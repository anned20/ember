import {describe, expect, it} from 'vitest';
import brandShell from '../scripts/brand.sh?raw';
import brandPython from '../voice/daemon/brand.py?raw';
import mainAppinfo from '../appinfo.json?raw';
import voiceAppinfo from '../voice/overlay/appinfo.json?raw';
import {BRAND} from '@lib/brand.js';
import {renderBrandPython, renderBrandShell} from '@lib/brand-codegen.js';

// The generated modules the shipped shell scripts and the Python daemon read
// are committed. They must be re-rendered from src/ts/lib/brand.ts whenever it
// changes: run `npm run brand`.
describe('generated brand modules', () => {
  it('scripts/brand.sh matches src/ts/lib/brand.ts', () => {
    expect(brandShell).toBe(renderBrandShell(BRAND));
  });

  it('voice/daemon/brand.py matches src/ts/lib/brand.ts', () => {
    expect(brandPython).toBe(renderBrandPython(BRAND));
  });

  it('the source manifests carry the brand identity', () => {
    const main = JSON.parse(mainAppinfo);
    expect(main.id).toBe(BRAND.appId);
    expect(main.title).toBe(BRAND.name);
    expect(main.vendor).toBe(BRAND.vendor);
    expect(main.appDescription).toBe(BRAND.tagline);

    const voice = JSON.parse(voiceAppinfo);
    expect(voice.id).toBe(BRAND.voiceAppId);
    expect(voice.title).toBe(BRAND.voiceName);
    expect(voice.vendor).toBe(BRAND.vendor);
    expect(voice.appDescription).toBe(BRAND.voiceTagline);
  });
});
