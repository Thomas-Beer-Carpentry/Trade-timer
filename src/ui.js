export const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const dateLabel = (timestamp) =>
  new Intl.DateTimeFormat("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
export const timeLabel = (timestamp) =>
  new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
export const rateValue = (cents) => (cents / 100).toFixed(2);
const icons = {
  timer: '<circle cx="12" cy="13" r="8"/><path d="M9 2h6m-3 3v-3m0 6v5l3 2"/>',
  jobs: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V4h8v3M3 12h18m-10 0v3h2v-3"/>',
  workers:
    '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a5 5 0 0 0-2-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  material:
    '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9v10M3 8l9 4 9-4M7 5l10 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m15 4 5 5-11 11-6 1 1-6L15 4Zm-9 9 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.jobs}</svg>`;
export function button(action, label, klass = "secondary", extra = "") {
  return `<button class="${klass}" data-action="${action}" ${extra}>${label}</button>`;
}
export const textField = (name, label, value = "", extra = "") =>
  `<label class="field">${e(label)}<input name="${name}" value="${e(value)}" ${extra}></label>`;
export const rateField = (name, label, value = "") =>
  `<label class="field">${e(label)}<div class="input-affix"><span>$</span><input aria-label="${e(label)}" name="${name}" type="number" inputmode="decimal" min="0" max="999999999.99" step="0.01" value="${e(value)}" required><span>/ hr</span></div><small>NZD excluding GST</small></label>`;
