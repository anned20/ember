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
import {stepperField, textField} from '@settings/settings-binding.js';
import {beginSettingsTextEdit} from '@settings/text-gate.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
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
      ? 'The ' + (entry ? entry.label : profileId) + ' profile uses its own dark background, ' +
        'so this Source applies once Active profile is Default or Night.'
      : '';
  }

  return {
    setProfile: function (profileId: string): void {
      applyProfileNote(profileId);
    },

    build: function (ctx: SettingsContext): void {
      rawConfig = ctx.rawConfig;
      const bg = normalizeBackgroundConfig(ctx.config.background);

      const section = createSection('Background');

      const sourceSelect = createOptionStepper({
        focusIndex: 902,
        choices: [
          {value: 'preset', label: 'Gradient'},
          {value: 'animated-gradient', label: 'Animated Gradient'},
          {value: 'builtin', label: 'Built-in photos'},
          {value: 'usb', label: 'USB folder'},
          {value: 'url', label: 'Online URL (nature + anime)'},
          {value: 'aerial', label: 'Aerial videos (Apple)'}
        ],
        onChange: function (value) {
          syncFields({
            revealGallery: value === 'url' || value === 'builtin' || value === 'aerial'
          });
        }
      });
      ctx.binder.bind(stepperField(sourceSelect, 'background.source'));
      section.appendChild(labeledControl('Source', sourceSelect));

      // A profile with its own background (Cinema) overrides the Source above.
      // Unexplained, Save looked like it reset photos back to Gradient.
      profileBgNote = createHint('');
      section.appendChild(profileBgNote);
      applyProfileNote(pendingProfile || rawConfig.profile || 'default');
      pendingProfile = null;

      const presetSelect = createOptionStepper({
        focusIndex: 903,
        choices: [
          {value: 'warm-gradient', label: 'Warm gradient'},
          {value: 'cool-gradient', label: 'Cool gradient'},
          {value: 'midnight', label: 'Midnight'},
          {value: 'ember', label: 'Ember'}
        ]
      });
      ctx.binder.bind(stepperField(presetSelect, 'background.preset'));
      // Only shown when Source is Gradient / Animated Gradient (not when Photo is set).
      const presetRow = labeledControl('Gradient style', presetSelect);
      section.appendChild(presetRow);

      const displaySelect = createOptionStepper({
        focusIndex: 904,
        choices: [
          {value: 'static', label: 'Single image'},
          {value: 'slideshow', label: 'Slideshow'}
        ],
        onChange: function () {
          syncFields();
        }
      });
      ctx.binder.bind(stepperField(displaySelect, 'background.mode'));
      const displayRow = labeledControl('Display', displaySelect);
      section.appendChild(displayRow);

      // Aerial Slideshow only: randomise the clip order.
      const bgShuffleField = createToggle({
        label: 'Shuffle clips',
        focusIndex: '936',
        path: 'background.shuffle'
      });
      const bgShuffleRow = bgShuffleField.row;
      ctx.binder.bind(bgShuffleField.field!);
      section.appendChild(bgShuffleRow);

      // Aerial clips (Apple) — title-only picker; the clips stream from Apple's
      // CDN, so there are no packaged thumbnails to show.
      let selectedAerialId = bg.aerial || (AERIAL_BACKGROUNDS[0] && AERIAL_BACKGROUNDS[0].id) || '';
      const aerialGallery = createGallery({
        heading: 'Choose an aerial clip (' + AERIAL_BACKGROUNDS.length + ' \u00b7 streams from Apple)',
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

      aerialRow.appendChild(createHint(
        'Clips stream from Apple\u2019s network (nothing is packaged) and play muted, full-screen and looping. The TV must be online; if a clip will not play, the gradient above is used instead. ' +
        'Aerials are the heaviest background source (network plus continuous video decode), and Performance mode has no effect on video.'
      ));

      // Built-in photo gallery (thumbnails) — only visible when Source is Built-in photos.
      // Built empty; the tiles arrive with the manifest in `load`.
      let selectedBuiltinId = bg.builtin || '';
      const builtinGallery = createGallery({
        heading: 'Choose a built-in photo (~3840px, sharp on 4K)',
        focusIndex: indexInRow('settings-photo', 0),
        selectedId: selectedBuiltinId,
        entries: [],
        onSelect: function (id) {
          selectedBuiltinId = id || '';
          builtinGallery.markSelection(selectedBuiltinId);
        }
      });
      const builtinRow = builtinGallery.row;
      builtinRow.appendChild(createHint(
        'Packaged at ~3840px for 4K TVs; Performance mode downloads 1920px copies. Arrows browse \u00b7 OK chooses the photo and moves on.'
      ));
      section.appendChild(builtinRow);

      const usbHint = createHint('USB path: lounge/backgrounds/ with images.json. For a single file, enter the filename below.');
      section.appendChild(usbHint);

      const usbField = createTextField({
        label: 'USB filename',
        focusIndex: '930',
        placeholder: 'living-room.jpg',
        path: 'background.file',
        trim: true
      });
      const usbFileRow = usbField.row;
      ctx.binder.bind(usbField.field!);
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

      const urlHint = createHint('Loads over the network (not stored in the app package). Choose a photo below (nature or anime), or pick Custom URL and paste any direct https image link (Unsplash, Pexels, Wallhaven, your own host). TV must be online. Slideshow with no URLs uses the curated set.');
      section.appendChild(urlHint);

      const urlField = createTextField({
        label: 'Image URL',
        focusIndex: '931',
        placeholder: 'https://images.unsplash.com/photo-…'
      });
      const urlInput = urlField.input;
      const urlRow = urlField.row;
      // Prefer saved URL; if empty and a catalog pick is selected, prefill that.
      const remotePrefill = findRemoteBackgroundById(initialRemote);
      urlInput.value = bg.url || (remotePrefill && remotePrefill.url) || '';
      // Derived init (a catalog pick prefills the field), so register the field
      // without reading the raw config over it.
      ctx.binder.add(textField(urlInput, 'background.url', {trim: true}));

      // Visual photo gallery (replaces text-only stepper) — D-pad pickable tiles.
      let selectedRemoteId = initialRemote;
      const customHint = document.createElement('span');
      customHint.className = 'photo-picker-custom-hint';
      customHint.textContent = 'Paste link below';
      customHint.style.pointerEvents = 'none';
      const customEntry: GalleryEntry = {
        id: '',
        title: 'Custom URL',
        className: 'photo-picker-custom',
        ariaLabel: 'Custom URL',
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
        heading: 'Choose an online photo (' + REMOTE_BACKGROUNDS.length + ' network images · nature + anime)',
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
          showUrlStatus('This needs a web link starting with https://', 'error');
          return;
        }
        showUrlStatus('Checking the link\u2026', '');
        const img = new Image();
        let settled = false;
        function done(ok: boolean) {
          if (settled || gen !== urlCheckGen) return;
          settled = true;
          if (ok) {
            showUrlStatus('The link loads as an image (' + img.naturalWidth + ' \u00d7 ' +
              img.naturalHeight + '). Press Save to use it.', 'ok');
          } else {
            showUrlStatus('That link didn\u2019t load as an image. Use the direct image link: it ' +
              'usually ends in .jpg or .png (on an image host, \u201cCopy image address\u201d or ' +
              '\u201cDirect link\u201d). A link to a web page about the photo won\u2019t work.', 'error');
          }
        }
        img.onload = function () { done(true); };
        img.onerror = function () { done(false); };
        setTimeout(function () { done(false); }, 20000);
        img.src = jpegForTv(url);
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
        label: 'Slideshow URLs',
        focusIndex: '932',
        textarea: true,
        rows: 4,
        block: true,
        placeholder: 'One https image URL per line (leave empty to use curated online set)',
        path: 'background.urls',
        parse: parseUrlList,
        format: function (value) { return Array.isArray(value) ? value.join('\n') : ''; }
      });
      const urlsRow = urlsField.row;
      ctx.binder.bind(urlsField.field!);
      section.appendChild(urlsRow);

      const intervalField = createTextField({
        label: 'Seconds per slide',
        focusIndex: '933',
        type: 'number',
        min: '30',
        max: '3600',
        step: '30',
        path: 'background.slideshowIntervalSec',
        parse: function (raw) { return Number(raw) || 300; },
        format: function (value) { return String(value || 300); }
      });
      const intervalRow = intervalField.row;
      ctx.binder.bind(intervalField.field!);
      section.appendChild(intervalRow);

      const kenBurnsField = createToggle({
        label: 'Slow zoom background',
        focusIndex: '934',
        path: 'background.kenBurns'
      });
      const kenBurnsRow = kenBurnsField.row;
      ctx.binder.bind(kenBurnsField.field!);
      section.appendChild(kenBurnsRow);
      const kenBurnsHint = createHint(
        'When on, the wallpaper slowly zooms in and drifts a little (like a calm slideshow). When off, the picture stays still. Photos only — not gradients. ' +
        'While the wallpaper moves, tiles and buttons are tinted instead of frosted glass: blurring a moving picture makes TVs stutter.'
      );
      section.appendChild(kenBurnsHint);

      const overlayField = createTextField({
        label: 'Overlay opacity',
        focusIndex: '935',
        type: 'range',
        className: 'focusable',
        min: '20',
        max: '60',
        path: 'background.overlayOpacity',
        parse: function (raw) { return Number(raw) / 100; },
        format: function (value) { return String(Math.round(Number(value || 0.45) * 100)); }
      });
      ctx.binder.bind(overlayField.field!);
      section.appendChild(overlayField.row);

      const oledNote = document.createElement('p');
      oledNote.className = 'oled-note';
      oledNote.textContent = 'On OLED TVs, prefer slideshow or gradients over a single static photo left on screen for long periods.';
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
