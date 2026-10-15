#!/usr/bin/env node
//
// Render the brand values from src/ts/lib/brand.ts into the generated module
// the shipped shell scripts read. Run with `npm run brand`.
// test/brand.test.ts fails if the committed file drifts from the source.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const {BRAND} = require('../src/ts/lib/brand.ts') as {
  BRAND: import('../src/ts/lib/brand.ts').Brand;
};
const {renderBrandShell, BRAND_SHELL_PATH} = require(
  '../src/ts/lib/brand-codegen.ts'
) as {
  renderBrandShell: (brand: import('../src/ts/lib/brand.ts').Brand) => string;
  BRAND_SHELL_PATH: string;
};

function write(rel: string, text: string) {
  const file = path.join(root, rel);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (before !== text) fs.writeFileSync(file, text);
  return before !== text;
}

const changed = write(BRAND_SHELL_PATH, renderBrandShell(BRAND));

console.log('Brand module ' + (changed ? 'updated' : 'already current') +
  ': ' + BRAND_SHELL_PATH);
