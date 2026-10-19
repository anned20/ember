import {AERIAL_BACKGROUNDS} from '@background/aerials.js';
import {
  normalizeBackgroundConfig,
  loadBuiltinManifest,
  REMOTE_BACKGROUNDS,
  findRemoteBackgroundById,
  findRemoteBackgroundByUrl,
  remoteThumbUrl,
  builtinImageUrl,
  jpegForTv,
  parseUrlList
} from '@background/backgrounds.js';
import {PRESET_OPTIONS, probeImage} from '@background/media.js';
import {SOURCE_OPTIONS} from '@background/background-sources.js';
import {getProfileOverrides, PROFILE_OPTIONS} from '@config/profiles.js';
import {indexInRow} from '@focus/focus-row.js';
import {
  labeledControl,
  createHint,
  createSection,
  createToggle,
  createTextField,
  createGallery,
  createOptionStepper
} from '@settings/components/index.js';
import type {GalleryEntry, OptionStepperElement} from '@settings/components/index.js';
import {beginSettingsTextEdit} from '@settings/text-gate.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import {BRAND} from '@lib/brand.js';
import {t} from '@lib/i18n.js';
import type {BuiltinBackground, Config} from '@lib/types.js';

// How long the packaged-photo manifest may take to arrive before it is abandoned.
const BUILTIN_MANIFEST_MS = 4000;

/** The background controls syncBackgroundFields toggles, keyed by name. */
interface BackgroundRefs {
  displayRow: HTMLElement;
  bgShuffleRow: HTMLElement;
  aerialRow: HTMLElement;
  builtinRow: HTMLElement;
  usbHint: HTMLElement;
  usbFileRow: HTMLElement;
  remoteRow: HTMLElement;
  urlHint: HTMLElement;
  urlRow: HTMLElement;
  urlsRow: HTMLElement;
  intervalRow: HTMLElement;
  kenBurnsRow: HTMLElement;
  kenBurnsHint: HTMLElement;
  displaySelect: OptionStepperElement;
}

interface SyncFieldsOptions {
  revealGallery?: boolean;
}

/** The tiles for the built-in photo gallery (packaged wallpapers). */
function builtinEntries(manifest: BuiltinBackground[]): GalleryEntry[] {
  return (manifest || []).map(function (entry) {
    return {
      id: entry.id,
      title: entry.title || entry.id,
      // 480px thumbnails: decoding the full wallpapers for 200px tiles
      // stalled the panel on open and while scrolling past the gallery.
      sources: [
        builtinImageUrl('thumbs/' + entry.file),
        builtinImageUrl(entry.file),
        'assets/backgrounds/' + entry.file
      ]
    };
  });
}

/**
 * Show only the rows relevant to the chosen source and Display mode. Aerial
 * slideshow cycles the whole catalog; a Ken Burns pan on top of a moving video
 * is meaningless, so both are hidden for aerials.
 */
function syncBackgroundFields(
  ctx: SettingsContext,
  source: string,
  refs: BackgroundRefs,
  opts?: SyncFieldsOptions
): void {
  const isImage = source !== 'preset' && source !== 'animated-gradient';
  const showBuiltin = source === 'builtin';
  const showUsb = source === 'usb';
  const showUrl = source === 'url';
  const showAerial = source === 'aerial';
  const isSlideshow = refs.displaySelect.value === 'slideshow';
  const revealGallery = !!(opts && opts.revealGallery);

  refs.displayRow.hidden = !isImage;
  // Aerial Slideshow cycles the whole catalog, so the single-clip picker is
  // hidden there (as the built-in gallery is for its own slideshow).
  refs.aerialRow.hidden = !showAerial || isSlideshow;
  refs.bgShuffleRow.hidden = !(showAerial && isSlideshow);
  // Built-in / online / aerial galleries are mutually exclusive by source.
  refs.builtinRow.hidden = !showBuiltin || isSlideshow;
  refs.usbHint.hidden = !showUsb;
  refs.usbFileRow.hidden = !showUsb || isSlideshow;
  refs.remoteRow.hidden = !showUrl || isSlideshow;
  refs.urlHint.hidden = !showUrl;
  refs.urlRow.hidden = !showUrl || isSlideshow;
  refs.urlsRow.hidden = !showUrl || !isSlideshow;
  // Neither applies to aerials: clips advance on the clip's own end, and a
  // Ken Burns pan on top of a moving video is meaningless.
  refs.intervalRow.hidden = !isImage || !isSlideshow || showAerial;
  refs.kenBurnsRow.hidden = !isImage || showAerial;
  refs.kenBurnsHint.hidden = !isImage || showAerial;

  // When the user switches Source to a photo catalog, scroll that gallery into view.
  if (revealGallery && !isSlideshow) {
    if (showAerial && refs.aerialRow && !refs.aerialRow.hidden) {
      ctx.focusGallery(refs.aerialRow);
    } else if (showBuiltin && refs.builtinRow && !refs.builtinRow.hidden) {
      ctx.focusGallery(refs.builtinRow);
    } else if (showUrl && refs.remoteRow && !refs.remoteRow.hidden) {
      ctx.focusGallery(refs.remoteRow);
    }
  }
}

/**
 * The Background pane's handle. Beyond the shared pane contract it exposes the
 * profile-vs-source note, which the Look pane drives when the active profile
 * changes (so neither pane imports the other).
 */
export interface BackgroundPaneHandle extends PaneHandle {
  /** Update the "this profile uses its own background" note. */
  setProfile(profileId: string): void;
}

/** The Background pane: source, gallery, URL list, interval, zoom and overlay. */
export function createBackgroundPane(): BackgroundPaneHandle {
  // Filled in by `build`; `load` calls it once the manifest arrives.
  let applyManifest: ((tracks: BuiltinBackground[]) => void) | null = null;
  // The "profile uses its own background" note and what it reads.
  let profileBgNote: HTMLElement | null = null;
  let rawConfig: Config | null = null;
  // A profile change that arrived before `build` ran (the Look pane may set it
  // first), applied once the note exists.
  let pendingProfile: string | null = null;

  function applyProfileNote(profileId: string): void {
    if (!profileBgNote || !rawConfig) {
      pendingProfile = profileId;
      return;
    }
    const overrides = getProfileOverrides(
      {profile: profileId, profiles: rawConfig.profiles} as Config);
    const forced = !!(overrides.background && overrides.background.source);
    const entry = PROFILE_OPTIONS.filter(function (p) { return p.id === profileId; })[0];
    profileBgNote.hidden = !forced;
    profileBgNote.textContent = forced
      ? t('background.profileNote', {profile: entry ? t(entry.labelKey) : profileId})
      : '';
  }

  return {
    setProfile: function (profileId: string): void {
      applyProfileNote(profileId);
    },

    build: function (ctx: SettingsContext): void {
      rawConfig = ctx.rawConfig;
      const bg = normalizeBackgroundConfig(ctx.config.background);

      const section = createSection(t('background.section'));

      const sourceSelect = createOptionStepper({
        focusIndex: 902,
        choices: SOURCE_OPTIONS.map(function (option) {
          return {value: option.value, label: t(option.labelKey)};
        }),
        path: 'background.source',
        binder: ctx.binder,
        onChange: function (value) {
          syncFields({
            revealGallery: value === 'url' || value === 'builtin' || value === 'aerial'
          });
        }
      });
      section.appendChild(labeledControl(t('background.source'), sourceSelect));

      // A profile with its own background (Cinema) overrides the Source above.
      // Unexplained, Save looked like it reset photos back to Gradient.
      profileBgNote = createHint('');
      section.appendChild(profileBgNote);
      applyProfileNote(pendingProfile || rawConfig.profile || 'default');
      pendingProfile = null;

      const presetSelect = createOptionStepper({
        focusIndex: 903,
        choices: PRESET_OPTIONS.map(function (option) {
          return {value: option.value, label: t(option.labelKey)};
        }),
        path: 'background.preset',
        binder: ctx.binder
      });
      // Only shown when Source is Gradient / Animated Gradient (not when Photo is set).
      const presetRow = labeledControl(t('background.preset'), presetSelect);
      section.appendChild(presetRow);

      const displaySelect = createOptionStepper({
        focusIndex: 904,
        choices: [
          {value: 'static', label: t('background.display.static')},
          {value: 'slideshow', label: t('background.display.slideshow')}
        ],
        path: 'background.mode',
        binder: ctx.binder,
        onChange: function () {
          syncFields();
        }
      });
      const displayRow = labeledControl(t('background.display'), displaySelect);
      section.appendChild(displayRow);

      // Aerial Slideshow only: randomise the clip order.
      const bgShuffleField = createToggle({
        label: t('background.shuffle'),
        focusIndex: '936',
        path: 'background.shuffle',
        binder: ctx.binder
      });
      const bgShuffleRow = bgShuffleField.row;
      section.appendChild(bgShuffleRow);

      // Aerial clips (Apple) — title-only picker; the clips stream from Apple's
      // CDN, so there are no packaged thumbnails to show.
      let selectedAerialId = bg.aerial || (AERIAL_BACKGROUNDS[0] && AERIAL_BACKGROUNDS[0].id) || '';
      const aerialGallery = createGallery({
        heading: t('background.aerial.heading', {count: AERIAL_BACKGROUNDS.length}),
        focusIndex: indexInRow('settings-photo', 0),
        gridClassName: 'aerial-picker-grid',
        selectedId: selectedAerialId,
        entries: AERIAL_BACKGROUNDS.map(function (entry) {
          return {id: entry.id, title: entry.title || entry.id, text: true};
        }),
        onSelect: function (id) {
          selectedAerialId = id || '';
          aerialGallery.markSelection(selectedAerialId);
        }
      });
      const aerialRow = aerialGallery.row;
      section.appendChild(aerialRow);

      aerialRow.appendChild(createHint(t('background.aerial.hint', {brand: BRAND.name})));

      // Built-in photo gallery (thumbnails) — only visible when Source is Built-in photos.
      // Built empty; the tiles arrive with the manifest in `load`.
      let selectedBuiltinId = bg.builtin || '';
      const builtinGallery = createGallery({
        heading: t('background.builtin.heading'),
        focusIndex: indexInRow('settings-photo', 0),
        selectedId: selectedBuiltinId,
        entries: [],
        onSelect: function (id) {
          selectedBuiltinId = id || '';
          builtinGallery.markSelection(selectedBuiltinId);
        }
      });
      const builtinRow = builtinGallery.row;
      builtinRow.appendChild(createHint(t('background.builtin.hint')));
      section.appendChild(builtinRow);

      const usbHint = createHint(t('background.usb.hint', {folder: BRAND.usbFolder}));
      section.appendChild(usbHint);

      const usbField = createTextField({
        label: t('background.usb.file'),
        focusIndex: '930',
        placeholder: t('background.usb.placeholder'),
        path: 'background.file',
        trim: true,
        binder: ctx.binder
      });
      const usbFileRow = usbField.row;
      section.appendChild(usbFileRow);

      // Match curated remote by saved id, else by URL, else default first entry.
      let initialRemote = bg.remote || '';
      if (!findRemoteBackgroundById(initialRemote)) {
        const byUrl = findRemoteBackgroundByUrl(bg.url);
        initialRemote = byUrl ? byUrl.id : (REMOTE_BACKGROUNDS[0] && REMOTE_BACKGROUNDS[0].id) || '';
      }
      // Empty string = custom typed URL (not a catalog entry).
      if (bg.url && !findRemoteBackgroundByUrl(bg.url) && !findRemoteBackgroundById(bg.remote)) {
        initialRemote = '';
      }

      const urlHint = createHint(t('background.url.hint'));
      section.appendChild(urlHint);

      const urlField = createTextField({
        label: t('background.url.label'),
        focusIndex: '931',
        placeholder: 'https://images.unsplash.com/photo-…',
        path: 'background.url',
        trim: true,
        // Derived init (a catalog pick prefills the field), so add the field
        // without reading the raw config over it.
        readBack: false,
        binder: ctx.binder
      });
      const urlInput = urlField.input;
      const urlRow = urlField.row;
      // Prefer saved URL; if empty and a catalog pick is selected, prefill that.
      const remotePrefill = findRemoteBackgroundById(initialRemote);
      urlInput.value = bg.url || (remotePrefill && remotePrefill.url) || '';

      // Visual photo gallery (replaces text-only stepper) — D-pad pickable tiles.
      let selectedRemoteId = initialRemote;
      const customHint = document.createElement('span');
      customHint.className = 'photo-picker-custom-hint';
      customHint.textContent = t('background.url.customHint');
      customHint.style.pointerEvents = 'none';
      const customEntry: GalleryEntry = {
        id: '',
        title: t('background.url.custom'),
        className: 'photo-picker-custom',
        ariaLabel: t('background.url.custom'),
        extra: customHint,
        onSelect: function () {
          selectRemote('');
          try {
            urlInput.scrollIntoView({block: 'nearest', behavior: 'smooth'});
          } catch (err) {
            try { urlInput.scrollIntoView(true); } catch (err2) { /* ignore */ }
          }
          window.setTimeout(function () {
            beginSettingsTextEdit(urlInput);
          }, 120);
        }
      };
      const remoteGallery = createGallery({
        heading: t('background.url.heading', {count: REMOTE_BACKGROUNDS.length}),
        focusIndex: indexInRow('settings-photo', 0),
        selectedId: selectedRemoteId,
        entries: REMOTE_BACKGROUNDS.map(function (entry): GalleryEntry {
          return {
            id: entry.id,
            title: entry.title || entry.id,
            sources: [remoteThumbUrl(entry.url)]
          };
        }).concat([customEntry]),
        onSelect: function (id) { selectRemote(id); }
      });
      const remoteRow = remoteGallery.row;
      function markRemoteSelection(): void {
        remoteGallery.markSelection(selectedRemoteId);
      }
      function selectRemote(id: string): void {
        selectedRemoteId = id || '';
        const picked = findRemoteBackgroundById(selectedRemoteId);
        if (picked) {
          urlInput.value = picked.url;
        }
        markRemoteSelection();
      }
      section.appendChild(remoteRow);

      // Keep remote id aligned when the user edits the URL by hand.
      // Under the field: whether the link loads as an image. A web page link
      // (an image host's page for the photo) was accepted and silently showed
      // nothing on the home screen.
      const urlStatus = createHint('', 'settings-url-status');
      urlStatus.hidden = true;
      let urlCheckTimer: ReturnType<typeof setTimeout> | null = null;
      let urlCheckGen = 0;
      function showUrlStatus(text: string, kind: string): void {
        urlStatus.textContent = text;
        urlStatus.hidden = !text;
        urlStatus.classList.toggle('is-ok', kind === 'ok');
        urlStatus.classList.toggle('is-error', kind === 'error');
      }
      function checkUrl() {
        const url = urlInput.value.trim();
        const gen = ++urlCheckGen;
        // A built-in online photo: known good.
        if (!url || findRemoteBackgroundByUrl(url)) {
          showUrlStatus('', '');
          return;
        }
        if (!/^https?:\/\//i.test(url)) {
          showUrlStatus(t('background.url.needsHttps'), 'error');
          return;
        }
        showUrlStatus(t('background.url.checking'), '');
        probeImage(jpegForTv(url)).then(function (res) {
          if (gen !== urlCheckGen) return;
          if (res.ok) {
            showUrlStatus(t('background.url.ok', {width: res.width, height: res.height}), 'ok');
          } else {
            showUrlStatus(t('background.url.badLoad'), 'error');
          }
        });
      }
      urlInput.addEventListener('input', function () {
        const match = findRemoteBackgroundByUrl(urlInput.value.trim());
        selectedRemoteId = match ? match.id : '';
        markRemoteSelection();
        if (urlCheckTimer !== null) clearTimeout(urlCheckTimer);
        urlCheckTimer = setTimeout(checkUrl, 800);
      });

      section.appendChild(urlRow);
      section.appendChild(urlStatus);
      // A saved link is checked when Settings opens, too.
      if (urlInput.value.trim()) checkUrl();

      // Gallery picks and the URL/remote-id alignment are derived fields.
      ctx.binder.hook(function (cfg) {
        cfg.background.builtin = selectedBuiltinId || '';
        cfg.background.aerial = selectedAerialId || '';
        // Online catalog is independent of built-in; only apply when source is url,
        // and keep the remote id aligned with a matching URL.
        cfg.background.remote = selectedRemoteId || '';
        if (cfg.background.url) {
          const match = findRemoteBackgroundByUrl(cfg.background.url);
          if (match) cfg.background.remote = match.id;
        } else if (selectedRemoteId) {
          const picked = findRemoteBackgroundById(selectedRemoteId);
          if (picked) {
            cfg.background.url = picked.url;
            cfg.background.remote = picked.id;
          }
        }
      });

      const urlsField = createTextField({
        label: t('background.urls'),
        focusIndex: '932',
        textarea: true,
        rows: 4,
        block: true,
        placeholder: t('background.urls.placeholder'),
        path: 'background.urls',
        parse: parseUrlList,
        format: function (value) { return Array.isArray(value) ? value.join('\n') : ''; },
        binder: ctx.binder
      });
      const urlsRow = urlsField.row;
      section.appendChild(urlsRow);

      const intervalField = createTextField({
        label: t('background.interval'),
        focusIndex: '933',
        type: 'number',
        min: '30',
        max: '3600',
        step: '30',
        path: 'background.slideshowIntervalSec',
        parse: function (raw) { return Number(raw) || 300; },
        format: function (value) { return String(value || 300); },
        binder: ctx.binder
      });
      const intervalRow = intervalField.row;
      section.appendChild(intervalRow);

      const kenBurnsField = createToggle({
        label: t('background.kenBurns'),
        focusIndex: '934',
        path: 'background.kenBurns',
        binder: ctx.binder
      });
      const kenBurnsRow = kenBurnsField.row;
      section.appendChild(kenBurnsRow);
      const kenBurnsHint = createHint(t('background.kenBurns.hint'));
      section.appendChild(kenBurnsHint);

      const overlayField = createTextField({
        label: t('background.overlay'),
        focusIndex: '935',
        type: 'range',
        className: 'focusable',
        min: '20',
        max: '60',
        path: 'background.overlayOpacity',
        parse: function (raw) { return Number(raw) / 100; },
        format: function (value) { return String(Math.round(Number(value || 0.45) * 100)); },
        binder: ctx.binder
      });
      section.appendChild(overlayField.row);

      const oledNote = document.createElement('p');
      oledNote.className = 'oled-note';
      oledNote.textContent = t('background.oledNote');
      section.appendChild(oledNote);
      ctx.panes.look.appendChild(section);

      const refs = {
        displayRow: displayRow,
        bgShuffleRow: bgShuffleRow,
        aerialRow: aerialRow,
        builtinRow: builtinRow,
        usbHint: usbHint,
        usbFileRow: usbFileRow,
        remoteRow: remoteRow,
        urlHint: urlHint,
        urlRow: urlRow,
        urlsRow: urlsRow,
        intervalRow: intervalRow,
        kenBurnsRow: kenBurnsRow,
        kenBurnsHint: kenBurnsHint,
        displaySelect: displaySelect
      };

      function syncFields(opts?: SyncFieldsOptions): void {
        // Gradient style only applies to gradient sources — hide entirely for
        // photos (builtin/USB/URL) so a leftover "Warm gradient" is not confusing.
        const isGradientSource =
          sourceSelect.value === 'preset' || sourceSelect.value === 'animated-gradient';
        presetRow.hidden = !isGradientSource;
        syncBackgroundFields(ctx, sourceSelect.value, refs, opts);
      }

      syncFields();

      // The built-in tiles wait on the manifest.
      applyManifest = function (tracks: BuiltinBackground[]): void {
        builtinGallery.setEntries(builtinEntries(tracks), selectedBuiltinId);
      };
    },

    load: async function (ctx: SettingsContext): Promise<void> {
      if (!applyManifest) return;
      const tracks = await ctx.withDeadline(loadBuiltinManifest(), BUILTIN_MANIFEST_MS);
      if (!ctx.isVisible()) return;
      applyManifest(tracks || []);
    }
  };
}
