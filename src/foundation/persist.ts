/**
 * Saving snapshots between sessions.
 *
 * Storage is read when the element mounts, never during render: the server
 * can't see the browser's storage, so reading it while rendering would make
 * the first client render disagree with the server's HTML. Reads and writes
 * are guarded, because storage can be missing (the server), blocked
 * (privacy settings, sandboxed frames) or full, and none of that should
 * break resizing.
 */
import { warnOnce } from "./warn.js";

/**
 * Where snapshots are kept: anything with the `getItem` / `setItem` half of
 * the Web Storage API, such as `localStorage`, `sessionStorage`, or an
 * adapter over cookies or memory.
 */
export interface SnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /**
   * For `sync`: calls `onChange` when something else (another tab, say)
   * changes `key`, until the returned function is called. Not needed for
   * `localStorage` or `sessionStorage`, whose changes the browser reports.
   */
  subscribe?(key: string, onChange: () => void): () => void;
}

export interface PersistOptions {
  /**
   * The storage key. Changing it while mounted switches to that key's saved
   * snapshot, or to the defaults if nothing is saved there, so one component
   * can show, say, a different layout per document.
   */
  key: string;
  /**
   * Defaults to `localStorage`. The key names what's saved: passing other
   * storage under the same key saves there from then on, without loading
   * from it (so an adapter written inline, made anew each render, is fine).
   * To load from it, change the key too.
   */
  storage?: SnapshotStorage;
  /**
   * Follow changes saved under the key from elsewhere, like another tab
   * with the same layout open: they're restored here as they happen (and
   * reported to `onChange`, but not saved again). Off by default, so each
   * tab keeps its own until the next load.
   */
  sync?: boolean;
}

function storageOf(persist: PersistOptions): SnapshotStorage | null {
  if (persist.storage) return persist.storage;
  try {
    // Merely reading `localStorage` throws where it's blocked.
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved snapshot, or `null` if there isn't a valid one. */
export function loadSnapshot<T>(
  persist: PersistOptions,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const raw = storageOf(persist)?.getItem(persist.key);
    if (raw == null) return null;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : null;
  } catch {
    // Unreadable storage or malformed JSON: start from the defaults.
    return null;
  }
}

/**
 * Calls `onChange` when something else changes the snapshot saved under
 * the key; returns the unsubscribe, or `null` if the storage can't say.
 */
export function subscribeSnapshot(
  persist: PersistOptions,
  onChange: () => void,
): (() => void) | null {
  const storage = storageOf(persist);
  if (!storage) return null;
  if (storage.subscribe) return storage.subscribe(persist.key, onChange);
  if (typeof Storage === "undefined" || !(storage instanceof Storage)) {
    warnOnce(
      `persist.sync is on for "${persist.key}", but its storage has no subscribe(key, onChange), so changes from elsewhere can't be followed. Add one to the storage adapter.`,
    );
    return null;
  }
  // The browser reports changes other tabs make to Web Storage.
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === storage && event.key === persist.key) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function saveSnapshot(persist: PersistOptions, snapshot: unknown) {
  try {
    storageOf(persist)?.setItem(persist.key, JSON.stringify(snapshot));
  } catch {
    // Storage is full or blocked; the layout still works, it just won't last.
  }
}
