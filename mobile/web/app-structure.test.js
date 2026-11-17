import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(webDir, 'app');
const appFiles = existsSync(appDir)
  ? readdirSync(appDir).filter((f) => f.endsWith('.js')).sort()
  : [];
const sources = new Map(
  ['app.js', ...appFiles.map((f) => join('app', f))].map((f) => [
    f,
    readFileSync(join(webDir, f), 'utf8'),
  ]),
);
const indexHtml = readFileSync(join(webDir, 'index.html'), 'utf8');

// #442: the monolith is split by page/feature; no single file may grow back
// past the 800-line ceiling the split guarantees.
test('app.js and every mobile/web/app module stay within the 800-line ceiling', () => {
  assert.ok(appFiles.length > 0, 'expected split modules under mobile/web/app/');
  const oversized = [...sources.entries()]
    .map(([f, text]) => [f, text.split('\n').length - 1])
    .filter(([, lines]) => lines > 800);
  assert.deepEqual(oversized, []);
});

// Split modules must keep using the same DOM ids; a typo in a moved el() call
// silently renders nothing, so pin every literal lookup against index.html.
test('every literal el() id used by the app exists in index.html', () => {
  const ids = new Set();
  for (const text of sources.values()) {
    for (const m of text.matchAll(/\bel\('([^']+)'\)/g)) ids.add(m[1]);
  }
  const missing = [...ids].filter((id) => !indexHtml.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

// Storage keys are part of the user-data contract; the split must not rename
// or drop any of them.
test('phone preference storage keys are unchanged', () => {
  const text = [...sources.values()].join('\n');
  const keys = [...text.matchAll(/'(dsh-phone-[a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), [
    'dsh-phone-enter-send',
    'dsh-phone-expand-tools',
    'dsh-phone-git-title',
    'dsh-phone-glass',
    'dsh-phone-message-scale',
    'dsh-phone-running-send',
    'dsh-phone-scheme',
    'dsh-phone-show-reasoning',
    'dsh-phone-ui-font',
  ]);
});

// deploy-dshd-public-spa.mjs stamps ?v= on every relative module specifier;
// sibling imports inside app/*.js also carry the source-level stamp used by
// index.html so installed clients cannot mix a new parent with an old child.
test('split modules only import resolvable files and keep ?v= stamps on sibling modules', () => {
  assert.ok(appFiles.length > 0, 'expected split modules under mobile/web/app/');
  for (const f of appFiles) {
    const text = sources.get(join('app', f));
    for (const m of text.matchAll(/from '([^']+)'|import\('([^']+)'\)/g)) {
      const spec = m[1] || m[2];
      assert.match(spec, /^\.{1,2}\//, `${f}: unexpected bare specifier ${spec}`);
      const [path, query] = spec.split('?v=');
      const target = join(appDir, path);
      assert.ok(existsSync(target), `${f}: ${spec} does not resolve inside mobile/web`);
      if (path.startsWith('./')) assert.ok(query, `${f}: sibling import ${spec} missing ?v= stamp`);
    }
  }
});
