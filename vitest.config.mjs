import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {defineConfig} from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

// Keep in sync with the "paths" aliases in tsconfig.json and the "alias" map
// in scripts/build.ts.
const alias = {
  '@apps': path.join(root, 'src/ts/apps'),
  '@background': path.join(root, 'src/ts/background'),
  '@music': path.join(root, 'src/ts/music'),
  '@voice': path.join(root, 'src/ts/voice'),
  '@settings': path.join(root, 'src/ts/settings'),
  '@focus': path.join(root, 'src/ts/focus'),
  '@home': path.join(root, 'src/ts/home'),
  '@config': path.join(root, 'src/ts/config'),
  '@luna': path.join(root, 'src/ts/luna'),
  '@lib': path.join(root, 'src/ts/lib')
};

export default defineConfig({
  resolve: {alias},
  define: {
    // Injected by scripts/build.ts for the real bundle.
    __EMBER_VERSION__: JSON.stringify('0.0.0-test')
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom'
  }
});
