// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";

import { installResizeObserver } from "../../testing/dom.js";
import { type ElementSize, observeSize } from "./observe-size.js";

let observer: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  observer = installResizeObserver();
});
afterEach(() => observer.restore());

it("gives each subscriber the box it asked for, on one element", () => {
  const element = document.createElement("div");
  const border: ElementSize[] = [];
  const content: ElementSize[] = [];
  // A layout watches its element's border box; a resizable inside it
  // watches the same element's content box, as its container.
  const stopBorder = observeSize(
    element,
    (size) => border.push(size),
    "border-box",
  );
  const stopContent = observeSize(element, (size) => content.push(size));
  observer.resize(
    element,
    { width: 100, height: 50 },
    { width: 120, height: 60 },
  );
  expect(border).toEqual([{ width: 120, height: 60 }]);
  expect(content).toEqual([{ width: 100, height: 50 }]);

  // A late subscriber gets its own box straight away.
  const late: ElementSize[] = [];
  const stopLate = observeSize(
    element,
    (size) => late.push(size),
    "border-box",
  );
  expect(late).toEqual([{ width: 120, height: 60 }]);
  stopBorder();
  stopContent();
  stopLate();
});

it("tells each box's subscribers of a change to it, whichever came first", () => {
  const element = document.createElement("div");
  const content: ElementSize[] = [];
  const stopBorder = observeSize(element, () => {}, "border-box");
  const stopContent = observeSize(element, (size) => content.push(size));
  observer.resize(
    element,
    { width: 100, height: 50 },
    { width: 120, height: 60 },
  );
  // More padding, the same border box: the content box changed.
  observer.resize(
    element,
    { width: 80, height: 50 },
    { width: 120, height: 60 },
  );
  stopBorder();
  observer.resize(
    element,
    { width: 60, height: 50 },
    { width: 120, height: 60 },
  );
  expect(content.map((size) => size.width)).toEqual([100, 80, 60]);
  stopContent();
});
