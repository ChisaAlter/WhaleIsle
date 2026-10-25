import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimeManifest, stageAssets, auditAssets, MANIFEST, isDevelopmentFile } from './runtime-assets.mjs';

async function fixture(t) {
  const temp = await mkdtemp(resolve(tmpdir(), 'dshd-assets-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = resolve(temp, 'web');
  const output = resolve(temp, 'stage');
  const put = async (name, body) => {
    const path = resolve(source, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  };
  await put('index.html', '<link rel="stylesheet" href="./app.css?v=1"><script type="module" src="./app.js?v=1"></script>');
  await put('app.js', 'import { value } from "./nested/dep.js"; export const load = () => import("./nested/lazy.js"); console.log(value);');
  await put('nested/dep.js', 'export { value } from "./leaf.js";');
  await put('nested/leaf.js', 'export const value = 1;');
  await put('nested/lazy.js', 'export default 42;');
  await put('app.css', '@import "./tokens.css"; body { background: url("./image.svg"); }');
  await put('tokens.css', ':root { --x: red; }');
  await put('image.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const name of ['app.test.js', 'app.js.map', 'package.json', 'README.md', 'fake-client.mjs', 'chisacode/entry.mjs', 'unused.js']) await put(name, 'not runtime');
  await put('package.json', '{"type":"module"}');
  await put('app.test.js', 'export const testOnly = true;');
  return { source, output, put, temp };
}

test('deterministic graph retains static, lazy, re-export, CSS imports and image bytes only', async (t) => {
  const { source, output } = await fixture(t);
  const one = await stageAssets(source, output);
  const two = await stageAssets(source, output);
  assert.deepEqual(one, two);
  assert.deepEqual(one.files.map((file) => file.path), ['app.css', 'app.js', 'image.svg', 'index.html', 'nested/dep.js', 'nested/lazy.js', 'nested/leaf.js', 'tokens.css']);
  assert.equal((await auditAssets({ source, extracted: output })).pass, true);
  for (const file of one.files) assert.deepEqual(await readFile(resolve(output, file.path)), await readFile(resolve(source, file.path)));
});

test('audit rejects missing, modified, extra and stale-manifest files', async (t) => {
  const { source, output } = await fixture(t);
  await stageAssets(source, output);
  await unlink(resolve(output, 'nested/lazy.js'));
  await writeFile(resolve(output, 'tokens.css'), 'changed');
  await writeFile(resolve(output, 'app.test.js'), 'leaked');
  await writeFile(resolve(output, MANIFEST), '{}');
  const audit = await auditAssets({ source, extracted: output });
  assert.equal(audit.pass, false);
  assert.deepEqual(audit.missing, ['nested/lazy.js']);
  assert.deepEqual(audit.changed, [MANIFEST, 'tokens.css']);
  assert.deepEqual(audit.unexpected, ['app.test.js']);
});

test('restaging removes stale assets without changing source', async (t) => {
  const { source, output, put } = await fixture(t);
  await stageAssets(source, output);
  await put('app.js', 'console.log("new revision");');
  await stageAssets(source, output);
  await assert.rejects(readFile(resolve(output, 'nested/lazy.js')), { code: 'ENOENT' });
  assert.ok(await readFile(resolve(source, 'nested/lazy.js')));
  assert.equal((await auditAssets({ source, extracted: output })).pass, true);
});

for (const [name, code] of [
  ['missing static dependency', 'import "./missing.js";'],
  ['missing lazy dependency', 'export const load = () => import("./missing.js");'],
  ['extensionless browser import', 'import "./nested/dep";'],
  ['test imported by runtime', 'import "./app.test.js";'],
  ['bare package import', 'import "some-package";'],
  ['network import', 'import "https://example.com/code.js";'],
  ['unresolved dynamic import', 'export const load = (path) => import(path);'],
]) {
  test(`graph fails closed: ${name}`, async (t) => {
    const { source, put } = await fixture(t);
    await put('app.js', code);
    await assert.rejects(runtimeManifest(source));
  });
}

test('HTML references cannot escape the mount prefix', async (t) => {
  const { source, put } = await fixture(t);
  await put('index.html', '<script type="module" src="../app.js"></script>');
  await assert.rejects(runtimeManifest(source), /escapes runtime root/);
});

test('unsafe staging roots and non-staging directories are rejected', async (t) => {
  const { source, temp } = await fixture(t);
  await assert.rejects(stageAssets(source, source));
  await assert.rejects(stageAssets(source, resolve(source, 'output')));
  await assert.rejects(stageAssets(source, temp));
  const unrelated = resolve(temp, 'unrelated');
  await mkdir(unrelated);
  await writeFile(resolve(unrelated, 'user.txt'), 'preserve');
  await assert.rejects(stageAssets(source, unrelated));
  assert.equal(await readFile(resolve(unrelated, 'user.txt'), 'utf8'), 'preserve');
});

test('APK ZIP contents are decompressed and compared, known native assets are reported', async (t) => {
  const { source, temp } = await fixture(t);
  const archiveRoot = resolve(temp, 'archive');
  const assets = resolve(archiveRoot, 'assets');
  await stageAssets(source, assets);
  await mkdir(resolve(assets, 'dexopt'));
  await writeFile(resolve(assets, 'dexopt/baseline.prof'), 'native profile');
  const apk = resolve(temp, 'candidate.apk');
  const jar = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar') : 'jar';
  const zipped = spawnSync(jar, ['cf', apk, '-C', archiveRoot, 'assets'], { encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stderr || zipped.error?.message);
  const audit = await auditAssets({ source, apk });
  assert.equal(audit.pass, true);
  assert.deepEqual(audit.nativeAssets, ['dexopt/baseline.prof']);
  assert.match(audit.apkSha256, /^[a-f0-9]{64}$/);
});

test('actual Web runtime stages the canonical brand image and only runtime dependencies', async () => {
  const { manifest } = await runtimeManifest();
  const names = manifest.files.map((file) => file.path);
  assert.ok(names.includes('chisacode/daemon-client.bundle.js'));
  assert.ok(names.includes('host/catalog.js'));
  assert.ok(names.includes('git/stack.js'));
  assert.ok(names.includes('assets/whale-head.png'));
  assert.deepEqual(await readFile(new URL('../../mobile/web/assets/whale-head.png', import.meta.url)), await readFile(new URL('../../assets/whale-head.png', import.meta.url)));
  assert.ok(!names.some(isDevelopmentFile));
});
