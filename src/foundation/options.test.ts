import { describe, expect, it } from "vitest";

import { DEFAULT_ELASTIC } from "./limits.js";
import { parseCommonOptions } from "./options.js";

describe("parseCommonOptions", () => {
  it("turns elastic on by default, and off with false", () => {
    expect(parseCommonOptions({}).elastic).toEqual(DEFAULT_ELASTIC);
    expect(parseCommonOptions({ elastic: true }).elastic).toEqual(
      DEFAULT_ELASTIC,
    );
    expect(parseCommonOptions({ elastic: false }).elastic).toBeNull();
  });

  it("keeps the defaults for what a partial elastic leaves out", () => {
    expect(parseCommonOptions({ elastic: { distance: 24 } }).elastic).toEqual({
      ...DEFAULT_ELASTIC,
      distance: 24,
    });
    expect(parseCommonOptions({ elastic: { tension: 0.5 } }).elastic).toEqual({
      ...DEFAULT_ELASTIC,
      tension: 0.5,
    });
    expect(
      parseCommonOptions({ elastic: { afterSnap: true } }).elastic,
    ).toEqual({ ...DEFAULT_ELASTIC, afterSnap: true });
  });

  it("keeps the defaults for fields given as undefined (an optional prop passed on)", () => {
    const defaults = parseCommonOptions({});
    const parsed = parseCommonOptions({
      keyboard: { step: undefined, jump: undefined },
      elastic: { distance: undefined },
      transition: { changes: { stop: { duration: undefined } } },
    });
    expect(parsed.keyboard).toEqual(defaults.keyboard);
    expect(parsed.elastic).toEqual(defaults.elastic);
    expect(parsed.transition).toEqual(defaults.transition);
  });
});
