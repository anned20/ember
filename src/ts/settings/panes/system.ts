import {
  createHint,
  createOptionStepper,
  createSection,
  createToggle,
  labeledControl
} from '@settings/components/index.js';
import type {StepperOption} from '@settings/components/index.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import {BRAND} from '@lib/brand.js';

// TV system volume levels (0–100), separate from ambient music slider.
// '' = "Don't change": leave whatever the remote set (stored as null).
function volumeLevelValue(level: number | null): string {
  return typeof level === 'number' ? String(level) : '';
}

function volumeLevelParse(raw: string): number | null {
  const level = parseInt(raw, 10);
  return isNaN(level) ? null : level;
}

function volumeLevelOptions(selected: string): StepperOption[] {
  const opts: StepperOption[] = [{value: '', label: 'Don’t change'}];
  for (let v = 0; v <= 30; v += 1) {
    opts.push({value: String(v), label: String(v)});
  }
  // Also offer a few higher steps for loud setups.
  [35, 40, 45, 50, 60, 70, 80, 90, 100].forEach(function (v) {
    opts.push({value: String(v), label: String(v)});
  });
  if (!opts.some(function (o) { return o.value === selected; })) {
    opts.splice(1, 0, {value: selected, label: selected});
  }
  return opts;
}

/**
 * The System pane: the Launch Home vs app-launch volume levels, performance
 * mode, the rooted Home button watcher and boot-on-start.
 */
export function createSystemPane(): PaneHandle {
  return {
    build: function (ctx: SettingsContext): void {
      const section = createSection('System');

      const volumeAtHomeValue = volumeLevelValue(ctx.rawConfig.launcher.volumeAtHome);
      const volumeAtHomeSelect = createOptionStepper({
        focusIndex: 993,
        choices: volumeLevelOptions(volumeAtHomeValue),
        path: 'launcher.volumeAtHome',
        parse: volumeLevelParse,
        binder: ctx.binder
      });
      section.appendChild(labeledControl('Volume in ' + BRAND.name, volumeAtHomeSelect));

      const volumeOnAppValue = volumeLevelValue(ctx.rawConfig.launcher.volumeOnAppLaunch);
      const volumeOnAppSelect = createOptionStepper({
        focusIndex: 994,
        choices: volumeLevelOptions(volumeOnAppValue),
        path: 'launcher.volumeOnAppLaunch',
        parse: volumeLevelParse,
        binder: ctx.binder
      });
      section.appendChild(labeledControl('Volume when apps launch', volumeOnAppSelect));

      section.appendChild(createHint(
        'TV system volume (0–100). “Don’t change” keeps whatever you set with the remote. Otherwise ' + BRAND.name + ' switches to the first level when you return home, and the second when Netflix / HDMI / other apps launch.'
      ));

      const perfModeField = createToggle({
        label: 'Performance mode (low-spec TVs)',
        focusIndex: '1009',
        path: 'launcher.perfMode',
        binder: ctx.binder
      });
      section.appendChild(perfModeField.row);
      section.appendChild(createHint(
        'Turns off the frosted glass and uses 1920px wallpapers. ' +
        'With Slow zoom on (Look), the glass is already off while the wallpaper moves.'
      ));

      // Off by default: when enabled, stock Home coming to the foreground
      // (Home button press after another app, or an app exiting to home)
      // relaunches Launch Home.
      const launchOnHomeField = createToggle({
        label: 'Launch on Home button',
        focusIndex: '1010',
        checked: !!(ctx.rawConfig.launcher.launchOnHome || ctx.rawConfig.launcher.returnOnAppExit),
        path: 'launcher.launchOnHome',
        readBack: false,
        binder: ctx.binder
      });
      section.appendChild(launchOnHomeField.row);
      // The legacy key stays in sync so older builds / USB config still work.
      ctx.binder.hook(function (cfg) {
        cfg.launcher.returnOnAppExit = cfg.launcher.launchOnHome;
      });

      section.appendChild(createHint(
        'When enabled, a root service opens ' + BRAND.name + ' whenever stock Home appears. A brief flash of the LG home screen is normal (the TV opens Home first; we cannot block the key without a separate input-hook app). Requires rooted TV + Homebrew Channel. Toggle off/on and Save after updates if it stops working.'
      ));

      const bootField = createToggle({
        label: 'Boot on TV start',
        focusIndex: '1011',
        path: 'launcher.bootOnStart',
        binder: ctx.binder
      });
      section.appendChild(bootField.row);

      section.appendChild(createHint(
        'When enabled, a root init.d script launches ' + BRAND.name + ' after the TV powers on. Requires rooted TV + Homebrew Channel (same as Home button). A short delay on boot is normal while webOS starts. With Quick Start+ on, the TV only wakes from standby and this doesn’t run; turn it off under General → Devices → TV Management.'
      ));

      ctx.panes.system.appendChild(section);
    }
  };
}
