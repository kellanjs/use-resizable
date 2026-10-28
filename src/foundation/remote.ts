/**
 * Remotes: a typed connection to a mounted resizable, for components that
 * don't render it (a toolbar toggling a sidebar). Made at module level,
 * given to the hook as its `remote` option, and read anywhere:
 * `remote.current?.toggle("closed")`, or `useResizableRemote` in React.
 *
 * A remote holds the connection and its listeners, nothing else: the
 * state, options and persistence stay with the hook that renders the
 * resizable, and while none is attached, `current` is `null`.
 */
import { warnOnce } from "./warn.js";

export type RemoteKind = "resizable" | "layout";

/**
 * Type-only markers. `remoteContract` is a function-typed property, so a
 * remote is invariant in its contract: one for other stops or ids can't be
 * given to a hook, either way round.
 */
declare const remoteKind: unique symbol;
declare const remoteContract: unique symbol;

/**
 * A remote for a kind of resizable whose contract (stops, ids, view) is
 * `C`, reaching it through `Endpoint`.
 */
export interface Remote<K extends RemoteKind, C, Endpoint> {
  readonly [remoteKind]?: K;
  readonly [remoteContract]?: (contract: C) => C;
  /**
   * The attached resizable's actions and view, or `null` while none is
   * attached (before it mounts, after it unmounts, on the server). Read it
   * when acting: a saved endpoint doesn't follow a newer attachment.
   */
  readonly current: Endpoint | null;
  /**
   * Calls `listener` when a resizable attaches or detaches, and on every
   * change to the attached one. Returns unsubscribe.
   */
  subscribe(listener: () => void): () => void;
}

/** What `useResizableRemote` reads: any remote, by its view. */
export interface ReadableRemote<V> {
  readonly current: { getView(): V } | null;
  subscribe(listener: () => void): () => void;
}

interface Internals {
  kind: RemoteKind;
  attach(endpoint: object, subscribeTo: Subscribe): () => void;
}

type Subscribe = (listener: () => void) => () => void;

/** Each remote's attaching, kept off the object so it isn't public. */
const internals = new WeakMap<object, Internals>();

export function createRemote(
  kind: RemoteKind,
): Remote<RemoteKind, unknown, object> {
  let attached: {
    token: object;
    endpoint: object;
    unsubscribe: () => void;
  } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const remote: Remote<RemoteKind, unknown, object> = {
    get current() {
      return attached?.endpoint ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  internals.set(remote, {
    kind,
    attach(endpoint, subscribeTo) {
      if (attached) {
        // The newer one replaces it, for good: it doesn't come back when
        // the newer one detaches.
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[use-resizable] A remote was given to a second mounted ${kind} while the first was still attached. The newer one replaces it, and the first won't be reattached when the newer one unmounts. Give each mounted ${kind} its own remote.`,
          );
        }
        attached.unsubscribe();
      }
      // A token per attachment: a cleanup clears the remote only if it's
      // still the one attached (Strict Mode attaches the same instance
      // twice).
      const token = {};
      attached = { token, endpoint, unsubscribe: subscribeTo(notify) };
      notify();
      return () => {
        if (attached?.token !== token) return;
        attached.unsubscribe();
        attached = null;
        notify();
      };
    },
  });
  return remote;
}

/**
 * A hook's side of a remote: which remote it's given (which can change
 * between renders), and whether it's mounted. It attaches once both are
 * true, after the controller has mounted (so persisted state is loaded),
 * and detaches before the controller unmounts. A new remote only moves the
 * connection: the controller stays mounted.
 */
export function createRemoteBinding(
  kind: RemoteKind,
  endpoint: object,
  subscribeTo: Subscribe,
) {
  let remote: object | undefined;
  let connected = false;
  let detach: (() => void) | null = null;

  const attach = () => {
    detach = null;
    if (!remote) return;
    const found = internals.get(remote);
    if (!found) {
      warnOnce(
        `The remote option isn't a remote: make one with ${kind === "layout" ? "createLayoutRemote" : "createResizableRemote"}().`,
      );
      return;
    }
    if (found.kind !== kind) {
      warnOnce(
        `A ${found.kind} remote was given to ${kind === "layout" ? "useResizableLayout" : "useResizable"}, so it isn't attached. Use ${kind === "layout" ? "createLayoutRemote" : "createResizableRemote"}().`,
      );
      return;
    }
    detach = found.attach(endpoint, subscribeTo);
  };

  return {
    /** The remote option as rendered; moves the connection if mounted. */
    setRemote(next: object | undefined) {
      if (next === remote) return;
      detach?.();
      remote = next;
      if (connected) attach();
      else detach = null;
    },
    /** After the controller has mounted. */
    connect() {
      connected = true;
      attach();
    },
    /** Before the controller unmounts. */
    disconnect() {
      connected = false;
      detach?.();
      detach = null;
    },
  };
}
