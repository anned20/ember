import {configFromBackup, loadConfig, saveConfig} from '@config/config.js';
import {
  createHint,
  createMiniButton,
  createOptionStepper,
  createSection,
  labeledControl
} from '@settings/components/index.js';
import {
  execRoot, readSettingsBackups, runTvCheck, writeAutoBackup, writeSettingsBackup
} from '@luna/luna.js';
import {findLoungeRoots} from '@lib/usb.js';
import {qrSvgMarkup} from '@lib/qr-svg.js';
import {RELEASE_PAGE_URL, fetchLatestRelease, updateVerdict} from '@lib/update-check.js';
import {BRAND} from '@lib/brand.js';
import {APP_VERSION} from '@lib/version.js';
import {t} from '@lib/i18n.js';
import {
  LAST_BACKUP_KEY, backupLabel, backupWhen, backupWhereLabel, compatibilityNote, lastBackupNote,
  listBackups, restoreReport, settingsBackupText
} from '@settings/settings-backup.js';
import {startLauncherProbe, tvCheckHead, tvCheckSummary} from '@settings/tv-check.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';

/** How long the TV's backup roots may take to arrive before it is abandoned. */
const ROOTS_DEADLINE_MS = 4000;

/** Where diagnostics.sh saves its full report on the TV. */
const DIAGNOSTICS_FILE = BRAND.tmpPrefix + '-diagnostics.txt';

/** An Ember backup file as parsed by settings-backup.js. */
interface BackupRecord {
  data: {config: any; savedAt?: string; updatedTo?: string};
  where: string;
  time: number;
  format: number;
  schema: number;
  appVersion: string;
  reason: string;
  readable: boolean;
}

/**
 * The Tools pane: Backup & restore (back up, pick a backup, restore, with the
 * status note), the TV check (the launcher probe and the shareable report) and
 * the update check (the running version and GitHub's newest release).
 *
 * A restore redraws the whole panel, which rebuilds this pane; the report it
 * leaves behind is held in this closure until the next build shows it.
 */
export function createToolsPane(): PaneHandle {
  let restoreNote = '';

  return {
    build: function (ctx: SettingsContext): void {
      // Backup & restore: every Ember setting to a file on the TV (kept
      // when Ember is reinstalled) and to a plugged-in USB drive, to move
      // them to another TV. Ember also keeps copies by itself, before each
      // restore and each update. Backups from other versions restore as far as
      // they fit (config.js, configFromBackup). Needs root (Homebrew Channel).
      const backupSection = createSection(t('tools.backupSection'));
      backupSection.appendChild(createHint(t('tools.backupHint', {
        brand: BRAND.name,
        usbFolder: BRAND.usbFolder,
        settingsFile: BRAND.usbSettingsFile
      })));
      const backupActions = document.createElement('div');
      backupActions.className = 'settings-backup-actions';
      const backupBtn = createMiniButton({
        label: t('tools.backUp'),
        focusIndex: '1590',
        className: 'settings-scan-btn',
        dataset: {backupAction: 'backup'}
      });
      const restoreBtn = createMiniButton({
        label: t('tools.restore'),
        focusIndex: '1591',
        className: 'settings-scan-btn',
        dataset: {backupAction: 'restore'}
      });
      backupActions.appendChild(backupBtn);
      backupActions.appendChild(restoreBtn);
      backupSection.appendChild(backupActions);
      // Which backup to restore: shown once Restore has found them.
      let backupsFound: BackupRecord[] = [];
      const backupPicker = createOptionStepper({
        focusIndex: 1592,
        choices: [],
        value: '',
        onChange: function () {
          showChosenBackup();
        }
      });
      const backupPickRow = labeledControl(t('tools.backupToRestore'), backupPicker);
      backupPickRow.hidden = true;
      backupSection.appendChild(backupPickRow);
      const backupStatus = createHint(restoreNote || lastBackupNote());
      restoreNote = '';
      backupSection.appendChild(backupStatus);
      ctx.panes.tools.appendChild(backupSection);

      let backupBusy = false;
      function chosenBackup(): BackupRecord | null {
        return backupsFound[parseInt(backupPicker.value, 10)] || null;
      }
      function showChosenBackup(): void {
        const chosen = chosenBackup();
        if (!chosen) return;
        backupStatus.textContent = compatibilityNote(chosen) + (chosen.readable
          ? t('tools.pressRestore')
          : '');
      }
      function closeBackupPicker(): void {
        backupsFound = [];
        backupPickRow.hidden = true;
        restoreBtn.textContent = t('tools.restore');
      }

      backupBtn.addEventListener('click', async function () {
        if (backupBusy) return;
        backupBusy = true;
        closeBackupPicker();
        // Not disabled while busy: a disabled button drops focus.
        backupBtn.textContent = t('tools.backingUp');
        backupStatus.textContent = t('tools.backingUp');
        try {
          const roots = (await ctx.withDeadline(findLoungeRoots(), ROOTS_DEADLINE_MS)) || [];
          const text = settingsBackupText(loadConfig(), {reason: 'manual'});
          const res = await writeSettingsBackup(text, roots[0] || '');
          const savedAt = JSON.parse(text).savedAt;
          // The English token stays in the note; backupWhereLabel() reads it back.
          const where = res.usb ? 'TV and USB drive' : 'TV';
          try {
            localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({savedAt: savedAt, where: where}));
          } catch (err) {
            // The note is optional.
          }
          backupStatus.textContent = t('tools.backedUpTo', {
            when: backupWhen(savedAt),
            where: backupWhereLabel(where)
          }) +
            (res.usb === false ? t('tools.usbWriteFailed') +
              (res.usbError ? t('tools.usbError', {detail: res.usbError}) : '') + '.' : '') +
            (res.usb === null ? t('tools.noUsb') : '');
        } catch (err: any) {
          backupStatus.textContent = t('tools.backupFailed', {
            detail: (err && err.message) || t('tools.needsRoot')
          });
        } finally {
          backupBusy = false;
          backupBtn.textContent = t('tools.backUp');
        }
      });

      restoreBtn.addEventListener('click', async function () {
        if (backupBusy) return;
        backupBusy = true;
        try {
          if (!backupsFound.length) {
            // First press: find the backups and let the user pick one.
            restoreBtn.textContent = t('tools.looking');
            backupStatus.textContent = t('tools.lookingForBackups');
            const roots = (await ctx.withDeadline(findLoungeRoots(), ROOTS_DEADLINE_MS)) || [];
            backupsFound = listBackups(await readSettingsBackups(roots)) as BackupRecord[];
            if (!backupsFound.length) {
              restoreBtn.textContent = t('tools.restore');
              backupStatus.textContent = t('tools.noBackupFound');
              return;
            }
            backupPicker.setOptions(backupsFound.map(function (b, i) {
              return {value: String(i), label: backupLabel(b)};
            }), '0');
            backupPickRow.hidden = false;
            restoreBtn.textContent = t('tools.restoreThis');
            showChosenBackup();
            return;
          }
          const chosen = chosenBackup();
          if (!chosen || !chosen.readable) return;
          restoreBtn.textContent = t('tools.restoring');
          // Keep the current settings first, so this restore can be undone
          // (it shows up as "before your last restore").
          try {
            await writeAutoBackup('before-restore.json',
              settingsBackupText(loadConfig(), {reason: 'before-restore'}));
          } catch (err: any) {
            restoreBtn.textContent = t('tools.restoreThis');
            backupStatus.textContent = t('tools.keepCopyFailed', {
              detail: err && err.message ? ': ' + err.message : '.'
            });
            return;
          }
          const result = configFromBackup(chosen.data.config, ctx.rawConfig);
          if (!result) {
            restoreBtn.textContent = t('tools.restoreThis');
            backupStatus.textContent = t('tools.noSettingsInBackup', {brand: BRAND.name});
            return;
          }
          saveConfig(result.config);
          if (ctx.options.onSave) ctx.options.onSave(result.config);
          restoreNote = restoreReport(chosen, result);
          ctx.redraw();
        } catch (err: any) {
          closeBackupPicker();
          backupStatus.textContent = t('tools.lookFailed', {
            detail: (err && err.message) || t('tools.needsRoot')
          });
        } finally {
          backupBusy = false;
        }
      });

      // TV check: a root script reports the TV's model, memory, CPU load and
      // background activity, and times how long TV Settings takes to open. The
      // summary is shown with a QR code so it can be sent from a phone.
      const tvCheckSection = createSection(t('tools.tvCheckSection'));
      tvCheckSection.appendChild(createHint(t('tools.tvCheckHint')));

      const tvCheckBtn = createMiniButton({
        label: t('tools.runTvCheck'),
        focusIndex: '1600',
        className: 'settings-scan-btn'
      });
      tvCheckSection.appendChild(tvCheckBtn);

      const tvCheckStatus = createHint('');
      tvCheckSection.appendChild(tvCheckStatus);

      const tvCheckResult = document.createElement('div');
      tvCheckResult.className = 'tv-check-result focusable';
      tvCheckResult.dataset.focusIndex = '1601';
      tvCheckResult.tabIndex = 0;
      tvCheckResult.hidden = true;
      const tvCheckText = document.createElement('pre');
      tvCheckText.className = 'tv-check-report';
      const tvCheckQr = document.createElement('div');
      tvCheckQr.className = 'tv-check-qr';
      tvCheckResult.appendChild(tvCheckText);
      tvCheckResult.appendChild(tvCheckQr);
      tvCheckSection.appendChild(tvCheckResult);
      ctx.panes.tools.appendChild(tvCheckSection);

      let checking = false;
      tvCheckBtn.addEventListener('click', async function () {
        if (checking) return;
        checking = true;
        // Not disabled: a disabled button drops focus, and Settings would jump
        // back to the top when TV Settings closes.
        tvCheckBtn.textContent = t('tools.checking');
        tvCheckResult.hidden = true;
        tvCheckStatus.textContent = t('tools.tvCheckRunning');
        try {
          const head = tvCheckHead(ctx.rawConfig);
          const probe = startLauncherProbe();
          let report: string;
          try {
            report = await runTvCheck(head);
          } catch (err) {
            probe.stop();
            throw err;
          }
          const probeLine = probe.stop();
          const summary = tvCheckSummary(report, head) + '\n' + probeLine;
          // Also into the saved report, which is what people usually send.
          execRoot('printf \'%s\\n\' \'' + probeLine.replace(/'/g, '') +
            '\' >> ' + DIAGNOSTICS_FILE).catch(function () { /* optional */ });
          tvCheckText.textContent = summary;
          tvCheckQr.innerHTML = qrSvgMarkup(summary);
          tvCheckResult.hidden = false;
          // Some TVs (webOS 9) keep TV Settings open despite the check's close.
          const stuck = /didn.t close by itself/.test(report);
          tvCheckStatus.textContent = (stuck ? t('tools.tvCheckStuck') : t('tools.tvCheckDone')) +
            t('tools.tvCheckScan', {file: DIAGNOSTICS_FILE});
          ctx.focusNow(tvCheckResult);
        } catch (err: any) {
          tvCheckStatus.textContent = t('tools.tvCheckFailed', {
            detail: (err && err.message) || t('tools.needsRoot')
          });
        } finally {
          checking = false;
          tvCheckBtn.textContent = t('tools.runTvCheck');
        }
      });

      // Updates: the version that is running, and on demand GitHub's newest
      // release. The answer is one sentence and, when there is a release to
      // open, a QR code of its page. Nothing is downloaded or installed, no
      // setting changes, and no root is needed.
      const updateSection = createSection(t('tools.updatesSection'));
      updateSection.appendChild(createHint(t('tools.updatesHint', {brand: BRAND.name})));
      updateSection.appendChild(createHint(t('tools.runningVersion', {
        brand: BRAND.name,
        version: APP_VERSION
      })));

      const updateBtn = createMiniButton({
        label: t('tools.checkUpdates'),
        focusIndex: '1602',
        className: 'settings-scan-btn',
        dataset: {updateAction: 'check'}
      });
      updateSection.appendChild(updateBtn);

      const updateStatus = createHint('');
      updateStatus.dataset.updateAction = 'status';
      updateSection.appendChild(updateStatus);

      // The release page as a code to scan. The tv-check-result class keeps it
      // hidden until there is something to show.
      const updateQr = document.createElement('div');
      updateQr.className = 'tv-check-result';
      updateQr.dataset.updateAction = 'qr';
      updateQr.hidden = true;
      const updateQrCode = document.createElement('div');
      updateQrCode.className = 'tv-check-qr';
      updateQr.appendChild(updateQrCode);
      updateSection.appendChild(updateQr);
      ctx.panes.tools.appendChild(updateSection);

      let updateBusy = false;
      updateBtn.addEventListener('click', async function () {
        if (updateBusy) return;
        updateBusy = true;
        // Not disabled: a disabled button drops focus.
        updateBtn.textContent = t('tools.checking');
        updateStatus.textContent = t('tools.askingGitHub');
        // No code until there is a release to show: a leftover one could be
        // scanned for the wrong answer.
        updateQr.hidden = true;
        updateQrCode.innerHTML = '';
        try {
          const verdict = updateVerdict(APP_VERSION, await fetchLatestRelease());
          if (verdict.state === 'available') {
            updateStatus.textContent = t('tools.updateAvailable', {
              brand: BRAND.name,
              version: verdict.latest,
              current: APP_VERSION
            });
            updateQrCode.innerHTML = qrSvgMarkup(RELEASE_PAGE_URL);
            updateQr.hidden = false;
          } else if (verdict.state === 'current') {
            updateStatus.textContent = t('tools.upToDate', {
              brand: BRAND.name,
              version: APP_VERSION
            });
          } else {
            updateStatus.textContent = t('tools.updateUnreadable', {brand: BRAND.name});
          }
        } catch (err) {
          updateStatus.textContent = t('tools.githubUnreachable');
        } finally {
          updateBusy = false;
          updateBtn.textContent = t('tools.checkUpdates');
        }
      });
    }
  };
}
