// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { StrictMode, act } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installAnimationFrames,
  installPointerCapture,
  installResizeObserver,
  pointer,
} from "../../testing/dom.js";
import { memoryStorage } from "../../testing/storage.js";
import { type LayoutOptions } from "../layout/layout-config.js";
import {
  type LayoutRemoteOf,
  type UseResizableLayoutOptions,
  createLayoutRemote,
  useResizableLayout,
} from "../layout/use-resizable-layout.js";
import {
  type ResizableRemoteOf,
  type ResizableViewOf,
  type UseResizableOptions,
  createResizableRemote,
  useResizable,
} from "../resizable/use-resizable.js";
import { useResizableRemote } from "./use-resizable-remote.js";
import { resetWarnings } from "./warn.js";

let frames: ReturnType<typeof installAnimationFrames>;
let observer: ReturnType<typeof installResizeObserver>;
let restoreCapture: () => void;

beforeEach(() => {
  frames = installAnimationFrames();
  observer = installResizeObserver();
  restoreCapture = installPointerCapture();
  resetWarnings();
});

afterEach(() => {
  frames.restore();
  observer.restore();
  restoreCapture();
  vi.restoreAllMocks();
});

const sidebarOptions = {
  anchor: "left",
  width: {
    defaultSize: 250,
    stops: { closed: 0, open: { min: 200, max: 400 } },
  },
  elastic: false,
} as const satisfies UseResizableOptions;

type SidebarRemote = ResizableRemoteOf<typeof sidebarOptions>;

function Sidebar({
  remote,
  testId = "sidebar",
  ...options
}: Pick<UseResizableOptions, "persist" | "onDragEnd"> & {
  remote?: SidebarRemote;
  testId?: string;
}) {
  const sidebar = useResizable({ ...sidebarOptions, ...options, remote });
  return (
    <div data-testid={`${testId}-container`}>
      <div data-testid={testId} {...sidebar.getElementProps()}>
        <div
          data-testid={`${testId}-handle`}
          {...sidebar.getHandleProps("right")}
          aria-label="Resize sidebar"
        />
      </div>
    </div>
  );
}

function measure(testId = "sidebar") {
  act(() =>
    observer.resize(screen.getByTestId(`${testId}-container`), {
      width: 1000,
      height: 800,
    }),
  );
}

describe("remotes: attaching", () => {
  it("is null until the resizable mounts, then reaches it", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    expect(remote.current).toBeNull();
    render(<Sidebar remote={remote} />);
    measure();
    expect(remote.current?.getView().width.stop).toBe("open");
    act(() => remote.current?.toggle("closed"));
    expect(remote.current?.getView().width.stop).toBe("closed");
    expect(screen.getByTestId("sidebar").dataset.widthStop).toBe("closed");
  });

  it("tells its listeners about attaching, every change and detaching", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    const listener = vi.fn();
    remote.subscribe(listener);
    const { unmount } = render(<Sidebar remote={remote} />);
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    act(() => remote.current?.setStop("closed"));
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unmount();
    expect(listener).toHaveBeenCalled();
    expect(remote.current).toBeNull();
  });

  it("attaches after persisted state is loaded", () => {
    const { storage } = memoryStorage({
      sidebar: {
        version: 2,
        width: { stop: "closed", sizes: {}, lastRange: "open" },
      },
    });
    const remote = createResizableRemote<typeof sidebarOptions>();
    const seen: (string | null)[] = [];
    remote.subscribe(() => {
      if (seen.length === 0)
        seen.push(remote.current?.getView().width.stop ?? null);
    });
    render(<Sidebar remote={remote} persist={{ key: "sidebar", storage }} />);
    expect(seen).toEqual(["closed"]);
  });

  it("detaches before the resizable's teardown (a drag cancelled by unmounting)", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    const attachedAtEnd: unknown[] = [];
    const { unmount } = render(
      <Sidebar
        remote={remote}
        onDragEnd={() => void attachedAtEnd.push(remote.current)}
      />,
    );
    measure();
    act(() => {
      pointer(screen.getByTestId("sidebar-handle"), "pointerdown", { x: 500 });
      pointer(window, "pointermove", { x: 530 });
      frames.flushFrame();
    });
    unmount();
    expect(attachedAtEnd).toEqual([null]);
  });

  it("stays attached through Strict Mode's double effects", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    const { unmount } = render(
      <StrictMode>
        <Sidebar remote={remote} />
      </StrictMode>,
    );
    measure();
    expect(remote.current).not.toBeNull();
    act(() => remote.current?.toggle("closed"));
    expect(screen.getByTestId("sidebar").dataset.widthStop).toBe("closed");
    unmount();
    expect(remote.current).toBeNull();
  });

  it("moves to a new remote without remounting the resizable", () => {
    const first = createResizableRemote<typeof sidebarOptions>();
    const second = createResizableRemote<typeof sidebarOptions>();
    const onDragEnd = vi.fn();
    const { rerender } = render(
      <Sidebar remote={first} onDragEnd={onDragEnd} />,
    );
    measure();
    // A drag in progress survives the move: the controller stays mounted.
    act(() => {
      pointer(screen.getByTestId("sidebar-handle"), "pointerdown", { x: 500 });
      pointer(window, "pointermove", { x: 530 });
      frames.flushFrame();
    });
    rerender(<Sidebar remote={second} onDragEnd={onDragEnd} />);
    expect(first.current).toBeNull();
    expect(second.current?.getView().dragging).toBe("right");
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("is displaced by a second resizable, for good, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remote = createResizableRemote<typeof sidebarOptions>();
    function Both({ second }: { second: boolean }) {
      return (
        <>
          <Sidebar remote={remote} testId="a" />
          {second && <Sidebar remote={remote} testId="b" />}
        </>
      );
    }
    const { rerender } = render(<Both second={false} />);
    measure("a");
    rerender(<Both second />);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("second mounted resizable"),
    );
    act(() => remote.current?.toggle("closed"));
    expect(screen.getByTestId("a").dataset.widthStop).not.toBe("closed");
    // The newer one leaving doesn't bring the first back.
    rerender(<Both second={false} />);
    expect(remote.current).toBeNull();
  });

  it("stays with the newer resizable when the one it replaced unmounts", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const remote = createResizableRemote<typeof sidebarOptions>();
    function Both({ first }: { first: boolean }) {
      return (
        <>
          {first && <Sidebar remote={remote} testId="a" />}
          <Sidebar remote={remote} testId="b" />
        </>
      );
    }
    const { rerender } = render(<Both first />);
    measure("b");
    rerender(<Both first={false} />);
    act(() => remote.current?.toggle("closed"));
    expect(screen.getByTestId("b").dataset.widthStop).toBe("closed");
  });

  it("warns about a remote of the other kind, and doesn't attach it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remote = createLayoutRemote<typeof workspaceLayout>();
    render(<Sidebar remote={remote as unknown as SidebarRemote} />);
    expect(remote.current).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("A layout remote was given to useResizable"),
    );
  });
});

const workspaceLayout = {
  id: "root",
  direction: "row",
  children: [
    {
      id: "display",
      defaultSize: "50%",
      stops: { closed: 0, open: { min: 200 } },
    },
    {
      id: "note",
      defaultSize: "50%",
      stops: { closed: 0, open: { min: 200 } },
    },
  ],
} as const satisfies LayoutOptions["layout"];

type WorkspaceRemote = LayoutRemoteOf<typeof workspaceLayout>;

function Workspace({
  remote,
  ...options
}: { remote: WorkspaceRemote } & Pick<
  UseResizableLayoutOptions,
  "onChange" | "persist"
>) {
  const workspace = useResizableLayout({
    layout: workspaceLayout,
    elastic: false,
    ...options,
    remote,
  });
  return (
    <div {...workspace.getGroupProps("root")}>
      {workspace.elements.map((element) => (
        <div
          key={element.id}
          data-testid={element.id}
          {...workspace.getElementProps(element.id)}
        />
      ))}
    </div>
  );
}

async function measureWorkspace() {
  await act(async () => {
    for (const id of ["display", "note"]) {
      observer.resize(screen.getByTestId(id), { width: 500, height: 500 });
    }
  });
}

describe("remotes: layouts", () => {
  it("reaches the layout, with queries that read it as it is", async () => {
    const remote = createLayoutRemote<typeof workspaceLayout>();
    const { unmount } = render(<Workspace remote={remote} />);
    await measureWorkspace();
    const workspace = remote.current!;
    expect(workspace.canToggle("note", "closed")).toBe(true);
    // No render in between: the queries read the controller, not a render.
    workspace.toggle("note", "closed");
    expect(workspace.getView().children.note.stop).toBe("closed");
    expect(workspace.canToggle("display", "closed")).toBe(false);
    unmount();
    expect(remote.current).toBeNull();
  });
});

describe("setStops", () => {
  it("moves several children as one change, in any order", async () => {
    const remote = createLayoutRemote<typeof workspaceLayout>();
    const { storage } = memoryStorage();
    const saves = vi.spyOn(storage, "setItem");
    const onChange = vi.fn();
    render(
      <Workspace
        remote={remote}
        onChange={onChange}
        persist={{ key: "workspace", storage }}
      />,
    );
    await measureWorkspace();
    act(() => remote.current?.setStop("note", "closed"));
    onChange.mockClear();
    saves.mockClear();
    const workspace = remote.current!;
    // Written closing first: that waits for the note to open.
    const solo = { display: "closed", note: "open" } as const;
    expect(workspace.canSetStops(solo)).toBe(true);
    act(() => workspace.setStops(solo));
    const { children } = workspace.getView();
    expect([children.display.stop, children.note.stop]).toEqual([
      "closed",
      "open",
    ]);
    // Each from where it was before the batch.
    expect([children.display.fromStop, children.note.fromStop]).toEqual([
      "open",
      "closed",
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toEqual({ cause: "stop" });
    expect(saves).toHaveBeenCalledTimes(1);
    // There already: nothing to do.
    expect(workspace.canSetStops(solo)).toBe(false);
  });

  it("answers no, without a warning, for what it would refuse", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remote = createLayoutRemote<typeof workspaceLayout>();
    render(<Workspace remote={remote} />);
    await measureWorkspace();
    const both = { display: "closed", note: "closed" } as const;
    expect(remote.current!.canSetStops(both)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("types ids and stops", () => {
    const remote = createLayoutRemote<typeof workspaceLayout>();
    // @ts-expect-error: not one of the note's stops
    remote.current?.setStops({ note: "rail" });
    // @ts-expect-error: not a child
    remote.current?.setStops({ notes: "open" });
    remote.current?.setStops({ note: "open" });
    expect(remote.current).toBeNull();
  });
});

describe("useResizableRemote", () => {
  function Reader({
    remote,
    select,
    equals,
    onRender,
  }: {
    remote: SidebarRemote;
    select: (view: ResizableViewOf<typeof sidebarOptions> | null) => unknown;
    equals?: (a: unknown, b: unknown) => boolean;
    onRender?: (value: unknown) => void;
  }) {
    const value = useResizableRemote(remote, select, equals);
    onRender?.(value);
    return <output data-testid="read">{JSON.stringify(value)}</output>;
  }
  const read = () => JSON.parse(screen.getByTestId("read").textContent!);
  const stopOf = (view: { width: { stop: string | null } } | null) =>
    view?.width.stop ?? "unmounted";

  it("selects from null until the resizable mounts, then follows it", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    function App({ shown }: { shown: boolean }) {
      return (
        <>
          <Reader remote={remote} select={stopOf} />
          {shown && <Sidebar remote={remote} />}
        </>
      );
    }
    const { rerender } = render(<App shown={false} />);
    expect(read()).toBe("unmounted");
    rerender(<App shown />);
    measure();
    expect(read()).toBe("open");
    act(() => remote.current?.toggle("closed"));
    expect(read()).toBe("closed");
    rerender(<App shown={false} />);
    expect(read()).toBe("unmounted");
  });

  it("re-renders only when the selection changes", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    const renders = vi.fn();
    render(
      <>
        <Reader remote={remote} select={stopOf} onRender={renders} />
        <Sidebar remote={remote} />
      </>,
    );
    measure();
    renders.mockClear();
    // A size change within the stop: the view changes, the selection doesn't.
    act(() => remote.current?.setSize({ width: 300 }));
    act(() => remote.current?.setSize({ width: 320 }));
    expect(renders).not.toHaveBeenCalled();
  });

  it("keeps an equal selection's identity, by `equals`", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    const seen: unknown[] = [];
    const sameStops = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    render(
      <>
        <Reader
          remote={remote}
          select={(view) => [stopOf(view)]}
          equals={sameStops}
          onRender={(value) => void seen.push(value)}
        />
        <Sidebar remote={remote} />
      </>,
    );
    measure();
    const before = seen.at(-1);
    const renders = seen.length;
    act(() => remote.current?.setSize({ width: 300 }));
    expect(seen.length).toBe(renders);
    expect(seen.at(-1)).toBe(before);
  });

  it("keeps an equal selection's identity across a new inline selector", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    const seen: unknown[] = [];
    const sameStops = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    function App({ label }: { label: string }) {
      return (
        <>
          <Reader
            remote={remote}
            // A new function each render, as inline selectors are.
            select={(view) => [label, stopOf(view)]}
            equals={sameStops}
            onRender={(value) => void seen.push(value)}
          />
          <Sidebar remote={remote} />
        </>
      );
    }
    const { rerender } = render(<App label="a" />);
    measure();
    const before = seen.at(-1);
    rerender(<App label="a" />);
    expect(seen.at(-1)).toBe(before);
    // A captured value that changes the selection does change it.
    rerender(<App label="b" />);
    expect(seen.at(-1)).toEqual(["b", "open"]);
  });

  it("doesn't select again from a view it has already seen", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    const select = vi.fn(stopOf);
    const always = () => true;
    function App({ tick }: { tick: number }) {
      return (
        <>
          <output>{tick}</output>
          <Reader remote={remote} select={select} equals={always} />
          <Sidebar remote={remote} />
        </>
      );
    }
    const { rerender } = render(<App tick={0} />);
    measure();
    act(() => remote.current?.setSize({ width: 300 }));
    select.mockClear();
    // Re-rendering with nothing changed reads the same view: no selecting,
    // though `equals` kept the old selection when the view last changed.
    rerender(<App tick={1} />);
    rerender(<App tick={2} />);
    expect(select).not.toHaveBeenCalled();
  });

  it("selects from null on the server, attached or not", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    render(<Sidebar remote={remote} />);
    measure();
    expect(remote.current).not.toBeNull();
    const html = renderToString(<Reader remote={remote} select={stopOf} />);
    expect(html).toContain("unmounted");
  });

  it("reads layouts too", async () => {
    const remote = createLayoutRemote<typeof workspaceLayout>();
    function OpenIds() {
      const ids = useResizableRemote(
        remote,
        (view) =>
          view
            ? (["display", "note"] as const).filter(
                (id) => view.children[id].stop !== "closed",
              )
            : [],
        (a, b) => a.join() === b.join(),
      );
      return <output data-testid="read">{JSON.stringify(ids)}</output>;
    }
    render(
      <>
        <OpenIds />
        <Workspace remote={remote} />
      </>,
    );
    await measureWorkspace();
    expect(read()).toEqual(["display", "note"]);
    act(() => remote.current?.toggle("note", "closed"));
    expect(read()).toEqual(["display"]);
  });
});

describe("remotes: types", () => {
  it("checks a remote against the options it's given to", () => {
    const remote = createResizableRemote<typeof sidebarOptions>();
    function Typed() {
      // Other sizes, persistence and callbacks: the same contract.
      useResizable({
        anchor: "left",
        width: { defaultSize: 300, stops: { closed: 0, open: { min: 100 } } },
        persist: { key: "k" },
        onDragEnd: (target) => void target,
        remote,
      });
      useResizable({
        anchor: "left",
        width: { defaultSize: 300, stops: { closed: 0, other: 100 } },
        // @ts-expect-error: other stops
        remote,
      });
      useResizable({
        anchor: "left",
        width: {
          defaultSize: 300,
          stops: { closed: 0, open: 300, rail: 50 },
        },
        // @ts-expect-error: an extra stop
        remote,
      });
      useResizable({
        anchor: "left",
        width: { defaultSize: 300, stops: { closed: 0, open: { min: 100 } } },
        height: { defaultSize: 200 },
        // @ts-expect-error: a height, which the remote's view hasn't
        remote,
      });
      // @ts-expect-error: not one of its stops
      remote.current?.toggle("rail");
      const stop: "closed" | "open" | null | undefined =
        remote.current?.getView().width.stop;
      void stop;
      // The helper type matches, both ways.
      const annotated: ResizableRemoteOf<typeof sidebarOptions> = remote;
      const again: ResizableRemoteOf<typeof sidebarOptions> = annotated;
      void again;
      return null;
    }
    void Typed;

    const layoutRemote = createLayoutRemote<typeof workspaceLayout>();
    function TypedLayout() {
      // Other sizes and direction: the same contract.
      useResizableLayout({
        layout: {
          id: "root",
          direction: "column",
          children: [
            {
              id: "display",
              defaultSize: 100,
              stops: { closed: 0, open: { min: 50 } },
            },
            {
              id: "note",
              defaultSize: 100,
              stops: { closed: 0, open: { min: 50 } },
            },
          ],
        },
        onDragEnd: (pairs) => void pairs,
        valueText: ({ id }) => id,
        remote: layoutRemote,
      });
      useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "display",
              defaultSize: 100,
              stops: { closed: 0, open: { min: 50 } },
            },
            {
              id: "notes",
              defaultSize: 100,
              stops: { closed: 0, open: { min: 50 } },
            },
          ],
        },
        // @ts-expect-error: another id
        remote: layoutRemote,
      });
      useResizableLayout({
        layout: {
          id: "root",
          direction: "row",
          children: [
            {
              id: "display",
              defaultSize: 100,
              stops: { closed: 0, open: { min: 50 } },
            },
            {
              id: "note",
              defaultSize: 100,
              stops: { closed: 0, rail: 40, open: { min: 50 } },
            },
          ],
        },
        // @ts-expect-error: a child with other stops
        remote: layoutRemote,
      });
      // @ts-expect-error: not one of the note's stops
      layoutRemote.current?.setStop("note", "rail");
      // @ts-expect-error: not a child
      layoutRemote.current?.toggle("root", "closed");
      layoutRemote.current?.reset("root");
      const annotated: LayoutRemoteOf<typeof workspaceLayout> = layoutRemote;
      void annotated;
      return null;
    }
    void TypedLayout;
    expect(true).toBe(true);
  });
});
