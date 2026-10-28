/**
 * Turning size specs back into CSS.
 *
 * Before a resizable has been measured (on the server, and during hydration),
 * we can't resolve `%` sizes to pixels. Instead we hand the browser the
 * equivalent CSS expression and let it do the resolving. The first render is
 * then already the right size, with nothing to correct after hydration.
 */
import type { LimitWinner } from "./limits.js";
import type { Size } from "./size.js";

export function toCss(size: Size): string {
  return `${size.value}${size.unit}`;
}

/**
 * CSS for `value` held within optional min and max bounds, mirroring how
 * {@link resolveMin} and {@link resolveMax} treat lists: the tightest
 * entry wins. When the bounds conflict, `wins` says which holds (`clamp()`
 * lets the min win).
 */
export function cssClamp(
  value: Size,
  min: readonly Size[] | undefined,
  max: readonly Size[] | undefined,
  wins: LimitWinner = "min",
): string {
  const valueCss = toCss(value);
  const minCss = min?.length ? combine("max", min) : undefined;
  const maxCss = max?.length ? combine("min", max) : undefined;

  if (minCss && maxCss) {
    return wins === "max"
      ? `min(max(${minCss}, ${valueCss}), ${maxCss})`
      : `clamp(${minCss}, ${valueCss}, ${maxCss})`;
  }
  if (minCss) return `max(${minCss}, ${valueCss})`;
  if (maxCss) return `min(${valueCss}, ${maxCss})`;
  return valueCss;
}

function combine(fn: "min" | "max", sizes: readonly Size[]): string {
  return sizes.length === 1
    ? toCss(sizes[0])
    : `${fn}(${sizes.map(toCss).join(", ")})`;
}
