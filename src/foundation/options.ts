/**
 * The options both hooks share, and their parsing. Each hook's options
 * extend these with their own (anchor and dimensions; the layout and cascade).
 */
import { withDefaults } from "./defaults.js";
import {
  type KeyboardConfig,
  type KeyboardOptions,
  parseKeyboard,
} from "./keyboard.js";
import {
  DEFAULT_ELASTIC,
  type Elastic,
  type ElasticOptions,
} from "./limits.js";
import {
  type TransitionConfig,
  type TransitionOptions,
  parseTransition,
} from "./transition.js";

/** How often content reflows (see `CommonOptions.reflow`). */
export type Reflow = "live" | "once";

export interface CommonOptions {
  /**
   * Stretch past the limits while dragging: on by default, `false` for
   * none, or how far and how stiffly (what you leave out keeps its default).
   */
  elastic?: ElasticOptions | boolean;
  /**
   * Animate committed changes (releases, stops, keys, …): `true` for the
   * defaults, `false` for none, or timing, per kind of change if you like,
   * and for reduced motion (see `TransitionOptions`).
   */
  transition?: TransitionOptions | boolean;
  /**
   * Keyboard resizing: step sizes, and whether arrows jump on to the next
   * stop at a stop's edge. `false` turns it off (handles and separators
   * leave the tab order). Which stop Enter toggles is each track's
   * `enterToggles`.
   */
  keyboard?: KeyboardOptions | boolean;
  /** Pixels the pointer must move before a drag starts. Default 2. */
  dragThreshold?: number;
  /**
   * How often content laid out at the content size (`getContentProps`)
   * reflows: `"live"` (the default) on every frame, as a drag moves or a
   * change animates; or `"once"` per drag or change, when it's over, for
   * content too slow to lay out on every frame. The elements, handles and
   * separators move as usual either way (see the README's "Reflowing
   * once").
   */
  reflow?: Reflow;
  /**
   * Set the resize cursors: on handles and separators (`cursor` in their
   * styles), and across the whole page while dragging, so it doesn't
   * flicker as the pointer outruns the handle. Default `true`; `false`
   * leaves cursors to your CSS (text selection is still blocked while
   * dragging).
   */
  cursor?: boolean;
  /**
   * Hide what rests at a size of 0 (`visibility: hidden`, once any
   * transition ends), so its content leaves the tab order and the
   * accessibility tree. Default `true`; turn it off to keep it visible
   * (content meant to overflow it, say) or to handle hiding yourself. In a
   * layout, a child's own `hideAtZero` overrides it.
   */
  hideAtZero?: boolean;
  disabled?: boolean;
}

/** The common options after parsing and defaulting. */
export interface CommonConfig {
  readonly elastic: Elastic | null;
  readonly transition: TransitionConfig | null;
  /** `null` when keyboard resizing is off. */
  readonly keyboard: KeyboardConfig | null;
  readonly dragThreshold: number;
  readonly reflow: Reflow;
  readonly cursor: boolean;
  readonly hideAtZero: boolean;
  readonly disabled: boolean;
}

export function parseCommonOptions(options: CommonOptions): CommonConfig {
  return {
    elastic:
      options.elastic === false
        ? null
        : withDefaults(
            DEFAULT_ELASTIC,
            typeof options.elastic === "object" ? options.elastic : undefined,
          ),
    transition: parseTransition(options.transition),
    keyboard: parseKeyboard(options.keyboard),
    dragThreshold: options.dragThreshold ?? 2,
    reflow: options.reflow ?? "live",
    cursor: options.cursor ?? true,
    hideAtZero: options.hideAtZero ?? true,
    disabled: options.disabled ?? false,
  };
}
