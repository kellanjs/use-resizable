/**
 * `useResizable`'s types: its options, what it returns and the props it
 * hands out, and the inference that types them from the options (each
 * dimension's stop names, and the position), for the hook and its remotes.
 */
import type { CSSProperties, RefObject } from "react";

import type {
  Dimension,
  HandleEdge,
  LogicalHandleEdge,
} from "../foundation/handle.js";
import type {
  ClipOptions,
  PropsOptions,
  ResizableClipProps,
  ResizableContentProps,
} from "../foundation/props.js";
import type { RefCallback } from "../foundation/ref-callback.js";
import type { Remote } from "../foundation/remote.js";
import type { SizeValue } from "../foundation/size.js";
import type { DimensionOptions } from "./dimension.js";
import type { DragTarget, ResizableOptions } from "./resizable-config.js";
import type {
  ResizableCallbacks,
  ResizableController,
} from "./resizable-controller.js";
import type { ResizableDimension, ResizableView } from "./resizable-view.js";

export type UseResizableOptions = ResizableOptions &
  ResizableCallbacks & {
    /** The element `%` sizes are relative to. Defaults to the element's parent. */
    containerRef?: RefObject<Element | null>;
    /** `id` for the element; handles point to it. Generated if omitted. */
    id?: string;
    /**
     * What a screen reader announces for an edge handle's value
     * (`aria-valuetext`), for your own wording or language. `stop` is
     * `null` for a dimension without named stops, `size` is in pixels (or
     * `null` before measuring). Defaults to "rail, 56 pixels" with named
     * stops, and nothing without (`aria-valuenow` then says the size).
     */
    valueText?: (value: {
      dimension: Dimension;
      stop: string | null;
      size: number | null;
    }) => string | undefined;
    /**
     * A remote to attach this resizable to while it's mounted (see
     * `createResizableRemote`). Its type must have the same stops, which
     * the hook checks.
     */
    // `any`: matched to the options by `RemoteChecked`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    remote?: ResizableRemote<any>;
  };

/**
 * `ResizableDimension` when the options configure that dimension, `null`
 * when they don't mention it, and either when the options' type can't tell
 * (e.g. options built at runtime, where it's optional). This spares a sidebar
 * from writing `sidebar.width?.size` when its width is obviously there.
 */
export type DimensionOf<O, K extends Dimension> =
  O extends Record<K, infer D extends DimensionOptions>
    ? ResizableDimension<StopsOf<D>>
    : K extends "height"
      ? O extends { aspectRatio: number; width: infer W }
        ? // A ratio-locked height follows the width, stops included.
          ResizableDimension<StopsOf<W>>
        : MaybeDimension<O, K>
      : MaybeDimension<O, K>;

type MaybeDimension<O, K extends Dimension> = K extends keyof O
  ? ResizableDimension | null
  : null;

/**
 * The stop names a dimension's options define: the names written, or with
 * options typed to allow any (`DimensionOptions`, say), `string`.
 */
type StopsOf<D> = D extends { stops?: infer S }
  ? keyof NonNullable<S> & string
  : never;

/** Every stop name either dimension defines (see `StopsOf`). */
type AllStopsOf<O> =
  | (O extends { width?: infer W } ? StopsOf<W> : never)
  | (O extends { height?: infer H } ? StopsOf<H> : never);

/**
 * The stop names `dimension` defines: a ratio-locked height's are the
 * width's, as `setStop(stop, "height")` goes to the width.
 */
type DimensionStopsOf<O, D extends Dimension> = D extends "height"
  ? O extends { aspectRatio: number; width?: infer W }
    ? StopsOf<W>
    : O extends { height?: infer H }
      ? StopsOf<H>
      : never
  : O extends { width?: infer W }
    ? StopsOf<W>
    : never;

/** Each dimension's stop names (see `DimensionStopsOf`). */
type StopsByDimension<O> = {
  width: DimensionStopsOf<O, "width">;
  height: DimensionStopsOf<O, "height">;
};

export interface ResizableElementProps {
  ref: RefCallback;
  id: string;
  style: CSSProperties;
  /** The width's stop, if it has named stops (`[data-width-stop="rail"]`). */
  "data-width-stop": string | undefined;
  /** The height's stop, if it has named stops. */
  "data-height-stop": string | undefined;
  /** What's being dragged: a handle's edge, or "move". */
  "data-dragging": DragTarget | undefined;
  /** Set while a committed change (release, `setStop`, …) transitions. */
  "data-animating": "" | undefined;
  /** Set while either dimension is at zero (and `hideAtZero` may hide it). */
  "data-zero": "" | undefined;
}

export interface ResizableMoveHandleProps {
  ref: RefCallback;
  tabIndex: number;
  style: CSSProperties;
  "aria-disabled": true | undefined;
  "data-handle": "move";
  "data-dragging": "" | undefined;
}

export interface ResizableHandleProps {
  ref: RefCallback;
  /**
   * An edge is a `separator`; a corner is hidden from assistive tech, but
   * for one that's the keyboard's way to resize (with no edge handle for
   * some dimension it moves), which is a `slider`.
   */
  role: "separator" | "slider" | undefined;
  tabIndex: number;
  style: CSSProperties;
  "aria-controls": string | undefined;
  "aria-orientation": "horizontal" | "vertical" | undefined;
  "aria-valuenow": number | undefined;
  "aria-valuemin": number | undefined;
  "aria-valuemax": number | undefined;
  /**
   * With named stops, the stop and size ("rail, 56 pixels"), or whatever
   * `valueText` returns.
   */
  "aria-valuetext": string | undefined;
  /** Set while the resizable is `disabled`. */
  "aria-disabled": true | undefined;
  "aria-hidden": true | undefined;
  "data-handle": HandleEdge;
  "data-dragging": "" | undefined;
  /**
   * Set when the dimension it drives is at 0 (either one, for a corner).
   * Its edge may then lie against the container's, where a handle centred
   * on it would be half cut off; `[data-zero]` can move it to the open
   * side.
   */
  "data-zero": "" | undefined;
  /** The stop of the dimension this handle resizes, if it has named stops. */
  "data-stop": string | undefined;
}

/**
 * What `useResizable` returns: its view (see `ResizableView`), and props
 * and actions.
 */
export interface Resizable extends ResizableView {
  /** Spread onto the resizable element. */
  getElementProps(options?: PropsOptions): ResizableElementProps;
  /**
   * Spread onto a wrapper inside the element, around its content (not its
   * handles: keep them beside it), to lay the content out at the content size:
   * at rest at a rail or 0, the size of the range it goes back to; on its way
   * to one, the size it had as it left; carried on from an interrupted change,
   * the size it was laid out at; and with `reflow: "once"`, through a drag at
   * the size it had, and through an animated change at the larger of its sizes
   * before and after, until it's over. Clip a layer inside the element
   * (`overflow: hidden`) where content larger than it shouldn't show: clipping
   * the element itself would clip handles that hang over its edge.
   */
  getContentProps(options?: PropsOptions): ResizableContentProps;
  /**
   * Spread onto a layer inside the element, around the content wrapper
   * (`getContentProps`), not the handles: it fills the element (which must
   * be what it's positioned against: `position: relative`, say), clips
   * what's past its edge, and pins the content to the anchored edge, so
   * the moving edge covers and uncovers it. With `slide`, the content
   * instead travels with the moving edge as it closes to 0 or opens from
   * it, as a drawer does. The element's size must come from elsewhere (its
   * resizing, or its layout): the layer takes the content out of its flow.
   */
  getClipProps(options?: ClipOptions): ResizableClipProps;
  /**
   * Spread onto a handle that drives `edge` (an edge or a corner). It can be
   * any element, anywhere: a drag moves the edge by however far the pointer
   * moves. Add your own `aria-label` to every handle. Corner handles are
   * hidden from assistive tech and the tab order, since their two edges
   * already cover them, except the one that takes the keyboard where only
   * corners do it (see Accessibility in the README). Where it sits, and how
   * big it is, is up to your styles.
   */
  getHandleProps(
    edge: HandleEdge | LogicalHandleEdge,
    options?: PropsOptions,
  ): ResizableHandleProps;
  /**
   * Spread onto a floating element's move handle (e.g. a title bar).
   * Arrow keys move it too; add an `aria-label` that says so.
   */
  getMoveHandleProps(options?: PropsOptions): ResizableMoveHandleProps;
  setStop: ResizableController["setStop"];
  toggle: ResizableController["toggle"];
  setSize: ResizableController["setSize"];
  setPosition: ResizableController["setPosition"];
  getSnapshot: ResizableController["getSnapshot"];
  restore: ResizableController["restore"];
  reset: ResizableController["reset"];
  /** The underlying controller, for sharing with other components. */
  controller: ResizableController;
}

/**
 * Where the element is: always there for `anchor: "none"`, `null` for any
 * other anchor, and either when the options' type can't tell.
 */
export type PositionOf<O> = O extends { anchor: infer A }
  ? [A] extends ["none"]
    ? NonNullable<Resizable["position"]>
    : "none" extends A
      ? Resizable["position"]
      : null
  : Resizable["position"];

/**
 * A {@link Resizable} with `width`, `height` and `position` narrowed to what
 * the options configure. It stays assignable to plain `Resizable`, so it can
 * be passed to components that accept any resizable.
 */
export type ResizableOf<O> = Omit<
  Resizable,
  "width" | "height" | "position" | "setStop" | "toggle"
> & {
  width: DimensionOf<O, "width">;
  height: DimensionOf<O, "height">;
  position: PositionOf<O>;
  /** A stop of either dimension, or with `dimension`, of that one. */
  setStop(stop: AllStopsOf<O>): void;
  setStop<D extends Dimension>(
    stop: DimensionStopsOf<O, D>,
    dimension: D,
  ): void;
  toggle(stop: AllStopsOf<O>): void;
  toggle<D extends Dimension>(stop: DimensionStopsOf<O, D>, dimension: D): void;
};

/**
 * What a remote reads of a resizable: its view, with `width`, `height` and
 * `position` narrowed by the options as on {@link ResizableOf}.
 */
export type ResizableViewOf<O> = Omit<
  ResizableView,
  "width" | "height" | "position"
> & {
  width: DimensionOf<O, "width">;
  height: DimensionOf<O, "height">;
  position: PositionOf<O>;
};

/**
 * What a remote and the resizable it's given to must agree on: what its
 * view reads (stops by dimension, anchoring) and the stops its actions
 * take. Only these: sizes, persistence and callbacks may differ. Written
 * as a conditional so it's compared by its members, not by `O` (two
 * options with the same stops are different types).
 */
export type ResizableContractOf<O> = [O] extends [unknown]
  ? {
      view: ResizableViewOf<O>;
      stops: AllStopsOf<O>;
      dimensionStops: StopsByDimension<O>;
    }
  : never;

type ResizableContract = {
  view: unknown;
  stops: string;
  dimensionStops: Record<Dimension, string>;
};

/**
 * A remote's way into the resizable attached to it: its actions and its
 * view, read when called. Not its props: those belong where it's rendered.
 */
export interface ResizableRemoteEndpoint<
  C extends ResizableContract = ResizableContract,
> {
  /** What it is now (see `ResizableView`). */
  getView(): C["view"];
  setStop(stop: C["stops"]): void;
  setStop<D extends Dimension>(
    stop: C["dimensionStops"][D],
    dimension: D,
  ): void;
  toggle(stop: C["stops"]): void;
  toggle<D extends Dimension>(stop: C["dimensionStops"][D], dimension: D): void;
  setSize(sizes: Partial<Record<Dimension, SizeValue>>): void;
  setPosition(position: { x?: SizeValue; y?: SizeValue }): void;
  getSnapshot: ResizableController["getSnapshot"];
  restore: ResizableController["restore"];
  reset: ResizableController["reset"];
}

/** A remote for a resizable, by its contract (see `ResizableRemoteOf`). */
export type ResizableRemote<C extends ResizableContract = ResizableContract> =
  Remote<"resizable", C, ResizableRemoteEndpoint<C>>;

/**
 * The remote `createResizableRemote<O>()` makes, for annotations. A
 * conditional for the same reason as the contract: a plain alias would be
 * compared by `O`.
 */
export type ResizableRemoteOf<O> = [O] extends [unknown]
  ? ResizableRemote<ResizableContractOf<O>>
  : never;
