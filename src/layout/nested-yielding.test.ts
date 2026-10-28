import { describe, expect, it } from "vitest";

import { groupSpace } from "../../testing/layout.js";
import { own, setOwn } from "../foundation/own.js";
import {
  type GroupSpace,
  type LayoutOptions,
  type LayoutState,
  createLayoutState,
  parseLayoutOptions,
} from "./layout-config.js";
import {
  endDrag,
  measure,
  moveDrag,
  setChildSize,
  setChildStop,
  startDrag,
} from "./layout-model.js";
import { getLayoutRendering } from "./layout-rendering.js";
import {
  type ChildNode,
  type LayoutChildOptions,
  type LayoutTrackOptions,
  type RootNode,
  indexTree,
} from "./tree.js";

/**
 * Measures every group as the browser would lay it out in `width` by
 * `height` (each as its parent draws it), until that settles.
 */
function lay(state: LayoutState, width: number, height = 800): LayoutState {
  let next = state;
  for (let pass = 0; pass < 20; pass++) {
    const nodes = getLayoutRendering(next).nodes;
    const spaces: Record<string, GroupSpace> = {};
    const drawn = (id: string) => nodes.get(id)?.drawn ?? 0;
    const visit = (node: RootNode | ChildNode, w: number, h: number) => {
      // A grid's tracks share its width and height; a cell's content has
      // its column's width and its row's height.
      if (node.kind === "grid") {
        setOwn(spaces, node.columns.id, groupSpace(w));
        setOwn(spaces, node.rows.id, groupSpace(h));
        for (const cell of node.cells) {
          if (!cell.content) continue;
          visit(
            cell.content,
            drawn(node.columns.children[cell.column].id),
            drawn(node.rows.children[cell.row].id),
          );
        }
        return;
      }
      if (node.kind !== "group") return;
      const along = node.axis === "horizontal";
      spaces[node.id] = groupSpace(along ? w : h);
      for (const child of node.children) {
        const drawn = nodes.get(child.id)?.drawn;
        if (drawn == null) continue;
        visit(child, along ? drawn : w, along ? h : drawn);
      }
    };
    visit(next.config.root, width, height);
    const measured = measure(next, spaces);
    if (measured === next) break;
    next = measured;
  }
  return next;
}

/** Each element's size and stop, by id. */
function panes(state: LayoutState) {
  const nodes = getLayoutRendering(state).nodes;
  return Object.fromEntries(
    indexTree(state.config.root).elements.map((element) => {
      const node = nodes.get(element.id);
      return [element.id, `${Math.round(node?.drawn ?? -1)} ${node?.stop}`];
    }),
  );
}

const start = (options: LayoutOptions, width: number) =>
  lay(createLayoutState(parseLayoutOptions(options)), width);

describe("stepping down across groups", () => {
  // The app's window: a sidebar, and beside it a header over the content
  // (a page, and a view of a diagram and a panel).
  const window = (keepSize: boolean | "yield-first"): LayoutOptions =>
    ({
      layout: {
        id: "window",
        direction: "row",
        children: [
          {
            id: "sidebar",
            defaultSize: 300,
            keepSize,
            priority: 1,
            stops: { closed: 0, open: { min: 180 } },
          },
          {
            id: "main",
            direction: "column",
            children: [
              { id: "header", stops: { bar: 40 } },
              {
                id: "content",
                direction: "row",
                children: [
                  {
                    id: "page",
                    // Sized, so the view starts with room for the panel.
                    defaultSize: 400,
                    keepSize: true,
                    priority: -1,
                    stops: { closed: 0, open: { min: 280 } },
                    yieldTo: { open: "closed" },
                  },
                  {
                    id: "view",
                    direction: "row",
                    children: [
                      {
                        id: "diagram",
                        stops: { closed: 0, open: { min: 240 } },
                      },
                      {
                        id: "panel",
                        defaultSize: 340,
                        keepSize,
                        stops: { closed: 0, open: { min: 260 } },
                        yieldTo: { open: "closed" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      elastic: false,
    }) as LayoutOptions;

  it("steps a page two groups down before squeezing the sidebar below its minimum", () => {
    // 180 + 280 + 240 + 260 = 960 doesn't fit 900: the page closes.
    const state = lay(start(window(true), 1400), 900);
    expect(panes(state)).toMatchObject({
      page: "0 closed",
      panel: expect.stringMatching(/open$/),
    });
    expect(Number(panes(state).sidebar.split(" ")[0])).toBeGreaterThanOrEqual(
      180,
    );
  });

  it("keeps the app's order narrowing and widening, keeping sizes first", () => {
    let state = start(window("yield-first"), 1400);
    const seen: Record<number, Record<string, string>> = {};
    for (const width of [1400, 1100, 1000, 800, 700, 500]) {
      state = lay(state, width);
      seen[width] = panes(state);
    }
    // The sidebar keeps 300 and the panel 340 until the page has closed,
    // the panel shrinks to its minimum before it closes, and the sidebar
    // gives way last.
    expect(seen[1400]).toMatchObject({
      sidebar: "300 open",
      page: expect.stringMatching(/open$/),
      panel: "340 open",
    });
    expect(seen[1100]).toMatchObject({
      sidebar: "300 open",
      page: "0 closed",
      diagram: "460 open",
      panel: "340 open",
    });
    expect(seen[1000]).toMatchObject({
      sidebar: "300 open",
      page: "0 closed",
      diagram: "360 open",
      panel: "340 open",
    });
    expect(seen[800]).toMatchObject({
      sidebar: "300 open",
      page: "0 closed",
      diagram: "240 open",
      panel: "260 open",
    });
    expect(seen[700]).toMatchObject({
      sidebar: "300 open",
      page: "0 closed",
      diagram: "400 open",
      panel: "0 closed",
    });
    expect(seen[500]).toMatchObject({
      sidebar: "260 open",
      page: "0 closed",
      diagram: "240 open",
      panel: "0 closed",
    });
    // Widening, the same at each width: last down, first up.
    for (const width of [700, 800, 1000, 1100, 1400]) {
      state = lay(state, width);
      expect(panes(state)).toEqual(seen[width]);
    }
  });

  it("steps down nested panes as the same panes flat would", () => {
    const pane = (id: string, priority = 0) => ({
      id,
      priority,
      stops: { closed: 0, open: { min: 200 } },
      yieldTo: { open: "closed" },
    });
    const flat: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          pane("a"),
          pane("b", -1),
          pane("c"),
          { id: "d", minSize: 100 },
        ],
      },
      elastic: false,
    };
    const nested: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          pane("a"),
          {
            id: "g",
            direction: "row",
            children: [
              pane("b", -1),
              {
                id: "h",
                direction: "column",
                children: [
                  { id: "x" },
                  {
                    id: "y",
                    direction: "row",
                    children: [pane("c"), { id: "d", minSize: 100 }],
                  },
                ],
              },
            ],
          },
        ],
      },
      elastic: false,
    };
    const stops = (state: LayoutState) =>
      Object.fromEntries(
        ["a", "b", "c", "d"].map((id) => [
          id,
          getLayoutRendering(state).nodes.get(id)?.stop,
        ]),
      );
    let a = start(flat, 1000);
    let b = start(nested, 1000);
    for (const width of [1000, 650, 450, 250, 450, 650, 1000]) {
      a = lay(a, width);
      b = lay(b, width);
      expect(stops(b)).toEqual(stops(a));
    }
  });

  it("steps rows of a column down together where they're all the widest", () => {
    const row = (id: string, pane: string, rest: number) => ({
      id,
      direction: "row" as const,
      children: [
        {
          id: pane,
          stops: { closed: 0, open: { min: 200 } },
          yieldTo: { open: "closed" },
        },
        { id: `${id}-rest`, minSize: rest },
      ],
    });
    const options = (top: number, bottom: number): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "side", minSize: 300 },
          {
            id: "column",
            direction: "column",
            children: [row("top", "t", top), row("bottom", "b", bottom)],
          },
        ],
      },
      elastic: false,
    });
    const side = (state: LayoutState) =>
      Number(panes(state).side.split(" ")[0]);
    // Both rows need 600 wide: only closing both frees anything, so both
    // do, and the side keeps its minimum.
    const both = lay(start(options(400, 400), 1000), 750);
    expect(panes(both)).toMatchObject({ t: "0 closed", b: "0 closed" });
    expect(side(both)).toBeGreaterThanOrEqual(300);
    // The bottom row is the widest (700): closing its pane is enough, and
    // the top row's stays open.
    const widest = lay(start(options(400, 500), 1000), 900);
    expect(panes(widest)).toMatchObject({
      b: "0 closed",
      t: expect.stringMatching(/open$/),
    });
    expect(side(widest)).toBeGreaterThanOrEqual(300);
  });

  it("leaves a nested group's panes open where its own minimums fit, a sibling closing first", () => {
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "side",
            priority: -1,
            stops: { closed: 0, open: { min: 300 } },
            yieldTo: { open: "closed" },
          },
          {
            id: "g",
            direction: "row",
            children: [
              {
                id: "p",
                stops: { closed: 0, open: { min: 300 } },
                yieldTo: { open: "closed" },
              },
              { id: "q", minSize: 200 },
            ],
          },
        ],
      },
      elastic: false,
    };
    // 300 + 300 + 200 = 800 doesn't fit 700: the side goes first (its
    // priority), and then the group fits with p open.
    const state = lay(start(options, 1000), 700);
    expect(panes(state)).toMatchObject({
      side: "0 closed",
      p: expect.stringMatching(/open$/),
    });
    expect(own(state.places, "p")?.stop).toBe("open");
  });
});

describe("keeping sizes first", () => {
  const kept = (id: string, priority = 0) => ({
    id,
    priority,
    defaultSize: 300,
    minSize: 100,
    keepSize: "yield-first" as const,
  });
  const row = (children: LayoutChildOptions[]): LayoutOptions => ({
    layout: { id: "root", direction: "row", children },
    elastic: false,
  });
  const sizes = (options: LayoutOptions) => {
    const { a, b, rest } = panes(lay(start(options, 700), 500));
    return { a, b, rest };
  };

  it("has the one that gave way give the space, the others keeping theirs", () => {
    // 300 + 300 doesn't fit 500: b, the last, gives way first, and gives
    // all it has to; a keeps its 300.
    expect(sizes(row([kept("a"), kept("b"), { id: "rest" }]))).toEqual({
      a: "300 ",
      b: "200 ",
      rest: "0 ",
    });
  });

  it("doesn't grow a group the user made smaller back for those inside", () => {
    // The drag makes the group 300: p goes past its rail to hidden for y
    // to keep its 200. Released, the group stays 300, rather than grow
    // back to fit p's rail too.
    const options = row([
      {
        id: "group",
        direction: "row",
        children: [
          { ...kept("y"), defaultSize: 200 },
          {
            id: "p",
            defaultStop: "rail",
            stops: { hidden: 0, rail: 50, open: { min: 100 } },
            yieldTo: { open: "rail", rail: "hidden" },
          },
          { id: "q", defaultSize: 100, minSize: 100 },
        ],
      },
      { id: "rest" },
    ]);
    const state = lay(start(options, 800), 800);
    expect(panes(state)).toMatchObject({ y: "200 ", p: "50 rail" });
    const dragging = lay(
      moveDrag(startDrag(state, [{ before: "group", after: "rest" }]), -100, 0),
      800,
    );
    const shown = panes(dragging);
    expect(shown).toMatchObject({ y: "200 ", p: "0 hidden" });
    expect(panes(lay(endDrag(dragging), 800))).toEqual(shown);
  });

  it("has the one that gave way give the space, from a call too", () => {
    // Widening c to 200 needs 100: b, the last of the others, gives it,
    // and a keeps its 300.
    const options = row([
      kept("a"),
      kept("b"),
      { ...kept("c"), defaultSize: 100 },
    ]);
    const state = lay(start(options, 700), 700);
    const widened = lay(
      setChildSize(state, "c", { value: 200, unit: "px" }),
      700,
    );
    expect(panes(widened)).toEqual({ a: "300 ", b: "200 ", c: "200 " });
  });

  it("has those keeping their size give way for a call's child", () => {
    // c doesn't keep its size, and the others are at theirs: widening it
    // to 200, b gives way.
    const options = row([
      kept("a"),
      kept("b"),
      { id: "c", defaultSize: 100, minSize: 100 },
    ]);
    const state = lay(start(options, 700), 700);
    const widened = lay(
      setChildSize(state, "c", { value: 200, unit: "px" }),
      700,
    );
    expect(panes(widened)).toEqual({ a: "300 ", b: "200 ", c: "200 " });
  });

  it("gives way in the same order grouped as flat", () => {
    const flat = row([kept("a", 10), { id: "rest" }, kept("b", -10)]);
    const nested = row([
      { id: "g", direction: "row", children: [kept("a", 10), { id: "rest" }] },
      kept("b", -10),
    ]);
    expect(sizes(flat)).toMatchObject({ a: "300 ", b: "200 " });
    expect(sizes(nested)).toEqual(sizes(flat));
  });
});

describe("stepping down across groups, from calls", () => {
  it("fits a call with what the groups inside need once stepped down", () => {
    // Widening the sidebar to 500 closes p, two levels down, as it would
    // flat: the sidebar gets its 500, rather than what's left with p open
    // (which would then reopen).
    const sidebar = {
      id: "sidebar",
      defaultSize: 200,
      minSize: 100,
      keepSize: "yield-first" as const,
    };
    const p = {
      id: "p",
      stops: { closed: 0, open: { min: 300 } },
      yieldTo: { open: "closed" },
    };
    const q = { id: "q", minSize: 200 };
    const layout = (children: LayoutChildOptions[]): LayoutOptions => ({
      layout: { id: "root", direction: "row", children },
      elastic: false,
    });
    const flat = layout([sidebar, p, q]);
    const nested = layout([
      sidebar,
      { id: "g", direction: "row", children: [p, q] },
    ]);
    const widened = (options: LayoutOptions) => {
      const state = lay(lay(start(options, 1000), 700), 700);
      const { p, q, sidebar } = panes(
        lay(setChildSize(state, "sidebar", { value: 500, unit: "px" }), 700),
      );
      return { p, q, sidebar };
    };
    expect(widened(flat)).toEqual({
      sidebar: "500 ",
      p: "0 closed",
      q: "200 ",
    });
    expect(widened(nested)).toEqual(widened(flat));
  });
});

describe("stepping down across groups, with drags", () => {
  it("has what a drag resized inside a group remember what it showed", () => {
    // Pushed past p, at its minimum, into the group, y shrinks with it.
    // At the release it keeps that, rather than claim back its 300 and
    // step r down for it.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "group",
            direction: "row",
            children: [
              {
                id: "y",
                defaultSize: 300,
                keepSize: "yield-first",
                stops: { open: { min: 100 } },
              },
            ],
          },
          { id: "p", defaultSize: 200, minSize: 200 },
          { id: "q", defaultSize: 200, keepSize: "yield-first" },
          {
            id: "r",
            defaultSize: 100,
            stops: { rail: 50, open: { min: 100 } },
            yieldTo: { open: "rail" },
          },
        ],
      },
      elastic: false,
      cascade: true,
    };
    const state = start(options, 800);
    const dragging = lay(
      moveDrag(startDrag(state, [{ before: "p", after: "q" }]), -10, 0),
      800,
    );
    const shown = panes(dragging);
    expect(shown).toMatchObject({ y: "290 open", r: "100 open" });
    expect(panes(lay(endDrag(dragging), 800))).toEqual(shown);
  });

  it("keeps a group's last fill beside a locked child, as shown", () => {
    // Closing c leaves its room to the fill: a is at its maximum, and the
    // locked l doesn't take it. The drag widens the group, and the release
    // keeps the fill's room, rather than give it to l.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "group",
            direction: "row",
            children: [
              { id: "fill", fill: "last" },
              {
                id: "c",
                defaultSize: 100,
                stops: { closed: 0, open: { min: 100 } },
              },
              { id: "a", defaultSize: 300, maxSize: 300 },
              { id: "l", defaultSize: 200, locked: true },
            ],
          },
          { id: "other", defaultSize: 200 },
        ],
      },
      elastic: false,
    };
    const closed = lay(setChildStop(start(options, 800), "c", "closed"), 800);
    expect(panes(closed)).toMatchObject({ fill: "100 ", l: "200 " });
    const dragging = lay(
      moveDrag(
        startDrag(closed, [{ before: "group", after: "other" }]),
        100,
        0,
      ),
      800,
    );
    const shown = panes(dragging);
    expect(shown.fill).toBe("100 ");
    expect(panes(lay(endDrag(dragging), 800))).toEqual(shown);
  });

  it("holds what a resize during a drag stepped down, at its release", () => {
    // Narrowed mid-drag, c steps down for a's kept 500; the drag then
    // makes a smaller. Released, c stays down as the drag showed it,
    // rather than open in the room the drag made.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 500, minSize: 100, keepSize: "yield-first" },
          { id: "b", minSize: 100 },
          {
            id: "c",
            defaultSize: 300,
            stops: { rail: 50, open: { min: 300 } },
            yieldTo: { open: "rail" },
          },
        ],
      },
      elastic: false,
    };
    let dragging = lay(
      startDrag(start(options, 1100), [{ before: "a", after: "b" }]),
      550,
    );
    expect(panes(dragging).c).toBe("50 rail");
    dragging = lay(moveDrag(dragging, -250, 0), 550);
    const shown = panes(dragging);
    expect(Number(shown.a.split(" ")[0])).toBeLessThan(200);
    expect(panes(lay(endDrag(dragging), 550))).toEqual(shown);
  });
});

describe("stepping down across groups, in grids", () => {
  // A cell's group in the first column: p, which can close, and q.
  const grid = (
    columns: LayoutTrackOptions[],
    p: Partial<LayoutChildOptions> = {},
  ): LayoutOptions => ({
    layout: {
      id: "grid",
      columns,
      rows: [{ id: "r0" }],
      children: [
        {
          id: "cell",
          column: "c0",
          row: "r0",
          direction: "row",
          children: [
            {
              id: "p",
              stops: { closed: 0, open: { min: 300 } },
              yieldTo: { open: "closed" },
              ...p,
            } as LayoutChildOptions,
            { id: "q", minSize: 100 },
          ],
        },
      ],
    },
    elastic: false,
  });
  /** A node's size and stop: a track's too. */
  const at = (state: LayoutState, id: string) => {
    const node = getLayoutRendering(state).nodes.get(id);
    return `${Math.round(node?.drawn ?? -1)} ${node?.stop}`;
  };

  it("steps down what's in a column's cells for the columns to fit", () => {
    // 300 + 100 + 300 doesn't fit 600: p closes, rather than the second
    // column being squeezed.
    const state = lay(
      start(grid([{ id: "c0" }, { id: "c1", minSize: 300 }]), 1000),
      600,
    );
    expect(at(state, "p")).toBe("0 closed");
    expect(Number(at(state, "c1").split(" ")[0])).toBeGreaterThanOrEqual(300);
  });

  it("fits a call on a column with what its cells need stepped down", () => {
    // Widening the second column to 500 closes p, in the first: the
    // columns become 200 and 500, rather than stay as they were.
    const options = grid([
      { id: "c0" },
      {
        id: "c1",
        defaultSize: 200,
        minSize: 100,
        keepSize: "yield-first",
      },
    ]);
    const state = lay(lay(start(options, 1000), 700), 700);
    const widened = lay(
      setChildSize(state, "c1", { value: 500, unit: "px" }),
      700,
    );
    expect(at(widened, "p")).toBe("0 closed");
    expect(at(widened, "c1")).toBe("500 ");
  });

  it("protects the column a pane opened in, as it does a group", () => {
    // Opening p needs 400 of 450 in the first column: the second closes,
    // not the first (p's), though the first steps down earlier.
    const options = grid(
      [
        {
          id: "c0",
          priority: -1,
          stops: { closed: 0, open: { min: 100 } },
          yieldTo: { open: "closed" },
        },
        {
          id: "c1",
          stops: { closed: 0, open: { min: 200 } },
          yieldTo: { open: "closed" },
        },
      ],
      { defaultStop: "closed" },
    );
    const state = lay(start(options, 450), 450);
    expect(at(state, "p")).toBe("0 closed");
    const opened = lay(setChildStop(state, "p", "open", false), 450);
    expect(at(opened, "p")).toBe("300 open");
    expect(at(opened, "c1")).toBe("0 closed");
    expect(at(opened, "c0")).toMatch(/open$/);
  });
});

describe("stepping down many", () => {
  it("steps down as many as it takes", () => {
    // Seventy panes needing 10 each, and one that can't close, in 10.
    const children: LayoutChildOptions[] = [
      ...Array.from({ length: 70 }, (_, index) => ({
        id: `p${index}`,
        stops: { closed: 0, open: { min: 10 } },
        yieldTo: { open: "closed" },
      })),
      { id: "last", minSize: 10 },
    ];
    const state = lay(
      start(
        { layout: { id: "root", direction: "row", children }, elastic: false },
        1000,
      ),
      10,
    );
    const shown = panes(state);
    expect(shown.last).toBe("10 ");
    expect(
      Object.entries(shown).filter(
        ([id, pane]) => id !== "last" && pane !== "0 closed",
      ),
    ).toEqual([]);
  });
});

describe("the README's app shell", () => {
  // Kept in step with the README's recipe, "App shell that closes panes in
  // order": its options, its table of what's shown at each width, and the
  // protected child's example in "What a call protects".
  const closable = (min: number) => ({
    closed: { size: 0, onlyByName: true },
    open: { min },
  });
  const shell: LayoutOptions = {
    layout: {
      id: "shell",
      direction: "row",
      children: [
        {
          id: "sidebar",
          defaultSize: 300,
          keepSize: "yield-first",
          priority: 1,
          stops: closable(180),
        },
        {
          id: "main",
          direction: "column",
          children: [
            { id: "header", stops: { bar: 40 } },
            {
              id: "content",
              direction: "row",
              children: [
                {
                  id: "page",
                  defaultSize: 280,
                  keepSize: true,
                  stops: closable(280),
                  yieldTo: { open: "closed" },
                },
                {
                  id: "view",
                  direction: "row",
                  children: [
                    { id: "diagram", minSize: 240 },
                    {
                      id: "panel",
                      defaultSize: 340,
                      keepSize: "yield-first",
                      stops: closable(260),
                      yieldTo: { open: "closed" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    elastic: false,
  };
  /** The table's columns: each pane's size, or "closed". */
  const row = (state: LayoutState) => {
    const { sidebar, page, diagram, panel } = panes(state);
    const cell = (pane: string) =>
      pane.endsWith("closed") ? "closed" : Number(pane.split(" ")[0]);
    return [sidebar, page, diagram, panel].map(cell);
  };
  const table: Record<number, (number | "closed")[]> = {
    1400: [300, 280, 480, 340],
    1160: [300, 280, 240, 340],
    1100: [300, "closed", 460, 340],
    900: [300, "closed", 260, 340],
    800: [300, "closed", 240, 260],
    700: [300, "closed", 400, "closed"],
    500: [260, "closed", 240, "closed"],
    420: [180, "closed", 240, "closed"],
    400: [171, "closed", 229, "closed"],
  };
  const widths = Object.keys(table)
    .map(Number)
    .sort((a, b) => b - a);

  it("shows the table's rows narrowing, and again widening", () => {
    let state = start(shell, widths[0]);
    for (const width of widths) {
      state = lay(state, width);
      expect([width, ...row(state)]).toEqual([width, ...table[width]]);
      expect(getLayoutRendering(state).overflowing).toBe(width < 420);
    }
    for (const width of [...widths].reverse()) {
      state = lay(state, width);
      expect([width, ...row(state)]).toEqual([width, ...table[width]]);
    }
  });

  it("keeps the panel a call opened until the window narrows", () => {
    let state = lay(start(shell, 1400), 700);
    state = lay(setChildStop(state, "panel", "open"), 700);
    // The diagram at its minimum, the sidebar giving the rest, while its
    // 300 is kept.
    expect(row(state)).toEqual([200, "closed", 240, 260]);
    expect(own(own(state.places, "sidebar")?.sizes, "open")).toBe(300);
    state = lay(state, 900);
    expect(row(state)).toEqual([300, "closed", 260, 340]);
    // Narrower: no longer protected, the panel closes again.
    state = lay(state, 700);
    expect(row(state)).toEqual([300, "closed", 400, "closed"]);
  });

  it("brings back a page a call opened into less room than its size", () => {
    const wide = structuredClone(shell);
    const find = (node: object, id: string): Record<string, unknown> =>
      (node as { id: string }).id === id
        ? (node as Record<string, unknown>)
        : ((node as { children?: object[] }).children ?? [])
            .map((child) => find(child, id))
            .find(Boolean)!;
    find(wide.layout, "page").defaultSize = 336;
    let state = lay(start(wide, 1400), 1100);
    expect(row(state)).toEqual([300, "closed", 460, 340]);
    state = lay(setChildStop(state, "page", "open"), 1100);
    expect(row(state)).toEqual([300, 300, 240, 260]);
    // What's saved is the size it was opened at, not what fitted.
    expect(own(own(state.places, "page")?.sizes, "open")).toBe(336);
    // It takes the room back before the diagram grows.
    expect(row(lay(state, 1300))).toEqual([300, 336, 324, 340]);
    // A drag while it's squeezed is a choice, and is kept.
    const dragged = lay(
      endDrag(
        moveDrag(startDrag(state, [{ before: "page", after: "view" }]), -10, 0),
      ),
      1300,
    );
    expect(own(own(dragged.places, "page")?.sizes, "open")).toBe(290);
    expect(row(dragged)[1]).toBe(290);
    // Narrowed again, it steps down; widened, it's back at its size.
    state = lay(lay(state, 1100), 1400);
    expect(row(state)).toEqual([300, 336, 424, 340]);
  });

  it("has those keeping their size first give way for a call's child in another group", () => {
    let state = lay(start(shell, 1400), 1100);
    expect(row(state)).toEqual([300, "closed", 460, 340]);
    // The diagram at its minimum, the panel giving the rest: the page,
    // protected, steps down after it.
    state = lay(setChildStop(state, "page", "open"), 1100);
    expect(row(state)).toEqual([300, 280, 240, 280]);
    state = lay(state, 1150);
    expect(row(state)).toEqual([300, 280, 240, 330]);
    // Narrower: no longer protected, the page steps down again.
    state = lay(state, 1100);
    expect(row(state)).toEqual([300, "closed", 460, 340]);
  });
});
