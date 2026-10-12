import {describe, expect, it, vi} from 'vitest';
import {createOptionStepper} from '@settings/components/option-stepper.js';

const options = [
  {value: 'a', label: 'Alpha'},
  {value: 'b', label: 'Beta'},
  {value: 'c', label: 'Gamma'}
];

describe('createOptionStepper', () => {
  it('builds the arrows, label and focus index', () => {
    const stepper = createOptionStepper('', 904, options, 'b');
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
    const stepper = createOptionStepper('', 904, options, 'a', onChange);

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
    const stepper = createOptionStepper('', 904, options, 'a');
    stepper.setOptions([{value: 'x', label: 'X'}, {value: 'y', label: 'Y'}], 'y');
    expect(stepper.value).toBe('y');

    stepper.setValue('x');
    expect(stepper.value).toBe('x');
    expect(stepper.querySelector('.stepper-label')!.textContent).toBe('X');
  });

  it('steps on arrow and body clicks', () => {
    const stepper = createOptionStepper('', 904, options, 'a');
    const arrows = stepper.querySelectorAll<HTMLElement>('.stepper-arrow');

    arrows[1].click();
    expect(stepper.value).toBe('b');
    arrows[0].click();
    expect(stepper.value).toBe('a');

    stepper.click();
    expect(stepper.value).toBe('b');
  });
});
