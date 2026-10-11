import {describe, expect, it} from 'vitest';
import {createHint} from '../../../src/ts/components/settings/hint.js';

describe('createHint', () => {
  it('builds a settings-hint paragraph, with an extra class', () => {
    const hint = createHint('hello', 'ai-status-line');
    expect(hint.tagName).toBe('P');
    expect(hint.className).toBe('settings-hint ai-status-line');
    expect(hint.textContent).toBe('hello');
  });
});
