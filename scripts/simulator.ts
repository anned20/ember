#!/usr/bin/env node

// Ember's dev loop on LG's webOS TV Simulator: `node scripts/simulator.ts`
// launches dist/ on it, `node scripts/simulator.ts setup` installs it.
// Run as `npm run sim` / `npm run sim:setup` so ares-launch resolves to this
// project's @webos-tools/cli (dev dependency) rather than a global install, and
// so dist/ is built first.
//
// There is no webOS 22+ Emulator to target: LG stopped the Emulator at webOS
// 6.0 (sdk 6, below Ember's floor) and ships Simulators from webOS 22 on.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {Readable} = require('stream');
const {pipeline} = require('stream/promises');
const {spawnSync} = require('child_process');

const {parseSimulatorPage, pickSimulatorPackage, unpackedDirName, downloadUrlFromReply} =
  require('../src/ts/lib/simulator-download.ts') as typeof import('../src/ts/lib/simulator-download.ts');

const SITE = 'https://webostv.developer.lge.com';
const PAGE_URL = SITE + '/develop/tools/simulator-installation';
const SDK_ENV = 'LG_WEBOS_TV_SDK_HOME';
const FILE_API = 'https://developer.lge.com/common/file/DownloadFilePath.ajax';

// The version the project's own TV runs (docs/adr/0001-webos-22-floor.md).
const DEFAULT_VERSION = '25';

const simulatorRoot = () => path.join(process.env[SDK_ENV] || path.join(os.homedir(), 'webOS_SDK'), 'Simulator');

/** The installed Simulator directory for `version`, or null. Same name shape
 * ares looks for under $LG_WEBOS_TV_SDK_HOME/Simulator. */
function installedDir(version: string): string | null {
  const prefix = 'webOS_TV_' + version + '_Simulator_';
  let names: string[];
  try {
    names = fs.readdirSync(simulatorRoot());
  } catch (err) {
    return null;
  }
  const match = names.filter(function (name) { return name.indexOf(prefix) === 0; }).sort().pop();
  return match ? path.join(simulatorRoot(), match) : null;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return await res.text();
}

/** LG's signed link for a file id: three calls, none of them a URL to link to. */
async function resolveDownloadUrl(fileId: string): Promise<string> {
  const body = await fetchText(SITE + '/api/downloadSDK', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({fileId: fileId})
  });
  const token = (JSON.parse(body) as {fileIdEnc?: string}).fileIdEnc;
  if (!token) throw new Error('No download token for ' + fileId + ' (the page may have changed).');
  // Without a Referer this one answers 200 with an empty body.
  const xml = await fetchText(FILE_API + '?fileId=' + encodeURIComponent(token), {
    method: 'POST',
    headers: {Referer: SITE + '/'}
  });
  const url = downloadUrlFromReply(xml);
  if (!url) throw new Error('No download link for ' + fileId + ' (the page may have changed).');
  return url;
}

async function downloadTo(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('Download failed: ' + res.status);
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(file));
}

/** Install the Simulator for `version`, unless it is already there. */
async function setup(version: string): Promise<void> {
  const packages = parseSimulatorPage(await fetchText(PAGE_URL));
  const pkg = pickSimulatorPackage(packages, version, process.platform, process.arch);
  if (!pkg) {
    throw new Error('No webOS TV ' + version + ' Simulator for ' + process.platform + '/' +
      process.arch + ' on LG\'s download page.');
  }

  const dir = path.join(simulatorRoot(), unpackedDirName(pkg.name));
  if (fs.existsSync(dir)) {
    console.log('Already installed: ' + dir);
    return;
  }

  console.log('Downloading ' + pkg.name);
  const zip = path.join(os.tmpdir(), pkg.name);
  try {
    await downloadTo(await resolveDownloadUrl(pkg.fileId), zip);
    fs.mkdirSync(simulatorRoot(), {recursive: true});
    if (spawnSync('unzip', ['-q', '-o', zip, '-d', simulatorRoot()]).status !== 0) {
      fs.rmSync(dir, {recursive: true, force: true}); // never leave a half-unpacked Simulator behind
      throw new Error('Could not unpack ' + zip);
    }
  } finally {
    fs.rmSync(zip, {force: true});
  }
  console.log('Installed ' + dir + '\nRun `npm run sim` to launch Ember on it.');
}

/** Launch a built dist/ on the installed Simulator for `version`. */
function launch(version: string): void {
  const dir = installedDir(version);
  if (!dir) {
    throw new Error('No webOS TV ' + version + ' Simulator installed. Run `npm run sim:setup' +
      (version === DEFAULT_VERSION ? '' : ' -- ' + version) + '` first.');
  }
  const appDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(path.join(appDir, 'appinfo.json'))) {
    throw new Error('Nothing built in dist/. Run `npm run build` first.');
  }
  // -sp names the Simulator outright: it silences ares's LG_WEBOS_TV_SDK_HOME
  // warning and records the path, so a plain `ares-launch -s <version> dist` works later.
  const res = spawnSync('ares-launch', ['-sp', dir, '-s', version, appDir], {stdio: 'inherit'});
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error('ares-launch failed with status ' + res.status + '.');
}

async function main(): Promise<void> {
  const [first, second] = process.argv.slice(2);
  const action = first === 'setup' ? 'setup' : 'launch';
  const version = (first === 'setup' ? second : first) || DEFAULT_VERSION;
  if (!/^\d+$/.test(version)) {
    throw new Error('Expected a webOS TV year, got "' + version + '" (e.g. `npm run sim -- 22`).');
  }
  if (action === 'setup') await setup(version);
  else launch(version);
}

main().catch(function (err: Error) {
  console.error('error: ' + err.message);
  process.exit(1);
});
