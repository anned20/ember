import {describe, expect, it} from 'vitest';
import {createTextField} from '@settings/components/text-field.js';
import {createBinder} from '@settings/settings-binding.js';
import type {Config} from '@lib/types.js';

describe('createTextField', () => {
  it('builds a labelled input and applies type attributes', () => {
    const field = createTextField({
      label: 'Seconds per slide', focusIndex: 933, type: 'number', min: '30', max: '3600'
    });
    expect(field.input.tagName).toBe('INPUT');
    expect(field.input.type).toBe('number');
    expect(field.input.min).toBe('30');
    expect(field.input.max).toBe('3600');
    expect(field.input.className).toBe('settings-text focusable');
    expect(field.row.querySelector('span')!.textContent).toBe('Seconds per slide');
  });

  it('can build a textarea block row', () => {
    const field = createTextField({label: 'URLs', focusIndex: 932, textarea: true, block: true});
    expect(field.input.tagName).toBe('TEXTAREA');
    expect(field.input.className).toBe('settings-textarea focusable');
    expect(field.row.className).toBe('settings-block');
    expect(field.row.querySelector('.settings-block-label')!.textContent).toBe('URLs');
  });

  it('exposes a config field carrying the path when one is given', () => {
    const plain = createTextField({label: 'URL', focusIndex: 931});
    expect(plain.field).toBeUndefined();

    const field = createTextField({label: 'URL', focusIndex: 931, path: 'background.url', trim: true});
    expect(field.field!.path).toBe('background.url');
    field.field!.write('https://example.com/a.jpg');
    expect(field.input.value).toBe('https://example.com/a.jpg');
    field.input.value = '  https://example.com/b.jpg  ';
    expect(field.field!.read()).toBe('https://example.com/b.jpg');
  });

  it('registers its own field with the injected binder, codec included', () => {
    const binder = createBinder({background: {overlayOpacity: 0.45}} as unknown as Config);
    const field = createTextField({
      label: 'Overlay opacity', focusIndex: 935, path: 'background.overlayOpacity',
      parse: function (raw) { return Number(raw) / 100; },
      format: function (value) { return String(Math.round(Number(value || 0.45) * 100)); },
      binder: binder
    });
    // Read-back runs through the codec: 0.45 → "45".
    expect(field.input.value).toBe('45');

    field.input.value = '30';
    const out = {} as Config;
    binder.collect(out);
    expect(out.background.overlayOpacity).toBe(0.3);
  });
});
