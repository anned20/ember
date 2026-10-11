import {labeledControl} from './labeled.js';
import {toggleField} from '@settings/settings-binding.js';
import type {ConfigField} from '@settings/settings-binding.js';

export interface ToggleOptions {
  label: string;
  focusIndex: number | string;
  checked?: boolean;
  /** The config path this toggle edits (see settings-binding.js). */
  path?: string;
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
  return {
    row: labeledControl(options.label, input),
    input: input,
    field: options.path ? toggleField(input, options.path) : undefined
  };
}
