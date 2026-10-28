import { describe, expect, it, vi } from "vitest";

import { groupSpace, layoutAt } from "../../testing/layout.js";
import type { LayoutOptions, LayoutState } from "./layout-config.js";
import { leastFitting, mostFilled } from "./layout-extents.js";
import { measure, moveDrag, startDrag } from "./layout-model.js";
import { getLayoutRendering } from "./layout-rendering.js";
import type { LayoutChildOptions } from "./tree.js";

// Counts the stops resolved, for the work a drag frame does.
const counter = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../foundation/stops", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../foundation/stops.js")>();
  return {
    ...actual,
    resolveTrack: (...args: Parameters<typeof actual.resolveTrack>) => {
      counter.calls++;
      return actual.resolveTrack(...args);
    },
  };
});

const sizes = (state: LayoutState) =>
  Object.fromEntries(
    [...getLayoutRendering(state).nodes.values()].map((node) => [
      node.id,
      node.size,
    ]),
  );

/** Measures `groups` at the sizes they're drawn at, until that settles. */
function settle(state: LayoutState, groups: readonly string[]) {
  let next = state;
  for (let pass = 0; pass < 20; pass++) {
    const nodes = getLayoutRendering(next).nodes;
    const measured = measure(
      next,
      Object.fromEntries(
        groups.map((id) => [id, groupSpace(nodes.get(id)?.drawn ?? 0)]),
      ),
    );
    if (measured === next) break;
    next = measured;
  }
  return next;
}

/** A row of `inner` (with `children`) and a sibling, in 1000px. */
const nested = (children: LayoutOptions["layout"]["children"]): LayoutOptions =>
  ({
    layout: {
      id: "root",
      direction: "row",
      children: [{ id: "inner", direction: "row", children }, { id: "sib" }],
    },
    elastic: false,
  }) as LayoutOptions;

describe("where a group's children's limits meet its space", () => {
  it("finds the least space minimums fit in", () => {
    expect(leastFitting((space) => 0.99 * space)).toBe(0);
    expect(leastFitting((space) => 50 + 0.9 * space)).toBeCloseTo(500);
    expect(
      leastFitting((space) => Math.max(200, 0.2 * space) + 0.5 * space),
    ).toBeCloseTo(400);
    // Never: more than all of it.
    expect(leastFitting((space) => 1 + space)).toBeNull();
  });

  it("finds the most space maximums fill", () => {
    // Shares that add up to all of it, or more: any.
    expect(mostFilled((space) => space)).toBe(Infinity);
    expect(mostFilled((space) => 1.5 * space)).toBe(Infinity);
    expect(mostFilled((space) => 10 + space)).toBe(Infinity);
    expect(mostFilled((space) => 2 * Math.min(200, 0.6 * space))).toBeCloseTo(
      400,
    );
    expect(mostFilled((space) => Math.min(1.5 * space, 300) + 100)).toBeCloseTo(
      400,
    );
    expect(mostFilled((space) => 0.5 * space + 100)).toBeCloseTo(200);
  });
});

describe("a nested group's children's `%` maximums", () => {
  for (const [name, children] of [
    [
      "50% each",
      [
        { id: "a", maxSize: "50%" },
        { id: "b", maxSize: "50%" },
      ],
    ],
    [
      "75% each",
      [
        { id: "a", maxSize: "75%" },
        { id: "b", maxSize: "75%" },
      ],
    ],
  ] as const) {
    it(`leave it its space, ${name}`, () => {
      const state = layoutAt(nested(children), { root: 1000, inner: 500 });
      expect(sizes(state)).toMatchObject({ inner: 500, sib: 500 });
    });
  }

  it("cap it where they fill it", () => {
    const state = settle(
      layoutAt(
        nested([
          { id: "a", maxSize: [200, "60%"] },
          { id: "b", maxSize: [200, "60%"] },
        ]),
        { root: 1000, inner: 500 },
      ),
      ["inner"],
    );
    expect(sizes(state)).toMatchObject({ inner: 400, a: 200, b: 200 });
  });

  it("leave it its space, the rest empty, where they add up to less than 100%", () => {
    const state = layoutAt(
      nested([
        { id: "a", maxSize: "30%" },
        { id: "b", maxSize: "40%" },
      ]),
      { root: 1000, inner: 500 },
    );
    expect(sizes(state)).toMatchObject({ inner: 500, a: 150, b: 200 });
  });
});

describe("a nested group with a range of `%`s", () => {
  it("still needs what its children need", () => {
    for (const maxSize of ["50%", 500] as const) {
      const state = settle(
        layoutAt(
          {
            layout: {
              id: "root",
              direction: "row",
              children: [
                {
                  id: "g",
                  direction: "row",
                  children: [
                    {
                      id: "p",
                      maxSize,
                      direction: "row",
                      children: [{ id: "x", minSize: 100 }],
                    },
                    { id: "q" },
                  ],
                },
                { id: "sib" },
              ],
            },
            elastic: false,
          },
          { root: 1000, g: 500 },
        ),
        ["g", "p"],
      );
      const dragged = moveDrag(
        startDrag(state, [{ before: "g", after: "sib" }]),
        -900,
        0,
      );
      expect(sizes(dragged).g).toBeCloseTo(100);
    }
  });
});

describe("the work `%` limits take", () => {
  /** Rows each a 10% child and the next row, `levels` deep. */
  function chain(levels: number) {
    const groups: string[] = [];
    const build = (level: number): LayoutChildOptions => {
      groups.push(`g${level}`);
      const child: LayoutChildOptions = {
        id: `c${level}`,
        minSize: "10%",
        defaultSize: "10%",
      };
      return {
        id: `g${level}`,
        direction: "row",
        children:
          level === levels
            ? [child, { id: "end", minSize: 50 }]
            : [child, build(level + 1)],
      };
    };
    const options = {
      layout: {
        id: "root",
        direction: "row",
        children: [build(1), { id: "sib" }],
      },
      elastic: false,
    } satisfies LayoutOptions;
    return settle(layoutAt(options, { root: 2000 }), groups);
  }

  it("grows with the depth, not exponentially", () => {
    const perFrame = (levels: number) => {
      let dragging = startDrag(chain(levels), [
        { before: `c${levels}`, after: "end" },
      ]);
      dragging = moveDrag(dragging, 1, 0);
      counter.calls = 0;
      getLayoutRendering(moveDrag(dragging, 2, 0));
      return counter.calls;
    };
    // Twice as deep, about four times the work (each level to the root),
    // not 4 times more per level (256 times).
    expect(perFrame(8)).toBeLessThan(5 * perFrame(4));
    expect(perFrame(8)).toBeLessThan(1000);
  });
});
