import type { CSSProperties } from "react";

import type { RefCallback } from "./ref-callback.js";
import type { TransitionTiming } from "./transition.js";

/** What every prop getter takes. */
export interface PropsOptions {
  /**
   * Your own inline styles, merged over the library's, so yours win key by
   * key (an inline style beats any class, so this is how to change one of
   * the library's).
   */
  style?: CSSProperties;
}

/** What `getClipProps` takes, in `useResizable`. */
export interface ClipOptions extends PropsOptions {
  /**
   * The content travels with the moving edge as the element closes to 0
   * or opens from it, as a drawer does, instead of staying put while the
   * edge covers and uncovers it (the default). See "Content while it
   * resizes" in the README, and its limits.
   */
  slide?: boolean;
}

/** What `getClipProps` returns, in either hook. */
export interface ResizableClipProps {
  /** For a development check that the layer fills its element. */
  ref: RefCallback;
  style: CSSProperties;
  "data-resizable-clip": "";
  /**
   * The element's own `data-zero`: set while it's at 0, or on its way
   * there (from the change's start, so a fade on it runs alongside), and
   * cleared as soon as it's past 0.
   */
  "data-zero": "" | undefined;
  /** Set while the content slides with the moving edge. */
  "data-sliding": "" | undefined;
}

/** What `getContentProps` returns, in either hook. */
export interface ResizableContentProps {
  style: CSSProperties;
  /** Marks the wrapper, for the library's development warnings. */
  "data-resizable-content": "";
}

/**
 * The style of a wrapper around an element's content, laying it out at the
 * element's content size (`--resizable-content-width`, `-height`) along
 * `axes`. While a drag or an animated change holds the content (reflowing
 * once), exactly that, so it keeps its layout whether its element grows or
 * shrinks, and with its own paint (`contain: paint`), so the element
 * resizing around it doesn't paint it again either (half the cost of a
 * move with heavy content). Otherwise at least the element's size, so it
 * never falls short of an element animating past it.
 */
export function contentStyle(
  axes: { readonly width: boolean; readonly height: boolean },
  holding: boolean,
): CSSProperties {
  const size = (axis: "width" | "height") => {
    if (!axes[axis]) return undefined;
    const variable = `var(--resizable-content-${axis}, 100%)`;
    return holding ? variable : `max(100%, ${variable})`;
  };
  return {
    width: size("width"),
    height: size("height"),
    flexShrink: 0,
    contain: holding ? "paint" : undefined,
  };
}

/**
 * Whether an animating change holds a part's content at its content size:
 * only if the part changes stop in it (`fromStop`, where the change began,
 * isn't the stop it's going to).
 */
export function holdsWhileAnimating(
  animating: boolean,
  fromStop: string | null | undefined,
  stop: string | null | undefined,
): boolean {
  return animating && fromStop != null && fromStop !== stop;
}

/**
 * The value of a `--resizable-content-*` variable: the content size, or
 * `initial` while that's just the size drawn (in a range, not animating),
 * so `var(…, 100%)` falls back to `100%`, which says the same. Custom
 * properties inherit, so one that changed on every frame of a drag or a
 * window resize would restyle everything inside the element each time;
 * `initial` doesn't change, and unlike leaving it unset, it keeps an outer
 * element's value from being inherited (a resizable inside a sidebar at
 * its rail).
 *
 * `always` gives the size anyway: while content is held (reflowing once),
 * and while a change that moves this part to another stop animates (see
 * `holdsWhileAnimating`), so content opening or closing keeps its open
 * size instead of squeezing. A part resized within its stop (a neighbour
 * opening, say) isn't held: its content reflows with its edge, as in a
 * drag, rather than jumping to where the change will end.
 */
export function contentVariable(
  contentSize: number | null,
  size: number | null,
  always: boolean,
): string {
  return contentSize !== null && (always || contentSize !== size)
    ? `${contentSize}px`
    : "initial";
}

/**
 * The size a part's content wrapper (`getContentProps`) is laid out at,
 * with the part `shown` at that size: its content size where it has one
 * (`contentVariable`: held, or not just the size drawn), exactly while
 * reflowing once holds it (`holding`), and otherwise never less than the
 * part (`max(100%, …)`); else the part's own size, which it follows.
 */
export function laidOutContentSize(
  contentSize: number | null,
  size: number | null,
  shown: number,
  holds: boolean,
  holding: boolean,
): number {
  if (contentSize === null || (!holds && contentSize === size)) return shown;
  return holding ? contentSize : Math.max(shown, contentSize);
}

/**
 * `--resizable-duration` and `--resizable-easing`: the latest change's
 * timing, for content that should move with it (`0ms` when it doesn't
 * animate).
 */
export function timingVariables(
  timing: TransitionTiming | null,
): CSSProperties {
  return {
    "--resizable-duration": `${timing?.duration ?? 0}ms`,
    "--resizable-easing": timing?.easing ?? "linear",
  } as CSSProperties;
}
