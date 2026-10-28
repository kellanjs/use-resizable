// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { act, useLayoutEffect } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  installAnimationFrames,
  installPointerCapture,
  installResizeObserver,
  pointer,
} from "../../testing/dom.js";
import { resetWarnings } from "../foundation/warn.js";
import type { ResizableLayoutChild } from "./layout-view.js";
import type { LayoutGridOptions } from "./tree.js";
import {
  type ResizableLayout,
  type UseResizableLayoutOptions,
  useResizableLayout,
} from "./use-resizable-layout.js";

let frames: ReturnType<typeof installAnimationFrames>;
let observer: ReturnType<typeof installResizeObserver>;
let restoreCapture: () => void;

/**
 * jsdom doesn't lay grids out: the grid's computed template is what the
 * browser would report, its tracks in pixels.
 */
let template = { columns: "", rows: "" };

beforeEach(() => {
  frames = installAnimationFrames();
  observer = installResizeObserver();
  restoreCapture = installPointerCapture();
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = real(element);
    if (!(element as HTMLElement).hasAttribute("data-grid")) return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === "gridTemplateColumns") return template.columns;
        if (key === "gridTemplateRows") return template.rows;
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
});

afterEach(() => {
  frames.restore();
  observer.restore();
  restoreCapture();
  vi.restoreAllMocks();
});

/**
 *   +---------------+-------+
 *   |     chart     |       |
 *   +-------+-------+ stats |
 *   | table |  log  |       |
 *   +-------+-------+-------+
 */
const dashboard = {
  id: "dash",
  columns: [
    { id: "left" },
    { id: "middle" },
    { id: "right", stops: { closed: 0, open: { min: 200 } } },
  ],
  rows: [{ id: "top" }, { id: "bottom" }],
  children: [
    { id: "chart", column: "left", columnSpan: 2, row: "top" },
    { id: "stats", column: "right", row: "top", rowSpan: 2 },
    { id: "table", column: "left", row: "bottom" },
    { id: "log", column: "middle", row: "bottom" },
  ],
} as const satisfies LayoutGridOptions;

let latest: ResizableLayout;
/** Each line's `primary`, by the track before it (`"before"` if absent). */
let sides: Record<string, "before" | "after"> = {};

function Dashboard() {
  const dash = useResizableLayout({
    idPrefix: "d",
    layout: dashboard,
    elastic: false,
  });
  useLayoutEffect(() => {
    latest = dash as ResizableLayout;
  });
  return (
    <div data-testid="dash" {...dash.getGroupProps("dash")}>
      {(["chart", "stats", "table", "log"] as const).map((id) => (
        <div key={id} data-testid={id} {...dash.getElementProps(id)} />
      ))}
      {dash.separatorsOf("dash").map(({ key, before, after, segment }) => (
        <div
          key={key}
          data-testid={key}
          {...dash.getSeparatorProps(before, after, {
            segment,
            primary: sides[before],
          })}
          aria-label={`Resize ${before}`}
        />
      ))}
      <div
        data-testid="junction"
        {...dash.getJunctionProps([
          ["middle", "right"],
          ["top", "bottom"],
        ])}
      />
    </div>
  );
}

/** The grid laid out 902 by 601: 900 and 600 for its tracks, 1px lines. */
async function measured() {
  render(<Dashboard />);
  template = {
    columns: "300px 1px 300px 1px 300px",
    rows: "300px 1px 300px",
  };
  await act(async () => {
    observer.resize(screen.getByTestId("dash"), { width: 902, height: 601 });
  });
}

const style = (id: string) => screen.getByTestId(id).style;

describe("useResizableLayout with a grid", () => {
  it("lays it out as a CSS grid, its lines' tracks between its tracks", () => {
    render(<Dashboard />);
    const grid = screen.getByTestId("dash");
    expect(grid.style.display).toBe("grid");
    expect(grid.dataset.grid).toBe("");
    expect(grid.dataset.direction).toBeUndefined();
    // Before it's measured, its tracks share it.
    expect(grid.style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) min-content minmax(0, 1fr) min-content minmax(0, 1fr)",
    );
    expect(style("chart").gridColumn).toBe("1 / 4");
    expect(style("stats").gridRow).toBe("1 / 4");
    expect(style("chart").contain).toBe("size");
  });

  it("measures it again when its gap changes, though nothing resizes", async () => {
    await measured();
    const columns = () =>
      ["left", "middle", "right"].map(
        (id) => latest.getChild(id as never)?.size,
      );
    expect(columns()).toEqual([300, 300, 300]);
    // A class or style giving it gaps: its tracks only move.
    await act(async () => {
      screen.getByTestId("dash").style.columnGap = "15px";
      await Promise.resolve();
    });
    // Four gaps (either side of each line) out of 900.
    expect(columns()).toEqual([280, 280, 280]);
  });

  it("renders each segment of its lines where it goes", () => {
    render(<Dashboard />);
    expect(latest.separatorsOf("dash").map((entry) => entry.key)).toEqual([
      "left|middle|0",
      "middle|right|0",
      "top|bottom|0",
    ]);
    const underChart = style("left|middle|0");
    expect([underChart.gridColumn, underChart.gridRow]).toEqual([
      "2 / 3",
      "2 / 4",
    ]);
    const line = screen.getByTestId("left|middle|0");
    expect(line.dataset.direction).toBe("row");
    expect(line.getAttribute("aria-orientation")).toBe("vertical");
    // It controls the cell before it where it starts: the table.
    expect(line.getAttribute("aria-controls")).toBe("d-table");
  });

  it("controls the cell after a line that's about its after side", () => {
    sides = { middle: "after" };
    render(<Dashboard />);
    sides = {};
    // The stats start right after the middle column.
    expect(
      screen.getByTestId("middle|right|0").getAttribute("aria-controls"),
    ).toBe("d-stats");
  });

  it("places a junction of a column line and a row line on their crossing", () => {
    render(<Dashboard />);
    const junction = style("junction");
    expect(junction.position).toBe("absolute");
    expect([junction.gridColumn, junction.gridRow]).toEqual(["4 / 5", "2 / 3"]);
    expect(style("dash").position).toBe("relative");
  });

  it("measures its tracks' space from the grid, less its lines", async () => {
    await measured();
    expect(latest.getChild("left")?.size).toBe(300);
    expect(latest.getChild("top")?.size).toBe(300);
    expect(style("dash").gridTemplateColumns).toBe(
      "300px min-content 300px min-content 300px",
    );
  });

  it("animates its templates when a track changes stop", async () => {
    await measured();
    act(() => latest.setStop("right", "closed"));
    expect(style("dash").gridTemplateColumns).toBe(
      "450px min-content 450px min-content 0px",
    );
    expect(style("dash").transition).toMatch(/grid-template-columns \d+ms/);
    // The stats keep their content at the column's open size.
    expect(style("stats").getPropertyValue("--resizable-content-width")).toBe(
      "300px",
    );
  });

  it("drags a line's tracks", async () => {
    await measured();
    act(() => {
      pointer(screen.getByTestId("middle|right|0"), "pointerdown", { x: 600 });
      pointer(window, "pointermove", { x: 540 });
      frames.flushFrame();
    });
    expect(latest.getChild("middle")?.size).toBe(240);
    expect(latest.getChild("right")?.size).toBe(360);
  });

  it("marks a junction as dragging while it's dragged", async () => {
    await measured();
    const junction = screen.getByTestId("junction");
    act(() => {
      pointer(junction, "pointerdown", { x: 600, y: 300 });
      pointer(window, "pointermove", { x: 640, y: 330 });
      frames.flushFrame();
    });
    expect(junction.dataset.dragging).toBe("");
    expect(latest.getChild("middle")?.size).toBe(340);
    expect(latest.getChild("top")?.size).toBe(330);
    act(() => void pointer(window, "pointerup", { x: 640, y: 330 }));
    expect(junction.dataset.dragging).toBeUndefined();
  });

  it("pins a cell's clip by where it sits, covering only", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Dashboard />);
    const pins = (id: "chart" | "stats" | "log") => {
      const { justifyContent, alignItems } = latest.getClipProps(id).style;
      return [justifyContent, alignItems];
    };
    // At the grid's start both ways.
    expect(pins("chart")).toEqual(["flex-start", "flex-start"]);
    // In its last column (and every row): its end, its top.
    expect(pins("stats")).toEqual(["flex-end", "flex-start"]);
    // In a middle column and the last row.
    expect(pins("log")).toEqual(["flex-start", "flex-end"]);
    const slid = latest.getClipProps("stats", { slide: true });
    expect(slid.style.justifyContent).toBe("flex-end");
    expect(slid["data-sliding"]).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("sliding isn't offered for cells"),
    );
  });

  it("warns about a segment its line doesn't have", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Dashboard />);
    latest.getSeparatorProps("left", "middle", { segment: 1 });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("has no such segment"),
    );
  });

  it("types its tracks and cells from the options", () => {
    // Type-level only: checked by tsc, never called.
    function useTypes() {
      const dash = useResizableLayout({ layout: dashboard });
      expectTypeOf(dash.getChild("right").stop).toEqualTypeOf<
        "closed" | "open" | null
      >();
      dash.setStop("right", "closed");
      // @ts-expect-error: not one of the right column's stops
      dash.setStop("right", "tiny");
      dash.getElementProps("chart");
      // @ts-expect-error: a cell has no view of its own
      dash.getChild("chart");
      dash.getSeparatorProps("left", "middle", { segment: 0 });

      // Nor does one of a grid in a cell; its tracks do.
      const nested = useResizableLayout({
        layout: {
          id: "outer",
          columns: [{ id: "c1" }, { id: "c2" }],
          rows: [{ id: "r1" }],
          children: [
            { id: "plain", column: "c1", row: "r1" },
            {
              id: "inner",
              column: "c2",
              row: "r1",
              columns: [{ id: "ic1" }],
              rows: [{ id: "ir1" }],
              children: [{ id: "innerCell", column: "ic1", row: "ir1" }],
            },
          ],
        },
      });
      nested.getChild("ic1");
      // @ts-expect-error: a cell of the grid in a cell
      nested.getChild("innerCell");

      // Ids built at runtime are all strings: a track may not exist.
      const columns = ["a", "b"];
      const built = useResizableLayout({
        layout: {
          id: "grid",
          columns: columns.map((id) => ({ id })),
          rows: [{ id: "row" }],
          children: columns.map((column) => ({
            id: `${column}-cell`,
            column,
            row: "row",
          })),
        },
      });
      expectTypeOf(built.getChild("a")).toEqualTypeOf<
        ResizableLayoutChild<"a"> | undefined
      >();
    }
    expect(useTypes).toBeTypeOf("function");
  });
});

describe("useResizableLayout rendering a grid from childrenOf", () => {
  /**
   * A renderer that knows nothing of the layout: each node by its kind,
   * a group's separators between its children, a grid's in any order.
   */
  function Node({
    layout,
    id,
    kind,
  }: {
    layout: ResizableLayout;
    id: string;
    kind: "element" | "group" | "grid";
  }) {
    if (kind === "element") {
      return <div data-testid={id} {...layout.getElementProps(id)} />;
    }
    const children = layout.childrenOf(id);
    return (
      <div data-testid={id} {...layout.getGroupProps(id)}>
        {kind === "grid"
          ? [
              ...children.map((child) => (
                <Node key={child.id} layout={layout} {...child} />
              )),
              ...layout
                .separatorsOf(id)
                .map(({ key, before, after, segment }) => (
                  <div
                    key={key}
                    {...layout.getSeparatorProps(before, after, { segment })}
                    aria-label={key}
                  />
                )),
            ]
          : children.map((child) => [
              child.previous && (
                <div
                  key={`${child.previous}|${child.id}`}
                  {...layout.getSeparatorProps(child.previous, child.id)}
                  aria-label={`${child.previous}|${child.id}`}
                />
              ),
              <Node key={child.id} layout={layout} {...child} />,
            ])}
      </div>
    );
  }

  function Tree() {
    const layout = useResizableLayout({
      layout: {
        id: "dash",
        columns: [{ id: "left" }, { id: "right" }],
        rows: [{ id: "top" }],
        children: [
          {
            id: "chart",
            column: "left",
            row: "top",
            direction: "row",
            children: [{ id: "a" }, { id: "b" }],
          },
          {
            id: "table",
            column: "right",
            row: "top",
            columns: [{ id: "x" }, { id: "y" }],
            rows: [{ id: "r" }],
            children: [
              { id: "t1", column: "x", row: "r" },
              { id: "t2", column: "y", row: "r" },
            ],
          },
        ],
      },
    });
    return <Node layout={layout as ResizableLayout} id="dash" kind="grid" />;
  }

  it("descends into a cell's group and a cell's grid", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Tree />);
    expect(screen.getByTestId("chart").dataset.group).toBe("chart");
    expect(screen.getByTestId("table").dataset.grid).toBe("");
    for (const id of ["a", "b", "t1", "t2"]) {
      expect(screen.getByTestId(id).dataset.element).toBe(id);
    }
    expect(screen.getByLabelText("a|b").getAttribute("role")).toBe("separator");
    expect(screen.getByLabelText("x|y|0").style.gridColumn).toBe("2 / 3");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a cell spanning a track that closes", () => {
  /**
   *   +-------+-------+
   *   |     wide      |
   *   +-------+-------+
   *   |   a   |   b   |
   *   +-------+-------+
   */
  const spanning = {
    id: "grid",
    columns: [{ id: "left" }, { id: "right", stops: { closed: 0, open: {} } }],
    rows: [{ id: "top" }, { id: "bottom" }],
    children: [
      { id: "wide", column: "left", columnSpan: 2, row: "top" },
      { id: "a", column: "left", row: "bottom" },
      { id: "b", column: "right", row: "bottom" },
    ],
  } as const satisfies LayoutGridOptions;

  let grid: ResizableLayout;

  function Spanning() {
    const layout = useResizableLayout({ layout: spanning, elastic: false });
    useLayoutEffect(() => {
      grid = layout as ResizableLayout;
    });
    return (
      <div data-testid="grid" {...layout.getGroupProps("grid")}>
        {(["wide", "a", "b"] as const).map((id) => (
          <div key={id} data-testid={id} {...layout.getElementProps(id)} />
        ))}
      </div>
    );
  }

  const contentWidth = (id: string) =>
    style(id).getPropertyValue("--resizable-content-width");

  async function setup() {
    render(<Spanning />);
    // Its lines' tracks, between, take no room.
    template = { columns: "300px 0px 300px", rows: "300px 0px 300px" };
    await act(async () => {
      observer.resize(screen.getByTestId("grid"), { width: 600, height: 600 });
    });
  }

  it("lays its content out at its size while the track closes, and after", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => grid.setStop("right", "closed"));
      expect(grid.animating).toBe(true);
      // The cell stays 600 wide (the other column takes the space): its
      // content follows it, rather than being laid out at 300 + 600.
      expect(contentWidth("wide")).toBe("initial");
      // A cell in the closing column alone keeps its content's size.
      expect(contentWidth("b")).toBe("300px");
      await act(async () => void vi.advanceTimersByTime(450));
      expect(grid.animating).toBe(false);
      // At rest, the closed column adds nothing to the cell's content.
      expect(contentWidth("wide")).toBe("initial");
      expect(contentWidth("b")).toBe("300px");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a grid line's segments", () => {
  /**
   * Line a|b has a segment beside x|y and another beside p|q (m spans it
   * between them); then p and q become one cell spanning it, so the second
   * segment goes, and the first stays as it was.
   */
  const two = {
    id: "g",
    columns: [{ id: "a" }, { id: "b" }],
    rows: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
    children: [
      { id: "x", column: "a", row: "r1" },
      { id: "y", column: "b", row: "r1" },
      { id: "m", column: "a", columnSpan: 2, row: "r2" },
      { id: "p", column: "a", row: "r3" },
      { id: "q", column: "b", row: "r3" },
    ],
  } satisfies LayoutGridOptions;
  const one = {
    ...two,
    children: [
      ...two.children.slice(0, 3),
      { id: "w", column: "a", columnSpan: 2, row: "r3" },
    ],
  } satisfies LayoutGridOptions;

  function Lines({ layout }: { layout: LayoutGridOptions }) {
    const grid = useResizableLayout({ idPrefix: "g", layout, elastic: false });
    return (
      <div {...grid.getGroupProps("g")}>
        {layout.children.map((cell) => (
          <div key={cell.id} {...grid.getElementProps(cell.id)} />
        ))}
        {grid.separatorsOf("g").map(({ key, before, after, segment }) => (
          <div
            key={key}
            data-testid={key}
            aria-label="Resize"
            {...grid.getSeparatorProps(before, after, { segment })}
          />
        ))}
      </div>
    );
  }

  it("keeps one wired up when another goes (each has its own ref)", () => {
    const { rerender } = render(<Lines layout={two} />);
    const kept = screen.getByTestId("a|b|0");
    expect(screen.getByTestId("a|b|1")).toBeTruthy();
    rerender(<Lines layout={one} />);
    expect(screen.getByTestId("a|b|0")).toBe(kept);
    expect(observer.isObserved(kept)).toBe(true);
  });
});

describe("a grid's space", () => {
  function Pair({ min }: { min?: number }) {
    const grid = useResizableLayout({
      idPrefix: "p",
      elastic: false,
      layout: {
        id: "g",
        columns: [
          { id: "a", minSize: min },
          { id: "b", minSize: min },
        ],
        rows: [{ id: "r" }],
        children: [
          { id: "ca", column: "a", row: "r" },
          { id: "cb", column: "b", row: "r" },
        ],
      },
    });
    useLayoutEffect(() => {
      latest = grid as ResizableLayout;
    });
    return (
      <div data-testid="g" {...grid.getGroupProps("g")}>
        <div data-testid="ca" {...grid.getElementProps("ca")} />
        <div data-testid="cb" {...grid.getElementProps("cb")} />
        {grid.separatorsOf("g").map(({ key, before, after, segment }) => (
          <div
            key={key}
            {...grid.getSeparatorProps(before, after, { segment })}
            aria-label="Resize"
          />
        ))}
      </div>
    );
  }
  const grid = () => screen.getByTestId("g");

  it("follows its padding, though its outer size stays", async () => {
    render(<Pair />);
    template = { columns: "300px 1px 300px", rows: "300px" };
    await act(async () => {
      observer.resize(grid(), { width: 601, height: 300 });
      observer.resize(screen.getByTestId("ca"), { width: 300, height: 300 });
      observer.resize(screen.getByTestId("cb"), { width: 300, height: 300 });
    });
    expect(latest.getChild("a")?.size).toBe(300);
    // 10px of padding each side: the content box is 581.
    grid().style.paddingLeft = "10px";
    grid().style.paddingRight = "10px";
    await act(async () => {
      observer.resize(
        grid(),
        { width: 581, height: 300 },
        { width: 601, height: 300 },
      );
    });
    expect(latest.getChild("a")?.size).toBe(290);
  });

  it("squeezes its tracks into its space when they don't fit, as a group does", async () => {
    render(<Pair min={400} />);
    template = { columns: "300px 1px 300px", rows: "300px" };
    await act(async () => {
      observer.resize(grid(), { width: 601, height: 300 });
    });
    expect(latest.overflowing).toBe(true);
    expect(grid().style.gridTemplateColumns).toMatch(/^300px .* 300px$/);
  });

  it("keeps a point's CSS units before it's measured", () => {
    function Unmeasured() {
      const grid = useResizableLayout({
        idPrefix: "u",
        layout: {
          id: "g",
          columns: [
            { id: "a", defaultStop: "half", stops: { half: "50%", open: {} } },
            { id: "b", defaultStop: "rail", stops: { rail: "3rem", open: {} } },
            { id: "c" },
          ],
          rows: [{ id: "r" }],
          children: [{ id: "ca", column: "a", row: "r" }],
        },
      });
      return (
        <div data-testid="g" {...grid.getGroupProps("g")}>
          <div {...grid.getElementProps("ca")} />
        </div>
      );
    }
    render(<Unmeasured />);
    expect(grid().style.gridTemplateColumns).toMatch(/^50% .* 3rem /);
  });
});

describe("a grid, measured", () => {
  function Row({ withGrid }: { withGrid: boolean }) {
    const layout = useResizableLayout({
      idPrefix: "m",
      elastic: false,
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "side" },
          ...(withGrid
            ? [
                {
                  id: "g",
                  columns: [{ id: "a" }, { id: "b" }],
                  rows: [{ id: "r" }],
                  children: [
                    { id: "ca", column: "a", row: "r" },
                    { id: "cb", column: "b", row: "r" },
                  ],
                },
              ]
            : []),
        ],
      },
    } as UseResizableLayoutOptions) as ResizableLayout;
    useLayoutEffect(() => {
      latest = layout;
    });
    return (
      <div {...layout.getGroupProps("root")}>
        <div data-testid="side" {...layout.getElementProps("side")} />
        {withGrid && (
          <div data-testid="g" {...layout.getGroupProps("g")}>
            <div data-testid="ca" {...layout.getElementProps("ca")} />
            <div data-testid="cb" {...layout.getElementProps("cb")} />
            {layout.separatorsOf("g").map(({ key, before, after, segment }) => (
              <div
                key={key}
                data-testid={`line-${key}`}
                {...layout.getSeparatorProps(before, after, { segment })}
                aria-label="Resize"
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  const grid = () => screen.getByTestId("g");
  const measureGrid = async (content: number, border = 601) => {
    template = { columns: "300px 1px 300px", rows: "300px" };
    await act(async () => {
      observer.resize(
        grid(),
        { width: content, height: 300 },
        { width: border, height: 300 },
      );
      observer.resize(screen.getByTestId("ca"), { width: 300, height: 300 });
      observer.resize(screen.getByTestId("cb"), { width: 300, height: 300 });
    });
  };

  it("follows its padding when it's added after mount", async () => {
    const { rerender } = render(<Row withGrid={false} />);
    await act(async () =>
      observer.resize(screen.getByTestId("side"), { width: 200, height: 300 }),
    );
    rerender(<Row withGrid />);
    await measureGrid(601);
    expect(latest.getChild("a")?.size).toBe(300);
    grid().style.paddingLeft = "10px";
    grid().style.paddingRight = "10px";
    await measureGrid(581);
    expect(latest.getChild("a")?.size).toBe(290);
    expect(observer.isObserved(screen.getByTestId("line-a|b|0"))).toBe(true);
  });

  it("leaves its scrollbar out of what its tracks share", async () => {
    render(<Row withGrid />);
    // A 15px scrollbar: the client box is that much narrower.
    Object.defineProperty(grid(), "offsetWidth", { value: 601 });
    Object.defineProperty(grid(), "clientWidth", { value: 586 });
    await measureGrid(586);
    expect(latest.getChild("a")?.size).toBe(292.5);
  });
});
