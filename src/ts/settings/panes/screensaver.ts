import {coerceScreensaverMinutes} from '@config/config.js';
import {
  createHint,
  createMiniButton,
  createOptionStepper,
  createSection,
  createToggle,
  labeledControl
} from '@settings/components/index.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import {BRAND} from '@lib/brand.js';
import {t, tn} from '@lib/i18n.js';

/**
 * The Screensaver pane: the in-app photo slideshow (on/off, idle delay, slide
 * interval, home info block) and the rooted LG system screensaver timeout.
 */
export function createScreensaverPane(): PaneHandle {
  return {
    build: function (ctx: SettingsContext): void {
      const section = createSection(t('screensaver.section'));

      const customSsField = createToggle({
        label: t('screensaver.custom', {brand: BRAND.name}),
        focusIndex: '990',
        path: 'launcher.customScreensaver',
        binder: ctx.binder
      });
      section.appendChild(customSsField.row);

      const customSsIdle = createOptionStepper({
        focusIndex: 991,
        choices: [
          {value: '2', label: tn('screensaver.minutes', 2)},
          {value: '5', label: tn('screensaver.minutes', 5)},
          {value: '10', label: tn('screensaver.minutes', 10)},
          {value: '15', label: tn('screensaver.minutes', 15)},
          {value: '20', label: tn('screensaver.minutes', 20)},
          {value: '30', label: tn('screensaver.minutes', 30)},
          {value: '45', label: tn('screensaver.minutes', 45)},
          {value: '60', label: tn('screensaver.minutes', 60)}
        ],
        path: 'launcher.customScreensaverMinutes',
        parse: function (raw) {
          const n = parseInt(raw, 10);
          return isNaN(n) || n < 1 ? 5 : n;
        },
        binder: ctx.binder
      });
      section.appendChild(labeledControl(t('screensaver.startAfter'), customSsIdle));

      const customSsSlide = createOptionStepper({
        focusIndex: 992,
        choices: [
          {value: '12', label: tn('screensaver.seconds', 12)},
          {value: '20', label: tn('screensaver.seconds', 20)},
          {value: '30', label: tn('screensaver.seconds', 30)},
          {value: '45', label: tn('screensaver.seconds', 45)},
          {value: '60', label: tn('screensaver.minutes', 1)},
          {value: '120', label: tn('screensaver.minutes', 2)}
        ],
        path: 'launcher.customScreensaverSlideSec',
        parse: function (raw) {
          const n = parseInt(raw, 10);
          return isNaN(n) || n < 8 ? 20 : n;
        },
        binder: ctx.binder
      });
      section.appendChild(labeledControl(t('screensaver.slideEvery'), customSsSlide));

      const customSsInfoField = createToggle({
        label: t('screensaver.info'),
        focusIndex: '993',
        path: 'launcher.customScreensaverInfo',
        binder: ctx.binder
      });
      section.appendChild(customSsInfoField.row);
      section.appendChild(createHint(t('screensaver.infoHint')));

      section.appendChild(createHint(t('screensaver.hint', {brand: BRAND.name})));

      // Preview over the open panel. Closing Settings first threw away any
      // unsaved changes; the saver sits above it and hands focus back here.
      section.appendChild(createMiniButton({
        label: t('screensaver.preview'),
        focusIndex: '996',
        className: 'settings-preview-ss-btn',
        onClick: function () {
          if (ctx.options.onPreviewScreensaver) {
            ctx.options.onPreviewScreensaver();
          } else if (ctx.options.onToast) {
            ctx.options.onToast(t('screensaver.previewToast', {brand: BRAND.name}));
          }
        }
      }));

      // System LG gallery saver (rooted write). Pushed to 30 min when custom is on.
      const ssMins = coerceScreensaverMinutes(
        typeof ctx.rawConfig.launcher.screensaverMinutes === 'number'
          ? ctx.rawConfig.launcher.screensaverMinutes
          : 30
      );
      const screensaverSelect = createOptionStepper({
        focusIndex: 995,
        choices: [
          {value: '0', label: t('screensaver.off')},
          {value: '3', label: tn('screensaver.minutes', 3)},
          {value: '10', label: tn('screensaver.minutes', 10)},
          {value: '20', label: tn('screensaver.minutes', 20)},
          {value: '30', label: tn('screensaver.minutes', 30)}
        ],
        value: String(ssMins),
        path: 'launcher.screensaverMinutes',
        parse: function (raw) { return parseInt(raw, 10); },
        // The TV enum is coerced, and the value is raised past the in-app saver.
        readBack: false,
        binder: ctx.binder
      });
      ctx.binder.hook(function (cfg) {
        cfg.launcher.screensaverMinutes = coerceScreensaverMinutes(cfg.launcher.screensaverMinutes);
        // Keep system saver from firing before the in-app one.
        if (cfg.launcher.customScreensaver &&
            cfg.launcher.screensaverMinutes > 0 &&
            cfg.launcher.screensaverMinutes < 30) {
          cfg.launcher.screensaverMinutes = 30;
        }
      });
      section.appendChild(labeledControl(t('screensaver.tv'), screensaverSelect));

      section.appendChild(createHint(t('screensaver.tvHint', {brand: BRAND.name})));

      ctx.panes.screensaver.appendChild(section);
    }
  };
}
