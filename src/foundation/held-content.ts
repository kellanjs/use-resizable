/**
 * Content as it was when a change began. Both hooks keep one `HeldContent`
 * per dimension or child, as `heldContent` on their state, set when a
 * change starts animating (the controller core's `holdContent` step), and
 * reflowing once, when a drag starts. Content an animated change takes to
 * a point leaves at that size (see `withHeldContent`); and reflowing once
 * (`reflow: "once"`), content is held at it while a drag or an animated
 * change goes on, so it's laid out again once, when that's over.
 */
import type { Reflow } from "./options.js";

/** What a dimension's or a child's content was, before what's going on. */
export interface HeldContent {
  readonly contentSize: number | null;
  readonly contentStop: string | null;
  /**
   * Kept as a change began that interrupted another animated change: its
   * content carries on at this size (see `withHeldContent`).
   */
  readonly interrupted?: boolean;
}

/** The parts of a model's state that holding content works with. */
export interface HoldingState {
  readonly config: { readonly reflow: Reflow };
  readonly drag: unknown;
  readonly animating: boolean;
  readonly heldContent: unknown;
}

/**
 * Whether the content is held now: reflowing once, with something held,
 * while a drag or an animated change goes on.
 */
export function holdsContent(state: HoldingState): boolean {
  return (
    state.config.reflow === "once" &&
    state.heldContent !== null &&
    (state.drag !== null || state.animating)
  );
}

/** The content of a dimension's or a child's rendering, to hold. */
export function heldOf(rendering: HeldContent): HeldContent {
  return {
    contentSize: rendering.contentSize,
    contentStop: rendering.contentStop,
  };
}

/**
 * `live`, with `held` content (what it was when the change began).
 *
 * Departing (an animated change taking it to a point: a rail, or 0), at the
 * size it was, or the point's own if that's larger, at the new stop: what's
 * on screen leaves as it was. A point's content size is the size of the
 * range it would go back to (see `contentSizeOf`), which isn't what's shown
 * when the change begins after a drag or while siblings squeeze it, so it
 * would otherwise jump on the first frame. It's laid out at that size once
 * the change is over, as it is at rest.
 *
 * Carrying on (an animated change that interrupted another, moving it to
 * another stop, or on to one the interrupted change was moving it to: see
 * `holdsWhileAnimating`), at the size it was laid out at: a pane opening,
 * then taken further before it's open (shown alone, say), carries on at
 * the size it was coming in at rather than being laid out at once at the
 * new one, which would shift it (a column centred in it jumping to where
 * it'll end). Its wrapper never falls short of the element (`max(100%,
 * …)`), so it grows with it past that size.
 *
 * Otherwise, reflowing once (`holding`): through a drag, exactly what it
 * was; through an animated change, the larger of its sizes before and
 * after, at the new stop, so a crossfade runs alongside the change.
 */
export function withHeldContent<
  T extends HeldContent & { readonly size: number | null },
>(
  live: T,
  held: HeldContent | null | undefined,
  how: {
    holding: boolean;
    dragging: boolean;
    departing: boolean;
    continuing: boolean;
  },
): T {
  if (!held) return live;
  if (how.departing && held.contentSize !== null) {
    return {
      ...live,
      contentSize: largerContentSize(held.contentSize, live.size),
    };
  }
  if (
    held.interrupted &&
    how.continuing &&
    !how.holding &&
    held.contentSize !== null
  ) {
    return { ...live, contentSize: held.contentSize };
  }
  if (!how.holding) return live;
  if (how.dragging) return { ...live, ...held };
  return {
    ...live,
    contentSize: largerContentSize(held.contentSize, live.contentSize),
  };
}

/**
 * Whether a state can have content departing: an animated change (not a
 * drag) with content kept from when it began.
 */
export function mayDepart(state: HoldingState): boolean {
  return state.animating && state.drag === null && state.heldContent !== null;
}

/** The larger of two content sizes, either of which may be unknown. */
function largerContentSize(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  return b === null ? a : Math.max(a, b);
}
