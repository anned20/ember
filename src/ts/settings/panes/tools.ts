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
import {
  LAST_BACKUP_KEY, backupLabel, backupWhen, compatibilityNote, lastBackupNote, listBackups,
  restoreReport, settingsBackupText
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
      const backupSection = createSection('Backup & restore');
      backupSection.appendChild(createHint('Saves all your ' + BRAND.name + ' settings: apps, wallpaper, music, clock, weather and profiles. The copy on the TV is kept if you reinstall ' + BRAND.name + '. A plugged-in USB drive gets a copy too (' + BRAND.usbFolder + '/' + BRAND.usbSettingsFile + '), to move your settings to another TV. ' + BRAND.name + ' also keeps a copy by itself before each restore and each update. Backups made by other versions of ' + BRAND.name + ' can be restored too: you’re told what fitted.'));
      const backupActions = document.createElement('div');
      backupActions.className = 'settings-backup-actions';
      const backupBtn = createMiniButton({
        label: 'Back up settings',
        focusIndex: '1590',
        className: 'settings-scan-btn',
        dataset: {backupAction: 'backup'}
      });
      const restoreBtn = createMiniButton({
        label: 'Restore settings',
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
      const backupPickRow = labeledControl('Backup to restore', backupPicker);
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
          ? ' Press “Restore this backup” to replace your current settings with it; ' +
            'a copy of them is kept first.'
          : '');
      }
      function closeBackupPicker(): void {
        backupsFound = [];
        backupPickRow.hidden = true;
        restoreBtn.textContent = 'Restore settings';
      }

      backupBtn.addEventListener('click', async function () {
        if (backupBusy) return;
        backupBusy = true;
        closeBackupPicker();
        // Not disabled while busy: a disabled button drops focus.
        backupBtn.textContent = 'Backing up…';
        backupStatus.textContent = 'Backing up…';
        try {
          const roots = (await ctx.withDeadline(findLoungeRoots(), ROOTS_DEADLINE_MS)) || [];
          const text = settingsBackupText(loadConfig(), {reason: 'manual'});
          const res = await writeSettingsBackup(text, roots[0] || '');
          const savedAt = JSON.parse(text).savedAt;
          const where = res.usb ? 'TV and USB drive' : 'TV';
          try {
            localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({savedAt: savedAt, where: where}));
          } catch (err) {
            // The note is optional.
          }
          backupStatus.textContent = 'Backed up on ' + backupWhen(savedAt) + ' to the ' + where + '.' +
            (res.usb === false ? ' The USB drive couldn’t be written' +
              (res.usbError ? ' (' + res.usbError + ')' : '') + '.' : '') +
            (res.usb === null ? ' No USB drive plugged in.' : '');
        } catch (err: any) {
          backupStatus.textContent = 'Backup failed: ' +
            ((err && err.message) || 'it needs root (Homebrew Channel)');
        } finally {
          backupBusy = false;
          backupBtn.textContent = 'Back up settings';
        }
      });

      restoreBtn.addEventListener('click', async function () {
        if (backupBusy) return;
        backupBusy = true;
        try {
          if (!backupsFound.length) {
            // First press: find the backups and let the user pick one.
            restoreBtn.textContent = 'Looking…';
            backupStatus.textContent = 'Looking for backups on the TV and USB drive…';
            const roots = (await ctx.withDeadline(findLoungeRoots(), ROOTS_DEADLINE_MS)) || [];
            backupsFound = listBackups(await readSettingsBackups(roots)) as BackupRecord[];
            if (!backupsFound.length) {
              restoreBtn.textContent = 'Restore settings';
              backupStatus.textContent = 'No backup found on the TV or a USB drive.';
              return;
            }
            backupPicker.setOptions(backupsFound.map(function (b, i) {
              return {value: String(i), label: backupLabel(b)};
            }), '0');
            backupPickRow.hidden = false;
            restoreBtn.textContent = 'Restore this backup';
            showChosenBackup();
            return;
          }
          const chosen = chosenBackup();
          if (!chosen || !chosen.readable) return;
          restoreBtn.textContent = 'Restoring…';
          // Keep the current settings first, so this restore can be undone
          // (it shows up as "before your last restore").
          try {
            await writeAutoBackup('before-restore.json',
              settingsBackupText(loadConfig(), {reason: 'before-restore'}));
          } catch (err: any) {
            restoreBtn.textContent = 'Restore this backup';
            backupStatus.textContent = 'Couldn’t keep a copy of your current settings first, so ' +
              'nothing was changed' + (err && err.message ? ': ' + err.message : '.');
            return;
          }
          const result = configFromBackup(chosen.data.config, ctx.rawConfig);
          if (!result) {
            restoreBtn.textContent = 'Restore this backup';
            backupStatus.textContent = 'That backup has no ' + BRAND.name + ' settings in it.';
            return;
          }
          saveConfig(result.config);
          if (ctx.options.onSave) ctx.options.onSave(result.config);
          restoreNote = restoreReport(chosen, result);
          ctx.redraw();
        } catch (err: any) {
          closeBackupPicker();
          backupStatus.textContent = 'Could not look for backups: ' +
            ((err && err.message) || 'it needs root (Homebrew Channel)');
        } finally {
          backupBusy = false;
        }
      });

      // TV check: a root script reports the TV's model, memory, CPU load and
      // background activity, and times how long TV Settings takes to open. The
      // summary is shown with a QR code so it can be sent from a phone.
      const tvCheckSection = createSection('TV check');
      tvCheckSection.appendChild(createHint('If the TV or TV Settings feels slow, this collects the TV model, memory, CPU load and what is running in the background, and times how long TV Settings takes to open. TV Settings opens and closes by itself, twice; it takes about 40 seconds. Scan the code with your phone to share the result.'));

      const tvCheckBtn = createMiniButton({
        label: 'Run TV check',
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
        tvCheckBtn.textContent = 'Checking…';
        tvCheckResult.hidden = true;
        tvCheckStatus.textContent =
          'Checking… about 40 seconds. TV Settings will open and close by itself, twice ' +
          '(if it stays open, press Exit).';
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
          tvCheckStatus.textContent = (stuck
            ? 'Done, but TV Settings didn\u2019t close by itself on this TV: press Exit or Back ' +
              'to close it. '
            : 'Done. ') + 'Scan the code to copy this text. The full report is in ' +
            DIAGNOSTICS_FILE + ' on the TV.';
          ctx.focusNow(tvCheckResult);
        } catch (err: any) {
          tvCheckStatus.textContent = 'TV check failed: ' +
            ((err && err.message) || 'it needs root (Homebrew Channel)');
        } finally {
          checking = false;
          tvCheckBtn.textContent = 'Run TV check';
        }
      });

      // Updates: the version that is running, and on demand GitHub's newest
      // release. The answer is one sentence and, when there is a release to
      // open, a QR code of its page. Nothing is downloaded or installed, no
      // setting changes, and no root is needed.
      const updateSection = createSection('Updates');
      updateSection.appendChild(createHint('Asks GitHub for the newest ' + BRAND.name +
        ' release. Nothing is downloaded or installed; when there is a newer one, ' +
        'scan its code to open the release page on your phone.'));
      updateSection.appendChild(createHint('You are running ' + BRAND.name + ' ' + APP_VERSION + '.'));

      const updateBtn = createMiniButton({
        label: 'Check for updates',
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
        updateBtn.textContent = 'Checking…';
        updateStatus.textContent = 'Asking GitHub…';
        // No code until there is a release to show: a leftover one could be
        // scanned for the wrong answer.
        updateQr.hidden = true;
        updateQrCode.innerHTML = '';
        try {
          const verdict = updateVerdict(APP_VERSION, await fetchLatestRelease());
          if (verdict.state === 'available') {
            updateStatus.textContent = BRAND.name + ' ' + verdict.latest + ' is available; you have ' +
              APP_VERSION + '. Update from Homebrew Channel, or scan the code to get the file.';
            updateQrCode.innerHTML = qrSvgMarkup(RELEASE_PAGE_URL);
            updateQr.hidden = false;
          } else if (verdict.state === 'current') {
            updateStatus.textContent = 'You are up to date: ' + BRAND.name + ' ' + APP_VERSION +
              ' is the newest release.';
          } else {
            updateStatus.textContent = 'GitHub\u2019s newest release has no version ' + BRAND.name +
              ' can read, so it can\u2019t tell whether you are up to date.';
          }
        } catch (err) {
          updateStatus.textContent = 'Couldn\u2019t reach GitHub. Check that the TV is connected to ' +
            'the internet and try again.';
        } finally {
          updateBusy = false;
          updateBtn.textContent = 'Check for updates';
        }
      });
    }
  };
}
