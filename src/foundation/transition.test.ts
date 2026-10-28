import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSITION,
  parseTransition,
  transitionFor,
} from "./transition.js";

describe("parseTransition", () => {
  it("uses the defaults for every kind, or nothing with false", () => {
    const config = parseTransition(undefined);
    expect(config?.changes.stop).toEqual(DEFAULT_TRANSITION);
    expect(config?.changes.children).toEqual(DEFAULT_TRANSITION);
    expect(config?.reducedMotion).toBeNull();
    expect(parseTransition(true)).toEqual(config);
    expect(parseTransition(false)).toBeNull();
  });

  it("takes timing per kind of change, filling in from the base", () => {
    const config = parseTransition({
      duration: 300,
      changes: { stop: { duration: 600 }, keyboard: false },
    });
    expect(config?.changes.drag).toEqual({
      duration: 300,
      easing: DEFAULT_TRANSITION.easing,
    });
    expect(config?.changes.stop?.duration).toBe(600);
    expect(config?.changes.keyboard).toBeNull();
  });
});

describe("transitionFor", () => {
  const config = parseTransition({
    changes: { keyboard: false },
    reducedMotion: { duration: 100 },
  });

  it("picks the kind's transition, or none without a kind", () => {
    expect(transitionFor(config, "stop", false)).toEqual(DEFAULT_TRANSITION);
    expect(transitionFor(config, null, false)).toBeNull();
    expect(transitionFor(null, "stop", false)).toBeNull();
  });

  it("uses reducedMotion's transition when motion is reduced", () => {
    expect(transitionFor(config, "stop", true)?.duration).toBe(100);
    expect(transitionFor(parseTransition(true), "stop", true)).toBeNull();
  });

  it("keeps a kind that's off off, reduced motion or not", () => {
    expect(transitionFor(config, "keyboard", false)).toBeNull();
    expect(transitionFor(config, "keyboard", true)).toBeNull();
  });
});
