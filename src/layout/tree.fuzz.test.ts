import { describe, it } from "vitest";

import { type Random, ensure, forEachCase } from "../../testing/fuzz.js";
import {
  randomElement,
  withFills,
  withPrototypeNames,
} from "../../testing/layout-cases.js";
import { groupSpace } from "../../testing/layout.js";
import { own, setOwn } from "../foundation/own.js";
import { findStop } from "../foundation/stops.js";
import {
  type GroupSpace,
  type LayoutOptions,
  type LayoutState,
  createLayoutState,
  parseLayoutOptions,
} from "./layout-config.js";
import {
  applyKeyboard,
  cancelDrag,
  endDrag,
  measure,
  moveDrag,
  setChildStop,
  startDrag,
} from "./layout-model.js";
import { getLayoutRendering } from "./layout-rendering.js";
import { getLayoutView } from "./layout-view.js";
import {
  type ChildNode,
  type LayoutChildOptions,
  type LayoutDirection,
  type LayoutGridOptions,
  type LayoutTrackOptions,
  type RootNode,
  type SeparatorPair,
  indexTree,
} from "./tree.js";

/** Within half a pixel: what a browser can't show the difference of. */
const NEAR = 0.5;
const DISTANCE = 16;

const flip = (direction: LayoutDirection): LayoutDirection =>
  direction === "row" ? "column" : "row";

/**
 * A random tree: a row of elements, groups running across it and grids,
 * nested up to three deep, with fills sometimes; or a grid on its own.
 */
function generate(random: Random): {
  options: LayoutOptions;
  width: number;
  height: number;
} {
  let counter = 0;
  const id = () => `n${counter++}`;
  /** A grid of 2 to 4 tracks each way, a cell in each place. */
  const grid = (): LayoutGridOptions => {
    const gridId = id();
    const tracks = (which: string): LayoutTrackOptions[] =>
      Array.from({ length: random.int(2, 4) }, (_, index) =>
        random.chance(0.5)
          ? { id: `${gridId}-${which}${index}`, minSize: random.int(40, 120) }
          : {
              id: `${gridId}-${which}${index}`,
              stops: {
                strip: random.int(20, 40),
                open: { min: random.int(60, 140) },
              },
            },
      );
    const columns = tracks("c");
    const rows = tracks("r");
    return {
      id: gridId,
      columns,
      rows,
      children: columns.flatMap((column) =>
        rows.map((row) => {
          const place = {
            id: `${column.id}-${row.id}`,
            column: column.id,
            row: row.id,
          };
          if (!random.chance(0.25)) return place;
          // A group in the cell, either way, whose own separators move
          // with the grid's lines.
          const direction = random.pick(["row", "column"] as const);
          return {
            ...place,
            direction,
            children: Array.from({ length: random.int(2, 3) }, () =>
              randomElement(random, id()),
            ),
          };
        }),
      ),
    };
  };
  const children = (
    direction: LayoutDirection,
    depth: number,
  ): LayoutChildOptions[] => {
    const own = Array.from({ length: random.int(2, 4) }, () => {
      if (depth < 2 && random.chance(0.1)) return grid();
      if (depth >= 2 || !random.chance(0.35)) {
        return randomElement(random, id());
      }
      // Mostly across its parent; sometimes the same way, so its
      // separators can lie against its parent's (stacked).
      const nested = random.chance(0.7) ? flip(direction) : direction;
      return {
        id: id(),
        direction: nested,
        children: children(nested, depth + 1),
      };
    });
    return withFills(random, own, `${id()}-`);
  };

  const layout = random.chance(0.2)
    ? grid()
    : { id: "root", direction: "row" as const, children: children("row", 0) };
  return {
    options: {
      layout: withPrototypeNames(layout),
      elastic: random.pick([false, true, { afterSnap: true }] as const),
      cascade: random.chance(0.8),
      ...(random.chance(0.3) && { keyboard: { jump: false } }),
    },
    width: random.int(600, 1600),
    height: random.int(400, 1000),
  };
}

/**
 * Measures every group the way the browser would (children as drawn: see
 * `squeezed`): the root gets the window,
 * and a nested group the size its parent gives it along one axis and the
 * parent's own extent along the other. Repeated until nothing changes, as
 * each group's sizes give the next level its space.
 *
 * `holding`: what's held down (see `heldDown`) and the protected child
 * (see `protectedChild`) stay, as for a change that isn't from elsewhere,
 * so measuring it changes nothing (taking a drag's stretch off, say: its
 * release predicts the spaces).
 */
function remeasure(
  state: LayoutState,
  width: number,
  height: number,
  holding = false,
): LayoutState {
  let next = state;
  for (let pass = 0; pass < 20; pass++) {
    const nodes = getLayoutRendering(next).nodes;
    const spaces: Record<string, GroupSpace> = {};
    const visit = (node: RootNode | ChildNode, w: number, h: number) => {
      // A grid's tracks share its width and its height, and what's in a
      // cell has the tracks it spans.
      if (node.kind === "grid") {
        setOwn(spaces, node.columns.id, groupSpace(w));
        setOwn(spaces, node.rows.id, groupSpace(h));
        const spanned = (
          tracks: readonly ChildNode[],
          from: number,
          span: number,
        ) =>
          tracks
            .slice(from, from + span)
            .reduce((sum, track) => sum + (nodes.get(track.id)?.drawn ?? 0), 0);
        for (const cell of node.cells) {
          if (!cell.content) continue;
          visit(
            cell.content,
            spanned(node.columns.children, cell.column, cell.columnSpan),
            spanned(node.rows.children, cell.row, cell.rowSpan),
          );
        }
        return;
      }
      if (node.kind !== "group") return;
      setOwn(spaces, node.id, groupSpace(node.axis === "horizontal" ? w : h));
      for (const child of node.children) {
        const size = nodes.get(child.id)?.drawn;
        if (size == null) continue;
        visit(
          child,
          node.axis === "horizontal" ? size : w,
          node.axis === "horizontal" ? h : size,
        );
      }
    };
    visit(next.config.root, width, height);
    const measured = measure(next, spaces);
    if (measured === next) break;
    next = holding
      ? {
          ...measured,
          heldDown: next.heldDown,
          protectedChild: next.protectedChild,
        }
      : measured;
  }
  return next;
}

interface Row {
  readonly id: string;
  readonly size: number;
  readonly min: number;
  readonly max: number;
  readonly fill: boolean;
  readonly last: boolean;
  readonly keepSize: boolean;
  readonly locked: boolean;
}

/** Each group's children as shown: sizes and their stops' limits. */
function rowsOf(state: LayoutState): Map<string, Row[]> {
  const nodes = getLayoutRendering(state).nodes;
  const groups = new Map<string, Row[]>();
  for (const group of indexTree(state.config.root).groups) {
    groups.set(
      group.id,
      group.children.map((child) => {
        const node = nodes.get(child.id);
        const stop = node?.track && findStop(node.track, node.stop ?? "");
        ensure(
          !!node && node.size !== null && !!stop,
          () => `"${child.id}" has no size or stop`,
        );
        return {
          id: child.id,
          size: node.size,
          min: stop.min,
          max: stop.max,
          fill: child.fill !== null,
          last: child.fill === "last",
          keepSize: child.keepSize,
          locked: child.locked,
        };
      }),
    );
  }
  return groups;
}

const totalOf = (rows: readonly Row[]) =>
  rows.reduce((sum, row) => sum + row.size, 0);

const describeRows = (rows: readonly Row[]) =>
  rows.map((row) => `${row.id} ${row.size.toFixed(1)}`).join(" | ");

/** Every child's size (a grid's tracks too), for comparing whole layouts. */
function sizesOf(state: LayoutState): string {
  return [...getLayoutRendering(state).nodes.values()]
    .map((node) => `${node.id} ${(node.size ?? NaN).toFixed(1)}`)
    .join(" | ");
}

const sameSizes = (a: string, b: string) => {
  const parse = (text: string) =>
    text.split(" | ").map((part) => part.split(" "));
  const left = parse(a);
  const right = parse(b);
  return (
    left.length === right.length &&
    left.every(
      ([id, size], index) =>
        id === right[index][0] &&
        Math.abs(Number(size) - Number(right[index][1])) <= NEAR,
    )
  );
};

/** Whether a group's children can fill its space, given their stops. */
function fillable(rows: readonly Row[], available: number) {
  const least = rows.reduce((sum, row) => sum + row.min, 0);
  const most = rows.reduce((sum, row) => sum + row.max, 0);
  return least <= available + NEAR && most >= available - NEAR;
}

/** Fills of a kind share what they hold equally, at every moment. */
function checkFillsShare(
  rows: readonly { id: string; size: number; fill: boolean; last: boolean }[],
  describe: () => string,
) {
  for (const last of [false, true]) {
    const sizes = rows
      .filter((row) => row.fill && row.last === last)
      .map((row) => row.size);
    ensure(
      sizes.every((size) => Math.abs(size - sizes[0]) <= NEAR),
      () =>
        `${last ? '"last"' : '"first"'} fills don't share equally: ${describe()}`,
    );
  }
}

/**
 * The rules for every group (a grid's tracks too): its children add up to
 * `expected(group)` (its space if they can fill it), each within its stop
 * (`slack` past it while a drag stretches).
 */
function checkTree(
  state: LayoutState,
  slack: number,
  expected: (group: string, rows: readonly Row[], available: number) => number,
) {
  for (const [group, rows] of rowsOf(state)) {
    const available = own(state.spaces, group)?.available;
    ensure(available !== undefined, () => `group "${group}" isn't measured`);
    const total = expected(group, rows, available!);
    checkFillsShare(rows, () => describeRows(rows));
    ensure(
      Math.abs(totalOf(rows) - total) <= NEAR,
      () =>
        `"${group}" adds up to ${totalOf(rows).toFixed(2)}, not ${total.toFixed(2)}: ${describeRows(rows)}`,
    );
    for (const row of rows) {
      ensure(
        Number.isFinite(row.size) &&
          row.size >= -NEAR &&
          row.size >= row.min - slack - NEAR &&
          row.size <= row.max + slack + NEAR,
        () =>
          `"${row.id}" is ${row.size.toFixed(2)}, outside ${row.min}-${row.max} (slack ${slack}): ${describeRows(rows)}`,
      );
    }
  }
}

/** The committed rules, on top of `checkTree`. */
function checkCommitted(state: LayoutState) {
  checkTree(state, 0, (_, rows, available) =>
    fillable(rows, available) ? available : totalOf(rows),
  );
  const nodes = getLayoutRendering(state).nodes;
  for (const [group, rows] of rowsOf(state)) {
    if (rows.some((row) => row.last && row.size > NEAR)) {
      // (Children keeping their size, or locked, are passed over.)
      for (const row of rows.filter(
        (other) => !other.fill && !other.keepSize && !other.locked,
      )) {
        ensure(
          row.size >= row.max - NEAR,
          () =>
            `in "${group}", a "last" fill holds space while "${row.id}" could grow: ${describeRows(rows)}`,
        );
      }
    }
    const couldTake = rows.some((row) =>
      nodes.get(row.id)?.track?.some((stop) => stop.max === Infinity),
    );
    if (couldTake) {
      ensure(
        rows.some((row) => row.max === Infinity),
        () => `no child of "${group}" takes the space: ${describeRows(rows)}`,
      );
    }
  }
}

const unstretched = (state: LayoutState): LayoutState => ({
  ...state,
  config: { ...state.config, elastic: null },
});

/**
 * Checks that a change gave every group the space the browser will then
 * measure it at (see `passDownChanges` and `respace`): animating from the
 * spaces as they were would aim nested groups at the wrong sizes, and
 * refuse what fits.
 */
function checkPredicted(state: LayoutState, width: number, height: number) {
  const measured = remeasure(state, width, height);
  for (const [group, space] of Object.entries(measured.spaces)) {
    const predicted = own(state.spaces, group);
    if (!predicted) continue;
    ensure(
      Math.abs(predicted.available - space.available) <= NEAR,
      () =>
        `${group} was given ${predicted.available}, and is measured at ${space.available}`,
    );
  }
}

/**
 * Checks that an arrow took no neighbour of the separator to another stop,
 * with `keyboard.jump` off. (On, one goes to its stop's edge first, but
 * beside a `"last"` fill, collapsing is the only move there is.)
 */
function checkArrow(
  before: LayoutState,
  after: LayoutState,
  pair: SeparatorPair,
) {
  const was = getLayoutView(before).children;
  const now = getLayoutView(after).children;
  for (const id of [pair.before, pair.after]) {
    const from = own(was, id);
    const to = own(now, id);
    if (!from || !to || from.stop === to.stop || from.stop === null) continue;
    ensure(
      false,
      () =>
        `with jump off, an arrow took ${id} from ${from.size} in "${from.stop}" to "${to.stop}"`,
    );
  }
}

/** Every separator, as the pair either side of it, with its group's axis. */
function separatorsOf(state: LayoutState) {
  return indexTree(state.config.root).groups.flatMap((group) =>
    group.children.slice(1).map((child, index) => ({
      pair: { before: group.children[index].id, after: child.id },
      axis: group.axis,
    })),
  );
}

describe("layout trees under random use", () => {
  // Long runs (FUZZ_RUNS) take longer than a test's usual 5 seconds.
  it(
    "keep their rules through random drags, junctions, stops, keys and resizes",
    { timeout: 0 },
    () => {
      forEachCase((random, log) => {
        const generated = generate(random);
        let { width, height } = generated;
        log(`options: ${JSON.stringify(generated.options)}`);
        log(`window: ${width}x${height}`);
        let state = remeasure(
          createLayoutState(parseLayoutOptions(generated.options)),
          width,
          height,
        );
        checkCommitted(state);
        const elastic = state.config.elastic !== null;
        const separators = separatorsOf(state);
        // Right to left: every row lays its children out from the right.
        const rtl = random.chance(0.3);
        if (rtl) log("right to left");

        for (let step = 0; step < random.int(4, 10); step++) {
          const action = random.pick([
            "drag",
            "drag",
            "junction",
            "stop",
            "key",
            "resize",
          ] as const);

          if (action === "drag" || action === "junction") {
            // A junction drags a separator of each axis at once.
            const first = random.pick(separators);
            const across = separators.filter(
              (other) => other.axis !== first.axis,
            );
            const pairs: SeparatorPair[] =
              action === "junction" && across.length > 0
                ? [first.pair, random.pick(across).pair]
                : [first.pair];
            const startTotals = new Map(
              [...rowsOf(state)].map(([group, rows]) => [group, totalOf(rows)]),
            );
            const startSpaces = new Map(
              Object.entries(state.spaces).map(([group, space]) => [
                group,
                space.available,
              ]),
            );
            const allFillable = [...rowsOf(state)].every(([group, rows]) =>
              fillable(rows, own(state.spaces, group)!.available),
            );
            const before = sizesOf(state);
            const path = Array.from({ length: random.int(1, 6) }, () => [
              random.int(-width, width),
              random.int(-height, height),
            ]);
            log(
              `drag ${pairs.map((pair) => `${pair.before}|${pair.after}`).join(" + ")} along ${path.map((point) => point.join(",")).join("  ")}`,
            );
            let dragging = startDrag(state, pairs, () => rtl);
            // Right to left, a drag is its mirror image left to right.
            let mirror = rtl ? startDrag(state, pairs) : null;
            for (const [dx, dy] of path) {
              // The browser measures as nested groups change size.
              dragging = remeasure(moveDrag(dragging, dx, dy), width, height);
              log(`  at ${dx},${dy}: ${sizesOf(dragging)}`);
              if (mirror) {
                mirror = remeasure(moveDrag(mirror, -dx, dy), width, height);
                ensure(
                  sameSizes(sizesOf(dragging), sizesOf(mirror)),
                  () =>
                    `right to left at ${dx},${dy}: ${sizesOf(dragging)}; mirrored left to right: ${sizesOf(mirror!)}`,
                );
              }
              // A drag only moves space within a group; one whose own
              // space changed (a parent moved) fills that, if it can.
              checkTree(
                dragging,
                elastic ? DISTANCE : 0,
                (group, rows, available) =>
                  startSpaces.get(group) === available
                    ? startTotals.get(group)!
                    : fillable(rows, available)
                      ? available
                      : totalOf(rows),
              );
            }
            const ending = random.pick(["release", "cancel", "back"] as const);
            log(`  then ${ending}`);
            if (ending === "back") {
              const back = remeasure(moveDrag(dragging, 0, 0), width, height);
              ensure(
                sameSizes(sizesOf(back), before),
                () => `back at the start, ${sizesOf(back)}, not ${before}`,
              );
              dragging = back;
            }
            if (ending === "cancel") {
              state = remeasure(cancelDrag(dragging), width, height);
              ensure(
                sameSizes(sizesOf(state), before),
                () => `Escape left ${sizesOf(state)}, not ${before}`,
              );
            } else {
              const kept = sizesOf(
                remeasure(unstretched(dragging), width, height, true),
              );
              state = remeasure(endDrag(dragging), width, height);
              // The release keeps what the drag showed, less the stretch
              // (where every group could fill its space to begin with).
              ensure(
                !allFillable || sameSizes(sizesOf(state), kept),
                () => `released ${sizesOf(state)}, showed ${kept}`,
              );
            }
          } else if (action === "stop") {
            const elements = indexTree(state.config.root).elements.filter(
              (element) =>
                element.fill === null &&
                element.stops.some((stop) => stop.name !== ""),
            );
            if (elements.length === 0) continue;
            const element = random.pick(elements);
            const stop = random.pick(element.stops).name;
            const toggle = random.chance(0.5);
            log(`${toggle ? "toggle" : "setStop"} ${element.id} ${stop}`);
            const changed = setChildStop(state, element.id, stop, toggle);
            if (changed !== state) checkPredicted(changed, width, height);
            state = remeasure(changed, width, height);
          } else if (action === "key") {
            const { pair } = random.pick(separators);
            const intent = random.pick([
              { kind: "move", delta: random.pick([-50, -10, 10, 50]) },
              { kind: "min" },
              { kind: "max" },
              { kind: "toggle" },
            ] as const);
            log(`key ${pair.before}|${pair.after} ${JSON.stringify(intent)}`);
            const pressed = applyKeyboard(
              state,
              pair.before,
              pair.after,
              intent,
            );
            if (pressed !== state) checkPredicted(pressed, width, height);
            if (
              intent.kind === "move" &&
              state.config.keyboard?.jump === false
            ) {
              checkArrow(state, pressed, pair);
            }
            state = remeasure(pressed, width, height);
          } else {
            width = random.int(600, 1600);
            height = random.int(400, 1000);
            log(`resize to ${width}x${height}`);
            state = remeasure(state, width, height);
          }
          log(`  -> ${sizesOf(state)}`);
          checkCommitted(state);
        }
      });
    },
  );
});
