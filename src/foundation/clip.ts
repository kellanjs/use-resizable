/**
 * Clip layers (`getClipProps`): a layer between an element and its content
 * wrapper (`getContentProps`) that clips the content and pins it to an edge,
 * so that while the element resizes the content either stays put, the
 * moving edge covering and uncovering it (covering, the default), or
 * travels with the moving edge, as a drawer does (`slide`).
 *
 * Which edge content slides with is decided per part (a dimension, a
 * layout's child) as a change begins, and kept for the change (see
 * `recordSliding`): switching edges while content is partly covered would
 * move it.
 */
import type { CSSProperties } from "react";

import { own, setOwn } from "./own.js";
import { type TrackConfig, ZERO, isRangeStop, isZeroStop } from "./stops.js";

/** The parts of a model's state that sliding works with. */
export interface SlidingState {
  readonly drag: unknown;
  readonly animating: boolean;
  readonly fromStops: Readonly<Record<string, string | null>> | null;
  /**
   * Whether each part's content slides with its moving edge through the
   * change in progress (a drag, or an animated change), by part (see
   * `recordSliding`); `null` at rest, where content is pinned to the
   * anchored edge.
   */
  readonly sliding: Readonly<Record<string, boolean>> | null;
}

/** A part, for deciding whether its content slides. */
export interface SlidingPart {
  /**
   * Its stops, for which are at 0 and which are ranges; `null` for one
   * that can't slide on its own (a ratio-locked height follows its width).
   */
  readonly config: TrackConfig | null;
  /** Its stop after the change. */
  readonly stop: string | null;
  /**
   * Its size as shown when the change begins (measured, if it was
   * animating: its rendering is only where it was going), and its
   * content wrapper's then (see `laidOutContentSize`), before the change
   * and as it begins; `null` before measuring.
   */
  readonly size: number | null;
  readonly content: number | null;
  readonly contentAfter: number | null;
}

/**
 * Whether a change from `from` to `to` asks for content to slide: closing
 * to 0 (from any stop, a rail too), or opening from 0 into a range. Not
 * into a rail, or within a stop: content that slid there would rest
 * pinned to the moving edge, and jump to the anchored one. Which edge it
 * slides with is decided as the change begins (see `recordSliding`), which
 * covers instead where sliding would move content already on screen.
 */
export function slidesBetween(
  config: TrackConfig,
  from: string | null,
  to: string | null,
): boolean {
  return (
    (isZeroStop(config, to) && !isZeroStop(config, from)) ||
    (isZeroStop(config, from) && to !== null && isRangeStop(config, to))
  );
}

/**
 * Records, in `after`, whether each part's content slides through the
 * change in progress (`sliding`), decided as it begins: a drag's press,
 * an animated change starting (`begins`), or a drag handing over to the
 * animation of its release.
 *
 * Each part wants to slide for a change that closes it to 0 or opens it
 * from 0 into a range (`slidesBetween`), or for a drag, if it starts at 0.
 * It gets the edge that moves what's shown least: where its content is
 * now (by the edge in force: the change it interrupts, or the anchored
 * edge at rest), against where each edge puts it as the change begins
 * (its content may be laid out at another size now). The edge it wants
 * wins a tie, and at 0, where nothing shows, it's always what it wants.
 * Content closing from a rail, say (laid out wider than the rail), stays
 * covered rather than jumping to the moving edge; and a pane reopened
 * just after it started closing (wanting to slide in from 0, though it
 * never got there) covers, rather than being laid out at its open size
 * against the moving edge, which would show its far end.
 *
 * `partsOf` gives each part, with its stop after the change, its sizes
 * as shown as it begins, and its content before and after. Returns `after`
 * itself when nothing's decided.
 */
export function recordSliding<S extends SlidingState>(
  before: S,
  after: S,
  begins: boolean,
  partsOf: (before: S, after: S) => Readonly<Record<string, SlidingPart>>,
): S {
  if (after.drag == null && !after.animating) {
    return after.sliding === null ? after : { ...after, sliding: null };
  }
  const pressed = before.drag == null && after.drag != null;
  const released = before.drag != null && after.drag == null;
  if (!begins && !pressed && !released && after.sliding) return after;
  const changing = before.drag != null || before.animating;
  const sliding: Record<string, boolean> = {};
  for (const [id, part] of Object.entries(partsOf(before, after))) {
    const inForce = changing ? (own(before.sliding, id) ?? false) : false;
    const { size } = part;
    const atZero = size !== null && size < ZERO;
    const wanted =
      part.config !== null &&
      (pressed
        ? atZero
        : slidesBetween(
            part.config,
            own(after.fromStops, id) ?? null,
            part.stop,
          ));
    if (size === null || atZero) {
      setOwn(sliding, id, wanted);
      continue;
    }
    // Where the content's anchored edge is, from the element's: 0 pinned
    // there, or pinned to the moving edge, the difference in their sizes.
    const offset = (slides: boolean, content: number | null) =>
      slides && content !== null ? size - content : 0;
    const now = offset(inForce, part.content);
    const shift = (slides: boolean) =>
      Math.abs(offset(slides, part.contentAfter) - now);
    setOwn(
      sliding,
      id,
      shift(wanted) <= 0.5 || shift(wanted) <= shift(!wanted)
        ? wanted
        : !wanted,
    );
  }
  return { ...after, sliding };
}

/**
 * Where a clip layer pins its content, along each axis: horizontally a
 * physical side (`useResizable`, whose anchors are physical), a side in
 * the direction the layer inherits (a layout's row, whose direction is
 * the page's), or the centre; vertically, the top, the bottom or the
 * centre. `null` along an axis that isn't resized: the content fills it.
 */
export interface ClipPins {
  readonly horizontal: "left" | "right" | "start" | "end" | "center" | null;
  readonly vertical: "top" | "bottom" | "center" | null;
}

/**
 * The style of a clip layer: filling its element (which must be what it's
 * positioned against), clipping, and pinning the content wrapper with
 * flexbox. A row, pinned across by `justify-content` (`left` and `right`
 * are physical on a row's main axis) and up and down by `align-items`; or,
 * resized only up and down, a column, so the wrapper fills its width.
 */
export function clipStyle(pins: ClipPins): CSSProperties {
  const flex = (side: NonNullable<ClipPins[keyof ClipPins]>) =>
    side === "top" || side === "start"
      ? "flex-start"
      : side === "bottom" || side === "end"
        ? "flex-end"
        : side;
  const column = pins.horizontal === null && pins.vertical !== null;
  return {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: column ? "column" : undefined,
    justifyContent: column
      ? flex(pins.vertical!)
      : pins.horizontal
        ? flex(pins.horizontal)
        : undefined,
    alignItems: !column && pins.vertical ? flex(pins.vertical) : undefined,
  };
}
