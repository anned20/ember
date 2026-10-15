/**
 * Parsing for LG's Simulator download page. Pure, so scripts/simulator.ts
 * (`npm run sim:setup`) can read the page and test/simulator-download.test.ts
 * can check what it makes of it.
 *
 * There is no plain download URL to link to: the page's buttons POST a file id
 * to /api/downloadSDK and trade the reply for a signed gfts.lge.com link, which
 * is the only thing that serves the .zip. The ids change every release, so they
 * are read from the page rather than pinned here.
 */

export interface SimulatorPackage {
  /** e.g. webOS_TV_25_Simulator_1.4.4_mac-arm64.zip */
  name: string;
  fileId: string;
}

/** The packages the download page offers, in page order. */
export function parseSimulatorPage(html: string): SimulatorPackage[] {
  const packages: SimulatorPackage[] = [];
  // The page ships its file list as JSON, name and id adjacent.
  const entry = /"fileName":"([^"]+\.zip)","fileId":"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(html)) !== null) {
    packages.push({name: match[1], fileId: match[2]});
  }
  return packages;
}

/**
 * The package for `version` on this OS and chip, or null when the page has
 * none. On Apple silicon the arm64 build is preferred: several versions ship
 * both an x64 `_mac` and an `_mac-arm64` package, and newer ones ship only
 * `_mac`, which is arm64.
 */
export function pickSimulatorPackage(
  packages: SimulatorPackage[],
  version: string,
  platform: string,
  arch: string
): SimulatorPackage | null {
  const prefix = 'webOS_TV_' + version + '_Simulator_';
  const suffixes = platform === 'darwin'
    ? (arch === 'arm64' ? ['mac-arm64', 'mac'] : ['mac'])
    : platform === 'win32' ? ['win'] : ['linux'];
  for (const suffix of suffixes) {
    const found = packages.find(function (pkg) {
      return pkg.name.indexOf(prefix) === 0 && pkg.name.endsWith('_' + suffix + '.zip');
    });
    if (found) return found;
  }
  return null;
}

/** The directory a package unpacks to, e.g. webOS_TV_25_Simulator_1.4.4. */
export function unpackedDirName(packageName: string): string {
  return packageName.replace(/_(?:mac-arm64|mac|linux|win)\.zip$/, '');
}

/** The signed download link in the file-path service's XML reply, or null. */
export function downloadUrlFromReply(xml: string): string | null {
  const match = xml.match(/gftsUrl="([^"]+)"/);
  return match ? match[1].replace(/&amp;/g, '&') : null;
}
