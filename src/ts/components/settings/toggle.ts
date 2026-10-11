import {labeledControl} from './labeled.js';

export interface ToggleOptions {
  label: string;
  focusIndex: number | string;
  checked?: boolean;
  /** Extra class on the checkbox, after the default `focusable`. */
  className?: string;
  onChange?: (checked: boolean) => void;
}

export interface Toggle {
  row: HTMLDivElement;
  input: HTMLInputElement;
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
  return {row: labeledControl(options.label, input), input: input};
}
