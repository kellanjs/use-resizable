/**
 * The resizable model: an element whose size is its own, resized through
 * handles on its free edges and corners. Pure functions over a plain state
 * object; no DOM, no React, no timers.
 *
 * An element has one or two dimensions (see `dimension.ts`). Its anchor says
 * which part of it stays still, and from that come its handles. A drag is
 * stored as what was grabbed plus how far the pointer has moved, and
 * everything rendered is derived from that, so cancelling a drag is just
 * forgetting it.
 *
 * Two variations:
 * - With a locked aspect ratio, only the width is stored. The height follows
 *   it (the element gets CSS `aspect-ratio`), height handles drive the width
 *   through the ratio, and height limits become width limits.
 * - With `anchor: "none"` the element is floating: it stores where it is
 *   (see `position.ts`), resizing from a left or top edge moves it so the
 *   opposite edge stays put, and a move handle drags it around.
 *
 * The options, config and state shape are in `resizable-config.ts`; saving
 * and restoring is in `resizable-snapshot.ts`.
 */
import { type SlidingPart, recordSliding } from "../foundation/clip.js";
import { walkDrag } from "../foundation/drag-path.js";
import {
  type Corner,
  type Dimension,
  type Edge,
  type HandleEdge,
  anchorFactor,
  edgeDirection,
  edgesOf,
  keyboardCorner,
} from "../foundation/handle.js";
import {
  heldOf,
  holdsContent,
  mayDepart,
  withHeldContent,
} from "../foundation/held-content.js";
import type { KeyboardIntent } from "../foundation/keyboard.js";
import type { Limits } from "../foundation/limits.js";
import type { ElementSize } from "../foundation/observe-size.js";
import {
  holdsWhileAnimating,
  laidOutContentSize,
} from "../foundation/props.js";
import {
  type Size,
  type SizeContext,
  type Viewport,
  px,
  resolveMax,
  resolveMin,
  resolveSize,
  usesViewportUnits,
} from "../foundation/size.js";
import {
  EPSILON,
  ZERO,
  checkStop,
  findStop,
  isRangeStop,
  land,
  reach,
  reachedStop,
  resolveTrack,
} from "../foundation/stops.js";
import {
  MIN_MOVE,
  type TransitionTiming,
  transitionFor,
  transitionOf,
} from "../foundation/transition.js";
import {
  type DimensionConfig,
  type DimensionDrag,
  type DimensionRendering,
  type DimensionState,
  applyKey,
  initialDimension,
  moveTo,
  renderDimension,
  sameDimensionState,
  settleDrag,
  toggleStop,
} from "./dimension.js";
import {
  type Point,
  type PositionRendering,
  type PositionState,
  type Rect,
  initialPosition,
  keepInside,
  renderPoint,
  renderUnmeasured,
  resolvePoint,
} from "./position.js";
import {
  DIMENSIONS,
  type DragTarget,
  type MeasuredContainer,
  type ResizableConfig,
  type ResizableDrag,
  type ResizableState,
  storedDimension,
} from "./resizable-config.js";

export interface ResizableRendering {
  readonly width: DimensionRendering | null;
  /** For a ratio-locked element, derived from the width (`css` is "auto"). */
  readonly height: DimensionRendering | null;
  readonly position: PositionRendering | null;
  /** What's being dragged, if anything. */
  readonly dragging: DragTarget | null;
  /** CSS `transition` value, or `undefined` when this change shouldn't animate. */
  readonly transition: string | undefined;
  /**
   * The timing for content that moves with the latest change (`null` when it
   * doesn't animate): see `--resizable-duration`.
   */
  readonly contentTiming: TransitionTiming | null;
  /** Whether a committed change is still transitioning (not during drags). */
  readonly animating: boolean;
  /**
   * Whether the element rests at a size of 0, with nothing to show: it's
   * hidden (from view, focus and assistive tech) once any transition ends.
   */
  readonly hidden: boolean;
}

// --- Deriving the rendering --------------------------------------------------

function contextFor(
  state: ResizableState,
  dimension: Dimension,
): SizeContext | null {
  const { container } = state;
  return container
    ? {
        containerSize: container[dimension],
        rootFontSize: container.rootFontSize,
        viewport: container.viewport,
      }
    : null;
}

/**
 * How much the stored `dimension` grows per pixel the pointer moves along each
 * axis while dragging `target`, or `null` if the drag doesn't resize it. With
 * a locked ratio, a height edge grows the width through the ratio.
 */
function growthRates(
  config: ResizableConfig,
  target: DragTarget,
  dimension: Dimension,
): { readonly x: number; readonly y: number } | null {
  if (target === "move") return null;
  const edges = edgesOf(target);
  let x = 0;
  let y = 0;
  if (dimension === "width" && config.width && edges.width) {
    x = edgeDirection(edges.width) * anchorFactor(config.width.anchor);
  }
  if (dimension === "width" && config.aspect && edges.height) {
    y =
      edgeDirection(edges.height) *
      anchorFactor(config.aspect.heightAnchor) *
      config.aspect.ratio;
  }
  if (dimension === "height" && config.height && edges.height) {
    y = edgeDirection(edges.height) * anchorFactor(config.height.anchor);
  }
  return x === 0 && y === 0 ? null : { x, y };
}

/** How much the current drag has grown `dimension`, if it resizes it at all. */
function dragFor(
  state: ResizableState,
  dimension: Dimension,
): DimensionDrag | null {
  const { drag } = state;
  const from = drag?.from[dimension];
  if (!drag || from == null) return null;
  const rates = growthRates(state.config, drag.target, dimension);
  if (!rates) return null;

  // Only a corner on a ratio-locked element pulls on both axes; otherwise
  // one rate is 0 and the other pull is the growth.
  const reached = drag.reached[dimension];
  if (!rates.x || !rates.y) {
    return { from, growth: drag.dx * rates.x + drag.dy * rates.y, reached };
  }
  return { from, growth: cornerGrowth(state.config, drag, rates), reached };
}

/** How much a ratio-locked corner drag grows the width (see `cornerDrag`). */
function cornerGrowth(
  config: ResizableConfig,
  drag: ResizableDrag,
  rates: { readonly x: number; readonly y: number },
): number {
  if (config.aspect?.cornerDrag === "axis") {
    const fromX = drag.dx * rates.x;
    const fromY = drag.dy * rates.y;
    // Pulled the same way, the further pull wins, so the corner stays on the
    // pointer along that axis; pulled opposite ways, they offset each other.
    // (Letting the further pull win there too jumps from shrinking to
    // growing the moment a pull out overtakes a pull in.)
    return fromX * fromY >= 0
      ? Math.abs(fromX) >= Math.abs(fromY)
        ? fromX
        : fromY
      : fromX + fromY;
  }
  // The corner moves 1 / rate px along each axis per px of growth: put it at
  // the point on that path nearest the pointer.
  return (
    (drag.dx / rates.x + drag.dy / rates.y) /
    (1 / rates.x ** 2 + 1 / rates.y ** 2)
  );
}

/**
 * Extra limits on a stored dimension: a ratio-locked height's limits (as
 * width), and for a confined floating element, its room (see `roomFor`).
 */
function boundsFor(
  state: ResizableState,
  dimension: Dimension,
  target: DragTarget | null,
  rect: Rect | null,
): Limits | undefined {
  const { aspect } = state.config;
  const { container } = state;
  if (!container) return undefined;
  let min = 0;
  let max = roomFor(state, dimension, target, rect);

  if (dimension === "width" && aspect) {
    const context = {
      containerSize: container.height,
      rootFontSize: container.rootFontSize,
      viewport: container.viewport,
    };
    min = resolveMin(aspect.minHeight, context) * aspect.ratio;
    max = Math.min(max, resolveMax(aspect.maxHeight, context) * aspect.ratio);
  }

  return min === 0 && max === Infinity ? undefined : { min, max };
}

/**
 * How big a confined floating element can get: never bigger than its
 * container, and resized from `target`, no further than the container's
 * edge on that side. Unlike its own limits, the container's edge doesn't
 * stretch. `Infinity` when it isn't confined.
 */
function roomFor(
  state: ResizableState,
  dimension: Dimension,
  target: DragTarget | null,
  rect: Rect | null,
): number {
  const { aspect, position } = state.config;
  const { container } = state;
  if (!position?.confined || !container) return Infinity;
  const toWidth = (width: number, height: number) =>
    aspect ? Math.min(width, height * aspect.ratio) : width;

  // Never bigger than the container, whatever asks for the size.
  let room = {
    width: container.width,
    height: container.height,
  };
  if (rect && target && target !== "move") {
    const edges = edgesOf(target);
    room = {
      width:
        edges.width === "left" ? rect.x + rect.width : container.width - rect.x,
      height:
        edges.height === "top"
          ? rect.y + rect.height
          : container.height - rect.y,
    };
  }
  return dimension === "height"
    ? room.height
    : toWidth(room.width, room.height);
}

/**
 * The stops of `dimension` whose smallest size, as its limits resolve
 * (`wins` included), is bigger than the room a confined element has on
 * the side `target` resizes: a move from there can't reach them (see
 * `reachableConfig`).
 */
function beyondRoom(
  state: ResizableState,
  dimension: Dimension,
  target: DragTarget | null,
  rect: Rect | null,
): Set<string> {
  const config = state.config[dimension];
  const context = contextFor(state, dimension);
  if (!config || !rect || !target || target === "move" || !context) {
    return new Set();
  }
  const room = roomFor(state, dimension, target, rect);
  if (room === Infinity) return new Set();
  const track = resolveTrack(
    config,
    context,
    boundsFor(state, dimension, null, null),
  );
  return new Set(
    track.filter((stop) => stop.min > room + EPSILON).map((stop) => stop.name),
  );
}

/**
 * A dimension's options as a move from `target` sees them: resizing from
 * there, a confined element can't reach a stop whose smallest size is
 * bigger than its room that way (a point, or a range's minimum), so a drag
 * (or key) lands short of it, on a stop that fits, rather than show it at
 * a size it isn't, or past the container's edge. `setStop` still goes
 * there (kept inside, from either edge).
 */
function reachableConfig(
  state: ResizableState,
  dimension: Dimension,
  target: DragTarget | null,
  rect: Rect | null,
): DimensionConfig | null {
  const config = state.config[dimension];
  const context = contextFor(state, dimension);
  if (!config || !rect || !target || target === "move" || !context) {
    return config;
  }
  const beyond = beyondRoom(state, dimension, target, rect);
  if (beyond.size === 0) return config;
  const stops = config.stops.map((stop) =>
    beyond.has(stop.name) ? { ...stop, onlyByName: true } : stop,
  );
  return stops.every((stop, index) => stop === config.stops[index])
    ? config
    : { ...config, stops };
}

/**
 * A stored dimension's rendering. Its limits include the room a confined
 * element has on the side `target` resizes (the drag's handle by
 * default).
 */
function dimensionRenderingOf(
  state: ResizableState,
  dimension: Dimension,
  target: DragTarget | null = state.drag?.target ?? null,
  rect: Rect | null = dragRect(state),
): DimensionRendering | null {
  const config = reachableConfig(state, dimension, target, rect);
  const current = state[dimension];
  if (!config || !current) return null;
  // Not resized by the drag, but grabbed mid-change: where it was shown.
  const frozen = state.drag?.frozen?.[dimension];
  if (frozen !== undefined && !dragFor(state, dimension)) {
    const resting = renderDimension(
      config,
      current,
      state.previousStops[dimension] ?? null,
      contextFor(state, dimension),
      null,
      state.config.elastic,
      boundsFor(state, dimension, target, rect),
    );
    return { ...resting, size: frozen, css: `${frozen}px` };
  }
  const rendering = renderDimension(
    config,
    current,
    state.previousStops[dimension] ?? null,
    contextFor(state, dimension),
    dragFor(state, dimension),
    state.config.elastic,
    boundsFor(state, dimension, target, rect),
    ratioLimitsBefore(state, dimension),
  );
  // An elastic stretch goes past the element's own limits, but a confined
  // element's container doesn't give: it stays inside even mid-stretch
  // (unless its resolved minimum is bigger: by default, with `wins:
  // "min"`, a minimum wins over the room).
  const room = roomFor(state, dimension, target, rect);
  if (rendering.size === null || rendering.size <= room) return rendering;
  const own =
    rendering.track &&
    rendering.stop !== null &&
    findStop(rendering.track, rendering.stop);
  const size = Math.max(room, own ? own.min : 0);
  return size >= rendering.size
    ? rendering
    : { ...rendering, size, css: `${size}px` };
}

/**
 * The sizes the user can reach from an edge handle, from its dimension's
 * smallest stop to its largest (a ratio-locked height's, through its width),
 * and for a confined floating element, within that handle's room: the left
 * handle can only grow it as far as the container's left edge. `null`
 * before measuring.
 */
export function handleReach(
  state: ResizableState,
  handle: HandleEdge,
  dimension: Dimension = handle === "left" || handle === "right"
    ? "width"
    : "height",
): Limits | null {
  const onWidth = dimension === "width";
  const rendering = getResizableRendering(state);
  let resized: DimensionRendering | null = rendering[dimension];
  const rect = rectOf(rendering, { width: 0, height: 0 });
  if (state.config.position?.confined && !state.drag && rect) {
    // Within this handle's room (a corner's both ways). A ratio-locked
    // height follows its width.
    const width = dimensionRenderingOf(state, "width", handle, rect);
    const { aspect } = state.config;
    if (onWidth) resized = width;
    else if (aspect) resized = width && followWidth(width, aspect.ratio);
    else resized = dimensionRenderingOf(state, "height", handle, rect);
  }
  return resized?.track ? reach(resized.track, resized.stop) : null;
}

/**
 * Where Enter takes `dimension` (to `next`), from `target`: where a drag
 * from there could, so a confined element's stop beyond its room that way
 * is refused (`null`), and a size it remembers that's bigger than the
 * room is the room, as a drag lands there. Unless it's to the stop
 * `enterToggles` names, which (as `setStop` does) may be anywhere.
 */
function reachedByEnter(
  state: ResizableState,
  dimension: Dimension,
  next: DimensionState,
  intent: KeyboardIntent,
  rect: Rect | null,
  target: DragTarget,
): DimensionState | null {
  const config = state.config[dimension];
  if (intent.kind !== "toggle" || !rect || !config) return next;
  if (next.stop !== null && next.stop === config.enterToggles) return next;
  const moved: ResizableState = { ...state, [dimension]: next };
  // Where it rests, as the handle sees it (within its room), and as it
  // would without the room.
  const reached = dimensionRenderingOf(moved, dimension, target, rect);
  const free = dimensionRenderingOf(moved, dimension, null, rect);
  if (!reached || reached.stop === null || reached.size === null) return next;
  if (beyondRoom(state, dimension, target, rect).has(reached.stop)) return null;
  return free?.size != null && reached.size < free.size - EPSILON
    ? moveTo(config, next, reached.stop, reached.stop, px(reached.size))
    : next;
}

/**
 * Before measurement, a ratio-locked width's limits from its height's,
 * through the ratio, as sizes for its CSS (`boundsFor` gives them once
 * measured), so the server's HTML is right: those a width can say (a `%`
 * of the container's height can't be).
 */
function ratioLimitsBefore(
  state: ResizableState,
  dimension: Dimension,
): { min: Size[]; max: Size[] } | undefined {
  const { aspect } = state.config;
  if (dimension !== "width" || !aspect || state.container) return undefined;
  const through = (sizes: readonly Size[] | undefined) =>
    (sizes ?? [])
      .filter((size) => size.unit !== "%")
      .map((size) => ({ ...size, value: size.value * aspect.ratio }));
  return { min: through(aspect.minHeight), max: through(aspect.maxHeight) };
}

/** A ratio-locked height, derived from the width's rendering. */
function followWidth(
  width: DimensionRendering,
  ratio: number,
): DimensionRendering {
  const scale = (value: number) => value / ratio;
  return {
    size: width.size === null ? null : scale(width.size),
    contentSize: width.contentSize === null ? null : scale(width.contentSize),
    stop: width.stop,
    contentStop: width.contentStop,
    track:
      width.track &&
      width.track.map((stop) => ({
        ...stop,
        min: scale(stop.min),
        max: scale(stop.max),
      })),
    // CSS `aspect-ratio` sizes the height, even before measurement.
    css: "auto",
  };
}

/**
 * Where a drag puts a floating element at `size`. Moving offsets it;
 * resizing from the left or top moves it so the opposite edge stays put.
 * Confined, it's kept inside the container, at the size it is now: one
 * the app sizes can change mid-drag (its text rewrapping, as it narrows),
 * as `own` follows it. (Along what a drag resizes, its room already
 * keeps it in.)
 */
function dragPoint(
  state: ResizableState,
  drag: ResizableDrag,
  rect: Rect,
  size: ElementSize,
): Point {
  const point =
    drag.target === "move"
      ? { x: rect.x + drag.dx, y: rect.y + drag.dy }
      : resizedPoint(drag.target, rect, size);
  const { container } = state;
  if (!state.config.position?.confined || !container) return point;
  const inside = keepInside(point, size, container);
  if (drag.target === "move") return inside;
  const edges = edgesOf(drag.target);
  return {
    x: edges.width ? point.x : inside.x,
    y: edges.height ? point.y : inside.y,
  };
}

/**
 * Where a floating element's drag began (its rect), kept inside its
 * container as it is now, if confined: a container that shrinks mid-drag
 * takes the drag with it, as it would the element at rest, rather than
 * leave it past the edge (its room on the side it's resized from, and the
 * edge that stays, are from here).
 */
function dragRect(state: ResizableState): Rect | null {
  const rect = state.drag?.rect ?? null;
  const { container } = state;
  if (!rect || !container || !state.config.position?.confined) return rect;
  const point = keepInside(rect, rect, container);
  return point.x === rect.x && point.y === rect.y
    ? rect
    : { ...rect, ...point };
}

/**
 * A floating element's size mid-drag: what's rendered, and a dimension
 * the app sizes as drawn now (see `own`), or as it was grabbed.
 */
function dragSize(
  state: ResizableState,
  rendering: Pick<ResizableRendering, "width" | "height">,
  rect: Rect,
): ElementSize {
  return {
    width: rendering.width?.size ?? state.own?.width ?? rect.width,
    height: rendering.height?.size ?? state.own?.height ?? rect.height,
  };
}

/**
 * Where a floating element resized from `handle` sits at its new `size`:
 * from the left or top, it moves so the opposite edge stays put.
 */
function resizedPoint(
  handle: HandleEdge,
  rect: Rect,
  size: ElementSize,
): Point {
  const edges = edgesOf(handle);
  return {
    x: edges.width === "left" ? rect.x + rect.width - size.width : rect.x,
    y: edges.height === "top" ? rect.y + rect.height - size.height : rect.y,
  };
}

/**
 * The position to keep once a drag or key has taken a floating element from
 * `shown` to `point` at `size`. An axis the change moved it along takes the
 * new place, and so does one whose size changed while it was shown away from
 * its stored place (kept inside a smaller container), so it stays where it
 * was seen. Every other axis keeps its stored position, `%` included, so a
 * confined element still goes back there when there's room.
 */
function keptPosition(
  state: ResizableState,
  shown: Rect,
  point: Point,
  size: ElementSize,
): PositionState | null {
  const { position } = state;
  if (!position) return null;
  const stored = storedPoint(state);
  const differs = (a: number, b: number) => Math.abs(a - b) > 0.5;
  const axis = (key: "x" | "y", dimension: "width" | "height") => {
    const moved = differs(point[key], shown[key]);
    const resized = differs(size[dimension], shown[dimension]);
    const displaced = stored !== null && differs(stored[key], shown[key]);
    return moved || (resized && displaced) ? px(point[key]) : position[key];
  };
  const x = axis("x", "width");
  const y = axis("y", "height");
  return x === position.x && y === position.y ? position : { x, y };
}

function storedPoint(state: ResizableState): Point | null {
  const { position } = state;
  const width = contextFor(state, "width");
  const height = contextFor(state, "height");
  return position && width && height
    ? resolvePoint(position, width, height)
    : null;
}

/**
 * Renderings already worked out, by state. States are never changed in
 * place, so a state's rendering never goes stale; during a drag the hook,
 * the controller and the model all ask for the same one.
 */
const renderings = new WeakMap<ResizableState, ResizableRendering>();

/** What to render: each dimension's size and stop, and the drag's state. */
export function getResizableRendering(
  state: ResizableState,
): ResizableRendering {
  let rendering = renderings.get(state);
  if (!rendering) {
    rendering = deriveRendering(state);
    renderings.set(state, rendering);
  }
  return rendering;
}

const contentRenderings = new WeakMap<ResizableState, ResizableRendering>();

/**
 * What the element shows, with its content as it's laid out. Usually the
 * same as `getResizableRendering`; but while an animated change takes a
 * dimension to a point, its content leaves at the size it had when the
 * change began; an animated change that interrupted another carries its
 * content on at the size it was laid out at; and reflowing once (`reflow:
 * "once"`), the content keeps the size and stop it had through a drag, and
 * through an animated change, the larger of its size before and after (at
 * the new stop, so a crossfade runs alongside): content sized by
 * `--resizable-content-*` is laid out again once, when it's over (see
 * `withHeldContent`, which says which comes first).
 */
export function getResizableContentRendering(
  state: ResizableState,
): ResizableRendering {
  const held = state.heldContent;
  const holding = holdsContent(state);
  if (!held || !(holding || mayDepart(state))) {
    return getResizableRendering(state);
  }
  let rendering = contentRenderings.get(state);
  if (!rendering) {
    const live = getResizableRendering(state);
    const how = (dimension: Dimension, stop: string | null) => ({
      holding,
      dragging: state.drag !== null,
      departing:
        mayDepart(state) &&
        stop !== null &&
        !!state.config[dimension] &&
        !isRangeStop(state.config[dimension], stop),
      continuing:
        mayDepart(state) &&
        holdsWhileAnimating(true, state.fromStops?.[dimension], stop),
    });
    const width =
      live.width &&
      withHeldContent(live.width, held.width, how("width", live.width.stop));
    const { aspect } = state.config;
    rendering = {
      ...live,
      width,
      // A ratio-locked height follows its width, content and all.
      height:
        aspect && width
          ? followWidth(width, aspect.ratio)
          : live.height &&
            withHeldContent(
              live.height,
              held.height,
              how("height", live.height.stop),
            ),
    };
    contentRenderings.set(state, rendering);
  }
  return rendering;
}

/** What to render for a state (see `getResizableRendering`). */
function deriveRendering(state: ResizableState): ResizableRendering {
  const { config, drag } = state;
  const width = dimensionRenderingOf(state, "width");
  const height =
    config.aspect && width
      ? followWidth(width, config.aspect.ratio)
      : dimensionRenderingOf(state, "height");

  let position: PositionRendering | null = null;
  if (state.position) {
    const point = storedPoint(state);
    if (!point) position = renderUnmeasured(state.position);
    else if (drag?.rect) {
      const rect = dragRect(state)!;
      const size = dragSize(state, { width, height }, rect);
      position = renderPoint(dragPoint(state, drag, rect, size));
    } else if (config.position?.confined && state.container) {
      // Shown inside the container, whatever moved it there (setSize,
      // setPosition, the container shrinking). The stored position is
      // kept, so it comes back if there's room again.
      // A dimension the app sizes is as drawn (see `own`).
      const size = {
        width: width?.size ?? state.own?.width ?? 0,
        height: height?.size ?? state.own?.height ?? 0,
      };
      position = renderPoint(keepInside(point, size, state.container));
    } else position = renderPoint(point);
  }

  // For content that moves with a change (a crossfade between stops): the
  // change's own timing, and while dragging, the drag's (stops it passes
  // through change as it goes, and its release animates with it).
  const contentTiming = transitionFor(
    config.transition,
    drag ? "drag" : state.animate,
    state.reducedMotion,
  );
  const timing = drag ? null : transitionOf(state);
  // A ratio-locked height follows the width's transition through CSS.
  const properties = [
    ...DIMENSIONS.filter((dimension) => state[dimension]),
    ...(state.position ? ["left", "top"] : []),
  ];
  const transition = timing
    ? properties
        .map((property) => `${property} ${timing.duration}ms ${timing.easing}`)
        .join(", ")
    : undefined;

  const animating = state.animating && !drag;
  return {
    width,
    height,
    position,
    dragging: drag?.target ?? null,
    transition,
    contentTiming,
    animating,
    hidden:
      config.hideAtZero && !animating && (isZero(width) || isZero(height)),
  };
}

/** Each dimension's stop (`null` if it has none yet), for `previousStops`. */
export function stopsOf(state: ResizableState): Record<string, string | null> {
  const rendering = getResizableRendering(state);
  return {
    width: rendering.width?.stop ?? null,
    height: rendering.height?.stop ?? null,
  };
}

/** Whether a dimension is at zero, with nothing to show. */
export function isZero(rendering: DimensionRendering | null): boolean {
  if (!rendering) return false;
  // Before measuring, a point at zero renders as 0 in any unit ("0px",
  // "0%"); a range renders as clamp(…), which isn't a number.
  return rendering.size === null
    ? parseFloat(rendering.css) === 0
    : rendering.size < ZERO;
}

// --- Animation ---------------------------------------------------------------

/**
 * Whether going from `before` to `after` plays a transition: the change
 * animates and the element's size or position actually moves.
 */
export function playsTransition(
  before: ResizableState,
  after: ResizableState,
): boolean {
  const next = getResizableRendering(after);
  if (!next.transition) return false;
  const previous = getResizableRendering(before);
  const moved = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null && Math.abs(a - b) > MIN_MOVE;
  return (
    moved(previous.width?.size, next.width?.size) ||
    moved(previous.height?.size, next.height?.size) ||
    moved(previous.position?.x, next.position?.x) ||
    moved(previous.position?.y, next.position?.y)
  );
}

// --- Actions -----------------------------------------------------------------
// Each takes the current state and returns the next one. Those that check
// for it return the same object when nothing changes, so the store can skip
// notifying.

/** The root font size changed, so `rem` sizes resolve differently. */
export function setRootFontSize(
  state: ResizableState,
  rootFontSize: number,
): ResizableState {
  return state.container
    ? measure(state, { ...state.container, rootFontSize })
    : state;
}

/**
 * Whether a size is in `vw` or `vh`: one in the options, or one kept from
 * `setSize` or `setPosition` (`setSize("50vw")` stays relative, following
 * the window).
 */
export function usesViewport(state: ResizableState): boolean {
  return (
    usesViewportUnits(state.config) ||
    usesViewportUnits(state.width) ||
    usesViewportUnits(state.height) ||
    usesViewportUnits(state.position)
  );
}

/** The viewport changed, so `vw` and `vh` sizes resolve differently. */
export function setViewport(
  state: ResizableState,
  viewport: Viewport,
): ResizableState {
  return state.container
    ? measure(state, { ...state.container, viewport })
    : state;
}

export function measure(
  state: ResizableState,
  container: MeasuredContainer,
): ResizableState {
  const current = state.container;
  if (
    current?.width === container.width &&
    current.height === container.height &&
    current.rootFontSize === container.rootFontSize &&
    current.viewport?.width === container.viewport?.width &&
    current.viewport?.height === container.viewport?.height
  ) {
    return state;
  }
  // Measurement changes follow the layout; animating them would make the
  // element lag behind its container. While a change animates, it keeps
  // its timing.
  return {
    ...state,
    container,
    animate: state.animating ? state.animate : null,
  };
}

/**
 * The element's own size as drawn: what a confined element whose width or
 * height the app sizes is kept inside its container by (see `own`).
 */
export function measureOwn(
  state: ResizableState,
  own: ElementSize | null,
): ResizableState {
  if (own?.width === state.own?.width && own?.height === state.own?.height) {
    return state;
  }
  return { ...state, own, animate: state.animating ? state.animate : null };
}

/** Applies new options, adding or dropping dimensions as needed. */
export function setConfig(
  state: ResizableState,
  config: ResizableConfig,
): ResizableState {
  const keep = (dimension: Dimension) => {
    const dimensionConfig = config[dimension];
    if (!dimensionConfig) return null;
    return state[dimension] ?? initialDimension(dimensionConfig);
  };
  const target = state.drag?.target;
  const targetGone =
    target && target !== "move" && !config.handles.includes(target);
  return {
    ...state,
    config,
    width: keep("width"),
    height: keep("height"),
    position: config.position
      ? (state.position ?? initialPosition(config.position))
      : null,
    drag: targetGone ? null : state.drag,
    // Options derived from what's animating (a size computed from a value
    // that just changed) mustn't cut the animation short.
    animate: state.animating ? state.animate : null,
  };
}

/**
 * The element's rect, using the sizes this library sets and falling back to
 * the measured element for dimensions the app sizes itself.
 */
function rectOf(
  rendering: ResizableRendering,
  measured: ElementSize,
): Rect | null {
  const { position } = rendering;
  if (position?.x == null || position.y == null) return null;
  return {
    x: position.x,
    y: position.y,
    width: rendering.width?.size ?? measured.width,
    height: rendering.height?.size ?? measured.height,
  };
}

/**
 * Starts dragging `target`. `measured` is the element's current size, needed
 * for floating elements whose app-sized dimensions the model can't know, and
 * `placed` where it's shown in its container, if known.
 *
 * Mid-animation, the element is on its way somewhere: the drag starts from
 * where it's shown (`measured`, `placed`), not where it's going, so the
 * grabbed edge stays under the pointer.
 */
export function startDrag(
  state: ResizableState,
  target: DragTarget,
  measured: ElementSize = { width: 0, height: 0 },
  placed: Point | null = null,
): ResizableState {
  const { config } = state;
  if (config.disabled || state.drag) return state;
  if (target === "move" ? !config.position : !config.handles.includes(target))
    return state;

  const rendering = getResizableRendering(state);
  const shown = state.animating && measured.width > 0 && measured.height > 0;
  const from: Record<Dimension, number | null> = { width: null, height: null };
  const frozen: Partial<Record<Dimension, number>> = {};
  for (const dimension of DIMENSIONS) {
    if (!state[dimension]) continue;
    if (!growthRates(config, target, dimension)) {
      // Mid-change, one the drag doesn't resize stays where it's shown.
      if (shown) frozen[dimension] = measured[dimension];
      continue;
    }
    const size = rendering[dimension]?.size;
    // Can't drag before the element has been measured.
    if (size == null) return state;
    from[dimension] = shown ? measured[dimension] : size;
  }

  let rect = state.position ? rectOf(rendering, measured) : null;
  if (state.position && !rect) return state;
  if (rect && shown) {
    rect = { ...(placed ?? rect), ...measured };
  }
  return {
    ...holdContent(state, state, shown ? measured : undefined),
    drag: {
      target,
      from,
      rect,
      dx: 0,
      dy: 0,
      reached: { width: null, height: null },
      ...(Object.keys(frozen).length > 0 && { frozen }),
    },
  };
}

/**
 * `after`, keeping the content as `before` had it (see `heldContent`): for
 * a drag starting, or a change about to animate. `shown` is the element's
 * size as shown, mid-animation (measured: its rendering is where it's
 * going), so content is kept as it's laid out there, not as it would be.
 */
export function holdContent(
  before: ResizableState,
  after: ResizableState,
  shown?: ElementSize,
): ResizableState {
  const { width, height } = getResizableContentRendering(before);
  const laidOut = laidOutContent(before, shown);
  const interrupted = before.animating && before.drag === null;
  const held = (dimension: Dimension, rendering: DimensionRendering) => ({
    ...heldOf(rendering),
    contentSize: laidOut[dimension]?.content ?? rendering.contentSize,
    interrupted,
  });
  return {
    ...after,
    heldContent: {
      width: width && held("width", width),
      height: height && held("height", height),
    },
  };
}

/**
 * Each dimension's size as shown in `state` (`shown`, measured, or its
 * rendering), and its content wrapper's then (see `laidOutContentSize`);
 * `null` before measuring.
 */
function laidOutContent(
  state: ResizableState,
  shown?: Partial<Record<Dimension, number | null>>,
): Partial<Record<Dimension, { size: number | null; content: number | null }>> {
  const content = getResizableContentRendering(state);
  const holding = holdsContent(state);
  const animating = state.animating && state.drag === null;
  const result: Partial<
    Record<Dimension, { size: number | null; content: number | null }>
  > = {};
  for (const dimension of DIMENSIONS) {
    const rendering = content[dimension];
    if (!rendering) continue;
    const size = shown?.[dimension] ?? rendering.size;
    const holds =
      holding ||
      holdsWhileAnimating(
        animating,
        state.fromStops?.[dimension],
        rendering.stop,
      );
    result[dimension] = {
      size,
      content:
        size === null
          ? rendering.contentSize
          : laidOutContentSize(
              rendering.contentSize,
              rendering.size,
              size,
              holds,
              holding,
            ),
    };
  }
  return result;
}

/**
 * `after`, with whether each dimension's content slides through the change
 * in progress (see `recordSliding`). `shown`, as for `holdContent`.
 */
export function withSliding(
  before: ResizableState,
  after: ResizableState,
  begins: boolean,
  shown?: ElementSize,
): ResizableState {
  return recordSliding(before, after, begins, (was, now) =>
    slidingParts(was, now, shown),
  );
}

/** Each dimension, for `recordSliding`. */
function slidingParts(
  before: ResizableState,
  after: ResizableState,
  shown?: ElementSize,
): Record<string, SlidingPart> {
  const was = laidOutContent(before, shown);
  // As the change begins, the element is still where it was.
  const now = laidOutContent(after, {
    width: was.width?.size,
    height: was.height?.size,
  });
  const rendering = getResizableRendering(after);
  const parts: Record<string, SlidingPart> = {};
  for (const dimension of DIMENSIONS) {
    const stop = rendering[dimension]?.stop;
    if (stop === undefined) continue;
    parts[dimension] = {
      // A ratio-locked height has none: it follows its width.
      config: after.config[dimension],
      stop,
      size: was[dimension]?.size ?? null,
      content: was[dimension]?.content ?? null,
      contentAfter: now[dimension]?.content ?? null,
    };
  }
  return parts;
}

/** `dx`, `dy`: the pointer's total offset since the drag started. */
export function moveDrag(
  state: ResizableState,
  dx: number,
  dy: number,
): ResizableState {
  const { drag } = state;
  if (!drag || (drag.dx === dx && drag.dy === dy)) return state;
  // A fast move mustn't skip a stop that ends the drag.
  const moved = walkDrag(
    state,
    drag,
    dx,
    dy,
    DIMENSIONS.some((dimension) =>
      state.config[dimension]?.stops.some((stop) => stop.endsDrag),
    ),
    (x, y) => ({ ...state, drag: { ...drag, dx: x, dy: y } }),
    landedOnDragEnd,
    changedStop,
  );
  return moved.ended
    ? endDrag(moved.state, arrivals(state, moved.state))
    : withReached(state, moved.state);
}

/**
 * Records the stop each dimension's pointer last reached, over the move
 * from `before` to `after` (see `reachedStop`).
 */
function withReached(
  before: ResizableState,
  after: ResizableState,
): ResizableState {
  if (!after.drag) return after;
  const reached = { ...after.drag.reached };
  for (const dimension of DIMENSIONS) {
    const was = dragFor(before, dimension);
    const now = dragFor(after, dimension);
    const track = dimensionRenderingOf(after, dimension)?.track;
    if (!was || !now || !track) continue;
    reached[dimension] = reachedStop(
      track,
      reached[dimension],
      was.from + was.growth,
      now.from + now.growth,
      after[dimension]?.stop ?? null,
    );
  }
  return { ...after, drag: { ...after.drag, reached } };
}

/** Whether a move landed some dimension in another stop. */
function changedStop(before: ResizableState, after: ResizableState) {
  const was = getResizableRendering(before);
  const now = getResizableRendering(after);
  return DIMENSIONS.some(
    (dimension) => now[dimension]?.stop !== was[dimension]?.stop,
  );
}

/** Whether a move landed a dragged dimension in a stop with `endsDrag`. */
function landedOnDragEnd(before: ResizableState, after: ResizableState) {
  return Object.keys(arrivals(before, after)).length > 0;
}

/**
 * The dimensions a move landed in a stop with `endsDrag`, and the stops.
 */
function arrivals(
  before: ResizableState,
  after: ResizableState,
): Partial<Record<Dimension, string>> {
  const was = getResizableRendering(before);
  const now = getResizableRendering(after);
  const arrived: Partial<Record<Dimension, string>> = {};
  for (const dimension of DIMENSIONS) {
    const rendering = now[dimension];
    if (!rendering?.track || rendering.stop === null) continue;
    if (rendering.stop === was[dimension]?.stop) continue;
    if (findStop(rendering.track, rendering.stop)?.endsDrag) {
      arrived[dimension] = rendering.stop;
    }
  }
  return arrived;
}

/**
 * Releases the drag: each dimension keeps where the pointer left it,
 * without the elastic stretch, or one that `arrived` in a range that ends
 * drags goes there as `setStop` would (see `settleDrag`).
 */
export function endDrag(
  state: ResizableState,
  arrived: Partial<Record<Dimension, string>> = {},
): ResizableState {
  const { drag } = state;
  if (!drag) return state;
  let next: ResizableState = { ...state, drag: null, animate: "drag" };
  const rect = dragRect(state);

  for (const dimension of DIMENSIONS) {
    const dimensionDrag = dragFor(state, dimension);
    const context = contextFor(state, dimension);
    // As the drag saw them (see `reachableConfig`).
    const config = reachableConfig(state, dimension, drag.target, rect);
    const current = state[dimension];
    if (!dimensionDrag || !context || !config || !current) continue;
    const bounds = boundsFor(state, dimension, drag.target, rect);
    next = {
      ...next,
      [dimension]: settleDrag(
        config,
        current,
        context,
        dimensionDrag,
        bounds,
        arrived[dimension],
      ),
    };
  }

  if (rect && next.position) {
    // Place the element for its settled size, not the elastic one.
    const size = dragSize(state, getResizableRendering(next), rect);
    const point = dragPoint(state, drag, rect, size);
    next = { ...next, position: keptPosition(state, rect, point, size) };
  }
  return next;
}

export function cancelDrag(state: ResizableState): ResizableState {
  return state.drag ? { ...state, drag: null, animate: "drag" } : state;
}

/**
 * Asks for a size, which lands like a drag would (on the nearest stop if it's
 * in a gap). Inside a range it's kept as given, so a `%` stays relative.
 */
export function setSize(
  state: ResizableState,
  dimension: Dimension,
  size: Size,
): ResizableState {
  const { aspect } = state.config;
  if (dimension === "height" && aspect && !state.config.height) {
    // A ratio-locked height is the width's (as in `dimensionsWithStop`),
    // through the ratio, in pixels: a height in `vh` can't stay relative
    // as a width.
    const context = contextFor(state, "height");
    const height = context && resolveSize(size, context);
    return height == null
      ? state
      : setSize(state, "width", px(height * aspect.ratio));
  }
  const config = state.config[dimension];
  const current = state[dimension];
  const context = contextFor(state, dimension);
  const rendering = dimensionRenderingOf(state, dimension);
  if (!config || !current || !rendering || rendering.stop === null)
    return state;

  let next: DimensionState;
  if (!context) {
    // Before measuring, nothing can land; give the size to the current stop.
    next = moveTo(config, current, rendering.stop, rendering.stop, size);
  } else {
    const track = resolveTrack(
      config,
      context,
      boundsFor(state, dimension, null, null),
    );
    const requested = resolveSize(size, context) ?? 0;
    const landed = land(track, requested, rendering.stop);
    next = moveTo(
      config,
      current,
      rendering.stop,
      landed.stop,
      landed.size === requested ? size : px(landed.size),
    );
  }
  return { ...state, [dimension]: next, drag: null, animate: "size" };
}

export function setPosition(
  state: ResizableState,
  position: Partial<PositionState>,
): ResizableState {
  if (!state.position) return state;
  return {
    ...state,
    position: { ...state.position, ...position },
    drag: null,
    animate: "position",
  };
}

/**
 * The dimensions a stop name applies to: `dimension` if given (throwing if it
 * has no such stop), else every stored dimension that has one (throwing if
 * none does).
 */
export function dimensionsWithStop(
  config: ResizableConfig,
  stop: string,
  dimension?: Dimension,
): Dimension[] {
  if (dimension) {
    const stored = storedDimension(config, dimension);
    const dimensionConfig = config[stored];
    if (!dimensionConfig) {
      throw new Error(`This resizable's ${dimension} isn't resizable.`);
    }
    checkStop(dimensionConfig, stop);
    return [stored];
  }
  const found = DIMENSIONS.filter((candidate) =>
    config[candidate]?.stops.some((option) => option.name === stop),
  );
  // None has it: let the stored dimension's check say which stops exist.
  const stored = config.width ?? config.height;
  if (found.length === 0 && stored) checkStop(stored, stop);
  return found;
}

/**
 * Goes to the stop called `stop` (a point, or a range at its remembered
 * size), or with `toggle`, back from it if it's already there. A toggle
 * decides once for all `dimensions`: back only if every one is at the stop,
 * otherwise each goes to it. (Deciding each on its own would flip
 * dimensions that have drifted apart in opposite directions.)
 */
export function setStop(
  state: ResizableState,
  dimensions: readonly Dimension[],
  stop: string,
  toggle = false,
): ResizableState {
  const back =
    toggle &&
    dimensions.every(
      (dimension) => dimensionRenderingOf(state, dimension)?.stop === stop,
    );
  let next = state;
  for (const dimension of dimensions) {
    const config = state.config[dimension];
    const current = next[dimension];
    const rendering = dimensionRenderingOf(next, dimension);
    if (!config || !current || !rendering) continue;
    if (!back && rendering.stop === stop) continue;
    const moved = back
      ? toggleStop(config, current, rendering.stop, stop, rendering.track)
      : moveTo(config, current, rendering.stop, stop);
    if (sameDimensionState(moved, current)) continue;
    next = { ...next, [dimension]: moved };
  }
  return next === state ? state : { ...next, drag: null, animate: "stop" };
}

/**
 * Applies a key press on an edge handle: `handle` is the edge it drives,
 * and `corner` the corner it came from, for the one corner that takes keys
 * where the edge handles offered don't cover resizing (see
 * `keyboardCornerOf`; other corners aren't focusable). On a floating
 * element it resizes like a drag on the same handle: within the
 * room a confined element has on that side, and from the left or top,
 * moving so the opposite edge stays put. `measured` is the element's size,
 * for dimensions the app sizes itself.
 */
export function applyKeyboard(
  state: ResizableState,
  handle: Edge,
  intent: KeyboardIntent,
  measured: ElementSize = { width: 0, height: 0 },
  corner?: Corner,
): ResizableState {
  const { config } = state;
  // From a corner (see `keyboardCornerOf`): one of its two edges.
  if (
    config.disabled ||
    state.drag ||
    !config.handles.includes(corner ?? handle)
  ) {
    return state;
  }

  const onWidthEdge = handle === "left" || handle === "right";
  // A ratio-locked height edge drives the stored width.
  const dimension: Dimension =
    onWidthEdge || config.aspect ? "width" : "height";
  const dimensionConfig = config[dimension];
  const current = state[dimension];
  const rect = state.position
    ? rectOf(getResizableRendering(state), measured)
    : null;
  if (state.position && !rect) return state;
  // The room it has, and the edges that stay, are the corner's: its arrows
  // move its edges, as a drag would (`handle` is the edge an arrow moves).
  const rendering = dimensionRenderingOf(
    state,
    dimension,
    corner ?? handle,
    rect,
  );
  const rates = growthRates(config, handle, dimension);
  if (!dimensionConfig || !current || !rendering || !rates) return state;

  const next = applyKey(
    dimensionConfig,
    current,
    rendering,
    intent,
    onWidthEdge ? rates.x : rates.y,
    config.keyboard?.jump,
  );
  if (next === current) return state;
  const resized: ResizableState = {
    ...state,
    [dimension]:
      reachedByEnter(state, dimension, next, intent, rect, corner ?? handle) ??
      current,
    animate: "keyboard",
  };
  if (resized[dimension] === current) return state;
  if (!rect) return resized;
  const after = getResizableRendering(resized);
  const size = {
    width: after.width?.size ?? rect.width,
    height: after.height?.size ?? rect.height,
  };
  const point = resizedPoint(corner ?? handle, rect, size);
  return { ...resized, position: keptPosition(state, rect, point, size) };
}

/**
 * The corner that takes the keyboard for this resizable, if any (see
 * `keyboardCorner`).
 */
export function keyboardCornerOf(config: ResizableConfig): Corner | null {
  return keyboardCorner(
    config.handles,
    { width: config.width !== null, height: config.height !== null },
    config.aspect !== null,
  );
}

/** Moves a floating element by a keyboard step (kept inside if confined). */
export function moveByKeyboard(
  state: ResizableState,
  dx: number,
  dy: number,
  measured: ElementSize,
): ResizableState {
  if (state.config.disabled || state.drag || !state.position) return state;
  // From where it's shown, which for a confined element may differ from
  // the stored position.
  const rect = rectOf(getResizableRendering(state), measured);
  const { container } = state;
  if (!rect || !container) return state;

  const moved = { x: rect.x + dx, y: rect.y + dy };
  const next = state.config.position?.confined
    ? keepInside(moved, rect, container)
    : moved;
  const position = keptPosition(state, rect, next, rect);
  if (position === state.position) return state;
  return { ...state, position, animate: "keyboard" };
}
