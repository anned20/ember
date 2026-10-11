import {describe, expect, it} from 'vitest';
import {labeledControl, labeledBlock} from '../../../src/ts/components/settings/labeled.js';

describe('labeled layout', () => {
  it('labeledControl and labeledBlock lay out a label plus control', () => {
    const control = document.createElement('input');
    const row = labeledControl('Name', control);
    expect(row.className).toBe('settings-row');
    expect(row.lastChild).toBe(control);

    const block = labeledBlock('Tracks', control);
    expect(block.className).toBe('settings-block');
    expect(block.querySelector('.settings-block-label')!.textContent).toBe('Tracks');
  });
});
