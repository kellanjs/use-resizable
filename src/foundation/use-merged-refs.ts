"use client";

import { type Ref, type RefCallback, useMemo } from "react";

import { mergeRefs } from "./merge-refs.js";

/**
 * A stable ref callback feeding every ref given (two, or three), for putting
 * your own ref on an element alongside the library's:
 *
 * ```tsx
 * const scroller = useRef<HTMLElement>(null);
 * const ref = useMergedRefs(sidebar.getElementProps().ref, scroller);
 * <aside {...sidebar.getElementProps()} ref={ref} />
 * ```
 *
 * It changes only when one of the refs does (the library's never do).
 */
export function useMergedRefs<T>(
  first: Ref<T> | undefined,
  second: Ref<T> | undefined,
  third?: Ref<T>,
): RefCallback<T> {
  return useMemo(() => mergeRefs(first, second, third), [first, second, third]);
}
