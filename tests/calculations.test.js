import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateJob,
  materialExclCents,
  parseMoney,
  parsePercent,
} from "../src/calculations.js";
import { elapsedMs, startSession, stopSession } from "../src/timer.js";
const fiveHours = {
  start: 0,
  finish: 18_000_000,
  workers: [
    { name: "Eryk", rateCents: 7000 },
    { name: "John", rateCents: 7000 },
  ],
};
const job = (overrides = {}) => ({
  sessions: [fiveHours],
  materials: [{ amountCents: 50000, gstInclusive: false }],
  markup: { enabled: true, basisPoints: 1500, scope: "entire" },
  gstBasisPoints: 1500,
  ...overrides,
});
test("brief: $700 labour + $500 materials + 15% entire-bill markup + GST = $1,587", () => {
  assert.deepEqual(calculateJob(job()), {
    labour: 70000,
    materials: 50000,
    base: 120000,
    markup: 18000,
    subtotal: 138000,
    gst: 20700,
    total: 158700,
  });
});
test("inclusive materials are normalised before materials-only markup and GST", () => {
  const result = calculateJob(
    job({
      materials: [
        { amountCents: 50000, gstInclusive: false },
        { amountCents: 8625, gstInclusive: true },
        { amountCents: 24000, gstInclusive: false },
      ],
      markup: { enabled: true, basisPoints: 1500, scope: "materials" },
    }),
  );
  assert.equal(result.materials, 81500);
  assert.equal(result.markup, 12225);
  assert.equal(result.subtotal, 163725);
  assert.equal(result.gst, 24559);
  assert.equal(result.total, 188284);
  assert.equal(
    materialExclCents({ amountCents: 8625, gstInclusive: true }, 1500),
    7500,
  );
});
test("different rates, fractional hours and historical sessions", () => {
  const result = calculateJob(
    job({
      sessions: [
        {
          start: 0,
          finish: 28_680_000,
          workers: [{ rateCents: 7000 }, { rateCents: 7000 }],
        },
        { start: 0, finish: 18_900_000, workers: [{ rateCents: 7000 }] },
      ],
      materials: [],
      markup: { enabled: false },
    }),
  );
  assert.equal(result.labour, 148283);
  assert.equal(result.total, 170525);
});
test("running timers use timestamps and completed sessions ignore current time", () => {
  const session = startSession({ workers: [{ rateCents: 7000 }] }, 1000);
  assert.equal(elapsedMs(session, 3_601_000), 3_600_000);
  assert.equal(
    calculateJob(
      job({ sessions: [session], materials: [], markup: { enabled: false } }),
      3_601_000,
    ).labour,
    7000,
  );
  const stopped = stopSession(session, 1_801_000);
  assert.equal(elapsedMs(stopped, 99_000_000), 1_800_000);
  assert.equal(session.finish, null);
});
test("fixed-point parsing and half-cent rounding are deterministic", () => {
  assert.equal(parseMoney("86.25"), 8625);
  assert.equal(parseMoney("0.29"), 29);
  assert.equal(parsePercent("15.25"), 1525);
  assert.equal(
    calculateJob(
      job({
        sessions: [
          { start: 0, finish: 1_800_000, workers: [{ rateCents: 1 }] },
        ],
        materials: [],
        markup: { enabled: false },
      }),
    ).labour,
    1,
  );
  for (const value of ["-1", "NaN", "1.234", "Infinity", "1e3"])
    assert.throws(() => parseMoney(value));
});
test("zero rates, no markup, empty jobs and inverted times", () => {
  assert.equal(
    calculateJob(
      job({ sessions: [], materials: [], markup: { enabled: false } }),
    ).total,
    0,
  );
  assert.equal(elapsedMs({ start: 10, finish: 5 }, 20), 0);
  assert.equal(
    calculateJob(
      job({
        sessions: [{ start: 0, finish: 1000, workers: [{ rateCents: 0 }] }],
        materials: [],
        markup: { enabled: false },
      }),
    ).total,
    0,
  );
});
