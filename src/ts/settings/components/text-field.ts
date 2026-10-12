import {labeledControl, labeledBlock} from './labeled.js';
import {registerField, textField} from '@settings/settings-binding.js';
import type {ConfigField, FieldCodec, SettingsBinder} from '@settings/settings-binding.js';

export interface TextFieldOptions extends FieldCodec {
  label: string;
  focusIndex: number | string;
  type?: 'text' | 'number' | 'password' | 'search' | 'url' | 'range';
  value?: string;
  placeholder?: string;
  /** Render a `<textarea>` instead of an `<input>`. */
  textarea?: boolean;
  rows?: number;
  min?: string;
  max?: string;
  step?: string;
  spellcheck?: boolean;
  autocomplete?: string;
  /** The config path this field edits (see settings-binding.js). */
  path?: string;
  /** The binder to register the field with; needs `path`. */
  binder?: SettingsBinder;
  /** Register without reading config back (hand-initialised). Default: true. */
  readBack?: boolean;
  /** Overrides the default `settings-text focusable` / textarea class. */
  className?: string;
  /** Lay the label out as a `settings-block` heading instead of a row. */
  block?: boolean;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
}

export interface TextField {
  row: HTMLDivElement;
  input: HTMLInputElement & HTMLTextAreaElement;
  /** The control as a config field, when `path` was given. */
  field?: ConfigField;
}

/** A labelled text field (or textarea), gated for the TV keyboard elsewhere. */
export function createTextField(options: TextFieldOptions): TextField {
  const isTextarea = !!options.textarea;
  const input = document.createElement(isTextarea ? 'textarea' : 'input') as
    HTMLInputElement & HTMLTextAreaElement;
  const defaultClass = isTextarea ? 'settings-textarea focusable' : 'settings-text focusable';
  input.className = options.className || defaultClass;
  input.dataset.focusIndex = String(options.focusIndex);
  if (isTextarea) {
    input.rows = options.rows || 4;
  } else {
    input.type = options.type || 'text';
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step !== undefined) input.step = options.step;
    if (options.spellcheck === false) input.spellcheck = false;
    if (options.autocomplete) input.setAttribute('autocomplete', options.autocomplete);
  }
  if (options.placeholder !== undefined) input.placeholder = options.placeholder;
  if (options.value !== undefined) input.value = options.value;
  if (options.onInput) {
    input.addEventListener('input', function () { options.onInput!(input.value); });
  }
  if (options.onChange) {
    input.addEventListener('change', function () { options.onChange!(input.value); });
  }
  const row = options.block ? labeledBlock(options.label, input) : labeledControl(options.label, input);
  const field = options.path
    ? textField(input, options.path, {
      parse: options.parse, format: options.format, trim: options.trim
    })
    : undefined;
  if (field && options.binder) registerField(options.binder, field, options.readBack);
  return {row: row, input: input, field: field};
}
