import {describe, expect, it, vi} from 'vitest';
import {createProviderPicker} from '@settings/components/provider-picker.js';

describe('createProviderPicker', () => {
  it('builds a radiogroup of three indexed cards', () => {
    const picker = createProviderPicker(1970);
    expect(picker.className).toBe('ai-provider-pick');
    expect(picker.getAttribute('role')).toBe('radiogroup');
    expect(picker.getAttribute('aria-label')).toBe('AI assistant');

    const cards = picker.querySelectorAll<HTMLButtonElement>('.ai-provider-card');
    expect(cards.length).toBe(3);
    expect(Array.from(cards).map((c) => c.dataset.focusIndex)).toEqual(['1970', '1971', '1972']);
    expect(picker.value).toBe('xai');
    expect(picker.querySelector('[data-value="xai"]')!.classList.contains('is-selected')).toBe(true);
    expect(picker.querySelector('[data-value="xai"] .ai-provider-card-name')!.textContent).toBe('Grok');
    expect(picker.querySelector('[data-value="xai"] .ai-provider-card-sub')!.textContent)
      .toBe('xAI · voice, chat, and spoken answers');
  });

  it('selects a card on click and reports the change', () => {
    const onChange = vi.fn();
    const picker = createProviderPicker(1970, onChange);

    picker.querySelector<HTMLButtonElement>('[data-value="gemini"]')!.click();
    expect(picker.value).toBe('gemini');
    expect(onChange).toHaveBeenLastCalledWith('gemini');
    expect(picker.querySelector('[data-value="gemini"]')!.getAttribute('aria-checked')).toBe('true');
    expect(picker.querySelector('[data-value="xai"]')!.getAttribute('aria-checked')).toBe('false');

    // Re-selecting the current card is a no-op.
    picker.querySelector<HTMLButtonElement>('[data-value="gemini"]')!.click();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('sets a value silently and folds unknown values to xai', () => {
    const onChange = vi.fn();
    const picker = createProviderPicker(1970, onChange);

    picker.setValue('openrouter');
    expect(picker.value).toBe('openrouter');
    expect(onChange).not.toHaveBeenCalled();

    picker.setValue('nonsense');
    expect(picker.value).toBe('xai');
    expect(onChange).not.toHaveBeenCalled();
  });
});
