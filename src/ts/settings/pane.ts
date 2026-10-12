import type {Config} from '@lib/types.js';
import type {SettingsBinder} from './settings-binding.js';

/**
 * The one seam between the Settings composition root and the category panes.
 *
 * The root owns the panel state, the open/hide plumbing, the category nav, the
 * header and Save. A pane is built with this context, which carries the config,
 * the binder and the root's focus helpers, so a pane reads its dependencies from
 * one explicit argument instead of closing over panel-local state.
 */

/**
 * Hooks the launcher passes into createSettingsPanel. They live on the seam
 * (rather than the root) because the context hands them to the panes too.
 */
export interface SettingsPanelOptions {
  onClose?: () => void;
  onOpen?: () => void;
  onRendered?: () => void;
  onSave?: (config: Config) => void;
  onToast?: (message: string) => void;
  onVoiceEnabledChange?: (on: boolean) => void;
  onPreviewScreensaver?: () => void;
  hasTvChannels?: () => boolean;
  focusControl?: (el: Element) => boolean;
}

/** What the composition root hands each category pane. */
export interface SettingsContext {
  /** The effective config (the active profile applied). */
  readonly config: Config;
  /** The config as stored, before the active profile is merged. */
  readonly rawConfig: Config;
  readonly binder: SettingsBinder;
  /** The pane containers, keyed by category id. */
  readonly panes: Record<string, HTMLDivElement>;
  /** The host hooks the panel was created with. */
  readonly options: SettingsPanelOptions;
  /** Whether the panel is open; an async fill drops its result once it isn't. */
  isVisible(): boolean;
  /** Put focus (and the row highlight) on a control. */
  focusControl(el: Element): void;
  /** Focus a control immediately, without the deferral. */
  focusNow(el: Element | null): boolean;
  /** Scroll a photo gallery into view and focus its first tile. */
  focusGallery(el: HTMLElement): void;
  /** Focus the button in the same spot after a list rebuild. */
  refocusListButton(el: Element, row: number, order: number[]): void;
  /** Resolve `promise`, or `null` once `ms` elapses. */
  withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null>;
  /** Rebuild the panel from config and refocus the Restore control. */
  redraw(): void;
}

/**
 * A category pane. `build` draws the pane and registers its bindings and hooks;
 * `load` is the pane's optional asynchronous fill, driven by the root under a
 * deadline; `onSave` overrides Save for a pane with special write behaviour and
 * returns whether it handled the save.
 */
export interface PaneHandle {
  build(ctx: SettingsContext): void;
  load?(ctx: SettingsContext): Promise<void>;
  onSave?(ctx: SettingsContext, config: Config): boolean;
}
