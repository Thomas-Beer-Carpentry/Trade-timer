// Decimal input -> integer cents/basis points. BigInt intermediates avoid binary
// floating-point arithmetic. Round once at each displayed billing boundary.
import { roundRatio } from "./money.js";
import { materialExclCents } from "./materials.js";
import { markupCents } from "./markup.js";
export { parseMoney, parsePercent, money } from "./money.js";
export { materialExclCents } from "./materials.js";

export function labourCents(sessions, now = Date.now()) {
  let numerator = 0n;
  for (const session of sessions) {
    if (session.start === null) continue;
    const milliseconds = Math.max(0, (session.finish ?? now) - session.start);
    for (const worker of session.workers)
      numerator += BigInt(milliseconds) * BigInt(worker.rateCents);
  }
  return roundRatio(numerator, 3_600_000);
}
export function calculateJob(job, now = Date.now()) {
  const labour = labourCents(job.sessions, now);
  const materials = job.materials.reduce(
    (sum, material) => sum + materialExclCents(material, job.gstBasisPoints),
    0,
  );
  const base = labour + materials;
  const markup = markupCents(base, materials, job.markup);
  const subtotal = base + markup;
  const gst = roundRatio(BigInt(subtotal) * BigInt(job.gstBasisPoints), 10000);
  const total = subtotal + gst;
  if (!Number.isSafeInteger(total))
    throw new Error("This total is too large to calculate safely.");
  return { labour, materials, base, markup, subtotal, gst, total };
}
