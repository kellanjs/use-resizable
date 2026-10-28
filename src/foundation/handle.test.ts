import { describe, expect, it } from "vitest";

import {
  anchorFactor,
  cursorFor,
  deriveHandles,
  edgeDirection,
  edgesOf,
  isCorner,
  keyboardCorner,
  physicalEdge,
} from "./handle.js";

describe("physicalEdge", () => {
  it.each([
    ["start", false, "left"],
    ["start", true, "right"],
    ["end", false, "right"],
    ["end", true, "left"],
    ["top-start", true, "top-right"],
    ["bottom-end", false, "bottom-right"],
    ["bottom-end", true, "bottom-left"],
    // Physical names stay as they are, either way.
    ["left", true, "left"],
    ["top", true, "top"],
    ["bottom-right", true, "bottom-right"],
  ] as const)("%s, right to left %s: %s", (edge, rtl, physical) => {
    expect(physicalEdge(edge, rtl)).toBe(physical);
  });
});

describe("deriveHandles", () => {
  it.each([
    ["left", null, ["right"]],
    ["right", null, ["left"]],
    [null, "bottom", ["top"]],
    ["left", "top", ["right", "bottom", "bottom-right"]],
    ["right", "bottom", ["left", "top", "top-left"]],
    [
      "center",
      "top",
      ["left", "right", "bottom", "bottom-left", "bottom-right"],
    ],
    [
      "center",
      "center",
      [
        "left",
        "right",
        "top",
        "bottom",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ],
    ],
  ] as const)("width %s, height %s → %j", (width, height, expected) => {
    expect(deriveHandles(width, height)).toEqual(expected);
  });
});

describe("handle geometry", () => {
  it("knows which edges a handle moves", () => {
    expect(edgesOf("right")).toEqual({ width: "right", height: null });
    expect(edgesOf("top-left")).toEqual({ width: "left", height: "top" });
    expect(isCorner("top-left")).toBe(true);
    expect(isCorner("top")).toBe(false);
  });

  it("knows which way each edge grows the element", () => {
    expect(edgeDirection("right")).toBe(1);
    expect(edgeDirection("bottom")).toBe(1);
    expect(edgeDirection("left")).toBe(-1);
    expect(edgeDirection("top")).toBe(-1);
  });

  it("doubles the size change for centre anchors", () => {
    expect(anchorFactor("center")).toBe(2);
    expect(anchorFactor("left")).toBe(1);
  });

  it("picks a cursor matching the direction", () => {
    expect(cursorFor("left")).toBe("ew-resize");
    expect(cursorFor("bottom")).toBe("ns-resize");
    expect(cursorFor("bottom-right")).toBe("nwse-resize");
    expect(cursorFor("bottom-left")).toBe("nesw-resize");
  });
});

describe("keyboardCorner", () => {
  const both = { width: true, height: true };

  it("is none while edge handles reach every dimension", () => {
    expect(keyboardCorner(deriveHandles("none", "none"), both, false)).toBe(
      null,
    );
    expect(keyboardCorner([], both, false)).toBe(null);
  });

  it("is the first corner when there are only corners", () => {
    const corners = ["bottom-left", "bottom-right"] as const;
    expect(keyboardCorner(corners, both, false)).toBe("bottom-left");
    // Ratio-locked: the corner sets the width, which the height follows.
    expect(keyboardCorner(corners, { width: true, height: false }, true)).toBe(
      "bottom-left",
    );
  });

  it("is a corner that moves a dimension no edge does", () => {
    // The right edge reaches the width; only the corner, the height.
    expect(keyboardCorner(["right", "bottom-right"], both, false)).toBe(
      "bottom-right",
    );
    // Ratio-locked, the right edge reaches both.
    expect(
      keyboardCorner(
        ["right", "bottom-right"],
        { width: true, height: false },
        true,
      ),
    ).toBe(null);
    // A height that doesn't resize needs no route.
    expect(
      keyboardCorner(
        ["right", "bottom-right"],
        { width: true, height: false },
        false,
      ),
    ).toBe(null);
  });
});
