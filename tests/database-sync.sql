-- Run only in a disposable local PostgreSQL database, via database-sync.sh.
-- This simulates Supabase authentication and default API-role privileges.
\set ON_ERROR_STOP on
\o /dev/null

do $$
begin
  if to_regnamespace('auth') is not null then
    raise exception 'Refusing to modify a database with an existing auth schema.';
  end if;
end;
$$;

create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004');

\ir ../supabase/schema.sql

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%', message; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.assert_true(count(*) = 0, 'Nonzero revision must not create a missing row')
  from public.save_trade_timer(1, '{"version":1,"workers":[],"jobs":[]}');
select pg_temp.assert_true(count(*) = 1 and min(revision) = 1, 'Initial save must return revision 1')
  from public.save_trade_timer(0, '{"version":1,"workers":[],"jobs":[]}');
select pg_temp.assert_true(count(*) = 1 and min(revision) = 2, 'Matching revision must save once')
  from public.save_trade_timer(1, '{"version":1,"workers":[],"jobs":[{"id":"retained"}]}');
select pg_temp.assert_true(count(*) = 0, 'Stale revision must report a conflict')
  from public.save_trade_timer(1, '{"version":1,"workers":[],"jobs":[]}');
select pg_temp.assert_true(count(*) = 0, 'Revision zero must not overwrite existing data')
  from public.save_trade_timer(0, '{"version":1,"workers":[],"jobs":[]}');
select pg_temp.assert_true(count(*) = 1 and min(revision) = 2
    and bool_and(payload->'jobs' = '[{"id":"retained"}]'::jsonb),
    'Conflicts must preserve existing payload and revision')
  from public.trade_timer_data;

-- Rerunning configuration must preserve stored data, not just avoid errors.
reset role;
\ir ../supabase/schema.sql
set role authenticated;
select pg_temp.assert_true(count(*) = 1 and min(revision) = 2
    and bool_and(payload->'jobs' = '[{"id":"retained"}]'::jsonb),
    'Schema rerun must preserve data')
  from public.trade_timer_data;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.assert_true(count(*) = 0, 'Second account must not read first account data')
  from public.trade_timer_data;
select pg_temp.assert_true(count(*) = 1 and min(revision) = 1,
    'Second account must save independently')
  from public.save_trade_timer(0, '{"version":1,"workers":[],"jobs":[{"id":"other"}]}');
select pg_temp.assert_true(count(*) = 1
    and bool_and(user_id = '00000000-0000-0000-0000-000000000002'::uuid),
    'RLS must reveal only the signed-in account')
  from public.trade_timer_data;

do $$
begin
  begin
    insert into public.trade_timer_data (user_id, payload)
      values ('00000000-0000-0000-0000-000000000003', '{"version":1,"workers":[],"jobs":[]}');
    raise exception 'Direct authenticated insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.trade_timer_data set payload = '{"version":1,"workers":[],"jobs":[]}';
    raise exception 'Direct authenticated update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.trade_timer_data;
    raise exception 'Direct authenticated delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_trade_timer(-1, '{"version":1,"workers":[],"jobs":[]}');
    raise exception 'Negative revision unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_trade_timer(null, '{"version":1,"workers":[],"jobs":[]}');
    raise exception 'Null revision unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_trade_timer(1, '{"version":1,"workers":[]}');
    raise exception 'Invalid payload unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
select pg_temp.assert_true(count(*) = 0, 'Missing identity must reveal no data')
  from public.trade_timer_data;
do $$
begin
  begin
    perform public.save_trade_timer(0, '{"version":1,"workers":[],"jobs":[]}');
    raise exception 'Missing identity unexpectedly allowed to save';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set role anon;
-- A forged UUID claim must not give an anonymous role access.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$
begin
  begin
    perform 1 from public.trade_timer_data;
    raise exception 'Anonymous read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_trade_timer(0, '{"version":1,"workers":[],"jobs":[]}');
    raise exception 'Anonymous RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select pg_temp.assert_true(count(*) = 2, 'Negative authorization tests must leave data untouched')
  from public.trade_timer_data;
\o
\echo Authorization, idempotency, shape validation and sequential CAS checks passed.
