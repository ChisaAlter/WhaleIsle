'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashRuntimeArchive, readRuntimeArchiveIdentity } = require('./harness-runtime-identity');
const { materializeRuntimeLinks } = require('./runtime-links');

/** Run inside the official NSIS staging directory, before closing/replacing the old application. */
async function installHarness(resources, finalResources) {
  resources = path.resolve(resources);
  finalResources = path.resolve(finalResources);
  const archive = path.join(resources, 'vendor', 'deepseek-harness.tar');
  const runtime = path.join(resources, 'vendor', 'deepseek-harness');
  const identity = await readRuntimeArchiveIdentity(archive);
  if (!identity || fs.statSync(archive).size !== identity.archiveBytes
      || await hashRuntimeArchive(archive) !== identity.archiveSha256) throw new Error('Harness runtime archive verification failed');
  // Only the newly created install staging tree is written. Existing app and user data are untouched.
  if (fs.existsSync(runtime)) throw new Error('Harness install staging directory is not empty');
  fs.mkdirSync(runtime, { recursive: true });
  const tar = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', runtime], { windowsHide: true, stdio: 'pipe' });
  for (const entry of ['apps/cli/lib/bin.js', 'apps/web/dist/index.html', '.dsh-runtime-links.json']) {
    if (!fs.existsSync(path.join(runtime, entry))) throw new Error(`Incomplete Harness install: ${entry}`);
  }
  const links = materializeRuntimeLinks(runtime, { targetRoot: path.join(finalResources, 'vendor', 'deepseek-harness') });
  fs.unlinkSync(archive);
  console.log(`Prepared installed Harness runtime (${links} dependency links)`);
}

module.exports = { installHarness };
if (require.main === module) {
  if (process.argv.length !== 4) throw new Error('Usage: install-harness.cjs <staged-resources> <installed-resources>');
  installHarness(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
}
