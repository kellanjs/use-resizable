// The tests, run against React 18, the oldest React the library supports
// (`npm run test:react18`, which installs it: see scripts/react18.mjs).
// Every import of React goes to that copy: the library's, the tests', and
// Testing Library's, which is inlined so the aliases reach it.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config.js";

const folder = process.env.REACT18_DIR;
if (!folder) {
  throw new Error("Run the React 18 tests with `npm run test:react18`.");
}
const modules = join(folder, "node_modules");

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        // Its ESM build: the CommonJS one would `require` React 19.
        {
          find: /^@testing-library\/react$/,
          replacement: fileURLToPath(
            new URL(
              "./node_modules/@testing-library/react/dist/@testing-library/react.esm.js",
              import.meta.url,
            ),
          ),
        },
        { find: /^react$/, replacement: join(modules, "react/index.js") },
        { find: /^react\/(.*)$/, replacement: join(modules, "react/$1.js") },
        {
          find: /^react-dom$/,
          replacement: join(modules, "react-dom/index.js"),
        },
        {
          find: /^react-dom\/(.*)$/,
          replacement: join(modules, "react-dom/$1.js"),
        },
      ],
    },
    test: {
      // The README's examples and the built package are checked once, on 19.
      exclude: ["testing/readme.test.ts", "testing/package.test.tsx"],
      server: { deps: { inline: [/@testing-library[\\/]react/] } },
    },
  }),
);
