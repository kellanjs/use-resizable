/**
 * What `useResizableLayout` hands the app on each render: the view, the
 * props for its groups, grids, elements, separators and junctions, and its
 * actions, from the controller's state and this render's options.
 */
import { type CSSProperties } from "react";

import {
  nowValue,
  roundValue,
  stopName,
  valueText,
} from "../foundation/aria.js";
import { type ClipPins, clipStyle } from "../foundation/clip.js";
import { holdsContent } from "../foundation/held-content.js";
import { own } from "../foundation/own.js";
import {
  type PropsOptions,
  contentStyle,
  contentVariable,
  holdsWhileAnimating,
  timingVariables,
} from "../foundation/props.js";
import { forReact } from "../foundation/react-ref.js";
import { ZERO, isRangeStop } from "../foundation/stops.js";
import { warnOnce } from "../foundation/warn.js";
import {
  cellArea,
  cellsAfter,
  cellsBefore,
  crossingArea,
  segmentArea,
  segmentsOf,
  templateOf,
} from "./grid-lines.js";
import type { LayoutOptions, LayoutState } from "./layout-config.js";
import {
  type LayoutControllerWithState,
  stopChanges,
} from "./layout-controller.js";
import {
  allowsStop,
  separatorAnswersKeys,
  setChildStops,
} from "./layout-model.js";
import {
  getLayoutContentRendering,
  getLayoutRendering,
} from "./layout-rendering.js";
import { type ResizableLayoutChild, getLayoutView } from "./layout-view.js";
import { separatorMoves, separatorReach } from "./separators.js";
import {
  type CellNode,
  type GridNode,
  type LayoutNode,
  type SeparatorPair,
  directionOf,
  dragCursor,
  groupBetween,
  indexTree,
  parseTree,
  shareSpace,
} from "./tree.js";
import type {
  ChildIdsOf,
  IdsOf,
  ResizableLayoutGroupProps,
  ResizableLayoutOf,
  UseResizableLayoutOptions,
} from "./use-resizable-layout-types.js";

/**
 * The layout as this render has it: `controller`'s `state`, with the
 * structure of `options.layout` (which the controller takes in a layout
 * effect, after this render: see `layout` below), and DOM ids made from
 * `prefix`.
 */
export function layoutOf<const L extends LayoutOptions["layout"]>(
  controller: LayoutControllerWithState,
  state: LayoutState,
  options: Pick<
    UseResizableLayoutOptions<ChildIdsOf<{ layout: L }>>,
    "valueText"
  > & { layout: L },
  prefix: string,
): ResizableLayoutOf<{ layout: L }> {
  type O = { layout: L };
  type Id = IdsOf<O>;
  type ChildId = ChildIdsOf<O>;
  const view = getLayoutView(state);
  const rendering = getLayoutRendering(state);
  const { config } = state;
  // The structure as these options have it. The controller gets them in a
  // layout effect, so on the render after they change, its state still has
  // the old tree: rendering from that would lag a render behind, and warn
  // about children that were just added. Sizes come from the state.
  const layout = parseTree(options.layout);
  const tree = indexTree(layout);
  const domId = (id: string) => `${prefix}-${id}`;

  // A stop these options just added isn't in the state yet: until the
  // controller takes them in (before this render is painted), nothing can
  // go there, as nothing can a child just added (see `childOf`). One these
  // options don't have either still throws.
  const justAdded = (id: string, stop: string) => {
    const has = (node: LayoutNode | undefined) =>
      node !== undefined &&
      "stops" in node &&
      node.stops.some((candidate) => candidate.name === stop);
    return (
      has(tree.nodes.get(id)) && !has(indexTree(config.root).nodes.get(id))
    );
  };

  // A child these options just added isn't in the state yet: until the
  // controller takes them in (before this render is painted), it reads as
  // not measured, so a child the options name always has a view.
  const childOf = (id: string) =>
    (own(view.children, id) ??
      (id !== layout.id && tree.nodes.has(id) && !tree.cellOf.has(id)
        ? unmeasuredChild(id)
        : undefined)) as ResizableLayoutChild<ChildId> | undefined;

  // Reflowing once, a drag or an animated change holds the children's
  // content (see `getLayoutContentRendering`).
  const holding = holdsContent(state);
  const content = getLayoutContentRendering(state);
  // Or an animated change that moves a child to another stop holds its own
  // (see `contentVariable`).
  const holds = (id: string) =>
    holding ||
    holdsWhileAnimating(
      rendering.animating,
      own(state.fromStops, id),
      rendering.nodes.get(id)?.stop,
    );

  /** Flex sizing for a child, along its group's direction. */
  const childStyle = (id: string): CSSProperties => {
    const parent = tree.parents.get(id);
    const node = rendering.nodes.get(id);
    const laidOut = content.nodes.get(id);
    // Against the size it's drawn at (smaller than its size in a group
    // past its space), which content is laid out at.
    const contentSize = contentVariable(
      laidOut?.contentSize ?? null,
      laidOut?.drawn ?? null,
      holds(id),
    );
    return {
      flex: node?.flex ?? "0 0 0px",
      // Without this, content larger than the child would push it open.
      [parent?.axis === "vertical" ? "minHeight" : "minWidth"]: 0,
      transition: rendering.transition,
      // At 0 there's nothing to show; hiding it also takes its content out
      // of the tab order and the accessibility tree.
      visibility: node?.hidden ? "hidden" : undefined,
      // For content that keeps its size while the child is small
      // (`initial` while that's just its size; see `contentVariable`). Only
      // along its group's direction: across it, the child is its group's
      // size, so it takes the group's.
      ...({
        "--resizable-content-size": contentSize,
        [parent?.axis === "vertical"
          ? "--resizable-content-height"
          : "--resizable-content-width"]: contentSize,
      } as CSSProperties),
    };
  };

  /** `data-zero` for a child, once measured. */
  const zero = (id: string) => {
    const size = rendering.nodes.get(id)?.size;
    return size != null && size < ZERO ? "" : undefined;
  };

  /** A separator's `data-zero`: which of its neighbours is at zero. */
  const zeroSide = (before: string, after: string) => {
    const atBefore = zero(before) !== undefined;
    const atAfter = zero(after) !== undefined;
    if (atBefore && atAfter) return "both";
    return atBefore ? "before" : atAfter ? "after" : undefined;
  };

  /** The tracks a cell spans along `which`, and the room between them. */
  const spanned = (
    cell: CellNode,
    grid: GridNode,
    which: "columns" | "rows",
  ) => {
    const [start, span] =
      which === "columns"
        ? [cell.column, cell.columnSpan]
        : [cell.row, cell.rowSpan];
    const between = own(state.spaces, grid[which].id)?.between ?? [];
    return {
      tracks: grid[which].children.slice(start, start + span),
      between: between
        .slice(start, start + span - 1)
        .reduce((sum, room) => sum + room, 0),
    };
  };

  /**
   * A cell's size along `which` as drawn, and as its content is laid out
   * (its tracks', and the lines between them), or `null` until measured,
   * and whether its content is held (see `holds`): only while every track
   * it spans is, so a cell resized because one of them opens or closes
   * reflows with its edge, as a child resized within its stop does. A
   * track at a point (closed, or a rail) adds its content size only if
   * they all are: with any in a range, the cell is open, and that track
   * adds what it shows, not the range it would go back to.
   */
  const cellSize = (
    cell: CellNode,
    grid: GridNode,
    which: "columns" | "rows",
  ) => {
    const { tracks, between } = spanned(cell, grid, which);
    const laidOut = tracks.map((track) => content.nodes.get(track.id));
    const open = tracks.some((track, index) => {
      const stop = laidOut[index]?.stop;
      return stop != null && isRangeStop(track, stop);
    });
    let size = between;
    let contentSize = between;
    for (const [index, track] of tracks.entries()) {
      const rendering = laidOut[index];
      if (rendering?.drawn == null || rendering.contentSize == null) {
        return null;
      }
      const atPoint =
        rendering.stop == null || !isRangeStop(track, rendering.stop);
      // As drawn: a grid past its space squeezes its tracks.
      size += rendering.drawn;
      contentSize += open && atPoint ? rendering.drawn : rendering.contentSize;
    }
    return {
      size,
      contentSize,
      held: tracks.every((track) => holds(track.id)),
    };
  };

  /** A cell's place, clipping, and the size to lay its content out at. */
  const cellStyle = (cell: CellNode): CSSProperties => {
    const grid = tree.gridOf.get(cell.id) as GridNode;
    const width = cellSize(cell, grid, "columns");
    const height = cellSize(cell, grid, "rows");
    const atZero =
      (width !== null && width.size < ZERO) ||
      (height !== null && height.size < ZERO);
    return {
      ...cellArea(cell),
      // Content larger than it mustn't widen its tracks, or the lines'
      // tracks it spans: it's as big as its area, whatever's in it.
      contain: "size",
      minWidth: 0,
      minHeight: 0,
      visibility:
        (cell.hideAtZero ?? config.hideAtZero) && !rendering.animating && atZero
          ? "hidden"
          : undefined,
      ...({
        "--resizable-content-width": contentVariable(
          width?.contentSize ?? null,
          width?.size ?? null,
          width?.held ?? false,
        ),
        "--resizable-content-height": contentVariable(
          height?.contentSize ?? null,
          height?.size ?? null,
          height?.held ?? false,
        ),
      } as CSSProperties),
    };
  };

  /** A cell's `data-zero`: at zero either way. */
  const cellZero = (cell: CellNode) => {
    const grid = tree.gridOf.get(cell.id) as GridNode;
    const width = cellSize(cell, grid, "columns");
    const height = cellSize(cell, grid, "rows");
    return (width !== null && width.size < ZERO) ||
      (height !== null && height.size < ZERO)
      ? ""
      : undefined;
  };

  /** A grid's props: its templates, animated with the change. */
  function getGridProps(
    grid: GridNode,
    { style }: PropsOptions = {},
  ): ResizableLayoutGroupProps {
    const root = grid.id === layout.id;
    // A nested grid is sized in its parent like any child; a cell's, by
    // its tracks.
    const placement = tree.cellOf.get(grid.id);
    const placed = root
      ? undefined
      : placement
        ? cellStyle(placement)
        : childStyle(grid.id);
    const timing = rendering.timing;
    const templates = timing
      ? `grid-template-columns ${timing.duration}ms ${timing.easing}, ` +
        `grid-template-rows ${timing.duration}ms ${timing.easing}`
      : undefined;
    const template = (tracks: GridNode["columns"]) =>
      templateOf(
        tracks.children.map(
          (track) => rendering.nodes.get(track.id)?.template ?? "0px",
        ),
      );
    const child = rendering.nodes.get(grid.id);
    return {
      ref: forReact(controller.groupRef(grid.id)),
      id: domId(grid.id),
      style: {
        // A nested grid is sized in its parent like any child.
        ...placed,
        display: "grid",
        gridTemplateColumns: template(grid.columns),
        gridTemplateRows: template(grid.rows),
        // What its junctions are placed against.
        position: "relative",
        transition:
          [placed?.transition, templates].filter(Boolean).join(", ") ||
          undefined,
        // Children and their content inherit these.
        ...(root && timingVariables(rendering.contentTiming)),
        ...style,
      },
      "data-group": grid.id,
      "data-direction": undefined,
      "data-grid": "",
      "data-stop": root ? undefined : (stopName(child?.stop) ?? undefined),
      "data-zero": root
        ? undefined
        : placement
          ? cellZero(placement)
          : zero(grid.id),
      "data-dragging": root && rendering.dragging.length > 0 ? "" : undefined,
      "data-animating": root && rendering.animating ? "" : undefined,
    };
  }

  /**
   * Where a junction of a grid's column line and row line goes: on their
   * crossing, centred. `undefined` for any other junction, which the app
   * places.
   */
  const crossingStyle = (
    pairs: readonly SeparatorPair[],
  ): CSSProperties | undefined => {
    if (pairs.length !== 2) return undefined;
    const grid = tree.gridOf.get(pairs[0].before);
    if (!grid || tree.gridOf.get(pairs[1].before) !== grid) return undefined;
    const indexIn = (tracks: GridNode["columns"], pair: SeparatorPair) => {
      const index = tracks.children.findIndex(
        (track) => track.id === pair.before,
      );
      return tracks.children[index + 1]?.id === pair.after ? index : -1;
    };
    const [first, second] = pairs;
    const column = Math.max(
      indexIn(grid.columns, first),
      indexIn(grid.columns, second),
    );
    const row = Math.max(indexIn(grid.rows, first), indexIn(grid.rows, second));
    if (column === -1 || row === -1) return undefined;
    return {
      position: "absolute",
      ...crossingArea(column, row),
      left: "50%",
      top: "50%",
      translate: "-50% -50%",
    };
  };

  const isDragging = (before: string, after: string) =>
    rendering.dragging.some(
      (pair) => pair.before === before && pair.after === after,
    );

  function getGroupProps(
    id: Id,
    { style }: PropsOptions = {},
  ): ResizableLayoutGroupProps {
    const group = tree.nodes.get(id);
    if (group?.kind === "grid") return getGridProps(group, { style });
    if (group?.kind !== "group") {
      warnOnce(
        group
          ? `getGroupProps("${id}"): "${id}" is an element; use getElementProps.`
          : `getGroupProps("${id}"): there's no group "${id}" in the options, so it renders at 0px.`,
      );
    }
    const direction = directionOf(
      group?.kind === "group" ? group.axis : "horizontal",
    );
    const root = id === layout.id;
    const child = rendering.nodes.get(id);
    // A grid's cell, sized by its tracks.
    const placement = tree.cellOf.get(id);
    return {
      ref: forReact(controller.groupRef(id)),
      id: domId(id),
      style: {
        // The root fills what the app gives it; a nested group is sized in
        // its parent like any child, and a cell by its tracks.
        ...(!root && (placement ? cellStyle(placement) : childStyle(id))),
        display: "flex",
        flexDirection: direction,
        // Children and their content inherit these.
        ...(root && timingVariables(rendering.contentTiming)),
        ...style,
      },
      "data-group": id,
      "data-direction": direction,
      "data-grid": undefined,
      "data-stop": root ? undefined : (stopName(child?.stop) ?? undefined),
      "data-zero": root
        ? undefined
        : placement
          ? cellZero(placement)
          : zero(id),
      "data-dragging": root && rendering.dragging.length > 0 ? "" : undefined,
      "data-animating": root && rendering.animating ? "" : undefined,
    };
  }

  return {
    // In the options' order: see `layout` above.
    elements: tree.elements.flatMap((element) => childOf(element.id) ?? []),
    // Every id the options name has a view (measured or not); see `ChildOf`.
    getChild: childOf as ResizableLayoutOf<O>["getChild"],
    dragging: view.dragging as { before: ChildId; after: ChildId }[],
    animating: view.animating,
    overflowing: view.overflowing,
    childrenOf(id) {
      const group = tree.nodes.get(id);
      if (group?.kind === "grid") {
        // A cell is an element, or the group or grid it holds.
        return group.cells.map((cell) => ({
          id: cell.id as ChildId,
          kind: cell.content?.kind ?? "element",
          previous: null,
        }));
      }
      if (group?.kind !== "group") {
        warnOnce(
          `childrenOf("${id}"): there's no group "${id}" in the options.`,
        );
        return [];
      }
      return group.children.map((child, index) => ({
        id: child.id as ChildId,
        // A group's children are never tracks: those are a grid's.
        kind: child.kind === "track" ? "element" : child.kind,
        previous: index > 0 ? (group.children[index - 1].id as ChildId) : null,
      }));
    },
    getGroupProps,
    getElementProps(id, { style } = {}) {
      const child = rendering.nodes.get(id);
      const node = tree.nodes.get(id);
      if (node?.kind === "cell") {
        return {
          ref: forReact(controller.elementRef(id)),
          id: domId(id),
          style: { ...cellStyle(node), overflow: "hidden", ...style },
          "data-element": id,
          // Its stops are its tracks'.
          "data-stop": undefined,
          "data-zero": cellZero(node),
        };
      }
      const kind = node?.kind;
      if (kind !== "element") {
        warnOnce(
          kind === "group"
            ? `getElementProps("${id}"): "${id}" is a group; use getGroupProps.`
            : `getElementProps("${id}"): there's no element "${id}" in the options, so it renders at 0px.`,
        );
      }
      return {
        ref: forReact(controller.elementRef(id)),
        id: domId(id),
        // Elements clip their content; groups don't, so a separator's hit
        // area near a group's edge isn't cut off.
        style: { ...childStyle(id), overflow: "hidden", ...style },
        "data-element": id,
        "data-stop": stopName(child?.stop) ?? undefined,
        "data-zero": zero(id),
      };
    },
    getContentProps(id, { style } = {}) {
      const kind = tree.nodes.get(id)?.kind;
      if (kind !== "element" && kind !== "cell") {
        warnOnce(
          `getContentProps("${id}"): there's no element "${id}" in the options, so its content has no size of its own to keep.`,
        );
      }
      return {
        // Both ways: a nested element takes the size across its group from
        // the group's.
        style: {
          ...contentStyle({ width: true, height: true }, holding),
          ...style,
        },
        "data-resizable-content": "",
      };
    },
    getClipProps(id, { slide = false, anchor, style } = {}) {
      const node = tree.nodes.get(id);
      let pins: ClipPins = { horizontal: null, vertical: null };
      let slides = false;
      if (node?.kind === "cell") {
        if (slide) {
          warnOnce(
            `getClipProps("${id}", { slide: true }): a grid's cell covers its content; sliding isn't offered for cells.`,
          );
        }
        // Pinned by where it sits along each way: at the grid's end edge
        // (and not its start), there; otherwise at its start.
        const grid = tree.gridOf.get(id) as GridNode;
        const atEnd = (start: number, span: number, count: number) =>
          start > 0 && start + span === count;
        pins = {
          horizontal: atEnd(
            node.column,
            node.columnSpan,
            grid.columns.children.length,
          )
            ? "end"
            : "start",
          vertical: atEnd(node.row, node.rowSpan, grid.rows.children.length)
            ? "bottom"
            : "top",
        };
      } else if (node?.kind === "element") {
        const group = tree.parents.get(id)!;
        const index = group.children.findIndex((child) => child.id === id);
        const placed =
          anchor ??
          (index > 0 && index === group.children.length - 1 ? "end" : "start");
        slides = slide && (own(state.sliding, id) ?? false);
        const side = slides ? (placed === "start" ? "end" : "start") : placed;
        pins =
          group.axis === "vertical"
            ? {
                horizontal: null,
                vertical: side === "start" ? "top" : "bottom",
              }
            : { horizontal: side, vertical: null };
      } else {
        warnOnce(
          `getClipProps("${id}"): there's no element "${id}" in the options, so there's nothing to clip.`,
        );
      }
      return {
        ref: forReact(controller.clipRef(id)),
        style: { ...clipStyle(pins), ...style },
        "data-resizable-clip": "",
        "data-zero": node?.kind === "cell" ? cellZero(node) : zero(id),
        "data-sliding": slides ? "" : undefined,
      };
    },
    separatorsOf(id) {
      const node = tree.nodes.get(id);
      if (node?.kind === "grid") {
        return segmentsOf(node).map(({ before, after, segment }) => ({
          key: separatorKey(before, after, segment),
          before: before as ChildId,
          after: after as ChildId,
          segment,
        }));
      }
      if (node?.kind !== "group") {
        warnOnce(
          `separatorsOf("${id}"): there's no group or grid "${id}" in the options.`,
        );
        return [];
      }
      return node.children.slice(1).map((child, index) => ({
        key: separatorKey(node.children[index].id, child.id, 0),
        before: node.children[index].id as ChildId,
        after: child.id as ChildId,
        segment: 0,
      }));
    },
    getSeparatorProps(
      before,
      after,
      { style, segment = 0, primary = "before" } = {},
    ) {
      // The neighbour it's about: its size is the separator's value.
      const primaryId = primary === "before" ? before : after;
      const child = rendering.nodes.get(primaryId);
      // A grid's line: placed in its track, segment by segment.
      const grid = tree.gridOf.get(before);
      const placed =
        grid &&
        segmentsOf(grid).find(
          (entry) =>
            entry.before === before &&
            entry.after === after &&
            entry.segment === segment,
        );
      if (grid && !placed && groupBetween(layout, before, after)) {
        warnOnce(
          `getSeparatorProps("${before}", "${after}", { segment: ${segment} }): the line between them has no such segment (cells spanning across it cut it; see separatorsOf).`,
        );
      }
      // It controls a cell on its primary side along the segment: one
      // that's just the track there, whose size it reports, if there is one.
      const sideCells =
        grid && placed
          ? primary === "before"
            ? cellsBefore(grid, placed)
            : cellsAfter(grid, placed)
          : [];
      const controls = grid
        ? (
            sideCells.find((cell) =>
              placed?.between === "columns"
                ? cell.columnSpan === 1
                : cell.rowSpan === 1,
            ) ?? sideCells[0]
          )?.id
        : primaryId;
      // The sizes the user can reach: where Home and End go, as far as the
      // layout allows (before measuring, nothing yet).
      const limits = separatorReach(state, before, after, primary);
      const group = groupBetween(layout, before, after);
      if (!group) {
        warnOnce(
          `getSeparatorProps("${before}", "${after}"): these aren't neighbours in one group, so the separator does nothing. Pass the ids either side of it, in order.`,
        );
      }
      const axis = group?.axis ?? "horizontal";
      // Pinned where it is (say, next to a fill holding no space): no
      // resize cursor or highlight, and announced as disabled.
      const moves = !config.disabled && separatorMoves(state, before, after);
      // Enter can reach a stop a press can't: announced as enabled.
      const answers =
        moves ||
        (!config.disabled &&
          separatorAnswersKeys(state, before, after, primary));
      return {
        ref: forReact(controller.separatorRef(before, after, primary, segment)),
        role: "separator",
        tabIndex: config.disabled || !config.keyboard ? -1 : 0,
        style: {
          // Without this, touch drags would scroll the page instead.
          touchAction: "none",
          flexShrink: 0,
          cursor:
            moves && config.cursor
              ? dragCursor(layout, [{ before, after }])
              : undefined,
          ...(grid && placed && segmentArea(grid, placed)),
          ...style,
        },
        "aria-controls": domId(controls ?? grid?.id ?? before),
        // The separator is a line across its group's direction.
        "aria-orientation": axis === "vertical" ? "horizontal" : "vertical",
        "aria-valuenow": nowValue(child?.size ?? null, limits),
        "aria-valuemin": roundValue(limits?.min ?? null),
        "aria-valuemax": roundValue(limits?.max ?? null),
        "aria-valuetext": options.valueText
          ? options.valueText({
              id: primaryId,
              stop: stopName(child?.stop),
              size: child?.size ?? null,
            })
          : valueText(stopName(child?.stop), child?.size ?? null),
        "aria-disabled": !answers || undefined,
        "data-direction": directionOf(axis),
        "data-dragging": isDragging(before, after) ? "" : undefined,
        "data-hover":
          moves &&
          rendering.hovered.some(
            (pair) => pair.before === before && pair.after === after,
          )
            ? ""
            : undefined,
        "data-zero": zeroSide(before, after),
      };
    },
    getJunctionProps(separators, { style } = {}) {
      const pairs = separators.map(([before, after]) => ({ before, after }));
      const name = `getJunctionProps(${separators.map((pair) => `["${pair.join('", "')}"]`).join(", ")})`;
      if (pairs.length < 2) {
        warnOnce(
          `${name}: a junction drags two or more separators; for one, use getSeparatorProps.`,
        );
      }
      pairs.forEach((pair, index) => {
        if (!groupBetween(layout, pair.before, pair.after)) {
          warnOnce(
            `${name}: "${pair.before}" and "${pair.after}" aren't neighbours in one group, so that part does nothing.`,
          );
        }
        const earlier = pairs
          .slice(0, index)
          .find((other) => shareSpace(layout, other, pair));
        if (earlier) {
          warnOnce(
            `${name}: ["${pair.before}", "${pair.after}"] moves the same space as ["${earlier.before}", "${earlier.after}"] (the same group, or nested groups that run the same way), so only the first moves.`,
          );
        }
      });
      // Pressed or hovered here: the pairs are this junction's. (Its
      // separators' own attributes cover every segment they move.) The
      // pairs are new each render, so they're compared by content.
      const isThis = (other: readonly SeparatorPair[] | null | undefined) =>
        other?.length === pairs.length &&
        pairs.every(
          (pair, index) =>
            pair.before === other[index].before &&
            pair.after === other[index].after,
        );
      const moves =
        !config.disabled &&
        pairs.some((pair) => separatorMoves(state, pair.before, pair.after));
      return {
        ref: forReact(controller.junctionRef(pairs)),
        tabIndex: -1,
        "aria-hidden": true,
        style: {
          touchAction: "none",
          cursor:
            moves && config.cursor ? dragCursor(layout, pairs) : undefined,
          // In a grid, on its lines' crossing.
          ...crossingStyle(pairs),
          ...style,
        },
        // What was pressed, or the element pressed, whose pairs may have
        // changed since.
        "data-dragging":
          state.drag &&
          (isThis(state.drag.grabbed) || controller.isPressedJunction(pairs))
            ? ""
            : undefined,
        "data-hover": moves && isThis(state.hovered) ? "" : undefined,
      };
    },
    setStop: controller.setStop,
    toggle: controller.toggle,
    setStops: controller.setStops,
    // From this render's state, like the rest, not the controller's latest.
    canSetStops: (stops) =>
      !stopChanges(stops).some(([id, stop]) => justAdded(id, stop)) &&
      setChildStops(state, stopChanges(stops), true) !== state,
    canSetStop: (id, stop) =>
      !justAdded(id, stop) && allowsStop(state, id, stop),
    canToggle: (id, stop) =>
      !justAdded(id, stop) && allowsStop(state, id, stop, true),
    setSize: controller.setSize,
    getSnapshot: controller.getSnapshot,
    restore: controller.restore,
    reset: controller.reset,
    controller,
  };
}

/** A child's view before the layout has measured it. */
function unmeasuredChild(id: string): ResizableLayoutChild {
  return {
    id,
    size: null,
    stop: null,
    previousStop: null,
    stops: null,
    contentSize: null,
    contentStop: null,
    fromStop: null,
    yieldedFrom: null,
  };
}

/**
 * A separator's key, `before|after|segment`, a `|` or `\` in an id
 * escaped, so no ids can pass for others' (`"a|b"`, `"c"` and `"a"`,
 * `"b|c"`).
 */
function separatorKey(before: string, after: string, segment: number) {
  const escaped = (id: string) => id.replace(/[\\|]/g, "\\$&");
  return `${escaped(before)}|${escaped(after)}|${segment}`;
}
