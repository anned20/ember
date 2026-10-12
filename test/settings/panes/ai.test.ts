import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config.js')>();
  return Object.assign({}, actual, {
    loadConfig: vi.fn(() => ({}) as unknown as ReturnType<typeof actual.loadConfig>),
    saveConfig: vi.fn()
  });
});

vi.mock('@luna/luna.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luna/luna.js')>();
  return Object.assign({}, actual, {
    disableVoice: vi.fn(async () => ({})),
    enableVoice: vi.fn(async () => ({otherVoice: ''})),
    isVoiceRunning: vi.fn(async () => false)
  });
});

vi.mock('@voice/voice-config.js', () => ({
  getVoiceConfig: vi.fn(async () => ({})),
  getVoiceStatus: vi.fn(async () => ({})),
  setVoiceConfig: vi.fn(async () => ({})),
  startSuperGrokLogin: vi.fn(async () => ({})),
  cancelSuperGrokLogin: vi.fn(async () => ({})),
  signOutSuperGrok: vi.fn(async () => ({})),
  importSuperGrokAuth: vi.fn(async () => ({}))
}));

vi.mock('@lib/qr-svg.js', () => ({
  qrSvgMarkup: vi.fn(() => '<svg></svg>')
}));

import {createAiPane} from '@settings/panes/ai.js';
import {createBinder} from '@settings/settings-binding.js';
import {
  getVoiceConfig,
  getVoiceStatus,
  setVoiceConfig,
  startSuperGrokLogin,
  cancelSuperGrokLogin
} from '@voice/voice-config.js';
import type {AiPaneHandle} from '@settings/panes/ai.js';
import type {SettingsContext, SettingsPanelOptions} from '@settings/pane.js';
import type {Config} from '@lib/types.js';

function makeConfig(voiceEnabled = true): Config {
  return {
    version: 1,
    profile: 'default',
    launcher: {voiceEnabled: voiceEnabled},
    background: {}
  } as unknown as Config;
}

interface Hooks {
  onToast?: (message: string) => void;
}

function buildAi(
  config: Config = makeConfig(),
  hooks: Hooks = {}
): {pane: HTMLElement; ctx: SettingsContext; handle: AiPaneHandle; onToast: ReturnType<typeof vi.fn>} {
  const pane = document.createElement('div');
  const onToast = vi.fn();
  const ctx: SettingsContext = {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {ai: pane},
    options: {onToast: hooks.onToast || onToast} as SettingsPanelOptions,
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
  const handle = createAiPane();
  handle.build(ctx);
  return {pane: pane, ctx: ctx, handle: handle, onToast: onToast};
}

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  throw new Error('waitFor timed out');
}

function statusText(pane: HTMLElement): string {
  return Array.prototype.map
    .call(pane.querySelectorAll('.ai-status-line'), function (el: HTMLElement) { return el.textContent; })
    .join(' | ');
}

describe('AI Voice pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(getVoiceConfig).mockReset();
    vi.mocked(getVoiceConfig).mockResolvedValue({});
    vi.mocked(getVoiceStatus).mockReset();
    vi.mocked(getVoiceStatus).mockResolvedValue({});
    vi.mocked(setVoiceConfig).mockReset();
    vi.mocked(setVoiceConfig).mockResolvedValue({});
    vi.mocked(startSuperGrokLogin).mockReset();
    vi.mocked(startSuperGrokLogin).mockResolvedValue({});
    vi.mocked(cancelSuperGrokLogin).mockReset();
    vi.mocked(cancelSuperGrokLogin).mockResolvedValue({});
  });

  it('builds the whole cluster through the context and exposes the overlay', () => {
    const {pane, handle} = buildAi();

    // Power, Assistant, Grok account, keys, Voice & chat and the service status.
    expect(pane.querySelector('[data-focus-index="1960"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1970"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1990"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="2001"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1991"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1993"]')).not.toBeNull();

    // The full-panel sign-in modal is handed to the root, not the pane box.
    expect(handle.overlay).not.toBeNull();
    expect(handle.overlay!.className).toContain('ai-oauth-modal');
    expect(handle.overlay!.hidden).toBe(true);
    expect(pane.querySelector('.ai-oauth-modal')).toBeNull();
  });

  it('fills the form and the status line from the voice service', async () => {
    vi.mocked(getVoiceConfig).mockResolvedValue({
      ai_provider: 'gemini',
      gemini_api_key_configured: true,
      gemini_api_key_masked: 'AIza••••',
      gemini_model: 'gemini-2.0',
      options: {gemini_model: [{value: 'gemini-2.0', label: 'Gemini 2.0'}]}
    });
    vi.mocked(getVoiceStatus).mockResolvedValue({daemonActive: true});

    const {pane, ctx, handle} = buildAi();
    await handle.load!(ctx);
    await waitFor(function () { return statusText(pane).indexOf('ready') >= 0; });

    expect((pane.querySelector('.ai-provider-pick') as HTMLElement & {value: string}).value)
      .toBe('gemini');
    expect(statusText(pane)).toContain('Voice daemon running — ready');
  });

  it('writes the voice settings on Save and reports it handled the save', async () => {
    const {ctx, handle} = buildAi();
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';

    const handled = handle.onSave!(ctx, ctx.rawConfig, saveBtn);
    expect(handled).toBe(true);

    await waitFor(function () { return vi.mocked(setVoiceConfig).mock.calls.length > 0; });
    expect(setVoiceConfig).toHaveBeenCalledWith(expect.objectContaining({
      ai_provider: 'xai',
      overlay_auto_dismiss_sec: 8,
      auth_mode: 'API_KEY'
    }));
    expect(saveBtn.textContent).toBe('Save');
  });

  it('aborts Save on a bad Grok key without writing', () => {
    const {pane, ctx, handle, onToast} = buildAi();
    (pane.querySelector('[data-focus-index="2001"]') as HTMLInputElement).value = 'not-a-key';

    const handled = handle.onSave!(ctx, ctx.rawConfig, document.createElement('button'));

    expect(handled).toBe(true);
    expect(setVoiceConfig).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('xai-'));
  });

  it('shows the SuperGrok QR and cancels the sign-in', async () => {
    vi.mocked(startSuperGrokLogin).mockResolvedValue({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://accounts.x.ai/oauth2/device'
    });
    const {pane, handle} = buildAi();
    // SuperGrok sign-in only paints while that account mode is selected.
    (pane.querySelector('[data-focus-index="1990"]') as HTMLElement & {value: string}).value = 'SUPERGROK_OAUTH';

    (pane.querySelector('[data-focus-index="1991"]') as HTMLElement).click();
    await waitFor(function () { return handle.overlay!.hidden === false; });

    const qrWrap = handle.overlay!.querySelector('.ai-oauth-qr-wrap') as HTMLElement;
    expect(qrWrap.hidden).toBe(false);
    expect(qrWrap.innerHTML).toContain('<svg');

    (handle.overlay!.querySelector('.ai-oauth-modal-cancel') as HTMLElement).click();
    await waitFor(function () { return handle.overlay!.hidden === true; });
    expect(cancelSuperGrokLogin).toHaveBeenCalled();

    handle.dispose();
  });
});
