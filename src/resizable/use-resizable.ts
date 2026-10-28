"use client";

/**
 * `useResizable`: an element whose size is its own, resized by handles on
 * its free edges and corners. Sidebars, drawers, images, widgets.
 *
 * ```tsx
 * // A sidebar: the left edge stays put, so the one handle is on the right.
 * const sidebar = useResizable({
 *   anchor: "left",
 *   width: {
 *     defaultSize: "18rem",
 *     stops: { rail: "3.5rem", open: { min: "14rem", max: ["28rem", "50%"] } },
 *   },
 * });
 *
 * <aside {...sidebar.getElementProps()}>
 *   …
 *   <div {...sidebar.getHandleProps("right")} aria-label="Resize sidebar" />
 * </aside>
 * ```
 *
 * The hook only connects React: it creates a controller once, keeps its
 * options current and subscribes to its state. The props it hands out are
 * built in `resizable-props.ts`, and all behaviour lives in the controller
 * and the pure model underneath it.
 */
import { useId, useState, useSyncExternalStore } from "react";

import { createRemote, createRemoteBinding } from "../foundation/remote.js";
import { useIsomorphicLayoutEffect } from "../foundation/use-isomorphic-layout-effect.js";
import {
  type ResizableController,
  createResizableControllerWithState,
} from "./resizable-controller.js";
import { resizableOf } from "./resizable-props.js";
import type {
  ResizableContractOf,
  ResizableOf,
  ResizableRemote,
  ResizableRemoteEndpoint,
  UseResizableOptions,
} from "./use-resizable-types.js";

export type {
  UseResizableOptions,
  ResizableElementProps,
  ResizableMoveHandleProps,
  ResizableHandleProps,
  Resizable,
  ResizableOf,
  ResizableViewOf,
  ResizableRemoteEndpoint,
  ResizableRemote,
  ResizableRemoteOf,
} from "./use-resizable-types.js";

/**
 * A remote for a resizable rendered elsewhere: give it to the hook as its
 * `remote` option, and reach the resizable from anywhere through
 * `remote.current` (`null` while none is mounted), or read it in React with
 * `useResizableRemote`. The type argument, the options' type, gives the
 * stop names; only the parts with stops need be at module level.
 *
 * ```tsx
 * export const sidebar = createResizableRemote<typeof sidebarOptions>();
 * useResizable({ ...sidebarOptions, remote: sidebar });
 * sidebar.current?.toggle("closed");
 * ```
 */
export function createResizableRemote<
  O extends UseResizableOptions,
>(): ResizableRemote<ResizableContractOf<O>> {
  return createRemote("resizable") as ResizableRemote<ResizableContractOf<O>>;
}

/**
 * Checks the `remote` option against the options it's given with, once
 * they've been inferred: unchanged if it matches, and if it doesn't, a
 * `remote` of the type it should have, so the error is on `remote`. (Typed
 * as part of `O` instead, an inline callback beside it would fix `O` before
 * its stops were read, at the constraint.)
 */
type RemoteChecked<O> = O extends { remote?: infer R }
  ? [R] extends [ResizableRemote<ResizableContractOf<O>> | undefined]
    ? unknown
    : { remote: ResizableRemote<ResizableContractOf<O>> }
  : unknown;

export function useResizable<const O extends UseResizableOptions>(
  options: O & NoInfer<RemoteChecked<O>>,
): ResizableOf<O> {
  const { containerRef } = options;
  const generatedId = useId();
  const id = options.id ?? generatedId;

  // The controller ignores the hook-only options (`containerRef`, `id`,
  // `valueText`).
  const [controller] = useState(() =>
    createResizableControllerWithState(options),
  );
  // Runs after every render, before `mount` on the first one, so the
  // controller always has the latest options (and the container getter,
  // which it only needs once mounted).
  useIsomorphicLayoutEffect(() =>
    controller.setOptions({
      ...options,
      getContainer: containerRef && (() => containerRef.current),
    }),
  );
  // The remote, if given: attached once the controller has mounted
  // (persisted state loaded), detached before it unmounts. Before the
  // mount effect, so the first remote is known when it connects; a new
  // one moves the connection without remounting.
  const [remoteBinding] = useState(() =>
    createRemoteBinding(
      "resizable",
      endpointOf(controller),
      controller.subscribe,
    ),
  );
  const { remote } = options;
  useIsomorphicLayoutEffect(
    () => remoteBinding.setRemote(remote),
    [remoteBinding, remote],
  );
  useIsomorphicLayoutEffect(() => {
    const unmount = controller.mount();
    remoteBinding.connect();
    return () => {
      remoteBinding.disconnect();
      unmount();
    };
  }, [controller, remoteBinding]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return resizableOf<O>(controller, state, options, id);
}

/** A remote's way in: the controller's actions, which read it when called. */
function endpointOf(controller: ResizableController): ResizableRemoteEndpoint {
  return Object.freeze({
    getView: controller.getView,
    setStop: controller.setStop,
    toggle: controller.toggle,
    setSize: controller.setSize,
    setPosition: controller.setPosition,
    getSnapshot: controller.getSnapshot,
    restore: controller.restore,
    reset: controller.reset,
  });
}
