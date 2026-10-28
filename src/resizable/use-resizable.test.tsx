// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, act, useLayoutEffect, useRef, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  installAnimationFrames,
  installPointerCapture,
  installResizeObserver,
  installViewport,
  keyDown,
  pointer,
} from "../../testing/dom.js";
import { memoryStorage } from "../../testing/storage.js";
import type { HandleEdge } from "../foundation/handle.js";
import { resetWarnings } from "../foundation/warn.js";
import type { ResizableSnapshot } from "./resizable-config.js";
import {
  createResizableController,
  createResizableControllerWithState,
} from "./resizable-controller.js";
import type { ResizableDimension } from "./resizable-view.js";
import {
  type Resizable,
  type ResizableOf,
  type UseResizableOptions,
  createResizableRemote,
  useResizable,
} from "./use-resizable.js";

let frames: ReturnType<typeof installAnimationFrames>;
let observer: ReturnType<typeof installResizeObserver>;
let restoreCapture: () => void;

beforeEach(() => {
  frames = installAnimationFrames();
  observer = installResizeObserver();
  restoreCapture = installPointerCapture();
});

afterEach(() => {
  frames.restore();
  observer.restore();
  restoreCapture();
});

const sidebar: UseResizableOptions = {
  anchor: "left",
  width: {
    defaultSize: 250,
    stops: { closed: 0, open: { min: 200, max: 400 } },
  },
  elastic: false,
};

let latest: Resizable;

/** Hands the hook's latest result to the test, outside of render. */
function useExpose(resizable: Resizable) {
  useLayoutEffect(() => {
    latest = resizable;
  });
}

function Box({
  showHandles = true,
  ...options
}: UseResizableOptions & { showHandles?: boolean }) {
  const resizable = useResizable(options);
  useExpose(resizable);
  return (
    <div data-testid="container">
      <div data-testid="element" {...resizable.getElementProps()}>
        {showHandles &&
          resizable.handles.map((edge) => (
            <div
              key={edge}
              data-testid={`handle-${edge}`}
              {...resizable.getHandleProps(edge)}
              aria-label={`Resize ${edge}`}
            />
          ))}
      </div>
    </div>
  );
}

function setup(props: Parameters<typeof Box>[0] = sidebar) {
  const result = render(<Box {...props} />);
  measureContainer();
  return result;
}

function measureContainer(width = 1000, height = 800) {
  act(() =>
    observer.resize(screen.getByTestId("container"), { width, height }),
  );
}

const element = () => screen.getByTestId("element");
const handle = (edge: HandleEdge = "right") =>
  screen.getByTestId(`handle-${edge}`);

function dragHandle(
  edge: HandleEdge,
  dx: number,
  dy = 0,
  { release = true } = {},
) {
  act(() => {
    pointer(handle(edge), "pointerdown", { x: 500, y: 500 });
    pointer(window, "pointermove", { x: 500 + dx, y: 500 + dy });
    frames.flushFrame();
  });
  if (release) {
    act(() => void pointer(window, "pointerup", { x: 500 + dx, y: 500 + dy }));
  }
}

describe("drag callbacks", () => {
  it("reports drags starting and ending, cancelled or not", () => {
    const events: string[] = [];
    setup({
      ...sidebar,
      onDragStart: (target) => void events.push(`start ${target}`),
      onDragEnd: (target, { cancelled }) =>
        void events.push(`end ${target}${cancelled ? " cancelled" : ""}`),
    });
    dragHandle("right", 40);
    dragHandle("right", 40, 0, { release: false });
    act(() => keyDown(window, "Escape"));
    expect(events).toEqual([
      "start right",
      "end right",
      "start right",
      "end right cancelled",
    ]);
  });

  it("reports a drag something else dropped as cancelled, and lets go of the pointer", () => {
    const events: string[] = [];
    setup({
      ...sidebar,
      onDragEnd: (target, { cancelled }) =>
        void events.push(`end ${target}${cancelled ? " cancelled" : ""}`),
    });
    dragHandle("right", 40, 0, { release: false });
    const locked = () =>
      [...document.head.querySelectorAll("style")].some((style) =>
        style.textContent?.includes("ew-resize"),
      );
    expect(locked()).toBe(true);
    act(() => latest.reset());
    // Ended there and then, not on the pointer's next move.
    expect(events).toEqual(["end right cancelled"]);
    expect(locked()).toBe(false);
    act(() => {
      pointer(window, "pointermove", { x: 560, y: 500 });
      frames.flushFrame();
    });
    expect(events).toEqual(["end right cancelled"]);
    expect(latest.width?.size).toBe(250);
    // And a new drag works.
    dragHandle("right", 20);
    expect(latest.width?.size).toBe(270);
  });

  it("ignores a second pointer while one is dragging", () => {
    const onDragEnd = vi.fn();
    const { unmount } = setup({ ...sidebar, onDragEnd });
    const locked = () =>
      [...document.head.querySelectorAll("style")].some((style) =>
        style.textContent?.includes("cursor"),
      );
    act(() => {
      pointer(handle(), "pointerdown", { x: 500, y: 500 });
      // A second finger: not primary, so it can't start a drag of its own,
      // and mustn't take the first one's place.
      pointer(handle(), "pointerdown", {
        x: 500,
        y: 500,
        pointerId: 2,
        isPrimary: false,
      });
      pointer(window, "pointermove", { x: 540, y: 500 });
      frames.flushFrame();
    });
    expect(latest.width?.size).toBe(290);
    expect(locked()).toBe(true);
    // Unmounting mid-drag still ends the first finger's session.
    unmount();
    expect(locked()).toBe(false);
    expect(onDragEnd).toHaveBeenCalledWith("right", { cancelled: true });
  });

  it("doesn't report a press that never became a drag", () => {
    const onDragStart = vi.fn();
    setup({ ...sidebar, onDragStart });
    act(() => {
      pointer(handle(), "pointerdown", { x: 500, y: 500 });
      pointer(window, "pointerup", { x: 500, y: 500 });
    });
    expect(onDragStart).not.toHaveBeenCalled();
  });
});

describe("animating and hiding", () => {
  it("ends an animation when a change that doesn't animate lands on it", () => {
    // Resizes by setSize don't animate here; a close does.
    setup({ ...sidebar, transition: { changes: { size: false } } });
    act(() => latest.setStop("closed"));
    expect(latest.animating).toBe(true);
    act(() => latest.setSize({ width: 300 }));
    expect(element().style.transition).toBe("");
    expect(latest.animating).toBe(false);
    expect(element().dataset.animating).toBeUndefined();
  });

  it("animates a close, then hides the element but not its handles", () => {
    setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => latest.setStop("closed"));
      expect(latest.animating).toBe(true);
      expect(element().dataset.animating).toBe("");
      expect(element().style.visibility).toBe("");

      act(() => void vi.advanceTimersByTime(450));
      expect(latest.animating).toBe(false);
      expect(element().dataset.animating).toBeUndefined();
      expect(element().style.visibility).toBe("hidden");
      expect(handle().style.visibility).toBe("visible");

      // Opening shows it at once, to animate.
      act(() => latest.setStop("open"));
      expect(element().style.visibility).toBe("");
      expect(handle().style.visibility).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the range size on the element as a CSS variable", () => {
    setup();
    // `initial` while it's just the size (see contentVariable).
    expect(latest.width?.contentSize).toBe(250);
    expect(element().style.getPropertyValue("--resizable-content-width")).toBe(
      "initial",
    );
    act(() => latest.setStop("closed"));
    expect(latest.width?.contentSize).toBe(250);
    expect(element().style.getPropertyValue("--resizable-content-width")).toBe(
      "250px",
    );
  });

  it("ends an animation that restore lands on, showing the snapshot at once", () => {
    setup();
    const closed = {
      version: 2 as const,
      width: { stop: "closed", sizes: {}, lastRange: null },
    };
    act(() => latest.setSize({ width: 300 }));
    expect(latest.animating).toBe(true);
    act(() => latest.restore(closed));
    expect(element().style.transition).toBe("");
    expect(latest.animating).toBe(false);
    expect(element().style.visibility).toBe("hidden");
  });

  it("doesn't animate with transition: false, so hides at once", () => {
    setup({ ...sidebar, transition: false });
    act(() => latest.setStop("closed"));
    expect(latest.animating).toBe(false);
    expect(element().style.visibility).toBe("hidden");
  });
});

describe("stops that end drags", () => {
  it("stops following the pointer once the drag ends there", () => {
    const changes: unknown[] = [];
    setup({
      anchor: "left",
      width: {
        defaultSize: 250,
        stops: { closed: { size: 0, endsDrag: true }, open: { min: 200 } },
      },
      onChange: (snapshot) => void changes.push(snapshot),
    });
    act(() => {
      pointer(handle(), "pointerdown", { x: 500, y: 500 });
      pointer(window, "pointermove", { x: 300, y: 500 });
      frames.flushFrame();
    });
    expect(latest.width?.stop).toBe("closed");
    expect(latest.dragging).toBeNull();
    expect(changes).toHaveLength(1);

    // The rest of the gesture does nothing.
    act(() => {
      pointer(window, "pointermove", { x: 800, y: 500 });
      frames.flushFrame();
      pointer(window, "pointerup", { x: 800, y: 500 });
    });
    expect(latest.width?.stop).toBe("closed");
    expect(latest.width?.size).toBe(0);
    expect(changes).toHaveLength(1);
  });
});

describe("useResizable as a sidebar", () => {
  it("renders CSS from the specs until the container is measured", () => {
    render(
      <Box
        {...sidebar}
        width={{ ...sidebar.width!, defaultSize: "25%", defaultStop: "open" }}
      />,
    );
    // Its stop is known, so the server HTML clamps to that stop's range.
    expect(element().style.width).toBe("clamp(200px, 25%, 400px)");
    expect(latest.width?.size).toBeNull();

    measureContainer();
    expect(element().style.width).toBe("250px");
    expect(latest.width?.size).toBe(250);
  });

  it("offers one handle, on the free edge", () => {
    setup();
    expect(latest.handles).toEqual(["right"]);
  });

  it("anchors at the start side, which follows the element's direction", () => {
    render(<Box {...sidebar} anchor="start" />);
    measureContainer();
    // Left to right, the start is the left.
    expect(latest.handles).toEqual(["right"]);
    expect(latest.getHandleProps("end")["data-handle"]).toBe("right");

    // Right to left, it's the right: the handle is on the left, and
    // dragging it left widens the sidebar.
    element().style.direction = "rtl";
    measureContainer(1001);
    expect(latest.handles).toEqual(["left"]);
    expect(latest.getHandleProps("end")["data-handle"]).toBe("left");
    dragHandle("left", -60);
    expect(latest.width?.size).toBe(310);
  });

  it("drives what a logical handle is at the press, right after a flip", () => {
    function EndHandle() {
      const resizable = useResizable({ ...sidebar, anchor: "start" });
      useExpose(resizable);
      return (
        <div data-testid="container">
          <div data-testid="element" {...resizable.getElementProps()}>
            <div
              data-testid="end"
              {...resizable.getHandleProps("end")}
              aria-label="Resize"
            />
          </div>
        </div>
      );
    }
    render(<EndHandle />);
    measureContainer();
    // Flipped, with nothing measured since: the first press finds out, and
    // still drives the end edge, now the left.
    element().style.direction = "rtl";
    act(() => {
      pointer(screen.getByTestId("end"), "pointerdown", { x: 500, y: 500 });
      pointer(window, "pointermove", { x: 440, y: 500 });
      frames.flushFrame();
    });
    act(() => void pointer(window, "pointerup", { x: 440, y: 500 }));
    expect(latest.width?.size).toBe(310);
  });

  it("measures a custom container instead of the parent", () => {
    function WithContainer() {
      const containerRef = useRef<HTMLDivElement>(null);
      const resizable = useResizable({
        ...sidebar,
        width: { ...sidebar.width!, defaultSize: "50%" },
        containerRef,
      });
      useExpose(resizable);
      return (
        <div ref={containerRef} data-testid="outer">
          <div data-testid="parent">
            <div {...resizable.getElementProps()} />
          </div>
        </div>
      );
    }
    render(<WithContainer />);
    act(() =>
      observer.resize(screen.getByTestId("parent"), { width: 400, height: 0 }),
    );
    // The parent isn't the container, so its size doesn't count.
    expect(latest.width?.size).toBeNull();
    act(() =>
      observer.resize(screen.getByTestId("outer"), { width: 600, height: 0 }),
    );
    expect(latest.width?.size).toBe(300);
  });

  it("follows a container ref that comes to point elsewhere", () => {
    function Switching({ outer }: { outer: "a" | "b" }) {
      const a = useRef<HTMLDivElement>(null);
      const b = useRef<HTMLDivElement>(null);
      const resizable = useResizable({
        ...sidebar,
        width: { ...sidebar.width!, defaultSize: "50%" },
        containerRef: outer === "a" ? a : b,
      });
      useExpose(resizable);
      return (
        <div ref={b} data-testid="b">
          <div ref={a} data-testid="a">
            <div {...resizable.getElementProps()} />
          </div>
        </div>
      );
    }
    const { rerender } = render(<Switching outer="a" />);
    act(() =>
      observer.resize(screen.getByTestId("a"), { width: 400, height: 0 }),
    );
    expect(latest.width?.size).toBe(200);
    rerender(<Switching outer="b" />);
    act(() =>
      observer.resize(screen.getByTestId("b"), { width: 800, height: 0 }),
    );
    expect(latest.width?.size).toBe(400);
  });

  it("sets no cursors with cursor: false", () => {
    setup({ ...sidebar, cursor: false });
    expect(handle().style.cursor).toBe("");
    dragHandle("right", 80, 0, { release: false });
    const page = document.head.querySelector("style")?.textContent;
    expect(page).toContain("user-select: none");
    expect(page).not.toContain("cursor");
    act(() => void pointer(window, "pointerup", { x: 580, y: 500 }));
  });

  it("resizes while dragging and reports only the committed result", () => {
    const onChange = vi.fn();
    setup({ ...sidebar, onChange });

    dragHandle("right", 80, 0, { release: false });
    expect(element().style.width).toBe("330px");
    expect(element().dataset.dragging).toBe("right");
    expect(handle().dataset.dragging).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    act(() => void pointer(window, "pointerup", { x: 580, y: 500 }));
    expect(element().dataset.dragging).toBeUndefined();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      {
        version: 2,
        width: {
          stop: "open",
          sizes: { open: { value: 330, unit: "px" } },
          lastRange: "open",
        },
      } satisfies ResizableSnapshot,
      { cause: "drag" },
    );
  });

  it("animates the release but not the drag itself", () => {
    setup();
    dragHandle("right", 80, 0, { release: false });
    expect(element().style.transition).toBe("");
    act(() => void pointer(window, "pointerup", { x: 580, y: 500 }));
    expect(element().style.transition).toContain("width");
  });

  it("restores the original size on Escape", () => {
    const onChange = vi.fn();
    setup({ ...sidebar, onChange });
    dragHandle("right", 80, 0, { release: false });

    act(() => void keyDown(document.body, "Escape"));
    expect(element().style.width).toBe("250px");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("snaps to another stop when dragged far enough, and exposes it", () => {
    setup();
    expect(latest.width?.stop).toBe("open");
    dragHandle("right", -200);
    expect(element().style.width).toBe("0px");
    expect(latest.width?.stop).toBe("closed");
    expect(element().dataset.widthStop).toBe("closed");
    expect(handle().dataset.stop).toBe("closed");
  });

  it("exposes its stops in pixels once measured", () => {
    render(<Box {...sidebar} />);
    expect(latest.width?.stops).toBeNull();
    measureContainer();
    expect(latest.width?.stops).toEqual({
      closed: { min: 0, max: 0 },
      open: { min: 200, max: 400 },
    });
  });

  it("lets a maximum below the minimum win with wins: max", () => {
    const narrow = (wins?: "max"): UseResizableOptions => ({
      ...sidebar,
      width: {
        defaultSize: "25%",
        defaultStop: "open",
        stops: { closed: 0, open: { min: 200, max: [400, "50%"] } },
        wins,
      },
    });
    const { unmount } = render(<Box {...narrow()} />);
    measureContainer(300);
    expect(latest.width?.size).toBe(200);
    unmount();

    render(<Box {...narrow("max")} />);
    // Before measuring too, in the CSS.
    expect(element().style.width).toBe("min(max(200px, 25%), min(400px, 50%))");
    measureContainer(300);
    expect(latest.width?.size).toBe(150);
    expect(latest.width?.stops?.open).toEqual({ min: 150, max: 150 });
    measureContainer(1000);
    expect(latest.width?.size).toBe(250);
  });

  it("marks the element, and a handle whose dimension is, at zero", () => {
    setup();
    expect(handle().dataset.zero).toBeUndefined();
    expect(element().dataset.zero).toBeUndefined();
    dragHandle("right", -200);
    expect(handle().dataset.zero).toBe("");
    expect(element().dataset.zero).toBe("");
  });

  it("remembers the previous stop, through drags and setStop", () => {
    setup();
    expect(latest.width?.previousStop).toBeNull();
    dragHandle("right", -200, 0, { release: false });
    // Mid-drag, the stop it passes through counts.
    expect(latest.width?.stop).toBe("closed");
    expect(latest.width?.previousStop).toBe("open");
    act(() => void pointer(window, "pointerup", { x: 300, y: 500 }));
    act(() => latest.setStop("open"));
    expect(latest.width?.previousStop).toBe("closed");
  });

  it("shows the content of the stop it came from while at zero", () => {
    setup({
      anchor: "left",
      width: {
        defaultSize: 240,
        defaultStop: "open",
        stops: { hidden: { size: 0, onlyByName: true }, rail: 48, open: {} },
      },
    });
    const content = () => [latest.width?.contentStop, latest.width?.fromStop];
    expect(content()).toEqual(["open", null]);
    act(() => latest.setStop("rail"));
    expect(content()).toEqual(["rail", "open"]);
    // At 0, the rail's content leaves with it.
    act(() => latest.setStop("hidden"));
    expect(latest.width?.stop).toBe("hidden");
    expect(content()).toEqual(["rail", "rail"]);
    // Out of 0, nothing was showing.
    act(() => latest.setStop("open"));
    expect(content()).toEqual(["open", "hidden"]);
    act(() => latest.setStop("hidden"));
    expect(content()).toEqual(["open", "open"]);
  });

  it("says which stop the change in progress began in", () => {
    setup({ ...sidebar, elastic: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(latest.width?.fromStop).toBeNull();
      act(() => latest.setStop("closed"));
      expect(latest.width?.fromStop).toBe("open");
      act(() => void vi.advanceTimersByTime(450));
      expect(latest.width?.fromStop).toBeNull();
      act(() => latest.setStop("open"));
      expect(latest.width?.fromStop).toBe("closed");
      act(() => void vi.advanceTimersByTime(450));
      expect(latest.width?.fromStop).toBeNull();

      // Pulled below the minimum and let go: it settles back from "open",
      // though its previous stop is still "closed" (what tells a settle
      // from a reopening).
      dragHandle("right", -80, 0, { release: false });
      expect(latest.width?.fromStop).toBe("open");
      act(() => void pointer(window, "pointerup", { x: 420, y: 500 }));
      expect(latest.animating).toBe(true);
      expect(latest.width?.previousStop).toBe("closed");
      expect(latest.width?.fromStop).toBe("open");
      act(() => void vi.advanceTimersByTime(450));
      expect(latest.width?.fromStop).toBeNull();

      // A change interrupting another starts afresh, from the stop it's in.
      act(() => latest.setStop("closed"));
      act(() => latest.setStop("open"));
      expect(latest.width?.fromStop).toBe("closed");
      // A drag through a stop keeps where it began.
      act(() => void vi.advanceTimersByTime(450));
      dragHandle("right", -300, 0, { release: false });
      expect(latest.width?.stop).toBe("closed");
      expect(latest.width?.fromStop).toBe("open");
      // Released already at 0, nothing settles: the change is over.
      act(() => void pointer(window, "pointerup", { x: 200, y: 500 }));
      expect(latest.width?.fromStop).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starting at zero, shows the content it would open to", () => {
    setup({
      anchor: "left",
      width: { defaultStop: "hidden", stops: { hidden: 0, open: {} } },
    });
    expect(latest.width?.contentStop).toBe("open");
    expect(latest.width?.fromStop).toBeNull();
  });

  it("puts the latest change's timing on the element", () => {
    setup({ ...sidebar, transition: { changes: { stop: { duration: 250 } } } });
    const style = () => element().style;
    expect(style().getPropertyValue("--resizable-duration")).toBe("0ms");
    act(() => latest.setStop("closed"));
    expect(style().getPropertyValue("--resizable-duration")).toBe("250ms");
    // While dragging, a drag's own timing (the default here).
    dragHandle("right", 300, 0, { release: false });
    expect(style().getPropertyValue("--resizable-duration")).toBe("400ms");
  });

  it("resizes from the keyboard", () => {
    const onChange = vi.fn();
    setup({ ...sidebar, onChange });

    act(() => void keyDown(handle(), "ArrowRight"));
    expect(element().style.width).toBe("260px");
    act(() => void keyDown(handle(), "Enter"));
    expect(latest.width?.stop).toBe("closed");
    expect(onChange.mock.calls.map(([, change]) => change)).toEqual([
      { cause: "keyboard" },
      { cause: "keyboard" },
    ]);
  });

  it("keeps aria-valuenow within its min and max while stretched", () => {
    setup({ ...sidebar, elastic: true });
    dragHandle("right", 300, 0, { release: false });
    expect(latest.width?.size).toBeGreaterThan(400);
    expect(handle().getAttribute("aria-valuenow")).toBe("400");
  });

  it("exposes separator semantics on the handle", () => {
    setup({ ...sidebar, id: "sidebar" });
    const el = handle();
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-controls")).toBe("sidebar");
    expect(element().id).toBe("sidebar");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-valuenow")).toBe("250");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    expect(el.getAttribute("aria-valuemax")).toBe("400");
    expect(el.tabIndex).toBe(0);
    expect(el.style.touchAction).toBe("none");
    expect(el.style.cursor).toBe("ew-resize");
    expect(el.dataset.handle).toBe("right");
  });

  it("wires up a handle that mounts after the element", () => {
    function Late() {
      const [visible, setVisible] = useState(false);
      return (
        <>
          <button onClick={() => setVisible(true)}>show</button>
          <Box {...sidebar} showHandles={visible} />
        </>
      );
    }
    render(<Late />);
    measureContainer();
    fireEvent.click(screen.getByText("show"));

    dragHandle("right", 50);
    expect(element().style.width).toBe("300px");
  });

  it("works under StrictMode's double mount", () => {
    render(
      <StrictMode>
        <Box {...sidebar} />
      </StrictMode>,
    );
    measureContainer();
    dragHandle("right", 50);
    expect(element().style.width).toBe("300px");
  });

  it("controls the element in code; restore doesn't report a change", () => {
    const onChange = vi.fn();
    setup({ ...sidebar, onChange });

    act(() => latest.setSize({ width: "30%" }));
    expect(element().style.width).toBe("300px");
    act(() => latest.setStop("closed"));
    expect(element().style.width).toBe("0px");
    act(() => latest.toggle("closed"));
    expect(element().style.width).toBe("300px");
    expect(onChange.mock.calls.map(([, change]) => change.cause)).toEqual([
      "size",
      "stop",
      "stop",
    ]);

    act(() =>
      latest.restore({
        version: 2,
        width: {
          stop: "open",
          sizes: { open: { value: 220, unit: "px" } },
          lastRange: "open",
        },
      }),
    );
    expect(element().style.width).toBe("220px");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("ignores input while disabled", () => {
    setup({ ...sidebar, disabled: true });
    dragHandle("right", 80);
    act(() => void keyDown(handle(), "ArrowRight"));
    expect(element().style.width).toBe("250px");
    // A press does nothing, the browser's text selection included.
    expect(pointer(handle(), "pointerdown").defaultPrevented).toBe(true);
    expect(handle().getAttribute("aria-disabled")).toBe("true");
    expect(handle().tabIndex).toBe(-1);
  });

  it("renders its CSS sizes where ResizeObserver doesn't exist", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    try {
      render(<Box {...sidebar} />);
      expect(element().style.width).toBe("250px");
      expect(latest.width?.size).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops observing the container on unmount", () => {
    const { unmount } = setup();
    const container = screen.getByTestId("container");
    unmount();
    expect(observer.isObserved(container)).toBe(false);
  });
});

describe("useResizable in two dimensions", () => {
  const image: UseResizableOptions = {
    anchor: "top-left",
    width: { defaultSize: 400, minSize: 100 },
    height: { defaultSize: 300, minSize: 50 },
    elastic: false,
  };

  it("sizes both dimensions and offers edge and corner handles", () => {
    setup(image);
    expect(element().style.width).toBe("400px");
    expect(element().style.height).toBe("300px");
    expect(latest.handles).toEqual(["right", "bottom", "bottom-right"]);
  });

  it("resizes both dimensions from a corner", () => {
    setup(image);
    dragHandle("bottom-right", 40, 25);
    expect(element().style.width).toBe("440px");
    expect(element().style.height).toBe("325px");
  });

  it("keeps corner handles out of the tab order and accessibility tree", () => {
    setup(image);
    const corner = handle("bottom-right");
    expect(corner.tabIndex).toBe(-1);
    expect(corner.getAttribute("aria-hidden")).toBe("true");
    expect(corner.getAttribute("role")).toBeNull();
    expect(handle("bottom").getAttribute("aria-orientation")).toBe(
      "horizontal",
    );
  });

  it("gives a corner the keyboard when only corners resize a dimension", () => {
    setup({ ...image, handles: ["bottom-right"] });
    const corner = handle("bottom-right");
    expect(corner.tabIndex).toBe(0);
    expect(corner.getAttribute("role")).toBe("slider");
    expect(corner.getAttribute("aria-hidden")).toBeNull();
    expect(corner.getAttribute("aria-valuenow")).toBe("400");
    // Two values, and no ARIA control for two: both in its text.
    expect(corner.getAttribute("aria-valuetext")).toBe(
      "width 400 pixels, height 300 pixels",
    );
    // Its arrows move its edges, as a drag would.
    act(() => void keyDown(corner, "ArrowRight"));
    expect(element().style.width).toBe("410px");
    act(() => void keyDown(corner, "ArrowDown"));
    expect(element().style.height).toBe("310px");
    act(() => void keyDown(corner, "Home"));
    expect(latest.width?.size).toBe(100);
  });

  it("gives a ratio-locked image's first corner the keyboard, for its width", () => {
    setup({
      anchor: "top",
      width: { defaultSize: 320, minSize: 100 },
      aspectRatio: 4 / 3,
      handles: ["bottom-left", "bottom-right"],
      elastic: false,
    });
    const first = handle("bottom-left");
    expect(first.getAttribute("role")).toBe("slider");
    expect(first.tabIndex).toBe(0);
    expect(first.getAttribute("aria-valuenow")).toBe("320");
    // One tab stop: the other corner does the same.
    expect(handle("bottom-right").tabIndex).toBe(-1);
    expect(handle("bottom-right").getAttribute("aria-hidden")).toBe("true");
    // Centred, so both sides move: twice the step.
    act(() => void keyDown(first, "ArrowLeft"));
    expect(latest.width?.size).toBe(340);
    act(() => void keyDown(first, "ArrowDown"));
    expect(latest.width?.size).toBeGreaterThan(340);
    // Keys on the other corner do nothing.
    const width = latest.width?.size;
    act(() => void keyDown(handle("bottom-right"), "ArrowRight"));
    expect(latest.width?.size).toBe(width);
  });

  it("grows from both sides when centre-anchored", () => {
    setup({ ...image, anchor: "center" });
    expect(latest.handles).toHaveLength(8);
    dragHandle("left", -20);
    expect(element().style.width).toBe("440px");
  });

  it("sets a stop only on the dimension that has it", () => {
    setup({
      ...image,
      height: { defaultSize: 300, stops: { bar: 40, open: { min: 50 } } },
    });
    act(() => latest.setStop("bar"));
    expect(element().style.height).toBe("40px");
    expect(element().style.width).toBe("400px");
    expect(element().dataset.heightStop).toBe("bar");
    expect(element().dataset.widthStop).toBeUndefined();
  });
});

describe("your own styles", () => {
  it("merges a getter's style over the library's, key by key", () => {
    setup();
    const style = latest.getElementProps({
      style: { background: "red", flexShrink: 1 },
    }).style;
    expect(style).toMatchObject({ background: "red", flexShrink: 1 });
    expect(style.width).toBe("250px");

    const handleStyle = latest.getHandleProps("right", {
      style: { cursor: "grab", position: "absolute" },
    }).style;
    expect(handleStyle).toMatchObject({
      cursor: "grab",
      position: "absolute",
      touchAction: "none",
    });
    expect(
      latest.getMoveHandleProps({ style: { cursor: "grab" } }).style.cursor,
    ).toBe("grab");
  });

  it("marks the move handle as a handle", () => {
    setup();
    expect(latest.getMoveHandleProps()["data-handle"]).toBe("move");
  });
});

describe("return types", () => {
  it("narrows width and height to the configured dimensions", () => {
    // Type-level only: checked by tsc, never called.
    function useTypes() {
      const sidebar = useResizable({
        anchor: "left",
        width: { defaultSize: 240 },
      });
      expectTypeOf(sidebar.width).toEqualTypeOf<ResizableDimension<never>>();
      expectTypeOf(sidebar.height).toEqualTypeOf<null>();

      const options: UseResizableOptions = {
        anchor: "left",
        width: { defaultSize: 240 },
      };
      const unknown = useResizable(options);
      expectTypeOf(unknown.width).toEqualTypeOf<ResizableDimension | null>();

      // Only a floating element has a position, and then always.
      expectTypeOf(sidebar.position).toEqualTypeOf<null>();
      const floating = useResizable({
        anchor: "none",
        width: { defaultSize: 240 },
      });
      expectTypeOf(floating.position).toEqualTypeOf<{
        x: number | null;
        y: number | null;
      }>();
      expectTypeOf(unknown.position).toEqualTypeOf<Resizable["position"]>();
    }
    expect(useTypes).toBeTypeOf("function");
  });
});

describe("useResizable with a locked aspect ratio", () => {
  it("sets the width and lets CSS aspect-ratio size the height", () => {
    setup({
      anchor: "top-left",
      width: { defaultSize: 320 },
      aspectRatio: 16 / 9,
      elastic: false,
    });
    expect(element().style.width).toBe("320px");
    expect(element().style.height).toBe("auto");
    expect(element().style.aspectRatio).toContain("1.777");
    expect(latest.height?.size).toBe(180);

    dragHandle("bottom", 0, 90);
    expect(element().style.width).toBe("480px");
    expect(handle("bottom").getAttribute("aria-valuenow")).toBe("270");
  });

  it("keeps the opposite corner when a ratio-locked corner takes the keys", () => {
    setup({
      anchor: "none",
      width: { defaultSize: 200 },
      aspectRatio: 2,
      defaultPosition: { x: 100, y: 100 },
      handles: ["top-left"],
      elastic: false,
      transition: false,
    });
    const farEdges = () => ({
      right: (latest.position?.x ?? 0) + (latest.width?.size ?? 0),
      bottom: (latest.position?.y ?? 0) + (latest.height?.size ?? 0),
    });
    for (const key of ["ArrowUp", "ArrowLeft"]) {
      act(() => void keyDown(handle("top-left"), key));
      expect(farEdges()).toEqual({ right: 300, bottom: 200 });
    }
  });
});

describe("useResizable positioned (anchor: none)", () => {
  const floating: UseResizableOptions = {
    anchor: "none",
    width: { defaultSize: 300, minSize: 200 },
    height: { defaultSize: 200, minSize: 100 },
    defaultPosition: { x: 100, y: 50 },
    confine: "container",
    elastic: false,
  };

  function Window() {
    const resizable = useResizable(floating);
    useExpose(resizable);
    return (
      <div data-testid="container">
        <div data-testid="element" {...resizable.getElementProps()}>
          <div
            data-testid="title"
            {...resizable.getMoveHandleProps()}
            aria-label="Move"
          />
          {resizable.handles.map((edge) => (
            <div
              key={edge}
              data-testid={`handle-${edge}`}
              {...resizable.getHandleProps(edge)}
              aria-label={`Resize ${edge}`}
            />
          ))}
        </div>
      </div>
    );
  }

  function dragTitle(dx: number, dy: number) {
    const title = screen.getByTestId("title");
    act(() => {
      pointer(title, "pointerdown", { x: 0, y: 0 });
      pointer(window, "pointermove", { x: dx, y: dy });
      frames.flushFrame();
    });
    act(() => void pointer(window, "pointerup", { x: dx, y: dy }));
  }

  it("renders its position as left/top", () => {
    render(<Window />);
    measureContainer();
    expect(element().style.position).toBe("absolute");
    expect(element().style.left).toBe("100px");
    expect(element().style.top).toBe("50px");
    expect(latest.position).toEqual({ x: 100, y: 50 });
  });

  it("moves by its move handle, staying inside the container", () => {
    render(<Window />);
    measureContainer();
    dragTitle(40, 30);
    expect(element().style.left).toBe("140px");
    expect(element().style.top).toBe("80px");

    dragTitle(-1000, 0);
    expect(element().style.left).toBe("0px");
  });

  it("moves with arrow keys on the move handle", () => {
    render(<Window />);
    measureContainer();
    act(() => void keyDown(screen.getByTestId("title"), "ArrowDown"));
    expect(element().style.top).toBe("60px");
  });

  it("keeps the right edge still when resizing from the left", () => {
    render(<Window />);
    measureContainer();
    dragHandle("left", -50);
    expect(element().style.left).toBe("50px");
    expect(element().style.width).toBe("350px");
  });
});

describe("useResizable with named stops", () => {
  const railed: UseResizableOptions = {
    anchor: "left",
    width: {
      defaultSize: 250,
      stops: {
        hidden: { size: 0, onlyByName: true },
        rail: 48,
        open: { min: 200, max: 400 },
      },
    },
    elastic: false,
  };

  it("goes to a stop by name, and toggles back to where it was", () => {
    setup(railed);
    act(() => latest.setStop("rail"));
    expect(element().style.width).toBe("48px");
    expect(latest.width).toMatchObject({ size: 48, stop: "rail" });
    expect(element().dataset.widthStop).toBe("rail");
    expect(handle().dataset.stop).toBe("rail");

    act(() => latest.setStop("hidden"));
    expect(element().style.width).toBe("0px");
    expect(element().dataset.widthStop).toBe("hidden");

    // Hidden from the rail: back to the rail, then the rail to open.
    act(() => latest.toggle("hidden"));
    expect(latest.width?.stop).toBe("rail");
    act(() => latest.toggle("rail"));
    expect(element().style.width).toBe("250px");
    expect(latest.width?.stop).toBe("open");
  });

  it("types stop names from the options", () => {
    // Type-level only: checked by tsc, never called.
    function useTypes() {
      const sidebar = useResizable({
        anchor: "left",
        width: { defaultSize: 240, stops: { rail: 48, open: { min: 200 } } },
      });
      expectTypeOf(sidebar.width.stop).toEqualTypeOf<"rail" | "open" | null>();
      sidebar.setStop("rail");
      // @ts-expect-error: not one of this sidebar's stops
      sidebar.setStop("tiny");

      const plain = useResizable({
        anchor: "left",
        width: { defaultSize: 240 },
      });
      expectTypeOf(plain.width.stop).toEqualTypeOf<null>();

      useResizable({
        anchor: "left",
        // @ts-expect-error: needs a defaultSize or a defaultStop
        width: { stops: { rail: 48 } },
      });
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("keeps its types through a hook of your own, or named options", () => {
    // Type-level only (see Types in the README).
    function useSidebar() {
      return useResizable({
        anchor: "left",
        width: { defaultSize: 240, stops: { rail: 48, open: { min: 200 } } },
      });
    }
    const options = {
      anchor: "left",
      handles: ["right"],
      width: { defaultSize: 240, stops: { rail: 48, open: { min: 200 } } },
    } as const satisfies UseResizableOptions;
    function useTypes() {
      const sidebar: ReturnType<typeof useSidebar> = useSidebar();
      expectTypeOf(sidebar.width.stop).toEqualTypeOf<"rail" | "open" | null>();
      const named: ResizableOf<typeof options> = useResizable(options);
      expectTypeOf(named.width.stop).toEqualTypeOf<"rail" | "open" | null>();
      // Still plain resizables.
      expectTypeOf(sidebar).toExtend<Resizable>();
      expectTypeOf(named).toExtend<Resizable>();
      // A remote in named options too, checked where they're used.
      const remote = createResizableRemote<typeof options>();
      const withRemote = { ...options, remote } satisfies UseResizableOptions;
      useResizable(withRemote);
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("reports the reachable sizes as the handle's range", () => {
    setup(railed);
    // hidden is only reached by name, so the smallest size a user can reach is the rail.
    expect(handle().getAttribute("aria-valuemin")).toBe("48");
    expect(handle().getAttribute("aria-valuetext")).toBe("open, 250 pixels");
    expect(handle().getAttribute("aria-valuemax")).toBe("400");
  });

  it("leaves handles out of the tab order with keyboard: false", () => {
    setup({ ...sidebar, keyboard: false });
    expect(handle().tabIndex).toBe(-1);
    act(() => keyDown(handle(), "ArrowRight"));
    expect(latest.width?.size).toBe(250);
  });

  it("words the value with valueText", () => {
    setup({
      ...railed,
      valueText: ({ dimension, stop, size }) =>
        `${dimension}: ${stop} (${size} px)`,
    });
    expect(handle().getAttribute("aria-valuetext")).toBe(
      "width: open (250 px)",
    );
  });

  it("has no stop attributes without named stops", () => {
    setup({ anchor: "left", width: { defaultSize: 250, minSize: 200 } });
    expect(latest.width?.stop).toBeNull();
    expect(element().dataset.widthStop).toBeUndefined();
    expect(handle().dataset.stop).toBeUndefined();
  });

  it("keeps arrows in their stop with keyboard.jump off, beside one it overlaps", () => {
    setup({
      anchor: "left",
      width: {
        defaultStop: "small",
        defaultSize: 200,
        stops: { small: { min: 100, max: 200 }, large: { min: 190, max: 400 } },
      },
      keyboard: { jump: false },
      elastic: false,
      transition: false,
    });
    act(() => void keyDown(handle("right"), "ArrowRight"));
    expect(latest.width).toMatchObject({ stop: "small", size: 200 });
  });

  it("types setStop's stop by the dimension it's given", () => {
    function useTypes() {
      const box = useResizable({
        anchor: "top-left",
        width: { defaultSize: 240, stops: { rail: 48, wide: { min: 100 } } },
        height: { defaultSize: 200, stops: { bar: 24, tall: { min: 80 } } },
      });
      box.setStop("rail");
      box.setStop("bar", "height");
      // @ts-expect-error: a width stop, for the height
      box.setStop("rail", "height");
      // @ts-expect-error: a height stop, for the width
      box.toggle("bar", "width");
      const video = useResizable({
        anchor: "top-left",
        width: { defaultSize: 320, stops: { small: 320, big: 640 } },
        aspectRatio: 16 / 9,
      });
      // A ratio-locked height's stops are the width's.
      video.setStop("small", "height");
    }
    // Options typed to allow any stops (a wrapper's): any name.
    function useWrapper(options: UseResizableOptions) {
      const box = useResizable(options);
      box.setStop("open");
      box.setStop("open", "width");
      box.toggle("rail", "height");
      createResizableRemote<UseResizableOptions>().current?.setStop(
        "open",
        "height",
      );
    }
    expect(useTypes).toBeTypeOf("function");
    expect(useWrapper).toBeTypeOf("function");
  });
});

describe("useResizable persistence", () => {
  const at = (value: number) => ({
    version: 2,
    width: {
      stop: "open",
      sizes: { open: { value, unit: "px" } },
      lastRange: "open",
    },
  });
  const defaults = {
    version: 2,
    width: { stop: null, sizes: {}, lastRange: null },
  };
  const closable: UseResizableOptions = { ...sidebar, transition: false };

  it("restores the saved snapshot on mount and saves committed changes", () => {
    const { storage, saved } = memoryStorage({ sidebar: at(320) });
    setup({ ...sidebar, persist: { key: "sidebar", storage } });
    expect(element().style.width).toBe("320px");

    dragHandle("right", 30, 0, { release: false });
    expect(saved("sidebar")).toEqual(at(320));
    act(() => void pointer(window, "pointerup", { x: 530, y: 500 }));
    expect(saved("sidebar")).toEqual(at(350));
  });

  it("doesn't overwrite the saved snapshot under StrictMode", () => {
    const { storage, saved } = memoryStorage({ sidebar: at(320) });
    render(
      <StrictMode>
        <Box {...sidebar} persist={{ key: "sidebar", storage }} />
      </StrictMode>,
    );
    measureContainer();
    expect(element().style.width).toBe("320px");
    expect(saved("sidebar")).toEqual(at(320));
  });

  it("ignores saved data that isn't a snapshot", () => {
    const { storage } = memoryStorage({ sidebar: { width: 320 } });
    setup({ ...sidebar, persist: { key: "sidebar", storage } });
    expect(element().style.width).toBe("250px");
  });

  it("switches to another key's snapshot, or the defaults", () => {
    const onChange = vi.fn();
    const { storage, saved } = memoryStorage({
      a: at(320),
      b: { version: 2, width: { stop: "closed", sizes: {}, lastRange: null } },
    });
    const props = { ...sidebar, onChange };
    const { rerender } = setup({ ...props, persist: { key: "a", storage } });
    expect(element().style.width).toBe("320px");
    // The first load is where the state starts: no change to report.
    expect(onChange).not.toHaveBeenCalled();

    rerender(<Box {...props} persist={{ key: "b", storage }} />);
    expect(element().style.width).toBe("0px");
    rerender(<Box {...props} persist={{ key: "c", storage }} />);
    expect(element().style.width).toBe("250px");
    // Each switch changed the state under the app, so it's reported...
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(defaults, { cause: "options" });
    // ...but it isn't the user's change, so nothing is saved until they act.
    expect(saved("c")).toBeUndefined();
    expect(element().style.transition).toBe("");
  });

  it("follows changes saved elsewhere with sync, without saving them", () => {
    const onChange = vi.fn();
    const { storage, saved, write } = memoryStorage({ sidebar: at(320) });
    const setItem = vi.spyOn(storage, "setItem");
    setup({
      ...sidebar,
      onChange,
      persist: { key: "sidebar", storage, sync: true },
    });
    act(() => write("sidebar", at(380)));
    expect(element().style.width).toBe("380px");
    // A change under the app: reported, but not saved back.
    expect(onChange).toHaveBeenCalledExactlyOnceWith(at(380), {
      cause: "sync",
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(saved("sidebar")).toEqual(at(380));
  });

  it("keeps its own layout without sync", () => {
    const { storage, write } = memoryStorage({ sidebar: at(320) });
    setup({ ...sidebar, persist: { key: "sidebar", storage } });
    act(() => write("sidebar", at(380)));
    expect(element().style.width).toBe("320px");
  });

  it("waits for a drag to end before following a synced change", () => {
    const { storage, saved, write } = memoryStorage({ sidebar: at(320) });
    setup({ ...sidebar, persist: { key: "sidebar", storage, sync: true } });
    dragHandle("right", 30, 0, { release: false });
    act(() => write("sidebar", at(380)));
    // Still the user's drag.
    expect(element().style.width).toBe("350px");
    // Released, the drag is the newest change: it's kept, and saved.
    act(() => void pointer(window, "pointerup", { x: 530, y: 500 }));
    expect(element().style.width).toBe("350px");
    expect(saved("sidebar")).toEqual(at(350));
    // Cancelled, nothing of it is kept: the synced change applies.
    dragHandle("right", 30, 0, { release: false });
    act(() => write("sidebar", at(380)));
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(element().style.width).toBe("380px");
  });

  it("keeps a change from code that ends a drag over a synced change waiting on it", () => {
    const { storage, saved, write } = memoryStorage({ sidebar: at(250) });
    setup({ ...sidebar, persist: { key: "sidebar", storage, sync: true } });
    dragHandle("right", 30, 0, { release: false });
    act(() => write("sidebar", at(380)));
    // Newer than the change heard: saved, and what's shown.
    act(() => latest.setSize({ width: 300 }));
    expect(element().style.width).toBe("300px");
    expect(saved("sidebar")).toEqual(at(300));
  });

  it("saves a change onChange makes in turn after the one it heard", () => {
    const { storage, saved } = memoryStorage();
    setup({
      ...sidebar,
      persist: { key: "sidebar", storage },
      // Rounds a change to tens, say.
      onChange: (snapshot) => {
        const size = (snapshot as ReturnType<typeof at>).width.sizes.open
          ?.value;
        if (size === 305) latest.setSize({ width: 310 });
      },
    });
    act(() => latest.setSize({ width: 305 }));
    expect(element().style.width).toBe("310px");
    expect(saved("sidebar")).toEqual(at(310));
  });

  it("saves to storage passed anew under the same key, without loading it", () => {
    const a = memoryStorage({ sidebar: at(320) });
    const b = memoryStorage({ sidebar: at(380) });
    const { rerender } = setup({
      ...sidebar,
      persist: { key: "sidebar", storage: a.storage },
    });
    expect(element().style.width).toBe("320px");
    rerender(
      <Box {...sidebar} persist={{ key: "sidebar", storage: b.storage }} />,
    );
    expect(element().style.width).toBe("320px");
    act(() => latest.setSize({ width: 300 }));
    expect(a.saved("sidebar")).toEqual(at(320));
    expect(b.saved("sidebar")).toEqual(at(300));
  });

  it("follows an inline storage adapter made anew each render", () => {
    const { storage, write } = memoryStorage({ sidebar: at(320) });
    const subscribe = vi.spyOn(storage, "subscribe");
    const inline = () => ({
      getItem: (key: string) => storage.getItem(key),
      setItem: (key: string, value: string) => storage.setItem(key, value),
      subscribe: (key: string, onChange: () => void) =>
        storage.subscribe!(key, onChange),
    });
    const { rerender } = setup({
      ...sidebar,
      persist: { key: "sidebar", storage: inline(), sync: true },
    });
    rerender(
      <Box
        {...sidebar}
        persist={{ key: "sidebar", storage: inline(), sync: true }}
      />,
    );
    expect(subscribe).toHaveBeenCalledTimes(1);
    act(() => write("sidebar", at(380)));
    expect(element().style.width).toBe("380px");
  });

  it("drops a synced change waiting on a drag when the key switches", () => {
    const { storage, write } = memoryStorage({ a: at(320), b: at(350) });
    const props = { ...sidebar };
    const { rerender } = setup({
      ...props,
      persist: { key: "a", storage, sync: true },
    });
    dragHandle("right", 30, 0, { release: false });
    // A change to "a" from elsewhere waits for the drag...
    act(() => write("a", at(450)));
    // ...which switching to "b" ends: "b" is loaded, and stays.
    rerender(<Box {...props} persist={{ key: "b", storage, sync: true }} />);
    expect(element().style.width).toBe("350px");
    act(() => void pointer(window, "pointerup", { x: 530, y: 500 }));
    expect(element().style.width).toBe("350px");
  });

  it("follows another tab's localStorage changes", () => {
    localStorage.setItem("sidebar", JSON.stringify(at(320)));
    try {
      setup({ ...sidebar, persist: { key: "sidebar", sync: true } });
      expect(element().style.width).toBe("320px");
      // Another tab saves: the browser fires a storage event here.
      act(() => {
        localStorage.setItem("sidebar", JSON.stringify(at(380)));
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "sidebar",
            storageArea: localStorage,
          }),
        );
      });
      expect(element().style.width).toBe("380px");
    } finally {
      localStorage.clear();
    }
  });

  it("warns when sync's storage can't report changes", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const storage = { getItem: () => null, setItem: () => {} };
      setup({ ...sidebar, persist: { key: "sidebar", storage, sync: true } });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("persist.sync is on"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("resets to the defaults, reporting and saving the change", () => {
    const onChange = vi.fn();
    const { storage, saved } = memoryStorage({ sidebar: at(320) });
    setup({ ...sidebar, onChange, persist: { key: "sidebar", storage } });

    act(() => latest.reset());
    expect(element().style.width).toBe("250px");
    expect(element().style.transition).toContain("width");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(defaults, {
      cause: "reset",
    });
    expect(saved("sidebar")).toEqual(defaults);
  });

  it("drops a size waiting to be measured for another key's, or a synced change", () => {
    const { storage, saved, write } = memoryStorage({ b: at(300) });
    const { rerender } = render(
      <Box {...closable} persist={{ key: "a", storage, sync: true }} />,
    );
    act(() => latest.setSize({ width: 380 }));
    rerender(<Box {...closable} persist={{ key: "b", storage, sync: true }} />);
    measureContainer();
    expect(latest.width?.size).toBe(300);
    expect(saved("b")).toEqual(at(300));
    cleanup();
    render(<Box {...closable} persist={{ key: "b", storage, sync: true }} />);
    act(() => latest.setSize({ width: 380 }));
    act(() => write("b", at(320)));
    measureContainer();
    expect(latest.width?.size).toBe(320);
  });
});

describe("useResizable before measurement", () => {
  it("applies a setSize from before the first measurement once measured", () => {
    // Named stops without defaultStop: which stop 300 lands in depends on
    // the container, so it waits for it, and doesn't animate.
    render(<Box {...sidebar} />);
    act(() => latest.setSize({ width: 300 }));
    expect(latest.width?.size).toBeNull();
    measureContainer();
    expect(latest.width).toMatchObject({ size: 300, stop: "open" });
    expect(element().style.transition).toBe("");
  });
});

describe("useResizable development warnings", () => {
  it("warns about an absolute handle in an element that isn't positioned", async () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Placed({ position }: { position: "static" | "relative" }) {
        const box = useResizable({
          anchor: "left",
          width: { defaultSize: 200 },
        });
        return (
          // jsdom computes only inline styles, so the position is inline.
          <div {...box.getElementProps({ style: { position } })}>
            <div
              {...box.getHandleProps("right", {
                style: { position: "absolute" },
              })}
              aria-label="Resize"
            />
          </div>
        );
      }
      const { unmount } = render(<Placed position="relative" />);
      await Promise.resolve();
      expect(warn).not.toHaveBeenCalled();
      unmount();

      render(<Placed position="static" />);
      await Promise.resolve();
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringContaining(
          `The "right" handle is absolutely positioned inside an element that isn't`,
        ),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about a handle inside the content wrapper", async () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Wrapped() {
        const box = useResizable({
          anchor: "left",
          width: { defaultSize: 200 },
        });
        return (
          <div {...box.getElementProps({ style: { position: "relative" } })}>
            <div {...box.getContentProps()}>
              <div {...box.getHandleProps("right")} aria-label="Resize" />
            </div>
          </div>
        );
      }
      render(<Wrapped />);
      await Promise.resolve();
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringContaining(
          `The "right" handle is inside a content wrapper (getContentProps)`,
        ),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about a handle inside the clip layer, outside the content", async () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Clipped() {
        const box = useResizable({
          anchor: "left",
          width: { defaultSize: 200 },
        });
        return (
          <div {...box.getElementProps({ style: { position: "relative" } })}>
            <div {...box.getClipProps()}>
              <div {...box.getContentProps()} />
              <div {...box.getHandleProps("right")} aria-label="Resize" />
            </div>
          </div>
        );
      }
      render(<Clipped />);
      await Promise.resolve();
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringContaining(
          `The "right" handle is inside a clip layer (getClipProps)`,
        ),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("doesn't warn about a handle inside another resizable's content", async () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Inner() {
        const box = useResizable({
          anchor: "right",
          width: { defaultSize: 100 },
        });
        return (
          <div {...box.getElementProps({ style: { position: "relative" } })}>
            <div {...box.getHandleProps("left")} aria-label="Resize inner" />
          </div>
        );
      }
      function Outer() {
        const box = useResizable({
          anchor: "left",
          width: { defaultSize: 300 },
        });
        return (
          <div {...box.getElementProps({ style: { position: "relative" } })}>
            <div {...box.getContentProps()}>
              <Inner />
            </div>
            <div {...box.getHandleProps("right")} aria-label="Resize outer" />
          </div>
        );
      }
      render(<Outer />);
      await Promise.resolve();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when reflowing once has no content wrapper to hold", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Content({ wrapped }: { wrapped: boolean }) {
        const box = useResizable({ ...sidebar, reflow: "once" });
        return (
          <div {...box.getElementProps()}>
            {wrapped ? <div {...box.getContentProps()} /> : <div />}
          </div>
        );
      }
      const { unmount } = render(<Content wrapped />);
      expect(warn).not.toHaveBeenCalled();
      unmount();
      render(<Content wrapped={false} />);
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringContaining(
          `reflow: "once" holds only content in a getContentProps() wrapper`,
        ),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about a handle the resizable doesn't offer, and disables it", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Corners() {
        const box = useResizable({
          anchor: "top-left",
          width: { defaultSize: 200 },
          height: { defaultSize: 200 },
          handles: ["bottom-right"],
        });
        return (
          <div {...box.getElementProps()}>
            <div
              data-testid="right"
              {...box.getHandleProps("right")}
              aria-label="Resize"
            />
          </div>
        );
      }
      render(<Corners />);
      const right = screen.getByTestId("right");
      expect(right.tabIndex).toBe(-1);
      expect(right.style.cursor).toBe("");
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringContaining(`doesn't offer "right"`),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about an unlabelled edge handle, but not a corner", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Bare() {
        const box = useResizable({
          anchor: "top-left",
          width: { defaultSize: 200 },
          height: { defaultSize: 200 },
        });
        return (
          <div {...box.getElementProps()}>
            <div {...box.getHandleProps("right")} />
            <div {...box.getHandleProps("bottom-right")} />
          </div>
        );
      }
      render(<Bare />);
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringContaining(`The "right" handle has no aria-label`),
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the controller without React", () => {
  it("gives the view the hook renders from, the same object until it changes", () => {
    const controller = createResizableController(sidebar);
    const view = controller.getView();
    // Not measured: no size yet, and which stop 250px lands in can wait.
    expect(view.width).toMatchObject({ size: null, stop: null });
    expect(view.height).toBeNull();
    expect(view.handles).toEqual(["right"]);
    expect(controller.getView()).toBe(view);

    const listener = vi.fn();
    controller.subscribe(listener);
    controller.setStop("closed");
    expect(listener).toHaveBeenCalled();
    const closed = controller.getView();
    expect(closed).not.toBe(view);
    expect(closed.width?.stop).toBe("closed");
  });
});

describe("useResizable with viewport units", () => {
  let viewport: ReturnType<typeof installViewport>;
  beforeEach(() => {
    viewport = installViewport(1600, 900);
  });
  afterEach(() => viewport.restore());

  const probe = () => document.querySelector("[data-resizable-viewport]");

  it("resolves vw against the viewport, and follows it", () => {
    setup({
      anchor: "left",
      width: { defaultSize: "50vw", minSize: 100, maxSize: "60vw" },
    });
    expect(element().style.width).toBe("800px");
    act(() => viewport.resize(1200, 900));
    expect(element().style.width).toBe("600px");
    // Dragged past the maximum: 60vw.
    dragHandle("right", 400);
    expect(latest.width?.size).toBe(720);
  });

  it("resolves vw given to setSize, though the options use none", () => {
    setup({ anchor: "left", width: { defaultSize: 200, minSize: 100 } });
    expect(probe()).toBeNull();
    act(() => latest.setSize({ width: "50vw" }));
    expect(latest.width?.size).toBe(800);
    // Kept as given, so it follows the window.
    act(() => viewport.resize(1200, 900));
    expect(latest.width?.size).toBe(600);
    // Given in pixels, it no longer needs the viewport.
    act(() => latest.setSize({ width: 300 }));
    expect(probe()).toBeNull();
  });

  it("only reads the viewport when a size uses vw or vh", () => {
    const { unmount } = setup();
    expect(probe()).toBeNull();
    unmount();
    const { unmount: unmountVh } = setup({
      anchor: "bottom",
      height: { defaultSize: "40vh" },
    });
    expect(probe()).not.toBeNull();
    unmountVh();
    expect(probe()).toBeNull();
  });
});

describe("useResizable reflowing once", () => {
  const contentWidth = () =>
    element().style.getPropertyValue("--resizable-content-width");

  it("resizes as it drags, holding the content until it's let go", () => {
    const onChange = vi.fn();
    setup({ ...sidebar, reflow: "once", onChange });
    dragHandle("right", 50, 0, { release: false });
    // The element and its handle follow the pointer; the content keeps the
    // size it had.
    expect(element().style.width).toBe("300px");
    expect(latest.width?.size).toBe(300);
    expect(contentWidth()).toBe("250px");
    expect(handle().style.transform).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    act(() => void pointer(window, "pointerup", { x: 550, y: 500 }));
    // Released: the content takes the element's size.
    expect(element().style.width).toBe("300px");
    expect(contentWidth()).toBe("initial");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("holds the content through an animated change, until it's over", () => {
    setup({ ...sidebar, reflow: "once" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // Shrinking: the content keeps the larger size it had.
      act(() => latest.setSize({ width: 210 }));
      expect(element().style.width).toBe("210px");
      expect(latest.animating).toBe(true);
      expect(contentWidth()).toBe("250px");
      act(() => void vi.advanceTimersByTime(450));
      expect(contentWidth()).toBe("initial");
      // Growing: it takes the new size at once.
      act(() => latest.setSize({ width: 300 }));
      expect(contentWidth()).toBe("300px");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the content follow an animated change, reflowing live", () => {
    setup({ ...sidebar });
    act(() => latest.setSize({ width: 210 }));
    expect(latest.animating).toBe(true);
    // Within its range: the content follows the edge.
    expect(contentWidth()).toBe("initial");
    // Opening from 0: laid out at its open size from the start.
    act(() => latest.setStop("closed"));
    act(() => latest.setStop("open"));
    expect(latest.animating).toBe(true);
    expect(contentWidth()).toBe("210px");
  });

  it("lets the content follow the drag, reflowing live", () => {
    setup();
    dragHandle("right", 50, 0, { release: false });
    expect(element().style.width).toBe("300px");
    expect(contentWidth()).toBe("initial");
  });

  it("lays content out at the content size with getContentProps", () => {
    function WithContent(options: UseResizableOptions) {
      const resizable = useResizable(options);
      useExpose(resizable);
      return (
        <div data-testid="container">
          <div data-testid="element" {...resizable.getElementProps()}>
            <div data-testid="content" {...resizable.getContentProps()} />
            <div
              data-testid="handle-right"
              {...resizable.getHandleProps("right")}
              aria-label="Resize"
            />
          </div>
        </div>
      );
    }
    render(<WithContent {...sidebar} reflow="once" />);
    measureContainer();
    const content = () => screen.getByTestId("content").style;
    // At least the element's size, across only what it resizes.
    expect(content().width).toBe(
      "max(100%, var(--resizable-content-width, 100%))",
    );
    expect(content().height).toBe("");
    // Held while a drag lasts, growing or shrinking.
    dragHandle("right", 50, 0, { release: false });
    expect(content().width).toBe("var(--resizable-content-width, 100%)");
    act(() => void pointer(window, "pointerup", { x: 550, y: 500 }));
    expect(content().width).toBe(
      "max(100%, var(--resizable-content-width, 100%))",
    );
  });

  it("holds the content's stop until it's let go", () => {
    setup({ ...sidebar, reflow: "once" });
    dragHandle("right", -250, 0, { release: false });
    expect(latest.width?.stop).toBe("closed");
    expect(latest.width?.contentStop).toBe("open");
    expect(contentWidth()).toBe("250px");
  });
});

describe("getClipProps", () => {
  const clip = () => latest.getClipProps();
  const slide = () => latest.getClipProps({ slide: true });
  const finish = async () => act(async () => void vi.advanceTimersByTime(450));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills the element, clips, and pins the content to the anchored edge", () => {
    setup();
    expect(clip().style).toMatchObject({
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      display: "flex",
      justifyContent: "left",
    });
    // The height isn't resized: the content fills it.
    expect(clip().style.alignItems).toBeUndefined();
    expect(clip()["data-resizable-clip"]).toBe("");
  });

  it("covers: the anchored edge through a close", () => {
    setup();
    act(() => latest.setStop("closed"));
    expect(latest.animating).toBe(true);
    expect(clip().style.justifyContent).toBe("left");
    expect(clip()["data-sliding"]).toBeUndefined();
    // From the change's start, as the element's.
    expect(clip()["data-zero"]).toBe("");
  });

  it("slides: the moving edge through a close and an open, the anchored at rest", async () => {
    setup();
    expect(slide().style.justifyContent).toBe("left");
    act(() => latest.setStop("closed"));
    expect(slide().style.justifyContent).toBe("right");
    expect(slide()["data-sliding"]).toBe("");
    await finish();
    expect(slide().style.justifyContent).toBe("left");
    expect(slide()["data-sliding"]).toBeUndefined();
    act(() => latest.setStop("open"));
    expect(slide().style.justifyContent).toBe("right");
    expect(slide()["data-zero"]).toBeUndefined();
    await finish();
    expect(slide().style.justifyContent).toBe("left");
  });

  it("slides a drag out of 0, and covers one in the range", async () => {
    setup();
    act(() => latest.setStop("closed"));
    await finish();
    dragHandle("right", 300, 0, { release: false });
    expect(latest.dragging).not.toBeNull();
    expect(slide().style.justifyContent).toBe("right");
    act(() => void pointer(window, "pointerup", { x: 800, y: 500 }));
    await finish();
    dragHandle("right", -20, 0, { release: false });
    expect(slide().style.justifyContent).toBe("left");
  });

  it("covers a resize within the range, even sliding", () => {
    setup();
    act(() => latest.setSize({ width: 300 }));
    expect(latest.animating).toBe(true);
    expect(slide().style.justifyContent).toBe("left");
  });

  it("covers closing from a rail, whose content is wider than it", async () => {
    setup({
      ...sidebar,
      width: {
        defaultSize: 250,
        stops: { closed: 0, rail: 56, open: { min: 200, max: 400 } },
      },
    });
    act(() => latest.setStop("rail"));
    await finish();
    act(() => latest.setStop("closed"));
    expect(latest.animating).toBe(true);
    expect(slide().style.justifyContent).toBe("left");
  });

  it("pins to the right for a right anchor, and slides to the left", () => {
    setup({ ...sidebar, anchor: "right" });
    expect(slide().style.justifyContent).toBe("right");
    act(() => latest.setStop("closed"));
    expect(slide().style.justifyContent).toBe("left");
  });

  it("is a column for a height alone, so the content fills across", () => {
    setup({
      anchor: "bottom",
      height: {
        defaultSize: 250,
        stops: { closed: 0, open: { min: 100, max: 400 } },
      },
      elastic: false,
    });
    expect(slide().style).toMatchObject({
      flexDirection: "column",
      justifyContent: "flex-end",
    });
    act(() => latest.setStop("closed"));
    expect(slide().style.justifyContent).toBe("flex-start");
  });

  it("pins a centre anchor to the centre either way", () => {
    setup({ ...sidebar, anchor: "center" });
    act(() => latest.setStop("closed"));
    expect(slide().style.justifyContent).toBe("center");
  });

  it("covers a floating element from its top left, warning about slide", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setup({
      anchor: "none",
      width: { defaultSize: 300, minSize: 100 },
      height: { defaultSize: 200, minSize: 100 },
    });
    expect(slide().style).toMatchObject({
      justifyContent: "left",
      alignItems: "flex-start",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("a floating element"),
    );
    warn.mockRestore();
  });
});

describe("useResizable hydrating a right-to-left page", () => {
  afterEach(() => {
    document.documentElement.style.direction = "";
  });

  it("hydrates as the server rendered it, then puts handles where they go", async () => {
    const options: UseResizableOptions = { ...sidebar, anchor: "start" };
    // The server can't know the direction: left to right.
    const host = document.createElement("div");
    // jsdom has a `window`, so the hooks take the browser's layout effects
    // here, which React 18 warns about on the server (a real server has no
    // `window`: see use-isomorphic-layout-effect.test.tsx).
    const serverError = vi.spyOn(console, "error").mockImplementation(() => {});
    host.innerHTML = renderToString(<Box {...options} />);
    serverError.mockRestore();
    document.body.append(host);
    expect(
      host.querySelector("[data-handle]")?.getAttribute("data-handle"),
    ).toBe("right");
    document.documentElement.style.direction = "rtl";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(host, <Box {...options} />);
      });
      expect(error).not.toHaveBeenCalled();
      expect(
        [...host.querySelectorAll("[data-handle]")].map((handle) =>
          handle.getAttribute("data-handle"),
        ),
      ).toEqual(["left"]);
    } finally {
      error.mockRestore();
      act(() => root.unmount());
      host.remove();
    }
  });
});

describe("useResizable changes asked for before measurement", () => {
  it("applies the latest: a later reset or setStop wins over a setSize", () => {
    render(<Box {...sidebar} />);
    act(() => latest.setSize({ width: 300 }));
    act(() => latest.reset());
    measureContainer();
    expect(latest.width).toMatchObject({ stop: "open", size: 250 });
    act(() => latest.setSize({ width: 300 }));
    expect(latest.width?.size).toBe(300);
  });

  it("lands a setSize as it would once measured, whatever stop it starts in", () => {
    const closed = {
      ...sidebar,
      width: { ...sidebar.width!, defaultStop: "closed" },
    };
    render(<Box {...closed} />);
    act(() => latest.setSize({ width: 300 }));
    act(() => latest.setStop("closed"));
    act(() => latest.setSize({ width: 300 }));
    measureContainer();
    expect(latest.width).toMatchObject({ stop: "open", size: 300 });
  });

  it("lands one past the range's minimum in the stop below it", () => {
    const open = {
      ...sidebar,
      width: { ...sidebar.width!, defaultStop: "open" },
    };
    render(<Box {...open} />);
    act(() => latest.setSize({ width: 0 }));
    measureContainer();
    expect(latest.width).toMatchObject({ stop: "closed", size: 0 });
  });
});

describe("useResizable floating, in detail", () => {
  function Floating(options: UseResizableOptions) {
    const resizable = useResizable(options);
    useExpose(resizable);
    return (
      <div data-testid="container">
        <div data-testid="element" {...resizable.getElementProps()}>
          <div
            data-testid="title"
            {...resizable.getMoveHandleProps()}
            aria-label="Move"
          />
        </div>
      </div>
    );
  }
  const move = (dx: number) => {
    act(() => {
      pointer(screen.getByTestId("title"), "pointerdown", { x: 0, y: 0 });
      pointer(window, "pointermove", { x: dx, y: 0 });
      frames.flushFrame();
    });
  };

  it("takes a position in vw and vh, and follows the window", () => {
    const viewport = installViewport(1000, 800);
    try {
      render(
        <Floating
          anchor="none"
          width={{ defaultSize: 200 }}
          height={{ defaultSize: 100 }}
          transition={false}
        />,
      );
      measureContainer();
      act(() => latest.setPosition({ x: "50vw", y: "25vh" }));
      expect(latest.position).toEqual({ x: 500, y: 200 });
      act(() => viewport.resize(1200, 800));
      expect(latest.position).toEqual({ x: 600, y: 200 });
    } finally {
      viewport.restore();
    }
  });

  it("confines a height the app sizes at rest, as when grabbed", () => {
    render(
      <Floating
        anchor="none"
        width={{ defaultSize: 100 }}
        defaultPosition={{ y: 350 }}
        confine="container"
        elastic={false}
      />,
    );
    measureContainer(1000, 400);
    // Its content makes it 100px tall.
    act(() => observer.resize(element(), { width: 100, height: 100 }));
    expect(latest.position?.y).toBe(300);
    element().getBoundingClientRect = () =>
      DOMRect.fromRect({ width: 100, height: 100 });
    move(3);
    expect(latest.position?.y).toBe(300);
    act(() => void pointer(window, "pointerup", { x: 3, y: 0 }));
  });

  it("grabbed mid-animation in a scrolled container, moves from where it shows", () => {
    render(
      <Floating
        anchor="none"
        width={{ defaultSize: 300 }}
        height={{ defaultSize: 200 }}
        defaultPosition={{ x: 100, y: 50 }}
        elastic={false}
      />,
    );
    const container = screen.getByTestId("container");
    measureContainer();
    act(() => latest.setPosition({ x: 150 }));
    expect(latest.animating).toBe(true);
    // Shown at left 150, its container scrolled 50px: 100px in on screen.
    Object.defineProperty(container, "scrollLeft", {
      value: 50,
      configurable: true,
    });
    container.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 800 });
    element().getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 100, y: 50, width: 300, height: 200 });
    move(5);
    expect(element().style.left).toBe("155px");
    act(() => void pointer(window, "pointerup", { x: 5, y: 0 }));
  });

  describe("confined, floating", () => {
    const box: UseResizableOptions = {
      anchor: "none",
      width: { defaultSize: 100 },
      height: { defaultSize: 100 },
      defaultPosition: { y: 350 },
      confine: "container",
      elastic: false,
      transition: false,
    };
    const { height: _, ...widthOnly } = box;

    it("measures a dimension the app comes to size", () => {
      const { rerender } = render(<Box {...box} />);
      measureContainer(1000, 400);
      expect(latest.position?.y).toBe(300);
      rerender(<Box {...widthOnly} />);
      act(() => observer.resize(element(), { width: 100, height: 100 }));
      expect(latest.position?.y).toBe(300);
      rerender(<Box {...box} />);
      expect(observer.isObserved(element())).toBe(false);
    });

    it("doesn't reach a point stop bigger than its room by a drag", () => {
      const sized: UseResizableOptions = {
        ...box,
        width: { defaultStop: "small", stops: { small: 100, large: 400 } },
        defaultPosition: { x: 200, y: 0 },
        handles: ["right"],
      };
      setup(sized);
      measureContainer(500, 400);
      dragHandle("right", 200, 0, { release: false });
      const place = () => ({
        size: latest.width?.size,
        stop: latest.width?.stop,
        x: latest.position?.x,
      });
      const shown = place();
      act(() => void pointer(window, "pointerup", { x: 700, y: 500 }));
      expect(place()).toEqual(shown);
      expect(shown).toEqual({ size: 100, stop: "small", x: 200 });
      // Asked for by name, it goes there, kept inside.
      act(() => latest.setStop("large"));
      expect({ size: latest.width?.size, x: latest.position?.x }).toEqual({
        size: 400,
        x: 100,
      });
    });
  });
});

describe("useResizable with a locked aspect ratio, sized in code", () => {
  const video: UseResizableOptions = {
    anchor: "top-left",
    width: { defaultSize: 320, minSize: 100, maxSize: 900 },
    aspectRatio: 16 / 9,
    transition: false,
  };

  it("sizes the width through the ratio for a height", () => {
    setup(video);
    act(() => latest.setSize({ height: 360 }));
    expect(latest.width?.size).toBe(640);
  });

  it("takes the width when given both, and warns", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      setup(video);
      act(() => latest.setSize({ width: 400, height: 360 }));
      expect(latest.width?.size).toBe(400);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("can't both be set"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("useResizable's refs", () => {
  it("are as the running React wants them: nothing logged as they attach", () => {
    // React 18 warns about a callback ref returning a cleanup.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { unmount } = setup({ ...sidebar, anchor: "none" });
      unmount();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("useResizable changes made while another is stored", () => {
  const widthOf = (snapshot: unknown) =>
    (snapshot as ResizableSnapshot).width?.sizes.open?.value;

  it("saves and reports last the change an onDragEnd makes, ending a drag", () => {
    const { storage, saved } = memoryStorage();
    const onChange = vi.fn();
    setup({
      ...sidebar,
      persist: { key: "s", storage },
      onChange,
      onDragEnd: () => latest.setSize({ width: 350 }),
    });
    dragHandle("right", 20, 0, { release: false });
    // A change from code ends the drag; onDragEnd answers it.
    act(() => latest.setSize({ width: 300 }));
    expect(latest.width?.size).toBe(350);
    expect(widthOf(saved("s"))).toBe(350);
    expect(widthOf(onChange.mock.lastCall?.[0])).toBe(350);
  });

  it("saves and reports last the change a subscriber makes at once", () => {
    const { storage, saved } = memoryStorage();
    const onChange = vi.fn();
    setup({ ...sidebar, persist: { key: "s", storage }, onChange });
    latest.controller.subscribe(() => {
      if (latest.controller.getView().width?.size === 300) {
        latest.controller.setSize({ width: 350 });
      }
    });
    act(() => latest.setSize({ width: 300 }));
    expect(latest.width?.size).toBe(350);
    expect(widthOf(saved("s"))).toBe(350);
    expect(widthOf(onChange.mock.lastCall?.[0])).toBe(350);
  });
});

describe("useResizable restoring sizes in vw", () => {
  let viewport: ReturnType<typeof installViewport>;
  beforeEach(() => {
    viewport = installViewport(1000, 800);
  });
  afterEach(() => viewport.restore());

  const plain: UseResizableOptions = {
    anchor: "left",
    width: { defaultSize: 200, minSize: 100 },
  };
  /** A snapshot with the width at 50vw. */
  function halfWindow(): ResizableSnapshot {
    const { unmount } = setup(plain);
    act(() => latest.setSize({ width: "50vw" }));
    const snapshot = latest.getSnapshot();
    unmount();
    return snapshot;
  }

  it("resolves them at once, from the window as it is now", () => {
    const snapshot = halfWindow();
    setup(plain);
    act(() => latest.restore(snapshot));
    expect(latest.width?.size).toBe(500);
    // Changed while nothing watched it.
    act(() => latest.setSize({ width: 300 }));
    act(() => viewport.resize(1200, 800));
    act(() => latest.restore(snapshot));
    expect(latest.width?.size).toBe(600);
  });

  it("from another key, or another tab", () => {
    const snapshot = halfWindow();
    const { storage, write } = memoryStorage({ b: snapshot });
    const { rerender } = setup({ ...plain, persist: { key: "a", storage } });
    rerender(<Box {...plain} persist={{ key: "b", storage, sync: true }} />);
    expect(latest.width?.size).toBe(500);
    act(() => latest.setSize({ width: 300 }));
    act(() => write("b", snapshot));
    expect(latest.width?.size).toBe(500);
  });

  it("from another tab, without React, following the window after", () => {
    const snapshot = halfWindow();
    const { storage, write } = memoryStorage();
    const container = document.createElement("div");
    const element = document.createElement("div");
    container.append(element);
    document.body.append(container);
    const controller = createResizableController({
      ...plain,
      persist: { key: "k", storage, sync: true },
    });
    const unmount = controller.mount();
    controller.elementRef(element);
    try {
      observer.resize(container, { width: 1000, height: 800 });
      write("k", snapshot);
      expect(controller.getView().width?.size).toBe(500);
      viewport.resize(1200, 800);
      expect(controller.getView().width?.size).toBe(600);
    } finally {
      unmount();
      container.remove();
    }
  });
});

describe("useResizable's release", () => {
  it("lands where the pointer was let go, not where it last moved", () => {
    setup();
    dragHandle("right", 30, 0, { release: false });
    act(() => void pointer(window, "pointerup", { x: 560, y: 500 }));
    expect(latest.width?.size).toBe(310);
  });
});

describe("useResizable changes made one at a time", () => {
  const widthOf = (snapshot: unknown) =>
    (snapshot as ResizableSnapshot).width?.sizes.open?.value;

  it("saves and reports a change, though one made as it's stored changes nothing", () => {
    const { storage, saved } = memoryStorage();
    const onChange = vi.fn();
    const options = { ...sidebar, persist: { key: "s", storage }, onChange };
    const container = document.createElement("div");
    const box = document.createElement("div");
    container.append(box);
    document.body.append(container);
    const controller = createResizableController(options);
    const unmount = controller.mount();
    controller.elementRef(box);
    try {
      observer.resize(container, { width: 1000, height: 800 });
      let once = false;
      controller.subscribe(() => {
        if (!once && controller.getView().width?.size === 300) {
          once = true;
          controller.setOptions({ ...options, disabled: true });
        }
      });
      controller.setSize({ width: 300 });
      expect(widthOf(saved("s"))).toBe(300);
      expect(onChange).toHaveBeenCalledOnce();
    } finally {
      unmount();
      container.remove();
    }
  });

  it("reports a change before one made as it's stored, which comes after", () => {
    const { storage } = memoryStorage();
    const seen: (number | null | undefined)[] = [];
    setup({
      ...sidebar,
      persist: { key: "s", storage },
      onChange: () => void seen.push(latest.controller.getView().width?.size),
    });
    const original = latest.getSnapshot();
    latest.controller.subscribe(() => {
      if (latest.controller.getView().width?.size === 300) {
        latest.controller.restore(original);
      }
    });
    act(() => latest.setSize({ width: 300 }));
    // Heard while it was so; the restore after.
    expect(seen).toEqual([300]);
    expect(latest.width?.size).toBe(250);
  });

  it("shows a synced vw size resolved when onChange hears of it", () => {
    const viewport = installViewport(1000, 800);
    try {
      const plain: UseResizableOptions = {
        anchor: "left",
        width: { defaultSize: 200, minSize: 100 },
      };
      const { unmount } = setup(plain);
      act(() => latest.setSize({ width: "50vw" }));
      const half = latest.getSnapshot();
      unmount();
      const { storage, write } = memoryStorage();
      const heard: (number | null | undefined)[] = [];
      setup({
        ...plain,
        persist: { key: "k", storage, sync: true },
        onChange: () =>
          void heard.push(latest.controller.getView().width?.size),
      });
      act(() => write("k", half));
      expect(heard).toEqual([500]);
    } finally {
      viewport.restore();
    }
  });
});

describe("useResizable actions made in turn", () => {
  const wider: UseResizableOptions = {
    ...sidebar,
    width: {
      defaultSize: 250,
      stops: { closed: 0, open: { min: 200, max: 400 }, wide: 600 },
    },
  };

  /** A bare controller in a measured container, with its right handle. */
  function mountBare(options: UseResizableOptions) {
    const container = document.createElement("div");
    const box = document.createElement("div");
    const right = document.createElement("div");
    box.append(right);
    container.append(box);
    document.body.append(container);
    const controller = createResizableControllerWithState(options);
    const unmount = controller.mount();
    controller.elementRef(box);
    controller.handleRef("right")(right);
    observer.resize(container, { width: 1000, height: 800 });
    return {
      controller,
      box,
      right,
      done() {
        unmount();
        container.remove();
      },
    };
  }

  it("checks an action against the options a change before it applied", () => {
    let once = true;
    const { controller, done } = mountBare({
      ...sidebar,
      onChange: () => {
        if (!once) return;
        once = false;
        controller.setOptions(wider);
        // The stop the options above add.
        controller.setStop("wide");
      },
    });
    try {
      controller.setStop("closed");
      expect(controller.getView().width?.stop).toBe("wide");
    } finally {
      done();
    }
  });

  it("makes the rest when one throws, then throws its error", () => {
    let once = true;
    const { controller, done } = mountBare({
      ...sidebar,
      onChange: () => {
        if (!once) return;
        once = false;
        controller.setStop("nowhere");
        controller.setOptions(wider);
      },
    });
    try {
      expect(() => controller.setStop("closed")).toThrow(/nowhere/);
      expect(
        controller.getState().config.width?.stops.map((s) => s.name),
      ).toEqual(["closed", "open", "wide"]);
    } finally {
      done();
    }
  });

  it("starts measuring what it confines when options made in turn ask", () => {
    const floating: UseResizableOptions = {
      anchor: "none",
      width: { defaultSize: 200 },
    };
    let once = true;
    const { controller, box, done } = mountBare({
      ...floating,
      onChange: () => {
        if (!once) return;
        once = false;
        controller.setOptions({ ...floating, confine: "container" });
      },
    });
    try {
      controller.setPosition({ x: 10 });
      expect(controller.getState().config.position?.confined).toBe(true);
      // Its height, which the app sizes.
      expect(observer.isObserved(box)).toBe(true);
    } finally {
      done();
    }
  });

  it("reports a drag a subscriber's change drops as cancelled", () => {
    const ends: { cancelled: boolean }[] = [];
    const { controller, right, done } = mountBare({
      ...sidebar,
      transition: false,
      onDragEnd: (_, end) => void ends.push(end),
    });
    let once = true;
    controller.subscribe(() => {
      const view = controller.getView();
      if (once && view.dragging && (view.width?.size ?? 0) > 260) {
        once = false;
        controller.setSize({ width: 400 });
      }
    });
    try {
      pointer(right, "pointerdown", { x: 500, y: 500 });
      pointer(window, "pointermove", { x: 530, y: 500 });
      frames.flushFrame();
      expect(controller.getView().width?.size).toBe(400);
      expect(controller.getView().dragging).toBeNull();
      expect(ends).toEqual([{ cancelled: true }]);
      pointer(window, "pointerup", { x: 530, y: 500 });
      expect(ends).toEqual([{ cancelled: true }]);
    } finally {
      done();
    }
  });

  it("ends a change's animation when transitions are turned off", () => {
    vi.useFakeTimers();
    const slow = { ...sidebar, transition: { duration: 10000 } };
    const { controller, done } = mountBare(slow);
    try {
      controller.setStop("closed");
      expect(controller.getView().animating).toBe(true);
      controller.setOptions({ ...slow, transition: false });
      expect(controller.getView().animating).toBe(false);
    } finally {
      done();
      vi.useRealTimers();
    }
  });

  it("ends a change's animation when the user asks for reduced motion", () => {
    vi.useFakeTimers();
    let changed: (() => void) | null = null;
    const list = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => {
        changed = listener;
      },
      removeEventListener: () => {},
    };
    const original = globalThis.matchMedia;
    globalThis.matchMedia = (() => list) as unknown as typeof matchMedia;
    const { controller, done } = mountBare({
      ...sidebar,
      transition: { duration: 10000 },
    });
    try {
      controller.setStop("closed");
      expect(controller.getView().animating).toBe(true);
      list.matches = true;
      changed!();
      expect(controller.getView().animating).toBe(false);
    } finally {
      done();
      globalThis.matchMedia = original;
      vi.useRealTimers();
    }
  });
});

describe("useResizable's box", () => {
  it("sizes the element's whole box", () => {
    setup();
    expect(element().style.boxSizing).toBe("border-box");
  });

  it("places a floating element in its container's padding box", () => {
    const container = document.createElement("div");
    container.style.padding = "10px 20px";
    const box = document.createElement("div");
    container.append(box);
    document.body.append(container);
    const controller = createResizableControllerWithState({
      anchor: "none",
      confine: "container",
      width: { defaultSize: 100 },
      height: { defaultSize: 100 },
    });
    const unmount = controller.mount();
    controller.elementRef(box);
    try {
      // Its content box; left and top reach into the padding too.
      observer.resize(
        container,
        { width: 500, height: 400 },
        { width: 540, height: 420 },
      );
      expect(controller.getState().container).toMatchObject({
        width: 540,
        height: 420,
      });
      controller.setPosition({ x: 5000 });
      expect(controller.getView().position?.x).toBe(440);
      // Its padding gone, its content box as it was: its border box says.
      container.style.padding = "0";
      observer.resize(
        container,
        { width: 500, height: 400 },
        { width: 500, height: 400 },
      );
      expect(controller.getState().container).toMatchObject({
        width: 500,
        height: 400,
      });
      // Anchored, the same container is its content box, padding or not.
      container.style.padding = "10px 20px";
      observer.resize(
        container,
        { width: 500, height: 400 },
        { width: 540, height: 420 },
      );
      expect(controller.getState().container?.width).toBe(540);
      controller.setOptions({ anchor: "left", width: { defaultSize: 100 } });
      expect(controller.getState().container?.width).toBe(500);
    } finally {
      unmount();
      container.remove();
    }
  });
});

describe("useResizable drags and the app's callbacks", () => {
  const events: string[] = [];
  const callbacks = {
    onDragStart: () => void events.push("start"),
    onDragEnd: (_: unknown, { cancelled }: { cancelled: boolean }) =>
      void events.push(`end ${cancelled}`),
  };
  /** Whether the page's cursor is locked (a drag's style in the head). */
  const locked = () =>
    [...document.head.querySelectorAll("style")].some((style) =>
      style.textContent?.includes("cursor"),
    );
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  beforeEach(() => {
    events.length = 0;
    errors.length = 0;
    window.addEventListener("error", onError);
  });
  afterEach(() => window.removeEventListener("error", onError));

  const press = (x = 540) =>
    act(() => {
      pointer(handle(), "pointerdown", { x: 500, y: 500 });
      pointer(window, "pointermove", { x, y: 500 });
    });

  it("reports a drag a subscriber drops as it starts, start and end", () => {
    setup({ ...sidebar, ...callbacks });
    let once = true;
    latest.controller.subscribe(() => {
      if (once && latest.controller.getView().dragging) {
        once = false;
        latest.controller.setStop("closed");
      }
    });
    press();
    expect(latest.width?.stop).toBe("closed");
    expect(events).toEqual(["start", "end true"]);
    expect(locked()).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it("ends a drag onDragStart drops at once", () => {
    setup({
      ...sidebar,
      ...callbacks,
      onDragStart: () => {
        events.push("start");
        latest.setStop("closed");
      },
    });
    press();
    expect(latest.dragging).toBeNull();
    expect(events).toEqual(["start", "end true"]);
    expect(locked()).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it("schedules nothing once it's unmounted from onDragStart", () => {
    const { unmount } = setup({
      ...sidebar,
      ...callbacks,
      onDragStart: () => {
        events.push("start");
        unmount();
      },
    });
    pointer(handle(), "pointerdown", { x: 500, y: 500 });
    pointer(window, "pointermove", { x: 540, y: 500 });
    expect(events).toEqual(["start", "end true"]);
    expect(frames.pending).toBe(0);
  });

  it("finishes a release whose onChange throws, then throws its error", () => {
    let throwing = true;
    const { unmount } = setup({
      ...sidebar,
      ...callbacks,
      onChange: () => {
        if (throwing) throw new Error("onChange");
      },
    });
    press();
    act(() => frames.flushFrame());
    act(() => void pointer(window, "pointerup", { x: 540, y: 500 }));
    throwing = false;
    expect(latest.width?.size).toBe(290);
    expect(events).toEqual(["start", "end false"]);
    expect(errors).toHaveLength(1);
    unmount();
    expect(events).toEqual(["start", "end false"]);
  });

  it("lets the pointer go when a release landing in a stop throws", () => {
    let throwing = true;
    setup({
      anchor: "left",
      width: {
        defaultSize: 250,
        stops: { closed: { size: 0, endsDrag: true }, open: { min: 200 } },
      },
      ...callbacks,
      onChange: () => {
        if (throwing) throw new Error("onChange");
      },
    });
    press(490);
    act(() => frames.flushFrame());
    // Let go past the stop that ends it.
    act(() => void pointer(window, "pointerup", { x: 300, y: 500 }));
    throwing = false;
    expect(latest.width?.stop).toBe("closed");
    expect(locked()).toBe(false);
    expect(events).toEqual(["start", "end false"]);
    // A new press (a new touch) drags again.
    act(() => {
      pointer(handle(), "pointerdown", { x: 100, y: 500, pointerId: 7 });
      pointer(window, "pointermove", { x: 400, y: 500, pointerId: 7 });
      frames.flushFrame();
    });
    expect(latest.dragging).not.toBeNull();
  });
});
