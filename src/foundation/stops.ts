/**
 * Stops: the sizes a track can take. A track is one resizable length (an
 * element's width, a layout child's size along its group), and its stops are
 * named sizes or ranges of sizes:
 *
 * ```ts
 * stops: {
 *   hidden: { size: 0, onlyByName: true },
 *   rail: "3.5rem",
 *   open: { min: "12rem", max: ["28rem", "50%"] },
 * }
 * ```
 *
 * A point resolves to equal bounds; a range stays a range even where its
 * resolved bounds meet (see `isRangeStop`). A track without `stops` has
 * one unnamed range, from `minSize` to `maxSize`.
 *
 * The rules, which every drag, key press and `setSize` goes through:
 *
 * 1. The size can be anywhere in the union of the stops; overlaps are fine.
 * 2. A requested size inside a stop stays as asked. In a gap between stops it
 *    goes to the nearer side, weighted by each side's `pull`.
 * 3. The track stays in its current stop while the size is inside it;
 *    otherwise it's in the narrowest stop containing the size.
 * 4. `onlyByName` stops are only reached by name (`setStop`, or Enter when
 *    `enterToggles` names one), never by landing.
 *
 * Stops are resolved to pixels after measuring, every time, and sorted by
 * size then, so the order they're written in never matters.
 */
import {
  type Elastic,
  type LimitWinner,
  type Limits,
  createLimits,
  stretch,
} from "./limits.js";
import {
  type Size,
  type SizeBound,
  type SizeContext,
  type SizeValue,
  parseBound,
  parseSize,
  resolveMax,
  resolveMin,
  resolveSize,
} from "./size.js";
import { warnOnce } from "./warn.js";

// --- Tolerances --------------------------------------------------------------

// Pixel sizes come from division; treat anything closer than this as equal.
export const EPSILON = 1e-6;

/** Below this many pixels, a size counts as zero (nothing to show). */
export const ZERO = 0.5;

// --- Options -----------------------------------------------------------------

interface StopBehaviour {
  /**
   * How strongly this stop claims the gaps beside it, relative to the stop
   * on the other side. Equal pulls (the default, 1) divide a gap halfway; a
   * stop with pull 3 next to one with pull 1 claims three quarters of it.
   */
  pull?: number;
  /**
   * Only reachable by name (`setStop`, `toggle`, or Enter when
   * `enterToggles` names it): drags, arrow keys and `setSize` never land
   * here. For states a button should reach but a drag shouldn't, like
   * hiding an element entirely.
   */
  onlyByName?: boolean;
  /**
   * Whether a drag pulling past this stop's end stretches it a little
   * before it snaps across a gap or settles back: `true` both ways, `false`
   * neither, or only when pulled `"larger"` or `"smaller"`. Defaults to
   * `true` for ranges and `false` for points, which stay crisp. A rail that
   * should give when pulled open but not when pushed smaller is
   * `"larger"`. How a stretch feels is the hook's own `elastic` option.
   */
  elastic?: StopElastic;
  /**
   * Landing here ends the drag, as if the pointer had been released
   * (passing through counts, however fast the pointer jumped over it): the
   * move into the stop animates like any committed change, and the rest of
   * the gesture is ignored until the next press. For gestures that should
   * play out on their own, like a sidebar snapping to its rail. A range
   * goes to the size it has there, as `setStop` would, not where the
   * pointer was (just past its edge): a drawer pulled open opens as a
   * toggle would.
   */
  endsDrag?: boolean;
}

/** Which ways a stop stretches (see `elastic` on a stop). */
export type StopElastic = boolean | "larger" | "smaller";

/** Which ways a stop stretches when a drag pulls past its edges. */
export interface Stretches {
  readonly larger: boolean;
  readonly smaller: boolean;
}

/** One exact size. */
export interface PointStopOptions extends StopBehaviour {
  size: SizeValue;
}

/** Any size from `min` (default 0) to `max` (default unbounded). */
export interface RangeStopOptions extends StopBehaviour {
  min?: SizeBound;
  max?: SizeBound;
}

/** A stop: a size (shorthand for a point), a point, or a range. */
export type StopValue = SizeValue | PointStopOptions | RangeStopOptions;

export interface TrackOptions {
  /** Shorthand for a single unnamed range. Not combined with `stops`. */
  minSize?: SizeBound;
  /** Shorthand for a single unnamed range. Not combined with `stops`. */
  maxSize?: SizeBound;
  /** The named sizes and ranges the track can take, in any order. */
  stops?: Readonly<Record<string, StopValue>>;
  /**
   * The stop Enter toggles from a focused handle: by default the smallest
   * stop a drag can reach, or name one (an `onlyByName` stop too, since the
   * keyboard, like `setStop`, may go where a drag can't). `false`: none.
   */
  enterToggles?: string | false;
  /**
   * Which limit holds when a range's minimum is above its maximum: `"min"`
   * (the default, as in CSS) or `"max"`. It covers a range's own limits
   * (`min: "17.5rem"` with `max: "90%"` in a narrow container) and limits
   * from outside it: the room in a container it's confined to, an aspect
   * ratio's, and what a nested group's children need. `"min"` keeps the
   * track's content usable; `"max"` keeps what's beside it usable.
   */
  wins?: LimitWinner;
}

/** The name of the one stop a track without `stops` has. */
export const UNNAMED = "";

/** A stop as configured. Plain data, safe to compare. */
export interface StopConfig {
  readonly name: string;
  /** A point's size, or `null` for a range. */
  readonly size: Size | null;
  readonly min: readonly Size[] | undefined;
  readonly max: readonly Size[] | undefined;
  readonly pull: number;
  readonly onlyByName: boolean;
  readonly stretches: Stretches;
  readonly endsDrag: boolean;
}

export interface TrackConfig {
  readonly stops: readonly StopConfig[];
  /** A stop's name, `false` for none, or `null` for the smallest reachable. */
  readonly enterToggles: string | false | null;
  readonly wins: LimitWinner;
}

export function parseTrackOptions(options: TrackOptions): TrackConfig {
  const parsed = { stops: parseStops(options), wins: parseWins(options.wins) };
  const { enterToggles } = options;
  return {
    ...parsed,
    enterToggles:
      enterToggles === undefined
        ? null
        : enterToggles === false
          ? false
          : checkStop({ ...parsed, enterToggles: null }, enterToggles),
  };
}

function parseWins(wins: LimitWinner | undefined): LimitWinner {
  if (wins === undefined) return "min";
  if (wins !== "min" && wins !== "max") {
    throw new Error(`wins is ${String(wins)}: expected "min" or "max".`);
  }
  return wins;
}

function parseStops(options: TrackOptions): StopConfig[] {
  const { stops, minSize, maxSize } = options;
  if (stops === undefined) {
    return [
      {
        name: UNNAMED,
        size: null,
        min: minSize === undefined ? undefined : parseBound(minSize),
        max: maxSize === undefined ? undefined : parseBound(maxSize),
        pull: 1,
        onlyByName: false,
        stretches: BOTH_WAYS,
        endsDrag: false,
      },
    ];
  }
  if (minSize !== undefined || maxSize !== undefined) {
    throw new Error(
      "Use `stops` or `minSize`/`maxSize`, not both: give the range in `stops` its own `min` and `max`.",
    );
  }
  const entries = Object.entries(stops);
  if (entries.length === 0) throw new Error("`stops` needs at least one stop.");
  return entries.map(([name, value]) => parseStop(name, value));
}

function parseStop(name: string, value: StopValue): StopConfig {
  if (name === UNNAMED) throw new Error("A stop needs a non-empty name.");
  const options: StopBehaviour = typeof value === "object" ? value : {};
  const pull = options.pull ?? 1;
  if (!Number.isFinite(pull) || pull <= 0) {
    throw new Error(`Stop "${name}" has pull ${pull}: expected a number > 0.`);
  }
  const base = {
    name,
    pull,
    onlyByName: options.onlyByName ?? false,
    endsDrag: options.endsDrag ?? false,
  };
  const point = {
    min: undefined,
    max: undefined,
    stretches: parseStopElastic(options.elastic ?? false),
  };

  if (typeof value !== "object") {
    return { ...base, ...point, size: parseSize(value) };
  }
  if ("size" in value) {
    return { ...base, ...point, size: parseSize(value.size) };
  }
  return {
    ...base,
    stretches: parseStopElastic(value.elastic ?? true),
    size: null,
    min: value.min === undefined ? undefined : parseBound(value.min),
    max: value.max === undefined ? undefined : parseBound(value.max),
  };
}

const BOTH_WAYS: Stretches = { larger: true, smaller: true };

function parseStopElastic(option: StopElastic): Stretches {
  return typeof option === "boolean"
    ? { larger: option, smaller: option }
    : { larger: option === "larger", smaller: option === "smaller" };
}

/**
 * Whether a default size is outside every stop it could land in, when
 * that's known before measuring: it and those stops are all in pixels.
 * Before measuring, a track with no `defaultStop` renders its `defaultSize`
 * as it is (which stop it lands in can depend on the container), so such a
 * size shows, then jumps to the nearest stop once measured.
 */
export function defaultOutsideStops(
  config: TrackConfig,
  defaultSize: Size,
): boolean {
  if (defaultSize.unit !== "px") return false;
  // Landing never picks an `onlyByName` stop, unless that's all there is.
  const automatic = config.stops.filter((stop) => !stop.onlyByName);
  const candidates = automatic.length > 0 ? automatic : config.stops;
  let known = true;
  const inside = candidates.some((stop) => {
    const min = minInPixels(stop.size ? [stop.size] : stop.min);
    const max = stop.size ? min : maxInPixels(stop.max);
    if (min === null || max === null) {
      known = false;
      return false;
    }
    const limits = createLimits(min, max, config.wins);
    return limits.min <= defaultSize.value && defaultSize.value <= limits.max;
  });
  return known && !inside;
}

/**
 * In development, warns about a `defaultSize` that shows, then jumps (see
 * `defaultOutsideStops`). `what` names the track ("The width", `"files"`).
 */
export function warnIfDefaultJumps(
  config: TrackConfig,
  defaultSize: Size | null,
  defaultStop: string | null,
  what: string,
) {
  if (!defaultSize || defaultStop !== null) return;
  if (!defaultOutsideStops(config, defaultSize)) return;
  const size = `${defaultSize.value}px`;
  const where = isNamed(config)
    ? "any of its stops"
    : "its minSize and maxSize";
  warnOnce(
    `${what} has defaultSize ${size}, which isn't inside ${where}: it renders at ${size} until it's measured, then jumps to the nearest stop. Give a defaultStop, or a defaultSize inside a stop.`,
  );
}

/**
 * A minimum in pixels: the largest of its sizes (each must hold), 0 if
 * there's none, and `null` if any of it isn't in pixels.
 */
function minInPixels(bound: readonly Size[] | undefined): number | null {
  const values = pixelValues(bound);
  return values && (values.length > 0 ? Math.max(...values) : 0);
}

/** A maximum in pixels: the smallest of its sizes (see `minInPixels`). */
function maxInPixels(bound: readonly Size[] | undefined): number | null {
  const values = pixelValues(bound);
  return values && (values.length > 0 ? Math.min(...values) : Infinity);
}

function pixelValues(bound: readonly Size[] | undefined): number[] | null {
  if (!bound) return [];
  if (bound.some((size) => size.unit !== "px")) return null;
  return bound.map((size) => size.value);
}

/** Whether `name` is a range in the track's options (so it remembers a size). */
export function isRangeStop(config: TrackConfig, name: string): boolean {
  return config.stops.find((stop) => stop.name === name)?.size === null;
}

/** Whether the track has named stops (rather than one unnamed range). */
export function isNamed(config: TrackConfig): boolean {
  return config.stops[0]?.name !== UNNAMED;
}

/** Whether `name` is a point at 0 (in any unit): a stop that shows nothing. */
export function isZeroStop(config: TrackConfig, name: string | null): boolean {
  return config.stops.find((stop) => stop.name === name)?.size?.value === 0;
}

/** Returns `name` if it's one of the track's stops, else throws. */
export function checkStop(config: TrackConfig, name: string): string {
  if (config.stops.some((stop) => stop.name === name)) return name;
  const known = config.stops
    .filter((stop) => stop.name !== UNNAMED)
    .map((stop) => `"${stop.name}"`);
  throw new Error(
    known.length > 0
      ? `Unknown stop "${name}". Stops: ${known.join(", ")}.`
      : `Unknown stop "${name}": this track has no named stops.`,
  );
}

// --- Resolving ---------------------------------------------------------------

/** A stop in pixels. A point has `min === max`. */
export interface Stop {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly pull: number;
  readonly onlyByName: boolean;
  readonly stretches: Stretches;
  readonly endsDrag: boolean;
}

/** A track's stops in pixels, sorted by `min`, then `max`. */
export type Track = readonly Stop[];

/** A stop's sizes in pixels, as the hooks expose them. */
export interface ResolvedStop {
  readonly min: number;
  readonly max: number;
}

/**
 * A track's named stops by name (`{}` without named stops), or `null`
 * before measurement.
 */
export function resolvedStops(
  track: Track | null,
): Record<string, ResolvedStop> | null {
  if (!track) return null;
  return Object.fromEntries(
    track
      .filter((stop) => stop.name !== UNNAMED)
      .map(({ name, min, max }) => [name, { min, max }]),
  );
}

/**
 * Resolves the stops to pixels and sorts them. `bounds` are limits from
 * outside the track (a ratio-locked height's limits, the room left in a
 * container, what a nested group's children need). They clip ranges, and
 * pull points above their maximum down to it; points below their minimum
 * stay, so a small state like `hidden: 0` survives content that needs room
 * when it's shown.
 */
export function resolveTrack(
  config: TrackConfig,
  context: SizeContext,
  bounds?: Limits,
): Track {
  return sortStops(
    config.stops.map((stop) => resolveStop(stop, context, config.wins, bounds)),
  );
}

/** Sorts stops by `min`, then `max`: the order a track's stops are kept in. */
export function sortStops(stops: readonly Stop[]): Stop[] {
  return [...stops].sort((a, b) => a.min - b.min || a.max - b.max);
}

function resolveStop(
  stop: StopConfig,
  context: SizeContext,
  wins: LimitWinner,
  bounds?: Limits,
): Stop {
  const { name, pull, onlyByName, stretches, endsDrag } = stop;
  const behaviour = { pull, onlyByName, stretches, endsDrag };
  if (stop.size) {
    const size = Math.min(
      resolveSize(stop.size, context) ?? 0,
      bounds?.max ?? Infinity,
    );
    return { name, min: size, max: size, ...behaviour };
  }
  // When limits conflict, the minimum wins (as with CSS min/max-width),
  // unless the track says the maximum does.
  const own = createLimits(
    resolveMin(stop.min, context),
    resolveMax(stop.max, context),
    wins,
  );
  const { min, max } = bounds
    ? createLimits(
        Math.max(own.min, bounds.min),
        Math.min(own.max, bounds.max),
        wins,
      )
    : own;
  return { name, min, max, ...behaviour };
}

// --- Reading a track ---------------------------------------------------------

export function findStop(track: Track, name: string): Stop | undefined {
  return track.find((stop) => stop.name === name);
}

export function isPoint(stop: Stop): boolean {
  return stop.max - stop.min <= EPSILON;
}

export function contains(stop: Stop, size: number): boolean {
  return size >= stop.min - EPSILON && size <= stop.max + EPSILON;
}

/** Keeps `size` within one stop. */
export function within(stop: Stop, size: number): number {
  return Math.min(stop.max, Math.max(stop.min, size));
}

/**
 * The stops a requested size can land on from `current`: every stop that
 * isn't `onlyByName`, and the current one even if it is.
 */
export function reachable(track: Track, current: string | null): Stop[] {
  return track.filter((stop) => !stop.onlyByName || stop.name === current);
}

/** The smallest and largest sizes a requested size can land on. */
export function reach(track: Track, current: string | null = null): Limits {
  const stops = reachable(track, current);
  if (stops.length === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(...stops.map((stop) => stop.min)),
    max: Math.max(...stops.map((stop) => stop.max)),
  };
}

/** The stop reaching furthest (the widest of those, on a tie). */
export function roomiest(track: Track): Stop {
  return track.reduce((best, stop) =>
    stop.max > best.max ||
    (stop.max === best.max && stop.max - stop.min > best.max - best.min)
      ? stop
      : best,
  );
}

// --- Toggling and content ----------------------------------------------------

/**
 * The stop Enter toggles: the one named by `enterToggles`, or else the
 * smallest a drag can reach (if there's more than one to be in).
 */
export function enterTarget(
  config: TrackConfig,
  candidates: readonly Stop[],
): string | null {
  if (config.enterToggles !== null) return config.enterToggles || null;
  return candidates.length > 1 ? candidates[0].name : null;
}

/**
 * Where toggling `stop` off goes back to: the stop it was in before it went
 * there (`from`) if that's a larger one, so hiding a rail and showing it
 * again comes back to the rail; otherwise the last range it was in. `null`
 * when neither applies.
 */
export function toggleBack(
  track: Track | null,
  stop: string,
  from: string | null | undefined,
  lastRange: string | null,
): string | null {
  if (from && from !== stop && track) {
    const order = track.map((candidate) => candidate.name);
    const at = order.indexOf(stop);
    if (at >= 0 && order.indexOf(from) > at) return from;
  }
  return lastRange !== null && lastRange !== stop ? lastRange : null;
}

/**
 * The size content should be laid out at, so it doesn't squeeze while the
 * track is small: the size itself while it's in a range, and at a point (a
 * rail, or 0) the size of the range it would go back to, `back` (where a
 * toggle goes), or if that isn't a range, the roomiest range.
 * `remembered` gives a range's size. A range is one in the options, even
 * when its limits have met (a minimum and maximum in conflict): it's still
 * where the content goes back to.
 */
export function contentSizeOf(
  config: TrackConfig,
  track: Track,
  stop: string,
  size: number,
  back: string | null,
  remembered: (range: Stop) => number,
): number {
  if (isRangeStop(config, stop)) return size;
  const ranges = track.filter((candidate) =>
    isRangeStop(config, candidate.name),
  );
  if (ranges.length === 0) return size;
  const target =
    ranges.find((candidate) => candidate.name === back) ?? roomiest(ranges);
  return Math.max(size, remembered(target));
}

/**
 * The stop whose content to show: `stop` itself, or at a point at 0, which
 * shows nothing, the stop it came from (`previous`), so the content leaves
 * with it. If that's unknown or also at 0, `back` (where a toggle would
 * bring it back to), and failing that, `stop`.
 */
export function contentStopOf(
  config: TrackConfig,
  stop: string | null,
  previous: string | null,
  back: string | null,
): string | null {
  if (!isZeroStop(config, stop)) return stop;
  if (previous !== null && !isZeroStop(config, previous)) return previous;
  return back ?? stop;
}

// --- Landing -----------------------------------------------------------------

export interface Landing {
  readonly size: number;
  readonly stop: string;
}

/**
 * Where a requested size lands (rules 2–4 above). `current` is the stop the
 * track is in, or `null` if it hasn't settled in one yet. With `elastic`, a
 * size pulled past the edge of a stop that stretches that way (by default,
 * ranges, not points) goes a little beyond it, for drags.
 */
export function land(
  track: Track,
  requested: number,
  current: string | null,
  elastic?: Elastic,
  /** The stop the drag's pointer last reached (see `reachedStop`). */
  reached: string | null = current,
): Landing {
  let stops = reachable(track, current);
  // Nowhere to land but `onlyByName` stops: then they're all there is.
  if (stops.length === 0) stops = [...track];

  const own = stops.find((stop) => stop.name === current);
  if (own && contains(own, requested)) {
    return { size: requested, stop: own.name };
  }
  const inside = stops.filter((stop) => contains(stop, requested));
  if (inside.length > 0) {
    return { size: requested, stop: preferred(inside, current).name };
  }

  // In a gap between stops, or beyond all of them.
  const below = endBelow(stops, requested, current);
  const above = endAbove(stops, requested, current);
  const side =
    below && (!above || requested <= dividingPoint(below, above))
      ? below
      : (above ?? below);
  if (!side) return { size: requested, stop: current ?? UNNAMED };

  const edge = side === below ? side.max : side.min;
  const larger = requested > edge;
  const origin = track.find((stop) => stop.name === reached);
  const give =
    elastic &&
    side.stretches[larger ? "larger" : "smaller"] &&
    (elastic.afterSnap || !snappedShortOf(origin, side, requested))
      ? stretch(Math.abs(requested - edge), elastic)
      : 0;
  return {
    // A stretch below a stop never goes under 0.
    size: larger ? edge + give : Math.max(0, edge - give),
    stop: side.name,
  };
}

/**
 * The stop a drag's pointer has most recently reached, after it moved from
 * asking for `from` to asking for `to`: of the stops that span covers (so
 * a fast move that jumps one still reaches it), the nearest to `to`.
 * `previous` if it covered none (it's in a gap it was already in). Only
 * stops the drag can land on count (see `reachable`, from `current`, the
 * stop it's in): passing over one reached only by name (`closed: 0`,
 * which a pointer past the edge always covers) isn't snapping to it.
 */
export function reachedStop(
  track: Track,
  previous: string | null,
  from: number,
  to: number,
  current: string | null,
): string | null {
  const low = Math.min(from, to) - EPSILON;
  const high = Math.max(from, to) + EPSILON;
  const covered = reachable(track, current).filter(
    (stop) => stop.max >= low && stop.min <= high,
  );
  if (covered.length === 0) return previous;
  const distance = (stop: Stop) =>
    to < stop.min ? stop.min - to : to > stop.max ? to - stop.max : 0;
  return covered.reduce((best, stop) =>
    distance(stop) < distance(best) ? stop : best,
  ).name;
}

/**
 * Whether a drag whose pointer last reached `origin` and asks for
 * `requested` got to `landed` by snapping across a gap, so the pointer is
 * short of it, on the side it came from. A stretch there would only lean
 * back toward the pointer; past an edge the pointer has gone beyond, it's
 * the resistance a stretch is for. See `Elastic.afterSnap`.
 */
export function snappedShortOf(
  origin: Stop | undefined,
  landed: Stop,
  requested: number,
): boolean {
  if (!origin || origin.name === landed.name) return false;
  if (requested < landed.min) return origin.max < landed.min;
  if (requested > landed.max) return origin.min > landed.max;
  return false;
}

/**
 * Where a gap between `below` and `above` divides: each side claims a share
 * of it in proportion to its pull.
 */
export function dividingPoint(below: Stop, above: Stop): number {
  const gap = above.min - below.max;
  return below.max + (gap * below.pull) / (below.pull + above.pull);
}

/** The current stop if it's among `stops`, else the narrowest of them. */
function preferred(stops: readonly Stop[], current: string | null): Stop {
  return (
    stops.find((stop) => stop.name === current) ??
    stops.reduce((best, stop) =>
      stop.max - stop.min < best.max - best.min ? stop : best,
    )
  );
}

/** The stop whose top end is nearest below `size`. */
function endBelow(
  stops: readonly Stop[],
  size: number,
  current: string | null,
): Stop | undefined {
  const lower = stops.filter((stop) => stop.max < size);
  if (lower.length === 0) return undefined;
  const top = Math.max(...lower.map((stop) => stop.max));
  return preferred(
    lower.filter((stop) => stop.max >= top - EPSILON),
    current,
  );
}

/** The stop whose bottom end is nearest above `size`. */
function endAbove(
  stops: readonly Stop[],
  size: number,
  current: string | null,
): Stop | undefined {
  const higher = stops.filter((stop) => stop.min > size);
  if (higher.length === 0) return undefined;
  const bottom = Math.min(...higher.map((stop) => stop.min));
  return preferred(
    higher.filter((stop) => stop.min <= bottom + EPSILON),
    current,
  );
}

// --- Stepping ----------------------------------------------------------------

/**
 * The nearest reachable stop entirely beyond `stop` in `direction` (1 for
 * larger, -1 for smaller), or `undefined` if there's none. Stops that only
 * overlap it don't count: a drag moves into those continuously.
 */
export function nextStop(
  track: Track,
  stop: Stop,
  direction: 1 | -1,
): Stop | undefined {
  const stops = reachable(track, null);
  return direction > 0
    ? endAbove(stops, stop.max + EPSILON, null)
    : endBelow(stops, stop.min - EPSILON, null);
}

/**
 * Whether a reachable stop extends beyond `stop` in `direction`, so a
 * neighbour at `stop`'s edge should hold (and snap across) rather than let
 * a drag push past it.
 */
export function hasStopBeyond(
  track: Track,
  stop: Stop,
  direction: 1 | -1,
): boolean {
  return reachable(track, null).some((other) =>
    direction > 0
      ? other.max > stop.max + EPSILON
      : other.min < stop.min - EPSILON,
  );
}
