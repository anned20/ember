import {coerceScreensaverMinutes} from '@config/config.js';
import {
  createHint,
  createMiniButton,
  createOptionStepper,
  createSection,
  createToggle,
  labeledControl
} from '@settings/components/index.js';
import {stepperField} from '@settings/settings-binding.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';

/**
 * The Screensaver pane: the in-app photo slideshow (on/off, idle delay, slide
 * interval, clock and date) and the rooted LG system screensaver timeout.
 */
export function createScreensaverPane(): PaneHandle {
  return {
    build: function (ctx: SettingsContext): void {
      const section = createSection('Screensaver');

      const customSsField = createToggle({
        label: 'Launch Home screensaver',
        focusIndex: '990',
        path: 'launcher.customScreensaver'
      });
      ctx.binder.bind(customSsField.field!);
      section.appendChild(customSsField.row);

      const customSsIdle = createOptionStepper({
        focusIndex: 991,
        choices: [
          {value: '2', label: '2 minutes'},
          {value: '5', label: '5 minutes'},
          {value: '10', label: '10 minutes'},
          {value: '15', label: '15 minutes'},
          {value: '20', label: '20 minutes'},
          {value: '30', label: '30 minutes'},
          {value: '45', label: '45 minutes'},
          {value: '60', label: '60 minutes'}
        ]
      });
      ctx.binder.bind(stepperField(customSsIdle, 'launcher.customScreensaverMinutes', {
        parse: function (raw) {
          const n = parseInt(raw, 10);
          return isNaN(n) || n < 1 ? 5 : n;
        }
      }));
      section.appendChild(labeledControl('Start after (idle)', customSsIdle));

      const customSsSlide = createOptionStepper({
        focusIndex: 992,
        choices: [
          {value: '12', label: '12 seconds'},
          {value: '20', label: '20 seconds'},
          {value: '30', label: '30 seconds'},
          {value: '45', label: '45 seconds'},
          {value: '60', label: '1 minute'},
          {value: '120', label: '2 minutes'}
        ]
      });
      ctx.binder.bind(stepperField(customSsSlide, 'launcher.customScreensaverSlideSec', {
        parse: function (raw) {
          const n = parseInt(raw, 10);
          return isNaN(n) || n < 8 ? 20 : n;
        }
      }));
      section.appendChild(labeledControl('Photo change every', customSsSlide));

      const customSsClockField = createToggle({
        label: 'Screensaver clock',
        focusIndex: '993',
        path: 'launcher.customScreensaverShowClock'
      });
      ctx.binder.bind(customSsClockField.field!);
      section.appendChild(customSsClockField.row);

      const customSsDateField = createToggle({
        label: 'Screensaver date',
        focusIndex: '994',
        path: 'launcher.customScreensaverShowDate'
      });
      ctx.binder.bind(customSsDateField.field!);
      section.appendChild(customSsDateField.row);

      section.appendChild(createHint(
        'Full-screen photo slideshow from your Launch Home wallpapers while this app is open. Any remote button wakes. Uses Ken Burns motion for OLED care.'
      ));

      // Preview over the open panel. Closing Settings first threw away any
      // unsaved changes; the saver sits above it and hands focus back here.
      section.appendChild(createMiniButton({
        label: 'Preview screensaver now',
        focusIndex: '996',
        className: 'settings-preview-ss-btn',
        onClick: function () {
          if (ctx.options.onPreviewScreensaver) {
            ctx.options.onPreviewScreensaver();
          } else if (ctx.options.onToast) {
            ctx.options.onToast('Save & reopen Launch Home to preview');
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
          {value: '0', label: 'Off (never)'},
          {value: '3', label: '3 minutes'},
          {value: '10', label: '10 minutes'},
          {value: '20', label: '20 minutes'},
          {value: '30', label: '30 minutes'}
        ],
        value: String(ssMins)
      });
      // The TV enum is coerced, and the value is raised past the in-app saver.
      ctx.binder.add(stepperField(screensaverSelect, 'launcher.screensaverMinutes', {
        parse: function (raw) { return parseInt(raw, 10); }
      }));
      ctx.binder.hook(function (cfg) {
        cfg.launcher.screensaverMinutes = coerceScreensaverMinutes(cfg.launcher.screensaverMinutes);
        // Keep system saver from firing before the in-app one.
        if (cfg.launcher.customScreensaver &&
            cfg.launcher.screensaverMinutes > 0 &&
            cfg.launcher.screensaverMinutes < 30) {
          cfg.launcher.screensaverMinutes = 30;
        }
      });
      section.appendChild(labeledControl('TV system screensaver', screensaverSelect));

      section.appendChild(createHint(
        'LG system gallery timeout (3/10/20/30 min only). When Launch Home screensaver is on, leave this at 30 so the TV does not interrupt first. Requires rooted TV.'
      ));

      ctx.panes.screensaver.appendChild(section);
    }
  };
}
