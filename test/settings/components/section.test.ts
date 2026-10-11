import {describe, expect, it} from 'vitest';
import {createSection} from '@settings/components/section.js';

describe('createSection', () => {
  it('builds a settings-section with an h3 heading', () => {
    const section = createSection('Clock & icons');
    expect(section.className).toBe('settings-section');
    const heading = section.querySelector('h3');
    expect(heading && heading.textContent).toBe('Clock & icons');
  });
});
