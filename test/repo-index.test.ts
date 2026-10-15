import {describe, expect, it} from 'vitest';
import {buildRepo, type RepoInput} from '@lib/repo-index.js';

// Homebrew Channel parses these documents itself (its BrowserPanel reads
// `packages[]`, DetailsPanel reads the manifest), so the values here are what a
// TV sees: the repository is served from Pages, the icon from the default
// branch, and the IPK from the release.
const input: RepoInput = {
  id: 'com.ember.launcher',
  version: '1.2.3',
  title: 'Ember',
  tagline: 'Warm, bright, yours.',
  baseUrl: 'https://anned20.github.io/ember',
  sourceUrl: 'https://github.com/anned20/ember',
  iconUri: 'https://raw.githubusercontent.com/anned20/ember/main/assets/icon-130-v8.png',
  ipkFile: 'com.ember.launcher_1.2.3_all.ipk',
  ipkSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ipkSize: 1234567
};

describe('Homebrew Channel repository', () => {
  it('lists one package pointing at the manifest on the repository', () => {
    const {index} = buildRepo(input);

    expect(index.packages).toHaveLength(1);
    expect(index.packages[0].id).toBe('com.ember.launcher');
    expect(index.packages[0].title).toBe('Ember');
    expect(index.packages[0].manifestUrl).toBe('https://anned20.github.io/ember/com.ember.launcher.manifest.json');
    expect(index.packages[0].iconUri).toBe(input.iconUri);
    expect(index.packages[0].shortDescription).toBe('Warm, bright, yours.');
    expect(index.packages[0].pool).toBe('main');
  });

  it('carries the whole manifest in the index, so nothing has to be fetched twice', () => {
    const {manifest, index} = buildRepo(input);
    expect(index.packages[0].manifest).toEqual(manifest);
  });

  it('describes the packed IPK', () => {
    const {manifest} = buildRepo(input);

    expect(manifest).toMatchObject({
      id: 'com.ember.launcher',
      version: '1.2.3',
      type: 'web',
      title: 'Ember',
      appDescription: 'Warm, bright, yours.',
      sourceUrl: 'https://github.com/anned20/ember',
      rootRequired: false
    });
    expect(manifest.ipkUrl).toBe('https://github.com/anned20/ember/releases/download/v1.2.3/com.ember.launcher_1.2.3_all.ipk');
    expect(manifest.ipkHash).toEqual({sha256: input.ipkSha256});
    expect(manifest.ipkSize).toBe(1234567);
  });

  it('takes the repository URL with or without a trailing slash', () => {
    const plain = buildRepo(input).index.packages[0].manifestUrl;
    const slashed = buildRepo({...input, baseUrl: input.baseUrl + '/'}).index.packages[0].manifestUrl;
    expect(slashed).toBe(plain);
  });

  it('follows the version it is given, so the manifest cannot describe an older IPK', () => {
    const {manifest, index} = buildRepo({...input, version: '2.0.0', ipkFile: 'com.ember.launcher_2.0.0_all.ipk'});

    expect(manifest.version).toBe('2.0.0');
    expect(manifest.ipkUrl).toContain('/v2.0.0/');
    expect(index.packages[0].manifest).toEqual(manifest);
  });
});
