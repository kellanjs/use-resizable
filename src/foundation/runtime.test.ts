// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installResizeObserver } from "../../testing/dom.js";
import { lockCursor } from "./cursor-lock.js";
import { readKeyboardIntent } from "./keyboard.js";
import { observeSize } from "./observe-size.js";
import { refCallback } from "./ref-callback.js";
import { createStore } from "./store.js";

describe("createStore", () => {
  it("notifies subscribers of new values only", () => {
    const store = createStore({ size: 1 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const same = store.get();
    store.set(same);
    expect(listener).not.toHaveBeenCalled();

    store.set({ size: 2 });
    expect(listener).toHaveBeenCalledOnce();
    expect(store.get()).toEqual({ size: 2 });

    unsubscribe();
    store.set({ size: 3 });
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("refCallback", () => {
  const element = () => document.createElement("div");

  it("returns the cleanup, for React 19", () => {
    const detach = vi.fn();
    const ref = refCallback(() => detach);
    const cleanup = ref(element());
    expect(detach).not.toHaveBeenCalled();
    cleanup?.();
    expect(detach).toHaveBeenCalledOnce();
  });

  it("runs it when called with null, for React 18", () => {
    const detach = vi.fn();
    const ref = refCallback(() => detach);
    ref(element());
    ref(null);
    expect(detach).toHaveBeenCalledOnce();
  });

  it("runs each cleanup once, however it's asked", () => {
    const detach = vi.fn();
    const ref = refCallback(() => detach);
    const cleanup = ref(element());
    cleanup?.();
    ref(null);
    cleanup?.();
    expect(detach).toHaveBeenCalledOnce();
  });
});

describe("lockCursor", () => {
  const cursorStyle = () => document.head.querySelector("style")?.textContent;

  it("restores the previous lock when overlapping locks are released", () => {
    const releaseOuter = lockCursor("col-resize");
    const releaseInner = lockCursor("row-resize");
    expect(cursorStyle()).toContain("row-resize");

    releaseInner();
    expect(cursorStyle()).toContain("col-resize");

    releaseOuter();
    expect(cursorStyle()).toBeUndefined();
  });

  it("with no cursor, leaves cursors be but still blocks selection", () => {
    const release = lockCursor(null);
    expect(cursorStyle()).toContain("user-select: none");
    expect(cursorStyle()).not.toContain("cursor");
    release();
    expect(cursorStyle()).toBeUndefined();
  });

  it("ignores a second release of the same lock", () => {
    const releaseA = lockCursor("col-resize");
    const releaseB = lockCursor("col-resize");
    releaseA();
    releaseA();
    expect(cursorStyle()).toContain("col-resize");
    releaseB();
    expect(cursorStyle()).toBeUndefined();
  });
});

describe("observeSize", () => {
  let observer: ReturnType<typeof installResizeObserver>;
  beforeEach(() => {
    observer = installResizeObserver();
  });
  afterEach(() => observer.restore());

  it("reports size changes to every subscriber of an element", () => {
    const element = document.createElement("div");
    const first = vi.fn();
    const second = vi.fn();
    observeSize(element, first);
    observeSize(element, second);

    observer.resize(element, { width: 300, height: 200 });

    expect(first).toHaveBeenCalledWith({ width: 300, height: 200 });
    expect(second).toHaveBeenCalledWith({ width: 300, height: 200 });
  });

  it("gives late subscribers the last known size straight away", () => {
    const element = document.createElement("div");
    observeSize(element, () => {});
    observer.resize(element, { width: 300, height: 200 });

    const late = vi.fn();
    observeSize(element, late);
    expect(late).toHaveBeenCalledExactlyOnceWith({ width: 300, height: 200 });
  });

  it("stops observing once the last subscriber leaves", () => {
    const element = document.createElement("div");
    const stopA = observeSize(element, () => {});
    const stopB = observeSize(element, () => {});

    stopA();
    expect(observer.isObserved(element)).toBe(true);
    stopB();
    expect(observer.isObserved(element)).toBe(false);
  });

  it("does nothing where ResizeObserver doesn't exist", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    try {
      const callback = vi.fn();
      const stop = observeSize(document.createElement("div"), callback);
      expect(callback).not.toHaveBeenCalled();
      expect(stop).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("readKeyboardIntent", () => {
  it("maps arrows along the axis to a signed step", () => {
    expect(
      readKeyboardIntent({ key: "ArrowRight", shiftKey: false }, "horizontal"),
    ).toEqual({ kind: "move", delta: 10 });
    expect(
      readKeyboardIntent({ key: "ArrowLeft", shiftKey: true }, "horizontal"),
    ).toEqual({ kind: "move", delta: -50 });
    expect(
      readKeyboardIntent({ key: "ArrowDown", shiftKey: false }, "vertical"),
    ).toEqual({ kind: "move", delta: 10 });
  });

  it("ignores arrows across the axis", () => {
    expect(
      readKeyboardIntent({ key: "ArrowUp", shiftKey: false }, "horizontal"),
    ).toBeNull();
    expect(
      readKeyboardIntent({ key: "ArrowLeft", shiftKey: false }, "vertical"),
    ).toBeNull();
  });

  it("uses custom steps", () => {
    const steps = { step: 1, largeStep: 25 };
    expect(
      readKeyboardIntent({ key: "ArrowUp", shiftKey: true }, "vertical", steps),
    ).toEqual({ kind: "move", delta: -25 });
  });

  it("maps Home, End and Enter", () => {
    const read = (key: string) =>
      readKeyboardIntent({ key, shiftKey: false }, "horizontal");
    expect(read("Home")).toEqual({ kind: "min" });
    expect(read("End")).toEqual({ kind: "max" });
    expect(read("Enter")).toEqual({ kind: "toggle" });
    expect(read("a")).toBeNull();
  });
});
