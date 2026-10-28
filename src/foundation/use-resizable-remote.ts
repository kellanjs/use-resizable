"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type { ReadableRemote } from "./remote.js";

/**
 * Reads a remote's resizable from anywhere in React: `select` picks what's
 * needed from its view (or from `null`, while none is attached, on the
 * server and while hydrating), and the component re-renders only when that
 * changes (by `equals`, `Object.is` by default).
 *
 * ```tsx
 * const open = useResizableRemote(leftSidebar, (view) => view?.width.stop === "open");
 * ```
 *
 * A selection `equals` finds unchanged keeps its identity, so a selector
 * that builds an array (open panels' ids) doesn't re-render on every frame
 * of a drag when given an `equals` that compares them.
 */
export function useResizableRemote<V, S>(
  remote: ReadableRemote<V>,
  select: (view: V | null) => S,
  equals?: (a: S, b: S) => boolean,
): S {
  // The selection last rendered, recorded after commit: a render React
  // throws away mustn't become what a later one compares with.
  const committed = useRef<{ value: S } | null>(null);

  // One memoized selection per remote, selector and `equals`. Its getters
  // read `committed` when React calls them (during render, as
  // `getSnapshot` is), as React's own selector shim reads its ref; only
  // the effect below writes it.
  const [getSelection, getServerSelection] = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => memoizedSelection(remote, select, equals, committed),
    [remote, select, equals],
  );

  const value = useSyncExternalStore(
    remote.subscribe,
    getSelection,
    getServerSelection,
  );
  useEffect(() => {
    committed.current = { value };
  }, [value]);
  return value;
}

/**
 * The getters `useSyncExternalStore` reads, as React's
 * `useSyncExternalStoreWithSelector` makes them: one selection memoized
 * for both, the client's from the attached view and the server's from
 * `null`.
 */
function memoizedSelection<V, S>(
  remote: ReadableRemote<V>,
  select: (view: V | null) => S,
  equals: ((a: S, b: S) => boolean) | undefined,
  committed: { readonly current: { value: S } | null },
): [() => S, () => S] {
  let memo: { view: V | null; selection: S } | null = null;
  const selectFrom = (view: V | null): S => {
    if (!memo) {
      const selection = select(view);
      // A new selector (an inline one, on a parent's re-render) that
      // selects what's showing keeps its identity.
      const last = committed.current;
      const kept =
        equals && last && equals(last.value, selection)
          ? last.value
          : selection;
      memo = { view, selection: kept };
      return kept;
    }
    if (Object.is(memo.view, view)) return memo.selection;
    const selection = select(view);
    // Equal: keep the selection, but move on to the new view, so reading
    // it again doesn't select again.
    if (equals && equals(memo.selection, selection)) {
      memo = { view, selection: memo.selection };
      return memo.selection;
    }
    memo = { view, selection };
    return selection;
  };
  return [
    () => selectFrom(remote.current?.getView() ?? null),
    () => selectFrom(null),
  ];
}
