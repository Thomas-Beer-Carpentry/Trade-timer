# Connect your phone and computer

The app is ready for a private Supabase account. Cloud sync becomes active only
when you create your project, run the SQL setup, and sign in. Your existing device
records stay saved during setup.

1. Go to https://supabase.com and create an account/project. Choose a region near
   New Zealand. Keep the project's database password private; the app does not
   need it.
2. Open the project's **SQL Editor**, paste the whole contents of
   [schema.sql](schema.sql), and run it. This creates private account storage and
   a revision-checked save function. It is safe to rerun without erasing jobs.
3. In **Authentication → URL Configuration**, set the Site URL to
   `https://thomas-beer-carpentry.github.io/Trade-timer/` and add that exact URL to
   the allowed Redirect URLs. Keep email/password authentication enabled. Email
   confirmation and password reset links return to this address. For local tests,
   also allow `http://localhost:5173/` if needed.
4. Copy the **Project URL** and **public publishable key** from your project's API
   settings. A publishable key begins `sb_publishable_`; a legacy `anon` key also
   works. Never use a secret key, `service_role` key, database password, or private
   access token. Those must not be included in a browser app.
5. Open Trade Timer → **Set up sync**, enter the Project URL/public key, and tap
   **Connect cloud**. This saves public settings on that device only. Choose
   **Create account**, confirm the email if requested, then **Sign in**.
6. On the other device, enter the same project settings and sign in using the same
   email and password. **Synced** means that device has checked the current cloud
   version. Open **Account & sync → Sync now** for an immediate check.
7. If you have jobs from before cloud setup, open **Account & sync** on the device
   containing them and choose **Import this device's jobs** while the account is
   empty. Wait for **Synced**, then sync the other device. The original local copy
   remains intact. If both devices contain different old records, export both
   before importing; this version does not automatically merge separate histories.

## Configure once for every device (optional)

In the GitHub repository, open **Settings → Secrets and variables → Actions →
Variables**. Add repository variables `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` with the public values from step 4. Rerun the Pages
workflow. New installs will receive the public settings automatically. These
values are intentionally included in the browser bundle; database permissions
and sign-in protect the data. Do not put secret/service-role keys here.

For local development, copy `.env.example` to `.env.local` and enter those same
public values. The `.env` files are ignored by Git.

## Install on a phone

After the new Pages deployment completes, open the app at the same address.

- **iPhone/iPad:** use Safari, tap **Share → Add to Home Screen**, then **Add**.
- **Android:** use Chrome's menu → **Install app** or **Add to Home screen**.
  The app's **Add to your phone** control also offers installation when the
  browser supports the prompt.

Open the home-screen icon to use Trade Timer in its own window. Sign in on that
installed app too if your browser/platform uses a separate storage session. The
app must load once online before its offline shell is cached. It does not store
cloud API responses in the service-worker cache.

## Offline work, updates and conflicts

Edits are saved to an account-specific cache immediately, then uploaded. The app
checks again every 15 seconds while visible and when returning online/to the app.
Jobs, workers, rates, timers, materials and markup/GST settings are included. Only
timestamps are synced for a running timer; its elapsed time does not require an
upload every second. Device clocks should be set automatically.

While **waiting to sync**, that device has unsent changes. Reconnect and wait for
**Synced** before expecting them on another device. Closing the app preserves the
pending changes. Sign out retains its account cache on that device; sign in again
to resume.

If two devices edit before syncing, the app detects a conflict and asks you to
choose **Use cloud version** or **Use this device version**. The losing complete
version is backed up on the resolving device before replacement, and can be
exported using **Download conflict backups**. No edits are silently overwritten.
This first version resolves whole-account snapshots; it does not automatically
combine simultaneous edits. Finish syncing one device before editing the other
for the simplest workflow.

App updates wait for an explicit **Update app** tap after forms are closed and
active timers stopped. Clearing browser storage removes local caches/pending
changes and locally retained conflict backups; previously synced cloud data can
be restored by signing in again. Export backups before clearing storage.

## Troubleshooting

- **Cloud function/table not found:** run the entire schema in the same project
  identified by the configured Project URL.
- **Email link returns to the wrong page:** recheck Site URL/Redirect URLs from
  step 3, then request a new confirmation/reset link.
- **No email arrives:** check spam and Supabase Auth email settings. Supabase's
  default email service is limited; configure your own SMTP provider if needed.
- **Waiting to sync:** check the internet connection, Supabase project availability,
  sign-in state and schema setup. Open Account & sync for the error message. Local
  changes remain cached until a successful upload.

The code was tested with separate browser profiles against a simulated Supabase
API, and the SQL authorization/CAS behavior was tested with actual PostgreSQL 17.
Live Supabase email delivery, sign-in and synchronization still need confirmation
with your project after setup. No project or private credentials have been created
or supplied by Codex.
