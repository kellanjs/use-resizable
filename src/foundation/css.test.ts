import { describe, expect, it } from "vitest";

import { cssClamp } from "./css.js";
import { parseBound, parseSize } from "./size.js";

describe("cssClamp", () => {
  const size = parseSize("22.5rem");
  const min = parseBound("17.5rem");
  const max = parseBound(["32.5rem", "90%"]);

  it("lets the min win a conflict, as clamp() does", () => {
    expect(cssClamp(size, min, max)).toBe(
      "clamp(17.5rem, 22.5rem, min(32.5rem, 90%))",
    );
  });

  it("lets the max win with wins: max", () => {
    expect(cssClamp(size, min, max, "max")).toBe(
      "min(max(17.5rem, 22.5rem), min(32.5rem, 90%))",
    );
  });

  it("uses only the bounds there are", () => {
    expect(cssClamp(size, min, undefined, "max")).toBe("max(17.5rem, 22.5rem)");
    expect(cssClamp(size, undefined, max)).toBe(
      "min(22.5rem, min(32.5rem, 90%))",
    );
    expect(cssClamp(size, undefined, undefined)).toBe("22.5rem");
  });
});
