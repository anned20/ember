import {describe, expect, it, vi} from 'vitest';
import {createOptionStepper} from '@settings/components/option-stepper.js';
import {createBinder} from '@settings/settings-binding.js';
import type {Config} from '@lib/types.js';

const choices = [
  {value: 'a', label: 'Alpha'},
  {value: 'b', label: 'Beta'},
  {value: 'c', label: 'Gamma'}
];

describe('createOptionStepper', () => {
  it('builds the arrows, label and focus index', () => {
    const stepper = createOptionStepper({focusIndex: 904, choices, value: 'b'});
    expect(stepper.className).toBe('option-stepper focusable');
    expect(stepper.dataset.focusIndex).toBe('904');
    expect(stepper.tabIndex).toBe(0);
    expect(stepper.querySelectorAll('.stepper-arrow').length).toBe(2);
    expect(stepper.querySelector('.stepper-label')!.textContent).toBe('Beta');
    expect(stepper.value).toBe('b');
    expect(stepper.dataset.value).toBe('b');
  });

  it('steps within bounds and reports changes', () => {
    const onChange = vi.fn();
    const stepper = createOptionStepper({focusIndex: 904, choices, value: 'a', onChange});

    stepper.__step(-1);
    expect(stepper.value).toBe('a');
    expect(onChange).not.toHaveBeenCalled();

    stepper.__step(1);
    expect(stepper.value).toBe('b');
    expect(onChange).toHaveBeenLastCalledWith('b');

    stepper.__step(1);
    stepper.__step(1);
    expect(stepper.value).toBe('c');
    expect(stepper.querySelector('.stepper-label')!.textContent).toBe('Gamma');
  });

  it('sets options and value', () => {
    const stepper = createOptionStepper({focusIndex: 904, choices, value: 'a'});
    stepper.setOptions([{value: 'x', label: 'X'}, {value: 'y', label: 'Y'}], 'y');
    expect(stepper.value).toBe('y');

    stepper.setValue('x');
    expect(stepper.value).toBe('x');
    expect(stepper.querySelector('.stepper-label')!.textContent).toBe('X');
  });

  it('steps on arrow and body clicks', () => {
    const stepper = createOptionStepper({focusIndex: 904, choices, value: 'a'});
    const arrows = stepper.querySelectorAll<HTMLElement>('.stepper-arrow');

    arrows[1].click();
    expect(stepper.value).toBe('b');
    arrows[0].click();
    expect(stepper.value).toBe('a');

    stepper.click();
    expect(stepper.value).toBe('b');
  });

  it('registers its own field with the injected binder', () => {
    const binder = createBinder({launcher: {iconLayout: 'b'}} as unknown as Config);
    const stepper = createOptionStepper({
      focusIndex: 1007, choices: choices, path: 'launcher.iconLayout', binder: binder
    });
    // Read-back: the picker shows what is configured.
    expect(stepper.value).toBe('b');

    stepper.setValue('c');
    const out = {} as Config;
    binder.collect(out);
    expect(out.launcher.iconLayout).toBe('c');
  });

  it('can add without read-back for a hand-initialised picker', () => {
    const binder = createBinder({launcher: {iconLayout: 'b'}} as unknown as Config);
    const stepper = createOptionStepper({
      focusIndex: 1007, choices: choices, value: 'a',
      path: 'launcher.iconLayout', readBack: false, binder: binder
    });
    // No read-back: the hand-set value stands.
    expect(stepper.value).toBe('a');

    const out = {} as Config;
    binder.collect(out);
    expect(out.launcher.iconLayout).toBe('a');
  });
});
