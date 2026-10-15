#!/usr/bin/env node

// Ember's own Homebrew Channel repository: `npm run repo`, after `npm run pack`,
// writes the site the release workflow publishes to GitHub Pages into dist/repo.
//
// A TV adds the index once (Homebrew Channel -> Settings -> Add repository),
// then installs and updates Ember from it. The shapes live in
// src/ts/lib/repo-index.ts; this script only hashes the IPK and writes files.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {buildRepo, manifestFileName} =
  require('../src/ts/lib/repo-index.ts') as typeof import('../src/ts/lib/repo-index.ts');
const {BRAND} = require('../src/ts/lib/brand.ts') as {
  BRAND: typeof import('../src/ts/lib/brand.ts').BRAND;
};
const {readVersion} = require('./read-version.ts') as {readVersion: (filePath?: string) => string};

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const site = path.join(dist, 'repo');

// The repository's public addresses. The index must never move: every TV keeps
// the URL its owner pasted. A fork overrides the first one with `--base`.
const DEFAULT_BASE_URL = 'https://anned20.github.io/ember';
const SOURCE_URL = 'https://github.com/' + BRAND.repo;
const ICON_URL = 'https://raw.githubusercontent.com/' + BRAND.repo + '/main/assets/icon-130-v9.png';

function argValue(name: string): string | undefined {
  const arg = process.argv.find((value) => value.indexOf(name + '=') === 0);
  return arg && arg.slice(name.length + 1);
}

function write(dir: string, name: string, doc: unknown) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(doc, null, 2) + '\n');
}

/** For a browser: the bare Pages URL is otherwise GitHub's 404. */
function landingPage(baseUrl: string) {
  const indexUrl = baseUrl.replace(/\/+$/, '') + '/apps.json';
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ember — Homebrew Channel repository</title>
<style>
  body { margin: 0 auto; max-width: 40rem; padding: 3rem 1.5rem;
         background: #0f3d4a; color: #f4efe6;
         font: 1rem/1.6 -apple-system, system-ui, sans-serif; }
  h1 { margin: 0 0 .25rem; }
  p { margin: 1.25rem 0; }
  code { background: rgba(255, 255, 255, .12); padding: .2rem .4rem; border-radius: .25rem; }
</style>
<h1>Ember</h1>
<p>Add this address under <strong>Homebrew Channel → Settings → Add repository</strong>:</p>
<p><code>${indexUrl}</code></p>
<p>Ember then appears in Homebrew Channel's app list, installs on the TV and updates in place.</p>
</body>
</html>
`;
}

function main() {
  const version = readVersion();
  const ipkFile = BRAND.appId + '_' + version + '_all.ipk';
  const ipkPath = path.join(dist, ipkFile);
  if (!fs.existsSync(ipkPath)) {
    throw new Error('Missing ' + ipkPath + ' — run `npm run pack` first.');
  }

  const ipk = fs.readFileSync(ipkPath);
  const baseUrl = argValue('--base') || DEFAULT_BASE_URL;
  const {manifest, index} = buildRepo({
    id: BRAND.appId,
    version: version,
    title: BRAND.name,
    tagline: BRAND.tagline,
    baseUrl: baseUrl,
    sourceUrl: SOURCE_URL,
    iconUri: ICON_URL,
    ipkFile: ipkFile,
    ipkSha256: crypto.createHash('sha256').update(ipk).digest('hex'),
    ipkSize: ipk.length
  });

  fs.rmSync(site, {recursive: true, force: true});
  fs.mkdirSync(site, {recursive: true});
  write(site, 'apps.json', index);
  write(site, manifestFileName(BRAND.appId), manifest);
  fs.writeFileSync(path.join(site, 'index.html'), landingPage(baseUrl));

  console.log('Wrote dist/repo/ for ' + BRAND.name + ' ' + version);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
