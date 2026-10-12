import {fetchInputDevices, inputFromId, isTvInputId} from '@home/inputs.js';
import {
  createHint,
  createMiniButton,
  createOptionStepper,
  createSection,
  labeledControl
} from '@settings/components/index.js';
import {stepperField} from '@settings/settings-binding.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import type {Config} from '@lib/types.js';

const DEFAULT_INPUTS = ['HDMI_1', 'HDMI_2', 'HDMI_3', 'TV'];
// How long the TV's input list may take to arrive before it is abandoned.
const INPUTS_LOAD_MS = 6000;

/** A TV input as listed by inputs.js. */
interface InputDevice {
  id: string;
  label?: string;
  appId?: string;
}

/** One tick / label row in the inputs grid. */
function inputRow(
  device: InputDevice,
  index: number,
  checked: boolean,
  label: string | undefined,
  added: boolean
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'settings-input-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'focusable';
  checkbox.dataset.focusIndex = String(1100 + index * 2);
  checkbox.dataset.inputId = device.id;
  if (added) checkbox.dataset.added = '1';
  checkbox.checked = checked;

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'settings-text focusable';
  labelInput.dataset.focusIndex = String(1101 + index * 2);
  labelInput.dataset.inputId = device.id;
  labelInput.placeholder = device.label || device.id.replace(/_/g, ' ');
  labelInput.value = label || '';

  const name = document.createElement('span');
  name.className = 'settings-input-name';
  name.textContent = device.label || device.id;

  row.appendChild(checkbox);
  row.appendChild(name);
  row.appendChild(labelInput);
  return row;
}

// Inputs the TV didn't list that can be added by hand: HDMI ports up to 4
// (or the highest it listed) and Live TV.
function addableInputs(devices: InputDevice[]): InputDevice[] {
  const listed: Record<string, boolean> = {};
  let maxHdmi = 4;
  devices.forEach(function (d) {
    listed[d.id] = true;
    const m = /^HDMI_(\d+)$/.exec(d.id || '');
    if (m) maxHdmi = Math.max(maxHdmi, Number(m[1]));
  });
  const out: InputDevice[] = [];
  for (let n = 1; n <= maxHdmi; n += 1) {
    if (!listed['HDMI_' + n]) out.push(inputFromId('HDMI_' + n) as InputDevice);
  }
  if (!devices.some(function (d) { return isTvInputId(d.id); })) {
    out.push(inputFromId('TV') as InputDevice);
  }
  return out;
}

// The inputs grid (tick / label / added) is rebuilt from the device list, and
// hand-added inputs join it in place. The grid still reads and writes the same
// config surface on Save.
async function fillInputs(container: HTMLElement, ctx: SettingsContext): Promise<void> {
  const config = ctx.rawConfig;
  const added: string[] = config.launcher.addedInputs || [];
  const devices: InputDevice[] = await fetchInputDevices(
    !!(ctx.options.hasTvChannels && ctx.options.hasTvChannels()), added);
  const allowed = config.launcher.inputs || DEFAULT_INPUTS.slice();
  const labels = config.launcher.inputLabels || {};

  devices.forEach(function (device, index) {
    container.appendChild(inputRow(device, index, allowed.indexOf(device.id) >= 0,
      labels[device.id], added.indexOf(device.id) >= 0));
  });

  // Some TVs list fewer HDMI ports to an app than they have, and without root
  // (Homebrew Channel) Live TV may not be offered: add one by hand.
  const addable = addableInputs(devices);
  if (!addable.length) return;
  const addRow = document.createElement('div');
  addRow.className = 'settings-input-add';
  const addName = document.createElement('span');
  addName.className = 'settings-input-name';
  addName.textContent = 'Add an input';
  addRow.appendChild(addName);
  addable.forEach(function (device, i) {
    const btn = createMiniButton({
      label: '+ ' + device.label,
      focusIndex: 1190 + i,
      onClick: function () {
        const rows = container.querySelectorAll('.settings-input-row').length;
        const row = inputRow(device, rows, true, '', true);
        container.insertBefore(row, addRow);
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        if (!addRow.querySelector('button') && addRow.parentNode) {
          addRow.parentNode.removeChild(addRow);
        }
        // The pressed button is gone: go to the new input's tick.
        ctx.focusNow(row.querySelector('input[type=checkbox]'));
      }
    });
    addRow.appendChild(btn);
  });
  container.appendChild(addRow);
}

// Collect the grid back into the config on Save. Empty array is intentional
// ("show no inputs") — do not fall back to defaults.
function saveInputs(container: HTMLElement, config: Config): void {
  const allowed: string[] = [];
  const labels: Record<string, string> = {};
  const added: string[] = [];

  container.querySelectorAll('.settings-input-row').forEach(function (row) {
    const checkbox = row.querySelector('input[type=checkbox]') as HTMLInputElement | null;
    const labelInput = row.querySelector('input[type=text]') as HTMLInputElement | null;
    if (!checkbox || !labelInput) return;
    const inputId = checkbox.dataset.inputId || '';

    if (checkbox.checked) allowed.push(inputId);
    // An added input stays listed while ticked; untick it to take it away.
    if (checkbox.checked && checkbox.dataset.added === '1') added.push(inputId);
    if (labelInput.value.trim()) labels[inputId] = labelInput.value.trim();
  });

  config.launcher.inputs = allowed;
  config.launcher.inputLabels = labels;
  config.launcher.addedInputs = added;
}

/** The Inputs & channels pane: the tick/label grid plus the channels chip. */
export function createInputsPane(): PaneHandle {
  let listEl: HTMLElement | null = null;

  return {
    build: function (ctx: SettingsContext): void {
      const section = createSection('Inputs');
      section.appendChild(createHint('Choose which inputs appear and set custom labels. Uncheck all to hide the input row entirely. One missing? Add it at the end of the list.'));

      const list = document.createElement('div');
      list.className = 'settings-inputs';
      section.appendChild(list);
      listEl = list;

      // Channels chip on the home screen (channels.js): LG's favourite channels
      // (every channel if there are none), all channels, or none.
      const channelsSelect = createOptionStepper({
        focusIndex: 1095,
        choices: [
          {value: 'favourites', label: 'Favourites (or all)'},
          {value: 'all', label: 'All channels'},
          {value: 'off', label: 'Off'}
        ]
      });
      ctx.binder.bind(stepperField(channelsSelect, 'launcher.channels'));
      section.appendChild(labeledControl('TV channels', channelsSelect));
      section.appendChild(createHint(
        'Adds a Channels button after the inputs when the TV has Live TV ' +
        'channels tuned: pick one to watch it, or see what\u2019s on now.'
      ));

      // The inputs grid (tick / label / added) is built from the device list.
      ctx.binder.hook(function (cfg) {
        saveInputs(list, cfg);
      });
      ctx.panes.inputs.appendChild(section);
    },

    load: async function (ctx: SettingsContext): Promise<void> {
      if (!listEl) return;
      await ctx.withDeadline(fillInputs(listEl, ctx), INPUTS_LOAD_MS);
    }
  };
}
