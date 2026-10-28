/**
 * A layout's view: what it is now, in the terms the hook returns (each
 * child's size and stop, what's being dragged). The hook renders from it,
 * and the controller's `getView()` returns it, for code outside React.
 * Derived from the state, and cached by it.
 */
import { stopName } from "../foundation/aria.js";
import { own, setOwn } from "../foundation/own.js";
import { type ResolvedStop, resolvedStops } from "../foundation/stops.js";
import type { LayoutState } from "./layout-config.js";
import { getLayoutContentRendering } from "./layout-rendering.js";
import { indexTree } from "./tree.js";

/**
 * The live state of a child: an element, a nested group or grid, or a
 * grid's track (a cell's content has none of its own: its tracks' are its
 * size).
 */
export interface ResizableLayoutChild<
  Id extends string = string,
  Stop extends string = string,
> {
  id: Id;
  /**
   * Size along its group's direction in pixels, as given: what its stops,
   * `setSize`, a saved snapshot and the separator's `aria-valuenow` are in
   * terms of. In a group past its space (`overflowing`), it's drawn
   * smaller (see `contentSize`). `null` until measured.
   */
  size: number | null;
  /**
   * The stop it's in. `null` without named stops, and before measurement
   * when that depends on where its default size lands.
   */
  stop: Stop | null;
  /**
   * The stop it was in before its latest change of stop (by a drag, a
   * `setStop`, a key, …), or `null` if it hasn't changed stop yet. For
   * content that crossfades between stops.
   */
  previousStop: Stop | null;
  /**
   * Its named stops in pixels, as they are now (`%` sizes resolved against
   * the space its group shares, and limited by what its children need):
   * `{ min, max }` each, equal for a point. `{}` without named stops; `null`
   * until measured. For drawing the stops (tick marks, a ruler) or
   * reasoning about them in code.
   */
  stops: Readonly<Record<Stop, ResolvedStop>> | null;
  /**
   * The size to lay content out at, so it doesn't squeeze while the child is
   * small: its size while it's in a range, as drawn (smaller than `size` in
   * a group past its space), and at a point (a rail, or 0)
   * the size of the range it would go back to, though while an animated
   * change takes it there, the size it had when the change began, so its
   * content leaves as it was; with `reflow: "once"`, the held size while a
   * drag or an animated change holds the content.
   * `getContentProps(id)` lays content out at it (through
   * `--resizable-content-size` on its element, and `--resizable-content-width`
   * in a row or `-height` in a column, the names `useResizable` uses).
   * `null` until measured.
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
  /**
   * While it's stepped down along its `yieldTo` to fit, the stop chosen
   * for it, which it goes back to when there's room (and which is what's
   * saved); `stop` is where it is. `null` otherwise.
   */
  yieldedFrom: Stop | null;
}

export interface ResizableLayoutView<Id extends string = string> {
  /**
   * Every element in a group (not groups, grids, a grid's tracks, nor its
   * plain cells: `childrenOf(gridId)` lists those), in reading order.
   */
  elements: ResizableLayoutChild<Id>[];
  /**
   * Every child by id: elements, nested groups and grids, and grids'
   * tracks (not the root, which isn't a child, nor cells).
   */
  children: Readonly<Record<string, ResizableLayoutChild<Id>>>;
  /** The separators being dragged, as the children either side of each. */
  dragging: { before: Id; after: Id }[];
  /**
   * Whether a committed change (a release, `setStop`, `toggle`, …) is still
   * transitioning. Also `data-animating` on the root group.
   */
  animating: boolean;
  /** Whether some group's minimum sizes don't fit in its space. */
  overflowing: boolean;
}

/** Views already worked out, by state (see `getLayoutRendering`). */
const views = new WeakMap<LayoutState, ResizableLayoutView>();

/** The view of a state: the same object for the same state. */
export function getLayoutView(state: LayoutState): ResizableLayoutView {
  let view = views.get(state);
  if (!view) {
    view = deriveView(state);
    views.set(state, view);
  }
  return view;
}

function deriveView(state: LayoutState): ResizableLayoutView {
  // With the content as it's laid out: held while reflowing once (see
  // `getLayoutContentRendering`).
  const rendering = getLayoutContentRendering(state);
  const children: Record<string, ResizableLayoutChild> = {};
  for (const [id, child] of rendering.nodes) {
    setOwn(children, id, {
      id,
      size: child.size,
      // Without named stops, the one unnamed stop reads `null`.
      stop: stopName(child.stop),
      previousStop: stopName(own(state.previousStops, id)),
      stops: resolvedStops(child.track),
      contentSize: child.contentSize,
      contentStop: stopName(child.contentStop),
      fromStop: stopName(own(state.fromStops, id)),
      yieldedFrom: stopName(child.yieldedFrom),
    });
  }
  return {
    elements: indexTree(state.config.root).elements.flatMap(
      (element) => own(children, element.id) ?? [],
    ),
    children,
    dragging: rendering.dragging.map(({ before, after }) => ({
      before,
      after,
    })),
    animating: rendering.animating,
    overflowing: rendering.overflowing,
  };
}
