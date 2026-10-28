import { describe, expect, it } from "vitest";

import { createLimits, stretch } from "./limits.js";

const elastic = { distance: 20, tension: 0.5 };

describe("createLimits", () => {
  it("lets min win when the bounds conflict", () => {
    expect(createLimits(300, 100)).toEqual({ min: 300, max: 300 });
  });

  it("lets max win when told to", () => {
    expect(createLimits(300, 100, "max")).toEqual({ min: 100, max: 100 });
    expect(createLimits(100, 300, "max")).toEqual({ min: 100, max: 300 });
  });
});

describe("stretch", () => {
  it("starts at (1 - tension) × the pointer's movement", () => {
    expect(stretch(0.001, elastic)).toBeCloseTo(0.0005, 6);
  });

  it("grows with the overshoot but never reaches the limit", () => {
    const small = stretch(10, elastic);
    const large = stretch(1000, elastic);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(20);
    expect(stretch(1e9, elastic)).toBeCloseTo(20, 3);
  });

  it("doesn't move with tension 1, a zero limit, or no overshoot", () => {
    expect(stretch(50, { distance: 20, tension: 1 })).toBe(0);
    expect(stretch(50, { distance: 0, tension: 0.5 })).toBe(0);
    expect(stretch(0, elastic)).toBe(0);
    expect(stretch(-5, elastic)).toBe(0);
  });

  it("treats out-of-range tension as the nearest valid value", () => {
    expect(stretch(50, { distance: 20, tension: 2 })).toBe(0);
    expect(stretch(50, { distance: 20, tension: -1 })).toBe(
      stretch(50, { distance: 20, tension: 0 }),
    );
  });
});
