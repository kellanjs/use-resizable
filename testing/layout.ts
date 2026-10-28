/**
 * Measurements for the layout tests: groups measured as a browser would
 * report them, and the sizes a layout then shows.
 */
import {
  type GroupSpace,
  type LayoutOptions,
  type LayoutState,
  createLayoutState,
  parseLayoutOptions,
} from "../src/layout/layout-config.js";
import { measure } from "../src/layout/layout-model.js";
import { getLayoutRendering } from "../src/layout/layout-rendering.js";

/**
 * A group's measurement: `available` for its children to share, `overhead`
 * taken by its own separators, gaps and padding along its axis and
 * `crossOverhead` across it, none by its children's own padding and borders,
 * and no viewport for `vw` and `vh`.
 */
export const groupSpace = (
  available: number,
  overhead = 0,
  crossOverhead = 0,
): GroupSpace => ({
  available,
  overhead,
  crossOverhead,
  bases: {},
  basisOffsets: {},
  rootFontSize: 16,
  viewport: null,
});

/** A layout from `options`, its groups measured at `spaces`, by id. */
export const layoutAt = (
  options: LayoutOptions,
  spaces: Record<string, number>,
): LayoutState =>
  measure(
    createLayoutState(parseLayoutOptions(options)),
    Object.fromEntries(
      Object.entries(spaces).map(([id, available]) => [
        id,
        groupSpace(available),
      ]),
    ),
  );

/** Each node's size by id, rounded to 2 decimals. */
export function sizes(state: LayoutState): Record<string, number | null> {
  return Object.fromEntries(
    [...getLayoutRendering(state).nodes.values()].map((node) => [
      node.id,
      node.size === null ? null : Math.round(node.size * 100) / 100,
    ]),
  );
}
