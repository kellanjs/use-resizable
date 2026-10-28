"use client";

/**
 * `useResizableLayout`: elements that share space, laid out in groups (rows
 * and columns, nested as deep as you like), with separators between them.
 * The whole tree is one layout, resolved together: a group can't shrink
 * below what its children need, and a junction drags separators of
 * different groups at once.
 *
 * ```tsx
 * const ide = useResizableLayout({
 *   layout: {
 *     id: "ide",
 *     direction: "row",
 *     children: [
 *       { id: "files", defaultSize: 240, stops: { closed: 0, open: { min: 180 } } },
 *       {
 *         id: "work",
 *         direction: "column",
 *         children: [{ id: "editor" }, { id: "terminal", defaultSize: 200 }],
 *       },
 *     ],
 *   },
 * });
 *
 * <div {...ide.getGroupProps("ide")}>
 *   <nav {...ide.getElementProps("files")} />
 *   <div {...ide.getSeparatorProps("files", "work")} aria-label="Resize files" />
 *   <div {...ide.getGroupProps("work")}>
 *     <main {...ide.getElementProps("editor")} />
 *     <div {...ide.getSeparatorProps("editor", "terminal")} aria-label="Resize terminal" />
 *     <section {...ide.getElementProps("terminal")} />
 *   </div>
 * </div>
 * ```
 *
 * The layout is data: to add, remove, reorder or regroup children, pass a
 * different tree. The hook only connects React: the props it hands out are
 * built in `layout-props.ts`, and behaviour lives in the controller and
 * the pure model underneath it.
 */
import { useId, useState, useSyncExternalStore } from "react";

import { createRemote, createRemoteBinding } from "../foundation/remote.js";
import { useIsomorphicLayoutEffect } from "../foundation/use-isomorphic-layout-effect.js";
import type { LayoutOptions } from "./layout-config.js";
import {
  type LayoutController,
  type LayoutControllerOptions,
  createLayoutControllerWithState,
} from "./layout-controller.js";
import { layoutOf } from "./layout-props.js";
import type {
  ChildIdsOf,
  LayoutContractOf,
  LayoutRemote,
  LayoutRemoteEndpoint,
  ResizableLayoutOf,
  UseResizableLayoutOptions,
} from "./use-resizable-layout-types.js";

export type {
  UseResizableLayoutOptions,
  ResizableLayoutGroupProps,
  ResizableLayoutElementProps,
  ResizableLayoutSeparatorProps,
  ResizableLayoutJunctionProps,
  LayoutClipOptions,
  SeparatorPropsOptions,
  ResizableLayoutSeparatorEntry,
  ResizableLayoutEntry,
  ResizableLayout,
  ResizableLayoutOf,
  ResizableLayoutViewOf,
  LayoutRemoteEndpoint,
  LayoutRemote,
  LayoutRemoteOf,
} from "./use-resizable-layout-types.js";

/**
 * A remote for a layout rendered elsewhere (see `createResizableRemote`).
 * The type argument is the `layout` option's type, which gives the ids and
 * stops.
 *
 * ```tsx
 * export const workspace = createLayoutRemote<typeof workspaceLayout>();
 * useResizableLayout({ layout: workspaceLayout, remote: workspace });
 * workspace.current?.toggle("note", "closed");
 * ```
 */
export function createLayoutRemote<
  L extends LayoutOptions["layout"],
>(): LayoutRemote<LayoutContractOf<{ layout: L }>> {
  return createRemote("layout") as LayoutRemote<
    LayoutContractOf<{ layout: L }>
  >;
}

/**
 * The layout is its own type parameter, so the ids it names are known
 * before the callbacks are typed: `onDragStart`'s pairs and `valueText`'s
 * id are the children's ids.
 */
export function useResizableLayout<const L extends LayoutOptions["layout"]>(
  options: Omit<
    UseResizableLayoutOptions<ChildIdsOf<{ layout: L }>>,
    "layout" | "remote"
  > & {
    layout: L;
    /**
     * A remote to attach this layout to while it's mounted (see
     * `createLayoutRemote`). Its type must have the same ids and stops.
     */
    remote?: NoInfer<LayoutRemote<LayoutContractOf<{ layout: L }>>>;
  },
): ResizableLayoutOf<{ layout: L }> {
  const generatedId = useId();
  const prefix = options.idPrefix ?? generatedId;

  // The controller works with plain string ids; the ids it passes the
  // callbacks are always the layout's. It ignores the hook-only options
  // (`idPrefix`, `valueText`).
  const controllerOptions = options as LayoutControllerOptions;
  const [controller] = useState(() =>
    createLayoutControllerWithState(controllerOptions),
  );
  // Runs after every render, so the controller always has the latest options.
  useIsomorphicLayoutEffect(() => controller.setOptions(controllerOptions));
  // The remote, if given: attached once the controller has mounted, and
  // detached before it unmounts (see `useResizable`).
  const [remoteBinding] = useState(() =>
    createRemoteBinding("layout", endpointOf(controller), controller.subscribe),
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
  return layoutOf(controller, state, options, prefix);
}

/**
 * A remote's way in: the controller's actions and queries, which read it
 * when called (the hook's `canSetStop` and `canToggle` read its render).
 */
function endpointOf(controller: LayoutController): LayoutRemoteEndpoint {
  return Object.freeze({
    getView: controller.getView,
    setStop: controller.setStop,
    toggle: controller.toggle,
    setStops: controller.setStops,
    canSetStops: controller.canSetStops,
    canSetStop: controller.canSetStop,
    canToggle: controller.canToggle,
    setSize: controller.setSize,
    getSnapshot: controller.getSnapshot,
    restore: controller.restore,
    reset: controller.reset,
  });
}
