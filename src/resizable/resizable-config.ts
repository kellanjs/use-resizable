/**
 * The resizable's options, its parsed config, the shape of its state, and
 * setting it up: what the model, the snapshot functions, the controller and
 * the hook all agree on.
 */
import {
  type Corner,
  type Dimension,
  type Edge,
  type HandleEdge,
  type HeightAnchor,
  type LogicalHandleEdge,
  type WidthAnchor,
  deriveHandles,
  edgesOf,
  physicalEdge,
} from "../foundation/handle.js";
import type { HeldContent } from "../foundation/held-content.js";
import type { ElementSize } from "../foundation/observe-size.js";
import {
  type CommonConfig,
  type CommonOptions,
  parseCommonOptions,
} from "../foundation/options.js";
import { type Size, type Viewport, parseBound } from "../foundation/size.js";
import type { ChangeKind } from "../foundation/transition.js";
import {
  type DimensionConfig,
  type DimensionOptions,
  type DimensionState,
  initialDimension,
  parseDimension,
} from "./dimension.js";
import {
  type PositionConfig,
  type PositionOptions,
  type PositionState,
  type Rect,
  initialPosition,
  parsePosition,
} from "./position.js";

export const DIMENSIONS = ["width", "height"] as const;

/**
 * The dimension that holds `dimension`'s size: with `aspectRatio`, a height
 * is the width's (it follows from it).
 */
export function storedDimension(
  config: ResizableConfig,
  dimension: Dimension,
): Dimension {
  return dimension === "height" && config.aspect ? "width" : dimension;
}

/**
 * The part of the element that stays still while it resizes, named like CSS
 * `background-position`: a single side ("left") centres the other dimension,
 * so "left" means "left edge, vertically centred". `"none"` makes the element
 * floating: it has a position of its own, and when it resizes, the side
 * opposite the grabbed handle holds still.
 *
 * A side or corner can be named by reading direction (`start`, `end`,
 * `top-start`...): it becomes `left` or `right` by the element's
 * `direction` (see `InlineEdge`).
 */
export type Anchor = PhysicalAnchor | LogicalHandleEdge;

/** An anchor with its sides named physically, as the model uses it. */
export type PhysicalAnchor = "center" | "none" | Edge | Corner;

/** What a drag can grab: a resize handle (by its edge), or the move handle. */
export type DragTarget = HandleEdge | "move";

interface BaseOptions extends PositionOptions, CommonOptions {
  anchor: Anchor;
  /**
   * Which edge and corner handles to offer. Defaults to every free edge and
   * corner the anchor allows; pass a subset to offer fewer (e.g. corners
   * only on an image). Logical names (`end`, `bottom-end`) follow the
   * reading direction too.
   */
  handles?: readonly (HandleEdge | LogicalHandleEdge)[];
}

interface IndependentDimensions {
  /** Make the width resizable. */
  width?: DimensionOptions;
  /** Make the height resizable. */
  height?: DimensionOptions;
  aspectRatio?: undefined;
}

interface LockedAspectRatio {
  width: DimensionOptions;
  /**
   * The height follows the width, so only its limits apply. They limit the
   * width's ranges through the ratio.
   */
  height?: Pick<DimensionOptions, "minSize" | "maxSize">;
  /** Width ÷ height, e.g. `16 / 9`. */
  aspectRatio: number;
  /**
   * How a corner drag turns the pointer's two pulls into one size. The
   * corner can only move along its path, the line from the anchor out
   * through the corner.
   * - `"nearest"` (default): it goes to the point on that path nearest the
   *   pointer. Smooth in every direction.
   * - `"axis"`: it stays on the pointer along whichever axis you pull
   *   further (pulls in opposite directions offset each other), for lining
   *   an edge up with something exactly.
   */
  cornerDrag?: CornerDrag;
}

export type CornerDrag = "nearest" | "axis";

export type ResizableOptions = BaseOptions &
  (IndependentDimensions | LockedAspectRatio);

/** A locked aspect ratio, with the height's limits and anchor. */
export interface AspectConfig {
  readonly ratio: number;
  readonly heightAnchor: HeightAnchor;
  readonly minHeight: readonly Size[] | undefined;
  readonly maxHeight: readonly Size[] | undefined;
  readonly cornerDrag: CornerDrag;
}

/** Options after parsing and defaulting. Plain data, safe to compare. */
export interface ResizableConfig extends CommonConfig {
  readonly width: DimensionConfig | null;
  /** `null` when the height isn't resizable, or follows a locked ratio. */
  readonly height: DimensionConfig | null;
  readonly aspect: AspectConfig | null;
  /** Set for floating elements (`anchor: "none"`). */
  readonly position: PositionConfig | null;
  readonly handles: readonly HandleEdge[];
}

/** The container's measured size, which `%` sizes resolve against. */
export interface MeasuredContainer {
  readonly width: number;
  readonly height: number;
  readonly rootFontSize: number;
  /** For `vw` and `vh` sizes; `null` if none use them. */
  readonly viewport: Viewport | null;
}

/** A drag in progress: what was grabbed, and the pointer's offset since. */
export interface ResizableDrag {
  readonly target: DragTarget;
  /** Rendered size of each stored dimension the drag resizes, at the start. */
  readonly from: Readonly<Record<Dimension, number | null>>;
  /** For floating elements: where the element was when the drag started. */
  readonly rect: Rect | null;
  readonly dx: number;
  readonly dy: number;
  /**
   * For each dimension, the stop its pointer last reached (`null`: the one
   * it started in); see `DimensionDrag.reached`.
   */
  readonly reached: Readonly<Record<Dimension, string | null>>;
  /**
   * The size each stored dimension the drag doesn't resize was shown at
   * when it started mid-animation: it stays there through the drag, and
   * its own change carries on with the release.
   */
  readonly frozen?: Readonly<Partial<Record<Dimension, number>>>;
}

export interface ResizableState {
  readonly config: ResizableConfig;
  /** `null` until the container is first measured. */
  readonly container: MeasuredContainer | null;
  /**
   * The element's own size as drawn, for confining one whose width or
   * height the app sizes (see `confine`); `null` until measured, and when
   * nothing needs it.
   */
  readonly own: ElementSize | null;
  readonly reducedMotion: boolean;
  /** `null` for a dimension that isn't stored (not resizable, or ratio-locked). */
  readonly width: DimensionState | null;
  readonly height: DimensionState | null;
  /** `null` unless the element is floating. */
  readonly position: PositionState | null;
  readonly drag: ResizableDrag | null;
  /**
   * The kind of the latest change, if it should animate (see
   * `getResizableRendering`); `null` for changes that follow the layout.
   */
  readonly animate: ChangeKind | null;
  /**
   * Whether a committed change is still transitioning. Set with the change
   * (see `playsTransition`) and cleared by the controller once the
   * transition has had time to finish.
   */
  readonly animating: boolean;
  /** Each dimension's stop before its latest change of stop. */
  readonly previousStops: Readonly<Record<string, string>>;
  /**
   * Each dimension's stop when the change in progress (a drag, or an
   * animated change) began; `null` while nothing is changing.
   */
  readonly fromStops: Readonly<Record<string, string | null>> | null;
  /**
   * Whether each dimension's content slides with its moving edge through
   * the change in progress (see `recordSliding`); `null` at rest.
   */
  readonly sliding: Readonly<Record<string, boolean>> | null;
  /**
   * The content as it was when the change in progress began: reflowing
   * once (`reflow: "once"`), held at that through a drag, and through an
   * animated change at the larger of that and where it's going; and any
   * dimension an animated change takes to a point leaves at that size (see
   * `getResizableContentRendering`). Unused once it's over.
   */
  readonly heldContent: Readonly<Record<Dimension, HeldContent | null>> | null;
}

/** The part of the state worth saving between sessions. */
export interface ResizableSnapshot {
  readonly version: 2;
  readonly width?: DimensionState;
  readonly height?: DimensionState;
  readonly position?: PositionState;
}

// --- Setup -------------------------------------------------------------------

/**
 * Each dimension's anchor: an edge anchor holds that edge still (a side
 * holds one dimension, and the other is centred); a corner holds both.
 */
export function anchorsOf(anchor: PhysicalAnchor): {
  width: WidthAnchor;
  height: HeightAnchor;
} {
  if (anchor === "center") return { width: "center", height: "center" };
  if (anchor === "none") return { width: "none", height: "none" };
  const edges = edgesOf(anchor);
  return {
    width: edges.width ?? "center",
    height: edges.height ?? "center",
  };
}

export function parseResizableOptions(
  options: ResizableOptions,
  /** Whether the element is laid out right to left, for logical names. */
  rtl = false,
): ResizableConfig {
  const anchor: PhysicalAnchor =
    options.anchor === "center" || options.anchor === "none"
      ? options.anchor
      : physicalEdge(options.anchor, rtl);
  const anchors = anchorsOf(anchor);
  let width: DimensionConfig | null;
  let height: DimensionConfig | null;
  let aspect: AspectConfig | null;

  if (options.aspectRatio === undefined) {
    if (!options.width && !options.height) {
      throw new Error("A resizable needs `width`, `height`, or both.");
    }
    width = options.width
      ? parseDimension(options.width, anchors.width, "width")
      : null;
    height = options.height
      ? parseDimension(options.height, anchors.height, "height")
      : null;
    aspect = null;
  } else {
    const { aspectRatio: ratio } = options;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      throw new Error(`Invalid aspectRatio ${ratio}: expected a number > 0.`);
    }
    width = parseDimension(options.width, anchors.width, "width");
    height = null;
    const { minSize, maxSize } = options.height ?? {};
    aspect = {
      ratio,
      heightAnchor: anchors.height,
      minHeight: minSize === undefined ? undefined : parseBound(minSize),
      maxHeight: maxSize === undefined ? undefined : parseBound(maxSize),
      cornerDrag: options.cornerDrag ?? "nearest",
    };
  }

  const floating = anchor === "none";
  if (!floating && (options.defaultPosition || options.confine)) {
    throw new Error('`defaultPosition` and `confine` need `anchor: "none"`.');
  }

  const available = deriveHandles(
    width ? anchors.width : null,
    height || aspect ? anchors.height : null,
  );
  const handles =
    options.handles?.map((handle) => physicalEdge(handle, rtl)) ?? available;
  handles.forEach((handle, index) => {
    if (available.includes(handle)) return;
    // In the user's words, with what a logical name means here.
    const named = (given: string, physical: string) =>
      given === physical ? `"${given}"` : `"${given}" (here "${physical}")`;
    throw new Error(
      `Handle ${named(options.handles?.[index] ?? handle, handle)} isn't available with anchor ${named(options.anchor, anchor)}. Available: ${available.join(", ")}.`,
    );
  });

  return {
    width,
    height,
    aspect,
    position: floating ? parsePosition(options) : null,
    handles,
    ...parseCommonOptions(options),
  };
}

export function createResizableState(
  config: ResizableConfig,
  snapshot?: ResizableSnapshot,
): ResizableState {
  const initial = (dimension: Dimension) => {
    const dimensionConfig = config[dimension];
    if (!dimensionConfig) return null;
    return snapshot?.[dimension] ?? initialDimension(dimensionConfig);
  };

  return {
    config,
    container: null,
    own: null,
    reducedMotion: false,
    width: initial("width"),
    height: initial("height"),
    position: config.position
      ? (snapshot?.position ?? initialPosition(config.position))
      : null,
    drag: null,
    animate: null,
    animating: false,
    heldContent: null,
    previousStops: {},
    fromStops: null,
    sliding: null,
  };
}
