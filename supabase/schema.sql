-- Run this entire file in your Supabase project's SQL Editor as the postgres
-- owner. It is safe to rerun; existing account data is preserved.
begin;

create table if not exists public.trade_timer_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint trade_timer_payload_shape check (
    coalesce(
      jsonb_typeof(payload) = 'object'
      and payload -> 'version' = '1'::jsonb
      and jsonb_typeof(payload -> 'workers') = 'array'
      and jsonb_typeof(payload -> 'jobs') = 'array',
      false
    )
  )
);

alter table public.trade_timer_data enable row level security;

-- The browser can read only its signed-in account. All writes go through the
-- revision-checked function below; direct writes must never bypass that check.
revoke all on table public.trade_timer_data from public, anon, authenticated;
grant select on table public.trade_timer_data to authenticated;

drop policy if exists trade_timer_read_own_account on public.trade_timer_data;
create policy trade_timer_read_own_account
  on public.trade_timer_data for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.save_trade_timer(
  expected_revision bigint,
  payload jsonb
)
returns setof public.trade_timer_data
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
  stored_revision bigint;
begin
  if account_id is null then
    raise exception 'Sign in before saving Trade Timer data.'
      using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 0 then
    raise exception 'Expected revision must be a non-negative integer.'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
     or (payload -> 'version') is distinct from '1'::jsonb
     or pg_catalog.jsonb_typeof(payload -> 'workers') is distinct from 'array'
     or pg_catalog.jsonb_typeof(payload -> 'jobs') is distinct from 'array' then
    raise exception 'Trade Timer data must contain version 1, workers and jobs.'
      using errcode = '22023';
  end if;

  -- Serialize even the first save, when there is no row to lock yet. Hash
  -- collisions only serialize unrelated users; they never grant data access.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(account_id::text, 71046318)
  );

  select data.revision into stored_revision
    from public.trade_timer_data as data
    where data.user_id = account_id
    for update;

  if not found then
    if expected_revision <> 0 then
      return;
    end if;
    return query
      insert into public.trade_timer_data as data
        (user_id, payload, revision, updated_at)
      values (account_id, $2, 1, pg_catalog.now())
      returning data.*;
  elsif stored_revision = expected_revision then
    return query
      update public.trade_timer_data as data
        set payload = $2,
            revision = stored_revision + 1,
            updated_at = pg_catalog.now()
        where data.user_id = account_id
        returning data.*;
  end if;

  -- Zero rows signals a conflict. The caller must fetch the newest revision and
  -- ask the user to resolve their local changes rather than overwriting it.
  return;
end;
$$;

revoke all on function public.save_trade_timer(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_trade_timer(bigint, jsonb)
  to authenticated;

commit;
