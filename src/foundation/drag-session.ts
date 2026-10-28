/**
 * One pointer drag, from `pointerdown` to its end. Every resizable uses this
 * same session, so they all behave alike:
 *
 * - Only the primary button of the primary pointer starts a drag, and only
 *   events from that pointer are followed.
 * - The drag starts once the pointer has moved `threshold` pixels, so a plain
 *   click never registers as a resize.
 * - Movement is reported at most once per animation frame, as the total
 *   offset from where the pointer went down. Reporting totals rather than
 *   increments means a dropped frame never loses distance.
 * - It ends on `pointerup`, or if the browser takes the pointer away
 *   (`pointercancel`, lost capture, window blur). Escape cancels it.
 */
import { lockCursor } from "./cursor-lock.js";

export interface DragSessionOptions {
  /** Distance in pixels the pointer must travel before the drag starts. */
  threshold?: number;
  /**
   * Cursor to show everywhere while dragging, or `null` to leave cursors
   * be (text selection is blocked either way).
   */
  cursor?: string | null;
  /** The pointer has crossed the threshold; the drag is now live. */
  onStart?(): void;
  /** The pointer is now `dx`, `dy` pixels from where it went down. */
  onMove(dx: number, dy: number): void;
  /** The drag finished normally; keep the result. */
  onEnd(): void;
  /** The user pressed Escape; undo the drag. */
  onCancel(): void;
  /**
   * The session is over, whether or not a drag started (a plain click
   * ends one too). Not called when it's stopped with the returned function.
   */
  onClose?(): void;
}

/**
 * A press on a handle or separator that does nothing (it's disabled, or
 * can't move): like a press that drags, it mustn't start a text selection
 * or a native drag of selected text either. A handle is a control, not
 * content.
 */
export function ignorePress(down: PointerEvent) {
  if (isDragPress(down)) down.preventDefault();
}

/** The press of a primary pointer's main button: what can start a drag. */
function isDragPress(down: PointerEvent): boolean {
  return down.isPrimary && down.button === 0;
}

/**
 * Starts tracking a drag from a `pointerdown` on `handle`, or returns `null`
 * if the event shouldn't start one (wrong button, secondary touch). The
 * returned function stops the session silently, for when the owner is torn
 * down mid-drag.
 */
export function startDragSession(
  down: PointerEvent,
  handle: HTMLElement,
  options: DragSessionOptions,
): (() => void) | null {
  if (!isDragPress(down)) return null;

  // Stops the browser from starting a text selection or a native drag.
  down.preventDefault();

  const { threshold = 0, cursor } = options;
  const { pointerId, clientX: startX, clientY: startY } = down;
  const view = handle.ownerDocument.defaultView ?? window;

  let started = false;
  /** Set once it's stopped: by its end, or by its owner (`stop`). */
  let stopped = false;
  let latest: { dx: number; dy: number } | null = null;
  let frame: number | null = null;
  let unlockCursor: (() => void) | null = null;

  // Capture keeps events coming even when the pointer leaves the window.
  // Listeners go on the window, which captured events still bubble to, so the
  // session also works where capture is unavailable.
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // The pointer is already gone (e.g. a synthetic event); nothing to capture.
  }

  const flush = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    if (latest) options.onMove(latest.dx, latest.dy);
    latest = null;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!started) {
      if (Math.hypot(dx, dy) < threshold) return;
      started = true;
      unlockCursor = lockCursor(cursor ?? null);
      options.onStart?.();
      // Its start can end it (the app dropping the drag at once).
      if (stopped) return;
    }

    latest = { dx, dy };
    frame ??= view.requestAnimationFrame(flush);
  };

  const finish = (outcome: "end" | "cancel") => {
    // The pointer is let go, and the session told, even if the last move
    // throws (an app's callback): its error is thrown after.
    try {
      if (outcome === "end") flush();
    } finally {
      stop();
      options.onClose?.();
      if (started) {
        if (outcome === "end") options.onEnd();
        else options.onCancel();
      }
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    // Where it was let go: a release can be somewhere the last move wasn't
    // (a finger or pen lifting, say).
    if (started) {
      latest = { dx: event.clientX - startX, dy: event.clientY - startY };
    }
    finish("end");
  };
  // A cancel's coordinates are the last event's: nothing new to apply.
  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === pointerId) finish("end");
  };
  const onLostCapture = (event: PointerEvent) => {
    if (event.pointerId === pointerId) finish("end");
  };
  const onBlur = () => finish("end");
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // Escape belongs to the drag; don't also close a surrounding dialog.
    event.preventDefault();
    event.stopPropagation();
    finish("cancel");
  };

  const stop = () => {
    stopped = true;
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    unlockCursor?.();
    view.removeEventListener("pointermove", onPointerMove);
    view.removeEventListener("pointerup", onPointerUp);
    view.removeEventListener("pointercancel", onPointerCancel);
    view.removeEventListener("keydown", onKeyDown, true);
    view.removeEventListener("blur", onBlur);
    handle.removeEventListener("lostpointercapture", onLostCapture);
    try {
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    } catch {
      // Already released.
    }
  };

  view.addEventListener("pointermove", onPointerMove);
  view.addEventListener("pointerup", onPointerUp);
  view.addEventListener("pointercancel", onPointerCancel);
  // Capture phase, so Escape reaches us before app-level handlers.
  view.addEventListener("keydown", onKeyDown, true);
  view.addEventListener("blur", onBlur);
  handle.addEventListener("lostpointercapture", onLostCapture);

  return stop;
}
