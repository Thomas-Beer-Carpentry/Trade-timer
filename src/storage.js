export const STORAGE_KEY = "trade-timer:v1";
export const emptyData = () => ({ version: 1, workers: [], jobs: [] });
const validCents = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 99999999999;
const validTime = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
export function validateData(data) {
  const id = (value) => typeof value === "string" && value.length > 0;
  const name = (value) => typeof value === "string" && value.trim().length > 0;
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.workers) ||
    !Array.isArray(data.jobs)
  )
    throw new Error("Saved data format is not supported.");
  const workerValid = (w) =>
    id(w.id) && name(w.name) && validCents(w.rateCents);
  if (!data.workers.every(workerValid))
    throw new Error("Saved worker data is invalid.");
  for (const j of data.jobs) {
    if (
      !id(j.id) ||
      !name(j.name) ||
      !name(j.client) ||
      typeof j.description !== "string" ||
      !validTime(j.createdAt) ||
      !["active", "completed"].includes(j.status) ||
      !validCents(j.gstBasisPoints) ||
      j.gstBasisPoints > 10000 ||
      !j.markup ||
      typeof j.markup.enabled !== "boolean" ||
      !validCents(j.markup.basisPoints) ||
      j.markup.basisPoints > 100000 ||
      !["entire", "materials"].includes(j.markup.scope) ||
      !Array.isArray(j.sessions) ||
      !Array.isArray(j.materials)
    )
      throw new Error("Saved job data is invalid.");
    if (
      !j.sessions.every(
        (s) =>
          id(s.id) &&
          validTime(s.createdAt) &&
          Array.isArray(s.workers) &&
          s.workers.length > 0 &&
          s.workers.every(workerValid) &&
          (s.start === null
            ? s.finish === null
            : validTime(s.start) &&
              (s.finish === null ||
                (validTime(s.finish) && s.finish >= s.start))),
      )
    )
      throw new Error("Saved session data is invalid.");
    if (
      !j.materials.every(
        (m) =>
          id(m.id) &&
          name(m.description) &&
          validCents(m.amountCents) &&
          typeof m.gstInclusive === "boolean" &&
          validTime(m.date),
      )
    )
      throw new Error("Saved materials data is invalid.");
  }
  return data;
}
// Replace this adapter with a cloud implementation without changing billing logic.
export class LocalStorageAdapter {
  constructor(storage) {
    this.storage = storage;
    this.lastRead = null;
  }
  load() {
    this.lastRead = this.storage.getItem(STORAGE_KEY);
    return this.lastRead === null
      ? emptyData()
      : validateData(JSON.parse(this.lastRead));
  }
  save(data) {
    validateData(data);
    if (this.storage.getItem(STORAGE_KEY) !== this.lastRead)
      throw new Error(
        "Data changed in another tab. Reload to use the latest version.",
      );
    const value = JSON.stringify(data);
    this.storage.setItem(STORAGE_KEY, value);
    this.lastRead = value;
  }
}
