/**
 * The layout's rendering: what to render for a state. Each child's size, stop,
 * CSS and content hints, worked out from the committed layout fitted to its
 * group's space or moved by a live drag; which separators are dragged and
 * hovered; and the timing of the latest change. Before a group is
 * measured, flexbox approximates it.
 *
 * Renderings are cached by state, which is never changed in place.
 */
import { toCss } from "../foundation/css.js";
import {
  holdsContent,
  mayDepart,
  withHeldContent,
} from "../foundation/held-content.js";
import { own, setOwn } from "../foundation/own.js";
import { holdsWhileAnimating } from "../foundation/props.js";
import {
  type Track,
  UNNAMED,
  ZERO,
  contentSizeOf,
  contentStopOf,
  findStop,
  isNamed,
  isPoint,
  isRangeStop,
  within,
} from "../foundation/stops.js";
import {
  MIN_MOVE,
  type TransitionTiming,
  transitionFor,
  transitionOf,
} from "../foundation/transition.js";
import type { GroupSpace, LayoutState } from "./layout-config.js";
import { fallbackSize, homeStop } from "./layout-extents.js";
import { draggedItems, fittedItems } from "./layout-fit.js";
import { draggedPairs, linesOf, pairsOf } from "./separators.js";
import { type GroupItem, isStepped } from "./solver.js";
import {
  type ChildNode,
  type GroupNode,
  type SeparatorPair,
  indexTree,
} from "./tree.js";

/** One child as rendered. */
export interface ChildRendering {
  readonly id: string;
  /** A child of a group, or a grid's column or row (a track). */
  readonly kind: ChildNode["kind"];
  /** Size along its group's axis, or `null` before measurement. */
  readonly size: number | null;
  /**
   * Its size as drawn, as its `flex` (or grid track) draws it (see
   * `drawnSizes`): `size`, but where its padding and border don't fit in
   * it, or its group is past its space, when the children share the space
   * in proportion (see `squeezed`). `null` before measurement. What the
   * groups inside it are given (see `respace`).
   */
  readonly drawn: number | null;
  /**
   * The stop it's in (`UNNAMED` without named stops), or `null` before
   * measurement when that isn't known yet.
   */
  readonly stop: string | null;
  /** Its stops in pixels, or `null` before measurement. */
  readonly track: Track | null;
  /** CSS `flex` value. */
  readonly flex: string;
  /**
   * Its size as a grid track, for a grid's template: once measured, its size
   * in pixels; before, an approximation (see `unmeasuredChildren`).
   */
  readonly template: string;
  /**
   * The size to lay content out at, or `null` before measurement: the size
   * it's drawn at while it's in a range, and at a point (a rail, or 0) the
   * size of the range it would go back to (see `contentSizeOf`).
   */
  readonly contentSize: number | null;
  /** The stop whose content to show (see `contentStopOf`). */
  readonly contentStop: string | null;
  /**
   * The stop chosen for it, while it's stepped down from there to fit (see
   * `stepDown`, and `GroupItem.yielded`); else `null`.
   */
  readonly yieldedFrom: string | null;
  /**
   * Whether it rests at a size of 0, with nothing to show: it's hidden (from
   * view, focus and assistive tech) once any transition ends.
   */
  readonly hidden: boolean;
}

/** What to render for a state (see `getLayoutRendering`). */
export interface LayoutRendering {
  /** Every child, by id (everything but the root group). */
  readonly nodes: ReadonlyMap<string, ChildRendering>;
  /** The separators being dragged. */
  readonly dragging: readonly SeparatorPair[];
  /**
   * The separators a press under the mouse or pen would drag, worked out
   * the same way: what `dragging` would be.
   */
  readonly hovered: readonly SeparatorPair[];
  /** Whether some group's minimum sizes don't fit in its space. */
  readonly overflowing: boolean;
  /**
   * By how much each measured group's children are wider than its space
   * (their minimums don't fit), by id; 0 when they fit.
   */
  readonly shortfalls: ReadonlyMap<string, number>;
  /** CSS `transition` value, or `undefined` when this change shouldn't animate. */
  readonly transition: string | undefined;
  /**
   * The latest change's timing, while it should animate (not during drags):
   * what `transition` is made of, for grids' templates.
   */
  readonly timing: TransitionTiming | null;
  /**
   * The timing for content that moves with the latest change (`null` when it
   * doesn't animate): see `--resizable-duration`.
   */
  readonly contentTiming: TransitionTiming | null;
  /** Whether a committed change is still transitioning (not during drags). */
  readonly animating: boolean;
}

/** A group's items to render: a live drag, or the layout fitted to the space. */
export function currentItems(
  state: LayoutState,
  group: GroupNode,
): GroupItem[] {
  return draggedItems(state, group) ?? fittedItems(state, group);
}

/**
 * Renderings already worked out, by state. States are never changed in
 * place, so a state's rendering never goes stale; during a drag the hook
 * and the controller ask for the same one.
 */
const renderings = new WeakMap<LayoutState, LayoutRendering>();

/** What to render: each child's size and stop, and the separators' state. */
export function getLayoutRendering(state: LayoutState): LayoutRendering {
  let rendering = renderings.get(state);
  if (!rendering) {
    rendering = deriveRendering(state);
    renderings.set(state, rendering);
  }
  return rendering;
}

const contentRenderings = new WeakMap<LayoutState, LayoutRendering>();

/**
 * What the elements and groups show, with their content as it's laid out.
 * Usually the same as `getLayoutRendering`; but while an animated change
 * takes a child to a point, its content leaves at the size it had when the
 * change began; an animated change that interrupted another carries its
 * content on at the size it was laid out at; and reflowing once (`reflow:
 * "once"`), each child's content
 * keeps the size and stop it had through a drag, and through an animated
 * change, the larger of its size before and after (at the new stop, so a
 * crossfade runs alongside): content sized by `--resizable-content-*` is
 * laid out again once, when it's over (see `withHeldContent`).
 */
export function getLayoutContentRendering(state: LayoutState): LayoutRendering {
  const held = state.heldContent;
  const holding = holdsContent(state);
  if (!held || !(holding || mayDepart(state))) return getLayoutRendering(state);
  let rendering = contentRenderings.get(state);
  if (!rendering) {
    const live = getLayoutRendering(state);
    const nodes = new Map<string, ChildRendering>();
    const { nodes: parts } = indexTree(state.config.root);
    for (const [id, node] of live.nodes) {
      const part = parts.get(id);
      nodes.set(
        id,
        withHeldContent(node, held.get(id), {
          holding,
          dragging: state.drag !== null,
          departing:
            mayDepart(state) &&
            node.stop !== null &&
            part !== undefined &&
            "stops" in part &&
            !isRangeStop(part, node.stop),
          continuing:
            mayDepart(state) &&
            holdsWhileAnimating(true, own(state.fromStops, id), node.stop),
        }),
      );
    }
    rendering = { ...live, nodes };
    contentRenderings.set(state, rendering);
  }
  return rendering;
}

/** What to render for a state (see `getLayoutRendering`). */
function deriveRendering(state: LayoutState): LayoutRendering {
  const { config, drag } = state;
  // For content that moves with a change (a crossfade between stops): the
  // change's own timing, and while dragging, the drag's (stops it passes
  // through change as it goes, and its release animates with it).
  const contentTiming = transitionFor(
    config.transition,
    drag ? "drag" : state.animate,
    state.reducedMotion,
  );
  const timing = drag ? null : transitionOf(state);
  // Both, in step: see `flex` below.
  const transition = timing
    ? `flex-grow ${timing.duration}ms ${timing.easing}, ` +
      `flex-basis ${timing.duration}ms ${timing.easing}`
    : undefined;

  const animating = state.animating && !drag;
  const nodes = new Map<string, ChildRendering>();
  const shortfalls = new Map<string, number>();
  let overflowing = false;
  for (const group of indexTree(config.root).groups) {
    const space = own(state.spaces, group.id);
    if (!space) {
      unmeasuredChildren(state, group).forEach((rendering, index) => {
        const child = group.children[index];
        nodes.set(child.id, { ...rendering, id: child.id, kind: child.kind });
      });
      continue;
    }
    const items = currentItems(state, group);
    const used = items.reduce((sum, item) => sum + item.size, 0);
    shortfalls.set(group.id, Math.max(0, used - space.available));
    const { parts, over } = flexPartsOf(group, items, space);
    if (over) overflowing = true;
    const drawn = drawnSizes(group, items, space, parts);
    items.forEach((item, index) => {
      const child = group.children[index];
      const known = own(state.places, child.id);
      // Where a toggle would go back to: its last range, or its home.
      const back = known?.lastRange ?? homeStop(state, child, group);
      const previous = own(state.previousStops, child.id) ?? null;
      // From the size it's drawn at, which content is laid out at.
      const contentSize = contentSizeOf(
        child,
        item.track,
        item.stop,
        drawn[index],
        back,
        (range) =>
          within(
            range,
            own(known?.sizes, range.name) ??
              fallbackSize(state, group, child, range),
          ),
      );
      nodes.set(child.id, {
        id: child.id,
        kind: child.kind,
        size: item.size,
        drawn: drawn[index],
        stop: item.stop,
        track: item.track,
        flex: flexCss(parts[index], own(space.basisOffsets, child.id) ?? 0),
        template: `${sharp(drawn[index])}px`,
        contentSize,
        contentStop: contentStopOf(child, item.stop, previous, back),
        yieldedFrom: item.yielded && isStepped(item) ? item.yielded.from : null,
        hidden:
          (child.hideAtZero ?? config.hideAtZero) &&
          !animating &&
          item.size < ZERO,
      });
    });
  }

  return {
    nodes,
    dragging: draggedPairs(state),
    hovered:
      state.hovered && !config.disabled
        ? pairsOf(linesOf(state, state.hovered))
        : [],
    overflowing,
    shortfalls,
    transition,
    timing,
    contentTiming,
    animating,
  };
}

/** A child's CSS `flex`, in parts: see `flexPartsOf`. */
export interface FlexParts {
  /** Its flex-grow. */
  readonly grow: number;
  /** Its flex-basis, as its whole box (padding and border included). */
  readonly basis: number;
  /** Its padding and border: flexbox never draws it smaller. */
  readonly floor: number;
}

/**
 * Each of a measured group's children's CSS `flex`, so it ends up at
 * exactly its size, and whether the group is past its space (`over`).
 * Flexbox starts each child at its basis, then shares out what's left by
 * flex-grow. A child at a point (a strip, a rail, 0) is its size outright,
 * its basis, so it's left out of the sharing and the browser's rounding of
 * it: it can't come out a fraction off, shifting what follows. A child in
 * a range starts at its own padding and border, and grows by the rest of
 * its size.
 *
 * The bases and grows add up to the group's space, before a change and
 * after it, so with both transitioning in step, they do at every moment
 * between too: each child moves straight from one size to the other, as
 * its share never drifts.
 *
 * A child that keeps its size (`keepSize`, while a sibling can take the
 * change instead) is its size outright too, as the solver would keep it.
 * When the group's space changes from outside (a sidebar beside it
 * resizing), the browser's own layout then already gives the change to
 * the others, rather than sharing it out in proportion first and having
 * the measurement correct it.
 *
 * Past its space, every child grows from its padding and border by the
 * rest of its size, so they share what's left in proportion: not fixed at
 * their shares, as the group's space is what they add up to, so it could
 * never grow back (a group measured closed, say, opening).
 */
function flexPartsOf(
  group: GroupNode,
  items: readonly GroupItem[],
  space: GroupSpace,
): { parts: FlexParts[]; over: boolean } {
  const floors = group.children.map((child) => own(space.bases, child.id) ?? 0);
  const used = items.reduce((sum, item) => sum + item.size, 0);
  const over = used > space.available + 0.5 && used > 0;
  // Whether the siblings that don't keep their size (fills included) can
  // take a change of space in CSS: those in a range grow by what they are
  // past their padding, and flexbox hands out only that fraction of new
  // space when the grows add up to less than 1. Then those that keep their
  // size are their size outright. Otherwise they grow too: the browser
  // would leave new space empty, and the group's measured children
  // wouldn't add up to it.
  const othersGrow = items.reduce((sum, item, index) => {
    const stop = findStop(item.track, item.stop);
    if (group.children[index].keepSize || !stop || isPoint(stop)) return sum;
    return sum + Math.max(0, item.size - floors[index]);
  }, 0);
  const parts = items.map((item, index): FlexParts => {
    const floor = floors[index];
    const stop = findStop(item.track, item.stop);
    const outright =
      !over &&
      ((group.children[index].keepSize && othersGrow >= 1) ||
        (stop !== undefined && isPoint(stop)));
    return outright
      ? { grow: 0, basis: Math.max(item.size, floor), floor }
      : { grow: Math.max(0, item.size - floor), basis: floor, floor };
  });
  return { parts, over };
}

/**
 * CSS `flex` for a child's `parts`. For `content-box`, CSS takes the basis
 * without its padding and border (`basisOffset`).
 */
function flexCss(parts: FlexParts, basisOffset: number): string {
  return `${sharp(parts.grow)} 1 ${sharp(parts.basis - basisOffset)}px`;
}

/**
 * A measured group's children's sizes as the browser draws them: their
 * `flex` laid out (see `flexAllocation`), or a grid's tracks, `squeezed`.
 * That's their sizes, but where a child's padding and border are more
 * than its size (a closed pane with padding), or the group is past its
 * space. One rule for drawing them, for what the groups inside are given,
 * and for what content is laid out at, so they agree. As they are before
 * the group is measured.
 */
export function drawnSizes(
  group: GroupNode,
  items: readonly GroupItem[],
  space: GroupSpace | undefined,
  parts?: readonly FlexParts[],
): number[] {
  const sizes = items.map((item) => item.size);
  if (!space) return sizes;
  // A grid's tracks are its template's sizes in pixels, not flexed.
  if (group.children[0]?.kind === "track") {
    return squeezed(sizes, space.available);
  }
  return flexAllocation(
    space.available,
    parts ?? flexPartsOf(group, items, space).parts,
  );
}

/**
 * The sizes flexbox draws children with `parts` at in `available` (no
 * maximums, `flex-shrink: 1`): each starts at its basis, never below its
 * floor. With room left, those that grow share it by their grows (only
 * that fraction of it if the grows add up to less than 1: the rest is
 * left empty). Short of room, those above their floors give it up in
 * proportion to how far above they start, none going below its floor.
 */
export function flexAllocation(
  available: number,
  parts: readonly FlexParts[],
): number[] {
  const start = parts.map((part) => Math.max(part.basis, part.floor));
  const free = available - start.reduce((sum, size) => sum + size, 0);
  if (free >= 0) {
    const grows = parts.reduce((sum, part) => sum + part.grow, 0);
    if (grows <= 0) return start;
    const shared = grows < 1 ? free * grows : free;
    return start.map(
      (size, index) => size + (shared * parts[index].grow) / grows,
    );
  }
  const sizes = [...start];
  const frozen = parts.map((part, index) => start[index] <= part.floor);
  // Each pass shrinks those still free; any that would go below their
  // floor stop there, and the others give up the rest.
  for (let pass = 0; pass <= parts.length; pass++) {
    const open = parts.flatMap((_, index) => (frozen[index] ? [] : [index]));
    const used = sizes.reduce(
      (sum, size, index) => sum + (frozen[index] ? size : start[index]),
      0,
    );
    const above = open.reduce(
      (sum, index) => sum + start[index] - parts[index].floor,
      0,
    );
    if (above <= 0) break;
    let clamped = false;
    for (const index of open) {
      const { floor } = parts[index];
      sizes[index] =
        start[index] + ((available - used) * (start[index] - floor)) / above;
      if (sizes[index] < floor) {
        sizes[index] = floor;
        frozen[index] = true;
        clamped = true;
      }
    }
    if (!clamped) break;
  }
  return sizes;
}

/**
 * Sizes as a grid draws its tracks in `available`: as they are, unless
 * they don't fit, when they share it in proportion (rather than run past
 * its edge).
 */
function squeezed(sizes: readonly number[], available: number): number[] {
  const used = sizes.reduce((sum, size) => sum + size, 0);
  if (used <= available + 0.5 || used <= 0) return [...sizes];
  return sizes.map((size) => (size * available) / used);
}

/**
 * To a ten-thousandth of a pixel, far finer than the browser lays out: so
 * arithmetic's noise (a child at 3e-14px rather than 0) doesn't make a
 * style that's new each time, which the browser would lay out and repaint
 * along with everything after it.
 */
function sharp(value: number): number {
  return Math.round(value * 1e4) / 1e4 || 0;
}

/**
 * Before a group is measured (server rendering, hydration), let flexbox
 * approximate it: a saved layout's proportions, or each child's default size
 * with the unsized children filling the rest.
 */
function unmeasuredChildren(
  state: LayoutState,
  group: GroupNode,
): ChildRendering[] {
  const someUnsized = group.children.some((child) => !child.defaultSize);

  return group.children.map((child) => {
    const known = own(state.places, child.id);
    // Without a committed or default stop, which stop the default size lands
    // in isn't known until the group is measured.
    const stopName =
      known?.stop ?? child.defaultStop ?? (isNamed(child) ? null : UNNAMED);
    const stop = child.stops.find((candidate) => candidate.name === stopName);
    const remembered = known ? own(known.sizes, known.stop) : undefined;
    // As a grid's track, the same: a point is its size, a remembered size a
    // share, and a default size that size, the unsized sharing the rest.
    let flex: string;
    let template: string;
    if (stop?.size) {
      // As CSS has it, so the server's HTML is right in any unit (a `%`,
      // against the whole group).
      flex = `0 0 ${toCss(stop.size)}`;
      template = toCss(stop.size);
    } else if (remembered !== undefined) {
      flex = `${remembered} 1 0px`;
      template = `minmax(0, ${remembered}fr)`;
    } else if (child.defaultSize) {
      const basis = `${child.defaultSize.value}${child.defaultSize.unit}`;
      flex = `${someUnsized ? 0 : 1} 1 ${basis}`;
      template = basis;
    } else {
      flex = "1 1 0px";
      template = "minmax(0, 1fr)";
    }
    return {
      id: child.id,
      kind: child.kind,
      size: null,
      drawn: null,
      stop: stopName,
      track: null,
      flex,
      template,
      contentSize: null,
      contentStop: contentStopOf(
        child,
        stopName,
        own(state.previousStops, child.id) ?? null,
        known?.lastRange ?? null,
      ),
      yieldedFrom: null,
      hidden: false,
    };
  });
}

/** Each node's stop (`null` if it has none yet), for `previousStops`. */
export function stopsOf(state: LayoutState): Record<string, string | null> {
  const stops: Record<string, string | null> = {};
  for (const [id, node] of getLayoutRendering(state).nodes) {
    setOwn(stops, id, node.stop);
  }
  return stops;
}

/**
 * Whether going from `before` to `after` plays a transition: the change
 * animates and some node's size actually moves.
 */
export function playsTransition(before: LayoutState, after: LayoutState) {
  const next = getLayoutRendering(after);
  if (!next.transition) return false;
  const previous = getLayoutRendering(before).nodes;
  return [...next.nodes.values()].some((node) => {
    const was = previous.get(node.id)?.size;
    return (
      node.size !== null && was != null && Math.abs(node.size - was) > MIN_MOVE
    );
  });
}
