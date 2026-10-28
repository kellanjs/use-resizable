// @vitest-environment jsdom
/**
 * The built package (`dist/`), consumed through its `exports` map the way an
 * app would. `npm test` builds first; `npm run type:test` type-checks this
 * file against the emitted `.d.ts`.
 */
import {
  type UseResizableLayoutOptions,
  createLayoutController,
  isResizableSnapshot,
  useResizable,
  useResizableLayout,
} from "@kellanjs/use-resizable";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dist = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
);

const options = {
  layout: {
    id: "root",
    direction: "row",
    children: [
      { id: "left", defaultSize: 200 },
      { id: "right", minSize: 100 },
    ],
  },
} satisfies UseResizableLayoutOptions;

describe("the built package", () => {
  it("renders both hooks", () => {
    function Sidebar() {
      const sidebar = useResizable({
        anchor: "start",
        width: { defaultSize: 240 },
      });
      return <aside {...sidebar.getElementProps()} />;
    }
    function Split() {
      const split = useResizableLayout(options);
      return (
        <div {...split.getGroupProps("root")}>
          <section {...split.getElementProps("left")} />
          <div
            {...split.getSeparatorProps("left", "right")}
            aria-label="Resize"
          />
          <section {...split.getElementProps("right")} />
        </div>
      );
    }
    const { container } = render(
      <>
        <Sidebar />
        <Split />
      </>,
    );
    expect(container.querySelector("aside")).not.toBeNull();
    expect(container.querySelector('[role="separator"]')).not.toBeNull();
  });

  it("works without React, for its controllers and snapshots", () => {
    const controller = createLayoutController(options);
    expect(controller.getView().children.left?.id).toBe("left");
    expect(isResizableSnapshot(null)).toBe(false);
  });

  it("keeps the hooks' modules client-only for server components", () => {
    // Next.js and other server component frameworks read this directive
    // from the first line of each module.
    for (const file of [
      "layout/use-resizable-layout.js",
      "foundation/use-merged-refs.js",
      "foundation/use-resizable-remote.js",
    ]) {
      const source = readFileSync(path.join(dist, file), "utf8");
      expect(source.startsWith('"use client";')).toBe(true);
    }
  });
});
