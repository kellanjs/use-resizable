/**
 * The media query resizables follow: reduced motion (they skip their
 * transitions, unless told otherwise).
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function matches(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

/** Calls `listener` when `query` starts or stops matching. Returns unsubscribe. */
function subscribe(
  query: string,
  listener: (matches: boolean) => void,
): () => void {
  if (typeof matchMedia !== "function") return () => {};

  const list = matchMedia(query);
  const onChange = () => listener(list.matches);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

export const prefersReducedMotion = () => matches(REDUCED_MOTION);

export const subscribeReducedMotion = (listener: (reduced: boolean) => void) =>
  subscribe(REDUCED_MOTION, listener);
