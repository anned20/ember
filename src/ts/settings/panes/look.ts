import {setIconSrc} from '@apps/app-catalog.js';
import {TIMEZONE_OPTIONS} from '@config/config.js';
import {PROFILE_OPTIONS} from '@config/profiles.js';
import {
  labeledControl,
  createHint,
  createSection,
  createToggle,
  createOptionStepper
} from '@settings/components/index.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import {BRAND} from '@lib/brand.js';
import {t} from '@lib/i18n.js';

/**
 * The Background pane, as the Look pane uses it: mounted between the Profile
 * and Glass sections, and driven when the active profile changes. The root
 * injects the handle, so neither pane module imports the other.
 */
interface LookBackgroundHandle extends PaneHandle {
  /** Update the "this profile uses its own background" note. */
  setProfile(profileId: string): void;
}

/** What the root hands the Look pane: the Background pane to compose. */
export interface LookPaneOptions {
  /** The Background pane, mounted between Profile and Glass; may be absent. */
  background?: LookBackgroundHandle;
}

/**
 * The Look pane: the active Profile picker, the Background section (mounted
 * from its own handle), the Glass tint/outline/highlight pickers and the
 * Clock & icons section, in that order.
 */
export function createLookPane(options: LookPaneOptions = {}): PaneHandle {
  return {
    build: function (ctx: SettingsContext): void {
      const profileSection = createSection(t('look.section.profile'));

      // The profile names and the timezone entries live in the config modules as
      // dictionary keys, so their stored values stay untouched.
      const profileSelect = createOptionStepper({
        focusIndex: 901,
        choices: PROFILE_OPTIONS.map(function (entry) {
          return {value: entry.id, label: t(entry.labelKey)};
        }),
        path: 'profile',
        binder: ctx.binder,
        onChange: function (value) {
          if (options.background) options.background.setProfile(value);
        }
      });
      profileSection.appendChild(labeledControl(t('look.profile.active'), profileSelect));

      profileSection.appendChild(createHint(t('look.profile.hint')));
      ctx.panes.look.appendChild(profileSection);

      // The Background section sits between Profile and Glass; its own pane
      // draws it, and the root still drives its asynchronous fill.
      if (options.background) options.background.build(ctx);

      // ── Glass: the see-through tiles and buttons on the home screen ──────
      const glassSection = createSection(t('look.section.glass'));
      glassSection.appendChild(createHint(t('look.glass.hint')));

      // A sample over the current wallpaper: a tile, the tile the remote is on,
      // the current input and another input, in the choices below (before Save).
      const glassPreview = document.createElement('div');
      glassPreview.className = 'glass-preview';
      const wallpaperLayer = document.getElementById('background-layer');
      const wallpaperImage = wallpaperLayer ? getComputedStyle(wallpaperLayer).backgroundImage : '';
      if (wallpaperImage && wallpaperImage !== 'none') glassPreview.style.backgroundImage = wallpaperImage;
      function previewTile(title: string, icon: string, selected: boolean): HTMLDivElement {
        const tile = document.createElement('div');
        // Not .focused: the focus manager clears that class from everything.
        tile.className = 'app-tile' + (selected ? ' is-preview-focus' : '');
        const img = document.createElement('img');
        img.className = 'app-icon';
        img.alt = '';
        setIconSrc(img, icon, undefined);
        const label = document.createElement('span');
        label.className = 'app-label';
        label.textContent = title;
        tile.appendChild(img);
        tile.appendChild(label);
        return tile;
      }
      function previewChip(text: string, current: boolean): HTMLDivElement {
        const chip = document.createElement('div');
        chip.className = 'input-chip' + (current ? ' active' : '');
        chip.textContent = text;
        return chip;
      }
      const previewInputs = document.createElement('div');
      previewInputs.className = 'glass-preview-inputs';
      previewInputs.appendChild(previewChip(t('look.glass.preview.currentInput'), true));
      previewInputs.appendChild(previewChip(t('look.glass.preview.otherInput'), false));
      glassPreview.appendChild(previewTile(t('look.glass.preview.tile'), 'assets/app-icons/netflix.png', false));
      glassPreview.appendChild(previewTile(t('look.glass.preview.selected'), 'assets/app-icons/youtube.png', true));
      glassPreview.appendChild(previewInputs);
      glassSection.appendChild(glassPreview);

      const tileStyleSelect = createOptionStepper({
        focusIndex: 1096,
        choices: [
          {value: 'glass', label: t('look.glass.style.glass')},
          {value: 'plain', label: t('look.glass.style.plain')}
        ],
        path: 'launcher.tileStyle',
        parse: function (raw) { return raw === 'plain' ? 'plain' : 'glass'; },
        binder: ctx.binder,
        onChange: paintGlassPreview
      });
      glassSection.appendChild(labeledControl(t('look.glass.style'), tileStyleSelect));
      glassSection.appendChild(createHint(t('look.glass.styleHint')));

      function paintGlassPreview(): void {
        const tint = glassSelect.value;
        const border = glassBorderSelect.value;
        const highlight = focusColourSelect.value;
        glassPreview.className = 'glass-preview' +
          (tileStyleSelect.value === 'plain' ? ' tiles-plain' : '') +
          (tint && tint !== 'light' ? ' glass-' + tint : '') +
          (border && border !== 'white' ? ' glass-border-' + border : '') +
          (highlight && highlight !== 'warm' ? ' focus-' + highlight : '');
      }

      const glassSelect = createOptionStepper({
        focusIndex: 1091,
        choices: [
          {value: 'light', label: t('look.glass.tint.light')},
          {value: 'dark', label: t('look.colour.dark')},
          {value: 'black', label: t('look.colour.black')},
          {value: 'blue', label: t('look.colour.blue')},
          {value: 'purple', label: t('look.colour.purple')},
          {value: 'green', label: t('look.colour.green')},
          {value: 'warm', label: t('look.colour.warm')}
        ],
        path: 'launcher.glassTint',
        parse: function (raw) { return raw || 'light'; },
        binder: ctx.binder,
        onChange: paintGlassPreview
      });
      glassSection.appendChild(labeledControl(t('look.glass.tint'), glassSelect));
      glassSection.appendChild(createHint(t('look.glass.tintHint')));

      const glassBorderSelect = createOptionStepper({
        focusIndex: 1092,
        choices: [
          {value: 'white', label: t('look.glass.border.white')},
          {value: 'glass', label: t('look.glass.border.sameAsTint')},
          {value: 'none', label: t('look.glass.border.none')},
          {value: 'black', label: t('look.colour.black')},
          {value: 'blue', label: t('look.colour.blue')},
          {value: 'purple', label: t('look.colour.purple')},
          {value: 'green', label: t('look.colour.green')},
          {value: 'warm', label: t('look.colour.warm')},
          {value: 'gold', label: t('look.colour.gold')}
        ],
        path: 'launcher.glassBorder',
        parse: function (raw) { return raw || 'white'; },
        binder: ctx.binder,
        onChange: paintGlassPreview
      });
      glassSection.appendChild(labeledControl(t('look.glass.border'), glassBorderSelect));
      glassSection.appendChild(createHint(t('look.glass.borderHint')));

      const focusColourSelect = createOptionStepper({
        focusIndex: 1093,
        choices: [
          {value: 'warm', label: t('look.glass.focus.warm')},
          {value: 'white', label: t('look.colour.white')},
          {value: 'border', label: t('look.glass.focus.sameAsBorder')},
          {value: 'blue', label: t('look.colour.blue')},
          {value: 'purple', label: t('look.colour.purple')},
          {value: 'green', label: t('look.colour.green')},
          {value: 'gold', label: t('look.colour.gold')}
        ],
        path: 'launcher.focusColour',
        parse: function (raw) { return raw || 'warm'; },
        binder: ctx.binder,
        onChange: paintGlassPreview
      });
      glassSection.appendChild(labeledControl(t('look.glass.focus'), focusColourSelect));
      glassSection.appendChild(createHint(t('look.glass.focusHint')));
      paintGlassPreview();
      ctx.panes.look.appendChild(glassSection);

      const clockSection = createSection(t('look.section.clockIcons'));

      const showClockField = createToggle({
        label: t('look.clock.show'),
        focusIndex: '1000',
        path: 'launcher.showClock',
        binder: ctx.binder
      });
      clockSection.appendChild(showClockField.row);

      const clockFormatSelect = createOptionStepper({
        focusIndex: 1090,
        choices: [
          {value: '24', label: t('look.clock.format.24')},
          {value: '12', label: t('look.clock.format.12')}
        ],
        path: 'launcher.clockFormat',
        parse: function (raw) { return raw === '12' ? '12' : '24'; },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.clock.format'), clockFormatSelect));

      const showDateField = createToggle({
        label: t('look.clock.showDate'),
        focusIndex: '1001',
        path: 'launcher.showDate',
        binder: ctx.binder
      });
      clockSection.appendChild(showDateField.row);

      const clockAlignSelect = createOptionStepper({
        focusIndex: 1002,
        choices: [
          {value: 'left', label: t('look.clock.position.left')},
          {value: 'center', label: t('look.clock.position.center')},
          {value: 'center-middle', label: t('look.clock.position.centerMiddle')},
          {value: 'right', label: t('look.clock.position.right')}
        ],
        path: 'launcher.clockAlign',
        // Normalise unknown legacy values to centre top.
        parse: function (raw) {
          return ['left', 'center', 'center-middle', 'right'].indexOf(raw) < 0 ? 'center' : raw;
        },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.clock.position'), clockAlignSelect));

      const clockSizeSelect = createOptionStepper({
        focusIndex: 1003,
        choices: [
          {value: 'small', label: t('look.size.small')},
          {value: 'medium', label: t('look.size.medium')},
          {value: 'large', label: t('look.size.large')},
          {value: 'x-large', label: t('look.size.xLarge')},
          {value: 'xx-large', label: t('look.size.xxLarge')}
        ],
        path: 'launcher.clockSize',
        parse: function (raw) { return raw || 'large'; },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.clock.size'), clockSizeSelect));

      const clockShadowSelect = createOptionStepper({
        focusIndex: 1094,
        choices: [
          {value: 'off', label: t('look.shadow.off')},
          {value: 'soft', label: t('look.shadow.soft')},
          {value: 'strong', label: t('look.shadow.strong')}
        ],
        path: 'launcher.clockShadow',
        // Normalise unknown legacy values to the default.
        parse: function (raw) {
          return ['off', 'soft', 'strong'].indexOf(raw) < 0 ? 'strong' : raw;
        },
        format: function (value) {
          const shadow = String(value);
          return ['off', 'soft', 'strong'].indexOf(shadow) < 0 ? 'strong' : shadow;
        },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.clock.shadow'), clockShadowSelect));

      const timezoneSelect = createOptionStepper({
        focusIndex: 1004,
        choices: TIMEZONE_OPTIONS.map(function (option) {
          return {value: option.value, label: t(option.labelKey)};
        }),
        path: 'launcher.timezone',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.clock.timezone'), timezoneSelect));

      const iconSizeSelect = createOptionStepper({
        focusIndex: 1005,
        choices: [
          {value: 'small', label: t('look.size.small')},
          {value: 'medium', label: t('look.size.medium')},
          {value: 'large', label: t('look.size.large')}
        ],
        path: 'launcher.iconSize',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.icon.size'), iconSizeSelect));

      const iconAlignSelect = createOptionStepper({
        focusIndex: 1006,
        choices: [
          {value: 'left', label: t('look.align.left')},
          {value: 'center', label: t('look.align.center')},
          {value: 'right', label: t('look.align.right')}
        ],
        path: 'launcher.iconAlign',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.icon.align'), iconAlignSelect));

      const iconLayoutSelect = createOptionStepper({
        focusIndex: 1007,
        choices: [
          {value: 'scroll', label: t('look.icon.layout.scroll')},
          {value: 'wrap', label: t('look.icon.layout.wrap')}
        ],
        path: 'launcher.iconLayout',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.icon.layout'), iconLayoutSelect));

      const iconsPerRowSelect = createOptionStepper({
        focusIndex: 1008,
        choices: [
          {value: '4', label: '4'}, {value: '5', label: '5'}, {value: '6', label: '6'},
          {value: '7', label: '7'}, {value: '8', label: '8'}, {value: '9', label: '9'},
          {value: '10', label: '10'}, {value: '11', label: '11'}, {value: '12', label: '12'}
        ],
        path: 'launcher.iconsPerRow',
        parse: function (raw) { return parseInt(raw, 10) || 7; },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl(t('look.icon.perRow'), iconsPerRowSelect));

      const bundledIconsField = createToggle({
        label: t('look.icon.bundled', {brand: BRAND.name}),
        focusIndex: '1008',
        path: 'launcher.bundledIcons',
        binder: ctx.binder
      });
      clockSection.appendChild(bundledIconsField.row);

      clockSection.appendChild(createHint(t('look.icon.bundledHint', {brand: BRAND.name})));
      ctx.panes.look.appendChild(clockSection);
    }
  };
}
