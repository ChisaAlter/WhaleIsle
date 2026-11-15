#!/usr/bin/env node
// Download one GitHub Actions ZIP by immutable artifact ID; resume interrupted
// transfers and verify GitHub's digest before promoting .part to .zip.
import { execFileSync } from 'node:child_process';
import { mkdir, open, lstat, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function downloadArtifact({ artifact, directory, resolveUrl, fetchImpl = fetch, idleMs = 30000, attempts = 3 }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest) || !Number.isSafeInteger(artifact.id) || artifact.id < 1) throw new Error('Artifact lacks a verifiable identity');
  if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 || artifact.expired) throw new Error('Artifact is empty, invalid or expired');
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${artifact.id}.zip`);
  const partial = `${target}.part`;
  const expected = artifact.digest.slice(7);
  const size = async file => {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Cache entries must be regular files');
      return info.size;
    } catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
  };
  if (await size(target)) {
    if (await fileDigest(target) !== expected) throw new Error('Cached ZIP digest mismatch; preserve it for diagnosis and choose a fresh directory');
    return target;
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let handle;
    let timer;
    let deadline;
    const controller = new AbortController();
    const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), idleMs); };
    try {
      let offset = await size(partial);
      if (offset === artifact.size_in_bytes && await fileDigest(partial) === expected) { await rename(partial, target); return target; }
      if (offset >= artifact.size_in_bytes) { await rename(partial, `${partial}.rejected-${Date.now()}`); offset = 0; }
      resetTimer();
      deadline = setTimeout(() => controller.abort(), 15 * 60 * 1000);
      const url = await resolveUrl();
      const response = await fetchImpl(url, { signal: controller.signal, headers: offset ? { Range: `bytes=${offset}-` } : {} });
      if (![200, 206].includes(response.status) || !response.body) throw new Error('Artifact response is not downloadable');
      if (response.status === 206) {
        const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!range || Number(range[1]) !== offset || Number(range[3]) !== artifact.size_in_bytes || Number(range[2]) >= artifact.size_in_bytes) throw new Error('Invalid resume range');
      }
      let written = response.status === 206 ? offset : 0;
      handle = await open(partial, response.status === 206 ? 'a' : 'w');
      for await (const chunk of response.body) {
        resetTimer();
        written += chunk.byteLength;
        if (written > artifact.size_in_bytes) throw new Error('Artifact exceeds advertised size');
        // FileHandle.write may write fewer bytes than requested.
        let start = 0;
        while (start < chunk.byteLength) {
          const { bytesWritten } = await handle.write(chunk, start, chunk.byteLength - start);
          if (!bytesWritten) throw new Error('Artifact write made no progress');
          start += bytesWritten;
        }
      }
      await handle.close(); handle = undefined;
      clearTimeout(timer);
      if (written !== artifact.size_in_bytes) throw new Error('Artifact transfer ended early');
      if (await fileDigest(partial) !== expected) {
        await rename(partial, `${partial}.rejected-${Date.now()}`);
        throw new Error('Artifact digest mismatch');
      }
      await rename(partial, target);
      return target;
    } catch {
      controller.abort();
      if (attempt === attempts) throw new Error(`Artifact ${artifact.id} download failed after ${attempts} bounded attempts; partial bytes retained`);
    } finally { clearTimeout(timer); clearTimeout(deadline); await handle?.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [repo, runId, artifactName, directory] = process.argv.slice(2);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[1-9]\d*$/.test(runId) || !artifactName || !directory) throw new Error('Usage: release-download.mjs <owner/repo> <run-id> <artifact-name> <cache-directory>');
    const gh = process.env.GH_PATH || 'gh';
    const pages = JSON.parse(execFileSync(gh, ['api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`], { encoding: 'utf8' }));
    const matches = pages.flatMap(p => p.artifacts).filter(a => a.name === artifactName);
    if (matches.length !== 1) throw new Error('Expected exactly one named artifact');
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync(gh, ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const target = await downloadArtifact({ artifact: matches[0], directory: resolve(directory), resolveUrl: async () => {
      const response = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${matches[0].id}/zip`, {
        redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      const url = response.headers.get('location');
      if (response.status !== 302 || !url || new URL(url).protocol !== 'https:') throw new Error('GitHub did not return an artifact download');
      return url; // The GitHub credential is never forwarded to storage.
    } });
    console.log(`Verified artifact ZIP: ${target}`);
  } catch { console.error('Candidate download failed; check run/artifact identity, credentials and retained partial file. Signed URLs and credentials are not logged.'); process.exitCode = 1; }
}
