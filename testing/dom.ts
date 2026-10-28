/**
 * Test doubles for the browser APIs jsdom doesn't implement, plus helpers for
 * dispatching pointer events. Each installer can be undone, from
 * `afterEach`: pointer capture's returns a function that undoes it; the
 * others return an object whose `restore()` does.
 */

/** Replaces requestAnimationFrame with a queue that tests flush by hand. */
export function installAnimationFrames() {
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const original = {
    request: window.requestAnimationFrame,
    cancel: window.cancelAnimationFrame,
  };

  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };

  return {
    /** Runs every frame callback queued so far. */
    flushFrame() {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(performance.now());
    },
    get pending() {
      return queue.size;
    },
    restore() {
      window.requestAnimationFrame = original.request;
      window.cancelAnimationFrame = original.cancel;
    },
  };
}

/** Makes pointer capture calls work, tracking which pointers are captured. */
export function installPointerCapture() {
  const captured = new WeakMap<Element, Set<number>>();
  const proto = Element.prototype;
  const original = {
    set: proto.setPointerCapture,
    has: proto.hasPointerCapture,
    release: proto.releasePointerCapture,
  };

  proto.setPointerCapture = function (pointerId) {
    const set = captured.get(this) ?? new Set();
    set.add(pointerId);
    captured.set(this, set);
  };
  proto.hasPointerCapture = function (pointerId) {
    return captured.get(this)?.has(pointerId) ?? false;
  };
  proto.releasePointerCapture = function (pointerId) {
    captured.get(this)?.delete(pointerId);
  };

  return () => {
    proto.setPointerCapture = original.set;
    proto.hasPointerCapture = original.has;
    proto.releasePointerCapture = original.release;
  };
}

interface BoxSize {
  width: number;
  height: number;
}

// Module-level, because code under test may create its observer once and keep
// it across tests (observe-size shares a single instance).
const resizeObservers = new Set<FakeResizeObserver>();

class FakeResizeObserver {
  /** Each target, with the box it's observed by and its size last told. */
  readonly targets = new Map<
    Element,
    { box: ResizeObserverBoxOptions; last: BoxSize | null }
  >();
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.add(this);
  }
  observe(target: Element, options?: ResizeObserverOptions) {
    this.targets.set(target, {
      box: options?.box ?? "content-box",
      last: null,
    });
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  report(target: Element, content: BoxSize, border: BoxSize) {
    const observed = this.targets.get(target);
    if (!observed) return;
    // As the browser does: only when the box it's observed by changed.
    const size = observed.box === "border-box" ? border : content;
    const { last } = observed;
    if (last && last.width === size.width && last.height === size.height) {
      return;
    }
    observed.last = { ...size };
    const entry = {
      target,
      contentRect: content,
      borderBoxSize: [{ inlineSize: border.width, blockSize: border.height }],
    };
    this.callback(
      [entry as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

/** A ResizeObserver whose measurements tests report by hand. */
export function installResizeObserver() {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;

  return {
    /**
     * Reports a new size for `target` to whoever observes it: its content
     * box, and its border box (the same, unless given).
     */
    resize(target: Element, size: BoxSize, border: BoxSize = size) {
      for (const instance of resizeObservers) {
        instance.report(target, size, border);
      }
    },
    isObserved(target: Element) {
      return [...resizeObservers].some((instance) =>
        instance.targets.has(target),
      );
    },
    restore() {
      globalThis.ResizeObserver = original;
    },
  };
}

/**
 * A viewport of the given size, as the library reads it (jsdom lays nothing
 * out). `resize` changes it and fires the window's `resize`.
 */
export function installViewport(width: number, height: number) {
  let size = { width, height };
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return "resizableViewport" in this.dataset
      ? DOMRect.fromRect(size)
      : original.call(this);
  };

  return {
    resize(nextWidth: number, nextHeight: number) {
      size = { width: nextWidth, height: nextHeight };
      window.dispatchEvent(new Event("resize"));
    },
    restore() {
      HTMLElement.prototype.getBoundingClientRect = original;
    },
  };
}

interface PointerInit {
  x?: number;
  y?: number;
  pointerId?: number;
  button?: number;
  isPrimary?: boolean;
}

/** Dispatches a bubbling pointer event and returns it. */
export function pointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  {
    x = 0,
    y = 0,
    pointerId = 1,
    button = 0,
    isPrimary = true,
  }: PointerInit = {},
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId,
    button,
    isPrimary,
  });
  target.dispatchEvent(event);
  return event;
}

/** Dispatches a keydown on `target` and returns it. */
export function keyDown(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}
