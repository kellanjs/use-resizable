import { describe, expect, it } from "vitest";

import { holdsContent, mayDepart, withHeldContent } from "./held-content.js";

const state = (
  reflow: "live" | "once",
  { drag = null as object | null, animating = false, held = true } = {},
) => ({
  config: { reflow },
  drag,
  animating,
  heldContent: held ? {} : null,
});

describe("holdsContent", () => {
  it("holds reflowing once, through a drag or an animated change", () => {
    expect(holdsContent(state("once", { drag: {} }))).toBe(true);
    expect(holdsContent(state("once", { animating: true }))).toBe(true);
    // Neither going on, nothing held, or reflowing live: it doesn't.
    expect(holdsContent(state("once"))).toBe(false);
    expect(holdsContent(state("once", { drag: {}, held: false }))).toBe(false);
    expect(holdsContent(state("live", { drag: {} }))).toBe(false);
  });
});

describe("mayDepart", () => {
  it("is an animated change, not a drag, with content kept", () => {
    expect(mayDepart(state("live", { animating: true }))).toBe(true);
    expect(mayDepart(state("once", { animating: true }))).toBe(true);
    expect(mayDepart(state("live"))).toBe(false);
    expect(mayDepart(state("live", { drag: {} }))).toBe(false);
    expect(mayDepart(state("live", { animating: true, held: false }))).toBe(
      false,
    );
  });
});

describe("withHeldContent", () => {
  const live = { contentSize: 200, contentStop: "rail", size: 56 };
  const held = { contentSize: 300, contentStop: "open" };
  const once = (dragging: boolean) => ({
    holding: true,
    dragging,
    departing: false,
    continuing: false,
  });

  it("is exactly what was held through a drag", () => {
    expect(withHeldContent(live, held, once(true))).toEqual({
      ...live,
      ...held,
    });
  });

  it("is the larger size, at the new stop, through an animated change", () => {
    expect(withHeldContent(live, held, once(false))).toEqual({
      ...live,
      contentSize: 300,
    });
    expect(
      withHeldContent({ ...live, contentSize: 400 }, held, once(false))
        .contentSize,
    ).toBe(400);
    expect(withHeldContent(live, null, once(false))).toBe(live);
  });

  it("is what's live when not holding or departing", () => {
    const how = {
      holding: false,
      dragging: false,
      departing: false,
      continuing: false,
    };
    expect(withHeldContent(live, held, how)).toBe(live);
  });

  describe("carrying on through an interrupting change", () => {
    const how = {
      holding: false,
      dragging: false,
      departing: false,
      continuing: true,
    };
    // Opening (laid out at 511), then taken to 1022 before it's open.
    const live = { contentSize: 1022, contentStop: "open", size: 1022 };
    const held = { contentSize: 511, contentStop: "open", interrupted: true };

    it("is the size it was laid out at, not where the change ends", () => {
      expect(withHeldContent(live, held, how).contentSize).toBe(511);
    });

    it("isn't for a change that interrupted nothing, or doesn't move it", () => {
      expect(withHeldContent(live, { ...held, interrupted: false }, how)).toBe(
        live,
      );
      expect(withHeldContent(live, held, { ...how, continuing: false })).toBe(
        live,
      );
    });
  });

  describe("departing", () => {
    const how = {
      holding: false,
      dragging: false,
      departing: true,
      continuing: false,
    };

    it("is the size it had, at the new stop, smaller or not", () => {
      // Squeezed to 270 by a drag, it would reopen at 400.
      const closed = { contentSize: 400, contentStop: "open", size: 0 };
      const squeezed = { contentSize: 270, contentStop: "open" };
      expect(withHeldContent(closed, squeezed, how)).toEqual({
        ...closed,
        contentSize: 270,
      });
      expect(withHeldContent(live, held, how)).toEqual({
        ...live,
        contentSize: 300,
      });
    });

    it("isn't smaller than the point it goes to", () => {
      // Fixed sizes only: from 100 to 500.
      const large = { contentSize: 500, contentStop: "large", size: 500 };
      const small = { contentSize: 100, contentStop: "small" };
      expect(withHeldContent(large, small, how).contentSize).toBe(500);
    });

    it("goes before holding, reflowing once", () => {
      const closed = { contentSize: 400, contentStop: "open", size: 0 };
      const squeezed = { contentSize: 270, contentStop: "open" };
      expect(
        withHeldContent(closed, squeezed, { ...how, holding: true })
          .contentSize,
      ).toBe(270);
    });
  });
});
