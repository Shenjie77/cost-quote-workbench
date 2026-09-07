/**
 * Serializes writes for one loaded project session. A queued edit uses the
 * revision returned by the preceding write, never the revision at click time.
 * This module has no React/network dependency so delayed writes can be tested.
 */
export function createSaveQueue<T>(options: {
  revision: number | null;
  savedDocument?: T;
  persist: (
    document: T,
    revision: number | null,
  ) => Promise<{
    revision: number;
    updatedAt: string;
  }>;
  onSaving: () => void;
  onSaved: (
    record: { revision: number; updatedAt: string },
    document: T,
  ) => void;
  onError: (error: unknown) => void;
  isConflict: (error: unknown) => boolean;
}) {
  let revision = options.revision;
  let savedJson = options.savedDocument
    ? JSON.stringify(options.savedDocument)
    : '';
  let conflicted = false;
  let paused = false;
  let disposed = false;
  let pending: Promise<boolean> = Promise.resolve(true);

  return {
    /** Stop new writes, then wait for all accepted writes before deletion. */
    async pause() {
      paused = true;
      const ok = await pending;
      return ok ? revision : null;
    },
    resume() {
      paused = false;
    },
    dispose() {
      disposed = true;
    },
    /** Returns whether a document already has a successful durable write. */
    isSaved(document: T) {
      return JSON.stringify(document) === savedJson;
    },
    /** Captures a detached document and appends a revision-checked write. */
    save(document: T): Promise<boolean> {
      if (paused || disposed) return Promise.resolve(false);
      const snapshot = structuredClone(document);
      pending = pending.then(async () => {
        if (conflicted || disposed) return false;
        const json = JSON.stringify(snapshot);
        if (json === savedJson) return true;
        options.onSaving();
        try {
          const record = await options.persist(snapshot, revision);
          revision = record.revision;
          savedJson = json;
          options.onSaved(record, snapshot);
          return true;
        } catch (error) {
          conflicted = options.isConflict(error);
          options.onError(error);
          return false;
        }
      });
      return pending;
    },
  };
}
