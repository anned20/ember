import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createFocusManager} from '@focus/focus.js';

const onLongPress = vi.fn();
let root: HTMLElement;
let manager: ReturnType<typeof createFocusManager>;

function key(type: string, keyCode: number, keyName?: string): KeyboardEvent {
  const event = new KeyboardEvent(type, {key: keyName || '', bubbles: true, cancelable: true});
  Object.defineProperty(event, 'keyCode', {value: keyCode});
  document.dispatchEvent(event);
  return event;
}

/** A focusable marked for the hold gesture, focused and ready. */
function markedTile(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'focusable';
  button.dataset.longPress = '';
  root.appendChild(button);
  button.focus();
  return button;
}

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  root.id = 'app-long-press';
  document.body.appendChild(root);
  manager = createFocusManager(root, {onLongPress});
});

afterEach(() => {
  manager.destroy();
  root.remove();
  onLongPress.mockClear();
  vi.useRealTimers();
});

describe('long press on a marked tile', () => {
  it('raises onLongPress after the hold and swallows the release', () => {
    const button = markedTile();
    let clicks = 0;
    button.addEventListener('click', () => { clicks += 1; });

    key('keydown', 13, 'Enter');
    vi.advanceTimersByTime(1500);

    expect(onLongPress).toHaveBeenCalledWith(button);
    expect(clicks).toBe(0);

    key('keyup', 13, 'Enter');
    expect(clicks).toBe(0);
  });

  it('clicks the tile on a quick release (a normal Select)', () => {
    const button = markedTile();
    let clicks = 0;
    button.addEventListener('click', () => { clicks += 1; });

    key('keydown', 13, 'Enter');
    vi.advanceTimersByTime(400);
    key('keyup', 13, 'Enter');

    expect(clicks).toBe(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels the hold when another key arrives', () => {
    markedTile();
    key('keydown', 13, 'Enter');
    vi.advanceTimersByTime(400);
    key('keydown', 403, 'Red');
    vi.advanceTimersByTime(2000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not start a hold on an unmarked focusable', () => {
    const plain = document.createElement('button');
    plain.className = 'focusable';
    root.appendChild(plain);
    plain.focus();
    let clicks = 0;
    plain.addEventListener('click', () => { clicks += 1; });

    key('keydown', 13, 'Enter');
    expect(clicks).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
