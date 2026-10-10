/**
 * Ensure runtime artifacts match latest source before Electron starts.
 * Stops shipping stale ui-settings-remote/lib or missing dshd remote links.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFileScanner } from './source-scan.mjs';
import { readStageCredentials, stagesToRun } from '../vendor/deepseek-harness/scripts/build-stage-credentials.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'vendor', 'deepseek-harness');
const clientBuildRecord = path.join(harness, '.dsh-build', 'client-build-environment.json');

const remoteScanner = createFileScanner((file) => /\.(tsx?|css)$/.test(file));

/**
 * The exact public environment an official build at this checkout must embed.
 *
 * This is derived from the checkout itself — Git HEAD and the vendored
 * package.json — never from the build record, so comparing the two is a real
 * check rather than a tautology.
 */
function expectedOfficialEnvironment() {
  const commit = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  const version = JSON.parse(fs.readFileSync(path.join(harness, 'package.json'), 'utf8')).version;
  return {
    DSH_CLIENT_BUILD_PROFILE: 'official',
    DSH_CLIENT_TITLE: 'Whale Isle',
    DSH_CLIENT_COMMIT_HASH: commit.status === 0 ? commit.stdout.trim() : '',
    DSH_CLIENT_VERSION: version,
  };
}

/**
 * Why the official build must run again, or an empty string when it can be
 * reused. Record and profile checks come first because they are cheap; the
 * per-stage credential check then decides which stages are stale, so a commit
 * that touches no build input no longer rebuilds the client at all.
 */
async function officialBuildReason() {
  if (!fs.existsSync(clientBuildRecord)) return 'official client build record is missing';
  let record;
  try {
    record = JSON.parse(fs.readFileSync(clientBuildRecord, 'utf8'));
  } catch {
    return 'official client build record is invalid';
  }
  const environment = record?.environment;
  if (environment?.DSH_CLIENT_BUILD_PROFILE !== 'official') return 'client build is not official';
  if (environment?.DSH_CLIENT_TITLE !== 'Whale Isle') return 'client build title is not official';
  const expected = expectedOfficialEnvironment();
  const recordedKeys = Object.keys(environment).sort().join(',');
  if (recordedKeys !== Object.keys(expected).sort().join(',')) {
    return 'client build environment has a different set of public values';
  }
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) return `client build is stale for ${name}`;
  }
  let stale;
  try {
    stale = await stagesToRun(harness, expected, readStageCredentials(harness));
  } catch (error) {
    // Any failure to prove the artifacts are current has to rebuild, exactly
    // like a failed check: this gate may never skip work on an error.
    return `build credentials could not be verified (${error instanceof Error ? error.message : String(error)})`;
  }
  if (stale.length > 0) return `build stages are stale: ${stale.join(', ')}`;
  return '';
}

function run(command, args, cwd = root, { shell = process.platform === 'win32' } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const buildReason = await officialBuildReason();
if (buildReason) {
  console.log(`[prestart] ${buildReason}; rebuilding official client`);
  const pnpm = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  run(process.execPath, [pnpm, '--dir', harness, 'run', 'build:official'], root, { shell: false });
}

// Absolute node paths with spaces break under shell:true on Windows.
run(process.execPath, ['scripts/prepare-dshd-remote.mjs'], root, { shell: false });
run(process.execPath, ['scripts/prepare-dsh-remote-client.mjs'], root, { shell: false });

const remotePkg = path.join(root, 'vendor', 'deepseek-harness', 'packages', 'client', 'ui-settings-remote');
const remoteSrc = path.join(remotePkg, 'src');
const remoteLib = path.join(remotePkg, 'lib', 'client.js');
const srcNewest = remoteScanner(remoteSrc);
const libMtime = fs.existsSync(remoteLib) ? fs.statSync(remoteLib).mtimeMs : 0;
if (srcNewest > libMtime + 500) {
  console.log('[prestart] rebuilding ui-settings-remote (src newer than lib)');
  run('npm', ['run', 'bundle'], remotePkg);
} else {
  console.log('[prestart] ui-settings-remote lib is current');
}

if (!fs.existsSync(remoteLib)) {
  console.error('[prestart] ui-settings-remote/lib/client.js missing. Run: pnpm --filter @deepseek-ai/dsh-client-ui-settings-remote run bundle');
  process.exit(1);
}
const text = fs.readFileSync(remoteLib, 'utf8');
if (!text.includes('copyLink') || !text.includes('data-dsh-remote-copy-link')) {
  console.error('[prestart] ui-settings-remote/lib is stale (missing copyLink / data-dsh-remote-copy-link). Run: pnpm --filter @deepseek-ai/dsh-client-ui-settings-remote run bundle');
  process.exit(1);
}
if (text.includes('保存宿主令牌') && !text.includes('ayase.cn:443')) {
  console.error('[prestart] ui-settings-remote/lib is stale (host-token wall). Run: npm run bundle --prefix vendor/deepseek-harness/packages/client/ui-settings-remote');
  process.exit(1);
}

console.log('[prestart] ready');
