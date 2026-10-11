import {describe, expect, it} from 'vitest';
import {createAppRow} from '@settings/components/app-row.js';

describe('createAppRow', () => {
  it('styles pinned rows and appends title suffix', () => {
    const pinned = createAppRow({
      title: 'Netflix', icon: 'assets/n.png', variant: 'pinned',
      missing: true, titleSuffix: ' \u2014 not installed on this TV',
      mountIcon: (img) => { img.src = 'assets/n.png'; }
    });
    expect(pinned.row.className).toContain('settings-pinned-row');
    expect(pinned.row.className).toContain('is-missing');
    expect(pinned.title.className).toBe('settings-pinned-title');
    expect(pinned.title.textContent).toBe('Netflix \u2014 not installed on this TV');
    expect(pinned.row.querySelector('img')).not.toBeNull();

    const plain = createAppRow({title: 'YouTube'});
    expect(plain.row.className).toBe('settings-app-row');
    expect(plain.row.querySelector('img')).toBeNull();
    expect(plain.title.className).toBe('');
  });
});
