/**
 * The solver: how the items in one group (a row or a column) share a fixed
 * length. Pure functions over pixel sizes, used by the layout model for
 * every group.
 *
 * Each item is a track with stops (see `foundation/stops.ts`), sitting in one
 * of them. Two things can change the sizes:
 *
 * - **Moving a boundary** between two neighbours (a separator drag or key
 *   press). One side gives up space, the other takes it, and the total stays
 *   the same.
 * - **Fitting** to a new total (the container resized, an item was added
 *   or removed, moved to another stop or set in code). Space is spread by
 *   weight, and every item stays in its stop.
 *
 * Items that fill (`fill: "first" | "last"`) take what the others leave,
 * by their own order (see `fitSizes` and `settleLastFills`).
 */
import { type Elastic, stretch } from "../foundation/limits.js";
import {
  EPSILON,
  type Stop,
  type Track,
  dividingPoint,
  findStop,
  hasStopBeyond,
  land,
  nextStop,
  snappedShortOf,
  within,
} from "../foundation/stops.js";
import type { LayoutFill } from "./tree.js";

/** One item in a group: its stops, and where it is now. */
export interface GroupItem {
  readonly track: Track;
  readonly size: number;
  /** The stop it's in. */
  readonly stop: string;
  /** For an item that fills what the others leave: when it takes space. */
  readonly fill?: LayoutFill;
  /**
   * For an item that keeps its size (`keepSize`): it takes space only once
   * nothing else can, `"last"` fills included (see `fitSizes`).
   */
  readonly keepSize?: boolean;
  /**
   * When space is taken, lower priorities give it first (see `fitSizes`);
   * 0 when unset.
   */
  readonly priority?: number;
  /**
   * Its share of extra space, once any item in the group has one (see
   * `fitSizes`).
   */
  readonly grow?: number;
  /**
   * Set when the item stepped down along its `yieldTo` to fit: `from` is
   * the stop chosen for it, `at` the stop it stepped down to, and `size`
   * its size in `from` before it did (see `stepDown`). It describes the
   * item only while it's still at `at` (see `isStepped`): an item a drag
   * moved on keeps it, but it no longer applies. `chosen`: `from` was
   * just asked for, by a call, and is to be written as the stop chosen.
   */
  readonly yielded?: {
    readonly from: string;
    readonly at: string;
    readonly size: number;
    readonly chosen?: boolean;
  };
}

/** Whether an item is stepped down to fit (see `GroupItem.yielded`). */
export function isStepped(item: GroupItem): boolean {
  return item.yielded !== undefined && item.yielded.at === item.stop;
}

/** The stop an item is in (as a point at its size, if that's unknown). */
function stopOf(item: GroupItem): Stop {
  return (
    findStop(item.track, item.stop) ?? {
      name: item.stop,
      min: item.size,
      max: item.size,
      pull: 1,
      onlyByName: true,
      stretches: { larger: false, smaller: false },
      endsDrag: false,
    }
  );
}

/**
 * Whether an item can take any amount of space: it's in a range with no
 * maximum. A group keeps at least one such item, or nothing would take what
 * the others leave, and the browser would stretch them past their sizes.
 */
export function takesSpace(item: GroupItem): boolean {
  const stop = stopOf(item);
  return stop.max === Infinity;
}

// --- Distributing space ------------------------------------------------------

/**
 * Divides `amount` between items in proportion to `weights`, without giving
 * any item more than its `capacity`. What a full item can't take is shared
 * among the rest ("water-filling"). Items with no weight get nothing. Returns
 * each item's share; they sum to less than `amount` (by more than `EPSILON`)
 * only once every item with weight is full.
 */
export function distribute(
  amount: number,
  capacities: readonly number[],
  weights: readonly number[],
): number[] {
  const shares = capacities.map(() => 0);
  let remaining = amount;
  let open = capacities
    .map((_, index) => index)
    .filter((index) => capacities[index] > EPSILON && weights[index] > 0);

  while (remaining > EPSILON && open.length > 0) {
    const totalWeight = open.reduce((sum, index) => sum + weights[index], 0);
    const pool = remaining;
    // Items whose fair share would overflow them take what they can hold;
    // the others wait for the next round, when the pool is re-shared.
    const full = open.filter(
      (index) =>
        (pool * weights[index]) / totalWeight >=
        capacities[index] - shares[index],
    );
    if (full.length === 0) {
      for (const index of open) {
        shares[index] += (pool * weights[index]) / totalWeight;
      }
      break;
    }
    for (const index of full) {
      remaining -= capacities[index] - shares[index];
      shares[index] = capacities[index];
    }
    open = open.filter((index) => !full.includes(index));
  }
  return shares;
}

/**
 * Resizes items so they add up to `available`, spreading the difference by
 * `weights` (e.g. current sizes, to keep proportions; 0 for items that should
 * keep their size). If the weighted items can't absorb it all, any item with
 * room takes the rest. Items stay within their stops, so items at points
 * never change. If even that isn't enough (minimums wider than the space),
 * the result overflows.
 *
 * Fill items (see `GroupItem.fill`) go by their own order, whatever their
 * weights: they give space up before the others, in proportion to their
 * sizes, and take it equally, `"first"` ones before the others and `"last"`
 * ones after. Items that keep their size (`GroupItem.keepSize`) take space
 * after even those. Items at `placed` (one whose size was just asked for,
 * by `setStop` say, or children joining) give or take space last of all,
 * once nothing else can: otherwise, beside siblings that keep their size,
 * they'd share the difference with them, and give back some of what was
 * asked for. Several give in proportion to the sizes they asked for.
 * Within each of those turns, items give by priority (`GroupItem.priority`),
 * the lowest first, each priority down to its minimums before the next.
 * Once any item has a `grow`, extra space goes by those instead of
 * `weights` (items without one get none until the others are full), as
 * with CSS `flex-grow`; an item `weights` leaves out still gets none.
 */
export function fitSizes(
  items: readonly GroupItem[],
  available: number,
  weights: readonly number[],
  placed: readonly number[] = [],
): GroupItem[] {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  const difference = available - total;
  if (Math.abs(difference) <= EPSILON) return [...items];

  const growing = difference > 0;
  const capacities = items.map((item) => {
    // An item keeps to its stop until a boundary move lands it in another.
    const { min, max } = stopOf(item);
    return growing ? max - item.size : item.size - min;
  });

  const others = (weight: (index: number) => number) =>
    items.map((item, index) =>
      item.fill || placed.includes(index) ? 0 : weight(index),
    );
  const lastOfAll = (weight: (item: GroupItem) => number) =>
    items.map((item, index) =>
      !item.fill && placed.includes(index) ? weight(item) : 0,
    );
  // Items that keep their size take part only once nothing else can.
  const unkept = (weight: (index: number) => number) =>
    others((index) => (items[index].keepSize ? 0 : weight(index)));
  const fills = (
    kind: LayoutFill | "any",
    weight: (item: GroupItem) => number,
  ) =>
    items.map((item) =>
      item.fill && (kind === "any" || item.fill === kind) ? weight(item) : 0,
    );
  // When space is taken, a round goes by priority, the lowest first: the
  // round's weights for each priority in turn.
  const priorities = [...new Set(items.map((item) => item.priority ?? 0))].sort(
    (a, b) => a - b,
  );
  const byPriority = (round: number[]) =>
    priorities.length < 2
      ? [round]
      : priorities.map((priority) =>
          round.map((weight, index) =>
            (items[index].priority ?? 0) === priority ? weight : 0,
          ),
        );
  // Extra space goes by `grow` once any item has one.
  const byGrow = items.some((item) => item.grow !== undefined)
    ? (index: number) => (weights[index] > 0 ? (items[index].grow ?? 0) : 0)
    : (index: number) => weights[index];
  // Each round's weights, in turn, until the difference is all placed: the
  // weighted items, then any with room.
  const rounds = growing
    ? [
        fills("first", () => 1),
        unkept(byGrow),
        unkept(() => 1),
        fills("last", () => 1),
        others(() => 1),
        lastOfAll(() => 1),
      ]
    : [
        fills("any", (item) => item.size),
        ...byPriority(unkept((index) => weights[index])),
        ...byPriority(others(() => 1)),
        ...byPriority(lastOfAll((item) => item.size)),
      ];

  const changes = items.map(() => 0);
  let left = Math.abs(difference);
  for (const round of rounds) {
    if (left <= EPSILON) break;
    const shares = distribute(
      left,
      capacities.map((capacity, index) => capacity - changes[index]),
      round,
    );
    shares.forEach((share, index) => {
      changes[index] += share;
      left -= share;
    });
  }

  return items.map((item, index) => {
    const change = changes[index];
    return { ...item, size: item.size + (growing ? change : -change) };
  });
}

/**
 * Hands the space `"last"` fill items hold to the other items that can take
 * it (by `weights`, sizes unless given, as `fitSizes` grows them), keeping
 * only what they can't: a `"last"` fill holds space only once nothing else
 * can use it. After a drag or a stop change leaves one holding space beside
 * an item that could take it, this is what it comes to.
 */
export function settleLastFills(
  items: readonly GroupItem[],
  weights: readonly number[] = items.map((item) => item.size),
): GroupItem[] {
  const held = items.reduce(
    (sum, item) => sum + (item.fill === "last" ? item.size : 0),
    0,
  );
  if (held <= EPSILON) return [...items];
  const emptied = items.map((item) =>
    item.fill === "last" ? { ...item, size: 0 } : item,
  );
  return fitSizes(emptied, totalOf(items, range(0, items.length)), weights);
}

// --- Moving a boundary -------------------------------------------------------

interface SideResult {
  readonly items: GroupItem[];
  /** How far the boundary moved, as seen from this side. */
  readonly amount: number;
  /** Whether the nearest item landed in another stop. */
  readonly snapped: boolean;
}

interface SideOptions {
  /** Let the nearest item land across a gap (see `moveSide`). */
  readonly snap: boolean;
  /**
   * Let the items beyond the nearest one move while it holds at its stop's
   * end, rather than wait for it.
   */
  readonly passHold?: boolean;
  /**
   * Let a `"last"` fill grow, as it does to take a neighbour's whole
   * collapse (see `collapseHeld`); otherwise it doesn't, as a drag moves.
   */
  readonly fillTakesLump?: boolean;
}

/**
 * Moves the items on one side of a boundary by up to `amount`, nearest
 * first, growing them (`direction` 1) or shrinking them (-1).
 *
 * The nearest item, if it has a reachable stop beyond its current one in
 * that direction, holds at its stop's end and, with `snap`, lands across
 * the gap once the drag passes the gap's dividing point (which can move the
 * boundary further than asked). Nothing beyond it moves while it holds,
 * unless `passHold`: then it gives what it has in its stop and the rest
 * cascades past it. Otherwise it moves to its stop's limit and the rest
 * cascades to the items beyond, which only move within their current stops
 * (points don't move).
 */
function moveSide(
  items: readonly GroupItem[],
  side: readonly number[],
  amount: number,
  direction: 1 | -1,
  { snap, passHold = false, fillTakesLump = false }: SideOptions,
): SideResult {
  const next = [...items];
  let left = amount;
  let snapped = false;

  for (const [position, index] of side.entries()) {
    if (left <= EPSILON) break;
    const item = next[index];
    const stop = stopOf(item);

    if (position === 0 && hasStopBeyond(item.track, stop, direction)) {
      const requested = item.size + direction * left;
      const landed = snap
        ? land(item.track, requested, item.stop)
        : { size: within(stop, requested), stop: item.stop };
      next[index] = { ...item, size: landed.size, stop: landed.stop };
      left -= Math.abs(landed.size - item.size);
      snapped = landed.stop !== item.stop;
      const now = findStop(item.track, landed.stop) ?? stop;
      if (!passHold && hasStopBeyond(item.track, now, direction)) break;
      continue;
    }

    // A `"last"` fill only takes what nothing else can: as a drag moves,
    // nothing (it would go straight back). A fill with partners moves only
    // by its own edges, with them (see `moveLinked`), not cascaded into.
    const room = linkedFill(items, index)
      ? 0
      : direction > 0
        ? item.fill === "last" && !fillTakesLump
          ? 0
          : stop.max - item.size
        : item.size - stop.min;
    const moved = Math.min(Math.max(0, room), left);
    next[index] = { ...item, size: item.size + direction * moved };
    left -= moved;
  }
  return { items: next, amount: amount - left, snapped };
}

const growSide = (
  items: readonly GroupItem[],
  side: readonly number[],
  amount: number,
  snap: boolean,
) => moveSide(items, side, amount, 1, { snap });

const shrinkSide = (
  items: readonly GroupItem[],
  side: readonly number[],
  amount: number,
  snap: boolean,
) => moveSide(items, side, amount, -1, { snap });

/** The growing side's items from one list, and the rest from another. */
function combine(
  grown: readonly GroupItem[],
  shrunk: readonly GroupItem[],
  growing: readonly number[],
): GroupItem[] {
  const fromGrown = new Set(growing);
  return grown.map((item, index) =>
    fromGrown.has(index) ? item : shrunk[index],
  );
}

/**
 * For each of the two items beside a boundary: the stop the pointer last
 * reached for it in this drag (`null`: the one it started in).
 */
export interface NeighbourStops {
  readonly before: string | null;
  readonly after: string | null;
}

export interface MoveOptions {
  /** Stretch the neighbours a little where the boundary can't follow. */
  readonly elastic?: Elastic;
  /**
   * Whether items beyond the two neighbours move once a neighbour can't
   * (default `true`). Without it, the boundary stops there.
   */
  readonly cascade?: boolean;
  /** Which tells resisting from snapping (see `stretchShows`). */
  readonly reached?: NeighbourStops;
}

/**
 * Moves the boundary after item `boundary` by `delta` pixels (positive moves
 * it toward the end: the items before it grow). `items` are the sizes when
 * the drag started and `delta` is the total movement since, so, like
 * landing, this is a pure function of its inputs, the boundary solved from
 * the start, and every drag is reversible. Only whether a stretch shows
 * also reads the stops last reached (`reached`).
 *
 * Both sides have to move by the same amount. A snap (a neighbour landing in
 * another stop) puts the boundary at that stop rather than under the
 * pointer, so it only happens if the other side can match it exactly. When
 * one side runs out of room, the boundary moves as far as that side allows,
 * snapping if that still lands somewhere (a neighbour opened into a range
 * stays open); failing that, it moves as far as both allow without a snap.
 * See `solveMove` for the special cases (a neighbour crossing a gap goes
 * first; one beside a `"last"` fill can only collapse).
 *
 * The group's only item that takes space (see `takesSpace`) can't be
 * snapped out of it, and a `"last"` fill keeps only what nothing else can
 * take (see `settleLastFills`). Where the boundary isn't under the pointer,
 * its two neighbours may stretch toward it (see `stretchShows`).
 */
export function moveBoundary(
  items: readonly GroupItem[],
  boundary: number,
  delta: number,
  options: MoveOptions = {},
): GroupItem[] {
  if (Math.abs(delta) <= EPSILON) return [...items];
  // Between two fills of a kind, which share equally: nothing to move.
  const [left, right] = [items[boundary], items[boundary + 1]];
  if (left?.fill && left.fill === right?.fill) return [...items];
  const linked = linkedNeighbour(items, boundary);
  if (linked) return moveLinked(items, boundary, delta, options, linked);
  const { elastic, cascade = true, reached } = options;

  // Without cascading, only the two neighbours take part.
  const before = range(boundary, cascade ? -1 : boundary - 1);
  const after = range(boundary + 1, cascade ? items.length : boundary + 2);
  const [growing, shrinking] = delta > 0 ? [before, after] : [after, before];
  const want = Math.abs(delta);

  // Settled before the stretch, so the stretch shows.
  const solved = settleLastFills(
    keepingTheOnlyTaker(items, (guarded) =>
      solveMove(guarded, growing, shrinking, want),
    ),
  );

  const behind = want - (totalOf(solved, growing) - totalOf(items, growing));
  if (!elastic || Math.abs(behind) <= EPSILON) return solved;
  const neighbour = (
    index: number,
    asked: number,
    side: keyof NeighbourStops,
  ): Neighbour => ({
    start: items[index],
    now: solved[index],
    asked,
    reached: reached?.[side] ?? null,
  });
  const grow = neighbour(
    growing[0],
    items[growing[0]].size + want,
    delta > 0 ? "before" : "after",
  );
  const shrink = neighbour(
    shrinking[0],
    items[shrinking[0]].size - want,
    delta > 0 ? "after" : "before",
  );
  if (!stretchShows(grow, shrink, behind > 0, elastic.afterSnap)) {
    return solved;
  }
  const stretched = stretch(Math.abs(behind), elastic);
  const give =
    behind > 0
      ? Math.min(stretched, shrink.now.size)
      : -Math.min(stretched, grow.now.size);
  const result = [...solved];
  result[growing[0]] = { ...grow.now, size: grow.now.size + give };
  result[shrinking[0]] = { ...shrink.now, size: shrink.now.size - give };
  return result;
}

// --- Fills with partners ----------------------------------------------------

/**
 * The fill at `index`'s kind, if another fill of that kind shares the group
 * with it: they share what they hold equally (see `shareFills`), so they
 * move together.
 */
function linkedFill(
  items: readonly GroupItem[],
  index: number,
): LayoutFill | null {
  const kind = items[index]?.fill;
  if (!kind) return null;
  return items.some((other, at) => at !== index && other.fill === kind)
    ? kind
    : null;
}

interface LinkedNeighbour {
  readonly index: number;
  readonly kind: LayoutFill;
}

/**
 * The neighbour of the boundary after item `boundary` that's a fill with
 * partners, if one is (not between two fills of a kind: see
 * `moveBoundary`).
 */
function linkedNeighbour(
  items: readonly GroupItem[],
  boundary: number,
): LinkedNeighbour | null {
  const [before, after] = [items[boundary], items[boundary + 1]];
  if (!before || !after || (before.fill && before.fill === after.fill)) {
    return null;
  }
  for (const index of [boundary + 1, boundary]) {
    const kind = linkedFill(items, index);
    if (kind) return { index, kind };
  }
  return null;
}

/**
 * How much its neighbours change per pixel the boundary after item
 * `boundary` moves: 1, except beside a fill with partners. They all change
 * as it does, so for the boundary to stay under the pointer, the other
 * neighbour changes more: with `n` of them, `m` on the far side of the
 * boundary from it, `n / (n - m)` times. One either side of the others
 * (centring them): twice, both outer edges moving, mirrored.
 */
export function boundaryScale(
  items: readonly GroupItem[],
  boundary: number,
): number {
  const linked = linkedNeighbour(items, boundary);
  if (!linked) return 1;
  const fills = range(0, items.length).filter(
    (index) => items[index].fill === linked.kind,
  );
  const farSide =
    linked.index > boundary
      ? (index: number) => index <= boundary
      : (index: number) => index > boundary;
  const across = fills.filter(farSide).length;
  return fills.length / (fills.length - across);
}

/**
 * How much the neighbour at `position` (either side of the boundary after
 * item `boundary`) changes per pixel the boundary moves: `boundaryScale`,
 * but for a fill with partners, its share of that, as they change
 * together (`1`, for one either side of the others).
 */
export function neighbourScale(
  items: readonly GroupItem[],
  boundary: number,
  position: number,
): number {
  const scale = boundaryScale(items, boundary);
  const linked = linkedNeighbour(items, boundary);
  if (!linked || linked.index !== position) return scale;
  const fills = items.filter((item) => item.fill === linked.kind).length;
  return scale / fills;
}

/**
 * `moveBoundary` beside a fill with partners: as if they were one fill,
 * where this one is, holding them all, moved `boundaryScale` times as far
 * (so the boundary stays under the pointer); then they share what that
 * holds equally.
 */
function moveLinked(
  items: readonly GroupItem[],
  boundary: number,
  delta: number,
  options: MoveOptions,
  { index, kind }: LinkedNeighbour,
): GroupItem[] {
  const partners = range(0, items.length).filter(
    (at) => at !== index && items[at].fill === kind,
  );
  const count = partners.length + 1;
  const removedBefore = (at: number) =>
    partners.filter((partner) => partner < at).length;
  const merged = items
    .map((item, at) =>
      at === index
        ? { ...item, size: totalOf(items, [index, ...partners]) }
        : item,
    )
    .filter((_, at) => !partners.includes(at));
  const moved = moveBoundary(
    merged,
    boundary - removedBefore(boundary),
    delta * boundaryScale(items, boundary),
    options,
  );
  const share = moved[index - removedBefore(index)].size / count;
  return items.map((item, at) =>
    item.fill === kind
      ? { ...item, size: share }
      : moved[at - removedBefore(at)],
  );
}

/**
 * Fills of a kind sharing what they hold equally: two either side of the
 * others centre them, whatever's moved them.
 */
export function shareFills(items: readonly GroupItem[]): GroupItem[] {
  const result = [...items];
  for (const kind of ["first", "last"] as const) {
    const fills = range(0, items.length).filter(
      (index) => items[index].fill === kind,
    );
    if (fills.length < 2) continue;
    const share = totalOf(items, fills) / fills.length;
    for (const index of fills) result[index] = { ...items[index], size: share };
  }
  return result;
}

/**
 * Where both sides of a boundary move by `want`, growing the items in
 * `growing` and shrinking those in `shrinking` (each nearest first).
 * Special cases go first: a neighbour that can only collapse
 * (`collapseHeld`), then one crossing a gap (`acrossGap`). Then both sides
 * move as far as asked; or with a snap on either side, if the other can
 * match it; or as far as the side with less room allows; or as far as
 * both allow without a snap.
 */
function solveMove(
  items: readonly GroupItem[],
  growing: readonly number[],
  shrinking: readonly number[],
  want: number,
): GroupItem[] {
  const held = collapseHeld(items, growing, shrinking, want);
  if (held) return held;
  const grown = growSide(items, growing, want, true);
  const shrunk = shrinkSide(items, shrinking, want, true);
  const across =
    acrossGap(items, growing, shrinking, want, grown, 1) ??
    acrossGap(items, shrinking, growing, want, shrunk, -1);
  if (across) return across;
  if (Math.abs(grown.amount - shrunk.amount) <= EPSILON) {
    return combine(grown.items, shrunk.items, growing);
  }

  // A snap puts the boundary where the stop is, ahead of or behind the
  // pointer; the other side must move by exactly that much, or no snap.
  if (grown.snapped) {
    const match = shrinkSide(items, shrinking, grown.amount, false);
    if (Math.abs(match.amount - grown.amount) <= EPSILON) {
      return combine(grown.items, match.items, growing);
    }
  }
  if (shrunk.snapped) {
    const match = growSide(items, growing, shrunk.amount, false);
    if (Math.abs(match.amount - shrunk.amount) <= EPSILON) {
      return combine(match.items, shrunk.items, growing);
    }
  }

  // One side can't move as far as asked: move as far as it can, which may
  // still be a snap (into a range, say, as far as the other side frees).
  const less = Math.min(grown.amount, shrunk.amount);
  const grownLess = growSide(items, growing, less, true);
  const shrunkLess = shrinkSide(items, shrinking, less, true);
  if (Math.abs(grownLess.amount - shrunkLess.amount) <= EPSILON) {
    return combine(grownLess.items, shrunkLess.items, growing);
  }

  // No snap fits: move as far as both sides can without one.
  const amount = Math.min(
    growSide(items, growing, want, false).amount,
    shrinkSide(items, shrinking, want, false).amount,
  );
  return combine(
    growSide(items, growing, amount, false).items,
    shrinkSide(items, shrinking, amount, false).items,
    growing,
  );
}

/**
 * A neighbour that `moved` across a gap into another stop takes the lump
 * first: it lands at that stop's near edge, and the other side gives as
 * much, its own neighbour within its stop (it holds there, as ever) and
 * the items beyond it the rest. The rest of the drag then carries on from
 * there, as if it had started that way. `null` if nothing crossed a gap, or
 * the other side can't give the lump.
 */
function acrossGap(
  items: readonly GroupItem[],
  side: readonly number[],
  other: readonly number[],
  want: number,
  moved: SideResult,
  direction: 1 | -1,
): GroupItem[] | null {
  if (!moved.snapped) return null;
  const near = items[side[0]];
  const landed = findStop(near.track, moved.items[side[0]].stop);
  if (!landed) return null;
  const lump = direction > 0 ? landed.min - near.size : near.size - landed.max;
  if (lump <= EPSILON) return null;
  const opened = moveSide(items, side, lump, direction, { snap: true });
  const given = moveSide(items, other, lump, direction > 0 ? -1 : 1, {
    snap: false,
    passHold: true,
  });
  if (
    Math.abs(opened.amount - lump) > EPSILON ||
    Math.abs(given.amount - lump) > EPSILON
  ) {
    return null;
  }
  const growing = direction > 0 ? side : other;
  const shrinking = direction > 0 ? other : side;
  const after =
    direction > 0
      ? combine(opened.items, given.items, growing)
      : combine(given.items, opened.items, growing);
  return want - lump > EPSILON
    ? solveMove(after, growing, shrinking, want - lump)
    : after;
}

/**
 * A neighbour that can only collapse, because the other side takes no space
 * as the pointer moves, only a whole lump: a `"last"` fill, which holds
 * space only once nothing else can use it. The neighbour holds where it is,
 * and lands in its next stop down after the same travel as from its stop's
 * edge to the gap's dividing point, however large it's held. The rest of
 * the drag carries on from there. `null` where that isn't the case.
 */
function collapseHeld(
  items: readonly GroupItem[],
  growing: readonly number[],
  shrinking: readonly number[],
  want: number,
): GroupItem[] | null {
  if (growSide(items, growing, want, false).amount > EPSILON) return null;
  const near = items[shrinking[0]];
  const stop = stopOf(near);
  const below = nextStop(near.track, stop, -1);
  const lump = below ? near.size - below.max : 0;
  if (!below || lump <= EPSILON) return null;
  const taken = moveSide(items, growing, lump, 1, {
    snap: false,
    fillTakesLump: true,
  });
  if (Math.abs(taken.amount - lump) > EPSILON) return null;

  // Not the dividing point from where it's held: its edge doesn't follow
  // the pointer, so that point would be nowhere on screen, and further the
  // larger it is.
  const travel = stop.min - dividingPoint(below, stop);
  if (want < travel) return [...items];
  const collapsed = combine(
    taken.items,
    items.map((item, index) =>
      index === shrinking[0]
        ? { ...item, size: below.max, stop: below.name }
        : item,
    ),
    growing,
  );
  return want - lump > EPSILON
    ? solveMove(collapsed, growing, shrinking, want - lump)
    : collapsed;
}

// --- When a stretch shows ----------------------------------------------------

/** One item beside the boundary, for deciding whether it stretches. */
interface Neighbour {
  /** As the drag began. */
  readonly start: GroupItem;
  /** As moved. */
  readonly now: GroupItem;
  /** What the pointer asks of it: its start size moved by the pointer. */
  readonly asked: number;
  /** The stop the pointer last reached for it (`null`: where it began). */
  readonly reached: string | null;
}

/**
 * Whether the two neighbours of a boundary that isn't under the pointer
 * stretch toward it. A stretch is resistance: one of them is pushed past an
 * edge it's at, and neither snapped across a gap, short of the pointer
 * (unless `afterSnap`). And both their stops stretch the way they're
 * pulled: `behind` the pointer, the growing one larger and the shrinking
 * one smaller; ahead of it, the other way round.
 */
function stretchShows(
  grow: Neighbour,
  shrink: Neighbour,
  behind: boolean,
  afterSnap: boolean,
): boolean {
  const [growWay, shrinkWay] = behind
    ? (["larger", "smaller"] as const)
    : (["smaller", "larger"] as const);
  return (
    stopOf(grow.now).stretches[growWay] &&
    stopOf(shrink.now).stretches[shrinkWay] &&
    (pushedPastEdge(grow) || pushedPastEdge(shrink)) &&
    (afterSnap || (!snappedShort(grow) && !snappedShort(shrink)))
  );
}

/**
 * Whether the pointer pushes a neighbour against an edge of the stop it's
 * in: it's at that edge, and asked past it. (Held well away from it, say by
 * a fill handing it the row, it isn't pushing against anything.) A
 * `"last"` fill can't grow in a drag, so its top edge is where it started.
 */
function pushedPastEdge({ start, now, asked }: Neighbour): boolean {
  const { min, max } = stopOf(now);
  const top = start.fill === "last" ? start.size : max;
  return (
    (asked < min - EPSILON && now.size <= min + EPSILON) ||
    (asked > top + EPSILON && now.size >= top - EPSILON)
  );
}

/**
 * Whether a neighbour snapped across a gap, short of the pointer. Not one
 * held back in the stop it started in, because the other side can't give,
 * though the pointer would land it elsewhere: that's resistance, not a
 * snap.
 */
function snappedShort({ start, now, asked, reached }: Neighbour): boolean {
  const origin =
    (reached !== null ? findStop(start.track, reached) : undefined) ??
    stopOf(start);
  const held =
    now.stop === start.stop &&
    land(start.track, asked, start.stop).stop !== now.stop;
  return !held && snappedShortOf(origin, stopOf(now), asked);
}

// --- Helpers -----------------------------------------------------------------

/**
 * Runs `move`, keeping something that takes space (see `takesSpace`): if
 * the result has nothing that does, where the items had something, `move`
 * runs again with those items kept among their stops that do. A drag then
 * can't snap the last of them into one that doesn't (it holds at its
 * range's end, like a range with nothing beyond), since nothing would take
 * what the others leave. One that a drag opens on the way counts: the one
 * it opens beside can then close. Their own stops come back in the result.
 */
function keepingTheOnlyTaker(
  items: readonly GroupItem[],
  move: (items: readonly GroupItem[]) => GroupItem[],
): GroupItem[] {
  const moved = move(items);
  if (moved.some(takesSpace) || !items.some(takesSpace)) return moved;
  const guarded = items.map((item) =>
    takesSpace(item)
      ? {
          ...item,
          track: item.track.filter((stop) => stop.max === Infinity),
        }
      : item,
  );
  return move(guarded).map((item, index) => ({
    ...item,
    track: items[index].track,
  }));
}

/** Indices from `start` toward (not including) `end`, nearest first. */
function range(start: number, end: number): number[] {
  const step = end > start ? 1 : -1;
  const indices: number[] = [];
  for (let index = start; index !== end; index += step) indices.push(index);
  return indices;
}

function totalOf(
  items: readonly GroupItem[],
  indices: readonly number[],
): number {
  return indices.reduce((sum, index) => sum + items[index].size, 0);
}
