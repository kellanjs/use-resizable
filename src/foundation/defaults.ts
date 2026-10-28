/**
 * Options over their defaults, field by field: one left out or given as
 * `undefined` (passing an optional prop along, `{ step: props.step }`)
 * takes its default, rather than spreading `undefined` over it.
 */
export function withDefaults<T extends object>(
  defaults: T,
  given: Partial<T> | undefined,
): T {
  const result = { ...defaults };
  if (!given) return result;
  for (const key of Object.keys(given) as (keyof T)[]) {
    const value = given[key];
    if (value !== undefined) result[key] = value as T[keyof T];
  }
  return result;
}
