/**
 * How committed changes animate. Drags follow the pointer instantly; what
 * comes after (a release, moving between stops, a key press, …) animates
 * with a CSS transition, which can differ by the kind of change, and by
 * whether the user prefers reduced motion.
 */
import { withDefaults } from "./defaults.js";

/** A transition's timing: its duration in milliseconds, and its CSS easing. */
export interface TransitionTiming {
  readonly duration: number;
  readonly easing: string;
}

/**
 * The kinds of change that animate: the end of a `drag` (released, or
 * cancelled with Escape), moving to a `stop` (`setStop`, `toggle`),
 * `setSize`, `setPosition`, `keyboard` resizing and moving, `reset`, and in
 * layouts, `children` added or reordered (removing one is instant).
 */
export type ChangeKind =
  "drag" | "stop" | "size" | "position" | "keyboard" | "reset" | "children";

const KINDS: readonly ChangeKind[] = [
  "drag",
  "stop",
  "size",
  "position",
  "keyboard",
  "reset",
  "children",
];

export interface TransitionOptions extends Partial<TransitionTiming> {
  /**
   * Timing for particular kinds of change (anything not given comes from
   * `duration` and `easing`), or `false` not to animate that kind: e.g.
   * `{ stop: { duration: 600 }, keyboard: false }`.
   */
  changes?: Partial<Record<ChangeKind, Partial<TransitionTiming> | false>>;
  /**
   * When the user prefers reduced motion: `false` (the default) not to
   * animate, or a transition to use instead for every change that would
   * otherwise animate.
   */
  reducedMotion?: Partial<TransitionTiming> | false;
}

/** The transition options, resolved. `null` where nothing animates. */
export interface TransitionConfig {
  readonly changes: Readonly<Record<ChangeKind, TransitionTiming | null>>;
  readonly reducedMotion: TransitionTiming | null;
}

/**
 * A strong ease-out: it starts at full speed, so an animation that carries on
 * from a drag (a release, an endsDrag stop) keeps the hand's motion, then lands
 * softly.
 */
export const DEFAULT_TRANSITION: TransitionTiming = {
  duration: 400,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};

/**
 * How long after its duration a transition counts as finished: the render
 * that starts it can land a frame or two after the change.
 */
export const TRANSITION_GRACE = 50;

/** A change moving a size or position less than this many pixels doesn't play. */
export const MIN_MOVE = 0.5;

/** `true` (or nothing) for the defaults, `false` for no transitions. */
export function parseTransition(
  option: TransitionOptions | boolean | undefined,
): TransitionConfig | null {
  if (option === false) return null;
  const options = typeof option === "object" ? option : {};
  const base: TransitionTiming = {
    duration: options.duration ?? DEFAULT_TRANSITION.duration,
    easing: options.easing ?? DEFAULT_TRANSITION.easing,
  };
  const timing = (value: Partial<TransitionTiming> | false | undefined) =>
    value === false ? null : withDefaults(base, value);
  return {
    changes: Object.fromEntries(
      KINDS.map((kind) => [kind, timing(options.changes?.[kind])]),
    ) as Record<ChangeKind, TransitionTiming | null>,
    reducedMotion: options.reducedMotion ? timing(options.reducedMotion) : null,
  };
}

/**
 * The transition for a change of `kind`, or `null` if it doesn't animate. A
 * kind turned off stays off with reduced motion too.
 */
export function transitionFor(
  config: TransitionConfig | null,
  kind: ChangeKind | null,
  reducedMotion: boolean,
): TransitionTiming | null {
  if (!config || !kind || !config.changes[kind]) return null;
  return reducedMotion ? config.reducedMotion : config.changes[kind];
}

/** The parts of a model's state that animating works with. */
export interface AnimatedState {
  readonly config: { readonly transition: TransitionConfig | null };
  /** The kind of the latest change, if it should animate. */
  readonly animate: ChangeKind | null;
  /** Whether a committed change is still transitioning. */
  readonly animating: boolean;
  readonly reducedMotion: boolean;
}

/** The transition for the latest change, or `null` if it doesn't animate. */
export function transitionOf(state: AnimatedState): TransitionTiming | null {
  return transitionFor(
    state.config.transition,
    state.animate,
    state.reducedMotion,
  );
}

/** Marks a committed change as transitioning (until `endAnimation`). */
export function startAnimation<S extends AnimatedState>(state: S): S {
  return state.animating ? state : { ...state, animating: true };
}

/** The transition has had time to finish. */
export function endAnimation<S extends AnimatedState>(state: S): S {
  return state.animating ? { ...state, animating: false } : state;
}

export function setReducedMotion<S extends AnimatedState>(
  state: S,
  reducedMotion: boolean,
): S {
  return state.reducedMotion === reducedMotion
    ? state
    : { ...state, reducedMotion };
}
