/**
 * Stepping down a layout's children: which ones step down their `yieldTo`,
 * for the whole layout at once, while what a group's children need doesn't
 * fit its space (see `planOf`). What each child needs is read in
 * `layout-extents.ts`; fitting a group's sizes to its space
 * (`layout-fit.ts`) builds on this.
 */
import type { Axis } from "../foundation/keyboard.js";
import { own } from "../foundation/own.js";
import { EPSILON, findStop } from "../foundation/stops.js";
import type { LayoutState } from "./layout-config.js";
import {
  type Reading,
  type Steps,
  contentsOn,
  extentOf,
  heldStop,
  innerExtent,
  innerOf,
  reachesDown,
  stopFor,
  stopNameOf,
  trackOf,
} from "./layout-extents.js";
import {
  type ChildNode,
  type GridNode,
  type GroupNode,
  type RootNode,
  type TreeIndex,
  indexTree,
  tracksAlong,
} from "./tree.js";

/** What a group's stepping down decided (see `decide`). */
export interface Decision {
  readonly steps: Steps;
  /**
   * Children keeping their size first (`keepSize: "yield-first"`) that
   * gave way, by id: the others keep their size while the space is shared.
   */
  readonly relaxed: ReadonlySet<string>;
}

export const NOTHING_DECIDED: Decision = {
  steps: new Map(),
  relaxed: new Set(),
};

/** The layout's stepping down (see `planOf`), by group id. */
interface Plan {
  /**
   * What the groups a group is in stepped down inside it: where it starts
   * from deciding its own (see `stepDown`).
   */
  readonly before: ReadonlyMap<string, Decision>;
  /**
   * That, and what it stepped down itself: what it's fitted with. Not
   * what the groups inside it decide on their own, in the space it gives
   * them: that it had to give them less is what they decided from.
   */
  readonly after: ReadonlyMap<string, Decision>;
}

const plans = new WeakMap<LayoutState, Plan>();

/**
 * Which children step down, for the whole layout: each group, outermost
 * first, steps down its children and those in the groups inside it while
 * its minimums don't fit its space (see `decide`), and a group inside
 * starts from what the groups it's in decided. So a pane steps down as it
 * would if its groups were flattened into one (but for each group keeping
 * a child taking its space: see `keepsTaker`), and every group agrees on
 * it: a nested group keeps what the groups it's in decided, and steps down
 * more only for its own space. (A group being dragged, and the groups it's
 * in, decide as without the drag; its children's sizes are the drag's: see
 * `currentItems`.) Nothing is stored but what's held down (see `heldDown`):
 * worked out from the stops chosen on every fit, a child steps back up as
 * soon as there's room for its own, unless it's held.
 */
export function planOf(state: LayoutState): Plan {
  const cached = plans.get(state);
  if (cached) return cached;
  // Mid-drag, the layout steps down as it did without the drag: a drag
  // doesn't step children down or up as it goes (its release does). But
  // in a dragged group's children, whose space the drag changes, groups
  // step down for it as it goes. (The groups those are in aren't among
  // them, and are decided first: as they would be without the drag.)
  const still: LayoutState = state.drag ? { ...state, drag: null } : state;
  const moving = state.drag ? insideDragged(state) : new Set<string>();
  const steps = new Map<string, string>();
  const relaxed = new Set<string>();
  const decided = (): Decision => ({
    steps: new Map(steps),
    relaxed: new Set(relaxed),
  });
  const take = (decision: Decision) => {
    for (const [id, stop] of decision.steps) steps.set(id, stop);
    for (const id of decision.relaxed) relaxed.add(id);
  };
  const before = new Map<string, Decision>();
  const after = new Map<string, Decision>();
  const tree = indexTree(state.config.root);
  for (const group of tree.groups) {
    before.set(group.id, decided());
    const space = own(state.spaces, group.id);
    if (space && yieldsWithin(tree, group)) {
      const from = moving.has(group.id) ? state : still;
      // The protected child at the size it was asked for, as in its call
      // (see `stepDown`): it saves that size (see `keepingSizes`).
      take(
        decide(from, group, space.available, decided(), state.protectedChild),
      );
    }
    after.set(group.id, decided());
  }
  const plan = { before, after };
  plans.set(state, plan);
  return plan;
}

/**
 * The stops `group`'s children and the children of the groups inside it
 * step down to (with those `imposed` by the groups it's in to start from),
 * while what its children need doesn't fit `available`. A step at a time:
 * the first, in yielding order, that lowers what they need; a column of
 * rows lowers what it needs only if each of its widest rows steps down,
 * so they do together, or none does. The order: children that don't keep
 * their size, then those that do (`keepSize`) or are `locked` (calls take
 * room from them only once nothing else can give it), then the protected
 * child (see `protectedChild`); within each, lower priorities first, and
 * of those, the last child first (in the whole tree). A step is taken
 * only if its group keeps a child taking the space (see `takesSpace`).
 *
 * A child keeping its size first (`keepSize: "yield-first"`) counts at its
 * size, and doesn't step down itself, while others can step down (but for
 * the protected child, which waits for them too): once none can, the
 * first of them in yielding order gives way to its minimum (and may then
 * step down), and so on.
 */
export function decide(
  state: LayoutState,
  group: GroupNode,
  available: number,
  imposed: Decision,
  asked: string | null = null,
): Decision {
  const steps = new Map(imposed.steps);
  const tree = indexTree(state.config.root);
  // Children held down (see `heldDown`), its own and inside it, start
  // there, or further down: what was shown, which it keeps.
  if (state.heldDown) {
    for (const node of descendants(tree, group)) {
      const parent = tree.parents.get(node.id);
      if (node === group || !parent || !("yieldTo" in node)) continue;
      const child = node;
      const chosen = stopNameOf(state, child, parent);
      const held = heldStop(state, child, chosen);
      const at = steps.get(child.id) ?? chosen;
      if (held !== undefined && reachesDown(child, at, held)) {
        steps.set(child.id, held);
      }
    }
  }
  // Those the groups it's in had give way have.
  const relaxed = new Set(imposed.relaxed);
  const keepsSize = (node: ChildNode) =>
    node.yieldFirst && !relaxed.has(node.id);
  const needs = (with_: Reading) => {
    const inner = innerExtent(state, group, group.axis, with_);
    const overhead = own(state.spaces, group.id)?.overhead ?? 0;
    return inner.min - overhead;
  };
  const ranks = rankings(state);
  // Each round steps a child down its `yieldTo` (which never comes back
  // round) or has one keeping its size first give way: no more rounds
  // than those steps and those children.
  const rounds = descendants(tree, group).reduce(
    (count, node) =>
      "yieldTo" in node
        ? count + Object.keys(node.yieldTo).length + (node.yieldFirst ? 1 : 0)
        : count,
    0,
  );
  // Each child's steps, kept from round to round but for the children a
  // step was taken in; and all of them once one keeping its size gives
  // way, or the children taking the space change where there's one at
  // most (see `keepsTaker`).
  const within = new Map<string, number[]>();
  group.children.forEach((child, index) => {
    for (const node of descendants(tree, child)) {
      within.set(node.id, [...(within.get(node.id) ?? []), index]);
    }
  });
  let proposals: (Proposal[] | null)[] = group.children.map(() => null);
  let taking: ReadonlySet<string> | null = null;
  // The first keeping its size, in yielding order, gives way; `false` if
  // none is left to.
  const giveWay = () => {
    const next = keepingFirst(tree, group)
      .filter((node) => !relaxed.has(node.id))
      .sort((a, b) => compareRanks(ranks(a), ranks(b)))[0];
    if (!next) return false;
    relaxed.add(next.id);
    proposals = proposals.map(() => null);
    return true;
  };
  for (let round = 0; round <= rounds; round++) {
    // Its own each round, as what's read with it is kept for it (see
    // `takersOf`).
    const reading: Reading = { steps: new Map(steps), keepsSize };
    const now = needs(reading);
    if (now <= available + 0.5) {
      // A call's child at the size asked for: those keeping their size
      // first give way for it, as for anything else (it steps nothing
      // down, which its own minimum decides).
      const fitsAsked =
        asked === null ||
        needs({
          ...reading,
          keepsSize: (node) => keepsSize(node) || node.id === asked,
        }) <=
          available + 0.5;
      if (fitsAsked || !giveWay()) break;
      continue;
    }
    const takers = takersOf(state, group, reading);
    // (A step is refused only for leaving none: see `keepsTaker`.)
    if (
      taking &&
      (taking.size <= 1 || takers.size <= 1) &&
      !sameMembers(taking, takers)
    ) {
      proposals = proposals.map(() => null);
    }
    taking = takers;
    const current = proposals.map(
      (known, index) =>
        known ??
        proposalsFor(
          state,
          group.children[index],
          group,
          group.axis,
          reading,
          ranks,
        ),
    );
    proposals = current;
    // The first in yielding order that lowers what they need.
    const best = current
      .flat()
      .sort((a, b) => compareRanks(a.rank, b.rank))
      .find((proposal) => needs(withSteps(reading, proposal)) < now - EPSILON);
    // The protected child steps down only once those keeping their size
    // first have given way too: it's last of all.
    if (best?.rank[0] === PROTECTED && giveWay()) continue;
    if (best) {
      for (const [id, stop] of best.members) {
        steps.set(id, stop);
        for (const index of within.get(id) ?? []) proposals[index] = null;
      }
      continue;
    }
    // Nothing else can step down.
    if (!giveWay()) break;
  }
  return { steps, relaxed };
}

/** The groups inside the children of the groups being dragged. */
function insideDragged(state: LayoutState): Set<string> {
  const tree = indexTree(state.config.root);
  const inside = new Set<string>();
  for (const separator of state.drag?.separators ?? []) {
    const group = tree.nodes.get(separator.group);
    if (group?.kind !== "group") continue;
    for (const child of group.children) {
      for (const node of descendants(tree, child)) {
        if (node.kind === "group") inside.add(node.id);
      }
    }
  }
  return inside;
}

/** A step to take: its children's new stops, ranked by its latest. */
interface Proposal {
  readonly members: readonly (readonly [string, string])[];
  readonly rank: Rank;
}

/** Whether `a` and `b` hold the same ids. */
function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** `steps` with `taken` too, read over them (not copied). */
function over(
  steps: Reading["steps"],
  taken: readonly (readonly [string, string])[],
): Reading["steps"] {
  const added = new Map(taken);
  return { get: (id) => added.get(id) ?? steps.get(id) };
}

/** `reading` with `proposal`'s steps taken. */
function withSteps(reading: Reading, proposal: Proposal): Reading {
  return {
    ...reading,
    steps: over(reading.steps, proposal.members),
  };
}

/**
 * The steps that lower what `node` needs along `axis` (as a child of
 * `parent`, a group or a grid's track group): its own next step down, and
 * those inside it. Inside a group running along `axis`, any of its
 * children's; running across, or among the groups in a grid track's cells,
 * what it needs is the largest of theirs, so one from each of the largest,
 * taken together.
 */
function proposalsFor(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
  axis: Axis,
  reading: Reading,
  ranks: (node: ChildNode) => Rank,
): Proposal[] {
  const needs = (with_: Reading) =>
    extentOf(state, node, parent, axis, with_).min;
  const now = needs(reading);
  const lowering = (proposal: Proposal) =>
    needs(withSteps(reading, proposal)) < now - EPSILON;
  const proposals: Proposal[] = [];

  // Its own next step: not while it keeps its size first, nor a group
  // hiding a child that does.
  const from = stopFor(state, node, parent, reading);
  const to = axis === parent.axis ? own(node.yieldTo, from) : undefined;
  if (
    to !== undefined &&
    !keepingFirst(indexTree(state.config.root), node).some((kept) =>
      reading.keepsSize?.(kept),
    ) &&
    keepsTaker(state, node, parent, to, reading)
  ) {
    proposals.push({ members: [[node.id, to]], rank: ranks(node) });
  }

  // Inside it.
  const inside = (group: GroupNode) =>
    group.children.map((child) => ({
      needs: extentOf(state, child, group, axis, reading).min,
      proposals: proposalsFor(state, child, group, axis, reading, ranks),
    }));
  if (node.kind === "group") {
    proposals.push(
      ...(axis === node.axis
        ? inside(node).flatMap((child) => child.proposals)
        : together(inside(node))),
    );
  } else if (node.kind === "grid") {
    proposals.push(
      ...inside(tracksAlong(node, axis)).flatMap((child) => child.proposals),
    );
  } else if (node.kind === "track") {
    const grid = indexTree(state.config.root).gridOf.get(node.id);
    proposals.push(
      ...together(
        contentsOn(state, node, axis, true).map((content) => ({
          needs: innerOf(state, content, axis, reading)?.min ?? 0,
          proposals: contentProposals(
            state,
            content,
            grid,
            axis,
            reading,
            ranks,
          ),
        })),
      ),
    );
  }
  return proposals.filter(lowering);
}

/** The steps inside a grid cell's group or grid, along `axis`. */
function contentProposals(
  state: LayoutState,
  content: GroupNode | GridNode,
  grid: GridNode | undefined,
  axis: Axis,
  reading: Reading,
  ranks: (node: ChildNode) => Rank,
): Proposal[] {
  if (!grid) return [];
  // As a child of the grid's track group that way, it shares its space.
  return proposalsFor(
    state,
    content,
    tracksAlong(grid, axis),
    axis,
    reading,
    ranks,
  );
}

/**
 * Where what's needed is the largest of `children`'s: a step from each of
 * the largest (its first in yielding order), taken together, or none if
 * one of them can't.
 */
function together(
  children: readonly { needs: number; proposals: readonly Proposal[] }[],
): Proposal[] {
  const largest = Math.max(0, ...children.map((child) => child.needs));
  if (largest <= 0) return [];
  const widest = children.filter((child) => child.needs >= largest - EPSILON);
  const firsts = widest.map(
    (child) =>
      [...child.proposals].sort((a, b) => compareRanks(a.rank, b.rank))[0],
  );
  if (firsts.some((first) => first === undefined)) return [];
  return [
    {
      members: firsts.flatMap((first) => first!.members),
      rank: firsts
        .map((first) => first!.rank)
        .reduce((a, b) => (compareRanks(a, b) >= 0 ? a : b)),
    },
  ];
}

/**
 * Whether `parent` still has a child taking the space (see `takesSpace`)
 * with `node` at `to`, if it had one.
 */
function keepsTaker(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
  to: string,
  reading: Reading,
): boolean {
  const takers = takersOf(state, parent, reading);
  if (takers.size === 0) return true;
  // Another still does, or it does at `to`.
  if (takers.size > 1 || !takers.has(node.id)) return true;
  return takes(state, node, parent, {
    ...reading,
    steps: over(reading.steps, [[node.id, to]]),
  });
}

/** Whether `node` takes the space in `parent` (see `takesSpace`), as read. */
function takes(
  state: LayoutState,
  node: ChildNode,
  parent: GroupNode,
  reading: Reading,
): boolean {
  const track = trackOf(state, node, parent, reading);
  return (
    findStop(track, stopFor(state, node, parent, reading))?.max === Infinity
  );
}

const takersByReading = new WeakMap<
  Reading,
  Map<string, ReadonlySet<string>>
>();

/** The children of `parent` taking the space, as `reading` reads them. */
function takersOf(
  state: LayoutState,
  parent: GroupNode,
  reading: Reading,
): ReadonlySet<string> {
  let known = takersByReading.get(reading);
  if (!known) takersByReading.set(reading, (known = new Map()));
  let taking = known.get(parent.id);
  if (!taking) {
    taking = new Set(
      parent.children
        .filter((child) => takes(state, child, parent, reading))
        .map((child) => child.id),
    );
    known.set(parent.id, taking);
  }
  return taking;
}

/**
 * Yielding order, as a tuple to compare (see `decide`): the tier (0 for
 * children that don't keep their size, 1 for those that do or are locked,
 * 2 for the protected child), the priority, and the place in reading
 * order, negated so the last comes first.
 */
type Rank = readonly [tier: number, priority: number, order: number];

/** The protected child's tier (see `Rank`). */
const PROTECTED = 2;

function compareRanks(a: Rank, b: Rank): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Each node's place in yielding order (see `decide`), for `state`. */
function rankings(state: LayoutState): (node: ChildNode) => Rank {
  const tree = indexTree(state.config.root);
  const order = readingOrder(state.config.root);
  return (node) => [
    node.id === state.protectedChild ||
    (state.protectedChild !== null && holds(tree, node, state.protectedChild))
      ? PROTECTED
      : node.keepSize || node.locked
        ? 1
        : 0,
    node.priority,
    // The last first.
    -(order.get(node.id) ?? 0),
  ];
}

const readingOrders = new WeakMap<RootNode, Map<string, number>>();

/** Every node's place in the tree, in reading order. */
function readingOrder(root: RootNode): Map<string, number> {
  let order = readingOrders.get(root);
  if (!order) {
    order = new Map(
      [...indexTree(root).nodes.keys()].map((id, index) => [id, index]),
    );
    readingOrders.set(root, order);
  }
  return order;
}

/** Whether the node with `id` is inside `node` (or is it). */
function holds(tree: TreeIndex, node: ChildNode | RootNode, id: string) {
  return descendants(tree, node).some((inner) => inner.id === id);
}

type Inside = readonly (ChildNode | RootNode)[];

const insides = new WeakMap<TreeIndex, Map<string, Inside>>();

/**
 * `node` and every node inside it, in `tree`: a grid's tracks and its
 * cells' content, and in a grid's track, the content of the cells on it
 * (spanning others too), whose size it gives them that way.
 */
function descendants(tree: TreeIndex, node: ChildNode | RootNode): Inside {
  let known = insides.get(tree);
  if (!known) insides.set(tree, (known = new Map()));
  let inside = known.get(node.id);
  if (inside) return inside;
  const within = (nodes: readonly (ChildNode | null)[]) =>
    nodes.flatMap((inner) => (inner ? descendants(tree, inner) : []));
  if (node.kind === "group") {
    inside = [node, ...within(node.children)];
  } else if (node.kind === "grid") {
    inside = [node, ...within([node.columns, node.rows])];
  } else if (node.kind === "track") {
    const grid = tree.gridOf.get(node.id);
    inside = [node, ...within(grid ? cellsOn(grid, node) : [])];
  } else {
    inside = [node];
  }
  // A cell's content is on a column and a row, and on every track it
  // spans: once.
  inside = [...new Set(inside)];
  known.set(node.id, inside);
  return inside;
}

/** The content of the cells on `track`, a column or row of `grid`. */
function cellsOn(grid: GridNode, track: ChildNode): (ChildNode | null)[] {
  const column = grid.columns.children.indexOf(track);
  const row = grid.rows.children.indexOf(track);
  return grid.cells.map((cell) => {
    const [index, start, span] =
      column >= 0
        ? [column, cell.column, cell.columnSpan]
        : [row, cell.row, cell.rowSpan];
    return start <= index && index < start + span ? cell.content : null;
  });
}

/** Whether any child inside `node` can step down (or keeps its size first). */
function yieldsWithin(tree: TreeIndex, node: ChildNode | RootNode): boolean {
  return descendants(tree, node).some(
    (inner) =>
      inner !== node &&
      "yieldTo" in inner &&
      (Object.keys(inner.yieldTo).length > 0 || inner.yieldFirst),
  );
}

/** The children inside `node` (it too) that keep their size first. */
export function keepingFirst(tree: TreeIndex, node: ChildNode | RootNode) {
  return descendants(tree, node).filter(
    (inner): inner is ChildNode => "yieldFirst" in inner && inner.yieldFirst,
  );
}
