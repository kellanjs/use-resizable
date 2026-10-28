import { describe, expect, it } from "vitest";

import { stretch } from "../foundation/limits.js";
import type { Stop } from "../foundation/stops.js";
import {
  type GroupItem,
  distribute,
  fitSizes,
  moveBoundary,
} from "./solver.js";

const open = (min = 100, max = Infinity): Stop => ({
  name: "open",
  min,
  max,
  pull: 1,
  onlyByName: false,
  stretches: { larger: true, smaller: true },
  endsDrag: false,
});
const point = (
  name: string,
  size: number,
  extra: Partial<Stop> = {},
): Stop => ({
  name,
  min: size,
  max: size,
  pull: 1,
  onlyByName: false,
  stretches: { larger: false, smaller: false },
  endsDrag: false,
  ...extra,
});
const sorted = (stops: Stop[]) =>
  [...stops].sort((a, b) => a.min - b.min || a.max - b.max);

/** An item in its `open` range (min 100 by default), with no other stops. */
function item(size: number, limits: { min?: number; max?: number } = {}) {
  return { track: [open(limits.min, limits.max)], size, stop: "open" };
}

/** An item with several stops, in the one called `stop`. */
function at(stops: Stop[], stop: string, size: number): GroupItem {
  return { track: sorted(stops), size, stop };
}

/** An item at a point (`stop`), below an open range starting at `min`. */
const parked = (size: number, min = 100) =>
  at([point("parked", size), open(min)], "parked", size);

const sizes = (items: readonly GroupItem[]) =>
  items.map((entry) => Math.round(entry.size * 1000) / 1000);
const total = (items: readonly GroupItem[]) =>
  items.reduce((sum, entry) => sum + entry.size, 0);

describe("distribute", () => {
  it("shares in proportion to weight", () => {
    expect(distribute(90, [Infinity, Infinity], [1, 2])).toEqual([30, 60]);
  });

  it("re-shares what a full item can't take", () => {
    // Equal weights, but the first can only take 10.
    expect(distribute(100, [10, Infinity, Infinity], [1, 1, 1])).toEqual([
      10, 45, 45,
    ]);
  });

  it("gives nothing to items without weight or room", () => {
    expect(distribute(60, [Infinity, Infinity, 0], [0, 1, 1])).toEqual([
      0, 60, 0,
    ]);
  });

  it("stops when everyone is full", () => {
    expect(distribute(100, [10, 20], [1, 1])).toEqual([10, 20]);
  });
});

describe("fitSizes", () => {
  it("leaves a placed item for last, after those that keep their size", () => {
    // The first asked for 600; the second keeps its size, but nothing else
    // can make room.
    const kept = { ...item(900), keepSize: true };
    expect(sizes(fitSizes([item(600), kept], 900, [0, 0], [0]))).toEqual([
      600, 300,
    ]);
    // Freeing space, likewise: the kept one takes it before the placed one.
    expect(sizes(fitSizes([item(200), kept], 1500, [0, 0], [0]))).toEqual([
      200, 1300,
    ]);
    // Only once the others are at their limits does it give way itself.
    const limited = { ...item(900, { min: 700 }), keepSize: true };
    expect(sizes(fitSizes([item(600), limited], 900, [0, 0], [0]))).toEqual([
      200, 700,
    ]);
  });

  it("takes space by priority, the lowest first, each to its minimum", () => {
    const low = { ...item(400), priority: -1 };
    const fit = (available: number) =>
      sizes(fitSizes([low, item(400), item(400)], available, [400, 400, 400]));
    // The lowest gives first, down to its minimum of 100...
    expect(fit(900)).toEqual([100, 400, 400]);
    // ...then the next priority, in proportion to size.
    expect(fit(600)).toEqual([100, 250, 250]);
    // Growing doesn't use priorities.
    expect(fit(1500)).toEqual([500, 500, 500]);
  });

  it("orders by priority within a turn, not across keeping or placing", () => {
    // A kept item gives only once the others can't, whatever its priority.
    const kept = { ...item(400), keepSize: true, priority: -1 };
    const high = { ...item(400), priority: 5 };
    expect(sizes(fitSizes([kept, high], 600, [0, 400]))).toEqual([400, 200]);
    // A placed item gives last of all, whatever its priority.
    const placed = { ...item(400), priority: -1 };
    expect(sizes(fitSizes([placed, high], 600, [0, 400], [0]))).toEqual([
      400, 200,
    ]);
  });

  it("shares extra space by grow, once any item has one", () => {
    const weights = [600, 600];
    // Only the first has a grow: it takes all the extra.
    expect(
      sizes(fitSizes([{ ...item(600), grow: 1 }, item(600)], 1500, weights)),
    ).toEqual([900, 600]);
    // Equal grows: equal shares of the extra, not equal sizes.
    expect(
      sizes(
        fitSizes(
          [
            { ...item(200), grow: 1 },
            { ...item(400), grow: 1 },
          ],
          900,
          [200, 400],
        ),
      ),
    ).toEqual([350, 550]);
    // One without a grow takes extra once the others are full.
    expect(
      sizes(
        fitSizes(
          [{ ...item(600, { max: 700 }), grow: 1 }, item(600)],
          1500,
          weights,
        ),
      ),
    ).toEqual([700, 800]);
    // Taking space doesn't use grow: in proportion to size, as ever.
    expect(
      sizes(fitSizes([{ ...item(600), grow: 1 }, item(200)], 400, [600, 200])),
    ).toEqual([300, 100]);
  });

  it("keeps an item its weights leave out out of grow's share", () => {
    // A kept item has no weight: the other takes the extra first.
    const kept = { ...item(400), keepSize: true, grow: 3 };
    expect(
      sizes(fitSizes([kept, { ...item(400), grow: 1 }], 1000, [0, 400])),
    ).toEqual([400, 600]);
  });

  it("keeps proportions when weighted by size", () => {
    const fitted = fitSizes([item(200), item(400)], 900, [200, 400]);
    expect(sizes(fitted)).toEqual([300, 600]);
    expect(sizes(fitSizes([item(200), item(400)], 300, [200, 400]))).toEqual([
      100, 200,
    ]);
  });

  it("leaves items with no weight alone while others can absorb", () => {
    expect(sizes(fitSizes([item(240), item(400)], 800, [0, 1]))).toEqual([
      240, 560,
    ]);
  });

  it("shrinks fixed items once the others reach their minimums", () => {
    // The flexible item can only give 100; the fixed one gives the rest.
    expect(sizes(fitSizes([item(300), item(200)], 350, [0, 1]))).toEqual([
      250, 100,
    ]);
  });

  it("respects maximums and minimums", () => {
    expect(
      sizes(fitSizes([item(200, { max: 250 }), item(200)], 600, [1, 1])),
    ).toEqual([250, 350]);
    expect(sizes(fitSizes([item(200), item(200)], 150, [1, 1]))).toEqual([
      100, 100,
    ]); // overflows
  });

  it("never resizes items at a point", () => {
    expect(sizes(fitSizes([parked(48), item(400)], 600, [1, 1]))).toEqual([
      48, 552,
    ]);
  });

  it("returns the same sizes when they already fit", () => {
    expect(sizes(fitSizes([item(300), item(300)], 600, [1, 1]))).toEqual([
      300, 300,
    ]);
  });
});

describe("moveBoundary", () => {
  const three = [item(300), item(300), item(300)];

  it("moves space between the two neighbours", () => {
    expect(sizes(moveBoundary(three, 0, 50))).toEqual([350, 250, 300]);
    expect(sizes(moveBoundary(three, 1, -50))).toEqual([300, 250, 350]);
  });

  it("is a pure function of the total movement, so drags reverse", () => {
    expect(moveBoundary(three, 0, 0)).toEqual(three);
    expect(sizes(moveBoundary(three, 0, -120))).toEqual([180, 420, 300]);
  });

  it("cascades into further items once the neighbour hits its minimum", () => {
    // B gives 200 (to its min of 100), then C gives the other 50.
    expect(sizes(moveBoundary(three, 0, 250))).toEqual([550, 100, 250]);
    // Everything after the boundary at minimum: stops there.
    expect(sizes(moveBoundary(three, 0, 900))).toEqual([700, 100, 100]);
  });

  it("cascades growth past a neighbour at its maximum", () => {
    const capped = [item(300), item(300, { max: 320 }), item(300)];
    expect(sizes(moveBoundary(capped, 1, 50))).toEqual([330, 320, 250]);
  });

  it("moves only the two neighbours without cascade", () => {
    const items = [item(300), item(300, { min: 250 }), item(300)];
    expect(sizes(moveBoundary(items, 0, 100))).toEqual([400, 250, 250]);
    expect(sizes(moveBoundary(items, 0, 100, { cascade: false }))).toEqual([
      350, 250, 300,
    ]);
    // Growing past a neighbour's maximum too: B takes 20 (to its 320
    // maximum); with cascade, C takes the other 80.
    const capped = [item(300), item(300, { max: 320 }), item(300)];
    expect(sizes(moveBoundary(capped, 0, -100))).toEqual([200, 320, 380]);
    expect(sizes(moveBoundary(capped, 0, -100, { cascade: false }))).toEqual([
      280, 320, 300,
    ]);
  });

  it("stops at a neighbour's maximum when nothing else can grow", () => {
    const capped = [item(300, { max: 320 }), item(300)];
    expect(sizes(moveBoundary(capped, 0, 100))).toEqual([320, 280]);
  });

  it("keeps the total the same", () => {
    for (const delta of [-500, -150, -20, 0, 35, 260, 900]) {
      expect(total(moveBoundary(three, 1, delta))).toBeCloseTo(900);
    }
  });

  describe("stops", () => {
    const closable = (size = 300) =>
      at([point("closed", 0), open(200)], "open", size);
    // B has a point at 0 below its range (min 200): they divide at 100.
    const withClosable = [item(300), closable(), item(300)];

    it("holds a neighbour with a stop beyond it, without cascading", () => {
      const held = moveBoundary(withClosable, 0, 180);
      expect(sizes(held)).toEqual([400, 200, 300]);
    });

    it("lands it across the gap past the group, and the other side takes the space", () => {
      const shut = moveBoundary(withClosable, 0, 210);
      expect(sizes(shut)).toEqual([600, 0, 300]);
      expect(shut[1].stop).toBe("closed");
    });

    it("comes back within the same drag", () => {
      expect(moveBoundary(withClosable, 0, 150)[1].stop).toBe("open");
    });

    it("doesn't snap if the other side can't take the space", () => {
      const narrow = [item(300, { max: 450 }), ...withClosable.slice(1)];
      const result = moveBoundary(narrow, 0, 210);
      expect(sizes(result)).toEqual([400, 200, 300]);
      expect(result[1].stop).toBe("open");
    });

    it("opens a neighbour at a point once dragged past the group", () => {
      // B closed at 0 between A and C; dragging the A|B boundary left grows B.
      const items = [
        item(400),
        at([point("closed", 0), open(200)], "closed", 0),
        item(300),
      ];
      expect(sizes(moveBoundary(items, 0, -80))).toEqual([400, 0, 300]);
      const opened = moveBoundary(items, 0, -120);
      expect(sizes(opened)).toEqual([200, 200, 300]);
      expect(opened[1].stop).toBe("open");
    });

    it("keeps a neighbour it opened into a range once the other side runs out", () => {
      // Editor group: files (min 160), editor (min 240), preview closed with
      // a range from 180. Dragging far left opens preview as wide as the
      // other two can shrink, rather than closing it again.
      const items = [
        item(220, { min: 160 }),
        item(400, { min: 240 }),
        at([point("closed", 0), open(180)], "closed", 0),
      ];
      const opened = moveBoundary(items, 1, -500);
      expect(sizes(opened)).toEqual([160, 240, 220]);
      expect(opened[2].stop).toBe("open");
      // Too little room to reach the range: it stays closed.
      const cramped = [item(300, { min: 200 }), items[2]];
      expect(sizes(moveBoundary(cramped, 0, -150))).toEqual([300, 0]);
    });

    it("keeps it at its point if the other side can't make room", () => {
      const items = [
        item(250, { min: 200 }),
        at([point("closed", 0), open(200)], "closed", 0),
      ];
      expect(sizes(moveBoundary(items, 0, -150))).toEqual([250, 0]);
    });

    const railed = [point("hidden", 0), point("rail", 48), open(200)];

    it("walks across several stops", () => {
      const items = [item(300), at(railed, "open", 300)];
      // B requested at 120 (≤ 124): rail. At 20 (≤ 24): hidden.
      expect(moveBoundary(items, 0, 180)[1]).toMatchObject({
        size: 48,
        stop: "rail",
      });
      expect(moveBoundary(items, 0, 280)[1]).toMatchObject({
        size: 0,
        stop: "hidden",
      });
    });

    it("snaps even when the stop is behind the pointer", () => {
      // From 180 (min 160) with a 48px rail: asking for 30 snaps to the rail,
      // which frees 132 although the pointer moved 150.
      const items = [
        at([point("hidden", 0), point("rail", 48), open(160)], "open", 180),
        item(600),
      ];
      const snapped = moveBoundary(items, 0, -150);
      expect(sizes(snapped)).toEqual([48, 732]);
      expect(snapped[0].stop).toBe("rail");
    });

    it("cascades past a neighbour with no stop beyond it", () => {
      const items = [item(300), parked(40), item(300), item(300)];
      // The parked element stays put; the elements beyond it make room.
      expect(sizes(moveBoundary(items, 0, 80))).toEqual([380, 40, 220, 300]);
    });

    it("walks a neighbour on to its next stop before cascading", () => {
      const items = [item(300), at(railed, "rail", 48), item(300)];
      expect(sizes(moveBoundary(items, 0, 10))).toEqual([300, 48, 300]);
      const hidden = moveBoundary(items, 0, 30);
      expect(sizes(hidden)).toEqual([348, 0, 300]);
      expect(hidden[1].stop).toBe("hidden");
    });

    it("leaves items at points further away alone", () => {
      const items = [item(300), item(300), parked(48)];
      expect(sizes(moveBoundary(items, 0, 250))).toEqual([500, 100, 48]);
    });

    it("holds a growing neighbour below a stop above it, then snaps up", () => {
      // B can be 100–400, or exactly 800 (dividing point at 600).
      const items = [
        item(800),
        at([open(100, 400), point("max", 800)], "open", 300),
      ];
      expect(sizes(moveBoundary(items, 0, -250))).toEqual([700, 400]);
      const maxed = moveBoundary(items, 0, -350);
      expect(sizes(maxed)).toEqual([300, 800]);
      expect(maxed[1].stop).toBe("max");
    });

    it("never lands on a stop reached only by name, so it cascades instead", () => {
      const items = [
        item(300),
        at([point("hidden", 0, { onlyByName: true }), open(200)], "open", 300),
        item(300),
      ];
      expect(sizes(moveBoundary(items, 0, 250))).toEqual([550, 200, 150]);
    });

    it("divides the gap by pull", () => {
      // rail (48) pulls 3 against open (from 200): they divide at 162.
      const items = [
        item(300),
        at([point("rail", 48, { pull: 3 }), open(200)], "open", 300),
        item(300),
      ];
      expect(sizes(moveBoundary(items, 0, 130))).toEqual([400, 200, 300]);
      expect(sizes(moveBoundary(items, 0, 140))).toEqual([552, 48, 300]);
    });

    describe("a neighbour opening across a gap", () => {
      // Panes with a 40px strip and a range from 180: A a strip, B just
      // above its minimum, C with room. Opening A needs 140 at once.
      const pane = (stop: "strip" | "open", size: number) =>
        at([point("strip", 40), open(180)], stop, size);
      const workspace = [pane("strip", 40), pane("open", 219), item(444)];

      it("opens at its own dividing point, the items beyond making room", () => {
        expect(sizes(moveBoundary(workspace, 0, 60))).toEqual([40, 219, 444]);
        // B gives what it has in its range (39), C the rest (101).
        const opened = moveBoundary(workspace, 0, 75);
        expect(sizes(opened)).toEqual([180, 180, 343]);
        expect(opened.map((entry) => entry.stop)).toEqual([
          "open",
          "open",
          "open",
        ]);
      });

      it("then carries on from there: B holds, and collapses at its own dividing point", () => {
        // From the opened layout, B's dividing point is 70 further on.
        expect(sizes(moveBoundary(workspace, 0, 175))).toEqual([180, 180, 343]);
        const collapsed = moveBoundary(workspace, 0, 215);
        // C doesn't spring back: it keeps what it gave.
        expect(sizes(collapsed)).toEqual([320, 40, 343]);
        expect(collapsed[1].stop).toBe("strip");
        expect(sizes(moveBoundary(workspace, 0, 300))).toEqual([340, 40, 323]);
      });

      it("waits for B to collapse when nothing beyond can make room", () => {
        const cramped = [
          pane("strip", 40),
          pane("open", 219),
          item(180, { min: 180 }),
        ];
        expect(sizes(moveBoundary(cramped, 0, 100))).toEqual([40, 219, 180]);
        const opened = moveBoundary(cramped, 0, 200);
        expect(sizes(opened)).toEqual([219, 40, 180]);
      });
    });
  });

  describe("elastic", () => {
    const elastic = { distance: 20, tension: 0.5, afterSnap: false };
    const leaning = { ...elastic, afterSnap: true };

    it("stretches the neighbours past the limit", () => {
      const pair = [item(300), item(300)];
      // B can give 200; the other 100 becomes a stretch.
      const pulled = moveBoundary(pair, 0, 300, { elastic });
      const give = stretch(100, elastic);
      expect(sizes(pulled)).toEqual(
        sizes([item(500 + give), item(100 - give)]),
      );
      expect(total(pulled)).toBeCloseTo(600);
    });

    it("stretches a neighbour at a point only if that point stretches", () => {
      // B sits at its rail (48) and holds there until the drag passes the
      // dividing point (124): before that, a stretchy rail gives a little.
      const items = (stretchy: boolean) => [
        item(500),
        at(
          [
            point("rail", 48, {
              stretches: { larger: stretchy, smaller: stretchy },
            }),
            open(200),
          ],
          "rail",
          48,
        ),
      ];
      expect(sizes(moveBoundary(items(false), 0, -40, { elastic }))).toEqual([
        500, 48,
      ]);
      const give = stretch(40, elastic);
      expect(sizes(moveBoundary(items(true), 0, -40, { elastic }))).toEqual(
        sizes([item(500 - give), item(48 + give)]),
      );
    });

    it("lands a neighbour that snapped across a gap at its stop's edge", () => {
      // B opens from its rail (48) to 200 once the drag passes the dividing
      // point (124), ahead of the pointer, and sits at 200: nothing resists it.
      const rail = point("rail", 48, {
        stretches: { larger: true, smaller: true },
      });
      const items = [item(500), at([rail, open(200)], "rail", 48)];
      expect(sizes(moveBoundary(items, 0, -82, { elastic }))).toEqual([
        348, 200,
      ]);
      // Before the snap, pulled past its rail, it stretches as ever.
      const pulled = moveBoundary(items, 0, -40, { elastic });
      expect(pulled[1].size).toBeGreaterThan(48);
      expect(pulled[1].stop).toBe("rail");
      // And pushed past the far edge of the stop it snapped to.
      const capped = [item(500), at([rail, open(200, 300)], "rail", 48)];
      const pushed = moveBoundary(capped, 0, -300, { elastic });
      expect(pushed[1].stop).toBe("open");
      expect(pushed[1].size).toBeGreaterThan(300);
    });

    it("stretches it back toward the pointer with afterSnap", () => {
      // A drag back retraces the same sizes.
      const items = [item(500), at([point("rail", 48), open(200)], "rail", 48)];
      const opened = moveBoundary(items, 0, -82, { elastic: leaning });
      const give = stretch(70, elastic);
      expect(sizes(opened)).toEqual(
        sizes([item(348 + give), item(200 - give)]),
      );
      expect(opened[1].stop).toBe("open");
      expect(total(opened)).toBeCloseTo(548);
      // At the stop's edge, nothing to give.
      expect(sizes(moveBoundary(items, 0, -152, { elastic: leaning }))).toEqual(
        [348, 200],
      );
    });

    it("lands crisply after a snap if a neighbour's stop doesn't stretch", () => {
      const items = [
        item(500),
        at([point("rail", 48), open(200, Infinity)], "rail", 48),
      ];
      const rigid = [
        {
          ...items[0],
          track: [{ ...open(), stretches: { larger: false, smaller: false } }],
        },
        items[1],
      ];
      expect(sizes(moveBoundary(rigid, 0, -82, { elastic: leaning }))).toEqual([
        348, 200,
      ]);
    });

    it("stretches a neighbour only the way its stop says", () => {
      // B sits at a rail with nothing below it; it stretches only larger.
      const items = (smaller: boolean) => [
        item(500),
        at(
          [
            point("rail", 48, { stretches: { larger: true, smaller } }),
            open(200),
          ],
          "rail",
          48,
        ),
      ];
      const give = stretch(40, elastic);
      // Pulled larger (toward open, before the dividing point): it gives.
      expect(sizes(moveBoundary(items(false), 0, -40, { elastic }))).toEqual(
        sizes([item(500 - give), item(48 + give)]),
      );
      // Pushed smaller: nothing to reach, so it doesn't...
      expect(sizes(moveBoundary(items(false), 0, 40, { elastic }))).toEqual([
        500, 48,
      ]);
      // ...unless its stop stretches smaller too.
      expect(sizes(moveBoundary(items(true), 0, 40, { elastic }))).toEqual(
        sizes([item(500 + give), item(48 - give)]),
      );
    });

    it("doesn't stretch within the limits", () => {
      const pair = [item(300), item(300)];
      expect(sizes(moveBoundary(pair, 0, 50, { elastic }))).toEqual([350, 250]);
    });
  });
});
