/**
 * How a layout's measured spaces change through its nested groups and grid
 * cells: when a group is laid out anew, the groups inside its children get
 * the space they're about to have (`passDownChanges`), and every measured
 * group's space can be worked out afresh, top down (`respace`). The actions
 * in `layout-model.ts` build on these.
 */
import { own } from "../foundation/own.js";
import { EPSILON } from "../foundation/stops.js";
import { type LayoutState, MEASURE_EPSILON } from "./layout-config.js";
import { contentsOn } from "./layout-extents.js";
import { fittedItems } from "./layout-fit.js";
import {
  type LayoutRendering,
  currentItems,
  drawnSizes,
} from "./layout-rendering.js";
import type { GroupItem } from "./solver.js";
import {
  type ChildNode,
  type GroupNode,
  indexTree,
  tracksAlong,
} from "./tree.js";

/**
 * After `group` is laid out anew, the groups inside its children that run
 * the same way get the space they're about to have: their measured space
 * changed by as much as the child containing them. Groups that run across
 * are passed through, as they stretch to fill the child (the flex default).
 * Their measurements are from the layout as it was (`rendered`), and until
 * the browser catches up, laying them out in that space would pick stops
 * for the wrong size (say, a `40%` child in a group about to triple).
 *
 * Their children change size in turn, so it carries on down, but for the
 * groups in `committedLater`, which the caller lays out itself next.
 */
export function passDownChanges(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
  rendered: LayoutRendering,
  committedLater: ReadonlySet<string> = new Set(),
): LayoutState {
  // Each group inside, with its change: a cell spanning several tracks is
  // reached from each, and gets their changes added up (one track giving
  // what the other takes leaves it as it was).
  const changes = new Map<string, { inner: GroupNode; change: number }>();
  // As drawn (see `drawnSizes`), as the browser measures them.
  const drawn = drawnSizes(group, items, own(state.spaces, group.id));
  group.children.forEach((child, index) => {
    const was = rendered.nodes.get(child.id)?.drawn;
    if (was == null) return;
    const change = drawn[index] - was;
    for (const inner of runningAlong(state, child, group.axis)) {
      if (own(state.spaces, inner.id)) {
        const sum = changes.get(inner.id)?.change ?? 0;
        changes.set(inner.id, { inner, change: sum + change });
      }
    }
  });
  let spaces = state.spaces;
  const reached: GroupNode[] = [];
  for (const { inner, change } of changes.values()) {
    // Every change counts, however small: a drag passes its changes down a
    // move at a time, and a fraction dropped each move would add up.
    if (Math.abs(change) < EPSILON) continue;
    const space = own(spaces, inner.id)!;
    spaces = {
      ...spaces,
      [inner.id]: {
        ...space,
        available: Math.max(0, space.available + change),
      },
    };
    reached.push(inner);
  }
  if (spaces === state.spaces) return state;
  let next: LayoutState = { ...state, spaces };
  for (const inner of reached) {
    if (committedLater.has(inner.id)) continue;
    next = passDownChanges(
      next,
      inner,
      fittedItems(next, inner),
      rendered,
      committedLater,
    );
  }
  return next;
}

/**
 * Every measured group's space as it's about to be, worked out afresh from
 * the spaces `measured` with the layout as `rendered` shows it: each
 * changed by as much as the child containing it, of the nearest group
 * running its way (see `runningAlong`). Top down, so each group is fitted
 * in its new space before the groups inside it are. Unlike
 * `passDownChanges`, which starts from the group laid out anew, this
 * reaches the groups around it too: a change that raises what a group's
 * children need past its space (a child opening at a minimum it doesn't
 * have room for) makes its parent give it more, and its siblings less.
 */
export function respace(
  state: LayoutState,
  measured: LayoutState["spaces"],
  rendered: LayoutRendering,
): LayoutState {
  // A child's limits can resolve against its group's space (a `%` of
  // it), so a group given more can need more again: passes until the
  // spaces settle. What a group needs of its own space is worked out where
  // they meet (see `innerExtent`), so a pass a level down settles it.
  // Limits that can't all be met don't settle, and stop at the last pass.
  let spaces = measured;
  for (let pass = 0; pass < RESPACE_PASSES; pass++) {
    const next = respacePass(state, measured, rendered, spaces);
    const settled = Object.keys(next).every(
      (id) =>
        Math.abs(next[id]!.available - (own(spaces, id)?.available ?? 0)) <
        MEASURE_EPSILON,
    );
    spaces = next;
    if (settled) break;
  }
  return spaces === state.spaces ? state : { ...state, spaces };
}

/** At most this many passes of `respace`: see there. */
const RESPACE_PASSES = 20;

/**
 * One pass of `respace`, top down: each group fitted in the space the
 * pass gave it, and with the groups inside it at their spaces in `guess`
 * (the last pass's) until the pass reaches them.
 */
function respacePass(
  state: LayoutState,
  measured: LayoutState["spaces"],
  rendered: LayoutRendering,
  guess: LayoutState["spaces"],
): LayoutState["spaces"] {
  let spaces = guess;
  for (const group of indexTree(state.config.root).groups) {
    if (!own(spaces, group.id)) continue;
    const now: LayoutState = { ...state, spaces };
    // As drawn (see `drawnSizes`): a group past its space gives the
    // groups inside its children their shares of it. Mid-drag, as the drag
    // has them (see `currentItems`).
    const sizes = drawnSizes(
      group,
      currentItems(now, group),
      own(spaces, group.id),
    );
    // A cell spanning several tracks gets their changes added up.
    const changes = new Map<string, number>();
    group.children.forEach((child, index) => {
      const was = rendered.nodes.get(child.id)?.drawn;
      if (was == null) return;
      for (const inner of runningAlong(now, child, group.axis)) {
        if (!own(measured, inner.id)) continue;
        changes.set(
          inner.id,
          (changes.get(inner.id) ?? 0) + sizes[index] - was,
        );
      }
    });
    for (const [id, change] of changes) {
      const space = own(measured, id)!;
      const available =
        Math.abs(change) < EPSILON
          ? space.available
          : Math.max(0, space.available + change);
      if (own(spaces, id)?.available === available) continue;
      spaces = { ...spaces, [id]: { ...space, available } };
    }
  }
  return spaces;
}

/**
 * The groups in `node` (itself included) that run along `axis`, reached
 * through groups that run across it. In a grid, its tracks that way; in a
 * grid's track, the groups and grids in its cells.
 */
export function runningAlong(
  state: LayoutState,
  node: ChildNode,
  axis: GroupNode["axis"],
): GroupNode[] {
  if (node.kind === "grid") return [tracksAlong(node, axis)];
  if (node.kind === "track") {
    return contentsOn(state, node, axis).flatMap((content) =>
      runningAlong(state, content, axis),
    );
  }
  if (node.kind !== "group") return [];
  if (node.axis === axis) return [node];
  return node.children.flatMap((child) => runningAlong(state, child, axis));
}
