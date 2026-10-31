import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  appendRootFile,
  cleanupVoice,
  disableBootLaunch,
  disableHomeWatcher,
  enableBootLaunch,
  enableHomeWatcher,
  getTvChannelNow,
  getTvChannels,
  openTvChannel,
  readFileAsDataUrl,
  readSettingsBackups,
  runTvCheck,
  setScreensaverTimeout,
  setVolumeAsRoot,
  takePreviewFlag,
  whoAmI,
  writeAutoBackup,
  writeSettingsBackup
} from '@luna/root.js';
import {setLunaAdapter} from '@luna/luna-transport.js';
import type {LunaAdapter} from '@luna/luna-transport.js';
import {BRAND} from '@lib/brand.js';
import type {WebOSServiceRequestOptions} from '@lib/types.js';

/**
 * A fake Homebrew Channel root service: records every command and answers it
 * with `reply`. This is the module's interface on a TV, so the tests cross it.
 */
function fakeRoot(reply: (command: string, index: number) => string): string[] {
  const commands: string[] = [];
  const adapter: LunaAdapter = {
    request: function (_uri, options: WebOSServiceRequestOptions) {
      const command = String((options.parameters || {}).command || '');
      commands.push(command);
      const out = reply(command, commands.length - 1);
      void Promise.resolve().then(function () {
        options.onSuccess!({returnValue: true, stdoutString: out});
      });
      return {cancel: vi.fn()};
    }
  };
  setLunaAdapter(adapter);
  return commands;
}

/** A root service that refuses every command. */
function brokenRoot(): void {
  setLunaAdapter({
    request: function (_uri, options) {
      options.onFailure!({errorText: 'command failed'});
      return {cancel: vi.fn()};
    }
  });
}

afterEach(function () {
  setLunaAdapter(null);
});

describe('the root backup write', () => {
  it('writes to a .part file in chunks, then renames it', async () => {
    const commands = fakeRoot(() => 'written');

    await expect(writeSettingsBackup('x'.repeat(24001))).resolves.toEqual({usb: null, usbError: ''});

    const tvPath = BRAND.configDir + '/settings-backup.json';
    expect(commands).toHaveLength(3);
    expect(commands[0]).toContain('mkdir -p ' + "'" + BRAND.configDir + "'");
    expect(commands[0]).toContain('> ' + "'" + tvPath + ".part'");
    expect(commands[1]).toContain(" >> '" + tvPath + ".part'");
    expect(commands[2]).toBe("mv -f '" + tvPath + ".part' '" + tvPath + "' && echo written");
  });

  it('quotes a USB folder whose name carries a space and an apostrophe', async () => {
    const commands = fakeRoot(() => 'written');

    await writeSettingsBackup('{}', "/media/usb 1/it's ember");

    const usbWrite = commands.filter(function (command) {
      return command.indexOf(BRAND.usbSettingsFile) >= 0;
    })[0];
    expect(usbWrite).toContain(
      "'/media/usb 1/it'\\''s ember/" + BRAND.usbSettingsFile + ".part'"
    );
  });

  it('keeps a safe automatic-backup name and prunes old update copies', async () => {
    const commands = fakeRoot(() => 'written');

    await writeAutoBackup('../before-update-to-0.0.111.json', '{}');

    expect(commands.some(function (command) {
      return command.indexOf("mv -f ") === 0 && command.indexOf('.._before-update-to-0.0.111.json') >= 0;
    })).toBe(true);
    const prune = commands.filter(function (command) {
      return command.indexOf('ls -t before-update-*.json') >= 0;
    })[0];
    expect(prune).toContain('tail -n +4');
  });
});

describe('the root backup read', () => {
  it('collects the TV copy, automatic copies and USB backups', async () => {
    fakeRoot(function (command) {
      if (command.indexOf("cat '" + BRAND.configDir + "/settings-backup.json'") >= 0) return '{"tv":1}';
      if (command.indexOf('for f in ') === 0) {
        if (command.indexOf(BRAND.configDir + '/auto') >= 0) {
          return '\n' + BRAND.fileMark + BRAND.configDir + '/auto/before-restore.json\n{"auto":2}';
        }
        return '';
      }
      if (command.indexOf("cat '/media/usb1/" + BRAND.usbSettingsFile + "'") >= 0) return '{"usb":3}';
      return '__missing__';
    });

    await expect(readSettingsBackups(['/media/usb1/'])).resolves.toEqual([
      {where: 'TV', text: '{"tv":1}'},
      {where: 'TV', text: '{"auto":2}'},
      {where: 'USB', text: '{"usb":3}'}
    ]);
  });

  it('finds nothing when no copy exists', async () => {
    fakeRoot(() => '__missing__');

    await expect(readSettingsBackups()).resolves.toEqual([]);
  });
});

describe('the root screensaver timer', () => {
  it('snaps 15 minutes to the nearest allowed timer (20)', async () => {
    const commands = fakeRoot(() => 'ok 20 30 on');

    await expect(setScreensaverTimeout('15')).resolves.toEqual({
      returnValue: true, value: '20', enabled: true, out: 'ok 20 30 on'
    });
    expect(commands[0]).toContain('sv="20"');
    expect(commands[0]).toContain('ov="30"');
  });

  it('turns the screensaver off when the setting is off', async () => {
    const commands = fakeRoot(() => 'ok 30 120 off');

    await expect(setScreensaverTimeout('off')).resolves.toEqual({
      returnValue: true, value: '30', enabled: false, out: 'ok 30 120 off'
    });
    expect(commands[0]).toContain('en="off"');
  });

  it('reports a reply without ok as a failure', async () => {
    fakeRoot(() => 'no such file');

    await expect(setScreensaverTimeout(20)).resolves.toEqual({
      returnValue: false, value: '20', enabled: true, out: 'no such file'
    });
  });

  it('reports a refused command as a failure', async () => {
    brokenRoot();

    await expect(setScreensaverTimeout(20)).resolves.toEqual({
      returnValue: false, value: '20', enabled: true
    });
  });
});

describe('the root Home watcher and boot hook', () => {
  it('translates a missing watcher script', async () => {
    fakeRoot(() => 'missing_watcher');

    await expect(enableHomeWatcher()).rejects.toThrow('home-watcher.sh not installed on TV');
  });

  it('translates a watcher that did not start', async () => {
    fakeRoot(() => 'start_failed');

    await expect(enableHomeWatcher()).rejects.toThrow('watcher did not start');
  });

  it('resolves true when the watcher reports enabled', async () => {
    fakeRoot(() => 'enabled');

    await expect(enableHomeWatcher()).resolves.toBe(true);
  });

  it('translates a missing boot script', async () => {
    fakeRoot(() => 'missing_boot_script');

    await expect(enableBootLaunch()).rejects.toThrow('boot-launch.sh not installed on TV');
  });

  it('resolves true when the boot hook reports enabled', async () => {
    fakeRoot(() => 'enabled');

    await expect(enableBootLaunch()).resolves.toBe(true);
  });

  it('treats a refused disable as false rather than an error', async () => {
    brokenRoot();

    await expect(disableHomeWatcher()).resolves.toBe(false);
    await expect(disableBootLaunch()).resolves.toBe(false);
  });

  it('treats both clean and cleaned as a finished voice teardown', async () => {
    fakeRoot(() => 'cleaned');
    await expect(cleanupVoice()).resolves.toBe(true);

    fakeRoot(() => 'clean');
    await expect(cleanupVoice()).resolves.toBe(true);
  });
});

describe('the root channel scripts', () => {
  it('parses channel rows and drops a malformed one', async () => {
    fakeRoot(() => '1\t101\tBBC One\t0\t0\t1\nbroken\n2\t102\tBBC Two\t1\t1\t0');

    await expect(getTvChannels()).resolves.toEqual([
      {id: '1', number: '101', name: 'BBC One', radio: false, hidden: false, favourite: true},
      {id: '2', number: '102', name: 'BBC Two', radio: true, hidden: true, favourite: false}
    ]);
  });

  it('reads the channel Live TV is on and the programme', async () => {
    fakeRoot(() => '101\tBBC One\tNews');

    await expect(getTvChannelNow()).resolves.toEqual({
      number: '101', name: 'BBC One', programme: 'News'
    });
  });

  it('rejects when the TV did not switch channel', async () => {
    fakeRoot(() => 'failed');

    await expect(openTvChannel({id: '1', number: '101'})).rejects.toThrow('switch channel');
  });

  it('keeps the channel whitelist and quotes the surviving tokens', async () => {
    const commands = fakeRoot(() => 'opened');

    await expect(openTvChannel({id: '1; rm -rf /', number: '10.1'})).resolves.toBe(true);
    expect(commands[0]).not.toContain('; rm -rf');
    expect(commands[0]).toContain("open '1rm-rf' '10.1'");
  });
});

describe('the root preview flag', () => {
  it('removes a set flag and reports it', async () => {
    const commands = fakeRoot(() => '1');

    await expect(takePreviewFlag()).resolves.toBe(true);
    expect(commands[0]).toContain("cat '" + BRAND.tmpPrefix + "-preview-ss'");
    expect(commands[0]).toContain("rm -f '" + BRAND.tmpPrefix + "-preview-ss'");
  });

  it('reports an absent flag as false', async () => {
    fakeRoot(() => '');

    await expect(takePreviewFlag()).resolves.toBe(false);
  });
});

describe('the root report append', () => {
  it('appends the probe line without stripping its apostrophe', async () => {
    const commands = fakeRoot(() => '');

    await appendRootFile("/tmp/it's report.txt", "app: 1'2");

    expect(commands[0]).toBe(
      "printf '%s\\n' 'app: 1'\\''2' >> '/tmp/it'\\''s report.txt'"
    );
  });
});

describe('the root volume fallback', () => {
  it('clamps the level and tries both audio services', async () => {
    const commands = fakeRoot(() => '');

    await expect(setVolumeAsRoot(150)).resolves.toEqual({returnValue: true, via: 'root'});
    expect(commands[0]).toContain('luna://com.webos.audio/setVolume \'{"volume":100}\'');
    expect(commands[0]).toContain('luna://com.webos.service.audio/setVolume \'{"volume":100}\'');
  });

  it('reports a refused command as no volume', async () => {
    brokenRoot();

    await expect(setVolumeAsRoot(-5)).resolves.toEqual({returnValue: false});
  });
});

describe('the root TV check', () => {
  it('passes the app line through quoting, apostrophe intact', async () => {
    const commands = fakeRoot(() => 'report');

    await expect(runTvCheck("app: Ember's settings")).resolves.toBe('report');
    expect(commands[0]).toContain("--app 'app: Ember'\\''s settings'");
  });
});

describe('the root identity', () => {
  it('reads the effective user name', async () => {
    fakeRoot(() => 'root');

    await expect(whoAmI()).resolves.toBe('root');
  });

  it('inlines a root-read icon as a data URL', async () => {
    const bytes = btoa('png');
    setLunaAdapter({
      request: function (_uri, options) {
        void Promise.resolve().then(function () {
          options.onSuccess!({returnValue: true, stdoutBytes: bytes});
        });
        return {cancel: vi.fn()};
      }
    });

    await expect(readFileAsDataUrl('file:///media/usb/icon.jpg'))
      .resolves.toBe('data:image/jpeg;base64,' + bytes);
  });
});
