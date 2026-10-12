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
      const profileSection = createSection('Profile');

      const profileSelect = createOptionStepper({
        focusIndex: 901,
        choices: PROFILE_OPTIONS.map(function (entry) {
          return {value: entry.id, label: entry.label};
        }),
        path: 'profile',
        binder: ctx.binder,
        onChange: function (value) {
          if (options.background) options.background.setProfile(value);
        }
      });
      profileSection.appendChild(labeledControl('Active profile', profileSelect));

      profileSection.appendChild(createHint(
        'Night lowers ambient volume and darkens the scrim. Cinema disables music and uses a dark gradient.'
      ));
      ctx.panes.look.appendChild(profileSection);

      // The Background section sits between Profile and Glass; its own pane
      // draws it, and the root still drives its asynchronous fill.
      if (options.background) options.background.build(ctx);

      // ── Glass: the see-through tiles and buttons on the home screen ──────
      const glassSection = createSection('Glass');
      glassSection.appendChild(createHint('How the see-through app tiles, input buttons and Settings button ' +
        'look over your wallpaper. The preview shows your choices; press Save to keep them.'));

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
      previewInputs.appendChild(previewChip('Current input', true));
      previewInputs.appendChild(previewChip('Other input', false));
      glassPreview.appendChild(previewTile('A tile', 'assets/app-icons/netflix.png', false));
      glassPreview.appendChild(previewTile('Selected', 'assets/app-icons/youtube.png', true));
      glassPreview.appendChild(previewInputs);
      glassSection.appendChild(glassPreview);

      function paintGlassPreview(): void {
        const tint = glassSelect.value;
        const border = glassBorderSelect.value;
        const highlight = focusColourSelect.value;
        glassPreview.className = 'glass-preview' +
          (tint && tint !== 'light' ? ' glass-' + tint : '') +
          (border && border !== 'white' ? ' glass-border-' + border : '') +
          (highlight && highlight !== 'warm' ? ' focus-' + highlight : '');
      }

      const glassSelect = createOptionStepper({
        focusIndex: 1091,
        choices: [
          {value: 'light', label: 'Light (original)'},
          {value: 'dark', label: 'Dark'},
          {value: 'black', label: 'Black'},
          {value: 'blue', label: 'Blue'},
          {value: 'purple', label: 'Purple'},
          {value: 'green', label: 'Green'},
          {value: 'warm', label: 'Warm'}
        ],
        path: 'launcher.glassTint',
        parse: function (raw) { return raw || 'light'; },
        binder: ctx.binder,
        onChange: paintGlassPreview
      });
      glassSection.appendChild(labeledControl('Tile colour', glassSelect));
      glassSection.appendChild(createHint('Inside the app tiles, input buttons and Settings button. ' +
        'Dark or Black suit dark wallpapers.'));

      const glassBorderSelect = createOptionStepper({
        focusIndex: 1092,
        choices: [
          {value: 'white', label: 'White (original)'},
          {value: 'glass', label: 'Same as tile colour'},
          {value: 'none', label: 'None'},
          {value: 'black', label: 'Black'},
          {value: 'blue', label: 'Blue'},
          {value: 'purple', label: 'Purple'},
          {value: 'green', label: 'Green'},
          {value: 'warm', label: 'Warm'},
          {value: 'gold', label: 'Gold'}
        ],
        path: 'launcher.glassBorder',
        parse: function (raw) { return raw || 'white'; },
        binder: ctx.binder,
        onChange: paintGlassPreview
      });
      glassSection.appendChild(labeledControl('Tile outline', glassBorderSelect));
      glassSection.appendChild(createHint('The thin line around each tile and button.'));

      const focusColourSelect = createOptionStepper({
        focusIndex: 1093,
        choices: [
          {value: 'warm', label: 'Warm (original)'},
          {value: 'white', label: 'White'},
          {value: 'border', label: 'Same as tile outline'},
          {value: 'blue', label: 'Blue'},
          {value: 'purple', label: 'Purple'},
          {value: 'green', label: 'Green'},
          {value: 'gold', label: 'Gold'}
        ],
        path: 'launcher.focusColour',
        parse: function (raw) { return raw || 'warm'; },
        binder: ctx.binder,
        onChange: paintGlassPreview
      });
      glassSection.appendChild(labeledControl('Selection highlight', focusColourSelect));
      glassSection.appendChild(createHint('The glow around the tile or button the remote is on, ' +
        'and the colour of the current input.'));
      paintGlassPreview();
      ctx.panes.look.appendChild(glassSection);

      const clockSection = createSection('Clock & icons');

      const showClockField = createToggle({
        label: 'Show clock',
        focusIndex: '1000',
        path: 'launcher.showClock',
        binder: ctx.binder
      });
      clockSection.appendChild(showClockField.row);

      const clockFormatSelect = createOptionStepper({
        focusIndex: 1090,
        choices: [
          {value: '24', label: '24-hour (18:30)'},
          {value: '12', label: '12-hour (6:30 PM)'}
        ],
        path: 'launcher.clockFormat',
        parse: function (raw) { return raw === '12' ? '12' : '24'; },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl('Clock format', clockFormatSelect));

      const showDateField = createToggle({
        label: 'Show date',
        focusIndex: '1001',
        path: 'launcher.showDate',
        binder: ctx.binder
      });
      clockSection.appendChild(showDateField.row);

      const clockAlignSelect = createOptionStepper({
        focusIndex: 1002,
        choices: [
          {value: 'left', label: 'Top left'},
          {value: 'center', label: 'Centre top'},
          {value: 'center-middle', label: 'Centre middle'},
          {value: 'right', label: 'Top right'}
        ],
        path: 'launcher.clockAlign',
        // Normalise unknown legacy values to centre top.
        parse: function (raw) {
          return ['left', 'center', 'center-middle', 'right'].indexOf(raw) < 0 ? 'center' : raw;
        },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl('Clock position', clockAlignSelect));

      const clockSizeSelect = createOptionStepper({
        focusIndex: 1003,
        choices: [
          {value: 'small', label: 'Small'},
          {value: 'medium', label: 'Medium'},
          {value: 'large', label: 'Large'},
          {value: 'x-large', label: 'X-Large'},
          {value: 'xx-large', label: 'XX-Large'}
        ],
        path: 'launcher.clockSize',
        parse: function (raw) { return raw || 'large'; },
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl('Clock size', clockSizeSelect));

      const timezoneSelect = createOptionStepper({
        focusIndex: 1004,
        choices: TIMEZONE_OPTIONS.map(function (option) {
          return {value: option.value, label: option.label};
        }),
        path: 'launcher.timezone',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl('Timezone', timezoneSelect));

      const iconSizeSelect = createOptionStepper({
        focusIndex: 1005,
        choices: [
          {value: 'small', label: 'Small'},
          {value: 'medium', label: 'Medium'},
          {value: 'large', label: 'Large'}
        ],
        path: 'launcher.iconSize',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl('Icon size', iconSizeSelect));

      const iconAlignSelect = createOptionStepper({
        focusIndex: 1006,
        choices: [
          {value: 'left', label: 'Left'},
          {value: 'center', label: 'Centre'},
          {value: 'right', label: 'Right'}
        ],
        path: 'launcher.iconAlign',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl('Icon alignment', iconAlignSelect));

      const iconLayoutSelect = createOptionStepper({
        focusIndex: 1007,
        choices: [
          {value: 'scroll', label: 'Scroll one row'},
          {value: 'wrap', label: 'Stacked rows'}
        ],
        path: 'launcher.iconLayout',
        binder: ctx.binder
      });
      clockSection.appendChild(labeledControl('Icon layout', iconLayoutSelect));

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
      clockSection.appendChild(labeledControl('Icons per row (scroll mode)', iconsPerRowSelect));

      const bundledIconsField = createToggle({
        label: 'Use Launch Home app icons',
        focusIndex: '1008',
        path: 'launcher.bundledIcons',
        binder: ctx.binder
      });
      clockSection.appendChild(bundledIconsField.row);

      clockSection.appendChild(createHint(
        'Off = each app’s own icon from the TV (Netflix, YouTube, TV Settings, …). Reading the TV’s icons needs root; apps without one keep the Launch Home icon.'
      ));
      ctx.panes.look.appendChild(clockSection);
    }
  };
}
