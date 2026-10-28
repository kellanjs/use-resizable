import { describe, expect, it } from "vitest";

import { recordFromStops, recordPreviousStops } from "./previous-stops.js";

interface State {
  previousStops: Readonly<Record<string, string>>;
  fromStops: Readonly<Record<string, string | null>> | null;
  stops: Record<string, string | null>;
}

const state = (
  stops: State["stops"],
  previousStops: State["previousStops"] = {},
): State => ({ stops, previousStops, fromStops: null });
const stopsOf = (s: State) => s.stops;

describe("recordPreviousStops", () => {
  it("records the stop each part left", () => {
    const before = state({ width: "open", height: "tall" });
    const after = recordPreviousStops(
      before,
      state({ width: "rail", height: "tall" }),
      stopsOf,
    );
    expect(after.previousStops).toEqual({ width: "open" });
  });

  it("returns the same state when no stop changed", () => {
    const after = state({ width: "open" }, { width: "rail" });
    expect(recordPreviousStops(state({ width: "open" }), after, stopsOf)).toBe(
      after,
    );
  });

  it("doesn't count leaving no stop (before measurement)", () => {
    const after = recordPreviousStops(
      state({ width: null }),
      state({ width: "open" }),
      stopsOf,
    );
    expect(after.previousStops).toEqual({});
  });

  it("keeps the other parts' previous stops", () => {
    const after = recordPreviousStops(
      state({ a: "open", b: "x" }, { b: "y" }),
      state({ a: "closed", b: "x" }, { b: "y" }),
      stopsOf,
    );
    expect(after.previousStops).toEqual({ a: "open", b: "y" });
  });
});

describe("recordFromStops", () => {
  interface Changing extends State {
    drag: object | null;
    animating: boolean;
  }
  const changing = (
    stops: State["stops"],
    { drag = null as object | null, animating = false } = {},
    fromStops: State["fromStops"] = null,
  ): Changing => ({ ...state(stops), drag, animating, fromStops });

  it("records the stops a drag starts from, through its release", () => {
    const pressed = recordFromStops(
      changing({ width: "open" }),
      changing({ width: "open" }, { drag: {} }),
      stopsOf,
      false,
    );
    expect(pressed.fromStops).toEqual({ width: "open" });
    // Through another stop, and released into a settle: still the drag's.
    const passing = recordFromStops(
      pressed,
      { ...pressed, stops: { width: "rail" } },
      stopsOf,
      false,
    );
    const settling = recordFromStops(
      passing,
      { ...passing, drag: null, animating: true },
      stopsOf,
      false,
    );
    expect(settling.fromStops).toEqual({ width: "open" });
  });

  it("starts afresh with an animated change, and clears when it's over", () => {
    const before = changing(
      { width: "closed" },
      { animating: true },
      { width: "open" },
    );
    const opening = recordFromStops(
      before,
      { ...before, stops: { width: "open" } },
      stopsOf,
      true,
    );
    expect(opening.fromStops).toEqual({ width: "closed" });
    const over = recordFromStops(
      opening,
      { ...opening, animating: false },
      stopsOf,
      false,
    );
    expect(over.fromStops).toBeNull();
  });

  it("keeps where a part began when an interrupting change leaves its stop", () => {
    // The editor is opening from closed; links then closes, at once.
    const opening = changing(
      { editor: "open", links: "open" },
      { animating: true },
      { editor: "closed", links: "open" },
    );
    const closing = recordFromStops(
      opening,
      { ...opening, stops: { editor: "open", links: "closed" } },
      stopsOf,
      true,
    );
    expect(closing.fromStops).toEqual({ editor: "closed", links: "open" });
  });

  it("starts afresh for every part when a drag interrupts", () => {
    const opening = changing(
      { editor: "open", links: "open" },
      { animating: true },
      { editor: "closed", links: "open" },
    );
    const pressed = recordFromStops(
      opening,
      { ...opening, drag: {} },
      stopsOf,
      false,
    );
    expect(pressed.fromStops).toEqual({ editor: "open", links: "open" });
  });
});
