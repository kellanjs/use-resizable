/**
 * What `useResizable` hands the app on each render: the view, the props
 * for its element, content, clip layer and handles, and its actions, from
 * the controller's state.
 */
import type { CSSProperties } from "react";

import {
  nowValue,
  roundValue,
  stopName,
  valueText,
} from "../foundation/aria.js";
import { type ClipPins, clipStyle } from "../foundation/clip.js";
import {
  type Dimension,
  type DimensionAnchor,
  type HandleEdge,
  type LogicalHandleEdge,
  cursorFor,
  edgesOf,
  isCorner,
} from "../foundation/handle.js";
import { holdsContent } from "../foundation/held-content.js";
import {
  type PropsOptions,
  contentStyle,
  contentVariable,
  holdsWhileAnimating,
  timingVariables,
} from "../foundation/props.js";
import { forReact } from "../foundation/react-ref.js";
import { warnOnce } from "../foundation/warn.js";
import type { DimensionRendering } from "./dimension.js";
import type { ResizableState } from "./resizable-config.js";
import type { ResizableControllerWithState } from "./resizable-controller.js";
import {
  type ResizableRendering,
  getResizableContentRendering,
  getResizableRendering,
  handleReach,
  isZero,
  keyboardCornerOf,
} from "./resizable-model.js";
import { getResizableView } from "./resizable-view.js";
import type {
  DimensionOf,
  PositionOf,
  ResizableHandleProps,
  ResizableOf,
  UseResizableOptions,
} from "./use-resizable-types.js";

/**
 * The resizable as this render has it: `controller`'s `state`, with DOM
 * ids made from `id`.
 */
export function resizableOf<O extends UseResizableOptions>(
  controller: ResizableControllerWithState,
  state: ResizableState,
  options: O,
  id: string,
): ResizableOf<O> {
  const view = getResizableView(state);
  const rendering = getResizableRendering(state);
  const { config } = state;
  // Reflowing once, a drag or an animated change holds the content (see
  // `getResizableContentRendering`).
  const holding = holdsContent(state);

  function getHandleProps(
    given: HandleEdge | LogicalHandleEdge,
    { style }: PropsOptions = {},
  ): ResizableHandleProps {
    // A logical edge (`end`) is the physical one for this direction.
    const edge = controller.resolveEdge(given);
    const moved = edgesOf(edge);
    // A handle `handles` leaves out does nothing (neither drags nor keys
    // resize from it), so it shouldn't look or act like one.
    const offered = config.handles.includes(edge);
    if (!offered) {
      warnOnce(
        `getHandleProps("${edge}"): this resizable doesn't offer "${edge}" (its handles are ${config.handles.join(", ") || "none"}), so the handle does nothing.`,
      );
    }
    const base = {
      // By the name given: resolved when pressed (see `handleRef`).
      ref: forReact(controller.handleRef(given)),
      style: {
        // Without this, touch drags would scroll the page instead.
        touchAction: "none",
        cursor:
          config.disabled || !offered || !config.cursor
            ? undefined
            : cursorFor(edge),
        // Reachable while the element is at zero, to bring it back.
        visibility: rendering.hidden ? "visible" : undefined,
        ...style,
      },
      "data-handle": edge,
      "data-dragging": view.dragging === edge ? "" : undefined,
      "data-zero":
        (moved.width && isZero(rendering.width)) ||
        // A ratio-locked height is at zero when its width is (before
        // measuring, its CSS is "auto").
        (moved.height &&
          isZero(config.aspect ? rendering.width : rendering.height))
          ? ""
          : undefined,
    } as const;

    if (isCorner(edge) && edge === keyboardCornerOf(config)) {
      return { ...base, ...keyboardCornerProps(edge) };
    }
    if (isCorner(edge)) {
      return {
        ...base,
        role: undefined,
        tabIndex: -1,
        "aria-controls": undefined,
        "aria-orientation": undefined,
        "aria-valuenow": undefined,
        "aria-valuemin": undefined,
        "aria-valuemax": undefined,
        "aria-valuetext": undefined,
        "aria-disabled": undefined,
        "aria-hidden": true,
        "data-stop": undefined,
      };
    }

    const dimension: Dimension = moved.width ? "width" : "height";
    const dimensionRendering: DimensionRendering | null = rendering[dimension];
    // The sizes the user can reach from this handle (see `handleReach`).
    const limits = handleReach(state, edge);

    return {
      ...base,
      role: "separator",
      tabIndex: config.disabled || !config.keyboard || !offered ? -1 : 0,
      "aria-controls": id,
      // The handle is a line across the dimension it resizes.
      "aria-orientation": dimension === "width" ? "vertical" : "horizontal",
      "aria-valuenow": nowValue(dimensionRendering?.size ?? null, limits),
      "aria-valuemin": roundValue(limits && limits.min),
      "aria-valuemax": roundValue(limits && limits.max),
      "aria-valuetext": options.valueText
        ? options.valueText({
            dimension,
            stop: stopName(dimensionRendering?.stop),
            size: dimensionRendering?.size ?? null,
          })
        : valueText(
            stopName(dimensionRendering?.stop),
            dimensionRendering?.size ?? null,
          ),
      "aria-disabled": config.disabled || undefined,
      "aria-hidden": undefined,
      "data-stop": stopName(dimensionRendering?.stop) ?? undefined,
    };
  }

  /** What one dimension's value reads as, for `aria-valuetext`. */
  function describe(dimension: Dimension): string | undefined {
    const resized = rendering[dimension];
    const stop = stopName(resized?.stop);
    const size = resized?.size ?? null;
    if (options.valueText) {
      return options.valueText({ dimension, stop, size });
    }
    return (
      valueText(stop, size) ??
      (size === null ? undefined : `${Math.round(size)} pixels`)
    );
  }

  /**
   * A corner that's the keyboard's way to resize: a slider. Its value is
   * its first dimension's size; with two it moves on its own, both are in
   * its text ("width 320 pixels, height 240 pixels"), as ARIA has no
   * control for two values.
   */
  function keyboardCornerProps(corner: HandleEdge) {
    // A ratio-locked height follows the width: one value.
    const values = (["width", "height"] as const).filter(
      (dimension) =>
        rendering[dimension] && !(dimension === "height" && config.aspect),
    );
    const first: Dimension = values[0] ?? "width";
    // The corner's reach: its room both ways, as its keys have.
    const limits = handleReach(state, corner, first);
    const resized = rendering[first];
    return {
      role: "slider" as const,
      tabIndex: config.disabled || !config.keyboard ? -1 : 0,
      "aria-controls": id,
      "aria-orientation": undefined,
      "aria-valuenow": nowValue(resized?.size ?? null, limits),
      "aria-valuemin": roundValue(limits && limits.min),
      "aria-valuemax": roundValue(limits && limits.max),
      "aria-valuetext":
        values.length === 2
          ? `width ${describe("width")}, height ${describe("height")}`
          : describe(first),
      "aria-disabled": config.disabled || undefined,
      "aria-hidden": undefined,
      "data-stop": stopName(resized?.stop) ?? undefined,
    };
  }

  return {
    // The configured dimensions are known from the options' type; see
    // `DimensionOf`.
    width: view.width as DimensionOf<O, "width">,
    height: view.height as DimensionOf<O, "height">,
    dragging: view.dragging,
    animating: view.animating,
    position: view.position as PositionOf<O>,
    getMoveHandleProps: ({ style } = {}) => ({
      ref: forReact(controller.moveHandleRef),
      tabIndex:
        config.disabled || !config.position || !config.keyboard ? -1 : 0,
      style: {
        // Without this, touch drags would scroll the page instead.
        touchAction: "none",
        cursor:
          config.disabled || !config.position || !config.cursor
            ? undefined
            : "move",
        visibility: rendering.hidden ? "visible" : undefined,
        ...style,
      },
      "aria-disabled": config.disabled || undefined,
      "data-handle": "move",
      "data-dragging": view.dragging === "move" ? "" : undefined,
    }),
    handles: view.handles,
    getElementProps: ({ style } = {}) => ({
      ref: forReact(controller.elementRef),
      id,
      style: {
        width: rendering.width?.css,
        height: rendering.height?.css,
        // Its size is its whole box, padding and border included, which
        // its stops, its room in a container and what's beside it are.
        boxSizing:
          rendering.width || rendering.height ? "border-box" : undefined,
        aspectRatio: config.aspect?.ratio,
        // A floating element is placed by left/top, which need this.
        position: config.position ? "absolute" : undefined,
        left: rendering.position?.left,
        top: rendering.position?.top,
        flexShrink: 0,
        transition: rendering.transition,
        // At 0 there's nothing to show; hiding it also takes its content out
        // of the tab order and the accessibility tree.
        visibility: rendering.hidden ? "hidden" : undefined,
        ...contentVariables(
          getResizableContentRendering(state),
          holding,
          state.fromStops,
        ),
        ...timingVariables(rendering.contentTiming),
        ...style,
      },
      "data-width-stop": view.width?.stop ?? undefined,
      "data-height-stop": view.height?.stop ?? undefined,
      "data-dragging": view.dragging ?? undefined,
      "data-animating": view.animating ? "" : undefined,
      "data-zero":
        isZero(rendering.width) || isZero(rendering.height) ? "" : undefined,
    }),
    getContentProps: ({ style } = {}) => ({
      style: {
        ...contentStyle(
          {
            width: rendering.width !== null,
            height: rendering.height !== null,
          },
          holding,
        ),
        ...style,
      },
      "data-resizable-content": "",
    }),
    getClipProps: ({ slide = false, style } = {}) => {
      const floating = config.position !== null;
      if (slide && floating) {
        warnOnce(
          `getClipProps({ slide: true }): a floating element (anchor: "none") has no anchored edge for its content to slide from, so it's covered instead.`,
        );
      }
      const slides = (dimension: Dimension) =>
        slide && !floating && (state.sliding?.[dimension] ?? false);
      // A ratio-locked height has no stops of its own: it follows its width.
      const slidesUp = config.height ? slides("height") : slides("width");
      const heightAnchor = config.height?.anchor ?? config.aspect?.heightAnchor;
      return {
        ref: forReact(controller.clipRef),
        style: {
          ...clipStyle({
            horizontal:
              rendering.width && config.width
                ? (pinOf(
                    config.width.anchor,
                    slides("width"),
                    "left",
                  ) as ClipPins["horizontal"])
                : null,
            vertical:
              rendering.height && heightAnchor
                ? (pinOf(heightAnchor, slidesUp, "top") as ClipPins["vertical"])
                : null,
          }),
          ...style,
        },
        "data-resizable-clip": "",
        "data-zero":
          isZero(rendering.width) || isZero(rendering.height) ? "" : undefined,
        "data-sliding":
          slides("width") || (rendering.height && slidesUp) ? "" : undefined,
      };
    },
    getHandleProps,
    setStop: controller.setStop,
    toggle: controller.toggle,
    setSize: controller.setSize,
    setPosition: controller.setPosition,
    getSnapshot: controller.getSnapshot,
    restore: controller.restore,
    reset: controller.reset,
    controller,
  };
}

/**
 * Where a clip layer pins content along a dimension with `anchor`: its
 * anchored edge, or sliding, the one opposite (which moves); the centre
 * for a centre anchor; and a floating element's from `start`, its top or
 * left, where its position is.
 */
function pinOf(
  anchor: DimensionAnchor,
  slides: boolean,
  start: "left" | "top",
): "left" | "right" | "top" | "bottom" | "center" {
  if (anchor === "center") return "center";
  if (anchor === "none") return start;
  return slides ? OPPOSITE[anchor] : anchor;
}

const OPPOSITE = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
} as const;

/**
 * `--resizable-content-width` and `-height`, for content that keeps its
 * size (`initial` while that's just the size; see `contentVariable`).
 */
function contentVariables(
  rendering: ResizableRendering,
  holding: boolean,
  fromStops: ResizableState["fromStops"],
): CSSProperties {
  const variables: Record<string, string> = {};
  const { width, height } = rendering;
  // Held while reflowing once, or while an animated change moves the
  // dimension to another stop (see `contentVariable`).
  const holds = (dimension: Dimension, stop: string | null) =>
    holding ||
    holdsWhileAnimating(rendering.animating, fromStops?.[dimension], stop);
  if (width) {
    variables["--resizable-content-width"] = contentVariable(
      width.contentSize,
      width.size,
      holds("width", width.stop),
    );
  }
  if (height) {
    variables["--resizable-content-height"] = contentVariable(
      height.contentSize,
      height.size,
      holds("height", height.stop),
    );
  }
  return variables;
}
