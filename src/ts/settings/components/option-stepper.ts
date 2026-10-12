import {registerField, stepperField} from '@settings/settings-binding.js';
import type {FieldCodec, SettingsBinder} from '@settings/settings-binding.js';

/** One choice in a createOptionStepper picker. */
export interface StepperOption {
  value: string;
  label: string;
}

/** A createOptionStepper control: a div carrying the picker's own API. */
export interface OptionStepperElement extends HTMLDivElement {
  value: string;
  setOptions(options: StepperOption[], value?: string): void;
  setValue(value: string): void;
  __step(dir: number): void;
}

/** The arguments for createOptionStepper. */
export interface OptionStepperOptions extends FieldCodec {
  /** The choices to step through. */
  choices: StepperOption[];
  focusIndex: number | string;
  /** The initially selected value; falls back to the first choice. */
  value?: string;
  /** Extra class on the control, after the default `focusable`. */
  className?: string;
  onChange?: (value: string) => void;
  /** The config path this picker edits (see settings-binding.js). */
  path?: string;
  /** The binder to register the field with; needs `path`. */
  binder?: SettingsBinder;
  /** Register without reading config back (hand-initialised). Default: true. */
  readBack?: boolean;
}

/** A `‹ label ›` picker: arrows step through options, clicking the body advances. */
export function createOptionStepper(options: OptionStepperOptions): OptionStepperElement {
  const className = options.className || '';
  const el = document.createElement('div') as OptionStepperElement;
  el.className = 'option-stepper focusable' + (className ? ' ' + className : '');
  el.dataset.focusIndex = String(options.focusIndex);
  el.tabIndex = 0;

  const prev = document.createElement('span');
  prev.className = 'stepper-arrow';
  prev.textContent = '\u2039';

  const labelEl = document.createElement('span');
  labelEl.className = 'stepper-label';

  const next = document.createElement('span');
  next.className = 'stepper-arrow';
  next.textContent = '\u203A';

  el.appendChild(prev);
  el.appendChild(labelEl);
  el.appendChild(next);

  let choices = options.choices.slice();
  let index = 0;

  function indexOfValue(value: string | undefined): number {
    for (let i = 0; i < choices.length; i += 1) {
      if (choices[i].value === value) return i;
    }
    return -1;
  }

  function render() {
    const opt = choices[index] || {value: '', label: ''};
    labelEl.textContent = opt.label;
    el.value = opt.value;
    el.dataset.value = opt.value;
    prev.classList.toggle('is-disabled', index <= 0);
    next.classList.toggle('is-disabled', index >= choices.length - 1);
  }

  el.__step = function (dir: number) {
    if (!choices.length) return;
    let n = index + dir;
    if (n < 0) n = 0;
    if (n > choices.length - 1) n = choices.length - 1;
    if (n !== index) {
      index = n;
      render();
      if (options.onChange) options.onChange(el.value);
    }
  };

  el.setOptions = function (newOptions: StepperOption[], newValue?: string) {
    choices = (newOptions || []).slice();
    const found = indexOfValue(newValue);
    index = found >= 0 ? found : 0;
    render();
  };

  el.setValue = function (value: string) {
    const found = indexOfValue(value);
    if (found >= 0 && found !== index) {
      index = found;
      render();
    }
  };

  prev.addEventListener('click', function (event) {
    event.stopPropagation();
    el.__step(-1);
  });

  next.addEventListener('click', function (event) {
    event.stopPropagation();
    el.__step(1);
  });

  el.addEventListener('click', function (event) {
    if (event.target === prev || event.target === next) return;
    el.__step(1);
  });

  const start = indexOfValue(options.value);
  index = start >= 0 ? start : 0;
  render();
  if (options.path && options.binder) {
    registerField(options.binder, stepperField(el, options.path, {
      parse: options.parse, format: options.format
    }), options.readBack);
  }
  return el;
}
