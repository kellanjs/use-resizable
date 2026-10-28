/**
 * Measuring a layout in the browser: each mounted group's and element's
 * box, a grid's tracks and gaps, and from them each group's space (see
 * `measure`), worked out once a batch of reports is in. And what's shown
 * mid-animation, read from the page.
 */
import { isRightToLeft } from "../foundation/direction.js";
import type { Axis } from "../foundation/keyboard.js";
import { type ElementSize, observeSize } from "../foundation/observe-size.js";
import { setOwn } from "../foundation/own.js";
import { type RefCallback, refCallback } from "../foundation/ref-callback.js";
import { getRootFontSize } from "../foundation/root-font-size.js";
import type { Store } from "../foundation/store.js";
import { viewportFor } from "../foundation/viewport.js";
import {
  type GroupSpace,
  type LayoutState,
  inMotion,
} from "./layout-config.js";
import { measure, shownSizes, usesViewport } from "./layout-model.js";
import { getLayoutRendering } from "./layout-rendering.js";
import {
  type GridNode,
  type GroupNode,
  gridOfTracks,
  indexTree,
  tracksAlong,
} from "./tree.js";

/**
 * The measurements for the layout in `store`, which they keep measured:
 * refs for its groups and elements to observe, and what's read from them.
 */
export function createLayoutMeasurement(store: Store<LayoutState>) {
  let measurePending = false;
  /** Each mounted group's and element's border box, by id. */
  const nodeSizes = new Map<string, ElementSize>();
  /** Each grid's gaps, as last measured (see `watchGaps`). */
  const gapsRead = new Map<string, string>();
  /** Each mounted group and element, by id. */
  const nodeElements = new Map<string, HTMLElement>();

  /**
   * Works out each group's space once all its children have reported.
   * Elements report one at a time, so this waits for the rest of the batch.
   */
  function scheduleMeasure() {
    if (measurePending) return;
    measurePending = true;
    queueMicrotask(() => {
      measurePending = false;
      const state = store.get();
      const rootFontSize = getRootFontSize();
      const viewport = viewportFor(usesViewport(state));
      const spaces: Record<string, GroupSpace> = {};
      const tree = indexTree(state.config.root);
      for (const group of tree.groups) {
        const grid = gridOfTracks(tree, group.id);
        if (grid) {
          const tracks = measureTracks(grid, group);
          if (tracks) {
            setOwn(spaces, group.id, { ...tracks, rootFontSize, viewport });
          }
          continue;
        }
        const along = (size: ElementSize) =>
          group.axis === "horizontal" ? size.width : size.height;
        const across = (size: ElementSize) =>
          group.axis === "horizontal" ? size.height : size.width;
        let available = 0;
        let filled = 0;
        let complete = true;
        const bases: Record<string, number> = {};
        const basisOffsets: Record<string, number> = {};
        for (const child of group.children) {
          const size = nodeSizes.get(child.id);
          const element = nodeElements.get(child.id);
          if (!size || !element) complete = false;
          else {
            available += along(size);
            filled = Math.max(filled, across(size));
            const { base, contentBox } = baseAlong(element, group.axis);
            if (base > 0) setOwn(bases, child.id, base);
            if (base > 0 && contentBox) setOwn(basisOffsets, child.id, base);
          }
        }
        if (!complete) continue;
        const own = nodeSizes.get(group.id);
        const overhead = own ? Math.max(0, along(own) - available) : 0;
        const crossOverhead = own ? Math.max(0, across(own) - filled) : 0;
        setOwn(spaces, group.id, {
          available,
          overhead,
          crossOverhead,
          bases,
          basisOffsets,
          rootFontSize,
          viewport,
        });
      }
      store.set(measure(state, spaces));
    });
  }

  /**
   * A grid's track sizes along `axis`, as the browser laid them out: its
   * computed template, every track and line's track in pixels. `null`
   * before it's a grid with these tracks (not rendered yet, or the options
   * just changed).
   */
  function readTemplate(
    element: HTMLElement,
    axis: Axis,
    count: number,
  ): number[] | null {
    const style = getComputedStyle(element);
    const sizes = (
      axis === "horizontal" ? style.gridTemplateColumns : style.gridTemplateRows
    )
      .split(" ")
      .map(parseFloat);
    return sizes.length === 2 * count - 1 && !sizes.some(Number.isNaN)
      ? sizes
      : null;
  }

  /**
   * The space a grid's tracks share along their axis: its content box,
   * less the lines' tracks and the gaps. Measured from the box, not the
   * tracks, which are the layout's sizes from before.
   */
  function measureTracks(
    grid: GridNode,
    tracks: GroupNode,
  ): Omit<GroupSpace, "rootFontSize" | "viewport"> | null {
    const element = nodeElements.get(grid.id);
    const size = nodeSizes.get(grid.id);
    if (!element || !size) return null;
    const template = readTemplate(element, tracks.axis, tracks.children.length);
    if (!template) return null;
    const style = getComputedStyle(element);
    const horizontal = tracks.axis === "horizontal";
    const own = horizontal ? size.width : size.height;
    // Inside its padding and borders, and a scrollbar's room: read now (an
    // observed content box can be a frame behind its size mid-change), as
    // what's beyond the client box but the borders. Whole pixels, so only
    // a gap a scrollbar could be counts.
    const scrollbar =
      (horizontal
        ? element.offsetWidth - element.clientWidth
        : element.offsetHeight - element.clientHeight) -
      (horizontal
        ? parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
        : parseFloat(style.borderTopWidth) +
            parseFloat(style.borderBottomWidth) || 0);
    const inside =
      own -
      baseAlong(element, tracks.axis).base -
      (scrollbar >= 2 ? scrollbar : 0);
    const gap = gapOf(horizontal ? style.columnGap : style.rowGap, inside);
    gapsRead.set(grid.id, gapsOf(style));
    const between = tracks.children
      .slice(1)
      .map((_, index) => template[2 * index + 1] + 2 * gap);
    const available = Math.max(
      0,
      inside - between.reduce((sum, room) => sum + room, 0),
    );
    return {
      available,
      overhead: own - available,
      crossOverhead: 0,
      bases: {},
      basisOffsets: {},
      between,
    };
  }

  /**
   * A grid's gap (`column-gap` or `row-gap`, as computed) in pixels. A `%`
   * of its content box (`inside`), or a `calc()` with one, is given as
   * written: it's laid out on a probe that size, off the page.
   */
  function gapOf(value: string, inside: number): number {
    if (value === "" || value === "normal") return 0;
    if (/^[\d.]+px$/.test(value)) return parseFloat(value);
    const box = document.createElement("div");
    box.style.cssText = `position: absolute; visibility: hidden; left: -100000px; top: 0; width: ${inside}px; height: 0`;
    const gap = document.createElement("div");
    gap.style.width = value;
    box.append(gap);
    document.body.append(box);
    try {
      return gap.getBoundingClientRect().width;
    } finally {
      box.remove();
    }
  }

  /**
   * The sizes children are shown at in `state` if it's animating (see
   * `shownSizes`).
   */
  function shownIn(
    state: LayoutState,
  ): ReadonlyMap<string, number> | undefined {
    if (!state.animating || state.drag) return undefined;
    return shownSizes(state, shownSize);
  }

  /**
   * The size a node is shown at along `axis`, mid-animation: a grid's track
   * from its grid's computed template, anything else from its box.
   */
  function shownSize(id: string, axis: Axis): number | undefined {
    const tree = indexTree(store.get().config.root);
    const grid =
      tree.nodes.get(id)?.kind === "track" ? tree.gridOf.get(id) : undefined;
    if (!grid) {
      const box = nodeElements.get(id)?.getBoundingClientRect();
      return box && (axis === "horizontal" ? box.width : box.height);
    }
    const element = nodeElements.get(grid.id);
    const tracks = tracksAlong(grid, axis).children;
    const index = tracks.findIndex((track) => track.id === id);
    if (!element || index === -1) return undefined;
    return readTemplate(element, axis, tracks.length)?.[2 * index];
  }

  /**
   * An element's own padding and border along `axis`: what flexbox starts
   * it at, however small its share.
   */
  function baseAlong(
    element: HTMLElement,
    axis: Axis,
  ): { base: number; contentBox: boolean } {
    const style = getComputedStyle(element);
    const sides =
      axis === "horizontal"
        ? [
            style.paddingLeft,
            style.paddingRight,
            style.borderLeftWidth,
            style.borderRightWidth,
          ]
        : [
            style.paddingTop,
            style.paddingBottom,
            style.borderTopWidth,
            style.borderBottomWidth,
          ];
    return {
      base: sides.reduce((sum, side) => sum + (parseFloat(side) || 0), 0),
      // Its `flex-basis` leaves them out.
      contentBox: style.boxSizing === "content-box",
    };
  }

  /**
   * A child the options just added is already in the page, rendered at 0
   * (the hook drew it before the controller had the new options). Make the
   * browser work out its style now, so when it gets its size it grows from
   * 0 with the others, rather than appearing at its size at once.
   */
  function startJoinersAtZero() {
    const state = store.get();
    const { nodes } = getLayoutRendering(state);
    const tree = indexTree(state.config.root);
    for (const [id, element] of nodeElements) {
      // A grid's cells take their tracks' sizes; they don't grow from 0.
      if (nodes.has(id) || tree.cellOf.has(id)) continue;
      void getComputedStyle(element).flexGrow;
    }
  }

  /** The root group's element, once it's attached. */
  function rootElement(): HTMLElement | undefined {
    return nodeElements.get(store.get().config.root.id);
  }

  function observeNode(id: string): RefCallback {
    return refCallback((element) => {
      nodeElements.set(id, element);
      const stopObserving = observeSize(
        element,
        (size) => {
          nodeSizes.set(id, size);
          scheduleMeasure();
        },
        "border-box",
      );
      // A grid's tracks are sized in pixels, so nothing in it changes size
      // when its padding (or a scrollbar) does: its content box says so.
      // Observed for every node, as it may be a grid only in options that
      // haven't reached the controller yet (refs attach first).
      const stopContent = observeSize(element, scheduleMeasure, "content-box");
      const stopGaps = watchGaps(id, element);
      return () => {
        stopObserving();
        stopContent();
        stopGaps();
        nodeSizes.delete(id);
        if (nodeElements.get(id) === element) nodeElements.delete(id);
      };
    });
  }

  /**
   * A grid's gaps changing move its tracks without resizing anything
   * observed, so its own `class` and `style` are watched for it (a change
   * from an ancestor, or of a CSS variable, isn't seen: the grid's next
   * resize measures it). Not while it's moving: the layout writes its
   * style each frame, and measures once it stops anyway.
   */
  function watchGaps(id: string, element: HTMLElement): () => void {
    if (typeof MutationObserver !== "function") return () => {};
    const watcher = new MutationObserver(() => {
      const state = store.get();
      if (state.drag || inMotion(state)) return;
      if (indexTree(state.config.root).nodes.get(id)?.kind !== "grid") return;
      const read = gapsRead.get(id);
      if (read !== undefined && read !== gapsOf(getComputedStyle(element))) {
        scheduleMeasure();
      }
    });
    watcher.observe(element, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => watcher.disconnect();
  }

  /** A grid's gaps as its computed style has them, to compare. */
  function gapsOf(style: CSSStyleDeclaration): string {
    return `${style.columnGap} ${style.rowGap}`;
  }

  /**
   * Whether a group lays its children out right to left: a row whose CSS
   * `direction` is `rtl`. Read when a drag or key press starts, so it's
   * whatever the page says then.
   */
  function isReversed(id: string): boolean {
    // A grid's columns go the way the grid does.
    const grid = gridOfTracks(indexTree(store.get().config.root), id);
    const element = nodeElements.get(grid?.id ?? id);
    return element ? isRightToLeft(element) : false;
  }

  return {
    /** Each mounted group and element, by id. */
    elements: nodeElements as ReadonlyMap<string, HTMLElement>,
    scheduleMeasure,
    shownIn,
    shownSize,
    startJoinersAtZero,
    rootElement,
    observeNode,
    isReversed,
  };
}
