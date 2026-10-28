// A server: no `window`, as in Node.
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useResizableLayout } from "../layout/use-resizable-layout.js";
import { useResizable } from "../resizable/use-resizable.js";

describe("rendering on the server", () => {
  it("renders both hooks without React warning about layout effects", () => {
    function Sidebar() {
      const sidebar = useResizable({
        anchor: "start",
        width: { defaultSize: 240 },
      });
      return (
        <aside {...sidebar.getElementProps()}>
          <div {...sidebar.getHandleProps("end")} aria-label="Resize" />
        </aside>
      );
    }
    function Split() {
      const split = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "left", defaultSize: 200 },
            { id: "right", minSize: 100 },
          ],
        },
      });
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToString(
        <>
          <Sidebar />
          <Split />
        </>,
      );
      expect(html).toContain('role="separator"');
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
