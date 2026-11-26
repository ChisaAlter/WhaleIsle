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
import { preparePreviewGuestPreload } from './prepare-preview-guest-preload.cjs';
import { prepareWhaleUi } from './prepare-whale-ui.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'vendor', 'deepseek-harness');
const clientBuildRecord = path.join(harness, '.dsh-build', 'client-build-environment.json');

const remoteScanner = createFileScanner((file) => /\.(tsx?|css)$/.test(file));

/**
 * The vendored lefthook postinstall (`lefthook install -f`) would write hooks
 * into the developer's outer repository. It only stands down when CI is
 * truthy and LEFTHOOK is unset.
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
export function pnpmInstallEnv(baseEnv = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...baseEnv, CI: 'true' };
  delete env.LEFTHOOK;
  return env;
}

/**
 * Validate workspace symlinks/junctions inside one `@deepseek-ai` scope directory.
 * @param {string} scopeDir
 * @param {string} normHarness
 * @param {boolean} requireNonEmpty
 */
function invalidWorkspaceScopeReason(scopeDir, normHarness, requireNonEmpty) {
  if (!fs.existsSync(scopeDir)) return requireNonEmpty ? 'apps/cli @deepseek-ai workspace links are missing' : '';
  const entries = fs.readdirSync(scopeDir, { withFileTypes: true });
  if (requireNonEmpty && entries.length === 0) return 'apps/cli @deepseek-ai workspace links are empty';
  const realpathFn = fs.realpathSync.native || fs.realpathSync;
  for (const entry of entries) {
    const entryPath = path.join(scopeDir, entry.name);
    let lstat;
    try { lstat = fs.lstatSync(entryPath); } catch { return `unreadable workspace link: ${entry.name}`; }
    if (!lstat.isSymbolicLink()) continue;
    if (!fs.existsSync(entryPath)) return `dangling workspace link: ${entry.name}`;
    let targetReal;
    try { targetReal = realpathFn(entryPath); } catch { return `broken workspace link: ${entry.name}`; }
    const normTarget = process.platform === 'win32' ? targetReal.toLowerCase() : targetReal;
    if (normTarget !== normHarness && !normTarget.startsWith(normHarness + path.sep)) {
      return `workspace link points outside current harness checkout: ${entry.name}`;
    }
  }
  return '';
}

/**
 * Why `pnpm install --frozen-lockfile` must run in `vendor/deepseek-harness`,
 * or an empty string when lockfile sync and workspace links are valid.
 * @param {string} [harnessDir]
 */
export function harnessInstallReason(harnessDir = harness) {
  if (!fs.existsSync(path.join(harnessDir, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))) {
    return 'harness pnpm binary is missing';
  }
  const cliNodeModules = path.join(harnessDir, 'apps', 'cli', 'node_modules');
  if (!fs.existsSync(cliNodeModules)) {
    return 'apps/cli node_modules is missing';
  }
  const wantedLock = path.join(harnessDir, 'pnpm-lock.yaml');
  const installedLock = path.join(harnessDir, 'node_modules', '.pnpm', 'lock.yaml');
  if (fs.existsSync(wantedLock)) {
    if (!fs.existsSync(installedLock)) return 'installed pnpm lockfile is missing';
    if (Buffer.compare(fs.readFileSync(wantedLock), fs.readFileSync(installedLock)) !== 0) {
      return 'pnpm-lock.yaml differs from installed node_modules/.pnpm/lock.yaml';
    }
  }
  const realpathFn = fs.realpathSync.native || fs.realpathSync;
  const harnessReal = realpathFn(harnessDir);
  const normHarness = process.platform === 'win32' ? harnessReal.toLowerCase() : harnessReal;
  const rootScopeReason = invalidWorkspaceScopeReason(path.join(harnessDir, 'node_modules', '@deepseek-ai'), normHarness, false);
  if (rootScopeReason) return rootScopeReason;
  return invalidWorkspaceScopeReason(path.join(cliNodeModules, '@deepseek-ai'), normHarness, true);
}

/**
 * The exact public environment an official build at this checkout must embed.
 *
 * This is derived from the checkout itself — Git HEAD and the vendored
 * package.json — never from the build record, so comparing the two is a real
 * check rather than a tautology.
 */
function expectedOfficialEnvironment(harnessDir = harness, rootDir = root) {
  const commit = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: false,
  });
  const version = JSON.parse(fs.readFileSync(path.join(harnessDir, 'package.json'), 'utf8')).version;
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
export async function officialBuildReason(harnessDir = harness, rootDir = root) {
  const buildRecord = path.join(harnessDir, '.dsh-build', 'client-build-environment.json');
  if (!fs.existsSync(buildRecord)) return 'official client build record is missing';
  let record;
  try {
    record = JSON.parse(fs.readFileSync(buildRecord, 'utf8'));
  } catch {
    return 'official client build record is invalid';
  }
  const environment = record?.environment;
  if (environment?.DSH_CLIENT_BUILD_PROFILE !== 'official') return 'client build is not official';
  if (environment?.DSH_CLIENT_TITLE !== 'Whale Isle') return 'client build title is not official';
  const expected = expectedOfficialEnvironment(harnessDir, rootDir);
  const recordedKeys = Object.keys(environment).sort().join(',');
  if (recordedKeys !== Object.keys(expected).sort().join(',')) {
    return 'client build environment has a different set of public values';
  }
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) return `client build is stale for ${name}`;
  }
  let stale;
  try {
    stale = await stagesToRun(harnessDir, expected, readStageCredentials(harnessDir));
  } catch (error) {
    // Any failure to prove the artifacts are current has to rebuild, exactly
    // like a failed check: this gate may never skip work on an error.
    return `build credentials could not be verified (${error instanceof Error ? error.message : String(error)})`;
  }
  if (stale.length > 0) return `build stages are stale: ${stale.join(', ')}`;
  return '';
}

function run(command, args, cwd = root, { shell = process.platform === 'win32', env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell, env });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

async function main() {
  await prepareWhaleUi();
  const installReason = harnessInstallReason(harness);
  if (installReason) {
    console.log(`[prestart] ${installReason}; running pnpm install --frozen-lockfile`);
    const harnessPnpm = path.join(harness, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
    const pnpmBin = fs.existsSync(harnessPnpm)
      ? harnessPnpm
      : path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
    run(process.execPath, [pnpmBin, '--dir', harness, 'install', '--frozen-lockfile'], root, {
      shell: false,
      env: pnpmInstallEnv(),
    });
  }
  const buildReason = await officialBuildReason(harness, root);
  if (buildReason) {
    console.log(`[prestart] ${buildReason}; rebuilding official client`);
    const pnpm = path.join(harness, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
    run(process.execPath, [pnpm, '--dir', harness, 'run', 'build:official'], root, { shell: false });
  }

  // Absolute node paths with spaces break under shell:true on Windows.
  preparePreviewGuestPreload();
  run(process.execPath, ['scripts/prepare-dshd-remote.mjs'], root, { shell: false });
  run(process.execPath, ['scripts/prepare-dsh-remote-client.mjs'], root, { shell: false });
  run(process.execPath, ['scripts/build-dsh-whale-client.mjs'], root, { shell: false });
  run(process.execPath, ['scripts/prepare-dsh-feedback-clients.mjs'], root, { shell: false });

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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
