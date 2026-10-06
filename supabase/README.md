# Supabase storage setup

Create a Supabase project, open **SQL Editor**, paste [schema.sql](schema.sql), and
run the entire file. The script creates private per-account storage and a
revision-checked save function. Rerunning it preserves existing account data.

The app uses Supabase Auth: phone and computer must sign in to the same account.
Only the signed-in account can read its jobs. Direct browser writes are denied;
the app saves through `save_trade_timer` to detect changes made on another device.

The browser needs the project's URL and **publishable key** (or legacy `anon`
key). Never put a service-role key or database password in the app, repository,
GitHub build variables, or chat. A publishable key identifies the project;
Supabase Auth and the SQL permissions protect the data.

## Storage API

- Read: select `user_id,payload,revision,updated_at` from `trade_timer_data`.
- Save: call `save_trade_timer` with `expected_revision` and `payload`.
- Use revision `0` for an account that has no stored row.
- A successful save returns one row with the new revision.
- An empty result means another device already changed that revision. Load the
  latest account data before deciding whether to apply or discard local edits.

`payload` uses the app's version 1 data format: `workers` and `jobs` arrays. The
database checks the top-level shape; the app validates the complete payload.
