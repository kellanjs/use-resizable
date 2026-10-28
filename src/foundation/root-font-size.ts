/**
 * The root font size, which `rem` sizes resolve against.
 *
 * It can change at runtime: an attribute on `<html>` (a class, a style, a
 * `data-` setting for "large text" or a theme), a media query reacting to
 * the window size, a stylesheet loading late, the browser's own text size.
 * Every resizable that uses `rem` needs the current value, so one shared
 * watcher serves all subscribers and only runs while someone is listening.
 */
import { DEFAULT_ROOT_FONT_SIZE } from "./size.js";

type Listener = (rootFontSize: number) => void;

const listeners = new Set<Listener>();
let current = DEFAULT_ROOT_FONT_SIZE;
let stopWatching: (() => void) | null = null;

/** Reads the root font size from the DOM. Falls back to 16 on the server. */
export function readRootFontSize(): number {
  if (typeof document === "undefined") return DEFAULT_ROOT_FONT_SIZE;
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_ROOT_FONT_SIZE;
}

/**
 * The latest known root font size. While anyone is subscribed this is kept
 * up to date by the watcher; otherwise it's read on demand.
 */
export function getRootFontSize(): number {
  return stopWatching ? current : readRootFontSize();
}

/** Calls `listener` whenever the root font size changes. Returns unsubscribe. */
export function subscribeRootFontSize(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stopWatching = startWatching();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

function startWatching(): () => void {
  current = readRootFontSize();
  if (typeof window === "undefined") return () => {};

  const check = () => {
    const next = readRootFontSize();
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener(next);
  };

  // Whatever changes it, a hidden element `1rem` wide changes size with it.
  // Where there's no ResizeObserver, attributes on <html> (any of them:
  // rules can select on `data-` ones) and resizes (media queries) still
  // tell. Browsers coalesce each to at most once per frame, so no extra
  // throttling is needed.
  const probe = remProbe();
  const resizes =
    probe && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(check)
      : null;
  if (probe && resizes) resizes.observe(probe);
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { attributes: true });
  window.addEventListener("resize", check);

  return () => {
    resizes?.disconnect();
    probe?.remove();
    observer.disconnect();
    window.removeEventListener("resize", check);
  };
}

/** A hidden element `1rem` wide, in the page, or `null` without a body. */
function remProbe(): HTMLElement | null {
  if (!document.body) return null;
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.dataset.resizableRem = "";
  probe.style.cssText =
    "position: fixed; top: 0; left: 0; width: 1rem; height: 0; " +
    "visibility: hidden; pointer-events: none;";
  document.body.appendChild(probe);
  return probe;
}
