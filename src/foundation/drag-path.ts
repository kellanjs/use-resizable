/**
 * Pointer events arrive as far apart as the pointer moved between frames,
 * so a fast move can jump right over a stop. For stops that end the drag
 * when reached (`endsDrag`), the path in between matters: a drag is walked
 * along it in short steps, and the first step that reaches one ends there.
 * A step can still pass over one (stops closer together than a step, or a
 * size that grows faster than the pointer moves, centred or through a
 * ratio): where a step lands in another stop, the path is looked at more
 * closely between.
 */

/** The longest step along the pointer's path, in pixels. */
const STEP = 4;

/** How finely a step that changes stop is looked into, in pixels. */
const FINEST = 1 / 64;

/**
 * Moves a drag from `from` to (`dx`, `dy`). With `stepped`, the path is
 * walked in steps of at most `STEP` px, and the walk stops at the first
 * point `ends` (given the point before) says ends the drag; a step that
 * `changes` (lands somewhere else: another stop) is halved until it's
 * found what's between, or it's too short to hold anything. `at` makes
 * the state for a pointer offset.
 */
export function walkDrag<S>(
  start: S,
  from: { readonly dx: number; readonly dy: number },
  dx: number,
  dy: number,
  stepped: boolean,
  at: (dx: number, dy: number) => S,
  ends: (previous: S, next: S) => boolean,
  changes: (previous: S, next: S) => boolean = () => false,
): { readonly state: S; readonly ended: boolean } {
  const distance = Math.hypot(dx - from.dx, dy - from.dy);
  const steps = stepped ? Math.max(1, Math.ceil(distance / STEP)) : 1;
  const point = (t: number) =>
    t === 1
      ? at(dx, dy)
      : at(from.dx + (dx - from.dx) * t, from.dy + (dy - from.dy) * t);

  /** The first point between `t0` and `t1` that ends the drag, if any. */
  const between = (previous: S, t0: number, next: S, t1: number): S | null => {
    if ((t1 - t0) * distance < FINEST) return null;
    const t = (t0 + t1) / 2;
    const middle = point(t);
    if (changes(previous, middle)) {
      const found = between(previous, t0, middle, t);
      if (found) return found;
    }
    if (ends(previous, middle)) return middle;
    return changes(middle, next) ? between(middle, t, next, t1) : null;
  };

  let previous = start;
  for (let step = 1; step <= steps; step++) {
    const t0 = (step - 1) / steps;
    const t1 = step / steps;
    const next = point(t1);
    if (stepped && changes(previous, next)) {
      const found = between(previous, t0, next, t1);
      if (found) return { state: found, ended: true };
    }
    if (ends(previous, next)) return { state: next, ended: true };
    previous = next;
  }
  return { state: previous, ended: false };
}
