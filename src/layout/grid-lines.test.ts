import { describe, expect, it } from "vitest";

import {
  cellArea,
  crossingArea,
  segmentArea,
  segmentsOf,
  templateOf,
} from "./grid-lines.js";
import { type GridNode, parseTree } from "./tree.js";

/**
 * Three columns, two rows:
 *
 *   +---------------+-------+
 *   |     chart     |       |
 *   +-------+-------+ stats |
 *   | table |  log  |       |
 *   +-------+-------+-------+
 */
const dashboard = parseTree({
  id: "dash",
  columns: [{ id: "left" }, { id: "middle" }, { id: "right" }],
  rows: [{ id: "top" }, { id: "bottom" }],
  children: [
    { id: "chart", column: "left", columnSpan: 2, row: "top" },
    { id: "stats", column: "right", row: "top", rowSpan: 2 },
    { id: "table", column: "left", row: "bottom" },
    { id: "log", column: "middle", row: "bottom" },
  ],
}) as GridNode;

describe("grid lines", () => {
  it("cuts a line where a cell spans across it", () => {
    expect(segmentsOf(dashboard)).toEqual([
      // Under the chart only.
      {
        before: "left",
        after: "middle",
        segment: 0,
        between: "columns",
        index: 0,
        from: 1,
        to: 1,
      },
      {
        before: "middle",
        after: "right",
        segment: 0,
        between: "columns",
        index: 1,
        from: 0,
        to: 1,
      },
      // Not under the stats.
      {
        before: "top",
        after: "bottom",
        segment: 0,
        between: "rows",
        index: 0,
        from: 0,
        to: 1,
      },
    ]);
  });

  it("splits a line into segments either side of a cell across it", () => {
    const grid = parseTree({
      id: "g",
      columns: [{ id: "a" }, { id: "b" }],
      rows: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
      children: [{ id: "wide", column: "a", columnSpan: 2, row: "r2" }],
    }) as GridNode;
    const line = segmentsOf(grid).filter((segment) => segment.before === "a");
    expect(line.map(({ segment, from, to }) => [segment, from, to])).toEqual([
      [0, 0, 0],
      [1, 2, 2],
    ]);
  });

  it("places cells over their tracks and the lines between them", () => {
    const [chart, stats] = dashboard.cells;
    expect(cellArea(chart)).toEqual({ gridColumn: "1 / 4", gridRow: "1 / 2" });
    expect(cellArea(stats)).toEqual({ gridColumn: "5 / 6", gridRow: "1 / 4" });
  });

  it("places a segment in its line's track, on into the lines at its ends", () => {
    const [underChart, beside, across] = segmentsOf(dashboard);
    // Down from the row line it meets, to the grid's edge.
    expect(segmentArea(dashboard, underChart)).toEqual({
      gridColumn: "2 / 3",
      gridRow: "2 / 4",
    });
    expect(segmentArea(dashboard, beside)).toEqual({
      gridColumn: "4 / 5",
      gridRow: "1 / 4",
    });
    // From the grid's edge into the line beside the stats.
    expect(segmentArea(dashboard, across)).toEqual({
      gridColumn: "1 / 5",
      gridRow: "2 / 3",
    });
  });

  it("places a crossing where two lines' tracks meet", () => {
    expect(crossingArea(1, 0)).toEqual({
      gridColumn: "4 / 5",
      gridRow: "2 / 3",
    });
  });

  it("puts a line's track between each two tracks", () => {
    expect(templateOf(["200px", "300px", "1fr"])).toBe(
      "200px min-content 300px min-content 1fr",
    );
  });
});
