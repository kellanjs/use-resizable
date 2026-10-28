/**
 * Ref callbacks as the running React wants them. The library's return a
 * cleanup, which React 19 runs when the element detaches; React 18 calls
 * the ref with `null` instead (which runs it too: see `refCallback`), and
 * in development warns about any callback ref that returns a function.
 */
import { version } from "react";

/** Whether React runs the cleanup a callback ref returns (React 19 on). */
const runsCleanups = Number.parseInt(version, 10) >= 19;

const quiet = new WeakMap<(element: never) => unknown, unknown>();

/**
 * `ref` itself on React 19; on React 18, the same ref returning nothing,
 * the same function for the same ref (so it stays stable).
 */
export function forReact<T, R>(
  ref: (element: T) => R,
): (element: T) => R | undefined {
  if (runsCleanups) return ref;
  let wrapped = quiet.get(ref) as ((element: T) => undefined) | undefined;
  if (!wrapped) {
    wrapped = (element: T) => {
      ref(element);
      return undefined;
    };
    quiet.set(ref, wrapped);
  }
  return wrapped;
}
