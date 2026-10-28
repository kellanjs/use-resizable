/**
 * Keyboard resizing, following the WAI-ARIA window splitter pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
 *
 * Arrow keys along the resize axis move the edge by a step (Shift for a
 * larger step), Home and End go to the minimum and maximum, and Enter
 * toggles a stop (by default the smallest; the pattern's "collapse").
 *
 * Arrow keys are reported as an edge movement on screen, the same as a
 * pointer drag: ArrowRight is +x whether that grows a left sidebar or shrinks
 * a right one. Each hook's model already knows how screen movement maps to
 * its own size, so a key moves an edge the way a drag on it would.
 */
import { withDefaults } from "./defaults.js";

export type Axis = "horizontal" | "vertical";

export type KeyboardIntent =
  | { readonly kind: "move"; readonly delta: number }
  | { readonly kind: "min" }
  | { readonly kind: "max" }
  | { readonly kind: "toggle" };

/** Keyboard resizing options. `false` instead turns it off. */
export interface KeyboardOptions {
  /** Pixels per arrow key press. Default 10. */
  step?: number;
  /** Pixels per arrow key press with Shift held. Default 50. */
  largeStep?: number;
  /**
   * Whether an arrow press at the edge of a stop goes on to the next stop
   * (default `true`). Without it, arrows stay within the current stop, and
   * Enter, Home and End reach the others.
   */
  jump?: boolean;
}

export type KeyboardConfig = Readonly<Required<KeyboardOptions>>;

const DEFAULT_KEYBOARD: KeyboardConfig = {
  step: 10,
  largeStep: 50,
  jump: true,
};

/** `null` when keyboard resizing is off. */
export function parseKeyboard(
  option: KeyboardOptions | boolean | undefined,
): KeyboardConfig | null {
  if (option === false) return null;
  return withDefaults(
    DEFAULT_KEYBOARD,
    typeof option === "object" ? option : undefined,
  );
}

const ARROWS: Record<Axis, Record<string, 1 | -1>> = {
  horizontal: { ArrowLeft: -1, ArrowRight: 1 },
  vertical: { ArrowUp: -1, ArrowDown: 1 },
};

/**
 * Works out what a key press on a resize handle asks for, or `null` if it's
 * not a resize key (so the caller leaves the event alone).
 */
export function readKeyboardIntent(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
  axis: Axis,
  steps: Pick<KeyboardConfig, "step" | "largeStep"> = DEFAULT_KEYBOARD,
): KeyboardIntent | null {
  const direction = ARROWS[axis][event.key];
  if (direction) {
    const step = event.shiftKey ? steps.largeStep : steps.step;
    return { kind: "move", delta: direction * step };
  }

  switch (event.key) {
    case "Home":
      return { kind: "min" };
    case "End":
      return { kind: "max" };
    case "Enter":
      return { kind: "toggle" };
    default:
      return null;
  }
}
