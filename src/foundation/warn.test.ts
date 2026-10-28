// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWarnings, warnIfClipNotOver } from "./warn.js";

describe("warnIfClipNotOver", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetWarnings();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    document.body.replaceChildren();
  });

  /**
   * An element and a clip layer inside it, with the sizes the browser
   * would lay them out at (jsdom lays nothing out).
   */
  function layOut(
    element: { width: number; height: number },
    clip: { width: number; height: number },
  ) {
    const outer = document.createElement("div");
    const layer = document.createElement("div");
    outer.append(layer);
    document.body.append(outer);
    const set = (node: HTMLElement, props: Record<string, number>) => {
      for (const [key, value] of Object.entries(props)) {
        Object.defineProperty(node, key, { value, configurable: true });
      }
    };
    set(outer, { clientWidth: element.width, clientHeight: element.height });
    set(layer, { offsetWidth: clip.width, offsetHeight: clip.height });
    outer.getClientRects = () =>
      [{}] as unknown as ReturnType<Element["getClientRects"]>;
    return { outer, layer };
  }

  it("doesn't warn when the layer fills the element inside its borders", () => {
    const { outer, layer } = layOut(
      { width: 250, height: 600 },
      { width: 250, height: 600 },
    );
    warnIfClipNotOver(layer, outer);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when it fills something else, whatever made that a containing block", () => {
    const { outer, layer } = layOut(
      { width: 250, height: 600 },
      { width: 1200, height: 800 },
    );
    warnIfClipNotOver(layer, outer);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("isn't laid over its element"),
    );
  });

  it("doesn't warn for an element that isn't laid out", () => {
    const { outer, layer } = layOut(
      { width: 0, height: 0 },
      { width: 1200, height: 800 },
    );
    outer.getClientRects = () =>
      [] as unknown as ReturnType<Element["getClientRects"]>;
    warnIfClipNotOver(layer, outer);
    expect(warn).not.toHaveBeenCalled();
  });
});
