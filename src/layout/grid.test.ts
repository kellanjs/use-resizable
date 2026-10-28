import { describe, expect, it } from "vitest";

import { groupSpace, sizes } from "../../testing/layout.js";
import {
  type LayoutOptions,
  type LayoutState,
  createLayoutState,
  parseLayoutOptions,
} from "./layout-config.js";
import {
  allowsStop,
  applyKeyboard,
  endDrag,
  measure,
  moveDrag,
  setChildSize,
  setChildStop,
  setConfig,
  startDrag,
} from "./layout-model.js";
import { toSnapshot } from "./layout-snapshot.js";
import {
  type GridNode,
  type LayoutGridOptions,
  type LayoutTrackOptions,
  dragCursor,
  gridOfTracks,
  groupBetween,
  indexTree,
  parseTree,
  shareSpace,
  trackGroupId,
} from "./tree.js";

/**
 * A dashboard: three columns, two rows. "chart" spans the first two
 * columns of the top row, "stats" both rows of the last column.
 */
function dashboard(
  columns: readonly LayoutTrackOptions[] = [
    { id: "left" },
    { id: "middle" },
    { id: "right" },
  ],
  rows: readonly LayoutTrackOptions[] = [{ id: "top" }, { id: "bottom" }],
): LayoutGridOptions {
  return {
    id: "dash",
    columns,
    rows,
    children: [
      { id: "chart", column: "left", columnSpan: 2, row: "top" },
      { id: "stats", column: "right", row: "top", rowSpan: 2 },
      { id: "table", column: "left", row: "bottom" },
      { id: "log", column: "middle", row: "bottom" },
    ],
  };
}

const COLUMNS = trackGroupId("dash", "columns");
const ROWS = trackGroupId("dash", "rows");

/** The dashboard as the root, 900 by 600 to share between its tracks. */
function create(grid: LayoutGridOptions = dashboard()): LayoutState {
  const options: LayoutOptions = { layout: grid, elastic: false };
  return measure(createLayoutState(parseLayoutOptions(options)), {
    [COLUMNS]: groupSpace(900),
    [ROWS]: groupSpace(600),
  });
}

describe("grid options", () => {
  it("makes a group of the columns and one of the rows, of tracks", () => {
    const grid = parseTree(dashboard()) as GridNode;
    expect(grid.kind).toBe("grid");
    expect(grid.columns).toMatchObject({ id: COLUMNS, axis: "horizontal" });
    expect(grid.rows).toMatchObject({ id: ROWS, axis: "vertical" });
    expect(grid.columns.children.map((track) => track.kind)).toEqual([
      "track",
      "track",
      "track",
    ]);
    expect(grid.cells[0]).toEqual({
      kind: "cell",
      id: "chart",
      column: 0,
      columnSpan: 2,
      row: 0,
      rowSpan: 1,
      hideAtZero: null,
      content: null,
    });
  });

  it("indexes tracks under their track groups, and cells under the grid", () => {
    const root = parseTree(dashboard());
    const index = indexTree(root);
    expect(index.groups.map((group) => group.id)).toEqual([COLUMNS, ROWS]);
    expect(index.grids.map((grid) => grid.id)).toEqual(["dash"]);
    expect(index.cells.map((cell) => cell.id)).toEqual([
      "chart",
      "stats",
      "table",
      "log",
    ]);
    // Cells are the grid's, not elements of a group.
    expect(index.elements).toEqual([]);
    expect(index.parents.get("middle")?.id).toBe(COLUMNS);
    expect(index.parents.has("chart")).toBe(false);
    expect(index.gridOf.get("chart")?.id).toBe("dash");
    expect(index.gridOf.get("top")?.id).toBe("dash");
    expect(index.nodes.get("log")?.kind).toBe("cell");
  });

  it("makes a line of two neighbouring tracks", () => {
    const root = parseTree(dashboard());
    expect(groupBetween(root, "left", "middle")?.id).toBe(COLUMNS);
    expect(groupBetween(root, "top", "bottom")?.id).toBe(ROWS);
    expect(groupBetween(root, "left", "right")).toBeNull();
    expect(groupBetween(root, "middle", "top")).toBeNull();
    const column = { before: "left", after: "middle" };
    const row = { before: "top", after: "bottom" };
    expect(dragCursor(root, [column])).toBe("col-resize");
    expect(dragCursor(root, [column, row])).toBe("move");
    // Lines that cross move different space; two column lines, the same.
    expect(shareSpace(root, column, row)).toBe(false);
    expect(shareSpace(root, column, { before: "middle", after: "right" })).toBe(
      true,
    );
  });

  it("walks out of a nested grid as from a nested group", () => {
    const root = parseTree({
      id: "app",
      direction: "row",
      children: [{ id: "nav" }, { ...dashboard(), minSize: 300 }],
    });
    const { parents, groups } = indexTree(root);
    expect(groups.map((group) => group.id)).toEqual(["app", COLUMNS, ROWS]);
    expect(parents.get(COLUMNS)?.id).toBe("app");
    expect(parents.get("dash")?.id).toBe("app");
    // The outer line resizes the grid's columns: they move the same space.
    expect(
      shareSpace(
        root,
        { before: "nav", after: "dash" },
        { before: "left", after: "middle" },
      ),
    ).toBe(true);
    // Its rows run across it.
    expect(
      shareSpace(
        root,
        { before: "nav", after: "dash" },
        { before: "top", after: "bottom" },
      ),
    ).toBe(false);
  });

  it("rejects cells placed off the grid, or on each other", () => {
    const cell = (extra: object) => ({
      ...dashboard(),
      children: [{ id: "x", column: "left", row: "top", ...extra }],
    });
    expect(() => parseTree(cell({ column: "nope" }))).toThrow(
      /column "nope", which isn't one of/,
    );
    expect(() => parseTree(cell({ row: "left" }))).toThrow(/row "left"/);
    expect(() => parseTree(cell({ columnSpan: 4 }))).toThrow(/past/);
    expect(() => parseTree(cell({ rowSpan: 0 }))).toThrow(/whole number/);
    expect(() =>
      parseTree({
        ...dashboard(),
        children: [
          { id: "a", column: "left", columnSpan: 2, row: "top" },
          { id: "b", column: "middle", row: "top" },
        ],
      }),
    ).toThrow(/"b" and "a" both take the same place/);
    expect(() => parseTree({ ...dashboard(), columns: [] })).toThrow(
      /at least one column/,
    );
    expect(() =>
      parseTree({
        ...dashboard(),
        children: [{ id: "left", column: "left", row: "top" }],
      }),
    ).toThrow(/Two parts of the layout have the id "left"/);
  });
});

describe("a grid's tracks", () => {
  it("share the grid's space like a group's children", () => {
    expect(sizes(create())).toEqual({
      left: 300,
      middle: 300,
      right: 300,
      top: 300,
      bottom: 300,
    });
  });

  it("move along their line when it's dragged", () => {
    const dragged = moveDrag(
      startDrag(create(), [{ before: "left", after: "middle" }]),
      50,
      20,
    );
    expect(sizes(dragged)).toMatchObject({ left: 350, middle: 250, top: 300 });
    expect(sizes(endDrag(dragged))).toMatchObject({ left: 350, middle: 250 });
  });

  it("move both ways from a junction of a column line and a row line", () => {
    const dragged = moveDrag(
      startDrag(create(), [
        { before: "middle", after: "right" },
        { before: "top", after: "bottom" },
      ]),
      -100,
      60,
    );
    expect(sizes(dragged)).toEqual({
      left: 300,
      middle: 200,
      right: 400,
      top: 360,
      bottom: 240,
    });
  });

  it("go to their stops, the others making room", () => {
    const state = create(
      dashboard([
        { id: "left", stops: { rail: 48, open: { min: 150 } } },
        { id: "middle" },
        { id: "right" },
      ]),
    );
    const railed = setChildStop(state, "left", "rail");
    expect(sizes(railed)).toMatchObject({ left: 48, middle: 426, right: 426 });
    expect(toSnapshot(railed).children.left).toMatchObject({ stop: "rail" });
    expect(allowsStop(railed, "left", "rail")).toBe(false);
    expect(allowsStop(railed, "left", "open")).toBe(true);
  });

  it("move by keys on their line", () => {
    const moved = applyKeyboard(create(), "top", "bottom", {
      kind: "move",
      delta: 30,
    });
    expect(sizes(moved)).toMatchObject({ top: 330, bottom: 270 });
  });
});

describe("a grid in a group", () => {
  const app = (grid: LayoutGridOptions = dashboard()): LayoutOptions => ({
    layout: {
      id: "app",
      direction: "row",
      children: [{ id: "nav", defaultSize: 200 }, grid],
    },
    elastic: false,
  });

  /** 1100 wide: the nav, and the grid's 900; the grid 600 tall. */
  function nested(grid?: LayoutGridOptions): LayoutState {
    return measure(createLayoutState(parseLayoutOptions(app(grid))), {
      app: groupSpace(1100),
      [COLUMNS]: groupSpace(900),
      [ROWS]: groupSpace(600),
    });
  }

  it("can't be made smaller than its columns need", () => {
    const state = nested(
      dashboard([
        { id: "left", minSize: 200 },
        { id: "middle", minSize: 200 },
        { id: "right", minSize: 200 },
      ]),
    );
    const dragged = moveDrag(
      startDrag(state, [{ before: "nav", after: "dash" }]),
      800,
      0,
    );
    expect(sizes(dragged)).toMatchObject({ nav: 500, dash: 600 });
  });

  it("passes a change in its width down to its columns", () => {
    // From code, it animates: the browser's measurements of the grid lag,
    // so its columns get the space it's about to have.
    const released = setChildSize(nested(), "nav", { value: 290, unit: "px" });
    expect(sizes(released)).toMatchObject({
      nav: 290,
      dash: 810,
      left: 270,
      middle: 270,
      right: 270,
      // Its height didn't change.
      top: 300,
    });
    expect(released.spaces[COLUMNS].available).toBe(810);
  });

  it("takes new options without losing its tracks' sizes", () => {
    const moved = endDrag(
      moveDrag(
        startDrag(nested(), [{ before: "left", after: "middle" }]),
        60,
        0,
      ),
    );
    const config = parseLayoutOptions(
      app({ ...dashboard(), children: dashboard().children.slice(0, 2) }),
    );
    expect(sizes(setConfig(moved, config))).toMatchObject({
      left: 360,
      middle: 240,
    });
  });
});

describe("groups and grids in a grid's cells", () => {
  /**
   * The dashboard with its chart a row of two (spanning two columns), its
   * table a grid of its own, and its log a row of two.
   */
  const withContents = (min = 100): LayoutGridOptions => ({
    ...dashboard(),
    children: [
      {
        id: "chart",
        column: "left",
        columnSpan: 2,
        row: "top",
        direction: "row",
        children: [{ id: "chart-a" }, { id: "chart-b" }],
      },
      { id: "stats", column: "right", row: "top", rowSpan: 2 },
      {
        id: "table",
        column: "left",
        row: "bottom",
        columns: [{ id: "t1" }, { id: "t2" }],
        rows: [{ id: "tr" }],
        children: [
          { id: "t1-cell", column: "t1", row: "tr" },
          { id: "t2-cell", column: "t2", row: "tr" },
        ],
      },
      {
        id: "log",
        column: "middle",
        row: "bottom",
        direction: "row",
        children: [
          { id: "list", minSize: min },
          { id: "detail", minSize: min },
        ],
      },
    ],
  });
  const TABLE_COLUMNS = trackGroupId("table", "columns");
  const TABLE_ROWS = trackGroupId("table", "rows");

  /** 900 by 600 for the dashboard's tracks, 300 each, as the browser has it. */
  function create(grid: LayoutGridOptions = withContents()): LayoutState {
    const options: LayoutOptions = { layout: grid, elastic: false };
    return measure(createLayoutState(parseLayoutOptions(options)), {
      [COLUMNS]: groupSpace(900),
      [ROWS]: groupSpace(600),
      // Two columns and the line between them.
      chart: groupSpace(600, 1),
      [TABLE_COLUMNS]: groupSpace(300),
      [TABLE_ROWS]: groupSpace(300),
      log: groupSpace(300),
    });
  }

  it("hangs a cell's group or grid off the tracks it shares", () => {
    const index = indexTree(parseTree(withContents()));
    // A row's separators move the columns' space; a grid's tracks, each
    // its own way.
    expect(index.parents.get("log")?.id).toBe(COLUMNS);
    expect(index.parents.get(TABLE_COLUMNS)?.id).toBe(COLUMNS);
    expect(index.parents.get(TABLE_ROWS)?.id).toBe(ROWS);
    expect(index.nodes.get("log")?.kind).toBe("group");
    expect(index.cellOf.get("log")).toMatchObject({ column: 1, row: 1 });
    expect(index.gridOf.get("t1")?.id).toBe("table");
    // A cell's group is measured as a group, not as the grid's tracks.
    expect(gridOfTracks(index, "log")).toBeUndefined();
    expect(gridOfTracks(index, COLUMNS)?.id).toBe("dash");
    expect(gridOfTracks(index, TABLE_ROWS)?.id).toBe("table");
    const root = parseTree(withContents());
    expect(groupBetween(root, "list", "detail")?.id).toBe("log");
    // A cell isn't one of its parent's children: no line to its tracks.
    expect(groupBetween(root, "log", "right")).toBeNull();
    const logLine = { before: "list", after: "detail" };
    expect(shareSpace(root, logLine, { before: "left", after: "middle" })).toBe(
      true,
    );
    expect(shareSpace(root, logLine, { before: "top", after: "bottom" })).toBe(
      false,
    );
  });

  it("keeps a track as big as the group in a cell of its own needs", () => {
    // The log needs 2 × 150: the middle column holds at 300, and the drag
    // cascades on into the right one.
    const state = create(withContents(150));
    const dragged = moveDrag(
      startDrag(state, [{ before: "left", after: "middle" }]),
      200,
      0,
    );
    expect(sizes(dragged)).toMatchObject({
      left: 500,
      middle: 300,
      right: 100,
    });
    // Unless a cell spans more: the chart's children don't hold the left
    // column, the table's grid in it does (its tracks have no minimums).
    const left = moveDrag(
      startDrag(state, [{ before: "left", after: "middle" }]),
      -250,
      0,
    );
    expect(sizes(left)).toMatchObject({ left: 50 });
  });

  it("passes a track's change to the groups and grids in its cells", () => {
    const moved = setChildSize(create(), "left", { value: 250, unit: "px" });
    expect(sizes(moved)).toMatchObject({ left: 250, middle: 325, right: 325 });
    // The table is in the left column; the log in the middle; the chart
    // spans both, so it gets both changes.
    expect(moved.spaces[TABLE_COLUMNS].available).toBe(250);
    expect(moved.spaces.log.available).toBe(325);
    expect(moved.spaces.chart.available).toBe(575);
    // Not the other way.
    expect(moved.spaces[TABLE_ROWS].available).toBe(300);
    expect(sizes(moved)).toMatchObject({ t1: 125, list: 162.5 });
  });

  it("passes a spanning cell its tracks' changes added up", () => {
    // The chart spans left and middle, with 10px left for its children
    // (the rest padding). Left gives 20 to middle: the chart is the same
    // width, so it keeps its 10, not 0 clamped from left's change and then
    // 20 from middle's.
    const state = measure(create(), { chart: groupSpace(10, 590) });
    const dragging = moveDrag(
      startDrag(state, [{ before: "left", after: "middle" }]),
      -20,
      0,
    );
    expect(sizes(dragging)).toMatchObject({ left: 280, middle: 320 });
    expect(dragging.spaces.chart.available).toBe(10);
    expect(endDrag(dragging).spaces.chart.available).toBe(10);
  });

  it("refuses a stop for a cell's group, which is its tracks' size", () => {
    expect(allowsStop(create(), "log", "anything")).toBe(false);
  });
});
