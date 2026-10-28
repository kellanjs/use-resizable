/**
 * What a layout's children can be: each one's stop, its limits and its
 * stops in pixels, with nested groups needing room for their children, read
 * at the stops its children are stepped down to. Deciding what steps down
 * (`layout-plan.ts`) and fitting a group's sizes to its space
 * (`layout-fit.ts`) build on these.
 */
import type { Axis } from "../foundation/keyboard.js";
import { type Limits, createLimits } from "../foundation/limits.js";
import { own } from "../foundation/own.js";
import {
  DEFAULT_ROOT_FONT_SIZE,
  type SizeContext,
  resolveSize,
  usesPercentUnits,
} from "../foundation/size.js";
import {
  EPSILON,
  type Stop,
  type Track,
  findStop,
  isPoint,
  isRangeStop,
  land,
  resolveTrack,
  roomiest,
  within,
} from "../foundation/stops.js";
import type { LayoutState } from "./layout-config.js";
import {
  type ChildNode,
  type GridNode,
  type GroupNode,
  indexTree,
  tracksAlong,
} from "./tree.js";

/** What a group's children's `%`, `rem`, `vw` and `vh` sizes resolve against. */
export function contextOf(state: LayoutState, group: GroupNode): SizeContext {
  const space = own(state.spaces, group.id) ?? Object.values(state.spaces)[0];
  return {
    containerSize: own(state.spaces, group.id)?.available ?? null,
    rootFontSize: space?.rootFontSize ?? DEFAULT_ROOT_FONT_SIZE,
    viewport: space?.viewport ?? null,
  };
}

/**
 * The name of the stop a node is in: its committed one, or for a node not
 * laid out yet, its default stop, or else its home stop.
 */
export function stopNameOf(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
): string {
  const known = own(state.places, node.id);
  if (known) return known.stop;
  return node.defaultStop ?? homeStop(state, node, parent);
}

/**
 * Where a node goes without a stop of its own: where its default size lands,
 * or its roomiest stop if it has no default size.
 */
export function homeStop(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
): string {
  const context = contextOf(state, parent);
  const track = resolveTrack(node, context);
  const size = node.defaultSize && resolveSize(node.defaultSize, context);
  return size == null ? roomiest(track).name : land(track, size, null).stop;
}

/** The size a node takes in a range stop it hasn't been in yet. */
export function fallbackSize(
  state: LayoutState,
  parent: GroupNode,
  node: ChildNode,
  stop: Stop,
): number {
  const size =
    node.defaultSize && resolveSize(node.defaultSize, contextOf(state, parent));
  return within(stop, size ?? stop.min);
}

/**
 * How big `node` can be along `axis`. Along its own group's axis, that's its
 * own limits; a nested group also can't be smaller than its children need
 * (added up if they run the same way, the largest if they run across).
 * Across its group's axis, an element is unconstrained. Read as `reading`
 * says (see `Reading`): at its chosen stop, without one.
 */
export function extentOf(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
  axis: Axis,
  reading?: Reading,
  // What its own children need: of its own space, not its parent's, so a
  // caller trying spaces for the parent works it out once.
  inner: Limits | null = innerOf(state, node, axis, reading),
): Limits {
  let min = 0;
  let max = Infinity;

  if (axis === parent.axis) {
    const track = ownTrack(node, contextOf(state, parent));
    const stop =
      findStop(track, stopFor(state, node, parent, reading)) ?? roomiest(track);
    // A node at a point is exactly that size: one its options make a
    // point (a range of `%`s is one only in no space at all, where it
    // still can't be smaller than its children need).
    if (isPoint(stop) && !isRangeStop(node, stop.name)) {
      return { min: stop.min, max: stop.max };
    }
    min = stop.min;
    max = stop.max;
    // Keeping its size before others step down, it counts at its size.
    if (reading?.keepsSize?.(node) && isRangeStop(node, stop.name)) {
      min = Math.max(min, keptSize(state, node, parent, stop));
    }
  }

  if (inner) {
    min = Math.max(min, inner.min);
    max = Math.min(max, inner.max);
  }
  return createLimits(min, max, node.wins);
}

const ownTracks = new WeakMap<
  ChildNode,
  { readonly context: SizeContext; readonly track: Track }
>();

/**
 * `node`'s own stops resolved in `context`: kept for the last context it
 * was resolved in, as stepping down reads them over and over.
 */
function ownTrack(node: ChildNode, context: SizeContext): Track {
  const known = ownTracks.get(node);
  if (
    known &&
    known.context.containerSize === context.containerSize &&
    known.context.rootFontSize === context.rootFontSize &&
    known.context.viewport === context.viewport
  ) {
    return known.track;
  }
  const track = resolveTrack(node, context);
  ownTracks.set(node, { context, track });
  return track;
}

/**
 * What a group's or a grid's own children need along `axis` (a grid's, its
 * tracks that way), and a grid track what the groups and grids in its
 * cells need; `null` for an element, which has none (and a track with none
 * of those).
 */
export function innerOf(
  state: LayoutState,
  node: ChildNode,
  axis: Axis,
  reading?: Reading,
): Limits | null {
  if (node.kind === "group") return innerExtent(state, node, axis, reading);
  if (node.kind === "grid") {
    return innerExtent(state, tracksAlong(node, axis), axis, reading);
  }
  if (node.kind === "track") {
    // What the groups and grids in its cells need, those spanning just it
    // that way: a cell spanning several would need their sizes added up,
    // which isn't kept to (its content is clipped instead).
    const min = Math.max(
      0,
      ...contentsOn(state, node, axis, true).map(
        (content) => innerOf(state, content, axis, reading)?.min ?? 0,
      ),
    );
    return min > 0 ? { min, max: Infinity } : null;
  }
  return null;
}

/**
 * The groups and grids that are cells on a grid's track, along `axis`:
 * every one spanning it, or with `alone`, those spanning just it.
 */
export function contentsOn(
  state: LayoutState,
  track: ChildNode,
  axis: Axis,
  alone = false,
): (GroupNode | GridNode)[] {
  const grid = indexTree(state.config.root).gridOf.get(track.id);
  if (!grid) return [];
  const index = tracksAlong(grid, axis).children.indexOf(track);
  return grid.cells.flatMap((cell) => {
    const [start, span] =
      axis === "horizontal"
        ? [cell.column, cell.columnSpan]
        : [cell.row, cell.rowSpan];
    const on = start <= index && index < start + span;
    return cell.content && on && (!alone || span === 1) ? [cell.content] : [];
  });
}

export function innerExtent(
  state: LayoutState,
  group: GroupNode,
  axis: Axis,
  reading?: Reading,
): Limits {
  const space = own(state.spaces, group.id);
  if (axis !== group.axis) {
    // Across, the children stretch to fill it, inside its padding. (What
    // they need that way is their own groups', of their own spaces, not
    // a share of this one's.)
    const children = group.children.map((child) =>
      extentOf(state, child, group, axis, reading),
    );
    const overhead = space?.crossOverhead ?? 0;
    return {
      min: Math.max(0, ...children.map((limits) => limits.min)) + overhead,
      max:
        Math.min(Infinity, ...children.map((limits) => limits.max)) + overhead,
    };
  }
  // Along it, they add up, in its space as it is now, or as it would be.
  const overhead = space?.overhead ?? 0;
  // Once, not once per space tried (see `extentOf`).
  const inners = group.children.map((child) =>
    innerOf(state, child, axis, reading),
  );
  const along = (available?: number): Limits => {
    const at =
      available === undefined || !space
        ? state
        : {
            ...state,
            spaces: { ...state.spaces, [group.id]: { ...space, available } },
          };
    return group.children.reduce(
      (sum, child, index) => {
        const limits = extentOf(at, child, group, axis, reading, inners[index]);
        return { min: sum.min + limits.min, max: sum.max + limits.max };
      },
      { min: 0, max: 0 },
    );
  };
  const now = along();
  if (
    !space ||
    !group.children.some((child) => usesPercentUnits(child.stops))
  ) {
    return { min: now.min + overhead, max: now.max + overhead };
  }
  // A child's `%` limits are of this space, which is what the children
  // add up to: needing 90% of itself, a group needs no more than its
  // padding (and 10px more needs 100px). So it needs as much as the least
  // space what they'd need in it fits in, and takes as much as the most
  // space what they'd take in it fills. Where they need more than all of
  // it, nothing fits: then it's as now. Where only no space at all is
  // filled (maximums of `%`s adding up to less than 100%), it takes any:
  // they stop at their shares, and the rest is left empty, as in CSS.
  const min = leastFitting((available) => along(available).min);
  const max = Number.isFinite(now.max)
    ? mostFilled((available) => along(available).max)
    : Infinity;
  return {
    min: (min ?? now.min) + overhead,
    max: (max > EPSILON ? max : Infinity) + overhead,
  };
}

/**
 * The least space `need` fits in (`need(space) <= space`). `need`, the
 * children's minimums added up for a space, grows with it in straight
 * pieces, each steeper than the last (a minimum is the largest of its
 * sizes): from 0, a step along the line of the piece it's on lands at or
 * short of the answer, so it's reached in as many steps as there are
 * pieces between. The line is read a pixel ahead, and the steps stop at
 * `MEETING_STEPS`, with the answer reached so far. `null` where it's never
 * met (it grows as fast as the space, or faster).
 */
export function leastFitting(
  need: (available: number) => number,
): number | null {
  let available = 0;
  for (let step = 0; step < MEETING_STEPS; step++) {
    const here = need(available);
    if (here <= available + EPSILON) return available;
    // How much more it needs for each pixel more there is.
    const slope = need(available + 1) - here;
    if (slope >= 1 - EPSILON) return null;
    available += (here - available) / (1 - slope);
  }
  return available;
}

/**
 * The most space `cap` fills (`cap(space) >= space`). `cap`, the
 * children's maximums added up for a space, grows with it in straight
 * pieces, each less steep than the last (a maximum is the least of its
 * sizes), and is at least 0 in none: what it fills runs from 0 up to one
 * space, or on forever. Forever if it fills one further than any layout
 * is (`FAR`); else back from there, a step along the line of the piece
 * it's on landing at or past the answer.
 */
export function mostFilled(cap: (available: number) => number): number {
  let available = FAR;
  if (cap(available) >= available - EPSILON) return Infinity;
  for (let step = 0; step < MEETING_STEPS; step++) {
    const here = cap(available);
    if (here >= available - EPSILON) return available;
    // How much more it takes for each pixel more there is.
    const slope = here - cap(available - 1);
    // Rising slower before than here, so it never caught the space up.
    if (slope >= 1 - EPSILON) return 0;
    available = Math.max(0, available - (available - here) / (1 - slope));
  }
  return available;
}

/** At most this many steps of `leastFitting` and `mostFilled`. */
const MEETING_STEPS = 8;

/** Further than any layout's space: past where any fixed size bends. */
const FAR = 1e9;

/**
 * A child's stops in its group. A nested group's ranges are also limited by
 * what its children need.
 */
export function trackOf(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
  reading?: Reading,
): Track {
  const context = contextOf(state, parent);
  const inner = innerOf(state, node, parent.axis, reading);
  return inner ? resolveTrack(node, context, inner) : ownTrack(node, context);
}

// --- Stepping down ---------------------------------------------------------

/**
 * Where children are stepped down to, beyond the stops chosen for them, by
 * id: down their `yieldTo`, to fit (see `planOf`).
 */
export type Steps = ReadonlyMap<string, string>;

/**
 * How what a node needs is read: at the stops `steps` step its children
 * down to, and (deciding which to step) a child that keeps
 * its size first (`keepSize: "yield-first"`) at its size while `keepsSize`
 * says so. Without one, at the stops chosen.
 */
export interface Reading {
  readonly steps: { get(id: string): string | undefined };
  readonly keepsSize?: (node: ChildNode) => boolean;
}

/** The stop a node is at, read as `reading` says. */
export function stopFor(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
  reading: Reading | undefined,
): string {
  const chosen = stopNameOf(state, node, parent);
  const to = reading?.steps.get(node.id);
  return to !== undefined && reachesDown(node, chosen, to) ? to : chosen;
}

/** The stop a node is held down to from `stop` (see `heldDown`), if any. */
export function heldStop(
  state: LayoutState,
  node: ChildNode,
  stop: string,
): string | undefined {
  const held = own(state.heldDown, node.id);
  return held !== undefined && held !== stop ? held : undefined;
}

/** Whether `to` is down `node`'s `yieldTo` from `from`, a step at a time. */
export function reachesDown(
  node: ChildNode,
  from: string,
  to: string,
): boolean {
  let at = from;
  for (let step = 0; step < Object.keys(node.yieldTo).length; step++) {
    const next = own(node.yieldTo, at);
    if (next === undefined) return false;
    if (next === to) return true;
    at = next;
  }
  return false;
}

/** The size a child keeping its size keeps in `stop`, within it. */
export function keptSize(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
  stop: Stop,
): number {
  const remembered = own(own(state.places, node.id)?.sizes, stop.name);
  return within(stop, remembered ?? fallbackSize(state, parent, node, stop));
}
