import { initializePwa, pwaControls, handlePwaAction } from "./pwa.js";
import {
  initializeCloud,
  cloudControls,
  cloudStorageLabel,
  handleCloudAction,
  cloudStorageKey,
  refreshCloudCache,
  refreshCloud,
} from "./cloud-session.js";
import {
  e,
  dateLabel,
  timeLabel,
  rateValue,
  icon,
  button,
  textField,
  rateField,
} from "./ui.js";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./styles.css";
import {
  calculateJob,
  labourCents,
  materialExclCents,
  money,
  parseMoney,
  parsePercent,
} from "./calculations.js";
import {
  clock,
  elapsedMs,
  hours,
  localDateTime,
  parseTime,
  startSession,
  stopSession,
} from "./timer.js";
import { LocalStorageAdapter, STORAGE_KEY } from "./storage.js";
import { createJob, newId, previousRate } from "./data.js";

const app = document.querySelector("#app");
const dialog = document.querySelector("#editor");
const toast = document.querySelector("#toast");
let storage;
let data,
  page = "jobs",
  selectedJob = null,
  filter = "active",
  toastTimeout;
const getJob = () => data.jobs.find((j) => j.id === selectedJob);
const activeSession = (job) =>
  job.sessions.find((s) => s.start !== null && s.finish === null);
function notify(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 4500);
}
function commit(change) {
  const next = structuredClone(data);
  change(next);
  storage.save(next);
  data = next;
  render();
}
function shell(content) {
  const running = data.jobs.filter((j) => activeSession(j));
  app.innerHTML = `<header class="topbar"><a href="#" class="brand" aria-label="Trade Timer home">${icon("timer")}<span>TRADE<span class="brand-light"> TIMER</span></span></a><span class="currency-label">NZD <span>•</span> GST 15% default</span></header>
 <div class="layout"><aside class="sidebar"><p class="eyebrow">YOUR WORKSPACE</p>${button("jobs", `${icon("jobs")} Jobs`, page === "jobs" ? "nav active" : "nav")}${button("workers", `${icon("workers")} Labour pool`, page === "workers" ? "nav active" : "nav")}<div class="sidebar-note">Built for the tools-down total.<br><span>Labour, materials & GST. Sorted.</span></div></aside>
 <main id="main">${pwaControls()}${cloudControls()}${running.length && !selectedJob ? `<div class="active-banner"><span class="live-dot"></span><span>${running.length} job timer${running.length > 1 ? "s" : ""} running</span>${button("open", `View ${icon("arrow")}`, "text-button", `data-id="${running[0].id}"`)}</div>` : ""}${content}</main></div>
 <nav class="bottom-nav" aria-label="Main navigation">${button("jobs", `${icon("jobs")}<span>Jobs</span>`, page === "jobs" ? "nav active" : "nav")}${button("workers", `${icon("workers")}<span>Labour pool</span>`, page === "workers" ? "nav active" : "nav")}</nav>`;
}
function render() {
  if (!data) return;
  if (page === "workers") renderWorkers();
  else if (selectedJob && getJob()) renderJob();
  else renderHome();
  tick();
}
function renderHome() {
  selectedJob = null;
  const active = data.jobs.filter((j) => j.status === "active").length;
  const jobs = data.jobs
    .filter((j) => filter === "all" || j.status === filter)
    .sort((a, b) => b.createdAt - a.createdAt);
  shell(`<div class="page-heading"><div><p class="eyebrow">EVERY HOUR. EVERY DOLLAR.</p><h1>Your jobs<span class="heading-dot">.</span></h1><p class="muted">Keep the work moving. Know what it's worth.</p></div>${button("new-job", `${icon("plus")} New job`, "primary")}</div>
 <div class="overview"><div><span class="overview-number">${active.toString().padStart(2, "0")}</span><span>Active jobs</span></div><div><span class="overview-number">${data.workers.length.toString().padStart(2, "0")}</span><span>Workers in your pool</span></div><div class="overview-caption">A clear picture of<br><strong>every job on the go.</strong></div></div>
 <div class="section-bar"><div class="tabs" aria-label="Filter jobs">${["active", "completed", "all"].map((f) => button(`filter-${f}`, f === "all" ? "All jobs" : f[0].toUpperCase() + f.slice(1), filter === f ? "tab selected" : "tab", `aria-pressed="${filter === f}"`)).join("")}</div><span class="count-label">${jobs.length} job${jobs.length === 1 ? "" : "s"}</span></div>
 ${
   jobs.length
     ? `<div class="job-grid">${jobs
         .map((job) => {
           const total = calculateJob(job);
           const running = activeSession(job);
           return `<button class="job-card" data-action="open" data-id="${job.id}"><div class="card-top"><span class="job-symbol">${icon("jobs")}</span><span class="badge ${running ? "running" : job.status}">${running ? '<span class="live-dot"></span> Timer running' : job.status === "active" ? "Active" : "Completed"}</span></div><h2>${e(job.name)}</h2><p class="muted client-name">${e(job.client)}</p>${job.description ? `<p class="address">${e(job.description)}</p>` : ""}<div class="job-card-total"><div><span class="eyebrow">CHARGE-UP TOTAL</span><strong data-job-total="${job.id}">${money(total.total)}</strong><small>incl. GST</small></div>${icon("arrow")}</div><div class="card-footer"><span>${job.sessions.length} work session${job.sessions.length === 1 ? "" : "s"}</span><span>Created ${dateLabel(job.createdAt)}</span></div></button>`;
         })
         .join("")}</div>`
     : `<div class="empty-state"><span class="empty-icon">${icon("jobs")}</span><h2>${filter === "completed" ? "No completed jobs yet" : filter === "active" && data.jobs.length ? "No active jobs" : "Your next job starts here"}</h2><p>Create a job, choose your crew, and keep a running total<br class="desktop-only"> from the first hour to the final fixing.</p>${button("new-job", `${icon("plus")} Create a job`, "primary")}</div>`
 }
 <div class="storage-note"><span class="small-dot"></span> <span data-cloud-status>${e(cloudStorageLabel())}</span> · ${button("backup", "Export backup", "text-button")}</div>`);
}
function renderWorkers() {
  selectedJob = null;
  shell(`<div class="page-heading"><div><p class="eyebrow">YOUR CREW, READY TO GO</p><h1>Labour pool<span class="heading-dot">.</span></h1><p class="muted">Add your workers once. Use them on any job.</p></div>${button("new-worker", `${icon("plus")} Add worker`, "primary")}</div>
 <div class="panel"><div class="panel-heading"><h2>Your workers</h2><span class="count-label">${data.workers.length} in pool</span></div>${data.workers.length ? data.workers.map((w) => `<div class="worker-row"><span class="avatar">${e(w.name.slice(0, 2).toUpperCase())}</span><div class="row-main"><strong>${e(w.name)}</strong><span>${w.rateCents ? `${money(w.rateCents)} / hr excl. GST` : "No default rate set"}</span></div>${button("edit-worker", `${icon("edit")}<span class="desktop-only">Edit</span>`, "icon-button", `data-id="${w.id}" aria-label="Edit ${e(w.name)}"`)}</div>`).join("") : `<div class="empty-state compact">${icon("workers")}<h2>Build your crew</h2><p>Add yourself and the people you work with.<br>Hourly rates can be adjusted for every work day.</p>${button("new-worker", "Add your first worker", "primary")}</div>`}</div><p class="helper">Removing a worker from the pool keeps their existing job history.</p>`);
}
function renderJob() {
  const j = getJob(),
    total = calculateJob(j),
    running = activeSession(j);
  shell(`<div class="job-heading">${button("jobs", `${icon("back")} All jobs`, "text-button")}<div class="job-title-line"><div><p class="eyebrow">${e(j.client)}</p><h1>${e(j.name)}</h1><p class="muted">${e(j.description) || "Job charge-up"} <span class="separator">·</span> ${dateLabel(j.createdAt)}</p></div>${button("edit-job", `${icon("edit")} Edit job`, "secondary")}</div></div>
 <div class="job-layout"><section class="total-card" aria-label="Running job total"><div class="total-top"><span class="eyebrow">RUNNING TOTAL</span><span class="badge ${running ? "running" : j.status}">${running ? '<span class="live-dot"></span> Live' : j.status === "active" ? "Active" : "Completed"}</span></div><div class="big-total" data-total="total">${money(total.total)}</div><p class="total-caption">NZD · including GST</p><div class="breakdown"><div><span>Labour</span><strong data-total="labour">${money(total.labour)}</strong></div><div><span>Materials <small>excl. GST</small></span><strong data-total="materials">${money(total.materials)}</strong></div><div><span>Markup ${j.markup.enabled ? `(${rateValue(j.markup.basisPoints)}%)` : ""}</span><strong data-total="markup">${money(total.markup)}</strong></div><div class="subtotal"><span>Subtotal <small>excl. GST</small></span><strong data-total="subtotal">${money(total.subtotal)}</strong></div><div><span>GST (${rateValue(j.gstBasisPoints)}%)</span><strong data-total="gst">${money(total.gst)}</strong></div></div><div class="total-foot">${icon("check")} Labour, materials &amp; GST included.</div></section>
 <div class="job-content">
 ${running ? `<section class="timer-card"><div class="timer-status"><span class="live-dot"></span> TIMER RUNNING <span class="today-label">${dateLabel(running.start)}</span></div><div class="timer-clock" data-clock="${running.id}">${clock(elapsedMs(running))}</div><div class="crew-chips">${running.workers.map((w) => `<span>${e(w.name)} <small>${money(w.rateCents)}/hr</small></span>`).join("")}</div><div class="timer-actions">${button("stop", '<span class="stop-square"></span> Stop timer', "stop-button", `data-id="${running.id}"`)}${button("edit-session", "Edit crew / times", "timer-edit", `data-id="${running.id}"`)}</div><div class="timer-bottom"><span>Started ${timeLabel(running.start)}</span><span>Labour <strong data-session-cost="${running.id}">${money(labourCents([running]))}</strong></span></div></section>` : j.status === "active" ? `<section class="start-card"><span class="start-icon">${icon("timer")}</span><div><h2>Ready to get to work?</h2><p>Pick your crew and start today's timer.</p></div>${button("new-session", `${icon("plus")} Start New Day`, "primary")}</section>` : `<div class="completed-note">${icon("check")} This job is completed. History and materials remain editable.${button("reopen", "Reopen job", "text-button")}</div>`}
 <section class="panel"><div class="panel-heading"><h2>${icon("timer")} Work days <span class="inline-count">${j.sessions.length}</span></h2>${button("manual-session", "+ Manual entry", "text-button")}</div>${
   j.sessions.length
     ? `<div class="session-list">${[...j.sessions]
         .sort((a, b) => (b.start ?? b.createdAt) - (a.start ?? a.createdAt))
         .map((s) => sessionRow(s))
         .join("")}</div>`
     : `<div class="quiet-empty">No labour recorded yet.<br>Start a timer or add a manual time entry.</div>`
 }<div class="panel-footer"><span>Today's labour <small>${new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short" }).format(Date.now())}</small></span><strong data-today-labour></strong></div></section>
 <section class="panel"><div class="panel-heading"><h2>${icon("material")} Materials <span class="inline-count">${j.materials.length}</span></h2>${button("new-material", "+ Add Materials", "text-button")}</div>${
   j.materials.length
     ? j.materials
         .slice()
         .sort((a, b) => b.date - a.date)
         .map(
           (m) =>
             `<div class="material-row"><span class="material-icon">${icon("material")}</span><div class="row-main"><strong>${e(m.description)}</strong><span>${dateLabel(m.date)} · ${m.gstInclusive ? "GST inclusive" : "GST exclusive"}</span></div><div class="material-amount"><strong>${money(m.amountCents)}</strong>${m.gstInclusive ? `<small>${money(materialExclCents(m, j.gstBasisPoints))} excl.</small>` : ""}</div>${button("edit-material", icon("edit"), "icon-button", `data-id="${m.id}" aria-label="Edit ${e(m.description)}"`)}</div>`,
         )
         .join("")
     : `<div class="quiet-empty">Timber, fixings, the lot.<br>Add material costs as you go.</div>`
 }</section>
 <section class="panel settings-panel"><div><h2>Markup & GST</h2><p>${j.markup.enabled ? `${rateValue(j.markup.basisPoints)}% on ${j.markup.scope === "entire" ? "entire bill" : "materials only"}` : "No markup applied"} · GST ${rateValue(j.gstBasisPoints)}%</p></div>${button("settings", "Adjust", "secondary")}</section>
 <div class="storage-note"><span class="small-dot"></span> <span data-cloud-status>${e(cloudStorageLabel())}</span> · ${button("backup", "Export backup", "text-button")}</div>
 </div></div>`);
}
function sessionRow(s) {
  const running = s.start !== null && s.finish === null;
  return `<article class="session-row"><div class="session-top"><strong>${dateLabel(s.start ?? s.createdAt)}</strong><span class="badge ${running ? "running" : "neutral"}">${running ? "Running" : s.start === null ? "Ready to start" : `${hours(elapsedMs(s))} hrs`}</span></div>${s.workers.map((w) => `<div class="session-worker"><span>${e(w.name)} <small>${money(w.rateCents)}/hr</small></span><span>${s.start === null ? "Not started" : `${timeLabel(s.start)}–${s.finish === null ? "now" : timeLabel(s.finish)}`}</span></div>`).join("")}<div class="session-bottom"><strong data-session-cost="${s.id}">${money(labourCents([s]))} <small>excl. GST</small></strong><div>${s.start === null ? button("start", `${icon("timer")} Start timer`, "small-primary", `data-id="${s.id}"`) : ""}${button("edit-session", "Edit", "text-button", `data-id="${s.id}"`)}</div></div></article>`;
}
function todayLabour(j, now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const midnight = date.getTime();
  const tomorrow = new Date(midnight);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return labourCents(
    j.sessions
      .filter((s) => s.start !== null)
      .map((s) => ({
        ...s,
        start: Math.max(s.start, midnight),
        finish: Math.min(s.finish ?? now, tomorrow.getTime()),
      })),
    now,
  );
}
function tick() {
  const now = Date.now();
  for (const job of data?.jobs ?? []) {
    const total = calculateJob(job, now);
    document
      .querySelectorAll(`[data-job-total="${job.id}"]`)
      .forEach((el) => (el.textContent = money(total.total)));
  }
  const job = getJob();
  if (!job) return;
  const total = calculateJob(job, now);
  document
    .querySelectorAll("[data-total]")
    .forEach((el) => (el.textContent = money(total[el.dataset.total])));
  for (const s of job.sessions) {
    document
      .querySelectorAll(`[data-clock="${s.id}"]`)
      .forEach((el) => (el.textContent = clock(elapsedMs(s, now))));
    document
      .querySelectorAll(`[data-session-cost="${s.id}"]`)
      .forEach(
        (el) =>
          (el.innerHTML = `${money(labourCents([s], now))}${el.closest(".session-row") ? " <small>excl. GST</small>" : ""}`),
      );
  }
  const today = document.querySelector("[data-today-labour]");
  if (today) today.textContent = money(todayLabour(job, now));
}
function modal(
  title,
  body,
  onSave,
  { submit = "Save", footer = "", setup } = {},
) {
  dialog.innerHTML = `<form><div class="dialog-heading"><div><p class="eyebrow">TRADE TIMER</p><h2 id="dialog-title">${title}</h2></div><button type="button" class="close" aria-label="Close">×</button></div><div class="dialog-body">${body}<p class="form-error" role="alert" hidden></p></div><div class="dialog-footer">${footer}<button type="button" class="secondary cancel">Cancel</button><button type="submit" class="primary">${submit}</button></div></form>`;
  const form = dialog.querySelector("form");
  form.onsubmit = (event) => {
    event.preventDefault();
    try {
      onSave(new FormData(form), form);
      dialog.close();
      notify("Saved on this device");
    } catch (error) {
      form.querySelector(".form-error").hidden = false;
      form.querySelector(".form-error").textContent = error.message;
    }
  };
  form.querySelector(".close").onclick = () => dialog.close();
  form.querySelector(".cancel").onclick = () => dialog.close();
  setup?.(form);
  dialog.showModal();
}
function deleteFooter() {
  return '<button type="button" class="danger-text" data-delete>Delete</button>';
}
function confirmDelete(message, change) {
  if (confirm(message)) {
    commit(change);
    dialog.close();
    notify("Entry removed");
  }
}
function jobEditor(edit = false) {
  const j = edit ? getJob() : null;
  modal(
    edit ? "Edit job" : "Create a new job",
    `${textField("name", "Job name", j?.name, 'required maxlength="120" placeholder="e.g. Kauri Street deck"')}${textField("client", "Client name", j?.client, 'required maxlength="120" placeholder="Who are you working for?"')}<label class="field">Description / address <span class="optional">optional</span><textarea name="description" rows="3" maxlength="600" placeholder="Job details or site address">${e(j?.description)}</textarea></label>${edit ? `<label class="field">Job status<select name="status"><option value="active" ${j.status === "active" ? "selected" : ""}>Active</option><option value="completed" ${j.status === "completed" ? "selected" : ""}>Completed</option></select></label>` : ""}`,
    (f) => {
      const values = {
        name: f.get("name").trim(),
        client: f.get("client").trim(),
        description: f.get("description").trim(),
      };
      if (!values.name || !values.client)
        throw new Error("Enter a job name and client.");
      if (edit) {
        if (f.get("status") === "completed" && activeSession(j))
          throw new Error("Stop the running timer before completing this job.");
        commit((d) =>
          Object.assign(
            d.jobs.find((x) => x.id === j.id),
            values,
            { status: f.get("status") },
          ),
        );
      } else {
        const job = createJob(values);
        selectedJob = job.id;
        commit((d) => d.jobs.push(job));
      }
    },
    { submit: edit ? "Save job" : "Create job" },
  );
}
function workerEditor(id) {
  const worker = data.workers.find((w) => w.id === id);
  modal(
    worker ? "Edit worker" : "Add a worker",
    `${textField("name", "Worker name", worker?.name, 'required maxlength="100" placeholder="e.g. Eryk"')}${rateField("rate", "Default hourly charge-out rate", worker?.rateCents ? rateValue(worker.rateCents) : "")}<p class="helper">You can change this rate for each work day. Leave it blank to enter a rate when starting a job.</p>`,
    (f) => {
      const name = f.get("name").trim();
      if (!name) throw new Error("Enter a worker name.");
      const rateCents = f.get("rate") ? parseMoney(f.get("rate")) : 0;
      commit((d) => {
        if (worker)
          Object.assign(
            d.workers.find((w) => w.id === id),
            { name, rateCents },
          );
        else d.workers.push({ id: newId(), name, rateCents });
      });
    },
    {
      footer: worker ? deleteFooter() : "",
      setup: (form) => {
        form.elements.rate.required = false;
        if (worker)
          form.querySelector("[data-delete]").onclick = () =>
            confirmDelete(
              `Remove ${worker.name} from the labour pool? Existing job history will be kept.`,
              (d) => {
                d.workers = d.workers.filter((w) => w.id !== id);
              },
            );
      },
    },
  );
}
function sessionEditor(id, manual = false) {
  const j = getJob(),
    session = j.sessions.find((s) => s.id === id);
  const workers = [...data.workers];
  for (const w of session?.workers ?? [])
    if (!workers.some((pool) => pool.id === w.id))
      workers.push({ ...w, removed: true });
  if (!workers.length) {
    notify("Add a worker to your labour pool first.");
    page = "workers";
    selectedJob = null;
    render();
    workerEditor();
    return;
  }
  const isRunning = session?.start !== null && session?.finish === null;
  const same = session
    ? new Set(session.workers.map((w) => w.rateCents)).size === 1
    : true;
  const defaultRate =
    session?.workers[0]?.rateCents ?? previousRate(data, workers[0].id);
  const selected = new Set(session?.workers.map((w) => w.id) ?? []);
  modal(
    session
      ? "Edit labour session"
      : manual
        ? "Manual labour entry"
        : "Start a new work day",
    `
 <p class="helper">${session ? "Changes apply to this session only." : "Choose the crew working this session, then set their rates."}</p>
 <details class="worker-picker" open><summary>Select workers <span id="selected-count"></span></summary><div>${workers.map((w) => `<label class="check-row"><input type="checkbox" name="workers" value="${w.id}" ${selected.has(w.id) ? "checked" : ""}><span>${e(w.name)}${w.removed ? " <small>(removed from pool)</small>" : ""}</span><small>${money(session?.workers.find((x) => x.id === w.id)?.rateCents ?? previousRate(data, w.id))}/hr</small></label>`).join("")}</div></details>
 <label class="check-row same-rate"><input type="checkbox" name="same" ${same ? "checked" : ""}>All selected workers have the same hourly rate</label>
 <div id="shared-rate">${rateField("sharedRate", "Hourly rate", rateValue(defaultRate))}</div>
 <div id="individual-rates">${workers.map((w) => `<div data-worker-rate="${w.id}">${rateField(`rate-${w.id}`, w.name, rateValue(session?.workers.find((x) => x.id === w.id)?.rateCents ?? previousRate(data, w.id)))}</div>`).join("")}</div>
 ${manual || session ? `<fieldset class="time-fields"><legend>Session times</legend>${textField("start", "Start date & time", session?.start !== null && session?.start !== undefined ? localDateTime(session.start) : localDateTime(), 'type="datetime-local" required')}<label class="check-row"><input type="checkbox" name="running" ${isRunning ? "checked" : ""}>Timer is still running</label><div id="finish-field">${textField("finish", "Finish date & time", session?.finish !== null && session?.finish !== undefined ? localDateTime(session.finish) : localDateTime(), 'type="datetime-local" required')}</div><p class="helper" id="duration-preview"></p></fieldset>` : `<p class="helper">Your timer starts when you tap the button below. You can edit times later.</p>`}
 `,
    (f) => {
      const ids = f.getAll("workers");
      if (!ids.length) throw new Error("Select at least one worker.");
      const crew = ids.map((workerId) => {
        const w =
          session?.workers.find((w) => w.id === workerId) ??
          workers.find((w) => w.id === workerId);
        return {
          id: w.id,
          name: w.name,
          rateCents: parseMoney(
            f.get(f.has("same") ? "sharedRate" : `rate-${workerId}`),
          ),
        };
      });
      let start, finish;
      if (manual || session) {
        start =
          session?.start != null &&
          f.get("start") === localDateTime(session.start)
            ? session.start
            : parseTime(f.get("start"));
        finish = f.has("running")
          ? null
          : session?.finish != null &&
              f.get("finish") === localDateTime(session.finish)
            ? session.finish
            : parseTime(f.get("finish"));
      } else {
        start = Date.now();
        finish = null;
      }
      if (finish !== null && finish < start)
        throw new Error(
          "Finish must be after the start. Use the next date for overnight work.",
        );
      if (finish === null && start > Date.now())
        throw new Error("A running timer cannot start in the future.");
      if (finish === null && j.status === "completed")
        throw new Error("Reopen the job before starting a timer.");
      if (
        finish === null &&
        j.sessions.some(
          (s) => s.id !== id && s.start !== null && s.finish === null,
        )
      )
        throw new Error(
          "Stop the existing timer first, or enter a finish time.",
        );
      const saved = {
        id: id ?? newId(),
        createdAt: session?.createdAt ?? Date.now(),
        workers: crew,
        start,
        finish,
      };
      commit((d) => {
        const job = d.jobs.find((x) => x.id === j.id);
        if (session)
          job.sessions[job.sessions.findIndex((s) => s.id === id)] = saved;
        else job.sessions.push(saved);
      });
    },
    {
      submit: session ? "Save session" : manual ? "Save entry" : "Start timer",
      footer: session ? deleteFooter() : "",
      setup: (form) => {
        const update = () => {
          const ids = [
            ...form.querySelectorAll('[name="workers"]:checked'),
          ].map((el) => el.value);
          const shared = form.elements.same.checked;
          form.querySelector("#selected-count").textContent = ids.length
            ? `${ids.length} selected`
            : "Choose your crew";
          form.querySelector("#shared-rate").hidden = !shared;
          form.elements.sharedRate.disabled = !shared;
          form.querySelector("#individual-rates").hidden = shared;
          for (const w of workers) {
            const el = form.querySelector(`[data-worker-rate="${w.id}"]`);
            el.hidden = shared || !ids.includes(w.id);
            el.querySelector("input").disabled = shared || !ids.includes(w.id);
          }
          if (form.elements.running) {
            const running = form.elements.running.checked;
            form.querySelector("#finish-field").hidden = running;
            form.elements.finish.disabled = running;
            const start = new Date(form.elements.start.value).getTime(),
              finish = running
                ? Date.now()
                : new Date(form.elements.finish.value).getTime();
            form.querySelector("#duration-preview").textContent =
              Number.isFinite(start) && Number.isFinite(finish)
                ? finish < start
                  ? "Finish must be after start."
                  : `${hours(finish - start)} hours per worker`
                : "";
          }
        };
        form.addEventListener("change", update);
        form.addEventListener("input", () => {
          if (form.elements.running) update();
        });
        update();
        if (!session) {
          let previousFirst = null;
          form.addEventListener("change", () => {
            const first = form.querySelector('[name="workers"]:checked')?.value;
            if (first && first !== previousFirst) {
              form.elements.sharedRate.value = rateValue(
                previousRate(data, first),
              );
              previousFirst = first;
            }
          });
        }
        if (session)
          form.querySelector("[data-delete]").onclick = () =>
            confirmDelete(
              "Delete this labour session and its charge? This cannot be undone.",
              (d) => {
                const job = d.jobs.find((x) => x.id === j.id);
                job.sessions = job.sessions.filter((s) => s.id !== id);
              },
            );
      },
    },
  );
}
function materialEditor(id) {
  const j = getJob(),
    material = j.materials.find((m) => m.id === id);
  modal(
    material ? "Edit materials" : "Add materials",
    `${textField("description", "Description", material?.description, 'required maxlength="200" placeholder="e.g. Timber and fixings"')}<label class="field">Amount (NZD)<div class="input-affix"><span>$</span><input aria-label="Amount (NZD)" name="amount" type="number" inputmode="decimal" min="0" max="999999999.99" step="0.01" value="${material ? rateValue(material.amountCents) : ""}" placeholder="0.00" required></div></label><fieldset class="gst-choice"><legend>This amount is</legend><label class="radio-row"><input type="radio" name="gst" value="exclusive" ${!material?.gstInclusive ? "checked" : ""}>GST Exclusive</label><label class="radio-row"><input type="radio" name="gst" value="inclusive" ${material?.gstInclusive ? "checked" : ""}>GST Inclusive</label></fieldset>${textField("date", "Date & time", localDateTime(material?.date ?? Date.now()), 'type="datetime-local" required')}<p class="helper">GST treatment applies to this entry only. Markup is calculated on the GST-exclusive cost.</p>`,
    (f) => {
      const description = f.get("description").trim();
      if (!description) throw new Error("Enter a material description.");
      const entry = {
        id: id ?? newId(),
        description,
        amountCents: parseMoney(f.get("amount")),
        gstInclusive: f.get("gst") === "inclusive",
        date:
          material && f.get("date") === localDateTime(material.date)
            ? material.date
            : parseTime(f.get("date")),
      };
      commit((d) => {
        const job = d.jobs.find((x) => x.id === j.id);
        if (material)
          job.materials[job.materials.findIndex((m) => m.id === id)] = entry;
        else job.materials.push(entry);
      });
    },
    {
      footer: material ? deleteFooter() : "",
      setup: (form) => {
        if (material)
          form.querySelector("[data-delete]").onclick = () =>
            confirmDelete(
              "Delete this material entry? This cannot be undone.",
              (d) => {
                const job = d.jobs.find((x) => x.id === j.id);
                job.materials = job.materials.filter((m) => m.id !== id);
              },
            );
      },
    },
  );
}
function settingsEditor() {
  const j = getJob();
  modal(
    "Markup & GST",
    `<fieldset><legend>Apply markup to this job?</legend><label class="radio-row"><input type="radio" name="apply" value="no" ${!j.markup.enabled ? "checked" : ""}>No</label><label class="radio-row"><input type="radio" name="apply" value="yes" ${j.markup.enabled ? "checked" : ""}>Yes</label></fieldset><div id="markup-fields"><label class="field">Markup percentage<div class="input-affix"><input aria-label="Markup percentage" name="percent" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${rateValue(j.markup.basisPoints)}" required><span>%</span></div></label><fieldset><legend>Apply markup to</legend><label class="radio-row"><input type="radio" name="scope" value="entire" ${j.markup.scope === "entire" ? "checked" : ""}>Markup entire bill</label><label class="radio-row"><input type="radio" name="scope" value="materials" ${j.markup.scope === "materials" ? "checked" : ""}>Markup materials only</label></fieldset></div><label class="field">GST rate<div class="input-affix"><input aria-label="GST rate" name="gst" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${rateValue(j.gstBasisPoints)}" required><span>%</span></div></label><p class="helper">Markup is applied before GST. Changing GST also recalculates GST-inclusive materials.</p>`,
    (f) => {
      const enabled = f.get("apply") === "yes";
      const basisPoints = enabled
        ? parsePercent(f.get("percent"))
        : j.markup.basisPoints;
      const gstBasisPoints = parsePercent(f.get("gst"));
      if (basisPoints > 100000 || gstBasisPoints > 10000)
        throw new Error("GST must be 0–100% and markup 0–1000%.");
      commit((d) => {
        const job = d.jobs.find((x) => x.id === j.id);
        job.markup = {
          enabled,
          basisPoints,
          scope: f.get("scope") ?? j.markup.scope,
        };
        job.gstBasisPoints = gstBasisPoints;
      });
    },
    {
      setup: (form) => {
        const update = () => {
          const enabled =
            form.querySelector('[name="apply"]:checked').value === "yes";
          form.querySelector("#markup-fields").hidden = !enabled;
          form
            .querySelectorAll("#markup-fields input")
            .forEach((el) => (el.disabled = !enabled));
        };
        form.addEventListener("change", update);
        update();
      },
    },
  );
}
function backup() {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `trade-timer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("Backup downloaded");
}
app.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (event.target.closest(".brand")) {
    event.preventDefault();
    page = "jobs";
    selectedJob = null;
    render();
    return;
  }
  if (!control) return;
  const { action, id } = control.dataset;
  if (handleCloudAction(action)) return;
  if (action.startsWith("pwa-")) {
    handlePwaAction(action).catch((error) => notify(error.message));
    return;
  }
  try {
    if (action === "jobs" || action === "workers") {
      page = action;
      selectedJob = null;
      render();
    } else if (action.startsWith("filter-")) {
      filter = action.slice(7);
      render();
    } else if (action === "open") {
      selectedJob = id;
      page = "jobs";
      render();
      window.scrollTo({ top: 0 });
    } else if (action === "new-job") jobEditor();
    else if (action === "edit-job") jobEditor(true);
    else if (action === "new-worker") workerEditor();
    else if (action === "edit-worker") workerEditor(id);
    else if (action === "new-session") sessionEditor();
    else if (action === "manual-session") sessionEditor(undefined, true);
    else if (action === "edit-session") sessionEditor(id);
    else if (action === "new-material") materialEditor();
    else if (action === "edit-material") materialEditor(id);
    else if (action === "settings") settingsEditor();
    else if (action === "backup") backup();
    else if (action === "reopen") {
      const job = getJob();
      commit((d) => (d.jobs.find((j) => j.id === job.id).status = "active"));
    } else if (action === "stop" || action === "start") {
      const job = getJob();
      if (action === "start" && activeSession(job))
        throw new Error("Stop the existing timer before starting another.");
      commit((d) => {
        const j = d.jobs.find((j) => j.id === job.id);
        const index = j.sessions.findIndex((s) => s.id === id);
        j.sessions[index] =
          action === "stop"
            ? stopSession(j.sessions[index])
            : startSession(j.sessions[index]);
      });
      notify(action === "stop" ? "Timer stopped and saved" : "Timer started");
    }
  } catch (error) {
    notify(`Could not save: ${error.message}`);
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === cloudStorageKey()) {
    try {
      refreshCloudCache();
    } catch (error) {
      notify(`Could not read saved account data: ${error.message}`);
    }
    return;
  }
  if (cloudStorageKey() || event.key !== STORAGE_KEY) return;
  try {
    data = storage.load();
    if (dialog.open) dialog.close();
    render();
    notify("Updated from another tab");
  } catch (error) {
    notify(`Could not read saved data: ${error.message}`);
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});
window.addEventListener("pageshow", () => tick());
try {
  storage = new LocalStorageAdapter(localStorage);
  data = storage.load();
  render();
} catch (error) {
  app.innerHTML = `<main class="recovery"><h1>Unable to load saved data</h1><p>${e(error.message)}</p><p>Your saved data has not been overwritten. Check that browser storage is available, or export the existing data before troubleshooting.</p><button id="raw-backup" class="primary">Download existing data</button></main>`;
  document.querySelector("#raw-backup").onclick = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const blob = new Blob([raw ?? ""], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "trade-timer-recovery.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
setInterval(() => {
  try {
    tick();
  } catch (error) {
    notify(error.message);
  }
}, 1000);

if (data) {
  initializePwa({
    onChange: () => render(),
    isBusy: () =>
      dialog.open ||
      document.querySelector("#cloud-dialog")?.open ||
      data.jobs.some(activeSession),
    notify,
  });
  initializeCloud({
    isBusy: () => dialog.open,
    notify,
    onStore: (adapter, preserveView = false) => {
      const next = adapter.load();
      if (dialog.open) {
        dialog.close();
        notify(
          "Account or browser data changed. Your open form was closed without saving.",
        );
      }
      storage = adapter;
      data = next;
      if (!preserveView) {
        selectedJob = null;
        page = "jobs";
      }
      render();
    },
    onData: (next) => {
      data = next;
      render();
    },
    onStatus: () => {},
  }).catch((error) => notify(error.message));
  dialog.addEventListener("close", () => refreshCloud());
}
