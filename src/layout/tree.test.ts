import { describe, expect, it, vi } from "vitest";

import { groupSpace, sizes } from "../../testing/layout.js";
import { resetWarnings } from "../foundation/warn.js";
import {
  type LayoutOptions,
  type LayoutState,
  createLayoutState,
  parseLayoutOptions,
} from "./layout-config.js";
import {
  endDrag,
  measure,
  moveDrag,
  resetToDefaults,
  setChildStop,
  setConfig,
  startDrag,
} from "./layout-model.js";
import { getLayoutRendering } from "./layout-rendering.js";
import {
  type GroupNode,
  type LayoutChildOptions,
  type LayoutGroupOptions,
  type LayoutNestedGroupOptions,
  dragCursor,
  groupBetween,
  parseTree,
  shareSpace,
} from "./tree.js";

/** files | work, where work is editor over terminal. */
const ide: LayoutOptions & { layout: LayoutGroupOptions } = {
  layout: {
    id: "root",
    direction: "row",
    children: [
      {
        id: "files",
        defaultSize: 240,
        stops: { closed: 0, open: { min: 180 } },
      },
      {
        id: "work",
        direction: "column",
        stops: { strip: 40, open: { min: 300 } },
        children: [
          { id: "editor", minSize: 200 },
          {
            id: "terminal",
            defaultSize: 200,
            stops: { closed: 0, open: { min: 100 } },
          },
        ],
      },
    ],
  },
  elastic: false,
};

/** The IDE in a 1200×800 group; one separator in each group takes 1px. */
function create(options: LayoutOptions = ide): LayoutState {
  const state = createLayoutState(parseLayoutOptions(options));
  return measure(state, { root: groupSpace(1199), work: groupSpace(799, 1) });
}

describe("tree options", () => {
  it("reads nested groups from children with their own direction and children", () => {
    const root = parseTree(ide.layout) as GroupNode;
    expect(root.axis).toBe("horizontal");
    const work = root.children[1];
    expect(work).toMatchObject({ kind: "group", id: "work", axis: "vertical" });
    expect(groupBetween(root, "editor", "terminal")?.id).toBe("work");
    expect(groupBetween(root, "files", "work")?.id).toBe("root");
    expect(groupBetween(root, "files", "editor")).toBeNull();
  });

  it("rejects duplicate ids anywhere in the tree", () => {
    expect(() =>
      parseTree({
        id: "root",
        direction: "row",
        children: [
          { id: "a" },
          { id: "b", direction: "column", children: [{ id: "a" }] },
        ],
      }),
    ).toThrow(/Two parts of the layout have the id "a"/);
    expect(() =>
      parseTree({ id: "a", direction: "row", children: [{ id: "a" }] }),
    ).toThrow(/Two parts of the layout have the id "a"/);
  });
});

describe("laying out a tree", () => {
  it("lays every group out in its own space", () => {
    expect(sizes(create())).toEqual({
      files: 240,
      work: 959,
      editor: 599,
      terminal: 200,
    });
  });

  it("waits for a group's own measurement before sizing its children", () => {
    const state = measure(createLayoutState(parseLayoutOptions(ide)), {
      root: groupSpace(1199),
    });
    expect(sizes(state)).toEqual({
      files: 240,
      work: 959,
      editor: null,
      terminal: null,
    });
  });

  it("lets a nested group's children set its minimum across the axis", () => {
    // work is vertical; its child "pair" runs horizontally with two 300px
    // minimums, so work can't be narrower than 600 (+1px separator).
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "side", defaultSize: 300 },
          {
            id: "work",
            direction: "column",
            children: [
              { id: "top" },
              {
                id: "pair",
                direction: "row",
                children: [
                  { id: "left", minSize: 300 },
                  { id: "right", minSize: 300 },
                ],
              },
            ],
          },
        ],
      },
      elastic: false,
    };
    let state = createLayoutState(parseLayoutOptions(options));
    state = measure(state, {
      root: groupSpace(1199),
      work: groupSpace(799, 1),
      pair: groupSpace(898, 1),
    });
    const dragged = moveDrag(
      startDrag(state, [{ before: "side", after: "work" }]),
      500,
      0,
    );
    expect(sizes(dragged).work).toBe(601);
  });

  it("adds up a same-direction nested group's children and overhead", () => {
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 300 },
          {
            id: "inner",
            direction: "row",
            children: [
              { id: "b", minSize: 200 },
              { id: "c", minSize: 200 },
            ],
          },
        ],
      },
      elastic: false,
    };
    let state = createLayoutState(parseLayoutOptions(options));
    state = measure(state, {
      root: groupSpace(1000),
      inner: groupSpace(690, 10),
    });
    const dragged = moveDrag(
      startDrag(state, [{ before: "a", after: "inner" }]),
      600,
      0,
    );
    expect(sizes(dragged).inner).toBe(410);
  });

  it("adds a cross-direction nested group's padding across it", () => {
    // work is a column in a row: its minimum width is inner's (two 200s
    // and 10 of separators), plus its own 32 of padding across.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 300 },
          {
            id: "work",
            direction: "column",
            children: [
              {
                id: "inner",
                direction: "row",
                children: [
                  { id: "b", minSize: 200 },
                  { id: "c", minSize: 200 },
                ],
              },
              { id: "d" },
            ],
          },
        ],
      },
      elastic: false,
    };
    let state = createLayoutState(parseLayoutOptions(options));
    state = measure(state, {
      root: groupSpace(1000),
      work: groupSpace(799, 1, 32),
      inner: groupSpace(658, 10),
    });
    const dragged = moveDrag(
      startDrag(state, [{ before: "a", after: "work" }]),
      600,
      0,
    );
    expect(sizes(dragged).work).toBe(442);
  });

  it("counts a child at a point at that point's size", () => {
    // inner runs the same way as its parent: its minimum is b parked at 50,
    // plus c's 200, plus 10 of separators.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 300 },
          {
            id: "inner",
            direction: "row",
            children: [
              {
                id: "b",
                stops: { parked: 50, open: { min: 200 } },
                defaultStop: "parked",
              },
              { id: "c", minSize: 200 },
            ],
          },
        ],
      },
      elastic: false,
    };
    let state = createLayoutState(parseLayoutOptions(options));
    state = measure(state, {
      root: groupSpace(1000),
      inner: groupSpace(690, 10),
    });
    const dragged = moveDrag(
      startDrag(state, [{ before: "a", after: "inner" }]),
      600,
      0,
    );
    expect(sizes(dragged).inner).toBe(260);
  });
});

describe("resetting a tree", () => {
  /** work (editors over terminal) | outline, in a 1000px row. */
  const options: LayoutOptions = {
    layout: {
      id: "root",
      direction: "row",
      children: [
        {
          id: "work",
          direction: "column",
          children: [
            {
              id: "editors",
              direction: "row",
              children: [
                { id: "editor", minSize: 240 },
                {
                  id: "preview",
                  defaultSize: "40%",
                  stops: { closed: 0, open: { min: 200 } },
                },
              ],
            },
            { id: "terminal" },
          ],
        },
        { id: "outline", defaultSize: 180, minSize: 140 },
      ],
    },
    elastic: false,
  };

  /** Measured as the browser would: work 819 wide, so editors has 818. */
  const start = () =>
    measure(createLayoutState(parseLayoutOptions(options)), {
      root: groupSpace(999),
      work: groupSpace(799, 1),
      editors: groupSpace(818, 1),
    });

  /**
   * Drags the outline as wide as it goes (work stops at what editors
   * needs), then measures editors at its new width.
   */
  function widenOutline(state: LayoutState): LayoutState {
    const dragged = endDrag(
      moveDrag(
        startDrag(state, [{ before: "work", after: "outline" }]),
        -1000,
        0,
      ),
    );
    const work = sizes(dragged).work!;
    return measure(dragged, { editors: groupSpace(work - 1, 1) });
  }

  it("lays out a nested group in the space it's about to have", () => {
    expect(sizes(start()).preview).toBeCloseTo(327.2);
    const narrow = widenOutline(start());
    expect(sizes(narrow)).toMatchObject({
      work: 441,
      editor: 240,
      preview: 200,
    });
    // Measured, editors is 440 wide, where 40% is below preview's minimum.
    // But the reset gives work its 819 back, so editors will have 818 again.
    const reset = resetToDefaults(narrow);
    expect(sizes(reset).work).toBe(819);
    expect(sizes(reset).preview).toBeCloseTo(327.2);
  });

  it("doesn't leave a closed child closed for lack of room", () => {
    const narrow = widenOutline(setChildStop(start(), "preview", "closed"));
    // Measured, editors is 240 wide: 40% is nearer closed than open.
    expect(sizes(narrow)).toMatchObject({ work: 241, preview: 0 });
    const reset = resetToDefaults(narrow);
    expect(getLayoutRendering(reset).nodes.get("preview")?.stop).toBe("open");
    expect(sizes(reset).preview).toBeCloseTo(327.2);
  });
});

describe("separators that move the same space", () => {
  const inner = {
    id: "inner",
    direction: "row" as const,
    children: [{ id: "x" }, { id: "y" }],
  };

  it("include one in a group running across, in a grid's cell", () => {
    const grid = parseTree({
      id: "dash",
      columns: [{ id: "c1" }, { id: "c2" }],
      rows: [{ id: "r1" }],
      children: [
        {
          id: "col",
          column: "c1",
          row: "r1",
          direction: "column",
          children: [inner],
        },
        { id: "right", column: "c2", row: "r1" },
      ],
    });
    const outer = { before: "c1", after: "c2" };
    expect(shareSpace(grid, outer, { before: "x", after: "y" })).toBe(true);
  });
});

describe("drag cursors", () => {
  const root = parseLayoutOptions(ide).root;
  it("is the move cursor only for separators that run different ways", () => {
    expect(dragCursor(root, [{ before: "files", after: "work" }])).toBe(
      "col-resize",
    );
    expect(
      dragCursor(root, [
        { before: "files", after: "work" },
        { before: "editor", after: "terminal" },
      ]),
    ).toBe("move");
    // A pair that isn't neighbours drags nothing, so it doesn't count.
    expect(
      dragCursor(root, [
        { before: "editor", after: "terminal" },
        { before: "files", after: "terminal" },
      ]),
    ).toBe("row-resize");
  });
});

describe("children joining a tree", () => {
  it("sizes a nested group's newcomers for the space it's about to have", () => {
    const options = (extra: boolean): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 300 },
          {
            id: "inner",
            direction: "row",
            children: [
              { id: "b" },
              { id: "c" },
              ...(extra ? [{ id: "d", defaultSize: "50%" as const }] : []),
            ],
          },
          ...(extra ? [{ id: "z", defaultSize: 400 }] : []),
        ],
      },
      elastic: false,
    });
    const state = measure(
      createLayoutState(parseLayoutOptions(options(false))),
      {
        root: groupSpace(1000),
        inner: groupSpace(700),
      },
    );
    // z joins the root and d joins inner in the same change: inner is about
    // to shrink, so d's 50% is of what inner will have, not what it had.
    const joined = sizes(setConfig(state, parseLayoutOptions(options(true))));
    const inner = joined.b! + joined.c! + joined.d!;
    expect(inner).toBeCloseTo(joined.inner!);
    expect(joined.d).toBeCloseTo(inner / 2);
  });
});

describe("dragging in a tree", () => {
  it("moves a nested separator along its own axis", () => {
    const dragged = endDrag(
      moveDrag(
        startDrag(create(), [{ before: "editor", after: "terminal" }]),
        0,
        -100,
      ),
    );
    expect(sizes(dragged)).toEqual({
      files: 240,
      work: 959,
      editor: 499,
      terminal: 300,
    });
  });

  it("drags separators that meet together, each along its own axis", () => {
    const junction = startDrag(create(), [
      { before: "files", after: "work" },
      { before: "editor", after: "terminal" },
    ]);
    expect(getLayoutRendering(junction).dragging).toHaveLength(2);
    const moved = endDrag(moveDrag(junction, 60, -50));
    expect(sizes(moved)).toEqual({
      files: 300,
      work: 899,
      editor: 549,
      terminal: 250,
    });
  });

  it("drags only the grabbed one of two parallel separators in nested groups", () => {
    // preview at zero puts the editor/preview separator right next to the
    // work/outline one; both move widths, and outline's resizes work.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "work",
            direction: "column",
            children: [
              {
                id: "editors",
                direction: "row",
                children: [
                  { id: "editor" },
                  { id: "preview", stops: { closed: 0, open: { min: 200 } } },
                ],
              },
              { id: "terminal" },
            ],
          },
          { id: "outline", defaultSize: 200 },
        ],
      },
    };
    const state = measure(createLayoutState(parseLayoutOptions(options)), {
      root: groupSpace(1000, 1),
      work: groupSpace(799, 1),
      editors: groupSpace(799, 1),
    });
    const outlineFirst = startDrag(state, [
      { before: "work", after: "outline" },
      { before: "editor", after: "preview" },
    ]);
    expect(outlineFirst.drag?.separators.map((b) => b.group)).toEqual(["root"]);
    const previewFirst = startDrag(state, [
      { before: "editor", after: "preview" },
      { before: "work", after: "outline" },
    ]);
    expect(previewFirst.drag?.separators.map((b) => b.group)).toEqual([
      "editors",
    ]);
  });

  it("drags each group's separator only once", () => {
    const state = startDrag(create(), [
      { before: "files", after: "work" },
      { before: "files", after: "work" },
    ]);
    expect(state.drag?.separators).toHaveLength(1);
  });

  it("moves a whole nested group to a stop", () => {
    const strip = setChildStop(create(), "work", "strip");
    expect(sizes(strip).work).toBe(40);
    expect(getLayoutRendering(strip).nodes.get("work")?.stop).toBe("strip");
  });
});

describe("changing the tree", () => {
  it("treats an element moved into another group as joining it", () => {
    const [files, work] = ide.layout.children as [
      LayoutChildOptions,
      LayoutNestedGroupOptions,
    ];
    const moved: LayoutOptions = {
      ...ide,
      layout: {
        ...ide.layout,
        children: [
          files,
          {
            ...work,
            children: [
              { id: "editor", minSize: 200 },
              { id: "terminal", defaultSize: 200, minSize: 100 },
              { id: "outline", defaultSize: 150 },
            ],
          },
        ],
      },
    };
    const next = setConfig(create(), parseLayoutOptions(moved));
    const result = sizes(next);
    expect(result.outline).toBe(150);
    expect(
      (result.editor ?? 0) + (result.terminal ?? 0) + (result.outline ?? 0),
    ).toBeCloseTo(799);
  });
});

describe("development warnings", () => {
  it("warns about a defaultSize that would show, then jump", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      parseLayoutOptions({
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "files",
              defaultSize: 150,
              stops: { rail: 56, open: { min: 200 } },
            },
            // A defaultStop says where it starts: nothing to warn about.
            {
              id: "outline",
              defaultSize: 150,
              defaultStop: "open",
              stops: { rail: 56, open: { min: 200 } },
            },
          ],
        },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('"files" has defaultSize 150px'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
