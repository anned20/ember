import {describe, expect, it} from 'vitest';
import {
  attachInputScrollHelpers,
  beginSettingsTextEdit,
  endSettingsTextEdit,
  isEditingSettingsText,
  isSettingsTextField
} from '@settings/text-gate.js';

function input(type: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return el;
}

describe('isSettingsTextField', () => {
  it('recognises the editable input types and textareas', () => {
    for (const type of ['text', 'number', 'search', 'url', 'password']) {
      expect(isSettingsTextField(input(type))).toBe(true);
    }
    expect(isSettingsTextField(document.createElement('textarea'))).toBe(true);
  });

  it('rejects non-text controls and null', () => {
    expect(isSettingsTextField(null)).toBe(false);
    expect(isSettingsTextField(document.createElement('div'))).toBe(false);
    expect(isSettingsTextField(input('checkbox'))).toBe(false);
    expect(isSettingsTextField(input('range'))).toBe(false);
  });
});

describe('text edit mode', () => {
  it('enters and leaves edit mode through the helpers', () => {
    const el = input('text');
    expect(isEditingSettingsText(el)).toBe(false);

    expect(beginSettingsTextEdit(el)).toBe(true);
    expect(el.readOnly).toBe(false);
    expect(el.dataset.tvEdit).toBe('1');
    expect(isEditingSettingsText(el)).toBe(true);

    endSettingsTextEdit(el);
    expect(el.readOnly).toBe(true);
    expect(el.dataset.tvEdit).toBeUndefined();
    expect(isEditingSettingsText(el)).toBe(false);
  });

  it('leaves non-text elements alone', () => {
    expect(beginSettingsTextEdit(document.createElement('div'))).toBe(false);
    endSettingsTextEdit(document.createElement('div'));
  });
});

describe('attachInputScrollHelpers', () => {
  it('gates text fields read-only and re-locks them on blur', () => {
    const container = document.createElement('div');
    const el = input('text');
    container.appendChild(el);
    attachInputScrollHelpers(container);

    expect(el.readOnly).toBe(true);
    expect(el.dataset.tvKeyboardGated).toBe('1');

    beginSettingsTextEdit(el);
    expect(el.readOnly).toBe(false);

    el.dispatchEvent(new Event('blur'));
    expect(el.readOnly).toBe(true);
    expect(el.dataset.tvEdit).toBeUndefined();
  });

  it('gates number inputs and textareas but not checkboxes', () => {
    const container = document.createElement('div');
    const number = input('number');
    const area = document.createElement('textarea');
    const check = input('checkbox');
    container.append(number, area, check);
    attachInputScrollHelpers(container);

    expect(number.readOnly).toBe(true);
    expect(area.readOnly).toBe(true);
    expect(check.readOnly).toBe(false);
    expect(check.dataset.tvKeyboardGated).toBeUndefined();
  });

  it('enters edit mode on a pointer click while read-only', () => {
    const container = document.createElement('div');
    const el = input('text');
    container.appendChild(el);
    attachInputScrollHelpers(container);

    el.dispatchEvent(new MouseEvent('click'));
    expect(el.readOnly).toBe(false);
  });

  it('does nothing without a container', () => {
    expect(() => attachInputScrollHelpers(null)).not.toThrow();
  });
});
