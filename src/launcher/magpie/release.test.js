'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const { parseSha256Sums, resolveLatestMagpieRelease } = require('./release');

test('parseSha256Sums parses binary entries and rejects empty, malformed, or duplicate entries', () => {
  const hashA = 'a'.repeat(64);
  const hashB = 'B'.repeat(64);
  const map = parseSha256Sums(`# comment line\n${hashA}  ./magpie-cli-windows-amd64.exe\n${hashB} *magpie-cli-darwin-arm64\n`);
  assert.equal(map.get('magpie-cli-windows-amd64.exe'), hashA);
  assert.equal(map.get('magpie-cli-darwin-arm64'), 'b'.repeat(64));

  assert.throws(() => parseSha256Sums('# only comment\n'), /为空/);
  assert.throws(() => parseSha256Sums('not-a-hash  file.exe'), /格式无效/);
  assert.throws(() => parseSha256Sums(`${hashA}  ../evil.exe`), /格式无效/);
  assert.throws(() => parseSha256Sums(`${hashA}  sub/dir.exe`), /格式无效/);
  assert.throws(() => parseSha256Sums(`${hashA}  same.exe\n${hashA}  ./same.exe`), /重复条目/);
  assert.throws(() => parseSha256Sums(`${hashA}  same.exe\n${hashA}  same.exe`), /重复条目/);
});

test('resolveLatestMagpieRelease uses GitHub redirect + SHA256SUMS without REST API', async () => {
  const hash = 'c'.repeat(64);
  const requested = [];
  const fetchImpl = async (url) => {
    const s = String(url);
    requested.push(s);
    if (s === 'https://github.com/yetone/magpie/releases/latest') {
      return new Response('', {
        status: 302,
        headers: { location: 'https://github.com/yetone/magpie/releases/tag/v0.1.4708' },
      });
    }
    if (s.endsWith('/v0.1.4708/SHA256SUMS')) {
      return new Response(`${hash}  magpie-cli-windows-amd64.exe\n`, { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  const rel = await resolveLatestMagpieRelease({ route: 'github', platform: 'win32', arch: 'x64', fetchImpl });
  assert.equal(rel.id, 'magpie');
  assert.equal(rel.version, '0.1.4708');
  assert.equal(rel.tag, 'v0.1.4708');
  assert.equal(rel.asset, 'magpie-cli-windows-amd64.exe');
  assert.equal(rel.sha256, hash);
  assert.equal(rel.url, 'https://github.com/yetone/magpie/releases/download/v0.1.4708/magpie-cli-windows-amd64.exe');
  assert.ok(!requested.some((u) => u.includes('api.github.com')));
});

test('resolveLatestMagpieRelease supports CNB magpie-v* mirror and local devPackage', async () => {
  const binHash = 'd'.repeat(64);
  const cnbFetch = async (url) => {
    const s = String(url);
    if (s.includes('/-/releases?page_size=')) {
      return new Response(JSON.stringify([
        { tag_name: 'v0.3.20', draft: false, prerelease: false, assets: [] },
        {
          tag_name: 'magpie-v0.1.4710',
          draft: false,
          prerelease: false,
          assets: [
            { name: 'SHA256SUMS', browser_download_url: 'https://cnb.cool/dl/SHA256SUMS' },
            { name: 'magpie-cli-darwin-arm64', size: 12345, browser_download_url: 'https://cnb.cool/dl/magpie-darwin' },
          ],
        },
      ]), { status: 200 });
    }
    if (s === 'https://cnb.cool/dl/SHA256SUMS') {
      return new Response(`${binHash}  magpie-cli-darwin-arm64\n`, { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  const cnbRel = await resolveLatestMagpieRelease({ route: 'cnb', platform: 'darwin', arch: 'arm64', fetchImpl: cnbFetch });
  assert.equal(cnbRel.version, '0.1.4710');
  assert.equal(cnbRel.route, 'cnb');
  assert.equal(cnbRel.sha256, binHash);

  await withOwnedTempDir('magpie-devpkg-', async (dir) => {
    const payload = Buffer.from('local magpie dev build');
    const digest = createHash('sha256').update(payload).digest('hex');
    fs.writeFileSync(path.join(dir, 'magpie-cli-windows-amd64.exe'), payload);
    fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${digest}  magpie-cli-windows-amd64.exe\n`);
    fs.writeFileSync(path.join(dir, 'VERSION'), 'v0.1.9999\n');

    const devRel = await resolveLatestMagpieRelease({ devPackage: dir, platform: 'win32', arch: 'x64' });
    assert.equal(devRel.version, '0.1.9999');
    assert.equal(devRel.route, 'development');
    assert.equal(devRel.localDir, dir);
    assert.equal(devRel.sha256, digest);
  });
});

test('resolveLatestMagpieRelease preserves prerelease tag suffixes, paginates CNB up to 3 pages, and requires https URLs', async () => {
  const hash = 'e'.repeat(64);
  const rcRel = await resolveLatestMagpieRelease({
    route: 'github',
    platform: 'win32',
    arch: 'x64',
    fetchImpl: async (url) => {
      const s = String(url);
      if (s === 'https://github.com/yetone/magpie/releases/latest') {
        return new Response('', {
          status: 302,
          headers: { location: 'https://github.com/yetone/magpie/releases/tag/v0.2.0-rc.1' },
        });
      }
      if (s.endsWith('/v0.2.0-rc.1/SHA256SUMS')) {
        return new Response(`${hash}  magpie-cli-windows-amd64.exe\n`, { status: 200 });
      }
      return new Response('', { status: 404 });
    },
  });
  assert.equal(rcRel.version, '0.2.0-rc.1');
  assert.equal(rcRel.tag, 'v0.2.0-rc.1');
  assert.equal(rcRel.url, 'https://github.com/yetone/magpie/releases/download/v0.2.0-rc.1/magpie-cli-windows-amd64.exe');

  const requestedPages = [];
  const page2Rel = await resolveLatestMagpieRelease({
    route: 'cnb',
    platform: 'darwin',
    arch: 'arm64',
    fetchImpl: async (url) => {
      const s = String(url);
      if (s.includes('/-/releases?page_size=')) {
        requestedPages.push(s);
        if (s.includes('page=3')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (!s.includes('page=2')) {
          return new Response(JSON.stringify([{ tag_name: 'v0.3.20', draft: false, prerelease: false, assets: [] }]), { status: 200 });
        }
        return new Response(JSON.stringify([{
          tag_name: 'magpie-v0.1.4800',
          draft: false,
          prerelease: false,
          assets: [
            { name: 'SHA256SUMS', browser_download_url: 'https://cnb.cool/dl/SHA256SUMS' },
            { name: 'magpie-cli-darwin-arm64', size: 12345, browser_download_url: 'https://cnb.cool/dl/magpie-darwin' },
          ],
        }]), { status: 200 });
      }
      if (s === 'https://cnb.cool/dl/SHA256SUMS') {
        return new Response(`${hash}  magpie-cli-darwin-arm64\n`, { status: 200 });
      }
      return new Response('', { status: 404 });
    },
  });
  assert.equal(requestedPages.length, 3);
  assert.equal(page2Rel.version, '0.1.4800');

  let maxPageCalls = 0;
  await assert.rejects(
    () => resolveLatestMagpieRelease({
      route: 'cnb',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async () => {
        maxPageCalls += 1;
        return new Response(JSON.stringify([{ tag_name: 'v0.3.21', draft: false, prerelease: false, assets: [] }]), { status: 200 });
      },
    }),
    /尚未同步/,
  );
  assert.equal(maxPageCalls, 3);

  await assert.rejects(
    () => resolveLatestMagpieRelease({
      route: 'cnb',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: async () => new Response(JSON.stringify([{
        tag_name: 'magpie-v0.1.4801',
        draft: false,
        prerelease: false,
        assets: [
          { name: 'SHA256SUMS', browser_download_url: 'http://insecure.example/SHA256SUMS' },
          { name: 'magpie-cli-darwin-arm64', size: 12345, browser_download_url: 'https://cnb.cool/dl/magpie' },
        ],
      }]), { status: 200 }),
    }),
    /HTTPS/,
  );
});
