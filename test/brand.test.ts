import {describe, expect, it} from 'vitest';
import brandShell from '../scripts/brand.sh?raw';
import mainAppinfo from '../appinfo.json?raw';
import {BRAND} from '@lib/brand.js';
import {renderBrandShell} from '@lib/brand-codegen.js';

// The generated module the shipped shell scripts read is committed. It must be
// re-rendered from src/ts/lib/brand.ts whenever it changes: run `npm run brand`.
describe('generated brand module', () => {
  it('scripts/brand.sh matches src/ts/lib/brand.ts', () => {
    expect(brandShell).toBe(renderBrandShell(BRAND));
  });

  it('the source manifest carries the brand identity', () => {
    const main = JSON.parse(mainAppinfo);
    expect(main.id).toBe(BRAND.appId);
    expect(main.title).toBe(BRAND.name);
    expect(main.vendor).toBe(BRAND.vendor);
    expect(main.appDescription).toBe(BRAND.tagline);
  });
});
