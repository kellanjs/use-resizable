/**
 * Watching elements' sizes. All callers share a `ResizeObserver` per box,
 * which is cheaper than one per element and delivers every change in a
 * frame as one batch, before paint.
 */

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Which size to report: the content box (inside padding and border; what
 * children lay out in) or the border box (the space the element occupies).
 */
export type SizeBox = "content-box" | "border-box";

type Callback = (size: ElementSize) => void;

interface Observed {
  /** The latest entry, so late subscribers get a size straight away. */
  entry: ResizeObserverEntry | null;
  readonly callbacks: Set<Callback>;
}

/**
 * Each box's observer, and what it observes: an element is observed once
 * for each box asked of it, since a change to one box (padding alone, say)
 * needn't change the other.
 */
const watchers = new Map<
  SizeBox,
  {
    readonly observer: ResizeObserver;
    readonly observed: Map<Element, Observed>;
  }
>();

function watcherFor(box: SizeBox) {
  let watcher = watchers.get(box);
  if (!watcher) {
    const observed = new Map<Element, Observed>();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const record = observed.get(entry.target);
        if (!record) continue;
        record.entry = entry;
        for (const listener of record.callbacks) listener(sizeOf(entry, box));
      }
    });
    watcher = { observer, observed };
    watchers.set(box, watcher);
  }
  return watcher;
}

function sizeOf(entry: ResizeObserverEntry, box: SizeBox): ElementSize {
  const border = box === "border-box" ? entry.borderBoxSize?.[0] : undefined;
  // Box sizes are logical (inline/block); this assumes horizontal writing.
  return border
    ? { width: border.inlineSize, height: border.blockSize }
    : { width: entry.contentRect.width, height: entry.contentRect.height };
}

/**
 * Calls `callback` with the element's size once it's known, and again
 * whenever it changes. Returns a function that stops observing. Two
 * watching one element (a layout's element that's also a resizable's
 * container) can ask for different boxes, and each hears of changes to
 * its own.
 *
 * Where `ResizeObserver` doesn't exist (jsdom in an app's tests, very old
 * browsers), nothing is measured and elements keep their CSS sizes.
 */
export function observeSize(
  element: Element,
  callback: Callback,
  box: SizeBox = "content-box",
): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const { observer, observed } = watcherFor(box);
  let record = observed.get(element);
  if (record) {
    if (record.entry) callback(sizeOf(record.entry, box));
  } else {
    record = { entry: null, callbacks: new Set() };
    observed.set(element, record);
    // The observer reports a first measurement shortly after this.
    observer.observe(element, { box });
  }
  record.callbacks.add(callback);

  return () => {
    record.callbacks.delete(callback);
    if (record.callbacks.size > 0) return;
    observed.delete(element);
    observer.unobserve(element);
  };
}
