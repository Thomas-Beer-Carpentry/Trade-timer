import { emptyData, validateData } from "./storage.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const equalData = (first, second) =>
  JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;

function validateEnvelope(value) {
  if (
    !value ||
    value.version !== 1 ||
    !validRevision(value.revision) ||
    !validRevision(value.generation) ||
    typeof value.dirty !== "boolean"
  )
    throw new Error(
      "Saved account cache is invalid. Your saved copy was preserved.",
    );
  validateData(value.data);
  return value;
}

function validateRow(value) {
  if (value === null) return null;
  if (!value || !validRevision(value.revision) || value.revision === 0)
    throw new Error(
      "Cloud revision is invalid. Your saved copy was preserved.",
    );
  validateData(value.data);
  return clone(value);
}

/**
 * Account-scoped durable cache with optimistic cloud revisions.
 * Saving never waits for the network. A newer remote revision requires an
 * explicit choice, and the discarded version is backed up before replacement.
 */
export class CloudStore {
  constructor({
    storage,
    userId,
    repository,
    onData = () => {},
    onStatus = () => {},
    canApply = () => true,
  }) {
    if (typeof userId !== "string" || !userId)
      throw new Error("Sign in before opening account storage.");
    this.storage = storage;
    this.repository = repository;
    this.onData = onData;
    this.onStatus = onStatus;
    this.canApply = canApply;
    this.key = `trade-timer:cloud:v1:${encodeURIComponent(userId)}`;
    this.backupKey = `${this.key}:backups`;
    this.status = { state: "pending", message: "Checking cloud data…" };
    this._envelope = null;
    this._lastRead = null;
    this._flight = null;
    this._again = false;
    this._stopped = false;
    this._conflict = null;
    this._resolving = false;
  }

  get metadata() {
    this._ensureLoaded();
    return {
      revision: this._envelope.revision,
      dirty: this._envelope.dirty,
      hasCache: this._lastRead !== null,
    };
  }

  get envelope() {
    this._ensureLoaded();
    return clone(this._envelope);
  }

  get conflict() {
    return clone(this._conflict);
  }

  load() {
    if (!this._envelope) {
      const saved = this.storage.getItem(this.key);
      this._envelope =
        saved === null
          ? {
              version: 1,
              data: emptyData(),
              revision: 0,
              dirty: false,
              generation: 0,
            }
          : validateEnvelope(JSON.parse(saved));
      this._lastRead = saved;
      if (this._envelope.dirty)
        this._status(
          "pending",
          "Changes saved on this device; waiting to sync.",
        );
    }
    return clone(this._envelope.data);
  }

  save(data) {
    this._ensureLoaded();
    if (this._stopped)
      throw new Error(
        "Account changed. Reopen the current account before saving.",
      );
    validateData(data);
    this._persist({
      ...this._envelope,
      data: clone(data),
      dirty: true,
      generation: this._envelope.generation + 1,
    });
    this._again = true;
    if (this._conflict) this._showConflict();
    else
      this._status("pending", "Changes saved on this device; waiting to sync.");
    // Let the UI finish its synchronous durable save before starting requests.
    void Promise.resolve().then(() => this.synchronize());
  }

  synchronize() {
    this._ensureLoaded();
    if (this._stopped || this._resolving) return Promise.resolve();
    if (this._flight) {
      this._again = true;
      return this._flight;
    }
    this._flight = this._run().finally(() => {
      this._flight = null;
    });
    return this._flight;
  }

  async _run() {
    try {
      do {
        this._again = false;
        await this._syncOnce();
      } while (
        this._again &&
        !this._stopped &&
        !this._conflict &&
        this.status.state !== "offline"
      );
    } catch (error) {
      if (!this._stopped)
        this._status(
          "offline",
          `${error.message || "Cloud connection unavailable."} Changes remain on this device.`,
        );
    }
  }

  async _syncOnce() {
    if (this._stopped) return;
    if (this._conflict) {
      this._showConflict();
      return;
    }
    this._status("syncing", "Syncing with your account…");
    const remote = validateRow(await this.repository.fetch());
    if (this._stopped) return;
    const local = this._envelope;
    const remoteRevision = remote?.revision ?? 0;

    if (local.dirty) {
      // A completed upload may have lost its acknowledgement during shutdown.
      // Matching contents can safely acknowledge the new cloud revision.
      if (
        remote &&
        remoteRevision >= local.revision &&
        equalData(remote.data, local.data)
      ) {
        this._persist({ ...local, revision: remoteRevision, dirty: false });
        this._status("synced", "All changes synced.");
        return;
      }
      if (remoteRevision !== local.revision) {
        this._setConflict(remote);
        return;
      }
      const generation = local.generation;
      const sent = clone(local.data);
      const saved = validateRow(
        await this.repository.write(sent, local.revision),
      );
      if (this._stopped) return;
      if (saved === null) {
        const latest = validateRow(await this.repository.fetch());
        if (!this._stopped) this._setConflict(latest);
        return;
      }
      this._acknowledge(saved, generation, sent);
      return;
    }

    if (remoteRevision < local.revision) {
      this._setConflict(remote);
      return;
    }
    if (remoteRevision > local.revision) {
      if (!this.canApply()) {
        this._status(
          "pending",
          "Cloud changes are waiting until you finish editing.",
        );
        return;
      }
      this._persist({
        ...local,
        data: remote.data,
        revision: remoteRevision,
        dirty: false,
      });
      this.onData(clone(remote.data));
    }
    this._status("synced", "All changes synced.");
  }

  _acknowledge(saved, generation, sent) {
    if (
      !equalData(saved.data, sent) ||
      saved.revision <= this._envelope.revision
    )
      throw new Error("The cloud returned an unexpected acknowledgement.");
    const dirty = this._envelope.generation !== generation;
    this._persist({ ...this._envelope, revision: saved.revision, dirty });
    if (dirty) {
      this._again = true;
      this._status("pending", "Newer changes saved; continuing sync…");
    } else this._status("synced", "All changes synced.");
  }

  async resolveConflict(choice) {
    if (!["cloud", "device"].includes(choice))
      throw new Error("Choose cloud or device data.");
    this._ensureLoaded();
    if (this._stopped || this._resolving) return false;
    this._resolving = true;
    try {
      // Serialize with any request already running; never resolve against a
      // cloud snapshot captured before that request finished.
      if (this._flight) await this._flight;
      if (this._stopped) return false;
      const generation = this._envelope.generation;
      const remote = validateRow(await this.repository.fetch());
      if (this._stopped) return false;
      if (this._envelope.generation !== generation) {
        this._setConflict(remote);
        return false;
      }
      if (choice === "cloud") {
        if (!this.canApply()) {
          this._setConflict(remote);
          return false;
        }
        this._archive("device", this._envelope.data, this._envelope.revision);
        const data = remote?.data ?? emptyData();
        this._persist({
          ...this._envelope,
          data: clone(data),
          revision: remote?.revision ?? 0,
          dirty: false,
        });
        this._conflict = null;
        this.onData(clone(data));
        this._status(
          "synced",
          "Cloud version restored. Your device version is backed up.",
        );
        return true;
      }
      // Preserve the cloud version before requesting an explicit replacement.
      if (remote) this._archive("cloud", remote.data, remote.revision);
      const revision = remote?.revision ?? 0;
      const sent = clone(this._envelope.data);
      this._persist({ ...this._envelope, revision, dirty: true });
      this._status("syncing", "Saving your chosen device version…");
      const saved = validateRow(await this.repository.write(sent, revision));
      if (this._stopped) return false;
      if (saved === null) {
        const latest = validateRow(await this.repository.fetch());
        if (!this._stopped) this._setConflict(latest);
        return false;
      }
      this._conflict = null;
      this._acknowledge(saved, generation, sent);
      return true;
    } catch (error) {
      if (!this._stopped)
        this._status(
          "offline",
          `${error.message || "Cloud connection unavailable."} Both saved versions were preserved.`,
        );
      return false;
    } finally {
      this._resolving = false;
      if (!this._stopped && !this._conflict && this._envelope.dirty)
        void Promise.resolve().then(() => this.synchronize());
    }
  }

  backups() {
    const saved = this.storage.getItem(this.backupKey);
    if (saved === null) return [];
    const backups = JSON.parse(saved);
    if (!Array.isArray(backups))
      throw new Error("Saved conflict backups are invalid.");
    for (const backup of backups) {
      if (
        !backup ||
        !["device", "cloud"].includes(backup.source) ||
        !validRevision(backup.revision) ||
        !Number.isSafeInteger(backup.savedAt)
      )
        throw new Error("Saved conflict backups are invalid.");
      validateData(backup.data);
    }
    return clone(backups);
  }

  _archive(source, data, revision) {
    const previous = this.backups();
    previous.push({ savedAt: Date.now(), source, revision, data: clone(data) });
    // A quota failure aborts replacement; a backup must exist before data is lost.
    this.storage.setItem(this.backupKey, JSON.stringify(previous));
  }

  _persist(envelope) {
    validateEnvelope(envelope);
    if (this.storage.getItem(this.key) !== this._lastRead)
      throw new Error(
        "Data changed in another tab. Reload to use the latest version.",
      );
    const value = JSON.stringify(envelope);
    this.storage.setItem(this.key, value);
    this._lastRead = value;
    this._envelope = envelope;
  }

  _ensureLoaded() {
    if (!this._envelope) this.load();
  }

  _setConflict(remote) {
    this._conflict = {
      data: remote?.data ?? emptyData(),
      revision: remote?.revision ?? 0,
    };
    this._showConflict();
  }

  _showConflict() {
    this._status(
      "conflict",
      "Cloud and device changes differ. Choose which version to keep; the other will be backed up.",
    );
  }

  _status(state, message) {
    if (this._stopped) return;
    this.status = { state, message };
    this.onStatus({ ...this.status });
  }

  // Account switches must stop applying late responses without deleting caches.
  pause() {
    this.stop();
  }
  stop() {
    this._stopped = true;
  }
}
