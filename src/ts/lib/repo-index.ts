/**
 * The two documents that make up Ember's own Homebrew Channel repository, built
 * from the packed IPK. Pure: scripts/build-repo.ts (`npm run repo`) hashes the
 * IPK and writes the files, and test/repo-index.test.ts checks the shape
 * Homebrew Channel parses.
 *
 * The shape mirrors the official repo.webosbrew.org/api/apps.json, which is what
 * Homebrew Channel reads: an index whose package points at a manifest, with the
 * same manifest inlined so the details view renders without a second fetch.
 */

export interface RepoManifest {
  id: string;
  version: string;
  type: 'web';
  title: string;
  appDescription: string;
  iconUri: string;
  sourceUrl: string;
  rootRequired: boolean;
  ipkUrl: string;
  ipkHash: {sha256: string};
  ipkSize: number;
}

interface RepoPackage {
  id: string;
  title: string;
  iconUri: string;
  manifestUrl: string;
  manifest: RepoManifest;
  pool: 'main';
  shortDescription: string;
}

export interface RepoIndex {
  packages: RepoPackage[];
}

export interface RepoInput {
  id: string;
  version: string;
  title: string;
  /** The line under the title in Homebrew Channel. */
  tagline: string;
  /** Where the repository is served, e.g. https://anned20.github.io/ember. */
  baseUrl: string;
  /** The project's GitHub page: the source link, and the release the IPK is in. */
  sourceUrl: string;
  iconUri: string;
  /** The IPK's file name in the release, e.g. com.ember.launcher_0.4.0_all.ipk. */
  ipkFile: string;
  ipkSha256: string;
  ipkSize: number;
}

/**
 * The manifest's file name in the repository, for `id`.
 * @public — `scripts/build-repo.ts` requires it; knip cannot see require() bindings.
 */
export function manifestFileName(id: string): string {
  return id + '.manifest.json';
}

export function buildRepo(input: RepoInput): {manifest: RepoManifest; index: RepoIndex} {
  const base = input.baseUrl.replace(/\/+$/, '');

  const manifest: RepoManifest = {
    id: input.id,
    version: input.version,
    type: 'web',
    title: input.title,
    appDescription: input.tagline,
    iconUri: input.iconUri,
    sourceUrl: input.sourceUrl,
    // The app runs without root elevation, it only loses the app scan and the
    // Home / boot hooks, so the entry installs on any Homebrew Channel.
    rootRequired: false,
    // The IPK is a release asset, not a file next to the index: pinned to the
    // release's own tag (v<version>, the tag the workflow is triggered by) so
    // the manifest and the file it hashes stay in step.
    ipkUrl: input.sourceUrl + '/releases/download/v' + input.version + '/' + input.ipkFile,
    ipkHash: {sha256: input.ipkSha256},
    ipkSize: input.ipkSize
  };

  return {
    manifest,
    index: {
      packages: [
        {
          id: input.id,
          title: input.title,
          iconUri: input.iconUri,
          manifestUrl: base + '/' + manifestFileName(input.id),
          manifest,
          pool: 'main',
          shortDescription: input.tagline
        }
      ]
    }
  };
}
