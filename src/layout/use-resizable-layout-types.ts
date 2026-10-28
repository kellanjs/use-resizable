/**
 * `useResizableLayout`'s types: its options, what it returns and the props
 * it hands out, and the inference that types them from the options (ids,
 * and each id's stop names), for the hook and its remotes.
 */
import type { CSSProperties } from "react";

import type {
  ClipOptions,
  PropsOptions,
  ResizableClipProps,
  ResizableContentProps,
} from "../foundation/props.js";
import type { RefCallback } from "../foundation/ref-callback.js";
import type { Remote } from "../foundation/remote.js";
import type { SizeValue } from "../foundation/size.js";
import type { LayoutOptions } from "./layout-config.js";
import type { LayoutCallbacks, LayoutController } from "./layout-controller.js";
import type {
  ResizableLayoutChild,
  ResizableLayoutView,
} from "./layout-view.js";
import type { SeparatorSide } from "./separators.js";
import type { LayoutDirection } from "./tree.js";

/**
 * The hook's options. `Id` is the children's ids, which the callbacks get;
 * the hook works it out from `layout`.
 */
export type UseResizableLayoutOptions<Id extends string = string> =
  LayoutOptions<Id> &
    LayoutCallbacks<Id> & {
      /**
       * Prefix for the DOM ids of elements and groups (`<prefix>-files`),
       * which separators point to. Generated if omitted.
       */
      idPrefix?: string;
      /**
       * What a screen reader announces for a separator's value
       * (`aria-valuetext`): `id` is the child it's about (its `primary`
       * neighbour: the one before it, unless it says `"after"`), whose size
       * the separator reports. `stop` is `null` without named stops, `size` is in
       * pixels (or `null` before measuring). Defaults to "rail, 56 pixels"
       * with named stops, and nothing without.
       */
      valueText?: (value: {
        id: Id;
        stop: string | null;
        size: number | null;
      }) => string | undefined;
      /**
       * A remote to attach this layout to while it's mounted (see
       * `createLayoutRemote`). Its type must have the same ids and stops,
       * which the hook checks.
       */
      // `any`: matched to the layout by the hook.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      remote?: LayoutRemote<any>;
    };

export interface ResizableLayoutGroupProps {
  ref: RefCallback;
  id: string;
  style: CSSProperties;
  /** Its id. */
  "data-group": string;
  /** How it lays out its children (a grid, both ways: `undefined`). */
  "data-direction": LayoutDirection | undefined;
  /** Set on a grid. */
  "data-grid": "" | undefined;
  /** A nested group's stop, if it has named stops. */
  "data-stop": string | undefined;
  /** Set while a nested group is at zero. */
  "data-zero": "" | undefined;
  /** On the root group: a separator is being dragged. */
  "data-dragging": "" | undefined;
  /** On the root group: a committed change (release, `setStop`, …) transitions. */
  "data-animating": "" | undefined;
}

export interface ResizableLayoutElementProps {
  ref: RefCallback;
  id: string;
  style: CSSProperties;
  "data-element": string;
  /** The stop it's in, if it has named stops (`[data-stop="rail"]`). */
  "data-stop": string | undefined;
  /** Set while it's at zero (and `hideAtZero` may hide it). */
  "data-zero": "" | undefined;
}

export interface ResizableLayoutSeparatorProps {
  ref: RefCallback;
  role: "separator";
  tabIndex: number;
  style: CSSProperties;
  "aria-controls": string;
  "aria-orientation": "horizontal" | "vertical";
  "aria-valuenow": number | undefined;
  "aria-valuemin": number | undefined;
  "aria-valuemax": number | undefined;
  /**
   * With named stops, the stop and size of the child it's about (its
   * `primary` neighbour), or whatever `valueText` returns.
   */
  "aria-valuetext": string | undefined;
  /**
   * Set while the layout is `disabled`, and while the separator can't
   * change anything either way (say, beside a `"last"` fill holding no
   * space, or with only fixed sizes on one side): then it also has no
   * resize cursor or `data-hover`, and presses do nothing (not even start
   * a text selection, as on a separator that moves). One that can't change
   * anything stays focusable (while the layout and its keyboard are
   * enabled), so focus doesn't jump around.
   */
  "aria-disabled": true | undefined;
  /**
   * The direction of the group it's in. The line runs across it: in a row,
   * a separator is a vertical line (`aria-orientation="vertical"`).
   */
  "data-direction": LayoutDirection;
  "data-dragging": "" | undefined;
  /**
   * Set while a mouse or pen is over something a press on would drag this
   * separator: itself, another segment of its line (in a grid), or a
   * junction that drags it. It's what `data-dragging` would be, so style it instead
   * of `:hover` and the lines that light up are the lines that will move.
   */
  "data-hover": "" | undefined;
  /**
   * Which neighbour is at zero, if any. The separator then sits at the
   * zero child's place, which may be the same place as another separator's
   * (a nested group's last child at zero puts its separator next to the
   * group's own), so it can move its hit area onto the open side.
   */
  "data-zero": "before" | "after" | "both" | undefined;
}

export interface ResizableLayoutJunctionProps {
  ref: RefCallback;
  /**
   * Pointer-only, like a corner: each separator it drags is reachable from
   * the keyboard on its own.
   */
  tabIndex: -1;
  "aria-hidden": true;
  style: CSSProperties;
  /** Set while it's being dragged (not when one of its separators is). */
  "data-dragging": "" | undefined;
  /**
   * Set while a mouse or pen is over it: what `data-dragging` would be on a
   * press. Its separators get `data-hover` then too.
   */
  "data-hover": "" | undefined;
}

/** `getClipProps`' options, in a layout. */
export interface LayoutClipOptions extends ClipOptions {
  /**
   * The child's edge its content is pinned to (covering), or slides from
   * (`slide`), along its group's direction. By default, its place in its
   * group: the first (or only) child's start, the last child's end (the
   * edge away from its separator), and a middle child's start. Start and
   * end follow the direction the layer inherits from its group.
   */
  anchor?: "start" | "end";
}

/** `getSeparatorProps`' options. */
export interface SeparatorPropsOptions extends PropsOptions {
  /**
   * In a grid, which segment of the line (from its start): a cell spanning
   * across a line cuts it, and each piece is an element of its own (see
   * `separatorsOf`). `0` by default, the whole line when nothing cuts it.
   */
  segment?: number;
  /**
   * Which neighbour the separator is about: `"before"` (the default) or
   * `"after"`, for a panel at the end, like a preview on the right or a
   * terminal at the bottom. Its `aria-controls`, its value (`aria-valuenow`,
   * `-min`, `-max`, `aria-valuetext`, and the `id` `valueText` gets), Home
   * and End (its smallest and largest sizes) and Enter (toggling its stop)
   * are all that neighbour's, so label it for that one ("Resize preview").
   * Arrows still move the line on screen, whichever it is.
   */
  primary?: SeparatorSide;
}

/** A separator to render (see `separatorsOf`). */
export interface ResizableLayoutSeparatorEntry<Id extends string = string> {
  /** Unique among the layout's separators, for React's `key`. */
  key: string;
  before: Id;
  after: Id;
  /** For `getSeparatorProps(before, after, { segment })`. */
  segment: number;
}

/** A child of a group, for rendering the tree (see `childrenOf`). */
export interface ResizableLayoutEntry<Id extends string = string> {
  id: Id;
  /** A grid's children are its cells: elements, or groups or grids. */
  kind: "element" | "group" | "grid";
  /**
   * The child before it, if any: the separator between them is theirs.
   * `null` for a grid's cells (see `separatorsOf` for its lines).
   */
  previous: Id | null;
}

/**
 * What `useResizableLayout` returns: its view (see `ResizableLayoutView`),
 * and props and actions.
 */
export interface ResizableLayout<Id extends string = string> extends Omit<
  ResizableLayoutView<Id>,
  "children"
> {
  /**
   * A group's children in order, for rendering a tree recursively: an
   * element gets `getElementProps`, a group gets `getGroupProps` and its own
   * children, and each child after the first has a separator,
   * `getSeparatorProps(child.previous, child.id)`, before it.
   */
  childrenOf(id: Id): ResizableLayoutEntry<Id>[];
  /**
   * An element, a nested group or grid, or a grid's track, by id. (A grid's
   * cells have no view of their own: their sizes are their tracks'.)
   */
  getChild(id: Id): ResizableLayoutChild<Id> | undefined;
  /** Spread onto a group's element (the root's, or a nested one's). */
  getGroupProps(id: Id, options?: PropsOptions): ResizableLayoutGroupProps;
  /** Spread onto an element. */
  getElementProps(id: Id, options?: PropsOptions): ResizableLayoutElementProps;
  /**
   * Spread onto a wrapper inside an element, around its content, to lay
   * the content out at the element's content size: at its open size while
   * the element is at a rail or 0, or on its way there, and with `reflow:
   * "once"`, through a drag at the size it had, and through an animated
   * change at the larger of its sizes before and after, until it's over.
   * The element clips it.
   */
  getContentProps(id: Id, options?: PropsOptions): ResizableContentProps;
  /**
   * Spread onto a layer inside an element (or a grid's cell), around its
   * content wrapper (`getContentProps(id)`): it fills the element, clips
   * it, and pins the content to an edge (see `anchor`), so the moving edge
   * covers and uncovers it. With `slide`, the content instead travels with
   * the moving edge as the element closes to 0 or opens from it, along
   * its group's direction (across it, and in a cell, it's covered). The
   * element must be what it's positioned against: its own styles
   * (`position: relative`, say), as `getElementProps` leaves that alone.
   */
  getClipProps(id: Id, options?: LayoutClipOptions): ResizableClipProps;
  /**
   * The separators to render in a group or a grid: between each two
   * neighbouring children of a group, and every segment of a grid's lines
   * (a line runs between two neighbouring tracks, wherever no cell spans
   * across it). Each is `getSeparatorProps(before, after, { segment })`.
   */
  separatorsOf(id: Id): ResizableLayoutSeparatorEntry<Id>[];
  /**
   * Spread onto the separator between two neighbouring children of a group,
   * or onto a segment of a grid's line between two neighbouring tracks
   * (`segment`; see `separatorsOf`), which it places. Add your own
   * `aria-label`.
   */
  getSeparatorProps(
    before: Id,
    after: Id,
    options?: SeparatorPropsOptions,
  ): ResizableLayoutSeparatorProps;
  /**
   * Spread onto a junction: an element that drags several separators at
   * once (each `[before, after]`, as for `getSeparatorProps`), like a
   * corner drives two edges. Put it where they cross (a junction of a
   * grid's column line and row line places itself there); it gets the
   * `move` cursor when they run different ways. Separators that move the
   * same space can't be dragged together (they're in one group, or in
   * nested groups that run the same way): only the first of them moves.
   */
  getJunctionProps(
    separators: readonly (readonly [Id, Id])[],
    options?: PropsOptions,
  ): ResizableLayoutJunctionProps;
  /**
   * Moves a child (an element or a nested group) to a stop: a point, or a
   * range at the size it last had there. Its siblings make room.
   */
  setStop(id: Id, stop: string): void;
  /**
   * Moves a child to `stop`, or if it's there, back: to the stop it came
   * from if that's a larger one, else to its last range.
   */
  toggle(id: Id, stop: string): void;
  /**
   * Moves several children to stops at once, as one change (one
   * transition, one `onChange`, one save): `setStops({ note: "open",
   * display: "closed" })` shows the note alone. The order written doesn't
   * matter: one refused at its turn (closing the only open child first) is
   * tried again after the rest. All or nothing: if one still can't move,
   * none do. Children already there are skipped.
   */
  setStops(stops: Partial<Record<Id, string>>): void;
  /** Whether `setStops(stops)` would change anything (see `canSetStop`). */
  canSetStops(stops: Partial<Record<Id, string>>): boolean;
  /**
   * Whether `setStop(id, stop)` would change anything, for disabling a
   * control that wouldn't: `false` if it would change nothing (a child
   * stepped down to `stop` changes: it's chosen there, so it stays when
   * there's room), if it's refused (it'd leave the child's group with
   * nothing to take its space: see Empty space in the README; or with
   * `refuseOverflow`, it'd overflow), or if there's no child `id`.
   */
  canSetStop(id: Id, stop: string): boolean;
  /**
   * Whether `toggle(id, stop)` would change anything: as `canSetStop`, but
   * a child at `stop` goes back, so it's `false` there only if it has
   * nowhere to go back to, or going back would be refused.
   */
  canToggle(id: Id, stop: string): boolean;
  setSize(id: Id, size: SizeValue): void;
  getSnapshot: LayoutController["getSnapshot"];
  restore: LayoutController["restore"];
  /**
   * Goes back to the layout the options start with (also with the root's
   * id); with a child's id, just that child, and its siblings make room.
   */
  reset(id?: Id): void;
  /** The underlying controller, for sharing with other components. */
  controller: LayoutController;
}

/** What a part of the options holds: a group's or a grid's children, and a
 * grid's tracks. */
type PartsOf<P> =
  | (P extends { children: readonly (infer C)[] } ? C : never)
  | (P extends { columns: readonly (infer T)[] } ? T : never)
  | (P extends { rows: readonly (infer T)[] } ? T : never);

/**
 * Every id in a list of children, nested groups' and grids' included (a
 * grid's tracks and cells). The options type is itself recursive, so the
 * depth is capped (8 levels) to keep TypeScript from expanding it forever.
 */
type ChildIds<P, Depth extends unknown[] = []> = Depth["length"] extends 8
  ? never
  : P extends { id: infer Id extends string }
    ? Id | ChildIds<PartsOf<P>, [...Depth, unknown]>
    : never;

/**
 * The ids of a grid's cells, which have no view of their own, a grid's or
 * group's in a cell included.
 */
type CellIds<P, Depth extends unknown[] = []> = Depth["length"] extends 8
  ? never
  : P extends { id: infer Id extends string; column: string }
    ? Id | CellIds<PartsOf<P>, [...Depth, unknown]>
    : P extends { id: string }
      ? CellIds<PartsOf<P>, [...Depth, unknown]>
      : never;

/**
 * The children's ids the options define (every id but the root's), or
 * `string` when they're built at runtime.
 */
export type ChildIdsOf<O> = O extends { layout: infer R }
  ? string extends ChildIds<PartsOf<R>>
    ? string
    : ChildIds<PartsOf<R>>
  : string;

/**
 * The ids of the options' grid cells: none to tell apart when ids are built
 * at runtime (then every id is `string`).
 */
type CellIdsOf<O> =
  string extends ChildIdsOf<O>
    ? never
    : O extends { layout: infer R }
      ? CellIds<PartsOf<R>>
      : never;

/** Every id the options define, the root's included. */
export type IdsOf<O> =
  | ChildIdsOf<O>
  | (O extends { layout: { id: infer Root extends string } } ? Root : never);

/** Each child's stop names, as `{ id, stops }` pairs (depth capped as above). */
type ChildStops<P, Depth extends unknown[] = []> = Depth["length"] extends 8
  ? never
  : P extends { id: infer Id extends string }
    ? | {
          id: Id;
          stops: P extends { stops: infer S } ? keyof S & string : never;
        }
      | ChildStops<PartsOf<P>, [...Depth, unknown]>
    : never;

/**
 * The stop names of the entries whose id includes `K`: one made from a
 * list of ids (`ids.map((id) => ({ id, stops }))`) has them all.
 */
type StopsOfId<Entries, K> = Entries extends {
  id: infer Id;
  stops: infer Stops;
}
  ? K extends Id
    ? Stops
    : never
  : never;

/** Each id's stop names, or `string` for all when built at runtime. */
type StopsOf<O> = O extends { layout: infer R }
  ? string extends ChildIds<PartsOf<R>>
    ? Record<string, string>
    : {
        [K in ChildIds<PartsOf<R>>]: StopsOfId<ChildStops<PartsOf<R>>, K>;
      }
  : Record<string, string>;

/** The stop names of `K` in a `Stops` map (`never` for no named stops). */
type StopName<Stops, K> = K extends keyof Stops ? Stops[K] & string : string;

/** `setStops`' argument: some of the children, each with one of its stops. */
type StopsFor<Id extends string, Stops> = {
  [K in Id]?: StopName<Stops, K>;
};

/** `T` is one string literal (not a union of them, nor `string`). */
type IsOne<T, U = T> = [T] extends [never]
  ? false
  : string extends T
    ? false
    : T extends unknown
      ? [U] extends [T]
        ? true
        : false
      : never;

/**
 * The ids surely in a part of the options `P` (its own included),
 * whichever of a union of them it is: those in every alternative. A
 * node's own id if it's one literal (`{ id: selected }`, `"a" | "b"`, may
 * be either), and those in the entries a tuple surely has: an array's
 * may not be there (its type names the ids it can hold, not those it
 * does: a filtered list, or one made with `map`, as TypeScript can't tell
 * them apart).
 */
type GuaranteedIds<P, Depth extends unknown[] = []> = Depth["length"] extends 8
  ? never
  : // Each alternative's, as a parameter: inferred back, they intersect.
    (
        P extends { id: string }
          ? (ids: GuaranteedOne<P, Depth>) => void
          : never
      ) extends (ids: infer Every) => void
    ? Every
    : never;

type GuaranteedOne<P, Depth extends unknown[]> =
  | (P extends { id: infer Id extends string }
      ? IsOne<Id> extends true
        ? Id
        : never
      : never)
  | GuaranteedParts<P, [...Depth, unknown]>;

/** The ids surely inside `P` (not its own). */
type GuaranteedParts<P, Depth extends unknown[]> =
  | GuaranteedList<P extends { children: infer L } ? L : [], Depth>
  | GuaranteedList<P extends { columns: infer L } ? L : [], Depth>
  | GuaranteedList<P extends { rows: infer L } ? L : [], Depth>;

/**
 * The ids surely in a list of options, whichever of a union of lists it
 * is (`small ? [a] : [a, b]`): those in every one. (None, not every id,
 * for no list at all.)
 */
type GuaranteedList<L, Depth extends unknown[]> = [L] extends [never]
  ? never
  : (
        L extends unknown ? (ids: GuaranteedTuple<L, Depth>) => void : never
      ) extends (ids: infer Every) => void
    ? Every
    : never;

/** The ids surely in one list: its entries a tuple surely has. */
type GuaranteedTuple<L, Depth extends unknown[]> = L extends readonly []
  ? never
  : L extends readonly [infer First, ...infer Rest]
    ? GuaranteedIds<First, Depth> | GuaranteedTuple<Rest, Depth>
    : L extends readonly [...infer Init, infer Last]
      ? GuaranteedIds<Last, Depth> | GuaranteedTuple<Init, Depth>
      : never;

/**
 * The options' ids that may not be there: all but those surely there (see
 * `GuaranteedIds`), in every layout a union of them can be (`small ? compact :
 * full`), at any depth.
 */
type MaybeIdsOf<O> = O extends { layout: infer R }
  ? Exclude<ChildIds<PartsOf<R>>, GuaranteedInside<R>>
  : never;

/** The ids surely inside every layout the union `R` can be. */
type GuaranteedInside<R> = (
  R extends unknown ? (ids: GuaranteedParts<R, []>) => void : never
) extends (ids: infer Every) => void
  ? Every
  : never;

/**
 * A child by an id the options name: there, with its own stop names
 * (`never` for none, so its `stop` reads `null`), unless it's in an array
 * of options or only some of a union of them (see `MaybeIdsOf`), or ids
 * are built at runtime: then it may
 * not exist.
 */
type ChildOf<O, K extends string> =
  string extends ChildIdsOf<O>
    ? ResizableLayoutChild<K> | undefined
    : K extends MaybeIdsOf<O>
      ? ResizableLayoutChild<K, StopName<StopsOf<O>, K> & string> | undefined
      : ResizableLayoutChild<K, StopName<StopsOf<O>, K> & string>;

/**
 * A {@link ResizableLayout} typed from its options: ids, and each id's stop
 * names, so `setStop("files", "tiny")` is a type error, and
 * `getChild("files")` needs no `?.`. The root's id goes where a group's
 * does, but not where a child's does: it has no size or stops of its own.
 * It stays assignable to plain `ResizableLayout<Id>`.
 */
export type ResizableLayoutOf<O> = Omit<
  ResizableLayout<IdsOf<O>>,
  | "elements"
  | "childrenOf"
  | "dragging"
  | "getElementProps"
  | "getContentProps"
  | "getClipProps"
  | "getSeparatorProps"
  | "separatorsOf"
  | "getJunctionProps"
  | "setStop"
  | "toggle"
  | "setStops"
  | "canSetStops"
  | "canSetStop"
  | "canToggle"
  | "setSize"
  | "getChild"
> & {
  elements: ResizableLayoutChild<ChildIdsOf<O>>[];
  childrenOf(id: IdsOf<O>): ResizableLayoutEntry<ChildIdsOf<O>>[];
  dragging: { before: ChildIdsOf<O>; after: ChildIdsOf<O> }[];
  getElementProps(
    id: ChildIdsOf<O>,
    options?: PropsOptions,
  ): ResizableLayoutElementProps;
  getContentProps(
    id: ChildIdsOf<O>,
    options?: PropsOptions,
  ): ResizableContentProps;
  getClipProps(
    id: ChildIdsOf<O>,
    options?: LayoutClipOptions,
  ): ResizableClipProps;
  getSeparatorProps(
    before: ChildIdsOf<O>,
    after: ChildIdsOf<O>,
    options?: SeparatorPropsOptions,
  ): ResizableLayoutSeparatorProps;
  separatorsOf(id: IdsOf<O>): ResizableLayoutSeparatorEntry<ChildIdsOf<O>>[];
  getJunctionProps(
    separators: readonly (readonly [ChildIdsOf<O>, ChildIdsOf<O>])[],
    options?: PropsOptions,
  ): ResizableLayoutJunctionProps;
  getChild<K extends Exclude<ChildIdsOf<O>, CellIdsOf<O>>>(
    id: K,
  ): ChildOf<O, K>;
  setStop<K extends ChildIdsOf<O>>(id: K, stop: StopName<StopsOf<O>, K>): void;
  toggle<K extends ChildIdsOf<O>>(id: K, stop: StopName<StopsOf<O>, K>): void;
  setStops(stops: StopsFor<ChildIdsOf<O>, StopsOf<O>>): void;
  canSetStops(stops: StopsFor<ChildIdsOf<O>, StopsOf<O>>): boolean;
  canSetStop<K extends ChildIdsOf<O>>(
    id: K,
    stop: StopName<StopsOf<O>, K>,
  ): boolean;
  canToggle<K extends ChildIdsOf<O>>(
    id: K,
    stop: StopName<StopsOf<O>, K>,
  ): boolean;
  setSize(id: ChildIdsOf<O>, size: SizeValue): void;
};

/**
 * What a remote reads of a layout: its view, typed from its options as on
 * {@link ResizableLayoutOf} (`children` by id, each with its own stops).
 */
export type ResizableLayoutViewOf<O> = Omit<
  ResizableLayoutView<ChildIdsOf<O>>,
  "children" | "elements" | "dragging"
> & {
  children: {
    readonly [K in Exclude<ChildIdsOf<O>, CellIdsOf<O>>]: ChildOf<O, K>;
  };
  elements: ResizableLayoutChild<ChildIdsOf<O>>[];
  dragging: { before: ChildIdsOf<O>; after: ChildIdsOf<O> }[];
};

/**
 * What a remote and the layout it's given to must agree on: its ids, each
 * child's stops, and what its view reads. Sizes, directions, persistence
 * and callbacks may differ. A conditional, so it's compared by its members
 * rather than by the options (see `ResizableRemoteOf`).
 */
export type LayoutContractOf<O> = [O] extends [unknown]
  ? {
      view: ResizableLayoutViewOf<O>;
      ids: IdsOf<O>;
      childIds: ChildIdsOf<O>;
      stops: StopsOf<O>;
    }
  : never;

type LayoutContract = {
  view: unknown;
  ids: string;
  childIds: string;
  stops: unknown;
};

/**
 * A remote's way into the layout attached to it: its actions, queries and
 * view, read when called. Not its props: those belong where it's rendered.
 */
export interface LayoutRemoteEndpoint<
  C extends LayoutContract = LayoutContract,
> {
  /** What it is now (see `ResizableLayoutView`). */
  getView(): C["view"];
  setStop<K extends C["childIds"]>(id: K, stop: StopName<C["stops"], K>): void;
  toggle<K extends C["childIds"]>(id: K, stop: StopName<C["stops"], K>): void;
  setStops(stops: StopsFor<C["childIds"], C["stops"]>): void;
  /** As the hook's, but from the layout as it is when called. */
  canSetStops(stops: StopsFor<C["childIds"], C["stops"]>): boolean;
  /** As the hook's, but from the layout as it is when called. */
  canSetStop<K extends C["childIds"]>(
    id: K,
    stop: StopName<C["stops"], K>,
  ): boolean;
  /** As the hook's, but from the layout as it is when called. */
  canToggle<K extends C["childIds"]>(
    id: K,
    stop: StopName<C["stops"], K>,
  ): boolean;
  setSize(id: C["childIds"], size: SizeValue): void;
  getSnapshot: LayoutController["getSnapshot"];
  restore: LayoutController["restore"];
  reset(id?: C["ids"]): void;
}

/** A remote for a layout, by its contract (see `LayoutRemoteOf`). */
export type LayoutRemote<C extends LayoutContract = LayoutContract> = Remote<
  "layout",
  C,
  LayoutRemoteEndpoint<C>
>;

/**
 * The remote `createLayoutRemote<L>()` makes, for annotations (a
 * conditional, as `ResizableRemoteOf` is).
 */
export type LayoutRemoteOf<L> = [L] extends [unknown]
  ? LayoutRemote<LayoutContractOf<{ layout: L }>>
  : never;
