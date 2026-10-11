import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  lunaRequest,
  lunaSubscribeOnce,
  rootLuna,
  runLadder,
  setLunaAdapter
} from '../src/ts/luna-transport.js';
import type {LadderRung, LunaAdapter} from '../src/ts/luna-transport.js';
import type {WebOSServiceRequestOptions} from '../src/ts/types.js';
import {LIST_APPS_LADDER, listApps} from '../src/ts/luna.js';

interface Sent {
  uri: string;
  options: WebOSServiceRequestOptions;
}

/** A Luna bus that records every request and lets the test answer it. */
function fakeBus(handler: (uri: string, options: WebOSServiceRequestOptions) => void): {
  adapter: LunaAdapter;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent: sent,
    adapter: {
      request: function (uri, options) {
        sent.push({uri: uri, options: options});
        handler(uri, options);
        return {cancel: vi.fn()};
      }
    }
  };
}

function execReply(payload: unknown): {stdoutString: string} {
  return {stdoutString: typeof payload === 'string' ? payload : JSON.stringify(payload)};
}

afterEach(() => {
  setLunaAdapter(null);
  vi.useRealTimers();
});

describe('lunaRequest', () => {
  it('resolves with the payload on success', async () => {
    const bus = fakeBus(function (uri, options) {
      options.onSuccess!({returnValue: true, appId: 'netflix'});
    });
    setLunaAdapter(bus.adapter);

    await expect(lunaRequest('luna://x', {method: 'getAppInfo'}))
      .resolves.toEqual({returnValue: true, appId: 'netflix'});
    expect(bus.sent[0].options.method).toBe('getAppInfo');
  });

  it('rejects when returnValue is false', async () => {
    const bus = fakeBus(function (uri, options) {
      options.onSuccess!({returnValue: false, errorText: 'denied'});
    });
    setLunaAdapter(bus.adapter);

    await expect(lunaRequest('luna://x', {method: 'm'})).rejects.toThrow('denied');
  });

  it('rejects when the bus never answers and the timeout elapses', async () => {
    vi.useFakeTimers();
    const bus = fakeBus(function () { /* never settles */ });
    setLunaAdapter(bus.adapter);

    const pending = lunaRequest('luna://x', {method: 'm'}, 100);
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});

describe('lunaSubscribeOnce', () => {
  it('resolves on the first payload and cancels the subscription', async () => {
    const cancel = vi.fn();
    const sent: Sent[] = [];
    setLunaAdapter({
      request: function (uri, options) {
        sent.push({uri: uri, options: options});
        // Real buses answer asynchronously, after the handle is handed back.
        Promise.resolve().then(function () {
          options.onSuccess!({returnValue: true, launchPoints: [{id: 'a'}]});
        });
        return {cancel: cancel};
      }
    });

    await expect(lunaSubscribeOnce('luna://x', {method: 'listLaunchPoints'}))
      .resolves.toEqual({returnValue: true, launchPoints: [{id: 'a'}]});
    expect(sent[0].options.parameters).toEqual({subscribe: true});
    expect(cancel).toHaveBeenCalled();
  });
});

describe('rootLuna', () => {
  it('runs luna-send as root and resolves with the parsed payload', async () => {
    const bus = fakeBus(function (uri, options) {
      options.onSuccess!(execReply({returnValue: true, apps: [{id: 'netflix'}]}));
    });
    setLunaAdapter(bus.adapter);

    await expect(rootLuna('luna://com.webos.applicationManager/listApps', {}))
      .resolves.toEqual({returnValue: true, apps: [{id: 'netflix'}]});
    expect(bus.sent[0].uri).toBe('luna://org.webosbrew.hbchannel.service');
    expect(String(bus.sent[0].options.parameters!.command)).toContain('luna-send');
  });

  it('rejects when the parsed payload has returnValue false', async () => {
    const bus = fakeBus(function (uri, options) {
      options.onSuccess!(execReply({returnValue: false, errorText: 'no root'}));
    });
    setLunaAdapter(bus.adapter);

    await expect(rootLuna('luna://com.webos.applicationManager/listApps', {}))
      .rejects.toThrow('no root');
  });

  it('rejects on empty output, unless emptyAs is given', async () => {
    const bus = fakeBus(function (uri, options) {
      options.onSuccess!(execReply(''));
    });
    setLunaAdapter(bus.adapter);

    await expect(rootLuna('luna://com.webos.applicationManager/launch', {id: 'a'}))
      .rejects.toThrow('empty');
    await expect(rootLuna('luna://com.webos.applicationManager/launch', {id: 'a'},
      {emptyAs: {returnValue: true}})).resolves.toEqual({returnValue: true});
  });
});

describe('runLadder', () => {
  const ladder: LadderRung[] = [
    {via: 'rootLuna', uri: 'luna://com.webos.applicationManager/listApps', parameters: {}},
    {via: 'subscribeOnce', uri: 'luna://com.webos.applicationManager', method: 'listLaunchPoints', parameters: {}}
  ];

  it('falls through to the next rung when a rung fails', async () => {
    const bus = fakeBus(function (uri, options) {
      if (uri.indexOf('hbchannel') >= 0) {
        options.onFailure!(new Error('not rooted'));
        return;
      }
      options.onSuccess!({returnValue: true, launchPoints: [{id: 'a'}]});
    });
    setLunaAdapter(bus.adapter);

    const result = await runLadder(ladder, function (res) { return res.launchPoints; });
    expect(result).toEqual([{id: 'a'}]);
    expect(bus.sent.map(function (s) { return s.uri; })).toEqual([
      'luna://org.webosbrew.hbchannel.service',
      'luna://com.webos.applicationManager'
    ]);
  });

  it('falls through when parse rejects (e.g. an empty list)', async () => {
    const seen: string[] = [];
    const bus = fakeBus(function (uri, options) {
      seen.push(uri);
      if (uri.indexOf('hbchannel') >= 0) {
        options.onSuccess!(execReply({returnValue: true, apps: []}));
        return;
      }
      options.onSuccess!({returnValue: true, apps: [{id: 'a'}]});
    });
    setLunaAdapter(bus.adapter);

    const result = await runLadder(ladder, function (res) {
      if (!res.apps || !res.apps.length) throw new Error('empty');
      return res.apps;
    });
    expect(result).toEqual([{id: 'a'}]);
    expect(seen.length).toBe(2);
  });

  it('surfaces the last rung error when every rung fails', async () => {
    const bus = fakeBus(function (uri, options) {
      if (uri.indexOf('hbchannel') >= 0) {
        options.onFailure!(new Error('not rooted'));
        return;
      }
      options.onSuccess!({returnValue: false, errorText: 'final failure'});
    });
    setLunaAdapter(bus.adapter);

    await expect(runLadder(ladder, function (res) { return res; }))
      .rejects.toThrow('final failure');
  });
});

describe('listApps ladder', () => {
  it('is data: root first, then subscribe-once, then the in-app call', () => {
    expect(LIST_APPS_LADDER.map(function (rung) { return rung.via; }))
      .toEqual(['rootLuna', 'subscribeOnce', 'request']);
  });

  it('marks the list complete only when it came from root', async () => {
    const bus = fakeBus(function (uri, options) {
      options.onSuccess!(execReply({returnValue: true, apps: [{id: 'netflix'}]}));
    });
    setLunaAdapter(bus.adapter);

    await expect(listApps()).resolves.toEqual({apps: [{id: 'netflix'}], complete: true});
  });

  it('falls back to the in-app list without the complete flag', async () => {
    const bus = fakeBus(function (uri, options) {
      if (uri.indexOf('hbchannel') >= 0) {
        options.onFailure!(new Error('not rooted'));
        return;
      }
      options.onSuccess!({returnValue: true, launchPoints: [{id: 'youtube'}]});
    });
    setLunaAdapter(bus.adapter);

    const result = await listApps();
    expect(result.complete).toBeUndefined();
    expect(result.apps).toEqual([{id: 'youtube', appInfo: {id: 'youtube'}}]);
  });

  it('resolves with an empty list when every rung fails', async () => {
    const bus = fakeBus(function (uri, options) {
      if (uri.indexOf('hbchannel') >= 0) options.onFailure!(new Error('not rooted'));
      else options.onFailure!(new Error('denied'));
    });
    setLunaAdapter(bus.adapter);

    await expect(listApps()).resolves.toEqual({apps: []});
  });
});
