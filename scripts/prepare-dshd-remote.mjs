import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';
import {
  materializeRuntimeCopies,
  planRuntimeClosure,
  readManifest,
} from './lib/dshd-remote-runtime.mjs';
import {
  createScanMemo,
  REMOTE_PRUNED_DIRS,
} from './source-scan.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamRoot = path.join(root, 'vendor', 'chisacode-remote');
const force = process.argv.includes('--force');
const buildRuntime = process.argv.includes('--runtime');
const sourceServerExport = path.join(
  upstreamRoot,
  'packages',
  'server',
  'dist',
  'server',
  'server',
  'exports.js',
);
const mobileBundle = path.join(root, 'mobile', 'web', 'chisacode', 'daemon-client.bundle.js');
const runtimeRoot = path.join(upstreamRoot, '.tmp', 'desktop-runtime');
const runtimeNodeModules = path.join(runtimeRoot, 'node_modules');
const runtimeDepSource = path.join(upstreamRoot, 'node_modules');
const runtimeServerRoot = path.join(runtimeNodeModules, '@chisacode', 'server');
const runtimeServerExport = path.join(runtimeServerRoot, 'dist', 'server', 'server', 'exports.js');
const runtimeStaticDir = path.join(runtimeServerRoot, 'dist', 'server');
const daemonRunner = path.join(root, 'src', 'main', 'dshd-daemon-runner.mjs');
const electronPackage = path.join(root, 'node_modules', 'electron', 'package.json');
const electronRebuildCli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const runtimeBudgetBytes = 96 * 1024 * 1024;

function run(command, args, cwd, { shell = process.platform === 'win32' } = {}) {
  // Absolute node paths with spaces break under shell:true on Windows.
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function electronExecutable() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') return path.join(dist, 'electron.exe');
  if (process.platform === 'darwin') {
    return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return path.join(dist, 'electron');
}

function probeElectronSqliteRuntime(sqlitePackage) {
  const executable = electronExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(`[dshd-remote] Electron binary is missing at ${executable}`);
  }
  const probe = [
    'const Database = require(process.argv[1]);',
    "const db = new Database(':memory:');",
    "db.exec('create table qa(v integer); insert into qa values (29)');",
    "const value = db.prepare('select v from qa').get().v;",
    'db.close();',
    'process.stdout.write(String(value));',
  ].join('');
  const result = spawnSync(executable, ['-e', probe, sqlitePackage], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 || result.stdout.trim() !== '29') {
    const detail = (result.stderr || result.stdout || result.error?.message || 'unknown error').trim();
    throw new Error(`[dshd-remote] Electron better-sqlite3 ABI probe failed: ${detail}`);
  }
}

function pruneSqliteBuildArtifacts(sqlitePackage) {
  const nativeFile = path.join(sqlitePackage, 'build', 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(nativeFile)) {
    throw new Error(`[dshd-remote] rebuilt better-sqlite3 binary is missing at ${nativeFile}`);
  }
  const native = fs.readFileSync(nativeFile);
  fs.rmSync(path.join(sqlitePackage, 'build'), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(nativeFile), { recursive: true });
  fs.writeFileSync(nativeFile, native);
  for (const entry of ['bin', 'deps', 'src', 'binding.gyp']) {
    fs.rmSync(path.join(sqlitePackage, entry), { recursive: true, force: true });
  }
}

function prepareElectronSqliteRuntime() {
  if (!fs.existsSync(electronPackage) || !fs.existsSync(electronRebuildCli)) {
    throw new Error('[dshd-remote] Electron or @electron/rebuild is missing; run npm ci first');
  }
  const electronVersion = JSON.parse(fs.readFileSync(electronPackage, 'utf8')).version;
  console.log(`[dshd-remote] rebuilding better-sqlite3 for Electron ${electronVersion}`);
  run(
    process.execPath,
    [
      electronRebuildCli,
      '--version', electronVersion,
      '--module-dir', runtimeRoot,
      '--only', 'better-sqlite3',
      '--force',
      ...(process.platform === 'win32' ? ['--sequential'] : []),
    ],
    root,
    { shell: false },
  );

  const sqlitePackage = path.join(runtimeNodeModules, 'better-sqlite3');
  probeElectronSqliteRuntime(sqlitePackage);
  pruneSqliteBuildArtifacts(sqlitePackage);
  probeElectronSqliteRuntime(sqlitePackage);
  console.log('[dshd-remote] Electron better-sqlite3 ABI probe passed after pruning');
}

function pruneNodePtyRuntime() {
  const packageRoot = path.join(runtimeNodeModules, 'node-pty');
  const prebuildsRoot = path.join(packageRoot, 'prebuilds');
  const target = `${process.platform}-${process.arch}`;
  if (!fs.existsSync(path.join(prebuildsRoot, target))) {
    throw new Error(`[dshd-remote] node-pty prebuild is missing for ${target}`);
  }
  for (const entry of fs.readdirSync(prebuildsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== target) {
      fs.rmSync(path.join(prebuildsRoot, entry.name), { recursive: true, force: true });
    }
  }
  for (const entry of ['binding.gyp', 'README.md', 'scripts', 'src', 'third_party', 'typings']) {
    fs.rmSync(path.join(packageRoot, entry), { recursive: true, force: true });
  }
  const stack = [path.join(prebuildsRoot, target)];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.name.toLowerCase().endsWith('.pdb')) fs.rmSync(absolute, { force: true });
    }
  }
}

function pruneFilesByExtension(dir, extensions) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        fs.rmSync(absolute, { force: true });
      }
    }
  }
}

function pruneWeriftRuntime() {
  const weriftRoot = path.join(runtimeNodeModules, 'werift');
  if (fs.existsSync(weriftRoot)) {
    // @chisacode/server is pure ESM and resolves werift to ./lib/index.mjs (0.89 MiB).
    // Prune unused CJS subtrees, polyfills, type declarations, and source maps.
    const libRoot = path.join(weriftRoot, 'lib');
    if (fs.existsSync(path.join(libRoot, 'index.mjs'))) {
      for (const entry of fs.readdirSync(libRoot, { withFileTypes: true })) {
        if (entry.name !== 'index.mjs') {
          fs.rmSync(path.join(libRoot, entry.name), { recursive: true, force: true });
        }
      }
    } else {
      pruneFilesByExtension(weriftRoot, ['.map', '.d.ts', '.d.mts', '.d.cts']);
    }
    fs.rmSync(path.join(weriftRoot, 'README.md'), { force: true });
  }
  const mediabunnyRoot = path.join(runtimeNodeModules, 'mediabunny');
  if (fs.existsSync(mediabunnyRoot)) {
    // Node ESM resolves mediabunny to ./dist/modules/src/index.js; CJS/browser bundles and TS sources are unused.
    fs.rmSync(path.join(mediabunnyRoot, 'src'), { recursive: true, force: true });
    fs.rmSync(path.join(mediabunnyRoot, 'dist', 'bundles'), { recursive: true, force: true });
    fs.rmSync(path.join(mediabunnyRoot, 'README.md'), { force: true });
    pruneFilesByExtension(mediabunnyRoot, ['.map', '.d.ts', '.d.mts', '.d.cts']);
  }
}

// With `--force` both builds run unconditionally, so the freshness scans are
// never read. Skip them entirely instead of paying for results no caller wants.
const sourceScans = force
  ? { scan: () => 0, scanFile: () => 0, calls: new Map() }
  : createScanMemo({ skipDirs: REMOTE_PRUNED_DIRS, includeDirMtime: true });

/** Newest mtime under `target`, memoized per input directory for this run. */
function newestMtime(target) {
  return sourceScans.scan(target);
}

function directorySize(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce(
    (total, entry) => total + directorySize(path.join(target, entry)),
    0,
  );
}

function forbiddenOptionalPayloads() {
  const found = [];
  const anthropicRoot = path.join(runtimeNodeModules, '@anthropic-ai');
  if (fs.existsSync(anthropicRoot)) {
    for (const entry of fs.readdirSync(anthropicRoot)) {
      if (/^claude-agent-sdk-(?:darwin|linux|win32)-/.test(entry)) {
        found.push(path.join('@anthropic-ai', entry));
      }
    }
  }
  for (const entry of fs.readdirSync(runtimeNodeModules)) {
    if (/^sherpa-onnx-(?:darwin|linux|win32)-/.test(entry)) {
      found.push(entry);
    }
  }
  return found;
}

function assertTrimmedRuntime() {
  const nodePtyTarget = `${process.platform}-${process.arch}`;
  const required = [
    runtimeServerExport,
    path.join(runtimeNodeModules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    path.join(runtimeNodeModules, '@chisacode', 'protocol', 'dist', 'connection-offer.js'),
    path.join(runtimeNodeModules, '@chisacode', 'relay', 'dist', 'e2ee.js'),
    path.join(runtimeNodeModules, 'node-pty', 'prebuilds', nodePtyTarget),
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error(`[dshd-remote] runtime is incomplete: ${missing.join(', ')}`);
  }
  const forbidden = forbiddenOptionalPayloads();
  const nodePtyPrebuilds = path.join(runtimeNodeModules, 'node-pty', 'prebuilds');
  for (const entry of fs.readdirSync(nodePtyPrebuilds, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== nodePtyTarget) {
      forbidden.push(path.join('node-pty', 'prebuilds', entry.name));
    }
  }
  if (fs.existsSync(path.join(runtimeNodeModules, 'node-pty', 'third_party'))) {
    forbidden.push(path.join('node-pty', 'third_party'));
  }
  if (forbidden.length > 0) {
    throw new Error(`[dshd-remote] optional platform payloads leaked into runtime: ${forbidden.join(', ')}`);
  }
  const bytes = directorySize(runtimeNodeModules);
  if (bytes > runtimeBudgetBytes) {
    throw new Error(
      `[dshd-remote] runtime is ${(bytes / 1024 / 1024).toFixed(1)} MiB; budget is ${runtimeBudgetBytes / 1024 / 1024} MiB`,
    );
  }
  console.log(`[dshd-remote] trimmed production runtime: ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
}

async function probeDshdDaemonRuntime() {
  const executable = electronExecutable();
  await withOwnedTempDir('dshd-remote-probe-', async (home) => {
  const launchFile = path.join(home, 'daemon-launch.json');
  fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
  fs.writeFileSync(launchFile, JSON.stringify({
    serverExport: runtimeServerExport,
    logLevel: 'error',
    daemonConfig: {
      listen: '127.0.0.1:0',
      chisacodeHome: home,
      corsAllowedOrigins: ['*'],
      staticDir: runtimeStaticDir,
      mcpDebug: false,
      agentClients: {},
      agentStoragePath: path.join(home, 'agents'),
      relayEnabled: false,
      auth: {},
    },
  }));

  await new Promise((resolve, reject) => {
      const child = spawn(executable, [daemonRunner, launchFile], {
        cwd: root,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          CHISACODE_HOME: home,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let sawReady = false;
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error(`[dshd-remote] daemon probe timed out\n${stderr.slice(-4000)}`));
      }, 45_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() || '';
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record.msg === 'dshd_daemon_ready' && !sawReady) {
              sawReady = true;
              child.stdin.write('stop\n');
            }
          } catch {
            // Keep waiting for a lifecycle record.
          }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
      child.on('error', (err) => finish(err));
      child.on('exit', (code, signal) => {
        if (sawReady && code === 0) {
          finish();
          return;
        }
        finish(new Error(
          `[dshd-remote] daemon probe failed (${signal || `code ${code}`})\n${stderr || stdout}`,
        ));
      });
    });
  });
  console.log('[dshd-remote] daemon start/stop probe passed');
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const typescript = path.join(upstreamRoot, 'node_modules', 'typescript', 'package.json');
if (!fs.existsSync(typescript)) {
  console.log('[dshd-remote] installing vendored workspace dependencies');
  run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], upstreamRoot);
}

// Each subtree feeds both the server stack and the mobile bundle. Scan each
// directory once and reuse the result: the previous version walked protocol and
// client twice per invocation.
const sourceMtimes = {
  server: newestMtime(path.join(upstreamRoot, 'packages', 'server', 'src')),
  relay: newestMtime(path.join(upstreamRoot, 'packages', 'relay', 'src')),
  protocol: newestMtime(path.join(upstreamRoot, 'packages', 'protocol', 'src')),
  client: newestMtime(path.join(upstreamRoot, 'packages', 'client', 'src')),
};
const serverSourceMtime = Math.max(
  sourceMtimes.server,
  sourceMtimes.relay,
  sourceMtimes.protocol,
  sourceMtimes.client,
);
const serverBuildMtime = fs.existsSync(sourceServerExport) ? fs.statSync(sourceServerExport).mtimeMs : 0;
if (force || serverSourceMtime > serverBuildMtime) {
  console.log('[dshd-remote] building vendored server dependency stack');
  run(npm, ['run', 'build:server'], upstreamRoot);
}

const mobileSourceMtime = Math.max(
  sourceScans.scanFile(path.join(root, 'mobile', 'web', 'chisacode', 'entry.mjs')),
  sourceMtimes.protocol,
  sourceMtimes.client,
);
const mobileBuildMtime = fs.existsSync(mobileBundle) ? fs.statSync(mobileBundle).mtimeMs : 0;
if (force || mobileSourceMtime > mobileBuildMtime) {
  console.log('[dshd-remote] bundling browser daemon client');
  run(process.execPath, ['scripts/bundle-chisacode-mobile-client.mjs'], root, { shell: false });
}

// Packs one workspace member exactly like `npm install --install-links`
// copies a file: dependency — its files list plus npm's always-included
// entries — without lifecycle scripts (dist/ is already built above).
function packWorkspacePackage(pkg, runtimeNodeModulesDir) {
  // Sequential packs share one staging dir inside runtimeRoot so the final
  // rename stays on the same filesystem as node_modules.
  const stage = path.join(runtimeRoot, '.pack');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    run(npm, ['pack', pkg.dir, '--ignore-scripts', '--pack-destination', stage], runtimeRoot);
    const [tarball] = fs.readdirSync(stage).filter((name) => name.endsWith('.tgz'));
    if (!tarball) {
      throw new Error(`[dshd-remote] npm pack produced no tarball for ${pkg.name}`);
    }
    fs.mkdirSync(path.join(stage, 'out'));
    run('tar', ['-xzf', tarball, '-C', 'out'], stage, { shell: false });
    const destination = path.join(runtimeNodeModulesDir, ...pkg.name.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(path.join(stage, 'out', 'package'), destination);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (buildRuntime) {
  if (!fs.existsSync(runtimeDepSource)) {
    run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], upstreamRoot);
  }
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeNodeModules, { recursive: true });
  const serverManifest = JSON.parse(fs.readFileSync(
    path.join(upstreamRoot, 'packages', 'server', 'package.json'),
    'utf8',
  ));
  const sqliteVersion = serverManifest.optionalDependencies?.['better-sqlite3'];
  if (!sqliteVersion) {
    throw new Error('[dshd-remote] vendored server does not declare better-sqlite3');
  }
  // The vendored workspace is installed from its own package-lock.json, so
  // the closure below is pinned; the old synthetic project ran npm install
  // without a lockfile and let transitive dependencies float.
  console.log('[dshd-remote] assembling DSHD-only production daemon dependencies');
  const plan = planRuntimeClosure({
    workspaceRoot: upstreamRoot,
    seeds: ['highlight', 'protocol', 'relay', 'server'],
    forcedDependencies: ['better-sqlite3'],
  });
  const sqliteSource = plan.copies.find((copy) => copy.target === 'better-sqlite3');
  const sqliteInstalled = sqliteSource && readManifest(sqliteSource.source).version;
  if (!sqliteInstalled || !semver.satisfies(sqliteInstalled, sqliteVersion)) {
    throw new Error(`[dshd-remote] installed better-sqlite3@${sqliteInstalled || 'missing'} does not satisfy ${sqliteVersion}`);
  }
  for (const pkg of plan.workspacePackages) {
    packWorkspacePackage(pkg, runtimeNodeModules);
  }
  materializeRuntimeCopies(plan.copies, runtimeNodeModules);
  const dependencies = {};
  for (const { name, dir } of plan.workspacePackages) {
    dependencies[name] = readManifest(dir).version;
  }
  for (const { target, source } of plan.copies) {
    if (!target.includes('node_modules')) {
      dependencies[readManifest(source).name] = readManifest(source).version;
    }
  }
  fs.writeFileSync(
    path.join(runtimeRoot, 'package.json'),
    `${JSON.stringify({ name: 'whale-isle-dshd-desktop-runtime', private: true, dependencies }, null, 2)}\n`,
  );
  pruneNodePtyRuntime();
  pruneWeriftRuntime();
  prepareElectronSqliteRuntime();
  assertTrimmedRuntime();
  await probeDshdDaemonRuntime();
}

console.log('[dshd-remote] ready');
