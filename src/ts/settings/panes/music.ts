import {loadBuiltinMusicManifest, normalizeMusicConfig} from '@music/builtin-music.js';
import {findLoungeRoots, joinPath, discoverMusicTracks} from '@lib/usb.js';
import {
  labeledControl,
  labeledBlock,
  createHint,
  createSection,
  createToggle,
  createTextField,
  createOptionStepper
} from '@settings/components/index.js';
import type {StepperOption} from '@settings/components/index.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import {t, tn} from '@lib/i18n.js';
import type {BuiltinMusicEntry, UsbTrack} from '@lib/types.js';

// How long the packaged-track manifest may take to arrive before it is abandoned.
const MANIFEST_LOAD_MS = 4000;
// How long a USB folder scan may take before it is abandoned.
const USB_SCAN_MS = 5000;

/** The Music pane: ambient on/off, sources, playlists, shuffle/repeat and volume. */
export function createMusicPane(): PaneHandle {
  // Filled in by `build`; `load` calls it once the manifest arrives.
  let applyManifest: ((tracks: BuiltinMusicEntry[]) => void) | null = null;

  return {
    build: function (ctx: SettingsContext): void {
      const config = ctx.rawConfig;
      const music = normalizeMusicConfig(config.music);

      const section = createSection(t('music.section'));

      const musicEnabledField = createToggle({
        label: t('music.enabled'),
        focusIndex: '940',
        path: 'music.enabled',
        binder: ctx.binder
      });
      section.appendChild(musicEnabledField.row);

      const showMusicBarField = createToggle({
        label: t('music.showBar'),
        focusIndex: '9405',
        path: 'music.showBar',
        binder: ctx.binder
      });
      section.appendChild(showMusicBarField.row);

      section.appendChild(createHint(t('music.showBarHint')));

      const musicSourceSelect = createOptionStepper({
        focusIndex: 941,
        choices: [
          {value: 'builtin', label: t('music.source.builtin')},
          {value: 'usb', label: t('music.source.usb')}
        ],
        path: 'music.source',
        binder: ctx.binder,
        onChange: function () {
          syncMusicFields();
        }
      });
      section.appendChild(labeledControl(t('music.source'), musicSourceSelect));

      // --- Built-in: multi-select which of the 8 packaged tracks to rotate ---
      const savedBuiltinPlaylist = Array.isArray(music.builtinPlaylist)
        ? music.builtinPlaylist.slice()
        : [];
      // Empty playlist in config means “all packaged tracks”.
      const builtinSelected: Record<string, boolean> = {};
      let builtinTracks: BuiltinMusicEntry[] = [];
      // The value the binder wrote for “Start with”, kept until the options
      // exist (they need the manifest): the empty list can't hold it yet.
      const builtinStartValue = (ctx.config.music && ctx.config.music.builtin) || '';

      const builtinPlaylistList = document.createElement('div');
      builtinPlaylistList.className = 'settings-track-list';
      const builtinPlaylistBlock = labeledBlock(t('music.builtinPlaylist'), builtinPlaylistList);
      section.appendChild(builtinPlaylistBlock);

      function enabledBuiltinIds(): string[] {
        return builtinTracks
          .map(function (entry) { return entry.id; })
          .filter(function (id) { return builtinSelected[id]; });
      }

      function builtinStartOptions(): StepperOption[] {
        const enabled = enabledBuiltinIds();
        const source = enabled.length
          ? builtinTracks.filter(function (e) { return enabled.indexOf(e.id) >= 0; })
          : builtinTracks;
        return source.map(function (entry) {
          return {value: entry.id, label: entry.title || entry.id};
        });
      }

      const builtinTrackSelect = createOptionStepper({
        focusIndex: 950,
        choices: builtinStartOptions(),
        path: 'music.builtin',
        binder: ctx.binder
      });
      const builtinTrackRow = labeledControl(t('music.startWith'), builtinTrackSelect);
      section.appendChild(builtinTrackRow);

      function refreshBuiltinStartOptions(): void {
        const opts = builtinStartOptions();
        let cur = builtinTrackSelect.value;
        const still = opts.some(function (o) { return o.value === cur; });
        if (!still && opts.length) cur = opts[0].value;
        builtinTrackSelect.setOptions(opts, cur || '');
      }

      // --- USB: folder + multi-select discovered tracks ---
      const musicFolderPicker = createOptionStepper({
        focusIndex: 951,
        choices: [
          {value: '', label: t('music.folder.custom')}
        ],
        value: '',
        onChange: function (value) {
          if (value) {
            musicPathInput.value = value;
            scanUsbTracks(value);
          }
        }
      });
      const musicFolderRow = labeledControl(t('music.folder.browse'), musicFolderPicker);
      section.appendChild(musicFolderRow);

      findLoungeRoots().then(function (roots) {
        const opts = [{value: '', label: t('music.folder.custom')}];
        roots.forEach(function (root) {
          opts.push({value: joinPath(root, 'music'), label: joinPath(root, 'music')});
          opts.push({value: joinPath(root, 'music'), label: joinPath(root, 'music')});
          opts.push({value: joinPath(root, 'music'), label: joinPath(root, 'music')});
        });

        if (opts.length === 1) {
          opts[0].label = t('music.folder.none');
        }
        musicFolderPicker.setOptions(opts, config.music.path || '');
      }).catch(function () {
        musicFolderPicker.setOptions(
          [{value: '', label: t('music.folder.failed')}], '');
      });

      const musicPathField = createTextField({
        label: t('music.path'),
        focusIndex: '952',
        placeholder: t('music.path.placeholder'),
        path: 'music.path',
        trim: true,
        binder: ctx.binder
      });
      const musicPathInput = musicPathField.input;
      const musicPathRow = musicPathField.row;
      section.appendChild(musicPathRow);

      musicPathInput.addEventListener('change', function () {
        musicFolderPicker.setValue(musicPathInput.value);
        scanUsbTracks(musicPathInput.value.trim());
      });
      musicPathInput.addEventListener('blur', function () {
        scanUsbTracks(musicPathInput.value.trim());
      });

      const usbPlaylistList = document.createElement('div');
      usbPlaylistList.className = 'settings-track-list';
      const usbPlaylistBlock = labeledBlock(t('music.usbPlaylist'), usbPlaylistList);

      const usbScanStatus = createHint(t('music.usbScan.idle'));
      usbPlaylistBlock.insertBefore(usbScanStatus, usbPlaylistList);
      section.appendChild(usbPlaylistBlock);

      // url -> checked
      const usbSelected: Record<string, boolean> = {};
      const savedUsb = Array.isArray(music.usbPlaylist) ? music.usbPlaylist : [];
      let usbTrackEntries: UsbTrack[] = [];

      function renderUsbTrackList(entries: UsbTrack[]): void {
        usbTrackEntries = entries || [];
        usbPlaylistList.innerHTML = '';
        if (!usbTrackEntries.length) {
          usbScanStatus.textContent = musicPathInput.value.trim()
            ? t('music.usbScan.empty')
            : t('music.usbScan.noFolder');
          return;
        }
        usbScanStatus.textContent = tn('music.usbScan.found', usbTrackEntries.length);
        const hadSaved = savedUsb.length > 0;
        usbTrackEntries.forEach(function (entry, index) {
          const url = entry.url || '';
          if (usbSelected[url] === undefined) {
            usbSelected[url] = !hadSaved || savedUsb.indexOf(url) >= 0;
          }
          const row = document.createElement('div');
          row.className = 'settings-track-row';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'focusable';
          checkbox.dataset.focusIndex = String(960 + index);
          checkbox.checked = !!usbSelected[url];
          checkbox.addEventListener('change', function () {
            usbSelected[url] = checkbox.checked;
          });

          const title = document.createElement('span');
          title.className = 'settings-track-title';
          if (entry.artist && entry.title) {
            title.textContent = entry.artist + ' — ' + entry.title;
          } else if (entry.title) {
            title.textContent = entry.title;
          } else {
            const parts = String(url).split('/');
            title.textContent = (parts[parts.length - 1] || url).replace(/\.[^.]+$/, '');
          }

          row.appendChild(checkbox);
          row.appendChild(title);
          usbPlaylistList.appendChild(row);
        });
        if (ctx.options.onRendered) ctx.options.onRendered();
      }

      let usbScanGen = 0;
      function scanUsbTracks(folder: string): void {
        const gen = (usbScanGen += 1);
        if (!folder) {
          renderUsbTrackList([]);
          return;
        }
        usbScanStatus.textContent = t('music.usbScan.scanning');
        void ctx.withDeadline(discoverMusicTracks(folder), USB_SCAN_MS).then(function (list) {
          if (gen !== usbScanGen || !ctx.isVisible()) return;
          renderUsbTrackList((list || []) as UsbTrack[]);
        });
      }

      if (music.path) {
        scanUsbTracks(music.path);
      }

      const shuffleField = createToggle({
        label: t('music.shuffle'),
        focusIndex: '990',
        path: 'music.shuffle',
        binder: ctx.binder
      });
      const shuffleRow = shuffleField.row;
      section.appendChild(shuffleRow);

      const repeatSelect = createOptionStepper({
        focusIndex: 991,
        choices: [
          {value: 'all', label: t('music.repeat.all')},
          {value: 'one', label: t('music.repeat.one')},
          {value: 'off', label: t('music.repeat.off')}
        ],
        path: 'music.repeat',
        binder: ctx.binder
      });
      const repeatRow = labeledControl(t('music.repeat'), repeatSelect);
      section.appendChild(repeatRow);

      const musicVolumeField = createTextField({
        label: t('music.volume'),
        focusIndex: '992',
        type: 'range',
        className: 'focusable',
        min: '0',
        max: '50',
        path: 'music.volume',
        parse: function (raw) { return Number(raw) / 100; },
        format: function (value) { return String(Math.round(Number(value || 0.15) * 100)); },
        binder: ctx.binder
      });
      section.appendChild(musicVolumeField.row);

      section.appendChild(createHint(t('music.hint')));

      function syncMusicFields(): void {
        const isBuiltin = musicSourceSelect.value === 'builtin';
        builtinPlaylistBlock.hidden = !isBuiltin;
        builtinTrackRow.hidden = !isBuiltin;
        musicFolderRow.hidden = isBuiltin;
        musicPathRow.hidden = isBuiltin;
        usbPlaylistBlock.hidden = isBuiltin;
        // Shuffle/repeat apply to multi-track playlists (built-in or USB).
        shuffleRow.hidden = false;
        repeatRow.hidden = false;
      }

      syncMusicFields();
      // The playlists come from the tick boxes, not a plain control.
      ctx.binder.hook(function (cfg) {
        // Empty array = all built-ins; otherwise only ticked ids.
        let pickedBuiltin = enabledBuiltinIds();
        if (!pickedBuiltin.length && builtinTracks.length) {
          // Don't allow empty playlist — keep the start track (or first).
          pickedBuiltin = [builtinTrackSelect.value || builtinTracks[0].id];
        }
        cfg.music.builtinPlaylist =
          pickedBuiltin.length === builtinTracks.length ? [] : pickedBuiltin;

        // Empty = all USB tracks found; otherwise only ticked urls.
        let pickedUsb: string[] = [];
        usbTrackEntries.forEach(function (entry) {
          const url = entry && entry.url;
          if (url && usbSelected[url]) pickedUsb.push(url);
        });
        if (!pickedUsb.length && usbTrackEntries.length) {
          pickedUsb = [usbTrackEntries[0].url];
        }
        cfg.music.usbPlaylist =
          usbTrackEntries.length && pickedUsb.length === usbTrackEntries.length
            ? []
            : pickedUsb;
      });

      // The built-in rows and “Start with” options wait on the manifest.
      applyManifest = function (tracks: BuiltinMusicEntry[]): void {
        builtinTracks = tracks || [];
        builtinTracks.forEach(function (entry) {
          builtinSelected[entry.id] = !savedBuiltinPlaylist.length
            || savedBuiltinPlaylist.indexOf(entry.id) >= 0;
        });

        builtinPlaylistList.innerHTML = '';
        builtinTracks.forEach(function (entry, index) {
          const row = document.createElement('div');
          row.className = 'settings-track-row';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'focusable';
          checkbox.dataset.focusIndex = String(942 + index);
          checkbox.checked = !!builtinSelected[entry.id];
          checkbox.addEventListener('change', function () {
            builtinSelected[entry.id] = checkbox.checked;
            // Keep “Start with” options in sync with enabled set.
            refreshBuiltinStartOptions();
          });

          const title = document.createElement('span');
          title.className = 'settings-track-title';
          const detail = entry.description ? ' — ' + entry.description : '';
          title.textContent = (entry.title || entry.id) + detail;

          row.appendChild(checkbox);
          row.appendChild(title);
          builtinPlaylistList.appendChild(row);
        });

        builtinTrackSelect.setOptions(builtinStartOptions(), builtinStartValue);
        syncMusicFields();
      };

      ctx.panes.music.appendChild(section);
    },

    load: async function (ctx: SettingsContext): Promise<void> {
      if (!applyManifest) return;
      const tracks = await ctx.withDeadline(loadBuiltinMusicManifest(), MANIFEST_LOAD_MS);
      if (!ctx.isVisible()) return;
      applyManifest(tracks || []);
    }
  };
}
