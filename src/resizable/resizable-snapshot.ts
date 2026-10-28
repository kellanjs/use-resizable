/**
 * Saving and restoring a resizable: the snapshot (what's worth keeping
 * between sessions), restoring one, checking untrusted data before it's
 * restored, and going back to the defaults.
 */
import type { Dimension } from "../foundation/handle.js";
import { sameSize } from "../foundation/size.js";
import { isDimensionState, sameDimensionState } from "./dimension.js";
import { isPositionState } from "./position.js";
import {
  DIMENSIONS,
  type ResizableSnapshot,
  type ResizableState,
  createResizableState,
  storedDimension,
} from "./resizable-config.js";

export function toSnapshot(state: ResizableState): ResizableSnapshot {
  return {
    version: 2,
    ...(state.width && { width: state.width }),
    ...(state.height && { height: state.height }),
    ...(state.position && { position: state.position }),
  };
}

export function restoreSnapshot(
  state: ResizableState,
  snapshot: ResizableSnapshot,
): ResizableState {
  return {
    ...state,
    width: state.width && (snapshot.width ?? state.width),
    height: state.height && (snapshot.height ?? state.height),
    position: state.position && (snapshot.position ?? state.position),
    drag: null,
    animate: null,
  };
}

/**
 * Goes back to the sizes and position the options start with; with
 * `dimension`, just that dimension (for a ratio-locked element, the height
 * is the width's).
 */
export function resetToDefaults(
  state: ResizableState,
  dimension?: Dimension,
): ResizableState {
  const initial = createResizableState(state.config);
  if (dimension) {
    const stored = storedDimension(state.config, dimension);
    return {
      ...state,
      [stored]: initial[stored],
      drag: null,
      animate: "reset",
    };
  }
  return {
    ...state,
    width: initial.width,
    height: initial.height,
    position: initial.position,
    drag: null,
    animate: "reset",
  };
}

export function snapshotsEqual(
  a: ResizableSnapshot,
  b: ResizableSnapshot,
): boolean {
  // Snapshots share the state's objects, which change only when changed.
  if (
    a.width === b.width &&
    a.height === b.height &&
    a.position === b.position
  ) {
    return true;
  }
  const samePosition =
    a.position && b.position
      ? sameSize(a.position.x, b.position.x) &&
        sameSize(a.position.y, b.position.y)
      : a.position === b.position;
  return (
    samePosition &&
    DIMENSIONS.every((dimension) => {
      const left = a[dimension];
      const right = b[dimension];
      return left && right ? sameDimensionState(left, right) : left === right;
    })
  );
}

/** Checks untrusted data (e.g. from storage) before it's restored. */
export function isResizableSnapshot(
  value: unknown,
): value is ResizableSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const { version, width, height, position } = value as Record<string, unknown>;
  return (
    version === 2 &&
    (width === undefined || isDimensionState(width)) &&
    (height === undefined || isDimensionState(height)) &&
    (position === undefined || isPositionState(position))
  );
}
