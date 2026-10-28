/**
 * Where a grid's parts go in its CSS grid. The template interleaves its
 * tracks with a track for each line between them, which the line's
 * separators size (`min-content`): track `i` is the template's `2i`th, and
 * the line after it the `2i + 1`th. So in CSS grid line numbers (from 1),
 * track `i` runs from `2i + 1` to `2i + 2`, and the line after it from
 * `2i + 2` to `2i + 3`.
 *
 * A line runs wherever no cell spans across it, so a cell spanning two
 * columns cuts the line between them: what's left is its segments, each an
 * element of its own (see `segmentsOf`).
 */
import type { CellNode, GridNode } from "./tree.js";

/** One stretch of a line between two of a grid's tracks. */
export interface GridSegment {
  /** The tracks either side: the line's `getSeparatorProps(before, after)`. */
  readonly before: string;
  readonly after: string;
  /** Which of its line's segments it is, counted from the line's start. */
  readonly segment: number;
  /**
   * `columns` for a line between two columns (which runs down the grid),
   * `rows` for one between two rows.
   */
  readonly between: "columns" | "rows";
  /** The index of the track before it. */
  readonly index: number;
  /** The first and last track (the other way) it runs along, by index. */
  readonly from: number;
  readonly to: number;
}

/** A place in the grid, as CSS `grid-column` and `grid-row`. */
export interface GridArea {
  readonly gridColumn: string;
  readonly gridRow: string;
}

/** The template line a track starts at. */
const trackStart = (index: number) => 2 * index + 1;
/** The template line a track ends at. */
const trackEnd = (index: number) => 2 * index + 2;

/** Where a cell goes: its tracks, and the lines between them. */
export function cellArea(cell: CellNode): GridArea {
  return {
    gridColumn: `${trackStart(cell.column)} / ${trackEnd(cell.column + cell.columnSpan - 1)}`,
    gridRow: `${trackStart(cell.row)} / ${trackEnd(cell.row + cell.rowSpan - 1)}`,
  };
}

/** The area of the line after track `index`. */
function lineArea(index: number): string {
  return `${trackEnd(index)} / ${trackEnd(index) + 1}`;
}

/**
 * Where a segment goes: in its line's track, along its tracks and the lines
 * between them, and on into the lines at its ends (where it meets another
 * line), so lines that meet leave no gap at the corner.
 */
export function segmentArea(grid: GridNode, segment: GridSegment): GridArea {
  const across = (segment.between === "columns" ? grid.rows : grid.columns)
    .children.length;
  const start =
    segment.from > 0 ? trackStart(segment.from) - 1 : trackStart(segment.from);
  const end =
    segment.to < across - 1 ? trackEnd(segment.to) + 1 : trackEnd(segment.to);
  const along = `${start} / ${end}`;
  const line = lineArea(segment.index);
  return segment.between === "columns"
    ? { gridColumn: line, gridRow: along }
    : { gridColumn: along, gridRow: line };
}

/**
 * Where the line after column `column` crosses the line after row `row`:
 * the area a junction of the two sits in.
 */
export function crossingArea(column: number, row: number): GridArea {
  return { gridColumn: lineArea(column), gridRow: lineArea(row) };
}

/** A template: the tracks' sizes, with a line's track between each two. */
export function templateOf(sizes: readonly string[]): string {
  return sizes.join(" min-content ");
}

const segmentsByGrid = new WeakMap<GridNode, readonly GridSegment[]>();

/**
 * Every segment of every line in a grid: the column lines first, in track
 * order (left to right, or right to left in a right-to-left layout), then
 * the row lines, top to bottom, each from its start.
 */
export function segmentsOf(grid: GridNode): readonly GridSegment[] {
  const cached = segmentsByGrid.get(grid);
  if (cached) return cached;
  const segments = [
    ...linesBetween(grid, "columns"),
    ...linesBetween(grid, "rows"),
  ];
  segmentsByGrid.set(grid, segments);
  return segments;
}

function linesBetween(
  grid: GridNode,
  between: "columns" | "rows",
): GridSegment[] {
  const tracks = grid[between].children;
  const across = (between === "columns" ? grid.rows : grid.columns).children
    .length;
  const segments: GridSegment[] = [];
  for (let index = 0; index < tracks.length - 1; index++) {
    // Where a cell spans across the line, it's cut.
    const cut = new Set<number>();
    for (const cell of grid.cells) {
      const [start, span, otherStart, otherSpan] =
        between === "columns"
          ? [cell.column, cell.columnSpan, cell.row, cell.rowSpan]
          : [cell.row, cell.rowSpan, cell.column, cell.columnSpan];
      if (start <= index && start + span - 1 >= index + 1) {
        for (let at = otherStart; at < otherStart + otherSpan; at++) {
          cut.add(at);
        }
      }
    }
    let segment = 0;
    for (let at = 0; at < across; at++) {
      if (cut.has(at)) continue;
      let to = at;
      while (to + 1 < across && !cut.has(to + 1)) to++;
      segments.push({
        before: tracks[index].id,
        after: tracks[index + 1].id,
        segment: segment++,
        between,
        index,
        from: at,
        to,
      });
      at = to;
    }
  }
  return segments;
}

/** The cells that end at a line's segment, on the side before it. */
export function cellsBefore(grid: GridNode, segment: GridSegment): CellNode[] {
  return grid.cells.filter((cell) => {
    const [end, start, span] =
      segment.between === "columns"
        ? [cell.column + cell.columnSpan - 1, cell.row, cell.rowSpan]
        : [cell.row + cell.rowSpan - 1, cell.column, cell.columnSpan];
    return (
      end === segment.index &&
      start <= segment.to &&
      start + span - 1 >= segment.from
    );
  });
}

/** The cells that start on a segment's line (the track after it). */
export function cellsAfter(grid: GridNode, segment: GridSegment): CellNode[] {
  return grid.cells.filter((cell) => {
    const [first, start, span] =
      segment.between === "columns"
        ? [cell.column, cell.row, cell.rowSpan]
        : [cell.row, cell.column, cell.columnSpan];
    return (
      first === segment.index + 1 &&
      start <= segment.to &&
      start + span - 1 >= segment.from
    );
  });
}
