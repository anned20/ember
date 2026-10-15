/**
 * The Settings control kit.
 *
 * Each module exports one control factory: a toggle, a text field, a hint, a
 * section, a mini button, an app row, a photo gallery, an option stepper, or an
 * AI provider picker. Panes compose them; a control's shape (DOM, classes,
 * focus index, events) lives in one module instead of being hand-built at every
 * call site. A control that edits a config path takes the settings binder in
 * its options and registers its own field, so the pane states the path once.
 */

export * from './labeled.js';
export * from './hint.js';
export * from './section.js';
export * from './toggle.js';
export * from './text-field.js';
export * from './mini-button.js';
export * from './app-row.js';
export * from './gallery.js';
export * from './option-stepper.js';
