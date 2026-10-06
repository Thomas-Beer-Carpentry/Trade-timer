import { createClient } from "@supabase/supabase-js";
import { CloudStore } from "./cloud-store.js";
import { SupabaseRepository } from "./supabase-repository.js";
import { LocalStorageAdapter } from "./storage.js";
import {
  CLOUD_CONFIG_KEY,
  readCloudConfig,
  validateCloudConfig,
} from "./cloud-config.js";
import { e, button, textField } from "./ui.js";
import "./cloud.css";

let callbacks,
  config,
  client,
  user,
  store,
  subscription,
  generation = 0,
  authError = "",
  poll;
const authDialog = document.createElement("dialog");
authDialog.id = "cloud-dialog";
authDialog.setAttribute("aria-labelledby", "cloud-title");
document.body.append(authDialog);
const labels = {
  synced: "Synced",
  pending: "Saved on device · sync pending",
  syncing: "Syncing…",
  offline: "Saved on device · waiting to sync",
  conflict: "Sync conflict · choose a version",
};
export function cloudStorageLabel() {
  return user && store
    ? (labels[store.status.state] ?? "Saved on device")
    : "Saved on this device";
}
export function cloudControls() {
  return `<div class="cloud-toolbar"><span data-cloud-status>${e(cloudStorageLabel())}</span>${button("cloud-open", user ? "Account & sync" : "Set up sync", "text-button")}</div>`;
}
function updateStatus() {
  document
    .querySelectorAll("[data-cloud-status]")
    .forEach((el) => (el.textContent = cloudStorageLabel()));
  callbacks?.onStatus?.();
}
function errorText(error) {
  return (
    error?.message ||
    "Could not connect. Check your connection and cloud setup."
  );
}
function drawDialog(title, body) {
  authDialog.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">TRADE TIMER</p><h2 id="cloud-title">${e(title)}</h2></div><button type="button" class="close" aria-label="Close">×</button></div><div class="dialog-body cloud-body">${body}<p class="form-error" role="alert" hidden></p></div>`;
  authDialog.querySelector(".close").onclick = () => authDialog.close();
  if (!authDialog.open) authDialog.showModal();
}
function showError(error) {
  const el = authDialog.querySelector(".form-error");
  if (el) {
    el.hidden = false;
    el.textContent = errorText(error);
  }
}
async function operation(button, task) {
  if (button) button.disabled = true;
  try {
    await task();
  } catch (error) {
    showError(error);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
function localData() {
  return new LocalStorageAdapter(localStorage).load();
}
function nonempty(data) {
  return data.jobs.length > 0 || data.workers.length > 0;
}
function renderSetup() {
  drawDialog(
    "Connect your cloud",
    `<p class="helper">Use the same Supabase project on your phone and computer. Create your project and run the database setup first; <a href="https://github.com/Thomas-Beer-Carpentry/Trade-timer/blob/main/supabase/SETUP.md" target="_blank" rel="noopener noreferrer">Read the setup guide</a>.</p><form id="cloud-setup">${textField("url", "Supabase Project URL", config?.url ?? "", 'type="url" placeholder="https://your-project.supabase.co" required')}${textField("key", "Public publishable key", config?.key ?? "", 'required autocomplete="off" spellcheck="false" placeholder="sb_publishable_…"')}<p class="helper">This is the public app key. Never enter the secret or service_role key.</p><button class="primary" type="submit">Connect cloud</button></form><p class="helper">These public settings are stored only on this device. If already configured in the deployment, both devices get them automatically.</p>`,
  );
  authDialog.querySelector("form").onsubmit = (event) => {
    event.preventDefault();
    const form = event.target;
    operation(form.querySelector("button"), async () => {
      const values = new FormData(form);
      const next = validateCloudConfig({
        url: values.get("url"),
        key: values.get("key"),
      });
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(next));
      await startClient(next);
      renderAccount();
    });
  };
}
function renderSignIn() {
  drawDialog(
    "Sign in to sync",
    `<p class="helper">Sign in with the same email account on both devices. Your jobs stay private to your account.</p>${authError ? `<p class="form-error">${e(authError)}</p>` : ""}<form id="cloud-login">${textField("email", "Email", "", 'type="email" required autocomplete="email"')}${textField("password", "Password", "", 'type="password" required minlength="8" autocomplete="current-password"')}<div class="cloud-buttons"><button class="primary" type="submit">Sign in</button><button class="secondary" type="button" id="create-account">Create account</button></div><button class="text-button" type="button" id="forgot-password">Forgot password?</button></form><button class="text-button" id="change-project">Change cloud project</button>`,
  );
  const form = authDialog.querySelector("form");
  const auth = async (create, control) =>
    operation(control, async () => {
      if (!form.reportValidity()) return;
      const values = new FormData(form),
        credentials = {
          email: values.get("email").trim(),
          password: values.get("password"),
        };
      const result = create
        ? await client.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: redirectUrl() },
          })
        : await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (create && !result.data.session) {
        drawDialog(
          "Check your email",
          '<p class="helper">Confirm your email, then sign in with that email and password on both devices.</p><button class="primary" id="back-to-signin">Back to sign in</button>',
        );
        authDialog.querySelector("#back-to-signin").onclick = () =>
          renderAccount();
      } else authDialog.close();
    });
  form.onsubmit = (event) => {
    event.preventDefault();
    auth(false, event.submitter);
  };
  form.querySelector("#create-account").onclick = (event) =>
    auth(true, event.currentTarget);
  form.querySelector("#forgot-password").onclick = (event) =>
    operation(event.currentTarget, async () => {
      const email = form.elements.email;
      if (!email.reportValidity()) return;
      const { error } = await client.auth.resetPasswordForEmail(
        email.value.trim(),
        { redirectTo: redirectUrl() },
      );
      if (error) throw error;
      callbacks.notify("Password reset email requested. Check your inbox.");
    });
  authDialog.querySelector("#change-project").onclick = renderSetup;
}
function redirectUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.href).href
    .split("?")[0]
    .split("#")[0];
}
function renderAccount() {
  if (!config) {
    renderSetup();
    return;
  }
  if (!user || !store) {
    renderSignIn();
    return;
  }
  const snapshot = store.load();
  let old;
  try {
    old = localData();
  } catch {
    old = null;
  }
  const canImport = old && nonempty(old) && !nonempty(snapshot);
  drawDialog(
    "Account & sync",
    `<p class="account-email">${e(user.email)}</p><p class="cloud-state" data-cloud-status>${e(cloudStorageLabel())}</p><p class="helper">${e(store.status.message ?? "Your jobs, workers, timers, materials and settings use the same account on every device.")}</p><div class="cloud-buttons"><button class="primary" id="sync-now">Sync now</button><button class="secondary" id="sign-out">Sign out</button></div>${canImport ? `<section class="cloud-import"><h3>Existing jobs on this device</h3><p class="helper">Your original ${old.jobs.length} job(s) and ${old.workers.length} worker(s) are still saved locally. Import them into this empty account to share them with your other device.</p><button class="secondary" id="import-local">Import this device's jobs</button></section>` : ""}${store.status.state === "conflict" ? `<section class="cloud-conflict"><h3>Changes on both devices</h3><p class="helper">Both versions are preserved until you choose. Download a backup, then decide which complete version to use. This does not automatically combine edits.</p><button class="secondary" id="download-current">Download this device version</button><div class="cloud-buttons"><button class="secondary" id="use-cloud">Use cloud version</button><button class="secondary" id="use-device">Use this device version</button></div></section>` : ""}${store.backups().length ? '<button class="text-button" id="sync-backups">Download conflict backups</button>' : ""}<p class="helper">When offline, edits stay saved on this device and upload when the connection returns. Sign out after syncing; pending changes remain in this account’s local cache.</p>`,
  );
  authDialog.querySelector("#sync-now").onclick = (event) =>
    operation(event.currentTarget, async () => {
      authDialog.close();
      await store.synchronize();
      renderAccount();
    });
  authDialog.querySelector("#sign-out").onclick = (event) =>
    operation(event.currentTarget, async () => {
      if (
        store.metadata.dirty &&
        !confirm(
          "Some changes are waiting to sync. They will remain in this account’s cache on this device. Sign out?",
        )
      )
        return;
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      authDialog.close();
    });
  const importButton = authDialog.querySelector("#import-local");
  if (importButton)
    importButton.onclick = (event) =>
      operation(event.currentTarget, async () => {
        if (
          store.status.state !== "synced" ||
          store.metadata.dirty ||
          store.metadata.revision !== 0
        )
          throw new Error(
            "Sync with the cloud first, then import into an empty account.",
          );
        if (nonempty(store.load()))
          throw new Error(
            "This account already has data. Export this device’s original data rather than replacing it.",
          );
        const original = localData();
        store.save(original);
        callbacks.onStore(store);
        authDialog.close();
        await store.synchronize();
      });
  const resolve = async (choice, control) =>
    operation(control, async () => {
      const label = choice === "cloud" ? "cloud" : "this device’s";
      if (
        !confirm(
          `Use ${label} complete version? The other version will be kept in a conflict backup on this device.`,
        )
      )
        return;
      authDialog.close();
      await store.resolveConflict(choice);
      callbacks.onData(store.load());
      renderAccount();
    });
  authDialog
    .querySelector("#use-cloud")
    ?.addEventListener("click", (event) =>
      resolve("cloud", event.currentTarget),
    );
  authDialog
    .querySelector("#use-device")
    ?.addEventListener("click", (event) =>
      resolve("device", event.currentTarget),
    );
  authDialog
    .querySelector("#download-current")
    ?.addEventListener("click", () =>
      download(store.load(), "trade-timer-device-version"),
    );
  authDialog
    .querySelector("#sync-backups")
    ?.addEventListener("click", () =>
      download(store.backups(), "trade-timer-conflict-backups"),
    );
}
function download(value, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function changeAccount(session) {
  const next = session?.user;
  if (next?.id === user?.id && store) return;
  if (user?.id && next?.id !== user.id && authDialog.open) authDialog.close();
  store?.stop();
  store = null;
  user = next;
  authError = "";
  if (next) {
    const currentUser = next.id;
    store = makeStore(currentUser);
    callbacks.onStore(store);
    store.synchronize();
  } else callbacks.onStore(new LocalStorageAdapter(localStorage));
  updateStatus();
}
function makeStore(currentUser) {
  return new CloudStore({
    storage: localStorage,
    userId: `${new URL(config.url).hostname}:${currentUser}`,
    repository: new SupabaseRepository(client, currentUser),
    canApply: () => !callbacks.isBusy() && !authDialog.open,
    onData: (nextData) => {
      if (user?.id === currentUser) callbacks.onData(nextData);
    },
    onStatus: updateStatus,
  });
}
async function startClient(nextConfig) {
  const current = ++generation;
  subscription?.unsubscribe();
  store?.stop();
  store = null;
  user = null;
  config = nextConfig;
  if (client) await client.auth.stopAutoRefresh();
  client = createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: `trade-timer:auth:${new URL(config.url).hostname}`,
    },
  });
  subscription = client.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (current !== generation) return;
      try {
        changeAccount(session);
        if (event === "PASSWORD_RECOVERY") renderPasswordReset();
      } catch (error) {
        authError = errorText(error);
        callbacks.notify(authError);
      }
    }, 0);
  }).data.subscription;
  const { data, error } = await client.auth.getSession();
  if (current !== generation) return;
  if (error) {
    authError = errorText(error);
    updateStatus();
    return;
  }
  changeAccount(data.session);
}
function renderPasswordReset() {
  drawDialog(
    "Choose a new password",
    `<form>${textField("password", "New password", "", 'type="password" required minlength="8" autocomplete="new-password"')}<button class="primary" type="submit">Save password</button></form>`,
  );
  authDialog.querySelector("form").onsubmit = (event) => {
    event.preventDefault();
    operation(event.submitter, async () => {
      const { error } = await client.auth.updateUser({
        password: new FormData(event.target).get("password"),
      });
      if (error) throw error;
      authDialog.close();
      callbacks.notify("Password updated");
    });
  };
}
export async function initializeCloud(options) {
  callbacks = options;
  try {
    config = readCloudConfig(localStorage, import.meta.env);
    if (config) await startClient(config);
  } catch (error) {
    authError = errorText(error);
    callbacks.notify(authError);
  }
  poll = setInterval(() => {
    if (user && !document.hidden) store?.synchronize();
  }, 15000);
  window.addEventListener("online", () => store?.synchronize());
  window.addEventListener("focus", () => store?.synchronize());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) store?.synchronize();
  });
  authDialog.addEventListener("close", () => store?.synchronize());
  updateStatus();
}
export function refreshCloud() {
  store?.synchronize();
}
export function handleCloudAction(action) {
  if (action !== "cloud-open") return false;
  renderAccount();
  return true;
}
export function cloudStorageKey() {
  return store?.key;
}
export function refreshCloudCache() {
  if (store && user) {
    store.stop();
    store = makeStore(user.id);
    callbacks.onStore(store, true);
    store.synchronize();
  }
}
