/**
 * The smallest observable value that works with React's
 * `useSyncExternalStore`: read it, replace it, and hear about changes.
 *
 * Each controller owns exactly one store, and it's the only place its state
 * lives. Event handlers call `get()` at the moment they run, so they never
 * see a stale value and never need a ref mirror.
 */

export interface Store<T> {
  get(): T;
  /** Replaces the value and notifies listeners, unless it's the same value. */
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
