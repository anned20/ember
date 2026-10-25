import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {REMOTE_KEY} from '@lib/remote.js';
import {createSettingsNavigation} from '@settings/navigation.js';

interface Fixture {
  root: HTMLElement;
  panel: HTMLElement;
  save: HTMLButtonElement;
  close: HTMLButtonElement;
  tabs: HTMLButtonElement[];
  pane: HTMLElement;
  body: HTMLElement;
}

function makeHost() {
  return {
    // A stand-in for the router's painter: paint the chrome and take DOM focus,
    // but skip the real visibility/geometry checks (jsdom reports zero rects).
    focusItem: vi.fn(function (el: HTMLElement | null) {
      if (!el) return false;
      document.querySelectorAll('.focused').forEach(function (n) {
        n.classList.remove('focused');
      });
      el.classList.add('focused');
      if (typeof el.focus === 'function') el.focus({preventScroll: true});
      return true;
    }),
    isFocusable: vi.fn(function (el: HTMLElement | null) {
      return !!el && !(el as HTMLButtonElement).disabled;
    }),
    noteRemoteNav: vi.fn()
  };
}

function buildFixture(): Fixture {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  root.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'settings-header';
  const save = document.createElement('button');
  save.className = 'settings-save focusable';
  const close = document.createElement('button');
  close.className = 'settings-close focusable';
  header.appendChild(save);
  header.appendChild(close);
  panel.appendChild(header);

  const nav = document.createElement('nav');
  nav.className = 'settings-nav';
  const tabs = ['look', 'music', 'apps'].map(function (id, i) {
    const btn = document.createElement('button');
    btn.className = 'settings-tab focusable' + (i === 0 ? ' active' : '');
    btn.dataset.tab = id;
    btn.textContent = id;
    nav.appendChild(btn);
    return btn;
  });
  panel.appendChild(nav);

  const body = document.createElement('div');
  body.className = 'settings-body';
  const pane = document.createElement('div');
  pane.className = 'settings-tab-pane is-active';
  pane.dataset.tab = 'look';
  body.appendChild(pane);
  panel.appendChild(body);

  return {root, panel, save, close, tabs, pane, body};
}

describe('settings navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks the category list and activates the tab it lands on', () => {
    const {root, tabs} = buildFixture();
    const activated: string[] = [];
    tabs.forEach(function (t) {
      t.addEventListener('settings-activate-tab', function () {
        activated.push(t.dataset.tab as string);
      });
    });
    const nav = createSettingsNavigation(root, makeHost());

    tabs[0].focus();
    expect(nav.move(REMOTE_KEY.DOWN)).toBe(true);
    expect(document.activeElement).toBe(tabs[1]);
    expect(activated).toEqual(['music']);

    expect(nav.move(REMOTE_KEY.DOWN)).toBe(true);
    expect(document.activeElement).toBe(tabs[2]);
    expect(activated).toEqual(['music', 'apps']);
  });

  it('reaches the header actions past the top of the category list', () => {
    const {root, tabs, save} = buildFixture();
    const nav = createSettingsNavigation(root, makeHost());

    tabs[0].focus();
    expect(nav.move(REMOTE_KEY.UP)).toBe(true);
    expect(document.activeElement).toBe(save);
  });

  it('moves between Save and Close', () => {
    const {root, save, close} = buildFixture();
    const nav = createSettingsNavigation(root, makeHost());

    save.focus();
    expect(nav.move(REMOTE_KEY.RIGHT)).toBe(true);
    expect(document.activeElement).toBe(close);

    expect(nav.move(REMOTE_KEY.LEFT)).toBe(true);
    expect(document.activeElement).toBe(save);
  });

  it('recovers focus onto a control when focus was lost', () => {
    const {root, save} = buildFixture();
    const host = makeHost();
    const nav = createSettingsNavigation(root, host);
    (document.activeElement as HTMLElement | null)?.blur();

    expect(nav.recover(false)).toBe(true);
    expect(host.focusItem).toHaveBeenCalled();
    expect(document.activeElement).toBe(save);
  });

  it('selects a photo tile and moves past the grid on activate', () => {
    const {root, pane} = buildFixture();
    const grid = document.createElement('div');
    grid.className = 'photo-picker-grid';
    const tile = document.createElement('div');
    tile.className = 'photo-picker-tile focusable';
    tile.tabIndex = 0;
    grid.appendChild(tile);
    const after = document.createElement('input');
    after.type = 'text';
    after.readOnly = true;
    after.className = 'focusable';
    pane.appendChild(grid);
    pane.appendChild(after);

    const clicked = vi.fn();
    tile.addEventListener('click', clicked);
    const nav = createSettingsNavigation(root, makeHost());

    tile.focus();
    expect(nav.activate(tile)).toBe(true);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(after);
  });

  it('ignores a non-photo control on activate', () => {
    const {root} = buildFixture();
    const nav = createSettingsNavigation(root, makeHost());
    expect(nav.activate(document.body)).toBe(false);
  });

  it('lets the wheel scroll the pane natively and keeps visible focus', () => {
    vi.useFakeTimers();
    const {root, pane} = buildFixture();
    const btn = document.createElement('button');
    btn.className = 'focusable';
    pane.appendChild(btn);
    const nav = createSettingsNavigation(root, makeHost());

    btn.focus();
    const event = new WheelEvent('wheel', {deltaY: 120, bubbles: true, cancelable: true});
    btn.dispatchEvent(event);
    nav.wheel(event);
    vi.advanceTimersByTime(200);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('drives the pane itself when the wheel is outside it', () => {
    vi.useFakeTimers();
    const {root, body} = buildFixture();
    Object.defineProperty(body, 'scrollTop', {value: 0, writable: true});
    const nav = createSettingsNavigation(root, makeHost());

    const event = new WheelEvent('wheel', {deltaY: 120, cancelable: true});
    nav.wheel(event);
    vi.advanceTimersByTime(200);

    expect(event.defaultPrevented).toBe(true);
    expect(body.scrollTop).toBe(120);
  });

  it('re-anchors focus to the nearest visible row after the wheel settles', () => {
    vi.useFakeTimers();
    const {root, pane, body} = buildFixture();
    Object.defineProperty(body, 'scrollTop', {value: 0, writable: true});
    const gone = document.createElement('button');
    const near = document.createElement('button');
    const far = document.createElement('button');
    [gone, near, far].forEach(function (btn) {
      btn.className = 'focusable';
      pane.appendChild(btn);
    });
    stubRect(body, 0, 600);
    stubRect(gone, -120, -70);
    stubRect(near, 100, 150);
    stubRect(far, 300, 350);
    const host = makeHost();
    const nav = createSettingsNavigation(root, host);

    gone.focus();
    nav.wheel(new WheelEvent('wheel', {deltaY: 120, cancelable: true}));
    vi.advanceTimersByTime(200);

    expect(document.activeElement).toBe(near);
    expect(host.focusItem).toHaveBeenCalledWith(near);
  });
});

function stubRect(el: HTMLElement, top: number, bottom: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: function () {
      return {
        top, bottom, left: 0, right: 100, width: 100, height: bottom - top,
        x: 0, y: top, toJSON: function () { return {}; }
      };
    }
  });
}
