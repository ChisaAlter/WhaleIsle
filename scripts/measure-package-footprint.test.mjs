import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'measure-package-footprint.mjs');

/**
 * Build a minimal Chromium Pickle `app.asar` file in memory and write it to disk.
 * @param {string} dest
 * @param {Record<string, unknown>} tree
 * @param {Buffer[]} chunks
 */
function writeSyntheticAsar(dest, tree, chunks) {
  const jsonBuf = Buffer.from(JSON.stringify({ files: tree }), 'utf8');
  const innerSize = 4 + ((jsonBuf.length + 3) & ~3);
  const headerBuf = Buffer.alloc(16 + ((jsonBuf.length + 3) & ~3));
  headerBuf.writeUInt32LE(4, 0);
  headerBuf.writeUInt32LE(4 + innerSize, 4);
  headerBuf.writeUInt32LE(innerSize, 8);
  headerBuf.writeUInt32LE(jsonBuf.length, 12);
  jsonBuf.copy(headerBuf, 16);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.concat([headerBuf, ...chunks]));
}

/**
 * Build a 512-byte ustar tar header block.
 * @param {string} name
 * @param {number} size
 * @param {string} typeflag
 */
function makeTarHeader(name, size, typeflag = '0') {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 'utf8');
  block.write('0000644\0', 100, 'ascii');
  block.write('0000000\0', 108, 'ascii');
  block.write('0000000\0', 116, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  block.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 'ascii');
  block.fill(0x20, 148, 156);
  block.write(typeflag, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += block[i];
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

/** @param {Array<{ name: string; data: Buffer; kind?: 'normal' | 'pax' | 'gnuL' }>} entries */
function buildTarBuffer(entries) {
  /** @type {Buffer[]} */
  const parts = [];
  for (const item of entries) {
    if (item.kind === 'pax') {
      const recBody = `path=${item.name}\n`;
      let totalLen = recBody.length + 3;
      while (String(totalLen).length + 1 + recBody.length !== totalLen) {
        totalLen = String(totalLen).length + 1 + recBody.length;
      }
      const paxPayload = Buffer.from(`${totalLen} ${recBody}`, 'utf8');
      parts.push(makeTarHeader('PaxHeaders/long', paxPayload.length, 'x'));
      parts.push(paxPayload, Buffer.alloc((512 - (paxPayload.length % 512)) % 512));
      parts.push(makeTarHeader('short_fallback', item.data.length, '0'));
    } else if (item.kind === 'gnuL') {
      const namePayload = Buffer.from(`${item.name}\0`, 'utf8');
      parts.push(makeTarHeader('././@LongLink', namePayload.length, 'L'));
      parts.push(namePayload, Buffer.alloc((512 - (namePayload.length % 512)) % 512));
      parts.push(makeTarHeader(item.name.slice(0, 90), item.data.length, '0'));
    } else {
      parts.push(makeTarHeader(item.name, item.data.length, '0'));
    }
    parts.push(item.data, Buffer.alloc((512 - (item.data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** @param {string} root */
function snapshotTree(root) {
  /** @type {string[]} */
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const st = fs.lstatSync(full);
      const rel = path.relative(root, full).replaceAll('\\', '/');
      if (st.isSymbolicLink()) {
        rows.push(`L:${rel}`);
      } else if (st.isDirectory()) {
        rows.push(`D:${rel}`);
        walk(full);
      } else {
        rows.push(`F:${rel}:${st.size}:${Math.trunc(st.mtimeMs)}`);
      }
    }
  };
  walk(root);
  return rows;
}

/** @param {string[]} args */
function runMeasure(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('counts all 4 layers without double-counting asarUnpack, handles pax + GNU long tar names, and exits 2 if unpacked missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footprint-4layer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appDir = path.join(root, 'pkg');
  const resDir = path.join(appDir, 'resources');
  const unpackedDir = path.join(resDir, 'app.asar.unpacked');
  fs.mkdirSync(path.join(unpackedDir, 'src', 'main'), { recursive: true });
  fs.mkdirSync(path.join(resDir, 'vendor'), { recursive: true });
  fs.mkdirSync(path.join(resDir, 'runtime', 'office-skills', 'docx'), { recursive: true });

  fs.writeFileSync(path.join(appDir, 'WhaleIsle.exe'), Buffer.alloc(1000, 1));

  const asarNormalBuf = Buffer.alloc(500, 2);
  const asarSha = crypto.createHash('sha256').update(asarNormalBuf).digest('hex');
  const unpackedPayload = Buffer.alloc(750, 3);
  fs.writeFileSync(path.join(unpackedDir, 'src', 'main', 'dsh-cli-runner.mjs'), unpackedPayload);

  writeSyntheticAsar(
    path.join(resDir, 'app.asar'),
    {
      src: {
        files: {
          renderer: {
            files: {
              'index.html': { size: asarNormalBuf.length, offset: '0', integrity: { algorithm: 'SHA256', hash: asarSha } },
            },
          },
          main: {
            files: {
              'dsh-cli-runner.mjs': { size: unpackedPayload.length, unpacked: true },
            },
          },
        },
      },
    },
    [asarNormalBuf],
  );

  const paxName = `node_modules/@deepseek-ai/dsh-web-frontend/${'nested-dir/'.repeat(9)}bundle.js`;
  const gnuName = `node_modules/${'very-long-package-segment/'.repeat(5)}index.mjs`;
  fs.writeFileSync(
    path.join(resDir, 'vendor', 'deepseek-harness.tar'),
    buildTarBuffer([
      { name: paxName, data: Buffer.alloc(1200, 4), kind: 'pax' },
      { name: gnuName, data: Buffer.alloc(800, 5), kind: 'gnuL' },
    ]),
  );

  fs.writeFileSync(path.join(resDir, 'runtime', 'office-skills', 'docx', 'SKILL.md'), Buffer.alloc(250, 6));

  const outJson = path.join(root, 'report.json');
  const res = runMeasure(['--input', appDir, '--target', 'win32-x64', '--out', outJson]);
  assert.equal(res.status, 0, res.stderr);

  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(report.totals.byLayer.base.bytes, 1000);
  assert.equal(report.totals.byLayer.asar.files, 1);
  assert.equal(report.totals.byLayer.asar.bytes, 500, 'unpacked: true leaf must NOT be counted in asar');
  assert.equal(report.totals.byLayer['asar-unpacked'].files, 1);
  assert.equal(report.totals.byLayer['asar-unpacked'].bytes, 750);
  assert.equal(report.totals.byLayer.tar.files, 2);
  assert.equal(report.totals.byLayer.tar.bytes, 2000);
  assert.equal(report.totals.byLayer.res.files, 1);
  assert.equal(report.totals.byLayer.res.bytes, 250);
  assert.equal(report.totals.bytes, 4500);

  const byId = Object.fromEntries(report.components.map((c) => [c.id, c]));
  assert.equal(byId['harness-web-frontend'].bytes, 1200);
  assert.equal(byId['harness-runtime-other'].bytes, 800);
  assert.equal(byId['office-kit-native'].bytes, 250);

  fs.rmSync(path.join(unpackedDir, 'src', 'main', 'dsh-cli-runner.mjs'));
  const missingRes = runMeasure(['--input', appDir, '--target', 'win32-x64']);
  assert.equal(missingRes.status, 2);
});

test('forbidden match returns exit 1 and lists exact logical paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footprint-forbidden-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appDir = path.join(root, 'pkg');
  const resDir = path.join(appDir, 'resources');
  fs.mkdirSync(path.join(resDir, 'vendor'), { recursive: true });
  writeSyntheticAsar(path.join(resDir, 'app.asar'), {}, []);
  fs.writeFileSync(
    path.join(resDir, 'vendor', 'deepseek-harness.tar'),
    buildTarBuffer([{ name: 'node_modules/@deepseek-ai/libreoffice-kit-wasm/soffice.wasm', data: Buffer.alloc(64, 7) }]),
  );

  const outJson = path.join(root, 'report.json');
  const res = runMeasure(['--input', appDir, '--target', 'win32-x64', '--out', outJson]);
  assert.equal(res.status, 1);
  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.deepEqual(
    report.forbidden.map((f) => f.path),
    ['tar/node_modules/@deepseek-ai/libreoffice-kit-wasm/soffice.wasm'],
  );
});

test('detects cross-layer >= 256 KiB duplicate files across asar and tar', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footprint-dup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appDir = path.join(root, 'pkg');
  const resDir = path.join(appDir, 'resources');
  fs.mkdirSync(path.join(resDir, 'vendor'), { recursive: true });

  const payload = crypto.randomBytes(300 * 1024);
  writeSyntheticAsar(
    path.join(resDir, 'app.asar'),
    {
      src: {
        files: {
          renderer: {
            files: {
              'dup.bin': { size: payload.length, offset: '0' },
            },
          },
        },
      },
    },
    [payload],
  );
  fs.writeFileSync(
    path.join(resDir, 'vendor', 'deepseek-harness.tar'),
    buildTarBuffer([{ name: 'apps/cli/dup.bin', data: payload }]),
  );

  const outJson = path.join(root, 'report.json');
  const res = runMeasure(['--input', appDir, '--target', 'win32-x64', '--out', outJson]);
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].wastedBytes, 300 * 1024);
  assert.deepEqual(report.duplicates[0].paths, ['asar/src/renderer/dup.bin', 'tar/apps/cli/dup.bin']);
});

test('computes baseline deltas and enforces ratchet maxBytes boundary (equal pass, +1B fail)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footprint-budget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appDir = path.join(root, 'pkg');
  const resDir = path.join(appDir, 'resources');
  fs.mkdirSync(resDir, { recursive: true });
  writeSyntheticAsar(
    path.join(resDir, 'app.asar'),
    {
      src: {
        files: {
          renderer: {
            files: {
              'app.js': { size: 1000, offset: '0' },
            },
          },
        },
      },
    },
    [Buffer.alloc(1000, 9)],
  );

  const baselinePath = path.join(root, 'baseline.json');
  const rec = runMeasure(['--input', appDir, '--target', 'win32-x64', '--record-baseline', baselinePath]);
  assert.equal(rec.status, 0, rec.stderr);

  const exactBudgetsPath = path.join(root, 'budgets-ok.json');
  fs.writeFileSync(
    exactBudgetsPath,
    JSON.stringify({
      'win32-x64': {
        totalBytes: 1000,
        maxUnclassifiedBytes: 0,
        maxDuplicateBytes: 0,
        components: { 'whale-ui-renderer': { maxBytes: 1000 } },
      },
    }),
  );

  const outJson = path.join(root, 'delta.json');
  const passRes = runMeasure([
    '--input', appDir,
    '--target', 'win32-x64',
    '--baseline', baselinePath,
    '--budgets', exactBudgetsPath,
    '--out', outJson,
  ]);
  assert.equal(passRes.status, 0, passRes.stderr);
  const deltaReport = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  const comp = deltaReport.components.find((c) => c.id === 'whale-ui-renderer');
  assert.equal(comp.deltaBytes, 0);

  const tightBudgetsPath = path.join(root, 'budgets-fail.json');
  fs.writeFileSync(
    tightBudgetsPath,
    JSON.stringify({
      'win32-x64': {
        totalBytes: 1000,
        components: { 'whale-ui-renderer': { maxBytes: 999 } },
      },
    }),
  );
  const failRes = runMeasure(['--input', appDir, '--target', 'win32-x64', '--budgets', tightBudgetsPath]);
  assert.equal(failRes.status, 1);
});

test('exits with code 2 on corrupt tar header', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footprint-corrupt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appDir = path.join(root, 'pkg');
  const resDir = path.join(appDir, 'resources');
  fs.mkdirSync(path.join(resDir, 'vendor'), { recursive: true });
  writeSyntheticAsar(path.join(resDir, 'app.asar'), {}, []);
  const corrupt = Buffer.alloc(1024, 0x41);
  fs.writeFileSync(path.join(resDir, 'vendor', 'deepseek-harness.tar'), corrupt);

  const res = runMeasure(['--input', appDir, '--target', 'win32-x64']);
  assert.equal(res.status, 2);
});

test('skips directory junctions or symlinks escaping input root and performs zero writes to input', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footprint-readonly-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outsideDir = path.join(root, 'outside');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'secret-big.bin'), Buffer.alloc(2 * 1024 * 1024, 5));

  const appDir = path.join(root, 'pkg');
  const resDir = path.join(appDir, 'resources');
  fs.mkdirSync(resDir, { recursive: true });
  writeSyntheticAsar(path.join(resDir, 'app.asar'), {}, []);
  fs.writeFileSync(path.join(resDir, 'local.txt'), Buffer.alloc(128, 3));

  const linkPath = path.join(resDir, 'escape-link');
  let linkCreated = false;
  try {
    fs.symlinkSync(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    linkCreated = true;
  } catch {
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'mklink', '/J', linkPath, outsideDir], { stdio: 'ignore' });
      linkCreated = true;
    }
  }
  assert.equal(linkCreated, true);

  const beforeSnap = snapshotTree(appDir);
  const outJson = path.join(root, 'report.json');
  const mdOut = path.join(root, 'summary.md');
  const res = runMeasure(['--input', appDir, '--target', 'win32-x64', '--out', outJson, '--markdown', mdOut]);
  assert.equal(res.status, 0, res.stderr);

  const afterSnap = snapshotTree(appDir);
  assert.deepEqual(afterSnap, beforeSnap, 'footprint scanner must never mutate or create files inside --input');
  assert.equal(fs.existsSync(mdOut), true);

  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(report.totals.bytes, 128, 'external bytes reachable via junction must not be counted');
});
