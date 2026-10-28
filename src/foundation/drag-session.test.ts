// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installAnimationFrames,
  installPointerCapture,
  keyDown,
  pointer,
} from "../../testing/dom.js";
import { type DragSessionOptions, startDragSession } from "./drag-session.js";

let frames: ReturnType<typeof installAnimationFrames>;
let restoreCapture: () => void;
let handle: HTMLElement;

beforeEach(() => {
  frames = installAnimationFrames();
  restoreCapture = installPointerCapture();
  handle = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  frames.restore();
  restoreCapture();
});

function setup(
  options: Pick<DragSessionOptions, "threshold" | "cursor"> = {},
  x = 100,
  y = 100,
) {
  const callbacks = {
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
  };
  const down = new PointerEvent("pointerdown", {
    clientX: x,
    clientY: y,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    cancelable: true,
  });
  const stop = startDragSession(down, handle, { ...options, ...callbacks });
  return { ...callbacks, down, stop };
}

describe("startDragSession", () => {
  it("ignores secondary buttons and non-primary pointers", () => {
    const right = new PointerEvent("pointerdown", {
      button: 2,
      isPrimary: true,
    });
    const second = new PointerEvent("pointerdown", {
      button: 0,
      isPrimary: false,
    });
    const options = { onMove: vi.fn(), onEnd: vi.fn(), onCancel: vi.fn() };

    expect(startDragSession(right, handle, options)).toBeNull();
    expect(startDragSession(second, handle, options)).toBeNull();
  });

  it("captures the pointer and prevents the default action", () => {
    const { down } = setup();
    expect(down.defaultPrevented).toBe(true);
    expect(handle.hasPointerCapture(1)).toBe(true);
  });

  it("reports total movement from the down point, once per frame", () => {
    const { onStart, onMove } = setup();

    pointer(window, "pointermove", { x: 110, y: 100 });
    pointer(window, "pointermove", { x: 130, y: 95 });
    expect(onStart).toHaveBeenCalledOnce();
    expect(onMove).not.toHaveBeenCalled();

    frames.flushFrame();
    expect(onMove).toHaveBeenCalledExactlyOnceWith(30, -5);
  });

  it("waits for the threshold before starting", () => {
    const { onStart, onMove } = setup({ threshold: 5 });

    pointer(window, "pointermove", { x: 103, y: 102 });
    frames.flushFrame();
    expect(onStart).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();

    pointer(window, "pointermove", { x: 105, y: 100 });
    frames.flushFrame();
    expect(onStart).toHaveBeenCalledOnce();
    // Movement is still measured from the down point, so the edge catches up
    // with the pointer instead of lagging behind it.
    expect(onMove).toHaveBeenCalledWith(5, 0);
  });

  it("ignores other pointers", () => {
    const { onMove, onEnd } = setup();

    pointer(window, "pointermove", { x: 150, pointerId: 2 });
    pointer(window, "pointerup", { pointerId: 2 });
    frames.flushFrame();

    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("applies the last movement before ending", () => {
    const { onMove, onEnd } = setup();

    pointer(window, "pointermove", { x: 140, y: 100 });
    pointer(window, "pointerup", { x: 140, y: 100 });

    expect(onMove).toHaveBeenCalledExactlyOnceWith(40, 0);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onMove.mock.invocationCallOrder[0]).toBeLessThan(
      onEnd.mock.invocationCallOrder[0],
    );
    expect(handle.hasPointerCapture(1)).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it("doesn't report anything for a click without movement", () => {
    const { onStart, onEnd, onCancel } = setup();
    pointer(window, "pointerup");

    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape without applying pending movement", () => {
    const { onMove, onEnd, onCancel } = setup();
    pointer(window, "pointermove", { x: 140 });

    const escape = keyDown(document.body, "Escape");

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(true);
  });

  it.each(["pointercancel", "lostpointercapture", "blur"] as const)(
    "ends when the browser interrupts with %s",
    (type) => {
      const { onEnd } = setup();
      pointer(window, "pointermove", { x: 140 });

      if (type === "pointercancel") pointer(window, type);
      else if (type === "lostpointercapture") {
        handle.dispatchEvent(new PointerEvent(type, { pointerId: 1 }));
      } else window.dispatchEvent(new Event("blur"));

      expect(onEnd).toHaveBeenCalledOnce();
    },
  );

  it("stops listening after it ends", () => {
    const { onMove, onEnd } = setup();
    pointer(window, "pointermove", { x: 140 });
    pointer(window, "pointerup");

    pointer(window, "pointermove", { x: 200 });
    pointer(window, "pointerup");
    frames.flushFrame();

    expect(onMove).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("can be stopped silently by its owner", () => {
    const { onEnd, onCancel, stop } = setup();
    pointer(window, "pointermove", { x: 140 });

    stop?.();
    pointer(window, "pointerup");

    expect(onEnd).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(frames.pending).toBe(0);
  });

  it("locks the cursor while dragging", () => {
    setup({ cursor: "col-resize" });
    const lockStyle = () =>
      [...document.head.querySelectorAll("style")].find((style) =>
        style.textContent?.includes("col-resize"),
      );

    expect(lockStyle()).toBeUndefined();
    pointer(window, "pointermove", { x: 140 });
    expect(lockStyle()).toBeDefined();
    pointer(window, "pointerup");
    expect(lockStyle()).toBeUndefined();
  });
});
