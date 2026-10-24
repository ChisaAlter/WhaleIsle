import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Compile the same desktop-side relay source used by the product; keep the
// independent JS observer out of Android production dependencies and the APK.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
await build({
  entryPoints: [resolve(root, 'vendor/chisacode-remote/packages/relay/src/e2ee.ts')],
  outfile: fileURLToPath(new URL('../build/test-peer/e2ee.mjs', import.meta.url)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  nodePaths: [fileURLToPath(new URL('./node_modules', import.meta.url))],
  packages: 'bundle',
  external: ['node:crypto'],
});
