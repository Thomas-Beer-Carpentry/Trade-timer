import { registerSW } from "virtual:pwa-register";
import { button, icon } from "./ui.js";

let installPrompt = null;
let installed = false;
let updateAvailable = false;
let offlineReady = false;
let reloadNeeded = false;
let updateRequested = false;
let initialized = false;
let refresh = () => {};
let busy = () => false;
let notify = () => {};
let updateServiceWorker = null;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;
const isAppleMobile = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Register once. Updates always need an explicit click and a safe moment to reload. */
export function initializePwa(options = {}) {
  refresh = options.onChange ?? (() => {});
  busy = options.isBusy ?? (() => false);
  notify = options.notify ?? (() => {});
  if (initialized) return;
  initialized = true;
  installed = isStandalone();
  window.addEventListener("beforeinstallprompt", (event) => {
    if (isAppleMobile()) return;
    event.preventDefault();
    installPrompt = event;
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    installPrompt = null;
    refresh();
    notify("Trade Timer added to your home screen.");
  });
  // A Vite dev server has no production service worker.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateAvailable = true;
      refresh();
    },
    onNeedReload() {
      // Another tab may activate an update. Keep this tab's work intact until its user agrees.
      reloadNeeded = true;
      if (updateRequested && !busy()) window.location.reload();
      else {
        updateAvailable = true;
        refresh();
      }
    },
    onOfflineReady() {
      offlineReady = true;
      refresh();
    },
    onRegisterError() {
      // Local data and normal online use are still available; do not promise offline readiness.
      offlineReady = false;
      refresh();
    },
  });
}

/** Place this in the app shell; existing application action delegation handles the buttons. */
export function pwaControls() {
  const install =
    installed || isStandalone()
      ? "<span>On your home screen</span>"
      : `<details class="install-guide"><summary>Add to your phone</summary><p>${
          isAppleMobile()
            ? "Open this app in Safari, tap Share, then Add to Home Screen."
            : "Open this app in Chrome or Edge. Use the browser menu and choose Install app or Add to Home screen."
        }</p>${installPrompt ? button("pwa-install", `${icon("download")} Install Trade Timer`, "secondary") : ""}</details>`;
  const update = updateAvailable
    ? `<div class="pwa-update"><span>A new version is ready.</span>${button("pwa-update", "Update app", "secondary")}<small>Finish editing and stop your timers first.</small></div>`
    : "";
  return `<section class="pwa-controls" aria-label="App installation">${install}${offlineReady ? '<span class="pwa-offline">Ready for offline use</span>' : ""}${update}</section>`;
}

/** Returns false for other application actions. No data is cleared by installing/updating. */
export async function handlePwaAction(action) {
  if (action === "pwa-install") {
    if (!installPrompt) return true;
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === "accepted") installed = true;
    refresh();
    return true;
  }
  if (action === "pwa-update") {
    if (busy()) {
      notify("Finish editing and stop your timers before updating the app.");
      return true;
    }
    if (updateAvailable && reloadNeeded) window.location.reload();
    else if (updateAvailable && updateServiceWorker) {
      updateRequested = true;
      await updateServiceWorker(true);
    }
    return true;
  }
  return false;
}
