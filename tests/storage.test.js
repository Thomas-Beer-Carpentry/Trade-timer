import test from "node:test";
import assert from "node:assert/strict";
import { LocalStorageAdapter, emptyData, STORAGE_KEY } from "../src/storage.js";
const memory = () => {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
};
test("fresh adapter restores jobs and active timer timestamps", () => {
  const store = memory();
  const adapter = new LocalStorageAdapter(store);
  const data = adapter.load();
  data.jobs.push({
    id: "job",
    name: "Deck",
    client: "Client",
    description: "",
    createdAt: 1000,
    status: "active",
    gstBasisPoints: 1500,
    markup: { enabled: false, basisPoints: 1500, scope: "entire" },
    materials: [],
    sessions: [
      {
        id: "session",
        createdAt: 1000,
        start: 1000,
        finish: null,
        workers: [{ id: "w", name: "Eryk", rateCents: 7000 }],
      },
    ],
  });
  adapter.save(data);
  assert.deepEqual(new LocalStorageAdapter(store).load(), data);
});
test("corrupt data is reported, never silently replaced", () => {
  const store = memory();
  store.setItem(STORAGE_KEY, "broken");
  assert.throws(() => new LocalStorageAdapter(store).load());
  assert.equal(store.getItem(STORAGE_KEY), "broken");
});
test("conflicting writes cannot erase another tab changes", () => {
  const store = memory();
  const first = new LocalStorageAdapter(store),
    second = new LocalStorageAdapter(store);
  first.load();
  second.load();
  first.save({
    ...emptyData(),
    workers: [{ id: "1", name: "Eryk", rateCents: 7000 }],
  });
  assert.throws(() => second.save(emptyData()), /another tab/);
});
test("storage failures are surfaced", () => {
  const store = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  const adapter = new LocalStorageAdapter(store);
  adapter.load();
  assert.throws(() => adapter.save(emptyData()), /quota/);
});
