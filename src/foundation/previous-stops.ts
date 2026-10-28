/**
 * The stop each part of a model (a dimension, a layout's child) was in
 * before its latest change of stop, wherever that change came from: a drag
 * passing through, `setStop`, the keyboard, a restore. Content that crossfades
 * between stops' layouts needs it, to know what it's fading from, and what
 * to keep showing while at zero. And the stop each was in when the change
 * in progress began, for content that moves differently by where a change
 * starts and ends.
 */
import { own, setOwn } from "./own.js";

export interface StopHistory {
  /** By part (a dimension, a child's id); missing until its stop first changes. */
  readonly previousStops: Readonly<Record<string, string>>;
  /**
   * Each part's stop when the change in progress began (see
   * `recordFromStops`), or `null` while nothing is changing.
   */
  readonly fromStops: Readonly<Record<string, string | null>> | null;
}

/** What tells whether a change is in progress. */
interface ChangingState extends StopHistory {
  readonly drag: unknown;
  readonly animating: boolean;
}

/**
 * Records, in `after`, the stop each part left on the way from `before`.
 * `stopsOf` reads each part's current stop (`null` when there's none, or
 * before measurement, which isn't a stop to come back to). Returns `after`
 * itself when no stop changed.
 */
export function recordPreviousStops<S extends StopHistory>(
  before: S,
  after: S,
  stopsOf: (state: S) => Readonly<Record<string, string | null>>,
): S {
  if (before === after) return after;
  const was = stopsOf(before);
  const now = stopsOf(after);
  let previous: Record<string, string> | null = null;
  for (const [part, stop] of Object.entries(now)) {
    const from = own(was, part);
    if (from == null || from === stop) continue;
    previous ??= { ...after.previousStops };
    setOwn(previous, part, from);
  }
  return previous ? { ...after, previousStops: previous } : after;
}

/**
 * Records, in `after`, each part's stop when the change in progress began:
 * a drag, from its press through its release and settling, or an animated
 * change (`begins`: a `setStop`, a key, a reset, …) until its transition
 * ends. An animated change interrupting another starts afresh for the parts
 * whose stop it changes; the others are still moving as the earlier change
 * began (opening from `closed`, say, while a second change closes a
 * neighbour), so they keep its start. A drag starts afresh for all. Unlike
 * the previous
 * stop, which is history, this says what's happening: from `fromStops` to
 * the stops now. Content that travels with a closing element needs it: a
 * settle after reopening is in the same stop as the reopening, with the
 * same previous stop, and only where it began tells them apart.
 */
export function recordFromStops<S extends ChangingState>(
  before: S,
  after: S,
  stopsOf: (state: S) => Readonly<Record<string, string | null>>,
  begins: boolean,
): S {
  if (after.drag == null && !after.animating) {
    return after.fromStops === null ? after : { ...after, fromStops: null };
  }
  const pressed = before.drag == null && after.drag != null;
  if (!begins && !pressed && after.fromStops) return after;
  const fromStops = stopsOf(before);
  if (begins && !pressed && before.fromStops) {
    const now = stopsOf(after);
    const earlier = before.fromStops;
    return {
      ...after,
      fromStops: Object.fromEntries(
        Object.entries(fromStops).map(([part, stop]) => {
          const began = own(earlier, part);
          return [
            part,
            stop === own(now, part) && began !== undefined ? began : stop,
          ];
        }),
      ),
    };
  }
  return { ...after, fromStops };
}
