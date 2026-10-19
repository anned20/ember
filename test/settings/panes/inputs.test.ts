import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@home/inputs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@home/inputs.js')>();
  return Object.assign({}, actual, {
    fetchInputDevices: vi.fn(async () => []),
    inputFromId: vi.fn((id: string) => ({id: id, label: id})),
    isTvInputId: vi.fn((id: string) => id === 'TV')
  });
});

import {createInputsPane} from '@settings/panes/inputs.js';
import {createBinder} from '@settings/settings-binding.js';
import {fetchInputDevices} from '@home/inputs.js';
import {setLanguage, t} from '@lib/i18n.js';
import type {PaneHandle, SettingsContext, SettingsPanelOptions} from '@settings/pane.js';
import type {Config} from '@lib/types.js';

function makeConfig(): Config {
  return {
    launcher: {
      channels: 'all',
      inputs: ['HDMI_1'],
      inputLabels: {HDMI_1: 'Console'},
      addedInputs: []
    }
  } as unknown as Config;
}

function buildPane(
  config: Config = makeConfig(),
  options: SettingsPanelOptions = {},
  focusNow: (el: Element | null) => boolean = function () { return true; }
): {pane: HTMLElement; config: Config; ctx: SettingsContext; handle: PaneHandle} {
  const pane = document.createElement('div');
  const ctx: SettingsContext = {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {inputs: pane},
    options: options,
    apps: {pinnedOrder: [], customApps: [], appsByIdMap: {}, installedCatalog: null},
    focusInPanel: function () { return true; },
    isVisible: function () { return true; },
    focusControl: function () {},
    focusNow: focusNow,
    focusGallery: function () {},
    refocusListButton: function () {},
    withDeadline: function (promise, ms) {
      return new Promise(function (resolve) {
        let done = false;
        const timer = setTimeout(function () {
          if (!done) { done = true; resolve(null); }
        }, ms);
        Promise.resolve(promise).then(function (value) {
          if (!done) { done = true; clearTimeout(timer); resolve(value); }
        }, function () {
          if (!done) { done = true; clearTimeout(timer); resolve(null); }
        });
      });
    },
    redraw: function () {}
  };
  const handle = createInputsPane();
  handle.build(ctx);
  return {pane: pane, config: config, ctx: ctx, handle: handle};
}

describe('inputs pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setLanguage('en');
    vi.mocked(fetchInputDevices).mockReset();
    vi.mocked(fetchInputDevices).mockResolvedValue([]);
  });

  it('builds the channels stepper and an empty inputs grid', () => {
    const {pane} = buildPane();

    const stepper = pane.querySelector('[data-focus-index="1095"]');
    expect(stepper).not.toBeNull();
    expect(stepper!.querySelector('.stepper-label')!.textContent).toBe('All channels');

    const grid = pane.querySelector('.settings-inputs');
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll('.settings-input-row').length).toBe(0);
  });

  it('loads the TV inputs through the context and saves their ticks and labels', async () => {
    vi.mocked(fetchInputDevices).mockResolvedValue([{id: 'HDMI_1', label: 'HDMI 1'}]);
    const hasTvChannels = vi.fn(() => true);
    const {pane, config, ctx, handle} = buildPane(makeConfig(), {hasTvChannels: hasTvChannels});

    await handle.load!(ctx);
    expect(fetchInputDevices).toHaveBeenCalledWith(true, []);

    const checkbox = pane.querySelector('.settings-input-row input[type=checkbox]') as HTMLInputElement;
    const label = pane.querySelector('.settings-input-row input[type=text]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(label.value).toBe('Console');

    checkbox.checked = false;
    label.value = 'Gaming';
    ctx.binder.collect(config);

    expect(config.launcher.inputs).toEqual([]);
    expect(config.launcher.inputLabels).toEqual({HDMI_1: 'Gaming'});
  });

  it('adds an input by hand, focuses it, and saves it as added', async () => {
    const focusNow = vi.fn(function () { return true; });
    const config = makeConfig();
    config.launcher.inputs = [];
    const {pane, ctx, handle} = buildPane(config, {}, focusNow);

    await handle.load!(ctx);

    const buttons = Array.prototype.slice.call(pane.querySelectorAll('.settings-input-add button'));
    const addBtn = buttons.find(function (b) {
      return (b as HTMLButtonElement).textContent === '+ HDMI_2';
    }) as HTMLButtonElement | undefined;
    expect(addBtn).toBeTruthy();

    addBtn!.click();

    const rows = pane.querySelectorAll('.settings-input-row');
    expect(rows.length).toBe(1);
    const checkbox = rows[0].querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.dataset.added).toBe('1');
    expect(focusNow).toHaveBeenCalledTimes(1);

    const stillThere = Array.prototype.slice.call(pane.querySelectorAll('.settings-input-add button'))
      .some(function (b) { return (b as HTMLButtonElement).textContent === '+ HDMI_2'; });
    expect(stillThere).toBe(false);

    ctx.binder.collect(config);
    expect(config.launcher.inputs).toEqual(['HDMI_2']);
    expect(config.launcher.addedInputs).toEqual(['HDMI_2']);
  });

  it('reads the pane in Dutch and keeps the TV’s and the user’s labels', async () => {
    setLanguage('nl');
    vi.mocked(fetchInputDevices).mockResolvedValue([{id: 'HDMI_1', label: 'HDMI 1'}]);
    const {pane, ctx, handle} = buildPane(makeConfig(), {hasTvChannels: () => true});

    await handle.load!(ctx);

    expect(pane.textContent).toContain(t('inputs.hint'));
    expect(pane.textContent).toContain(t('inputs.channels'));
    expect(pane.textContent).toContain(t('inputs.addInput'));
    expect(pane.querySelector('[data-focus-index="1095"] .stepper-label')!.textContent)
      .toBe(t('inputs.channelsAll'));
    // The TV's name for the input, and the label the user typed, are not ours.
    expect(pane.querySelector('.settings-input-name')!.textContent).toBe('HDMI 1');
    expect((pane.querySelector('.settings-input-row input[type=text]') as HTMLInputElement).value)
      .toBe('Console');
  });
});
