import {describe, expect, it, vi} from 'vitest';
import {createMiniButton} from '../../../src/ts/components/settings/mini-button.js';

describe('createMiniButton', () => {
  it('wires classes, dataset and click', () => {
    const onClick = vi.fn();
    const btn = createMiniButton({
      label: 'Scan', focusIndex: 1500, className: 'settings-scan-btn',
      dataset: {backupAction: 'backup'}, onClick
    });
    expect(btn.type).toBe('button');
    expect(btn.className).toBe('settings-mini-btn focusable settings-scan-btn');
    expect(btn.dataset.focusIndex).toBe('1500');
    expect(btn.dataset.backupAction).toBe('backup');
    expect(btn.textContent).toBe('Scan');
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
