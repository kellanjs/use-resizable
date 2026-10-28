import { describe, it } from "vitest";

import { type Random, ensure, forEachCase } from "../../testing/fuzz.js";
import {
  randomElement,
  withFills,
  withPrototypeNames,
} from "../../testing/layout-cases.js";
import { groupSpace } from "../../testing/layout.js";
import { findStop } from "../foundation/stops.js";
import {
  type LayoutOptions,
  type LayoutState,
  createLayoutState,
  parseLayoutOptions,
} from "./layout-config.js";
import {
  allowsStop,
  applyKeyboard,
  cancelDrag,
  endDrag,
  measure,
  moveDrag,
  setChildStop,
  startDrag,
} from "./layout-model.js";
import { getLayoutRendering } from "./layout-rendering.js";
import { separatorMoves } from "./separators.js";
import type { GroupNode } from "./tree.js";

/** Within half a pixel: what a browser can't show the difference of. */
const NEAR = 0.5;

/** The root group's measurement. */
const space = (available: number) => ({ root: groupSpace(available) });

/** A random row of children, some with stops, maybe fills. */
function generate(random: Random): {
  options: LayoutOptions;
  available: number;
} {
  const elements = Array.from({ length: random.int(2, 6) }, (_, index) =>
    randomElement(random, `c${index}`),
  );
  return {
    options: {
      layout: withPrototypeNames({
        id: "root",
        direction: "row" as const,
        children: withFills(random, elements, ""),
        refuseOverflow: random.chance(0.3),
      }),
      elastic: random.pick([false, true, { afterSnap: true }] as const),
      cascade: random.chance(0.8),
    },
    available: random.int(500, 1600),
  };
}

interface Shown {
  readonly id: string;
  readonly size: number;
  readonly min: number;
  readonly max: number;
  readonly fill: boolean;
  readonly last: boolean;
  readonly keepSize: boolean;
  readonly locked: boolean;
}

/** Each child as shown: its size and its stop's limits. */
function shown(state: LayoutState): Shown[] {
  const nodes = getLayoutRendering(state).nodes;
  return (state.config.root as GroupNode).children.map((child) => {
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
  });
}

const sizesOf = (rows: readonly Shown[]) =>
  rows.map((row) => `${row.id} ${row.size.toFixed(1)}`).join(" | ");

/** The same sizes, to arithmetic's noise (not as printed, rounded). */
const sameRows = (a: readonly Shown[], b: readonly Shown[]) =>
  a.length === b.length &&
  a.every(
    (row, index) =>
      row.id === b[index].id && Math.abs(row.size - b[index].size) < 1e-6,
  );

const totalOf = (rows: readonly Shown[]) =>
  rows.reduce((sum, row) => sum + row.size, 0);

/** Who's stepped down to fit, and from where (see `yieldTo`). */
const steppedDown = (of: LayoutState) =>
  [...getLayoutRendering(of).nodes.values()]
    .map((node) => `${node.id}:${node.yieldedFrom}`)
    .join();

/** The user can't resize a locked child: its size is what it was. */
function checkLocked(
  rows: readonly Shown[],
  from: readonly Shown[],
  what: string,
) {
  rows.forEach((row, position) => {
    if (!row.locked) return;
    ensure(
      Math.abs(row.size - from[position].size) <= NEAR,
      () =>
        `${what} resized locked "${row.id}": ${sizesOf(from)} to ${sizesOf(rows)}`,
    );
  });
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
 * The rules every layout keeps: its children add up to `total` (the space,
 * once committed; mid-drag, whatever it added up to when the drag began,
 * since a drag only moves space between children), none is negative, and
 * each is within its stop (`slack` past it while a drag stretches).
 */
function checkLayout(state: LayoutState, total: number, slack: number) {
  const rows = shown(state);
  checkFillsShare(rows, () => sizesOf(rows));
  ensure(
    Math.abs(totalOf(rows) - total) <= NEAR,
    () =>
      `sizes add up to ${totalOf(rows).toFixed(2)}, not ${total}: ${sizesOf(rows)}`,
  );
  for (const row of rows) {
    ensure(
      Number.isFinite(row.size) && row.size >= -NEAR,
      () => `"${row.id}" is ${row.size}`,
    );
    ensure(
      row.size >= row.min - slack - NEAR && row.size <= row.max + slack + NEAR,
      () =>
        `"${row.id}" is ${row.size.toFixed(2)}, outside ${row.min}–${row.max} (slack ${slack}): ${sizesOf(rows)}`,
    );
  }
}

/**
 * The rules for a committed layout (no drag), on top of `checkLayout`: it
 * fills its space, unless the minimums don't fit or every child has a
 * maximum and none fills (the known gaps, step 12's space policies).
 */
function checkCommitted(state: LayoutState, available: number) {
  const rows = shown(state);
  const unfillable =
    getLayoutRendering(state).overflowing ||
    rows.reduce((sum, row) => sum + row.max, 0) < available - NEAR;
  checkLayout(state, unfillable ? totalOf(rows) : available, 0);
  // A "last" fill holds space only once nothing else can take it (but
  // children keeping their size, or locked, which it takes space before).
  if (rows.some((row) => row.last && row.size > NEAR)) {
    for (const row of rows.filter(
      (other) => !other.fill && !other.keepSize && !other.locked,
    )) {
      ensure(
        row.size >= row.max - NEAR,
        () =>
          `a "last" fill holds space while "${row.id}" could grow: ${sizesOf(rows)}`,
      );
    }
  }
  // Some child takes the space, if any could.
  const nodes = getLayoutRendering(state).nodes;
  const couldTake = (state.config.root as GroupNode).children.some((child) =>
    nodes.get(child.id)?.track?.some((stop) => stop.max === Infinity),
  );
  if (couldTake) {
    ensure(
      rows.some((row) => row.max === Infinity),
      () => `no child takes the space: ${sizesOf(rows)}`,
    );
  }
}

/** The same state with the elastic stretch off: what a release keeps. */
const unstretched = (state: LayoutState): LayoutState => ({
  ...state,
  config: { ...state.config, elastic: null },
});

const DISTANCE = 16;

describe("layouts under random use", () => {
  // Long runs (FUZZ_RUNS) take longer than a test's usual 5 seconds.
  it(
    "keep their rules through random drags, stops, keys and resizes",
    { timeout: 0 },
    () => {
      forEachCase((random, log) => {
        const { options, available: initial } = generate(random);
        let available = initial;
        log(`options: ${JSON.stringify(options)}`);
        log(`space: ${available}`);
        let state = measure(
          createLayoutState(parseLayoutOptions(options)),
          space(available),
        );
        checkCommitted(state, available);
        const ids = (state.config.root as GroupNode).children.map(
          (child) => child.id,
        );
        const elastic = state.config.elastic !== null;

        for (let step = 0; step < random.int(4, 12); step++) {
          const action = random.pick([
            "drag",
            "drag",
            "drag",
            "stop",
            "key",
            "resize",
          ] as const);

          if (action === "drag") {
            const index = random.int(0, ids.length - 2);
            const pair = { before: ids[index], after: ids[index + 1] };
            const start = startDrag(state, [pair]);
            let startRows = shown(state);
            let before = sizesOf(startRows);
            let total = totalOf(startRows);
            let resized = false;
            const pinned = !separatorMoves(state, pair.before, pair.after);
            const path = Array.from({ length: random.int(1, 8) }, () =>
              random.chance(0.3)
                ? random.int(-20, 20)
                : random.int(-available, available),
            );
            log(`drag ${pair.before}|${pair.after} along ${path.join(", ")}`);
            let dragging = start;
            for (const dx of path) {
              if (random.chance(0.1)) {
                // The window resizes under the drag: it carries on from the
                // layout fitted to the new space, which fills it if it can.
                available = random.int(500, 1600);
                dragging = measure(dragging, space(available));
                log(`  resize to ${available} mid-drag`);
                resized = true;
                startRows = shown(unstretched(moveDrag(dragging, 0, 0)));
                before = sizesOf(startRows);
                const fillable =
                  !getLayoutRendering(dragging).overflowing &&
                  startRows.reduce((sum, row) => sum + row.max, 0) >=
                    available - NEAR;
                total = fillable ? available : totalOf(startRows);
              }
              dragging = moveDrag(dragging, dx, 0);
              log(`  at ${dx}: ${sizesOf(shown(dragging))}`);
              checkLayout(dragging, total, elastic ? DISTANCE : 0);
              const plain = shown(unstretched(dragging));
              const stretched = shown(dragging);
              if (!resized)
                checkLocked(stretched, startRows, `a drag at ${dx}`);
              // A stretch moves only the two children beside the separator
              // (a fill with its partners, which share what it holds), and
              // only so far.
              const neighbours = stretched.filter(
                (row) => row.id === pair.before || row.id === pair.after,
              );
              stretched.forEach((row, position) => {
                const difference = Math.abs(row.size - plain[position].size);
                const beside =
                  neighbours.includes(row) ||
                  (row.fill &&
                    neighbours.some(
                      (neighbour) =>
                        neighbour.fill && neighbour.last === row.last,
                    ));
                ensure(
                  difference <= (beside ? DISTANCE + NEAR : NEAR),
                  () =>
                    `the stretch moved "${row.id}" by ${difference.toFixed(2)} at ${dx}: ${sizesOf(stretched)} (unstretched ${sizesOf(plain)})`,
                );
              });
              // A separator that can't move changes nothing.
              if (pinned && !resized) {
                ensure(
                  plain.every(
                    (row, position) =>
                      Math.abs(row.size - startRows[position].size) <= NEAR,
                  ),
                  () =>
                    `a pinned separator changed ${before} to ${sizesOf(plain)}`,
                );
              }
            }
            const ending = random.pick(["release", "cancel", "back"] as const);
            log(`  then ${ending}`);
            if (ending === "back") {
              // Back where it started: the sizes it started with.
              const back = moveDrag(dragging, 0, 0);
              ensure(
                sizesOf(shown(back)) === before,
                () =>
                  `back at the start, ${sizesOf(shown(back))}, not ${before}`,
              );
              dragging = back;
            }
            if (ending === "cancel") {
              state = cancelDrag(dragging);
              ensure(
                resized || sizesOf(shown(state)) === before,
                () => `Escape left ${sizesOf(shown(state))}, not ${before}`,
              );
            } else {
              const kept = shown(unstretched(dragging));
              const wasStepped = steppedDown(unstretched(dragging));
              state = endDrag(dragging);
              // The release keeps what the drag showed, less the stretch.
              // (Not where the layout didn't fill its space to begin with:
              // a committed layout is fitted to it, a drag isn't. Step 12's
              // space policies. Nor where the release lets a child step
              // back up, or makes one step down: a drag doesn't, as it
              // goes, so the release does.)
              ensure(
                Math.abs(total - available) > NEAR ||
                  steppedDown(state) !== wasStepped ||
                  sameRows(shown(state), kept),
                () =>
                  `released ${sizesOf(shown(state))}, showed ${sizesOf(kept)}`,
              );
            }
          } else if (action === "stop") {
            const child = random.pick(
              (state.config.root as GroupNode).children,
            );
            const names = child.stops
              .map((stop) => stop.name)
              .filter((name) => !name.startsWith("\u0000"));
            if (child.fill || names.length === 0) continue;
            const stop = random.pick(names);
            const toggle = random.chance(0.5);
            log(`${toggle ? "toggle" : "setStop"} ${child.id} ${stop}`);
            const before = state;
            const allowed = allowsStop(state, child.id, stop, toggle);
            state = setChildStop(state, child.id, stop, toggle);
            // canSetStop says what the call does.
            ensure(
              allowed === (state !== before),
              () => `canSetStop said ${allowed}, but the call did the opposite`,
            );
            // A group that refuses overflow doesn't get further past its space.
            const shortfall = (of: LayoutState) =>
              getLayoutRendering(of).shortfalls.get("root") ?? 0;
            ensure(
              !(state.config.root as GroupNode).refuseOverflow ||
                !!before.drag ||
                shortfall(state) <= shortfall(before) + NEAR,
              () =>
                `overflowed further, refusing to: ${shortfall(before).toFixed(1)} to ${shortfall(state).toFixed(1)}`,
            );
          } else if (action === "key") {
            const index = random.int(0, ids.length - 2);
            const intent = random.pick([
              { kind: "move", delta: random.pick([-50, -10, 10, 50]) },
              { kind: "min" },
              { kind: "max" },
              { kind: "toggle" },
            ] as const);
            log(
              `key ${ids[index]}|${ids[index + 1]} ${JSON.stringify(intent)}`,
            );
            const before = shown(state);
            const wasStepped = steppedDown(state);
            state = applyKeyboard(state, ids[index], ids[index + 1], intent);
            // A key doesn't resize a locked child, but the room it frees or
            // takes can let one step back up, or make it step down.
            if (steppedDown(state) === wasStepped) {
              checkLocked(shown(state), before, "a key");
            }
          } else {
            available = random.int(500, 1600);
            log(`resize to ${available}`);
            state = measure(state, space(available));
          }
          log(`  -> ${sizesOf(shown(state))}`);
          checkCommitted(state, available);
        }
      });
    },
  );
});
