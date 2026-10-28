import { describe, expect, it, vi } from "vitest";

import { groupSpace, layoutAt, sizes } from "../../testing/layout.js";
import type { SizeValue } from "../foundation/size.js";
import { endAnimation, startAnimation } from "../foundation/transition.js";
import { resetWarnings } from "../foundation/warn.js";
import {
  type LayoutOptions,
  type LayoutSnapshot,
  type LayoutState,
  createLayoutState,
  parseLayoutOptions,
} from "./layout-config.js";
import { holdContent } from "./layout-content.js";
import {
  allowsStop,
  applyKeyboard,
  cancelDrag,
  endDrag,
  measure,
  moveDrag,
  optionsCause,
  resetToDefaults,
  separatorAnswersKeys,
  setChildSize,
  setChildStop,
  setChildStops,
  setConfig,
  shownSizes,
  startDrag,
} from "./layout-model.js";
import {
  flexAllocation,
  getLayoutContentRendering,
  getLayoutRendering,
  playsTransition,
} from "./layout-rendering.js";
import {
  isLayoutSnapshot,
  restoreSnapshot,
  snapshotsEqual,
  toSnapshot,
} from "./layout-snapshot.js";
import { getLayoutView } from "./layout-view.js";
import { separatorMoves, separatorReach } from "./separators.js";
import {
  type LayoutElementOptions,
  type LayoutGroupOptions,
  type LayoutNestedGroupOptions,
  trackGroupId,
} from "./tree.js";

/** The root group's measurement. */
const space = (available: number) => ({ root: groupSpace(available) });

/** Every node's view, in tree order. */
const views = (state: LayoutState) => [
  ...getLayoutRendering(state).nodes.values(),
];

/** An element that can close: a point at 0 below its open range. */
const files: LayoutElementOptions = {
  id: "files",
  defaultSize: 240,
  stops: { closed: 0, open: { min: 180 } },
};
const editor: LayoutElementOptions = { id: "editor", minSize: 320 };
const preview: LayoutElementOptions = {
  id: "preview",
  defaultSize: "30%",
  minSize: 200,
};

const options: LayoutOptions & { layout: LayoutGroupOptions } = {
  layout: { id: "root", direction: "row", children: [files, editor, preview] },

  elastic: false,
};

function create(
  groupOptions: LayoutOptions = options,
  available = 1200,
): LayoutState {
  const state = createLayoutState(parseLayoutOptions(groupOptions));
  return measure(state, space(available));
}

const reconfigure = (state: LayoutState, groupOptions: LayoutOptions) =>
  setConfig(state, parseLayoutOptions(groupOptions));

/** The space a group was last given, by id. */
const available = (state: LayoutState, id: string) =>
  state.spaces[id]?.available;

describe("first layout", () => {
  it("resolves defaults against the space and shares the rest", () => {
    expect(sizes(create())).toEqual({ files: 240, editor: 600, preview: 360 });
  });

  it("shares space equally among elements without a default", () => {
    const state = create(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [{ id: "a" }, { id: "b" }, { id: "c" }],
        },
      },
      900,
    );
    expect(sizes(state)).toEqual({ a: 300, b: 300, c: 300 });
  });

  it("lets a maximum below the minimum win with wins: max", () => {
    const layout = (wins?: "max") =>
      create(
        {
          layout: {
            id: "root",
            direction: "row",
            children: [
              { id: "a", defaultSize: 300, minSize: 300, maxSize: "20%", wins },
              { id: "b" },
            ],
          },
        },
        1000,
      );
    expect(sizes(layout())).toEqual({ a: 300, b: 700 });
    expect(sizes(layout("max"))).toEqual({ a: 200, b: 800 });
  });

  it("starts where the default size lands", () => {
    expect(views(create())[0].stop).toBe("open");
  });

  it("starts elements at their default stop", () => {
    const state = create({
      ...options,
      layout: {
        ...options.layout,
        children: [{ ...files, defaultStop: "closed" }, editor, preview],
      },
    });
    expect(sizes(state)).toEqual({ files: 0, editor: 840, preview: 360 });
    expect(views(state)[0].stop).toBe("closed");
  });

  it("starts an element without a default size in its roomiest stop", () => {
    const state = create({
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", stops: { closed: 0, open: { min: 100 } } },
          { id: "b" },
        ],
      },
    });
    expect(views(state)[0].stop).toBe("open");
    expect(sizes(state)).toEqual({ a: 600, b: 600 });
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parseLayoutOptions({
        layout: { id: "root", direction: "row", children: [editor, editor] },
      }),
    ).toThrow(/Two parts of the layout have the id "editor"/);
  });
});

describe("fills that share", () => {
  // Two panes centred by a fill either side; the group is 1000px.
  const pane = (id: string, defaultSize: number) => ({
    id,
    defaultSize,
    stops: { strip: 40, open: { min: 100 } },
  });
  const centred = (fill: "first" | "last"): LayoutOptions => ({
    layout: {
      id: "root",
      direction: "row",
      children: [
        { id: "left", fill },
        pane("a", 200),
        pane("b", 200),
        { id: "right", fill },
      ],
    },
    elastic: false,
  });
  /** Where the line after `id` is: the sizes before it, added up. */
  const lineAfter = (state: LayoutState, id: string) => {
    const nodes = [...getLayoutRendering(state).nodes.values()];
    const at = nodes.findIndex((node) => node.id === id);
    return nodes.slice(0, at + 1).reduce((sum, node) => sum + node.size!, 0);
  };
  const drag = (
    state: LayoutState,
    before: string,
    after: string,
    dx: number,
  ) => moveDrag(startDrag(state, [{ before, after }]), dx, 0);

  it("keeps the panes centred when an outer edge is dragged", () => {
    const state = create(centred("first"), 1000);
    expect(sizes(state)).toEqual({ left: 300, a: 200, b: 200, right: 300 });
    // b's far edge out by 10: both outer edges move 10, mirrored, so b
    // grows by 20, and the line stays under the pointer.
    const out = drag(state, "b", "right", 10);
    expect(sizes(out)).toEqual({ left: 290, a: 200, b: 220, right: 290 });
    expect(lineAfter(out, "b")).toBe(lineAfter(state, "b") + 10);
    // a's far edge, the same way round.
    expect(sizes(drag(state, "left", "a", -10))).toEqual({
      left: 290,
      a: 220,
      b: 200,
      right: 290,
    });
    // The keyboard too.
    expect(
      sizes(applyKeyboard(state, "b", "right", { kind: "move", delta: 10 })),
    ).toEqual({ left: 290, a: 200, b: 220, right: 290 });
  });

  it("leaves them be when the line between the panes moves", () => {
    const state = create(centred("first"), 1000);
    expect(sizes(drag(state, "a", "b", 50))).toEqual({
      left: 300,
      a: 250,
      b: 150,
      right: 300,
    });
  });

  it('opens a pane from all strips by its outer edge, with "last" fills', () => {
    const strips = setChildStop(
      setChildStop(create(centred("last"), 1000), "a", "strip"),
      "b",
      "strip",
    );
    expect(sizes(strips)).toEqual({ left: 460, a: 40, b: 40, right: 460 });
    // b's size moves twice as fast as the pointer, so it's past half its
    // gap (30 of 60) at 15px: then, beside "last" fills, it opens to the
    // whole row (they keep only what nothing else can take).
    expect(sizes(drag(strips, "b", "right", 10))).toEqual(sizes(strips));
    expect(sizes(drag(strips, "b", "right", 20))).toEqual({
      left: 0,
      a: 40,
      b: 960,
      right: 0,
    });
  });

  it("evens out fills a saved layout left off-centre", () => {
    const state = create(centred("first"), 1000);
    const saved = toSnapshot(state);
    const offCentre = {
      ...saved,
      children: {
        ...saved.children,
        left: { ...saved.children.left, sizes: { "": 1 } },
        right: { ...saved.children.right, sizes: { "": 599 } },
      },
    };
    expect(sizes(restoreSnapshot(state, offCentre))).toEqual({
      left: 300,
      a: 200,
      b: 200,
      right: 300,
    });
  });

  it("pins the line between two fills of a kind", () => {
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          pane("a", 200),
          { id: "x", fill: "first" },
          { id: "y", fill: "first" },
        ],
      },
    };
    const state = create(options, 1000);
    expect(separatorMoves(state, "x", "y")).toBe(false);
    expect(sizes(drag(state, "x", "y", 50))).toEqual(sizes(state));
  });
});

describe("children with padding", () => {
  const padded = (basisOffsets: Record<string, number> = {}) =>
    measure(createLayoutState(parseLayoutOptions(options)), {
      root: { ...groupSpace(1200), bases: { files: 48 }, basisOffsets },
    });
  const flexOf = (state: LayoutState, id: string) =>
    getLayoutRendering(state).nodes.get(id)?.flex;

  it("starts each at its own padding and border, and grows it by the rest", () => {
    // Flexbox starts files at its 48px of padding, so growing by 192 more
    // lands it at exactly 240.
    const state = padded();
    expect(sizes(state)).toEqual({ files: 240, editor: 600, preview: 360 });
    expect(flexOf(state, "files")).toBe("192 1 48px");
    expect(flexOf(state, "editor")).toBe("600 1 0px");
    // With content-box sizing, the basis leaves the padding out.
    expect(flexOf(padded({ files: 48 }), "files")).toBe("192 1 0px");
  });

  it("can't take a child below its padding", () => {
    const closed = setChildStop(padded(), "files", "closed");
    expect(flexOf(closed, "files")).toBe("0 1 48px");
    const contentBox = setChildStop(padded({ files: 48 }), "files", "closed");
    expect(flexOf(contentBox, "files")).toBe("0 1 0px");
  });
});

describe("priority", () => {
  const ranked = (priority?: number): LayoutOptions => ({
    layout: {
      id: "root",
      direction: "row",
      children: [
        { id: "side", defaultSize: 300, minSize: 100, priority },
        { id: "main", minSize: 200 },
      ],
    },
    elastic: false,
  });

  it("gives way by priority when the space shrinks, and undoes it", () => {
    const wide = create(ranked(-1), 1000);
    expect(sizes(wide)).toEqual({ side: 300, main: 700 });
    // The side gives first, down to its minimum; then the main.
    const narrow = measure(wide, space(600));
    expect(sizes(narrow)).toEqual({ side: 100, main: 500 });
    // Widening again brings both back.
    expect(sizes(measure(narrow, space(1000)))).toEqual({
      side: 300,
      main: 700,
    });
    // Without a priority, both give in proportion to their sizes.
    expect(sizes(measure(create(ranked(), 1000), space(600)))).toEqual({
      side: 180,
      main: 420,
    });
  });

  it("gives way by priority to a sibling opening", () => {
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 300, minSize: 100, priority: -1 },
          { id: "b", defaultSize: 300, minSize: 100 },
          {
            id: "c",
            defaultSize: 200,
            defaultStop: "closed",
            stops: { closed: 0, open: { min: 100 } },
          },
          { id: "d", minSize: 100, keepSize: true },
        ],
      },
      elastic: false,
    };
    const state = create(options, 1000);
    expect(sizes(state)).toEqual({ a: 300, b: 300, c: 0, d: 400 });
    // "a" gives the 200 "c" opens to, before "b" gives any.
    expect(sizes(setChildStop(state, "c", "open"))).toEqual({
      a: 100,
      b: 300,
      c: 200,
      d: 400,
    });
  });

  it("isn't for fills, and must be a number", () => {
    const withChild = (child: LayoutElementOptions) => () =>
      parseLayoutOptions({
        layout: {
          id: "root",
          direction: "row",
          children: [child, { id: "x" }],
        },
      });
    expect(
      withChild({ id: "spare", fill: "last", priority: 1 } as never),
    ).toThrow(/takes no `priority`/);
    expect(withChild({ id: "a", priority: Number.NaN })).toThrow(
      /priority NaN/,
    );
  });
});

describe("grow", () => {
  const growing = (grow?: number): LayoutOptions => ({
    layout: {
      id: "root",
      direction: "row",
      children: [
        { id: "side", defaultSize: 300, minSize: 100 },
        { id: "main", minSize: 200, grow },
      ],
    },
    elastic: false,
  });

  it("shares extra space by grow when the space grows, and undoes it", () => {
    const narrow = create(growing(1), 1000);
    expect(sizes(narrow)).toEqual({ side: 300, main: 700 });
    // Only the main has a grow: it takes all the extra.
    const wide = measure(narrow, space(1400));
    expect(sizes(wide)).toEqual({ side: 300, main: 1100 });
    expect(sizes(measure(wide, space(1000)))).toEqual({
      side: 300,
      main: 700,
    });
    // Without one, the extra goes in proportion to their sizes.
    expect(sizes(measure(create(growing(), 1000), space(1400)))).toEqual({
      side: 420,
      main: 980,
    });
  });

  it("shares the space a sibling closing frees by grow", () => {
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 200, minSize: 100 },
          {
            id: "b",
            defaultSize: 300,
            stops: { closed: 0, open: { min: 100 } },
          },
          { id: "c", minSize: 100, grow: 1 },
        ],
      },
      elastic: false,
    };
    expect(sizes(setChildStop(create(options, 1000), "b", "closed"))).toEqual({
      a: 200,
      b: 0,
      c: 800,
    });
  });

  it("isn't for fills, and must be a number of 0 or more", () => {
    const withChild = (child: LayoutElementOptions) => () =>
      parseLayoutOptions({
        layout: {
          id: "root",
          direction: "row",
          children: [child, { id: "x" }],
        },
      });
    expect(withChild({ id: "spare", fill: "last", grow: 1 } as never)).toThrow(
      /takes no `grow`/,
    );
    expect(withChild({ id: "a", grow: -1 })).toThrow(/grow -1/);
  });
});

describe("refusing overflow", () => {
  /** Three children of 300 minimum, the middle one closed, in 800. */
  const crowded = (
    refuseOverflow?: boolean,
    middle: Partial<LayoutElementOptions> = {},
  ): LayoutOptions => ({
    layout: {
      id: "root",
      direction: "row",
      refuseOverflow,
      children: [
        { id: "a", minSize: 300 },
        {
          id: "b",
          defaultSize: 300,
          defaultStop: "closed",
          stops: { closed: 0, open: { min: 300 } },
          ...middle,
        } as LayoutElementOptions,
        { id: "c", minSize: 300 },
      ],
    },
    elastic: false,
  });
  const shortfall = (state: LayoutState) =>
    getLayoutRendering(state).shortfalls.get("root");

  it("refuses an opening whose minimums don't fit, and says so first", () => {
    const state = create(crowded(true), 800);
    expect(sizes(state)).toEqual({ a: 400, b: 0, c: 400 });
    expect(allowsStop(state, "b", "open")).toBe(false);
    expect(allowsStop(state, "b", "closed", true)).toBe(false);
    expect(setChildStop(state, "b", "open")).toBe(state);
    // A size that lands it there likewise.
    expect(setChildSize(state, "b", { value: 300, unit: "px" })).toBe(state);
    // Without it, the minimums are squeezed past the space.
    const squeezed = setChildStop(create(crowded(), 800), "b", "open");
    expect(sizes(squeezed)).toEqual({ a: 300, b: 300, c: 300 });
    expect(shortfall(squeezed)).toBe(100);
    expect(allowsStop(create(crowded(), 800), "b", "open")).toBe(true);
  });

  it("lets a change through that fits, or doesn't make it worse", () => {
    // Room for it: it opens.
    const roomy = create(crowded(true), 1000);
    expect(allowsStop(roomy, "b", "open")).toBe(true);
    expect(sizes(setChildStop(roomy, "b", "open")).b).toBe(300);
    // Already overfull (it joined open: joining is never refused)...
    const overfull = create(crowded(true, { defaultStop: "open" }), 800);
    expect(shortfall(overfull)).toBe(100);
    // ...closing it helps, so it's allowed; growing a child can't make it
    // worse (the others are at their minimums: it gives way itself).
    expect(allowsStop(overfull, "b", "closed")).toBe(true);
    expect(sizes(setChildStop(overfull, "b", "closed")).b).toBe(0);
    const grown = setChildSize(overfull, "a", { value: 400, unit: "px" });
    expect(sizes(grown)).toEqual(sizes(overfull));
    expect(shortfall(grown)).toBe(100);
  });

  it("refuses resetting one child into overflow, not resetting all", () => {
    // "b" starts open by default, but the user closed it.
    const options = crowded(true, { defaultStop: "open" });
    const roomy = setChildStop(create(options, 1000), "b", "closed");
    const narrow = measure(roomy, space(800));
    expect(sizes(narrow).b).toBe(0);
    expect(resetToDefaults(narrow, "b")).toBe(narrow);
    expect(sizes(resetToDefaults(narrow)).b).toBe(300);
  });

  it("counts a nested group's minimums", () => {
    const state = create(
      {
        layout: {
          id: "root",
          direction: "row",
          refuseOverflow: true,
          children: [
            {
              id: "pair",
              direction: "row",
              children: [
                { id: "x", minSize: 200 },
                { id: "y", minSize: 200 },
              ],
            },
            {
              id: "z",
              defaultSize: 300,
              defaultStop: "closed",
              stops: { closed: 0, open: { min: 300 } },
            },
          ],
        },
        elastic: false,
      },
      600,
    );
    // The pair needs 400 of the 600: no room for "z" at 300.
    expect(allowsStop(state, "z", "open")).toBe(false);
    expect(setChildStop(state, "z", "open")).toBe(state);
  });

  it("answers the same through a drag, and anew when the space changes", () => {
    const state = create(crowded(true), 1000);
    expect(allowsStop(state, "b", "open")).toBe(true);
    const dragging = moveDrag(
      startDrag(state, [{ before: "a", after: "b" }]),
      -50,
      0,
    );
    expect(allowsStop(dragging, "b", "open")).toBe(true);
    expect(allowsStop(moveDrag(dragging, -80, 0), "b", "open")).toBe(true);
    // The window narrows mid-drag: no room for "b" at 300 now.
    const narrowed = measure(moveDrag(dragging, -80, 0), space(800));
    expect(narrowed.drag).not.toBeNull();
    expect(allowsStop(narrowed, "b", "open")).toBe(false);
  });

  it("can't tell before measuring, so goes by stops alone", () => {
    const unmeasured = createLayoutState(parseLayoutOptions(crowded(true)));
    expect(allowsStop(unmeasured, "b", "open")).toBe(true);
  });
});

describe("refusing overflow, through a drag", () => {
  const panes = (id: string) => [
    {
      id: `${id}1`,
      defaultStop: "open",
      stops: { closed: 0, open: { min: 400 } },
    },
    {
      id: `${id}2`,
      defaultStop: "closed",
      stops: { closed: 0, open: { min: 400 } },
    },
  ];

  it("answers anew when a grid's tracks are measured again", () => {
    const grid = measure(
      createLayoutState(
        parseLayoutOptions({
          layout: {
            id: "dash",
            refuseOverflow: true,
            columns: [...panes("c"), { id: "z" }],
            rows: [{ id: "r" }],
            children: [
              { id: "a", column: "c1", row: "r" },
              { id: "b", column: "c2", row: "r" },
              { id: "w", column: "z", row: "r" },
            ],
          },
          elastic: false,
        }),
      ),
      {
        [trackGroupId("dash", "columns")]: groupSpace(600),
        [trackGroupId("dash", "rows")]: groupSpace(400),
      },
    );
    const dragging = startDrag(grid, [{ before: "c1", after: "c2" }]);
    expect(allowsStop(dragging, "c2", "open")).toBe(false);
    const wider = measure(dragging, {
      [trackGroupId("dash", "columns")]: groupSpace(1000),
      [trackGroupId("dash", "rows")]: groupSpace(400),
    });
    expect(allowsStop(wider, "c2", "open")).toBe(true);
  });

  it("answers anew when a nested group running across is measured again", () => {
    const state = measure(
      createLayoutState(
        parseLayoutOptions({
          layout: {
            id: "root",
            direction: "column",
            children: [
              {
                id: "row",
                direction: "row",
                refuseOverflow: true,
                children: [...panes("p"), { id: "w" }],
              },
              { id: "bottom" },
            ],
          },
          elastic: false,
        }),
      ),
      { root: groupSpace(800), row: groupSpace(1000) },
    );
    const dragging = startDrag(state, [{ before: "row", after: "bottom" }]);
    expect(allowsStop(dragging, "p2", "open")).toBe(true);
    const narrow = measure(dragging, {
      root: groupSpace(800),
      row: groupSpace(600),
    });
    expect(allowsStop(narrow, "p2", "open")).toBe(false);
  });
});

describe("yielding", () => {
  /** A pane that can step down to a 60px compact stop, then close. */
  const pane = (
    id: string,
    extra: Partial<LayoutElementOptions> = {},
  ): LayoutElementOptions =>
    ({
      id,
      defaultSize: 300,
      stops: {
        closed: { size: 0, onlyByName: true },
        compact: 60,
        open: { min: 200 },
      },
      yieldTo: { open: "compact", compact: "closed" },
      ...extra,
    }) as LayoutElementOptions;
  const row = (
    children: LayoutElementOptions[],
    extra: Partial<LayoutGroupOptions> = {},
  ): LayoutOptions => ({
    layout: { id: "root", direction: "row", children, ...extra },
    elastic: false,
  });
  const panes = (extra: Partial<LayoutElementOptions> = {}) =>
    row([pane("a", extra), pane("b"), { id: "main", minSize: 300 }]);
  /** Each child's stop, and the stop chosen for it while stepped down. */
  const shown = (state: LayoutState) =>
    Object.fromEntries(
      views(state).map((view) => [
        view.id,
        view.yieldedFrom ? `${view.stop} (${view.yieldedFrom})` : view.stop,
      ]),
    );

  it("steps the last child down first, all its steps first, and back up", () => {
    const wide = create(panes(), 1000);
    expect(sizes(wide)).toEqual({ a: 300, b: 300, main: 400 });
    // The minimums (200 + 200 + 300) don't fit 600: "b" steps down.
    const narrow = measure(wide, space(600));
    expect(shown(narrow)).toEqual({
      a: "open",
      b: "compact (open)",
      main: "",
    });
    expect(sizes(narrow).b).toBe(60);
    // At 400, "b" takes its next step before "a" takes any.
    const narrower = measure(narrow, space(400));
    expect(shown(narrower)).toEqual({
      a: "compact (open)",
      b: "closed (open)",
      main: "",
    });
    // With room again, both go back, at the sizes they had.
    expect(sizes(measure(narrower, space(1000)))).toEqual({
      a: 300,
      b: 300,
      main: 400,
    });
    // Stepping down doesn't change what's chosen, or saved.
    expect(toSnapshot(narrower).children.b.stop).toBe("open");
  });

  it("goes by keepSize and priority before position", () => {
    const low = measure(create(panes({ priority: -1 }), 1000), space(600));
    expect(shown(low)).toMatchObject({ a: "compact (open)", b: "open" });
    const kept = row([
      pane("a"),
      pane("b", { keepSize: true }),
      { id: "main", minSize: 300 },
    ]);
    expect(shown(measure(create(kept, 1000), space(600)))).toMatchObject({
      a: "compact (open)",
      b: "open",
    });
  });

  it("keeps the stop chosen when laid out too narrow to show it", () => {
    const narrow = create(panes(), 600);
    expect(shown(narrow).b).toBe("compact (open)");
    expect(narrow.places.b).toMatchObject({
      stop: "open",
      sizes: { open: 300 },
    });
    expect(shown(measure(narrow, space(1000))).b).toBe("open");
  });

  it("keeps it through a change to a sibling", () => {
    const narrow = measure(create(panes(), 1000), space(600));
    const changed = setChildSize(narrow, "main", { value: 330, unit: "px" });
    expect(sizes(changed).main).toBe(330);
    expect(shown(changed).b).toBe("compact (open)");
    expect(changed.places.b).toMatchObject({
      stop: "open",
      sizes: { open: 300 },
    });
    expect(shown(measure(changed, space(1000))).b).toBe("open");
  });

  it("never steps down the last child that takes the space", () => {
    const state = create(
      row([
        {
          id: "a",
          stops: { compact: 60, open: { min: 240 } },
          yieldTo: { open: "compact" },
        },
        { id: "b", stops: { fixed: 300 } },
      ]),
      400,
    );
    expect(shown(state)).toEqual({ a: "open", b: "fixed" });
    expect(getLayoutRendering(state).overflowing).toBe(true);
  });

  it("makes room for a child opened into a full group, which goes last", () => {
    const closed = setChildStop(create(panes(), 1000), "b", "closed");
    const narrow = measure(closed, space(600));
    expect(shown(narrow)).toMatchObject({ a: "open", b: "closed" });
    // "b" opens; "a" steps down for it.
    const opened = setChildStop(narrow, "b", "open");
    expect(shown(opened)).toMatchObject({ a: "compact (open)", b: "open" });
    expect(opened.protectedChild).toBe("b");
    // Measured again where it is, nothing has changed: still protected.
    expect(measure(opened, space(600)).protectedChild).toBe("b");
    // A little wider, it stays protected: what "b" closed doesn't swap
    // back in for it.
    const wider = measure(opened, space(620));
    expect(wider.protectedChild).toBe("b");
    expect(shown(wider)).toMatchObject({ a: "compact (open)", b: "open" });
    // Narrower, the call has had its turn: the options' order decides
    // again, the last child ("b") stepping down first.
    const narrower = measure(opened, space(450));
    expect(narrower.protectedChild).toBe(null);
    expect(shown(narrower)).toMatchObject({
      a: "compact (open)",
      b: "closed (open)",
    });
  });

  it("ends a call's protection with new options", () => {
    const narrow = measure(create(panes(), 1000), space(600));
    const opened = setChildStop(narrow, "b", "open");
    expect(opened.protectedChild).toBe("b");
    const config = { ...opened.config, cascade: !opened.config.cascade };
    expect(setConfig(opened, config).protectedChild).toBe(null);
  });

  it("chooses a stepped-down child's stop, or shows the one chosen", () => {
    const narrow = measure(create(panes(), 1000), space(600));
    // Choosing where it's shown keeps it there with room.
    const chosen = setChildStop(narrow, "b", "compact");
    expect(chosen.places.b.stop).toBe("compact");
    expect(shown(measure(chosen, space(1000))).b).toBe("compact");
    // Asking for the stop chosen shows it: the others step down instead.
    expect(allowsStop(narrow, "b", "open")).toBe(true);
    const shownOpen = setChildStop(narrow, "b", "open");
    expect(shown(shownOpen)).toMatchObject({ a: "compact (open)", b: "open" });
    // At the size it had there (300), as much as fits: not squeezed (200).
    expect(sizes(shownOpen)).toMatchObject({ a: 60, b: 240, main: 300 });
    // Asked again, it's nothing new.
    expect(allowsStop(shownOpen, "b", "open")).toBe(false);
  });

  it("lets a child close when one stepped down can take its place", () => {
    const state = create(
      row([
        pane("a", { yieldTo: { open: "closed" } }),
        pane("b", { yieldTo: { open: "closed" } }),
        { id: "fixed", stops: { only: 300 } },
      ]),
      600,
    );
    expect(shown(state)).toEqual({
      a: "open",
      b: "closed (open)",
      fixed: "only",
    });
    // Closing "a" leaves "b" room to open, so something takes the space.
    expect(allowsStop(state, "a", "closed")).toBe(true);
    expect(shown(setChildStop(state, "a", "closed"))).toEqual({
      a: "closed",
      b: "open",
      fixed: "only",
    });
  });

  it("refuses overflow only once stepping down can't make room", () => {
    const closed = setChildStop(
      create(
        row([pane("a"), pane("b"), { id: "main", minSize: 300 }], {
          refuseOverflow: true,
        }),
        1000,
      ),
      "b",
      "closed",
    );
    const narrow = measure(closed, space(600));
    expect(allowsStop(narrow, "b", "open")).toBe(true);
    expect(shown(setChildStop(narrow, "b", "open"))).toMatchObject({
      a: "compact (open)",
      b: "open",
    });
    // At 350, even "a" closed leaves no room for "b" at 200.
    const narrower = measure(closed, space(350));
    expect(allowsStop(narrower, "b", "open")).toBe(false);
  });

  it("protects what reset(id) reset, and forgets it on a full reset", () => {
    const state = create(panes(), 1000);
    expect(resetToDefaults(state, "a").protectedChild).toBe("a");
    expect(resetToDefaults(state).protectedChild).toBe(null);
    const opened = setChildStop(state, "b", "compact");
    const removed = reconfigure(
      opened,
      row([pane("a"), { id: "main", minSize: 300 }]),
    );
    expect(removed.protectedChild).toBe(null);
  });

  it("keeps a call's choice when what it asked for has to step down", () => {
    // In 400, "a" can't open next to main (200 + 300): it shows compact.
    const state = create(
      row([pane("a", { defaultStop: "closed" }), { id: "main", minSize: 300 }]),
      400,
    );
    const asked = setChildStop(state, "a", "open");
    expect(shown(asked)).toEqual({ a: "compact (open)", main: "" });
    expect(sizes(asked)).toEqual({ a: 60, main: 340 });
    expect(asked.places.a.stop).toBe("open");
    expect(shown(measure(asked, space(1000))).a).toBe("open");
  });

  it("keeps siblings' sizes between them through a call", () => {
    const options = row([
      { id: "a", defaultSize: 500, minSize: 100 },
      { id: "b", defaultSize: 200, minSize: 100 },
      pane("y", {
        stops: { closed: { size: 0, onlyByName: true }, open: { min: 300 } },
        yieldTo: { open: "closed" },
      }),
      { id: "c", stops: { small: 10, large: 20 }, defaultStop: "small" },
    ]);
    const narrow = measure(create(options, 1010), space(500));
    expect(sizes(narrow)).toEqual({ a: 350, b: 140, y: 0, c: 10 });
    // "c" grows by 10: "a" and "b" give it in proportion, as they are.
    expect(sizes(setChildStop(narrow, "c", "large"))).toEqual({
      a: 342.86,
      b: 137.14,
      y: 0,
      c: 20,
    });
  });

  it("steps a locked child down only after the others, in every fit", () => {
    const options = row([
      pane("a", { defaultSize: 200 }),
      pane("b", { defaultSize: 200, locked: true }),
      {
        id: "main",
        defaultSize: 200,
        defaultStop: "narrow",
        stops: { narrow: { min: 100, max: 250 }, wide: { min: 300 } },
      },
    ]);
    const wide = setChildStop(create(options, 600), "main", "wide");
    expect(shown(wide)).toMatchObject({ a: "compact (open)", b: "open" });
    // Fitted again from what's stored, it comes out the same.
    expect(shown(measure(wide, space(601)))).toMatchObject({
      a: "compact (open)",
      b: "open",
    });
  });

  it("refuses reset(id) as it refuses setStop, where it can't be shown", () => {
    const options = row([pane("a"), { id: "main", minSize: 300 }], {
      refuseOverflow: true,
    });
    const closed = setChildStop(create(options, 1000), "a", "closed");
    const narrow = measure(closed, space(400));
    expect(setChildStop(narrow, "a", "open")).toBe(narrow);
    expect(resetToDefaults(narrow, "a")).toBe(narrow);
  });

  it("protects only a child that's there, and only on a change", () => {
    const narrow = measure(create(panes(), 1000), space(600));
    const opened = setChildStop(narrow, "b", "open");
    expect(opened.protectedChild).toBe("b");
    // No such child: nothing to protect.
    const missing = resetToDefaults(opened, "missing");
    expect(missing.protectedChild).toBe("b");
    expect(shown(missing)).toEqual(shown(opened));
    // A call that changes nothing doesn't move it.
    expect(setChildStop(opened, "main", "")).toBe(opened);
  });

  it("gives groups inside the space a restore gives them", () => {
    const group = (id: string): LayoutNestedGroupOptions => ({
      id,
      direction: "row",
      defaultSize: 150,
      stops: { compact: 60, open: { min: 200 } },
      yieldTo: { open: "compact" },
      children: [{ id: `${id}1` }],
    });
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [group("a"), group("b")],
      },
      elastic: false,
    };
    const spaces = (state: LayoutState) => {
      const nodes = getLayoutRendering(state).nodes;
      const inner = (id: string) => groupSpace(nodes.get(id)?.size ?? 0);
      return { root: groupSpace(300), a: inner("a"), b: inner("b") };
    };
    const measured = (state: LayoutState) =>
      measure(
        measure(state, spaces(state)),
        spaces(measure(state, spaces(state))),
      );
    const state = measured(createLayoutState(parseLayoutOptions(options)));
    expect(shown(state)).toMatchObject({ a: "open", b: "compact (open)" });
    const opened = setChildStop(state, "b", "open");
    expect(sizes(opened)).toMatchObject({ a: 60, b: 240 });
    // Restored, "b" isn't protected: it steps down again, "a" opens, and
    // each one's children get its space.
    const restored = restoreSnapshot(opened, toSnapshot(opened));
    expect(sizes(restored)).toMatchObject({ a: 240, b: 60 });
    expect(restored.spaces.a.available).toBe(240);
    expect(restored.spaces.b.available).toBe(60);
  });

  it("passes down the space a sibling that steps back up gets", () => {
    const group = (id: string): LayoutNestedGroupOptions => ({
      id,
      direction: "row",
      defaultSize: 150,
      stops: { compact: 60, open: { min: 200 } },
      yieldTo: { open: "compact" },
      children: [{ id: `${id}1` }],
    });
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [group("a"), group("b")],
      },
      elastic: false,
    };
    const spaces = (state: LayoutState) => {
      const nodes = getLayoutRendering(state).nodes;
      const inner = (id: string) => groupSpace(nodes.get(id)?.size ?? 0);
      return { root: groupSpace(300), a: inner("a"), b: inner("b") };
    };
    const measured = (state: LayoutState) => {
      const first = measure(state, spaces(state));
      return measure(first, spaces(first));
    };
    const state = measured(createLayoutState(parseLayoutOptions(options)));
    expect(sizes(state)).toMatchObject({ a: 240, b: 60 });
    // "a" to compact frees room: "b" steps back up, and its child gets it.
    const changed = setChildStop(state, "a", "compact");
    expect(sizes(changed)).toMatchObject({ a: 60, b: 240 });
    expect(changed.spaces.a.available).toBe(60);
    expect(changed.spaces.b.available).toBe(240);
  });

  it("says a child dragged out of its stepped-down stop isn't stepped down", () => {
    const state = create(
      row([pane("a", { defaultSize: 240 }), pane("b", { defaultSize: 240 })]),
      300,
    );
    expect(shown(state)).toEqual({ a: "open", b: "compact (open)" });
    const dragging = moveDrag(
      startDrag(state, [{ before: "a", after: "b" }]),
      -180,
      0,
    );
    expect(shown(dragging).b).toBe("open");
  });

  it("checks yieldTo's stops", () => {
    const parse = (child: LayoutElementOptions) => () =>
      parseLayoutOptions(row([child, { id: "x" }]));
    expect(parse(pane("a", { yieldTo: { open: "nope" } }))).toThrow(
      /Unknown stop "nope"/,
    );
    expect(
      parse(pane("a", { yieldTo: { open: "compact", compact: "open" } })),
    ).toThrow(/back round/);
    expect(parse({ id: "spare", fill: "last", yieldTo: {} } as never)).toThrow(
      /takes no `yieldTo`/,
    );
  });

  it("lets a key open a child stepped down to fit, which stays open", () => {
    const state = create(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "a",
              stops: { rail: 40, open: { min: 300 } },
              yieldTo: { open: "rail" },
            },
            { id: "b", stops: { closed: 0, open: { min: 400 } } },
          ],
        },
        elastic: false,
      },
      600,
    );
    expect(sizes(state)).toEqual({ a: 40, b: 560 });
    expect(sizes(applyKeyboard(state, "a", "b", { kind: "max" }))).toEqual({
      a: 600,
      b: 0,
    });
  });

  describe("a child stepped down to fit, through a drag", () => {
    // a wants 300 but steps down to its rail: b and c need the rest.
    const layout: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "a",
            locked: true,
            defaultStop: "open",
            stops: { rail: 40, open: { min: 300 } },
            yieldTo: { open: "rail" },
          },
          {
            id: "b",
            defaultStop: "open",
            stops: { strip: 30, open: { min: 250 } },
          },
          { id: "c", defaultSize: 100, minSize: 100, keepSize: true },
        ],
      },
      elastic: false,
    };
    const stopsOf = (state: LayoutState) =>
      Object.fromEntries(views(state).map((view) => [view.id, view.stop]));
    const released = () => {
      const state = create(layout, 600);
      expect(stopsOf(state).a).toBe("rail");
      // b to its strip: room enough for a, given to c.
      const dragged = moveDrag(
        startDrag(state, [{ before: "b", after: "c" }]),
        -400,
        0,
      );
      expect(stopsOf(dragged)).toMatchObject({ a: "rail", b: "strip" });
      const after = endDrag(dragged);
      expect(sizes(after)).toEqual(sizes(dragged));
      return after;
    };

    it("stays down on release, keeping what the drag showed", () => {
      const after = released();
      expect(views(after)[0].yieldedFrom).toBe("open");
      // An echo of the layout's own sizes doesn't let it up.
      expect(measure(after, space(600.3))).toMatchObject({
        heldDown: { a: "rail" },
      });
    });

    it("steps back up at a change from elsewhere", () => {
      expect(stopsOf(measure(released(), space(700))).a).toBe("open");
      expect(stopsOf(setChildStop(released(), "a", "open")).a).toBe("open");
    });

    it("lets a child held down step up when its own group's space changes", () => {
      const state = layoutAt(
        {
          layout: {
            id: "root",
            direction: "row",
            children: [
              {
                id: "g",
                direction: "row",
                defaultSize: 600,
                children: [
                  {
                    id: "a",
                    locked: true,
                    defaultStop: "open",
                    stops: { rail: 40, open: { min: 300 } },
                    yieldTo: { open: "rail" },
                  },
                  {
                    id: "b",
                    defaultStop: "open",
                    stops: { strip: 30, open: { min: 250 } },
                  },
                  { id: "c", defaultSize: 100, minSize: 100, keepSize: true },
                ],
              },
              {
                id: "other",
                direction: "column",
                children: [{ id: "x" }, { id: "y" }],
              },
            ],
          },
          elastic: false,
        },
        { root: 1000, g: 600, other: 800 },
      );
      // b to its strip, the room given to c: a stays on its rail.
      const released = endDrag(
        moveDrag(startDrag(state, [{ before: "b", after: "c" }]), -400, 0),
      );
      expect(released.heldDown).toEqual({ a: "rail" });
      // Another group's space changing gives a no room.
      expect(measure(released, { other: groupSpace(700) }).heldDown).toEqual({
        a: "rail",
      });
      expect(measure(released, { g: groupSpace(700) }).heldDown).toBeNull();
    });
  });
});

describe("children that keep their size", () => {
  it("are their size outright while another can take a change", () => {
    // So when the group's space changes from outside, the browser's own
    // layout gives the change to editor and preview, as the solver will.
    const kept = reconfigure(create(), {
      ...options,
      layout: {
        ...options.layout,
        children: [{ ...files, keepSize: true }, editor, preview],
      },
    });
    const flex = (state: LayoutState, id: string) =>
      getLayoutRendering(state).nodes.get(id)?.flex;
    expect(flex(kept, "files")).toBe("0 1 240px");
    expect(flex(kept, "editor")).toBe("600 1 0px");
    // The only one left to take the space: it shares like any other.
    const alone = reconfigure(create(), {
      ...options,
      layout: {
        ...options.layout,
        children: [
          { ...files, keepSize: true },
          { id: "side", stops: { closed: 0, open: {} }, defaultStop: "closed" },
        ],
      },
    });
    expect(sizes(alone)).toEqual({ files: 1200, side: 0 });
    expect(flex(alone, "files")).toBe("1200 1 0px");
  });

  it("count a fill as taking a change, but only one that can grow", () => {
    const row = (paneSize: number) =>
      create({
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "pane", defaultSize: paneSize, keepSize: true },
            { id: "spare", fill: "first" },
          ],
        },
      });
    const flex = (state: LayoutState, id: string) =>
      getLayoutRendering(state).nodes.get(id)?.flex;
    // The fill takes a change before the kept pane, and can grow.
    expect(sizes(row(400))).toEqual({ pane: 400, spare: 800 });
    expect(flex(row(400), "pane")).toBe("0 1 400px");
    // At 0, it has nothing to grow by: were the pane its size outright too,
    // nothing would take more space, and the browser would leave it empty.
    expect(sizes(row(1200))).toEqual({ pane: 1200, spare: 0 });
    expect(flex(row(1200), "pane")).toBe("1200 1 0px");
    // Growing by less than 1 in all, flexbox would hand out only that
    // fraction of new space (half a pixel's grow takes half of it).
    const sliver = create(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "pane", defaultSize: 200, keepSize: true },
            { id: "spare", fill: "first" },
          ],
        },
      },
      200.5,
    );
    expect(sizes(sliver)).toEqual({ pane: 200, spare: 0.5 });
    expect(flex(sliver, "pane")).toBe("200 1 0px");
  });
});

describe("children that keep their size, through calls", () => {
  const row = create({
    layout: {
      id: "root",
      direction: "row",
      children: [
        { id: "a", defaultSize: 300, minSize: 100, keepSize: true },
        { id: "b", minSize: 200 },
        {
          id: "c",
          defaultSize: 200,
          keepSize: true,
          stops: { closed: 0, open: { min: 100 } },
          defaultStop: "closed",
        },
      ],
    },
  });

  it("come back to their sizes once there's room for them", () => {
    // Narrowed, a gives way; opened, c takes the rest of a's room, and
    // gets less than it asks for. Neither is what anyone chose: widened,
    // both are their sizes again.
    let state = measure(row, space(450));
    expect(sizes(state)).toMatchObject({ a: 250, b: 200, c: 0 });
    state = setChildStop(state, "c", "open");
    expect(sizes(state)).toMatchObject({ a: 100, b: 200, c: 150 });
    state = measure(state, space(700));
    expect(sizes(state)).toMatchObject({ a: 300, b: 200, c: 200 });
  });

  it("keep a size the user chose while squeezed", () => {
    let state = setChildStop(measure(row, space(450)), "c", "open");
    // A drag or a key from what's shown is the user's choice.
    const dragged = endDrag(
      moveDrag(startDrag(state, [{ before: "a", after: "b" }]), 20, 0),
    );
    expect(sizes(measure(dragged, space(700)))).toMatchObject({ a: 120 });
    state = applyKeyboard(state, "a", "b", { kind: "move", delta: 20 });
    expect(sizes(measure(state, space(700)))).toMatchObject({ a: 120 });
  });
});

describe("children at a point", () => {
  it("are their size outright, out of the sharing", () => {
    // A rail at 48px: its basis, with nothing to grow by. The browser's
    // rounding of the others' shares can't move it a fraction.
    const railed = reconfigure(create(), {
      ...options,
      layout: {
        ...options.layout,
        children: [
          { id: "files", stops: { rail: 48, open: { min: 180 } } },
          ...options.layout.children.slice(1),
        ],
      },
    });
    const state = setChildStop(railed, "files", "rail");
    expect(getLayoutRendering(state).nodes.get("files")?.flex).toBe("0 1 48px");
    expect(getLayoutRendering(state).transition).toContain("flex-basis");
  });
});

describe("before measurement", () => {
  const unmeasured = createLayoutState(parseLayoutOptions(options));

  it("approximates the layout with flexbox", () => {
    const flex = views(unmeasured).map((element) => element.flex);
    expect(flex).toEqual(["0 1 240px", "1 1 0px", "0 1 30%"]);
  });

  it("uses a restored layout's proportions", () => {
    const at = (stop: string, size: number) => ({
      stop,
      sizes: { [stop]: size },
      lastRange: stop,
    });
    const restored = restoreSnapshot(unmeasured, {
      version: 3,
      children: {
        files: at("open", 300),
        editor: at("", 500),
        preview: at("", 400),
      },
    });
    expect(views(restored).map((element) => element.flex)).toEqual([
      "300 1 0px",
      "500 1 0px",
      "400 1 0px",
    ]);
  });

  it("can't be dragged yet", () => {
    expect(startDrag(unmeasured, [{ before: "files", after: "editor" }])).toBe(
      unmeasured,
    );
  });
});

describe("rendering", () => {
  it("renders flex-grow proportional to each size", () => {
    expect(views(create()).map((element) => element.flex)).toEqual([
      "240 1 0px",
      "600 1 0px",
      "360 1 0px",
    ]);
  });
});

describe("when the space changes", () => {
  it("keeps proportions, within limits", () => {
    expect(sizes(measure(create(), space(1800)))).toEqual({
      files: 360,
      editor: 900,
      preview: 540,
    });
  });

  it("keeps a share that a relative maximum doesn't reach", () => {
    const capped: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "main" },
          { id: "aside", defaultSize: "20%", maxSize: "25%" },
        ],
      },
    };
    const state = create(capped, 1400);
    expect(sizes(state)).toEqual({ main: 1120, aside: 280 });
    // 25% of 1000 is 250: the aside's 20% (200) is under it, so it's kept.
    // Kept to the maximum before fitting, it got 250 of every 1370: 182.5.
    expect(sizes(measure(state, space(1000)))).toEqual({
      main: 800,
      aside: 200,
    });
  });

  it("returns to the same layout when the space comes back", () => {
    const narrow = measure(create(), space(760));
    expect(sizes(narrow)).toEqual({
      files: 180,
      editor: 362.5,
      preview: 217.5,
    });
    expect(sizes(measure(narrow, space(1200)))).toEqual({
      files: 240,
      editor: 600,
      preview: 360,
    });
  });

  it("leaves fixed elements alone", () => {
    const fixed = create({
      ...options,
      layout: {
        ...options.layout,
        children: [{ ...files, keepSize: true }, editor, preview],
      },
    });
    expect(sizes(measure(fixed, space(1500))).files).toBe(240);
  });

  it("keeps the space exactly, however small the change", () => {
    const after = measure(measure(create(), space(767.3)), space(767));
    expect(after.spaces.root.available).toBe(767);
  });

  it("sets the browser's rounding aside while a change animates", () => {
    // Mid-animation, the children add up 1/64px differently with nothing
    // changed: taken as a change, it would retarget their transitions.
    const animating = startAnimation(setChildStop(create(), "files", "closed"));
    expect(measure(animating, space(1200 - 1 / 64))).toBe(animating);
    // Once it's done, it's kept exactly again.
    const done = endAnimation(animating);
    expect(measure(done, space(1200 - 1 / 64)).spaces.root.available).toBe(
      1200 - 1 / 64,
    );
  });

  it("sets the browser's rounding aside mid-drag too", () => {
    // Each move resizes the children, and they add up a fraction
    // differently: taken as a change, the group would be re-fitted on every
    // move, the fraction going to whichever child takes extra space.
    const dragging = moveDrag(
      startDrag(create(), [{ before: "files", after: "editor" }]),
      20,
      0,
    );
    expect(measure(dragging, space(1200 - 1 / 64))).toBe(dragging);
    // Released (and done animating), it's kept exactly again.
    const released = endAnimation(endDrag(dragging));
    expect(measure(released, space(1200 - 1 / 64)).spaces.root.available).toBe(
      1200 - 1 / 64,
    );
  });

  it("measures again only once a change has finished animating", () => {
    // What the change resizes already has the space it's going to; the
    // browser's measurements on the way would retarget it on every frame.
    const shut = startAnimation(setChildStop(create(), "files", "closed"));
    expect(measure(shut, space(1190))).toBe(shut);
    // Once it's done, a measurement is the window: no animation.
    const measured = measure(endAnimation(shut), space(1190));
    expect(measured.spaces.root.available).toBe(1190);
    expect(measured.animate).toBeNull();
  });

  it("carries a drag on in the new space when the window resizes", () => {
    // files dragged out to 600, then the window shrinks to 760: the drag
    // carries on from the layout fitted to 760, within the minimums.
    const dragging = moveDrag(
      startDrag(create(), [{ before: "files", after: "editor" }]),
      360,
      0,
    );
    const resized = measure(dragging, space(760));
    const total = Object.values(sizes(resized)).reduce(
      (sum, size) => (sum ?? 0) + (size ?? 0),
      0,
    );
    expect(total).toBe(760);
    expect(sizes(resized).editor).toBeGreaterThanOrEqual(320);
    expect(sizes(resized).preview).toBeGreaterThanOrEqual(200);
  });

  it("reports overflow when minimums don't fit", () => {
    const tight = measure(create(), space(600));
    expect(getLayoutRendering(tight).overflowing).toBe(true);
    expect(getLayoutRendering(create()).overflowing).toBe(false);
  });
});

describe("drawing a group past its space", () => {
  /** Two children at 200 in 300, with `bases` and `basisOffsets`. */
  const crowded = (
    bases: Record<string, number>,
    basisOffsets: Record<string, number>,
  ) =>
    getLayoutRendering(
      measure(
        createLayoutState(
          parseLayoutOptions({
            layout: {
              id: "root",
              direction: "row",
              children: [
                { id: "a", minSize: 200 },
                { id: "b", minSize: 200 },
              ],
            },
          }),
        ),
        { root: { ...groupSpace(300), bases, basisOffsets } },
      ),
    ).nodes;

  it("shares what's left past each one's padding and border, in proportion", () => {
    // a's 40px of padding is drawn whatever its share; the 260 left goes
    // 160 : 200, as the rest of their sizes.
    const nodes = crowded({ a: 40 }, { a: 40 });
    expect(nodes.get("a")?.drawn).toBeCloseTo(40 + (260 * 160) / 360);
    expect(nodes.get("b")?.drawn).toBeCloseTo((260 * 200) / 360);
    // As flexbox draws it (`content-box`: the basis leaves the padding out).
    expect(nodes.get("a")?.flex).toBe("160 1 0px");
    expect(nodes.get("b")?.flex).toBe("200 1 0px");
    // `border-box`: the basis has it.
    expect(crowded({ a: 40 }, {}).get("a")?.flex).toBe("160 1 40px");
  });

  it("lays content out at the size drawn, though its size is the one given", () => {
    expect(crowded({}, {}).get("a")).toMatchObject({
      size: 200,
      drawn: 150,
      contentSize: 150,
    });
  });
});

describe("drawing children as flexbox does", () => {
  const parts = (grow: number, basis: number, floor = 0) => ({
    grow,
    basis,
    floor,
  });

  it("lays out flex as the browser does", () => {
    // Each as Edge drew it (a 600px row; a's 40px of padding).
    expect(flexAllocation(600, [parts(0, 40, 40), parts(600, 0)])).toEqual([
      40, 560,
    ]);
    // A point beside it shrinks to make room for the padding.
    expect(flexAllocation(600, [parts(0, 40, 40), parts(0, 600)])).toEqual([
      40, 560,
    ]);
    expect(
      flexAllocation(600, [parts(0, 40, 40), parts(500, 0), parts(0, 100)]),
    ).toEqual([40, 460, 100]);
    // Grows adding up to less than 1 hand out only that fraction.
    expect(flexAllocation(600, [parts(0, 40, 40), parts(0.5, 0)])).toEqual([
      40, 280,
    ]);
    // Past its space: each from its padding.
    const [a, b] = flexAllocation(300, [parts(160, 40, 40), parts(200, 0)]);
    expect(a).toBeCloseTo(155.556);
    expect(b).toBeCloseTo(144.444);
  });

  it("draws a closed child's padding, and its sibling that much smaller", () => {
    const state = measure(
      createLayoutState(
        parseLayoutOptions({
          layout: {
            id: "root",
            direction: "row",
            children: [
              {
                id: "a",
                defaultStop: "closed",
                stops: { closed: 0, open: { min: 100 } },
              },
              { id: "b", direction: "row", children: [{ id: "c" }] },
            ],
          },
        }),
      ),
      { root: { ...groupSpace(600), bases: { a: 40 } }, b: groupSpace(560) },
    );
    const nodes = getLayoutRendering(state).nodes;
    expect(nodes.get("a")).toMatchObject({ size: 0, drawn: 40 });
    expect(nodes.get("b")).toMatchObject({
      size: 600,
      drawn: 560,
      contentSize: 560,
    });
    // And the group in b gets what b is drawn at.
    const opened = setChildStop(state, "a", "open");
    expect(opened.spaces.b?.available).toBeCloseTo(
      getLayoutRendering(opened).nodes.get("b")!.drawn!,
    );
  });

  it("lets the children of a group measured closed grow as it opens", () => {
    // A panel's group, measured while its panel was closed: 0 wide.
    const closed = layoutAt(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "g",
              direction: "row",
              children: [
                { id: "x", defaultSize: 300 },
                { id: "y", defaultSize: 300 },
              ],
            },
          ],
        },
        elastic: false,
      },
      { root: 600, g: 0 },
    );
    // Sharing what it gets: not fixed at their shares of nothing, which
    // its space (what they add up to) could never grow back from.
    for (const id of ["x", "y"]) {
      expect(getLayoutRendering(closed).nodes.get(id)?.flex).not.toMatch(
        /^0 0 /,
      );
    }
  });
});

describe("dragging a separator", () => {
  it("keeps stretching past a neighbour's far edge, beside a stop reached only by name", () => {
    const pane = (id: string): LayoutElementOptions => ({
      id,
      defaultSize: "50%",
      stops: { closed: { size: 0, onlyByName: true }, open: { min: 48 } },
    });
    const state = create(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [pane("a"), pane("b")],
        },
      },
      1000,
    );
    const dragging = startDrag(state, [{ before: "a", after: "b" }]);
    const at = (dx: number) => sizes(moveDrag(dragging, dx, 0)).a!;
    // Below its minimum, "a" stretches; past its far edge (500), where the
    // pointer asks for less than 0, it keeps on rather than snap to 48.
    expect(at(-480)).toBeLessThan(48);
    expect(at(-520)).toBeLessThan(at(-480));
    expect(at(-1000)).toBeLessThan(at(-520));
  });

  it("moves space between the neighbours and commits on release", () => {
    const dragging = moveDrag(
      startDrag(create(), [{ before: "files", after: "editor" }]),
      60,
      0,
    );
    expect(sizes(dragging)).toEqual({ files: 300, editor: 540, preview: 360 });
    expect(getLayoutRendering(dragging).dragging).toEqual([
      { before: "files", after: "editor" },
    ]);

    const released = endDrag(dragging);
    expect(sizes(released)).toEqual({ files: 300, editor: 540, preview: 360 });
    expect(released.places.files).toEqual({
      stop: "open",
      sizes: { open: 300 },
      lastRange: "open",
    });
  });

  it("mirrors the pointer in a group laid out right to left", () => {
    // Right to left, files is on the right: moving right shrinks it.
    const dragging = moveDrag(
      startDrag(
        create(),
        [{ before: "files", after: "editor" }],
        (group) => group === "root",
      ),
      60,
      0,
    );
    expect(sizes(dragging)).toEqual({ files: 180, editor: 660, preview: 360 });
    expect(sizes(endDrag(dragging))).toEqual({
      files: 180,
      editor: 660,
      preview: 360,
    });
  });

  it("reflowing once, holds the content from the drag's start", () => {
    const pairs = [{ before: "files", after: "editor" }];
    const dragging = moveDrag(
      startDrag(create({ ...options, reflow: "once" }), pairs),
      60,
      0,
    );
    const content = (state: LayoutState) =>
      getLayoutContentRendering(state).nodes.get("files")?.contentSize;
    expect(sizes(dragging).files).toBe(300);
    expect(content(dragging)).toBe(240);
    // Measured again mid-drag (the layout follows the pointer, so nested
    // groups do get new sizes), it still holds what it started with.
    expect(content(measure(dragging, space(1000)))).toBe(240);
    expect(content(endDrag(dragging))).toBe(300);
  });

  it("closes a squeezed child with its content at the size it had", () => {
    // Dragged to 300, then the window narrows: files is squeezed below the
    // 300 it remembers, and toggled closed from there.
    const pairs = [{ before: "files", after: "editor" }];
    const dragged = endDrag(moveDrag(startDrag(create(), pairs), 60, 0));
    expect(sizes(dragged).files).toBe(300);
    const squeezed = measure(dragged, space(700));
    const shown = sizes(squeezed).files!;
    expect(shown).toBeLessThan(300);
    const content = (state: LayoutState) =>
      getLayoutContentRendering(state).nodes.get("files")?.contentSize;
    expect(content(squeezed)).toBe(shown);
    // As the controller does, as the change starts animating.
    const closing = startAnimation(
      holdContent(squeezed, setChildStop(squeezed, "files", "closed")),
    );
    expect(sizes(closing).files).toBe(0);
    expect(content(closing)).toBe(shown);
    // A sibling it makes room for isn't held: it follows its edge.
    expect(getLayoutContentRendering(closing).nodes.get("editor")).toBe(
      getLayoutRendering(closing).nodes.get("editor"),
    );
    // At rest at 0, it's laid out at the size it reopens at.
    expect(content(endAnimation(closing))).toBe(300);
  });

  it("pulled open into a range that ends drags, goes there at the size it remembers", () => {
    const pulled = {
      ...options,
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            ...files,
            stops: { closed: 0, open: { min: 180, endsDrag: true } },
          },
          editor,
          preview,
        ],
      },
    } satisfies LayoutOptions;
    const pairs = [{ before: "files", after: "editor" }];
    const closed = setChildStop(
      setChildSize(create(pulled), "files", { value: 300, unit: "px" }),
      "files",
      "closed",
    );
    expect(sizes(closed).files).toBe(0);
    // Past the dividing point (90): it arrives in open, which ends the drag.
    const opened = moveDrag(startDrag(closed, pairs), 120, 0);
    expect(opened.drag).toBeNull();
    // As a toggle would have it.
    expect(sizes(opened)).toEqual(sizes(setChildStop(closed, "files", "open")));
    expect(sizes(opened).files).toBe(300);
    // A drag that starts there keeps where the pointer leaves it.
    const held = moveDrag(startDrag(opened, pairs), 20, 0);
    expect(held.drag).not.toBeNull();
    expect(sizes(endDrag(held)).files).toBe(320);
  });

  it("closes mid-animation with its content as it's shown", () => {
    // files on its way from 240 to 300, shown at 270, then closed: it
    // leaves at 270, not 300.
    const start = create();
    const growing = startAnimation(
      holdContent(
        start,
        setChildSize(start, "files", { value: 300, unit: "px" }),
      ),
    );
    expect(sizes(growing).files).toBe(300);
    const at = { files: 270, editor: 570, preview: 360 };
    const shown = shownSizes(growing, (id) => at[id as keyof typeof at]);
    expect(shown.get("files")).toBe(270);
    const closing = startAnimation(
      holdContent(growing, setChildStop(growing, "files", "closed"), shown),
    );
    expect(
      getLayoutContentRendering(closing).nodes.get("files")?.contentSize,
    ).toBe(270);
    // Measured sizes that don't fill the space aren't what's shown.
    expect(shownSizes(growing, () => 10).size).toBe(0);
  });

  it("starts a drag mid-animation from the sizes shown", () => {
    // files on its way from 240 to 300, say: caught at 200.
    const shown = { files: 200, editor: 600, preview: 400 };
    const at = (id: string) => shown[id as keyof typeof shown];
    const opening = startAnimation(create());
    const pairs = [{ before: "files", after: "editor" }];
    const caught = moveDrag(startDrag(opening, pairs, undefined, at), 10, 0);
    expect(sizes(caught)).toEqual({ files: 210, editor: 590, preview: 400 });
    // Shown sizes that don't fill the space aren't what's on screen.
    const stale = moveDrag(
      startDrag(opening, pairs, undefined, () => 10),
      0,
      0,
    );
    expect(sizes(stale)).toEqual({ files: 240, editor: 600, preview: 360 });
  });

  it("starts a drag caught between stops from the nearer one", () => {
    // Closing, caught at 100: between closed (0) and open (from 180). It
    // can't rest there, so it starts at open's edge, and what's dragged is
    // what's released.
    const shown = { files: 100, editor: 700, preview: 400 };
    const at = (id: string) => shown[id as keyof typeof shown];
    const pairs = [{ before: "files", after: "editor" }];
    const dragging = moveDrag(
      startDrag(startAnimation(create()), pairs, undefined, at),
      10,
      0,
    );
    expect(sizes(dragging).files).toBe(190);
    expect(sizes(endDrag(dragging))).toEqual(sizes(dragging));
    expect(endDrag(dragging).places.files?.sizes.open).toBe(190);
  });

  it("forgets the drag on cancel", () => {
    const cancelled = cancelDrag(
      moveDrag(
        startDrag(create(), [{ before: "files", after: "editor" }]),
        60,
        0,
      ),
    );
    expect(sizes(cancelled)).toEqual({ files: 240, editor: 600, preview: 360 });
  });

  it("lands an element in another stop past the gap's dividing point", () => {
    // files: closed at 0, open from 180; the dividing point is at 90 (a drag of
    // -150).
    const held = moveDrag(
      startDrag(create(), [{ before: "files", after: "editor" }]),
      -100,
      0,
    );
    expect(sizes(held).files).toBe(180);
    const shut = endDrag(
      moveDrag(
        startDrag(create(), [{ before: "files", after: "editor" }]),
        -150,
        0,
      ),
    );
    expect(sizes(shut)).toEqual({ files: 0, editor: 840, preview: 360 });
    expect(shut.places.files).toEqual({
      stop: "closed",
      sizes: { open: 240 },
      lastRange: "open",
      from: "open",
    });
  });

  it("only drags adjacent elements", () => {
    const state = create();
    expect(startDrag(state, [{ before: "files", after: "preview" }])).toBe(
      state,
    );
  });

  it("times children added as their own kind, and removes them at once", () => {
    const timed: LayoutOptions & { layout: LayoutGroupOptions } = {
      ...options,
      transition: { changes: { children: { duration: 900 } } },
    };
    const removed = reconfigure(create(timed), {
      ...timed,
      layout: { ...timed.layout, children: [files, editor] },
    });
    // The others easing into a removed child's space would be drawn off
    // their sizes meanwhile.
    expect(getLayoutRendering(removed).transition).toBeUndefined();
    const added = reconfigure(removed, timed);
    expect(getLayoutRendering(added).transition).toMatch(/^flex-grow 900ms /);
  });

  it("animates the release, not the drag or measurement", () => {
    const dragging = moveDrag(
      startDrag(create(), [{ before: "files", after: "editor" }]),
      60,
      0,
    );
    expect(getLayoutRendering(dragging).transition).toBeUndefined();
    expect(getLayoutRendering(endDrag(dragging)).transition).toMatch(
      /^flex-grow /,
    );
    expect(getLayoutRendering(create()).transition).toBeUndefined();
  });

  it("carries a drag on under limits or a lock that change as it goes", () => {
    const pair = (
      a: { maxSize?: number; locked?: boolean } = {},
    ): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", minSize: 100, ...a },
          { id: "b", minSize: 100 },
        ],
      },
      elastic: false,
    });
    for (const changed of [{ maxSize: 400 }, { locked: true }]) {
      const dragging = moveDrag(
        startDrag(create(pair(), 600), [{ before: "a", after: "b" }]),
        50,
        0,
      );
      const moved = moveDrag(reconfigure(dragging, pair(changed)), 150, 0);
      const limit = "locked" in changed ? 300 : 400;
      expect(sizes(moved).a).toBeLessThanOrEqual(limit);
      expect(sizes(endDrag(moved)).a).toBeLessThanOrEqual(limit);
    }
  });
});

describe("a change inside a nested group", () => {
  it("leaves the groups around it as they're shown", () => {
    // Found by the randomized tests. The root remembers its layout from a
    // wider window; at 1100 the column can't shrink (its row's minimums
    // add up to 418), so the other two take the whole shrink. Collapsing
    // y lowers the column's minimum: fitted again from what it remembered
    // for 1456, the column would shrink too, and a and c move.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a" },
          {
            id: "column",
            direction: "column",
            children: [
              {
                id: "row",
                direction: "row",
                children: [
                  { id: "x", minSize: 242 },
                  { id: "y", stops: { rail: 48, open: { min: 176 } } },
                ],
              },
              { id: "below" },
            ],
          },
          { id: "c" },
        ],
      },
      elastic: false,
    };
    const spaces = (state: LayoutState, width: number) => {
      const column = getLayoutRendering(state).nodes.get("column")?.size;
      return {
        root: groupSpace(width),
        column: groupSpace(600),
        ...(column != null && { row: groupSpace(column) }),
      };
    };
    const at = (state: LayoutState, width: number) =>
      measure(measure(state, spaces(state, width)), spaces(state, width));
    const wide = at(
      at(createLayoutState(parseLayoutOptions(options)), 1456),
      1456,
    );
    const narrow = at(wide, 1100);
    const before = sizes(narrow);
    expect(before.column).toBe(418);
    const collapsed = setChildStop(narrow, "y", "rail");
    expect(sizes(collapsed).y).toBe(48);
    expect(sizes(collapsed).a).toBe(before.a);
    expect(sizes(collapsed).column).toBe(418);
    expect(sizes(collapsed).c).toBe(before.c);
  });
});

describe("a change that needs more than its group has", () => {
  // g has 300, but a open needs 400 and b 100: the root gives g 500.
  const nested = (refuseOverflow: boolean): LayoutOptions => ({
    layout: {
      id: "root",
      direction: "row",
      children: [
        {
          id: "g",
          direction: "row",
          defaultSize: 300,
          refuseOverflow,
          children: [
            {
              id: "a",
              defaultStop: "closed",
              stops: { closed: 0, open: { min: 400 } },
            },
            { id: "b", minSize: 100 },
          ],
        },
        {
          id: "h",
          direction: "row",
          children: [
            { id: "c", defaultSize: 200, keepSize: true },
            { id: "d" },
          ],
        },
      ],
    },
    elastic: false,
  });
  const build = (refuseOverflow: boolean) =>
    measure(createLayoutState(parseLayoutOptions(nested(refuseOverflow))), {
      root: groupSpace(1000),
      g: groupSpace(300),
      h: groupSpace(700),
    });

  it("gives the groups around it the spaces they're about to have", () => {
    const opened = setChildStop(build(false), "a", "open");
    expect(sizes(opened)).toMatchObject({ g: 500, h: 500, a: 400, b: 100 });
    expect(opened.spaces.g?.available).toBe(500);
    expect(opened.spaces.h?.available).toBe(500);
    expect(sizes(opened).c! + sizes(opened).d!).toBe(500);
    expect(getLayoutRendering(opened).overflowing).toBe(false);
  });

  it("doesn't refuse it as overflowing when its parent can make room", () => {
    const state = build(true);
    expect(allowsStop(state, "a", "open")).toBe(true);
    expect(sizes(setChildStop(state, "a", "open")).a).toBe(400);
  });

  it("gives a group what a child's % minimum needs, once it's grown", () => {
    const nested = (refuseOverflow: boolean): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "g",
            direction: "row",
            defaultSize: 300,
            refuseOverflow,
            children: [
              {
                id: "a",
                defaultStop: "closed",
                stops: { closed: 0, open: { min: "50%" } },
              },
              { id: "b", minSize: 200 },
            ],
          },
          { id: "s" },
        ],
      },
      elastic: false,
    });
    const opened = setChildStop(
      layoutAt(nested(false), { root: 1000, g: 300 }),
      "a",
      "open",
    );
    expect(sizes(opened)).toMatchObject({ g: 400, a: 200, b: 200, s: 600 });
    expect(opened.spaces.g?.available).toBeCloseTo(400, 1);
    expect(getLayoutRendering(opened).overflowing).toBe(false);
    const refusing = layoutAt(nested(true), { root: 1000, g: 300 });
    expect(allowsStop(refusing, "a", "open")).toBe(true);
  });

  it("gives the groups around one their spaces when its limits change", () => {
    const options = (min: number): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "g",
            direction: "row",
            defaultSize: 300,
            children: [
              { id: "x", minSize: min },
              { id: "y", minSize: 100 },
            ],
          },
          { id: "s" },
        ],
      },
      elastic: false,
    });
    const next = reconfigure(
      layoutAt(options(100), { root: 600, g: 300 }),
      options(400),
    );
    expect(sizes(next)).toMatchObject({ g: 500, s: 100 });
    expect(next.spaces.g?.available).toBe(500);
    expect(getLayoutRendering(next).overflowing).toBe(false);
  });

  it("gives a group a 90% minimum needs, refusing overflow or not", () => {
    for (const refuseOverflow of [false, true]) {
      const state = layoutAt(
        {
          layout: {
            id: "root",
            direction: "row",
            children: [
              {
                id: "g",
                direction: "row",
                defaultSize: 300,
                refuseOverflow,
                children: [
                  {
                    id: "a",
                    defaultStop: "closed",
                    stops: { closed: 0, open: { min: "90%" } },
                  },
                  { id: "b", minSize: 50 },
                ],
              },
              { id: "s" },
            ],
          },
          elastic: false,
        },
        { root: 1500, g: 300 },
      );
      const opened = setChildStop(state, "a", "open");
      expect(opened.spaces.g?.available).toBeCloseTo(500, 1);
      expect(getLayoutRendering(opened).overflowing).toBe(false);
    }
  });

  it("gives a group whose child needs a share of it what it's drawn at", () => {
    // x's 99% is of inner's own space: inner needs nothing for it, and a
    // opens at its 50% of g, inner taking the rest.
    const state = layoutAt(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "g",
              direction: "row",
              defaultSize: 400,
              children: [
                {
                  id: "a",
                  stops: { closed: 60, open: { min: "50%" } },
                  defaultStop: "closed",
                },
                {
                  id: "inner",
                  direction: "row",
                  children: [{ id: "x", minSize: "99%" }],
                },
              ],
            },
            { id: "b" },
          ],
        },
        elastic: false,
      },
      { root: 800, g: 400, inner: 340 },
    );
    const opened = setChildStop(state, "a", "open");
    expect(sizes(opened)).toMatchObject({ g: 400, a: 200, inner: 200 });
    expect(available(opened, "g")).toBeCloseTo(400);
    expect(available(opened, "inner")).toBeCloseTo(200);
  });

  it("never gives a group less than nothing", () => {
    let state = layoutAt(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "g",
              direction: "row",
              defaultSize: 200,
              children: [
                {
                  id: "a",
                  stops: { closed: 0, open: { min: "50%" } },
                  defaultStop: "closed",
                },
                {
                  id: "y",
                  stops: { rail: 40, open: { min: 100 } },
                  yieldTo: { open: "rail" },
                },
                {
                  id: "inner",
                  direction: "row",
                  children: [{ id: "x", minSize: "80%" }],
                },
              ],
            },
            { id: "b" },
          ],
        },
        elastic: false,
      },
      { root: 1000, g: 200 },
    );
    state = measure(state, { inner: groupSpace(sizes(state).inner!) });
    const opened = setChildStop(state, "a", "open");
    for (const space of Object.values(opened.spaces)) {
      expect(space!.available).toBeGreaterThanOrEqual(0);
    }
    expect(available(opened, "g")).toBeCloseTo(200);
    expect(sizes(opened).a).toBeCloseTo(100);
  });
});

describe("a change around a nested group", () => {
  // a | column, the column holding row = x | column2, and column2 holding
  // row2 = p | q (40%): rows nested in rows two deep, through columns.
  const options: LayoutOptions = {
    layout: {
      id: "root",
      direction: "row",
      children: [
        { id: "a", defaultSize: 300, stops: { closed: 0, open: { min: 100 } } },
        {
          id: "column",
          direction: "column",
          children: [
            {
              id: "row",
              direction: "row",
              children: [
                { id: "x" },
                {
                  id: "column2",
                  direction: "column",
                  defaultSize: "50%",
                  children: [
                    {
                      id: "row2",
                      direction: "row",
                      children: [{ id: "p" }, { id: "q", defaultSize: "40%" }],
                    },
                    { id: "below2" },
                  ],
                },
              ],
            },
            { id: "below" },
          ],
        },
      ],
    },
    elastic: false,
  };
  /** Measured as the browser would: each row by the width it's drawn at. */
  const measured = (state: LayoutState) => {
    const size = (id: string) => getLayoutRendering(state).nodes.get(id)?.size;
    const column = size("column");
    const column2 = size("column2");
    return measure(state, {
      root: groupSpace(1000),
      column: groupSpace(600),
      column2: groupSpace(300),
      ...(column != null && { row: groupSpace(column) }),
      ...(column2 != null && { row2: groupSpace(column2) }),
    });
  };
  const open = () => {
    let state = createLayoutState(parseLayoutOptions(options));
    for (let pass = 0; pass < 4; pass++) state = measured(state);
    return state;
  };

  it("gives every group inside its new space at once, however deep", () => {
    // Closing a gives the column its 300 at once, and on down: row,
    // column2's half of it, and row2 in that, so q goes straight to its
    // size, not by way of every measurement the browser makes on the way.
    const before = open();
    expect(sizes(before).column).toBe(700);
    expect(sizes(before).q).toBe(140);
    const closed = setChildStop(before, "a", "closed");
    expect(closed.spaces.row?.available).toBe(1000);
    expect(closed.spaces.row2?.available).toBe(500);
    expect(sizes(closed).q).toBe(200);
  });

  it("does so for keys too", () => {
    // a 100 smaller: the column grows by 100, row2 by half of it.
    const keyed = applyKeyboard(open(), "a", "column", {
      kind: "move",
      delta: -100,
    });
    expect(sizes(keyed).column).toBe(800);
    expect(keyed.spaces.row2?.available).toBe(400);
    expect(sizes(keyed).q).toBe(160);
  });

  it("and through a drag, every frame, so they're laid out once a frame", () => {
    // a dragged 100 wider: the column is 600 at once, and the rows in it
    // with it (row2 is column2's half), rather than laid out by their old
    // sizes first and again once measured.
    const pairs = [{ before: "a", after: "column" }];
    const dragging = moveDrag(startDrag(open(), pairs), 100, 0);
    expect(sizes(dragging).column).toBe(600);
    expect(dragging.spaces.row?.available).toBe(600);
    expect(dragging.spaces.row2?.available).toBe(300);
    expect(sizes(dragging).q).toBe(120);
    // The browser's measurements then agree, and change nothing.
    expect(measured(dragging)).toBe(dragging);
    // On from there, and back: each move from what the last one showed.
    const further = moveDrag(dragging, 200, 0);
    expect(further.spaces.row2?.available).toBe(250);
    expect(moveDrag(further, 0, 0).spaces.row2?.available).toBe(350);
  });

  it("keeps every fraction of a pixel, however small each step", () => {
    // A drag a fifth of a pixel at a time: the rows follow every step,
    // not only those over half a pixel.
    let dragging = startDrag(open(), [{ before: "a", after: "column" }]);
    for (const dx of [0.2, 0.4, 0.6, 0.8, 1]) {
      dragging = moveDrag(dragging, dx, 0);
    }
    expect(dragging.spaces.row?.available).toBeCloseTo(699);
    expect(dragging.spaces.row2?.available).toBeCloseTo(349.5);
    // And from code, a fifth of a pixel at a time.
    let sized = open();
    for (const size of [300.2, 300.4, 300.6, 300.8, 301]) {
      sized = setChildSize(sized, "a", { value: size, unit: "px" });
    }
    expect(sized.spaces.row?.available).toBeCloseTo(699);
  });

  it("passes new options' changes down once, refitting parent and child", () => {
    // A child added to the root and one to inner, in one change. The
    // root's refit gives deep its new space, and inner's own mustn't take
    // inner's change off deep's again.
    const tree = (rootExtra: boolean): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 300 },
          {
            id: "inner",
            direction: "row",
            children: [
              { id: "b", defaultSize: 300 },
              {
                id: "deep",
                direction: "row",
                children: [{ id: "p" }, { id: "q" }],
              },
              ...(rootExtra ? [{ id: "y", defaultSize: 100 }] : []),
            ],
          },
          ...(rootExtra ? [{ id: "x", defaultSize: 300 }] : []),
        ],
      },
      elastic: false,
    });
    const measured = (state: LayoutState) => {
      const size = (id: string) =>
        getLayoutRendering(state).nodes.get(id)?.size;
      return measure(state, {
        root: groupSpace(900),
        ...(size("inner") != null && { inner: groupSpace(size("inner")!) }),
        ...(size("deep") != null && { deep: groupSpace(size("deep")!) }),
      });
    };
    let state = createLayoutState(parseLayoutOptions(tree(false)));
    for (let pass = 0; pass < 4; pass++) state = measured(state);
    expect(sizes(state)).toMatchObject({ inner: 600, deep: 300, p: 150 });
    const added = reconfigure(state, tree(true));
    expect(sizes(added)).toMatchObject({
      a: 200,
      inner: 400,
      x: 300,
      b: 150,
      deep: 150,
      y: 100,
      p: 75,
      q: 75,
    });
    expect(added.spaces.deep?.available).toBe(150);
  });

  it("gives the groups inside their space back when a change drops a drag", () => {
    // A 300 | 700 row, the 700 a row of b and c. Dragged 100 right, the
    // inner row is given 600; setSize on b drops the drag, so the outer
    // row goes back to 300 | 700, and b's 200 must be of 700, not of the
    // drag's 600, or measuring 700 would rescale it.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 300 },
          {
            id: "inner",
            direction: "row",
            children: [{ id: "b" }, { id: "c" }],
          },
        ],
      },
      elastic: false,
    };
    const measured = (state: LayoutState) =>
      measure(state, {
        root: groupSpace(1000),
        inner: groupSpace(getLayoutRendering(state).nodes.get("inner")!.size!),
      });
    let state = createLayoutState(parseLayoutOptions(options));
    for (let pass = 0; pass < 3; pass++) state = measured(state);
    const dragging = moveDrag(
      startDrag(state, [{ before: "a", after: "inner" }]),
      100,
      0,
    );
    expect(dragging.spaces.inner?.available).toBe(600);
    const sized = setChildSize(dragging, "b", { value: 200, unit: "px" });
    expect(sized.spaces.inner?.available).toBe(700);
    expect(sizes(sized)).toMatchObject({ a: 300, b: 200, c: 500 });
    expect(measured(sized)).toBe(sized);
    // Escape, and resetting, likewise.
    expect(cancelDrag(dragging).spaces.inner?.available).toBe(700);
    expect(resetToDefaults(dragging).spaces.inner?.available).toBe(700);

    // Restoring a snapshot gives the inner row the space it's restored to
    // at once: a setSize straight after is of that.
    const saved = toSnapshot(
      setChildSize(state, "a", { value: 600, unit: "px" }),
    );
    for (const from of [state, dragging]) {
      const restored = restoreSnapshot(from, saved);
      expect(restored.spaces.inner?.available).toBe(400);
      const next = setChildSize(restored, "b", { value: 100, unit: "px" });
      expect(sizes(next)).toMatchObject({ a: 600, b: 100, c: 300 });
      expect(measured(next)).toBe(next);
    }
  });

  it("starts from what's on screen when a change drops a drag", () => {
    // Mid-drag, a is 400 and the column 600, measured so; closing a gives
    // the column 1000, so row2 gets 500, not 500 less the drag.
    const pairs = [{ before: "a", after: "column" }];
    let dragging = moveDrag(startDrag(open(), pairs), 100, 0);
    for (let pass = 0; pass < 3; pass++) dragging = measured(dragging);
    expect(sizes(dragging).column).toBe(600);
    const closed = setChildStop(dragging, "a", "closed");
    expect(closed.spaces.row2?.available).toBe(500);
    expect(sizes(closed).q).toBe(200);
  });

  it("gives the groups inside a squeezed one their share, refusing for one that refuses", () => {
    const COLUMNS = trackGroupId("dash", "columns");
    const state = layoutAt(
      {
        layout: {
          id: "dash",
          columns: [
            { id: "left" },
            {
              id: "right",
              defaultStop: "normal",
              stops: { normal: { min: 0 }, wide: { min: 500 } },
            },
          ],
          rows: [{ id: "r" }],
          children: [
            {
              id: "g",
              column: "left",
              row: "r",
              direction: "row",
              refuseOverflow: true,
              children: [
                { id: "x", minSize: 150 },
                { id: "y", minSize: 150 },
              ],
            },
            { id: "w", column: "right", row: "r" },
          ],
        },
        elastic: false,
      },
      { [COLUMNS]: 600, [trackGroupId("dash", "rows")]: 400, g: 300 },
    );
    expect(setChildStop(state, "right", "wide")).toBe(state);
    // Not refusing: g is given what it's drawn at.
    const plain = layoutAt(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "g",
              direction: "row",
              children: [
                { id: "x", minSize: 150 },
                { id: "y", minSize: 150 },
              ],
            },
            {
              id: "right",
              defaultStop: "normal",
              stops: { normal: { min: 0 }, wide: { min: 500 } },
            },
          ],
        },
        elastic: false,
      },
      { root: 600, g: 300 },
    );
    const squeezedOut = setChildStop(plain, "right", "wide");
    expect(squeezedOut.spaces.g?.available).toBeCloseTo(225, 1);
    // Sharing the row in proportion to their sizes, 300 to 500.
    expect(getLayoutRendering(squeezedOut).nodes.get("g")?.flex).toBe(
      "300 1 0px",
    );
  });

  it("gives the groups inside a drag what it shows when options change", () => {
    const options = (b: Partial<LayoutElementOptions> = {}): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "g",
            direction: "row",
            children: [
              { id: "x", defaultSize: 100, keepSize: true },
              { id: "y" },
            ],
          },
          { id: "b", ...b },
        ],
      },
      elastic: false,
    });
    const dragging = moveDrag(
      startDrag(layoutAt(options(), { root: 600, g: 300 }), [
        { before: "g", after: "b" },
      ]),
      50,
      0,
    );
    expect(available(dragging, "g")).toBeCloseTo(350);
    // A limit that changes nothing here.
    const changed = setConfig(
      dragging,
      parseLayoutOptions(options({ minSize: 50 })),
    );
    expect(sizes(changed).g).toBeCloseTo(350);
    expect(available(changed, "g")).toBeCloseTo(350);
    expect(available(moveDrag(changed, 60, 0), "g")).toBeCloseTo(360);
  });
});

describe("releasing a junction across nested groups", () => {
  it("keeps what the drag showed, less the stretch, in the groups inside", () => {
    // Found by the randomized tests. a is stretched past its maximum, which
    // squeezes the nested row; saving the column's change had that row
    // remember its squeezed sizes, and share the stretch back out
    // differently once released.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", maxSize: 300 },
          {
            id: "nested",
            direction: "row",
            children: [
              // At their minimums: a squeeze comes from the column alone,
              // while space handed back is shared by all three.
              { id: "x", minSize: 100, defaultSize: 100 },
              { id: "y", minSize: 100, defaultSize: 100 },
              {
                id: "column",
                direction: "column",
                children: [{ id: "p" }, { id: "q" }],
              },
            ],
          },
        ],
      },
    };
    // Measured as the browser would: the nested row by its width.
    const measured = (state: LayoutState) => {
      let next = state;
      for (let pass = 0; pass < 3; pass++) {
        const width = getLayoutRendering(next).nodes.get("nested")?.size;
        next = measure(next, {
          root: groupSpace(1000),
          column: groupSpace(600),
          ...(width != null && { nested: groupSpace(width) }),
        });
      }
      return next;
    };
    const state = measured(createLayoutState(parseLayoutOptions(options)));
    const pairs = [
      { before: "a", after: "nested" },
      { before: "p", after: "q" },
    ];
    const dragging = measured(moveDrag(startDrag(state, pairs), 600, 50));
    expect(sizes(dragging).a).toBeGreaterThan(300);
    const shown = sizes(
      measured({ ...dragging, config: { ...dragging.config, elastic: null } }),
    );
    expect(sizes(measured(endDrag(dragging)))).toEqual(shown);
  });
});

describe("resetting one element", () => {
  it("puts it back at its default; its siblings make room", () => {
    const wider = setChildSize(create(), "files", { value: 400, unit: "px" });
    expect(sizes(wider).files).toBe(400);
    const reset = resetToDefaults(wider, "files");
    expect(sizes(reset).files).toBe(240);
    const total = Object.values(sizes(reset)).reduce((a, b) => a! + b!, 0);
    expect(total).toBeCloseTo(1200);
  });

  it("reopens a closed element at its default stop and size", () => {
    const shut = setChildStop(create(), "files", "closed");
    const reset = resetToDefaults(shut, "files");
    expect(getLayoutRendering(reset).nodes.get("files")).toMatchObject({
      size: 240,
      stop: "open",
    });
  });
});

describe("range size", () => {
  it("keeps a closed element's open size for its content", () => {
    const shut = setChildStop(create(), "files", "closed");
    expect(getLayoutRendering(shut).nodes.get("files")).toMatchObject({
      size: 0,
      contentSize: 240,
    });
  });
});

describe("animating and hiding", () => {
  it("animates closing an element, then hides it", () => {
    const state = create();
    const shut = setChildStop(state, "files", "closed");
    expect(playsTransition(state, shut)).toBe(true);
    expect(playsTransition(shut, setChildStop(shut, "files", "closed"))).toBe(
      false,
    );
    const hidden = (s: LayoutState) =>
      getLayoutRendering(s).nodes.get("files")?.hidden;
    expect(hidden(state)).toBe(false);
    expect(hidden(startAnimation(shut))).toBe(false);
    expect(getLayoutRendering(startAnimation(shut)).animating).toBe(true);
    expect(hidden(endAnimation(startAnimation(shut)))).toBe(true);
    // Its neighbours aren't hidden.
    expect(getLayoutRendering(shut).nodes.get("editor")?.hidden).toBe(false);
  });

  it("follows hideAtZero, an element's own over the group's", () => {
    const hidden = (options: LayoutOptions) =>
      getLayoutRendering(
        setChildStop(create(options), "files", "closed"),
      ).nodes.get("files")?.hidden;
    expect(hidden({ ...options, hideAtZero: false })).toBe(false);
    expect(
      hidden({
        ...options,
        hideAtZero: false,
        layout: {
          ...options.layout,
          children: [{ ...files, hideAtZero: true }, editor, preview],
        },
      }),
    ).toBe(true);
  });

  it("doesn't animate measurement", () => {
    const state = create();
    expect(playsTransition(state, measure(state, space(1000)))).toBe(false);
  });
});

describe("cascade", () => {
  it("drags only the two neighbours with cascade: false", () => {
    const drag = (cascade: boolean) =>
      sizes(
        endDrag(
          moveDrag(
            startDrag(create({ ...options, cascade }), [
              { before: "files", after: "editor" },
            ]),
            400,
            0,
          ),
        ),
      );
    // The editor can give 280 (to its 320 minimum); the preview the rest.
    expect(drag(true)).toEqual({ files: 640, editor: 320, preview: 240 });
    expect(drag(false)).toEqual({ files: 520, editor: 320, preview: 360 });
  });
});

describe("stops that end drags", () => {
  it("ends a drag when an element lands in one, committing the layout", () => {
    const ending: LayoutOptions = {
      ...options,
      layout: {
        ...options.layout,
        children: [
          {
            ...files,
            stops: { closed: { size: 0, endsDrag: true }, open: { min: 180 } },
          },
          editor,
          preview,
        ],
      },
    };
    const start = startDrag(create(ending), [
      { before: "files", after: "editor" },
    ]);
    const held = moveDrag(start, -50, 0);
    expect(held.drag).not.toBeNull();
    const shut = moveDrag(held, -150, 0);
    expect(shut.drag).toBeNull();
    expect(sizes(shut)).toEqual({ files: 0, editor: 840, preview: 360 });
    expect(shut.places.files?.stop).toBe("closed");
    expect(getLayoutRendering(shut).transition).toMatch(/^flex-grow /);
    expect(moveDrag(shut, 0, 0)).toBe(shut);
  });
});

describe("stops that end drags, passed through fast", () => {
  it("ends the drag at the stop however far one move jumps", () => {
    const railed: LayoutOptions = {
      ...options,
      layout: {
        ...options.layout,
        children: [
          {
            ...files,
            defaultStop: "closed",
            stops: {
              closed: 0,
              rail: { size: 48, endsDrag: true },
              open: { min: 180 },
            },
          },
          editor,
          preview,
        ],
      },
    };
    const start = startDrag(create(railed), [
      { before: "files", after: "editor" },
    ]);
    const opened = moveDrag(start, 300, 0);
    expect(opened.drag).toBeNull();
    expect(opened.places.files?.stop).toBe("rail");
    expect(sizes(opened).files).toBe(48);
  });

  it("and at one closer to the next than a step", () => {
    const close: LayoutOptions = {
      ...options,
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "a",
            defaultStop: "low",
            stops: { low: 100, mid: { size: 101, endsDrag: true }, high: 102 },
          },
          { id: "b" },
        ],
      },
    };
    const moved = moveDrag(
      startDrag(create(close), [{ before: "a", after: "b" }]),
      4,
      0,
    );
    expect(moved.drag).toBeNull();
    expect(moved.places.a?.stop).toBe("mid");
  });
});

describe("keyboard", () => {
  const move = (delta: number) => ({ kind: "move", delta }) as const;

  it("moves the separator", () => {
    expect(
      sizes(applyKeyboard(create(), "files", "editor", move(10))).files,
    ).toBe(250);
    expect(
      sizes(applyKeyboard(create(), "editor", "preview", move(-10))),
    ).toEqual({ files: 240, editor: 590, preview: 370 });
  });

  it("toggles with Enter like a drag: only across the separator", () => {
    const toggle = { kind: "toggle" } as const;
    const shut = applyKeyboard(create(), "files", "editor", toggle);
    // The editor takes files' 240; the preview, not next to it, keeps its.
    expect(sizes(shut)).toEqual({ files: 0, editor: 840, preview: 360 });
    expect(sizes(applyKeyboard(shut, "files", "editor", toggle))).toEqual({
      files: 240,
      editor: 600,
      preview: 360,
    });
  });

  it("jumps a neighbour holding at its stop's edge to its next stop", () => {
    const atMin = applyKeyboard(create(), "files", "editor", move(-60));
    expect(sizes(atMin).files).toBe(180);
    const shut = applyKeyboard(atMin, "files", "editor", move(-10));
    expect(views(shut)[0]).toMatchObject({ stop: "closed", size: 0 });
    // Nowhere further to go.
    expect(applyKeyboard(shut, "files", "editor", move(-10))).toBe(shut);
  });

  it("doesn't jump with keyboard.jump off", () => {
    const state = create({ ...options, keyboard: { jump: false } });
    const atMin = applyKeyboard(state, "files", "editor", move(-60));
    expect(applyKeyboard(atMin, "files", "editor", move(-10))).toBe(atMin);
  });

  it("toggles an element's enterToggles stop, or none", () => {
    const withFiles = (enterToggles: string | false) =>
      create({
        ...options,
        layout: {
          ...options.layout,
          children: [
            {
              ...files,
              stops: { closed: 0, rail: 48, open: { min: 180 } },
              enterToggles,
            },
            editor,
            preview,
          ],
        },
      });
    const enter = { kind: "toggle" } as const;
    const railed = applyKeyboard(withFiles("rail"), "files", "editor", enter);
    expect(views(railed)[0]).toMatchObject({ stop: "rail", size: 48 });
    const none = withFiles(false);
    expect(applyKeyboard(none, "files", "editor", enter)).toBe(none);
  });

  it("reaches the enterToggles stop, by name only or inside a range", () => {
    const pair = (stops: LayoutElementOptions["stops"]) =>
      create({
        ...options,
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "a",
              defaultSize: 240,
              defaultStop: "open",
              enterToggles: "closed",
              stops,
            },
            { id: "b" },
          ],
        },
      });
    const enter = { kind: "toggle" } as const;
    const byName = applyKeyboard(
      pair({ closed: { size: 0, onlyByName: true }, open: { min: 180 } }),
      "a",
      "b",
      enter,
    );
    expect(views(byName)[0]).toMatchObject({ stop: "closed", size: 0 });
    // A point inside the range: there, and back again.
    const inside = applyKeyboard(
      pair({ closed: 100, open: { min: 0 } }),
      "a",
      "b",
      enter,
    );
    expect(views(inside)[0]).toMatchObject({ stop: "closed", size: 100 });
    expect(views(applyKeyboard(inside, "a", "b", enter))[0]).toMatchObject({
      stop: "open",
      size: 240,
    });
  });

  it("goes to a stop's edge before another stop, a big step or not", () => {
    const narrow = (jump: boolean) =>
      create({
        ...options,
        keyboard: { jump },
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "a",
              defaultSize: 60,
              defaultStop: "open",
              stops: { closed: 0, open: { min: 40 } },
            },
            { id: "b" },
          ],
        },
      });
    for (const jump of [true, false]) {
      const edge = applyKeyboard(narrow(jump), "a", "b", move(-50));
      expect(views(edge)[0]).toMatchObject({ stop: "open", size: 40 });
    }
    const edge = applyKeyboard(narrow(false), "a", "b", move(-50));
    expect(applyKeyboard(edge, "a", "b", move(-50))).toBe(edge);
  });

  it("takes a fill centring the others to 0 with Home", () => {
    const centred = create(
      {
        ...options,
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "f1", fill: "first" },
            { id: "pane", defaultSize: 400 },
            { id: "f2", fill: "first" },
          ],
        },
      },
      600,
    );
    expect(sizes(centred)).toEqual({ f1: 100, pane: 400, f2: 100 });
    expect(separatorReach(centred, "f1", "pane")?.min).toBe(0);
    expect(
      sizes(applyKeyboard(centred, "f1", "pane", { kind: "min" })),
    ).toEqual({ f1: 0, pane: 600, f2: 0 });
  });

  it("leaves the layout alone when Home or End has nowhere to go", () => {
    const shut = setChildStop(create(), "files", "closed");
    expect(applyKeyboard(shut, "files", "editor", { kind: "min" })).toBe(shut);
  });

  it("takes the element before to its smallest and largest sizes", () => {
    expect(
      sizes(applyKeyboard(create(), "files", "editor", { kind: "min" })).files,
    ).toBe(0);
    // As far as the layout allows: past the editor's minimum, into the preview.
    expect(
      sizes(applyKeyboard(create(), "files", "editor", { kind: "max" })).files,
    ).toBe(680);
  });

  it("toggles the smallest stop of a neighbour that has one with Enter", () => {
    const shut = applyKeyboard(create(), "files", "editor", { kind: "toggle" });
    expect(sizes(shut).files).toBe(0);
    expect(
      sizes(applyKeyboard(shut, "files", "editor", { kind: "toggle" })).files,
    ).toBe(240);
    const neither = create();
    expect(
      applyKeyboard(neither, "editor", "preview", { kind: "toggle" }),
    ).toBe(neither);
  });

  it("refuses an Enter that would leave nothing taking the space", () => {
    const state = layoutAt(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "a",
              defaultSize: 300,
              defaultStop: "open",
              enterToggles: "preset",
              stops: { open: { min: 0 }, preset: 300 },
            },
            {
              id: "b",
              defaultStop: "rail",
              stops: { rail: 300, open: { min: 400 } },
            },
          ],
        },
        elastic: false,
      },
      { root: 600 },
    );
    expect(applyKeyboard(state, "a", "b", { kind: "toggle" })).toBe(state);
  });

  it("takes an arrow to a stop's edge past a neighbour that can't move", () => {
    for (const jump of [false, true]) {
      const state = layoutAt(
        {
          layout: {
            id: "root",
            direction: "row",
            children: [
              {
                id: "a",
                defaultSize: 120,
                stops: { closed: 0, open: { min: 100 } },
              },
              { id: "b", defaultSize: 100, minSize: 100, maxSize: 100 },
              { id: "c" },
            ],
          },
          keyboard: { jump },
          elastic: false,
        },
        { root: 600 },
      );
      const keyed = applyKeyboard(state, "a", "b", {
        kind: "move",
        delta: -100,
      });
      expect(sizes(keyed)).toEqual({ a: 100, b: 100, c: 400 });
    }
  });
});

describe("in code", () => {
  it("moves an element between stops, the others absorbing in proportion", () => {
    const shut = setChildStop(create(), "files", "closed");
    expect(sizes(shut)).toEqual({ files: 0, editor: 750, preview: 450 });
    expect(sizes(setChildStop(shut, "files", "open"))).toEqual({
      files: 240,
      editor: 600,
      preview: 360,
    });
  });

  it("toggles back to the last range", () => {
    const shut = setChildStop(create(), "files", "closed", true);
    expect(views(shut)[0].stop).toBe("closed");
    expect(sizes(setChildStop(shut, "files", "closed", true)).files).toBe(240);
  });

  it("rejects unknown stops", () => {
    expect(() => setChildStop(create(), "files", "rail")).toThrow(
      'Unknown stop "rail". Stops: "closed", "open".',
    );
  });

  it("sets an element's size within its limits", () => {
    expect(
      sizes(setChildSize(create(), "preview", { value: 50, unit: "%" })),
    ).toEqual({ files: 180, editor: 420, preview: 600 });
    // It lands like a drag: 100 is past the dividing point (90), so open's
    // edge.
    expect(
      sizes(setChildSize(create(), "files", { value: 100, unit: "px" })).files,
    ).toBe(180);
    const shut = setChildSize(create(), "files", { value: 50, unit: "px" });
    expect(views(shut)[0]).toMatchObject({ stop: "closed", size: 0 });
  });
});

describe("opening, closing and reordering elements", () => {
  it("adds an element at its size beside ones that keep their own", () => {
    // Joining is placing it: the kept ones make room, as for a reopening,
    // rather than all three sharing the shortfall.
    const row = (children: LayoutElementOptions[]) => ({
      layout: { id: "root", direction: "row" as const, children },
      elastic: false,
    });
    const a = { id: "a", defaultSize: 600, keepSize: true };
    const b = { id: "b", defaultSize: 600, keepSize: true };
    const added = reconfigure(
      create(row([a, b])),
      row([a, b, { id: "c", defaultSize: 300 }]),
    );
    expect(sizes(added)).toEqual({ a: 450, b: 450, c: 300 });

    // Two at once that can't both fit: once the kept one is at its
    // minimum, they share what's short in proportion to what they asked.
    const wide = { id: "a", defaultSize: 1200, minSize: 1000, keepSize: true };
    const both = reconfigure(
      create(row([wide])),
      row([wide, { id: "c", defaultSize: 300 }, { id: "d", defaultSize: 100 }]),
    );
    expect(sizes(both)).toEqual({ a: 1000, c: 150, d: 50 });

    // One coming back has its old size to come back at.
    const back = { id: "back", defaultSize: 400 };
    const three = create(
      row([{ ...a, defaultSize: 400 }, { ...b, defaultSize: 400 }, back]),
    );
    const gone = reconfigure(
      three,
      row([
        { ...a, defaultSize: 400 },
        { ...b, defaultSize: 400 },
      ]),
    );
    expect(sizes(gone)).toEqual({ a: 600, b: 600 });
    expect(sizes(reconfigure(gone, row([a, b, back])))).toEqual({
      a: 400,
      b: 400,
      back: 400,
    });

    // One coming back to a smaller space than it left, beside a newcomer:
    // its old 1000 is past its maximum now (50% of 600), so it asks for
    // 300, and the newcomer keeps its 200.
    const half = { id: "half", defaultSize: "50%", maxSize: "50%" } as const;
    const kept = { id: "kept", defaultSize: 1000, keepSize: true };
    const left = reconfigure(create(row([kept, half]), 2000), row([kept]));
    const smaller = measure(left, space(600));
    expect(sizes(smaller)).toEqual({ kept: 600 });
    expect(
      sizes(
        reconfigure(
          smaller,
          row([kept, half, { id: "new", defaultSize: 200 }]),
        ),
      ),
    ).toEqual({ kept: 100, half: 300, new: 200 });
  });

  it("reopens an element at its size beside one that keeps its own", () => {
    // Only the note can make room for the diagram, and it keeps its size,
    // so it gives last; the diagram mustn't give back what it asked for.
    const row = create(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "diagram",
              stops: {
                closed: { size: 0, onlyByName: true },
                open: { min: 320 },
              },
            },
            {
              id: "note",
              defaultSize: "40%",
              stops: { closed: 0, open: { min: 280 } },
              keepSize: true,
            },
          ],
        },
        elastic: false,
      },
      1100,
    );
    expect(sizes(row)).toEqual({ diagram: 660, note: 440 });
    const closed = setChildStop(row, "diagram", "closed");
    expect(sizes(closed)).toEqual({ diagram: 0, note: 1100 });
    const reopened = setChildStop(closed, "diagram", "open");
    expect(sizes(reopened)).toEqual({ diagram: 660, note: 440 });
    // Asking for more than the note can give: it goes to its minimum, and
    // only then does the diagram give way.
    const wide = setChildSize(reopened, "diagram", { value: 900, unit: "px" });
    expect(sizes(wide)).toEqual({ diagram: 820, note: 280 });
  });

  it("gives a closed element's space to the others", () => {
    const closed = reconfigure(create(), {
      ...options,
      layout: {
        ...options.layout,
        children: [{ ...files, keepSize: true }, editor],
      },
    });
    expect(sizes(closed)).toEqual({ files: 240, editor: 960 });
  });

  it("brings an element back at its old size", () => {
    const closed = reconfigure(create(), {
      ...options,
      layout: { ...options.layout, children: [files, editor] },
    });
    const reopened = reconfigure(closed, options);
    expect(sizes(reopened).preview).toBe(360);
  });

  it("makes room for a new element", () => {
    const added = reconfigure(create(), {
      ...options,
      layout: {
        ...options.layout,
        children: [
          ...options.layout.children,
          { id: "outline", defaultSize: 200, minSize: 150 },
        ],
      },
    });
    const result = sizes(added);
    expect(result.outline).toBe(200);
    expect(
      Object.values(result).reduce((sum, size) => sum! + size!, 0),
    ).toBeCloseTo(1200);
  });

  it("keeps sizes with their elements when reordered", () => {
    const reordered = reconfigure(create(), {
      ...options,
      layout: { ...options.layout, children: [preview, editor, files] },
    });
    expect(
      views(reordered).map((element) => [element.id, element.size]),
    ).toEqual([
      ["preview", 360],
      ["editor", 600],
      ["files", 240],
    ]);
  });

  it("cancels a drag when the elements change underneath it", () => {
    const dragging = moveDrag(
      startDrag(create(), [{ before: "files", after: "editor" }]),
      60,
      0,
    );
    expect(
      reconfigure(dragging, {
        ...options,
        layout: { ...options.layout, children: [files, editor] },
      }).drag,
    ).toBeNull();
  });

  it("reports children added or moved in a grid's cell as children", () => {
    const grid = (ids: string[]): LayoutOptions => ({
      layout: {
        id: "dash",
        columns: [{ id: "c1" }, { id: "c2" }],
        rows: [{ id: "r1" }],
        children: [
          {
            id: "cell",
            column: "c1",
            row: "r1",
            direction: "row",
            children: ids.map((id) => ({ id })),
          },
          { id: "w", column: "c2", row: "r1" },
        ],
      },
    });
    const cause = (from: string[], to: string[]) => {
      const before = createLayoutState(parseLayoutOptions(grid(from)));
      return optionsCause(
        before,
        setConfig(before, parseLayoutOptions(grid(to))),
      );
    };
    expect(cause(["p0", "p1"], ["p0", "p1", "p2"])).toBe("children");
    expect(cause(["p0", "p1"], ["p1", "p0"])).toBe("children");
    expect(cause(["p0", "p1"], ["p0", "p1"])).toBe("options");
  });
});

describe("toggling back", () => {
  it("goes back to the larger stop it came from, else its last range", () => {
    const railed = create({
      ...options,
      layout: {
        ...options.layout,
        children: [
          {
            ...files,
            stops: { hidden: 0, rail: 48, open: { min: 180 } },
          },
          editor,
          preview,
        ],
      },
    });
    const rail = setChildStop(railed, "files", "rail");
    const hidden = setChildStop(rail, "files", "hidden");
    const back = setChildStop(hidden, "files", "hidden", true);
    expect(back.places.files?.stop).toBe("rail");
    expect(setChildStop(back, "files", "rail", true).places.files?.stop).toBe(
      "open",
    );
  });
});

describe("snapshots", () => {
  it("round-trips the layout, including sizes in stops an element has left", () => {
    const changed = setChildStop(
      endDrag(
        moveDrag(
          startDrag(create(), [{ before: "files", after: "editor" }]),
          60,
          0,
        ),
      ),
      "files",
      "closed",
    );
    const snapshot = toSnapshot(changed);
    expect(snapshot.children.files).toEqual({
      stop: "closed",
      sizes: { open: 300 },
      lastRange: "open",
      from: "open",
    });
    const restored = restoreSnapshot(create(), snapshot);
    expect(sizes(restored)).toEqual(sizes(changed));
    expect(isLayoutSnapshot(snapshot)).toBe(true);
  });

  it("counts where a toggle goes back to as part of the snapshot", () => {
    const entry = { stop: "closed", sizes: { open: 300 }, lastRange: "open" };
    const withFrom = (from?: string) => ({
      version: 3 as const,
      children: { a: from ? { ...entry, from } : entry },
    });
    expect(snapshotsEqual(withFrom("open"), withFrom("open"))).toBe(true);
    expect(snapshotsEqual(withFrom("open"), withFrom("rail"))).toBe(false);
    expect(snapshotsEqual(withFrom(), withFrom("open"))).toBe(false);
  });

  const element = (entry: unknown) => ({ version: 3, children: { a: entry } });
  it.each([
    [{ version: 3, children: {} }, true],
    [element({ stop: "open", sizes: { open: 10 }, lastRange: "open" }), true],
    [element({ stop: "", sizes: {}, lastRange: null }), true],
    [{ version: 1, children: {} }, false],
    [element({ stop: null, sizes: {}, lastRange: null }), false],
    [element({ stop: "a", sizes: { a: -1 }, lastRange: null }), false],
    [element({ stop: "a", sizes: {}, lastRange: 3 }), false],
    [element({ stop: "a", sizes: {}, lastRange: null, from: "b" }), true],
    [element({ stop: "a", sizes: {}, lastRange: null, from: 3 }), false],
    [null, false],
  ])("validates %j", (value, valid) => {
    expect(isLayoutSnapshot(value)).toBe(valid);
  });
});

describe("a child that takes the space", () => {
  // Panes that shrink to a 40px strip; the group is 1000px.
  // (Sized ones: a fill takes no size options.)
  type Sized = Extract<LayoutElementOptions, { fill?: undefined }>;
  const pane = (id: string, extra: Partial<Sized> = {}): Sized => ({
    id,
    stops: { strip: 40, open: { min: 180 } },
    ...extra,
  });
  const panes = (...children: LayoutElementOptions[]): LayoutOptions => ({
    layout: { id: "root", direction: "row", children },
    elastic: false,
  });
  const stops = (state: LayoutState) => views(state).map((view) => view.stop);
  const three = panes(pane("a"), pane("b"), pane("c"));
  const lastOpen = setChildStop(
    setChildStop(create(three, 1000), "a", "strip"),
    "b",
    "strip",
  );

  it("lets a drag close the last one once it opens another", () => {
    // c takes the row. Dragging b|c right opens b; dragged on past half of
    // c's gap, c closes to its strip: b takes the row now.
    const drag = (state: LayoutState, before: string, dx: number) =>
      moveDrag(
        startDrag(state, [{ before, after: before === "b" ? "c" : "b" }]),
        dx,
        0,
      );
    expect(sizes(drag(lastOpen, "b", 700))).toEqual({ a: 40, b: 740, c: 220 });
    // At its minimum, c holds until the pointer passes half its gap (110).
    expect(sizes(drag(lastOpen, "b", 800))).toEqual({ a: 40, b: 780, c: 180 });
    expect(sizes(drag(lastOpen, "b", 850))).toEqual({ a: 40, b: 920, c: 40 });
    // The other way round: b takes the row, and c opens and closes it.
    const bOpen = setChildStop(
      setChildStop(lastOpen, "b", "open"),
      "c",
      "strip",
    );
    expect(sizes(bOpen)).toEqual({ a: 40, b: 920, c: 40 });
    expect(sizes(drag(bOpen, "b", -800))).toEqual({ a: 40, b: 180, c: 780 });
    expect(sizes(drag(bOpen, "b", -850))).toEqual({ a: 40, b: 40, c: 920 });
  });

  it("refuses to put the last one at a point, with a warning", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sizes(lastOpen)).toEqual({ a: 40, b: 40, c: 920 });
    expect(setChildStop(lastOpen, "c", "strip")).toBe(lastOpen);
    expect(setChildStop(lastOpen, "c", "strip", true)).toBe(lastOpen);
    expect(setChildSize(lastOpen, "c", { value: 40, unit: "px" })).toBe(
      lastOpen,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"c" stays where it is'),
    );
    warn.mockRestore();
  });

  it("counts a maximum of 100% as none: it can never stop a child", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = (max: SizeValue) =>
      create(
        {
          layout: {
            id: "root",
            direction: "row",
            children: [
              {
                id: "diagram",
                stops: {
                  closed: { size: 0, onlyByName: true },
                  open: { min: 320 },
                },
              },
              {
                id: "note",
                defaultSize: "40%",
                stops: { closed: 0, open: { min: 280, max } },
                keepSize: true,
              },
            ],
          },
          elastic: false,
        },
        1100,
      );
    // The note takes the row.
    expect(sizes(setChildStop(row("100%"), "diagram", "closed"))).toEqual({
      diagram: 0,
      note: 1100,
    });
    expect(warn).not.toHaveBeenCalled();
    // A maximum in pixels can stop it once the space grows, even one as
    // wide as the space now: refused, and the warning says why.
    const capped = row("1200px");
    expect(setChildStop(capped, "diagram", "closed")).toBe(capped);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"note" has a maximum'),
    );
    warn.mockRestore();
  });

  it("says beforehand which stops it would refuse", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // c is the last open one: it can't go to its strip, by either call.
    expect(allowsStop(lastOpen, "c", "strip")).toBe(false);
    expect(allowsStop(lastOpen, "c", "strip", true)).toBe(false);
    // Already there, setting it does nothing; nor does toggling it, with
    // nowhere it's been to go back to.
    expect(allowsStop(lastOpen, "c", "open")).toBe(false);
    expect(allowsStop(lastOpen, "c", "open", true)).toBe(false);
    // The others can open, and toggle back to their strips.
    expect(allowsStop(lastOpen, "a", "open")).toBe(true);
    expect(allowsStop(lastOpen, "a", "strip", true)).toBe(true);
    // With another open, c can go.
    expect(allowsStop(setChildStop(lastOpen, "a", "open"), "c", "strip")).toBe(
      true,
    );
    // No such child; and asking warns of nothing.
    expect(allowsStop(lastOpen, "nope", "strip")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    // Before it's measured too: the rule is about stops, not sizes.
    const unmeasured = createLayoutState(
      parseLayoutOptions(
        panes(
          pane("a", { defaultStop: "strip" }),
          pane("b", { defaultStop: "strip" }),
          pane("c"),
        ),
      ),
    );
    expect(allowsStop(unmeasured, "c", "strip")).toBe(false);
    expect(() => allowsStop(lastOpen, "c", "tiny")).toThrow();
    warn.mockRestore();
  });

  it("keeps a drag from snapping the last one to a point", () => {
    // Found by the randomized tests: b is the only child that can take
    // space; a, with a maximum, could absorb b's collapse, which left no
    // child to take space and reopened c on release.
    const capped = panes(
      { id: "a", stops: { strip: 55, open: { min: 167, max: 609 } } },
      pane("b"),
      { id: "c", minSize: 138, maxSize: 556 },
    );
    const state = setChildStop(create(capped, 881), "a", "open");
    const dragged = moveDrag(
      startDrag(state, [{ before: "a", after: "b" }]),
      600,
      0,
    );
    expect(stops(dragged)[1]).toBe("open");
    expect(sizes(dragged).b).toBe(180);
    expect(sizes(endDrag(dragged))).toEqual(sizes(dragged));
  });

  it("reopens one when removing children leaves none", () => {
    const opened = setChildStop(lastOpen, "a", "open");
    const shut = setChildStop(opened, "a", "strip");
    // a was open at its own size; c closes, a goes back to that size.
    const removed = reconfigure(shut, panes(pane("a"), pane("b")));
    expect(stops(removed)).toEqual(["strip", "open"]);
    expect(sizes(removed)).toEqual({ a: 40, b: 960 });
  });

  it("opens the last one that can, when the options start them all at points", () => {
    const strips = panes(
      pane("a", { defaultStop: "strip" }),
      pane("b", { defaultStop: "strip" }),
      pane("c", { defaultStop: "strip" }),
    );
    expect(stops(create(strips, 1000))).toEqual(["strip", "strip", "open"]);
    expect(sizes(create(strips, 1000))).toEqual({ a: 40, b: 40, c: 920 });
  });

  it("reopens one when a restored layout has them all at points", () => {
    const saved = {
      version: 3 as const,
      children: Object.fromEntries(
        ["a", "b", "c"].map((id) => [
          id,
          { stop: "strip", sizes: { open: 300 }, lastRange: "open" },
        ]),
      ),
    };
    const restored = restoreSnapshot(create(three, 1000), saved);
    expect(stops(restored)).toEqual(["strip", "strip", "open"]);
    expect(sizes(restored)).toEqual({ a: 40, b: 40, c: 920 });
  });

  it("doesn't apply where no child could take it to begin with", () => {
    // Every range has a maximum: the space beyond them is the app's choice
    // (see overflowing), not something a stop change broke.
    const capped = panes(
      pane("a", { stops: { strip: 40, open: { min: 180, max: 600 } } }),
      pane("b", { stops: { strip: 40, open: { min: 180, max: 600 } } }),
    );
    const state = create(capped, 1000);
    expect(stops(setChildStop(state, "a", "strip"))).toEqual(["strip", "open"]);
  });
});

describe("separators that can move", () => {
  it("include one between two children at their minimums, pushing others", () => {
    // b and c at their minimums: b|c can't resize b, but dragged left it
    // pushes b along, and a gives the space.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 680 },
          { id: "b", defaultSize: 160, minSize: 160 },
          { id: "c", defaultSize: 160, minSize: 160 },
        ],
      },
      elastic: false,
    };
    const squeezed = create(options, 1000);
    expect(sizes(squeezed)).toEqual({ a: 680, b: 160, c: 160 });
    expect(separatorMoves(squeezed, "b", "c")).toBe(true);
  });

  it("include one that only a short drag moves, snapping a hidden child open", () => {
    // Found by the randomized tests: c is hidden at 0 and opens to its
    // rail with a short drag; a long one asks it to open further than
    // anything can give, and does nothing.
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", defaultSize: 331, minSize: 130, maxSize: 672 },
          { id: "b", defaultSize: 233, minSize: 233 },
          {
            id: "c",
            defaultStop: "hidden",
            stops: {
              hidden: { size: 0, onlyByName: true },
              rail: 37,
              open: { min: 207 },
            },
          },
        ],
      },
      elastic: false,
    };
    const state = create(options, 564);
    expect(sizes(state)).toEqual({ a: 331, b: 233, c: 0 });
    expect(separatorMoves(state, "b", "c")).toBe(true);
  });

  it("exclude one between fixed sizes, with nothing beyond to give", () => {
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a", stops: { fixed: 100 } },
          { id: "b", stops: { fixed: 100 } },
          { id: "c" },
        ],
      },
    };
    expect(separatorMoves(create(options, 1000), "a", "b")).toBe(false);
  });

  it("calls a separator Enter works on enabled, though it can't be dragged", () => {
    const state = layoutAt(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "a",
              defaultStop: "open",
              enterToggles: "closed",
              stops: { closed: { size: 0, onlyByName: true }, open: 200 },
            },
            { id: "f", fill: "last" },
          ],
        },
        elastic: false,
      },
      { root: 1000 },
    );
    expect(separatorMoves(state, "a", "f")).toBe(false);
    expect(separatorAnswersKeys(state, "a", "f")).toBe(true);
  });
});

describe("stretching in a drag across stops", () => {
  it("snaps open crisply, and resists at the max and at the min on the way back", () => {
    const options: LayoutOptions = {
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a" },
          {
            id: "b",
            defaultStop: "strip",
            stops: {
              strip: { size: 40, elastic: true },
              open: { min: 180, max: 400 },
            },
          },
        ],
      },
    };
    const start = startDrag(create(options, 1000), [
      { before: "a", after: "b" },
    ]);
    const b = (state: LayoutState) => sizes(state).b!;
    // Past the gap's middle (110), short of open: at its edge.
    const out = moveDrag(start, -100, 0);
    expect(b(out)).toBe(180);
    // Pushed past the max: resistance.
    const far = moveDrag(out, -500, 0);
    expect(b(far)).toBeGreaterThan(400);
    // Back below the min, having been in open: resistance there too.
    const back = moveDrag(far, -130, 0);
    expect(b(back)).toBeLessThan(180);
    // The same pointer, never having reached open: no stretch.
    expect(b(moveDrag(start, -130, 0))).toBe(180);
  });
});

describe("fill", () => {
  // Panes that shrink to a 40px strip, and a fill; the group is 1000px.
  const pane = (id: string) => ({
    id,
    stops: { strip: 40, open: { min: 180 } },
  });
  const row = (...children: LayoutElementOptions[]): LayoutOptions => ({
    layout: { id: "root", direction: "row", children },
    elastic: false,
  });
  const shrinkAll = (state: LayoutState, ...ids: string[]) =>
    ids.reduce((current, id) => setChildStop(current, id, "strip"), state);

  describe('"last"', () => {
    const options = row(pane("a"), pane("b"), pane("c"), {
      id: "fill",
      fill: "last",
    });

    it("takes nothing while another child can grow", () => {
      const state = create(options, 1000);
      expect(sizes(state).fill).toBe(0);
      const wider = measure(state, space(1300));
      expect(sizes(wider).fill).toBe(0);
      expect(sizes(shrinkAll(state, "a", "b")).c).toBe(920);
    });

    it("resists a drag nothing can follow, all the way", () => {
      // Every pane a strip: dragging b|c left, b can't shrink and nothing
      // can give c room. Both strips give, with more resistance the further
      // the pointer goes, and never jump back.
      const stretchy = (id: string) => ({
        id,
        stops: { strip: { size: 40, elastic: true }, open: { min: 180 } },
      });
      const strips = shrinkAll(
        create(
          {
            ...row(stretchy("a"), stretchy("b"), stretchy("c"), {
              id: "fill",
              fill: "last",
            }),
            elastic: true,
          },
          1000,
        ),
        "a",
        "b",
        "c",
      );
      const drag = (dx: number) =>
        sizes(
          moveDrag(startDrag(strips, [{ before: "b", after: "c" }]), dx, 0),
        );
      let previous = 40;
      for (const dx of [-20, -100, -150, -200, -400]) {
        const { b, c } = drag(dx) as Record<string, number>;
        expect(b).toBeLessThan(previous);
        expect(c).toBeCloseTo(80 - b, 5);
        previous = b;
      }
    });

    describe("beside a child that keeps its size", () => {
      // a keeps its size; b and c reach 600 at most; the group is 1000px.
      const capped = (id: string) => ({
        id,
        defaultSize: 400,
        stops: { strip: 40, open: { min: 180, max: 600 } },
      });
      const keeping = row(
        { ...capped("a"), defaultSize: 200, keepSize: true },
        capped("b"),
        capped("c"),
        { id: "fill", fill: "last" },
      );

      it("takes what the others can't before it grows", () => {
        const state = create(keeping, 1000);
        expect(sizes(state)).toEqual({ a: 200, b: 400, c: 400, fill: 0 });
        // c goes to its strip: b takes what it can, and the fill the rest.
        expect(sizes(setChildStop(state, "c", "strip"))).toEqual({
          a: 200,
          b: 600,
          c: 40,
          fill: 160,
        });
        // The window widens past what b and c can take.
        expect(sizes(measure(state, space(1600)))).toEqual({
          a: 200,
          b: 600,
          c: 600,
          fill: 200,
        });
      });

      it("gives it back to a drag before the child keeping its size", () => {
        const state = setChildStop(create(keeping, 1000), "c", "strip");
        // Pulling c open: b gives a little, the fill the rest.
        const dragged = endDrag(
          moveDrag(startDrag(state, [{ before: "b", after: "c" }]), -100, 0),
        );
        expect(sizes(dragged)).toEqual({ a: 200, b: 575, c: 225, fill: 0 });
      });
    });

    it("takes the rest when every other child is at a point", () => {
      const strips = shrinkAll(create(options, 1000), "a", "b", "c");
      expect(sizes(strips)).toEqual({ a: 40, b: 40, c: 40, fill: 880 });
      // A child that opens takes it all back.
      expect(sizes(setChildStop(strips, "b", "open"))).toEqual({
        a: 40,
        b: 920,
        c: 40,
        fill: 0,
      });
    });

    it("gives it all to a child dragged open", () => {
      const strips = shrinkAll(create(options, 1000), "a", "b", "c");
      const dragged = moveDrag(
        startDrag(strips, [{ before: "a", after: "b" }]),
        200,
        0,
      );
      expect(sizes(dragged)).toEqual({ a: 920, b: 40, c: 40, fill: 0 });
      expect(sizes(endDrag(dragged))).toEqual(sizes(dragged));
    });

    it("lets a drag only collapse the child beside it, after the usual pull", () => {
      // c's edge against the fill can't resize c (the fill can't keep the
      // space while anything could use it), only collapse it: c holds, and
      // lands on its strip after the same pull as from its minimum, half the
      // gap from 180 to 40, however wide c is.
      const onlyC = shrinkAll(create(options, 1000), "a", "b");
      const pulled = (state: LayoutState, dx: number) =>
        moveDrag(startDrag(state, [{ before: "c", after: "fill" }]), dx, 0);
      expect(sizes(pulled(onlyC, -65))).toEqual(sizes(onlyC));
      const collapsed = pulled(onlyC, -75);
      expect(sizes(collapsed)).toEqual({ a: 40, b: 40, c: 40, fill: 880 });
      expect(sizes(endDrag(collapsed))).toEqual(sizes(collapsed));
      // Held, it stretches toward the pointer, and springs back.
      const elastic = shrinkAll(
        create({ ...options, elastic: true }, 1000),
        "a",
        "b",
      );
      const held = pulled(elastic, -50);
      expect(sizes(held).c).toBeLessThan(920);
      expect(sizes(held).c).toBeGreaterThan(900);
      expect(sizes(endDrag(held))).toEqual(sizes(onlyC));

      // Collapsed, it sits at its strip, though the strip stretches: what
      // stretches is only what's still in the stop the drag found it in.
      const stretchy = (id: string) => ({
        id,
        stops: { strip: { size: 40, elastic: true }, open: { min: 180 } },
      });
      const bOpen = shrinkAll(
        create(
          {
            ...row(stretchy("a"), stretchy("b"), stretchy("c"), {
              id: "fill",
              fill: "last",
            }),
            elastic: true,
          },
          1000,
        ),
        "a",
      );
      expect(sizes(pulled(bOpen, -100))).toEqual({
        a: 40,
        b: 920,
        c: 40,
        fill: 0,
      });

      // Opened by its edge from all strips, c takes the row; dragged on,
      // nothing resists (the fill just gave its space), so no stretch.
      const strips = shrinkAll(bOpen, "b", "c");
      for (const dx of [150, 300, 600]) {
        expect(sizes(pulled(strips, dx))).toEqual({
          a: 40,
          b: 40,
          c: 920,
          fill: 0,
        });
      }
      // Nor dragged out and back below c's minimum: c is held at the row's
      // width, nowhere near the minimum the pointer is below.
      const out = pulled(strips, 500);
      expect(sizes(moveDrag(out, 100, 0))).toEqual({
        a: 40,
        b: 40,
        c: 920,
        fill: 0,
      });

      // With other children open, they take the space it leaves.
      const allOpen = create(options, 1000);
      expect(sizes(endDrag(pulled(allOpen, -150)))).toEqual({
        a: 480,
        b: 480,
        c: 40,
        fill: 0,
      });
    });

    it("centres the others between two, sharing equally", () => {
      const centred = row({ id: "start", fill: "last" }, pane("a"), pane("b"), {
        id: "end",
        fill: "last",
      });
      const strips = shrinkAll(create(centred, 1000), "a", "b");
      expect(sizes(strips)).toEqual({ start: 460, a: 40, b: 40, end: 460 });
      expect(sizes(measure(strips, space(1200)))).toEqual({
        start: 560,
        a: 40,
        b: 40,
        end: 560,
      });
    });
  });

  describe('"first"', () => {
    const options = row(pane("a"), pane("b"), {
      id: "fill",
      fill: "first",
    });

    it("takes extra space before the others, which keep their sizes", () => {
      const state = create(options, 1000);
      expect(sizes(state)).toEqual({ a: 500, b: 500, fill: 0 });
      expect(sizes(measure(state, space(1300)))).toEqual({
        a: 500,
        b: 500,
        fill: 300,
      });
      // b shrinking to a strip leaves its space to the fill, not a.
      expect(sizes(setChildStop(state, "b", "strip"))).toEqual({
        a: 500,
        b: 40,
        fill: 460,
      });
    });

    it("gives its space up first when the others need room", () => {
      const wider = measure(create(options, 1000), space(1300));
      expect(sizes(measure(wider, space(1100)))).toEqual({
        a: 500,
        b: 500,
        fill: 100,
      });
      // Then the others share the rest of the shrink.
      expect(sizes(measure(wider, space(800)))).toEqual({
        a: 400,
        b: 400,
        fill: 0,
      });
    });

    it("lets the others' separator move between them alone", () => {
      const state = measure(create(options, 1000), space(1300));
      const dragged = endDrag(
        moveDrag(startDrag(state, [{ before: "a", after: "b" }]), 100, 0),
      );
      expect(sizes(dragged)).toEqual({ a: 600, b: 400, fill: 300 });
    });
  });

  it("keeps a group's children able to all be at points", () => {
    const options = row(pane("a"), { id: "fill", fill: "last" });
    const strip = setChildStop(create(options, 1000), "a", "strip");
    expect(sizes(strip)).toEqual({ a: 40, fill: 960 });
  });

  it("takes no size options of its own", () => {
    expect(() =>
      parseLayoutOptions(
        // A type error too; this is options from plain JavaScript.
        // @ts-expect-error: a fill takes no size options.
        row(pane("a"), {
          id: "fill",
          fill: "last",
          minSize: 100,
          defaultSize: 50,
        }),
      ),
    ).toThrow(
      '"fill" fills what its siblings leave, so it takes no `minSize` or `defaultSize`.',
    );
    // Nor stop options: it has one range, and no stop to toggle.
    expect(() =>
      parseLayoutOptions(
        // @ts-expect-error: a fill takes no stop options.
        row(pane("a"), { id: "fill", fill: "last", enterToggles: "x" }),
      ),
    ).toThrow(/takes no `enterToggles`/);
  });
});

describe("locked children and disabled separators", () => {
  const row = (...children: LayoutElementOptions[]): LayoutOptions => ({
    layout: { id: "root", direction: "row", children },
    elastic: false,
  });
  const drag = (
    state: LayoutState,
    before: string,
    after: string,
    dx: number,
  ) => moveDrag(startDrag(state, [{ before, after }]), dx, 0);
  const move = (delta: number) => ({ kind: "move", delta }) as const;
  const lockedFiles = row({ ...files, locked: true }, editor, preview);

  it("holds a locked child against drags and keys", () => {
    const state = create(lockedFiles);
    // Nothing beyond it to push: its separator is pinned.
    expect(separatorMoves(state, "files", "editor")).toBe(false);
    expect(sizes(drag(state, "files", "editor", 50))).toEqual(sizes(state));
    expect(sizes(applyKeyboard(state, "files", "editor", move(10)))).toEqual(
      sizes(state),
    );
  });

  it("lets a drag push on past it", () => {
    const state = create(
      row(
        { id: "a" },
        { id: "b", defaultSize: 200, locked: true },
        { id: "c" },
      ),
      1000,
    );
    expect(sizes(state)).toEqual({ a: 400, b: 200, c: 400 });
    expect(sizes(drag(state, "a", "b", 100))).toEqual({
      a: 500,
      b: 200,
      c: 300,
    });
  });

  it("keeps its size when code moves a sibling, but not when code moves it", () => {
    const state = create(lockedFiles);
    expect(
      sizes(setChildSize(state, "editor", { value: 700, unit: "px" })),
    ).toEqual({ files: 240, editor: 700, preview: 260 });
    expect(
      sizes(setChildSize(state, "files", { value: 300, unit: "px" })).files,
    ).toBe(300);
  });

  it("keeps its share when the space changes", () => {
    expect(sizes(measure(create(lockedFiles), space(1800))).files).toBe(360);
  });

  it("leaves a disabled separator where it is, but not its neighbours", () => {
    const state = create({
      ...options,
      disabledSeparators: [["files", "editor"]],
    });
    expect(separatorMoves(state, "files", "editor")).toBe(false);
    expect(sizes(applyKeyboard(state, "files", "editor", move(10)))).toEqual(
      sizes(state),
    );
    // The other separator pushes on into files as usual.
    expect(sizes(drag(state, "editor", "preview", -400)).files).toBeLessThan(
      240,
    );
  });
});

describe("setChildStops", () => {
  /** Two panes, the second closed, as a workspace starts. */
  const panes = () =>
    create(
      {
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "a",
              defaultSize: "50%",
              stops: { closed: 0, open: { min: 48 } },
            },
            {
              id: "b",
              defaultSize: "50%",
              defaultStop: "closed",
              stops: { closed: 0, open: { min: 48 } },
            },
          ],
        },
        elastic: false,
      },
      1000,
    );

  it("shows one alone, whichever order it's written in", () => {
    const state = panes();
    expect(sizes(state)).toEqual({ a: 1000, b: 0 });
    const opensFirst = setChildStops(state, [
      ["b", "open"],
      ["a", "closed"],
    ]);
    // Closing "a" first is refused at its turn (nothing would take the
    // row), so it waits for "b" to open.
    const closesFirst = setChildStops(state, [
      ["a", "closed"],
      ["b", "open"],
    ]);
    expect(sizes(opensFirst)).toEqual({ a: 0, b: 1000 });
    expect(sizes(closesFirst)).toEqual(sizes(opensFirst));
    // As the two calls would, one after the other.
    expect(sizes(opensFirst)).toEqual(
      sizes(setChildStop(setChildStop(state, "b", "open"), "a", "closed")),
    );
  });

  it("is all or nothing, with a warning", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = setChildStop(panes(), "b", "open");
    // Both closed would leave the row with nothing to take its space.
    const after = setChildStops(state, [
      ["a", "closed"],
      ["b", "closed"],
    ]);
    expect(after).toBe(state);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("so none of them happen"),
    );
    warn.mockClear();
    resetWarnings();
    expect(
      setChildStops(
        state,
        [
          ["a", "closed"],
          ["b", "closed"],
        ],
        true,
      ),
    ).toBe(state);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("so none of them happen"),
    );
    warn.mockRestore();
  });

  it("skips children already at their stop", () => {
    const state = panes();
    const after = setChildStops(state, [
      ["a", "open"],
      ["b", "open"],
    ]);
    expect(sizes(after)).toEqual({ a: 500, b: 500 });
    expect(
      setChildStops(after, [
        ["a", "open"],
        ["b", "open"],
      ]),
    ).toBe(after);
  });

  it("throws for an unknown stop", () => {
    expect(() => setChildStops(panes(), [["a", "rail"]])).toThrow();
  });

  describe("refusing overflow", () => {
    // Either open fills the row, both open overflow it.
    const swap = (min: number) =>
      create(
        {
          layout: {
            id: "root",
            direction: "row",
            refuseOverflow: true,
            children: [
              {
                id: "a",
                defaultStop: "open",
                stops: { closed: 0, open: { min } },
              },
              {
                id: "b",
                defaultStop: "closed",
                stops: { closed: 0, open: { min } },
              },
            ],
          },
          elastic: false,
        },
        600,
      );

    it("swaps which is open in either order, judged where they end", () => {
      for (const order of [
        [
          ["a", "closed"],
          ["b", "open"],
        ],
        [
          ["b", "open"],
          ["a", "closed"],
        ],
      ] as const) {
        expect(sizes(setChildStops(swap(400), order))).toEqual({
          a: 0,
          b: 600,
        });
      }
    });

    it("still refuses an end that overflows", () => {
      const state = swap(400);
      expect(setChildStops(state, [["b", "open"]], true)).toBe(state);
    });
  });
});

describe("ids that join alike", () => {
  it("keeps ids apart that only joined would be the same", () => {
    const options = (locked: boolean): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "column",
        children: [
          {
            id: "top",
            direction: "row",
            children: [
              { id: "a b", locked },
              { id: "c", locked },
            ],
          },
          {
            id: "bottom",
            direction: "row",
            children: [{ id: "a" }, { id: "b c" }],
          },
        ],
      },
    });
    const state = layoutAt(options(true), { root: 600, top: 600, bottom: 600 });
    expect(separatorMoves(state, "a b", "c")).toBe(false);
    expect(separatorMoves(state, "a", "b c")).toBe(true);
    expect(separatorReach(state, "a", "b c")).toEqual({ min: 0, max: 600 });
    // One child "a,b" for two, "a" and "b": children changed.
    const flat = (ids: string[]): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: ids.map((id) => ({ id })),
      },
    });
    const before = createLayoutState(parseLayoutOptions(flat(["a,b"])));
    expect(
      optionsCause(
        before,
        setConfig(before, parseLayoutOptions(flat(["a", "b"]))),
      ),
    ).toBe("children");
  });
});

describe("ids and stop names like members every object has", () => {
  const px = (value: number) => ({ value, unit: "px" }) as const;
  const sizeOf = (state: LayoutState, id: string) =>
    views(state).find((node) => node.id === id)?.size;

  /** Ids for a row of three, the middle one a group of two. */
  const prototypeIds = {
    first: "constructor",
    group: "__proto__",
    inner: "toString",
    innerLast: "valueOf",
    last: "hasOwnProperty",
  };
  const plainIds = {
    first: "first",
    group: "group",
    inner: "inner",
    innerLast: "innerLast",
    last: "last",
  };
  type Ids = typeof plainIds;

  const nested = (ids: Ids): LayoutOptions => ({
    layout: {
      id: "root",
      direction: "row",
      children: [
        {
          id: ids.first,
          defaultSize: 240,
          stops: { closed: 0, open: { min: 180 } },
        },
        {
          id: ids.group,
          direction: "row",
          defaultSize: 500,
          children: [
            { id: ids.inner },
            { id: ids.innerLast, defaultSize: 100 },
          ],
        },
        { id: ids.last, minSize: 200 },
      ],
    },
    elastic: false,
  });
  const build = (ids: Ids) =>
    measure(createLayoutState(parseLayoutOptions(nested(ids))), {
      root: groupSpace(1200),
      [ids.group]: groupSpace(500),
    });
  const all = (ids: Ids, state: LayoutState) =>
    Object.values(ids).map((id) => sizeOf(state, id));

  /** Every step's sizes, for each id in `ids`, in its order. */
  function walk(ids: Ids): (number | null | undefined)[][] {
    const steps: LayoutState[] = [];
    let state = build(ids);
    steps.push(state);
    const drag = (before: string, after: string, dx: number) =>
      endDrag(moveDrag(startDrag(state, [{ before, after }]), dx, 0));
    state = drag(ids.first, ids.group, 60);
    steps.push(state);
    state = setChildStop(state, ids.first, "closed");
    steps.push(state);
    state = setChildStop(state, ids.first, "open");
    steps.push(state);
    state = drag(ids.inner, ids.innerLast, -50);
    steps.push(state);
    state = applyKeyboard(state, ids.group, ids.last, {
      kind: "move",
      delta: 20,
    });
    steps.push(state);
    state = setChildSize(state, ids.last, px(300));
    steps.push(state);
    const saved: unknown = JSON.parse(JSON.stringify(toSnapshot(state)));
    expect(isLayoutSnapshot(saved)).toBe(true);
    const restored = restoreSnapshot(build(ids), saved as LayoutSnapshot);
    expect(snapshotsEqual(toSnapshot(restored), toSnapshot(state))).toBe(true);
    steps.push(restored);
    steps.push(resetToDefaults(restored, ids.first));
    return steps.map((step) => all(ids, step));
  }

  it("lays out, drags, sets and restores children with those ids", () => {
    const state = build(prototypeIds);
    expect(all(prototypeIds, state)).toEqual([240, 500, 400, 100, 460]);
    const moved = walk(prototypeIds);
    expect(moved).toEqual(walk(plainIds));
    expect(moved[1]).toEqual([300, 440, 352, 88, 460]);
    expect(moved[2][0]).toBe(0);
    expect(moved[3][0]).toBe(300);
    expect(moved.flat().every(Number.isFinite)).toBe(true);
  });

  it("views and renders children with those ids", () => {
    const state = build(prototypeIds);
    const view = getLayoutView(state);
    expect(view.elements.map((element) => element.id)).toEqual([
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
    ]);
    expect(Object.keys(view.children)).toHaveLength(5);
    expect(view.children["__proto__"]?.size).toBe(500);
    expect(view.children["constructor"]?.stop).toBe("open");
    expect(Object.getPrototypeOf(view.children)).toBe(Object.prototype);
    expect(getLayoutRendering(state).nodes.get("__proto__")?.flex).toBe(
      getLayoutRendering(build(plainIds)).nodes.get("group")?.flex,
    );
    const closed = setChildStop(state, "constructor", "closed");
    expect(getLayoutView(closed).children["constructor"]).toMatchObject({
      stop: "closed",
      size: 0,
    });
  });

  it("tells snapshots with those ids from ones without", () => {
    const named = toSnapshot(build(prototypeIds));
    const plain = toSnapshot(build(plainIds));
    expect(snapshotsEqual(named, plain)).toBe(false);
    expect(snapshotsEqual(plain, named)).toBe(false);
  });

  it("knows a group with one of those ids isn't measured yet", () => {
    const state = measure(
      createLayoutState(parseLayoutOptions(nested(prototypeIds))),
      space(1200),
    );
    expect(separatorReach(state, "constructor", "__proto__")).not.toBeNull();
    expect(separatorReach(state, "toString", "valueOf")).toBeNull();
    // Until it's measured, it might move.
    expect(separatorMoves(state, "toString", "valueOf")).toBe(true);
  });

  /** One element with range stops named `names`, beside one that fills. */
  const ranges = (names: [string, string, string]): LayoutOptions => ({
    layout: {
      id: "root",
      direction: "row",
      children: [
        {
          id: "a",
          defaultSize: 150,
          defaultStop: "closed",
          stops: {
            closed: 0,
            [names[0]]: { min: 100, max: 250 },
            [names[1]]: { min: 300, max: 400 },
            [names[2]]: { min: 500 },
          },
        },
        { id: "b" },
      ],
    },
    elastic: false,
  });

  it("opens range stops with those names at their sizes", () => {
    const run = (names: [string, string, string]) => {
      const state = create(ranges(names));
      const first = setChildStop(state, "a", names[0]);
      const second = setChildStop(first, "a", names[1]);
      const resized = setChildSize(second, "a", px(350));
      const third = setChildStop(resized, "a", names[2]);
      const back = setChildStop(third, "a", names[1]);
      const toggled = setChildStop(back, "a", names[1], true);
      return [first, second, resized, third, back, toggled].map((step) => [
        getLayoutView(step).children.a?.stop,
        sizeOf(step, "a"),
      ]);
    };
    const named = run(["constructor", "toString", "__proto__"]);
    expect(named).toEqual([
      ["constructor", 150],
      ["toString", 300],
      ["toString", 350],
      ["__proto__", 500],
      ["toString", 350],
      ["__proto__", 500],
    ]);
    expect(named.map(([, size]) => size)).toEqual(
      run(["small", "medium", "large"]).map(([, size]) => size),
    );
  });

  it("steps down along a yieldTo between stops with those names", () => {
    const yielding = (rail: string, open: string): LayoutOptions => ({
      layout: {
        id: "root",
        direction: "row",
        children: [
          {
            id: "a",
            defaultStop: open,
            stops: { [rail]: 40, [open]: { min: 300 } },
            yieldTo: { [open]: rail },
          },
          { id: "b", minSize: 800 },
        ],
      },
      elastic: false,
    });
    for (const [rail, open] of [
      ["constructor", "__proto__"],
      ["toString", "valueOf"],
    ]) {
      const tight = create(yielding(rail, open), 1000);
      expect(getLayoutView(tight).children.a).toMatchObject({
        stop: rail,
        yieldedFrom: open,
        size: 40,
      });
      const roomy = getLayoutView(measure(tight, space(1200))).children.a;
      expect(roomy?.stop).toBe(open);
      expect(roomy?.size).toBeCloseTo(400);
    }
  });
});
