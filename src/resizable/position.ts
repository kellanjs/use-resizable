/**
 * Position for elements with `anchor: "none"` (floating windows, palettes):
 * nothing about them is fixed, so the library owns where they are as well as
 * how big. Pure functions only.
 *
 * Like sizes, the stored position is a spec (`%` positions stay relative
 * until the element is moved), rendered as `left` / `top` with
 * `position: absolute`, so its container needs a positioning of its own.
 */
import { toCss } from "../foundation/css.js";
import {
  type Size,
  type SizeContext,
  type SizeValue,
  isSize,
  parseOffset,
  resolveSize,
} from "../foundation/size.js";

export interface PositionOptions {
  /** Where the element starts, relative to the container. Default 0, 0. */
  defaultPosition?: { x?: SizeValue; y?: SizeValue };
  /**
   * `"container"` keeps the element inside its container: it's never bigger
   * than the container (unless its minimum is, with `wins: "min"`, the
   * default), and it's shown
   * inside it whatever moved it (a drag, the keyboard, `setSize`,
   * `setPosition`, the container shrinking), even mid-stretch. By default it
   * can go anywhere.
   */
  confine?: "container";
}

export interface PositionConfig {
  readonly defaultX: Size;
  readonly defaultY: Size;
  readonly confined: boolean;
}

export interface PositionState {
  readonly x: Size;
  readonly y: Size;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle in the container's coordinates. */
export interface Rect extends Point {
  readonly width: number;
  readonly height: number;
}

export interface PositionRendering {
  /** Pixels from the container's left edge, or `null` before measurement. */
  readonly x: number | null;
  readonly y: number | null;
  readonly left: string;
  readonly top: string;
}

export function parsePosition(options: PositionOptions): PositionConfig {
  return {
    defaultX: parseOffset(options.defaultPosition?.x ?? 0),
    defaultY: parseOffset(options.defaultPosition?.y ?? 0),
    confined: options.confine === "container",
  };
}

export function initialPosition(config: PositionConfig): PositionState {
  return { x: config.defaultX, y: config.defaultY };
}

export function resolvePoint(
  position: PositionState,
  width: SizeContext,
  height: SizeContext,
): Point {
  return {
    x: resolveSize(position.x, width) ?? 0,
    y: resolveSize(position.y, height) ?? 0,
  };
}

/** Moves `point` so an element of `size` stays inside `container`. */
export function keepInside(
  point: Point,
  size: { readonly width: number; readonly height: number },
  container: { readonly width: number; readonly height: number },
): Point {
  // An element bigger than its container sticks to the top-left.
  const fit = (value: number, length: number, space: number) =>
    Math.max(0, Math.min(value, space - length));
  return {
    x: fit(point.x, size.width, container.width),
    y: fit(point.y, size.height, container.height),
  };
}

export function renderPoint(point: Point): PositionRendering {
  return { x: point.x, y: point.y, left: `${point.x}px`, top: `${point.y}px` };
}

/** Before measurement, the browser resolves the specs. */
export function renderUnmeasured(position: PositionState): PositionRendering {
  return { x: null, y: null, left: toCss(position.x), top: toCss(position.y) };
}

export function isPositionState(value: unknown): value is PositionState {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return isSize(x) && isSize(y);
}
