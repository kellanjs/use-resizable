import { describe, expect, it } from "vitest";

import { type SizeValue, parseSize } from "./size.js";
import {
  type Stop,
  type TrackOptions,
  UNNAMED,
  checkStop,
  contentSizeOf,
  contentStopOf,
  defaultOutsideStops,
  dividingPoint,
  findStop,
  hasStopBeyond,
  isNamed,
  isZeroStop,
  land,
  nextStop,
  parseTrackOptions,
  reach,
  reachedStop,
  resolveTrack,
  roomiest,
} from "./stops.js";

const context = { containerSize: 1000, rootFontSize: 16, viewport: null };
const track = (options: TrackOptions, bounds?: { min: number; max: number }) =>
  resolveTrack(parseTrackOptions(options), context, bounds);

/** A sidebar: hidden (code only), a rail, and an open range. */
const sidebarOptions = {
  stops: {
    open: { min: 200, max: 400 },
    rail: 56,
    hidden: { size: 0, onlyByName: true },
  },
} satisfies TrackOptions;
const sidebar = track(sidebarOptions);

const at = (requested: number, current: string | null = null) =>
  land(sidebar, requested, current);

describe("parsing stops", () => {
  it("treats minSize/maxSize as one unnamed range", () => {
    const config = parseTrackOptions({ minSize: 100, maxSize: "50%" });
    expect(isNamed(config)).toBe(false);
    expect(resolveTrack(config, context)).toEqual([
      {
        name: UNNAMED,
        min: 100,
        max: 500,
        pull: 1,
        onlyByName: false,
        stretches: { larger: true, smaller: true },
        endsDrag: false,
      },
    ]);
  });

  it("reads endsDrag, off unless a stop asks for it", () => {
    const [closed, open] = track({
      stops: { closed: { size: 0, endsDrag: true }, open: { min: 100 } },
    });
    expect(closed.endsDrag).toBe(true);
    expect(open.endsDrag).toBe(false);
  });

  it("reads sizes, points and ranges", () => {
    expect(
      track({
        stops: {
          rail: "3.5rem",
          tall: { size: "10%", pull: 2 },
          open: { min: "12rem" },
        },
      }),
    ).toEqual([
      {
        name: "rail",
        min: 56,
        max: 56,
        pull: 1,
        onlyByName: false,
        stretches: { larger: false, smaller: false },
        endsDrag: false,
      },
      {
        name: "tall",
        min: 100,
        max: 100,
        pull: 2,
        onlyByName: false,
        stretches: { larger: false, smaller: false },
        endsDrag: false,
      },
      {
        name: "open",
        min: 192,
        max: Infinity,
        pull: 1,
        onlyByName: false,
        stretches: { larger: true, smaller: true },
        endsDrag: false,
      },
    ]);
  });

  it("checks the stop enterToggles names", () => {
    expect(
      parseTrackOptions({
        stops: { closed: 0, open: {} },
        enterToggles: "open",
      }).enterToggles,
    ).toBe("open");
    expect(() =>
      parseTrackOptions({ stops: { closed: 0 }, enterToggles: "rail" }),
    ).toThrow(/Unknown stop "rail"/);
    expect(parseTrackOptions({ minSize: 10 }).enterToggles).toBeNull();
  });

  it("rejects mixing forms, empty stops, empty names and bad pulls", () => {
    expect(() => parseTrackOptions({ minSize: 10, stops: { a: 0 } })).toThrow(
      /not both/,
    );
    expect(() => parseTrackOptions({ stops: {} })).toThrow(/at least one/);
    expect(() => parseTrackOptions({ stops: { "": 0 } })).toThrow(/name/);
    expect(() =>
      parseTrackOptions({ stops: { a: { size: 0, pull: 0 } } }),
    ).toThrow(/pull 0/);
    expect(() =>
      parseTrackOptions({ minSize: 10, wins: "both" as "min" }),
    ).toThrow(/wins is both/);
  });

  it("checks stop names", () => {
    const config = parseTrackOptions({ stops: { rail: 56, open: {} } });
    expect(checkStop(config, "rail")).toBe("rail");
    expect(() => checkStop(config, "nope")).toThrow(
      'Unknown stop "nope". Stops: "rail", "open".',
    );
  });
});

describe("resolving stops", () => {
  it("sorts by size whatever the written order, as the container changes", () => {
    const options = {
      stops: { wide: "20%", rail: "5rem" },
    } satisfies TrackOptions;
    const names = (containerSize: number) =>
      resolveTrack(parseTrackOptions(options), {
        containerSize,
        rootFontSize: 16,
        viewport: null,
      }).map((stop) => stop.name);
    expect(names(1000)).toEqual(["rail", "wide"]);
    expect(names(300)).toEqual(["wide", "rail"]);
  });

  it("lets a range's minimum win when its limits conflict", () => {
    expect(track({ minSize: 300, maxSize: "10%" })[0]).toMatchObject({
      min: 300,
      max: 300,
    });
  });

  it("lets the maximum win instead with wins: max", () => {
    expect(
      track({ minSize: 300, maxSize: ["500px", "10%"], wins: "max" })[0],
    ).toMatchObject({ min: 100, max: 100 });
    // Without a conflict, nothing changes.
    expect(
      track({ minSize: 50, maxSize: "10%", wins: "max" })[0],
    ).toMatchObject({ min: 50, max: 100 });
    // Every range in the track.
    expect(
      track({
        stops: { closed: 0, open: { min: 280, max: "20%" } },
        wins: "max",
      }),
    ).toMatchObject([
      { name: "closed", min: 0, max: 0 },
      { name: "open", min: 200, max: 200 },
    ]);
  });

  it("lets the maximum win over outside bounds too, with wins: max", () => {
    // A container's room below the range's minimum...
    expect(
      track({ minSize: 300, maxSize: 800 }, { min: 0, max: 200 })[0],
    ).toMatchObject({ min: 300, max: 300 });
    expect(
      track(
        { minSize: 300, maxSize: 800, wins: "max" },
        { min: 0, max: 200 },
      )[0],
    ).toMatchObject({ min: 200, max: 200 });
    // ...and children needing more than the range's maximum.
    expect(
      track(
        { minSize: 0, maxSize: 200, wins: "max" },
        { min: 300, max: 900 },
      )[0],
    ).toMatchObject({ min: 200, max: 200 });
  });

  it("clips ranges to outside bounds and pulls high points down", () => {
    const confined = track(
      { stops: { hidden: 0, big: 900, open: { min: 50, max: 800 } } },
      { min: 100, max: 600 },
    );
    expect(confined).toMatchObject([
      { name: "hidden", min: 0, max: 0 },
      { name: "open", min: 100, max: 600 },
      { name: "big", min: 600, max: 600 },
    ]);
  });
});

describe("landing a requested size", () => {
  it("keeps a size inside a stop as asked", () => {
    expect(at(300)).toEqual({ size: 300, stop: "open" });
  });

  it("divides a gap halfway by default", () => {
    // Between rail (56) and open (200): halfway is 128.
    expect(at(128)).toEqual({ size: 56, stop: "rail" });
    expect(at(129)).toEqual({ size: 200, stop: "open" });
  });

  it("divides a gap by pull", () => {
    const pulled = track({
      stops: { rail: { size: 56, pull: 3 }, open: { min: 200, max: 400 } },
    });
    // rail claims three quarters of the 144px gap: up to 164.
    expect(dividingPoint(pulled[0], pulled[1])).toBe(164);
    expect(land(pulled, 160, "open").stop).toBe("rail");
    expect(land(pulled, 170, "open").stop).toBe("open");
  });

  it("lands below or above every stop on the nearest edge", () => {
    expect(at(10)).toEqual({ size: 56, stop: "rail" });
    expect(at(900)).toEqual({ size: 400, stop: "open" });
  });

  it("never lands on a stop reached only by name, unless it's already there", () => {
    expect(at(0)).toEqual({ size: 56, stop: "rail" });
    expect(at(0, "hidden")).toEqual({ size: 0, stop: "hidden" });
    // Leaving it works like any other stop.
    expect(at(40, "hidden")).toEqual({ size: 56, stop: "rail" });
  });

  it("stretches past a range's edge with elastic, but not a point's", () => {
    const elastic = { distance: 16, tension: 0.8, afterSnap: false };
    const pulled = land(sidebar, 180, "open", elastic);
    expect(pulled.stop).toBe("open");
    expect(pulled.size).toBeLessThan(200);
    expect(pulled.size).toBeGreaterThan(190);
    expect(land(sidebar, 70, "rail", elastic)).toEqual({
      size: 56,
      stop: "rail",
    });
  });

  it("lands crisply after a snap, unless afterSnap", () => {
    const elastic = { distance: 16, tension: 0.8, afterSnap: false };
    const both = track({
      stops: { rail: { size: 56, elastic: true }, open: { min: 200 } },
    });
    // From the rail, past the gap's middle (128): open, at its edge.
    expect(land(both, 150, "rail", elastic)).toEqual({
      size: 200,
      stop: "open",
    });
    // From open, past the middle the other way: the rail, at its size.
    expect(land(both, 100, "open", elastic)).toEqual({
      size: 56,
      stop: "rail",
    });
    // Pulled past the edge of the stop it started in, it stretches.
    expect(land(both, 100, "rail", elastic).size).toBeGreaterThan(56);
    // And past the far edge of the stop it snapped to: from the rail, open
    // pushed past its maximum resists as ever.
    const capped = track({
      stops: {
        rail: { size: 56, elastic: true },
        open: { min: 200, max: 400 },
      },
    });
    const pushed = land(capped, 450, "rail", elastic);
    expect(pushed.stop).toBe("open");
    expect(pushed.size).toBeGreaterThan(400);
    // With afterSnap, it stretches back toward the pointer either way.
    const leaning = { ...elastic, afterSnap: true };
    expect(land(both, 150, "rail", leaning).size).toBeLessThan(200);
    expect(land(both, 100, "open", leaning).size).toBeGreaterThan(56);
  });

  it("tracks the stop a drag's pointer last reached", () => {
    const railed = track({
      stops: { rail: 56, open: { min: 192, max: 448 } },
    });
    // In the gap it was already in: unchanged.
    expect(reachedStop(railed, null, 56, 120, "rail")).toBe("rail");
    expect(reachedStop(railed, "rail", 120, 150, "rail")).toBe("rail");
    // Into open, or jumping right through it past its max: open.
    expect(reachedStop(railed, "rail", 150, 300, "rail")).toBe("open");
    expect(reachedStop(railed, "rail", 150, 600, "rail")).toBe("open");
    // Back into the gap: still open, until it reaches the rail.
    expect(reachedStop(railed, "open", 300, 150, "rail")).toBe("open");
    expect(reachedStop(railed, "open", 150, 40, "rail")).toBe("rail");
  });

  it("doesn't count a stop reached only by name as reached", () => {
    const closable = track({
      stops: { closed: { size: 0, onlyByName: true }, open: { min: 48 } },
    });
    // Past the edge, the pointer covers "closed", but can't go there.
    expect(reachedStop(closable, "open", 40, -10, "open")).toBe("open");
    // Unless it's in it already.
    expect(reachedStop(closable, null, 0, 20, "closed")).toBe("closed");
  });

  it("never stretches below 0", () => {
    const elastic = { distance: 16, tension: 0.8, afterSnap: false };
    const drawer = track({
      stops: { closed: { size: 0, elastic: true }, open: { min: 96 } },
    });
    expect(land(drawer, -100, "closed", elastic)).toEqual({
      size: 0,
      stop: "closed",
    });
  });

  it("stretches only the way a stop says", () => {
    const elastic = { distance: 16, tension: 0.8, afterSnap: false };
    const oneWay = track({
      stops: {
        hidden: { size: 0, onlyByName: true },
        rail: { size: 56, elastic: "larger" },
        open: { min: 200, max: 400, elastic: "smaller" },
      },
    });
    // The rail gives when pulled open, not when pushed toward the only-by-name
    // hidden stop a drag can't reach.
    expect(land(oneWay, 70, "rail", elastic).size).toBeGreaterThan(56);
    expect(land(oneWay, 40, "rail", elastic).size).toBe(56);
    // Open gives below its min, not past its max.
    expect(land(oneWay, 180, "open", elastic).size).toBeLessThan(200);
    expect(land(oneWay, 450, "open", elastic).size).toBe(400);
  });

  it("stretches at a point, or not at a range, when a stop says so", () => {
    const elastic = { distance: 16, tension: 0.8, afterSnap: false };
    const flipped = track({
      stops: {
        rail: { size: 56, elastic: true },
        open: { min: 200, max: 400, elastic: false },
      },
    });
    expect(land(flipped, 70, "rail", elastic).size).toBeGreaterThan(56);
    expect(land(flipped, 180, "open", elastic).size).toBe(200);
  });

  it("stays in the current stop while the size is inside it", () => {
    const nested = track({
      stops: { half: "50%", open: { min: 200, max: 800 } },
    });
    // Passing over the point inside the range doesn't land on it...
    expect(land(nested, 500, "open")).toEqual({ size: 500, stop: "open" });
    // ...but from elsewhere, the narrowest stop containing the size wins.
    expect(land(nested, 500, null)).toEqual({ size: 500, stop: "half" });
  });

  it("names overlapping ranges by the current one, then the narrowest", () => {
    const overlapping = track({
      stops: { a: { min: 100, max: 300 }, b: { min: 200, max: 600 } },
    });
    expect(land(overlapping, 250, "a").stop).toBe("a");
    expect(land(overlapping, 250, "b").stop).toBe("b");
    expect(land(overlapping, 350, "a").stop).toBe("b");
    expect(land(overlapping, 250, null).stop).toBe("a");
  });

  it("handles a point that drifts into a range as the container shrinks", () => {
    const options = {
      stops: { small: "5%", open: { min: 100, max: 300 } },
    } satisfies TrackOptions;
    const resolved = (containerSize: number) =>
      resolveTrack(parseTrackOptions(options), {
        containerSize,
        rootFontSize: 16,
        viewport: null,
      });
    // At 1000px, small is 50: a separate stop.
    expect(land(resolved(1000), 60, "open").stop).toBe("small");
    // At 4000px, small is 200: inside open, so a drag passes over it.
    expect(land(resolved(4000), 200, "open")).toEqual({
      size: 200,
      stop: "open",
    });
  });
});

describe("neighbouring stops", () => {
  const open = findStop(sidebar, "open")!;
  const rail = findStop(sidebar, "rail")!;

  it("finds the next reachable stop in each direction", () => {
    expect(nextStop(sidebar, open, -1)?.name).toBe("rail");
    expect(nextStop(sidebar, rail, 1)?.name).toBe("open");
    // hidden is only reached by name, so nothing is below the rail.
    expect(nextStop(sidebar, rail, -1)).toBeUndefined();
    expect(nextStop(sidebar, open, 1)).toBeUndefined();
  });

  it("knows whether a stop lies beyond", () => {
    expect(hasStopBeyond(sidebar, open, -1)).toBe(true);
    expect(hasStopBeyond(sidebar, open, 1)).toBe(false);
    expect(hasStopBeyond(sidebar, rail, -1)).toBe(false);
  });

  it("measures the reachable extent and the roomiest stop", () => {
    expect(reach(sidebar)).toEqual({ min: 56, max: 400 });
    expect(reach(sidebar, "hidden")).toEqual({ min: 0, max: 400 });
    expect(roomiest(sidebar).name).toBe("open");
  });
});

describe("contentSizeOf", () => {
  // The sidebar's open range remembers 300; others fall back to their min.
  const remembered = (range: Stop) => (range.name === "open" ? 300 : range.min);
  const config = parseTrackOptions(sidebarOptions);
  const sizeOf = (stop: string, size: number, back: string | null) =>
    contentSizeOf(config, sidebar, stop, size, back, remembered);

  it("is the size itself in a range", () => {
    expect(sizeOf("open", 250, null)).toBe(250);
  });

  it("is the range's size at a point: the last range, else the roomiest", () => {
    expect(sizeOf("rail", 56, "open")).toBe(300);
    expect(sizeOf("hidden", 0, null)).toBe(300);
  });

  it("is the size itself without any range", () => {
    const options = { stops: { small: 10, large: 20 } };
    expect(
      contentSizeOf(
        parseTrackOptions(options),
        track(options),
        "small",
        10,
        null,
        remembered,
      ),
    ).toBe(10);
  });

  it("goes back to a range whose limits have met", () => {
    // A narrow container: the open range's 10% maximum wins, at 100.
    const options = {
      stops: { closed: 0, open: { min: 200, max: "10%" } },
      wins: "max",
    } satisfies TrackOptions;
    const squeezed = track(options);
    expect(findStop(squeezed, "open")).toMatchObject({ min: 100, max: 100 });
    expect(
      contentSizeOf(
        parseTrackOptions(options),
        squeezed,
        "closed",
        0,
        "open",
        (range) => range.min,
      ),
    ).toBe(100);
  });
});

describe("contentStopOf", () => {
  const config = parseTrackOptions({
    stops: { hidden: 0, gone: "0%", rail: 56, open: { min: 0 } },
  });

  it("counts a point at 0 in any unit as zero, and nothing else", () => {
    expect(isZeroStop(config, "hidden")).toBe(true);
    expect(isZeroStop(config, "gone")).toBe(true);
    // A range that reaches 0 still has a size to show.
    expect(isZeroStop(config, "open")).toBe(false);
    expect(isZeroStop(config, "rail")).toBe(false);
    expect(isZeroStop(config, null)).toBe(false);
  });

  it("is the stop itself, unless that's a point at 0", () => {
    expect(contentStopOf(config, "rail", "open", "open")).toBe("rail");
    expect(contentStopOf(config, "open", "hidden", null)).toBe("open");
  });

  it("at 0, is the stop it came from, else where it would go back to", () => {
    expect(contentStopOf(config, "hidden", "rail", "open")).toBe("rail");
    expect(contentStopOf(config, "hidden", null, "open")).toBe("open");
    // Coming from another stop at 0 says nothing about the content.
    expect(contentStopOf(config, "hidden", "gone", "open")).toBe("open");
    expect(contentStopOf(config, "hidden", null, null)).toBe("hidden");
  });
});

describe("defaultOutsideStops", () => {
  const sidebar = parseTrackOptions({
    stops: {
      hidden: { size: 0, onlyByName: true },
      rail: 56,
      open: { min: 200, max: 400 },
    },
  });
  const outside = (config: typeof sidebar, size: SizeValue) =>
    defaultOutsideStops(config, parseSize(size));

  it("is a size in a gap, or beyond every stop", () => {
    expect(outside(sidebar, 150)).toBe(true);
    expect(outside(sidebar, 500)).toBe(true);
  });

  it("isn't a size in a range or on a point", () => {
    expect(outside(sidebar, 300)).toBe(false);
    expect(outside(sidebar, 56)).toBe(false);
  });

  it("skips stops reached only by name, which a default never lands on", () => {
    expect(outside(sidebar, 0)).toBe(true);
  });

  it("can't tell unless everything is in pixels", () => {
    expect(outside(sidebar, "10rem")).toBe(false);
    const relative = parseTrackOptions({
      stops: { rail: 56, open: { min: "20%" } },
    });
    expect(outside(relative, 150)).toBe(false);
  });

  it("covers minSize and maxSize too", () => {
    const range = parseTrackOptions({ minSize: 100, maxSize: 300 });
    expect(outside(range, 50)).toBe(true);
    expect(outside(range, 200)).toBe(false);
  });

  it("follows which limit wins when they conflict", () => {
    const conflicting = { minSize: 300, maxSize: 100 } as const;
    expect(outside(parseTrackOptions(conflicting), 100)).toBe(true);
    expect(
      outside(parseTrackOptions({ ...conflicting, wins: "max" }), 100),
    ).toBe(false);
  });
});
