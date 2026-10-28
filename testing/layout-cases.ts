/**
 * Random layout children for the randomized tests: elements of every kind
 * of sizing, and fills.
 */
import type { LayoutElementOptions } from "../src/layout/tree.js";
import { type Random, random as seeded } from "./fuzz.js";

type SizedElement = Extract<LayoutElementOptions, { fill?: undefined }>;

/**
 * Cases without `keepSize: "yield-first"` (`FUZZ_PLAIN=1`): the generator
 * from before it existed, drawing the same numbers, so its seeds explore
 * the layouts they always did.
 */
const PLAIN = process.env.FUZZ_PLAIN === "1";

/**
 * An element sized one of several ways (see `sizedElement`), sometimes
 * keeping its size (`keepSize`), sometimes locked against the user
 * (`locked`).
 */
export function randomElement(
  random: Random,
  id: string,
): LayoutElementOptions {
  const element = sizedElement(random, id);
  const yieldTo = yieldsOf(element);
  return {
    ...element,
    ...(yieldTo && random.chance(0.5) && { yieldTo }),
    ...(random.chance(0.2) && {
      keepSize: PLAIN || random.chance(0.5) ? true : ("yield-first" as const),
    }),
    ...(random.chance(0.15) && { locked: true }),
    ...(random.chance(0.25) && { priority: random.int(-2, 2) }),
    ...(random.chance(0.25) && { grow: random.int(0, 3) }),
  };
}

/** Steps down from an element's open range to its smaller stops, if any. */
function yieldsOf(element: SizedElement): Record<string, string> | undefined {
  const stops = element.stops;
  if (!stops || !("open" in stops)) return undefined;
  if ("strip" in stops) return { open: "strip" };
  if ("rail" in stops) return { open: "rail", rail: "hidden" };
  if ("closed" in stops) return { open: "closed" };
  return undefined;
}

/**
 * A plain range, a bounded one, a strip with an open range (random
 * elasticity and pull), a hidden-rail-open track, one that closes to 0 (so
 * separators can meet end to end), a fixed size, or one with limits in `%`
 * of its group's space (which, in a nested group, is what it needs).
 */
function sizedElement(random: Random, id: string): SizedElement {
  const kind = random.pick([
    "plain",
    "bounded",
    "strip",
    "strip",
    "railed",
    "closable",
    "fixed",
    "percent",
  ] as const);
  if (kind === "percent") {
    // In the tree fuzz, at most four in a group, so their shares stay
    // below 100%; the flat fuzz has up to six, which may not all be met
    // (the layout then overflows, as documented).
    const share = () => `${random.int(5, 24)}%` as const;
    const min = random.pick([share(), [random.int(40, 160), share()] as const]);
    return random.chance(0.5)
      ? {
          id,
          minSize: min,
          ...(random.chance(0.3) && { maxSize: `${random.int(60, 95)}%` }),
        }
      : {
          id,
          stops: { closed: 0, open: { min } },
          ...(random.chance(0.5) && {
            defaultStop: random.pick(["closed", "open"]),
          }),
        };
  }
  if (kind === "plain") {
    return {
      id,
      ...(random.chance(0.5) && { minSize: random.int(0, 200) }),
      ...(random.chance(0.4) && { defaultSize: random.int(50, 400) }),
    };
  }
  if (kind === "bounded") {
    return { id, minSize: random.int(50, 150), maxSize: random.int(200, 600) };
  }
  if (kind === "strip") {
    return {
      id,
      stops: {
        strip: {
          size: random.int(20, 60),
          elastic: random.pick([true, false, "larger", "smaller"] as const),
          ...(random.chance(0.3) && { pull: random.pick([0.5, 2, 3]) }),
        },
        open: {
          min: random.int(100, 250),
          ...(random.chance(0.3) && { max: random.int(300, 700) }),
        },
      },
      ...(random.chance(0.5) && {
        defaultStop: random.pick(["strip", "open"]),
      }),
    };
  }
  if (kind === "railed") {
    return {
      id,
      stops: {
        hidden: { size: 0, onlyByName: true },
        rail: random.int(30, 60),
        open: { min: random.int(150, 250) },
      },
    };
  }
  if (kind === "closable") {
    return {
      id,
      stops: {
        closed: { size: 0, elastic: random.chance(0.5) },
        open: { min: random.int(80, 220) },
      },
      ...(random.chance(0.5) && {
        defaultStop: random.pick(["closed", "open"]),
      }),
    };
  }
  return { id, stops: { fixed: random.int(40, 120) } };
}

/** Sometimes one or two fills, of either kind, somewhere among `children`. */
export function withFills<T>(
  random: Random,
  children: readonly (T | LayoutElementOptions)[],
  prefix: string,
): (T | LayoutElementOptions)[] {
  const result = [...children];
  const fills = random.chance(0.4) ? random.int(1, 2) : 0;
  for (let fill = 0; fill < fills; fill++) {
    result.splice(random.int(0, result.length), 0, {
      id: `${prefix}fill${fill}`,
      fill: random.pick(["first", "last"] as const),
    });
  }
  return result;
}

/**
 * Names every object has a member by (see `foundation/own`), which ids and
 * stop names can be too.
 */
const PROTOTYPE_NAMES = [
  "constructor",
  "toString",
  "__proto__",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
];

/** The stop names `randomElement` uses, each to one of `PROTOTYPE_NAMES`. */
const STOP_NAMES = ["open", "closed", "strip", "rail", "hidden", "fixed"];

/**
 * Sometimes `layout` with names every object has a member by: some of its
 * ids (not the root's), and the stop names `randomElement` uses (in `stops`, `yieldTo` and
 * `defaultStop`). Decided by a generator of its own, seeded by the layout,
 * so a case's own sequence is the same either way: only its names change,
 * which must change nothing else.
 */
export function withPrototypeNames<T>(layout: T): T {
  const json = JSON.stringify(layout);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index++) {
    hash = Math.imul(hash ^ json.charCodeAt(index), 16777619);
  }
  const random = seeded(hash);
  if (!random.chance(0.4)) return layout;

  // All but the root's (the first), which is measured by name.
  const ids = [...json.matchAll(/"id":"([^"]*)"/g)]
    .slice(1)
    .map((match) => match[1]);
  const renamed = new Map<string, string>();
  for (const name of PROTOTYPE_NAMES) {
    const unnamed = ids.filter((id) => !renamed.has(id));
    if (unnamed.length > 0 && random.chance(0.7)) {
      renamed.set(random.pick(unnamed), name);
    }
  }
  const stops = random.chance(0.5);
  const id = (value: string) => renamed.get(value) ?? value;
  const stop = (name: string) =>
    stops && STOP_NAMES.includes(name)
      ? PROTOTYPE_NAMES[STOP_NAMES.indexOf(name)]
      : name;
  const entries = (
    record: object,
    rename: (entry: [string, unknown]) => [string, unknown],
  ) => Object.fromEntries(Object.entries(record).map(rename));
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value !== "object" || value === null) return value;
    return entries(value, ([key, field]) => [
      key,
      key === "id" || key === "column" || key === "row"
        ? id(field as string)
        : key === "stops"
          ? entries(field as object, ([name, size]) => [stop(name), size])
          : key === "yieldTo"
            ? entries(field as object, ([from, to]) => [
                stop(from),
                stop(to as string),
              ])
            : key === "defaultStop"
              ? stop(field as string)
              : visit(field),
    ]);
  };
  return visit(layout) as T;
}
