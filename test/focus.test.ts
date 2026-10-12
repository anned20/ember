import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createFocusManager} from '@focus/focus.js';

const onNumber = vi.fn();
const onChannelUp = vi.fn();
const onChannelDown = vi.fn();
const onBlue = vi.fn();
let root: HTMLElement;

function press(keyCode: number, key?: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {key: key || '', bubbles: true, cancelable: true});
  Object.defineProperty(event, 'keyCode', {value: keyCode});
  document.dispatchEvent(event);
  return event;
}

beforeAll(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  createFocusManager(root, {
    onNumber: onNumber,
    onChannelUp: onChannelUp,
    onChannelDown: onChannelDown,
    onBlue: onBlue
  });
});

afterEach(() => {
  onNumber.mockClear();
  onChannelUp.mockClear();
  onChannelDown.mockClear();
  onBlue.mockClear();
  document.body.className = '';
  root.innerHTML = '';
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.blur) active.blur();
});

afterAll(() => {
  root.remove();
});

describe('number-key routing', () => {
  it('calls onNumber with the digit on the home screen', () => {
    press(49, '1');
    expect(onNumber).toHaveBeenCalledWith(1);
    press(57, '9');
    expect(onNumber).toHaveBeenCalledWith(9);
  });

  it('maps the numeric keypad too', () => {
    press(97, '');
    expect(onNumber).toHaveBeenCalledWith(1);
  });

  it('ignores 0 and non-number keys', () => {
    press(48, '0');
    press(37, 'ArrowLeft');
    press(13, 'Enter');
    expect(onNumber).not.toHaveBeenCalled();
  });

  it('ignores numbers while a settings text field is being edited', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = false;
    input.dataset.tvEdit = '1';
    root.appendChild(input);
    input.focus();
    press(49, '1');
    expect(onNumber).not.toHaveBeenCalled();
  });

  it('ignores numbers while Settings is open', () => {
    document.body.classList.add('settings-open');
    press(49, '1');
    expect(onNumber).not.toHaveBeenCalled();
  });

  it('ignores numbers while the All apps overlay is open', () => {
    const overlay = document.createElement('div');
    overlay.className = 'all-apps';
    overlay.appendChild(document.createElement('button'));
    root.appendChild(overlay);
    press(49, '1');
    expect(onNumber).not.toHaveBeenCalled();
  });
});

describe('channel-key routing', () => {
  it('fires onChannelUp / onChannelDown for the remote keycodes', () => {
    press(427);
    expect(onChannelUp).toHaveBeenCalledTimes(1);
    press(428);
    expect(onChannelDown).toHaveBeenCalledTimes(1);
  });

  it('normalises the ChannelUp / ChannelDown keyboard keys', () => {
    press(0, 'ChannelUp');
    expect(onChannelUp).toHaveBeenCalledTimes(1);
    press(0, 'ChannelDown');
    expect(onChannelDown).toHaveBeenCalledTimes(1);
  });

  it('does not fire for other keys', () => {
    press(37, 'ArrowLeft');
    press(38, 'ArrowUp');
    press(403, 'Red');
    press(13, 'Enter');
    press(49, '1');
    expect(onChannelUp).not.toHaveBeenCalled();
    expect(onChannelDown).not.toHaveBeenCalled();
  });
});

describe('blue-key routing', () => {
  it('fires onBlue for the remote keycode', () => {
    press(406);
    expect(onBlue).toHaveBeenCalledTimes(1);
  });

  it('does not fire onBlue for other colour keys', () => {
    press(403);
    press(404);
    press(405);
    expect(onBlue).not.toHaveBeenCalled();
  });
});

describe('settings delegation', () => {
  // Settings owns its navigation; the router only routes home keys itself and
  // hands the Settings surface a move/delegate handle.
  let appRoot: HTMLElement;
  let tab: HTMLElement;
  let settingsNavigation: {
    move: ReturnType<typeof vi.fn>;
    recover: ReturnType<typeof vi.fn>;
    wheel: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    appRoot = document.createElement('div');
    appRoot.id = 'app-2';
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    tab = document.createElement('button');
    tab.className = 'settings-tab focusable active';
    tab.textContent = 'Home';
    panel.appendChild(tab);
    appRoot.appendChild(panel);
    document.body.appendChild(appRoot);

    settingsNavigation = {
      move: vi.fn(function () { return true; }),
      recover: vi.fn(function () { return true; }),
      wheel: vi.fn(),
      activate: vi.fn(function () { return true; })
    };
    createFocusManager(appRoot, {}, {settingsNavigation});
    document.body.classList.add('settings-open');
  });

  afterEach(() => {
    appRoot.remove();
  });

  it('asks the settings navigation module for direction keys', () => {
    tab.focus();
    press(39, 'ArrowRight');
    expect(settingsNavigation.move).toHaveBeenCalledWith(39);
  });

  it('asks it to recover when focus was lost in the panel', () => {
    tab.blur();
    press(40, 'ArrowDown');
    expect(settingsNavigation.recover).toHaveBeenCalledWith(false);
  });

  it('asks it to handle the wheel inside the panel', () => {
    tab.focus();
    document.dispatchEvent(new WheelEvent('wheel', {deltaY: 120, bubbles: true, cancelable: true}));
    expect(settingsNavigation.wheel).toHaveBeenCalledTimes(1);
  });

  it('asks it to activate a photo tile on Select', () => {
    const tile = document.createElement('div');
    tile.className = 'photo-picker-tile focusable';
    tile.tabIndex = 0;
    tab.parentElement!.appendChild(tile);
    tile.focus();
    press(13, 'Enter');
    expect(settingsNavigation.activate).toHaveBeenCalledWith(tile);
  });
});
