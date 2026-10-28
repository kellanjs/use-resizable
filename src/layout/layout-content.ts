/**
 * How a layout's content continues through a change: each child's content
 * kept as it was laid out when a drag starts or a change is about to
 * animate (`holdContent`), and whether it slides through the change in
 * progress (`withSliding`). The actions in `layout-model.ts` and the
 * controller build on these.
 */
import { type SlidingPart, recordSliding } from "../foundation/clip.js";
import { heldOf, holdsContent } from "../foundation/held-content.js";
import { own, setOwn } from "../foundation/own.js";
import {
  holdsWhileAnimating,
  laidOutContentSize,
} from "../foundation/props.js";
import type { LayoutState } from "./layout-config.js";
import {
  getLayoutContentRendering,
  getLayoutRendering,
} from "./layout-rendering.js";
import { indexTree } from "./tree.js";

/**
 * `after`, with whether each child's content slides through the change in
 * progress (see `recordSliding`). `shown`, as for `holdContent`.
 */
export function withSliding(
  before: LayoutState,
  after: LayoutState,
  begins: boolean,
  shown?: ReadonlyMap<string, number>,
): LayoutState {
  return recordSliding(before, after, begins, (was, now) =>
    slidingParts(was, now, shown),
  );
}

/** Each child, for `recordSliding`. */
function slidingParts(
  before: LayoutState,
  after: LayoutState,
  shown?: ReadonlyMap<string, number>,
): Record<string, SlidingPart> {
  const was = laidOutContent(before, shown);
  // As the change begins, the children are still where they were.
  const now = laidOutContent(
    after,
    new Map(
      [...was].flatMap(([id, { size }]) => (size === null ? [] : [[id, size]])),
    ),
  );
  const { nodes } = indexTree(after.config.root);
  const parts: Record<string, SlidingPart> = {};
  for (const [id, rendering] of getLayoutRendering(after).nodes) {
    const node = nodes.get(id);
    setOwn(parts, id, {
      // A cell has no stops: its tracks have.
      config: node && "stops" in node ? node : null,
      stop: rendering.stop,
      size: was.get(id)?.size ?? null,
      content: was.get(id)?.content ?? null,
      contentAfter: now.get(id)?.content ?? null,
    });
  }
  return parts;
}

/**
 * `after`, keeping each child's content as `before` had it (see
 * `heldContent`): for a drag starting, or a change about to animate.
 * `shown` is the sizes children are shown at, mid-animation (see
 * `shownSizes`: their rendering is where they're going), so content is
 * kept as it's laid out there, not as it would be.
 */
export function holdContent(
  before: LayoutState,
  after: LayoutState,
  shown?: ReadonlyMap<string, number>,
): LayoutState {
  const laidOut = laidOutContent(before, shown);
  const interrupted = before.animating && before.drag === null;
  const heldContent = new Map(
    [...getLayoutContentRendering(before).nodes].map(([id, node]) => [
      id,
      {
        ...heldOf(node),
        contentSize: laidOut.get(id)?.content ?? node.contentSize,
        interrupted,
      },
    ]),
  );
  return { ...after, heldContent };
}

/**
 * Each child's size as shown in `state` (`shown`, measured, or its
 * rendering), and its content wrapper's then, along its group's direction
 * (see `laidOutContentSize`); `null` before measuring.
 */
function laidOutContent(
  state: LayoutState,
  shown?: ReadonlyMap<string, number>,
): Map<string, { size: number | null; content: number | null }> {
  const holding = holdsContent(state);
  const animating = state.animating && state.drag === null;
  const result = new Map<
    string,
    { size: number | null; content: number | null }
  >();
  for (const [id, node] of getLayoutContentRendering(state).nodes) {
    const size = shown?.get(id) ?? node.drawn;
    const holds =
      holding ||
      holdsWhileAnimating(animating, own(state.fromStops, id), node.stop);
    result.set(id, {
      size,
      content:
        size === null
          ? node.contentSize
          : laidOutContentSize(
              node.contentSize,
              node.drawn,
              size,
              holds,
              holding,
            ),
    });
  }
  return result;
}
