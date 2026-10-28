/**
 * The ref callbacks the controllers hand out: called with the element (or
 * `null`), returning a cleanup for when it detaches (see `refCallback`).
 */
export type RefCallback = (
  element: HTMLElement | null,
) => (() => void) | undefined;

/**
 * A ref callback from `attach`, which wires an element up and returns how
 * to undo that. React 19 runs the cleanup the callback returns when the
 * element detaches; React 18 ignores it and calls the callback with `null`
 * instead, which runs it too. Either way, each cleanup runs once.
 */
export function refCallback(
  attach: (element: HTMLElement) => () => void,
): RefCallback {
  const attached = new Set<() => void>();
  return (element) => {
    if (!element) {
      for (const cleanup of [...attached]) cleanup();
      return undefined;
    }
    const detach = attach(element);
    const cleanup = () => {
      if (!attached.delete(cleanup)) return;
      detach();
    };
    attached.add(cleanup);
    return cleanup;
  };
}
