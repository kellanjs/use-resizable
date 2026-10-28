/**
 * The layout controller connects the pure layout model to the DOM. It owns
 * the layout's one store, measures the nodes, listens to the separators and
 * junctions, and turns events into model actions. It doesn't know about
 * React; the hook is a thin layer on top.
 *
 * Each group's space is measured as its children's sizes added up (each
 * child's border box along the group's axis). Children fill their group
 * through flexbox, so that sum is exactly what they have; the group's own
 * size minus that sum is what its separators, gaps and padding take.
 */
import {
  type Callbacks,
  createControllerCore,
} from "../foundation/controller-core.js";
import { ignorePress } from "../foundation/drag-session.js";
import { readKeyboardIntent } from "../foundation/keyboard.js";
import { observeSize } from "../foundation/observe-size.js";
import { type RefCallback, refCallback } from "../foundation/ref-callback.js";
import { type SizeValue, parseSize } from "../foundation/size.js";
import {
  warnIfClipNotOver,
  warnIfInContent,
  warnIfNothingHeld,
  warnIfUnlabelled,
  warnOnce,
} from "../foundation/warn.js";
import {
  type LayoutConfig,
  type LayoutOptions,
  type LayoutSnapshot,
  type LayoutState,
  createLayoutState,
  inMotion,
  isSeparatorDisabled,
  parseLayoutOptions,
} from "./layout-config.js";
import { holdContent, withSliding } from "./layout-content.js";
import { createLayoutMeasurement } from "./layout-measurement.js";
import {
  allowsStop,
  applyKeyboard,
  cancelDrag,
  endDrag,
  hover,
  moveDrag,
  optionsCause,
  resetToDefaults,
  setChildSize,
  setChildStop,
  setChildStops,
  setConfig,
  setRootFontSize,
  setViewport,
  startDrag,
  usesViewport,
} from "./layout-model.js";
import {
  getLayoutRendering,
  playsTransition,
  stopsOf,
} from "./layout-rendering.js";
import {
  isLayoutSnapshot,
  restoreSnapshot,
  snapshotsEqual,
  toSnapshot,
} from "./layout-snapshot.js";
import { type ResizableLayoutView, getLayoutView } from "./layout-view.js";
import { type SeparatorSide, separatorMoves } from "./separators.js";
import {
  type SeparatorPair,
  dragCursor,
  groupBetween,
  indexTree,
} from "./tree.js";

/**
 * Options about persistence and notification, shared with the hook. A drag
 * grabs the separators being dragged (several, from a junction), each as
 * the nodes either side of it.
 */
export type LayoutCallbacks<Id extends string = string> = Callbacks<
  LayoutSnapshot,
  readonly SeparatorPair<Id>[]
>;

export type LayoutControllerOptions = LayoutOptions & LayoutCallbacks;

/**
 * A separator's cache key: its pair (and what else tells its elements
 * apart), as JSON, so no ids can pass for others'. Read back for pruning.
 */
const separatorKey = (
  { before, after }: SeparatorPair,
  primary: SeparatorSide,
  segment: number,
) => JSON.stringify([before, after, primary, segment]);

/** A junction's cache key: its separators' pairs, as JSON. */
const junctionKey = (pairs: readonly SeparatorPair[]) =>
  JSON.stringify(pairs.map(({ before, after }) => [before, after]));

export interface LayoutController {
  /**
   * What it is now: each child's size and stop, what's being dragged (see
   * `ResizableLayoutView`). The same object until something changes, so
   * it can be compared to tell.
   */
  getView(): ResizableLayoutView;
  /** Calls `listener` after every change. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Applies the latest options. Cheap to call on every render. */
  setOptions(options: LayoutControllerOptions): void;
  mount(): () => void;
  /** A stable ref callback for the element with this id. */
  elementRef(id: string): RefCallback;
  /** A stable ref callback for the group (the root too) with this id. */
  groupRef(id: string): RefCallback;
  /** A stable ref callback for a clip layer (`getClipProps(id)`). */
  clipRef(id: string): RefCallback;
  /**
   * A stable ref callback for the separator between two neighbours. Its
   * keys are about its `primary` neighbour (Home, End and Enter; see
   * `getSeparatorProps`). Each `segment` of a grid's line (an element of
   * its own) has its own.
   */
  separatorRef(
    before: string,
    after: string,
    primary?: SeparatorSide,
    segment?: number,
  ): RefCallback;
  /**
   * A stable ref callback for a junction: an element that drags several
   * separators at once, like a corner drives two edges.
   */
  junctionRef(pairs: readonly SeparatorPair[]): RefCallback;

  /**
   * Moves a child (an element or a nested group) to the stop called `stop`:
   * a point, or a range at the size it last had there. Its siblings make
   * room. Throws for an unknown stop.
   */
  setStop(id: string, stop: string): void;
  /**
   * Moves a child to `stop`, or if it's already there, back: to the stop it
   * came from if that's a larger one, else to the last range it was in.
   */
  toggle(id: string, stop: string): void;
  /**
   * Moves several children to stops at once, as one change (one
   * transition, one `onChange`): `{ note: "open", display: "closed" }`. The
   * order written doesn't matter: one refused at its turn is tried again
   * after the rest. All or nothing: if one still can't move, none do.
   */
  setStops(stops: Readonly<Record<string, string | undefined>>): void;
  /** Whether `setStops(stops)` would change anything. */
  canSetStops(stops: Readonly<Record<string, string | undefined>>): boolean;
  /**
   * Whether `setStop(id, stop)` would change anything, for disabling a control
   * that wouldn't: `false` if it would change nothing (a child stepped down to
   * `stop` changes: it's chosen there, so it stays when there's room), if it's
   * refused (it'd leave the child's group with nothing to take its space: see
   * "Empty space" in the README; or with `refuseOverflow`, it'd overflow), or
   * if there's no child `id`. Throws for an unknown stop.
   */
  canSetStop(id: string, stop: string): boolean;
  /**
   * Whether `toggle(id, stop)` would change anything: as `canSetStop`, but
   * a child at `stop` goes back, so it's `false` there only if it has
   * nowhere to go back to, or going back would be refused.
   */
  canToggle(id: string, stop: string): boolean;
  /**
   * Asks for a child's size along its group's axis. It lands like a drag
   * would; its siblings make room.
   */
  setSize(id: string, size: SizeValue): void;
  getSnapshot(): LayoutSnapshot;
  /** Restores a saved layout without animating or calling `onChange`. */
  restore(snapshot: LayoutSnapshot): void;
  /**
   * Goes back to the layout the options start with (also with the root's
   * id); with a child's id, just that child goes back to its default stop
   * and size, and its siblings make room. For a "reset" menu item, or
   * double-clicking a separator.
   */
  reset(id?: string): void;
}

/** The controller with what only the hook reads. */
export interface LayoutControllerWithState extends LayoutController {
  getState(): LayoutState;
  /**
   * Whether the junction element now rendered with `pairs` is the one that
   * was pressed: its pairs can change mid-drag (lines coming into line, say)
   * and it's still the junction being dragged.
   */
  isPressedJunction(pairs: readonly SeparatorPair[]): boolean;
}

/** A layout without React: see the README's "Without React". */
export function createLayoutController(
  initialOptions: LayoutControllerOptions,
): LayoutController {
  return createLayoutControllerWithState(initialOptions);
}

export function createLayoutControllerWithState(
  initialOptions: LayoutControllerOptions,
): LayoutControllerWithState {
  const core = createControllerCore<
    LayoutControllerOptions,
    LayoutConfig,
    LayoutState,
    LayoutSnapshot,
    readonly SeparatorPair[]
  >(
    {
      parse: parseLayoutOptions,
      setConfig,
      toSnapshot,
      snapshotsEqual,
      isSnapshot: isLayoutSnapshot,
      restore: restoreSnapshot,
      reset: resetToDefaults,
      optionsCause,
      playsTransition,
      // Mid-animation, from where they're shown, not where they're going.
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
    createLayoutState(
      parseLayoutOptions(initialOptions),
      initialOptions.initialSnapshot,
    ),
  );
  const { store, commit } = core;
  // The browser's measurements of the layout, which keep its spaces current.
  const {
    elements: nodeElements,
    scheduleMeasure,
    shownIn,
    shownSize,
    startJoinersAtZero,
    rootElement,
    observeNode,
    isReversed,
  } = createLayoutMeasurement(store);

  const nodeRefs = new Map<string, RefCallback>();
  const separatorRefs = new Map<string, RefCallback>();
  const clipRefs = new Map<string, RefCallback>();
  const junctionRefs = new Map<string, RefCallback>();
  /**
   * Mounted junctions and the separators each drags, so a separator can
   * tell a hover inside one, and in development, a press that one should
   * have had.
   */
  const junctions = new Map<Element, readonly SeparatorPair[]>();
  /**
   * The junction element the drag was pressed on, if it was one. Only read
   * while a drag is live (see `isPressedJunction`).
   */
  let pressedJunction: Element | null = null;
  /** An element whose hover a ref change is handing on to its next ref. */
  let rehovered: Element | null = null;

  /**
   * Starts dragging the separators between each pair, from a separator or
   * (`junction`) the junction element pressed.
   */
  function dragSeparators(
    event: PointerEvent,
    pressed: readonly SeparatorPair[],
    junction: Element | null = null,
  ) {
    const state = store.get();
    // A junction drags only its separators that aren't disabled.
    const pairs = pressed.filter(
      (pair) => !isSeparatorDisabled(state.config, pair.before, pair.after),
    );
    // Pinned (see `separatorMoves`), or every one disabled: a press there
    // does nothing.
    if (!pairs.some((pair) => separatorMoves(state, pair.before, pair.after))) {
      ignorePress(event);
      return;
    }
    core.drag(event, {
      cursor: dragCursor(store.get().config.root, pairs),
      start: (current) => {
        pressedJunction = junction;
        // Read now: mid-animation, the last report may be a frame old.
        return startDrag(current, pairs, isReversed, shownSize);
      },
      grabbed: (current) => getLayoutRendering(current).dragging,
    });
  }

  /**
   * While a mouse or pen is over a separator or junction, the separators a
   * press there would drag get `data-hover` (a touch has no hover).
   * `pointerover`, unlike `pointerenter`, fires again when the pointer comes
   * back to a separator from a junction inside it.
   */
  function trackHover(
    element: HTMLElement,
    pairs: readonly SeparatorPair[],
  ): () => void {
    // The same element with new pairs (a new ref): it's still under the
    // pointer, and no pointerover is coming until the pointer moves.
    if (rehovered === element) store.set(hover(store.get(), pairs));
    rehovered = null;
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      // Over a junction inside this separator: the junction's hover wins.
      if (!junctions.has(element) && insideJunction(event.target, element)) {
        return;
      }
      store.set(hover(store.get(), pairs));
    };
    const leave = () => {
      if (store.get().hovered === pairs) store.set(hover(store.get(), null));
    };
    element.addEventListener("pointerover", onOver);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointerover", onOver);
      element.removeEventListener("pointerleave", leave);
      // Unmounted under the pointer: no pointerleave is coming. If it's
      // only getting a new ref, the next one takes the hover over.
      if (store.get().hovered === pairs) {
        rehovered = element;
        // A new ref attaches in the same commit; after that, it's gone.
        queueMicrotask(() => {
          if (rehovered === element) rehovered = null;
        });
      }
      leave();
    };
  }

  /**
   * A separator got a press inside a junction's box, so something covers
   * the junction there and it can't be pressed. Only a diagnosis: where
   * things are on screen never decides what a press drags.
   */
  function warnIfCovered(event: PointerEvent, pressed: SeparatorPair) {
    for (const [junction, pairs] of junctions) {
      const box = junction.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside || box.width === 0 || box.height === 0) continue;
      // Hidden or made unpressable on purpose: not covered.
      const style = getComputedStyle(junction);
      if (style.visibility !== "visible" || style.pointerEvents === "none") {
        continue;
      }
      const name = pairs
        .map(({ before, after }) => `["${before}", "${after}"]`)
        .join(", ");
      warnOnce(
        `A press inside the junction of ${name} went to the separator between "${pressed.before}" and "${pressed.after}": that separator (or something in it) is on top of the junction, so the junction can't be pressed there. Usually a separator has a z-index, which makes it a stacking context: anything inside it, the junction or its hit area, is then layered only against the rest of that separator. Put the z-index on the separators' hit areas and on the junction instead.`,
      );
    }
  }

  /** Whether `target` is in a junction inside `separator`. */
  function insideJunction(target: EventTarget | null, separator: Element) {
    for (
      let node = target instanceof Element ? target : null;
      node && node !== separator;
      node = node.parentElement
    ) {
      if (junctions.has(node)) return true;
    }
    return false;
  }

  function createSeparatorRef(
    pair: SeparatorPair,
    primary: SeparatorSide,
  ): RefCallback {
    const pairs = [pair];
    const onPointerDown = (event: PointerEvent) => {
      // A press inside a junction is the junction's (it stops it first).
      if (process.env.NODE_ENV !== "production") warnIfCovered(event, pair);
      dragSeparators(event, pairs);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.get();
      const group = groupBetween(state.config.root, pair.before, pair.after);
      if (!group) return;
      const { keyboard } = state.config;
      if (!keyboard) return;
      const read = readKeyboardIntent(event, group.axis, keyboard);
      if (!read || state.config.disabled || state.drag) return;
      event.preventDefault();
      // Arrows move the separator on screen, as a drag would: in a row
      // laid out right to left, ArrowRight grows the child after it.
      const intent =
        read.kind === "move" &&
        group.axis === "horizontal" &&
        isReversed(group.id)
          ? { ...read, delta: -read.delta }
          : read;
      commit("keyboard", (current) =>
        applyKeyboard(current, pair.before, pair.after, intent, primary),
      );
    };

    return refCallback((element) => {
      const what = `The separator between "${pair.before}" and "${pair.after}"`;
      warnIfUnlabelled(element, what);
      queueMicrotask(() => warnIfInContent(element, rootElement(), what));
      element.addEventListener("pointerdown", onPointerDown);
      element.addEventListener("keydown", onKeyDown);
      const stopHover = trackHover(element, pairs);
      // A grid's line sizes its own track, and so what its tracks share,
      // which the grid's size doesn't show. Observed for every separator,
      // as it may be a grid's only in options that haven't reached the
      // controller yet (refs attach first).
      const stopObserving = observeSize(element, scheduleMeasure, "border-box");
      return () => {
        element.removeEventListener("pointerdown", onPointerDown);
        element.removeEventListener("keydown", onKeyDown);
        stopHover();
        stopObserving();
        // A grid's line takes its track with it.
        scheduleMeasure();
      };
    });
  }

  /**
   * A junction is pointer-only, like a corner: each separator it drags can
   * be reached from the keyboard on its own.
   */
  function createJunctionRef(pairs: readonly SeparatorPair[]): RefCallback {
    const onPointerDown = (event: PointerEvent) => {
      // It's often inside one of its separators; that one mustn't start a
      // drag of its own.
      event.stopPropagation();
      dragSeparators(event, pairs, event.currentTarget as Element);
    };
    return refCallback((element) => {
      junctions.set(element, pairs);
      queueMicrotask(() =>
        warnIfInContent(element, rootElement(), "A junction"),
      );
      element.addEventListener("pointerdown", onPointerDown);
      const stopHover = trackHover(element, pairs);
      return () => {
        junctions.delete(element);
        element.removeEventListener("pointerdown", onPointerDown);
        stopHover();
      };
    });
  }

  /** Reflowing once with nothing to hold: see `warnIfNothingHeld`. */
  function warnIfReflowsLive() {
    if (store.get().config.reflow === "once" && nodeElements.size > 0) {
      warnIfNothingHeld(nodeElements.values());
    }
  }

  /**
   * Forgets the ref callbacks of children and separators no longer in the
   * options, so children coming and going (per document, say) don't pile up.
   * One that's still rendered just gets a new callback next time.
   */
  function pruneRefs() {
    const { root } = store.get().config;
    const { nodes } = indexTree(root);
    for (const id of nodeRefs.keys()) {
      if (!nodes.has(id)) nodeRefs.delete(id);
    }
    for (const id of clipRefs.keys()) {
      if (!nodes.has(id)) clipRefs.delete(id);
    }
    const gone = ([before, after]: string[]) =>
      !groupBetween(root, before, after);
    for (const key of separatorRefs.keys()) {
      if (gone(JSON.parse(key))) separatorRefs.delete(key);
    }
    for (const key of junctionRefs.keys()) {
      if ((JSON.parse(key) as string[][]).some(gone)) {
        junctionRefs.delete(key);
      }
    }
  }

  /** Ref callbacks are created once per key, so they stay stable. */
  function cached(
    cache: Map<string, RefCallback>,
    key: string,
    create: () => RefCallback,
  ): RefCallback {
    let ref = cache.get(key);
    if (!ref) {
      ref = create();
      cache.set(key, ref);
    }
    return ref;
  }

  return {
    getState: store.get,
    getView: () => getLayoutView(store.get()),
    subscribe: store.subscribe,

    setOptions: (next) =>
      core.act((now) => {
        startJoinersAtZero();
        if (!now.setOptions(next)) return;
        if (core.mounted()) warnIfReflowsLive();
        // Children added or removed change what each group adds up, but
        // not until the browser has laid them out: the size reports that
        // follow measure it then. (Measuring now would add up the sizes
        // from before.)
        pruneRefs();
      }),

    mount: () =>
      core.mount(() => {
        // While children move, rounding is set aside, and while a change
        // animates, resizes wait (see `measure`): once they stop, measure
        // where they are, exactly.
        warnIfReflowsLive();
        let moving = inMotion(store.get());
        return store.subscribe(() => {
          const now = inMotion(store.get());
          if (moving && !now) scheduleMeasure();
          moving = now;
        });
      }),

    // Ids are unique across elements and groups, so they share a cache.
    elementRef: (id) => cached(nodeRefs, id, () => observeNode(id)),
    groupRef: (id) => cached(nodeRefs, id, () => observeNode(id)),
    clipRef: (id) =>
      cached(clipRefs, id, () =>
        refCallback((clip) => {
          // The element attaches after the layer inside it.
          queueMicrotask(() => warnIfClipNotOver(clip, nodeElements.get(id)));
          return () => {};
        }),
      ),
    isPressedJunction(pairs) {
      const current = pressedJunction && junctions.get(pressedJunction);
      return (
        !!current &&
        current.length === pairs.length &&
        current.every(
          (pair, index) =>
            pair.before === pairs[index].before &&
            pair.after === pairs[index].after,
        )
      );
    },
    separatorRef: (before, after, primary = "before", segment = 0) =>
      // By side too: its keys differ. And by segment: they're different
      // elements, and React 18 detaches one by calling its ref with
      // `null`, which would detach every element sharing it.
      cached(
        separatorRefs,
        separatorKey({ before, after }, primary, segment),
        () => createSeparatorRef({ before, after }, primary),
      ),
    junctionRef: (pairs) =>
      cached(junctionRefs, junctionKey(pairs), () => createJunctionRef(pairs)),

    setStop: (id, stop) =>
      commit("stop", (state) => setChildStop(state, id, stop)),
    toggle: (id, stop) =>
      commit("stop", (state) => setChildStop(state, id, stop, true)),
    setStops: (stops) =>
      commit("stop", (state) => setChildStops(state, stopChanges(stops))),
    canSetStops: (stops) => {
      const state = store.get();
      return setChildStops(state, stopChanges(stops), true) !== state;
    },
    canSetStop: (id, stop) => allowsStop(store.get(), id, stop),
    canToggle: (id, stop) => allowsStop(store.get(), id, stop, true),
    setSize: (id, size) =>
      core.act((now) => {
        const parsed = parseSize(size);
        core.withViewportFor(parsed);
        now.commit("size", (state) => setChildSize(state, id, parsed));
      }),
    getSnapshot: () => toSnapshot(store.get()),
    restore: core.restore,
    reset: (id) => commit("reset", (state) => resetToDefaults(state, id)),
  };
}

/** `setStops`' argument as `[id, stop]` pairs, leaving out `undefined`s. */
export function stopChanges(
  stops: Readonly<Record<string, string | undefined>>,
): [string, string][] {
  return Object.entries(stops).flatMap(([id, stop]) =>
    stop === undefined ? [] : [[id, stop] as [string, string]],
  );
}
