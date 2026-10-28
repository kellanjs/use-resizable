/**
 * Records keyed by names you choose: child and group ids, stop names.
 *
 * A plain object comes with members it inherits from `Object.prototype`,
 * so reading a name that was never stored can find one anyway
 * (`record["constructor"]` is a function), and storing under `"__proto__"`
 * replaces the object's prototype rather than adding an entry. These read
 * and store only the object's own entries, so any name works as a key.
 */

const hasOwnProperty = Object.prototype.hasOwnProperty;

/** Whether `key` is stored in `record`. */
export function hasOwn(
  record: object | null | undefined,
  key: string,
): boolean {
  return record != null && hasOwnProperty.call(record, key);
}

/** What's stored under `key` in `record`, or `undefined` if nothing is. */
export function own<V>(
  record: Readonly<Record<string, V>> | null | undefined,
  key: string,
): V | undefined {
  return hasOwn(record, key) ? record![key] : undefined;
}

/** Stores `value` under `key` in `record`, a record being built. */
export function setOwn<V>(
  record: Record<string, V>,
  key: string,
  value: V,
): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
