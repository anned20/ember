import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';
import {createScreensaverPane} from '@settings/panes/screensaver.js';
import {createBinder} from '@settings/settings-binding.js';
import {setLanguage, t, tn} from '@lib/i18n.js';
import {BRAND} from '@lib/brand.js';
import type {SettingsContext} from '@settings/pane.js';
import type {Config} from '@lib/types.js';

function makeConfig(): Config {
  return {
    launcher: {
      customScreensaver: false,
      customScreensaverMinutes: 5,
      customScreensaverSlideSec: 20,
      customScreensaverShowClock: true,
      customScreensaverShowDate: false,
      screensaverMinutes: 10
    }
  } as unknown as Config;
}

function stepper(pane: HTMLElement, focusIndex: string) {
  return pane.querySelector('[data-focus-index="' + focusIndex + '"]') as unknown as {
    value: string;
    setValue(value: string): void;
  };
}

/** The option the stepper currently shows. */
function shown(pane: HTMLElement, focusIndex: string): string {
  const control = pane.querySelector('[data-focus-index="' + focusIndex + '"]') as HTMLElement;
  return (control.querySelector('.stepper-label') as HTMLElement).textContent || '';
}

function buildPane(
  options: SettingsContext['options'] = {}
): {pane: HTMLElement; config: Config; ctx: SettingsContext} {
  const config = makeConfig();
  const pane = document.createElement('div');
  const ctx: SettingsContext = {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {screensaver: pane},
    options: options,
    apps: {pinnedOrder: [], customApps: [], appsByIdMap: {}, installedCatalog: null},
    focusInPanel: function () { return true; },
    isVisible: function () { return true; },
    focusControl: function () {},
    focusNow: function () { return true; },
    focusGallery: function () {},
    refocusListButton: function () {},
    withDeadline: function <T>(promise: Promise<T>) { return Promise.resolve(promise); },
    redraw: function () {}
  };
  createScreensaverPane().build(ctx);
  return {pane: pane, config: config, ctx: ctx};
}

describe('screensaver pane', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => setLanguage('en'));

  it('builds the in-app slideshow and TV screensaver controls from the config', () => {
    const {pane} = buildPane();

    const toggle = pane.querySelector('[data-focus-index="990"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(stepper(pane, '991').value).toBe('5');
    expect(stepper(pane, '992').value).toBe('20');
    expect((pane.querySelector('[data-focus-index="993"]') as HTMLInputElement).checked).toBe(true);
    expect((pane.querySelector('[data-focus-index="994"]') as HTMLInputElement).checked).toBe(false);
    expect(stepper(pane, '995').value).toBe('10');
    expect(pane.querySelector('.settings-preview-ss-btn')!.textContent).toBe('Preview screensaver now');
  });

  it('asks the host to preview the screensaver when the button is pressed', () => {
    const onPreviewScreensaver = vi.fn();
    const {pane} = buildPane({onPreviewScreensaver: onPreviewScreensaver});

    (pane.querySelector('.settings-preview-ss-btn') as HTMLElement).click();
    expect(onPreviewScreensaver).toHaveBeenCalledTimes(1);
  });

  it('collects the slideshow options and pushes the TV saver past the in-app one', () => {
    const {pane, config, ctx} = buildPane();

    (pane.querySelector('[data-focus-index="990"]') as HTMLInputElement).checked = true;
    stepper(pane, '991').setValue('15');
    stepper(pane, '992').setValue('30');
    (pane.querySelector('[data-focus-index="993"]') as HTMLInputElement).checked = false;
    (pane.querySelector('[data-focus-index="994"]') as HTMLInputElement).checked = true;
    stepper(pane, '995').setValue('10');

    ctx.binder.collect(config);

    expect(config.launcher.customScreensaver).toBe(true);
    expect(config.launcher.customScreensaverMinutes).toBe(15);
    expect(config.launcher.customScreensaverSlideSec).toBe(30);
    expect(config.launcher.customScreensaverShowClock).toBe(false);
    expect(config.launcher.customScreensaverShowDate).toBe(true);
    // The in-app saver is on, so the TV saver is raised to 30.
    expect(config.launcher.screensaverMinutes).toBe(30);
  });

  it('leaves the TV saver alone when the in-app one is off', () => {
    const {pane, config, ctx} = buildPane();

    stepper(pane, '995').setValue('10');
    ctx.binder.collect(config);

    expect(config.launcher.screensaverMinutes).toBe(10);
  });

  it('reads the whole pane in Dutch and leaves the stored values alone', () => {
    setLanguage('nl');
    const {pane, config, ctx} = buildPane();

    expect(pane.querySelector('.settings-section > h3')!.textContent).toBe(t('screensaver.section'));
    expect(pane.textContent).toContain(t('screensaver.custom', {brand: BRAND.name}));
    expect(pane.textContent).toContain(t('screensaver.startAfter'));
    expect(pane.textContent).toContain(t('screensaver.slideEvery'));
    expect(pane.textContent).toContain(t('screensaver.tv'));
    expect(pane.textContent).toContain(t('screensaver.preview'));

    expect(shown(pane, '991')).toBe(tn('screensaver.minutes', 5));
    expect(shown(pane, '992')).toBe(tn('screensaver.seconds', 20));
    expect(shown(pane, '995')).toBe(tn('screensaver.minutes', 10));

    // The minute strings are counted: the 60-second slide reads as one minute.
    stepper(pane, '992').setValue('60');
    expect(shown(pane, '992')).toBe(tn('screensaver.minutes', 1));

    ctx.binder.collect(config);
    expect(config.launcher.customScreensaverMinutes).toBe(5);
    expect(config.launcher.customScreensaverSlideSec).toBe(60);
    expect(config.launcher.screensaverMinutes).toBe(10);
  });

  it('asks for a save and reopen in Dutch when the host cannot preview', () => {
    setLanguage('nl');
    const onToast = vi.fn();
    const {pane} = buildPane({onToast: onToast});

    (pane.querySelector('.settings-preview-ss-btn') as HTMLElement).click();
    expect(onToast).toHaveBeenCalledWith(t('screensaver.previewToast', {brand: BRAND.name}));
  });
});
