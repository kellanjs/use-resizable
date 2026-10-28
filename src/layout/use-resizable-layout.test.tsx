// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import {
  Fragment,
  type ReactNode,
  StrictMode,
  act,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  installAnimationFrames,
  installPointerCapture,
  installResizeObserver,
  installViewport,
  keyDown,
  pointer,
} from "../../testing/dom.js";
import { memoryStorage } from "../../testing/storage.js";
import { holdsContent } from "../foundation/held-content.js";
import { resetWarnings } from "../foundation/warn.js";
import {
  type LayoutControllerWithState,
  createLayoutController,
} from "./layout-controller.js";
import type { ResizableLayoutChild } from "./layout-view.js";
import type {
  LayoutElementOptions,
  LayoutGroupOptions,
  SeparatorPair,
} from "./tree.js";
import {
  type ResizableLayout,
  type ResizableLayoutOf,
  type UseResizableLayoutOptions,
  createLayoutRemote,
  useResizableLayout,
} from "./use-resizable-layout.js";

let frames: ReturnType<typeof installAnimationFrames>;
let observer: ReturnType<typeof installResizeObserver>;
let restoreCapture: () => void;

beforeEach(() => {
  frames = installAnimationFrames();
  observer = installResizeObserver();
  restoreCapture = installPointerCapture();
});

afterEach(() => {
  frames.restore();
  observer.restore();
  restoreCapture();
});

const files: LayoutElementOptions = {
  id: "files",
  defaultSize: 240,
  stops: { closed: 0, open: { min: 180 } },
};
const editor: LayoutElementOptions = { id: "editor", minSize: 320 };
const preview: LayoutElementOptions = {
  id: "preview",
  defaultSize: "30%",
  minSize: 200,
};

const defaults: UseResizableLayoutOptions & { layout: LayoutGroupOptions } = {
  idPrefix: "g",
  layout: { id: "root", direction: "row", children: [files, editor, preview] },
  elastic: false,
};

/** The defaults' layout with other children. */
const row = (...children: LayoutElementOptions[]) => ({
  id: "root",
  direction: "row" as const,
  children,
});

let latest: ResizableLayout;

function Group({
  keepSteppedDown = false,
  ...options
}: Partial<UseResizableLayoutOptions> & { keepSteppedDown?: boolean }) {
  const group = useResizableLayout({ ...defaults, ...options });
  useLayoutEffect(() => {
    latest = group;
  });
  // The README's recipe: what steps down to fit stays there.
  const { elements, setStop } = group;
  useEffect(() => {
    if (!keepSteppedDown) return;
    for (const element of elements) {
      if (element.yieldedFrom && element.stop) {
        setStop(element.id, element.stop);
      }
    }
  }, [keepSteppedDown, elements, setStop]);
  return (
    <div data-testid="group" {...group.getGroupProps("root")}>
      {group.elements.map((element, index) => {
        const previous = group.elements[index - 1];
        return (
          <Fragment key={element.id}>
            {previous && (
              <div
                data-testid={`separator-${previous.id}-${element.id}`}
                {...group.getSeparatorProps(previous.id, element.id)}
                aria-label={`Resize ${element.id}`}
              />
            )}
            <div
              data-testid={element.id}
              {...group.getElementProps(element.id)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

/** Reports each open element's size, as the browser's layout would. */
async function report(sizes: Record<string, number>) {
  await act(async () => {
    for (const [id, width] of Object.entries(sizes)) {
      observer.resize(screen.getByTestId(id), { width, height: 500 });
    }
  });
}

async function setup(options: Partial<UseResizableLayoutOptions> = {}) {
  const result = render(<Group {...options} />);
  await report({ files: 400, editor: 400, preview: 400 });
  return result;
}

const flex = (id: string) => screen.getByTestId(id).style.flex;
const separator = (before: string, after: string) =>
  screen.getByTestId(`separator-${before}-${after}`);

function dragSeparator(
  before: string,
  after: string,
  dx: number,
  { release = true } = {},
) {
  act(() => {
    pointer(separator(before, after), "pointerdown", { x: 500 });
    pointer(window, "pointermove", { x: 500 + dx });
    frames.flushFrame();
  });
  if (release) act(() => void pointer(window, "pointerup", { x: 500 + dx }));
}

describe("useResizableLayout", () => {
  it("approximates the layout with flexbox until the elements are measured", () => {
    render(<Group />);
    expect(flex("files")).toBe("0 1 240px");
    expect(flex("editor")).toBe("1 1 0px");
    expect(latest.elements[0].size).toBeNull();
  });

  it("lays elements out from the measured space", async () => {
    await setup();
    expect(
      latest.elements.map((element) => [element.id, element.size]),
    ).toEqual([
      ["files", 240],
      ["editor", 600],
      ["preview", 360],
    ]);
    expect(flex("editor")).toBe("600 1 0px");
    expect(screen.getByTestId("group").style.display).toBe("flex");
  });

  it("waits until every element has been measured", async () => {
    render(<Group />);
    await act(async () =>
      observer.resize(screen.getByTestId("files"), { width: 400, height: 500 }),
    );
    expect(latest.elements[0].size).toBeNull();
  });

  it("sets no cursors with cursor: false", async () => {
    await setup({ cursor: false });
    expect(separator("files", "editor").style.cursor).toBe("");
    dragSeparator("files", "editor", 60, { release: false });
    expect(latest.getChild("files")?.size).toBe(300);
    const page = document.head.querySelector("style")?.textContent;
    expect(page).toContain("user-select: none");
    expect(page).not.toContain("cursor");
    act(() => void pointer(window, "pointerup", { x: 560 }));
  });

  it("resizes by dragging a separator and reports only the committed layout", async () => {
    const onChange = vi.fn();
    await setup({ onChange });

    dragSeparator("files", "editor", 60, { release: false });
    expect(flex("files")).toBe("300 1 0px");
    expect(separator("files", "editor").dataset.dragging).toBe("");
    expect(screen.getByTestId("group").dataset.dragging).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    act(() => void pointer(window, "pointerup", { x: 560 }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].children.files).toEqual({
      stop: "open",
      sizes: { open: 300 },
      lastRange: "open",
    });
    expect(onChange.mock.calls[0][1]).toEqual({ cause: "drag" });
  });

  it("tells onChange what caused each change", async () => {
    const onChange = vi.fn();
    const { storage } = memoryStorage({});
    const persist = { key: "a", storage };
    const { rerender } = await setup({ onChange, persist });
    const causes = () =>
      onChange.mock.calls.map(([, change]) => change.cause as string);

    act(() => void keyDown(separator("files", "editor"), "ArrowRight"));
    act(() => latest.setStop("files", "closed"));
    act(() => latest.toggle("files", "closed"));
    act(() => latest.setSize("preview", 300));
    act(() => latest.reset());
    act(() => latest.setStop("files", "closed"));
    expect(causes()).toEqual([
      "keyboard",
      "stop",
      "stop",
      "size",
      "reset",
      "stop",
    ]);

    // New options: switching to a key with nothing saved goes back to the
    // defaults ("options"); children added, removed or reordered are
    // "children".
    onChange.mockClear();
    rerender(<Group onChange={onChange} persist={{ key: "b", storage }} />);
    expect(latest.getChild("files")?.stop).toBe("open");
    rerender(
      <Group
        onChange={onChange}
        persist={{ key: "b", storage }}
        layout={row(files, editor)}
      />,
    );
    expect(causes()).toEqual(["options", "children"]);
  });

  it("animates the release but not the drag", async () => {
    await setup();
    dragSeparator("files", "editor", 60, { release: false });
    expect(screen.getByTestId("files").style.transition).toBe("");
    act(() => void pointer(window, "pointerup", { x: 560 }));
    expect(screen.getByTestId("files").style.transition).toContain("flex-grow");
  });

  it("restores the layout on Escape", async () => {
    await setup();
    dragSeparator("files", "editor", 60, { release: false });
    act(() => void keyDown(document.body, "Escape"));
    expect(flex("files")).toBe("240 1 0px");
  });

  it("lands an element in another stop when dragged past the group", async () => {
    await setup();
    expect(screen.getByTestId("files").dataset.stop).toBe("open");
    dragSeparator("files", "editor", -150);
    expect(flex("files")).toBe("0 1 0px");
    expect(screen.getByTestId("files").dataset.stop).toBe("closed");
    expect(latest.getChild("files")?.stop).toBe("closed");
    // Elements without named stops have no stop to show.
    expect(screen.getByTestId("editor").dataset.stop).toBeUndefined();
    expect(latest.getChild("editor")?.stop).toBeNull();
  });

  it("applies setStop over a live drag, dropping the drag", async () => {
    const onDragEnd = vi.fn();
    await setup({ onDragEnd });
    dragSeparator("files", "editor", 60, { release: false });
    expect(latest.getChild("files")?.size).toBe(300);
    act(() => latest.setStop("files", "closed"));
    expect(latest.getChild("files")?.stop).toBe("closed");
    expect(latest.dragging).toEqual([]);
    expect(onDragEnd).toHaveBeenCalledExactlyOnceWith(
      [{ before: "files", after: "editor" }],
      { cancelled: true },
    );
  });

  it("moves separators from the keyboard", async () => {
    await setup();
    act(() => void keyDown(separator("files", "editor"), "ArrowRight"));
    expect(flex("files")).toBe("250 1 0px");
    act(() => void keyDown(separator("files", "editor"), "Enter"));
    expect(latest.getChild("files")?.stop).toBe("closed");
  });

  it("is about the child after it with primary: after", async () => {
    // A panel at the end: the separator before it is about it.
    const panel: LayoutElementOptions = {
      id: "panel",
      defaultSize: 300,
      stops: { closed: 0, open: { min: 200, max: 500 } },
    };
    const valueText = vi.fn(
      ({ id, size }: { id: string; size: number | null }) => `${id} ${size}`,
    );
    function Panel({ primary }: { primary?: "before" | "after" }) {
      const group = useResizableLayout({
        idPrefix: "g",
        layout: row(editor, panel),
        elastic: false,
        valueText,
      });
      useLayoutEffect(() => {
        latest = group;
      });
      return (
        <div data-testid="group" {...group.getGroupProps("root")}>
          <div data-testid="editor" {...group.getElementProps("editor")} />
          <div
            data-testid="separator-editor-panel"
            {...group.getSeparatorProps("editor", "panel", { primary })}
            aria-label="Resize panel"
          />
          <div data-testid="panel" {...group.getElementProps("panel")} />
        </div>
      );
    }
    const { rerender } = render(<Panel />);
    await report({ editor: 900, panel: 300 });
    const line = separator("editor", "panel");

    // By default it's about the editor, which has no stop for Enter: no
    // falling back to the panel's.
    expect(line.getAttribute("aria-controls")).toBe("g-editor");
    act(() => void keyDown(line, "Enter"));
    expect(latest.getChild("panel")?.stop).toBe("open");

    rerender(<Panel primary="after" />);
    expect(line.getAttribute("aria-controls")).toBe("g-panel");
    expect(line.getAttribute("aria-valuenow")).toBe("300");
    // Every stop a drag reaches, closed included.
    expect([
      line.getAttribute("aria-valuemin"),
      line.getAttribute("aria-valuemax"),
    ]).toEqual(["0", "500"]);
    expect(line.getAttribute("aria-valuetext")).toBe("panel 300");
    // Arrows move the line on screen: right, the panel gets smaller.
    act(() => void keyDown(line, "ArrowRight"));
    expect(latest.getChild("panel")?.size).toBe(290);
    // Home and End: the panel's smallest and largest sizes.
    act(() => void keyDown(line, "Home"));
    expect(latest.getChild("panel")?.stop).toBe("closed");
    act(() => void keyDown(line, "End"));
    expect(latest.getChild("panel")?.size).toBe(500);
    // Enter toggles the panel's stop.
    act(() => void keyDown(line, "Enter"));
    expect(latest.getChild("panel")?.stop).toBe("closed");
  });

  it("follows the pointer and arrows in a row laid out right to left", async () => {
    await setup();
    // Right to left, files (first) is on the right: moving its separator
    // right makes it smaller.
    screen.getByTestId("group").style.direction = "rtl";
    dragSeparator("files", "editor", 40);
    expect(latest.getChild("files")?.size).toBe(200);
    act(() => void keyDown(separator("files", "editor"), "ArrowLeft"));
    expect(latest.getChild("files")?.size).toBe(210);
    // Read when each drag starts: back to left to right, it's as usual.
    screen.getByTestId("group").style.direction = "";
    dragSeparator("files", "editor", 40);
    expect(latest.getChild("files")?.size).toBe(250);
  });

  it("takes each element's own padding and border out of its share", async () => {
    render(<Group />);
    // Flexbox starts files at its padding and border (24 + 24 + 2 + 2).
    const { style } = screen.getByTestId("files");
    style.padding = "0 24px";
    style.border = "2px solid";
    await report({ files: 400, editor: 400, preview: 400 });
    expect(latest.getChild("files")?.size).toBe(240);
    expect(flex("files")).toBe("188 1 0px");
    expect(flex("editor")).toBe("600 1 0px");
  });

  it("names the root group like any other", async () => {
    await setup();
    const root = screen.getByTestId("group");
    expect(root.id).toBe("g-root");
    expect(root.dataset.group).toBe("root");
    expect(root.dataset.direction).toBe("row");
    expect(latest.childrenOf("root").map((child) => child.id)).toEqual([
      "files",
      "editor",
      "preview",
    ]);
  });

  it("resets everything with the root's id", async () => {
    await setup();
    dragSeparator("files", "editor", 60);
    expect(latest.getChild("files")?.size).toBe(300);
    act(() => latest.reset("root"));
    expect(latest.getChild("files")?.size).toBe(240);
  });

  it("exposes separator semantics", async () => {
    await setup();
    const el = separator("files", "editor");
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-controls")).toBe("g-files");
    expect(screen.getByTestId("files").id).toBe("g-files");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.dataset.direction).toBe("row");
    expect(el.getAttribute("aria-valuenow")).toBe("240");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    // As far as End goes: the others down to their minimums (320, 200).
    expect(el.getAttribute("aria-valuemax")).toBe("680");
    expect(separator("editor", "preview").getAttribute("aria-valuemax")).toBe(
      "760",
    );
    expect(el.style.cursor).toBe("col-resize");
    expect(el.getAttribute("aria-valuetext")).toBe("open, 240 pixels");
    expect(
      separator("editor", "preview").getAttribute("aria-valuetext"),
    ).toBeNull();
    expect(el.tabIndex).toBe(0);
  });

  it("words separator values with valueText", async () => {
    await setup({
      valueText: ({ id, stop, size }) => `${id} ${stop ?? "–"} ${size}`,
    });
    expect(separator("files", "editor").getAttribute("aria-valuetext")).toBe(
      "files open 240",
    );
    expect(separator("editor", "preview").getAttribute("aria-valuetext")).toBe(
      "editor – 600",
    );
  });

  it("opens and closes elements from the list, reporting the change", async () => {
    const onChange = vi.fn();
    const { rerender } = await setup({ onChange });

    rerender(<Group onChange={onChange} layout={row(files, editor)} />);
    expect(latest.elements.map((element) => element.id)).toEqual([
      "files",
      "editor",
    ]);
    expect(onChange).toHaveBeenCalledOnce();

    rerender(
      <Group onChange={onChange} layout={row(files, editor, preview)} />,
    );
    expect(latest.getChild("preview")?.size).toBe(360);
  });

  it("renders a changed list of children at once, without false warnings", async () => {
    // Rendered from the app's own list, as apps do, not from `elements`.
    function Panes({ ids }: { ids: string[] }) {
      const layout = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: ids.map((id) => ({ id })),
        },
      });
      return (
        <div {...layout.getGroupProps("root")}>
          {ids.map((id, index) => (
            <Fragment key={id}>
              {index > 0 && (
                <div
                  {...layout.getSeparatorProps(ids[index - 1], id)}
                  aria-label="Resize"
                />
              )}
              <div {...layout.getElementProps(id)} />
            </Fragment>
          ))}
        </div>
      );
    }
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { rerender } = render(<Panes ids={["a", "b"]} />);
      // Added, then reordered: valid in the very render that names them.
      rerender(<Panes ids={["a", "b", "c"]} />);
      rerender(<Panes ids={["c", "a", "b"]} />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("controls elements in code", async () => {
    await setup();
    act(() => latest.setStop("files", "closed"));
    expect(flex("files")).toBe("0 1 0px");
    act(() => latest.toggle("files", "closed"));
    expect(flex("files")).toBe("240 1 0px");
    act(() => latest.setSize("preview", 400));
    expect(latest.getChild("preview")?.size).toBe(400);
  });

  it("works under StrictMode's double mount", async () => {
    render(
      <StrictMode>
        <Group />
      </StrictMode>,
    );
    await report({ files: 400, editor: 400, preview: 400 });
    dragSeparator("files", "editor", 60);
    expect(flex("files")).toBe("300 1 0px");
  });

  it("stops observing elements when they unmount", async () => {
    const { unmount } = await setup();
    const element = screen.getByTestId("files");
    unmount();
    expect(observer.isObserved(element)).toBe(false);
  });

  it("types element ids from the options", () => {
    // Type-level only: checked by tsc, never called.
    function useTypes() {
      const group = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [{ id: "files" }, { id: "editor" }],
        },
      });
      expectTypeOf(group.elements[0].id).toEqualTypeOf<"files" | "editor">();
      group.getElementProps("files");
      // @ts-expect-error: not one of this group's elements
      group.getElementProps("fles");
      useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [{ id: "files" }, { id: "editor" }],
        },
        // @ts-expect-error: not one of this group's ids
        disabledSeparators: [["files", "edtor"]],
      });

      const ids: string[] = ["a", "b"];
      const dynamic = useResizableLayout({
        layout: {
          id: "root",
          direction: "column",
          children: ids.map((id) => ({ id })),
        },
      });
      expectTypeOf(dynamic.elements[0].id).toEqualTypeOf<string>();
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("keeps its types through a hook of your own, or named options", () => {
    // Type-level only (see Types in the README).
    const layout = {
      id: "ide",
      direction: "row",
      children: [
        { id: "files", stops: { rail: 48, open: { min: 180 } } },
        { id: "editor" },
      ],
    } as const;
    function useIde() {
      return useResizableLayout({ layout });
    }
    const options = { layout } as const satisfies UseResizableLayoutOptions;
    function useTypes() {
      const ide: ReturnType<typeof useIde> = useIde();
      expectTypeOf(ide.getChild("files").stop).toEqualTypeOf<
        "rail" | "open" | null
      >();
      const named: ResizableLayoutOf<typeof options> =
        useResizableLayout(options);
      expectTypeOf(named.getChild("files").stop).toEqualTypeOf<
        "rail" | "open" | null
      >();
      // A remote in named options too.
      const remote = createLayoutRemote<typeof layout>();
      useResizableLayout({
        ...({ ...options, remote } satisfies UseResizableLayoutOptions),
      });
      // Still plain layouts, also typed by ids alone.
      expectTypeOf(named).toExtend<ResizableLayout>();
      expectTypeOf(named).toExtend<ResizableLayout<"files" | "editor">>();
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("types children only some of a union of layouts have as maybe missing", () => {
    const compact = {
      id: "root",
      direction: "row",
      children: [{ id: "a" }],
    } as const;
    const full = {
      id: "root",
      direction: "row",
      children: [{ id: "a" }, { id: "b" }],
    } as const;
    function useTypes(small: boolean) {
      const api = useResizableLayout({ layout: small ? compact : full });
      expectTypeOf(api.getChild("a")).toEqualTypeOf<
        ResizableLayoutChild<"a", never>
      >();
      expectTypeOf(api.getChild("b")).toEqualTypeOf<
        ResizableLayoutChild<"b", never> | undefined
      >();
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("types children only some alternatives have as maybe missing, at any depth", () => {
    const compact = {
      id: "work",
      direction: "column",
      children: [{ id: "editor" }],
    } as const;
    const full = {
      id: "work",
      direction: "column",
      children: [{ id: "editor" }, { id: "terminal" }],
    } as const;
    const one = { id: "x" } as const;
    const other = { id: "y" } as const;
    function useTypes(small: boolean, selected: "x" | "y") {
      // A union inside a tuple.
      const nested = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [{ id: "files" }, small ? compact : full],
        },
      });
      expectTypeOf(nested.getChild("editor")).toEqualTypeOf<
        ResizableLayoutChild<"editor", never>
      >();
      expectTypeOf(nested.getChild("terminal")).toEqualTypeOf<
        ResizableLayoutChild<"terminal", never> | undefined
      >();
      // A union of entries, and an id that's a union.
      const either = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [{ id: "fixed" }, small ? one : other, { id: selected }],
        },
      });
      expectTypeOf(either.getChild("fixed")).toEqualTypeOf<
        ResizableLayoutChild<"fixed", never>
      >();
      expectTypeOf(either.getChild("x")).toEqualTypeOf<
        ResizableLayoutChild<"x", never> | undefined
      >();
      // A union of lists, and of an array and a list.
      const lists = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: small
            ? ([{ id: "a" }] as const)
            : ([{ id: "a" }, { id: "b" }] as const),
        },
      });
      expectTypeOf(lists.getChild("a")).toEqualTypeOf<
        ResizableLayoutChild<"a", never>
      >();
      expectTypeOf(lists.getChild("b")).toEqualTypeOf<
        ResizableLayoutChild<"b", never> | undefined
      >();
      const more: { id: "m" }[] = [];
      const arrayOrList = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: small ? more : ([{ id: "m" }, { id: "n" }] as const),
        },
      });
      expectTypeOf(arrayOrList.getChild("n")).toEqualTypeOf<
        ResizableLayoutChild<"n", never> | undefined
      >();
      const remote = createLayoutRemote<{
        id: "root";
        direction: "row";
        children: [typeof one | typeof other];
      }>();
      expectTypeOf(remote.current?.getView().children.x).toEqualTypeOf<
        ResizableLayoutChild<"x", never> | undefined
      >();
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("types the stops of children made from a list of ids", () => {
    const ids = ["left", "right"] as const;
    const layout = {
      id: "root",
      direction: "row",
      children: ids.map((id) => ({
        id,
        stops: { closed: 0, open: { min: 100 } },
      })),
    } as const;
    function useTypes() {
      const panes = useResizableLayout({ layout });
      // An array (TypeScript can't tell a map from a filter): its children
      // may not be there, but their stops are typed.
      expectTypeOf(panes.getChild("left")?.stop).toEqualTypeOf<
        "closed" | "open" | null | undefined
      >();
      // Written out (a tuple), they're there; those of an array after
      // them may not be.
      const more: { id: "right" }[] = [];
      const written = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "left", stops: { closed: 0, open: { min: 100 } } },
            ...more,
          ],
        },
      });
      expectTypeOf(written.getChild("left").stop).toEqualTypeOf<
        "closed" | "open" | null
      >();
      expectTypeOf(written.getChild("right")).toEqualTypeOf<
        ResizableLayoutChild<"right", never> | undefined
      >();
      panes.setStop("right", "closed");
      panes.setStops({ left: "open", right: "closed" });
      // @ts-expect-error: not one of their stops
      panes.setStop("left", "rail");
      const remote = createLayoutRemote<typeof layout>();
      remote.current?.setStop("left", "closed");
    }
    expect(useTypes).toBeTypeOf("function");
  });
});

describe("useResizableLayout's separator keys", () => {
  it("keeps ids apart that only joined would be the same", async () => {
    render(
      <Group
        layout={row({ id: "a|b" }, { id: "c" }, { id: "a" }, { id: "b|c" })}
      />,
    );
    const keys = latest.separatorsOf("root").map((entry) => entry.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe("a\\|b|c|0");
    const { controller } = latest;
    expect(controller.separatorRef("a\u0000b", "c")).not.toBe(
      controller.separatorRef("a", "b\u0000c"),
    );
  });
});

describe("useResizableLayout with your own styles", () => {
  it("merges a getter's style over the library's, key by key", async () => {
    await setup();
    expect(
      latest.getGroupProps("root", { style: { gap: 4 } }).style,
    ).toMatchObject({
      display: "flex",
      gap: 4,
    });
    expect(
      latest.getElementProps("files", { style: { overflow: "visible" } }).style,
    ).toMatchObject({ overflow: "visible", flex: expect.any(String) });
    expect(
      latest.getSeparatorProps("files", "editor", { style: { cursor: "grab" } })
        .style,
    ).toMatchObject({ cursor: "grab", touchAction: "none", flexShrink: 0 });
  });
});

describe("useResizableLayout elements coming and going", () => {
  it("forgets the refs of elements that leave the options", () => {
    const controller = createLayoutController(defaults);
    const kept = controller.elementRef("files");
    const leaving = controller.elementRef("preview");
    const separator = controller.separatorRef("editor", "preview");
    controller.setOptions({
      ...defaults,
      layout: { ...defaults.layout, children: [files, editor] },
    });
    expect(controller.elementRef("files")).toBe(kept);
    expect(controller.elementRef("preview")).not.toBe(leaving);
    expect(controller.separatorRef("editor", "preview")).not.toBe(separator);
  });

  it("measures a group again when an element's element comes back", async () => {
    function Flaky({ showPreview }: { showPreview: boolean }) {
      const group = useResizableLayout(defaults);
      useLayoutEffect(() => {
        latest = group;
      });
      return (
        <div {...group.getGroupProps("root")}>
          <div data-testid="files" {...group.getElementProps("files")} />
          <div data-testid="editor" {...group.getElementProps("editor")} />
          {showPreview && (
            <div data-testid="preview" {...group.getElementProps("preview")} />
          )}
        </div>
      );
    }
    const { rerender } = render(<Flaky showPreview />);
    await report({ files: 400, editor: 400, preview: 400 });
    expect(latest.getChild("preview")?.size).toBe(360);
    // The element goes (the element stays in the options), then comes back
    // in a wider space.
    rerender(<Flaky showPreview={false} />);
    rerender(<Flaky showPreview />);
    await report({ files: 500, editor: 500, preview: 500 });
    expect(latest.getChild("preview")?.size).toBe(450);
  });

  it("has a view of a child on the render that adds it", async () => {
    const seen: (string | null)[] = [];
    function Added({ extra }: { extra: boolean }) {
      const layout = useResizableLayout({
        idPrefix: "g",
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "a" },
            ...(extra
              ? [{ id: "b", stops: { closed: 0, open: { min: 100 } } } as const]
              : []),
          ],
        },
      });
      // In these options: it has a view, though not measured yet. (Its
      // type says it may be missing: an array's entries may not be there.)
      if (extra) seen.push(layout.getChild("b")!.stop);
      return (
        <div {...layout.getGroupProps("root")}>
          {layout.elements.map((element) => (
            <div
              key={element.id}
              data-testid={element.id}
              {...layout.getElementProps(element.id)}
            />
          ))}
        </div>
      );
    }
    const { rerender } = render(<Added extra={false} />);
    await act(async () =>
      observer.resize(screen.getByTestId("a"), { width: 600, height: 400 }),
    );
    rerender(<Added extra />);
    // Not measured on the render that adds it, then in its stop.
    expect(seen[0]).toBeNull();
    expect(screen.getByTestId("b")).toBeTruthy();
    expect(seen.at(-1)).toBe("open");
  });
});

describe("useResizableLayout drag callbacks", () => {
  it("reports the separators being dragged", async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    await setup({ onDragStart, onDragEnd });
    dragSeparator("files", "editor", 30);
    expect(onDragStart).toHaveBeenCalledWith([
      { before: "files", after: "editor" },
    ]);
    expect(onDragEnd).toHaveBeenCalledWith(
      [{ before: "files", after: "editor" }],
      { cancelled: false },
    );
  });
});

describe("useResizableLayout separators that can't move", () => {
  // Two fixed sizes first: before the separator between them, nothing can
  // give or take.
  const layout = row(
    { id: "a", stops: { fixed: 100 } },
    { id: "b", stops: { fixed: 100 } },
    { id: "x" },
    { id: "y" },
  );

  it("look and announce it, and ignore presses", async () => {
    const onDragStart = vi.fn();
    render(<Group layout={layout} onDragStart={onDragStart} />);
    await report({ a: 100, b: 100, x: 400, y: 400 });
    const pinned = separator("a", "b");
    expect(pinned.getAttribute("aria-disabled")).toBe("true");
    expect(pinned.style.cursor).toBe("");
    act(
      () =>
        void pinned.dispatchEvent(
          new PointerEvent("pointerover", {
            pointerType: "mouse",
            bubbles: true,
          }),
        ),
    );
    expect(pinned.dataset.hover).toBeUndefined();
    dragSeparator("a", "b", 50);
    expect(onDragStart).not.toHaveBeenCalled();
    // Nor does the browser start a text selection, or drag selected text,
    // from it: it's a control. Other buttons keep their defaults.
    expect(pointer(pinned, "pointerdown").defaultPrevented).toBe(true);
    expect(pointer(pinned, "pointerdown", { button: 2 }).defaultPrevented).toBe(
      false,
    );
    // One between ranges moves as ever.
    expect(separator("x", "y").getAttribute("aria-disabled")).toBeNull();
    expect(separator("x", "y").style.cursor).toBe("col-resize");
  });

  it("include disabled ones, and those beside a locked child", async () => {
    const onDragStart = vi.fn();
    render(
      <Group
        layout={row({ id: "a", locked: true }, { id: "b" }, { id: "c" })}
        disabledSeparators={[["b", "c"]]}
        onDragStart={onDragStart}
      />,
    );
    await report({ a: 300, b: 300, c: 300 });
    for (const [before, after] of [
      ["a", "b"],
      ["b", "c"],
    ]) {
      expect(separator(before, after).getAttribute("aria-disabled")).toBe(
        "true",
      );
      expect(separator(before, after).style.cursor).toBe("");
      dragSeparator(before, after, 50);
      expect(
        pointer(separator(before, after), "pointerdown").defaultPrevented,
      ).toBe(true);
    }
    expect(onDragStart).not.toHaveBeenCalled();
    act(() => void keyDown(separator("b", "c"), "ArrowRight"));
    expect(latest.getChild("b")?.size).toBe(300);
  });

  it("ignore presses while the layout is disabled", async () => {
    const onDragStart = vi.fn();
    render(<Group disabled onDragStart={onDragStart} />);
    await report({ files: 400, editor: 400, preview: 400 });
    const press = pointer(separator("files", "editor"), "pointerdown");
    expect(press.defaultPrevented).toBe(true);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("leaves one beside a last fill able to collapse its neighbour", async () => {
    const pane = (id: string): LayoutElementOptions => ({
      id,
      stops: { strip: 40, open: { min: 180 } },
    });
    render(
      <Group
        layout={row(pane("a"), pane("b"), { id: "fill", fill: "last" })}
      />,
    );
    await report({ a: 500, b: 500, fill: 0 });
    expect(separator("b", "fill").getAttribute("aria-disabled")).toBeNull();
    dragSeparator("b", "fill", -300);
    expect(latest.getChild("b")?.stop).toBe("strip");
  });
});

describe("useResizableLayout animating and hiding", () => {
  it("animates closing an element, then hides it", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => latest.setStop("files", "closed"));
      expect(latest.animating).toBe(true);
      expect(screen.getByTestId("group").dataset.animating).toBe("");
      expect(screen.getByTestId("files").style.visibility).toBe("");

      act(() => void vi.advanceTimersByTime(450));
      expect(latest.animating).toBe(false);
      expect(screen.getByTestId("files").style.visibility).toBe("hidden");
      expect(screen.getByTestId("editor").style.visibility).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends an animation that restore lands on, showing the snapshot at once", async () => {
    // Without a content wrapper, "once" warns; it still holds the state's.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await setup({ reflow: "once" });
      const open = latest.getSnapshot();
      act(() => latest.setStop("files", "closed"));
      expect(latest.animating).toBe(true);
      act(() => latest.restore(open));
      expect(latest.animating).toBe(false);
      expect(latest.getChild("files")?.stop).toBe("open");
      expect(screen.getByTestId("files").style.transition).toBe("");
      const { controller } = latest as unknown as {
        controller: LayoutControllerWithState;
      };
      expect(holdsContent(controller.getState())).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("useResizableLayout measuring while animating", () => {
  it("sets rounding aside until the change is done, then measures exactly", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => latest.setStop("files", "closed"));
      const flexes = () => ["editor", "preview"].map(flex);
      const animating = flexes();
      // Mid-animation, the children add up 1/64px short: rounding, which
      // would retarget their transitions. Nothing changes.
      await report({ files: 120, editor: 540, preview: 540 - 1 / 64 });
      expect(flexes()).toEqual(animating);
      // Done, the space is measured again, and the 1/64px counts.
      await act(async () => void vi.advanceTimersByTime(450));
      expect(latest.animating).toBe(false);
      expect(flexes()).not.toEqual(animating);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useResizableLayout for content", () => {
  it("marks a child at zero, and gives its content size both ways", async () => {
    await setup();
    const files = screen.getByTestId("files");
    expect(files.dataset.zero).toBeUndefined();
    // In a range, the content size is the size: `initial` (the docs'
    // fallback is 100%), so a drag doesn't restyle the content each frame.
    expect(latest.getChild("files")?.contentSize).toBe(240);
    expect(files.style.getPropertyValue("--resizable-content-size")).toBe(
      "initial",
    );
    act(() => latest.setStop("files", "closed"));
    expect(files.style.getPropertyValue("--resizable-content-size")).toBe(
      "240px",
    );
    expect(files.dataset.zero).toBe("");
    // Its separator says which side is at zero.
    expect(separator("files", "editor").dataset.zero).toBe("before");
    expect(separator("editor", "preview").dataset.zero).toBeUndefined();
    // At a point, the content keeps the size of the range it came from.
    expect(files.style.getPropertyValue("--resizable-content-width")).toBe(
      "240px",
    );
  });
});

describe("useResizableLayout's content variables", () => {
  const contentWidth = (id: string) =>
    screen.getByTestId(id).style.getPropertyValue("--resizable-content-width");

  it("leaves them at initial through drags and window resizes in a range", async () => {
    await setup();
    dragSeparator("files", "editor", 60, { release: false });
    expect(latest.getChild("files")?.size).toBe(300);
    expect(contentWidth("files")).toBe("initial");
    act(() => void pointer(window, "pointerup", { x: 560 }));
    await report({ files: 300, editor: 540, preview: 360 });
    await report({ files: 280, editor: 500, preview: 340 });
    expect(contentWidth("files")).toBe("initial");
  });

  it("leaves them at initial in a group past its space", async () => {
    render(
      <Group
        layout={row({ id: "a", minSize: 300 }, { id: "b", minSize: 300 })}
      />,
    );
    await report({ a: 150, b: 150 });
    expect(latest.overflowing).toBe(true);
    // Its size is what it's given; its content, laid out as it's drawn.
    expect(latest.getChild("a")).toMatchObject({ size: 300, contentSize: 150 });
    expect(contentWidth("a")).toBe("initial");
  });

  it("doesn't set them while a change within a range animates", async () => {
    await setup();
    act(() => latest.setSize("files", 300));
    expect(latest.animating).toBe(true);
    // It stays in its range: its content follows its edge, as in a drag.
    expect(contentWidth("files")).toBe("initial");
    // Nor for a neighbour it resizes.
    expect(contentWidth("editor")).toBe("initial");
  });

  it("sets them while a change of stop animates, then not", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => latest.setStop("files", "closed"));
      await act(async () => void vi.advanceTimersByTime(450));
      act(() => latest.setStop("files", "open"));
      expect(latest.animating).toBe(true);
      // Opening from 0: laid out at its open size from the start.
      expect(contentWidth("files")).toBe("240px");
      await act(async () => void vi.advanceTimersByTime(450));
      expect(contentWidth("files")).toBe("initial");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useResizableLayout for crossfades", () => {
  it("exposes each element's stops in pixels once measured", async () => {
    render(<Group />);
    expect(latest.getChild("files")?.stops).toBeNull();
    await report({ files: 400, editor: 400, preview: 400 });
    expect(latest.getChild("files")?.stops?.closed).toEqual({ min: 0, max: 0 });
    expect(latest.getChild("files")?.stops?.open.min).toBe(180);
    expect(latest.getChild("editor")?.stops).toEqual({});
  });

  it("remembers each element's previous stop", async () => {
    await setup();
    expect(latest.getChild("files")?.previousStop).toBeNull();
    act(() => latest.setStop("files", "closed"));
    expect(latest.getChild("files")?.stop).toBe("closed");
    expect(latest.getChild("files")?.previousStop).toBe("open");
    act(() => latest.setStop("files", "open"));
    expect(latest.getChild("files")?.previousStop).toBe("closed");
  });

  it("shows the content of the stop a child came from while at zero", async () => {
    await setup();
    const content = () => {
      const files = latest.getChild("files");
      return [files?.contentStop, files?.fromStop];
    };
    expect(content()).toEqual(["open", null]);
    act(() => latest.setStop("files", "closed"));
    expect(content()).toEqual(["open", "open"]);
    act(() => latest.setStop("files", "open"));
    expect(content()).toEqual(["open", "closed"]);
  });

  it("puts the latest change's timing on the group", async () => {
    await setup({ transition: { changes: { stop: { duration: 250 } } } });
    const group = screen.getByTestId("group");
    expect(group.style.getPropertyValue("--resizable-duration")).toBe("0ms");
    act(() => latest.setStop("files", "closed"));
    expect(group.style.getPropertyValue("--resizable-duration")).toBe("250ms");
    expect(group.style.getPropertyValue("--resizable-easing")).toBe(
      "cubic-bezier(0.22, 1, 0.36, 1)",
    );
  });
});

describe("useResizableLayout stepping down to fit", () => {
  const files: LayoutElementOptions = {
    id: "files",
    defaultSize: 240,
    stops: {
      closed: { size: 0, onlyByName: true },
      rail: 48,
      open: { min: 180 },
    },
    yieldTo: { open: "rail" },
  };

  it("steps a child down when the space shrinks, and back, saving neither", async () => {
    const onChange = vi.fn();
    render(<Group layout={row(files, editor, preview)} onChange={onChange} />);
    await report({ files: 400, editor: 400, preview: 400 });
    expect(latest.getChild("files")?.stop).toBe("open");
    onChange.mockClear();
    // In 600, the minimums (180 + 320 + 200) don't fit: files goes to its rail.
    await report({ files: 200, editor: 200, preview: 200 });
    expect(latest.getChild("files")).toMatchObject({
      stop: "rail",
      yieldedFrom: "open",
      previousStop: "open",
    });
    expect(latest.getChild("files")?.size).toBe(48);
    expect(latest.getSnapshot().children.files.stop).toBe("open");
    // With room again, it's back.
    await report({ files: 400, editor: 400, preview: 400 });
    expect(latest.getChild("files")).toMatchObject({
      stop: "open",
      yieldedFrom: null,
      previousStop: "rail",
    });
    // What was chosen never changed, so there was nothing to save.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps what stepped down there, with the README's recipe", async () => {
    const onChange = vi.fn();
    render(
      <Group
        layout={row(files, editor, preview)}
        onChange={onChange}
        keepSteppedDown
      />,
    );
    await report({ files: 400, editor: 400, preview: 400 });
    await report({ files: 200, editor: 200, preview: 200 });
    expect(latest.getChild("files")).toMatchObject({
      stop: "rail",
      yieldedFrom: null,
    });
    expect(latest.getSnapshot().children.files.stop).toBe("rail");
    expect(onChange).toHaveBeenCalledWith(expect.anything(), {
      cause: "stop",
    });
    // With room again, it stays until it's opened.
    await report({ files: 400, editor: 400, preview: 400 });
    expect(latest.getChild("files")?.stop).toBe("rail");
  });
});

describe("useResizableLayout with nested groups", () => {
  const ide: UseResizableLayoutOptions = {
    idPrefix: "ide",
    elastic: false,
    layout: {
      id: "root",
      direction: "row",
      children: [
        { id: "files", defaultSize: 240, minSize: 180 },
        {
          id: "work",
          direction: "column",
          children: [
            { id: "editor", minSize: 200 },
            { id: "terminal", defaultSize: 200, minSize: 100 },
          ],
        },
      ],
    },
  };

  let tree: ResizableLayout;

  /** `swapped` names the junction's separators the other way round. */
  function Ide({
    swapped = false,
    ...options
  }: { swapped?: boolean } & Partial<UseResizableLayoutOptions>) {
    const group = useResizableLayout({ ...ide, ...options });
    useLayoutEffect(() => {
      tree = group;
    });
    return (
      <div data-testid="root" {...group.getGroupProps("root")}>
        <div data-testid="files" {...group.getElementProps("files")} />
        <div
          data-testid="sep-files-work"
          {...group.getSeparatorProps("files", "work")}
          aria-label="Resize files"
        />
        <div data-testid="work" {...group.getGroupProps("work")}>
          <div data-testid="editor" {...group.getElementProps("editor")} />
          <div
            data-testid="sep-editor-terminal"
            {...group.getSeparatorProps("editor", "terminal")}
            aria-label="Resize terminal"
          >
            {/* Where it meets the files separator. */}
            <div
              data-testid="junction"
              {...group.getJunctionProps(
                swapped
                  ? [
                      ["editor", "terminal"],
                      ["files", "work"],
                    ]
                  : [
                      ["files", "work"],
                      ["editor", "terminal"],
                    ],
              )}
            />
          </div>
          <div data-testid="terminal" {...group.getElementProps("terminal")} />
        </div>
      </div>
    );
  }

  async function setupTree(options: Partial<UseResizableLayoutOptions> = {}) {
    const result = render(<Ide {...options} />);
    await act(async () => {
      const resize = (id: string, width: number, height: number) =>
        observer.resize(screen.getByTestId(id), { width, height });
      resize("files", 400, 800);
      resize("work", 800, 800);
      resize("editor", 800, 400);
      resize("terminal", 800, 400);
    });
    return result;
  }

  it("lays out each group and renders nested groups as flex containers", async () => {
    await setupTree();
    expect(tree.getChild("files")?.size).toBe(240);
    expect(tree.getChild("work")?.size).toBe(960);
    expect(tree.getChild("terminal")?.size).toBe(200);
    expect(tree.elements.map((element) => element.id)).toEqual([
      "files",
      "editor",
      "terminal",
    ]);
    const work = screen.getByTestId("work");
    expect(work.style.display).toBe("flex");
    expect(work.style.flexDirection).toBe("column");
    expect(work.dataset.group).toBe("work");
    expect(
      screen
        .getByTestId("sep-editor-terminal")
        .getAttribute("aria-orientation"),
    ).toBe("horizontal");
    expect(screen.getByTestId("sep-editor-terminal").dataset.direction).toBe(
      "column",
    );
  });

  it("drags a nested separator vertically", async () => {
    await setupTree();
    act(() => {
      pointer(screen.getByTestId("sep-editor-terminal"), "pointerdown", {
        x: 500,
        y: 500,
      });
      pointer(window, "pointermove", { x: 500, y: 400 });
      frames.flushFrame();
    });
    act(() => void pointer(window, "pointerup", { x: 500, y: 400 }));
    expect(tree.getChild("terminal")?.size).toBe(300);
  });

  /** Presses `testId` at (500, 500) and moves to (560, 450). */
  function dragFrom(testId: string) {
    act(() => {
      pointer(screen.getByTestId(testId), "pointerdown", { x: 500, y: 500 });
      pointer(window, "pointermove", { x: 560, y: 450 });
      frames.flushFrame();
    });
    const dragging = tree.dragging.length;
    const junction = screen.getByTestId("junction").dataset.dragging;
    act(() => void pointer(window, "pointerup", { x: 560, y: 450 }));
    return { dragging, junction };
  }

  it("drags every separator a junction names, each along its own axis", async () => {
    await setupTree();
    expect(dragFrom("junction")).toEqual({ dragging: 2, junction: "" });
    expect(tree.getChild("files")?.size).toBe(300);
    expect(tree.getChild("terminal")?.size).toBe(250);
  });

  it("drags only a junction's separators that aren't disabled", async () => {
    await setupTree({ disabledSeparators: [["files", "work"]] });
    expect(dragFrom("junction")).toEqual({ dragging: 1, junction: "" });
    expect(tree.getChild("files")?.size).toBe(240);
    expect(tree.getChild("terminal")?.size).toBe(250);
  });

  it("holds a nested group's content too, reflowing once", async () => {
    await setupTree({ reflow: "once" });
    const workWas = tree.getChild("work")?.size;
    act(() => {
      pointer(screen.getByTestId("sep-files-work"), "pointerdown", {
        x: 500,
        y: 500,
      });
      pointer(window, "pointermove", { x: 560, y: 500 });
      frames.flushFrame();
    });
    expect(tree.getChild("files")?.size).toBe(300);
    // The editor and terminal take their width from work's, held.
    expect(
      screen
        .getByTestId("work")
        .style.getPropertyValue("--resizable-content-width"),
    ).toBe(`${workWas}px`);
    act(() => void pointer(window, "pointerup", { x: 560, y: 500 }));
    expect(tree.getChild("files")?.size).toBe(300);
  });

  it("drags just the separator pressed, wherever the others are", async () => {
    await setupTree();
    // The junction sits inside the terminal's separator: a press on the
    // separator itself is that separator's alone.
    expect(dragFrom("sep-editor-terminal")).toEqual({
      dragging: 1,
      junction: undefined,
    });
    expect(tree.getChild("files")?.size).toBe(240);
    expect(tree.getChild("terminal")?.size).toBe(250);
    expect(dragFrom("sep-files-work").dragging).toBe(1);
    expect(tree.getChild("terminal")?.size).toBe(250);
  });

  it("marks the separators a press would drag while a mouse is over it", async () => {
    await setupTree();
    const marked = () =>
      ["sep-files-work", "sep-editor-terminal", "junction"].map(
        (id) => screen.getByTestId(id).dataset.hover,
      );
    const send = (testId: string, type: string, pointerType = "mouse") =>
      act(
        () =>
          void screen.getByTestId(testId).dispatchEvent(
            new PointerEvent(type, {
              pointerType,
              bubbles: type === "pointerover",
            }),
          ),
      );
    expect(marked()).toEqual([undefined, undefined, undefined]);
    // Over the terminal's separator: just that one.
    send("sep-editor-terminal", "pointerover");
    expect(marked()).toEqual([undefined, "", undefined]);
    // Onto the junction inside it: both it drags, and the junction.
    send("junction", "pointerover");
    expect(marked()).toEqual(["", "", ""]);
    // Back off the junction onto the separator.
    send("junction", "pointerleave");
    send("sep-editor-terminal", "pointerover");
    expect(marked()).toEqual([undefined, "", undefined]);
    send("sep-editor-terminal", "pointerleave");
    expect(marked()).toEqual([undefined, undefined, undefined]);
    // A touch has no hover to show.
    send("junction", "pointerover", "touch");
    expect(marked()).toEqual([undefined, undefined, undefined]);
  });

  it("warns when a separator gets a press inside a junction's box", async () => {
    await setupTree();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // jsdom has no layout: put the junction at (500, 500), 12px square.
    vi.spyOn(
      screen.getByTestId("junction"),
      "getBoundingClientRect",
    ).mockReturnValue(
      DOMRect.fromRect({ x: 494, y: 494, width: 12, height: 12 }),
    );
    const press = (testId: string, x: number, y: number) => {
      act(
        () => void pointer(screen.getByTestId(testId), "pointerdown", { x, y }),
      );
      act(() => void pointer(window, "pointerup", { x, y }));
    };
    // Outside the junction: nothing's wrong.
    press("sep-files-work", 500, 300);
    expect(warn).not.toHaveBeenCalled();
    // On the junction itself: it gets the press.
    press("junction", 500, 500);
    expect(warn).not.toHaveBeenCalled();
    // A separator got it there instead: the junction is covered.
    press("sep-files-work", 500, 500);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'A press inside the junction of ["files", "work"], ["editor", "terminal"] went to the separator between "files" and "work"',
      ),
    );
    warn.mockRestore();
  });

  it("keeps a junction's highlights when its pairs change under the pointer", async () => {
    const { rerender } = await setupTree();
    const junction = () => screen.getByTestId("junction").dataset;
    act(
      () =>
        void screen.getByTestId("junction").dispatchEvent(
          new PointerEvent("pointerover", {
            pointerType: "mouse",
            bubbles: true,
          }),
        ),
    );
    expect(junction().hover).toBe("");
    // New pairs (a new ref) on the same element: still hovered.
    rerender(<Ide swapped />);
    expect(junction().hover).toBe("");
    // Pressed and dragging, then its pairs change: still the one dragged.
    act(() => {
      pointer(screen.getByTestId("junction"), "pointerdown", {
        x: 500,
        y: 500,
      });
      pointer(window, "pointermove", { x: 540, y: 460 });
      frames.flushFrame();
    });
    expect(junction().dragging).toBe("");
    rerender(<Ide />);
    act(() => {
      pointer(window, "pointermove", { x: 550, y: 450 });
      frames.flushFrame();
    });
    expect(junction().dragging).toBe("");
    act(() => void pointer(window, "pointerup", { x: 550, y: 450 }));
    // A separator's own drag isn't the junction's.
    expect(dragFrom("sep-files-work").junction).toBeUndefined();
  });

  it("makes a junction pointer-only, with the move cursor", async () => {
    await setupTree();
    const junction = screen.getByTestId("junction");
    expect(junction.tabIndex).toBe(-1);
    expect(junction.getAttribute("aria-hidden")).toBe("true");
    expect(junction.style.cursor).toBe("move");
    expect(junction.style.touchAction).toBe("none");
  });

  it("types ids from nested groups", () => {
    // Type-level only: checked by tsc, never called.
    function useTypes() {
      const group = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "a" },
            {
              id: "b",
              direction: "column",
              children: [{ id: "c" }, { id: "d" }],
            },
          ],
        },
      });
      expectTypeOf(group.elements[0].id).toEqualTypeOf<"a" | "b" | "c" | "d">();
      group.getGroupProps("b");
      group.getGroupProps("root");
      group.reset("root");
      // @ts-expect-error: not one of this group's ids
      group.getElementProps("e");
      // @ts-expect-error: the root has no size or stops of its own
      group.setSize("root", 100);
      // @ts-expect-error: the root isn't an element
      group.getElementProps("root");
      // @ts-expect-error: nor has it content of its own to clip
      group.getClipProps("root");
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("types the callbacks' ids from the layout", () => {
    // Type-level only: checked by tsc, never called.
    function useTypes() {
      useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "a" },
            {
              id: "b",
              direction: "column",
              children: [{ id: "c" }, { id: "d" }],
            },
          ],
        },
        onDragStart: (grabbed) =>
          expectTypeOf(grabbed[0].before).toEqualTypeOf<
            "a" | "b" | "c" | "d"
          >(),
        onDragEnd: (grabbed) =>
          expectTypeOf(grabbed[0].after).toEqualTypeOf<"a" | "b" | "c" | "d">(),
        valueText: ({ id }) => {
          expectTypeOf(id).toEqualTypeOf<"a" | "b" | "c" | "d">();
          return undefined;
        },
      });
      // A callback typed for any ids still fits.
      useResizableLayout({
        layout: { id: "root", direction: "row", children: [{ id: "a" }] },
        onDragStart: (grabbed: readonly SeparatorPair[]) => void grabbed,
      });
      // Options built at runtime: plain strings.
      const runtime: UseResizableLayoutOptions = {
        layout: { id: "root", direction: "row", children: [{ id: "a" }] },
        onDragStart: (grabbed) =>
          expectTypeOf(grabbed[0].before).toEqualTypeOf<string>(),
      };
      useResizableLayout(runtime);
    }
    expect(useTypes).toBeTypeOf("function");
  });

  it("types each element's stop names", () => {
    // Type-level only: checked by tsc, never called.
    function useTypes() {
      const group = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "files", stops: { closed: 0, open: { min: 100 } } },
            {
              id: "work",
              direction: "column",
              children: [
                { id: "editor" },
                { id: "terminal", stops: { bar: 32, open: {} } },
              ],
            },
          ],
        },
      });
      group.setStop("files", "closed");
      group.toggle("terminal", "bar");
      // @ts-expect-error: not one of files' stops
      group.setStop("files", "bar");
      // @ts-expect-error: editor has no named stops
      group.setStop("editor", "open");

      // A named element is always there, and its stop has its own names.
      const terminal: "bar" | "open" | null = group.getChild("terminal").stop;
      const editor: null = group.getChild("editor").stop;
      // @ts-expect-error: not one of terminal's stops
      void (group.getChild("terminal").previousStop === "rail");
      void [terminal, editor];

      const runtime: UseResizableLayoutOptions = {
        layout: { id: "root", direction: "row", children: [{ id: "a" }] },
      };
      useResizableLayout(runtime).setStop("anything", "goes");
      // Ids built at runtime may not exist.
      // @ts-expect-error: possibly undefined
      void useResizableLayout(runtime).getChild("a").stop;
    }
    expect(useTypes).toBeTypeOf("function");
  });
});

describe("rendering a tree from childrenOf", () => {
  function Recursive() {
    const group = useResizableLayout({
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "a" },
          {
            id: "inner",
            direction: "column",
            children: [{ id: "b" }, { id: "c" }],
          },
        ],
      },
    });
    type Id = Parameters<typeof group.childrenOf>[0];
    const renderChildren = (id: Id): ReactNode =>
      group.childrenOf(id).map((child) => (
        <Fragment key={child.id}>
          {child.previous && (
            <div
              data-testid={`sep-${child.previous}-${child.id}`}
              {...group.getSeparatorProps(child.previous, child.id)}
              aria-label={`Resize ${child.id}`}
            />
          )}
          {child.kind === "group" ? (
            <div data-testid={child.id} {...group.getGroupProps(child.id)}>
              {renderChildren(child.id)}
            </div>
          ) : (
            <div data-testid={child.id} {...group.getElementProps(child.id)} />
          )}
        </Fragment>
      ));
    return <div {...group.getGroupProps("root")}>{renderChildren("root")}</div>;
  }

  it("lists each group's children with the separators between them", () => {
    render(<Recursive />);
    expect(screen.getByTestId("inner").dataset.group).toBe("inner");
    expect(screen.getByTestId("b").dataset.element).toBe("b");
    expect(screen.getByTestId("sep-a-inner").getAttribute("role")).toBe(
      "separator",
    );
    expect(screen.getByTestId("sep-b-c").getAttribute("aria-orientation")).toBe(
      "horizontal",
    );
    expect(screen.queryByTestId("sep-inner-b")).toBeNull();
  });
});

describe("useResizableLayout persistence", () => {
  const at = (stop: string, size: number) => ({
    stop,
    sizes: { [stop]: size },
    lastRange: stop,
  });
  const layout = (files: number, editor: number, preview: number) => ({
    version: 3,
    children: {
      files: at("open", files),
      editor: at("", editor),
      preview: at("", preview),
    },
  });

  it("restores the saved layout on mount and saves committed changes", async () => {
    const { storage, saved } = memoryStorage({ g: layout(300, 500, 400) });
    await setup({ persist: { key: "g", storage } });
    expect(flex("files")).toBe("300 1 0px");
    expect(flex("preview")).toBe("400 1 0px");

    dragSeparator("files", "editor", 20);
    expect(saved("g")).toEqual(layout(320, 480, 400));
  });

  it("remembers closed elements' sizes", async () => {
    const { storage, saved } = memoryStorage();
    const { rerender } = await setup({ persist: { key: "g", storage } });
    rerender(
      <Group persist={{ key: "g", storage }} layout={row(files, editor)} />,
    );
    expect(saved("g")).toMatchObject({
      children: { preview: at("", 360) },
    });
  });

  it("switches to another key's layout, or the defaults", async () => {
    const { storage, saved } = memoryStorage({ a: layout(300, 500, 400) });
    const { rerender } = await setup({ persist: { key: "a", storage } });
    expect(flex("files")).toBe("300 1 0px");

    rerender(<Group persist={{ key: "b", storage }} />);
    expect(flex("files")).toBe("240 1 0px");
    expect(flex("preview")).toBe("360 1 0px");
    expect(saved("b")).toBeUndefined();
  });

  it("resets to the defaults, forgetting closed elements", async () => {
    const onChange = vi.fn();
    const { storage, saved } = memoryStorage({ g: layout(300, 500, 400) });
    await setup({ onChange, persist: { key: "g", storage } });

    act(() => latest.reset());
    expect(flex("files")).toBe("240 1 0px");
    expect(flex("editor")).toBe("600 1 0px");
    expect(onChange).toHaveBeenCalledOnce();
    expect(saved("g")).toEqual(layout(240, 600, 360));
  });
});

describe("useResizableLayout development warnings", () => {
  let warnings: string[] = [];
  let restoreWarn = () => {};
  beforeEach(() => {
    resetWarnings();
    warnings = [];
    const spy = vi
      .spyOn(console, "warn")
      .mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
    restoreWarn = () => spy.mockRestore();
  });
  afterEach(() => restoreWarn());

  const tree: UseResizableLayoutOptions = {
    layout: {
      id: "root",
      direction: "row",
      children: [
        { id: "a" },
        {
          id: "inner",
          direction: "column",
          children: [{ id: "b" }, { id: "c" }],
        },
      ],
    },
  };

  function Misused({ label = true }: { label?: boolean }) {
    const group = useResizableLayout(tree);
    return (
      <div {...group.getGroupProps("root")}>
        <div {...group.getElementProps("nope")} />
        <div {...group.getElementProps("inner")} />
        <div {...group.getGroupProps("a")} />
        <div {...group.getSeparatorProps("a", "c")} aria-label="Wrong pair" />
        <div
          {...group.getSeparatorProps("a", "inner")}
          aria-label={label ? "Resize a" : undefined}
        />
        <div {...group.getJunctionProps([["a", "inner"]])} />
        <div
          {...group.getJunctionProps([
            ["a", "inner"],
            ["b", "c"],
            ["a", "b"],
          ])}
        />
      </div>
    );
  }

  it("warns about ids and pairs that can't work", () => {
    render(<Misused />);
    expect(warnings).toEqual([
      expect.stringContaining(`there's no element "nope"`),
      expect.stringContaining(`"inner" is a group; use getGroupProps`),
      expect.stringContaining(`"a" is an element; use getElementProps`),
      expect.stringContaining(`("a", "c"): these aren't neighbours`),
      expect.stringContaining(`two or more separators`),
      expect.stringContaining(`"a" and "b" aren't neighbours`),
    ]);
  });

  it("warns about a junction whose separators would fight", () => {
    function Nested() {
      const group = useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "a" },
            {
              id: "inner",
              direction: "row",
              children: [{ id: "b" }, { id: "c" }],
            },
          ],
        },
      });
      return (
        <div {...group.getGroupProps("root")}>
          <div
            {...group.getJunctionProps([
              ["a", "inner"],
              ["b", "c"],
            ])}
          />
        </div>
      );
    }
    render(<Nested />);
    expect(warnings).toEqual([
      expect.stringContaining(
        `["b", "c"] moves the same space as ["a", "inner"]`,
      ),
    ]);
  });

  it("warns once about a separator without a label", () => {
    const { rerender } = render(<Misused label={false} />);
    rerender(<Misused label={false} />);
    const unlabelled = warnings.filter((message) =>
      message.includes("has no aria-label"),
    );
    expect(unlabelled).toEqual([
      expect.stringContaining(`The separator between "a" and "inner"`),
    ]);
  });
});

describe("the controller without React", () => {
  it("gives the view the hook renders from, the same object until it changes", () => {
    const controller = createLayoutController(defaults);
    const view = controller.getView();
    expect(view.elements.map((element) => element.id)).toEqual([
      "files",
      "editor",
      "preview",
    ]);
    expect(Object.keys(view.children)).toEqual(["files", "editor", "preview"]);
    // Not measured: no sizes yet.
    expect(view.children.files.size).toBeNull();
    expect(controller.getView()).toBe(view);

    const listener = vi.fn();
    controller.subscribe(listener);
    controller.setOptions({ ...defaults, layout: row(files, editor) });
    expect(listener).toHaveBeenCalled();
    const fewer = controller.getView();
    expect(fewer).not.toBe(view);
    expect(Object.keys(fewer.children)).toEqual(["files", "editor"]);
  });
});

describe("useResizableLayout with viewport units", () => {
  let viewport: ReturnType<typeof installViewport>;
  beforeEach(() => {
    viewport = installViewport(1000, 800);
  });
  afterEach(() => viewport.restore());

  it("resolves vw against the viewport, and follows it", async () => {
    await setup({
      layout: row(files, editor, { ...preview, maxSize: "30vw" }),
    });
    expect(latest.getChild("preview")?.size).toBe(300);
    act(() => viewport.resize(2000, 800));
    act(() => latest.setSize("preview", 500));
    expect(latest.getChild("preview")?.size).toBe(500);
  });

  it("resolves vw given to setSize, though the options use none", async () => {
    await setup();
    act(() => latest.setSize("files", "30vw"));
    expect(latest.getChild("files")?.size).toBe(300);
  });
});

describe("useResizableLayout reflowing once", () => {
  const contentWidth = (id: string) =>
    screen.getByTestId(id).style.getPropertyValue("--resizable-content-width");

  it("resizes as it drags, holding the children's content until it's let go", async () => {
    const onChange = vi.fn();
    await setup({ reflow: "once", onChange });
    const editorWas = latest.getChild("editor")?.size;
    const previewWas = latest.getChild("preview")?.size;
    dragSeparator("files", "editor", 60, { release: false });
    // The children follow the pointer; their content keeps its sizes, the
    // content of those that didn't move too (or it'd inherit another's).
    expect(flex("files")).toBe("300 1 0px");
    expect(latest.getChild("files")?.size).toBe(300);
    expect(contentWidth("files")).toBe("240px");
    expect(contentWidth("editor")).toBe(`${editorWas}px`);
    expect(contentWidth("preview")).toBe(`${previewWas}px`);
    expect(separator("files", "editor").style.transform).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    act(() => void pointer(window, "pointerup", { x: 560 }));
    // Released: the content takes the children's sizes.
    expect(flex("files")).toBe("300 1 0px");
    expect(contentWidth("files")).toBe("initial");
    expect(contentWidth("preview")).toBe("initial");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("holds the content through an animated change, until it's over", async () => {
    await setup({ reflow: "once" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const editorWas = latest.getChild("editor")?.size;
      // files grows into the editor: the editor's content keeps its
      // larger size until the change is over; files' takes its new one.
      act(() => latest.setSize("files", 300));
      expect(latest.animating).toBe(true);
      expect(contentWidth("files")).toBe("300px");
      expect(contentWidth("editor")).toBe(`${editorWas}px`);
      act(() => void vi.advanceTimersByTime(450));
      expect(contentWidth("editor")).toBe("initial");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the content follow the drag, reflowing live", async () => {
    await setup();
    dragSeparator("files", "editor", 60, { release: false });
    expect(flex("files")).toBe("300 1 0px");
    expect(contentWidth("files")).toBe("initial");
  });

  it("lays content out at the content size with getContentProps", async () => {
    function WithContent() {
      const group = useResizableLayout({ ...defaults, reflow: "once" });
      useLayoutEffect(() => {
        latest = group;
      });
      return (
        <div {...group.getGroupProps("root")}>
          {group.elements.map((element, index) => (
            <Fragment key={element.id}>
              {index > 0 && (
                <div
                  data-testid={`separator-${group.elements[index - 1].id}-${element.id}`}
                  {...group.getSeparatorProps(
                    group.elements[index - 1].id,
                    element.id,
                  )}
                />
              )}
              <div
                data-testid={element.id}
                {...group.getElementProps(element.id)}
              >
                <div
                  data-testid={`${element.id}-content`}
                  {...group.getContentProps(element.id)}
                />
              </div>
            </Fragment>
          ))}
        </div>
      );
    }
    render(<WithContent />);
    await report({ files: 400, editor: 400, preview: 400 });
    const content = () => screen.getByTestId("files-content").style;
    // Both ways, at least the element's size.
    expect(content().width).toBe(
      "max(100%, var(--resizable-content-width, 100%))",
    );
    expect(content().height).toBe(
      "max(100%, var(--resizable-content-height, 100%))",
    );
    dragSeparator("files", "editor", 60, { release: false });
    expect(content().width).toBe("var(--resizable-content-width, 100%)");
    act(() => void pointer(window, "pointerup", { x: 560 }));
    expect(content().width).toBe(
      "max(100%, var(--resizable-content-width, 100%))",
    );
  });

  it("holds a child's content stop until it's let go", async () => {
    await setup({
      reflow: "once",
      layout: row(
        { ...files, stops: { rail: 48, open: { min: 180 } } },
        editor,
        preview,
      ),
    });
    dragSeparator("files", "editor", -200, { release: false });
    expect(latest.getChild("files")?.stop).toBe("rail");
    expect(latest.getChild("files")?.contentStop).toBe("open");
  });
});

describe("getClipProps", () => {
  const closable = (id: string): LayoutElementOptions => ({
    id,
    defaultSize: 240,
    stops: { closed: 0, open: { min: 180 } },
  });
  const finish = async () => act(async () => void vi.advanceTimersByTime(450));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pins by place: the first child's start, the last's end, a middle one's start", async () => {
    await setup({
      layout: row(closable("files"), closable("editor"), closable("preview")),
    });
    const pin = (id: string) => latest.getClipProps(id).style.justifyContent;
    expect(pin("files")).toBe("flex-start");
    expect(pin("editor")).toBe("flex-start");
    expect(pin("preview")).toBe("flex-end");
    expect(
      latest.getClipProps("editor", { anchor: "end" }).style,
    ).toMatchObject({ justifyContent: "flex-end" });
  });

  it("slides the closing child, not the one taking its space", async () => {
    await setup({
      layout: row(closable("files"), editor, closable("preview")),
    });
    const clip = (id: string) => latest.getClipProps(id, { slide: true });
    act(() => latest.setStop("preview", "closed"));
    expect(latest.animating).toBe(true);
    // The last child, anchored at its end, slides with its start edge.
    expect(clip("preview").style.justifyContent).toBe("flex-start");
    expect(clip("preview")["data-sliding"]).toBe("");
    expect(clip("preview")["data-zero"]).toBe("");
    // The first child isn't moving to or from 0: covered.
    expect(clip("files").style.justifyContent).toBe("flex-start");
    expect(clip("files")["data-sliding"]).toBeUndefined();
    await finish();
    expect(clip("preview").style.justifyContent).toBe("flex-end");
    act(() => latest.setStop("preview", "open"));
    expect(clip("preview").style.justifyContent).toBe("flex-start");
  });

  it("pins up and down in a column, the content filling across", async () => {
    await setup({
      layout: {
        id: "root",
        direction: "column",
        children: [closable("files"), editor, preview],
      },
    });
    expect(latest.getClipProps("files", { slide: true }).style).toMatchObject({
      flexDirection: "column",
      justifyContent: "flex-start",
    });
    act(() => latest.setStop("files", "closed"));
    expect(
      latest.getClipProps("files", { slide: true }).style.justifyContent,
    ).toBe("flex-end");
  });

  it("warns for something that isn't an element", async () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setup();
    latest.getClipProps("root");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("nothing to clip"),
    );
    warn.mockRestore();
  });
});

describe("useResizableLayout's options changing", () => {
  it("answers for a stop on the render that adds it (not yet), then as usual", async () => {
    const answers: boolean[] = [];
    function Pane({ stops }: { stops: Record<string, number | object> }) {
      const layout = useResizableLayout({
        idPrefix: "p",
        elastic: false,
        layout: {
          id: "root",
          direction: "row",
          children: [
            { id: "pane", defaultStop: "open", stops },
            { id: "main", minSize: 100 },
          ],
        },
      } as UseResizableLayoutOptions) as ResizableLayout;
      if ("rail" in stops) {
        answers.push(
          layout.canSetStop("pane", "rail") &&
            layout.canToggle("pane", "rail") &&
            layout.canSetStops({ pane: "rail" }),
        );
      }
      return (
        <div {...layout.getGroupProps("root")}>
          <div data-testid="pane" {...layout.getElementProps("pane")} />
          <div data-testid="main" {...layout.getElementProps("main")} />
        </div>
      );
    }
    const { rerender } = render(
      <Pane stops={{ closed: 0, open: { min: 200 } }} />,
    );
    await act(async () => {
      observer.resize(screen.getByTestId("pane"), { width: 300, height: 300 });
      observer.resize(screen.getByTestId("main"), { width: 300, height: 300 });
    });
    rerender(<Pane stops={{ closed: 0, rail: 56, open: { min: 200 } }} />);
    expect(answers[0]).toBe(false);
    expect(answers.at(-1)).toBe(true);
  });

  it("keeps a point's CSS units before it's measured", () => {
    function Unmeasured() {
      const layout = useResizableLayout({
        idPrefix: "u",
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "half",
              defaultStop: "half",
              stops: { half: "50%", open: {} },
            },
            {
              id: "rail",
              defaultStop: "rail",
              stops: { rail: "3rem", open: {} },
            },
            { id: "main" },
          ],
        },
      });
      return (
        <div {...layout.getGroupProps("root")}>
          {(["half", "rail", "main"] as const).map((id) => (
            <div key={id} data-testid={id} {...layout.getElementProps(id)} />
          ))}
        </div>
      );
    }
    render(<Unmeasured />);
    expect(screen.getByTestId("half").style.flex).toBe("0 0 50%");
    expect(screen.getByTestId("rail").style.flex).toBe("0 0 3rem");
  });
});

describe("useResizableLayout with ids like members every object has", () => {
  const named = row(
    { ...files, id: "__proto__" },
    { ...editor, id: "constructor" },
    { ...preview, id: "toString" },
  );
  const measured = { ["__proto__"]: 400, constructor: 400, toString: 400 };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders, drags, sets stops and saves them", async () => {
    const { storage, saved } = memoryStorage();
    const { unmount } = render(
      <Group layout={named} persist={{ key: "g", storage }} />,
    );
    await report(measured);
    expect(
      latest.elements.map((element) => [element.id, element.size]),
    ).toEqual([
      ["__proto__", 240],
      ["constructor", 600],
      ["toString", 360],
    ]);
    expect(flex("constructor")).toBe("600 1 0px");
    expect(latest.getChild("valueOf")).toBeUndefined();

    dragSeparator("__proto__", "constructor", 60);
    expect(flex("__proto__")).toBe("300 1 0px");
    expect(saved("g")).toMatchObject({
      children: {
        ["__proto__"]: { stop: "open", sizes: { open: 300 } },
        constructor: { sizes: { "": 540 } },
      },
    });

    act(() => latest.setStop("__proto__", "closed"));
    expect(latest.getChild("__proto__")).toMatchObject({
      stop: "closed",
      previousStop: "open",
      fromStop: "open",
    });
    // Closing, it slides with its moving edge.
    const clip = latest.getClipProps("__proto__", { slide: true });
    expect(clip["data-sliding"]).toBe("");
    expect(clip.style.justifyContent).toBe("flex-end");
    act(() => latest.setStop("__proto__", "open"));
    expect(latest.getChild("__proto__")?.size).toBe(300);
    unmount();

    render(<Group layout={named} persist={{ key: "g", storage }} />);
    await report(measured);
    expect(flex("__proto__")).toBe("300 1 0px");
    expect(flex("constructor")).toBe("540 1 0px");
  });

  it("measures and drags in a nested group with one of those ids", async () => {
    const options: UseResizableLayoutOptions = {
      idPrefix: "n",
      elastic: false,
      layout: {
        id: "root",
        direction: "row",
        children: [
          { id: "constructor", defaultSize: 240, minSize: 180 },
          {
            id: "__proto__",
            direction: "column",
            children: [
              { id: "toString", minSize: 200 },
              { id: "valueOf", defaultSize: 200, minSize: 100 },
            ],
          },
        ],
      },
    };
    function Nested() {
      const group = useResizableLayout(options);
      useLayoutEffect(() => {
        latest = group;
      });
      return (
        <div {...group.getGroupProps("root")}>
          <div
            data-testid="constructor"
            {...group.getElementProps("constructor")}
          />
          <div data-testid="__proto__" {...group.getGroupProps("__proto__")}>
            <div
              data-testid="toString"
              {...group.getElementProps("toString")}
            />
            <div
              data-testid="separator"
              {...group.getSeparatorProps("toString", "valueOf")}
              aria-label="Resize valueOf"
            />
            <div data-testid="valueOf" {...group.getElementProps("valueOf")} />
          </div>
        </div>
      );
    }
    render(<Nested />);
    await act(async () => {
      const resize = (id: string, width: number, height: number) =>
        observer.resize(screen.getByTestId(id), { width, height });
      resize("constructor", 400, 800);
      resize("__proto__", 800, 800);
      resize("toString", 800, 400);
      resize("valueOf", 800, 400);
    });
    expect(latest.getChild("__proto__")?.size).toBe(960);
    expect(latest.getChild("valueOf")?.size).toBe(200);
    act(() => {
      pointer(screen.getByTestId("separator"), "pointerdown", { x: 0, y: 500 });
      pointer(window, "pointermove", { x: 0, y: 400 });
      frames.flushFrame();
    });
    act(() => void pointer(window, "pointerup", { x: 0, y: 400 }));
    expect(latest.getChild("valueOf")?.size).toBe(300);
  });
});
