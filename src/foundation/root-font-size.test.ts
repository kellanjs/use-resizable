// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRootFontSize,
  readRootFontSize,
  subscribeRootFontSize,
} from "./root-font-size.js";

// MutationObserver callbacks run as microtasks; wait for them to flush.
const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("root font size", () => {
  it("reads the computed font size of <html>", () => {
    document.documentElement.style.fontSize = "20px";
    expect(readRootFontSize()).toBe(20);
  });

  it("falls back to 16 when the computed value isn't usable", () => {
    document.documentElement.style.fontSize = "";
    vi.spyOn(window, "getComputedStyle").mockReturnValueOnce({
      fontSize: "",
    } as CSSStyleDeclaration);
    expect(readRootFontSize()).toBe(16);
  });

  it("notifies subscribers when the <html> style changes", async () => {
    document.documentElement.style.fontSize = "16px";
    const listener = vi.fn();
    const unsubscribe = subscribeRootFontSize(listener);

    document.documentElement.style.fontSize = "18px";
    await flushMutations();

    expect(listener).toHaveBeenCalledExactlyOnceWith(18);
    expect(getRootFontSize()).toBe(18);
    unsubscribe();
  });

  it("doesn't notify when the value is unchanged", async () => {
    document.documentElement.style.fontSize = "16px";
    const listener = vi.fn();
    const unsubscribe = subscribeRootFontSize(listener);

    document.documentElement.className = "theme-dark";
    await flushMutations();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    document.documentElement.className = "";
  });

  it("stops watching after the last subscriber leaves", async () => {
    document.documentElement.style.fontSize = "16px";
    const listener = vi.fn();
    subscribeRootFontSize(listener)();

    document.documentElement.style.fontSize = "18px";
    await flushMutations();

    expect(listener).not.toHaveBeenCalled();
    // Without a watcher the value is read on demand, so it's still current.
    expect(getRootFontSize()).toBe(18);
  });
});

describe("root font size, set by a rule", () => {
  it("notifies subscribers when a data- attribute on <html> changes it", async () => {
    const style = document.createElement("style");
    style.textContent =
      'html { font-size: 16px; } html[data-text-size="large"] { font-size: 20px; }';
    document.head.append(style);
    const listener = vi.fn();
    const unsubscribe = subscribeRootFontSize(listener);
    try {
      document.documentElement.dataset.textSize = "large";
      await flushMutations();
      expect(listener).toHaveBeenCalledExactlyOnceWith(20);
      expect(getRootFontSize()).toBe(20);
    } finally {
      unsubscribe();
      style.remove();
      delete document.documentElement.dataset.textSize;
    }
  });
});
