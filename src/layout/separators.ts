/**
 * Separators as the layout model sees them: each one is a boundary between
 * two neighbours in a group (a grid's tracks are a group's too), a line,
 * which a grid draws in segments. Which lines a press drags, and
 * what a separator can do from where things are now (move at all; how far
 * Home and End take it).
 */
import type { Limits } from "../foundation/limits.js";
import { own } from "../foundation/own.js";
import { findStop, nextStop, reach } from "../foundation/stops.js";
import { MIN_MOVE } from "../foundation/transition.js";
import {
  type GroupSpace,
  type LayoutState,
  isSeparatorDisabled,
} from "./layout-config.js";
import { fittedItems, groupById, holdingLocked } from "./layout-fit.js";
import { type GroupItem, moveBoundary, neighbourScale } from "./solver.js";
import {
  type GroupNode,
  type SeparatorPair,
  groupBetween,
  shareSpace,
} from "./tree.js";

// --- Lines -------------------------------------------------------------------

/** A separator as the line it belongs to: its group, and its index. */
interface Line {
  readonly group: GroupNode;
  readonly index: number;
}

/**
 * The lines a press on `pairs` drags (a separator's one pair, or a
 * junction's). Pairs that aren't neighbours in a measured group are left out, and so is
 * a pair that moves the same space as one before it (see `shareSpace`),
 * which would fight it.
 */
export function linesOf(
  state: LayoutState,
  pairs: readonly SeparatorPair[],
): Line[] {
  const { root } = state.config;
  const lines: Line[] = [];
  const taken: SeparatorPair[] = [];
  for (const pair of pairs) {
    const group = groupBetween(root, pair.before, pair.after);
    if (!group) continue;
    if (!own(state.spaces, group.id)) continue;
    if (taken.some((other) => shareSpace(root, other, pair))) continue;
    taken.push(pair);
    const index = group.children.findIndex((child) => child.id === pair.before);
    lines.push({ group, index });
  }
  return lines;
}

/** Each line's separator, as its two neighbours. */
export function pairsOf(lines: readonly Line[]): SeparatorPair[] {
  return lines.map(({ group, index }) => ({
    before: group.children[index].id,
    after: group.children[index + 1].id,
  }));
}

/** The separators being dragged. */
export function draggedPairs(state: LayoutState): SeparatorPair[] {
  const lines = (state.drag?.separators ?? []).flatMap((separator) => {
    const group = groupById(state, separator.group);
    return group ? [{ group, index: separator.index }] : [];
  });
  return pairsOf(lines);
}

// --- What a separator can do -------------------------------------------------

/**
 * A fact about separators, worked out once per committed layout: it reads
 * only what `fittedItems` does (the config, the measured spaces and the
 * children's places), which a drag leaves as they are, so every frame of
 * a drag shares it. Keyed by those three objects, then by the separator
 * (its ids as JSON, so none can pass for another pair's: `"a b"`, `"c"`
 * and `"a"`, `"b c"`).
 */
function layoutCache<T>() {
  const facts = new WeakMap<
    object,
    WeakMap<object, WeakMap<object, Map<string, T>>>
  >();
  return (state: LayoutState, key: string, compute: () => T): T => {
    const byConfig = facts.get(state.config) ?? new WeakMap();
    facts.set(state.config, byConfig);
    const bySpaces = byConfig.get(state.spaces) ?? new WeakMap();
    byConfig.set(state.spaces, bySpaces);
    const byPlaces = bySpaces.get(state.places) ?? new Map<string, T>();
    bySpaces.set(state.places, byPlaces);
    // Known, even as `false` or `null`.
    if (byPlaces.has(key)) return byPlaces.get(key) as T;
    const fact = compute();
    byPlaces.set(key, fact);
    return fact;
  };
}

/** Whether each separator can move (see `separatorMoves`). */
const movesOf = layoutCache<boolean>();

/** Each separator's reach, by its primary side (see `separatorReach`). */
const reachesOf = layoutCache<Limits | null>();

/** A separator's group, laid out in its space. */
export interface SeparatorAt {
  readonly group: GroupNode;
  readonly space: GroupSpace;
  /** The index of the child before it. */
  readonly index: number;
  /** The group's items as laid out now. */
  readonly items: GroupItem[];
}

/**
 * Where the separator between `before` and `after` is: its group, laid out
 * in its space. `null` if they aren't neighbours, or the group isn't
 * measured yet.
 */
export function separatorAt(
  state: LayoutState,
  before: string,
  after: string,
): SeparatorAt | null {
  const group = groupBetween(state.config.root, before, after);
  if (!group) return null;
  const space = own(state.spaces, group.id);
  if (!space) return null;
  const index = group.children.findIndex((child) => child.id === before);
  // As a press or a key moves them: locked children hold their size.
  return {
    group,
    space,
    index,
    items: holdingLocked(group, fittedItems(state, group)),
  };
}

/**
 * Whether the separator between `before` and `after` can move at all (or
 * isn't measured yet, so it can't be told): when it can't, nothing a press
 * or a key does there changes anything, so it shouldn't look as if it would.
 */
export function separatorMoves(
  state: LayoutState,
  before: string,
  after: string,
): boolean {
  return movesOf(state, JSON.stringify([before, after]), () =>
    separatorCanMove(state, before, after),
  );
}

function separatorCanMove(
  state: LayoutState,
  before: string,
  after: string,
): boolean {
  if (isSeparatorDisabled(state.config, before, after)) return false;
  const at = separatorAt(state, before, after);
  if (!at) return true;
  const { space, index, items } = at;
  // Anything it can change, not just `before`'s size: a child at its
  // minimum can still be pushed along, the space coming from beyond it,
  // and next to a `"last"` fill the line stays put as its neighbour
  // collapses. Tried: a long drag either way (cascading), a short one
  // (within the neighbours' ranges), and a jump to each neighbour's next
  // stop (a snap a long drag can overshoot: more than the other side can
  // give).
  const deltas = [
    -space.available,
    space.available,
    -1,
    1,
    ...jumpsFrom(items, index, -1),
    ...jumpsFrom(items, index, 1),
  ];
  return deltas.some((delta) => {
    const moved = moveBoundary(items, index, delta, {
      cascade: state.config.cascade,
    });
    return moved.some(
      (item, position) =>
        item.stop !== items[position].stop ||
        Math.abs(item.size - items[position].size) > MIN_MOVE,
    );
  });
}

/**
 * The sizes the separator between `before` and `after` can give its
 * `primary` neighbour (`before` by default): where Home and End take it,
 * as far as the layout allows (its siblings' stops, and cascading if
 * that's on). `null` before measuring, or if they aren't neighbours.
 */
export function separatorReach(
  state: LayoutState,
  before: string,
  after: string,
  primary: SeparatorSide = "before",
): Limits | null {
  return reachesOf(state, JSON.stringify([before, after, primary]), () =>
    reachOf(state, before, after, primary),
  );
}

/**
 * Which neighbour a separator is about (`primary` in `getSeparatorProps`):
 * the one whose size it reports, and whose stop Enter toggles.
 */
export type SeparatorSide = "before" | "after";

function reachOf(
  state: LayoutState,
  before: string,
  after: string,
  primary: SeparatorSide,
): Limits | null {
  const at = separatorAt(state, before, after);
  if (!at) return null;
  const { space, index, items } = at;
  const position = primary === "before" ? index : index + 1;
  const current = items[position];
  const limits = reach(current.track, current.stop);
  // A size for a neighbour is a move of the separator (see
  // `neighbourScale`), the other way for the one after it.
  const scale = neighbourScale(items, index, position);
  const sign = primary === "before" ? 1 : -1;
  const reached = (target: number) =>
    moveBoundary(items, index, (sign * (target - current.size)) / scale, {
      cascade: state.config.cascade,
    })[position].size;
  return {
    min: reached(limits.min),
    max: reached(Math.min(limits.max, space.available)),
  };
}

/**
 * Moves of the separator after item `index` that would take one of its
 * neighbours to its next stop in the direction of `delta`, smallest first.
 */
export function jumpsFrom(
  items: readonly GroupItem[],
  index: number,
  delta: number,
): number[] {
  const direction = delta > 0 ? 1 : -1;
  const growing = items[direction > 0 ? index : index + 1];
  const shrinking = items[direction > 0 ? index + 1 : index];
  // Sizes for the neighbours, as moves of the separator.
  const amounts: number[] = [];
  const growingStop = findStop(growing.track, growing.stop);
  const up = growingStop && nextStop(growing.track, growingStop, 1);
  if (up) {
    amounts.push(
      (up.min - growing.size) /
        neighbourScale(items, index, direction > 0 ? index : index + 1),
    );
  }
  const shrinkingStop = findStop(shrinking.track, shrinking.stop);
  const down = shrinkingStop && nextStop(shrinking.track, shrinkingStop, -1);
  if (down) {
    amounts.push(
      (shrinking.size - down.max) /
        neighbourScale(items, index, direction > 0 ? index + 1 : index),
    );
  }
  return amounts.sort((a, b) => a - b).map((amount) => amount * direction);
}
