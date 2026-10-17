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
import {t} from '@lib/i18n.js';

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
  const opts: StepperOption[] = [{value: '', label: t('system.volume.dontChange')}];
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
 * The System pane: the interface language, the Ember vs app-launch volume
 * levels, performance mode, the rooted Home button watcher and boot-on-start.
 */
export function createSystemPane(): PaneHandle {
  return {
    build: function (ctx: SettingsContext): void {
      const section = createSection(t('settings.category.system'));

      // The interface language. Automatic follows the TV (see lib/i18n.js);
      // Save restarts the app so every surface repaints in the new language.
      const languageSelect = createOptionStepper({
        focusIndex: 995,
        choices: [
          {value: 'auto', label: t('system.language.auto')},
          {value: 'en', label: t('system.language.en')},
          {value: 'nl', label: t('system.language.nl')}
        ],
        path: 'launcher.language',
        parse: function (raw) { return raw || 'auto'; },
        binder: ctx.binder
      });
      section.appendChild(labeledControl(t('system.language'), languageSelect));

      const volumeAtHomeValue = volumeLevelValue(ctx.rawConfig.launcher.volumeAtHome);
      const volumeAtHomeSelect = createOptionStepper({
        focusIndex: 993,
        choices: volumeLevelOptions(volumeAtHomeValue),
        path: 'launcher.volumeAtHome',
        parse: volumeLevelParse,
        binder: ctx.binder
      });
      section.appendChild(labeledControl(t('system.volumeAtHome', {brand: BRAND.name}), volumeAtHomeSelect));

      const volumeOnAppValue = volumeLevelValue(ctx.rawConfig.launcher.volumeOnAppLaunch);
      const volumeOnAppSelect = createOptionStepper({
        focusIndex: 994,
        choices: volumeLevelOptions(volumeOnAppValue),
        path: 'launcher.volumeOnAppLaunch',
        parse: volumeLevelParse,
        binder: ctx.binder
      });
      section.appendChild(labeledControl(t('system.volumeOnLaunch'), volumeOnAppSelect));

      section.appendChild(createHint(t('system.volumeHint', {brand: BRAND.name})));

      const perfModeField = createToggle({
        label: t('system.perfMode'),
        focusIndex: '1009',
        path: 'launcher.perfMode',
        binder: ctx.binder
      });
      section.appendChild(perfModeField.row);
      section.appendChild(createHint(t('system.perfModeHint')));

      // Off by default: when enabled, stock Home coming to the foreground
      // (Home button press after another app, or an app exiting to home)
      // relaunches Ember.
      const launchOnHomeField = createToggle({
        label: t('system.launchOnHome'),
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

      section.appendChild(createHint(t('system.launchOnHomeHint', {brand: BRAND.name})));

      const bootField = createToggle({
        label: t('system.bootOnStart'),
        focusIndex: '1011',
        path: 'launcher.bootOnStart',
        binder: ctx.binder
      });
      section.appendChild(bootField.row);

      section.appendChild(createHint(t('system.bootOnStartHint', {brand: BRAND.name})));

      ctx.panes.system.appendChild(section);
    }
  };
}
