import {describe, expect, it, vi} from 'vitest';
import {
  createBinder, field, getPathValue, setPathValue, stepperField, textField, toggleField
} from '../src/ts/settings-binding.js';
import type {FieldValue} from '../src/ts/settings-binding.js';
import type {Config} from '../src/ts/types.js';

/** A control backed by a plain object, so the binder runs without the DOM. */
function fakeControl(path: string, initial: FieldValue) {
  const state = {value: initial};
  return {
    state: state,
    field: field(path, {
      read: function () { return state.value; },
      write: function (value) { state.value = value as FieldValue; }
    })
  };
}

describe('settings binder', () => {
  it('binds the config tree into controls and collects controls back', () => {
    const source = {
      launcher: {iconAlign: 'right', iconsPerRow: 9},
      music: {shuffle: true}
    } as unknown as Config;

    const binder = createBinder(source);
    const align = fakeControl('launcher.iconAlign', null);
    const perRow = fakeControl('launcher.iconsPerRow', null);
    const shuffle = fakeControl('music.shuffle', null);

    binder.bind(align.field);
    binder.bind(perRow.field);
    binder.bind(shuffle.field);

    // bind() read config -> control as each field was added.
    expect(align.state.value).toBe('right');
    expect(perRow.state.value).toBe(9);
    expect(shuffle.state.value).toBe(true);

    // Edit the controls, then collect into a fresh tree.
    align.state.value = 'center';
    perRow.state.value = 11;
    shuffle.state.value = false;
    const out = {} as unknown as Config;
    binder.collect(out);

    expect(getPathValue(out, 'launcher.iconAlign')).toBe('center');
    expect(getPathValue(out, 'launcher.iconsPerRow')).toBe(11);
    expect(getPathValue(out, 'music.shuffle')).toBe(false);
  });

  it('runs hooks after the plain fields are collected', () => {
    const binder = createBinder({} as unknown as Config);
    binder.hook(function (config) {
      (config.launcher as unknown as Record<string, unknown>).mirrored =
        getPathValue(config, 'launcher.source');
    });
    const control = fakeControl('launcher.source', 41);
    binder.add(control.field);

    const out = {} as unknown as Config;
    binder.collect(out);
    expect(getPathValue(out, 'launcher.mirrored')).toBe(41);
  });

  it('readInto pushes the tree back into the controls', () => {
    const binder = createBinder({} as unknown as Config);
    const control = fakeControl('launcher.iconSize', 'small');
    binder.bind(control.field);

    binder.readInto({launcher: {iconSize: 'large'}} as unknown as Config);
    expect(control.state.value).toBe('large');
  });

  it('add() registers a field without reading the config into it', () => {
    const binder = createBinder({launcher: {iconSize: 'large'}} as unknown as Config);
    const control = fakeControl('launcher.iconSize', 'small');
    binder.add(control.field);
    expect(control.state.value).toBe('small');
  });

  it('reads and writes dotted paths, creating missing parents', () => {
    const tree: Record<string, unknown> = {};
    setPathValue(tree, 'a.b.c', 5);
    expect(getPathValue(tree, 'a.b.c')).toBe(5);
    expect(getPathValue(tree, 'a.b.missing')).toBeUndefined();
  });

  it('does not trip on a path through a non-object', () => {
    expect(getPathValue({a: 3}, 'a.b.c')).toBeUndefined();
  });
});

describe('settings binder adapters', () => {
  it('round-trips a toggle through a checkbox', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    const toggle = toggleField(input, 'music.enabled');

    toggle.write(true);
    expect(input.checked).toBe(true);
    expect(toggle.read()).toBe(true);

    input.checked = false;
    expect(toggle.read()).toBe(false);
  });

  it('applies a text codec on read-back and collect', () => {
    const input = document.createElement('input');
    const range = textField(input, 'background.overlayOpacity', {
      parse: function (raw) { return Number(raw) / 100; },
      format: function (value) { return String(Math.round(Number(value || 0.45) * 100)); }
    });

    range.write(0.45);
    expect(input.value).toBe('45');
    input.value = '60';
    expect(range.read()).toBe(0.6);
  });

  it('parses and formats an option stepper', () => {
    const el = {
      value: '5',
      setValue: vi.fn(function (next: string) { el.value = next; })
    };
    const stepper = stepperField(el, 'launcher.customScreensaverMinutes', {
      parse: function (raw) {
        const n = parseInt(raw, 10);
        return isNaN(n) || n < 1 ? 5 : n;
      }
    });

    stepper.write(20);
    expect(el.value).toBe('20');
    el.value = '0';
    expect(stepper.read()).toBe(5);
  });
});
