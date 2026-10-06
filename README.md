# Trade Timer

A mobile-first job charge-up app for tradespeople in New Zealand. Create jobs and a reusable labour pool, record time with a persistent timer or manual entries, add GST-inclusive/exclusive materials, and see a live NZD total with markup and GST.

## Development

Requires Node.js 20.19+ or 22.12+ (verified here with Node 24).

```sh
npm ci --cache /tmp/trade-timer-npm-cache
npm run dev
```

Use the existing checkout; a separate worktree is unnecessary. The dev server uses port 5173. For production, `npm run build` produces `dist/`, which can be served by any static web host. `npm run preview` checks the production build locally.

```sh
npm test          # billing, timestamp timers, storage integrity
npm run test:e2e  # real Chromium workflows, including persistence/reopening
npm run build    # production bundle
```

Browser tests use `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to another installed Chromium executable if needed. The cloud container uses `--no-sandbox` for its isolated test browser; this does not change the app's browser security. All fonts are bundled. Local mode needs no backend; optional private sync uses Supabase Auth and storage. See [cloud and phone setup](supabase/SETUP.md).

## How to use

1. Open **Labour pool** and add workers, optionally with default hourly charge-out rates excluding GST.
2. Create a job with a name, client and optional address/details.
3. Tap **Start New Day**, select the crew, use one shared rate or individual rates, and tap **Start timer**.
4. Tap **Stop timer** when finished. **Manual entry** records work without starting a live timer. Every session's workers, rates and start/finish dates remain editable.
5. Add materials, choosing GST Exclusive or GST Inclusive for each entry. Edit/delete them as needed.
6. Adjust job markup and GST. Markup applies to the entire bill or materials only, before GST. GST defaults to 15%.
7. Mark the job completed through **Edit job** after stopping its timer. Completed job history remains editable; reopen it to start another timer.

One timer may run per job. Different jobs retain independent timers. All timestamps use actual dates, so overnight sessions are supported. Times are shown in the browser's local timezone; use New Zealand device settings for NZ site times.

## Billing model

Money is entered as decimal NZD and parsed directly into integer cents. Percentages are parsed into integer basis points. BigInt multiplication/division avoids binary floating-point currency arithmetic.

- Labour: sum each worker's elapsed milliseconds × rate in cents, then round the job labour total to the nearest cent.
- GST-inclusive materials: divide each entry by `1 + GST rate`, rounding its exclusive amount to the nearest cent.
- Markup: apply the chosen percentage to exclusive labour + materials, or exclusive materials only; round to cents.
- GST: apply the job's GST percentage to the subtotal including markup; round to cents.
- Half-cent boundaries round up. No minimum hours, break deductions, overtime, billing increments, or compounding markup are added.

Individual displayed session totals are rounded independently; their sum can differ by a cent from the job's once-rounded labour total. The job total is authoritative.

The supplied example is automated in unit and browser tests: $700 labour + $500 materials + 15% whole-bill markup gives **$1,380.00 subtotal**, **$207.00 GST**, and **$1,587.00 total**.

## Persistence

Versioned browser localStorage retains jobs, workers, session timestamps, materials and settings across reloads and reopening the same browser/origin. Timers use stored start/finish timestamps rather than counting ticks, so time spent with the page suspended is included. The UI refreshes the calculated amount each second while visible and immediately when returning to the page.

Worker names/rates are copied into each session; later pool edits/removals preserve history. Storage errors are shown instead of claiming success. Corrupt/unsupported data is preserved for recovery; changes from another tab refresh the UI, and stale writes are rejected.

In local mode, data stays in this browser/origin. Optional Supabase sign-in syncs the same private account between phone and computer, with account-specific durable offline caches and revision checks. Original local records are retained and can be explicitly imported into an empty account. Clearing browser data removes unsynced changes; synced records restore after signing in. Export backups before clearing storage. See [setup and conflict resolution](supabase/SETUP.md).

The installable app caches its production shell after the first online visit. Add it through Safari’s Share → Add to Home Screen, or Chrome’s Install app/Add to Home screen menu. Updates require an explicit safe update tap and preserve open forms and active timers.

`src/storage.js` provides the local adapter; `src/cloud-store.js` supplies durable account caches and safe sync; `src/supabase-repository.js` is the cloud boundary. Billing and timestamp logic remain independent.

## Modules

- `src/app.js`: screen rendering, form workflows and event coordination.
- `src/ui.js`: reusable UI components, escaping, icons and display formatting.
- `src/data.js`: job creation and worker rate defaults/history.
- `src/timer.js`: timestamp sessions, elapsed time and manual date conversion.
- `src/money.js`: fixed-point input, safe rounding and NZD formatting.
- `src/materials.js`: per-entry GST normalisation.
- `src/markup.js`: exclusive markup rules.
- `src/calculations.js`: labour aggregation, GST and job totals.
- `src/storage.js`: local persistence, validation and conflicting-write protection.
- `src/cloud-store.js`: private durable cache, sync and conflict recovery.
- `src/supabase-repository.js`: authenticated database read/revision-checked save.
- `src/cloud-session.js`: account setup, sign-in, import and sync UI.
- `src/cloud-config.js`: public project configuration validation.
- `src/pwa.js`: phone install guidance and safe offline app updates.
- `supabase/schema.sql`: private storage, RLS and compare-and-swap RPC.

Browser tests emulate elapsed time, reloads and closing/reopening a page, and verify a full Chromium process restart using a persistent browser profile. Actual phone locking is not automated here; the same persisted-timestamp mechanism handles those intervals. Automated browser checks currently run in Chromium, with layouts checked from 360px to 1440px.

## GitHub Pages hosting

The repository includes `.github/workflows/pages.yml`. It installs from the lockfile, runs unit tests, builds the app, and deploys `dist/` to GitHub Pages on pushes to `main`. Production asset URLs are relative, so the app works under `/Trade-timer/`.

One-time repository setup: open **Settings → Pages → Build and deployment → Source**, and choose **GitHub Actions**. Then open **Actions → Deploy Trade Timer to GitHub Pages → Run workflow**, choosing `main` (or rerun the latest deployment if it failed before Pages was enabled).

After a successful deployment, the expected address is **https://thomas-beer-carpentry.github.io/Trade-timer/**. The deployed URL is also shown in the workflow's `github-pages` environment. If the repository is private, GitHub Pages availability depends on its account/organisation plan; do not change repository visibility to work around this without the owner's decision.

Future pushes to `main` deploy automatically. Optional sync requires your Supabase project setup. Keep using the same site address and sign in to the same account on each device. Public Supabase settings can be supplied through repository variables or the app’s Set up sync screen.

## Additional verification

`npm run test:e2e` includes real production service-worker checks and two-device sync workflows against a deterministic API fixture. `bash tests/database-sync.sh` (Docker + Python 3 required) verifies SQL permissions, account isolation, revision checks, concurrent saves and rollback in a disposable PostgreSQL container. The hosted Supabase project/email flow still needs a live setup check.
