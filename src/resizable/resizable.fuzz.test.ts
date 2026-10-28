import { describe, it } from "vitest";

import { type Random, ensure, forEachCase } from "../../testing/fuzz.js";
import type { Edge, HandleEdge } from "../foundation/handle.js";
import { findStop } from "../foundation/stops.js";
import {
  type ResizableOptions,
  type ResizableState,
  createResizableState,
  parseResizableOptions,
} from "./resizable-config.js";
import {
  applyKeyboard,
  cancelDrag,
  endDrag,
  getResizableRendering,
  measure,
  moveByKeyboard,
  moveDrag,
  setStop,
  startDrag,
} from "./resizable-model.js";

/** Within half a pixel: what a browser can't show the difference of. */
const NEAR = 0.5;
const DISTANCE = 16;

type Kind = "edge" | "both" | "ratio" | "floating";

/** A random dimension: a range, or stops around one. */
function dimension(random: Random, stops: boolean) {
  const stopElastic = () =>
    random.pick([true, false, "larger", "smaller"] as const);
  if (!stops) {
    const min = random.int(60, 250);
    return {
      minSize: min,
      ...(random.chance(0.7) && { maxSize: random.int(min + 50, 800) }),
      defaultSize: random.int(80, 500),
    };
  }
  const open = {
    min: random.int(120, 260),
    ...(random.chance(0.6) && { max: random.int(300, 700) }),
    ...(random.chance(0.2) && { elastic: stopElastic() }),
  };
  return random.chance(0.5)
    ? {
        stops: {
          hidden: { size: 0, onlyByName: true },
          rail: {
            size: random.int(32, 64),
            elastic: stopElastic(),
            ...(random.chance(0.3) && { pull: random.pick([0.5, 2, 3]) }),
          },
          open,
        },
        ...(random.chance(0.5)
          ? { defaultStop: random.pick(["hidden", "rail", "open"]) }
          : { defaultSize: random.int(20, 600) }),
      }
    : {
        stops: { closed: { size: 0, elastic: stopElastic() }, open },
        ...(random.chance(0.5)
          ? { defaultStop: random.pick(["closed", "open"]) }
          : { defaultSize: random.int(20, 600) }),
      };
}

/** A random element of one of four kinds, and its container. */
function generate(random: Random): {
  kind: Kind;
  options: ResizableOptions;
  width: number;
  height: number;
} {
  const kind = random.pick(["edge", "both", "ratio", "floating"] as const);
  const elastic = random.pick([false, true, { afterSnap: true }] as const);
  const corner = () =>
    random.pick([
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as const);
  let options: ResizableOptions;
  if (kind === "edge") {
    const anchor = random.pick(["left", "right", "top", "bottom"] as const);
    const horizontal = anchor === "left" || anchor === "right";
    options = {
      anchor,
      [horizontal ? "width" : "height"]: dimension(random, random.chance(0.7)),
      elastic,
    } as ResizableOptions;
  } else if (kind === "both") {
    options = {
      anchor: random.chance(0.8) ? corner() : "center",
      width: dimension(random, random.chance(0.4)),
      height: dimension(random, random.chance(0.4)),
      elastic,
    } as ResizableOptions;
  } else if (kind === "ratio") {
    const min = random.int(80, 200);
    options = {
      anchor: random.chance(0.8) ? corner() : "center",
      width: {
        minSize: min,
        ...(random.chance(0.6) && { maxSize: random.int(min + 100, 900) }),
        defaultSize: random.int(100, 600),
      },
      ...(random.chance(0.4) && {
        height: {
          ...(random.chance(0.5) && { minSize: random.int(40, 120) }),
          ...(random.chance(0.5) && { maxSize: random.int(300, 700) }),
        },
      }),
      aspectRatio: random.pick([0.5, 0.75, 1, 4 / 3, 16 / 9, 2]),
      cornerDrag: random.pick(["nearest", "axis"] as const),
      elastic,
    } as ResizableOptions;
  } else {
    options = {
      anchor: "none",
      // Stops sometimes: a point bigger than the room on a side can't be
      // reached by a drag from it.
      width: dimension(random, random.chance(0.3)),
      height: dimension(random, random.chance(0.3)),
      defaultPosition: { x: random.int(0, 400), y: random.int(0, 300) },
      ...(random.chance(0.6) && { confine: "container" as const }),
      elastic,
    } as ResizableOptions;
  }
  return {
    kind,
    options,
    width: random.int(600, 1600),
    height: random.int(400, 1000),
  };
}

interface Size {
  readonly size: number;
  readonly min: number;
  readonly max: number;
  readonly stop: string;
}

interface Shown {
  readonly width: Size | null;
  readonly height: Size | null;
  readonly x: number | null;
  readonly y: number | null;
}

function sizeOf(view: ReturnType<typeof getResizableRendering>["width"]) {
  if (!view) return null;
  const stop = view.track && findStop(view.track, view.stop ?? "");
  ensure(view.size !== null && !!stop, () => "a dimension has no size or stop");
  return {
    size: view.size,
    min: stop.min,
    max: stop.max,
    stop: stop.name,
  };
}

function shown(state: ResizableState): Shown {
  const view = getResizableRendering(state);
  return {
    width: sizeOf(view.width),
    height: sizeOf(view.height),
    x: view.position?.x ?? null,
    y: view.position?.y ?? null,
  };
}

const describeShown = (row: Shown) =>
  [
    row.width && `w ${row.width.size.toFixed(1)} (${row.width.stop})`,
    row.height && `h ${row.height.size.toFixed(1)} (${row.height.stop})`,
    row.x !== null && `at ${row.x.toFixed(1)},${row.y!.toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(" ");

const same = (a: Shown, b: Shown) =>
  (["width", "height"] as const).every(
    (key) =>
      (a[key] === null) === (b[key] === null) &&
      (!a[key] || Math.abs(a[key].size - b[key]!.size) <= NEAR),
  ) &&
  (a.x === null || Math.abs(a.x - b.x!) <= NEAR) &&
  (a.y === null || Math.abs(a.y - b.y!) <= NEAR);

/**
 * The rules an element keeps: each dimension within its stop (`slack` past
 * it while a drag stretches, more for a height that follows a ratio),
 * never negative; a locked ratio holds; a confined element stays inside
 * its container (unless its minimum is bigger).
 */
function checkElement(
  state: ResizableState,
  slack: number,
  container: { width: number; height: number },
) {
  const row = shown(state);
  const ratio = state.config.aspect?.ratio;
  for (const key of ["width", "height"] as const) {
    const size = row[key];
    if (!size) continue;
    const give = key === "height" && ratio ? slack / ratio + slack : slack;
    ensure(
      Number.isFinite(size.size) &&
        size.size >= -NEAR &&
        size.size >= size.min - give - NEAR &&
        size.size <= size.max + give + NEAR,
      () =>
        `${key} is ${size.size.toFixed(2)}, outside ${size.min}-${size.max} (slack ${give.toFixed(1)}): ${describeShown(row)}`,
    );
  }
  if (ratio && row.width && row.height && row.height.size > NEAR) {
    ensure(
      Math.abs(row.width.size / row.height.size - ratio) <= 0.02,
      () =>
        `the ratio is ${(row.width!.size / row.height!.size).toFixed(3)}, not ${ratio.toFixed(3)}: ${describeShown(row)}`,
    );
  }
  if (state.config.position?.confined && row.x !== null && row.y !== null) {
    const w = row.width?.size ?? 0;
    const h = row.height?.size ?? 0;
    ensure(
      (row.x >= -NEAR && row.x + w <= container.width + NEAR) ||
        w > container.width,
      () =>
        `confined, but at x ${row.x!.toFixed(1)} with width ${w.toFixed(1)} in ${container.width}`,
    );
    ensure(
      (row.y >= -NEAR && row.y + h <= container.height + NEAR) ||
        h > container.height,
      () =>
        `confined, but at y ${row.y!.toFixed(1)} with height ${h.toFixed(1)} in ${container.height}`,
    );
  }
}

const unstretched = (state: ResizableState): ResizableState => ({
  ...state,
  config: { ...state.config, elastic: null },
});

const measured = (state: ResizableState) => {
  const row = shown(state);
  return { width: row.width?.size ?? 0, height: row.height?.size ?? 0 };
};

describe("resizable elements under random use", () => {
  // Long runs (FUZZ_RUNS) take longer than a test's usual 5 seconds.
  it(
    "keep their rules through random drags, stops, keys, moves and resizes",
    { timeout: 0 },
    () => {
      forEachCase((random, log) => {
        const generated = generate(random);
        const container = {
          width: generated.width,
          height: generated.height,
        };
        log(`${generated.kind}: ${JSON.stringify(generated.options)}`);
        log(`container: ${container.width}x${container.height}`);
        let state = measure(
          createResizableState(parseResizableOptions(generated.options)),
          { ...container, rootFontSize: 16, viewport: null },
        );
        checkElement(state, 0, container);
        const elastic = state.config.elastic !== null;
        const floating = state.config.position !== null;
        const targets: (HandleEdge | "move")[] = [
          ...state.config.handles,
          ...(floating ? (["move"] as const) : []),
        ];
        const edges = state.config.handles.filter(
          (handle): handle is Edge => !handle.includes("-"),
        );
        const stopped = (["width", "height"] as const).filter((key) =>
          state.config[key]?.stops.some((stop) => stop.name !== ""),
        );

        for (let step = 0; step < random.int(4, 12); step++) {
          const action = random.pick([
            "drag",
            "drag",
            "drag",
            "stop",
            "key",
            "resize",
          ] as const);

          if (action === "drag" && targets.length > 0) {
            const target = random.pick(targets);
            const before = shown(state);
            const path = Array.from({ length: random.int(1, 8) }, () => [
              random.chance(0.3) ? random.int(-20, 20) : random.int(-700, 700),
              random.chance(0.3) ? random.int(-20, 20) : random.int(-500, 500),
            ]);
            log(
              `drag ${target} along ${path.map((point) => point.join(",")).join("  ")}`,
            );
            let dragging = startDrag(state, target, measured(state));
            for (const [dx, dy] of path) {
              dragging = moveDrag(dragging, dx, dy);
              log(`  at ${dx},${dy}: ${describeShown(shown(dragging))}`);
              checkElement(dragging, elastic ? DISTANCE : 0, container);
            }
            const ending = random.pick(["release", "cancel", "back"] as const);
            log(`  then ${ending}`);
            if (ending === "back") {
              const back = moveDrag(dragging, 0, 0);
              ensure(
                same(shown(back), before),
                () =>
                  `back at the start, ${describeShown(shown(back))}, not ${describeShown(before)}`,
              );
              dragging = back;
            }
            if (ending === "cancel") {
              state = cancelDrag(dragging);
              ensure(
                same(shown(state), before),
                () =>
                  `Escape left ${describeShown(shown(state))}, not ${describeShown(before)}`,
              );
            } else {
              const kept = shown(unstretched(dragging));
              state = endDrag(dragging);
              // The release keeps what the drag showed, less the stretch.
              ensure(
                same(shown(state), kept),
                () =>
                  `released ${describeShown(shown(state))}, showed ${describeShown(kept)}`,
              );
            }
          } else if (action === "stop" && stopped.length > 0) {
            const key = random.pick(stopped);
            const stop = random.pick(state.config[key]!.stops).name;
            const toggle = random.chance(0.5);
            log(`${toggle ? "toggle" : "setStop"} ${key} ${stop}`);
            state = setStop(state, [key], stop, toggle);
          } else if (action === "key" && (edges.length > 0 || floating)) {
            if (floating && (edges.length === 0 || random.chance(0.3))) {
              const [dx, dy] = random.pick([
                [10, 0],
                [-10, 0],
                [0, 50],
                [0, -50],
              ]);
              log(`move key ${dx},${dy}`);
              state = moveByKeyboard(state, dx, dy, measured(state));
            } else {
              const edge = random.pick(edges);
              const intent = random.pick([
                { kind: "move", delta: random.pick([-50, -10, 10, 50]) },
                { kind: "min" },
                { kind: "max" },
                { kind: "toggle" },
              ] as const);
              log(`key ${edge} ${JSON.stringify(intent)}`);
              state = applyKeyboard(state, edge, intent, measured(state));
            }
          } else if (action === "resize") {
            container.width = random.int(600, 1600);
            container.height = random.int(400, 1000);
            log(`resize to ${container.width}x${container.height}`);
            state = measure(state, {
              ...container,
              rootFontSize: 16,
              viewport: null,
            });
          }
          log(`  -> ${describeShown(shown(state))}`);
          checkElement(state, 0, container);
        }
      });
    },
  );
});
