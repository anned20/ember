import {listInstalledApps} from '@apps/apps.js';
import {dock} from '@apps/dock.js';
import {lgHomeAppsToAdd} from '@apps/lg-home.js';
import {
  isAppInstalled, loadAppCatalog, rememberApps, resolvePinnedApp, setIconSrc, lazyLoadIcon
} from '@apps/app-catalog.js';
import {KNOWN_BUILTIN_APPS, getBuiltinAppIcon, getBuiltinAppTitle, BUILTIN_ICON_CHOICES} from '@apps/app-icons.js';
import {listLaunchPoints} from '@luna/luna.js';
import {
  labeledControl,
  createHint,
  createSection,
  createToggle,
  createTextField,
  createMiniButton,
  createAppRow,
  createOptionStepper
} from '@settings/components/index.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import {t, tn} from '@lib/i18n.js';
import type {AppRecord, CustomApp, LauncherConfig} from '@lib/types.js';

/**
 * The Apps pane: the pinned home-row list (reorder and remove), the custom-app
 * form, and the Discover scan. Membership lives in a LauncherConfig draft that
 * only the dock module edits, so Save writes exactly what the Dock will show.
 */
export function createAppsPane(): PaneHandle {
  // Settings -> Apps -> Show hidden and system apps (for this visit only).
  let showHiddenApps = false;
  // The Dock as this visit edits it: written to the config only on Save.
  let draft: LauncherConfig;
  // The list containers built below, refilled by `load`.
  let pinnedList: HTMLElement;
  let addAppsList: HTMLElement;
  // Updates the "Show installed apps (N)" button after the list re-renders.
  let syncAddAppsToggle: (() => void) | null = null;

  /** The Custom app record with this id, or null. */
  function customAppOf(id: string): CustomApp | null {
    const list = draft.customApps;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function movePinned(ctx: SettingsContext, index: number, delta: number): void {
    const before = draft.pinnedApps[index];
    draft = dock.move(draft, index, delta);
    if (draft.pinnedApps[index] === before) return;
    if (!pinnedList) return;
    const keepFocus = pinnedList.contains(document.activeElement);
    renderPinnedList(ctx, pinnedList);
    // Stay on the moved app's arrow so repeated presses keep moving it.
    if (keepFocus) {
      ctx.refocusListButton(pinnedList, index + (delta < 0 ? -1 : 1), delta < 0 ? [0] : [1]);
    }
  }

  function renderPinnedList(ctx: SettingsContext, container: HTMLElement): void {
    const apps = ctx.apps;
    container.innerHTML = '';

    draft.pinnedApps.forEach(function (appId, index) {
      const app: AppRecord = apps.appsByIdMap[appId] ||
        {id: appId, launchId: undefined, title: appId, icon: ''};
      // Not shown on the home row (see apps.js): say why, so it can go.
      const isCustom = draft.customApps.some(function (entry) { return entry && entry.id === appId; });
      const missing = !isCustom && !isAppInstalled(apps.installedCatalog, appId);
      const row = createAppRow({
        title: app.title || app.id,
        icon: app.icon,
        variant: 'pinned',
        missing: missing,
        titleSuffix: missing ? ' ' + t('apps.notInstalled') : '',
        mountIcon: function (icon) {
          // TV-native icons are file:// paths WAM won't load directly.
          icon.addEventListener('error', function () {
            const bundled = getBuiltinAppIcon(app.launchId || app.id);
            if (bundled && icon.dataset.fallbackTried !== '1') {
              icon.dataset.fallbackTried = '1';
              icon.src = bundled;
              return;
            }
            icon.remove();
          });
          setIconSrc(icon, app.icon, undefined);
        }
      }).row;

      const upBtn = createMiniButton({
        label: '↑',
        focusIndex: 1200 + index * 3,
        onClick: function () { movePinned(ctx, index, -1); }
      });
      // At the ends the arrow stays focusable but does nothing (dimmed): when
      // it was disabled, focus fell to the other arrow and the next OK moved
      // the app straight back.
      if (index === 0) upBtn.setAttribute('aria-disabled', 'true');

      const downBtn = createMiniButton({
        label: '↓',
        focusIndex: 1201 + index * 3,
        onClick: function () { movePinned(ctx, index, 1); }
      });
      if (index === draft.pinnedApps.length - 1) downBtn.setAttribute('aria-disabled', 'true');

      const removeBtn = createMiniButton({
        label: '✕',
        focusIndex: 1202 + index * 3,
        onClick: function () {
          const keepFocus = container.contains(document.activeElement);
          draft = dock.remove(draft, draft.pinnedApps[index]);
          renderPinnedList(ctx, container);
          // The next app slides into this row; land on its ✕.
          if (keepFocus) ctx.refocusListButton(container, index, [2]);
        }
      });

      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
  }

  async function loadAppsLists(
    ctx: SettingsContext,
    pinnedListEl: HTMLElement,
    addContainer: HTMLElement
  ): Promise<void> {
    const apps = ctx.apps;
    // The old list stays up (and keeps focus) until the new one is ready; it
    // is cleared just before the synchronous rebuild below.
    const catalog = await loadAppCatalog();
    apps.installedCatalog = catalog;
    const listed = await listInstalledApps({includeHidden: true});
    const visible = listed.filter(function (app) { return !app.hidden; });
    apps.appsByIdMap = Object.assign({}, catalog);
    visible.forEach(function (app) {
      apps.appsByIdMap[app.id] = app;
    });

    draft.customApps.forEach(function (entry) {
      if (!entry || !entry.id) return;
      apps.appsByIdMap[entry.id] = {
        id: entry.id,
        launchId: entry.launchId,
        title: entry.title || entry.launchId || entry.id,
        icon: entry.icon || ''
      };
    });

    for (let i = 0; i < draft.pinnedApps.length; i += 1) {
      const appId = draft.pinnedApps[i];
      if (customAppOf(appId)) continue;
      if (!apps.appsByIdMap[appId] || !apps.appsByIdMap[appId].title || !apps.appsByIdMap[appId].icon) {
        apps.appsByIdMap[appId] = (await resolvePinnedApp(appId, apps.appsByIdMap)) as AppRecord;
      }
    }

    KNOWN_BUILTIN_APPS.forEach(function (id) {
      if (apps.appsByIdMap[id] && apps.appsByIdMap[id].title) return;
      apps.appsByIdMap[id] = {
        id: id,
        title: getBuiltinAppTitle(id) || id,
        icon: getBuiltinAppIcon(id) || ''
      };
    });

    // Redrawn after a + elsewhere: keep focus if the user is in this list.
    let pinnedSpot: {row: number; button: number} | null = null;
    const oldRows = pinnedListEl.querySelectorAll('.settings-pinned-row');
    for (let r = 0; r < oldRows.length; r += 1) {
      const btns = Array.prototype.slice.call(oldRows[r].querySelectorAll('.settings-mini-btn'));
      const b = btns.indexOf(document.activeElement);
      if (b >= 0) pinnedSpot = {row: r, button: b};
    }
    renderPinnedList(ctx, pinnedListEl);
    if (pinnedSpot) ctx.refocusListButton(pinnedListEl, pinnedSpot.row, [pinnedSpot.button, 0, 1, 2]);

    const seen: Record<string, boolean> = {};
    const candidates: AppRecord[] = [];
    visible.forEach(function (app) {
      if (app && app.id && !seen[app.id]) {
        seen[app.id] = true;
        candidates.push(app);
      }
    });
    // Hidden and system apps only on request: with root the TV lists every
    // installed app, and the list ran to hundreds of rows.
    if (showHiddenApps) {
      listed.forEach(function (app) {
        if (app && app.id && !seen[app.id]) {
          seen[app.id] = true;
          candidates.push(app);
        }
      });
    }
    // The TV's list couldn't be read (no root): offer the apps Ember knows.
    if (!listed.length) {
      KNOWN_BUILTIN_APPS.forEach(function (id) {
        const app = apps.appsByIdMap[id];
        if (app && app.title && !seen[id]) {
          seen[id] = true;
          candidates.push(app);
        }
      });
    }

    candidates.sort(function (a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id);
    });

    const remaining = candidates.filter(function (app) {
      return !dock.contains(draft, app.id);
    });

    addContainer.innerHTML = '';
    if (!remaining.length) {
      addContainer.appendChild(createHint(candidates.length
        ? t('apps.allPinned')
        : t('apps.noneFound')));
    }

    remaining.forEach(function (app, index) {
      const iconSrc = app.icon;
      const addBtn = createMiniButton({
        label: '+',
        focusIndex: 1300 + index,
        dataset: {pointerFocus: 'off'},
        onClick: function () {
          if (dock.contains(draft, app.id)) return; // second OK before the redraw
          const keepFocus = document.activeElement === addBtn;
          draft = dock.pin(draft, app.id);
          void loadAppsLists(ctx, pinnedListEl, addContainer).then(function () {
            // The next app slides into this row; land on its + (unless the
            // user already moved on while the list was loading).
            if (keepFocus && !ctx.focusInPanel()) {
              ctx.refocusListButton(addContainer, index, [0]);
            }
          });
        }
      });
      const row = createAppRow({
        title: app.title || app.id,
        icon: iconSrc,
        mountIcon: function (icon) {
          icon.addEventListener('error', function () { icon.remove(); });
          lazyLoadIcon(icon, iconSrc as string, addContainer);
        }
      }).row;
      row.appendChild(addBtn);
      addContainer.appendChild(row);
    });
    if (syncAddAppsToggle) syncAddAppsToggle();
  }

  return {
    build: function (ctx: SettingsContext): void {
      // Membership lives in this draft and is written only when Save runs; seed
      // it from the stored (unprofiled) launcher.
      const stored = ctx.rawConfig.launcher;
      draft = Object.assign({}, stored, {
        pinnedApps: (stored.pinnedApps || []).slice(),
        customApps: (stored.customApps || []).map(function (entry) {
          return Object.assign({}, entry);
        })
      });

      const appsSection = createSection(t('apps.pinnedSection'));
      appsSection.appendChild(createHint(t('apps.pinnedHint')));

      // All apps: a tile on the home row that opens every app on the TV.
      const allAppsTileField = createToggle({
        label: t('apps.allAppsTile'),
        focusIndex: '1190',
        path: 'launcher.allAppsTile',
        binder: ctx.binder
      });
      appsSection.appendChild(allAppsTileField.row);
      appsSection.appendChild(createHint(t('apps.allAppsTileHint')));

      // TV Settings shortcut at the end of the home row.
      const tvSettingsTileField = createToggle({
        label: t('apps.tvSettingsTile'),
        focusIndex: '1192',
        path: 'launcher.tvSettingsTile',
        binder: ctx.binder
      });
      appsSection.appendChild(tvSettingsTileField.row);
      appsSection.appendChild(createHint(t('apps.tvSettingsTileHint')));

      // Number keys: press 1-9 on the remote to open the home row tile at that
      // position (apps.js numbers the tiles and launches by number).
      const numberKeyField = createToggle({
        label: t('apps.numberKeys'),
        focusIndex: '1191',
        path: 'launcher.numberKeyLaunch',
        binder: ctx.binder
      });
      appsSection.appendChild(numberKeyField.row);
      appsSection.appendChild(createHint(t('apps.numberKeysHint')));

      pinnedList = document.createElement('div');
      pinnedList.className = 'settings-pinned-list';
      appsSection.appendChild(pinnedList);

      const addHeading = document.createElement('h4');
      addHeading.className = 'settings-subheading';
      addHeading.textContent = t('apps.addHeading');
      appsSection.appendChild(addHeading);

      appsSection.appendChild(createHint(t('apps.addHint')));

      // Every app on LG's own home screen in one press, in LG's order, after
      // the ones already here (instead of adding them one by one).
      const importLgBtn = createMiniButton({
        label: t('apps.lgImport'),
        focusIndex: '1298'
      });
      appsSection.appendChild(importLgBtn);
      const importLgStatus = createHint('');
      importLgStatus.hidden = true;
      appsSection.appendChild(importLgStatus);
      let importingLg = false;
      importLgBtn.addEventListener('click', async function () {
        if (importingLg) return;
        importingLg = true;
        // Not disabled while busy: a disabled button drops focus.
        importLgBtn.textContent = t('apps.lgReading');
        importLgStatus.hidden = false;
        importLgStatus.textContent = '';
        try {
          const points = await listLaunchPoints();
          // Their names and icons, for when the TV can't be asked later.
          rememberApps(points);
          if (!points.length) {
            importLgStatus.textContent = t('apps.lgReadFailed');
            return;
          }
          const toAdd = lgHomeAppsToAdd(points, draft);
          if (!toAdd.length) {
            importLgStatus.textContent = t('apps.lgNone');
            return;
          }
          toAdd.forEach(function (id) { draft = dock.pin(draft, id); });
          await loadAppsLists(ctx, pinnedList, addAppsList);
          importLgStatus.textContent = tn('apps.lgAdded', toAdd.length);
        } catch (err: any) {
          importLgStatus.textContent = t('apps.lgFailed', {
            reason: (err && err.message) || t('apps.lgRootRequired')
          });
        } finally {
          importingLg = false;
          importLgBtn.textContent = t('apps.lgImport');
        }
      });

      // Collapsed by default: with root this lists every installed app, and
      // scrolling past it was the only way to reach the sections below.
      const addAppsToggle = createMiniButton({
        label: '',
        focusIndex: '1299',
        className: 'settings-apps-toggle'
      });
      appsSection.appendChild(addAppsToggle);

      const showHiddenField = createToggle({
        label: t('apps.showHidden'),
        focusIndex: '1280',
        checked: showHiddenApps,
        onChange: function (checked) {
          showHiddenApps = checked;
          void loadAppsLists(ctx, pinnedList, addAppsList);
        }
      });
      appsSection.appendChild(showHiddenField.row);

      addAppsList = document.createElement('div');
      addAppsList.className = 'settings-apps';
      appsSection.appendChild(addAppsList);
      // The Dock edits live in the draft, not a control. Hooks run after the
      // field table, so only these two arrays are copied over: replacing the
      // launcher would throw away what the plain fields just wrote.
      ctx.binder.hook(function (cfg) {
        cfg.launcher.pinnedApps = draft.pinnedApps.slice();
        cfg.launcher.customApps = draft.customApps.slice();
      });
      ctx.panes.apps.appendChild(appsSection);

      let addAppsExpanded = false;
      syncAddAppsToggle = function () {
        const count = addAppsList.querySelectorAll('.settings-app-row').length;
        // No rows: skip the button and show the "all pinned / none found" note.
        addAppsToggle.hidden = !count;
        addAppsList.hidden = !!count && !addAppsExpanded;
        addAppsToggle.textContent = addAppsExpanded
          ? t('apps.hideInstalled')
          : tn('apps.showInstalled', count);
      };
      addAppsToggle.addEventListener('click', function () {
        addAppsExpanded = !addAppsExpanded;
        if (syncAddAppsToggle) syncAddAppsToggle();
      });
      syncAddAppsToggle();

      const customSection = createSection(t('apps.customSection'));
      customSection.appendChild(createHint(t('apps.customHint')));

      const customAppIdField = createTextField({
        label: t('apps.appId'),
        focusIndex: '1400',
        placeholder: t('apps.appIdPlaceholder')
      });
      const customAppIdInput = customAppIdField.input;
      customSection.appendChild(customAppIdField.row);

      const customNameField = createTextField({
        label: t('apps.name'),
        focusIndex: '1401',
        placeholder: t('apps.namePlaceholder')
      });
      const customNameInput = customNameField.input;
      customSection.appendChild(customNameField.row);

      const iconPreview = document.createElement('img');
      iconPreview.className = 'settings-app-icon';
      iconPreview.alt = '';
      iconPreview.src = BUILTIN_ICON_CHOICES[0].value;

      const iconSelect = createOptionStepper({
        focusIndex: 1402,
        choices: BUILTIN_ICON_CHOICES,
        value: BUILTIN_ICON_CHOICES[0].value,
        onChange: function (value) {
          iconPreview.src = value;
        }
      });

      const iconRow = labeledControl(t('apps.icon'), iconSelect);
      iconRow.insertBefore(iconPreview, iconRow.lastChild);
      customSection.appendChild(iconRow);

      const addCustomBtn = createMiniButton({
        label: t('apps.addCustom'),
        focusIndex: '1403',
        className: 'settings-add-custom',
        onClick: function () {
          const launchId = customAppIdInput.value.trim();
          if (!launchId) {
            if (ctx.options.onToast) ctx.options.onToast(t('apps.needAppId'));
            return;
          }

          const title = customNameInput.value.trim() || getBuiltinAppTitle(launchId) || launchId;

          const before = draft.customApps.length;
          draft = dock.addCustom(draft, {launchId: launchId, title: title, icon: iconSelect.value});
          // Already in the Dock: refuse the second tile and keep the form as it is.
          if (draft.customApps.length === before) return;

          customAppIdInput.value = '';
          customNameInput.value = '';

          void loadAppsLists(ctx, pinnedList, addAppsList);
        }
      });
      customSection.appendChild(addCustomBtn);
      ctx.panes.apps.appendChild(customSection);

      const discoverSection = createSection(t('apps.discoverSection'));
      discoverSection.appendChild(createHint(t('apps.discoverHint')));

      const scanBtn = createMiniButton({
        label: t('apps.scan'),
        focusIndex: '1500',
        className: 'settings-scan-btn'
      });
      discoverSection.appendChild(scanBtn);

      const discoverIconSelect = createOptionStepper({
        focusIndex: 1501,
        choices: [{value: '', label: t('apps.useNativeIcon')}].concat(BUILTIN_ICON_CHOICES),
        value: ''
      });
      discoverSection.appendChild(labeledControl(t('apps.iconOverride'), discoverIconSelect));

      const discoverStatus = createHint('');
      discoverSection.appendChild(discoverStatus);

      const discoverList = document.createElement('div');
      discoverList.className = 'settings-apps';
      discoverSection.appendChild(discoverList);
      ctx.panes.apps.appendChild(discoverSection);

      let discovered: AppRecord[] = [];

      function inDock(appId: string): boolean {
        return dock.contains(draft, appId);
      }

      function renderDiscoverList(): void {
        discoverList.innerHTML = '';
        if (!discovered.length) return;

        const available = discovered.filter(function (app) {
          return app && app.id && !inDock(app.id);
        });

        discoverStatus.textContent = available.length
          ? tn('apps.found', discovered.length)
          : t('apps.discoverAllPinned');

        available.forEach(function (app, index) {
          const iconSrc = app.icon;
          const addBtn = createMiniButton({
            label: '+',
            focusIndex: 1510 + index,
            dataset: {pointerFocus: 'off'},
            onClick: function () {
              if (inDock(app.id)) return; // second OK before the list redraws
              const keepFocus = document.activeElement === addBtn;
              const override = discoverIconSelect.value;
              if (override) {
                draft = dock.addCustom(draft, {
                  launchId: app.id, title: app.title || app.id, icon: override
                });
              } else {
                draft = dock.pin(draft, app.id);
              }
              void loadAppsLists(ctx, pinnedList, addAppsList);
              renderDiscoverList();
              // The next app slides into this row; land on its +.
              if (keepFocus) ctx.refocusListButton(discoverList, index, [0]);
            }
          });
          const row = createAppRow({
            title: app.title || app.id,
            icon: iconSrc,
            mountIcon: function (icon) {
              icon.addEventListener('error', function () { icon.remove(); });
              lazyLoadIcon(icon, iconSrc as string, discoverList);
            }
          }).row;
          row.appendChild(addBtn);
          discoverList.appendChild(row);
        });
      }

      let scanning = false;
      scanBtn.addEventListener('click', async function () {
        if (scanning) return;
        scanning = true;
        scanBtn.disabled = true;
        discoverStatus.textContent = t('apps.scanning');
        try {
          discovered = await listInstalledApps({includeHidden: true});
          discovered.sort(function (a, b) {
            return (a.title || a.id).localeCompare(b.title || b.id);
          });
          if (!discovered.length) {
            discoverStatus.textContent = t('apps.scanNone');
          } else {
            renderDiscoverList();
          }
        } catch (err) {
          discoverStatus.textContent = t('apps.scanFailed');
        } finally {
          scanning = false;
          scanBtn.disabled = false;
        }
      });
    },

    load: function (ctx: SettingsContext): Promise<void> {
      return loadAppsLists(ctx, pinnedList, addAppsList);
    }
  };
}
