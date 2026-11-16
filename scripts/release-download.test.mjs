import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadArtifact } from './release-download.mjs';
const bytes = Buffer.from('original-ci-installer-archive');
const artifact = { id: 123, size_in_bytes: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, expired: false };
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'release-download-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('resume uses exact Range and verified cache needs no network', async t => {
  const directory = await fixture(t); await writeFile(join(directory, '123.zip.part'), bytes.subarray(0, 7));
  const target = await downloadArtifact({ artifact, directory, resolveUrl: async () => 'https://storage.invalid', fetchImpl: async (_, opts) => {
    assert.equal(opts.headers.Range, 'bytes=7-'); return new Response(bytes.subarray(7), { status: 206, headers: { 'content-range': `bytes 7-${bytes.length - 1}/${bytes.length}` } });
  } });
  assert.deepEqual(await readFile(target), bytes);
  assert.equal(await downloadArtifact({ artifact, directory, resolveUrl: () => { throw new Error('must reuse'); } }), target);
});
test('server ignoring Range restarts rather than appending corrupt bytes', async t => {
  const directory = await fixture(t); await writeFile(join(directory, '123.zip.part'), bytes.subarray(0, 7));
  const target = await downloadArtifact({ artifact, directory, resolveUrl: async () => 'https://storage.invalid', fetchImpl: async () => new Response(bytes) });
  assert.deepEqual(await readFile(target), bytes);
});
test('bad range and wrong digest cannot produce an accepted ZIP', async t => {
  const directory = await fixture(t);
  await assert.rejects(downloadArtifact({ artifact, directory, attempts: 1, resolveUrl: async () => 'https://storage.invalid', fetchImpl: async () => new Response(bytes, { status: 206, headers: { 'content-range': `bytes 1-${bytes.length}/${bytes.length + 1}` } }) }), /bounded attempts/);
  await assert.rejects(downloadArtifact({ artifact, directory, attempts: 1, resolveUrl: async () => 'https://storage.invalid', fetchImpl: async () => new Response(Buffer.alloc(bytes.length)) }), /bounded attempts/);
  await assert.rejects(readFile(join(directory, '123.zip')), /ENOENT/);
});
test('a complete corrupt partial is preserved and replaced by verified bytes', async t => {
  const directory = await fixture(t); await writeFile(join(directory, '123.zip.part'), Buffer.alloc(bytes.length));
  const target = await downloadArtifact({ artifact, directory, resolveUrl: async () => 'https://storage.invalid', fetchImpl: async (_, opts) => {
    assert.equal(opts.headers.Range, undefined); return new Response(bytes);
  } });
  assert.deepEqual(await readFile(target), bytes);
});
test('an oversized partial is quarantined and the transfer restarts from zero', async t => {
  const directory = await fixture(t); await writeFile(join(directory, '123.zip.part'), Buffer.concat([bytes, Buffer.from('trailing-garbage')]));
  const target = await downloadArtifact({ artifact, directory, resolveUrl: async () => 'https://storage.invalid', fetchImpl: async (_, opts) => {
    assert.equal(opts.headers.Range, undefined); return new Response(bytes);
  } });
  assert.deepEqual(await readFile(target), bytes);
  const names = await readdir(directory);
  assert.ok(names.some(n => /^123\.zip\.part\.rejected-\d+$/.test(n)));
  assert.ok(!names.includes('123.zip.part'));
});
