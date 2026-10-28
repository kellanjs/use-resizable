/**
 * Saving and restoring a layout: the snapshot (what's worth keeping
 * between sessions), restoring one, and checking untrusted data before it's
 * restored. (Going back to the defaults is an action, in the model.)
 */
import { own } from "../foundation/own.js";
import {
  type LayoutSnapshot,
  type LayoutState,
  MEASURE_EPSILON,
} from "./layout-config.js";
import { withPlaces } from "./layout-model.js";

export function toSnapshot(state: LayoutState): LayoutSnapshot {
  return { version: 3, children: state.places };
}

export function restoreSnapshot(
  state: LayoutState,
  snapshot: LayoutSnapshot,
): LayoutState {
  return {
    // What was asked for last belongs to the layout restored over.
    ...withPlaces(state, { ...state.places, ...snapshot.children }, null),
    animate: null,
  };
}

export function snapshotsEqual(a: LayoutSnapshot, b: LayoutSnapshot): boolean {
  // Snapshots share the state's places, which change only when changed.
  if (a.children === b.children) return true;
  const ids = new Set([...Object.keys(a.children), ...Object.keys(b.children)]);
  return [...ids].every((id) => {
    const left = own(a.children, id);
    const right = own(b.children, id);
    if (!left || !right) return false;
    const names = new Set([
      ...Object.keys(left.sizes),
      ...Object.keys(right.sizes),
    ]);
    return (
      left.stop === right.stop &&
      left.lastRange === right.lastRange &&
      left.from === right.from &&
      [...names].every((name) => {
        const was = own(left.sizes, name);
        const now = own(right.sizes, name);
        return (
          was !== undefined &&
          now !== undefined &&
          Math.abs(was - now) < MEASURE_EPSILON
        );
      })
    );
  });
}

/** Checks untrusted data (e.g. from storage) before it's restored. */
export function isLayoutSnapshot(value: unknown): value is LayoutSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const { version, children } = value as Record<string, unknown>;
  if (version !== 3 || typeof children !== "object" || children === null) {
    return false;
  }
  return Object.values(children).every((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return false;
    const { stop, sizes, lastRange, from } = entry as Record<string, unknown>;
    return (
      typeof stop === "string" &&
      (lastRange === null || typeof lastRange === "string") &&
      (from === undefined || typeof from === "string") &&
      typeof sizes === "object" &&
      sizes !== null &&
      Object.values(sizes).every(
        (size) =>
          typeof size === "number" && Number.isFinite(size) && size >= 0,
      )
    );
  });
}
