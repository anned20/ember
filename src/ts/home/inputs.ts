import {getAllInputStatus, getAllInputStatusViaRoot, switchInput} from '@luna/luna.js';
import {indexInRow} from '@focus/focus-row.js';
import {t} from '@lib/i18n.js';
import type {Config, LauncherConfig, LunaResponse} from '@lib/types.js';

const TV_INPUT_IDS = ['TV', 'LIVE_TV', 'TUNER'];

/** A TV input: what the input service lists, or one made from its id. */
export interface InputDevice {
  id: string;
  label?: string;
  appId?: string;
  chosen?: boolean;
  activate?: boolean;
}

/** The channel strip inputs.js reads to offer Live TV and the Channels chip. */
export interface InputRowChannels {
  hasChannels(): boolean;
  isOpen(): boolean;
  available?(): boolean;
  toggle?(): void;
}

export interface InputRowOptions {
  channels?: InputRowChannels;
  onBeforeLaunch?: () => void;
  onToast?: (message: string) => void;
}

export interface InputRowHandle {
  refresh(): Promise<void>;
  render(): void;
  getDevices(): InputDevice[];
}

export function createInputRow(
  container: HTMLElement | null,
  getConfig: () => Config,
  options: InputRowOptions
): InputRowHandle {
  let devices: InputDevice[] = [];
  let currentInputId = '';

  function labelFor(device: InputDevice): string {
    const config = getConfig();
    const labels = (config.launcher && config.launcher.inputLabels) || {};
    if (labels[device.id]) return labels[device.id];

    if (device.label) return device.label;
    return device.id.replace(/_/g, ' ');
  }

  function isConfigured(device: InputDevice): boolean {
    const config = getConfig();
    // Explicit empty array means "hide all inputs". Only fall back to "show all"
    // when the key is missing (undefined/null) — never when the user cleared every
    // checkbox.
    if (!config.launcher || !Object.prototype.hasOwnProperty.call(config.launcher, 'inputs')) {
      return true;
    }
    const allowed = config.launcher.inputs;
    if (!Array.isArray(allowed) || !allowed.length) return false;

    if (allowed.indexOf(device.id) >= 0) return true;

    if (device.id.indexOf('HDMI') === 0) {
      return false;
    }

    return allowed.some(function (id) {
      return TV_INPUT_IDS.indexOf(id) >= 0;
    }) && (device.appId === 'com.webos.app.livetv' || device.id === 'TV');
  }

  function render(): void {
    container!.innerHTML = '';

    // Live TV joins the inputs once the TV turns out to have channels.
    const all = devices.slice();
    const channels = options.channels;
    if (channels && channels.hasChannels() &&
        !all.some(function (d) { return TV_INPUT_IDS.indexOf(d.id) >= 0; })) {
      all.push(liveTvInput());
    }
    const visible = all.filter(isConfigured);
    visible.forEach(function (device, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'input-chip focusable';
      button.dataset.focusIndex = String(indexInRow('inputs', index));
      button.dataset.inputId = device.id;
      button.textContent = labelFor(device);

      if (device.chosen || device.id === currentInputId) {
        button.classList.add('active');
      }

      button.addEventListener('click', function () {
        selectInput(device);
      });

      container!.appendChild(button);
    });

    // Live TV channels (channels.js): only when the TV has channels tuned.
    if (channels && channels.available && channels.available()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'input-chip input-chip-channels focusable';
      button.dataset.focusIndex = String(indexInRow('inputs', visible.length));
      button.dataset.channelsChip = '1';
      button.textContent = t('inputs.channelsChip');
      button.setAttribute('aria-expanded', channels.isOpen() ? 'true' : 'false');
      if (channels.isOpen()) button.classList.add('active');
      button.addEventListener('click', function () {
        channels.toggle!();
      });
      container!.appendChild(button);
    }
  }

  async function selectInput(device: InputDevice): Promise<void> {
    try {
      if (options.onBeforeLaunch) options.onBeforeLaunch();
      await switchInput(device.id, device);
      currentInputId = device.id;
      render();
    } catch (err) {
      if (options.onToast) options.onToast('Could not switch to ' + labelFor(device));
    }
  }

  async function refresh(): Promise<void> {
    // Live TV is added in render(), once the channel list is known.
    const launcher = getConfig().launcher || ({} as LauncherConfig);
    devices = await fetchInputDevices(false, launcher.addedInputs || []);
    const chosen = devices.find(function (d) {
      return d.chosen || d.activate;
    });
    if (chosen) currentInputId = chosen.id;
    render();
  }

  return {
    refresh: refresh,
    // Redraw the chips only (e.g. the Channels chip appeared or opened).
    render: render,
    getDevices: function () {
      return devices.slice();
    }
  };
}

/** Live TV: our own input, so its label follows the language setting. */
function liveTvInput(): InputDevice {
  return {id: 'TV', label: t('inputs.liveTv'), appId: 'com.webos.app.livetv'};
}
// Offered when the TV's input list can't be read.
const FALLBACK_INPUTS = ['HDMI_1', 'HDMI_2', 'HDMI_3'];

export function isTvInputId(id: string): boolean {
  return TV_INPUT_IDS.indexOf(id) >= 0;
}

/** An input from its id alone (HDMI_n or Live TV), or null. */
export function inputFromId(id: string): InputDevice | null {
  const m = /^HDMI_(\d+)$/.exec(id || '');
  if (m) return {id: id, label: 'HDMI ' + m[1], appId: 'com.webos.app.hdmi' + m[1]};
  if (isTvInputId(id)) return liveTvInput();
  return null;
}

/**
 * Every input the TV has: the input service's list, plus any HDMI port it
 * left out (up to the TV's maxHdmiCount: some TVs list fewer to an app than
 * they have), inputs added by hand in Settings (`added`), and Live TV when
 * the TV may have channels (`hasChannels`).
 */
export async function fetchInputDevices(hasChannels: boolean, added: string[]): Promise<InputDevice[]> {
  let res = null;
  try {
    res = await getAllInputStatus().catch(function () {
      return getAllInputStatusViaRoot();
    });
  } catch (err) {
    res = null;
  }
  return completeInputList(res, hasChannels, added);
}

/**
 * fetchInputDevices' list from the input service's reply `res` (null if
 * none). Live TV is also in it whenever `res` is null, as before 0.0.112:
 * without the TV's list we can't tell.
 */
export function completeInputList(
  res: LunaResponse | null,
  hasChannels: boolean,
  added: string[]
): InputDevice[] {
  const devices: InputDevice[] = res
    ? (((res && res.devices) || []).slice() as InputDevice[])
    : (FALLBACK_INPUTS.map(inputFromId) as InputDevice[]);
  function listed(id: string): boolean {
    return devices.some(function (d) {
      return d && (d.id === id || (isTvInputId(id) && isTvInputId(d.id)));
    });
  }
  function addMissing(id: string): void {
    const device = !listed(id) && inputFromId(id);
    if (device) devices.push(device);
  }
  const maxHdmi = Number(res && res.maxHdmiCount) || 0;
  for (let n = 1; n <= maxHdmi; n += 1) addMissing('HDMI_' + n);
  (added || []).forEach(addMissing);
  if (hasChannels || !res) addMissing('TV');
  // HDMI ports in port order, other inputs after them as the TV listed them.
  return devices.map(function (d, i) {
    const m = /^HDMI_(\d+)$/.exec((d && d.id) || '');
    return {d: d, key: m ? Number(m[1]) : 100 + i};
  }).sort(function (a, b) { return a.key - b.key; }).map(function (x) { return x.d; });
}
