/**
 * Keeping a size within its limits, either with a hard stop or with an
 * elastic stretch that springs back when the drag ends.
 */

/** Resolved size limits, in pixels. */
export interface Limits {
  readonly min: number;
  readonly max: number;
}

/**
 * How far a drag may stretch past a limit, and how stiffly.
 *
 * The stretch follows a rubber-band curve: it starts out moving at
 * `1 - tension` times the pointer's speed and slows down as it approaches
 * `distance` pixels, which it never quite reaches.
 */
export interface Elastic {
  /** The furthest the size can stretch past a limit, in pixels. */
  readonly distance: number;
  /** 0 follows the pointer at first; 1 doesn't move at all. */
  readonly tension: number;
  /**
   * Whether something a drag snapped across a gap, so the pointer is short
   * of it, stretches back toward the pointer (default `false`: it sits at
   * its new stop's edge). Stretching past an edge the pointer has gone
   * beyond (a strip pulled open, a maximum pushed) is the resistance the
   * stretch is for, and happens either way.
   */
  readonly afterSnap: boolean;
}

/** Elastic options; what you leave out keeps its default. */
export type ElasticOptions = Partial<Elastic>;

export const DEFAULT_ELASTIC: Elastic = {
  distance: 16,
  tension: 0.8,
  afterSnap: false,
};

/** Which limit holds when a minimum is above a maximum (see `wins`). */
export type LimitWinner = "min" | "max";

/**
 * Builds limits from resolved bounds. When they conflict, `min` wins by
 * default, the same way CSS lets `min-width` override `max-width`; with
 * `wins: "max"`, `max` does.
 */
export function createLimits(
  min: number,
  max: number,
  wins: LimitWinner = "min",
): Limits {
  return wins === "max"
    ? { min: Math.min(min, max), max }
    : { min, max: Math.max(min, max) };
}

/**
 * How far the size actually moves past a limit when the pointer has gone
 * `overshoot` pixels past it.
 */
export function stretch(
  overshoot: number,
  elastic: Pick<Elastic, "distance" | "tension">,
): number {
  const give = 1 - Math.min(1, Math.max(0, elastic.tension));
  if (overshoot <= 0 || elastic.distance <= 0 || give === 0) return 0;

  const pulled = overshoot * give;
  return pulled / (1 + pulled / elastic.distance);
}
