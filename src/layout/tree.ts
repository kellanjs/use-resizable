/**
 * The shape of a layout: a tree of groups. Every group lays its children out
 * in a row or a column; a child is an element or another group. A flat row
 * of elements is just a tree with one group.
 *
 * Options use one shape at every level: a group is `{ id, direction,
 * children }`. The layout's root is one; a nested group is
 * a child that has them too, with the same size options as an element.
 * Every group and element has an id.
 *
 * A grid (`{ id, columns, rows, children }`) can stand where a group does.
 * Its columns and rows are tracks, sized like elements, and its children
 * are cells placed on them. To the model, its columns are a group running
 * along a row, and its rows one running down a column (see `trackGroupId`),
 * so everything a group does, its tracks do.
 */
import { type Axis } from "../foundation/keyboard.js";
import { own } from "../foundation/own.js";
import type { Size, SizeValue } from "../foundation/size.js";
import { parseSize } from "../foundation/size.js";
import {
  type TrackConfig,
  type TrackOptions,
  checkStop,
  parseTrackOptions,
  warnIfDefaultJumps,
} from "../foundation/stops.js";

/**
 * How a group lays out its children: in a row (left to right, or right to
 * left in a right-to-left layout), or top to bottom.
 */
export type LayoutDirection = "row" | "column";

/**
 * When a `fill` element takes extra space: `"first"`, before the other
 * children (they keep their sizes), or `"last"`, only what they can't take.
 */
export type LayoutFill = "first" | "last";

/** A separator, as the children either side of it. */
export interface SeparatorPair<Id extends string = string> {
  readonly before: Id;
  readonly after: Id;
}

/** How a child is sized in its group: an element's options, or a group's. */
interface ChildSizeOptions extends TrackOptions {
  /** Identifies the child across renders, reorders and snapshots. */
  id: string;
  /**
   * Size when the child first appears, along its group's direction.
   * Children without one share whatever space is left.
   */
  defaultSize?: SizeValue;
  /**
   * The stop to start at. Defaults to wherever `defaultSize` lands, or for a
   * child without one, its roomiest stop (the one reaching furthest).
   */
  defaultStop?: string;
  /**
   * Keep this child's size when its group's space changes (the window
   * resizes, a child is removed) or a sibling changes size; the other
   * children absorb the change, and a `"last"` fill too, before it. A
   * sibling given a size (by `setStop`, `setSize` or `toggle`, or by
   * joining the group) takes room from it only once nothing else can give
   * it. The user can still resize it.
   *
   * `"yield-first"`: and when room runs short, keep its size while any
   * child that can step down (`yieldTo`) can make room, in the group that's
   * short or the groups inside it (outside this child's own group too, as
   * stepping down crosses groups); only then does it give way, down to its
   * minimum, before it steps down itself.
   */
  keepSize?: boolean | "yield-first";
  /**
   * Which children give way first when space is taken (the group's space
   * shrinking, or a sibling opening or growing): lower priorities first,
   * each down to its minimum before the next gives any, and equal ones in
   * proportion to their sizes. Default 0. It orders children within the
   * usual order (see `keepSize`): it never takes space from a child that
   * keeps its size while one that doesn't can still give. Separator drags
   * don't use it: they move their neighbours.
   */
  priority?: number;
  /**
   * How extra space is shared (the group's space growing, or a sibling
   * shrinking), as with CSS `flex-grow`: once any child in a group has a
   * `grow`, extra space goes to them in proportion to it (equal `grow`s,
   * equal shares of it), and a child without one (or with 0) takes extra
   * only once those can't. With none, extra space goes in proportion to
   * the children's sizes, so they keep their shares.
   */
  grow?: number;
  /**
   * The stops this child may step down to on its own when its group's
   * minimums (or a group's it's inside) don't fit, each from the stop
   * named as its key:
   * `{ open: "compact", compact: "closed" }`. It steps back up when room
   * returns. Only once every child is at its minimum, and lower priorities
   * first (see `priority`); what you chose stays its stop, and is what's
   * saved. A step is taken only if it frees space; naming a stop reached
   * only by name (`onlyByName`) lets it go there.
   */
  yieldTo?: Readonly<Record<string, string>>;
  /**
   * Hold this child's size against the user: drags and keys can't resize
   * it, and a drag pushing on goes past it to the children beyond (if
   * `cascade` is on). Your calls for its siblings (`setStop`, `setSize`)
   * take room from it only if nothing else can give it, and a `"last"`
   * fill takes space before it grows; calls for it still move it. When the
   * group's space changes (the window resizes), it keeps its share like any
   * other child (`keepSize` too, to keep its size then).
   */
  locked?: boolean;
  /**
   * Whether to hide this child when it rests at 0; overrides the layout's
   * `hideAtZero` (see there).
   */
  hideAtZero?: boolean;
}

/**
 * An element: a child you put content in. It has a size of its own, or it
 * fills the space its siblings leave (`fill`).
 */
export type LayoutElementOptions =
  LayoutSizedElementOptions | LayoutFillElementOptions;

/** An element with a size of its own. */
interface LayoutSizedElementOptions extends ChildSizeOptions {
  direction?: undefined;
  children?: undefined;
  columns?: undefined;
  rows?: undefined;
  fill?: undefined;
}

/**
 * The options for an element's own size and stops, which a `fill` element
 * doesn't take: it has one range from 0 up, and its size is what's left.
 */
const OWN_SIZE_OPTIONS = [
  "stops",
  "minSize",
  "maxSize",
  "defaultSize",
  "defaultStop",
  "keepSize",
  "priority",
  "grow",
  "yieldTo",
  "locked",
  "enterToggles",
] as const;

type OwnSizeOption = (typeof OWN_SIZE_OPTIONS)[number];

/** An element that fills the space its siblings leave. */
interface LayoutFillElementOptions extends Omit<
  ChildSizeOptions,
  OwnSizeOption
> {
  direction?: undefined;
  children?: undefined;
  columns?: undefined;
  rows?: undefined;
  /**
   * Make this element take the space its siblings leave, rather than a size
   * of its own: from 0 up, giving its space up before any of them when they
   * need room. `"first"` takes extra space before them, so they keep their
   * sizes; `"last"` takes only what they can't (when they're all at points
   * or maximums). It takes no size or stop options. Fills of a kind share
   * what they hold equally, always: one either side of the others keeps
   * them centred, its edges moving both, mirrored.
   */
  fill: LayoutFill;
  stops?: undefined;
  minSize?: undefined;
  maxSize?: undefined;
  defaultSize?: undefined;
  defaultStop?: undefined;
  keepSize?: undefined;
  priority?: undefined;
  grow?: undefined;
  yieldTo?: undefined;
  locked?: undefined;
  enterToggles?: undefined;
}

/** A group: the layout's root, and the shape of every nested one. */
export interface LayoutGroupOptions {
  /**
   * Identifies the group: `getGroupProps(id)`, `childrenOf(id)`, and for a
   * nested group, everything a child's id does.
   */
  id: string;
  /**
   * `row` lays children out in a row (left to right, or right to left in
   * a right-to-left layout); `column`, top to bottom.
   */
  direction: LayoutDirection;
  children: readonly LayoutChildOptions[];
  /**
   * Refuse a `setStop`, `toggle`, `setSize` or `reset(id)` that would leave
   * its children's minimums wider than its space (more than they already are), instead of letting the
   * browser squeeze them: the call does nothing, and `canSetStop` and
   * `canToggle` say so beforehand. One that makes it no worse (or better)
   * goes ahead. Children added to `children` are never refused: the layout
   * is data. Default `false`.
   */
  refuseOverflow?: boolean;
  columns?: undefined;
  rows?: undefined;
}

/** A nested group: sized like an element in its parent, with children. */
export interface LayoutNestedGroupOptions
  extends ChildSizeOptions, LayoutGroupOptions {}

/**
 * A column or row of a grid. It's sized like an element (stops, limits,
 * defaults, `keepSize`, `locked`, `fill`), along the grid's width for a
 * column and its height for a row, and its cells are as big as the
 * tracks they span. Its id is what `setStop`, `getChild` and a line's
 * `getSeparatorProps(before, after)` name it by.
 */
export type LayoutTrackOptions =
  | Omit<LayoutSizedElementOptions, "hideAtZero">
  | Omit<LayoutFillElementOptions, "hideAtZero">;

/**
 * Where a grid's child goes: from `column` and `row` (track ids), across
 * `columnSpan` columns and down `rowSpan` rows (1 each by default). Its size
 * is the tracks', so it takes no size options.
 */
interface CellPlacement {
  id: string;
  column: string;
  row: string;
  columnSpan?: number;
  rowSpan?: number;
  /** Whether to hide it while it rests at 0 either way (see `hideAtZero`). */
  hideAtZero?: boolean;
}

/** A cell that's an element: you put content in it. */
export interface LayoutElementCellOptions extends CellPlacement {
  direction?: undefined;
  children?: undefined;
  columns?: undefined;
  rows?: undefined;
}

/**
 * A cell that's a group, laying its own children out in a row or a column
 * (`getGroupProps(id)`): its separators share the cell's space, and the
 * cell can't be smaller than they need (while it spans one track that way).
 */
export interface LayoutGroupCellOptions
  extends CellPlacement, LayoutGroupOptions {}

/** A cell that's a grid of its own (`getGroupProps(id)`). */
export interface LayoutGridCellOptions
  extends CellPlacement, LayoutGridOptions {}

/** A grid's child: an element, a group or a grid, placed on its tracks. */
export type LayoutCellOptions =
  LayoutElementCellOptions | LayoutGroupCellOptions | LayoutGridCellOptions;

/**
 * A grid: its columns and rows are tracks that resize like a group's
 * children, and its children are cells placed on them, each spanning one
 * or more. A line between two tracks runs wherever no cell spans across
 * it. It can be the layout's root or a child of a group.
 */
export interface LayoutGridOptions {
  /**
   * Identifies the grid: `getGroupProps(id)`, `separatorsOf(id)`, and for
   * a nested grid, everything a child's id does.
   */
  id: string;
  /** Left to right (right to left in a right-to-left page). */
  columns: readonly LayoutTrackOptions[];
  /** Top to bottom. */
  rows: readonly LayoutTrackOptions[];
  children: readonly LayoutCellOptions[];
  /**
   * Refuse a `setStop`, `toggle`, `setSize` or `reset(id)` that would leave
   * its columns' or rows''s minimums wider than its space (more than they already are), instead of letting the
   * browser squeeze them: the call does nothing, and `canSetStop` and
   * `canToggle` say so beforehand. One that makes it no worse (or better)
   * goes ahead. Children added to `children` are never refused: the layout
   * is data. Default `false`.
   */
  refuseOverflow?: boolean;
  direction?: undefined;
}

/** A nested grid: sized like an element in its parent. */
export interface LayoutNestedGridOptions
  extends ChildSizeOptions, LayoutGridOptions {}

/** A child of a group: an element, a group of its own, or a grid. */
export type LayoutChildOptions =
  LayoutElementOptions | LayoutNestedGroupOptions | LayoutNestedGridOptions;

/** The layout's root: a group, or a grid. */
export type LayoutRootOptions = LayoutGroupOptions | LayoutGridOptions;

interface NodeBase extends TrackConfig {
  readonly id: string;
  readonly defaultSize: Size | null;
  /** The stop it starts at, or `null` to work it out from its size. */
  readonly defaultStop: string | null;
  readonly keepSize: boolean;
  /** `keepSize: "yield-first"`: see there. */
  readonly yieldFirst: boolean;
  /** See `ChildSizeOptions.priority`. */
  readonly priority: number;
  /** See `ChildSizeOptions.grow`; `null` without one. */
  readonly grow: number | null;
  /** See `ChildSizeOptions.yieldTo`; `{}` without one. */
  readonly yieldTo: Readonly<Record<string, string>>;
  /** See `LayoutChildOptions.locked`. */
  readonly locked: boolean;
  /** `null` to follow the layout's `hideAtZero`. */
  readonly hideAtZero: boolean | null;
  /** For an element that fills (see `LayoutFillElementOptions.fill`). */
  readonly fill: LayoutFill | null;
}

export interface ElementNode extends NodeBase {
  readonly kind: "element";
}

export interface GroupNode extends NodeBase {
  readonly kind: "group";
  /** The axis its children run along: `row` is horizontal. */
  readonly axis: Axis;
  readonly children: readonly ChildNode[];
  /** See `LayoutGroupOptions.refuseOverflow`. */
  readonly refuseOverflow: boolean;
}

/** A grid's column or row: a child of one of its track groups. */
export interface TrackNode extends NodeBase {
  readonly kind: "track";
}

/** A cell of a grid, placed by track index. */
export interface CellNode {
  readonly kind: "cell";
  readonly id: string;
  /**
   * The group or grid the cell is, with the same id, or `null` for an
   * element.
   */
  readonly content: GroupNode | GridNode | null;
  /** The first column it's in, and how many it spans. */
  readonly column: number;
  readonly columnSpan: number;
  /** The first row it's in, and how many it spans. */
  readonly row: number;
  readonly rowSpan: number;
  /** `null` to follow the layout's `hideAtZero`. */
  readonly hideAtZero: boolean | null;
}

/**
 * A grid. Its tracks are the children of two groups no option can name
 * (see `trackGroupId`): `columns` runs along its width, `rows` down its
 * height.
 */
export interface GridNode extends NodeBase {
  readonly kind: "grid";
  readonly columns: GroupNode;
  readonly rows: GroupNode;
  readonly cells: readonly CellNode[];
}

/**
 * What sits in a group: an element, a group, a grid, or (in a grid's
 * track groups) a track.
 */
export type ChildNode = ElementNode | GroupNode | GridNode | TrackNode;

/** The layout's root. */
export type RootNode = GroupNode | GridNode;

/** Any part of a layout, by id (see `TreeIndex.nodes`). */
export type LayoutNode = ChildNode | CellNode;

/**
 * The id of a grid's columns' or rows' group. It has a character no id in
 * the options has a reason to, so it can't clash with one; it's the key
 * for the group's measured space, and never shown.
 */
export function trackGroupId(grid: string, which: "columns" | "rows"): string {
  return `${grid}\u0000${which}`;
}

/**
 * The grid whose columns or rows group `id` is, if it's one (`gridOf` also
 * has its tracks and cells, and a cell's group or grid).
 */
export function gridOfTracks(
  index: TreeIndex,
  id: string,
): GridNode | undefined {
  const grid = index.gridOf.get(id);
  return grid && (grid.columns.id === id || grid.rows.id === id)
    ? grid
    : undefined;
}

/** A grid's track group running along `axis`. */
export function tracksAlong(grid: GridNode, axis: Axis): GroupNode {
  return axis === "horizontal" ? grid.columns : grid.rows;
}

/** The axis a direction lays children out along. */
function axisOf(direction: LayoutDirection): Axis {
  return direction === "row" ? "horizontal" : "vertical";
}

/** The direction of a group's axis, as the options say it. */
export function directionOf(axis: Axis): LayoutDirection {
  return axis === "horizontal" ? "row" : "column";
}

function isGrid(
  options: LayoutChildOptions | LayoutRootOptions,
): options is LayoutNestedGridOptions {
  return options.columns !== undefined;
}

function isGroup(
  options: LayoutChildOptions,
): options is LayoutNestedGroupOptions {
  return options.children !== undefined && options.columns === undefined;
}

/** A root's size options: it fills what the app gives it, so it has none. */
function rootBase(id: string): NodeBase {
  return {
    ...parseTrackOptions({}),
    id,
    defaultSize: null,
    defaultStop: null,
    keepSize: false,
    yieldFirst: false,
    priority: 0,
    grow: null,
    yieldTo: {},
    locked: false,
    hideAtZero: null,
    fill: null,
  };
}

export function parseTree(options: LayoutRootOptions): RootNode {
  const seen = new Set<string>();

  function claim(id: string) {
    if (id === "") throw new Error("Groups and elements need a non-empty id.");
    if (seen.has(id))
      throw new Error(`Two parts of the layout have the id "${id}".`);
    seen.add(id);
  }

  function parseNode(node: LayoutChildOptions): ChildNode {
    claim(node.id);
    if (!isGroup(node) && !isGrid(node) && node.fill !== undefined) {
      return parseFill(node);
    }
    const base = parseBase(node);
    if (isGrid(node)) return parseGrid(node, base);
    return isGroup(node)
      ? {
          ...base,
          kind: "group",
          axis: axisOf(node.direction),
          children: node.children.map(parseNode),
          refuseOverflow: node.refuseOverflow ?? false,
        }
      : { ...base, kind: "element" };
  }

  /** A child's own size options. */
  function parseBase(node: LayoutChildOptions | LayoutTrackOptions): NodeBase {
    const track = withoutWholeSpaceMaximums(parseTrackOptions(node));
    const base: NodeBase = {
      ...track,
      id: node.id,
      defaultSize:
        node.defaultSize === undefined ? null : parseSize(node.defaultSize),
      defaultStop:
        node.defaultStop === undefined
          ? null
          : checkStop(track, node.defaultStop),
      keepSize: parseKeepSize(node.id, node.keepSize),
      yieldFirst: node.keepSize === "yield-first",
      priority: parsePriority(node.id, node.priority),
      grow: parseGrow(node.id, node.grow),
      yieldTo: parseYieldTo(node.id, track, node.yieldTo),
      locked: node.locked ?? false,
      hideAtZero: ("hideAtZero" in node ? node.hideAtZero : undefined) ?? null,
      fill: null,
    };
    warnIfDefaultJumps(
      base,
      base.defaultSize,
      base.defaultStop,
      `"${node.id}"`,
    );
    return base;
  }

  function parseTrack(node: LayoutTrackOptions): TrackNode {
    claim(node.id);
    if (node.fill !== undefined) return { ...parseFill(node), kind: "track" };
    // Cells hide, not tracks.
    return { ...parseBase(node), hideAtZero: null, kind: "track" };
  }

  function parseGrid(options: LayoutGridOptions, base: NodeBase): GridNode {
    const name = `The grid "${options.id}"`;
    if (options.columns.length === 0 || options.rows.length === 0) {
      throw new Error(`${name} needs at least one column and one row.`);
    }
    const trackGroup = (which: "columns" | "rows", axis: Axis): GroupNode => ({
      ...rootBase(trackGroupId(options.id, which)),
      kind: "group",
      axis,
      children: options[which].map(parseTrack),
      refuseOverflow: options.refuseOverflow ?? false,
    });
    const columns = trackGroup("columns", "horizontal");
    const rows = trackGroup("rows", "vertical");
    const cells = options.children.map((cell) => {
      claim(cell.id);
      return {
        ...parseCell(name, cell, columns, rows),
        content: content(cell),
      };
    });
    checkOverlaps(name, cells);
    return { ...base, kind: "grid", columns, rows, cells };
  }

  /** A cell's group or grid; its size is its tracks', so it has no options. */
  function content(cell: LayoutCellOptions): GroupNode | GridNode | null {
    if (cell.columns !== undefined) return parseGrid(cell, rootBase(cell.id));
    if (cell.children === undefined) return null;
    return {
      ...rootBase(cell.id),
      kind: "group",
      axis: axisOf(cell.direction),
      children: cell.children.map(parseNode),
      refuseOverflow: cell.refuseOverflow ?? false,
    };
  }

  claim(options.id);
  // The root has no size of its own (it fills whatever the app gives it),
  // so no stops either.
  if (options.columns !== undefined) {
    return parseGrid(options, rootBase(options.id));
  }
  return {
    ...rootBase(options.id),
    kind: "group",
    axis: axisOf(options.direction),
    children: options.children.map(parseNode),
    refuseOverflow: options.refuseOverflow ?? false,
  };
}

/**
 * A child's `%` sizes are of its group's space, which it can never be
 * larger than, so a maximum of `100%` or more never stops it: it's left
 * out (of a list of maximums, the part that's one), so the child counts as
 * able to take whatever space is left (see `takesSpace`). Pixel maximums
 * stay: one as wide as the space now can stop the child once the space
 * grows.
 */
function withoutWholeSpaceMaximums(track: TrackConfig): TrackConfig {
  const binds = (size: Size) => size.unit !== "%" || size.value < 100;
  return {
    ...track,
    stops: track.stops.map((stop) => {
      if (!stop.max || stop.max.every(binds)) return stop;
      const max = stop.max.filter(binds);
      return { ...stop, max: max.length > 0 ? max : undefined };
    }),
  };
}

/** A cell's place, by track index, checked against the grid's tracks. */
function parseCell(
  grid: string,
  cell: LayoutCellOptions,
  columns: GroupNode,
  rows: GroupNode,
): Omit<CellNode, "content"> {
  const name = `"${cell.id}"`;
  const place = (
    tracks: GroupNode,
    id: string,
    span: number | undefined,
    which: "column" | "row",
  ) => {
    const start = tracks.children.findIndex((track) => track.id === id);
    if (start === -1) {
      throw new Error(
        `${name} is placed in ${which} "${id}", which isn't one of ${grid}'s ${which}s.`,
      );
    }
    const count = span ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`${name}: a ${which}Span is a whole number, 1 or more.`);
    }
    if (start + count > tracks.children.length) {
      throw new Error(
        `${name} spans ${count} ${which}s from "${id}", past ${grid}'s last.`,
      );
    }
    return { start, count };
  };
  const column = place(columns, cell.column, cell.columnSpan, "column");
  const row = place(rows, cell.row, cell.rowSpan, "row");
  return {
    kind: "cell",
    id: cell.id,
    column: column.start,
    columnSpan: column.count,
    row: row.start,
    rowSpan: row.count,
    hideAtZero: cell.hideAtZero ?? null,
  };
}

/** Cells can't share a place in the grid. */
function checkOverlaps(grid: string, cells: readonly CellNode[]) {
  const taken = new Map<string, string>();
  for (const cell of cells) {
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (
        let column = cell.column;
        column < cell.column + cell.columnSpan;
        column++
      ) {
        const key = `${column},${row}`;
        const other = taken.get(key);
        if (other) {
          throw new Error(
            `${grid}: "${cell.id}" and "${other}" both take the same place.`,
          );
        }
        taken.set(key, cell.id);
      }
    }
  }
}

function parseKeepSize(
  id: string,
  keepSize: boolean | "yield-first" | undefined,
): boolean {
  if (keepSize === undefined || keepSize === false) return false;
  if (keepSize === true || keepSize === "yield-first") return true;
  throw new Error(
    `"${id}" has keepSize ${JSON.stringify(keepSize)}: expected true, false or "yield-first".`,
  );
}

function parsePriority(id: string, priority: number | undefined): number {
  if (priority === undefined) return 0;
  if (!Number.isFinite(priority)) {
    throw new Error(`"${id}" has priority ${priority}: expected a number.`);
  }
  return priority;
}

/**
 * Checks a child's `yieldTo`: every name is one of its stops, no stop steps
 * to itself, and no chain of steps comes back round.
 */
function parseYieldTo(
  id: string,
  track: TrackConfig,
  yieldTo: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (yieldTo === undefined) return {};
  for (const [from, to] of Object.entries(yieldTo)) {
    checkStop(track, from);
    checkStop(track, to);
    const seen = new Set([from]);
    for (
      let at: string | undefined = to;
      at !== undefined;
      at = own(yieldTo, at)
    ) {
      if (seen.has(at)) {
        throw new Error(
          `"${id}": yieldTo steps from "${from}" back round to "${at}"; each step has to lead somewhere new.`,
        );
      }
      seen.add(at);
    }
  }
  return yieldTo;
}

function parseGrow(id: string, grow: number | undefined): number | null {
  if (grow === undefined) return null;
  if (!Number.isFinite(grow) || grow < 0) {
    throw new Error(`"${id}" has grow ${grow}: expected a number >= 0.`);
  }
  return grow;
}

/**
 * A `fill` element: one range from 0 up, starting at 0. Its size comes from
 * what its siblings leave, so options that size it are a mistake.
 */
function parseFill(
  node: LayoutElementOptions | LayoutTrackOptions,
): ElementNode {
  // TypeScript rejects these, but options can come from plain JavaScript.
  const sizing = OWN_SIZE_OPTIONS.filter(
    (option) => node[option] !== undefined,
  );
  if (sizing.length > 0) {
    throw new Error(
      `"${node.id}" fills what its siblings leave, so it takes no ` +
        `${sizing.map((option) => `\`${option}\``).join(" or ")}.`,
    );
  }
  if (node.fill !== "first" && node.fill !== "last") {
    throw new Error(`"${node.id}": \`fill\` is "first" or "last".`);
  }
  return {
    ...parseTrackOptions({}),
    id: node.id,
    defaultSize: parseSize(0),
    defaultStop: null,
    keepSize: false,
    yieldFirst: false,
    priority: 0,
    grow: null,
    yieldTo: {},
    locked: false,
    hideAtZero: ("hideAtZero" in node ? node.hideAtZero : undefined) ?? null,
    fill: node.fill,
    kind: "element",
  };
}

/** Lookups over a tree, built once per tree. */
export interface TreeIndex {
  /**
   * Every group, parents before children: a grid's track groups too, after
   * the group it's in.
   */
  readonly groups: readonly GroupNode[];
  /** Every element, in reading order (not a grid's cells). */
  readonly elements: readonly ElementNode[];
  /** Every grid, parents before children. */
  readonly grids: readonly GridNode[];
  /** Every grid's cells, in the options' order. */
  readonly cells: readonly CellNode[];
  /**
   * Every part of the layout by id, the root included: groups (a grid's
   * track groups too), elements, grids, tracks and cells.
   */
  readonly nodes: ReadonlyMap<string, LayoutNode>;
  /**
   * The group each child sits in (the root has none): a track's is its
   * track group. A track group's is the group its grid is in, so a walk
   * outwards from a track leaves the grid as from a nested group; or for a
   * grid in a cell, the outer grid's track group that way. A group in a
   * cell's is the outer grid's track group along its own axis, whose space
   * it shares. An element in a cell has none.
   */
  readonly parents: ReadonlyMap<string, GroupNode>;
  /** The grid each track group, track and cell belongs to. */
  readonly gridOf: ReadonlyMap<string, GridNode>;
  /** Each cell's placement, by id (an element's, a group's or a grid's). */
  readonly cellOf: ReadonlyMap<string, CellNode>;
}

const indexes = new WeakMap<RootNode, TreeIndex>();

export function indexTree(root: RootNode): TreeIndex {
  const cached = indexes.get(root);
  if (cached) return cached;

  const groups: GroupNode[] = [];
  const elements: ElementNode[] = [];
  const grids: GridNode[] = [];
  const cells: CellNode[] = [];
  const nodes = new Map<string, LayoutNode>();
  const parents = new Map<string, GroupNode>();
  const gridOf = new Map<string, GridNode>();
  const cellOf = new Map<string, CellNode>();

  /**
   * `outer` is the group whose space a node along an axis shares: for a
   * group's child, the group either way; in a grid's cell, the grid's track
   * group that way. `placed`: a cell's group or grid, which has no parent
   * of its own as a child (its track groups, and its own children, do).
   */
  const visit = (
    node: ChildNode,
    outer: (axis: Axis) => GroupNode | null,
    placed = false,
  ) => {
    nodes.set(node.id, node);
    const parent = outer(node.kind === "group" ? node.axis : "horizontal");
    if (parent && (!placed || node.kind === "group")) {
      parents.set(node.id, parent);
    }
    if (node.kind === "element" || node.kind === "track") {
      if (node.kind === "element") elements.push(node);
      return;
    }
    if (node.kind === "grid") {
      grids.push(node);
      for (const tracks of [node.columns, node.rows]) {
        gridOf.set(tracks.id, node);
        for (const track of tracks.children) gridOf.set(track.id, node);
        // A track group stands in its grid's place.
        visit(tracks, () => outer(tracks.axis));
      }
      for (const cell of node.cells) {
        gridOf.set(cell.id, node);
        cellOf.set(cell.id, cell);
        cells.push(cell);
        if (cell.content) {
          visit(cell.content, (axis) => tracksAlong(node, axis), true);
        } else {
          nodes.set(cell.id, cell);
        }
      }
      return;
    }
    groups.push(node);
    for (const child of node.children) visit(child, () => node);
  };
  visit(root, () => null);

  const index = {
    groups,
    elements,
    grids,
    cells,
    nodes,
    parents,
    gridOf,
    cellOf,
  };
  indexes.set(root, index);
  return index;
}

/**
 * Whether `inner` is `outer` or sits somewhere inside it, along the way
 * `outer` runs: a cell's group or grid sits in its grid's tracks both
 * ways, though its parent is the track group running its own way.
 */
function isWithin(root: RootNode, outer: GroupNode, inner: ChildNode): boolean {
  const { parents, cellOf, gridOf } = indexTree(root);
  for (let node: LayoutNode | undefined = inner; node;) {
    if (node.id === outer.id) return true;
    const grid: GridNode | undefined = cellOf.has(node.id)
      ? gridOf.get(node.id)
      : undefined;
    node = grid ? tracksAlong(grid, outer.axis) : parents.get(node.id);
  }
  return false;
}

/**
 * Whether two separators move the same space, so they can't be dragged
 * together: they're in one group, or their groups
 * run the same way and one is inside the other, so moving the outer one
 * resizes the inner one too. Separators that cross never do.
 */
export function shareSpace(
  root: RootNode,
  a: SeparatorPair,
  b: SeparatorPair,
): boolean {
  const first = groupBetween(root, a.before, a.after);
  const second = groupBetween(root, b.before, b.after);
  if (!first || !second || first.axis !== second.axis) return false;
  return isWithin(root, first, second) || isWithin(root, second, first);
}

/** The cursor for dragging separators: `move` when they run different ways. */
export function dragCursor(
  root: RootNode,
  pairs: readonly SeparatorPair[],
): "move" | "row-resize" | "col-resize" {
  // Pairs that aren't neighbours drag nothing, so they don't count.
  const axes = new Set(
    pairs.flatMap(
      ({ before, after }) => groupBetween(root, before, after)?.axis ?? [],
    ),
  );
  if (axes.size > 1) return "move";
  return axes.has("vertical") ? "row-resize" : "col-resize";
}

/**
 * The group that has `before` and `after` as neighbouring children, or
 * `null` if they aren't neighbours.
 */
export function groupBetween(
  root: RootNode,
  before: string,
  after: string,
): GroupNode | null {
  const parent = indexTree(root).parents.get(before);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.id === before);
  // (A group in a cell isn't among its parent's children.)
  if (index === -1) return null;
  return parent.children[index + 1]?.id === after ? parent : null;
}
