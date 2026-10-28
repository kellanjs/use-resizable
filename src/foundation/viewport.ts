/**
 * The viewport's size, which `vw` and `vh` sizes resolve against.
 *
 * It's read from a hidden element sized `100vw` by `100vh`, so it's what
 * CSS means by them exactly: on phones, `vh` is the viewport with the
 * browser's toolbars hidden, which `innerHeight` isn't while they show.
 * The element is only made when something reads the viewport, which only
 * resizables with sizes in `vw` or `vh` do, and it's removed when the last
 * one stops watching. One shared watcher serves every subscriber.
 */
import type { Viewport } from "./size.js";

type Listener = (viewport: Viewport) => void;

const listeners = new Set<Listener>();
let current: Viewport | null = null;
let probe: HTMLElement | null = null;
let stopWatching: (() => void) | null = null;

/** Reads the viewport's size, or `null` on the server. */
export function readViewport(): Viewport | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (!probe?.isConnected) {
    probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.dataset.resizableViewport = "";
    probe.style.cssText =
      "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; " +
      "visibility: hidden; pointer-events: none; contain: strict;";
    document.body.appendChild(probe);
  }
  const { width, height } = probe.getBoundingClientRect();
  return { width, height };
}

/** Calls `listener` whenever the viewport's size changes. Returns unsubscribe. */
export function subscribeViewport(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stopWatching = startWatching();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
      probe?.remove();
      probe = null;
    }
  };
}

function startWatching(): () => void {
  if (typeof window === "undefined") return () => {};
  current = readViewport();

  const check = () => {
    const next = readViewport();
    if (
      !next ||
      (next.width === current?.width && next.height === current?.height)
    ) {
      return;
    }
    current = next;
    for (const listener of listeners) listener(next);
  };

  window.addEventListener("resize", check);
  return () => window.removeEventListener("resize", check);
}

/** The viewport for measuring, if `needed` (a size is in `vw` or `vh`). */
export function viewportFor(needed: boolean): Viewport | null {
  return needed ? readViewport() : null;
}
