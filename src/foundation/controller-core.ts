/**
 * What both controllers share, around a model that plugs in through a small
 * adapter: the one store, committing changes (animating, `onChange`,
 * persistence), loading the persisted snapshot, applying options, running
 * drag sessions with their callbacks, and the media and font subscriptions.
 * Each controller adds its own DOM wiring (what it measures, what it
 * listens to).
 */
import { ignorePress, startDragSession } from "./drag-session.js";
import { prefersReducedMotion, subscribeReducedMotion } from "./media.js";
import {
  type PersistOptions,
  loadSnapshot,
  saveSnapshot,
  subscribeSnapshot,
} from "./persist.js";
import {
  type StopHistory,
  recordFromStops,
  recordPreviousStops,
} from "./previous-stops.js";
import { subscribeRootFontSize } from "./root-font-size.js";
import { type Viewport, usesViewportUnits } from "./size.js";
import { type Store, createStore } from "./store.js";
import {
  type AnimatedState,
  type ChangeKind,
  TRANSITION_GRACE,
  endAnimation,
  setReducedMotion,
  startAnimation,
  transitionOf,
} from "./transition.js";
import { readViewport, subscribeViewport } from "./viewport.js";

/**
 * What made a committed change: one of the kinds of change that animate
 * (see `ChangeKind`; `drag` and `keyboard` are the user's own), `options`
 * (new options changed what's shown, a switch of `persist.key` included),
 * or `sync` (followed from elsewhere, like another tab, with
 * `persist.sync`).
 */
export type ChangeCause = ChangeKind | "options" | "sync";

/** What `onChange` is told about a change, besides the new snapshot. */
export interface CommittedChange {
  readonly cause: ChangeCause;
}

/**
 * Options about persistence and notification, the same for both hooks.
 * `Grab` is what a drag takes hold of: a handle (or "move") on an element,
 * the separators being dragged in a layout.
 */
export interface Callbacks<Snapshot, Grab> {
  /** Saved state to start from instead of the defaults. Read once. */
  initialSnapshot?: Snapshot;
  /**
   * Called when a change is committed (not mid-drag), with what caused it:
   * to tell the user's changes (`drag`, `keyboard`) from the app's own, say.
   * A change it makes in turn (a `setSize` that rounds the size, say) is
   * made once this one's done, saved after it.
   */
  onChange?: (snapshot: Snapshot, change: CommittedChange) => void;
  /**
   * Save every committed change under a storage key, and restore it on
   * mount. For storage the server can read (cookies), also pass what it
   * read as `initialSnapshot`, so the server HTML is already right.
   */
  persist?: PersistOptions;
  /** A drag started, taking hold of `grabbed`. */
  onDragStart?: (grabbed: Grab) => void;
  /**
   * A drag ended: released (or ended by a stop with `endsDrag`), or
   * `cancelled`: with Escape, by unmounting, or by a change from code
   * (`setStop`, `setSize`, `reset`, `restore`, …) mid-drag.
   */
  onDragEnd?: (grabbed: Grab, end: { cancelled: boolean }) => void;
}

/** The parts of a model's state the core works with. */
export interface CoreState extends AnimatedState, StopHistory {
  readonly config: AnimatedState["config"] & {
    readonly disabled: boolean;
    readonly dragThreshold: number;
    readonly cursor: boolean;
  };
  /** The drag in progress, or `null`. */
  readonly drag: object | null;
}

/** How the core drives a model. */
export interface CoreModel<Options, Config, State, Snapshot> {
  parse(options: Options): Config;
  setConfig(state: State, config: Config): State;
  toSnapshot(state: State): Snapshot;
  snapshotsEqual(a: Snapshot, b: Snapshot): boolean;
  isSnapshot(value: unknown): value is Snapshot;
  restore(state: State, snapshot: Snapshot): State;
  reset(state: State): State;
  /**
   * What new options changed: `options`, or in a layout, `children` when
   * they added, removed or reordered some.
   */
  optionsCause(before: State, after: State): ChangeCause;
  /** Whether going from `before` to `after` plays a transition. */
  playsTransition(before: State, after: State): boolean;
  /**
   * `after`, about to animate from `before`, keeping the content as it was
   * (see `heldContent`).
   */
  holdContent(before: State, after: State): State;
  /**
   * `after`, with whether each part's content slides through the change in
   * progress, decided as it begins (`begins`: an animated change starting;
   * see `recordSliding`).
   */
  recordSliding(before: State, after: State, begins: boolean): State;
  setRootFontSize(state: State, rootFontSize: number): State;
  setViewport(state: State, viewport: Viewport): State;
  /**
   * Whether some size in `state` is in `vw` or `vh`: the options', or one
   * kept from `setSize`. The viewport is measured and watched only then.
   */
  usesViewport(state: State): boolean;
  /** Each part's current stop (`null` for none), for `previousStops`. */
  stopsOf(state: State): Readonly<Record<string, string | null>>;
  moveDrag(state: State, dx: number, dy: number): State;
  endDrag(state: State): State;
  cancelDrag(state: State): State;
}

/** The core's changes, made at once: for a controller's action (see `act`). */
export interface CoreChanges<Options, State, Snapshot> {
  /** Runs a user-facing action, reporting the result if it committed. */
  commit(cause: ChangeCause, action: (state: State) => State): void;
  /**
   * Restores a snapshot without reporting or saving it: an animation in
   * progress ends, as the restored state is shown at once.
   */
  restore(snapshot: Snapshot): void;
  /** Applies the latest options; returns whether the config changed. */
  setOptions(options: Options): boolean;
}

export interface ControllerCore<Options, State, Snapshot, Grab> {
  readonly store: Store<State>;
  /** The latest options. */
  options(): Options;
  /** Whether `mount()` is in effect. */
  mounted(): boolean;
  /** `CoreChanges`' `commit`, in turn (see `act`). */
  commit(cause: ChangeCause, action: (state: State) => State): void;
  /** `CoreChanges`' `restore`, in turn (see `act`). */
  restore(snapshot: Snapshot): void;
  /** `CoreChanges`' `setOptions`, in turn (see `act`). */
  setOptions(options: Options): void;
  /**
   * Runs a controller's action in turn (see `inTurn`), whole: what it
   * reads and checks before changing anything too, so it works from what
   * the changes before it left. Inside it, `now` makes the core's changes
   * at once (`commit` and the others would wait for it to end).
   */
  act(action: (now: CoreChanges<Options, State, Snapshot>) => void): void;
  /**
   * Before resolving `size` (one given to `setSize`, say): if it's in `vw`
   * or `vh`, measures the viewport, which may not be known yet (only sizes
   * in the state make it so).
   */
  withViewportFor(size: unknown): void;
  /**
   * Starts a drag session from a `pointerdown`: `start` begins the drag in
   * the model, and `grabbed` says what it took hold of, for the callbacks.
   */
  drag(
    event: PointerEvent,
    session: {
      cursor: string;
      start: (state: State) => State;
      grabbed: (state: State) => Grab;
    },
  ): void;
  /**
   * Starts the shared subscriptions, then `attach` (the controller's own,
   * returning its cleanup); returns the cleanup for both.
   */
  mount(attach: () => () => void): () => void;
}

export function createControllerCore<
  Options extends Callbacks<Snapshot, Grab>,
  Config,
  State extends CoreState & { readonly config: Config },
  Snapshot,
  Grab,
>(
  model: CoreModel<Options, Config, State, Snapshot>,
  initialOptions: Options,
  initialState: State,
): ControllerCore<Options, State, Snapshot, Grab> {
  /** Ends the live drag's session as dropped; set while a drag is live. */
  let onDropped: (() => void) | null = null;
  /** In the session's own handlers, whose changes end drags on purpose. */
  let inSession = false;
  /** Set while `commit` stores an animated change that isn't a release. */
  let beginning = false;
  // Every change goes through here, whatever made it, so each one records
  // the stops it left, where the change in progress began, and whether its
  // content slides.
  const states = createStore(initialState);
  const store: Store<State> = {
    get: states.get,
    set: (next) => {
      const before = states.get();
      states.set(
        model.recordSliding(
          before,
          recordFromStops(
            before,
            recordPreviousStops(before, next, model.stopsOf),
            model.stopsOf,
            beginning,
          ),
          beginning,
        ),
      );
      // Something other than the drag itself dropped it (`reset`,
      // `setSize`, a restore, unmounting): end the session now, rather than
      // on the pointer's next move.
      if (onDropped && !inSession && !states.get().drag) onDropped();
    },
    subscribe: states.subscribe,
  };
  /** A change `sync` heard about mid-drag, applied once the drag ends. */
  let followLater: (() => void) | null = null;
  /** Whether a change is being made (see `inTurn`). */
  let busy = false;
  /** Changes asked for while another was being made, in order. */
  const waiting: (() => void)[] = [];
  let options = initialOptions;
  let configKey = JSON.stringify(initialState.config);
  let mounted = false;
  /**
   * The storage key the state was last loaded from, if any. The key names
   * what's saved: a new `storage` under the same key (an adapter written
   * inline, made anew each render) isn't loaded again.
   */
  let persistedKey: string | undefined;
  /** Stops watching the viewport; set while sizes use `vw` or `vh`. */
  let stopViewport: (() => void) | null = null;
  /** The key `sync` follows, and how to stop following it. */
  let following: { readonly key: string } | null = null;
  let stopFollowing: (() => void) | null = null;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  /** Stops following the pointer; set from a press until its session ends. */
  let stopSession: (() => void) | null = null;
  /** Tells the app the drag in progress ended (`onDragEnd`, with its grab). */
  let reportDragEnd: ((cancelled: boolean) => void) | null = null;

  /**
   * Makes changes one at a time. One asked for while another is being
   * made (an `onChange`, an `onDragEnd` or a subscriber acting at once, a
   * change from another tab heard as a drag ends) waits until that one is
   * stored, saved and reported, then is made from what it left: it's the
   * newer, so it's saved and reported after, and nothing older is saved
   * over it. So it doesn't take effect before the call that asked for it
   * returns. One that throws doesn't keep the rest from being made: the
   * first error is thrown once they are.
   */
  function inTurn(change: () => void) {
    if (busy) {
      waiting.push(change);
      return;
    }
    busy = true;
    let failed: { error: unknown } | null = null;
    try {
      for (
        let next: (() => void) | undefined = change;
        next;
        next = waiting.shift()
      ) {
        try {
          next();
        } catch (error) {
          failed ??= { error };
        }
      }
    } finally {
      busy = false;
    }
    if (failed) throw failed.error;
  }

  function commit(cause: ChangeCause, action: (state: State) => State) {
    const before = store.get();
    let after = action(before);
    if (after === before) return;
    // Marked in the same update as the change, so something going to zero stays
    // visible while it animates. (Nothing animates mid-drag.)
    const timing = after.drag ? null : transitionOf(after);
    const animates = timing !== null && model.playsTransition(before, after);
    if (animates) {
      after = startAnimation(model.holdContent(before, after));
      clearTimeout(animationTimer);
      animationTimer = setTimeout(
        () => store.set(endAnimation(store.get())),
        timing.duration + TRANSITION_GRACE,
      );
    } else {
      after = endSuperseded(before, after);
    }
    // An animated change starts a change of its own (see `fromStops`),
    // but a drag's release, or its landing in a stop that ends it, goes on
    // with the drag's.
    beginning = animates && before.drag === null;
    try {
      store.set(after);
    } finally {
      beginning = false;
    }
    report(before, after, cause);
    // A size from `setSize` may be in `vw` or `vh` now, or no longer.
    watchViewport();
  }

  /**
   * `state` with the viewport as it is now, if its sizes are in `vw` or
   * `vh` (restored ones, say: it may have changed while nothing watched
   * it), so they're shown right from the first.
   */
  function withViewport(state: State): State {
    if (!mounted || !model.usesViewport(state)) return state;
    const viewport = readViewport();
    return viewport ? model.setViewport(state, viewport) : state;
  }

  /**
   * A change that doesn't animate, made while another does, ends that one:
   * its transition is gone from the styles already, so nothing should go on
   * as if it played (`animating`, held content, deferred measuring). A
   * change of the same kind (options passed again, a measurement) leaves
   * it, unless it turned transitions off (`transition: false`, reduced
   * motion), which ends it there.
   */
  function endSuperseded(before: State, after: State): State {
    if (!after.animating) return after;
    if (after.animate === before.animate && transitionOf(after)) return after;
    clearTimeout(animationTimer);
    return endAnimation(after);
  }

  /** Follows the user's reduced-motion preference. */
  function applyReducedMotion(reduced: boolean) {
    const before = store.get();
    store.set(endSuperseded(before, setReducedMotion(before, reduced)));
  }

  /**
   * Tells the app about a change, and saves it, if anything worth saving
   * moved. A key switch isn't the user's change, so it isn't saved.
   */
  function report(
    before: State,
    after: State,
    cause: ChangeCause,
    save = true,
  ) {
    const snapshot = model.toSnapshot(after);
    if (model.snapshotsEqual(model.toSnapshot(before), snapshot)) return;
    // Saved before the app hears of it: a change `onChange` makes in turn
    // is saved after, so the newest is what's kept.
    const { persist } = options;
    // Not before the key's own snapshot has been loaded, or the defaults
    // would overwrite it.
    if (save && persist && persist.key === persistedKey) {
      saveSnapshot(persist, snapshot);
    }
    options.onChange?.(snapshot, { cause });
  }

  /** Loads the snapshot saved under the current key, if it isn't loaded yet. */
  function loadPersisted() {
    const { persist } = options;
    if (!persist || persist.key === persistedKey) return;
    const switching = persistedKey !== undefined;
    persistedKey = persist.key;
    // A change heard under the old key waits for the drag to end, and
    // loading this key ends it: dropped first, so it can't land here.
    followLater = null;
    const saved = loadSnapshot(persist, model.isSnapshot);
    const before = store.get();
    // A new key is a different thing being sized (another document's
    // layout), so with nothing saved under it, it starts from the defaults.
    const after = withViewport(
      endSuperseded(
        before,
        saved
          ? model.restore(before, saved)
          : switching
            ? { ...model.reset(before), animate: null }
            : before,
      ),
    );
    store.set(after);
    // The state starts from the first load; switching keys after that
    // changes it under the app, so it's reported like any other change.
    if (switching) report(before, after, "options", false);
    watchViewport();
  }

  /**
   * With `persist.sync`, follows changes saved under the key from elsewhere
   * (another tab), restoring each as it comes. It's reported like a key
   * switch, but not saved: two tabs fitting it to different widths would
   * otherwise save back and forth.
   */
  function followPersisted() {
    const { persist } = options;
    const wanted = mounted && persist?.sync ? persist : null;
    // By key, as loading is (see `persistedKey`).
    if (wanted?.key === following?.key) return;
    stopFollowing?.();
    stopFollowing = null;
    // What waited for the drag was the old key's.
    followLater = null;
    const current = wanted && { key: wanted.key };
    following = current;
    if (!wanted) return;
    const follow = () =>
      inTurn(() => {
        // Only while it's still this key being followed.
        if (following !== current) return;
        const saved = loadSnapshot(options.persist ?? wanted, model.isSnapshot);
        if (!saved) return;
        const before = store.get();
        const after = withViewport(
          endSuperseded(before, model.restore(before, saved)),
        );
        store.set(after);
        report(before, after, "sync", false);
        watchViewport();
      });
    stopFollowing = subscribeSnapshot(wanted, () => {
      // Not under the user's hand: a drag here finishes first.
      if (store.get().drag) followLater = follow;
      else follow();
    });
  }

  /**
   * Watches the viewport while mounted and some size uses `vw` or `vh`
   * (only then, since reading it adds an element to the page). Starting,
   * it reads it as it is now: it may have changed while nothing watched.
   */
  function watchViewport() {
    const wanted = mounted && model.usesViewport(store.get());
    if (wanted === (stopViewport !== null)) return;
    stopViewport?.();
    stopViewport = wanted
      ? subscribeViewport((viewport) =>
          store.set(model.setViewport(store.get(), viewport)),
        )
      : null;
    if (stopViewport) store.set(withViewport(store.get()));
  }

  /**
   * The drag's session is over: tells the app (`onDragEnd`), then applies
   * a change from another tab that waited for it (after the change that
   * ended the drag, if one did: see `inTurn`).
   */
  function finishSession(cancelled: boolean) {
    // All of it over before the app hears, so a callback that throws
    // can't leave any of it behind.
    onDropped = null;
    const end = reportDragEnd;
    reportDragEnd = null;
    const later = followLater;
    followLater = null;
    try {
      end?.(cancelled);
    } finally {
      later?.();
    }
  }

  /** Runs one of the session's own handlers, in turn. */
  function inSessionTurn(handler: () => void) {
    inTurn(() => {
      inSession = true;
      try {
        handler();
      } finally {
        inSession = false;
      }
    });
  }

  const now: CoreChanges<Options, State, Snapshot> = {
    commit,

    restore(snapshot) {
      const before = store.get();
      store.set(
        withViewport(endSuperseded(before, model.restore(before, snapshot))),
      );
      watchViewport();
    },

    setOptions(next) {
      options = next;
      const config = model.parse(next);
      const key = JSON.stringify(config);
      const changed = key !== configKey;
      if (changed) {
        configKey = key;
        const before = store.get();
        const after = model.setConfig(before, config);
        commit(model.optionsCause(before, after), () => after);
      }
      if (mounted) loadPersisted();
      followPersisted();
      watchViewport();
      return changed;
    },
  };

  return {
    store,
    options: () => options,
    mounted: () => mounted,
    commit: (cause, action) => inTurn(() => commit(cause, action)),
    restore: (snapshot) => inTurn(() => now.restore(snapshot)),
    setOptions: (next) => inTurn(() => now.setOptions(next)),
    act: (action) => inTurn(() => action(now)),

    drag(event, { cursor, start, grabbed }) {
      const state = store.get();
      if (state.config.disabled) {
        ignorePress(event);
        return;
      }
      // One pointer at a time: a second press (another finger, say) while
      // a session is live is ignored, so it can't take the live one's place.
      if (state.drag || stopSession) return;

      /**
       * Something else dropped the drag while the pointer is still down
       * (`reset`, `restore`, `setSize`, a persist key switch), or it never
       * started (nothing measured yet): stop following the pointer, and
       * report it as cancelled, since nothing it did was kept.
       */
      const dropped = () => {
        stopSession?.();
        stopSession = null;
        finishSession(true);
      };

      const stop = startDragSession(event, event.currentTarget as HTMLElement, {
        threshold: state.config.dragThreshold,
        cursor: state.config.cursor ? cursor : null,
        // Each in a turn of its own, the session finished in it too: a
        // change asked for meanwhile (by a subscriber, or `onDragStart`)
        // is made after, and so, if the drag's still live, drops it
        // (cancelled). Finished even if the app's callbacks throw (in
        // `onChange`, say): their error is thrown after.
        onStart: () =>
          inSessionTurn(() => {
            store.set(start(store.get()));
            if (!store.get().drag) return;
            const grab = grabbed(store.get());
            // Ready to end before the app hears it began.
            reportDragEnd = (cancelled) =>
              options.onDragEnd?.(grab, { cancelled });
            onDropped = dropped;
            options.onDragStart?.(grab);
          }),
        onMove: (dx, dy) =>
          inSessionTurn(() => {
            if (!store.get().drag) {
              dropped();
              return;
            }
            try {
              commit("drag", (current) => model.moveDrag(current, dx, dy));
            } finally {
              // Landing in a stop with `endsDrag` ended it; ignore the
              // rest.
              if (!store.get().drag) {
                stopSession?.();
                stopSession = null;
                finishSession(false);
              }
            }
          }),
        onEnd: () =>
          inSessionTurn(() => {
            if (!store.get().drag) {
              finishSession(true);
              return;
            }
            try {
              commit("drag", model.endDrag);
            } finally {
              finishSession(false);
            }
          }),
        onCancel: () =>
          inSessionTurn(() => {
            try {
              commit("drag", model.cancelDrag);
            } finally {
              finishSession(true);
            }
          }),
        onClose: () => {
          stopSession = null;
        },
      });
      if (stop) stopSession = stop;
    },

    withViewportFor(size) {
      if (!usesViewportUnits(size)) return;
      const viewport = readViewport();
      if (viewport) store.set(model.setViewport(store.get(), viewport));
    },

    mount(attach) {
      mounted = true;
      // Read on every mount: storage may have changed while unmounted.
      persistedKey = undefined;
      inTurn(loadPersisted);
      followPersisted();
      applyReducedMotion(prefersReducedMotion());
      const stopMotion = subscribeReducedMotion(applyReducedMotion);
      const stopFont = subscribeRootFontSize((rootFontSize) =>
        store.set(model.setRootFontSize(store.get(), rootFontSize)),
      );
      watchViewport();
      const detach = attach();

      return () => {
        mounted = false;
        followPersisted();
        watchViewport();
        detach();
        stopFont();
        stopMotion();
        stopSession?.();
        stopSession = null;
        clearTimeout(animationTimer);
        store.set(endAnimation(model.cancelDrag(store.get())));
        finishSession(true);
      };
    },
  };
}
