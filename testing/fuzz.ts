/**
 * Randomized ("fuzz") testing: many generated cases instead of a few written
 * ones, each checked against rules that must always hold. Cases come from a
 * seeded generator, so a failure names the seed that reproduces it.
 *
 * `FUZZ_RUNS` sets how many cases each suite runs (default 200) and
 * `FUZZ_SEED` the first seed (default 1, so the suites are deterministic);
 * raise the one and vary the other to explore. `FUZZ_PLAIN=1` makes layout
 * cases without `keepSize: "yield-first"` (see `layout-cases.ts`).
 * `npm run fuzz` runs the long fuzz.
 */

export interface Random {
  /** A number in [0, 1). */
  next(): number;
  /** An integer in [low, high]. */
  int(low: number, high: number): number;
  pick<T>(values: readonly T[]): T;
  chance(probability: number): boolean;
}

/** A seeded generator (mulberry32): the same seed, the same sequence. */
export function random(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    pick: (values) => values[Math.floor(next() * values.length)],
    chance: (probability) => next() < probability,
  };
}

const RUNS = Number(process.env.FUZZ_RUNS ?? 200);
const SEED = Number(process.env.FUZZ_SEED ?? 1);

/**
 * Runs `check` on `RUNS` cases, each with its own seeded generator and a
 * log for describing what it did. A failure is rethrown with the seed and
 * the log, so it can be replayed (`FUZZ_SEED=<seed> FUZZ_RUNS=1`).
 */
export function forEachCase(
  check: (random: Random, log: (line: string) => void) => void,
): void {
  for (let run = 0; run < RUNS; run++) {
    const seed = SEED + run;
    const lines: string[] = [];
    try {
      check(random(seed), (line) => lines.push(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Seed ${seed} failed: ${message}\n\nWhat it did:\n${lines.join("\n")}`,
        { cause: error },
      );
    }
  }
}

/** Fails with `message` unless `condition` holds. */
export function ensure(
  condition: boolean,
  message: () => string,
): asserts condition {
  if (!condition) throw new Error(message());
}
