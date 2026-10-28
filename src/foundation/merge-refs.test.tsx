// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { createRef, useLayoutEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { mergeRefs } from "./merge-refs.js";
import { useMergedRefs } from "./use-merged-refs.js";

describe("mergeRefs", () => {
  it("feeds object refs and callback refs, and cleans up both kinds", () => {
    const object = createRef<string>();
    const plain = vi.fn();
    const cleanup = vi.fn();
    const withCleanup = vi.fn(() => cleanup);

    const merged = mergeRefs(object, plain, withCleanup, undefined);
    const detach = merged("el");
    expect(object.current).toBe("el");
    expect(plain).toHaveBeenCalledWith("el");
    expect(withCleanup).toHaveBeenCalledWith("el");

    if (typeof detach === "function") {
      // React 19 runs the cleanup returned.
      detach();
      expect(cleanup).toHaveBeenCalledOnce();
    } else {
      // React 18, which warns about one, calls the ref with `null`.
      merged(null);
      expect(withCleanup).toHaveBeenLastCalledWith(null);
    }
    expect(object.current).toBeNull();
    expect(plain).toHaveBeenLastCalledWith(null);
  });
});

describe("useMergedRefs", () => {
  it("stays the same across renders, so the element isn't reattached", () => {
    const attached = vi.fn();
    const libraryRef = (element: HTMLElement | null) => {
      if (element) attached();
    };
    let seen: HTMLElement | null = null;

    function Box() {
      const [, setCount] = useState(0);
      const own = useRef<HTMLDivElement>(null);
      const ref = useMergedRefs(libraryRef, own);
      useLayoutEffect(() => {
        seen = own.current;
      });
      return (
        <div
          ref={ref}
          data-testid="box"
          onClick={() => setCount((n) => n + 1)}
        />
      );
    }

    render(<Box />);
    act(() => screen.getByTestId("box").click());
    act(() => screen.getByTestId("box").click());
    expect(attached).toHaveBeenCalledOnce();
    expect(seen).toBe(screen.getByTestId("box"));
  });
});
