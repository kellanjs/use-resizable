import { UNNAMED } from "./stops.js";

/**
 * What a screen reader announces for a handle or separator on a track with
 * named stops: the stop as well as the size, since a number alone wouldn't
 * say "rail". Tracks without named stops leave it to `aria-valuenow`.
 */
export function valueText(
  stop: string | null,
  size: number | null,
): string | undefined {
  if (stop === null) return undefined;
  return size === null ? stop : `${stop}, ${Math.round(size)} pixels`;
}

/** A size for `aria-value*`: whole pixels, or nothing before measuring. */
export function roundValue(value: number | null): number | undefined {
  return value === null || !Number.isFinite(value)
    ? undefined
    : Math.round(value);
}

/**
 * `aria-valuenow`: the size, kept within the reported min and max. An
 * elastic stretch goes a little past them while dragging, but the value
 * a screen reader hears shouldn't.
 */
export function nowValue(
  size: number | null,
  limits: { readonly min: number; readonly max: number } | null,
): number | undefined {
  if (size === null) return undefined;
  const within = limits
    ? Math.min(Math.max(size, limits.min), limits.max)
    : size;
  return roundValue(within);
}

/** A stop as users see it: `null` for a track without named stops. */
export function stopName(stop: string | null | undefined): string | null {
  return stop === UNNAMED ? null : (stop ?? null);
}
