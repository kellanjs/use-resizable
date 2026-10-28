/**
 * Handle geometry: which edges a handle moves, and which handles an
 * element gets from the way it's anchored.
 *
 * A handle is an input device. It doesn't own a size; it reports that one
 * or more edges moved. An edge handle moves one edge; a corner handle is a
 * compound handle that moves two edges at once, one per dimension. Where a
 * handle sits is up to the app: only the edge it drives matters.
 */

export type Dimension = "width" | "height";
export type WidthEdge = "left" | "right";
export type HeightEdge = "top" | "bottom";
export type Edge = WidthEdge | HeightEdge;
export type Corner = `${HeightEdge}-${WidthEdge}`;
/**
 * The part of the element a handle drives: an edge, or a corner (which
 * drives the two edges that meet there). Not where the handle sits.
 */
export type HandleEdge = Edge | Corner;

/**
 * The inline sides by reading direction: `start` is the left in a
 * left-to-right page and the right in a right-to-left one.
 */
export type InlineEdge = "start" | "end";
export type LogicalCorner = `${HeightEdge}-${InlineEdge}`;
/** A handle's edge named by reading direction (see `InlineEdge`). */
export type LogicalHandleEdge = InlineEdge | LogicalCorner;

/**
 * The physical edge or corner a logical one stands for, `rtl` or not;
 * a physical one as it is.
 */
export function physicalEdge(
  edge: HandleEdge | LogicalHandleEdge,
  rtl: boolean,
): HandleEdge {
  const side = (inline: InlineEdge): WidthEdge =>
    (inline === "start") !== rtl ? "left" : "right";
  if (edge === "start" || edge === "end") return side(edge);
  const [vertical, horizontal] = edge.split("-") as [string, string];
  if (horizontal === "start" || horizontal === "end") {
    return `${vertical as HeightEdge}-${side(horizontal)}`;
  }
  return edge as HandleEdge;
}

/**
 * Where a dimension is held still while it resizes: one of its edges (the
 * other one moves), its centre (both edges move, mirroring each other), or
 * `"none"` for a floating element, where both edges are free and the one
 * opposite the grabbed edge holds still.
 */
export type WidthAnchor = WidthEdge | "center" | "none";
/** Where the height is held still (see `WidthAnchor`). */
export type HeightAnchor = HeightEdge | "center" | "none";
export type DimensionAnchor = WidthAnchor | HeightAnchor;

/** The edge a handle moves in each dimension, or `null` if it doesn't. */
export interface MovedEdges {
  readonly width: WidthEdge | null;
  readonly height: HeightEdge | null;
}

const EDGES: Record<HandleEdge, MovedEdges> = {
  left: { width: "left", height: null },
  right: { width: "right", height: null },
  top: { width: null, height: "top" },
  bottom: { width: null, height: "bottom" },
  "top-left": { width: "left", height: "top" },
  "top-right": { width: "right", height: "top" },
  "bottom-left": { width: "left", height: "bottom" },
  "bottom-right": { width: "right", height: "bottom" },
};

export function edgesOf(handle: HandleEdge): MovedEdges {
  return EDGES[handle];
}

/**
 * +1 if moving this edge right or down makes the element bigger (its right
 * and bottom edges), −1 if it makes it smaller (left and top).
 */
export function edgeDirection(edge: Edge): 1 | -1 {
  return edge === "right" || edge === "bottom" ? 1 : -1;
}

/**
 * How much the size changes per pixel an edge moves. When a dimension is
 * centre-anchored the opposite edge mirrors the dragged one, so the size
 * changes twice as fast and the dragged edge stays under the pointer.
 */
export function anchorFactor(anchor: DimensionAnchor): 1 | 2 {
  return anchor === "center" ? 2 : 1;
}

/**
 * The handles an element gets from its anchors: every free edge, plus a
 * corner wherever a free width edge meets a free height edge. Pass `null`
 * for a dimension that isn't resizable.
 */
export function deriveHandles(
  width: WidthAnchor | null,
  height: HeightAnchor | null,
): HandleEdge[] {
  const widthEdges = width ? freeEdges(width, "left", "right") : [];
  const heightEdges = height ? freeEdges(height, "top", "bottom") : [];
  const corners = heightEdges.flatMap((vertical) =>
    widthEdges.map((horizontal): Corner => `${vertical}-${horizontal}`),
  );
  return [...widthEdges, ...heightEdges, ...corners];
}

/** The edges of a dimension (`low` is left or top) its anchor leaves free. */
function freeEdges<T extends Edge>(
  anchor: T | "center" | "none",
  low: T,
  high: T,
): T[] {
  if (anchor === low) return [high];
  if (anchor === high) return [low];
  return [low, high]; // centre and none: both edges move
}

export function isCorner(handle: HandleEdge): handle is Corner {
  return handle.includes("-");
}

/**
 * The corner that takes the keyboard, if one has to: the first of `handles`
 * that moves a dimension no edge handle does. Corners are otherwise out of
 * the tab order, since a corner changes two values at once and its edges
 * can already do all it does; but with only corners (an image's two lower
 * ones, say), they're the only way to resize from the keyboard. `resizable`
 * is the dimensions that resize on their own: a ratio-locked height follows
 * the width, so any edge reaches it.
 */
export function keyboardCorner(
  handles: readonly HandleEdge[],
  resizable: { readonly width: boolean; readonly height: boolean },
  ratioLocked: boolean,
): Corner | null {
  const edges = handles.filter((handle) => !isCorner(handle));
  const reached = {
    width: edges.some((edge) => edgesOf(edge).width !== null || ratioLocked),
    height: edges.some((edge) => edgesOf(edge).height !== null),
  };
  const unreached = (["width", "height"] as const).filter(
    (dimension) => resizable[dimension] && !reached[dimension],
  );
  if (unreached.length === 0) return null;
  return (
    handles.find(
      (handle): handle is Corner =>
        isCorner(handle) &&
        unreached.some(
          (dimension) =>
            edgesOf(handle)[dimension] !== null ||
            (ratioLocked && dimension === "width"),
        ),
    ) ?? null
  );
}

/** The cursor that suggests which way a handle moves. */
export function cursorFor(handle: HandleEdge): string {
  switch (handle) {
    case "left":
    case "right":
      return "ew-resize";
    case "top":
    case "bottom":
      return "ns-resize";
    case "top-left":
    case "bottom-right":
      return "nwse-resize";
    case "top-right":
    case "bottom-left":
      return "nesw-resize";
  }
}
