import test from "node:test";
import assert from "node:assert/strict";
import { CloudStore } from "../src/cloud-store.js";
import { SupabaseRepository } from "../src/supabase-repository.js";
import { emptyData } from "../src/storage.js";

const copy = (value) => structuredClone(value);
function memory() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}
function repository(initial = null) {
  return {
    row: copy(initial),
    async fetch() {
      return copy(this.row);
    },
    async write(data, expectedRevision) {
      if ((this.row?.revision ?? 0) !== expectedRevision) return null;
      this.row = { data: copy(data), revision: expectedRevision + 1 };
      return copy(this.row);
    },
  };
}
const workers = (...names) => ({
  ...emptyData(),
  workers: names.map((name) => ({ id: name, name, rateCents: 7000 })),
});
function make(storage, repo, options = {}) {
  return new CloudStore({
    storage,
    repository: repo,
    userId: "account-a",
    ...options,
  });
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("pending offline edits survive reload and sync when connection returns", async () => {
  const storage = memory();
  const repo = repository();
  repo.fetch = async () => {
    throw new Error("Network unavailable");
  };
  const store = make(storage, repo);
  assert.deepEqual(store.load(), emptyData());
  store.save(workers("Eryk"));
  await store.synchronize();
  assert.equal(store.status.state, "offline");
  assert.equal(store.metadata.dirty, true);
  store.stop();
  repo.fetch = async () => copy(repo.row);
  const reopened = make(storage, repo);
  assert.deepEqual(reopened.load(), workers("Eryk"));
  await reopened.synchronize();
  assert.deepEqual(repo.row.data, workers("Eryk"));
  assert.equal(reopened.metadata.dirty, false);
  assert.equal(reopened.status.state, "synced");
});

test("accounts have isolated caches and never import original device data automatically", async () => {
  const storage = memory();
  storage.setItem("trade-timer:v1", JSON.stringify(workers("Device worker")));
  const first = make(storage, repository());
  assert.deepEqual(first.load(), emptyData());
  first.save(workers("Personal"));
  await first.synchronize();
  first.stop();
  const second = make(storage, repository(), { userId: "account-b" });
  assert.deepEqual(second.load(), emptyData());
  assert.notEqual(first.key, second.key);
  assert.deepEqual(make(storage, repository()).load(), workers("Personal"));
});

test("edits made during an upload are durably retained and uploaded at the next revision", async () => {
  const storage = memory();
  const repo = repository();
  const uploaded = deferred();
  const release = deferred();
  const originalWrite = repo.write;
  let calls = 0;
  repo.write = async function (data, revision) {
    calls++;
    if (calls === 1) {
      uploaded.resolve();
      await release.promise;
    }
    return originalWrite.call(this, data, revision);
  };
  const store = make(storage, repo);
  store.load();
  store.save(workers("First"));
  const syncing = store.synchronize();
  await uploaded.promise;
  store.save(workers("First", "Second"));
  release.resolve();
  await syncing;
  assert.deepEqual(repo.row.data, workers("First", "Second"));
  assert.equal(repo.row.revision, 2);
  assert.equal(store.metadata.dirty, false);
  assert.deepEqual(make(storage, repo).load(), workers("First", "Second"));
});

test("a stale offline edit conflicts rather than overwriting newer cloud data", async () => {
  const storage = memory();
  const repo = repository({ data: workers("Original"), revision: 1 });
  const store = make(storage, repo);
  store.load();
  await store.synchronize();
  repo.row = { data: workers("Other device"), revision: 2 };
  store.save(workers("Local edit"));
  await store.synchronize();
  assert.equal(store.status.state, "conflict");
  assert.deepEqual(repo.row.data, workers("Other device"));
  assert.deepEqual(make(storage, repo).load(), workers("Local edit"));
});

test("remote refresh waits for an open editor, then applies without dropping changes", async () => {
  let editorOpen = true;
  const received = [];
  const repo = repository({ data: workers("Cloud"), revision: 1 });
  const store = make(memory(), repo, {
    canApply: () => !editorOpen,
    onData: (data) => received.push(data),
  });
  assert.deepEqual(store.load(), emptyData());
  await store.synchronize();
  assert.equal(received.length, 0);
  assert.equal(store.metadata.revision, 0);
  editorOpen = false;
  await store.synchronize();
  assert.deepEqual(received, [workers("Cloud")]);
  assert.equal(store.metadata.revision, 1);
});

test("choosing cloud archives local edits before applying the latest cloud revision", async () => {
  const repo = repository({ data: workers("Cloud"), revision: 1 });
  const store = make(memory(), repo);
  store.load();
  store.save(workers("Device"));
  await store.synchronize();
  assert.equal(store.status.state, "conflict");
  assert.equal(await store.resolveConflict("cloud"), true);
  assert.deepEqual(store.load(), workers("Cloud"));
  assert.equal(store.backups().length, 1);
  assert.deepEqual(store.backups()[0].data, workers("Device"));
  assert.equal(store.backups()[0].source, "device");
});

test("choosing device archives the replaced cloud version and still uses compare-and-swap", async () => {
  const repo = repository({ data: workers("Cloud"), revision: 1 });
  const store = make(memory(), repo);
  store.load();
  store.save(workers("Device"));
  await store.synchronize();
  assert.equal(await store.resolveConflict("device"), true);
  assert.deepEqual(repo.row.data, workers("Device"));
  assert.equal(repo.row.revision, 2);
  assert.deepEqual(store.backups()[0].data, workers("Cloud"));
  assert.equal(store.backups()[0].source, "cloud");
});

test("a cloud change during explicit replacement remains a conflict", async () => {
  const repo = repository({ data: workers("Cloud"), revision: 1 });
  const store = make(memory(), repo);
  store.load();
  store.save(workers("Device"));
  await store.synchronize();
  repo.write = async () => {
    repo.row = { data: workers("Newer cloud"), revision: 2 };
    return null;
  };
  assert.equal(await store.resolveConflict("device"), false);
  assert.equal(store.status.state, "conflict");
  assert.deepEqual(repo.row.data, workers("Newer cloud"));
  assert.deepEqual(store.load(), workers("Device"));
});

test("stopping an account prevents late fetch responses from applying", async () => {
  const received = [];
  const fetch = deferred();
  const repo = repository();
  repo.fetch = () => fetch.promise;
  const store = make(memory(), repo, { onData: (data) => received.push(data) });
  store.load();
  const syncing = store.synchronize();
  store.stop();
  fetch.resolve({ data: workers("Old account"), revision: 1 });
  await syncing;
  assert.deepEqual(received, []);
  assert.equal(store.metadata.revision, 0);
});

test("storage quota blocks saves without erasing the previously durable copy", async () => {
  const storage = memory();
  const store = make(storage, repository());
  store.load();
  store.save(workers("Saved"));
  await store.synchronize();
  const original = storage.getItem(store.key);
  storage.setItem = () => {
    throw new Error("Storage quota exceeded");
  };
  assert.throws(() => store.save(workers("Lost")), /quota/);
  assert.equal(storage.getItem(store.key), original);
  assert.deepEqual(store.load(), workers("Saved"));
});

test("corrupt account cache and invalid server payload are reported without replacement", async () => {
  const storage = memory();
  const store = make(storage, repository());
  storage.setItem(store.key, "broken");
  assert.throws(() => store.load());
  assert.equal(storage.getItem(store.key), "broken");
  const invalid = make(memory(), repository({ data: {}, revision: 1 }));
  invalid.load();
  await invalid.synchronize();
  assert.equal(invalid.status.state, "offline");
  assert.deepEqual(invalid.load(), emptyData());
});

test("simultaneous writes from another tab cannot erase its durable cache", async () => {
  const storage = memory();
  const repo = repository();
  const first = make(storage, repo);
  const second = make(storage, repo);
  first.load();
  second.load();
  first.save(workers("First tab"));
  assert.throws(() => second.save(workers("Second tab")), /another tab/);
  await first.synchronize();
  assert.deepEqual(make(storage, repo).load(), workers("First tab"));
});

test("a conflict is rediscovered after reload without discarding pending edits", async () => {
  const storage = memory();
  const repo = repository({ data: workers("Cloud"), revision: 1 });
  const store = make(storage, repo);
  store.load();
  store.save(workers("Device"));
  await store.synchronize();
  store.stop();
  const reopened = make(storage, repo);
  assert.deepEqual(reopened.load(), workers("Device"));
  await reopened.synchronize();
  assert.equal(reopened.status.state, "conflict");
  assert.deepEqual(repo.row.data, workers("Cloud"));
});

test("backup quota failures prevent explicit replacement of either saved version", async () => {
  const storage = memory();
  const repo = repository({ data: workers("Cloud"), revision: 1 });
  const store = make(storage, repo);
  store.load();
  store.save(workers("Device"));
  await store.synchronize();
  const original = storage.getItem(store.key);
  const setItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === store.backupKey) throw new Error("Storage quota exceeded");
    return setItem(key, value);
  };
  assert.equal(await store.resolveConflict("cloud"), false);
  assert.equal(await store.resolveConflict("device"), false);
  assert.equal(storage.getItem(store.key), original);
  assert.deepEqual(store.load(), workers("Device"));
  assert.deepEqual(repo.row.data, workers("Cloud"));
});

test("editing during explicit device resolution uploads the newer edit afterward", async () => {
  const repo = repository({ data: workers("Cloud"), revision: 1 });
  const store = make(memory(), repo);
  store.load();
  store.save(workers("Device"));
  await store.synchronize();
  const uploading = deferred();
  const release = deferred();
  const originalWrite = repo.write;
  repo.write = async function (data, revision) {
    uploading.resolve();
    await release.promise;
    return originalWrite.call(this, data, revision);
  };
  const replacing = store.resolveConflict("device");
  await uploading.promise;
  store.save(workers("Device", "New edit"));
  release.resolve();
  assert.equal(await replacing, true);
  await store.synchronize();
  assert.deepEqual(repo.row.data, workers("Device", "New edit"));
  assert.equal(repo.row.revision, 3);
  assert.equal(store.metadata.dirty, false);
});

test("stopping during upload leaves the cache recoverable without late account callbacks", async () => {
  const storage = memory();
  const repo = repository();
  const uploading = deferred();
  const release = deferred();
  const originalWrite = repo.write;
  repo.write = async function (data, revision) {
    uploading.resolve();
    await release.promise;
    return originalWrite.call(this, data, revision);
  };
  const statuses = [];
  const store = make(storage, repo, {
    onStatus: (status) => statuses.push(status),
  });
  store.load();
  store.save(workers("Before sign out"));
  const syncing = store.synchronize();
  await uploading.promise;
  store.stop();
  const before = statuses.length;
  release.resolve();
  await syncing;
  assert.equal(statuses.length, before);
  assert.equal(store.metadata.dirty, true);
  const reopened = make(storage, repo);
  assert.deepEqual(reopened.load(), workers("Before sign out"));
  await reopened.synchronize();
  assert.equal(reopened.metadata.dirty, false);
  assert.equal(repo.row.revision, 1);
});

test("JSON object key ordering cannot create a false conflict", async () => {
  const repo = repository();
  const store = make(memory(), repo);
  store.load();
  const data = workers("Eryk");
  store.save(data);
  repo.row = {
    data: {
      jobs: [],
      workers: [{ rateCents: 7000, name: "Eryk", id: "Eryk" }],
      version: 1,
    },
    revision: 1,
  };
  await store.synchronize();
  assert.equal(store.status.state, "synced");
  assert.equal(store.metadata.revision, 1);
  assert.equal(repo.row.revision, 1);
});

test("Supabase storage boundary relies on account RLS and uses the CAS RPC", async () => {
  let selection;
  let write;
  const request = (data) => ({
    setHeader(name, value) {
      assert.equal(name, "Authorization");
      assert.equal(value, "Bearer test-account-token");
      return this;
    },
    retry(enabled) {
      assert.equal(enabled, false);
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  });
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: "account-a" },
            access_token: "test-account-token",
          },
        },
        error: null,
      }),
    },
    from(table) {
      assert.equal(table, "trade_timer_data");
      return {
        select(columns) {
          selection = columns;
          return {
            maybeSingle: () =>
              request({ payload: workers("Read"), revision: 2 }),
          };
        },
      };
    },
    rpc(name, args) {
      write = { name, args };
      return request([{ payload: args.payload, revision: 3 }]);
    },
  };
  const repo = new SupabaseRepository(client);
  assert.deepEqual(await repo.fetch(), { data: workers("Read"), revision: 2 });
  assert.equal(selection, "payload,revision");
  assert.deepEqual(await repo.write(workers("Write"), 2), {
    data: workers("Write"),
    revision: 3,
  });
  assert.deepEqual(write, {
    name: "save_trade_timer",
    args: { expected_revision: 2, payload: workers("Write") },
  });
});

test("account-bound repository refuses writes after a different account signs in", async () => {
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: "account-b" },
            access_token: "other-account-token",
          },
        },
        error: null,
      }),
    },
    rpc() {
      assert.fail("A mismatched account must never receive a database request");
    },
    from() {
      assert.fail("A mismatched account must never receive a database request");
    },
  };
  const repo = new SupabaseRepository(client, "account-a");
  await assert.rejects(repo.fetch(), /Account changed/);
  await assert.rejects(repo.write(workers("Account A"), 0), /Account changed/);
});

test("a queued database request pins its original session across a concurrent account switch", async () => {
  const session = {
    user: { id: "account-a" },
    access_token: "account-a-token",
  };
  let pinned;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: copy(session) },
        error: null,
      }),
    },
    rpc(name, args) {
      // Simulate the shared auth client changing between token capture and send.
      session.user.id = "account-b";
      session.access_token = "account-b-token";
      return {
        setHeader(header, value) {
          pinned = value;
          return this;
        },
        retry(enabled) {
          assert.equal(enabled, false);
          return this;
        },
        then(resolve, reject) {
          assert.equal(pinned, "Bearer account-a-token");
          return Promise.resolve({
            data: [{ payload: args.payload, revision: 1 }],
            error: null,
          }).then(resolve, reject);
        },
      };
    },
  };
  const repo = new SupabaseRepository(client, "account-a");
  assert.deepEqual(await repo.write(workers("Account A"), 0), {
    data: workers("Account A"),
    revision: 1,
  });
  await assert.rejects(repo.write(workers("Account A"), 1), /Account changed/);
});
