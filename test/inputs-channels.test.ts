import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@luna/luna.js', () => ({
  getAllInputStatus: vi.fn(),
  getAllInputStatusViaRoot: vi.fn(async () => null),
  switchInput: vi.fn(async () => true),
  getTvChannels: vi.fn(async () => []),
  getTvChannelNow: vi.fn(async () => ({number: '', name: '', programme: ''})),
  launchApp: vi.fn(async () => 'ok'),
  launchAppViaRoot: vi.fn(async () => 'ok'),
  openTvChannel: vi.fn(async () => true)
}));

import {createInputRow} from '@home/inputs.js';
import {createChannelStrip} from '@home/channels.js';
import {
  getAllInputStatus,
  getTvChannelNow,
  getTvChannels,
  launchApp,
  launchAppViaRoot,
  openTvChannel,
  switchInput
} from '@luna/luna.js';
import {setLanguage, t} from '@lib/i18n.js';
import type {TvChannel} from '@luna/luna.js';
import type {Config} from '@lib/types.js';

function flush(): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function inputsConfig(): Config {
  return {
    launcher: {
      inputs: ['HDMI_1', 'HDMI_2', 'TV'],
      inputLabels: {HDMI_2: 'Blu-ray speler'},
      addedInputs: []
    }
  } as unknown as Config;
}

describe('the home row in Dutch', () => {
  beforeEach(function () {
    document.body.innerHTML = '';
    localStorage.clear();
    setLanguage('nl');
    vi.mocked(getAllInputStatus).mockReset();
    vi.mocked(getAllInputStatus).mockResolvedValue({
      devices: [
        {id: 'HDMI_1', label: 'HDMI 1', appId: 'com.webos.app.hdmi1'},
        {id: 'HDMI_2', label: 'HDMI 2', appId: 'com.webos.app.hdmi2'}
      ]
    } as never);
    vi.mocked(switchInput).mockReset();
    vi.mocked(switchInput).mockResolvedValue(true as never);
    vi.mocked(getTvChannels).mockReset();
    vi.mocked(getTvChannels).mockResolvedValue([]);
    vi.mocked(getTvChannelNow).mockReset();
    vi.mocked(getTvChannelNow).mockResolvedValue({number: '', name: '', programme: ''});
    vi.mocked(openTvChannel).mockReset();
    vi.mocked(openTvChannel).mockResolvedValue(true as never);
    vi.mocked(launchApp).mockReset();
    vi.mocked(launchApp).mockResolvedValue('ok' as never);
    vi.mocked(launchAppViaRoot).mockReset();
    vi.mocked(launchAppViaRoot).mockResolvedValue('ok' as never);
  });

  afterEach(function () { setLanguage('en'); });

  it('names our chips in Dutch and leaves the TV’s and the user’s labels alone', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const channels = {
      hasChannels: () => true,
      isOpen: () => false,
      available: () => true,
      toggle: vi.fn()
    };
    const row = createInputRow(container, inputsConfig, {channels: channels});

    await row.refresh();

    const chips = Array.from(container.querySelectorAll('.input-chip'))
      .map(function (chip) { return chip.textContent; });
    expect(chips).toEqual([
      'HDMI 1', 'Blu-ray speler', t('inputs.liveTv'), t('inputs.channelsChip')
    ]);
  });

  it('reads the channel strip and its failures in Dutch', async () => {
    const channels: TvChannel[] = [
      {id: 'c1', number: '1', name: 'NPO 1', radio: false, hidden: false, favourite: true},
      {id: 'c2', number: '2', name: 'NPO 2', radio: false, hidden: false, favourite: true}
    ];
    vi.mocked(getTvChannels).mockResolvedValue(channels);

    const strip = document.createElement('div');
    document.body.appendChild(strip);
    const toasts: string[] = [];
    const handle = createChannelStrip(strip, function () {
      return {launcher: {channels: 'all'}} as unknown as Config;
    }, {onToast: function (message) { toasts.push(message); }});

    await handle.refresh();
    expect(handle.available()).toBe(true);

    handle.toggle();
    const chips = Array.from(strip.querySelectorAll('.channel-chip'));
    expect(chips.length).toBe(3);
    expect(chips[0].querySelector('.channel-number')!.textContent).toBe(t('inputs.liveTv'));
    expect(chips[0].querySelector('.channel-name')!.textContent).toBe(t('channels.nowPlaying'));
    expect(chips[1].querySelector('.channel-name')!.textContent).toBe('NPO 1');

    // Nothing on now: the first chip falls back to "watch Live TV".
    await flush();
    expect(chips[0].querySelector('.channel-name')!.textContent).toBe(t('channels.watchLive'));

    vi.mocked(openTvChannel).mockRejectedValue(new Error('no'));
    (chips[1] as HTMLElement).click();
    await flush();
    expect(toasts).toEqual([t('inputs.switchFailed', {input: 'NPO 1'})]);

    vi.mocked(launchApp).mockRejectedValue(new Error('no'));
    vi.mocked(launchAppViaRoot).mockRejectedValue(new Error('no'));
    (chips[0] as HTMLElement).click();
    await flush();
    expect(toasts).toContain(t('channels.openFailed'));
  });
});
