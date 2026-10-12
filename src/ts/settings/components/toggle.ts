import {labeledControl} from './labeled.js';
import {registerField, toggleField} from '@settings/settings-binding.js';
import type {ConfigField, SettingsBinder} from '@settings/settings-binding.js';

export interface ToggleOptions {
  label: string;
  focusIndex: number | string;
  checked?: boolean;
  /** The config path this toggle edits (see settings-binding.js). */
  path?: string;
  /** The binder to register the field with; needs `path`. */
  binder?: SettingsBinder;
  /** Register without reading config back (hand-initialised). Default: true. */
  readBack?: boolean;
  /** Extra class on the checkbox, after the default `focusable`. */
  className?: string;
  onChange?: (checked: boolean) => void;
}

export interface Toggle {
  row: HTMLDivElement;
  input: HTMLInputElement;
  /** The control as a config field, when `path` was given. */
  field?: ConfigField;
}

/** A labelled checkbox, wired for D-pad focus and change events. */
export function createToggle(options: ToggleOptions): Toggle {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'focusable' + (options.className ? ' ' + options.className : '');
  input.dataset.focusIndex = String(options.focusIndex);
  input.checked = !!options.checked;
  if (options.onChange) {
    input.addEventListener('change', function () { options.onChange!(input.checked); });
  }
  const field = options.path ? toggleField(input, options.path) : undefined;
  if (field && options.binder) registerField(options.binder, field, options.readBack);
  return {
    row: labeledControl(options.label, input),
    input: input,
    field: field
  };
}
