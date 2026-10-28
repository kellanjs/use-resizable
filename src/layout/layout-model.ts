/**
 * The layout model: elements sharing space, arranged as a tree of groups
 * (see `tree.ts`). Pure functions over a plain state object; no DOM, no
 * React. Each action takes the current state and returns the next one, or
 * the same object when nothing changes, so the store can skip notifying.
 *
 * The layout is data, passed in the options. Changing it (adding, removing,
 * reordering or regrouping children) is just a new config, and the sizes
 * follow.
 *
 * The state stores the committed layout: each node's stop, and the size in
 * pixels (along its group's axis) it last had in each of its range stops.
 * Nodes that leave keep their entry, so they come back at the size they
 * had. Each group's committed sizes are fitted to the space it has now, or
 * moved by a live drag, and a nested group's children set how small its
 * parent can make it.
 *
 * Nodes in a range are rendered with `flex-grow` proportional to their pixel
 * size, so the browser does the final fill; nodes at a point are their size
 * outright (see `flexPartsOf` and `flexCss` in `layout-rendering.ts`). A
 * group's space is its children's sizes added up, and what its own size has
 * beyond that (separators, gaps, padding) is its overhead, which counts toward
 * its minimum.
 *
 * Elsewhere: the options, config and state shape in `layout-config.ts`;
 * limits in `layout-extents.ts`; stepping down in `layout-plan.ts`;
 * fitting groups to their space in `layout-fit.ts`; how measured
 * spaces pass down through nested groups in `layout-spaces.ts`; how
 * content continues through a change in `layout-content.ts`; what to
 * render in `layout-rendering.ts`; separators as lines, and what they can do,
 * in `separators.ts`; sharing space within a group in `solver.ts`; saving
 * and restoring in `layout-snapshot.ts`.
 */
import type { ChangeCause } from "../foundation/controller-core.js";
import { walkDrag } from "../foundation/drag-path.js";
import type { KeyboardIntent } from "../foundation/keyboard.js";
import { hasOwn, own, setOwn } from "../foundation/own.js";
import {
  type Size,
  type Viewport,
  resolveSize,
  usesViewportUnits,
} from "../foundation/size.js";
import {
  EPSILON,
  checkStop,
  enterTarget,
  findStop,
  isRangeStop,
  land,
  reach,
  reachedStop,
  toggleBack,
  within,
} from "../foundation/stops.js";
import {
  type ChangeKind,
  MIN_MOVE,
  transitionOf,
} from "../foundation/transition.js";
import { warnOnce } from "../foundation/warn.js";
import {
  type ChildPlace,
  type DraggedSeparator,
  type GroupSpace,
  type LayoutConfig,
  type LayoutState,
  MEASURE_EPSILON,
  MOVING_MEASURE_EPSILON,
  inMotion,
  isSeparatorDisabled,
} from "./layout-config.js";
import { holdContent } from "./layout-content.js";
import {
  contextOf,
  fallbackSize,
  homeStop,
  reachesDown,
  stopNameOf,
} from "./layout-extents.js";
import {
  dragDelta,
  fittedItems,
  groupById,
  holdingLocked,
  stepDown,
} from "./layout-fit.js";
import {
  type LayoutRendering,
  currentItems,
  getLayoutRendering,
} from "./layout-rendering.js";
import { passDownChanges, respace, runningAlong } from "./layout-spaces.js";
import {
  type SeparatorSide,
  jumpsFrom,
  linesOf,
  separatorAt,
  separatorMoves,
} from "./separators.js";
import {
  type GroupItem,
  boundaryScale,
  fitSizes,
  isStepped,
  moveBoundary,
  neighbourScale,
  settleLastFills,
  takesSpace,
} from "./solver.js";
import {
  type ChildNode,
  type GroupNode,
  type SeparatorPair,
  gridOfTracks,
  indexTree,
} from "./tree.js";

// --- Saving a group's sizes --------------------------------------------------

/**
 * Writes a group's items back to the layout: each node's stop, and its size
 * as the remembered size of that stop if it's a range.
 *
 * The groups around it first remember the sizes they show. What a group shows
 * is its remembered sizes fitted to its space, and a change in here can
 * change what its children allow it (a child collapsing lowers a nested
 * group's minimum): fitted again from sizes remembered for some other
 * space, children nobody touched would move.
 */
function commitItems(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
  // The groups around it as they're shown: by default, as `state` fits
  // them; a release or a key passes what was on screen before it began
  // changing things (its holds, its other groups).
  shown: (ancestor: GroupNode) => GroupItem[] = (ancestor) =>
    fittedItems(state, ancestor),
): LayoutState {
  const { parents } = indexTree(state.config.root);
  let next = state;
  for (
    let ancestor = parents.get(group.id);
    ancestor;
    ancestor = parents.get(ancestor.id)
  ) {
    if (own(state.spaces, ancestor.id)) {
      next = writeItems(next, ancestor, shown(ancestor));
    }
  }
  return writeItems(next, group, items);
}

/**
 * Writes one group's items to the layout, as
 * they're shown: a `"last"` fill keeps only what nothing else (but a
 * locked child) can take.
 * Each child's entry records its stop, its size as that stop's remembered
 * size if it's a range, the last range it was in (where a toggle goes
 * back to), and the stop it came from (`from`).
 */
function writeItems(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
): LayoutState {
  const places: Record<string, ChildPlace> = { ...state.places };
  // As `fittedItems` settles them: a locked child doesn't take a `"last"`
  // fill's space, so what's written is fitted back to what was shown.
  const settled = settleLastFills(
    items.map((item, index) =>
      group.children[index]?.locked ? { ...item, keepSize: true } : item,
    ),
  );
  settled.forEach((item, index) => {
    const node = group.children[index];
    const previous = own(state.places, node.id);
    // Stepped down to fit (see `stepDown`), and not moved on from there:
    // what's written is the stop chosen for it, which stays as it was
    // unless a call just asked for it (`chosen`), and the size it has
    // where it's shown is remembered there.
    const { yielded } = item;
    const stepped = yielded !== undefined && isStepped(item);
    if (stepped && !yielded.chosen) {
      const chosen = previous ?? placeAt(node, yielded.from, yielded.size);
      setOwn(
        places,
        node.id,
        isRangeStop(node, item.stop)
          ? { ...chosen, sizes: { ...chosen.sizes, [item.stop]: item.size } }
          : chosen,
      );
      return;
    }
    const { stop, size } = stepped
      ? { stop: yielded.from, size: yielded.size }
      : item;
    const before = previous?.stop ?? stopNameOf(state, node, group);
    const inRange = isRangeStop(node, stop);
    let entry: ChildPlace = {
      stop,
      sizes: inRange
        ? { ...previous?.sizes, [stop]: size }
        : (previous?.sizes ?? {}),
      lastRange: inRange
        ? stop
        : before !== stop && isRangeStop(node, before)
          ? before
          : (previous?.lastRange ?? null),
    };
    if (stepped && isRangeStop(node, item.stop)) {
      entry = { ...entry, sizes: { ...entry.sizes, [item.stop]: item.size } };
    }
    const from = before !== stop ? before : previous?.from;
    if (from) entry = { ...entry, from };
    setOwn(places, node.id, entry);
  });
  return { ...state, places };
}

/** A fresh place for `node` at `stop`, remembering `size` if it's a range. */
function placeAt(node: ChildNode, stop: string, size: number): ChildPlace {
  const inRange = isRangeStop(node, stop);
  return {
    stop,
    sizes: inRange ? { [stop]: size } : {},
    lastRange: inRange ? stop : null,
  };
}

// --- Measuring ---------------------------------------------------------------

/** The root font size changed, so `rem` sizes resolve differently. */
export function setRootFontSize(
  state: LayoutState,
  rootFontSize: number,
): LayoutState {
  return measure(state, withEverySpace(state, { rootFontSize }));
}

/** The viewport changed, so `vw` and `vh` sizes resolve differently. */
export function setViewport(
  state: LayoutState,
  viewport: Viewport,
): LayoutState {
  return measure(state, withEverySpace(state, { viewport }));
}

/**
 * Whether a size in the options is in `vw` or `vh`. (A layout keeps the
 * sizes it's given in pixels, so `setSize` reads the viewport only as it
 * lands: see `withViewportFor`.)
 */
export function usesViewport(state: LayoutState): boolean {
  return usesViewportUnits(state.config);
}

/** Every group's measured space, with `change` made. */
function withEverySpace(
  state: LayoutState,
  change: Partial<GroupSpace>,
): Record<string, GroupSpace> {
  return Object.fromEntries(
    Object.entries(state.spaces).map(([id, space]) => [
      id,
      { ...space, ...change },
    ]),
  );
}

function sameBases(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
  epsilon: number,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Math.abs(a[key] - (own(b, key) ?? 0)) < epsilon)
  );
}

function sameBetween(
  a: readonly number[] = [],
  b: readonly number[] = [],
  epsilon: number,
): boolean {
  return (
    a.length === b.length &&
    a.every((size, index) => Math.abs(size - b[index]) < epsilon)
  );
}

/**
 * Whether `space` is `current` resized, and nothing else: the same
 * overheads, children with padding or a border (`bases`, `basisOffsets`)
 * and units, just sizes moved.
 */
function onlyResized(
  current: GroupSpace,
  space: GroupSpace,
  epsilon: number,
): boolean {
  const sameKeys = (
    a: Readonly<Record<string, number>>,
    b: Readonly<Record<string, number>>,
  ) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => hasOwn(b, key));
  return (
    Math.abs(current.overhead - space.overhead) < epsilon &&
    Math.abs(current.crossOverhead - space.crossOverhead) < epsilon &&
    sameKeys(current.bases, space.bases) &&
    sameKeys(current.basisOffsets, space.basisOffsets) &&
    current.rootFontSize === space.rootFontSize &&
    current.viewport?.width === space.viewport?.width &&
    current.viewport?.height === space.viewport?.height
  );
}

/**
 * Records measurements for any number of groups. A group's first
 * measurement fixes its starting layout, so defaults resolve against the
 * space its children actually got.
 */
export function measure(
  state: LayoutState,
  spaces: Readonly<Record<string, GroupSpace>>,
): LayoutState {
  let next = state;
  const changed = new Set<string>();
  // Kept exactly, but for the browser's rounding while children move (see
  // `MOVING_MEASURE_EPSILON`).
  const epsilon = inMotion(state) ? MOVING_MEASURE_EPSILON : MEASURE_EPSILON;
  // While a change animates, the groups it resizes already have the space
  // they're going to (see `passDownChanges`); measuring them on the way
  // would retarget their children on every frame, out of step, and lay out
  // their content each time. They're measured again once it ends. What
  // isn't the animation's doing (a separator added, the root font size)
  // still counts at once.
  const settling =
    state.animating && !state.drag && transitionOf(state) !== null;
  for (const [id, space] of Object.entries(spaces)) {
    const current = own(next.spaces, id);
    if (current && settling && onlyResized(current, space, epsilon)) continue;
    if (
      current &&
      Math.abs(current.available - space.available) < epsilon &&
      Math.abs(current.overhead - space.overhead) < epsilon &&
      Math.abs(current.crossOverhead - space.crossOverhead) < epsilon &&
      sameBases(current.bases, space.bases, epsilon) &&
      sameBases(current.basisOffsets, space.basisOffsets, epsilon) &&
      sameBetween(current.between, space.between, epsilon) &&
      current.rootFontSize === space.rootFontSize &&
      current.viewport?.width === space.viewport?.width &&
      current.viewport?.height === space.viewport?.height
    ) {
      continue;
    }
    next = { ...next, spaces: { ...next.spaces, [id]: space } };
    changed.add(id);
  }
  if (next === state) return state;

  // A drag in a group whose space changed (the window resized under it)
  // carries on from its committed layout fitted to the new space.
  if (next.drag) {
    const measured = next;
    const separators = next.drag.separators.map((separator) => {
      const group = groupById(measured, separator.group);
      return group && changed.has(group.id)
        ? {
            ...separator,
            start: holdingLocked(group, fittedItems(measured, group)),
          }
        : separator;
    });
    next = rebased(next, separators);
  }

  // A group's space changing is a change from elsewhere for its children
  // (see `heldDown`): the room they'd step back up into is new. Not for
  // those of a group whose space didn't (another drag's, say), and the
  // browser's echo of a change the layout made (a fraction off) isn't one.
  const resized = new Set(
    [...changed].filter(
      (id) =>
        Math.abs(
          own(next.spaces, id)!.available -
            (own(state.spaces, id)?.available ?? Number.NEGATIVE_INFINITY),
        ) >= 1,
    ),
  );
  if (resized.size > 0 && next.heldDown) {
    const { parents } = indexTree(next.config.root);
    const held = Object.entries(next.heldDown).filter(
      ([id]) => !resized.has(parents.get(id)?.id ?? ""),
    );
    next = {
      ...next,
      heldDown: held.length > 0 ? Object.fromEntries(held) : null,
    };
  }
  // A group the protected child is in getting less room (the window
  // narrowing, say) is a change from elsewhere too: the call has had its
  // turn, and the order the options give decides again. More room doesn't
  // end it, or a wider window could close what the call opened, for
  // something it had closed to come back (see `protectedChild`).
  if (next.protectedChild !== null && resized.size > 0) {
    const shrunk = (id: string) =>
      resized.has(id) &&
      own(next.spaces, id)!.available <
        (own(state.spaces, id)?.available ?? Number.NEGATIVE_INFINITY);
    const { parents } = indexTree(next.config.root);
    for (
      let group = parents.get(next.protectedChild);
      group;
      group = parents.get(group.id)
    ) {
      if (shrunk(group.id)) {
        next = { ...next, protectedChild: null };
        break;
      }
    }
  }
  return {
    ...layOutUnlaid(next),
    // Measurement changes follow the layout; animating them would lag. But
    // what gets through while a change animates (a separator added, the
    // root font size: resizes wait, see `onlyResized`) is part of what it
    // animates to, so its timing stays.
    animate: state.animating ? state.animate : null,
  };
}

/**
 * Gives every measured group with children not laid out yet their starting
 * sizes. Parents come first, so a nested group is laid out in the space its
 * parent gave it.
 *
 * With `rendered` (the rendering the measurements came from), a parent
 * laid out anew passes the change in its children's sizes down to the
 * groups inside them (see `passDownChanges`). Without it, the measured
 * spaces are taken as current.
 */
function layOutUnlaid(
  state: LayoutState,
  rendered?: LayoutRendering,
): LayoutState {
  let next = state;
  for (const group of indexTree(next.config.root).groups) {
    const unlaid = group.children.some((child) => !own(next.places, child.id));
    if (own(next.spaces, group.id) && unlaid) {
      const items = fittedItems(next, group);
      next = rendered
        ? commitAndPassDown(next, group, items, rendered)
        : commitItems(next, group, items);
    }
  }
  // And the groups around them (see `respace`).
  return rendered ? respace(next, state.spaces, rendered) : next;
}

/**
 * Commits `items` as `group`'s layout, and passes the change down to the
 * groups inside it (see `passDownChanges`): every change that lays a group
 * out anew goes through here, so none leaves the groups inside behind.
 */
function commitAndPassDown(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
  rendered: LayoutRendering,
  committedLater: ReadonlySet<string> = new Set(),
  shown?: (ancestor: GroupNode) => GroupItem[],
): LayoutState {
  const committed = commitItems(state, group, items, shown);
  return passDownChanges(
    committed,
    group,
    // As they're shown: in a group past its space, squeezed to their
    // minimums, whatever's committed.
    fittedItems(committed, group),
    rendered,
    committedLater,
  );
}

// --- New options -------------------------------------------------------------

/**
 * Applies new options. In each group, children that joined get their size
 * now (the others make room), so the layout always covers every child;
 * nodes that left keep their entry for when they come back.
 */
export function setConfig(
  state: LayoutState,
  config: LayoutConfig,
): LayoutState {
  const previous = indexTree(state.config.root);
  const next = indexTree(config.root);

  // A drag survives only if every group it touches is unchanged.
  const dragValid = state.drag?.separators.every((separator) => {
    const group = next.nodes.get(separator.group);
    return group?.kind === "group" && sameIds(childIds(group), separator.ids);
  });

  // Dropped under the options it was made with, which its groups are in.
  const kept = dragValid ? state : withoutDrag(state);
  let result: LayoutState = {
    ...kept,
    config,
    // Options passed again mid-animation (they're passed every render)
    // mustn't cut it short.
    animate: state.animating ? state.animate : null,
    // New options are a change from elsewhere (see `heldDown` and
    // `protectedChild`).
    heldDown: null,
    protectedChild: null,
  };
  let changed = false;
  let removed = false;
  // The groups whose children changed, to lay out again.
  const refits = next.groups.flatMap((group) => {
    const before = previous.nodes.get(group.id);
    if (before?.kind !== "group" || !own(state.spaces, group.id)) return [];
    // "Joining" means not in this group a moment ago, even if the node has an
    // old size in the layout.
    const was = new Set(childIds(before));
    const ids = childIds(group);
    const joining = new Set(ids.filter((id) => !was.has(id)));
    const left = [...was].some((id) => !ids.includes(id));
    // Reordered: the same children, laid out again in their new order.
    const moved = !sameIds(childIds(before), ids);
    if (joining.size === 0 && !left && !moved) return [];
    return [{ group, joining, left }];
  });
  // Parents come first; a nested group laid out after its parent changed
  // gets the space it's about to have (see `passDownChanges`). One that's
  // laid out again itself passes its own changes down when its turn comes,
  // or they'd count twice.
  const rendered = getLayoutRendering(kept);
  const refitted = new Set(refits.map(({ group }) => group.id));
  for (const { group, joining, left } of refits) {
    const items = fittedItems(result, group, joining);
    result = commitAndPassDown(result, group, items, rendered, refitted);
    changed = true;
    removed ||= left;
  }
  // And the groups around them: a child that joined, or a limit changed,
  // may need more than its group has (see `respace`).
  result = respace(result, kept.spaces, rendered);
  // A drag goes on in a group whose children's options changed (a limit,
  // a lock) from its layout under the new ones, as when its space changes
  // (see `measure`), rather than keep the old ones to its release.
  if (result.drag) {
    const configured = result;
    const separators = result.drag.separators.map((separator) => {
      const was = previous.nodes.get(separator.group);
      const group = groupById(configured, separator.group);
      return group && JSON.stringify(was) !== JSON.stringify(group)
        ? {
            ...separator,
            start: holdingLocked(group, fittedItems(configured, group)),
          }
        : separator;
    });
    result = rebased(result, separators);
    // And the groups inside get the space the drag gives them from there.
    result = respace(result, kept.spaces, rendered);
  }
  if (!changed) return result;
  // Children added or moved animate: one that joins grows from 0 (it
  // renders at 0 before the options reach here), so the shares always add
  // up and every other child stays its size on the way. One that left is
  // gone already, and the others easing into its space would be drawn off
  // their sizes meanwhile, so a removal is instant (to animate one out,
  // send it to a stop at 0 first).
  return { ...result, animate: removed ? null : "children" };
}

const childIds = (group: GroupNode) => group.children.map((child) => child.id);

/**
 * What new options changed, for `onChange`: `children` if they added,
 * removed or reordered any, else `options`.
 */
export function optionsCause(
  before: LayoutState,
  after: LayoutState,
): ChangeCause {
  return structureOf(before.config.root) === structureOf(after.config.root)
    ? "options"
    : "children";
}

/**
 * A node's ids, nested as its tree is, as a string to compare. Each id is
 * quoted (as JSON), so none can pass for the punctuation between them (a
 * child `"a,b"` for two, `"a"` and `"b"`).
 */
function structureOf(node: ChildNode): string {
  const id = JSON.stringify(node.id);
  if (node.kind === "grid") {
    const cells = node.cells.map(
      (cell) =>
        `${JSON.stringify(cell.id)}@${cell.column}+${cell.columnSpan},${cell.row}+${cell.rowSpan}` +
        // And the children of a group (or a grid) in it.
        (cell.content ? `:${structureOf(cell.content)}` : ""),
    );
    return `${id}[${structureOf(node.columns)};${structureOf(node.rows)};${cells.join(",")}]`;
  }
  return node.kind === "group"
    ? `${id}(${node.children.map(structureOf).join(",")})`
    : id;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// --- Dragging ----------------------------------------------------------------

/**
 * Starts dragging the separators between each `before`/`after` pair: one
 * for a separator, several for a junction. Pairs that aren't neighbours in
 * a measured group are ignored, and so is a pair that moves the same space
 * as one before it (see `shareSpace`), which would fight it. `reversed`
 * says which groups lay out right to left (read from the page's CSS).
 */
export function startDrag(
  state: LayoutState,
  pairs: readonly SeparatorPair[],
  reversed: (group: string) => boolean = () => false,
  shown?: (id: string, axis: GroupNode["axis"]) => number | undefined,
): LayoutState {
  if (state.config.disabled || state.drag) return state;
  const separators: DraggedSeparator[] = linesOf(state, pairs).map(
    ({ group, index }) => ({
      group: group.id,
      index,
      ids: group.children.map((child) => child.id),
      start: holdingLocked(group, startItems(state, group, shown)),
      reversed: group.axis === "horizontal" && reversed(group.id),
    }),
  );
  if (separators.length === 0) return state;
  return {
    ...holdContent(
      state,
      state,
      state.animating && shown ? shownSizes(state, shown) : undefined,
    ),
    drag: {
      separators,
      grabbed: pairs,
      dx: 0,
      dy: 0,
      steppedDown: shownSteppedDown(state),
    },
  };
}

/**
 * The sizes children are shown at mid-animation (`shown`, measured), by
 * id: those of each group whose children together fill the same space as
 * the layout's, so they're what's on screen (not, say, before they're
 * rendered).
 */
export function shownSizes(
  state: LayoutState,
  shown: (id: string, axis: GroupNode["axis"]) => number | undefined,
): ReadonlyMap<string, number> {
  const sizes = new Map<string, number>();
  for (const group of indexTree(state.config.root).groups) {
    if (!own(state.spaces, group.id)) continue;
    const measured = measuredFilling(group, shown, () =>
      fittedItems(state, group),
    );
    if (!measured) continue;
    group.children.forEach((child, index) =>
      sizes.set(child.id, measured[index]),
    );
  }
  return sizes;
}

/**
 * `group`'s children's sizes as `shown` measures them, if every one is
 * measured and together they fill the same space as its `items` (to a
 * pixel): then they're what's on screen (not, say, before they're
 * rendered). Else `null`.
 */
function measuredFilling(
  group: GroupNode,
  shown: (id: string, axis: GroupNode["axis"]) => number | undefined,
  items: () => readonly GroupItem[],
): number[] | null {
  const sizes = group.children.map((child) => shown(child.id, group.axis));
  if (!sizes.every((size): size is number => size !== undefined)) return null;
  const filled = totalOf(items().map((item) => item.size));
  return Math.abs(totalOf(sizes) - filled) < 1 ? sizes : null;
}

const totalOf = (sizes: readonly number[]) =>
  sizes.reduce((sum, size) => sum + size, 0);

/**
 * Where a drag in `group` starts. Mid-animation, the children are on their
 * way somewhere: it starts from the sizes they're shown at (`shown`,
 * measured), not where they're going, so the separator stays under the
 * pointer.
 */
function startItems(
  state: LayoutState,
  group: GroupNode,
  shown?: (id: string, axis: GroupNode["axis"]) => number | undefined,
): GroupItem[] {
  const items = fittedItems(state, group);
  if (!state.animating || !shown) return items;
  const sizes = measuredFilling(group, shown, () => items);
  if (!sizes) return items;
  const filled = totalOf(items.map((item) => item.size));
  // A child caught between stops (closing, say) can't rest there: it goes
  // to the nearer one, and the others fill the space around it.
  let between = false;
  const caught = items.map((item, index) => {
    const size = sizes[index];
    const landing = land(item.track, size, item.stop);
    if (Math.abs(landing.size - size) > MIN_MOVE) between = true;
    return { ...item, ...landing };
  });
  if (!between) return caught;
  const weights = caught.map((item, index) =>
    item.size === sizes[index] ? item.size : 0,
  );
  return fitSizes(caught, filled, weights);
}

/**
 * A separator or junction came under a mouse or pen (its pairs), or
 * (`null`) nothing is.
 */
export function hover(
  state: LayoutState,
  pairs: readonly SeparatorPair[] | null,
): LayoutState {
  return state.hovered === pairs ? state : { ...state, hovered: pairs };
}

/** `dx`, `dy`: the pointer's total offset since the drag started. */
export function moveDrag(
  state: LayoutState,
  dx: number,
  dy: number,
): LayoutState {
  const { drag } = state;
  if (!drag || (drag.dx === dx && drag.dy === dy)) return state;
  // A fast move mustn't skip a stop that ends the drag.
  const moved = walkDrag(
    state,
    drag,
    dx,
    dy,
    [...indexTree(state.config.root).nodes.values()].some(
      (node) =>
        node.kind !== "cell" && node.stops.some((stop) => stop.endsDrag),
    ),
    (x, y) => ({ ...state, drag: { ...drag, dx: x, dy: y } }),
    landedOnDragEnd,
    changedStop,
  );
  if (!moved.ended) return passDownDrag(state, withReached(state, moved.state));
  // Children that arrived in a range that ends drags go there as
  // `setChildStop` would: from the layout before the drag, at the size they
  // had there, their siblings making room. Where the pointer was is just
  // past the range's edge, not a size anyone chose. Otherwise (or if that's
  // refused), the drag is released where it landed.
  const { nodes } = indexTree(state.config.root);
  const opened = arrivals(state, moved.state).reduce((next, { id, stop }) => {
    const node = nodes.get(id);
    return node && "stops" in node && isRangeStop(node, stop)
      ? adjustNode(next, id, "drag", toStop(next, stop, false))
      : next;
  }, moved.state);
  return opened.drag ? endDrag(moved.state) : opened;
}

/**
 * Mid-drag, the groups inside the dragged ones get the space they're about
 * to have, as they do on release (see `endDrag`). Otherwise the browser
 * would lay them out by their old sizes first (flexbox sharing out their
 * new space in proportion, `keepSize` children too), and again once
 * they're measured: twice a frame. Their measurements then match, and
 * change nothing (see `measure`).
 */
function passDownDrag(before: LayoutState, after: LayoutState): LayoutState {
  const { drag } = after;
  if (!drag) return after;
  // (The last move's view, already worked out.)
  const rendered = getLayoutRendering(before);
  // A dragged group inside another is laid out from its own drag.
  const dragged = new Set(drag.separators.map((separator) => separator.group));
  let next = after;
  for (const id of outermostFirst(after, [...dragged])) {
    const group = groupById(next, id);
    if (!group) continue;
    // Just this group's sizes for the move, not the whole layout's.
    next = passDownChanges(
      next,
      group,
      currentItems(after, group),
      rendered,
      dragged,
    );
  }
  return next;
}

/**
 * Records the stop the pointer last reached for the two children beside
 * each dragged separator, over the move from `previous` to `moved` (see
 * `reachedStop`).
 */
function withReached(previous: LayoutState, moved: LayoutState): LayoutState {
  const { drag } = moved;
  const was = previous.drag;
  if (!drag || !was) return moved;
  const separators = drag.separators.map((separator) => {
    const group = groupById(moved, separator.group);
    if (!group) return separator;
    // What the pointer asks of each neighbour (see `boundaryScale`).
    const scale = boundaryScale(separator.start, separator.index);
    const from = dragDelta(was, separator, group) * scale;
    const to = dragDelta(drag, separator, group) * scale;
    const beforeStart = separator.start[separator.index];
    const afterStart = separator.start[separator.index + 1];
    return {
      ...separator,
      reached: {
        before: reachedStop(
          beforeStart.track,
          separator.reached?.before ?? null,
          beforeStart.size + from,
          beforeStart.size + to,
          beforeStart.stop,
        ),
        after: reachedStop(
          afterStart.track,
          separator.reached?.after ?? null,
          afterStart.size - from,
          afterStart.size - to,
          afterStart.stop,
        ),
      },
    };
  });
  return { ...moved, drag: { ...drag, separators } };
}

/**
 * Whether the move from `previous` to `moved` landed a dragged child in a
 * stop with `endsDrag`.
 */
function landedOnDragEnd(previous: LayoutState, moved: LayoutState): boolean {
  return arrivals(previous, moved).length > 0;
}

/** Whether the move landed a dragged child in another stop. */
function changedStop(previous: LayoutState, moved: LayoutState): boolean {
  return (moved.drag?.separators ?? []).some((separator) => {
    const group = groupById(moved, separator.group);
    if (!group) return false;
    const was = currentItems(previous, group);
    return currentItems(moved, group).some(
      (item, index) => item.stop !== was[index]?.stop,
    );
  });
}

/** The dragged children a move landed in a stop with `endsDrag`. */
function arrivals(
  previous: LayoutState,
  moved: LayoutState,
): { id: string; stop: string }[] {
  return (moved.drag?.separators ?? []).flatMap((separator) => {
    const group = groupById(moved, separator.group);
    if (!group) return [];
    const was = currentItems(previous, group);
    return currentItems(moved, group).flatMap((item, index) =>
      item.stop !== was[index]?.stop &&
      findStop(item.track, item.stop)?.endsDrag
        ? [{ id: group.children[index].id, stop: item.stop }]
        : [],
    );
  });
}

/**
 * Whether a key on the separator between `before` and `after` does
 * anything: it can move (see `separatorMoves`), or Enter toggles its
 * `primary` neighbour (which can reach a stop only a name reaches). For
 * `aria-disabled`; a press needs it to move.
 */
export function separatorAnswersKeys(
  state: LayoutState,
  before: string,
  after: string,
  primary: SeparatorSide = "before",
): boolean {
  if (separatorMoves(state, before, after)) return true;
  if (!state.config.keyboard) return false;
  return (
    applyKeyboard(state, before, after, { kind: "toggle" }, primary) !== state
  );
}

/**
 * Each child shown stepped down to fit, by id, at the stop it's shown in
 * (see `heldDown`), or `null` if none is.
 */
function shownSteppedDown(
  state: LayoutState,
): Readonly<Record<string, string>> | null {
  const held: Record<string, string> = {};
  for (const [id, node] of getLayoutRendering(state).nodes) {
    if (node.yieldedFrom !== null && node.stop !== null) {
      setOwn(held, id, node.stop);
    }
  }
  return Object.keys(held).length > 0 ? held : null;
}

/**
 * `state` with its drag carrying on from `separators` (those whose layout
 * it began with was laid out anew: the space changed, or the options),
 * and with what's stepped down there as what it began with (see
 * `steppedDown`): it's the drag's start now.
 */
function rebased(
  state: LayoutState,
  separators: readonly DraggedSeparator[],
): LayoutState {
  const { drag } = state;
  if (!drag || separators.every((s, i) => s === drag.separators[i])) {
    return state;
  }
  return {
    ...state,
    drag: {
      ...drag,
      separators,
      steppedDown: shownSteppedDown({ ...state, drag: null }),
    },
  };
}

/**
 * Those of `steppedDown` (by id, at stops) still shown stepped down in
 * `state`, at the stops they're shown in, or `null` if none are: no
 * further down than they began, as further, the stretch may have taken
 * them, and what's laid out from here is without it (and steps them down
 * again where it has to).
 */
function stillSteppedDown(
  state: LayoutState,
  steppedDown: Readonly<Record<string, string>> | null,
): Readonly<Record<string, string>> | null {
  if (!steppedDown) return null;
  const now = shownSteppedDown(state);
  if (!now) return null;
  const { nodes } = indexTree(state.config.root);
  const held = Object.fromEntries(
    Object.entries(now)
      .filter(([id]) => hasOwn(steppedDown, id))
      .map(([id, stop]) => {
        const node = nodes.get(id);
        const began = own(steppedDown, id)!;
        return [
          id,
          node?.kind !== "cell" && node && reachesDown(node, began, stop)
            ? began
            : stop,
        ];
      }),
  );
  return Object.keys(held).length > 0 ? held : null;
}

/**
 * Releases the drag: each dragged group keeps where the pointer left it,
 * without the elastic stretch (the transition animates the rest).
 */
export function endDrag(state: LayoutState): LayoutState {
  const { drag } = state;
  if (!drag) return state;
  let next: LayoutState = {
    ...state,
    drag: null,
    // Children stepped down from its start to its end stay so (see
    // `heldDown`), in what's laid out from here.
    heldDown: stillSteppedDown(state, drag.steppedDown),
  };
  // Outermost first, each passing the space its children are about to
  // have (without the stretch) to the groups inside them, so a group
  // inside, saved next, has its parents remember what they'll show.
  const rendered = getLayoutRendering(state);
  const order = outermostFirst(
    state,
    drag.separators.map((separator) => separator.group),
  );
  const separators = [...drag.separators].sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group),
  );
  // A dragged group inside another is laid out from its own drag, not
  // from what the outer one passes down.
  const dragged = new Set(drag.separators.map((separator) => separator.group));
  // Settled without the elastic stretch; the transition animates the
  // release.
  const settle = (separator: DraggedSeparator, group: GroupNode) =>
    moveBoundary(
      separator.start,
      separator.index,
      dragDelta(drag, separator, group),
      { cascade: state.config.cascade },
    );
  // The groups inside the children it resized were resized too, and
  // remember what it showed them (without the stretch), as the groups
  // around it do: a child keeping its size in there keeps the size it was
  // shown, not the one it had before, and doesn't claim that back. First,
  // so laying out the dragged groups doesn't count on what they had.
  let showing = state;
  for (const separator of separators) {
    const group = groupById(state, separator.group);
    if (!group) continue;
    showing = passDownChanges(
      showing,
      group,
      settle(separator, group),
      rendered,
      dragged,
    );
  }
  for (const inner of resizedInside(state, separators, settle)) {
    if (own(showing.spaces, inner.id)) {
      next = writeItems(next, inner, fittedItems(showing, inner));
    }
  }
  for (const separator of separators) {
    const group = groupById(state, separator.group);
    if (!group) continue;
    // The groups around it as the drag showed them, in the spaces passed
    // down so far (without the stretch), and the dragged ones settled:
    // what the release keeps, not what they'd be with its holds and the
    // other groups' new stops partly in place.
    const before: LayoutState = { ...state, drag: null, spaces: next.spaces };
    const shown = (ancestor: GroupNode) => {
      const outer = drag.separators.find(
        (entry) => entry.group === ancestor.id,
      );
      return outer ? settle(outer, ancestor) : fittedItems(before, ancestor);
    };
    next = commitAndPassDown(
      next,
      group,
      settle(separator, group),
      rendered,
      dragged,
      shown,
    );
  }
  // And the groups around them (see `respace`).
  return {
    ...respace(next, state.spaces, rendered),
    animate: "drag",
  };
}

/**
 * The groups inside the children a drag resized (from where it started to
 * `settle`d), and inside theirs, but for those it drags itself: those are
 * saved from their own separators.
 */
function resizedInside(
  state: LayoutState,
  separators: readonly DraggedSeparator[],
  settle: (separator: DraggedSeparator, group: GroupNode) => GroupItem[],
): GroupNode[] {
  const dragged = new Set(separators.map((separator) => separator.group));
  const inside = new Map<string, GroupNode>();
  const reach = (child: ChildNode, axis: GroupNode["axis"]) => {
    for (const inner of runningAlong(state, child, axis)) {
      if (dragged.has(inner.id) || inside.has(inner.id)) continue;
      inside.set(inner.id, inner);
      for (const grandchild of inner.children) reach(grandchild, inner.axis);
    }
  };
  for (const separator of separators) {
    const group = groupById(state, separator.group);
    if (!group) continue;
    const settled = settle(separator, group);
    group.children.forEach((child, index) => {
      const was = separator.start[index]?.size;
      const now = settled[index]?.size;
      if (was == null || now == null || Math.abs(now - was) < EPSILON) return;
      reach(child, group.axis);
    });
  }
  return [...inside.values()];
}

/**
 * `state` with `places` laid out at once, as restoring a snapshot does: any
 * drag dropped (see `withoutDrag`), and each group inside given the space
 * its parent now gives it (with `protectedChild` protected, as the new
 * layout has it). A call straight after (a `setSize`, say) then
 * plans from the restored layout, rather than one the browser hasn't
 * measured yet.
 */
export function withPlaces(
  state: LayoutState,
  places: LayoutState["places"],
  protectedChild = state.protectedChild,
): LayoutState {
  const dropped = withoutDrag(state);
  return respace(
    { ...dropped, places, protectedChild, heldDown: null },
    dropped.spaces,
    getLayoutRendering(dropped),
  );
}

/** Group ids, sorted so that a group comes before the groups inside it. */
function outermostFirst(state: LayoutState, ids: readonly string[]): string[] {
  const { parents } = indexTree(state.config.root);
  const depth = (id: string) => {
    let count = 0;
    for (let at = parents.get(id); at; at = parents.get(at.id)) count++;
    return count;
  };
  return [...ids].sort((a, b) => depth(a) - depth(b));
}

/** Escape: the drag ends, and the layout goes back to where it started. */
export function cancelDrag(state: LayoutState): LayoutState {
  if (!state.drag) return state;
  return { ...withoutDrag(state), animate: "drag" };
}

/**
 * `state` with its drag dropped, as Escape drops it: the groups inside the
 * dragged ones get back the space they had (a drag gives them its own as
 * it goes; see `passDownDrag`). Everything that drops a drag goes through
 * here, so what it does next starts from spaces that match the layout.
 * Changes made after are then passed down from this state's rendering,
 * not the drag's, or the drag's would count twice.
 */
export function withoutDrag(state: LayoutState): LayoutState {
  const { drag } = state;
  if (!drag) return state;
  const rendered = getLayoutRendering(state);
  // A dragged group inside another gives its own changes back.
  const dragged = new Set(drag.separators.map((separator) => separator.group));
  let next: LayoutState = { ...state, drag: null };
  for (const id of outermostFirst(state, [...dragged])) {
    const group = groupById(next, id);
    if (!group) continue;
    next = passDownChanges(
      next,
      group,
      fittedItems(next, group),
      rendered,
      dragged,
    );
  }
  return next;
}

// --- Stops and sizes from code -----------------------------------------------

/** A change asked of one node, before its siblings make room. */
interface Adjustment {
  /** Its group. */
  group: GroupNode;
  /** The state without a live drag, which the change drops. */
  committed: LayoutState;
  /**
   * The group's items as shown, at the stops chosen for them: a sibling
   * stepped down to fit counts as what was chosen, for the rule that
   * something takes the space (see `isRefused`).
   */
  chosen: GroupItem[];
  /** `chosen` with the change made to the node, at `index`. */
  next: GroupItem[];
  index: number;
}

/** An item stepped down to fit, back at the stop chosen for it. */
function chosenItem(
  state: LayoutState,
  id: string,
  item: GroupItem,
): GroupItem {
  if (!item.yielded || !isStepped(item)) return item;
  const { yielded, ...rest } = item;
  const stop = findStop(item.track, yielded.from);
  // At the size it had there: squeezed to fit, it'd come back smaller.
  const had = own(own(state.places, id)?.sizes, yielded.from) ?? yielded.size;
  return {
    ...rest,
    stop: yielded.from,
    size: stop ? within(stop, had) : had,
  };
}

/**
 * The change `change` asks of node `id` (mapping its current item to its
 * new one), or `null` if there's no such node or it changes nothing.
 * Planned from the layout as shown, so its siblings keep the sizes they
 * have between them: the node itself, if it's stepped down to fit, is
 * planned from the stop chosen for it, which the call changes (so asking
 * for that stop again shows it, and is a change, unless it's protected
 * already and still can't be shown).
 */
function planAdjustment(
  state: LayoutState,
  id: string,
  change: (item: GroupItem, node: ChildNode, group: GroupNode) => GroupItem,
): Adjustment | null {
  const group = indexTree(state.config.root).parents.get(id);
  if (!group) return null;

  // From the committed layout: a live drag is dropped (as `useResizable`
  // drops one), since the change was asked for over it.
  const committed = withoutDrag(state);
  const index = group.children.findIndex((child) => child.id === id);
  // A group or grid in a cell: its size is its tracks'.
  if (index === -1) return null;
  const shown = fittedItems(committed, group);
  const stepped = isStepped(shown[index]);
  // Locked siblings keep their size while any other can give (as with
  // `keepSize`); the child itself can move.
  const items = shown.map((item, position) =>
    position === index
      ? chosenItem(committed, id, item)
      : group.children[position].locked
        ? { ...item, keepSize: true }
        : item,
  );
  const changed = change(items[index], group.children[index], group);
  if (
    changed.size === items[index].size &&
    changed.stop === items[index].stop &&
    !(stepped && committed.protectedChild !== id)
  ) {
    return null;
  }
  // Siblings stepped down to fit are planned from the stops chosen for
  // them too, so the change steps them down again only if it still needs
  // to: one it frees room for steps back up, in the plan as it will when
  // drawn. Those that fit keep their sizes between them.
  const chosen = items.map((item, position) =>
    position === index
      ? item
      : chosenItem(committed, group.children[position].id, item),
  );
  const next = chosen.map((item, position) =>
    position === index ? changed : item,
  );
  return { group, committed, next, index, chosen };
}

/**
 * Whether a change leaves nothing to take its group's space (the browser
 * would stretch the others past their sizes): it's refused, rather than
 * reopen another. See `takesSpace`. Siblings count at the stops chosen
 * for them: closing one child can let another step back up to take it.
 */
function isRefused({ chosen, next, index }: Adjustment): boolean {
  const after = chosen.map((item, position) =>
    position === index ? next[index] : item,
  );
  return chosen.some(takesSpace) && !after.some(takesSpace);
}

/**
 * Whether `after` leaves a group that refuses overflow (`refuseOverflow`)
 * further past its space than `before` did: its children's minimums don't
 * fit, by more than half a pixel more. Only measured groups count: before
 * measuring, it can't be told.
 */
function overflowsMore(before: LayoutState, after: LayoutState): boolean {
  const was = getLayoutRendering(before).shortfalls;
  const now = getLayoutRendering(after).shortfalls;
  return indexTree(after.config.root).groups.some(
    (group) =>
      group.refuseOverflow &&
      (now.get(group.id) ?? 0) > (was.get(group.id) ?? 0) + 0.5,
  );
}

/**
 * Whether a call's outcome can depend on more than its stops: some group
 * refuses overflow, or some child steps down to fit (`yieldTo`).
 */
function fitsMatter(state: LayoutState): boolean {
  const tree = indexTree(state.config.root);
  return (
    tree.groups.some((group) => group.refuseOverflow) ||
    [...tree.nodes.values()].some(
      (node) => "yieldTo" in node && Object.keys(node.yieldTo).length > 0,
    )
  );
}

/**
 * Changes one node and lets its siblings absorb the difference (in
 * proportion to size, skipping `keepSize` ones). `change` maps the node's
 * current item to its new one. Refused, with a development warning, if it
 * would leave nothing to take the group's space (see `isRefused`), and
 * without one if it would overflow a group that refuses to (see
 * `applyAdjustment`).
 */
function adjustNode(
  state: LayoutState,
  id: string,
  kind: ChangeKind,
  change: (item: GroupItem, node: ChildNode, group: GroupNode) => GroupItem,
): LayoutState {
  const planned = planAdjustment(state, id, change);
  if (!planned) return state;
  const { group, next, index } = planned;
  if (isRefused(planned)) {
    // A grid's tracks are its columns' or rows' group, which has no id of
    // its own to name.
    const grid = gridOfTracks(indexTree(state.config.root), group.id);
    const of = grid
      ? `the ${grid.columns === group ? "columns" : "rows"} of "${grid.id}"`
      : `"${group.id}"`;
    // Siblings in a range that only a maximum stops from taking the space:
    // likely meant to take it.
    const capped = next.flatMap((item, position) => {
      const stop = findStop(item.track, item.stop);
      return position !== index && stop && stop.max > stop.min
        ? [`"${group.children[position].id}"`]
        : [];
    });
    const cappedNote =
      capped.length === 0
        ? ""
        : ` ${capped.join(", ")} ${capped.length === 1 ? "has" : "have"} a ` +
          `maximum, so can't; without it, ` +
          `${capped.length === 1 ? "it" : "they"} could.`;
    warnOnce(
      `"${id}" stays where it is: at "${next[index].stop}", every one of ` +
        `${of} would be a fixed size, with nothing to take the rest of its ` +
        `space. One must be able to.${cappedNote} To leave space empty ` +
        `instead, add a child (or a track) for it (see "Empty space" in the ` +
        `README).`,
    );
    return state;
  }
  return applyAdjustment(state, planned, id, kind);
}

/**
 * Carries out a planned change that isn't refused for leaving nothing to
 * take the space: `state` itself if it's refused for overflow (a group
 * with `refuseOverflow` that would end further past its space, or that
 * can't show the node as asked without stepping it down), unless not
 * `refusingOverflow` (a step of `setChildStops`, which checks where they
 * all end).
 */
function applyAdjustment(
  state: LayoutState,
  planned: Adjustment,
  id: string,
  kind: ChangeKind,
  refusingOverflow = true,
): LayoutState {
  const { group, committed, next, index } = planned;
  if (!own(committed.spaces, group.id)) return state;
  // The node itself steps down to fit only once its siblings can't (see
  // `protectedChild`), and gives way only once they can't.
  // Asked for: nothing's held down any more (see `heldDown`).
  const asked: LayoutState = {
    ...committed,
    protectedChild: id,
    heldDown: null,
  };
  // Groups get the space they're about to have now, so they animate to
  // their sizes in step, rather than chasing the browser's measurements of
  // it on the way (see `measure`). From the layout with any drag dropped,
  // as its spaces are (see `withoutDrag`).
  const rendered = getLayoutRendering(committed);
  // The group's own, too: more, if the change needs more than it has and
  // its parent can give it (see `respace`).
  const { spaces } = respace(
    keepingSizes(committed, commitItems(asked, group, next), id, next[index]),
    committed.spaces,
    rendered,
  );
  const space = own(spaces, group.id)!;
  const spaced: LayoutState = {
    ...asked,
    spaces: { ...asked.spaces, [group.id]: space },
  };
  // Planned from what's asked for, as it'd be stored.
  const stepped = stepDown(
    commitItems(spaced, group, next),
    group,
    next,
    space.available,
  );
  const { yielded } = stepped[index];
  if (yielded && group.refuseOverflow && refusingOverflow) return state;
  // Asked for, so it's what's chosen, even where it has to step down to
  // fit (see `writeItems`).
  const marked = yielded
    ? stepped.map((item, position) =>
        position === index
          ? { ...item, yielded: { ...yielded, chosen: true } }
          : item,
      )
    : stepped;
  const weights = marked.map((item, position) =>
    position === index || item.keepSize ? 0 : item.size,
  );
  const fitted = fitSizes(marked, space.available, weights, [index]);
  const after: LayoutState = {
    // Spaced as the sizes it saves are drawn.
    ...respace(
      keepingSizes(
        committed,
        commitItems(asked, group, fitted),
        id,
        next[index],
      ),
      committed.spaces,
      rendered,
    ),
    animate: kind,
  };
  return refusingOverflow && overflowsMore(committed, after) ? state : after;
}

/**
 * `after`, a call's layout, with the children that keep their size
 * (`keepSize`, or `locked`) at the sizes `before` saved: a call takes room
 * from them only while there's none to spare, as a narrower window does,
 * and they come back once there is. The call's own child saves the size it
 * asked for (`asked`), if it's one of them. Other children's sizes are
 * shares of their group's space, which a call changes, as adding a child
 * does.
 */
function keepingSizes(
  before: LayoutState,
  after: LayoutState,
  id: string,
  asked: GroupItem,
): LayoutState {
  let places: Record<string, ChildPlace> | null = null;
  for (const node of indexTree(after.config.root).nodes.values()) {
    if (!("keepSize" in node) || !(node.keepSize || node.locked)) continue;
    const place = own(after.places, node.id);
    if (!place || !isRangeStop(node, place.stop)) continue;
    const size =
      node.id === id
        ? asked.stop === place.stop
          ? asked.size
          : undefined
        : own(own(before.places, node.id)?.sizes, place.stop);
    if (size === undefined || size === own(place.sizes, place.stop)) continue;
    places ??= { ...after.places };
    setOwn(places, node.id, {
      ...place,
      sizes: { ...place.sizes, [place.stop]: size },
    });
  }
  return places ? { ...after, places } : after;
}

/**
 * Moves a node to the stop called `stop` (a point, or a range at its
 * remembered size); its siblings make room. With `toggle`, a node already
 * there goes back (see `toggleBack`; else its home stop). Throws
 * for an unknown stop.
 */
export function setChildStop(
  state: LayoutState,
  id: string,
  stop: string,
  toggle = false,
): LayoutState {
  return adjustNode(state, id, "stop", toStop(state, stop, toggle));
}

/**
 * `setChildStop` for several children at once, as one change: each in
 * the order given, except that one refused at its turn for leaving nothing
 * to take the space (closing the only open child before another opens)
 * waits for the rest and is tried again. Overflow is judged where they all
 * end, not on the way (a swap under `refuseOverflow` may only fit once
 * done): a group that refuses it mustn't end further past its space, or
 * show a child asked for here stepped down. All or nothing: if some still
 * can't move once nothing else can, or the end is refused, `state` itself
 * (warned about, unless `quiet`). Children already at their stop are
 * skipped. Throws for an unknown stop.
 */
export function setChildStops(
  state: LayoutState,
  changes: readonly (readonly [id: string, stop: string])[],
  quiet = false,
): LayoutState {
  let next = state;
  let pending = changes;
  while (pending.length > 0) {
    const waiting: (readonly [string, string])[] = [];
    for (const [id, stop] of pending) {
      const planned = planAdjustment(next, id, toStop(next, stop, false));
      // There already (or no such child): nothing to do.
      if (!planned) continue;
      if (isRefused(planned)) {
        waiting.push([id, stop]);
        continue;
      }
      next = applyAdjustment(next, planned, id, "stop", false);
    }
    if (waiting.length === pending.length) {
      if (!quiet) {
        const refused = waiting
          .map(([id, stop]) => `"${id}" to "${stop}"`)
          .join(", ");
        warnOnce(
          `setStops: ${refused} would leave a group with nothing to take its space, even after the other changes, so none of them happen.`,
        );
      }
      return state;
    }
    pending = waiting;
  }
  if (next === state || !overflowsAt(state, next, changes)) return next;
  if (!quiet) {
    warnOnce(
      `setStops: ${changes.map(([id, stop]) => `"${id}" to "${stop}"`).join(", ")} would overflow a group with refuseOverflow, so none of them happen.`,
    );
  }
  return state;
}

/**
 * Whether `setChildStops` ends refused for overflow (see there): `after`
 * overflows a group with `refuseOverflow` more than `before`, or shows a
 * child asked for in one stepped down.
 */
function overflowsAt(
  before: LayoutState,
  after: LayoutState,
  changes: readonly (readonly [id: string, stop: string])[],
): boolean {
  if (overflowsMore(before, after)) return true;
  const { parents } = indexTree(after.config.root);
  const { nodes } = getLayoutRendering(after);
  return changes.some(
    ([id, stop]) =>
      parents.get(id)?.refuseOverflow === true && nodes.get(id)?.stop !== stop,
  );
}

/**
 * `allowsStop`'s answers through a drag, by its `grabbed` pairs (the same
 * from press to release). A call drops the drag (see `planAdjustment`),
 * so they're about the layout from before it, the same on every frame,
 * however far the drag has gone; asked for every button on every render,
 * they're worked out once a drag. Kept only while what they depend on
 * stays the same: what's chosen, the options, the protected child, and
 * every group's space but those the drag passes its own down to, which
 * change every frame and are given back when it's dropped (a window
 * resize mid-drag changes the others).
 */
const dragAnswers = new WeakMap<
  readonly SeparatorPair[],
  {
    readonly state: Pick<
      LayoutState,
      "places" | "config" | "protectedChild" | "spaces"
    >;
    /** The groups whose spaces move with the drag. */
    readonly moving: ReadonlySet<string>;
    readonly answers: Map<string, boolean>;
  }
>();

/**
 * Whether `setChildStop` would change anything: `false` if the node is
 * there already (with `toggle`, if there's nowhere to go back to), if it'd
 * be refused (see `isRefused`, and `overflowsMore` once measured), or if
 * there's no node `id`. Throws for an unknown stop.
 */
export function allowsStop(
  state: LayoutState,
  id: string,
  stop: string,
  toggle = false,
): boolean {
  const { drag } = state;
  if (!drag) return answersStop(state, id, stop, toggle);
  let kept = dragAnswers.get(drag.grabbed);
  if (
    !kept ||
    kept.state.places !== state.places ||
    kept.state.config !== state.config ||
    kept.state.protectedChild !== state.protectedChild ||
    movedApart(kept.state.spaces, state.spaces, kept.moving)
  ) {
    kept = {
      state,
      moving:
        kept?.state.config === state.config ? kept.moving : passedDownTo(state),
      answers: new Map(),
    };
    dragAnswers.set(drag.grabbed, kept);
  }
  const key = JSON.stringify([id, stop, toggle]);
  let answer = kept.answers.get(key);
  if (answer === undefined) {
    answer = answersStop(state, id, stop, toggle);
    kept.answers.set(key, answer);
  }
  return answer;
}

/**
 * The groups a drag passes its space down to as it goes (see
 * `passDownDrag`): those in the dragged groups' children that run their
 * way, and on down.
 */
function passedDownTo(state: LayoutState): Set<string> {
  const reached = new Set<string>();
  const visit = (group: GroupNode) => {
    for (const child of group.children) {
      for (const inner of runningAlong(state, child, group.axis)) {
        if (reached.has(inner.id)) continue;
        reached.add(inner.id);
        visit(inner);
      }
    }
  };
  for (const separator of state.drag?.separators ?? []) {
    const group = groupById(state, separator.group);
    if (group) visit(group);
  }
  return reached;
}

/** Whether some group's space but those in `moving` isn't what it was. */
function movedApart(
  was: LayoutState["spaces"],
  now: LayoutState["spaces"],
  moving: ReadonlySet<string>,
): boolean {
  if (was === now) return false;
  const ids = new Set([...Object.keys(was), ...Object.keys(now)]);
  return [...ids].some(
    (id) => !moving.has(id) && own(was, id) !== own(now, id),
  );
}

/** `allowsStop`, worked out. */
function answersStop(
  state: LayoutState,
  id: string,
  stop: string,
  toggle: boolean,
): boolean {
  const planned = planAdjustment(state, id, toStop(state, stop, toggle));
  if (planned === null || isRefused(planned)) return false;
  // Whether it'd overflow, or what stepping down to fit makes of it, takes
  // the change itself, so only where that matters and can be told.
  if (!fitsMatter(state) || !own(state.spaces, planned.group.id)) return true;
  return applyAdjustment(state, planned, id, "stop") !== state;
}

/** The change `setChildStop` asks of a node (see `stopTarget`). */
function toStop(state: LayoutState, stop: string, toggle: boolean) {
  return (item: GroupItem, node: ChildNode, group: GroupNode) => {
    checkStop(node, stop);
    return stopTarget(state, item, node, group, stop, toggle);
  };
}

/**
 * Where moving `node` to `stop` puts it: a point, or a range at the size it
 * last had there. With `toggle`, a node already there goes back (see
 * `toggleBack`; else its home stop). `item` itself if there's nowhere to go.
 */
function stopTarget(
  state: LayoutState,
  item: GroupItem,
  node: ChildNode,
  group: GroupNode,
  stop: string,
  toggle: boolean,
): GroupItem {
  let target = stop;
  if (item.stop === stop) {
    if (!toggle) return item;
    const place = own(state.places, node.id);
    target =
      toggleBack(item.track, stop, place?.from, place?.lastRange ?? null) ??
      homeStop(state, node, group);
  }
  const found = findStop(item.track, target);
  if (!found) return item;
  const remembered = own(own(state.places, node.id)?.sizes, target);
  return {
    ...item,
    stop: target,
    size: within(found, remembered ?? fallbackSize(state, group, node, found)),
  };
}

/**
 * Asks for a node's size along its group's axis; it lands like a drag would
 * (on the nearest stop if it's in a gap), and its siblings make room.
 */
export function setChildSize(
  state: LayoutState,
  id: string,
  size: Size,
): LayoutState {
  return adjustNode(state, id, "size", (item, _node, group) => {
    const requested = resolveSize(size, contextOf(state, group)) ?? item.size;
    const landed = land(item.track, requested, item.stop);
    return { ...item, stop: landed.stop, size: landed.size };
  });
}

// --- Keyboard ----------------------------------------------------------------

/**
 * Applies a key press on the separator between `before` and `after`. Arrows
 * move it on screen; Home and End take its `primary` neighbour to its
 * smallest and largest reachable sizes; Enter toggles that neighbour's
 * `enterToggles` stop, its smallest by default (see `enterTarget`; nothing
 * if it has nowhere to go).
 */
export function applyKeyboard(
  state: LayoutState,
  before: string,
  after: string,
  intent: KeyboardIntent,
  primary: SeparatorSide = "before",
): LayoutState {
  // Children shown stepped down stay so (see `heldDown`), in what the key
  // lays out.
  const held: LayoutState = { ...state, heldDown: shownSteppedDown(state) };
  // Changes are from what's shown, which is what's measured.
  const next = keyboardChange(held, before, after, intent, primary, state);
  return next === held ? state : { ...next, animate: "keyboard" };
}

/**
 * What a key does on the separator between `before` and `after` (see
 * `applyKeyboard`), as a boundary move in its group: the other side gives
 * or takes the difference, as when dragging it, from what `shown` shows.
 * `state` itself if it changes nothing.
 */
function keyboardChange(
  state: LayoutState,
  before: string,
  after: string,
  intent: KeyboardIntent,
  primary: SeparatorSide,
  shown: LayoutState,
): LayoutState {
  if (
    state.config.disabled ||
    state.drag ||
    isSeparatorDisabled(state.config, before, after)
  ) {
    return state;
  }
  const at = separatorAt(state, before, after);
  if (!at) return state;
  const { group, space, index, items } = at;
  const { cascade } = state.config;
  // The neighbour the separator is about: Home, End and Enter are its.
  const position = primary === "before" ? index : index + 1;
  const current = items[position];
  // Its size grows as the separator moves forward if it's before it.
  const sign = primary === "before" ? 1 : -1;
  // A change of its size is a move of the separator this many times
  // smaller (see `neighbourScale`).
  const scale = neighbourScale(items, index, position);
  const commit = (moved: GroupItem[]) =>
    // Already there: nothing to change (or animate).
    sameItems(moved, items)
      ? state
      : respace(
          commitItems(
            releaseMoved(state, group, items, moved),
            group,
            moved,
            (ancestor) => fittedItems(shown, ancestor),
          ),
          state.spaces,
          getLayoutRendering(shown),
        );
  switch (intent.kind) {
    case "toggle":
      return commit(toggleAcross(state, at, position, sign * scale));
    case "move": {
      const moved = moveBoundary(items, index, intent.delta, { cascade });
      // Within the stops they're in: a step that would take a neighbour
      // across a gap to another stop goes to its stop's edge first (see
      // `crossesGap`). A drag snaps across as the pointer passes the gap's
      // dividing point; a key has no pointer, so it stops at the edge.
      const kept = crossesGap(items, moved)
        ? toEdge(items, index, intent.delta, cascade)
        : moved;
      if (!sameItems(kept, items) && !crossesGap(items, kept)) {
        return commit(kept);
      }
      // A neighbour holding at its stop's edge: jump to its next stop, so
      // the keyboard reaches every stop a drag can (unless that's off).
      if (!state.config.keyboard?.jump) return state;
      for (const jump of jumpsFrom(items, index, intent.delta)) {
        const jumped = moveBoundary(items, index, jump, { cascade });
        if (!sameItems(jumped, items)) return commit(jumped);
      }
      return state;
    }
    case "min":
      return commit(
        moveBoundary(
          items,
          index,
          (sign * (reach(current.track, current.stop).min - current.size)) /
            scale,
          { cascade },
        ),
      );
    case "max":
      // As far as the layout allows; the solver stops where it has to.
      return commit(
        moveBoundary(
          items,
          index,
          (sign *
            (Math.min(reach(current.track, current.stop).max, space.available) -
              current.size)) /
            scale,
          { cascade },
        ),
      );
  }
}

/**
 * `state` without the holds (see `heldDown`) on children of `group` that
 * a key moved out of the stop they were held in: it took them there, so
 * nothing holds them back.
 */
function releaseMoved(
  state: LayoutState,
  group: GroupNode,
  items: readonly GroupItem[],
  moved: readonly GroupItem[],
): LayoutState {
  const { heldDown } = state;
  if (!heldDown) return state;
  const released = group.children.filter(
    (child, index) =>
      hasOwn(heldDown, child.id) && moved[index].stop !== items[index].stop,
  );
  if (released.length === 0) return state;
  const held = { ...heldDown };
  for (const child of released) delete held[child.id];
  return {
    ...state,
    heldDown: Object.keys(held).length > 0 ? held : null,
  };
}

/**
 * Enter on a separator: its neighbour at `position` toggles the stop it
 * names (see `enterTarget`), like dragging the separator there: the other
 * side gives or takes the difference (cascading, if that's on), not every
 * sibling. Where it gets all the way, it's in that stop, though a drag
 * couldn't land there (one only reached by name, or a point inside a
 * range); else as far as the other side lets it, landing as a drag would.
 * `rate` is how much the neighbour grows per pixel the separator moves
 * forward. `at.items` themselves if there's nowhere to go.
 */
function toggleAcross(
  state: LayoutState,
  at: NonNullable<ReturnType<typeof separatorAt>>,
  position: number,
  rate: number,
): GroupItem[] {
  const { group, index, items } = at;
  const current = items[position];
  // Without `enterToggles`, it picks from the stops a drag can reach.
  const draggable = current.track.filter((stop) => !stop.onlyByName);
  const stop = enterTarget(group.children[position], draggable);
  if (stop === null) return items;
  const target = stopTarget(
    state,
    current,
    group.children[position],
    group,
    stop,
    true,
  );
  // The target can be landed in on the way, by name or not.
  const reachable = items.map((item, at) =>
    at === position
      ? {
          ...item,
          track: item.track.map((entry) =>
            entry.name === target.stop
              ? { ...entry, onlyByName: false }
              : entry,
          ),
        }
      : item,
  );
  const moved = moveBoundary(
    reachable,
    index,
    (target.size - current.size) / rate,
    { cascade: state.config.cascade },
  );
  const arrived = Math.abs(moved[position].size - target.size) <= EPSILON;
  const toggled = moved.map((item, at) =>
    at === position
      ? {
          ...item,
          track: current.track,
          ...(arrived && { stop: target.stop }),
        }
      : item,
  );
  // Named there after the solver's move, so checked here as the solver
  // checks its own: something must still take the space (see `isRefused`).
  return items.some(takesSpace) && !toggled.some(takesSpace)
    ? [...items]
    : toggled;
}

/**
 * Whether `moved` takes an item across a gap to another stop, rather than
 * on into one it overlaps or adjoins.
 */
function crossesGap(
  items: readonly GroupItem[],
  moved: readonly GroupItem[],
): boolean {
  return moved.some((item, position) => {
    const was = items[position];
    if (item.stop === was.stop) return false;
    const from = findStop(was.track, was.stop);
    const to = findStop(item.track, item.stop);
    if (!from || !to) return false;
    const edge = item.size > was.size ? from.max : from.min;
    return edge < to.min - EPSILON || edge > to.max + EPSILON;
  });
}

/**
 * `items` with the separator after item `index` moved toward `delta` as
 * far as it goes without taking an item across a gap to another stop (see
 * `crossesGap`), by the solver's own rules (cascading, if that's on):
 * where a neighbour's stop ends, if that's in reach, else found by
 * halving.
 */
function toEdge(
  items: readonly GroupItem[],
  index: number,
  delta: number,
  cascade: boolean,
): GroupItem[] {
  const sign = delta > 0 ? 1 : -1;
  const moveBy = (distance: number) =>
    moveBoundary(items, index, sign * distance, { cascade });
  // A neighbour's stop's edge, exactly, if a move there keeps to the stops.
  const growing = sign > 0 ? index : index + 1;
  const shrinking = sign > 0 ? index + 1 : index;
  const grows = findStop(items[growing].track, items[growing].stop);
  const shrinks = findStop(items[shrinking].track, items[shrinking].stop);
  const edges = [
    grows &&
      (grows.max - items[growing].size) / neighbourScale(items, index, growing),
    shrinks &&
      (items[shrinking].size - shrinks.min) /
        neighbourScale(items, index, shrinking),
  ]
    .filter(
      (distance): distance is number =>
        typeof distance === "number" &&
        distance > EPSILON &&
        distance <= Math.abs(delta) + EPSILON,
    )
    .sort((a, b) => b - a);
  for (const distance of edges) {
    const moved = moveBy(distance);
    if (!crossesGap(items, moved)) return moved;
  }
  let low = 0;
  let high = Math.abs(delta);
  let best = [...items];
  while (high - low > MIN_MOVE) {
    const middle = (low + high) / 2;
    const moved = moveBy(middle);
    if (crossesGap(items, moved)) high = middle;
    else {
      low = middle;
      best = moved;
    }
  }
  return best;
}

function sameItems(a: readonly GroupItem[], b: readonly GroupItem[]): boolean {
  return a.every(
    (item, index) =>
      item.stop === b[index].stop &&
      Math.abs(item.size - b[index].size) < EPSILON,
  );
}

// --- Resetting ---------------------------------------------------------------

/**
 * Goes back to the layout the options start with. With `id`, just that node
 * does: it takes its default stop and size again, as if it had just been added,
 * and its siblings make room. Either way, what was reset forgets the sizes
 * it remembered in each stop.
 */
export function resetToDefaults(state: LayoutState, id?: string): LayoutState {
  // The root's id resets everything, the same as no id.
  const all = id === undefined || id === state.config.root.id;
  const tree = indexTree(state.config.root);
  const known = all || tree.nodes.has(id);
  const places = all
    ? {}
    : Object.fromEntries(
        Object.entries(state.places).filter(([key]) => key !== id),
      );
  const dropped = withoutDrag(state);
  const after: LayoutState = {
    ...layOutUnlaid(
      // Reset, one node is what was asked for (see `protectedChild`).
      {
        ...dropped,
        places,
        protectedChild: all ? null : known ? id : dropped.protectedChild,
        heldDown: null,
      },
      getLayoutRendering(dropped),
    ),
    animate: "reset",
  };
  // Resetting one node is a change asked of it, like `setChildStop`, so
  // refused in the same way; resetting everything goes back to the
  // defaults, whatever they need.
  if (all || !known) return after;
  const parent = tree.parents.get(id);
  const steppedDown =
    parent?.refuseOverflow &&
    getLayoutRendering(after).nodes.get(id)?.yieldedFrom != null;
  return steppedDown || overflowsMore(dropped, after) ? state : after;
}
