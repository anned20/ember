import {describe, expect, it, vi} from 'vitest';
import {createToggle} from '../../../src/ts/components/settings/toggle.js';

describe('createToggle', () => {
  it('wires the checkbox, focus index and change handler', () => {
    const onChange = vi.fn();
    const toggle = createToggle({label: 'Show clock', focusIndex: '1000', checked: true, onChange});
    expect(toggle.input.type).toBe('checkbox');
    expect(toggle.input.checked).toBe(true);
    expect(toggle.input.dataset.focusIndex).toBe('1000');
    expect(toggle.input.className).toBe('focusable');
    expect(toggle.row.className).toBe('settings-row');
    expect(toggle.row.textContent).toContain('Show clock');

    toggle.input.checked = false;
    toggle.input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
