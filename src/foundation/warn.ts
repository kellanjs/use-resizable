/**
 * Development warnings for mistakes that would otherwise fail silently (a
 * child id that isn't in the options, a separator between two children that
 * aren't neighbours, a handle without a label). Each message is shown once,
 * and none are shown in production builds.
 */

const shown = new Set<string>();

export function warnOnce(message: string) {
  if (process.env.NODE_ENV === "production" || shown.has(message)) return;
  shown.add(message);
  console.warn(`[use-resizable] ${message}`);
}

/** Lets tests see a warning again. */
export function resetWarnings() {
  shown.clear();
}

/** Warns if a focusable handle or separator has no accessible name. */
export function warnIfUnlabelled(element: Element, what: string) {
  if (
    !element.hasAttribute("aria-label") &&
    !element.hasAttribute("aria-labelledby")
  ) {
    warnOnce(
      `${what} has no aria-label (or aria-labelledby), so screen readers can't name it. Add one, e.g. aria-label="Resize sidebar".`,
    );
  }
}

/**
 * Warns if an absolutely positioned handle inside the element has nothing
 * positioned between it and the element, inclusive: it's then placed
 * against some ancestor outside, far from its edge. (A positioned wrapper
 * inside the element is fine.)
 * Call it once both are attached.
 */
export function warnIfUncontained(
  handle: HTMLElement,
  element: HTMLElement | null,
  what: string,
) {
  if (process.env.NODE_ENV === "production") return;
  if (!element || element === handle || !element.contains(handle)) return;
  if (getComputedStyle(handle).position !== "absolute") return;
  for (
    let node = handle.parentElement;
    node;
    node = node === element ? null : node.parentElement
  ) {
    if (getComputedStyle(node).position !== "static") return;
  }
  warnOnce(
    `${what} is absolutely positioned inside an element that isn't, so it's placed against some ancestor outside it instead of its edge. Give the element position: relative (or another positioning).`,
  );
}

/** What `getContentProps` marks its wrapper with (see `warnIfInContent`). */
const CONTENT_ATTRIBUTE = "data-resizable-content";

/** What `getClipProps` marks its layer with. */
const CLIP_ATTRIBUTE = "data-resizable-clip";

/**
 * Warns if a clip layer (`getClipProps`) isn't laid over its element: it
 * fills what it's positioned against (`inset: 0`), which should be the
 * element, but an element that isn't a containing block for it (not
 * positioned, transformed, contained, …) leaves it filling some ancestor.
 * Told by its size, which matches the element's inside its borders when
 * it's placed against it, whatever made the element a containing block.
 * Call it once both are attached and laid out.
 */
export function warnIfClipNotOver(
  clip: HTMLElement,
  element: HTMLElement | null | undefined,
) {
  if (process.env.NODE_ENV === "production") return;
  if (!element || !element.contains(clip) || !clip.isConnected) return;
  // Not laid out (display: none, or not yet): nothing to tell by.
  if (element.getClientRects().length === 0) return;
  if (
    Math.abs(clip.offsetWidth - element.clientWidth) <= 1 &&
    Math.abs(clip.offsetHeight - element.clientHeight) <= 1
  ) {
    return;
  }
  warnOnce(
    `A clip layer (getClipProps) isn't laid over its element: the element isn't what it's positioned against, so it fills some ancestor instead. Give the element position: relative (or anything else that makes it a containing block), and put the layer directly inside it.`,
  );
}

/**
 * Warns if a handle, separator or junction is inside a content wrapper
 * (`getContentProps`) of its own `owner` (a handle's element, a layout's
 * root group). The wrapper is laid out at the content size, not the
 * element's, and while content is held (`reflow: "once"`) it paints on its
 * own (`contain: paint`), which makes it what anything absolutely
 * positioned inside is placed against: a handle there would stay put
 * instead of following its edge. A wrapper around the whole owner (another
 * resizable's content, holding this one) isn't in the way. Call it once
 * it's attached.
 */
export function warnIfInContent(
  control: HTMLElement,
  owner: HTMLElement | null | undefined,
  what: string,
) {
  if (process.env.NODE_ENV === "production") return;
  const wrapper = control.parentElement?.closest(`[${CONTENT_ATTRIBUTE}]`);
  if (wrapper && owner?.contains(wrapper)) {
    warnOnce(
      `${what} is inside a content wrapper (getContentProps), which is laid out at the content size and, reflowing once, is what it's positioned against: it wouldn't follow its edge. Put it beside the wrapper, inside the element.`,
    );
    return;
  }
  // A clip layer (getClipProps) clips at the element's edge, where a
  // handle hangs over it.
  const clip = control.parentElement?.closest(`[${CLIP_ATTRIBUTE}]`);
  if (clip && owner?.contains(clip)) {
    warnOnce(
      `${what} is inside a clip layer (getClipProps), which clips what's past the element's edge: it would be cut off. Put it beside the layer, inside the element.`,
    );
  }
}

/**
 * Warns if reflowing once has nothing to hold: no content wrapper
 * (`getContentProps`, or anything marked `data-resizable-content`) inside
 * `elements`, so content reflows on every frame all the same.
 */
export function warnIfNothingHeld(elements: Iterable<Element>) {
  if (process.env.NODE_ENV === "production") return;
  for (const element of elements) {
    if (element.querySelector(`[${CONTENT_ATTRIBUTE}]`)) return;
  }
  warnOnce(
    `reflow: "once" holds only content in a getContentProps() wrapper, and there's none, so content reflows on every frame as with "live". Wrap the content that's slow to lay out in getContentProps() (content you lay out at --resizable-content-* yourself: mark its wrapper data-resizable-content).`,
  );
}
