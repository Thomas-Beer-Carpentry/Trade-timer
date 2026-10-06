export function elapsedMs(session, now = Date.now()) {
  return session.start === null
    ? 0
    : Math.max(0, (session.finish ?? now) - session.start);
}
export function startSession(session, now = Date.now()) {
  return { ...session, start: now, finish: null };
}
export function stopSession(session, now = Date.now()) {
  if (session.start === null) throw new Error("Start this session first.");
  if (now < session.start)
    throw new Error("Finish must be after the start. Check your device clock.");
  return { ...session, finish: now };
}
export function clock(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export function hours(milliseconds) {
  return (milliseconds / 3_600_000).toFixed(2);
}
export function localDateTime(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function parseTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp))
    throw new Error("Enter a valid date and time.");
  return timestamp;
}
