// The tests against React 18, the oldest React the library supports. React
// 18 can't be a dependency beside 19 (react-dom@18 wants react@18 as its
// peer), so it's installed on first use into a folder of its own inside
// node_modules, and vitest.react18.config.ts points every import of React
// there.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = "18.3.1";
const folder = fileURLToPath(
  new URL("../node_modules/.react18/", import.meta.url),
);
const shell = process.platform === "win32";

const installed = (name) =>
  existsSync(`${folder}node_modules/${name}/package.json`);
if (!installed("react") || !installed("react-dom")) {
  console.log(`Installing React ${VERSION} for the React 18 tests…`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    `${folder}package.json`,
    JSON.stringify({
      private: true,
      dependencies: { react: VERSION, "react-dom": VERSION },
    }),
  );
  const install = spawnSync(
    "npm",
    ["install", "--no-package-lock", "--no-audit", "--no-fund"],
    { cwd: folder, stdio: "inherit", shell },
  );
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const test = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.react18.config.ts"],
  { stdio: "inherit", shell, env: { ...process.env, REACT18_DIR: folder } },
);
process.exit(test.status ?? 1);
