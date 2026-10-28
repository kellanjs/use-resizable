/**
 * Combining refs, for when an element needs the library's ref (from the
 * props it hands out) and one of your own.
 */
import type { Ref, RefCallback } from "react";

import { forReact } from "./react-ref.js";

/**
 * One ref callback that feeds every ref given: objects get the element in
 * `current`, callbacks are called with it. Cleanups returned by callback refs
 * (React 19's) run when the element detaches; callbacks without one are
 * called with `null` instead, as React would. React 18 calls the merged ref
 * with `null` rather than running its cleanup, and that's passed on too.
 *
 * In a component, use {@link useMergedRefs}: a merged ref made fresh on
 * every render would detach and reattach the element each time, which for
 * the library's refs means rewiring listeners and observers.
 */
export function mergeRefs<T>(
  ...refs: readonly (Ref<T> | undefined)[]
): RefCallback<T> {
  // React 18 warns about a cleanup returned; it calls this with `null`.
  return forReact((instance: T | null) => {
    const cleanups = refs.map((ref) => {
      if (!ref) return null;
      if (typeof ref === "function") {
        const cleanup = ref(instance);
        return typeof cleanup === "function" ? cleanup : () => ref(null);
      }
      // Set as React sets it (React 18's types call it read-only, for code
      // that isn't React).
      const object = ref as { current: T | null };
      object.current = instance;
      return () => {
        object.current = null;
      };
    });
    return () => {
      for (const cleanup of cleanups) cleanup?.();
    };
  });
}
