import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server. Neither runs
 * on the server, so the hooks behave the same; this only spares apps that
 * render on the server React 18's warning that `useLayoutEffect` "does
 * nothing on the server" (React 19 no longer warns).
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
