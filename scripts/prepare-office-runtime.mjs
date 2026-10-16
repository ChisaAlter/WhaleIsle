#!/usr/bin/env node
/**
 * Build the locked Windows x64 Office payload used by the packaged desktop:
 * vendor/deepseek-harness/scripts/primary-runtime/prepare.ts downloads the
 * pinned Node/Python archives and wheels (SHA-256 verified against
 * scripts/primary-runtime/lock.json), then materializes
 *
 *   build/office-runtime/primary-runtime/   manifest + interpreters
 *   build/office-runtime/office-skills/     skill-office assets
 *
 * after-pack ships both as resources/runtime/{primary-runtime,office-skills}
 * and asserts them. The download cache (build/office-runtime-cache) is
 * sha-addressed, so reruns only fetch missing archives. `--smoke` executes
 * the payload's own interpreters (the upstream smoke suite).
 *
 *   node scripts/prepare-office-runtime.mjs [--smoke]
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICE_SKILL_FOLDERS } from '../src/main/office-runtime.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = join(root, 'vendor', 'deepseek-harness');
const output = join(root, 'build', 'office-runtime');
const cache = join(root, 'build', 'office-runtime-cache');
const tsx = join(vendorRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.CMD' : 'tsx');

if (!existsSync(join(vendorRoot, 'node_modules'))) {
  console.error('vendor/deepseek-harness 依赖未安装，请先运行 npm run setup:harness');
  process.exit(1);
}
if (!existsSync(tsx)) {
  console.error(`缺少 tsx：${tsx}`);
  process.exit(1);
}
mkdirSync(output, { recursive: true });
mkdirSync(cache, { recursive: true });

const prepare = spawnSync(tsx, [
  join(vendorRoot, 'scripts', 'primary-runtime', 'prepare.ts'),
  '--target', 'win-x64',
  '--output', output,
  '--cache', cache,
], { cwd: vendorRoot, stdio: 'inherit', shell: process.platform === 'win32' });
if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1);
}

const payload = join(output, 'primary-runtime');
const manifest = JSON.parse(readFileSync(join(payload, 'runtime.json'), 'utf8'));
for (const required of [
  join(payload, 'dependencies', 'node', 'bin', 'node.exe'),
  ...OFFICE_SKILL_FOLDERS.map((name) => join(output, 'office-skills', name, 'SKILL.md')),
]) {
  if (!existsSync(required)) {
    console.error(`Office 运行时产物缺失：${required}`);
    process.exit(1);
  }
}
console.log(`Office 运行时就绪：platform=${manifest.platform}/${manifest.arch}`
  + ` node=${manifest.node} python=${manifest.python} pnpm=${manifest.pnpm ?? 'none'}`
  + ` digest=${manifest.payloadDigest}`);

if (process.argv.includes('--smoke')) {
  // Mirror the upstream smoke suite against the built payload (host is
  // win-x64 in CI/package flows; cross-target smoke is meaningless).
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    console.error(`--smoke 仅能在 ${manifest.platform}/${manifest.arch} 主机上执行`);
    process.exit(1);
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)),
  );
  const python = join(payload, 'dependencies', 'python', 'python.exe');
  const node = join(payload, 'dependencies', 'node', 'bin', 'node.exe');
  const options = { stdio: 'inherit', timeout: 120_000, env };
  execFileSync(python, ['-I', '-B', '-c',
    'import decimal, xml.parsers.expat, lzma, uuid, numpy, pandas;'
    + ' assert numpy.arange(4).sum() == 6; assert pandas.DataFrame({"n": [1, 2]}).n.sum() == 3'], options);
  execFileSync(python, ['-I', '-B', '-m', 'pip', 'check'], options);
  execFileSync(node, ['-e', `if (process.versions.node !== ${JSON.stringify(manifest.node)}) process.exit(1)`], options);
  // Evidence for the adoption ledger: sha256 of the payload manifest.
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(readFileSync(join(payload, 'runtime.json'))).digest('hex');
  const evidence = {
    generatedAt: new Date().toISOString(),
    manifestSha256: digest,
    manifest,
  };
  writeFileSync(join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`smoke 通过；证据写入 ${join(output, 'evidence.json')}`);
}
