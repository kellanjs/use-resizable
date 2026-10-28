import { describe, expect, it, vi } from "vitest";

import type { HandleEdge } from "../foundation/handle.js";
import { stretch } from "../foundation/limits.js";
import { parseOffset } from "../foundation/size.js";
import { UNNAMED } from "../foundation/stops.js";
import {
  endAnimation,
  setReducedMotion,
  startAnimation,
} from "../foundation/transition.js";
import { resetWarnings } from "../foundation/warn.js";
import {
  type ResizableOptions,
  type ResizableState,
  anchorsOf,
  createResizableState,
  parseResizableOptions,
} from "./resizable-config.js";
import {
  applyKeyboard,
  cancelDrag,
  dimensionsWithStop,
  endDrag,
  getResizableContentRendering,
  getResizableRendering,
  handleReach,
  holdContent,
  measure,
  measureOwn,
  moveByKeyboard,
  moveDrag,
  playsTransition,
  setConfig,
  setPosition,
  setSize,
  setStop,
  startDrag,
} from "./resizable-model.js";
import {
  isResizableSnapshot,
  resetToDefaults,
  restoreSnapshot,
  toSnapshot,
} from "./resizable-snapshot.js";

/** A left-anchored sidebar with one unnamed range: the simplest case. */
const sidebar: ResizableOptions = {
  anchor: "left",
  width: { defaultSize: "25%", minSize: 200, maxSize: ["30rem", "50%"] },
};

/** The same sidebar, closable: a point at 0 below its open range. */
const closable: ResizableOptions = {
  anchor: "left",
  width: {
    defaultSize: "25%",
    stops: { closed: 0, open: { min: 200, max: ["30rem", "50%"] } },
  },
};

/** The same sidebar with an icon rail (3rem = 48px) and then hidden. */
const railed: ResizableOptions = {
  anchor: "left",
  width: {
    defaultSize: "25%",
    stops: {
      hidden: 0,
      rail: "3rem",
      open: { min: 200, max: ["30rem", "50%"] },
    },
  },
  elastic: false,
};

/** An image anchored top-left: two dimensions with a corner. */
const image: ResizableOptions = {
  anchor: "top-left",
  width: { defaultSize: 400, minSize: 100, maxSize: "100%" },
  height: { defaultSize: 300, minSize: 50 },
};

/** Builds a state measured in a 1000×800 container with a 16px root font. */
function create(
  options: ResizableOptions,
  width = 1000,
  height = 800,
): ResizableState {
  return measure(createResizableState(parseResizableOptions(options)), {
    width,
    height,
    rootFontSize: 16,
    viewport: null,
  });
}

const widthOf = (state: ResizableState) =>
  getResizableRendering(state).width?.size;
const heightOf = (state: ResizableState) =>
  getResizableRendering(state).height?.size;
const stopOf = (state: ResizableState) =>
  getResizableRendering(state).width?.stop;

function drag(
  state: ResizableState,
  handle: HandleEdge,
  dx: number,
  dy = 0,
  measured?: { width: number; height: number },
) {
  return moveDrag(startDrag(state, handle, measured), dx, dy);
}

describe("stretching past a stop reached only by name", () => {
  it("keeps stretching when the pointer passes 0", () => {
    const byName: ResizableOptions = {
      anchor: "left",
      width: {
        defaultSize: 250,
        stops: { closed: { size: 0, onlyByName: true }, open: { min: 200 } },
      },
    };
    const state = create(byName);
    // Below the minimum it stretches; asking for less than 0 doesn't snap
    // it back to 200, as if it had passed through "closed".
    expect(widthOf(drag(state, "right", -100))).toBeLessThan(200);
    expect(widthOf(drag(state, "right", -300))).toBeLessThan(
      widthOf(drag(state, "right", -100))!,
    );
  });
});

const resize = (state: ResizableState, container: number) =>
  measure(state, {
    width: container,
    height: 800,
    rootFontSize: 16,
    viewport: null,
  });

const px = (value: number) => ({ value, unit: "px" }) as const;
const move = (delta: number) => ({ kind: "move", delta }) as const;

describe("setup", () => {
  it("reads anchors like CSS background-position", () => {
    expect(anchorsOf("left")).toEqual({ width: "left", height: "center" });
    expect(anchorsOf("bottom-right")).toEqual({
      width: "right",
      height: "bottom",
    });
    expect(anchorsOf("top")).toEqual({ width: "center", height: "top" });
    expect(anchorsOf("center")).toEqual({ width: "center", height: "center" });
  });

  it("derives handles from the anchor and the resizable dimensions", () => {
    expect(parseResizableOptions(sidebar).handles).toEqual(["right"]);
    expect(parseResizableOptions(image).handles).toEqual([
      "right",
      "bottom",
      "bottom-right",
    ]);
    expect(
      parseResizableOptions({ ...image, anchor: "center" }).handles,
    ).toHaveLength(8);
  });

  it("accepts a subset of the handles and rejects ones the anchor doesn't allow", () => {
    expect(
      parseResizableOptions({ ...image, handles: ["bottom-right"] }).handles,
    ).toEqual(["bottom-right"]);
    expect(() =>
      parseResizableOptions({ ...sidebar, handles: ["left"] }),
    ).toThrow(/isn't available with anchor "left"/);
  });

  it("resolves logical anchors and handles by direction", () => {
    const start = { ...sidebar, anchor: "start" } as const;
    expect(parseResizableOptions(start).handles).toEqual(["right"]);
    expect(parseResizableOptions(start, true).handles).toEqual(["left"]);
    const corner = { ...image, anchor: "top-start" } as const;
    expect(parseResizableOptions(corner, true).handles).toEqual([
      "left",
      "bottom",
      "bottom-left",
    ]);
    expect(
      parseResizableOptions({ ...corner, handles: ["bottom-end"] }, true)
        .handles,
    ).toEqual(["bottom-left"]);
    // An error names the handle and anchor as given.
    expect(() =>
      parseResizableOptions({ ...start, handles: ["start"] }, true),
    ).toThrow(
      `Handle "start" (here "right") isn't available with anchor "start" (here "right")`,
    );
  });

  it("needs at least one dimension", () => {
    expect(() => parseResizableOptions({ anchor: "left" })).toThrow(
      /width`, `height`/,
    );
  });

  it("rejects an unknown default stop", () => {
    expect(() =>
      parseResizableOptions({
        ...railed,
        width: { ...railed.width!, defaultStop: "tiny" },
      }),
    ).toThrow(/Unknown stop "tiny"/);
  });
});

describe("before measurement", () => {
  const unmeasured = createResizableState(parseResizableOptions(image));

  it("renders the specs as CSS so the browser can size the element", () => {
    const view = getResizableRendering(unmeasured);
    expect(view.width).toMatchObject({
      size: null,
      css: "clamp(100px, 400px, 100%)",
    });
    expect(view.height).toMatchObject({ size: null, css: "max(50px, 300px)" });
  });

  it("renders a point's size when starting at one", () => {
    const options = {
      ...railed,
      width: { ...railed.width!, defaultStop: "rail" },
    };
    const state = createResizableState(parseResizableOptions(options));
    expect(getResizableRendering(state).width).toMatchObject({
      css: "3rem",
      stop: "rail",
    });
  });

  it("renders the default size while it isn't known which stop it lands in", () => {
    const state = createResizableState(parseResizableOptions(railed));
    expect(getResizableRendering(state).width).toMatchObject({
      css: "25%",
      stop: null,
    });
  });

  it("can't be dragged yet", () => {
    expect(startDrag(unmeasured, "right")).toBe(unmeasured);
  });
});

describe("size", () => {
  it("resolves the default against the container", () => {
    expect(widthOf(create(sidebar))).toBe(250);
    expect(getResizableRendering(create(sidebar)).width?.css).toBe("250px");
  });

  it("keeps a relative default relative as the container changes", () => {
    expect(widthOf(resize(create(sidebar), 1200))).toBe(300);
  });

  it("resolves % heights against the container's height", () => {
    const tall = create({ anchor: "top", height: { defaultSize: "50%" } });
    expect(heightOf(tall)).toBe(400);
  });

  it("keeps within its stop, then returns to the chosen size when there's room", () => {
    const chosen = setSize(create(sidebar), "width", px(450));
    expect(widthOf(chosen)).toBe(450);
    const narrow = resize(chosen, 600); // max is now min(480, 300)
    expect(widthOf(narrow)).toBe(300);
    expect(widthOf(resize(narrow, 1000))).toBe(450);
  });

  it("follows the root font size for rem limits", () => {
    const big = create({
      anchor: "left",
      width: { defaultSize: 900, maxSize: "30rem" },
    });
    expect(widthOf(big)).toBe(480);
    expect(
      widthOf(
        measure(big, {
          width: 1000,
          height: 800,
          rootFontSize: 20,
          viewport: null,
        }),
      ),
    ).toBe(600);
  });

  it("lands a requested size like a drag would", () => {
    // 50 is nearer closed (0) than open (200).
    expect(stopOf(setSize(create(closable), "width", px(50)))).toBe("closed");
    const relative = setSize(create(closable), "width", {
      value: 30,
      unit: "%",
    });
    expect(stopOf(relative)).toBe("open");
    // Inside a range it's kept as given, so a % stays relative.
    expect(widthOf(resize(relative, 1200))).toBe(360);
  });
});

describe("dragging an edge", () => {
  it("grows and shrinks with the drag", () => {
    expect(widthOf(drag(create(sidebar), "right", 50))).toBe(300);
    expect(widthOf(drag(create(sidebar), "right", -30))).toBe(220);
  });

  it("grows toward the left when anchored right", () => {
    const docked = create({ ...sidebar, anchor: "right" });
    expect(widthOf(drag(docked, "left", -50))).toBe(300);
  });

  it("changes the size twice as fast when centre-anchored, so the edge tracks the pointer", () => {
    const centred = create({ anchor: "center", width: { defaultSize: 400 } });
    expect(widthOf(drag(centred, "right", 10))).toBe(420);
    expect(widthOf(drag(centred, "left", -10))).toBe(420);
  });

  it("stretches past max while dragging and settles on release", () => {
    const pulled = drag(create(sidebar), "right", 400); // asks for 650, max is 480
    expect(widthOf(pulled)).toBe(
      480 + stretch(170, { distance: 16, tension: 0.8 }),
    );
    const released = endDrag(pulled);
    expect(widthOf(released)).toBe(480);
    expect(released.width?.sizes[UNNAMED]).toEqual(px(480));
  });

  it("stops dead at the limits when elastic is off", () => {
    expect(
      widthOf(drag(create({ ...sidebar, elastic: false }), "right", 400)),
    ).toBe(480);
  });

  it("snaps across a gap past halfway, and back when dragged back", () => {
    // Halfway between closed (0) and open's min (200) is 100.
    const shut = drag(create(closable), "right", -150);
    expect(getResizableRendering(shut).width).toMatchObject({
      size: 0,
      stop: "closed",
    });
    expect(stopOf(moveDrag(shut, -100, 0))).toBe("open");
  });

  it("remembers the size a range had", () => {
    const resized = setSize(create(closable), "width", px(320));
    const shut = endDrag(drag(resized, "right", -300));
    expect(shut.width).toEqual({
      stop: "closed",
      sizes: { open: px(320) },
      lastRange: "open",
      from: "open",
    });
    expect(widthOf(setStop(shut, ["width"], "open"))).toBe(320);
  });

  it("can be dragged open from a point", () => {
    const options = {
      ...closable,
      width: { ...closable.width!, defaultStop: "closed" },
    };
    const opened = endDrag(drag(create(options), "right", 260));
    expect(getResizableRendering(opened).width).toMatchObject({
      size: 260,
      stop: "open",
    });
  });

  it("stays in its one range when there's nowhere else to go", () => {
    const pulled = drag(create(sidebar), "right", -240);
    expect(widthOf(pulled)).toBeLessThan(200); // elastic stretch below min
    expect(widthOf(endDrag(pulled))).toBe(200);
  });

  it("forgets the drag on cancel", () => {
    const before = create(sidebar);
    const cancelled = cancelDrag(drag(before, "right", 120));
    expect(widthOf(cancelled)).toBe(250);
    expect(cancelled.width).toBe(before.width);
  });

  it("only moves the dimension the edge belongs to", () => {
    const dragged = drag(create(image), "right", 50, 70);
    expect(widthOf(dragged)).toBe(450);
    expect(heightOf(dragged)).toBe(300);
  });

  it("ignores handles it doesn't offer and drags while disabled", () => {
    const state = create(image);
    expect(startDrag(state, "left")).toBe(state);
    const disabled = create({ ...image, disabled: true });
    expect(startDrag(disabled, "right")).toBe(disabled);
  });
});

describe("dragging a corner", () => {
  it("moves both edges at once", () => {
    const dragged = drag(create(image), "bottom-right", 50, 70);
    expect(widthOf(dragged)).toBe(450);
    expect(heightOf(dragged)).toBe(370);

    const released = endDrag(dragged);
    expect(released.width?.sizes[UNNAMED]).toEqual(px(450));
    expect(released.height?.sizes[UNNAMED]).toEqual(px(370));
  });

  it("applies each dimension's own direction and anchor", () => {
    const widget = create({
      anchor: "bottom-right",
      width: { defaultSize: 300 },
      height: { defaultSize: 400 },
    });
    // Up and to the left grows a bottom-right anchored widget.
    const dragged = drag(widget, "top-left", -40, -60);
    expect(widthOf(dragged)).toBe(340);
    expect(heightOf(dragged)).toBe(460);
  });
});

describe("transitions", () => {
  const transitionOf = (state: ResizableState) =>
    getResizableRendering(state).transition;
  const toRail = (state: ResizableState) => setStop(state, ["width"], "rail");

  it("animates committed changes but not live drags", () => {
    const dragging = drag(create(sidebar), "right", 40);
    expect(transitionOf(dragging)).toBeUndefined();
    expect(transitionOf(endDrag(dragging))).toBe(
      "width 400ms cubic-bezier(0.22, 1, 0.36, 1)",
    );
  });

  it("starts a drag mid-animation from the size it's shown at", () => {
    // Opening from 0 to 250, caught at 230: the edge stays under the pointer.
    const opening = startAnimation(
      setStop(setStop(create(sidebar), ["width"], "closed"), ["width"], "open"),
    );
    const caught = moveDrag(
      startDrag(opening, "right", { width: 230, height: 800 }),
      3,
      0,
    );
    expect(widthOf(caught)).toBe(233);
    // Not animating: the measured size is only for app-sized dimensions.
    const still = moveDrag(
      startDrag(create(sidebar), "right", { width: 230, height: 800 }),
      3,
      0,
    );
    expect(widthOf(still)).toBe(253);
  });

  it("keeps animating through options passed again mid-animation", () => {
    // Options derived from the value that just changed come back in the
    // same commit: they mustn't cut the animation short.
    const sized = startAnimation(setSize(create(sidebar), "width", px(300)));
    const again = setConfig(
      sized,
      parseResizableOptions({ ...sidebar, transition: true }),
    );
    expect(transitionOf(again)).toBe(
      "width 400ms cubic-bezier(0.22, 1, 0.36, 1)",
    );
  });

  it("animates every resizable dimension", () => {
    expect(
      transitionOf(endDrag(drag(create(image), "bottom-right", 10, 10))),
    ).toBe(
      "width 400ms cubic-bezier(0.22, 1, 0.36, 1), height 400ms cubic-bezier(0.22, 1, 0.36, 1)",
    );
  });

  it("doesn't animate changes that come from measurement", () => {
    expect(transitionOf(resize(toRail(create(railed)), 900))).toBeUndefined();
  });

  it("times each kind of change as configured", () => {
    const state = create({
      ...railed,
      transition: {
        duration: 300,
        changes: { stop: { duration: 600 }, keyboard: false },
      },
    });
    expect(transitionOf(toRail(state))).toMatch(/^width 600ms /);
    expect(transitionOf(endDrag(drag(state, "right", 20)))).toMatch(
      /^width 300ms /,
    );
    expect(
      transitionOf(applyKeyboard(state, "right", move(10))),
    ).toBeUndefined();
  });

  it("uses reducedMotion's transition when motion is reduced", () => {
    const state = setReducedMotion(
      create({ ...railed, transition: { reducedMotion: { duration: 120 } } }),
      true,
    );
    expect(transitionOf(toRail(state))).toMatch(/^width 120ms /);
  });

  it("respects reduced motion and `transition: false`", () => {
    expect(
      transitionOf(toRail(setReducedMotion(create(railed), true))),
    ).toBeUndefined();
    expect(
      transitionOf(toRail(create({ ...railed, transition: false }))),
    ).toBeUndefined();
  });
});

describe("stretching in a drag across stops", () => {
  const railed: ResizableOptions = {
    anchor: "left",
    width: {
      defaultStop: "rail",
      stops: { rail: 56, open: { min: 192, max: 448 } },
    },
  };

  it("snaps open crisply, and resists at the max and at the min on the way back", () => {
    const start = startDrag(create(railed), "right");
    // Past the gap's middle (124), short of open: at its edge, no lean.
    const out = moveDrag(start, 100, 0);
    expect(widthOf(out)).toBe(192);
    // Pushed past the max: resistance.
    const far = moveDrag(out, 500, 0);
    expect(widthOf(far)).toBeGreaterThan(448);
    // Back below the min, having been in open: resistance there too.
    const back = moveDrag(far, 110, 0);
    expect(stopOf(back)).toBe("open");
    expect(widthOf(back)).toBeLessThan(192);
    // The same pointer, never having reached open: no stretch.
    expect(widthOf(moveDrag(start, 110, 0))).toBe(192);
  });
});

describe("holding content, reflowing once", () => {
  it("stops holding once reflowing once is off", () => {
    // Held through a change, then switched to live mid-animation: the
    // content follows the element again.
    const once = create({ ...sidebar, reflow: "once" });
    const held = holdContent(
      once,
      startAnimation(setSize(once, "width", px(210))),
    );
    expect(held.heldContent).not.toBeNull();
    expect(getResizableContentRendering(held).width?.contentSize).toBe(250);
    const live = setConfig(held, parseResizableOptions(sidebar));
    expect(getResizableContentRendering(live).width?.contentSize).toBe(210);
  });
});

describe("stops that end drags", () => {
  /** The closable sidebar, whose closed stop ends a drag. */
  const ending: ResizableOptions = {
    anchor: "left",
    width: {
      defaultSize: "25%",
      stops: {
        closed: { size: 0, endsDrag: true },
        open: { min: 200, max: ["30rem", "50%"] },
      },
    },
  };

  it("ends the drag on landing there, committing it to animate", () => {
    // From 250: the pointer at 150 holds open; at 50 (past the dividing point at 100)
    // it lands in closed, which ends the drag.
    const held = drag(create(ending), "right", -100);
    expect(held.drag).not.toBeNull();
    const shut = moveDrag(held, -200, 0);
    expect(shut.drag).toBeNull();
    expect(widthOf(shut)).toBe(0);
    expect(getResizableRendering(shut).width?.stop).toBe("closed");
    expect(getResizableRendering(shut).transition).toBeDefined();
    // The rest of the gesture is ignored.
    expect(moveDrag(shut, 0, 0)).toBe(shut);
  });

  it("ends a drag passing one closer to the next than a step", () => {
    // 1px apart, and centred: the width grows twice as fast as the pointer.
    for (const anchor of ["left", "center"] as const) {
      const close = create({
        anchor,
        width: {
          defaultStop: "a",
          stops: { a: 100, b: { size: 101, endsDrag: true }, c: 102 },
        },
        elastic: false,
      });
      const moved = moveDrag(startDrag(close, "right"), 4, 0);
      expect(moved.drag).toBeNull();
      expect(getResizableRendering(moved).width?.stop).toBe("b");
    }
  });

  it("ends a drag that passes through, however fast", () => {
    // From hidden, a rail that ends drags, then open. One move of 250 jumps
    // the pointer from hidden to open; the drag still stops at the rail.
    const railed = create({
      anchor: "left",
      width: {
        defaultStop: "hidden",
        stops: {
          hidden: { size: 0, onlyByName: true },
          rail: { size: 56, endsDrag: true },
          open: { min: 200 },
        },
      },
    });
    const opened = moveDrag(startDrag(railed, "right"), 250, 0);
    expect(opened.drag).toBeNull();
    expect(getResizableRendering(opened).width).toMatchObject({
      size: 56,
      stop: "rail",
    });
  });

  it("closes with its content at the size it had, not the size it reopens at", () => {
    // From 250, squeezed to 220 by the drag, then closed by it: it reopens
    // at 250, but the content on screen is 220 wide.
    const held = drag(create(ending), "right", -30);
    expect(getResizableContentRendering(held).width?.contentSize).toBe(220);
    const shut = moveDrag(held, -200, 0);
    // As the controller does, as the change starts animating.
    const closing = startAnimation(holdContent(held, shut));
    expect(getResizableContentRendering(closing).width).toMatchObject({
      size: 0,
      contentSize: 220,
      contentStop: "open",
    });
    // At rest at 0, it's laid out at the size it reopens at.
    expect(
      getResizableContentRendering(endAnimation(closing)).width?.contentSize,
    ).toBe(250);
  });

  it("closes mid-animation with its content as it's shown, not where it was going", () => {
    // Animating from 250 to 400 (its content following its edge), closed
    // when it's shown at 300: it leaves at 300.
    const start = create(ending);
    const growing = startAnimation(
      holdContent(start, setSize(start, "width", px(400))),
    );
    const closed = setStop(growing, ["width"], "closed");
    const shown = { width: 300, height: 800 };
    const closing = startAnimation(holdContent(growing, closed, shown));
    expect(getResizableContentRendering(closing).width?.contentSize).toBe(300);
    // Without knowing where it's shown: where it was going.
    const guessed = startAnimation(holdContent(growing, closed));
    expect(getResizableContentRendering(guessed).width?.contentSize).toBe(400);
  });

  it("closes with the content it held, reflowing once", () => {
    // Held at 250 through the drag, so it leaves at 250.
    const held = drag(create({ ...ending, reflow: "once" }), "right", -30);
    expect(getResizableContentRendering(held).width?.contentSize).toBe(250);
    const closing = startAnimation(holdContent(held, moveDrag(held, -200, 0)));
    expect(getResizableContentRendering(closing).width?.contentSize).toBe(250);
  });

  it("closes a ratio-locked element with its height following", () => {
    const video = create({
      anchor: "top-left",
      width: {
        defaultSize: 320,
        stops: { closed: { size: 0, endsDrag: true }, open: { min: 160 } },
      },
      aspectRatio: 16 / 9,
    });
    const held = drag(video, "right", -40);
    const closing = startAnimation(holdContent(held, moveDrag(held, -400, 0)));
    const { width, height } = getResizableContentRendering(closing);
    expect(width?.contentSize).toBe(280);
    expect(height?.contentSize).toBe(157.5);
  });

  describe("pulled open: a range that ends drags", () => {
    /** Pulled out of 0, it stretches; arriving in open ends the drag. */
    const pull = create({
      anchor: "left",
      width: {
        defaultSize: 360,
        stops: {
          closed: { size: 0, elastic: true },
          open: { min: 280, max: 600, endsDrag: true },
        },
      },
    });
    const closedFrom = (size: number) =>
      setStop(setSize(pull, "width", px(size)), ["width"], "closed");

    it("goes there at the size it remembers, not where the pointer is", () => {
      const opened = drag(closedFrom(450), "right", 200);
      expect(opened.drag).toBeNull();
      expect(getResizableRendering(opened).width).toMatchObject({
        stop: "open",
        size: 450,
      });
      // And still remembers it.
      const again = setStop(
        setStop(opened, ["width"], "closed"),
        ["width"],
        "open",
      );
      expect(widthOf(again)).toBe(450);
    });

    it("goes there at its default size if it remembers none", () => {
      const closed = setStop(pull, ["width"], "closed");
      expect(widthOf(drag(closed, "right", 200))).toBe(360);
    });

    it("keeps a drag that starts there where the pointer leaves it", () => {
      const held = drag(pull, "right", 50);
      expect(held.drag).not.toBeNull();
      expect(widthOf(endDrag(held))).toBe(410);
    });
  });

  it("ends a drag arriving there, not one leaving", () => {
    const closed = setStop(create(ending), ["width"], "closed");
    const opening = drag(closed, "right", 250);
    expect(opening.drag).not.toBeNull();
    expect(getResizableRendering(opening).width?.stop).toBe("open");
    // Back across the dividing point in the same drag: arriving, so it ends.
    expect(moveDrag(opening, 10, 0).drag).toBeNull();
  });
});

describe("resetting one dimension", () => {
  it("puts just that dimension back", () => {
    const moved = drag(create(image), "bottom-right", 40, 25);
    const reset = resetToDefaults(endDrag(moved), "width");
    expect(widthOf(reset)).toBe(400);
    expect(getResizableRendering(reset).height?.size).toBe(325);
  });

  it("reopens a closed dimension", () => {
    const shut = setStop(create(closable), ["width"], "closed");
    expect(
      getResizableRendering(resetToDefaults(shut, "width")).width,
    ).toMatchObject({ size: 250, stop: "open" });
  });
});

describe("range size", () => {
  const width = (state: ResizableState) => getResizableRendering(state).width;

  it("follows the size in a range and keeps it at a point", () => {
    const state = create(railed);
    expect(width(state)?.contentSize).toBe(250);
    expect(width(drag(state, "right", 50))?.contentSize).toBe(300);
    const rail = setStop(state, ["width"], "rail");
    expect(width(rail)).toMatchObject({ size: 48, contentSize: 250 });
  });

  it("is unknown before measuring", () => {
    const state = createResizableState(parseResizableOptions(railed));
    expect(width(state)?.contentSize).toBeNull();
  });
});

describe("animating and hiding", () => {
  const close = (state: ResizableState) => setStop(state, ["width"], "closed");

  it("knows which changes play a transition", () => {
    const state = create(closable);
    expect(playsTransition(state, close(state))).toBe(true);
    // Released past a limit: the settle animates.
    const pulled = drag(create(sidebar), "right", 400);
    expect(playsTransition(pulled, endDrag(pulled))).toBe(true);
    // Nothing moves, or the change doesn't animate.
    expect(playsTransition(close(state), close(close(state)))).toBe(false);
    expect(playsTransition(state, resize(state, 900))).toBe(false);
    const reduced = setReducedMotion(state, true);
    expect(playsTransition(reduced, close(reduced))).toBe(false);
  });

  it("hides an element resting at 0 once it has finished animating", () => {
    const shut = close(create(closable));
    expect(getResizableRendering(shut).hidden).toBe(true);
    const closing = startAnimation(shut);
    expect(getResizableRendering(closing)).toMatchObject({
      animating: true,
      hidden: false,
    });
    expect(getResizableRendering(endAnimation(closing))).toMatchObject({
      animating: false,
      hidden: true,
    });
    expect(getResizableRendering(create(closable)).hidden).toBe(false);
  });

  it("doesn't hide anything with hideAtZero: false", () => {
    const shut = close(create({ ...closable, hideAtZero: false }));
    expect(getResizableRendering(shut).hidden).toBe(false);
  });

  it("hides one that starts closed, even before measuring", () => {
    const options = {
      ...closable,
      width: { ...closable.width!, defaultStop: "closed" },
    };
    const unmeasured = createResizableState(parseResizableOptions(options));
    expect(getResizableRendering(unmeasured).hidden).toBe(true);
  });

  it("isn't animating while dragging", () => {
    const closing = startAnimation(close(create(closable)));
    const dragging = startDrag(closing, "right");
    expect(getResizableRendering(dragging).animating).toBe(false);
  });
});

describe("keyboard", () => {
  it("moves the edge by the given amount", () => {
    expect(widthOf(applyKeyboard(create(sidebar), "right", move(10)))).toBe(
      260,
    );
    expect(
      widthOf(
        applyKeyboard(
          create({ ...sidebar, anchor: "right" }),
          "left",
          move(10),
        ),
      ),
    ).toBe(240);
    expect(heightOf(applyKeyboard(create(image), "bottom", move(10)))).toBe(
      310,
    );
  });

  it("stops at a range's edge, then jumps to the next stop", () => {
    const atMin = applyKeyboard(create(closable), "right", move(-100));
    expect(widthOf(atMin)).toBe(200);
    expect(stopOf(applyKeyboard(atMin, "right", move(-10)))).toBe("closed");
  });

  it("stays within the stop with keyboard.jump off", () => {
    const options = { ...closable, keyboard: { jump: false } };
    const atMin = applyKeyboard(create(options), "right", move(-100));
    expect(widthOf(atMin)).toBe(200);
    expect(applyKeyboard(atMin, "right", move(-10))).toBe(atMin);
    // Enter still reaches the other stops.
    expect(stopOf(applyKeyboard(atMin, "right", { kind: "toggle" }))).toBe(
      "closed",
    );
  });

  it("toggles the stop named by enterToggles, or none", () => {
    const toggle = (enterToggles: string | false) =>
      applyKeyboard(
        create({ ...railed, width: { ...railed.width!, enterToggles } }),
        "right",
        { kind: "toggle" },
      );
    expect(stopOf(toggle("rail"))).toBe("rail");
    const state = create(railed);
    expect(stopOf(applyKeyboard(state, "right", { kind: "toggle" }))).toBe(
      "hidden",
    );
    const none = create({
      ...railed,
      width: { ...railed.width!, enterToggles: false },
    });
    expect(applyKeyboard(none, "right", { kind: "toggle" })).toBe(none);
  });

  it("stays at the edge when there's no stop beyond it", () => {
    const atMin = applyKeyboard(create(sidebar), "right", move(-100));
    expect(applyKeyboard(atMin, "right", move(-10))).toBe(atMin);
  });

  it("moves from a point to the next stop's near edge", () => {
    const shut = setStop(create(closable), ["width"], "closed");
    // Not its remembered size (250): an arrow is a small step.
    expect(widthOf(applyKeyboard(shut, "right", move(10)))).toBe(200);
    expect(applyKeyboard(shut, "right", move(-10))).toBe(shut);
    // Enter still goes back to the remembered size.
    expect(widthOf(applyKeyboard(shut, "right", { kind: "toggle" }))).toBe(250);
  });

  it("goes to the smallest and largest reachable sizes with Home and End", () => {
    expect(
      widthOf(applyKeyboard(create(sidebar), "right", { kind: "min" })),
    ).toBe(200);
    expect(
      widthOf(applyKeyboard(create(sidebar), "right", { kind: "max" })),
    ).toBe(480);
    expect(
      stopOf(applyKeyboard(create(railed), "right", { kind: "min" })),
    ).toBe("hidden");
    const unbounded = create({ anchor: "left", width: { defaultSize: 300 } });
    expect(applyKeyboard(unbounded, "right", { kind: "max" })).toBe(unbounded);
  });

  it("counts the current stop for Home, even one reached only by name", () => {
    // hidden is onlyByName: Home from the rail stays at the rail (the smallest
    // a key can reach from there), and Home at hidden stays at hidden,
    // as aria-valuemin says.
    const withHidden = {
      ...railed,
      width: {
        ...railed.width!,
        stops: {
          ...railed.width!.stops!,
          hidden: { size: 0, onlyByName: true },
        },
      },
    };
    const rail = setStop(create(withHidden), ["width"], "rail");
    expect(applyKeyboard(rail, "right", { kind: "min" })).toBe(rail);
    const hidden = setStop(create(withHidden), ["width"], "hidden");
    expect(applyKeyboard(hidden, "right", { kind: "min" })).toBe(hidden);
    expect(stopOf(applyKeyboard(hidden, "right", { kind: "max" }))).toBe(
      "open",
    );
  });

  it("toggles the smallest reachable stop with Enter", () => {
    const shut = applyKeyboard(create(closable), "right", { kind: "toggle" });
    expect(stopOf(shut)).toBe("closed");
    expect(widthOf(applyKeyboard(shut, "right", { kind: "toggle" }))).toBe(250);
    // With one stop, there's nothing to toggle.
    const fixed = create(image);
    expect(applyKeyboard(fixed, "right", { kind: "toggle" })).toBe(fixed);
  });
});

describe("content size at a point", () => {
  it("is the size of the range a toggle goes back to", () => {
    // Starts at the rail; defaultSize lands in compact, the narrower range,
    // so that's where Enter or toggle goes, and what content is sized for.
    const options: ResizableOptions = {
      anchor: "left",
      width: {
        defaultSize: 200,
        defaultStop: "rail",
        stops: {
          rail: 48,
          compact: { min: 150, max: 250 },
          wide: { min: 300, max: 600 },
        },
      },
    };
    const atRail = create(options);
    expect(getResizableRendering(atRail).width?.contentSize).toBe(200);
    const opened = setStop(atRail, ["width"], "rail", true);
    expect(getResizableRendering(opened).width).toMatchObject({
      stop: "compact",
      size: 200,
    });
  });
});

describe("setting stops in code", () => {
  it("applies a stop to the dimensions that have it", () => {
    const config = parseResizableOptions(railed);
    expect(dimensionsWithStop(config, "rail")).toEqual(["width"]);
    expect(dimensionsWithStop(config, "rail", "width")).toEqual(["width"]);
    const box = parseResizableOptions({
      anchor: "top-left",
      width: { defaultSize: 300, stops: { hidden: 0, open: {} } },
      height: { defaultSize: 300, stops: { hidden: 0, open: {} } },
    });
    expect(dimensionsWithStop(box, "hidden")).toEqual(["width", "height"]);
    expect(() => dimensionsWithStop(config, "tiny")).toThrow(
      'Unknown stop "tiny". Stops: "hidden", "rail", "open".',
    );
    expect(() => dimensionsWithStop(config, "rail", "height")).toThrow(
      /height isn't resizable/,
    );
  });

  it("toggles several dimensions together, even when they've drifted apart", () => {
    const widget = create({
      anchor: "bottom-right",
      width: { defaultSize: 320, stops: { minimised: 200, open: {} } },
      height: { defaultSize: 320, stops: { minimised: 44, open: {} } },
    });
    const both = ["width", "height"] as const;
    const stops = (state: ResizableState) => {
      const view = getResizableRendering(state);
      return [view.width?.stop, view.height?.stop];
    };
    const minimised = setStop(widget, both, "minimised", true);
    expect(stops(minimised)).toEqual(["minimised", "minimised"]);
    expect(stops(setStop(minimised, both, "minimised", true))).toEqual([
      "open",
      "open",
    ]);
    // Only the width minimised (say the height was dragged open): the toggle
    // minimises the height too, rather than flipping each one.
    const drifted = setStop(widget, ["width"], "minimised");
    const together = setStop(drifted, both, "minimised", true);
    expect(stops(together)).toEqual(["minimised", "minimised"]);
    expect([widthOf(together), heightOf(together)]).toEqual([200, 44]);
    const reopened = setStop(together, both, "minimised", true);
    expect([widthOf(reopened), heightOf(reopened)]).toEqual([320, 320]);
  });

  it("goes to a point, or to a range at its remembered size", () => {
    const rail = setStop(create(railed), ["width"], "rail");
    expect(widthOf(rail)).toBe(48);
    expect(widthOf(setStop(rail, ["width"], "open"))).toBe(250);
  });

  it("toggles back to the larger stop it came from, else its last range", () => {
    const wide = setSize(create(railed), "width", px(400));
    const rail = setStop(wide, ["width"], "rail", true);
    expect(stopOf(rail)).toBe("rail");
    // Hidden from the rail: back to the rail.
    const hidden = setStop(rail, ["width"], "hidden");
    const back = setStop(hidden, ["width"], "hidden", true);
    expect(stopOf(back)).toBe("rail");
    // The rail came from hidden, which is smaller: back to the last range.
    expect(
      getResizableRendering(setStop(back, ["width"], "rail", true)).width,
    ).toMatchObject({ stop: "open", size: 400 });
    // Hidden from open: back to open.
    const shut = setStop(wide, ["width"], "hidden");
    expect(stopOf(setStop(shut, ["width"], "hidden", true))).toBe("open");
  });

  it("returns the same state when nothing changes", () => {
    const state = create(railed);
    expect(setStop(state, ["width"], "open")).toBe(state);
  });
});

describe("named stops", () => {
  it("walks across the stops while dragging and settles on one", () => {
    // From 250: rail|open divide at 124; hidden|rail at 24.
    expect(stopOf(drag(create(railed), "right", -130))).toBe("rail");
    expect(widthOf(drag(create(railed), "right", -130))).toBe(48);
    expect(stopOf(drag(create(railed), "right", -230))).toBe("hidden");

    const hidden = endDrag(drag(create(railed), "right", -230));
    expect(hidden.width).toEqual({
      stop: "hidden",
      sizes: {},
      lastRange: "open",
      // Where it was before the drag, not the rail it passed through.
      from: "open",
    });
    expect(widthOf(setStop(hidden, ["width"], "open"))).toBe(250);
  });

  it("drags from a point to the next stop either way", () => {
    const rail = setStop(create(railed), ["width"], "rail");
    expect(stopOf(drag(rail, "right", -30))).toBe("hidden");
    expect(stopOf(drag(rail, "right", 120))).toBe("open");
  });

  it("steps through the stops with the keyboard", () => {
    const atMin = applyKeyboard(create(railed), "right", move(-100));
    const rail = applyKeyboard(atMin, "right", move(-10));
    expect(stopOf(rail)).toBe("rail");
    const hidden = applyKeyboard(rail, "right", move(-10));
    expect(stopOf(hidden)).toBe("hidden");
    expect(applyKeyboard(hidden, "right", move(-10))).toBe(hidden);
    expect(stopOf(applyKeyboard(hidden, "right", move(10)))).toBe("rail");
    expect(stopOf(applyKeyboard(rail, "right", move(10)))).toBe("open");
  });

  it("divides gaps by pull", () => {
    const sticky: ResizableOptions = {
      ...railed,
      width: {
        defaultSize: "25%",
        stops: {
          rail: { size: "3rem", pull: 3 },
          open: { min: 200, max: 480 },
        },
      },
    };
    // rail claims three quarters of the 152px gap: up to 162.
    expect(stopOf(drag(create(sticky), "right", -90))).toBe("rail");
    expect(stopOf(drag(create(sticky), "right", -85))).toBe("open");
  });

  it("reaches onlyByName stops only by name", () => {
    const withHidden: ResizableOptions = {
      ...railed,
      width: {
        defaultSize: "25%",
        stops: {
          hidden: { size: 0, onlyByName: true },
          rail: "3rem",
          open: { min: 200, max: 480 },
        },
      },
    };
    expect(stopOf(drag(create(withHidden), "right", -245))).toBe("rail");
    const hidden = setStop(create(withHidden), ["width"], "hidden");
    expect(widthOf(hidden)).toBe(0);
    // Once there, a drag leaves it like any other stop.
    expect(stopOf(drag(hidden, "right", 30))).toBe("rail");
  });

  it("can start from a default stop alone", () => {
    const options: ResizableOptions = {
      anchor: "left",
      width: {
        defaultStop: "rail",
        stops: { rail: "3rem", open: { min: 200, max: 400 } },
      },
    };
    const state = create(options);
    expect(widthOf(state)).toBe(48);
    // A range it hasn't been in starts at its minimum.
    expect(widthOf(setStop(state, ["width"], "open"))).toBe(200);
    // Toggling back with no range to return to goes to the roomiest stop.
    expect(stopOf(setStop(state, ["width"], "rail", true))).toBe("open");
    const unmeasured = createResizableState(parseResizableOptions(options));
    expect(getResizableRendering(unmeasured).width?.css).toBe("3rem");
    expect(() =>
      parseResizableOptions({
        anchor: "left",
        width: { stops: { rail: 48 } },
      } as unknown as ResizableOptions),
    ).toThrow(/needs `defaultSize`, `defaultStop`, or both/);
  });

  it("starts at its default stop", () => {
    const options = {
      ...railed,
      width: { ...railed.width!, defaultStop: "rail" },
    };
    expect(widthOf(create(options))).toBe(48);
  });

  it("doesn't depend on the order stops are written in", () => {
    const reversed: ResizableOptions = {
      ...railed,
      width: {
        defaultSize: "25%",
        stops: { open: { min: 200, max: 480 }, rail: "3rem", hidden: 0 },
      },
    };
    expect(stopOf(drag(create(reversed), "right", -130))).toBe("rail");
    expect(stopOf(drag(create(reversed), "right", -230))).toBe("hidden");
  });

  it("goes where the default size lands for a stop that's no longer configured", () => {
    const restored = restoreSnapshot(create(railed), {
      version: 2,
      width: { stop: "gone", sizes: {}, lastRange: null },
    });
    expect(getResizableRendering(restored).width).toMatchObject({
      stop: "open",
      size: 250,
    });
  });
});

describe("changing options", () => {
  it("adds and drops dimensions", () => {
    const withHeight = { ...sidebar, height: { defaultSize: 200 } };
    const grown = setConfig(create(sidebar), parseResizableOptions(withHeight));
    expect(heightOf(grown)).toBe(200);
    expect(grown.width).toEqual(create(sidebar).width);

    const shrunk = setConfig(grown, parseResizableOptions(sidebar));
    expect(shrunk.height).toBeNull();
  });
});

describe("snapshots", () => {
  const box: ResizableOptions = {
    anchor: "top-left",
    width: { defaultSize: 400, minSize: 100 },
    height: { defaultSize: 300, stops: { bar: 40, open: { min: 50 } } },
  };

  it("round-trips each dimension's stop and sizes", () => {
    const changed = setStop(
      setSize(create(box), "width", px(333)),
      ["height"],
      "bar",
    );
    const restored = restoreSnapshot(create(box), toSnapshot(changed));
    expect(widthOf(restored)).toBe(333);
    expect(getResizableRendering(restored).height?.stop).toBe("bar");
  });

  it("only includes resizable dimensions", () => {
    expect(toSnapshot(create(sidebar))).toEqual({
      version: 2,
      width: { stop: null, sizes: {}, lastRange: null },
    });
  });

  it("starts from a snapshot", () => {
    const state = createResizableState(parseResizableOptions(sidebar), {
      version: 2,
      width: { stop: UNNAMED, sizes: { [UNNAMED]: px(300) }, lastRange: null },
    });
    expect(
      widthOf(
        measure(state, {
          width: 1000,
          height: 800,
          rootFontSize: 16,
          viewport: null,
        }),
      ),
    ).toBe(300);
  });

  const width = (value: unknown) => ({ version: 2, width: value });
  it.each([
    [
      width({ stop: "rail", sizes: { open: px(300) }, lastRange: "open" }),
      true,
    ],
    [width({ stop: null, sizes: {}, lastRange: null }), true],
    [{ version: 2 }, true],
    [{ version: 1 }, false],
    [width({ stop: 1, sizes: {}, lastRange: null }), false],
    [width({ stop: null, sizes: { a: px(-1) }, lastRange: null }), false],
    [
      width({
        stop: null,
        sizes: { a: { value: 1, unit: "em" } },
        lastRange: null,
      }),
      false,
    ],
    [width({ stop: null, sizes: null, lastRange: null }), false],
    [width({ stop: null, sizes: {}, lastRange: null, from: "rail" }), true],
    [width({ stop: null, sizes: {}, lastRange: null, from: 2 }), false],
    [null, false],
  ])("validates %j", (value, valid) => {
    expect(isResizableSnapshot(value)).toBe(valid);
  });
});

describe("locked aspect ratio", () => {
  /** A 16:9 video anchored top-left, max 450px tall. */
  const video: ResizableOptions = {
    anchor: "top-left",
    width: { defaultSize: 320, minSize: 160 },
    height: { maxSize: 450 },
    aspectRatio: 16 / 9,
  };

  it("takes the height's stops as the width's", () => {
    const closable: ResizableOptions = {
      ...video,
      width: { defaultSize: 320, stops: { closed: 0, open: { min: 160 } } },
    };
    const shut = setStop(
      create(closable),
      dimensionsWithStop(parseResizableOptions(closable), "closed", "height"),
      "closed",
    );
    expect(widthOf(shut)).toBe(0);
  });

  it("stores only the width and derives the height", () => {
    const state = create(video);
    expect(state.height).toBeNull();
    expect(widthOf(state)).toBe(320);
    expect(heightOf(state)).toBe(180);
    expect(getResizableRendering(state).height?.css).toBe("auto");
  });

  it("offers height handles, which drive the width through the ratio", () => {
    expect(parseResizableOptions(video).handles).toEqual([
      "right",
      "bottom",
      "bottom-right",
    ]);
    const taller = drag(create(video), "bottom", 0, 90);
    expect(heightOf(taller)).toBe(270);
    expect(widthOf(taller)).toBe(480);
  });

  describe("corner drags (cornerDrag: nearest, the default)", () => {
    /** A centred 4:3 photo: its bottom-right corner moves along (4, 3). */
    const photo: ResizableOptions = {
      anchor: "center",
      width: { defaultSize: 320, minSize: 160 },
      aspectRatio: 4 / 3,
      elastic: false,
    };
    const at = (dx: number, dy: number) =>
      widthOf(drag(create(photo), "bottom-right", dx, dy)) ?? NaN;

    it("keeps the corner on the pointer when it moves along the corner's path", () => {
      // 40 right, 30 down: the corner moves (40, 30), so the centred photo
      // grows 80 × 60.
      expect(at(40, 30)).toBeCloseTo(400);
    });

    it("takes the nearest point on the path otherwise", () => {
      // 30 right: the nearest point is 19.2 right, 14.4 down.
      expect(at(30, 0)).toBeCloseTo(358.4);
      expect(at(-30, 0)).toBeCloseTo(281.6);
    });

    it("weighs a wobble the same either way", () => {
      const base = at(30, 0);
      expect(at(30, 3) - base).toBeCloseTo(base - at(30, -3));
    });

    it("still stops at the limits", () => {
      expect(at(-300, 0)).toBe(160);
    });
  });

  describe("corner drags (cornerDrag: axis)", () => {
    const axis: ResizableOptions = { ...video, cornerDrag: "axis" as const };

    it("follows whichever axis a corner drag pulls further", () => {
      // 40px right (width +40) vs 10px down (width +10 × 16/9 ≈ 17.8).
      expect(widthOf(drag(create(axis), "bottom-right", 40, 10))).toBe(360);
      // 10px right vs 45px down (width +80).
      expect(widthOf(drag(create(axis), "bottom-right", 10, 45))).toBe(400);
    });

    it("offsets a corner's pulls in opposite directions, without jumping", () => {
      const stiff = { ...axis, elastic: false };
      const at = (dx: number, dy: number) =>
        widthOf(drag(create(stiff), "bottom-right", dx, dy));
      // 40px left (width -40) against 18, 22.5 and 27px down (width +32, +40,
      // +48): the size passes smoothly through where they cancel out.
      expect([at(-40, 18), at(-40, 22.5), at(-40, 27)]).toEqual([
        312, 320, 328,
      ]);
      // 200px left is 40px past the min (160): that has to be undone before it
      // grows (18px down: +32), as with an edge. Then it grows from the min.
      expect(at(-200, 0)).toBe(160);
      expect(at(-200, 18)).toBe(160);
      expect(at(-200, 45)).toBe(200);
      expect(at(-200, 135)).toBe(360);
      // Pulled in on both axes, the further pull wins.
      expect(at(-40, -9)).toBe(280);
    });
  });

  it("turns height limits into width limits", () => {
    // max height 450 → max width 800.
    expect(
      widthOf(
        endDrag(drag(create({ ...video, elastic: false }), "right", 1000)),
      ),
    ).toBe(800);
    expect(getResizableRendering(create(video)).height?.track?.[0].max).toBe(
      450,
    );
  });

  it("keeps the width's small points through the height limits", () => {
    const closableVideo: ResizableOptions = {
      ...video,
      width: {
        defaultSize: 320,
        stops: { closed: 0, open: { min: 160 } },
      },
      height: { minSize: 100 },
    };
    // min height 100 → open's min becomes 177.8, but closed stays at 0.
    expect(widthOf(setStop(create(closableVideo), ["width"], "closed"))).toBe(
      0,
    );
  });

  it("resizes from the keyboard on a height edge", () => {
    const state = applyKeyboard(create(video), "bottom", move(9));
    expect(heightOf(state)).toBe(189);
  });

  it("only transitions the width; CSS carries the height along", () => {
    const released = endDrag(drag(create(video), "right", 10));
    const { transition } = getResizableRendering(released);
    expect(transition).toMatch(/^width /);
    expect(transition).not.toContain("height");
  });

  it("rejects a ratio that isn't a positive number", () => {
    expect(() => parseResizableOptions({ ...video, aspectRatio: 0 })).toThrow(
      /aspectRatio/,
    );
  });
});

describe("positioned (anchor: none)", () => {
  /** A floating window at (100, 50) in a 1000×800 container. */
  const floating: ResizableOptions = {
    anchor: "none",
    width: { defaultSize: 300, minSize: 200, maxSize: 500 },
    height: { defaultSize: 200, minSize: 100 },
    defaultPosition: { x: 100, y: 50 },
    elastic: false,
  };
  const positionOf = (state: ResizableState) =>
    getResizableRendering(state).position;
  const sizeAt = (state: ResizableState) => ({
    ...positionOf(state),
    width: widthOf(state),
    height: heightOf(state),
  });
  const element = { width: 300, height: 200 };

  it("offers every edge and corner, changing size 1:1", () => {
    expect(parseResizableOptions(floating).handles).toHaveLength(8);
    expect(widthOf(drag(create(floating), "right", 10))).toBe(310);
  });

  it("starts at its default position, rendered as CSS until measured", () => {
    expect(positionOf(create(floating))).toMatchObject({
      x: 100,
      y: 50,
      left: "100px",
      top: "50px",
    });
    const unmeasured = createResizableState(
      parseResizableOptions({ ...floating, defaultPosition: { x: "10%" } }),
    );
    expect(positionOf(unmeasured)).toEqual({
      x: null,
      y: null,
      left: "10%",
      top: "0px",
    });
  });

  it("keeps the opposite edge still when resizing from the left or top", () => {
    const pulled = drag(create(floating), "top-left", -30, -20, element);
    expect(sizeAt(pulled)).toMatchObject({
      x: 70,
      y: 30,
      width: 330,
      height: 220,
    });

    const settled = endDrag(pulled);
    expect(sizeAt(settled)).toMatchObject({
      x: 70,
      y: 30,
      width: 330,
      height: 220,
    });
    expect(settled.position).toEqual({ x: px(70), y: px(30) });
  });

  it("stops moving the edge when a limit stops the size", () => {
    // Width can only grow by 200 (to max 500), so x can only move 200 left.
    const pulled = drag(create(floating), "left", -300, 0, element);
    expect(sizeAt(pulled)).toMatchObject({ x: -100, width: 500 });
  });

  it("keeps the right edge still through the elastic stretch and settle", () => {
    const elastic = create({ ...floating, elastic: true });
    const pulled = drag(elastic, "left", -300, 0, element);
    const view = sizeAt(pulled);
    expect((view.x ?? 0) + (view.width ?? 0)).toBe(400);
    const settled = sizeAt(endDrag(pulled));
    expect(settled).toMatchObject({ x: -100, width: 500 });
  });

  it("moves with the move handle", () => {
    const moved = moveDrag(
      startDrag(create(floating), "move", element),
      40,
      -10,
    );
    expect(positionOf(moved)).toMatchObject({ x: 140, y: 40 });
    expect(widthOf(moved)).toBe(300);
    expect(positionOf(endDrag(moved))).toMatchObject({ x: 140, y: 40 });
  });

  it("can be moved anywhere unless confined", () => {
    const free = moveDrag(
      startDrag(create(floating), "move", element),
      -500,
      0,
    );
    expect(positionOf(free)?.x).toBe(-400);

    const confined = create({ ...floating, confine: "container" });
    const kept = moveDrag(startDrag(confined, "move", element), -500, 2000);
    expect(positionOf(kept)).toMatchObject({ x: 0, y: 600 });
  });

  it("can't be resized past the container when confined", () => {
    const confined = create({
      ...floating,
      confine: "container",
      width: { defaultSize: 300 },
    });
    // From x=100, the left edge can only reach 0: width at most 400.
    expect(sizeAt(drag(confined, "left", -300, 0, element))).toMatchObject({
      x: 0,
      width: 400,
    });
    // The right edge can only reach 1000: width at most 900.
    expect(widthOf(drag(confined, "right", 2000, 0, element))).toBe(900);
  });

  it("moves by keyboard, staying inside when confined", () => {
    expect(
      positionOf(moveByKeyboard(create(floating), 10, 0, element))?.x,
    ).toBe(110);
    const confined = create({ ...floating, confine: "container" });
    expect(positionOf(moveByKeyboard(confined, -500, 0, element))?.x).toBe(0);
  });

  it("resizes from the keyboard like a drag on the same handle", () => {
    // ArrowLeft on the left handle: wider, and the right edge stays put.
    const left = applyKeyboard(create(floating), "left", move(-10), element);
    expect(sizeAt(left)).toMatchObject({ x: 90, width: 310 });
    const top = applyKeyboard(create(floating), "top", move(-10), element);
    expect(sizeAt(top)).toMatchObject({ y: 40, height: 210 });
    // The right edge stays where it was.
    const right = applyKeyboard(create(floating), "right", move(10), element);
    expect(sizeAt(right)).toMatchObject({ x: 100, width: 310 });
  });

  it("stays inside its container when confined, whatever resizes or moves it", () => {
    const confined = create({
      ...floating,
      confine: "container",
      width: { defaultSize: 300 },
    });
    // The keyboard stops at the container's edge, as a drag does: from
    // x=100, the left edge can only reach 0.
    const keyed = applyKeyboard(confined, "left", move(-300), element);
    expect(sizeAt(keyed)).toMatchObject({ x: 0, width: 400 });
    // setSize: never bigger than the container, moved inside to fit.
    const sized = setSize(confined, "width", px(5000));
    expect(sizeAt(sized)).toMatchObject({ x: 0, width: 1000 });
    const wide = setSize(confined, "width", px(950));
    expect(sizeAt(wide)).toMatchObject({ x: 50, width: 950 });
    // setPosition past the edge: shown inside.
    const placed = setPosition(confined, { x: px(900) });
    expect(positionOf(placed)?.x).toBe(700);
    // The container shrinking: shown inside, and back where it was when
    // there's room again.
    const shrunk = measure(confined, {
      width: 350,
      height: 800,
      rootFontSize: 16,
      viewport: null,
    });
    expect(sizeAt(shrunk)).toMatchObject({ x: 50, width: 300 });
    expect(
      positionOf(
        measure(shrunk, {
          width: 1000,
          height: 800,
          rootFontSize: 16,
          viewport: null,
        }),
      )?.x,
    ).toBe(100);
  });

  it("stretches past its own limits, but never past the container", () => {
    const confined = create({
      ...floating,
      confine: "container",
      elastic: true,
      width: { defaultSize: 300, maxSize: 2000 },
    });
    // From x=100 the right edge reaches 1000: elastic or not, 900 at most.
    expect(widthOf(drag(confined, "right", 2000, 0, element))).toBe(900);
    // Its own maximum still gives a little.
    const capped = create({ ...floating, confine: "container", elastic: true });
    expect(widthOf(drag(capped, "right", 300, 0, element))).toBeGreaterThan(
      500,
    );
  });

  it("reports what each handle can reach, within its room", () => {
    const confined = create({
      ...floating,
      confine: "container",
      width: { defaultSize: 300 },
    });
    // At x=100 in 1000: the right edge can take it to 900, the left to 400.
    expect(handleReach(confined, "right")).toEqual({ min: 0, max: 900 });
    expect(handleReach(confined, "left")).toEqual({ min: 0, max: 400 });
    // Not confined: the dimension's own reach, whichever handle.
    expect(handleReach(create(floating), "left")).toEqual({
      min: 200,
      max: 500,
    });
  });

  it("keeps its stored position through resizes that don't move it", () => {
    // Stored at x=600; a 700px container shows it at 400 (700 - 300).
    const confined = measure(
      setPosition(
        create({
          ...floating,
          confine: "container",
          width: { defaultSize: 300 },
        }),
        { x: px(600) },
      ),
      { width: 700, height: 800, rootFontSize: 16, viewport: null },
    );
    expect(positionOf(confined)?.x).toBe(400);
    const roomy = {
      width: 1000,
      height: 800,
      rootFontSize: 16,
      viewport: null,
    };
    // A bottom edge (drag or key) moves nothing sideways: x is still 600,
    // so it goes back there when there's room.
    const pulled = endDrag(drag(confined, "bottom", 0, 20, element));
    expect(pulled.position?.x).toEqual(px(600));
    expect(positionOf(measure(pulled, roomy))?.x).toBe(600);
    const keyed = applyKeyboard(confined, "bottom", move(10), element);
    expect(keyed.position?.x).toEqual(px(600));
    // A drag that comes back to where it started changes nothing.
    expect(endDrag(drag(confined, "left", 0, 0, element)).position?.x).toEqual(
      px(600),
    );
    // Narrowed from the right while shown at 400: it stays where it was
    // seen, rather than jumping right when released.
    const narrowed = endDrag(drag(confined, "right", -40, 0, element));
    expect(sizeAt(narrowed)).toMatchObject({ x: 400, width: 260 });
  });

  it("keeps a % position relative until it's moved along that axis", () => {
    const relative = setPosition(create(floating), {
      x: { value: 30, unit: "%" },
    });
    const widened = endDrag(drag(relative, "right", 40, 0, element));
    expect(widened.position?.x).toEqual({ value: 30, unit: "%" });
    const moved = endDrag(drag(relative, "left", -40, 0, element));
    expect(moved.position?.x).toEqual(px(260));
  });

  it("only takes keys on the handles it offers", () => {
    const corners = create({ ...floating, handles: ["bottom-right"] });
    expect(applyKeyboard(corners, "right", move(10), element)).toBe(corners);
  });

  it("can be placed in code, at negative positions too", () => {
    const placed = setPosition(create(floating), {
      x: { value: 50, unit: "%" },
    });
    expect(positionOf(placed)).toMatchObject({ x: 500, y: 50 });
    expect(parseOffset(-10)).toEqual(px(-10));
    expect(parseOffset("-5%")).toEqual({ value: -5, unit: "%" });
  });

  it("cancels a drag when placed in code", () => {
    const dragging = moveDrag(
      startDrag(create(floating), "move", element),
      40,
      0,
    );
    expect(setPosition(dragging, { x: px(0) }).drag).toBeNull();
  });

  it("animates position along with size", () => {
    const released = endDrag(drag(create(floating), "left", -10, 0, element));
    expect(getResizableRendering(released).transition).toContain("left ");
  });

  it("saves its position in snapshots", () => {
    const moved = endDrag(
      moveDrag(startDrag(create(floating), "move", element), 5, 5),
    );
    const snapshot = toSnapshot(moved);
    expect(snapshot.position).toEqual({ x: px(105), y: px(55) });
    expect(isResizableSnapshot(snapshot)).toBe(true);
    expect(
      positionOf(restoreSnapshot(create(floating), snapshot)),
    ).toMatchObject({ x: 105, y: 55 });
  });

  it("rejects position options without anchor none", () => {
    expect(() =>
      parseResizableOptions({ ...sidebar, confine: "container" }),
    ).toThrow(/anchor: "none"/);
  });

  it("can't start a move on an element that isn't positioned", () => {
    const state = create(sidebar);
    expect(startDrag(state, "move")).toBe(state);
  });
});

describe("development warnings", () => {
  it("warns about a defaultSize that would show, then jump", () => {
    resetWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      parseResizableOptions({
        anchor: "left",
        width: { defaultSize: 150, stops: { rail: 56, open: { min: 200 } } },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("The width has defaultSize 150px"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a confined element's reach, from a handle", () => {
  const place = (state: ResizableState) => ({
    x: getResizableRendering(state).position?.x,
    width: getResizableRendering(state).width?.size,
    stop: getResizableRendering(state).width?.stop,
  });
  const base: ResizableOptions = {
    anchor: "none",
    confine: "container",
    width: {
      defaultStop: "large",
      stops: { closed: 0, rail: 100, large: 400 },
    },
    height: { defaultSize: 100 },
    defaultPosition: { x: 200, y: 0 },
    handles: ["right"],
    elastic: false,
  };
  const measured = { width: 0, height: 100 };

  it("takes Enter back no further than a drag from there could go", () => {
    const closed = setStop(create(base, 500, 400), ["width"], "closed");
    expect(handleReach(closed, "right")).toEqual({ min: 0, max: 100 });
    const entered = applyKeyboard(
      closed,
      "right",
      { kind: "toggle" },
      measured,
    );
    expect(entered).toBe(closed);
    // To the stop enterToggles names, as setStop: kept inside.
    const named = setStop(
      create(
        { ...base, width: { ...base.width!, enterToggles: "large" } },
        500,
        400,
      ),
      ["width"],
      "closed",
    );
    expect(
      place(applyKeyboard(named, "right", { kind: "toggle" }, measured)),
    ).toEqual({ x: 100, width: 400, stop: "large" });
  });

  it("takes Enter to a remembered size no bigger than the room", () => {
    const state = create(
      {
        ...base,
        width: {
          defaultSize: 400,
          defaultStop: "open",
          stops: { closed: 0, open: { min: 200, max: 450 } },
        },
      },
      500,
      400,
    );
    const closed = setStop(state, ["width"], "closed");
    expect(handleReach(closed, "right")?.max).toBe(300);
    // As a drag from there lands: at the room, its far edge where it was.
    expect(
      place(applyKeyboard(closed, "right", { kind: "toggle" }, measured)),
    ).toEqual({ x: 200, width: 300, stop: "open" });
    expect(
      place(endDrag(moveDrag(startDrag(closed, "right", measured), 1000, 0))),
    ).toEqual({ x: 200, width: 300, stop: "open" });
  });

  it("takes Enter home to where it lands in the room", () => {
    // Enter's stop is the one it's in: it toggles back home, where its
    // default size (400) lands, which is beyond its room (100).
    const state = create(
      {
        ...base,
        width: {
          defaultSize: 400,
          defaultStop: "closed",
          stops: { closed: 0, rail: 100, open: { min: 400 } },
        },
      },
      500,
      400,
    );
    expect(handleReach(state, "right")).toEqual({ min: 0, max: 100 });
    expect(
      place(applyKeyboard(state, "right", { kind: "toggle" }, measured)),
    ).toEqual({ x: 200, width: 100, stop: "rail" });
  });

  it("reaches a stop whose limits resolve to fit, wins: max", () => {
    const state = create(
      {
        ...base,
        width: {
          defaultStop: "closed",
          stops: { closed: 0, open: { min: 400, max: "50%" } },
          wins: "max",
        },
      },
      500,
      400,
    );
    expect(handleReach(state, "right")?.max).toBe(250);
    expect(place(endDrag(moveDrag(startDrag(state, "right"), 250, 0)))).toEqual(
      { x: 200, width: 250, stop: "open" },
    );
  });

  it("gives a ratio-locked corner the room it has both ways", () => {
    const state = create(
      {
        anchor: "none",
        confine: "container",
        width: { defaultSize: 200 },
        aspectRatio: 2,
        defaultPosition: { x: 100, y: 0 },
        handles: ["top-left"],
        elastic: false,
      },
      500,
      400,
    );
    // Its top edge is at the container's: it can't grow.
    expect(handleReach(state, "top-left", "width")?.max).toBe(200);
  });
});

describe("a confined drag, sized by the app", () => {
  // Its height is the app's (its text), at the container's bottom edge.
  const options: ResizableOptions = {
    anchor: "none",
    confine: "container",
    defaultPosition: { x: 0, y: 300 },
    width: { defaultSize: 300, minSize: 50 },
    elastic: false,
  };
  const at = (state: ResizableState) => getResizableRendering(state).position;

  for (const target of ["right", "move"] as const) {
    it(`keeps it inside as that size changes mid-drag (${target})`, () => {
      const state = measureOwn(create(options, 1000, 400), {
        width: 300,
        height: 100,
      });
      const grabbed = startDrag(state, target, { width: 300, height: 100 });
      // Narrower, its text wraps: twice as tall.
      const dragging = measureOwn(
        moveDrag(grabbed, target === "move" ? 0 : -150, 0),
        { width: 150, height: 200 },
      );
      expect(at(dragging)?.y).toBe(200);
      // Released where it was shown.
      expect(at(endDrag(dragging))?.y).toBe(200);
    });
  }
});

describe("a confined drag, its container shrinking", () => {
  const options: ResizableOptions = {
    anchor: "none",
    confine: "container",
    width: { defaultSize: 200, minSize: 50 },
    height: { defaultSize: 100 },
    defaultPosition: { x: 300, y: 0 },
    elastic: false,
  };
  const at = (state: ResizableState) => ({
    x: getResizableRendering(state).position?.x,
    width: getResizableRendering(state).width?.size,
  });
  const shrink = (state: ResizableState, width: number) =>
    measure(state, { width, height: 800, rootFontSize: 16, viewport: null });
  const grabbed = { width: 200, height: 100 };

  it("takes it along, from the left edge", () => {
    const dragging = moveDrag(
      startDrag(create(options, 500, 800), "left", grabbed),
      -10,
      0,
    );
    expect(at(dragging)).toEqual({ x: 290, width: 210 });
    // Its right edge stays at the container's, as it's shown.
    const shrunk = shrink(dragging, 400);
    expect(at(shrunk)).toEqual({ x: 190, width: 210 });
    expect(at(endDrag(shrunk))).toEqual({ x: 190, width: 210 });
    // No bigger than the room it has now.
    expect(at(moveDrag(shrunk, -1000, 0))).toEqual({ x: 0, width: 400 });
  });

  it("takes it along, from the right edge", () => {
    const dragging = moveDrag(
      startDrag(create(options, 500, 800), "right", grabbed),
      10,
      0,
    );
    // Shrunk past where it began: inside, no bigger than the room.
    const shrunk = shrink(dragging, 250);
    expect(at(shrunk)).toEqual({ x: 50, width: 200 });
    expect(at(endDrag(shrunk))).toEqual({ x: 50, width: 200 });
  });
});

describe("grabbing mid-change", () => {
  const floating: ResizableOptions = {
    anchor: "none",
    width: { defaultSize: 200 },
    height: { defaultSize: 100 },
    defaultPosition: { x: 0, y: 0 },
    elastic: false,
  };
  // The width animating from 200 to 400, shown at 250.
  const shown = { width: 250, height: 100 };
  const widening = (options: ResizableOptions = floating) =>
    startAnimation(
      setSize(create(options), "width", { value: 400, unit: "px" }),
    );

  it("leaves what it doesn't resize where it's shown, then carries it on", () => {
    for (const target of ["move", "bottom"] as const) {
      const grabbed = startDrag(widening(), target, shown, { x: 0, y: 0 });
      expect(getResizableRendering(grabbed).width?.size).toBe(250);
      expect(getResizableRendering(endDrag(grabbed)).width?.size).toBe(400);
    }
  });

  it("keeps a confined one inside at the size it's shown", () => {
    const moved = moveDrag(
      startDrag(
        widening({ ...floating, confine: "container" }),
        "move",
        shown,
        {
          x: 0,
          y: 0,
        },
      ),
      900,
      0,
    );
    const rendering = getResizableRendering(moved);
    const right =
      (rendering.position?.x ?? 0) + (rendering.width?.size ?? Infinity);
    expect(right).toBeLessThanOrEqual(1000);
  });
});

describe("stops named like members every object has", () => {
  const withStops = (open: string, wide: string): ResizableOptions => ({
    anchor: "left",
    width: {
      defaultSize: 300,
      stops: {
        closed: 0,
        [open]: { min: 200, max: 400 },
        [wide]: { min: 500 },
      },
    },
    elastic: false,
  });
  const named = withStops("constructor", "toString");

  it("goes to them, sizes them, and toggles back", () => {
    const state = create(named);
    expect(stopOf(state)).toBe("constructor");
    expect(widthOf(state)).toBe(300);

    const wide = setStop(state, ["width"], "toString");
    expect(stopOf(wide)).toBe("toString");
    expect(widthOf(wide)).toBe(500);
    const wider = setSize(wide, "width", px(600));
    expect(widthOf(wider)).toBe(600);

    const back = setStop(wider, ["width"], "constructor");
    expect(widthOf(back)).toBe(300);
    const toggled = setStop(back, ["width"], "constructor", true);
    expect(stopOf(toggled)).toBe("toString");
    expect(widthOf(toggled)).toBe(600);
  });

  it("round-trips them through a snapshot", () => {
    const wider = setSize(
      setStop(create(named), ["width"], "toString"),
      "width",
      px(600),
    );
    const saved: unknown = JSON.parse(JSON.stringify(toSnapshot(wider)));
    expect(isResizableSnapshot(saved)).toBe(true);
    const restored = restoreSnapshot(
      create(named),
      saved as ReturnType<typeof toSnapshot>,
    );
    expect(stopOf(restored)).toBe("toString");
    expect(widthOf(restored)).toBe(600);
    expect(widthOf(setStop(restored, ["width"], "constructor"))).toBe(300);
  });

  it("renders them before measurement as it does other names", () => {
    const css = (options: ResizableOptions, stop: string) =>
      getResizableRendering(
        setStop(
          createResizableState(parseResizableOptions(options)),
          ["width"],
          stop,
        ),
      ).width?.css;
    expect(css(named, "toString")).toBe(css(withStops("open", "wide"), "wide"));
    expect(css(named, "constructor")).toBe(
      css(withStops("open", "wide"), "open"),
    );
  });
});

describe("a ratio-locked width before measurement", () => {
  const css = (options: ResizableOptions) =>
    getResizableRendering(createResizableState(parseResizableOptions(options)))
      .width?.css;

  it("keeps to its height's limits through the ratio", () => {
    expect(
      css({
        anchor: "left",
        width: { defaultSize: 400 },
        aspectRatio: 2,
        height: { minSize: "5rem", maxSize: 100 },
      }),
    ).toBe("clamp(10rem, 400px, 200px)");
    // With its own, the minimum winning (as once measured), or the
    // maximum with `wins: "max"`.
    expect(
      css({
        anchor: "left",
        width: { defaultSize: 400, minSize: 300 },
        aspectRatio: 2,
        height: { maxSize: 100 },
      }),
    ).toBe("clamp(300px, 400px, 200px)");
    expect(
      css({
        anchor: "left",
        width: { defaultSize: 400, maxSize: 200, wins: "max" },
        aspectRatio: 2,
        height: { minSize: 150 },
      }),
    ).toBe("min(max(300px, 400px), 200px)");
    // A point takes only maximums; at 0, it's 0.
    const closed = (height: ResizableOptions["height"]) =>
      createResizableState(
        parseResizableOptions({
          anchor: "left",
          width: {
            defaultStop: "closed",
            stops: { closed: 0, open: { min: 200 } },
          },
          aspectRatio: 2,
          height,
        } as ResizableOptions),
      );
    for (const height of [{ minSize: 100 }, { maxSize: 100 }]) {
      const rendering = getResizableRendering(closed(height));
      expect(rendering.width?.css).toBe("0px");
      expect(rendering.hidden).toBe(true);
    }
    // A `%` of the container's height can't be said in a width.
    expect(
      css({
        anchor: "left",
        width: { defaultSize: 400 },
        aspectRatio: 2,
        height: { maxSize: "50%" },
      }),
    ).toBe("400px");
  });
});
