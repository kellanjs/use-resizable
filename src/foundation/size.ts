/**
 * Size specs: how users describe sizes, and how we turn them into pixels.
 *
 * Users write sizes the way they'd write CSS lengths, limited to the units
 * we can resolve without the browser's layout engine:
 *
 * - `240` or `"240px"` — pixels
 * - `"20rem"`          — multiples of the root font size
 * - `"30%"`            — a percentage of the container along the resize axis
 * - `"25vw"`, `"40vh"` — percentages of the viewport's width and height
 *
 * Bounds (min/max) can also be a list, meaning "all of these apply", so the
 * tightest one wins. `maxSize: ["28rem", "90%"]` behaves like CSS
 * `min(28rem, 90%)`, and `minSize: [200, "20%"]` like `max(200px, 20%)`.
 *
 * Specs are parsed once (when options are read) and resolved many times (on
 * every layout pass), so the two steps are separate functions.
 */

export type SizeUnit = "px" | "rem" | "%" | "vw" | "vh";

/** A size as the user writes it. */
export type SizeValue =
  | number
  | `${number}px`
  | `${number}rem`
  | `${number}%`
  | `${number}vw`
  | `${number}vh`;

/** A min or max bound: one size, or several that must all hold. */
export type SizeBound = SizeValue | readonly SizeValue[];

/**
 * A parsed size: a number and its unit. Sizes are never negative; a
 * position (see `parseOffset`) may be.
 */
export interface Size {
  readonly value: number;
  readonly unit: SizeUnit;
}

/** Everything needed to turn a {@link Size} into pixels. */
export interface SizeContext {
  /**
   * Length of the container along the resize axis, which `%` sizes are
   * relative to. `null` while it's unknown (before the first measurement, or
   * during server rendering).
   */
  readonly containerSize: number | null;
  /** Pixels per `rem`. */
  readonly rootFontSize: number;
  /**
   * The viewport's size, which `vw` and `vh` sizes are relative to. `null`
   * while it's unknown (during server rendering), or not read because no
   * size uses them.
   */
  readonly viewport: Viewport | null;
}

/** The viewport's size in pixels, as CSS's `100vw` and `100vh` are. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Browsers' default root font size; used until a real one is measured. */
export const DEFAULT_ROOT_FONT_SIZE = 16;

const UNIT_SUFFIXES = ["px", "rem", "%", "vw", "vh"] as const;

// A plain decimal number: no sign (sizes can't be negative), no exponent.
const NUMBER_PATTERN = /^(?:\d+\.?\d*|\.\d+)$/;

/**
 * Parses a size spec. Throws on malformed or negative values: those are
 * programming errors, and failing loudly at the call site beats an element that
 * silently renders at 0px.
 */
export function parseSize(input: SizeValue): Size {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`Invalid size ${input}: expected a finite number ≥ 0.`);
    }
    return { value: input, unit: "px" };
  }

  const text = input.trim();
  const unit = UNIT_SUFFIXES.find((suffix) => text.endsWith(suffix));
  const number = unit ? text.slice(0, -unit.length) : "";

  if (!unit || !NUMBER_PATTERN.test(number)) {
    throw new Error(
      `Invalid size "${input}": expected a number, or a number followed by px, rem, %, vw or vh.`,
    );
  }

  return { value: Number(number), unit };
}

/**
 * Parses a position offset: like a size, but it may be negative (an
 * element dragged partly out of its container sits at a negative x).
 */
export function parseOffset(input: SizeValue): Size {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new Error(`Invalid position ${input}: expected a finite number.`);
    }
    return { value: input, unit: "px" };
  }
  const text = input.trim();
  const negative = text.startsWith("-");
  const size = parseSize((negative ? text.slice(1) : text) as SizeValue);
  return negative ? { ...size, value: -size.value } : size;
}

/** Parses a bound into its list of sizes. Throws on an empty list. */
export function parseBound(input: SizeBound): readonly Size[] {
  // Narrowing a readonly array with Array.isArray needs the explicit cast;
  // see https://github.com/microsoft/TypeScript/issues/17002.
  const values = Array.isArray(input)
    ? (input as readonly SizeValue[])
    : [input as SizeValue];

  if (values.length === 0) {
    throw new Error("A size bound needs at least one value.");
  }

  return values.map(parseSize);
}

/**
 * Resolves a size to pixels, or `null` if what it's relative to (the
 * container, or the viewport) isn't known yet. Callers decide what
 * "unknown" means for them.
 */
export function resolveSize(size: Size, context: SizeContext): number | null {
  switch (size.unit) {
    case "px":
      return size.value;
    case "rem":
      return size.value * context.rootFontSize;
    case "%":
      return context.containerSize === null
        ? null
        : (size.value / 100) * context.containerSize;
    case "vw":
      return context.viewport && (size.value / 100) * context.viewport.width;
    case "vh":
      return context.viewport && (size.value / 100) * context.viewport.height;
  }
}

/**
 * Whether any size in `config` (parsed options, however nested) has one
 * of `units`. Remembered per object in `known`, since parsed options don't
 * change in place.
 */
function usesUnits(
  config: unknown,
  units: readonly SizeUnit[],
  known: WeakMap<object, boolean>,
): boolean {
  if (typeof config !== "object" || config === null) return false;
  const remembered = known.get(config);
  if (remembered !== undefined) return remembered;
  const unit = (config as { unit?: unknown }).unit;
  const uses =
    units.includes(unit as SizeUnit) ||
    Object.values(config).some((value) => usesUnits(value, units, known));
  known.set(config, uses);
  return uses;
}

const usesViewport = new WeakMap<object, boolean>();
const VIEWPORT_UNITS: readonly SizeUnit[] = ["vw", "vh"];

/**
 * Whether any size in `config` (parsed options, however nested) is in
 * `vw` or `vh`, so the viewport needs reading.
 */
export function usesViewportUnits(config: unknown): boolean {
  return usesUnits(config, VIEWPORT_UNITS, usesViewport);
}

const usesPercent = new WeakMap<object, boolean>();
const PERCENT: readonly SizeUnit[] = ["%"];

/** Whether any size in `config` (parsed options, however nested) is a `%`. */
export function usesPercentUnits(config: unknown): boolean {
  return usesUnits(config, PERCENT, usesPercent);
}

/**
 * Resolves a min bound to pixels: the largest of its sizes. Sizes that can't
 * be resolved yet don't constrain anything, and no bound at all means 0.
 */
export function resolveMin(
  bound: readonly Size[] | undefined,
  context: SizeContext,
): number {
  return resolveBound(bound, context, Math.max, 0);
}

/**
 * Resolves a max bound to pixels: the smallest of its sizes. Sizes that can't
 * be resolved yet don't constrain anything, and no bound at all means
 * unlimited.
 */
export function resolveMax(
  bound: readonly Size[] | undefined,
  context: SizeContext,
): number {
  return resolveBound(bound, context, Math.min, Infinity);
}

function resolveBound(
  bound: readonly Size[] | undefined,
  context: SizeContext,
  pickTightest: (...values: number[]) => number,
  unconstrained: number,
): number {
  const resolved: number[] = [];
  for (const size of bound ?? []) {
    const pixels = resolveSize(size, context);
    if (pixels !== null) resolved.push(pixels);
  }
  return resolved.length === 0 ? unconstrained : pickTightest(...resolved);
}

/** A size in pixels. */
export function px(value: number): Size {
  return { value, unit: "px" };
}

export function sameSize(a: Size | undefined, b: Size | undefined): boolean {
  return a?.value === b?.value && a?.unit === b?.unit;
}

/** Checks untrusted data (e.g. from storage): a finite size in a known unit. */
export function isSize(value: unknown): value is Size {
  if (typeof value !== "object" || value === null) return false;
  const { value: amount, unit } = value as Record<string, unknown>;
  return (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    (UNIT_SUFFIXES as readonly unknown[]).includes(unit)
  );
}
