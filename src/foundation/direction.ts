/**
 * Reading direction, which logical names (`start`, `end`) and the order of
 * a row's children follow.
 */

/** Whether `element` is laid out right to left (its CSS `direction`). */
export function isRightToLeft(element: Element): boolean {
  return getComputedStyle(element).direction === "rtl";
}
