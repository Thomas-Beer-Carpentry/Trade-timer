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

Browser tests use `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to another installed Chromium executable if needed. The cloud container uses `--no-sandbox` for its isolated test browser; this does not change the app's browser security. All fonts are bundled; running the app requires no third-party APIs or credentials.

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

Data is local to this browser and origin. It does not sync between devices, and clearing browser data removes it. Use **Export backup** to download JSON. Do not use private browsing for long-term records. Browser storage can be evicted by device/browser policies; backups protect against this. There is no cloud sync, login, or offline page caching in this version. A page already open calculates without a network connection, but loading it initially requires the host.

`src/storage.js` provides an adapter boundary for a future cloud-backed store; calculation and timer logic do not depend on browser storage.

## Modules

- `src/app.js`: screen rendering, form workflows and event coordination.
- `src/ui.js`: reusable UI components, escaping, icons and display formatting.
- `src/data.js`: job creation and worker rate defaults/history.
- `src/timer.js`: timestamp sessions, elapsed time and manual date conversion.
- `src/money.js`: fixed-point input, safe rounding and NZD formatting.
- `src/materials.js`: per-entry GST normalisation.
- `src/markup.js`: exclusive markup rules.
- `src/calculations.js`: labour aggregation, GST and job totals.
- `src/storage.js`: versioned persistence, validation and conflicting-write protection.

Browser tests emulate elapsed time, reloads and closing/reopening a page, and verify a full Chromium process restart using a persistent browser profile. Actual phone locking is not automated here; the same persisted-timestamp mechanism handles those intervals. Automated browser checks currently run in Chromium, with layouts checked from 360px to 1440px.
