import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { nodeDistSha256, verifyNodeDistArchive, downloadSelfContainedNode } = require('./after-pack.js');

const version = '99.0.0';
const tuple = `node-v${version}-${process.platform}-${process.arch}`;
const archiveName = `${tuple}.tar.gz`;

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fixtureArchive(dir) {
  const src = join(dir, 'src');
  mkdirSync(join(src, tuple, 'bin'), { recursive: true });
  writeFileSync(join(src, tuple, 'bin', 'node'), 'stub-node');
  const archive = join(dir, archiveName);
  execFileSync('tar', ['-czf', archive, '-C', src, `${tuple}/bin/node`]);
  return readFileSync(archive);
}

// A file:// mirror exercises the real curl download path without a network
// listener — downloadSelfContainedNode shells out synchronously, so an
// in-process HTTP server would deadlock against the blocked event loop.
function withMirror(t, dir) {
  const previous = process.env.DSH_NODE_DIST_MIRROR;
  process.env.DSH_NODE_DIST_MIRROR = pathToFileURL(dir).href;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_NODE_DIST_MIRROR;
    else process.env.DSH_NODE_DIST_MIRROR = previous;
  });
}

function distDir(root, payload, shasumsDigest) {
  const dist = join(root, 'dist', `v${version}`);
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, archiveName), payload);
  writeFileSync(join(dist, 'SHASUMS256.txt'), `${shasumsDigest}  ${archiveName}\n`);
  return join(root, 'dist');
}

test('nodeDistSha256 finds the archive entry in the official checksum manifest', () => {
  const text = [
    `${'a'.repeat(64)}  node-v1.2.3-linux-x64.tar.gz`,
    `${'b'.repeat(64)}  node-v1.2.3-linux-x64.tar.xz`,
    `${'c'.repeat(64)}  node-v1.2.3-win-x64.zip`,
    '',
  ].join('\n');
  assert.equal(nodeDistSha256(text, 'node-v1.2.3-linux-x64.tar.gz'), 'a'.repeat(64));
  assert.equal(nodeDistSha256(text, 'node-v1.2.3-darwin-arm64.tar.gz'), null);
});

test('verifyNodeDistArchive accepts a matching digest and rejects any drift', async (t) => {
  const dir = await tempDir(t, 'node-dist-verify-');
  const archive = join(dir, archiveName);
  writeFileSync(archive, 'node bytes');
  const digest = createHash('sha256').update('node bytes').digest('hex');
  verifyNodeDistArchive(archive, `${digest}  ${archiveName}\n`, archiveName);
  assert.throws(
    () => verifyNodeDistArchive(archive, `${'0'.repeat(64)}  ${archiveName}\n`, archiveName),
    /SHA-256 不匹配/,
  );
  assert.throws(() => verifyNodeDistArchive(archive, `${digest}  other.tar.gz\n`, archiveName), /缺少/);
});

test('download verifies the published checksum before unpacking the bundled node', async (t) => {
  const dir = await tempDir(t, 'node-dist-download-');
  const payload = fixtureArchive(dir);
  withMirror(t, distDir(dir, payload, createHash('sha256').update(payload).digest('hex')));
  const cacheDir = join(dir, 'cache');
  const probed = [];
  const bin = downloadSelfContainedNode(cacheDir, version, (binPath, expected) => probed.push([binPath, expected]));
  assert.equal(bin, join(cacheDir, tuple, 'bin', 'node'));
  assert.equal(readFileSync(bin, 'utf8'), 'stub-node');
  assert.deepEqual(probed, [[bin, version]]);
  assert.equal(
    downloadSelfContainedNode(cacheDir, version, () => { throw new Error('cached node must not re-probe'); }),
    bin,
  );
});

test('a tampered archive is never extracted into the installer cache', async (t) => {
  const dir = await tempDir(t, 'node-dist-tamper-');
  const payload = fixtureArchive(dir);
  withMirror(t, distDir(dir, payload, createHash('sha256').update('official bytes').digest('hex')));
  const cacheDir = join(dir, 'cache');
  assert.throws(
    () => downloadSelfContainedNode(cacheDir, version, () => { throw new Error('must not probe'); }),
    /SHA-256 不匹配/,
  );
  assert.equal(existsSync(join(cacheDir, tuple, 'bin', 'node')), false);
  assert.deepEqual(readdirSync(cacheDir), []);
});
