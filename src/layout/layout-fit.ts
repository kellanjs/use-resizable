/**
 * Laying out a layout's groups: fitting a group's committed sizes to the
 * space it has now, with its children within what they can be (see
 * `layout-extents.ts`) and stepped down as the layout's stepping down
 * decides (see `layout-plan.ts`). The rendering and the actions build on
 * these.
 */
import { own } from "../foundation/own.js";
import { resolveSize } from "../foundation/size.js";
import {
  findStop,
  isPoint,
  isRangeStop,
  resolveTrack,
  roomiest,
  within,
} from "../foundation/stops.js";
import type {
  DraggedSeparator,
  LayoutDrag,
  LayoutState,
} from "./layout-config.js";
import {
  type Reading,
  type Steps,
  contextOf,
  fallbackSize,
  heldStop,
  keptSize,
  reachesDown,
  stopNameOf,
  trackOf,
} from "./layout-extents.js";
import {
  type Decision,
  NOTHING_DECIDED,
  decide,
  keepingFirst,
  planOf,
} from "./layout-plan.js";
import {
  type GroupItem,
  fitSizes,
  isStepped,
  moveBoundary,
  settleLastFills,
  shareFills,
  takesSpace,
} from "./solver.js";
import { type ChildNode, type GroupNode, indexTree } from "./tree.js";

// --- Groups -----------------------------------------------------------------

/** The group with this id, or `undefined` (an element, or not in the layout). */
export function groupById(
  state: LayoutState,
  id: string,
): GroupNode | undefined {
  const node = indexTree(state.config.root).nodes.get(id);
  return node?.kind === "group" ? node : undefined;
}

// --- Laying out a group ------------------------------------------------------

/**
 * Sizes for children that aren't in the layout yet. A child starting at a
 * point takes that point's size; otherwise its `defaultSize` if it has one,
 * or else an equal share of what the others leave (on the group's first
 * layout) or of the whole space (when joining an existing layout).
 */
function newcomerSizes(
  state: LayoutState,
  group: GroupNode,
  firstLayout: boolean,
): Map<string, number> {
  const context = contextOf(state, group);
  const available = context.containerSize ?? 0;
  const sizes = new Map<string, number>();
  const unsized: ChildNode[] = [];
  let taken = 0;
  for (const child of group.children) {
    if (own(state.places, child.id)) continue;
    const stop = findStop(
      resolveTrack(child, context),
      stopNameOf(state, child, group),
    );
    if (stop && isPoint(stop)) {
      taken += stop.min;
    } else if (child.defaultSize) {
      const size = resolveSize(child.defaultSize, context) ?? 0;
      sizes.set(child.id, size);
      taken += size;
    } else {
      unsized.push(child);
    }
  }

  const share = firstLayout
    ? Math.max(0, available - taken) / Math.max(1, unsized.length)
    : available / group.children.length;
  for (const child of unsized) sizes.set(child.id, share);
  return sizes;
}

/**
 * A group's committed layout fitted to its space: the heart of every
 * rendering.
 * Children that are `joining` (just added, or back) keep their size while
 * the others make room, `keepSize` ones included once nothing else can
 * (as a child placed by `setStop` does); otherwise space is spread in
 * proportion to size, skipping `keepSize` children. By default, children without a layout entry are the
 * ones joining, unless the whole group is new. Then, if no child is left
 * taking the space, one reopens (see `keepOneTakingSpace`), and a `"last"`
 * fill keeps only what nothing else can take (see `settleLastFills`).
 * Children step down along their `yieldTo` where the layout's plan says
 * (see `planOf`): where its minimums don't fit, this group's or one it's
 * in.
 */
export function fittedItems(
  state: LayoutState,
  group: GroupNode,
  joining?: ReadonlySet<string>,
): GroupItem[] {
  const space = own(state.spaces, group.id);
  const firstLayout = group.children.every(
    (child) => !own(state.places, child.id),
  );
  const newcomers = newcomerSizes(state, group, firstLayout);
  // A nested group needs what its children do at the stops they're
  // stepped down to.
  const plan = space ? planOf(state) : null;
  const decision = plan?.after.get(group.id);
  const steps = decision?.steps;
  const reading = steps ? { steps } : undefined;

  const items = group.children.map((child): GroupItem => {
    const track = trackOf(state, child, group, reading);
    // A stop that's no longer configured falls back to the roomiest one.
    const stop =
      findStop(track, stopNameOf(state, child, group)) ?? roomiest(track);
    const size =
      own(own(state.places, child.id)?.sizes, stop.name) ??
      newcomers.get(child.id) ??
      fallbackSize(state, group, child, stop);
    // Not kept within its stop yet: see below.
    const item = { track, stop: stop.name, size };
    if (child.fill) return { ...item, fill: child.fill };
    const ranked = {
      ...item,
      ...(child.priority !== 0 && { priority: child.priority }),
      ...(child.grow !== null && { grow: child.grow }),
    };
    return child.keepSize ? { ...ranked, keepSize: true } : ranked;
  });

  const repaired = keepOneTakingSpace(state, group, items);
  const kept = steps ? stepped(state, group, repaired, steps) : repaired;
  // Shared out with those keeping their size first that haven't given way
  // kept at it (see `decide`): the items keep their own limits, which are
  // what a drag can do.
  const sharing = decision
    ? keepingFirstAt(state, group, kept, decision)
    : kept;
  const isJoining = (id: string) =>
    joining ? joining.has(id) : !firstLayout && !own(state.places, id);
  const weights = kept.map((item, index) => {
    const { id, keepSize } = group.children[index];
    return keepSize || isJoining(id) ? 0 : item.size;
  });
  // Where they don't fit, the protected child gives way last, as in the
  // call: the others keeping their size have their own sizes saved, not
  // what the call left them (see `keepingSizes`). Where they do, it takes
  // extra space as it otherwise would.
  const short =
    space !== undefined &&
    sharing.reduce((sum, item) => sum + item.size, 0) > space.available;
  // Joining children give way last of all (see `fitSizes`).
  const placed = group.children.flatMap((child, index) =>
    isJoining(child.id) || (short && child.id === state.protectedChild)
      ? [index]
      : [],
  );
  const withinStops = (sized: readonly GroupItem[]) =>
    sharing.map((item, index) => {
      const stop = findStop(item.track, item.stop);
      const size = sized[index].size;
      return { ...item, size: stop ? within(stop, size) : size };
    });
  // Fills of a kind share equally, whatever's left them otherwise (a saved
  // layout, say).
  if (!space) return shareFills(withinStops(kept));
  // Sizes are kept from the space they were laid out in, so they're fitted
  // to this one before they're kept within their stops: a `%` limit is
  // smaller in a smaller space, and keeping to it first would take a share
  // from the child it limits that the others then split. Fitted again
  // after, for what the limits took or freed. Joining children aren't
  // sharing a space they were laid out in: they ask for their size within
  // their stops now, so the others make room for what they can have.
  const fitted = withinStops(
    fitSizes(
      withinStops(sharing).map((item, index) =>
        placed.includes(index) ? item : withoutLimits(sharing[index]),
      ),
      space.available,
      weights,
      placed,
    ),
  );
  // A `"last"` fill's space doesn't go to a locked child, as it doesn't to
  // one that keeps its size: the user's move that freed it (a neighbour
  // collapsing) would resize the locked one.
  const settled = settleLastFills(
    fitSizes(fitted, space.available, weights, placed).map((item, index) =>
      group.children[index].locked ? { ...item, keepSize: true } : item,
    ),
    weights,
  );
  return shareFills(
    settled.map((item, index) => ({
      ...item,
      track: kept[index].track,
      keepSize: kept[index].keepSize,
    })),
  );
}

/**
 * `items` with each child keeping its size first (`keepSize:
 * "yield-first"`) that `decision` didn't have give way held at its size,
 * and each group holding one at what it needs with that: for sharing out
 * a group's space, so the one that gave way gives first.
 */
function keepingFirstAt(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
  decision: Decision,
): GroupItem[] {
  const tree = indexTree(state.config.root);
  const reading: Reading = {
    steps: decision.steps,
    keepsSize: (node) => node.yieldFirst && !decision.relaxed.has(node.id),
  };
  return items.map((item, index) => {
    const child = group.children[index];
    if (!keepingFirst(tree, child).some((node) => reading.keepsSize!(node))) {
      return item;
    }
    // What a group holding one needs with it at its size, in its stop:
    // its minimum raised to that, but not past its own size (a group the
    // user made smaller had those inside give way), nor its maximum.
    const stop = findStop(item.track, item.stop);
    if (!stop) return item;
    const kept =
      reading.keepsSize!(child) && isRangeStop(child, stop.name)
        ? keptSize(state, child, group, stop)
        : 0;
    const inner =
      child.kind === "element"
        ? 0
        : (findStop(trackOf(state, child, group, reading), stop.name)?.min ??
          0);
    const floor = Math.min(
      stop.max,
      Math.max(stop.min, Math.min(Math.max(kept, inner), item.size)),
    );
    return {
      ...item,
      track: item.track.map((each) =>
        each === stop ? { ...each, min: floor } : each,
      ),
    };
  });
}

/**
 * `group`'s own children's `items`, each at the stop `steps` says it's
 * stepped down to (or held down to: see `heldDown`), if that's one its
 * `yieldTo` steps down to from its own: at the size it remembers there.
 * Each says so (`yielded`), with the stop and size it had.
 */
function stepped(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
  steps: Steps,
): GroupItem[] {
  return items.map((item, index) => {
    const child = group.children[index];
    // Where it started: one stepped down already keeps its first stop.
    const start =
      item.yielded && isStepped(item)
        ? item.yielded
        : { from: item.stop, size: item.size };
    const to = steps.get(child.id) ?? heldStop(state, child, start.from);
    if (to === undefined || to === item.stop) return item;
    if (!reachesDown(child, start.from, to)) return item;
    const stop = findStop(item.track, to);
    if (!stop) return item;
    const remembered = own(own(state.places, child.id)?.sizes, to);
    return {
      ...item,
      stop: to,
      size: within(stop, remembered ?? stop.min),
      yielded: { from: start.from, at: to, size: start.size },
    };
  });
}

/**
 * Children stepped down for the space they have: with a group's
 * planned stops (see `planOf`) to start from, the stops its own and its
 * nested children step down to while its minimums don't fit `available`
 * (see `decide`), applied to its children's `items`, with those keeping
 * their size first that didn't give way held at it for sharing the space
 * (see `keepingFirstAt`). For planning a change to it, in a space it's
 * about to have.
 */
export function stepDown(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
  available: number,
): GroupItem[] {
  const imposed = planOf(state).before.get(group.id) ?? NOTHING_DECIDED;
  // The child the call is for counts at the size asked for, so those
  // keeping their size first give way for it too.
  const decision = decide(
    state,
    group,
    available,
    imposed,
    state.protectedChild,
  );
  // What the groups, grids and grid tracks inside need at the stops they
  // step down to: `items` are from the layout before (a call's), with what
  // they needed there.
  const reading = { steps: decision.steps };
  const tracked = items.map((item, index) => {
    const child = group.children[index];
    return child.kind === "element"
      ? item
      : { ...item, track: trackOf(state, child, group, reading) };
  });
  return keepingFirstAt(
    state,
    group,
    stepped(state, group, tracked, decision.steps),
    decision,
  );
}

/**
 * A group's items as a drag in it has them (its separator moved by the
 * pointer, from the layout it began with), or `null` if none is.
 */
export function draggedItems(
  state: LayoutState,
  group: GroupNode,
): GroupItem[] | null {
  const separator = state.drag?.separators.find(
    (entry) => entry.group === group.id,
  );
  if (!separator || !state.drag) return null;
  const delta = dragDelta(state.drag, separator, group);
  return moveBoundary(separator.start, separator.index, delta, {
    elastic: state.config.elastic ?? undefined,
    cascade: state.config.cascade,
    reached: separator.reached,
  });
}

/**
 * How far a drag moves a separator towards its `after` child's side: the
 * pointer's offset along the group's axis, mirrored in a group laid out
 * right to left.
 */
export function dragDelta(
  drag: LayoutDrag,
  separator: DraggedSeparator,
  group: GroupNode,
): number {
  if (group.axis === "vertical") return drag.dy;
  return separator.reversed ? -drag.dx : drag.dx;
}

/**
 * `items` for a move the user makes (a drag, a key): each `locked` child
 * holds its size, as at a point that doesn't stretch, so a cascade passes
 * over it.
 */
export function holdingLocked(
  group: GroupNode,
  items: readonly GroupItem[],
): GroupItem[] {
  return items.map((item, index) => {
    if (!group.children[index]?.locked) return item;
    const stop = findStop(item.track, item.stop);
    return stop
      ? {
          ...item,
          track: [
            {
              ...stop,
              min: item.size,
              max: item.size,
              stretches: { larger: false, smaller: false },
            },
          ],
        }
      : item;
  });
}

/** An item whose range (if it's in one) has no limits, to fit it freely. */
function withoutLimits(item: GroupItem): GroupItem {
  return {
    ...item,
    track: item.track.map((stop) =>
      stop.name === item.stop && !isPoint(stop)
        ? { ...stop, min: 0, max: Infinity }
        : stop,
    ),
  };
}

/**
 * A group always has a child that takes whatever space the others leave
 * (see `takesSpace`). Changes asked for one at a time are refused rather
 * than break that (see `adjustNode`); for one that came some other way
 * (children removed, new options, a restored snapshot, the defaults), the
 * last child with a range that can take it goes there: its last range if
 * that one can, at the size it had.
 */
function keepOneTakingSpace(
  state: LayoutState,
  group: GroupNode,
  items: GroupItem[],
): GroupItem[] {
  if (items.length === 0 || items.some(takesSpace)) return items;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    const child = group.children[index];
    const place = own(state.places, child.id);
    const open = item.track.filter((stop) =>
      takesSpace({ ...item, stop: stop.name }),
    );
    const stop =
      open.find((candidate) => candidate.name === place?.lastRange) ?? open[0];
    if (!stop) continue;
    const size =
      own(place?.sizes, stop.name) ?? fallbackSize(state, group, child, stop);
    return items.map((other, position) =>
      position === index
        ? { ...item, stop: stop.name, size: within(stop, size) }
        : other,
    );
  }
  return items;
}
