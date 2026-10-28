/**
 * One resizable dimension (width or height) of an element: its settings, its
 * state, and how drags and key presses change it. Pure functions only.
 *
 * The state stores *inputs*: which stop it's in, and the size it was given in
 * each range stop (as specs, so a `%` stays relative until the user resizes).
 * What gets rendered is derived by {@link renderDimension}: the stops are
 * resolved against the latest measurements, the size is kept within the
 * current stop, and a live drag is run through the landing rules (see
 * `foundation/stops.ts`). Nothing derived is stored, so nothing drifts: a
 * container that shrinks and grows back returns the element to the user's
 * size.
 */
import { cssClamp, toCss } from "../foundation/css.js";
import type { Dimension, DimensionAnchor } from "../foundation/handle.js";
import type { KeyboardIntent } from "../foundation/keyboard.js";
import type { Elastic, Limits } from "../foundation/limits.js";
import { own } from "../foundation/own.js";
import {
  type Size,
  type SizeContext,
  type SizeValue,
  isSize,
  parseSize,
  px,
  resolveSize,
  sameSize,
} from "../foundation/size.js";
import {
  EPSILON,
  type Landing,
  type Track,
  type TrackConfig,
  type TrackOptions,
  UNNAMED,
  checkStop,
  contains,
  contentSizeOf,
  contentStopOf,
  enterTarget,
  findStop,
  isNamed,
  isPoint,
  isRangeStop,
  land,
  nextStop,
  parseTrackOptions,
  reach,
  reachable,
  resolveTrack,
  roomiest,
  toggleBack,
  warnIfDefaultJumps,
  within,
} from "../foundation/stops.js";

interface DimensionBase extends TrackOptions {
  /**
   * Size before the user resizes it. A range stop that hasn't been visited
   * yet also starts here (kept within the range), or at its minimum without
   * one.
   */
  defaultSize?: SizeValue;
  /** The stop to start at. Defaults to wherever `defaultSize` lands. */
  defaultStop?: string;
}

/** A dimension's options: it needs a `defaultSize`, a `defaultStop`, or both. */
export type DimensionOptions = DimensionBase &
  ({ defaultSize: SizeValue } | { defaultStop: string });

/** Options after parsing and defaulting. Plain data, safe to compare. */
export interface DimensionConfig extends TrackConfig {
  readonly anchor: DimensionAnchor;
  readonly defaultSize: Size | null;
  readonly defaultStop: string | null;
}

export interface DimensionState {
  /**
   * The stop it's in, or `null` until it first settles in one; until then
   * it's wherever `defaultSize` lands.
   */
  readonly stop: string | null;
  /** The size it was last given in each range stop. */
  readonly sizes: Readonly<Record<string, Size>>;
  /** The last range stop it was in, which `toggle` returns to. */
  readonly lastRange: string | null;
  /**
   * The stop it was in before its latest committed change of stop (not the
   * ones a drag passed through), for `toggle` (see `toggleBack`).
   */
  readonly from?: string | null;
}

/** A drag in progress along this dimension. */
export interface DimensionDrag {
  /** The rendered size when the drag started. */
  readonly from: number;
  /** How much the drag has grown the size since (negative shrinks). */
  readonly growth: number;
  /**
   * The stop its pointer last reached (`null`: the one it started in),
   * which tells resisting from snapping (see `snappedShortOf`).
   */
  readonly reached: string | null;
}

export interface DimensionRendering {
  /** Rendered size in pixels, or `null` before the element is measured. */
  readonly size: number | null;
  /**
   * The stop it's in (`UNNAMED` for a track without named stops), or `null`
   * before measurement when that depends on where `defaultSize` lands.
   */
  readonly stop: string | null;
  /** The stops in pixels, or `null` before the element is measured. */
  readonly track: Track | null;
  /** CSS length for this dimension. */
  readonly css: string;
  /**
   * The size to lay content out at, or `null` before measurement: the size
   * while it's in a range, and at a point (a rail, or 0) the size of the
   * range it would go back to (see `contentSizeOf`).
   */
  readonly contentSize: number | null;
  /** The stop whose content to show (see `contentStopOf`). */
  readonly contentStop: string | null;
}

export function parseDimension(
  options: DimensionOptions,
  anchor: DimensionAnchor,
  dimension: Dimension,
): DimensionConfig {
  const track = parseTrackOptions(options);
  if (options.defaultSize === undefined && options.defaultStop === undefined) {
    throw new Error("A dimension needs `defaultSize`, `defaultStop`, or both.");
  }
  const config = {
    ...track,
    anchor,
    defaultSize:
      options.defaultSize === undefined ? null : parseSize(options.defaultSize),
    defaultStop:
      options.defaultStop === undefined
        ? null
        : checkStop(track, options.defaultStop),
  };
  warnIfDefaultJumps(
    config,
    config.defaultSize,
    config.defaultStop,
    `The ${dimension}`,
  );
  return config;
}

export function initialDimension(config: DimensionConfig): DimensionState {
  return { stop: config.defaultStop, sizes: {}, lastRange: null };
}

/**
 * The stop a dimension goes back to when it has nowhere better to be (a
 * toggle with no range to return to, a stop that's no longer configured):
 * where `defaultSize` lands, which `null` stands for, or without one, its
 * roomiest stop.
 */
function homeStop(config: DimensionConfig, track: Track | null): string | null {
  if (config.defaultSize) return null;
  if (track) return roomiest(track).name;
  return (
    config.stops.find((stop) => stop.size === null)?.name ??
    config.stops[0].name
  );
}

/**
 * Where the dimension rests, before any drag: in its stop (or its home stop,
 * if it hasn't settled yet or its stop no longer exists), at that stop's size
 * or its remembered size within it (else `defaultSize`, else its minimum).
 */
function resting(
  config: DimensionConfig,
  state: DimensionState,
  track: Track,
  context: SizeContext,
): Landing {
  const resolve = (size: Size | null | undefined) =>
    size ? resolveSize(size, context) : null;
  const name =
    state.stop !== null && findStop(track, state.stop)
      ? state.stop
      : homeStop(config, track);
  const stop = name === null ? undefined : findStop(track, name);
  if (!stop) return land(track, resolve(config.defaultSize) ?? 0, null);
  const size = resolve(own(state.sizes, stop.name) ?? config.defaultSize);
  return { size: within(stop, size ?? stop.min), stop: stop.name };
}

/**
 * Derives what to render. `context` is `null` before the first measurement,
 * in which case the specs are handed to the browser as CSS, with limits
 * from outside it (`bounds` once measured) as sizes (`before`), applied as
 * once measured: a range's with its own, a point's maximums only.
 */
export function renderDimension(
  config: DimensionConfig,
  state: DimensionState,
  /** The stop it was in before its latest change of stop, if any. */
  previous: string | null,
  context: SizeContext | null,
  drag: DimensionDrag | null,
  elastic: Elastic | null,
  bounds?: Limits,
  before?: { readonly min: readonly Size[]; readonly max: readonly Size[] },
): DimensionRendering {
  if (!context) {
    const stop = state.stop ?? (isNamed(config) ? null : UNNAMED);
    const known = config.stops.find((candidate) => candidate.name === stop);
    // Without a size, a range starts at its minimum: clamp(min, 0, max).
    const size = (stop !== null && own(state.sizes, stop)) ||
      config.defaultSize || { value: 0, unit: "px" as const };
    return {
      size: null,
      stop,
      track: null,
      contentSize: null,
      contentStop: contentStopOf(
        config,
        stop,
        previous,
        state.lastRange ?? homeStop(config, null),
      ),
      css: known?.size
        ? // At 0 it's 0 whatever the maximum (and reads as zero).
          known.size.value === 0
          ? toCss(known.size)
          : cssClamp(known.size, undefined, before?.max)
        : known
          ? cssClamp(
              size,
              [...(known.min ?? []), ...(before?.min ?? [])],
              [...(known.max ?? []), ...(before?.max ?? [])],
              config.wins,
            )
          : toCss(size),
    };
  }

  const track = resolveTrack(config, context, bounds);
  const rest = resting(config, state, track, context);
  const { size, stop } = drag
    ? land(
        track,
        drag.from + drag.growth,
        rest.stop,
        elastic ?? undefined,
        drag.reached ?? rest.stop,
      )
    : rest;
  // Where a toggle would go back to: its last range, or else its home stop
  // (`null` standing for where `defaultSize` lands).
  const home = homeStop(config, track);
  const back =
    state.lastRange ??
    home ??
    land(
      track,
      (config.defaultSize && resolveSize(config.defaultSize, context)) ?? 0,
      null,
    ).stop;
  const contentSize = contentSizeOf(
    config,
    track,
    stop,
    size,
    back,
    (range) => {
      const spec = own(state.sizes, range.name) ?? config.defaultSize;
      return within(range, (spec && resolveSize(spec, context)) ?? range.min);
    },
  );
  return {
    size,
    stop,
    track,
    css: `${size}px`,
    contentSize,
    contentStop: contentStopOf(config, stop, previous, back),
  };
}

/**
 * Moves the state to `stop`. A range remembers `size` when given (as it was
 * given, so `setSize("30%")` stays relative). `current` is the stop it's
 * leaving: it's recorded as where it came from (`from`), and if it's a
 * range, as the last range (where toggling goes back to).
 */
export function moveTo(
  config: DimensionConfig,
  state: DimensionState,
  current: string | null,
  stop: string,
  size?: Size,
): DimensionState {
  const lastRange =
    current !== null && isRangeStop(config, current)
      ? current
      : state.lastRange;
  const from = current !== null && current !== stop ? current : state.from;
  if (!isRangeStop(config, stop)) {
    return { ...state, stop, lastRange, from };
  }
  return {
    stop,
    sizes: size ? { ...state.sizes, [stop]: size } : state.sizes,
    lastRange: stop,
    from,
  };
}

/**
 * Toggles `stop`: goes there, or if it's already there, back (see
 * `toggleBack`: where it came from if that's larger, else the last range it
 * was in), or if there's nowhere to go back to, its home stop (see
 * `homeStop`).
 */
export function toggleStop(
  config: DimensionConfig,
  state: DimensionState,
  current: string | null,
  stop: string,
  track: Track | null,
): DimensionState {
  if (current !== stop) return moveTo(config, state, current, stop);
  const back = toggleBack(track, stop, state.from, state.lastRange);
  if (back !== null) return moveTo(config, state, current, back);
  const home = homeStop(config, track);
  if (home === null) return { ...state, stop: null };
  return home === stop ? state : moveTo(config, state, current, home);
}

/** The state a finished drag leaves behind, without the elastic stretch. */
export function settleDrag(
  config: DimensionConfig,
  state: DimensionState,
  context: SizeContext,
  drag: DimensionDrag,
  bounds?: Limits,
  arrived?: string,
): DimensionState {
  const track = resolveTrack(config, context, bounds);
  const current = resting(config, state, track, context).stop;
  // Ended by arriving in a range that ends drags: it goes there as
  // `setStop` would, at the size it has there. Where the pointer was is
  // just past the range's edge, not a size anyone chose.
  if (arrived !== undefined && isRangeStop(config, arrived)) {
    return moveTo(config, state, current, arrived);
  }
  const landed = land(track, drag.from + drag.growth, current);
  return moveTo(config, state, current, landed.stop, px(landed.size));
}

/**
 * Applies a key press. `growthPerPixel` converts the intent's screen movement
 * into size change (direction and anchor factor). Returns `state` unchanged
 * when the key does nothing.
 */
export function applyKey(
  config: DimensionConfig,
  state: DimensionState,
  rendering: DimensionRendering,
  intent: KeyboardIntent,
  growthPerPixel: number,
  jump = true,
): DimensionState {
  const { track, size, stop } = rendering;
  const current = stop === null || !track ? undefined : findStop(track, stop);
  if (!track || size === null || !current) return state;

  // The stops a drag can reach: what Enter chooses from.
  const draggable = track.filter((candidate) => !candidate.onlyByName);
  // Already there: nothing to change (or animate).
  const go = (landing: Landing) =>
    landing.stop === current.name && Math.abs(landing.size - size) < EPSILON
      ? state
      : moveTo(config, state, current.name, landing.stop, px(landing.size));

  switch (intent.kind) {
    case "toggle": {
      const target = enterTarget(config, draggable);
      if (target === null) return state;
      return toggleStop(config, state, current.name, target, track);
    }
    // Home and End: the smallest and largest sizes reachable from here (the
    // current stop counts, even if it's `onlyByName`), as aria-valuemin/max say.
    case "min": {
      const { min } = reach(track, current.name);
      const target = reachable(track, current.name).find(
        (candidate) => candidate.min === min,
      );
      return target ? go({ size: min, stop: target.name }) : state;
    }
    case "max": {
      const { max } = reach(track, current.name);
      const target = reachable(track, current.name).find(
        (candidate) => candidate.max === max,
      );
      return target && Number.isFinite(max)
        ? go({ size: max, stop: target.name })
        : state;
    }
    case "move": {
      const growth = intent.delta * growthPerPixel;
      const requested = size + growth;
      const direction = growth > 0 ? 1 : -1;
      if (!isPoint(current)) {
        if (contains(current, requested)) {
          return go({ size: requested, stop: current.name });
        }
        // A big step goes to the edge first, never straight past it.
        const edge = direction > 0 ? current.max : current.min;
        if (Math.abs(size - edge) > EPSILON) {
          return go({ size: edge, stop: current.name });
        }
      }
      // From the edge: on into an overlapping stop, or on to the next one
      // (with `jump` on: off, arrows stay in the stop).
      const landed = land(track, requested, current.name);
      if (jump && landed.stop !== current.name && landed.size === requested) {
        return go(landed);
      }
      // At the next stop's near edge, as a drag across the gap lands there:
      // an arrow is a small step, whatever size that stop remembers.
      const next = jump && nextStop(track, current, direction);
      return next
        ? go({ size: direction > 0 ? next.min : next.max, stop: next.name })
        : state;
    }
  }
}

export function sameDimensionState(
  a: DimensionState,
  b: DimensionState,
): boolean {
  const names = new Set([...Object.keys(a.sizes), ...Object.keys(b.sizes)]);
  return (
    a.stop === b.stop &&
    a.lastRange === b.lastRange &&
    (a.from ?? null) === (b.from ?? null) &&
    [...names].every((name) => sameSize(own(a.sizes, name), own(b.sizes, name)))
  );
}

/** Checks untrusted data (e.g. from storage) before it's restored. */
export function isDimensionState(value: unknown): value is DimensionState {
  if (typeof value !== "object" || value === null) return false;
  const { stop, sizes, lastRange, from } = value as Record<string, unknown>;
  const name = (field: unknown) => field === null || typeof field === "string";
  return (
    name(stop) &&
    name(lastRange) &&
    (from === undefined || name(from)) &&
    typeof sizes === "object" &&
    sizes !== null &&
    Object.values(sizes).every((size) => isSize(size) && size.value >= 0)
  );
}
