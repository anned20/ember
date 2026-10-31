import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createNetworkStatus} from '@home/network-status.js';
import {setLanguage} from '@lib/i18n.js';
import {setLunaAdapter} from '@luna/luna-transport.js';
import type {LunaAdapter} from '@luna/luna-transport.js';
import type {Config, WebOSServiceRequestOptions} from '@lib/types.js';

interface Sent {
  uri: string;
  options: WebOSServiceRequestOptions;
}

function fakeBus(handler: (uri: string, options: WebOSServiceRequestOptions) => void): {
  adapter: LunaAdapter;
  sent: Sent[];
  cancel: ReturnType<typeof vi.fn>;
} {
  const sent: Sent[] = [];
  const cancel = vi.fn();
  return {
    sent: sent,
    cancel: cancel,
    adapter: {
      request: function (uri, options) {
        sent.push({uri: uri, options: options});
        handler(uri, options);
        return {cancel: cancel};
      }
    }
  };
}

function config(show: boolean): Config {
  return {launcher: {showNetworkStatus: show}} as unknown as Config;
}

function wifiHandler(_uri: string, options: WebOSServiceRequestOptions): void {
  options.onSuccess!({
    returnValue: true,
    wifi: {state: 'connected'},
    wired: {state: 'disconnected'}
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

function setup(handler: (uri: string, options: WebOSServiceRequestOptions) => void, show = true) {
  const button = document.createElement('button');
  document.body.appendChild(button);
  const bus = fakeBus(handler);
  setLunaAdapter(bus.adapter);
  const state = {enabled: show, active: true};
  const onClick = vi.fn();
  const handle = createNetworkStatus(button, {
    getConfig: function () { return config(state.enabled); },
    isActive: function () { return state.active; },
    onOpenNetworkSettings: onClick
  });
  return {button: button, bus: bus, handle: handle, onClick: onClick, state: state};
}

beforeEach(() => {
  document.body.innerHTML = '';
  setLanguage('en');
});

afterEach(() => {
  setLunaAdapter(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('network status chip', () => {
  it('paints Wi-Fi when the link is up and the probe resolves', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(wifiHandler);

    chip.handle.start();
    await flush();

    expect(chip.button.hidden).toBe(false);
    expect(chip.button.dataset.state).toBe('wifi');
    expect(chip.button.getAttribute('aria-label')).toBe('Wi-Fi connected');
  });

  it('paints Ethernet when the wired link is up', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(function (_uri, options) {
      options.onSuccess!({
        returnValue: true,
        wifi: {state: 'disconnected'},
        wired: {state: 'connected'}
      });
    });

    chip.handle.start();
    await flush();

    expect(chip.button.dataset.state).toBe('ethernet');
    expect(chip.button.getAttribute('aria-label')).toBe('Ethernet connected');
  });

  it('waits for a second failed probe before painting no internet', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const chip = setup(wifiHandler);

    chip.handle.start();
    await flush();

    // A single failure is not yet an outage.
    expect(chip.button.dataset.state).toBe('wifi');

    await vi.advanceTimersByTimeAsync(10000);
    expect(chip.button.dataset.state).toBe('no-internet');
    expect(chip.button.getAttribute('aria-label')).toBe('No internet connection');
  });

  it('does not call no-internet when only the first probe host is blocked', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.indexOf('cloudflare') >= 0) throw new Error('blocked');
      return {};
    }));
    const chip = setup(wifiHandler);

    chip.handle.start();
    await flush();

    expect(chip.button.dataset.state).toBe('wifi');
  });

  it('paints offline as soon as there is no link', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(function (_uri, options) {
      options.onSuccess!({
        returnValue: true,
        wifi: {state: 'disconnected'},
        wired: {state: 'disconnected'}
      });
    });

    chip.handle.start();
    await flush();

    expect(chip.button.dataset.state).toBe('offline');
    expect(chip.button.getAttribute('aria-label')).toBe('No network connection');
  });

  it('stays hidden until the first link reading', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(function () { /* never answers */ });

    chip.handle.start();
    await flush();

    expect(chip.button.hidden).toBe(true);
  });

  it('hides and stops probing when the setting is off', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({}));
    vi.stubGlobal('fetch', fetchMock);
    const chip = setup(wifiHandler, false);

    chip.handle.start();
    await flush();

    expect(chip.button.hidden).toBe(true);
    expect(document.body.classList.contains('has-network-status')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pauses probing while Ember is inactive and probes again on return', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({}));
    vi.stubGlobal('fetch', fetchMock);
    const chip = setup(wifiHandler);
    chip.state.active = false;

    chip.handle.start();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    chip.state.active = true;
    chip.handle.applyConfig();
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    expect(chip.button.dataset.state).toBe('wifi');
  });

  it('cancels the link subscription on stop', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(wifiHandler);

    chip.handle.start();
    chip.handle.stop();

    expect(chip.bus.cancel).toHaveBeenCalled();
  });

  it('degrades to an internet globe when the connection service is refused', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(function () { throw new Error('denied'); });

    chip.handle.start();
    await flush();

    expect(chip.button.hidden).toBe(false);
    expect(chip.button.dataset.state).toBe('internet');
    expect(chip.button.getAttribute('aria-label')).toBe('Internet connected');
  });

  it('treats a returnValue:false subscription as a refusal', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(function (_uri, options) {
      options.onSuccess!({returnValue: false, errorText: 'denied'});
    });

    chip.handle.start();
    await flush();

    expect(chip.button.dataset.state).toBe('internet');
  });

  it('shows no internet in degraded mode when the probe also fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const chip = setup(function () { throw new Error('denied'); });

    chip.handle.start();
    await flush();
    await vi.advanceTimersByTimeAsync(10000);

    expect(chip.button.dataset.state).toBe('no-internet');
  });

  it('probes once a minute while active', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({}));
    vi.stubGlobal('fetch', fetchMock);
    const chip = setup(wifiHandler);

    chip.handle.start();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers when a later probe resolves', async () => {    vi.useFakeTimers();
    let online = false;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (!online) throw new Error('offline');
      return {};
    }));
    const chip = setup(wifiHandler);

    chip.handle.start();
    await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(chip.button.dataset.state).toBe('no-internet');

    online = true;
    await vi.advanceTimersByTimeAsync(60000);

    expect(chip.button.dataset.state).toBe('wifi');
  });

  it('opens network settings when the chip is selected', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const chip = setup(wifiHandler);
    chip.handle.start();
    await flush();

    chip.button.click();

    expect(chip.onClick).toHaveBeenCalledTimes(1);
  });
});
