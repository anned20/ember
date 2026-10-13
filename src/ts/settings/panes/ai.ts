import {loadConfig, saveConfig} from '@config/config.js';
import {disableVoice, enableVoice, isVoiceRunning} from '@luna/luna.js';
import {
  getVoiceConfig,
  getVoiceStatus,
  setVoiceConfig,
  startSuperGrokLogin,
  cancelSuperGrokLogin,
  signOutSuperGrok,
  importSuperGrokAuth
} from '@voice/voice-config.js';
import {qrSvgMarkup} from '@lib/qr-svg.js';
import {BRAND} from '@lib/brand.js';
import {
  labeledControl,
  createHint,
  createSection,
  createTextField,
  createMiniButton,
  createOptionStepper,
  createProviderPicker
} from '../components/index.js';
import type {OptionStepperElement, ProviderPickerElement, StepperOption} from '../components/index.js';
import type {PaneHandle, SettingsContext} from '../pane.js';
import type {Config} from '@lib/types.js';

/** The row/input/show-button bundle makeKeyRow returns. */
interface KeyRow {
  row: HTMLDivElement;
  input: HTMLInputElement;
  showBtn: HTMLButtonElement;
}

/** A parsed voice-service config / status payload (untyped JSON). */
type VoicePayload = Record<string, any>;

/** What the AI Voice pane hands back to close over its own build. */
interface AiPaneApi {
  load: () => void;
  save: (saveBtn: HTMLButtonElement) => boolean;
  dispose: () => void;
}

/** The AI Voice pane's handle: the usual seam, plus its overlay and cleanup. */
export interface AiPaneHandle extends PaneHandle {
  /** The full-panel SuperGrok modal, to hang on the panel build stage. */
  overlay: HTMLElement | null;
  /** Stop the pane's timers (called when the panel hides or redraws). */
  dispose(): void;
}

/**
 * The AI Voice pane: the voice-service status, the provider/key/model cluster
 * and the SuperGrok sign-in flow. It builds and fills through the context and
 * overrides Save (its own write path), returning whether it handled the save.
 */
export function createAiPane(): AiPaneHandle {
  let api: AiPaneApi | null = null;
  let disposed = false;
  const handle: AiPaneHandle = {
    overlay: null,
    build: build,
    load: function () {
      if (api) api.load();
      return Promise.resolve();
    },
    onSave: function (_ctx: SettingsContext, _config: Config, saveBtn: HTMLButtonElement): boolean {
      return api ? api.save(saveBtn) : false;
    },
    dispose: function () {
      disposed = true;
      if (api) api.dispose();
    }
  };

  function build(ctx: SettingsContext): void {
    disposed = false;
    const aiPane = ctx.panes.ai;
    const options = ctx.options;
    const config = ctx.rawConfig;
    let aiOauthPollTimer: ReturnType<typeof setInterval> | null = null;
    let aiStatusLabel!: HTMLParagraphElement;
    let aiApiKeyInput!: HTMLInputElement;
    let aiApiKeyHint!: HTMLParagraphElement;
    let aiApiKeyShowBtn!: HTMLButtonElement;
    let aiGeminiKeyInput!: HTMLInputElement;
    let aiGeminiKeyHint!: HTMLParagraphElement;
    let aiGeminiKeyShowBtn!: HTMLButtonElement;
    let aiOpenRouterKeyInput!: HTMLInputElement;
    let aiOpenRouterKeyHint!: HTMLParagraphElement;
    let aiOpenRouterKeyShowBtn!: HTMLButtonElement;
    let aiSttSelect!: OptionStepperElement;
    let aiChatSelect!: OptionStepperElement;
    let aiVoiceModelSelect!: OptionStepperElement;
    let aiGeminiModelSelect!: OptionStepperElement;
    let aiGeminiSttSelect!: OptionStepperElement;
    let aiOpenRouterModelSelect!: OptionStepperElement;
    let aiOpenRouterSttSelect!: OptionStepperElement;
    let aiDismissSelect!: OptionStepperElement;
    let aiProviderSelect!: ProviderPickerElement;
    let aiAuthModeSelect!: OptionStepperElement;
    let aiCreditBanner!: HTMLParagraphElement;
    let aiOauthStatus!: HTMLParagraphElement;
    let aiOauthCode!: HTMLParagraphElement;
    let aiOauthHint!: HTMLParagraphElement;
    let aiOauthQrWrap!: HTMLDivElement;
    let aiOauthModal!: HTMLDivElement;
    let aiOauthModalCancel!: HTMLButtonElement;
    let aiOauthSignInBtn!: HTMLButtonElement;
    let aiOauthImportBtn!: HTMLButtonElement;
    let aiOauthSignOutBtn!: HTMLButtonElement;
    let aiLoadedConfig!: VoicePayload;
    let lastAiStatus: VoicePayload | null = null;
    // Voice assistant on (launcher.voiceEnabled), an on/off in progress, and
    // retries while the daemon starts.
    let voiceOn = false;
    let voiceBusy = false;
    let aiRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let aiLoadRetries = 0;
    let aiOauthInProgress = false;
    let aiOauthSawPending = false;
    let aiOauthLocalCode = '';
    let aiOauthLocalUri = '';
    let aiXaiKeyRevealed = false;
    let aiGeminiKeyRevealed = false;
    let aiOpenRouterKeyRevealed = false;
    // Key rows are referenced from syncAuthModeUi() before they are built.
    // Keep them as lets (not const) so an early call cannot TDZ-crash render.
    let xaiRow: KeyRow | null = null;
    let gemRow: KeyRow | null = null;
    let orRow: KeyRow | null = null;
    const aiStatusSection = createSection('Voice service');
    aiStatusLabel = createHint('Checking the voice service…', 'ai-status-line');
    aiStatusSection.appendChild(aiStatusLabel);
    aiCreditBanner = document.createElement('p');
    aiCreditBanner.className = 'ai-credit-banner';
    aiCreditBanner.hidden = true;
    aiStatusSection.appendChild(aiCreditBanner);
    aiStatusSection.appendChild(createHint(
      'Hold Voice on the Magic Remote to talk. Pick Grok, Gemini, or OpenRouter, add a key, then Save.'
    ));
    aiPane.appendChild(aiStatusSection);

    function makeKeyRow(label: string, focusIndex: number, placeholder: string): KeyRow {
      const field = createTextField({
        label: label,
        focusIndex: focusIndex,
        type: 'password',
        placeholder: placeholder || '',
        spellcheck: false,
        autocomplete: 'off'
      });
      field.row.classList.add('settings-key-row');
      const controls = document.createElement('div');
      controls.className = 'settings-key-controls';
      controls.appendChild(field.input);
      field.row.appendChild(controls);
      const showBtn = createMiniButton({label: 'Show', focusIndex: focusIndex + 1});
      controls.appendChild(showBtn);
      return {row: field.row, input: field.input, showBtn: showBtn};
    }

    const aiKeySection = createSection('API keys');
    aiAuthModeSelect = createOptionStepper({
      focusIndex: 1990,
      choices: [
        {value: 'API_KEY', label: 'Grok API key'},
        {value: 'SUPERGROK_OAUTH', label: 'SuperGrok sign-in'}
      ],
      value: 'API_KEY',
      onChange: function () {
        syncAuthModeUi();
        if (isSuperGrokMode()) paintOauthFromStatus({}, aiLoadedConfig);
      }
    });
    const authRow = labeledControl('Grok account', aiAuthModeSelect);
    aiKeySection.appendChild(authRow);
    const aiGrokUsing = document.createElement('p');
    aiGrokUsing.className = 'ai-using-badge';
    aiGrokUsing.hidden = true;
    aiKeySection.appendChild(aiGrokUsing);
    const authHint = createHint('Get a key at console.x.ai — stored only on this TV.');
    aiKeySection.appendChild(authHint);

    const oauthBox = document.createElement('div');
    oauthBox.hidden = true;
    aiOauthStatus = createHint('SuperGrok: not signed in');
    oauthBox.appendChild(aiOauthStatus);

    // Full-panel modal so the QR cannot be scrolled away, dismissed by a
    // stale "signed in" poll, or closed when the Magic Remote pointer
    // drifts onto Save / Close.
    aiOauthModal = document.createElement('div');
    aiOauthModal.className = 'ai-oauth-modal';
    aiOauthModal.hidden = true;
    aiOauthModal.setAttribute('role', 'dialog');
    aiOauthModal.setAttribute('aria-modal', 'true');
    aiOauthModal.setAttribute('aria-hidden', 'true');
    aiOauthModal.setAttribute('aria-label', 'SuperGrok sign-in');
    aiOauthModal.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    const oauthCard = document.createElement('div');
    oauthCard.className = 'ai-oauth-modal-card';
    oauthCard.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    const oauthTitle = document.createElement('h3');
    oauthTitle.className = 'ai-oauth-modal-title';
    oauthTitle.textContent = 'Sign in with SuperGrok';
    oauthCard.appendChild(oauthTitle);
    aiOauthQrWrap = document.createElement('div');
    aiOauthQrWrap.className = 'ai-oauth-qr-wrap';
    aiOauthQrWrap.hidden = true;
    aiOauthQrWrap.setAttribute('aria-hidden', 'true');
    oauthCard.appendChild(aiOauthQrWrap);
    aiOauthCode = document.createElement('p');
    aiOauthCode.className = 'ai-oauth-code';
    aiOauthCode.hidden = true;
    oauthCard.appendChild(aiOauthCode);
    aiOauthHint = createHint('', 'ai-oauth-modal-hint');
    aiOauthHint.hidden = true;
    oauthCard.appendChild(aiOauthHint);
    aiOauthModalCancel = createMiniButton({
      label: 'Cancel sign-in',
      focusIndex: '1994',
      className: 'ai-oauth-modal-cancel'
    });
    oauthCard.appendChild(aiOauthModalCancel);
    aiOauthModal.appendChild(oauthCard);
    handle.overlay = aiOauthModal;

    function hideOauthQr(): void {
      if (aiOauthQrWrap) {
        aiOauthQrWrap.hidden = true;
        aiOauthQrWrap.setAttribute('aria-hidden', 'true');
        aiOauthQrWrap.innerHTML = '';
      }
      if (aiOauthCode) aiOauthCode.hidden = true;
      if (aiOauthHint) aiOauthHint.hidden = true;
      if (aiOauthModal) {
        aiOauthModal.hidden = true;
        aiOauthModal.setAttribute('aria-hidden', 'true');
      }
    }

    function showOauthQr(uri: string): void {
      if (!aiOauthQrWrap) return;
      const svg = qrSvgMarkup(uri);
      if (!svg) {
        aiOauthQrWrap.hidden = true;
        aiOauthQrWrap.setAttribute('aria-hidden', 'true');
        aiOauthQrWrap.innerHTML = '';
        return;
      }
      aiOauthQrWrap.innerHTML = svg;
      aiOauthQrWrap.hidden = false;
      aiOauthQrWrap.setAttribute('aria-hidden', 'false');
    }

    function isSuperGrokMode(): boolean {
      return !!(aiAuthModeSelect && aiAuthModeSelect.value === 'SUPERGROK_OAUTH');
    }

    function setBtnTone(btn: HTMLElement | null, tone: string): void {
      if (!btn) return;
      btn.classList.remove(
        'btn-tone-ok', 'btn-tone-warn', 'btn-tone-danger', 'btn-tone-quiet'
      );
      if (tone) btn.classList.add('btn-tone-' + tone);
    }

    function paintGrokUsing(kind: string, email?: string): void {
      const grok = typeof isGrokProvider === 'function' ? isGrokProvider() : true;
      if (!aiGrokUsing) return;
      if (!grok) {
        aiGrokUsing.hidden = true;
        return;
      }
      aiGrokUsing.hidden = false;
      if (kind === 'signed-in') {
        aiGrokUsing.className = 'ai-using-badge is-supergrok';
        aiGrokUsing.textContent = email
          ? ('Using SuperGrok · ' + email)
          : 'Using SuperGrok';
      } else if (kind === 'expired') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'SuperGrok session expired — sign in again';
      } else if (kind === 'pending') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'Waiting for SuperGrok approval';
      } else if (kind === 'signed-out') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'SuperGrok — not signed in';
      } else {
        aiGrokUsing.className = 'ai-using-badge is-apikey';
        aiGrokUsing.textContent = 'Using Grok API key';
      }
    }

    function setOauthActionState(kind: string): void {
      if (!aiOauthSignInBtn || !aiOauthImportBtn || !aiOauthSignOutBtn) return;
      if (kind === 'signed-in') {
        aiOauthSignInBtn.textContent = 'Replace sign-in';
        setBtnTone(aiOauthSignInBtn, 'quiet');
        setBtnTone(aiOauthImportBtn, 'quiet');
        setBtnTone(aiOauthSignOutBtn, 'danger');
        aiOauthSignOutBtn.hidden = false;
        aiOauthImportBtn.hidden = false;
      } else if (kind === 'pending') {
        aiOauthSignInBtn.textContent = 'Cancel sign-in';
        setBtnTone(aiOauthSignInBtn, 'warn');
        setBtnTone(aiOauthImportBtn, 'quiet');
        aiOauthSignOutBtn.hidden = true;
        aiOauthImportBtn.hidden = true;
      } else if (kind === 'expired') {
        aiOauthSignInBtn.textContent = 'Sign in again';
        setBtnTone(aiOauthSignInBtn, 'ok');
        setBtnTone(aiOauthImportBtn, 'quiet');
        setBtnTone(aiOauthSignOutBtn, 'danger');
        aiOauthSignOutBtn.hidden = false;
        aiOauthImportBtn.hidden = false;
      } else {
        aiOauthSignInBtn.textContent = 'Sign in with SuperGrok';
        setBtnTone(aiOauthSignInBtn, 'ok');
        setBtnTone(aiOauthImportBtn, 'quiet');
        aiOauthSignOutBtn.hidden = true;
        aiOauthImportBtn.hidden = false;
      }
    }

    function showOauthPending(code?: string, uri?: string): void {
      if (!isSuperGrokMode() || !aiOauthStatus) {
        hideOauthQr();
        return;
      }
      const url = uri || 'https://accounts.x.ai/oauth2/device';
      aiOauthLocalCode = code || aiOauthLocalCode || '';
      aiOauthLocalUri = url;
      aiOauthStatus.textContent = 'Waiting for phone approval — keep this QR on screen';
      aiOauthStatus.className = 'settings-hint';
      if (aiOauthCode) {
        aiOauthCode.hidden = false;
        aiOauthCode.textContent = aiOauthLocalCode;
      }
      if (aiOauthHint) {
        aiOauthHint.hidden = false;
        aiOauthHint.textContent = 'Scan with your phone, or open ' + url +
          ' and enter the code. This stays open until you approve or cancel.';
      }
      showOauthQr(url);
      if (aiOauthModal) {
        aiOauthModal.hidden = false;
        aiOauthModal.setAttribute('aria-hidden', 'false');
      }
      if (aiOauthModalCancel && typeof aiOauthModalCancel.focus === 'function') {
        try { aiOauthModalCancel.focus(); } catch (err) { /* ignore */ }
        aiOauthModalCancel.classList.add('focused');
      }
      setOauthActionState('pending');
      paintGrokUsing('pending');
    }

    function syncAuthModeUi() {
      const heavy = isSuperGrokMode();
      const grok = typeof isGrokProvider === 'function' ? isGrokProvider() : true;
      if (oauthBox) oauthBox.hidden = !grok || !heavy;
      if (authHint) {
        authHint.hidden = !grok;
        authHint.textContent = heavy
          ? 'SuperGrok is an account sign-in (same as grok login). Green = sign in, red = sign out. The Grok API key is not used while SuperGrok is signed in.'
          : 'Using a Grok API key from console.x.ai. Switch Grok account to SuperGrok sign-in if you have a SuperGrok subscription instead.';
      }
      if (authRow) authRow.hidden = !grok;
      if (!heavy && grok) paintGrokUsing('apikey');
      if ((!heavy || !grok) && !aiOauthInProgress) {
        hideOauthQr();
        stopOauthPoll();
      }
      if (xaiRow && xaiRow.row && typeof syncProviderUi === 'function') {
        syncProviderUi();
      }
    }
    const oauthRow = document.createElement('div');
    oauthRow.className = 'ai-oauth-row';
    aiOauthSignInBtn = createMiniButton({
      label: 'Sign in with SuperGrok',
      focusIndex: '1991',
      className: 'btn-tone-ok'
    });
    aiOauthImportBtn = createMiniButton({
      label: 'Import login file',
      focusIndex: '1992',
      className: 'btn-tone-quiet'
    });
    aiOauthSignOutBtn = createMiniButton({
      label: 'Sign out',
      focusIndex: '1993',
      className: 'btn-tone-danger'
    });
    oauthRow.appendChild(aiOauthSignInBtn);
    oauthRow.appendChild(aiOauthImportBtn);
    oauthRow.appendChild(aiOauthSignOutBtn);
    oauthBox.appendChild(oauthRow);
    aiKeySection.appendChild(oauthBox);
    syncAuthModeUi();

    function stopOauthPoll(): void {
      if (aiOauthPollTimer) {
        clearInterval(aiOauthPollTimer);
        aiOauthPollTimer = null;
      }
    }

    function oauthPendingFrom(status: VoicePayload | null, cfg: VoicePayload | null): VoicePayload | null {
      return (status && status.oauthPending) || (cfg && cfg.oauth_pending) || null;
    }

    function isOauthPendingWaiting(pending: VoicePayload | null | undefined): boolean {
      if (!pending || !pending.userCode) return false;
      const st = String(pending.status || 'pending').toLowerCase();
      return !st || st === 'pending';
    }

    function paintSignedIn(email?: string): void {
      if (aiAuthModeSelect && aiAuthModeSelect.value !== 'SUPERGROK_OAUTH') {
        aiAuthModeSelect.value = 'SUPERGROK_OAUTH';
        if (typeof aiAuthModeSelect.setValue === 'function') {
          aiAuthModeSelect.setValue('SUPERGROK_OAUTH');
        }
        syncAuthModeUi();
      }
      aiOauthStatus.textContent = email
        ? ('Signed in as ' + email + ' — voice uses SuperGrok, not the API key')
        : 'Signed in — voice uses SuperGrok, not the API key';
      aiOauthStatus.className = 'settings-hint ai-status-ok';
      hideOauthQr();
      setOauthActionState('signed-in');
      paintGrokUsing('signed-in', email);
      stopOauthPoll();
    }

    function paintOauthFromStatus(status: VoicePayload, cfg: VoicePayload | null): void {
      syncAuthModeUi();
      // SuperGrok token / session warnings belong only on Grok + SuperGrok.
      if (!isGrokProvider() || !isSuperGrokMode()) return;
      const pending = oauthPendingFrom(status, cfg);
      const pendingWaiting = isOauthPendingWaiting(pending);
      if (pendingWaiting) aiOauthSawPending = true;
      const email = (status && status.oauthEmail) || (cfg && cfg.oauth_email) || '';
      const err = (status && status.oauthError) ||
        (pending && pending.error) ||
        (cfg && cfg.oauth_error) || '';
      const tokenExpired = !!(status && status.oauthTokenExpired) ||
        !!(cfg && cfg.oauth_token_expired);
      const signedIn = !tokenExpired && (
        !!(status && status.oauthSignedIn) || !!(cfg && cfg.oauth_signed_in)
      );
      // applyAiConfigToForm paints with {} — never treat that as "login done".
      const liveStatus = !!(status && (
        status.oauthSignedIn !== undefined ||
        status.oauthPending !== undefined ||
        status.daemonActive !== undefined
      ));

      // Device-code login in flight wins over a leftover oauth.json session.
      // Otherwise the 2s status poll hides the QR and claims "signed in".
      if (aiOauthInProgress || pendingWaiting) {
        if (liveStatus && aiOauthInProgress && aiOauthSawPending &&
            signedIn && !pendingWaiting) {
          aiOauthInProgress = false;
          paintSignedIn(email);
          return;
        }
        if (liveStatus && aiOauthInProgress && aiOauthSawPending &&
            !pendingWaiting && !signedIn) {
          aiOauthInProgress = false;
          hideOauthQr();
          aiOauthStatus.textContent = err
            ? ('SuperGrok: ' + err)
            : 'SuperGrok: sign-in did not complete';
          aiOauthStatus.className = 'settings-hint ai-status-warn';
          setOauthActionState('signed-out');
          paintGrokUsing('signed-out');
          stopOauthPoll();
          return;
        }
        showOauthPending(
          (pending && pending.userCode) || aiOauthLocalCode,
          (pending && pending.verificationUri) || aiOauthLocalUri ||
            'https://accounts.x.ai/oauth2/device'
        );
        return;
      }

      if (signedIn) {
        paintSignedIn(email);
      } else {
        aiOauthStatus.textContent = err
          ? ('SuperGrok: ' + err)
          : (tokenExpired
            ? 'SuperGrok session expired — sign in again to keep using SuperGrok'
            : 'Not signed in — use Sign in (green) or a Grok API key instead');
        aiOauthStatus.className = (err || tokenExpired)
          ? 'settings-hint ai-status-warn'
          : 'settings-hint';
        hideOauthQr();
        setOauthActionState(tokenExpired ? 'expired' : 'signed-out');
        paintGrokUsing(tokenExpired ? 'expired' : 'signed-out');
        stopOauthPoll();
      }
    }

    function pollOauthUntilDone(): void {
      stopOauthPoll();
      aiOauthPollTimer = setInterval(function () {
        if (!ctx.isVisible()) {
          stopOauthPoll();
          return;
        }
        getVoiceStatus().then(function (status) {
          const pending = status && status.oauthPending;
          const stillWaiting = isOauthPendingWaiting(pending) ||
            (aiOauthInProgress && !aiOauthSawPending);
          const tokenExpired = !!(status && status.oauthTokenExpired);
          const signedIn = !!(status && status.oauthSignedIn) && !tokenExpired;
          paintOauthFromStatus(status || {}, aiLoadedConfig);
          if (signedIn && !stillWaiting && (!aiOauthInProgress || aiOauthSawPending)) {
            if (options.onToast) options.onToast('SuperGrok signed in');
            aiOauthInProgress = false;
            loadAiTab();
          }
        }).catch(function () { /* ignore */ });
      }, 2000);
    }

    function cancelOauthLogin(): void {
      aiOauthInProgress = false;
      aiOauthSawPending = false;
      hideOauthQr();
      stopOauthPoll();
      cancelSuperGrokLogin().then(function () {
        loadAiTab();
      }).catch(function (err) {
        if (options.onToast) options.onToast((err && err.message) || 'Cancel failed');
        loadAiTab();
      });
    }

    aiOauthSignInBtn.addEventListener('click', function () {
      const pending = aiLoadedConfig && aiLoadedConfig.oauth_pending;
      if (aiOauthInProgress ||
          aiOauthSignInBtn.textContent.indexOf('Cancel') === 0 ||
          isOauthPendingWaiting(pending)) {
        cancelOauthLogin();
        return;
      }
      aiOauthSignInBtn.disabled = true;
      aiOauthInProgress = true;
      aiOauthSawPending = false;
      startSuperGrokLogin().then(function (res) {
        aiOauthSignInBtn.disabled = false;
        const code = (res && res.userCode) || '';
        const uri = (res && res.verificationUri) || 'https://accounts.x.ai/oauth2/device';
        showOauthPending(code, uri);
        aiOauthSignInBtn.textContent = 'Cancel sign-in';
        if (code) aiOauthSawPending = true;
        if (options.onToast) options.onToast('SuperGrok code: ' + code);
        pollOauthUntilDone();
      }).catch(function (err) {
        aiOauthInProgress = false;
        aiOauthSignInBtn.disabled = false;
        hideOauthQr();
        if (options.onToast) {
          options.onToast((err && err.message) || 'Could not start SuperGrok sign-in');
        }
      });
    });
    if (aiOauthModalCancel) {
      aiOauthModalCancel.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        cancelOauthLogin();
      });
    }
    aiOauthImportBtn.addEventListener('click', function () {
      aiOauthImportBtn.disabled = true;
      importSuperGrokAuth().then(function (res) {
        aiOauthImportBtn.disabled = false;
        if (options.onToast) {
          options.onToast(res && res.email
            ? ('Imported SuperGrok for ' + res.email)
            : 'Imported SuperGrok session');
        }
        loadAiTab();
      }).catch(function (err) {
        aiOauthImportBtn.disabled = false;
        if (options.onToast) {
          options.onToast((err && err.message) ||
            'Copy ~/.grok/auth.json to /home/root/.grok/auth.json on the TV');
        }
      });
    });
    aiOauthSignOutBtn.addEventListener('click', function () {
      signOutSuperGrok().then(function () {
        if (aiAuthModeSelect) {
          aiAuthModeSelect.value = 'API_KEY';
          if (typeof aiAuthModeSelect.setValue === 'function') {
            aiAuthModeSelect.setValue('API_KEY');
          }
        }
        if (options.onToast) options.onToast('Signed out of SuperGrok');
        loadAiTab();
      }).catch(function (err) {
        if (options.onToast) options.onToast((err && err.message) || 'Sign out failed');
      });
    });

    xaiRow = makeKeyRow('Grok API key', 2001, 'xai-…');
    aiApiKeyInput = xaiRow.input;
    aiApiKeyShowBtn = xaiRow.showBtn;
    aiKeySection.appendChild(xaiRow.row);
    aiApiKeyHint = createHint(
      'Get a key at console.x.ai — stored only on this TV. Leave blank to keep the current key.'
    );
    aiKeySection.appendChild(aiApiKeyHint);

    gemRow = makeKeyRow('Gemini key', 2003, 'AIza…');
    aiGeminiKeyInput = gemRow.input;
    aiGeminiKeyShowBtn = gemRow.showBtn;
    aiKeySection.appendChild(gemRow.row);
    aiGeminiKeyHint = createHint(
      'Optional. Google AI Studio key (usually starts with AIza). Leave blank to keep current.'
    );
    aiKeySection.appendChild(aiGeminiKeyHint);

    orRow = makeKeyRow('OpenRouter key', 2005, 'sk-or-…');
    aiOpenRouterKeyInput = orRow.input;
    aiOpenRouterKeyShowBtn = orRow.showBtn;
    aiKeySection.appendChild(orRow.row);
    aiOpenRouterKeyHint = createHint(
      'Get a key at openrouter.ai — stored only on this TV. Leave blank to keep current.'
    );
    aiKeySection.appendChild(aiOpenRouterKeyHint);

    aiApiKeyShowBtn.addEventListener('click', function () {
      aiXaiKeyRevealed = !aiXaiKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.xai_api_key_full) || '';
      const typed = (aiApiKeyInput.value || '').trim();
      if (aiXaiKeyRevealed) {
        aiApiKeyInput.type = 'text';
        if (!typed && full) aiApiKeyInput.value = full;
        aiApiKeyShowBtn.textContent = 'Hide';
      } else {
        aiApiKeyInput.type = 'password';
        if (full && aiApiKeyInput.value === full) aiApiKeyInput.value = '';
        aiApiKeyShowBtn.textContent = 'Show';
      }
    });
    aiGeminiKeyShowBtn.addEventListener('click', function () {
      aiGeminiKeyRevealed = !aiGeminiKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.gemini_api_key_full) || '';
      const typed = (aiGeminiKeyInput.value || '').trim();
      if (aiGeminiKeyRevealed) {
        aiGeminiKeyInput.type = 'text';
        if (!typed && full) aiGeminiKeyInput.value = full;
        aiGeminiKeyShowBtn.textContent = 'Hide';
      } else {
        aiGeminiKeyInput.type = 'password';
        if (full && aiGeminiKeyInput.value === full) aiGeminiKeyInput.value = '';
        aiGeminiKeyShowBtn.textContent = 'Show';
      }
    });
    aiOpenRouterKeyShowBtn.addEventListener('click', function () {
      aiOpenRouterKeyRevealed = !aiOpenRouterKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.openrouter_api_key_full) || '';
      const typed = (aiOpenRouterKeyInput.value || '').trim();
      if (aiOpenRouterKeyRevealed) {
        aiOpenRouterKeyInput.type = 'text';
        if (!typed && full) aiOpenRouterKeyInput.value = full;
        aiOpenRouterKeyShowBtn.textContent = 'Hide';
      } else {
        aiOpenRouterKeyInput.type = 'password';
        if (full && aiOpenRouterKeyInput.value === full) aiOpenRouterKeyInput.value = '';
        aiOpenRouterKeyShowBtn.textContent = 'Show';
      }
    });

    aiPane.appendChild(aiKeySection);

    const aiProviderSection = createSection('Assistant');
    const providerHint = createHint('Who listens and answers when you press Voice.');
    aiProviderSelect = createProviderPicker(1970, function () {
      syncProviderUi();
    });
    aiProviderSection.appendChild(aiProviderSelect);
    aiProviderSection.appendChild(providerHint);

    const aiVoiceSection = createSection('Voice & chat');
    aiSttSelect = createOptionStepper({
      focusIndex: 1973,
      choices: [],
      value: ''
    });
    aiVoiceSection.appendChild(labeledControl('Speech language', aiSttSelect));
    aiVoiceModelSelect = createOptionStepper({
      focusIndex: 1974,
      choices: [],
      value: ''
    });
    const aiVoiceModelRow = labeledControl('Voice model', aiVoiceModelSelect);
    aiVoiceSection.appendChild(aiVoiceModelRow);
    aiChatSelect = createOptionStepper({
      focusIndex: 1975,
      choices: [],
      value: ''
    });
    const aiChatModelRow = labeledControl('Chat model', aiChatSelect);
    aiVoiceSection.appendChild(aiChatModelRow);
    aiGeminiSttSelect = createOptionStepper({
      focusIndex: 1976,
      choices: [],
      value: ''
    });
    const aiGeminiSttRow = labeledControl('Listen model', aiGeminiSttSelect);
    aiVoiceSection.appendChild(aiGeminiSttRow);
    aiGeminiModelSelect = createOptionStepper({
      focusIndex: 1977,
      choices: [],
      value: ''
    });
    const aiGeminiModelRow = labeledControl('Answer model', aiGeminiModelSelect);
    aiVoiceSection.appendChild(aiGeminiModelRow);
    aiOpenRouterSttSelect = createOptionStepper({
      focusIndex: 1977,
      choices: [],
      value: ''
    });
    const aiOpenRouterSttRow = labeledControl('Listen model', aiOpenRouterSttSelect);
    aiVoiceSection.appendChild(aiOpenRouterSttRow);
    aiOpenRouterModelSelect = createOptionStepper({
      focusIndex: 1978,
      choices: [],
      value: ''
    });
    const aiOpenRouterModelRow = labeledControl('Answer model', aiOpenRouterModelSelect);
    aiVoiceSection.appendChild(aiOpenRouterModelRow);
    aiDismissSelect = createOptionStepper({
      focusIndex: 1979,
      choices: [
        {value: '6', label: '6 seconds'},
        {value: '8', label: '8 seconds'},
        {value: '10', label: '10 seconds'},
        {value: '12', label: '12 seconds'},
        {value: '20', label: '20 seconds'},
        {value: '30', label: '30 seconds'}
      ],
      value: '8'
    });
    aiVoiceSection.appendChild(labeledControl('Answer card auto-dismiss', aiDismissSelect));
    aiVoiceSection.appendChild(createHint(
      'Press Save after changes. Switching assistant or keys restarts the voice daemon.'
    ));

    function currentAiProvider(): string {
      const v = aiProviderSelect && aiProviderSelect.value;
      if (v === 'gemini' || v === 'openrouter') return v;
      return 'xai';
    }

    function isGrokProvider(): boolean {
      return currentAiProvider() === 'xai';
    }

    function isGeminiProvider(): boolean {
      return currentAiProvider() === 'gemini';
    }

    function isOpenRouterProvider(): boolean {
      return currentAiProvider() === 'openrouter';
    }

    function syncProviderUi(): void {
      const grok = isGrokProvider();
      const gemini = isGeminiProvider();
      const openrouter = isOpenRouterProvider();
      if (providerHint) {
        if (gemini) {
          providerHint.textContent =
            'Gemini listens and answers with the models below. Spoken replies use Gemini TTS.';
        } else if (openrouter) {
          providerHint.textContent =
            'OpenRouter listens with the speech-to-text model you pick, then answers with the chat model.';
        } else {
          providerHint.textContent =
            'Grok listens, answers, and can speak. Choose SuperGrok sign-in or a Grok API key under Grok account.';
        }
      }
      if (aiVoiceModelRow) aiVoiceModelRow.hidden = !grok;
      if (aiChatModelRow) aiChatModelRow.hidden = !grok;
      if (aiGeminiSttRow) aiGeminiSttRow.hidden = !gemini;
      if (aiGeminiModelRow) aiGeminiModelRow.hidden = !gemini;
      if (aiOpenRouterSttRow) aiOpenRouterSttRow.hidden = !openrouter;
      if (aiOpenRouterModelRow) aiOpenRouterModelRow.hidden = !openrouter;
      if (authRow) authRow.hidden = !grok;
      if (authHint) authHint.hidden = !grok;
      if (oauthBox) oauthBox.hidden = !grok || !isSuperGrokMode();
      const superGrok = grok && isSuperGrokMode();
      const showXaiKey = grok && !superGrok;
      if (xaiRow && xaiRow.row) {
        xaiRow.row.hidden = !showXaiKey;
        xaiRow.row.classList.remove('ai-key-inactive');
      }
      if (aiApiKeyHint) {
        aiApiKeyHint.hidden = !showXaiKey;
        if (showXaiKey) {
          const xaiConfigured = !!(aiLoadedConfig && (aiLoadedConfig.xai_api_key_configured ||
            (aiLoadedConfig.xai_api_key_masked && aiLoadedConfig.api_key_configured)));
          const xaiMasked = (aiLoadedConfig && aiLoadedConfig.xai_api_key_masked) || '';
          aiApiKeyHint.textContent = xaiConfigured
            ? ('Grok API key on file: ' + xaiMasked + ' — leave blank to keep it.')
            : 'Get a key at console.x.ai — stored only on this TV.';
        }
      }
      if (gemRow && gemRow.row) gemRow.row.hidden = !gemini;
      if (aiGeminiKeyHint) aiGeminiKeyHint.hidden = !gemini;
      if (orRow && orRow.row) orRow.row.hidden = !openrouter;
      if (aiOpenRouterKeyHint) aiOpenRouterKeyHint.hidden = !openrouter;
      if (grok && !isSuperGrokMode()) paintGrokUsing('apikey');
      if (aiGrokUsing) aiGrokUsing.hidden = !grok && aiGrokUsing.hidden;
      if (!grok && aiGrokUsing) aiGrokUsing.hidden = true;
      if (!grok && !aiOauthInProgress) {
        hideOauthQr();
        stopOauthPoll();
      }
      // Re-paint daemon status so leftover xAI credit/token errors hide as soon
      // as Gemini or OpenRouter is selected (even before Save).
      if (lastAiStatus != null || aiLoadedConfig) {
        paintVoiceStatus(aiLoadedConfig, lastAiStatus || {});
      }
    }

    // Voice assistant on/off. Launch Home installs and runs its own voice
    // daemon (voice/ in this app) as root; everything below talks to it, so
    // those sections only show while it is on.
    const aiPowerSection = createSection('Voice assistant');
    const aiPowerBtn = createMiniButton({
      label: '',
      focusIndex: '1960',
      className: 'settings-scan-btn'
    });
    aiPowerSection.appendChild(aiPowerBtn);
    const aiPowerStatus = createHint('', 'ai-status-line');
    aiPowerSection.appendChild(aiPowerStatus);
    const aiOtherVoice = document.createElement('p');
    aiOtherVoice.className = 'ai-credit-banner';
    aiOtherVoice.hidden = true;
    aiPowerSection.appendChild(aiOtherVoice);
    aiPowerSection.appendChild(createHint(
      'Answers the Voice button on the Magic Remote with Grok, Gemini or OpenRouter. ' +
      'It runs in the background as root (Homebrew Channel). Turning it off hands the ' +
      'button back to LG and keeps your keys and sign-in.'
    ));

    voiceOn = !!(config.launcher && config.launcher.voiceEnabled);

    function paintVoicePower(message?: string, kind?: string): void {
      aiPowerBtn.textContent = voiceBusy
        ? (voiceOn ? 'Turning off…' : 'Turning on…')
        : (voiceOn ? 'Turn off' : 'Turn on');
      aiPowerStatus.textContent = message || (voiceOn ? 'On' : 'Off');
      aiPowerStatus.className = 'settings-hint ai-status-line ' +
        (kind === 'err' ? 'ai-status-err' : (voiceOn ? 'ai-status-ok' : 'ai-status-warn'));
      [aiKeySection, aiProviderSection, aiVoiceSection, aiStatusSection].forEach(function (el) {
        el.hidden = !voiceOn;
      });
    }

    // VoxRelay (a separate project) answering the same button would clash.
    // Launch Home only reports it; it never stops or changes it.
    function paintOtherVoice(state: string): void {
      aiOtherVoice.hidden = !state;
      aiOtherVoice.textContent = state === 'running'
        ? 'VoxRelay is also running on this TV. Both answer the Voice button, so ' +
          'answers can clash. ' + BRAND.name + ' leaves it alone: turn one of them off.'
        : (state === 'installed'
          ? 'VoxRelay is also installed on this TV. If it runs, both answer the Voice ' +
            'button. ' + BRAND.name + ' leaves it alone.'
          : '');
    }

    // Saves just this setting: the panel's other edits still wait for Save.
    function persistVoiceEnabled(on: boolean): void {
      config.launcher.voiceEnabled = on;
      try {
        const stored = loadConfig();
        stored.launcher.voiceEnabled = on;
        saveConfig(stored);
      } catch (err) {
        console.error(err);
      }
      if (options.onVoiceEnabledChange) options.onVoiceEnabledChange(on);
    }

    aiPowerBtn.addEventListener('click', function () {
      if (voiceBusy) return;
      // Not disabled while busy: a disabled button drops focus.
      voiceBusy = true;
      const turningOn = !voiceOn;
      paintVoicePower(turningOn
        ? 'Turning on… the first time installs the voice card, up to a minute.'
        : 'Turning off…');
      (turningOn ? enableVoice() : disableVoice()).then(function (res) {
        voiceBusy = false;
        persistVoiceEnabled(turningOn);
        voiceOn = turningOn;
        paintOtherVoice(turningOn ? (res as import('@luna/luna.js').VoiceEnableResult).otherVoice : '');
        paintVoicePower(turningOn ? 'On' : 'Off. Your keys and sign-in are kept.');
        if (turningOn) loadAiTab();
      }, function (err) {
        voiceBusy = false;
        paintVoicePower((turningOn ? 'Could not turn on: ' : 'Could not turn off: ') +
          ((err && err.message) || 'it needs root (Homebrew Channel)'), 'err');
      });
    });

    // Voice assistant on/off first, then the Assistant choice (Grok, Gemini,
    // OpenRouter) with its API key / SuperGrok sign-in right underneath,
    // Voice & chat, and the service status.
    aiPane.insertBefore(aiVoiceSection, aiStatusSection);
    aiPane.insertBefore(aiKeySection, aiVoiceSection);
    aiPane.insertBefore(aiProviderSection, aiKeySection);
    aiPane.insertBefore(aiPowerSection, aiProviderSection);
    paintVoicePower();
    syncProviderUi();

    /**
     * Fill a picker from the voice service's own choices (config.options),
     * so Launch Home ships no model or language lists. The saved value is
     * always shown, even if the service no longer offers it.
     */
    function fillFromService(select: OptionStepperElement, key: string): void {
      if (!select || typeof select.setOptions !== 'function' || !aiLoadedConfig) return;
      const offered = (aiLoadedConfig.options && aiLoadedConfig.options[key]) || [];
      const list: StepperOption[] = offered.map(function (o: any) {
        return typeof o === 'object' && o
          ? {value: String(o.value), label: String(o.label || o.value)}
          : {value: String(o), label: String(o)};
      });
      let current = aiLoadedConfig[key] != null ? String(aiLoadedConfig[key]) : '';
      if (!current && list.length) current = list[0].value;
      if (current && !list.some(function (o) { return o.value === current; })) {
        list.unshift({value: current, label: current});
      }
      select.setOptions(list, current);
    }

    function applyAiConfigToForm(cfg: VoicePayload): void {
      aiLoadedConfig = cfg || {};
      aiXaiKeyRevealed = false;
      aiGeminiKeyRevealed = false;
      aiOpenRouterKeyRevealed = false;
      const xaiConfigured = !!(aiLoadedConfig.xai_api_key_configured ||
        (aiLoadedConfig.xai_api_key_masked && aiLoadedConfig.api_key_configured));
      const gemConfigured = !!aiLoadedConfig.gemini_api_key_configured ||
        !!(aiLoadedConfig.gemini_api_key_masked);
      const orConfigured = !!aiLoadedConfig.openrouter_api_key_configured ||
        !!(aiLoadedConfig.openrouter_api_key_masked);
      const xaiMasked = aiLoadedConfig.xai_api_key_masked || '';
      const gemMasked = aiLoadedConfig.gemini_api_key_masked || '';
      const orMasked = aiLoadedConfig.openrouter_api_key_masked || '';
      const provider = (aiLoadedConfig.ai_provider === 'gemini' ||
        aiLoadedConfig.ai_provider === 'openrouter')
        ? aiLoadedConfig.ai_provider
        : 'xai';
      aiApiKeyInput.type = 'password';
      aiApiKeyInput.value = '';
      aiApiKeyInput.placeholder = xaiConfigured ? (xaiMasked || '••••••••') : 'xai-…';
      aiApiKeyShowBtn.textContent = 'Show';
      aiApiKeyHint.textContent = xaiConfigured
        ? ('Grok API key on file: ' + xaiMasked + ' — leave blank to keep it.')
        : 'Get a key at console.x.ai — stored only on this TV.';
      if (aiProviderSelect) {
        aiProviderSelect.value = provider;
        if (typeof aiProviderSelect.setValue === 'function') {
          aiProviderSelect.setValue(provider);
        }
      }
      const authMode = ((aiLoadedConfig.oauth_signed_in &&
        !aiLoadedConfig.oauth_token_expired) && 'SUPERGROK_OAUTH') ||
        aiLoadedConfig.auth_mode || 'API_KEY';
      if (aiAuthModeSelect) {
        aiAuthModeSelect.value = authMode;
        if (typeof aiAuthModeSelect.setValue === 'function') {
          aiAuthModeSelect.setValue(authMode);
        }
      }
      fillFromService(aiGeminiModelSelect, 'gemini_model');
      fillFromService(aiGeminiSttSelect, 'gemini_stt_model');
      fillFromService(aiOpenRouterModelSelect, 'openrouter_model');
      fillFromService(aiOpenRouterSttSelect, 'openrouter_stt_model');
      syncAuthModeUi();
      if (typeof syncProviderUi === 'function') syncProviderUi();
      paintOauthFromStatus({}, aiLoadedConfig);
      aiGeminiKeyInput.type = 'password';
      aiGeminiKeyInput.value = '';
      aiGeminiKeyInput.placeholder = gemConfigured ? (gemMasked || '••••••••') : 'AIza…';
      aiGeminiKeyShowBtn.textContent = 'Show';
      aiGeminiKeyHint.textContent = gemConfigured
        ? ('Current Gemini key: ' + gemMasked + ' — leave blank to keep it')
        : 'Required for Gemini. Google AI Studio key (usually starts with AIza).';
      if (aiOpenRouterKeyInput) {
        aiOpenRouterKeyInput.type = 'password';
        aiOpenRouterKeyInput.value = '';
        aiOpenRouterKeyInput.placeholder = orConfigured ? (orMasked || '••••••••') : 'sk-or-…';
      }
      if (aiOpenRouterKeyShowBtn) aiOpenRouterKeyShowBtn.textContent = 'Show';
      if (aiOpenRouterKeyHint) {
        aiOpenRouterKeyHint.textContent = orConfigured
          ? ('Current OpenRouter key: ' + orMasked + ' — leave blank to keep it')
          : 'Required for OpenRouter. Get a key at openrouter.ai (usually starts with sk-or-).';
      }
      fillFromService(aiSttSelect, 'stt_language');
      fillFromService(aiChatSelect, 'chat_model');
      fillFromService(aiVoiceModelSelect, 'voice_model');
      let dismissN = Math.round(Number(aiLoadedConfig.overlay_auto_dismiss_sec));
      if (!isFinite(dismissN) || dismissN < 3) dismissN = 8;
      const dismiss = String(dismissN);
      aiDismissSelect.value = dismiss;
      if (typeof aiDismissSelect.setValue === 'function') aiDismissSelect.setValue(dismiss);
    }

    function paintVoiceStatus(cfg: VoicePayload, status: VoicePayload): void {
      if (!aiStatusLabel) return;
      cfg = cfg || {};
      status = status || {};
      const provider = currentAiProvider();
      const usingGemini = provider === 'gemini';
      const usingOpenRouter = provider === 'openrouter';
      const usingGrok = !usingGemini && !usingOpenRouter;
      // Leftover xAI errors (credits, spend limit, expired API tokens)
      // are Grok-only. Gemini / OpenRouter must not inherit it.
      const lastErr = usingGrok ? (status.lastXaiError || cfg.last_xai_error) : null;
      if (aiCreditBanner) {
        if (lastErr && lastErr.message) {
          aiCreditBanner.hidden = false;
          aiCreditBanner.textContent = lastErr.message;
        } else {
          aiCreditBanner.hidden = true;
          aiCreditBanner.textContent = '';
        }
      }
      const tokenExpired = !!(status.oauthTokenExpired || cfg.oauth_token_expired);
      const oauthOk = !tokenExpired &&
        !!(status.oauthSignedIn || cfg.oauth_signed_in);
      const ready = usingGemini
        ? !!cfg.gemini_api_key_configured
        : (usingOpenRouter
          ? !!cfg.openrouter_api_key_configured
          : !!(cfg.api_key_configured || oauthOk));
      if (lastErr && lastErr.message) {
        aiStatusLabel.textContent = lastErr.kind === 'credits'
          ? 'Voice blocked — xAI API credits / spend limit'
          : 'Voice blocked — xAI API error';
        aiStatusLabel.className = 'settings-hint ai-status-line ai-status-err';
      } else if (status.daemonActive) {
        aiStatusLabel.textContent = ready
          ? 'Voice daemon running — ready'
          : (usingGemini
            ? 'Daemon running — Gemini key still needed'
            : (usingOpenRouter
              ? 'Daemon running — OpenRouter key still needed'
              : 'Daemon running — API key or SuperGrok sign-in still needed'));
        aiStatusLabel.className = 'settings-hint ai-status-line ' +
          (ready ? 'ai-status-ok' : 'ai-status-warn');
      } else {
        aiStatusLabel.textContent = ready
          ? ((usingGemini ? 'Gemini' : (usingOpenRouter ? 'OpenRouter' : 'Signed in')) +
            ' configured — daemon not running (Save AI to restart)')
          : (usingGemini
            ? 'Voice service idle — add a Gemini key, then Save'
            : (usingOpenRouter
              ? 'Voice service idle — add an OpenRouter key, then Save'
              : 'Voice service idle — add an API key or SuperGrok sign-in, then Save'));
        aiStatusLabel.className = 'settings-hint ai-status-line ai-status-warn';
      }
    }

    function loadAiTab(isRetry?: boolean): void {
      if (aiRetryTimer !== null) clearTimeout(aiRetryTimer);
      if (isRetry !== true) aiLoadRetries = 0;
      if (!voiceOn) {
        // Off in this app's settings, but the daemon may still be running
        // (e.g. Launch Home was reinstalled): show what is really there.
        isVoiceRunning().then(function (running) {
          if (disposed || !ctx.isVisible() || voiceBusy || voiceOn || !running) return;
          persistVoiceEnabled(true);
          voiceOn = true;
          paintVoicePower();
          loadAiTab();
        }).catch(function () { /* not rooted / desktop preview */ });
        return;
      }
      Promise.all([
        getVoiceConfig().catch(function (err) { return {__error: err}; }),
        getVoiceStatus().catch(function () { return {}; })
      ]).then(function (results) {
        if (disposed || !ctx.isVisible()) return;
        const cfg = results[0] || {};
        const status = results[1] || {};
        if (cfg.__error) {
          lastAiStatus = null;
          if (aiCreditBanner) {
            aiCreditBanner.hidden = true;
            aiCreditBanner.textContent = '';
          }
          // Just turned on or restarting after Save: keep trying for a while.
          aiLoadRetries += 1;
          if (voiceOn && aiLoadRetries <= 10) {
            aiStatusLabel.textContent = 'Starting the voice assistant…';
            aiStatusLabel.className = 'settings-hint ai-status-line ai-status-warn';
            aiRetryTimer = setTimeout(function () { loadAiTab(true); }, 2500);
            return;
          }
          aiStatusLabel.textContent = 'The voice assistant is not answering. Turn it off and on ' +
            'again; its log is ' + BRAND.tmpPrefix + '-voice.log on the TV.';
          aiStatusLabel.className = 'settings-hint ai-status-line ai-status-err';
          return;
        }
        aiLoadRetries = 0;
        lastAiStatus = status;
        applyAiConfigToForm(cfg);
        paintOauthFromStatus(status, cfg);
        paintVoiceStatus(cfg, status);
      });
    }

    function saveAi(saveBtn: HTMLButtonElement): boolean {
      const payload: Record<string, any> = {
        ai_provider: (aiProviderSelect && aiProviderSelect.value) || 'xai',
        overlay_auto_dismiss_sec: parseInt(aiDismissSelect.value, 10) || 8,
        auth_mode: (aiAuthModeSelect && aiAuthModeSelect.value) || 'API_KEY'
      };
      // Model / language choices: only what the service offered and the
      // user has; the service keeps its own defaults.
      const modelPairs: Array<[OptionStepperElement, string]> = [
        [aiSttSelect, 'stt_language'],
        [aiChatSelect, 'chat_model'],
        [aiVoiceModelSelect, 'voice_model'],
        [aiGeminiModelSelect, 'gemini_model'],
        [aiGeminiSttSelect, 'gemini_stt_model'],
        [aiOpenRouterModelSelect, 'openrouter_model'],
        [aiOpenRouterSttSelect, 'openrouter_stt_model']
      ];
      modelPairs.forEach(function (pair) {
        if (pair[0] && pair[0].value) payload[pair[1]] = pair[0].value;
      });
      const key = (aiApiKeyInput.value || '').trim();
      // Hidden Grok key field must not toast xAI/SuperGrok token warnings
      // when Gemini or OpenRouter is the selected assistant.
      if (key && isGrokProvider()) {
        if (key.indexOf('xai-') !== 0 && key.indexOf('eyJ') !== 0) {
          if (options.onToast) {
            options.onToast('Grok key should start with xai- (or paste a SuperGrok token)');
          }
          return true;
        }
        payload.xai_api_key = key;
      }
      const gemKey = (aiGeminiKeyInput.value || '').trim();
      if (gemKey) {
        payload.gemini_api_key = gemKey;
      }
      const orKey = ((aiOpenRouterKeyInput && aiOpenRouterKeyInput.value) || '').trim();
      if (orKey) {
        payload.openrouter_api_key = orKey;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      setVoiceConfig(payload).then(function (res) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        if (res && res.restarting) {
          if (options.onToast) options.onToast('AI settings saved — restarting voice…');
        } else if (options.onToast) {
          options.onToast('AI settings saved');
        }
        aiApiKeyInput.value = '';
        aiGeminiKeyInput.value = '';
        if (aiOpenRouterKeyInput) aiOpenRouterKeyInput.value = '';
        loadAiTab();
      }).catch(function (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        if (options.onToast) {
          options.onToast((err && err.message) || 'Could not save AI settings');
        }
      });
      return true;
    }

    function disposeAll(): void {
      stopOauthPoll();
      if (aiRetryTimer !== null) {
        clearTimeout(aiRetryTimer);
        aiRetryTimer = null;
      }
    }

    api = {load: loadAiTab, save: saveAi, dispose: disposeAll};
  }

  return handle;
}
