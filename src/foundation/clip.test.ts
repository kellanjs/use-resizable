import { describe, expect, it } from "vitest";

import {
  type SlidingPart,
  type SlidingState,
  clipStyle,
  recordSliding,
  slidesBetween,
} from "./clip.js";
import { parseTrackOptions } from "./stops.js";

/** A sidebar's track: closed at 0, a rail, and an open range. */
const track = parseTrackOptions({
  stops: { closed: 0, rail: 56, open: { min: 200 } },
});

describe("slidesBetween", () => {
  it("slides closing to 0, and opening from 0 into a range", () => {
    expect(slidesBetween(track, "open", "closed")).toBe(true);
    expect(slidesBetween(track, "rail", "closed")).toBe(true);
    expect(slidesBetween(track, "closed", "open")).toBe(true);
  });

  it("doesn't slide into a rail or within a stop", () => {
    expect(slidesBetween(track, "open", "rail")).toBe(false);
    expect(slidesBetween(track, "closed", "rail")).toBe(false);
    expect(slidesBetween(track, "open", "open")).toBe(false);
    expect(slidesBetween(track, "closed", "closed")).toBe(false);
  });
});

describe("recordSliding", () => {
  /**
   * One part: its stop, its size as shown, and its content as laid out
   * (`content`); `after`'s `content` is its content as the change begins.
   */
  type State = SlidingState & { stop: string; size: number; content: number };
  const state = (overrides: Partial<State> = {}): State => ({
    drag: null,
    animating: false,
    fromStops: null,
    sliding: null,
    stop: "open",
    size: 300,
    content: 300,
    ...overrides,
  });
  const partsOf = (before: State, after: State) => ({
    width: {
      config: track,
      stop: after.stop,
      size: before.size,
      content: before.content,
      contentAfter: after.content,
    } satisfies SlidingPart,
  });
  /**
   * An animated change from `before` to `stop`, beginning, its content
   * laid out at `content` as it does (by default, as it was).
   */
  const change = (before: State, stop: string, content = before.content) =>
    recordSliding(
      before,
      {
        ...before,
        animating: true,
        stop,
        content,
        fromStops: { width: before.fromStops?.width ?? before.stop },
      },
      true,
      partsOf,
    ).sliding;

  it("is null at rest", () => {
    const after = state({ sliding: { width: true } });
    expect(recordSliding(state(), after, false, partsOf).sliding).toBeNull();
  });

  it("slides closing from rest, and opening from 0", () => {
    expect(change(state(), "closed")).toEqual({ width: true });
    // At 0 nothing shows: laid out at its open size, it slides in.
    expect(
      change(state({ stop: "closed", size: 0, content: 300 }), "open"),
    ).toEqual({ width: true });
  });

  it("covers a change that doesn't close or open", () => {
    expect(change(state(), "rail")).toEqual({ width: false });
  });

  it("covers closing from a rail, whose content isn't flush with it", () => {
    // At the rail, the content is laid out at the size it reopens at:
    // pinned to the moving edge at once, it would jump.
    expect(
      change(state({ stop: "rail", size: 56, content: 300 }), "closed"),
    ).toEqual({ width: false });
  });

  it("keeps sliding through an animation it interrupts, if that moves nothing", () => {
    // Opening from 0 (sliding), shown at 120 with its content at 300,
    // interrupted on its way to a rail: still against the moving edge.
    const opening = state({
      animating: true,
      fromStops: { width: "closed" },
      sliding: { width: true },
      size: 120,
      content: 300,
    });
    expect(change(opening, "rail")).toEqual({ width: true });
  });

  it("covers a pane reopened just after it started closing", () => {
    // Closing from 256 (sliding, its content at 256), reopened at once,
    // shown at 250: it wants to slide in from 0, but laid out at its open
    // size (511) against the moving edge, it would show its far end.
    const closing = state({
      animating: true,
      fromStops: { width: "open" },
      sliding: { width: true },
      stop: "closed",
      size: 250,
      content: 256,
    });
    expect(change(closing, "open", 511)).toEqual({ width: false });
  });

  it("slides a pane closing as it grows, its content following its edge", () => {
    // Growing as a neighbour closed, shown at 256 (its content too), then
    // closed itself: it leaves as it was, sliding.
    const growing = state({
      animating: true,
      fromStops: { width: "open" },
      size: 256,
      content: 256,
    });
    expect(change(growing, "closed", 256)).toEqual({ width: true });
  });

  it("slides a drag that starts at 0, and covers one that doesn't", () => {
    const press = (before: State) =>
      recordSliding(before, { ...before, drag: {} }, false, partsOf).sliding;
    expect(press(state({ stop: "closed", size: 0 }))).toEqual({ width: true });
    expect(press(state())).toEqual({ width: false });
  });

  it("decides again as a drag's release starts animating", () => {
    const release = (before: State, stop: string, content = before.content) =>
      recordSliding(
        before,
        { ...before, drag: null, animating: true, stop, content },
        false,
        partsOf,
      ).sliding;
    // Dragged from open to 270 (the content following it), then closed:
    // flush, so it slides.
    const dragged = state({
      drag: {},
      fromStops: { width: "open" },
      sliding: { width: false },
      size: 270,
      content: 270,
    });
    expect(release(dragged, "closed")).toEqual({ width: true });
    // Reflowing once, the content was held at 300 in a 270 element: it
    // stays covered rather than jumping to the moving edge.
    expect(release({ ...dragged, content: 300 }, "closed")).toEqual({
      width: false,
    });
    // Pulled out of 0 (sliding) into a range that ends drags: it goes on
    // sliding.
    const pulled = state({
      drag: {},
      fromStops: { width: "closed" },
      sliding: { width: true },
      stop: "closed",
      size: 10,
      content: 300,
    });
    expect(release(pulled, "open")).toEqual({ width: true });
  });

  it("keeps the decision through the change", () => {
    const closing = state({
      animating: true,
      fromStops: { width: "open" },
      sliding: { width: true },
      stop: "closed",
    });
    expect(recordSliding(closing, { ...closing }, false, partsOf)).toEqual(
      closing,
    );
  });
});

describe("clipStyle", () => {
  it("fills the element, clips, and pins the content with flexbox", () => {
    expect(clipStyle({ horizontal: "right", vertical: null })).toEqual({
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      display: "flex",
      flexDirection: undefined,
      justifyContent: "right",
      alignItems: undefined,
    });
  });

  it("pins both ways in a row, logical sides as flex ones", () => {
    expect(
      clipStyle({ horizontal: "start", vertical: "bottom" }),
    ).toMatchObject({ justifyContent: "flex-start", alignItems: "flex-end" });
    expect(
      clipStyle({ horizontal: "center", vertical: "center" }),
    ).toMatchObject({ justifyContent: "center", alignItems: "center" });
  });

  it("is a column when only the height is pinned, so the content fills across", () => {
    expect(clipStyle({ horizontal: null, vertical: "bottom" })).toMatchObject({
      flexDirection: "column",
      justifyContent: "flex-end",
      alignItems: undefined,
    });
  });
});
