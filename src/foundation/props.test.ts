import { describe, expect, it } from "vitest";

import { contentStyle, contentVariable } from "./props.js";

describe("contentStyle", () => {
  it("is at least the element's size, along the axes it's given", () => {
    expect(contentStyle({ width: true, height: false }, false)).toEqual({
      width: "max(100%, var(--resizable-content-width, 100%))",
      height: undefined,
      flexShrink: 0,
      contain: undefined,
    });
  });

  it("is exactly the content size while a drag holds it, painted alone", () => {
    expect(contentStyle({ width: true, height: true }, true)).toEqual({
      width: "var(--resizable-content-width, 100%)",
      height: "var(--resizable-content-height, 100%)",
      flexShrink: 0,
      contain: "paint",
    });
  });
});

describe("contentVariable", () => {
  it("is initial while it's just the size, unless told to give it", () => {
    expect(contentVariable(300, 300, false)).toBe("initial");
    expect(contentVariable(300, 300, true)).toBe("300px");
    expect(contentVariable(300, 56, false)).toBe("300px");
    expect(contentVariable(null, null, true)).toBe("initial");
  });
});
