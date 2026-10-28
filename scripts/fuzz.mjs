// The long fuzz: the three fuzz suites from two first seeds, with both case
// generators (the current one, and the plain one, which never gives a child
// `keepSize: "yield-first"`). Each run is 3000 cases unless FUZZ_RUNS says
// otherwise. A failure prints its seed; replay it alone with
//
//   FUZZ_SEED=<seed> FUZZ_RUNS=1 npx vitest run <suite>
//
// (adding FUZZ_PLAIN=1 if it came from the plain generator).
import { spawnSync } from "node:child_process";

const SUITES = [
  "src/layout/tree.fuzz.test.ts",
  "src/layout/layout.fuzz.test.ts",
  "src/resizable/resizable.fuzz.test.ts",
];
const SEEDS = ["1", "3001"];
const RUNS = process.env.FUZZ_RUNS ?? "3000";

let failed = false;
for (const plain of [false, true]) {
  for (const seed of SEEDS) {
    const name = `${plain ? "plain" : "current"} generator, seed ${seed}`;
    console.log(`\n--- ${name}, ${RUNS} runs`);
    const result = spawnSync("npx", ["vitest", "run", ...SUITES], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        FUZZ_SEED: seed,
        FUZZ_RUNS: RUNS,
        ...(plain ? { FUZZ_PLAIN: "1" } : {}),
      },
    });
    if (result.status !== 0) failed = true;
  }
}
process.exit(failed ? 1 : 0);
