import type { SnapshotStorage } from "../src/foundation/persist.js";

/** A `SnapshotStorage` over a Map, so tests can read and seed what's saved. */
export function memoryStorage(entries: Record<string, unknown> = {}) {
  const items = new Map(
    Object.entries(entries).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
  const listeners = new Map<string, Set<() => void>>();
  const storage: SnapshotStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    subscribe(key, onChange) {
      const forKey = listeners.get(key) ?? new Set();
      listeners.set(key, forKey);
      forKey.add(onChange);
      return () => void forKey.delete(onChange);
    },
  };
  /** Saves `value` under `key` as something else would (another tab). */
  const write = (key: string, value: unknown) => {
    items.set(key, JSON.stringify(value));
    listeners.get(key)?.forEach((onChange) => onChange());
  };
  /** The parsed value saved under `key`, if any. */
  const saved = (key: string): unknown => {
    const raw = items.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  };
  return { storage, items, saved, write };
}
