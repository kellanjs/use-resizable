import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests that render say so (`// @vitest-environment jsdom`).
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "testing/**/*.test.{ts,tsx}"],
    setupFiles: ["./testing/setup.ts"],
  },
});
