/**
 * The layout's options, its parsed config, the shape of its state, and
 * setting it up: what the model, the snapshot functions, the controller and
 * the hook all agree on.
 */
import type { HeldContent } from "../foundation/held-content.js";
import {
  type CommonConfig,
  type CommonOptions,
  parseCommonOptions,
} from "../foundation/options.js";
import type { Viewport } from "../foundation/size.js";
import type { ChangeKind } from "../foundation/transition.js";
import type { GroupItem, NeighbourStops } from "./solver.js";
import {
  type LayoutRootOptions,
  type RootNode,
  type SeparatorPair,
  parseTree,
} from "./tree.js";

/** The layout's options. `Id` is the children's ids. */
export interface LayoutOptions<
  Id extends string = string,
> extends CommonOptions {
  /**
   * The root: a group, with its direction and children (see
   * `LayoutGroupOptions`), or a grid (see `LayoutGridOptions`).
   */
  layout: LayoutRootOptions;
  /**
   * Whether dragging a separator moves children beyond its two neighbours
   * once a neighbour can't move further (default `true`). Turn it off and
   * the separator stops there instead.
   */
  cascade?: boolean;
  /**
   * Separators the user can't move, each `[before, after]` as for
   * `getSeparatorProps`: presses and keys there do nothing, a junction
   * drags only its others, and they look it (`aria-disabled`, no cursor or
   * `data-hover`). The children either side can still change other ways:
   * another separator's drag pushing on, the window, your code.
   */
  disabledSeparators?: readonly (readonly [Id, Id])[];
}

/** Options after parsing and defaulting. Plain data, safe to compare. */
export interface LayoutConfig extends CommonConfig {
  readonly root: RootNode;
  readonly cascade: boolean;
  readonly disabledSeparators: readonly SeparatorPair[];
}

/** Whether the separator between `before` and `after` is disabled. */
export function isSeparatorDisabled(
  config: LayoutConfig,
  before: string,
  after: string,
): boolean {
  return config.disabledSeparators.some(
    (pair) => pair.before === before && pair.after === after,
  );
}

/**
 * Measured or saved sizes closer than this, in pixels, are the same: a
 * difference that small is noise from adding up fractions.
 */
export const MEASURE_EPSILON = 0.01;

/**
 * While children are moving (see `inMotion`), measured spaces closer than
 * this to the last are the same. The browser rounds each child's size (to
 * 1/64px in Chromium), so a group's children can add up a fraction
 * differently from one frame to the next with nothing changed. Taken as a
 * change mid-drag, it would re-fit the group on every move, handing the
 * fraction to whichever child takes extra space, whose restyling makes the
 * browser repaint everything after it. (Mid-animation, a group's resizes
 * wait for the end anyway: see `measure`.) Once they stop, the space is
 * measured again, exactly.
 */
export const MOVING_MEASURE_EPSILON = 0.5;

/** Whether children are moving: a live drag, or a change animating. */
export function inMotion(state: LayoutState): boolean {
  return state.animating || state.drag !== null;
}

/**
 * A child's committed place in the layout, kept while it's at 0 and while
 * it's removed from the options, so it comes back the same.
 */
export interface ChildPlace {
  /** The stop it's in. */
  readonly stop: string;
  /** The size it last had in each range stop, along its group's axis. */
  readonly sizes: Readonly<Record<string, number>>;
  /** The last range stop it was in, which `toggle` returns to. */
  readonly lastRange: string | null;
  /**
   * The stop it was in before its latest committed change of stop (not the
   * ones a drag passed through), for `toggle` (see `toggleBack`).
   */
  readonly from?: string;
}

/** The space a group's children share, measured. */
export interface GroupSpace {
  /** The children's sizes added up: what they have to share. */
  readonly available: number;
  /**
   * The group's own size along its axis minus `available`: what its
   * separators, gaps and padding take. Counts toward its minimum size.
   */
  readonly overhead: number;
  /**
   * The group's own size across its axis minus its children's (which
   * stretch to fill it): its padding and borders that way. Counts toward
   * its minimum size across it.
   */
  readonly crossOverhead: number;
  /**
   * Each child's own padding and border along the axis, by id. Flexbox
   * never starts a child below these, so they're taken out of its share
   * (see `flex` in `ChildRendering`).
   */
  readonly bases: Readonly<Record<string, number>>;
  /**
   * For each child with `box-sizing: content-box` and padding or border
   * along the axis, by id: those, which its `flex-basis` doesn't include.
   */
  readonly basisOffsets: Readonly<Record<string, number>>;
  readonly rootFontSize: number;
  /** For `vw` and `vh` sizes; `null` if none use them. */
  readonly viewport: Viewport | null;
  /**
   * For a grid's columns or rows: the room between each two neighbouring
   * tracks (the line's track, and the gaps either side), which a cell
   * spanning both takes too. From the grid's computed template.
   */
  readonly between?: readonly number[];
}

/**
 * One separator being dragged: the separator after child `index` of a
 * group.
 */
export interface DraggedSeparator {
  readonly group: string;
  readonly index: number;
  /** The group's children and their sizes when the drag started. */
  readonly ids: readonly string[];
  readonly start: readonly GroupItem[];
  /**
   * The group lays its children out right to left (`direction: rtl` on a
   * row), so moving right grows the child after the separator.
   */
  readonly reversed: boolean;
  /**
   * The stop the pointer last reached for each child beside it (`null`:
   * the one it started in), which tells resisting from snapping.
   */
  readonly reached?: NeighbourStops;
}

/**
 * A drag in progress: one separator, or a junction's several, each along
 * its own group's axis.
 */
export interface LayoutDrag {
  /** Each dragged separator (every line a press moves). */
  readonly separators: readonly DraggedSeparator[];
  /** What was pressed: a separator's pair, or a junction's pairs. */
  readonly grabbed: readonly SeparatorPair[];
  readonly dx: number;
  readonly dy: number;
  /**
   * The children shown stepped down to fit when it started, by id, at the
   * stops they were shown in: those still stepped down at its release
   * stay so (see `heldDown`). One stepped down only on the way (its
   * stretch, say) isn't held.
   */
  readonly steppedDown: Readonly<Record<string, string>> | null;
}

export interface LayoutState {
  readonly config: LayoutConfig;
  /** Each group's measured space, once it has been measured. */
  readonly spaces: Readonly<Record<string, GroupSpace>>;
  /** Every child the layout has known (removed ones too), by id. */
  readonly places: Readonly<Record<string, ChildPlace>>;
  readonly reducedMotion: boolean;
  readonly drag: LayoutDrag | null;
  /** The kind of the latest change, if it should animate; else `null`. */
  readonly animate: ChangeKind | null;
  /**
   * Whether a committed change is still transitioning. Set with the change
   * (see {@link playsTransition}) and cleared by the controller once the
   * transition has had time to finish.
   */
  readonly animating: boolean;
  /** Each child's stop before its latest change of stop, by id. */
  readonly previousStops: Readonly<Record<string, string>>;
  /**
   * Each child's stop when the change in progress (a drag, or an animated
   * change) began, by id; `null` while nothing is changing.
   */
  readonly fromStops: Readonly<Record<string, string | null>> | null;
  /**
   * Whether each child's content slides with its moving edge through the
   * change in progress, by id (see `recordSliding`); `null` at rest.
   */
  readonly sliding: Readonly<Record<string, boolean>> | null;
  /**
   * What's under a mouse or pen, if anything: a separator's pair, or a
   * junction's. The rendering expands it into every separator a press there
   * would drag (see `data-hover`).
   */
  readonly hovered: readonly SeparatorPair[] | null;
  /**
   * Each child's content as it was when the change in progress began:
   * reflowing once (`reflow: "once"`), held at that through a drag, and
   * through an animated change at the larger of that and where it's going;
   * any child an animated change takes to a point leaves at that size; and
   * one an interrupting change carries on carries on at it (see
   * `getLayoutContentRendering`). Unused once it's over.
   */
  readonly heldContent: ReadonlyMap<string, HeldContent> | null;
  /**
   * The child a call last gave a stop or size (`setStop`, `toggle`,
   * `setSize`, `reset(id)`): it steps down along its `yieldTo` only once
   * its siblings can't, so what was just asked for isn't taken back. Until
   * a change from elsewhere that could take it back: a group it's in
   * getting less room (not more: a wider window doesn't close what the
   * call opened), or new options; or another call. Not saved.
   */
  readonly protectedChild: string | null;
  /**
   * Children kept at the stop they'd stepped down to (see `stepDown`)
   * when a drag was released, or a key pressed, by id: the user's move
   * gave the room they'd step back up into to something else, and taking
   * it back would undo what they saw. They can step further down. Cleared
   * by a change from elsewhere: new options, a call (`setStop`, a reset, a
   * restore), and for the children of a group, its space changing. Not
   * saved.
   */
  readonly heldDown: Readonly<Record<string, string>> | null;
}

/** The part of the state worth saving between sessions. */
export interface LayoutSnapshot {
  readonly version: 3;
  readonly children: Readonly<Record<string, ChildPlace>>;
}

// --- Setup -------------------------------------------------------------------

export function parseLayoutOptions(options: LayoutOptions): LayoutConfig {
  return {
    root: parseTree(options.layout),
    ...parseCommonOptions(options),
    cascade: options.cascade ?? true,
    disabledSeparators: (options.disabledSeparators ?? []).map(
      ([before, after]) => ({ before, after }),
    ),
  };
}

export function createLayoutState(
  config: LayoutConfig,
  snapshot?: LayoutSnapshot,
): LayoutState {
  return {
    config,
    spaces: {},
    places: snapshot?.children ?? {},
    reducedMotion: false,
    drag: null,
    animate: null,
    animating: false,
    previousStops: {},
    fromStops: null,
    sliding: null,
    hovered: null,
    heldContent: null,
    protectedChild: null,
    heldDown: null,
  };
}
