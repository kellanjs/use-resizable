import { describe, expect, it } from "vitest";

import {
  type SizeContext,
  type SizeValue,
  parseBound,
  parseSize,
  resolveMax,
  resolveMin,
  resolveSize,
  usesViewportUnits,
} from "./size.js";

const context: SizeContext = {
  containerSize: 1000,
  rootFontSize: 16,
  viewport: null,
};
const unmeasured: SizeContext = {
  containerSize: null,
  rootFontSize: 16,
  viewport: null,
};

describe("parseSize", () => {
  it.each([
    [240, { value: 240, unit: "px" }],
    [0, { value: 0, unit: "px" }],
    ["240px", { value: 240, unit: "px" }],
    ["12.5rem", { value: 12.5, unit: "rem" }],
    ["30%", { value: 30, unit: "%" }],
    [".5rem", { value: 0.5, unit: "rem" }],
  ] as const)("parses %j", (input, expected) => {
    expect(parseSize(input)).toEqual(expected);
  });

  it("tolerates surrounding whitespace from hand-written config", () => {
    expect(parseSize(" 20% " as SizeValue)).toEqual({ value: 20, unit: "%" });
  });

  it.each([
    "abc",
    "240",
    "px",
    "20 px",
    "-20px",
    "1e3px",
    "20em",
    "calc(20px)",
  ])("rejects %j", (input) => {
    expect(() => parseSize(input as SizeValue)).toThrow(/Invalid size/);
  });

  it.each([-1, Number.NaN, Infinity])("rejects the number %d", (input) => {
    expect(() => parseSize(input)).toThrow(/Invalid size/);
  });
});

describe("parseBound", () => {
  it("wraps a single size in a list", () => {
    expect(parseBound("20%")).toEqual([{ value: 20, unit: "%" }]);
  });

  it("parses every size in a list", () => {
    expect(parseBound([200, "10rem"])).toEqual([
      { value: 200, unit: "px" },
      { value: 10, unit: "rem" },
    ]);
  });

  it("rejects an empty list", () => {
    expect(() => parseBound([])).toThrow(/at least one value/);
  });
});

describe("resolveSize", () => {
  it("resolves each unit to pixels", () => {
    expect(resolveSize(parseSize(240), context)).toBe(240);
    expect(resolveSize(parseSize("2rem"), context)).toBe(32);
    expect(resolveSize(parseSize("25%"), context)).toBe(250);
  });

  it("uses the context's root font size for rem", () => {
    expect(
      resolveSize(parseSize("2rem"), { ...context, rootFontSize: 20 }),
    ).toBe(40);
  });

  it("returns null for a percentage while the container is unmeasured", () => {
    expect(resolveSize(parseSize("25%"), unmeasured)).toBeNull();
    expect(resolveSize(parseSize(240), unmeasured)).toBe(240);
  });

  it("treats a zero-size container as a real size", () => {
    expect(
      resolveSize(parseSize("25%"), { ...context, containerSize: 0 }),
    ).toBe(0);
  });
});

describe("resolveMin / resolveMax", () => {
  it("defaults to 0 and Infinity when there's no bound", () => {
    expect(resolveMin(undefined, context)).toBe(0);
    expect(resolveMax(undefined, context)).toBe(Infinity);
  });

  it("picks the tightest size in a list", () => {
    // min(28rem = 448px, 40% = 400px) and max(200px, 30% = 300px)
    expect(resolveMax(parseBound(["28rem", "40%"]), context)).toBe(400);
    expect(resolveMin(parseBound([200, "30%"]), context)).toBe(300);
  });

  it("ignores percentages until the container is measured", () => {
    expect(resolveMax(parseBound(["28rem", "40%"]), unmeasured)).toBe(448);
    expect(resolveMin(parseBound([200, "30%"]), unmeasured)).toBe(200);
    expect(resolveMin(parseBound("30%"), unmeasured)).toBe(0);
    expect(resolveMax(parseBound("30%"), unmeasured)).toBe(Infinity);
  });
});

describe("viewport units", () => {
  const withViewport: SizeContext = {
    ...context,
    viewport: { width: 1600, height: 900 },
  };

  it("parses vw and vh", () => {
    expect(parseSize("25vw")).toEqual({ value: 25, unit: "vw" });
    expect(parseSize("40vh")).toEqual({ value: 40, unit: "vh" });
  });

  it("resolves them against the viewport, once it's known", () => {
    expect(resolveSize(parseSize("25vw"), withViewport)).toBe(400);
    expect(resolveSize(parseSize("40vh"), withViewport)).toBe(360);
    expect(resolveSize(parseSize("25vw"), context)).toBeNull();
    expect(resolveMax(parseBound(["50vw", 600]), withViewport)).toBe(600);
  });

  it("finds them anywhere in parsed options", () => {
    expect(usesViewportUnits({ width: { min: [parseSize("20rem")] } })).toBe(
      false,
    );
    expect(
      usesViewportUnits({
        children: [{ stops: [{ min: parseSize("10vh") }] }],
      }),
    ).toBe(true);
  });
});
