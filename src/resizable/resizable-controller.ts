/**
 * The resizable controller connects the pure model to the DOM. It owns the
 * element's one store, measures the container, listens to the handles, and
 * turns events into model actions. It doesn't know about React; the hook is a
 * thin layer on top.
 *
 * Lifecycle:
 * - `elementRef` and `handleRef(edge)` return stable ref callbacks.
 *   Attaching an element wires it up and detaching unwires it, so elements
 *   that mount late or remount just work.
 * - `mount()` starts what should only run while the element is on screen
 *   (container, font-size and reduced-motion observation, loading the
 *   persisted snapshot) and returns its own cleanup.
 */
import {
  type Callbacks,
  type CoreChanges,
  createControllerCore,
} from "../foundation/controller-core.js";
import { isRightToLeft } from "../foundation/direction.js";
import {
  type Dimension,
  type HandleEdge,
  type LogicalHandleEdge,
  cursorFor,
  edgesOf,
  isCorner,
  physicalEdge,
} from "../foundation/handle.js";
import { readKeyboardIntent } from "../foundation/keyboard.js";
import { type ElementSize, observeSize } from "../foundation/observe-size.js";
import { type RefCallback, refCallback } from "../foundation/ref-callback.js";
import { getRootFontSize } from "../foundation/root-font-size.js";
import {
  type Size,
  type SizeValue,
  parseOffset,
  parseSize,
} from "../foundation/size.js";
import { viewportFor } from "../foundation/viewport.js";
import {
  warnIfClipNotOver,
  warnIfInContent,
  warnIfNothingHeld,
  warnIfUncontained,
  warnIfUnlabelled,
  warnOnce,
} from "../foundation/warn.js";
import type { Point } from "./position.js";
import {
  DIMENSIONS,
  type DragTarget,
  type ResizableConfig,
  type ResizableOptions,
  type ResizableSnapshot,
  type ResizableState,
  createResizableState,
  parseResizableOptions,
  storedDimension,
} from "./resizable-config.js";
import {
  applyKeyboard,
  cancelDrag,
  dimensionsWithStop,
  endDrag,
  holdContent,
  keyboardCornerOf,
  measure,
  measureOwn,
  moveByKeyboard,
  moveDrag,
  playsTransition,
  setConfig,
  setPosition,
  setRootFontSize,
  setSize,
  setStop,
  setViewport,
  startDrag,
  stopsOf,
  usesViewport,
  withSliding,
} from "./resizable-model.js";
import {
  isResizableSnapshot,
  resetToDefaults,
  restoreSnapshot,
  snapshotsEqual,
  toSnapshot,
} from "./resizable-snapshot.js";
import { type ResizableView, getResizableView } from "./resizable-view.js";

/**
 * Options about persistence and notification, shared with the hook. A drag
 * grabs a handle (the edge it drives), or "move".
 */
export type ResizableCallbacks = Callbacks<ResizableSnapshot, DragTarget>;

export type ResizableControllerOptions = ResizableOptions &
  ResizableCallbacks & {
    /** The element `%` sizes are relative to. Defaults to the element's parent. */
    getContainer?: () => Element | null;
  };

export interface ResizableController {
  /**
   * What it is now: sizes, stops, what's being dragged (see
   * `ResizableView`). The same object until something changes, so it can
   * be compared to tell.
   */
  getView(): ResizableView;
  /** Calls `listener` after every change. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Applies the latest options. Cheap to call on every render. */
  setOptions(options: ResizableControllerOptions): void;
  mount(): () => void;
  elementRef: RefCallback;
  /**
   * A stable ref callback for the handle that drives `edge`. A logical edge
   * (`end`) is resolved when the handle is pressed, so a press after the
   * direction changes drives what that edge is now.
   */
  handleRef(edge: HandleEdge | LogicalHandleEdge): RefCallback;
  /**
   * The physical edge a logical one (`start`, `bottom-end`) stands for, by
   * the element's direction as last read; a physical one as it is.
   */
  resolveEdge(edge: HandleEdge | LogicalHandleEdge): HandleEdge;
  /** A stable ref callback for a floating element's move handle. */
  moveHandleRef: RefCallback;
  /** A stable ref callback for a clip layer (`getClipProps`). */
  clipRef: RefCallback;

  /**
   * Goes to the stop called `stop`: a point, or a range at the size it last
   * had there. Acts on `dimension`, or by default on every dimension with a
   * stop of that name. Throws for an unknown stop.
   */
  setStop(stop: string, dimension?: Dimension): void;
  /**
   * Goes to `stop`, or if it's already there, back: to the stop it came
   * from if that's a larger one, else to the last range it was in. Acts on
   * dimensions like `setStop`; across several, it decides once: back only
   * if all of them are at `stop`, otherwise all go to it.
   */
  toggle(stop: string, dimension?: Dimension): void;
  /**
   * Asks for sizes. Each lands like a drag would: kept as given inside a
   * range, or moved to the nearest stop. Before the container is
   * measured, they wait for it (unless a later change of the dimension
   * comes first). With `aspectRatio`, a height sizes the width.
   */
  setSize(sizes: Partial<Record<Dimension, SizeValue>>): void;
  /** Moves a floating element. */
  setPosition(position: { x?: SizeValue; y?: SizeValue }): void;
  getSnapshot(): ResizableSnapshot;
  /** Restores saved state without animating or calling `onChange`. */
  restore(snapshot: ResizableSnapshot): void;
  /**
   * Goes back to the sizes and position the options start with; with
   * `dimension`, just that one. For double-clicking a handle, say.
   */
  reset(dimension?: Dimension): void;
}

/** The controller with the raw state, which only the hook reads. */
export interface ResizableControllerWithState extends ResizableController {
  getState(): ResizableState;
}

/** A resizable without React: see the README's "Without React". */
export function createResizableController(
  initialOptions: ResizableControllerOptions,
): ResizableController {
  return createResizableControllerWithState(initialOptions);
}

export function createResizableControllerWithState(
  initialOptions: ResizableControllerOptions,
): ResizableControllerWithState {
  /**
   * Whether the element is laid out right to left, which logical anchors
   * and handles (`start`, `end`) follow. Left to right until it's mounted,
   * as on the server, which can't know: the first render hydrates the
   * server's HTML as it is, and the direction read as it mounts applies
   * before anything's painted.
   */
  let rtl = false;
  /**
   * `setSize` calls made before the first measurement, by the dimension
   * they size (the width, for a ratio-locked height): where a size lands
   * depends on the container, so they wait for it. A later call for the
   * dimension replaces one, and any other change of it (`setStop`,
   * `reset`, `restore`, …) drops it: the latest asked for is what's shown.
   */
  const pendingSizes = new Map<Dimension, [Dimension, Size]>();

  /** Drops what's pending for `dimensions` (all, by default). */
  function dropPending(dimensions: readonly Dimension[] = DIMENSIONS) {
    for (const dimension of dimensions) pendingSizes.delete(dimension);
  }

  const core = createControllerCore<
    ResizableControllerOptions,
    ResizableConfig,
    ResizableState,
    ResizableSnapshot,
    DragTarget
  >(
    {
      parse: (options) => parseResizableOptions(options, rtl),
      setConfig,
      toSnapshot,
      snapshotsEqual,
      isSnapshot: isResizableSnapshot,
      // A size waiting for measurement is older than a snapshot or a key's
      // defaults, however they came (persistence, a synced change).
      restore: (state, snapshot) => {
        dropPending();
        return restoreSnapshot(state, snapshot);
      },
      reset: (state) => {
        dropPending();
        return resetToDefaults(state);
      },
      // Its options have nothing like a layout's children.
      optionsCause: () => "options",
      playsTransition,
      // Mid-animation, from where it's shown, not where it's going.
      holdContent: (before, after) =>
        holdContent(before, after, shownIn(before)),
      recordSliding: (before, after, begins) =>
        withSliding(before, after, begins, shownIn(before)),
      setRootFontSize,
      setViewport,
      usesViewport,
      stopsOf,
      moveDrag,
      endDrag,
      cancelDrag,
    },
    initialOptions,
    createResizableState(
      parseResizableOptions(initialOptions, rtl),
      initialOptions.initialSnapshot,
    ),
  );
  const { store, commit } = core;

  let element: HTMLElement | null = null;
  let stopContainer: (() => void) | null = null;
  /** Measures the observed container again (see `connectContainer`). */
  let remeasureContainer: (() => void) | null = null;
  /** Stops observing the element itself (see `observeOwn`). */
  let stopOwn: (() => void) | null = null;
  /** The element `%` sizes are relative to, while it's observed. */
  let observed: Element | null = null;
  const handleRefs = new Map<DragTarget | LogicalHandleEdge, RefCallback>();

  // The container is observed only while mounted and the element exists,
  // since by default it's found through the element's parent.
  function containerOf(of: HTMLElement): Element | null {
    return core.options().getContainer?.() ?? of.parentElement;
  }

  /**
   * Reads the element's direction (when it's mounted, measured, or grabbed),
   * and if it changed, applies the options again for logical names.
   */
  function readDirection() {
    if (!element) return;
    const now = isRightToLeft(element);
    if (now === rtl) return;
    rtl = now;
    core.setOptions(core.options());
  }

  function connectContainer() {
    readDirection();
    stopContainer?.();
    stopContainer = null;
    remeasureContainer = null;
    observed = null;
    observeOwn();
    if (!core.mounted() || !element) return;

    const container = containerOf(element);
    if (!container) return;
    observed = container;

    /** Its content box, as last observed. */
    let content: ElementSize | null = null;
    const remeasure = () => {
      if (!content) return;
      readDirection();
      // A floating element is placed, and its `%` sizes resolved, in its
      // container's padding box (as CSS positions an absolute element).
      const padding = store.get().config.position
        ? paddingOf(container)
        : { width: 0, height: 0 };
      store.set(
        measure(store.get(), {
          width: content.width + padding.width,
          height: content.height + padding.height,
          rootFontSize: getRootFontSize(),
          viewport: viewportFor(usesViewport(store.get())),
        }),
      );
      applyPendingSizes();
    };
    remeasureContainer = remeasure;
    const stopContent = observeSize(container, (size) => {
      content = size;
      remeasure();
    });
    // Its padding changing can leave its content box as it was (sized
    // `content-box`): its border box shows it.
    const stopBorder = observeSize(
      container,
      () => store.get().config.position && remeasure(),
      "border-box",
    );
    stopContainer = () => {
      stopContent();
      stopBorder();
    };
  }

  /** An element's padding, across and down. */
  function paddingOf(of: Element): ElementSize {
    const style = getComputedStyle(of);
    const sum = (...sides: string[]) =>
      sides.reduce((total, side) => total + (parseFloat(side) || 0), 0);
    return {
      width: sum(style.paddingLeft, style.paddingRight),
      height: sum(style.paddingTop, style.paddingBottom),
    };
  }

  /** Whether `state` confines a width or height the app sizes. */
  function needsOwn(state: ResizableState): boolean {
    return (
      state.config.position?.confined === true &&
      (!state.width || (!state.height && !state.config.aspect))
    );
  }

  /**
   * While confined, a width or height the app sizes is measured as drawn,
   * to keep the element inside its container at rest, not only once
   * grabbed (see `own`).
   */
  function observeOwn() {
    stopOwn?.();
    stopOwn = null;
    const state = store.get();
    if (!core.mounted() || !element || !needsOwn(state)) {
      if (state.own) store.set(measureOwn(state, null));
      return;
    }
    stopOwn = observeSize(
      element,
      (size) => store.set(measureOwn(store.get(), size)),
      "border-box",
    );
  }

  function applyPendingSizes() {
    if (pendingSizes.size === 0 || !store.get().container) return;
    const sizes = [...pendingSizes.values()];
    pendingSizes.clear();
    for (const [, size] of sizes) core.withViewportFor(size);
    // Part of the first layout, so it doesn't animate.
    commit("size", (state) => ({
      ...sizes.reduce(
        (current, [dimension, size]) => setSize(current, dimension, size),
        state,
      ),
      animate: null,
    }));
  }

  /** Reflowing once with nothing to hold: see `warnIfNothingHeld`. */
  function warnIfReflowsLive() {
    if (store.get().config.reflow === "once" && element) {
      warnIfNothingHeld([element]);
    }
  }

  /**
   * The element's size now. A dimension the app sizes is measured as drawn;
   * one the library sizes, as its CSS has it at this moment (mid-animation,
   * on its way somewhere): what `width` or `height` sets, whatever the
   * `box-sizing`, and without any `transform`, so a drag starting there
   * keeps the grabbed edge under the pointer.
   */
  function measureElement(): ElementSize {
    if (!element) return { width: 0, height: 0 };
    const rect = element.getBoundingClientRect();
    const { width, height } = store.get();
    const style = width || height ? getComputedStyle(element) : null;
    return {
      width: width && style ? parseFloat(style.width) : rect.width,
      height: height && style ? parseFloat(style.height) : rect.height,
    };
  }

  /**
   * The element's size as shown in `state` if it's animating (measured: its
   * rendering is where it's going), once it's laid out.
   */
  function shownIn(state: ResizableState): ElementSize | undefined {
    if (!state.animating || state.drag) return undefined;
    const size = measureElement();
    return size.width > 0 || size.height > 0 ? size : undefined;
  }

  /**
   * Where the element is shown in its container, as CSS `left` and `top`
   * place it: from its padding box, scrolled with its content.
   */
  function measurePlace(): Point | null {
    if (!element || !observed) return null;
    const own = element.getBoundingClientRect();
    const container = observed.getBoundingClientRect();
    return {
      x: own.left - container.left - observed.clientLeft + observed.scrollLeft,
      y: own.top - container.top - observed.clientTop + observed.scrollTop,
    };
  }

  /** The physical target a handle's name stands for, by direction now. */
  function physicalTarget(named: DragTarget | LogicalHandleEdge): DragTarget {
    readDirection();
    return named === "move" ? "move" : physicalEdge(named, rtl);
  }

  function onPointerDown(
    named: DragTarget | LogicalHandleEdge,
    event: PointerEvent,
  ) {
    const target = physicalTarget(named);
    core.drag(event, {
      cursor: target === "move" ? "move" : cursorFor(target),
      start: (state) =>
        startDrag(state, target, measureElement(), measurePlace()),
      grabbed: () => target,
    });
  }

  function onKeyDown(
    named: DragTarget | LogicalHandleEdge,
    event: KeyboardEvent,
  ) {
    const target = physicalTarget(named);
    const state = store.get();
    const steps = state.config.keyboard;
    if (state.config.disabled || state.drag || !steps) return;

    if (target !== "move" && isCorner(target)) {
      // Only a corner that's the keyboard's way to resize (see
      // `keyboardCornerOf`). Its arrows move its edges, as a drag does;
      // Home, End and Enter, the edge of its first resizable dimension.
      if (target !== keyboardCornerOf(state.config)) return;
      const edges = edgesOf(target);
      const across = readKeyboardIntent(event, "horizontal", steps);
      const down = readKeyboardIntent(event, "vertical", steps);
      const [edge, intent] =
        across?.kind === "move"
          ? [edges.width, across]
          : down?.kind === "move"
            ? [edges.height, down]
            : [state.config.width ? edges.width : edges.height, across];
      if (!edge || !intent) return;
      event.preventDefault();
      commit("keyboard", (current) =>
        applyKeyboard(current, edge, intent, measureElement(), target),
      );
      return;
    }

    if (target === "move") {
      // The move handle takes arrows on both axes.
      const across = readKeyboardIntent(event, "horizontal", steps);
      const down = readKeyboardIntent(event, "vertical", steps);
      const dx = across?.kind === "move" ? across.delta : 0;
      const dy = down?.kind === "move" ? down.delta : 0;
      if (dx === 0 && dy === 0) return;
      event.preventDefault();
      commit("keyboard", (current) =>
        moveByKeyboard(current, dx, dy, measureElement()),
      );
      return;
    }

    const axis =
      target === "left" || target === "right" ? "horizontal" : "vertical";
    const intent = readKeyboardIntent(event, axis, steps);
    if (!intent) return;
    event.preventDefault();
    commit("keyboard", (current) =>
      applyKeyboard(current, target, intent, measureElement()),
    );
  }

  /** Ref callbacks are created once per target, so they stay stable. */
  function refFor(target: DragTarget | LogicalHandleEdge): RefCallback {
    let ref = handleRefs.get(target);
    if (!ref) {
      ref = refCallback((handle) => {
        // Edges, the move handle and the corner that takes keys (see
        // `keyboardCornerOf`) are focusable, so they need a name; the other
        // corners are hidden from assistive tech.
        const what =
          target === "move" ? "The move handle" : `The "${target}" handle`;
        const physical = target === "move" ? "move" : physicalEdge(target, rtl);
        if (
          physical === "move" ||
          !isCorner(physical) ||
          physical === keyboardCornerOf(store.get().config)
        ) {
          warnIfUnlabelled(handle, what);
        }
        // The element attaches after the handles inside it.
        queueMicrotask(() => {
          warnIfUncontained(handle, element, what);
          warnIfInContent(handle, element, what);
        });
        const pointerDown = (event: PointerEvent) =>
          onPointerDown(target, event);
        const keyDown = (event: KeyboardEvent) => onKeyDown(target, event);
        handle.addEventListener("pointerdown", pointerDown);
        handle.addEventListener("keydown", keyDown);
        return () => {
          handle.removeEventListener("pointerdown", pointerDown);
          handle.removeEventListener("keydown", keyDown);
        };
      });
      handleRefs.set(target, ref);
    }
    return ref;
  }

  /**
   * `setSize`, in its turn. Before the first measurement, a size waits for
   * it (see `pendingSizes`).
   */
  function setSizes(
    now: CoreChanges<
      ResizableControllerOptions,
      ResizableState,
      ResizableSnapshot
    >,
    sizes: Partial<Record<Dimension, SizeValue>>,
  ) {
    const { config } = store.get();
    let asked = DIMENSIONS.flatMap((dimension) => {
      const value = sizes[dimension];
      return value === undefined
        ? []
        : [[dimension, parseSize(value)] as [Dimension, Size]];
    });
    if (config.aspect && asked.length === 2) {
      warnOnce(
        "setSize: with aspectRatio, the width and height can't both be set; the width is.",
      );
      asked = asked.filter(([dimension]) => dimension === "width");
    }
    // The dimension each sizes: a ratio-locked height sizes the width.
    const stored = (dimension: Dimension) => storedDimension(config, dimension);
    if (!store.get().container) {
      for (const entry of asked) {
        if (store.get()[stored(entry[0])]) {
          pendingSizes.set(stored(entry[0]), entry);
        }
      }
      return;
    }
    dropPending(asked.map(([dimension]) => stored(dimension)));
    for (const [, size] of asked) core.withViewportFor(size);
    now.commit("size", (state) =>
      asked.reduce(
        (current, [dimension, size]) => setSize(current, dimension, size),
        state,
      ),
    );
  }

  return {
    getState: store.get,
    getView: () => getResizableView(store.get()),
    subscribe: store.subscribe,

    setOptions: (next) =>
      core.act((now) => {
        const measuredOwn = needsOwn(store.get());
        const floating = store.get().config.position !== null;
        now.setOptions(next);
        // Floating or not: its container is measured another way.
        if ((store.get().config.position !== null) !== floating) {
          remeasureContainer?.();
        }
        if (core.mounted()) warnIfReflowsLive();
        // Confined or not, or which dimensions the app sizes, changed.
        if (needsOwn(store.get()) !== measuredOwn) observeOwn();
        // A container ref that now points elsewhere (or a moved element).
        if (core.mounted() && element && containerOf(element) !== observed) {
          connectContainer();
        }
      }),

    mount: () =>
      core.mount(() => {
        connectContainer();
        warnIfReflowsLive();
        return connectContainer;
      }),

    elementRef: refCallback((next) => {
      element = next;
      connectContainer();
      return () => {
        element = null;
        connectContainer();
      };
    }),

    handleRef: refFor,
    resolveEdge: (edge) => physicalEdge(edge, rtl),
    moveHandleRef: refFor("move"),
    clipRef: refCallback((clip) => {
      // The element attaches after the layer inside it.
      queueMicrotask(() => warnIfClipNotOver(clip, element));
      return () => {};
    }),

    setStop: (stop, dimension) =>
      core.act((now) => {
        const dimensions = dimensionsWithStop(
          store.get().config,
          stop,
          dimension,
        );
        dropPending(dimensions);
        now.commit("stop", (state) => setStop(state, dimensions, stop));
      }),
    toggle: (stop, dimension) =>
      core.act((now) => {
        const dimensions = dimensionsWithStop(
          store.get().config,
          stop,
          dimension,
        );
        dropPending(dimensions);
        now.commit("stop", (state) => setStop(state, dimensions, stop, true));
      }),
    setSize: (sizes) => core.act((now) => setSizes(now, sizes)),
    setPosition: ({ x, y }) =>
      core.act((now) => {
        const point = {
          ...(x !== undefined && { x: parseOffset(x) }),
          ...(y !== undefined && { y: parseOffset(y) }),
        };
        for (const size of Object.values(point)) core.withViewportFor(size);
        now.commit("position", (state) => setPosition(state, point));
      }),
    getSnapshot: () => toSnapshot(store.get()),
    restore: (snapshot) =>
      core.act((now) => {
        dropPending();
        now.restore(snapshot);
      }),
    reset: (dimension) =>
      core.act((now) => {
        dropPending(
          dimension === undefined
            ? DIMENSIONS
            : [storedDimension(store.get().config, dimension)],
        );
        now.commit("reset", (state) => resetToDefaults(state, dimension));
      }),
  };
}
