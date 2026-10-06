#!/usr/bin/env bash
# Requires Docker and Python 3. Uses a disposable container with no network/ports.
set -euo pipefail
task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v docker >/dev/null
command -v python3 >/dev/null
task_container="$(docker run --detach --rm --network none \
  --env POSTGRES_PASSWORD=local-test-only postgres:17-alpine)"
trap 'docker rm --force "$task_container" >/dev/null 2>&1 || true' EXIT

task_ready=false
for task_attempt in {1..30}; do
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    task_ready=true
    break
  fi
  sleep 0.2
done
if [[ "$task_ready" != true ]]; then
  docker logs "$task_container"
  exit 1
fi
docker exec "$task_container" mkdir -p /checks/tests /checks/supabase
docker cp "$task_root/tests/database-sync.sql" "$task_container:/checks/tests/database-sync.sql"
docker cp "$task_root/supabase/schema.sql" "$task_container:/checks/supabase/schema.sql"
docker exec "$task_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  --quiet --tuples-only --no-align -f /checks/tests/database-sync.sql

python3 - "$task_container" <<'PY'
import json
import subprocess
import sys
import time

container = sys.argv[1]
psql = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align']

def execute(sql):
    result = subprocess.run(psql, input=sql, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def concurrent_case(account, revision, committed, first_payload, second_payload):
    first = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
    second = None
    try:
        first.stdin.write(f"""begin;
set local role authenticated;
set local request.jwt.claim.sub = '{account}';
select 'FIRST=' || count(*) from public.save_trade_timer({revision}, '{json.dumps(first_payload)}');
\\echo FIRST_SAVE_COMPLETE
""")
        first.stdin.flush()
        assert first.stdout.readline().strip() == 'FIRST=1', 'First writer did not save'
        assert first.stdout.readline().strip() == 'FIRST_SAVE_COMPLETE', 'First transaction barrier failed'

        second = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        second.stdin.write(f"""set application_name = 'trade_timer_cas_second';
set role authenticated;
set request.jwt.claim.sub = '{account}';
select 'SECOND=' || count(*) from public.save_trade_timer({revision}, '{json.dumps(second_payload)}');
""")
        second.stdin.close()
        # Wait until the second transaction overlaps the still-uncommitted first
        # transaction. There is no race based on a fixed sleep duration.
        deadline = time.monotonic() + 5
        while second.poll() is None:
            blocked = execute("""select exists(select 1 from pg_stat_activity
              where application_name = 'trade_timer_cas_second'
              and wait_event_type = 'Lock');""")
            if blocked == 't':
                break
            assert time.monotonic() < deadline, 'Second save did not complete or reach transaction barrier'
            time.sleep(0.05)
        first.stdin.write('commit;\n' if committed else 'rollback;\n')
        first.stdin.close()
        assert first.wait(timeout=5) == 0, first.stderr.read()
        assert second.wait(timeout=5) == 0, second.stderr.read()
        expected_second = 'SECOND=0' if committed else 'SECOND=1'
        assert second.stdout.read().strip() == expected_second, 'Concurrent CAS outcome was incorrect'
        expected_payload = first_payload if committed else second_payload
        actual = execute(f"select payload::text from public.trade_timer_data where user_id = '{account}';")
        assert json.loads(actual) == expected_payload, 'Concurrent save lost the winning payload'
        expected_revision = revision + 1
        actual_revision = execute(f"select revision from public.trade_timer_data where user_id = '{account}';")
        assert int(actual_revision) == expected_revision, 'Concurrent save advanced revision incorrectly'
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()

def payload(name):
    return {'version': 1, 'workers': [], 'jobs': [{'id': name}]}

account = '00000000-0000-0000-0000-000000000003'
concurrent_case(account, 0, True, payload('insert-winner'), payload('insert-loser'))
concurrent_case(account, 1, True, payload('update-winner'), payload('update-loser'))
concurrent_case('00000000-0000-0000-0000-000000000004', 0, False,
                payload('rolled-back'), payload('recovered'))
print('Concurrent initial save, update, and transaction rollback recovery checks passed.')
PY
