/**
 * A resizable's view: what it is now, in the terms the hook returns (sizes
 * in pixels, stop names, what's being dragged). The hook renders from it,
 * and the controller's `getView()` returns it, for code outside React.
 * Derived from the state, and cached by it.
 */
import { stopName } from "../foundation/aria.js";
import type { HandleEdge } from "../foundation/handle.js";
import { type ResolvedStop, resolvedStops } from "../foundation/stops.js";
import type { DragTarget, ResizableState } from "./resizable-config.js";
import { getResizableContentRendering } from "./resizable-model.js";

/** The live state of one resizable dimension. */
export interface ResizableDimension<Stop extends string = string> {
  /** Rendered size in pixels; `null` until the element has been measured. */
  size: number | null;
  /**
   * The stop it's in. `null` for a dimension without named stops, and before
   * measurement when that depends on where `defaultSize` lands.
   */
  stop: Stop | null;
  /**
   * The stop it was in before its latest change of stop (by a drag, a
   * `setStop`, a key, …), or `null` if it hasn't changed stop yet. For
   * content that crossfades between stops: what it's fading from, and while
   * at zero, what was showing before.
   */
  previousStop: Stop | null;
  /**
   * Its named stops in pixels, as they are now (`%` sizes resolved against
   * the container, and limited by it if confined, or by the other
   * dimension through a locked ratio): `{ min, max }` each, equal for a
   * point. `{}` without named stops; `null` until measured. For drawing the
   * stops (tick marks, a ruler) or reasoning about them in code.
   */
  stops: Readonly<Record<Stop, ResolvedStop>> | null;
  /**
   * The size to lay content out at, so it doesn't squeeze while the element
   * is small: the size itself while it's in a range, and at a point (a rail,
   * or 0) the size of the range it would go back to, though while an
   * animated change takes it there, the size it had when the change began,
   * so its content leaves as it was; with `reflow: "once"`, the held size
   * while a drag or an animated change holds the content.
   * `getContentProps` lays content out at it (through
   * `--resizable-content-width` and `-height` on the element). `null` until
   * measured.
   */
  contentSize: number | null;
  /**
   * The stop whose content to show, for content that changes with the stop
   * (an icon rail, say): the stop itself, or at a point at 0, which shows
   * nothing, the stop it came from, so the content leaves with it (and if
   * that isn't known, the one a toggle would go back to).
   * With `reflow: "once"`, the stop it had while a drag holds the content.
   */
  contentStop: Stop | null;
  /**
   * The stop it was in when the change in progress began: a drag, from its
   * press until its release has settled, or an animated change (`setStop`,
   * `toggle`, a key, …) until its transition ends. An animated change
   * interrupting another starts afresh if it changes this one's stop, and
   * otherwise keeps where this one's motion began; a drag starts afresh.
   * `null` while nothing is changing (and without
   * named stops). With `stop`, it says what's happening: from `fromStop`
   * to `stop`. Unlike `previousStop`, which stays, it's about this change
   * only, so content can move by where a change starts and ends: travel
   * with the edge while going to or from `closed`, but not while settling
   * after an elastic pull; or swap a crossfade's layers at once coming out
   * of `closed`, where nothing was showing.
   */
  fromStop: Stop | null;
}

export interface ResizableView {
  /** `null` when the width isn't resizable. */
  width: ResizableDimension | null;
  /** `null` when the height isn't resizable. */
  height: ResizableDimension | null;
  /** What's being dragged (a handle's edge, or "move"), if anything. */
  dragging: DragTarget | null;
  /**
   * Whether a committed change (a release, `setStop`, `toggle`, …) is still
   * transitioning, for restyling during it, like hiding labels while a
   * sidebar goes to its rail. Also `data-animating` on the element.
   */
  animating: boolean;
  /**
   * Where a floating element (`anchor: "none"`) is, in pixels from the
   * container's top-left; `null` when the element isn't floating. `x` and
   * `y` are `null` until measured.
   */
  position: { x: number | null; y: number | null } | null;
  /**
   * The edges this element offers edge and corner handles for, for
   * rendering them in a loop (the move handle is separate).
   */
  handles: readonly HandleEdge[];
}

/** Views already worked out, by state (see `getResizableRendering`). */
const views = new WeakMap<ResizableState, ResizableView>();

/** The view of a state: the same object for the same state. */
export function getResizableView(state: ResizableState): ResizableView {
  let view = views.get(state);
  if (!view) {
    view = deriveView(state);
    views.set(state, view);
  }
  return view;
}

function deriveView(state: ResizableState): ResizableView {
  // With the content as it's laid out: held while reflowing once (see
  // `getResizableContentRendering`).
  const rendering = getResizableContentRendering(state);
  // A dimension without named stops has one unnamed stop, which reads
  // `null` (`stopName`).
  const dimensionOf = (dimension: "width" | "height") => {
    const own = rendering[dimension];
    return own
      ? {
          size: own.size,
          stop: stopName(own.stop),
          previousStop: stopName(state.previousStops[dimension]),
          stops: resolvedStops(own.track),
          contentSize: own.contentSize,
          contentStop: stopName(own.contentStop),
          fromStop: stopName(state.fromStops?.[dimension]),
        }
      : null;
  };
  return {
    width: dimensionOf("width"),
    height: dimensionOf("height"),
    dragging: rendering.dragging,
    animating: rendering.animating,
    position: rendering.position && {
      x: rendering.position.x,
      y: rendering.position.y,
    },
    handles: state.config.handles,
  };
}
