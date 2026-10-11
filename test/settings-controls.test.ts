import {describe, expect, it, vi} from 'vitest';
import {
  labeledControl,
  labeledBlock,
  createHint,
  createSection,
  createToggle,
  createTextField,
  createMiniButton,
  createAppRow,
  createGallery
} from '../src/ts/settings-controls.js';

describe('settings control kit', () => {
  it('createHint builds a settings-hint paragraph, with an extra class', () => {
    const hint = createHint('hello', 'ai-status-line');
    expect(hint.tagName).toBe('P');
    expect(hint.className).toBe('settings-hint ai-status-line');
    expect(hint.textContent).toBe('hello');
  });

  it('createSection builds a settings-section with an h3 heading', () => {
    const section = createSection('Clock & icons');
    expect(section.className).toBe('settings-section');
    const heading = section.querySelector('h3');
    expect(heading && heading.textContent).toBe('Clock & icons');
  });

  it('createToggle wires the checkbox, focus index and change handler', () => {
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

  it('createTextField builds a labelled input and applies type attributes', () => {
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

  it('createTextField can build a textarea block row', () => {
    const field = createTextField({label: 'URLs', focusIndex: 932, textarea: true, block: true});
    expect(field.input.tagName).toBe('TEXTAREA');
    expect(field.input.className).toBe('settings-textarea focusable');
    expect(field.row.className).toBe('settings-block');
    expect(field.row.querySelector('.settings-block-label')!.textContent).toBe('URLs');
  });

  it('createMiniButton wires classes, dataset and click', () => {
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

  it('labeledControl and labeledBlock lay out a label plus control', () => {
    const control = document.createElement('input');
    const row = labeledControl('Name', control);
    expect(row.className).toBe('settings-row');
    expect(row.lastChild).toBe(control);

    const block = labeledBlock('Tracks', control);
    expect(block.className).toBe('settings-block');
    expect(block.querySelector('.settings-block-label')!.textContent).toBe('Tracks');
  });

  it('createAppRow styles pinned rows and appends title suffix', () => {
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

  it('createGallery builds tiles, selects one and re-paints selection', () => {
    const onSelect = vi.fn();
    const gallery = createGallery({
      heading: 'Choose an online photo',
      focusIndex: 905,
      selectedId: 'a',
      entries: [
        {id: 'a', title: 'Alpha', sources: ['a.jpg', 'a2.jpg']},
        {id: 'b', title: 'Beta', sources: ['b.jpg']},
        {id: 'text', title: 'Text only', text: true}
      ],
      onSelect
    });

    const tiles = gallery.grid.querySelectorAll('.photo-picker-tile');
    expect(tiles.length).toBe(3);
    expect((tiles[0] as HTMLElement).dataset.galleryId).toBe('a');
    expect((tiles[0] as HTMLElement).classList.contains('is-selected')).toBe(true);
    expect((tiles[0] as HTMLElement).dataset.focusIndex).toBe('905');
    expect((tiles[2] as HTMLElement).classList.contains('photo-picker-tile-text')).toBe(true);

    (tiles[1] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('b');

    gallery.markSelection('b');
    expect((tiles[1] as HTMLElement).classList.contains('is-selected')).toBe(true);
    expect((tiles[0] as HTMLElement).classList.contains('is-selected')).toBe(false);
  });

  it('createGallery falls back through image sources before failing', () => {
    const gallery = createGallery({
      heading: 'Photos',
      focusIndex: 905,
      entries: [{id: 'a', title: 'A', sources: ['first.jpg', 'second.jpg']}],
      onSelect: () => {}
    });
    const img = gallery.grid.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('first.jpg');
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe('second.jpg');
    img.dispatchEvent(new Event('error'));
    expect(img.closest('.photo-picker-tile')!.classList.contains('photo-picker-thumb-failed')).toBe(true);
  });
});
