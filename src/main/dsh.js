const fs = require('fs');
const net = require('net');
const path = require('path');
const { createRequire } = require('module');
const { spawn, execFile, execFileSync } = require('child_process');
const EventEmitter = require('events');
const { loadConfig, configPath } = require('./config');
const { DESKTOP_PACKAGES } = require('../shared/harness-desktop-forks');
const { missingDeclaredEntries } = require('./plugin-runtime-files');
const { harnessRoot } = require('./paths');
const { ensurePackagedHarness, harnessArchivePath } = require('./harness-extract');
const { childSpawnEnv } = require('../shared/child-spawn-env');
const { desktopInstallEnv } = require('./desktop-install-control');
const { officeRuntimeEnv } = require('./office-runtime');
const { taskControlToken } = require('./task-protection');
const { platformToken } = require('./platform-session');
const { readPin } = require('../shared/harness-upstream');
const { probeHarnessReady, isUnpublishedHarnessNpm } = require('./harness-browser-auth');

const PORT_SCAN_RANGE = 50;

const READY_TIMEOUT_MS = 180_000;
const LOG_LIMIT = 400;

function whichAll(command) {
  try {
    const bin = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(bin, [command], { encoding: 'utf8' });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isUsableNode(bin) {
  if (!bin || !fs.existsSync(bin)) {
    return false;
  }
  const normalized = path.normalize(bin);
  if (/electron/i.test(normalized)) {
    return false;
  }
  if (process.execPath && path.normalize(process.execPath) === normalized) {
    return false;
  }
  return true;
}

function bundledNodeBin() {
  try {
    const { app } = require('electron');
    if (!app.isPackaged) {
      return null;
    }
    return firstExisting([
      path.join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
      path.join(process.resourcesPath, 'node.exe'),
      path.join(process.resourcesPath, 'node'),
    ]);
  } catch {
    return null;
  }
}

function resolveNodeBin(config) {
  if (isUsableNode(config.nodeBin)) {
    return config.nodeBin;
  }
  const bundled = bundledNodeBin();
  if (isUsableNode(bundled)) {
    return bundled;
  }
  const preferred = firstExisting([
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ]);
  if (preferred) {
    return preferred;
  }
  const fromPath = whichAll(process.platform === 'win32' ? 'node.exe' : 'node')
    .concat(whichAll('node'))
    .find(isUsableNode);
  return fromPath || null;
}

function resolveNpx(nodeBin) {
  if (!nodeBin) {
    return null;
  }
  const dir = path.dirname(nodeBin);
  const npx = firstExisting([
    path.join(dir, 'npx.cmd'),
    path.join(dir, 'npx'),
    path.join(dir, 'npx.exe'),
  ]);
  return npx;
}

function resolveDshBin(config) {
  const source = sourceHarnessStatus();
  if (source.present) {
    return source.bin;
  }
  if (config.dshBin && fs.existsSync(config.dshBin)) {
    return config.dshBin;
  }
  const npmGlobal = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    : null;
  const fromPath = whichAll(process.platform === 'win32' ? 'dsh.cmd' : 'dsh')[0]
    || whichAll('dsh')[0];
  return firstExisting([fromPath, npmGlobal]);
}

function sourceHarnessStatus() {
  const root = harnessRoot();
  const binJs = path.join(root, 'apps', 'cli', 'lib', 'bin.js');
  const binTs = path.join(root, 'apps', 'cli', 'src', 'bin.ts');
  const webDist = path.join(root, 'apps', 'web', 'dist', 'index.html');
  const builtOnDisk = fs.existsSync(binJs) && fs.existsSync(webDist);
  let archived = false;
  try {
    const { app } = require('electron');
    archived = Boolean(app.isPackaged && fs.existsSync(harnessArchivePath()));
  } catch {
    // app not ready
  }
  return {
    root,
    present: fs.existsSync(binTs) || fs.existsSync(binJs) || archived,
    installed: fs.existsSync(path.join(root, 'node_modules')) || archived,
    built: builtOnDisk || archived,
    bin: fs.existsSync(binJs) ? binJs : binTs,
  };
}

function forkPackageDirFromAnchor(anchor, packageName) {
  try {
    const searchPaths = createRequire(anchor).resolve.paths(packageName) || [];
    for (const searchPath of searchPaths) {
      const candidate = path.join(searchPath, packageName);
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
    }
  } catch {
    // Invalid anchors resolve nothing; the caller treats that as missing.
  }
  return '';
}

/**
 * Registered desktop fork packages the shipped web composition mounts but the
 * harness install cannot load. The dsh Loader imports every composed row
 * with the profile directory as parent and relies on the healed
 * `profiles/node_modules` fallback, which silently skips unresolvable names —
 * a missing in-box package then dies deep in Node's ESM loader
 * (`ERR_MODULE_NOT_FOUND … imported from …profiles/web/`) on every start,
 * including --skip-user-plugins recovery starts. A resolvable manifest whose
 * declared entries were never built (vendor pull without setup:harness) dies
 * the same way, so the probe checks entries too via the same predicate as the
 * packaging gate. Probing before spawn turns that loop into one actionable
 * startup error. Resolution mirrors the runtime's anchors: the CLI install
 * anchor first, then each shipped bundle's own manifest (pnpm's isolated
 * layout keeps bundle dependencies beside the bundle, not beside the CLI).
 * @param {string} root - harness root (source tree or extracted runtime).
 * @returns {string[]} unloadable package names or `name/entry` paths; empty when the anchor itself is absent.
 */
function missingDesktopForkPackages(root) {
  const cliAnchor = path.join(root, 'apps', 'cli', 'package.json');
  if (!fs.existsSync(cliAnchor)) {
    return [];
  }
  const anchors = [cliAnchor];
  for (const bundle of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    const dir = forkPackageDirFromAnchor(cliAnchor, bundle);
    if (dir) {
      anchors.push(path.join(dir, 'package.json'));
    }
  }
  const missing = [];
  for (const pkg of DESKTOP_PACKAGES) {
    let dir = '';
    for (const anchor of anchors) {
      dir = forkPackageDirFromAnchor(anchor, pkg.name);
      if (dir) {
        break;
      }
    }
    if (!dir) {
      missing.push(pkg.name);
      continue;
    }
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      // An unreadable manifest cannot declare entries; reported as the manifest itself below.
    }
    if (!manifest) {
      missing.push(`${pkg.name}/package.json`);
      continue;
    }
    for (const rel of missingDeclaredEntries(dir, manifest)) {
      missing.push(`${pkg.name}/${rel}`);
    }
  }
  return missing;
}

function execTimed(command, args, timeoutMs = 2500, run = execFile) {
  return new Promise((resolve) => {
    run(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }, (_error, stdout) => resolve(stdout ? String(stdout) : ''));
  });
}

function isSelfPid(pid) {
  return pid === process.pid || pid === process.ppid;
}

async function isSafeToKill(pid, run = execFile) {
  if (!pid || isSelfPid(pid)) {
    return false;
  }
  const name = (await processImageName(pid, run)).toLowerCase();
  if (!name || name.includes('electron')) {
    return false;
  }
  return /^(node|dsh)(\.exe)?$/.test(name);
}

async function killTree(pid, run = execFile) {
  if (!pid || !await isSafeToKill(pid, run)) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      await execTimed('taskkill', ['/pid', String(pid), '/T', '/F'], 2500, run);
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function pidFilePath() {
  try {
    return path.join(path.dirname(configPath()), 'dshd-web.pid');
  } catch {
    return null;
  }
}

function readPidFile() {
  const file = pidFilePath();
  if (!file || !fs.existsSync(file)) {
    return null;
  }
  const pid = Number(fs.readFileSync(file, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function writePidFile(pid) {
  const file = pidFilePath();
  if (!file || !pid) {
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(pid), 'utf8');
}

function clearPidFile() {
  const file = pidFilePath();
  if (file && fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

function processAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processImageName(pid, run = execFile) {
  try {
    if (process.platform === 'win32') {
      const out = (await execTimed('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], 2000, run)).trim();
      const match = out.match(/^"([^"]+)"/);
      return match ? match[1] : '';
    }
    return (await execTimed('ps', ['-p', String(pid), '-o', 'comm='], 2000, run)).trim();
  } catch {
    return '';
  }
}

function quoteWindowsCommand(command) {
  const value = String(command).trim();
  if (!value) {
    return command;
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value;
  }
  if (/[\s&()^<>|]/.test(value)) {
    return `"${value.replace(/"/g, '')}"`;
  }
  return value;
}

/**
 * Spawn plan for the harness child. Windows `.cmd`/`.bat` shims need
 * `shell: true`, and under a shell Node joins the args verbatim — an
 * unquoted path with spaces (overlay files live under `AppData\Roaming\…`)
 * would split into separate tokens, so every whitespace-bearing arg gets the
 * same quoting as the command.
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} [isWin]
 * @returns {{ command: string, args: string[], shell: boolean }}
 */
function harnessSpawnPlan(command, args, isWin = process.platform === 'win32') {
  const needsShell = isWin && /\.(cmd|bat)$/i.test(command);
  if (!needsShell) {
    return { command, args, shell: false };
  }
  return {
    command: quoteWindowsCommand(command),
    args: args.map(quoteWindowsCommand),
    shell: true,
  };
}

function spawnHarness(command, args, options) {
  const plan = harnessSpawnPlan(command, args);
  return spawn(plan.command, plan.args, {
    ...options,
    windowsHide: true,
    shell: plan.shell,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Host usable for TCP connects / fetch / BrowserView loads. Wildcard binds
 * (`0.0.0.0`, `::`) accept connections on loopback but are not themselves
 * connectable targets on every platform (Windows rejects them outright).
 */
function connectHost(host) {
  const value = String(host || '').trim().replace(/^\[|\]$/g, '');
  if (!value || value === '0.0.0.0' || value === '::' || value === '*') {
    return '127.0.0.1';
  }
  return value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Readiness-line matcher for `dsh web: <url>`. The harness prints the
 * loopback URL today, but an externally installed dsh may echo the configured
 * host, so the pattern accepts loopback, localhost, the configured host, and
 * its connectable form instead of hardcoding `127.0.0.1|localhost` (L-2).
 */
function readyUrlPattern(host) {
  const hosts = new Set(['127.0.0.1', 'localhost']);
  const configured = String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (configured) {
    // IPv6 literals appear bracketed inside URLs.
    hosts.add(configured.includes(':') ? `[${configured}]` : configured);
  }
  hosts.add(connectHost(host).toLowerCase());
  const alternatives = [...hosts].map(escapeRegExp).join('|');
  return new RegExp(`dsh web:\\s*(https?:\\/\\/(?:${alternatives}):\\d+(?:\\/[^\\s]*)?)`, 'i');
}

function isPortInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (used) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(used);
    };
    socket.setTimeout(400, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Whether this process can actually LISTEN on host:port. Windows reserves
 * dynamic TCP port blocks (Hyper-V / WinNAT, e.g. 2989-3088) that hold no
 * listener: the connect probe above calls such a port "free" while any real
 * bind dies with EACCES. Ports already held by someone also fail here
 * (EADDRINUSE), so a `true` result means "free AND bindable by us".
 */
function bindPortStatus(host, port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    let settled = false;
    const done = (status) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.removeAllListeners();
      server.close(() => {});
      resolve(status);
    };
    const timer = setTimeout(() => done({ ok: false, errorCode: 'TIMEOUT' }), timeoutMs);
    server.once('error', (error) => done({
      ok: false,
      errorCode: error?.code || 'UNKNOWN',
    }));
    server.once('listening', () => done({ ok: true, errorCode: null }));
    const bindOn = String(host || '').trim().replace(/^\[|\]$/g, '') || undefined;
    try {
      server.listen({ host: bindOn, port });
    } catch {
      done({ ok: false, errorCode: 'UNKNOWN' });
    }
  });
}

function canBindPort(host, port, timeoutMs = 600) {
  return bindPortStatus(host, port, timeoutMs).then((status) => status.ok);
}

function bindFailure(status) {
  const code = status?.errorCode;
  return code && code !== 'EACCES' && code !== 'EADDRINUSE' && code !== 'TIMEOUT';
}

function throwBindFailure(host, port, status) {
  if (!bindFailure(status)) {
    return;
  }
  const error = new Error(`无法监听 ${host || '*'}:${port}（${status.errorCode}）`);
  error.code = status.errorCode;
  throw error;
}

async function findFreePort(host, startPort, deps = {}) {
  const bindable = deps.bindable || ((bindOn, port) => canBindPort(bindOn, port));
  const bindStatus = deps.bindableStatus || ((bindOn, port) => bindPortStatus(bindOn, port));
  const probeHost = connectHost(host);
  const begin = Number(startPort) || 3080;
  for (let port = begin; port < begin + PORT_SCAN_RANGE; port += 1) {
    if (await isPortInUse(probeHost, port)) {
      continue;
    }
    const status = deps.bindable
      ? { ok: await bindable(host, port), errorCode: null }
      : await bindStatus(host, port);
    throwBindFailure(host, port, status);
    if (status.ok) {
      return port;
    }
  }
  throw new Error(`从 ${begin} 起连续 ${PORT_SCAN_RANGE} 个端口都不可用（被占用或被系统保留）`);
}

async function probePort(host, port) {
  const probeHost = connectHost(host);
  const inUse = await isPortInUse(probeHost, port);
  if (!inUse) {
    return { host: probeHost, port, inUse: false, httpReady: false };
  }
  const baseUrl = `http://${probeHost}:${port}`;
  let httpReady = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const response = await fetch(baseUrl, { signal: controller.signal });
    clearTimeout(timer);
    httpReady = response.ok;
  } catch {
    httpReady = false;
  }
  return { host: probeHost, port, inUse: true, httpReady, baseUrl };
}

/**
 * Make `port` ours for this GUI process. Only a leftover confirmed by our own
 * pid file (and passing the node/dsh image-name guard) may be stopped; any
 * other listener — even one that looks like a dsh server — belongs to someone
 * else, so we hop to the next free port instead of killing by process name.
 */
async function ensureOwnedPort(host, wantedPort, log = () => {}, deps = {}) {
  const bindable = deps.bindable || ((bindOn, port) => canBindPort(bindOn, port));
  const bindStatus = deps.bindableStatus || ((bindOn, port) => bindPortStatus(bindOn, port));
  const wanted = Number(wantedPort) || 3080;
  // No listener ≠ usable: a Windows-excluded port passes the connect probe
  // but kills the harness on bind (EACCES), so confirm bindability too.
  const takeIfBindable = async () => {
    const status = deps.bindable
      ? { ok: await bindable(host, wanted), errorCode: null }
      : await bindStatus(host, wanted);
    throwBindFailure(host, wanted, status);
    if (status.ok) {
      log(`端口 ${wanted} 空闲`);
      return wanted;
    }
    const next = await findFreePort(host, wanted + 1, deps);
    log(`端口 ${wanted} 被系统保留或无权监听，改用 ${next}`);
    return next;
  };
  let probe = await probePort(host, wanted);
  if (!probe.inUse) {
    clearPidFile();
    return takeIfBindable();
  }

  const previous = readPidFile();
  if (previous && processAlive(previous) && await isSafeToKill(previous)) {
    log(`停止上次残留的 dsh（pid ${previous}）`);
    await killTree(previous);
    await sleep(400);
    probe = await probePort(host, wanted);
    if (!probe.inUse) {
      clearPidFile();
      return takeIfBindable();
    }
  }
  clearPidFile();

  const next = await findFreePort(host, wanted + 1, deps);
  log(`端口 ${wanted} 被其他程序占用，改用 ${next}`);
  return next;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cancelledError(message = '启动已取消') {
  const error = new Error(message);
  error.code = 'DSH_CANCELLED';
  return error;
}

function defaultReadPin() {
  const roots = [path.join(__dirname, '..', '..')];
  try {
    const { projectRoot } = require('./paths');
    roots.unshift(projectRoot());
  } catch {
    // electron is unavailable outside the desktop process
  }
  let lastError;
  for (const root of roots) {
    try {
      return readPin(root);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('vendor/harness-upstream.json is missing');
}

function failureRecord(phase, message, code, signal) {
  return {
    phase,
    message,
    code: code === undefined || code === null ? null : code,
    signal: signal || null,
    occurredAt: new Date().toISOString(),
  };
}

class DshManager extends EventEmitter {
  /**
   * @param {object} [options] 窄依赖注入；不传任何选项时全部使用生产默认实现。
   *   可注入：loadConfig、ensurePackagedHarness、spawnHarness、isReachable、
   *   probeHarnessReady、
   *   sleep、readPidFile、writePidFile、clearPidFile、killTree、
   *   buildLaunch（测试需要绕过 electron 依赖时按需注入）、ensureGhosttyAssetsInHarness。
   */
  constructor(options = {}) {
    super();
    this.child = null;
    this.state = 'idle';
    this.logs = [];
    this.startLogIndex = null;
    this.error = '';
    this.failure = null;
    this.baseUrl = '';
    this.sessionCookie = '';
    this.webReady = false;
    this.attached = false;
    this.host = '127.0.0.1';
    this.port = 3080;
    this.generation = 0;
    this.inFlight = null;
    this._stopPromise = null;
    this._deps = {
      loadConfig: options.loadConfig || loadConfig,
      ensurePackagedHarness: options.ensurePackagedHarness || ensurePackagedHarness,
      spawnHarness: options.spawnHarness || spawnHarness,
      isReachable: options.isReachable || ((url, guard) => this.isReachable(url, guard)),
      probeHarnessReady: options.probeHarnessReady || probeHarnessReady,
      sleep: options.sleep || sleep,
      readPidFile: options.readPidFile || readPidFile,
      writePidFile: options.writePidFile || writePidFile,
      clearPidFile: options.clearPidFile || clearPidFile,
      killTree: options.killTree || killTree,
      buildLaunch: options.buildLaunch || ((config) => this.buildLaunch(config)),
      sourceHarnessStatus: options.sourceHarnessStatus || sourceHarnessStatus,
      resolveDshBin: options.resolveDshBin || resolveDshBin,
      resolveNpx: options.resolveNpx || resolveNpx,
      resolveNodeBin: options.resolveNodeBin || resolveNodeBin,
      missingDesktopForkPackages: options.missingDesktopForkPackages || missingDesktopForkPackages,
      readPin: options.readPin || defaultReadPin,
      ensureGhosttyAssetsInHarness: options.ensureGhosttyAssetsInHarness || ((root) => {
        const { ensureGhosttyAssetsInHarness } = require('../shared/ghostty-assets');
        return ensureGhosttyAssetsInHarness(root);
      }),
    };
  }

  snapshot() {
    return {
      state: this.state,
      error: this.error,
      baseUrl: this.baseUrl,
      attached: this.attached,
      logs: this.logs.slice(-80),
      failure: this.failure,
    };
  }

  setState(state, extra = {}) {
    this.state = state;
    if (extra.error !== undefined) {
      this.error = extra.error;
    }
    if (extra.baseUrl !== undefined) {
      this.baseUrl = extra.baseUrl;
    }
    if (extra.attached !== undefined) {
      this.attached = extra.attached;
    }
    if (extra.failure !== undefined) {
      this.failure = extra.failure;
    }
    this.emit('state', this.snapshot());
  }

  log(line, source = 'app') {
    const text = String(line).replace(/\s+$/, '');
    if (!text) {
      return;
    }
    const entry = `[${source}] ${text}`;
    this.logs.push(entry);
    if (this.logs.length > LOG_LIMIT) {
      const removed = this.logs.length - LOG_LIMIT;
      this.logs.splice(0, removed);
      if (this.startLogIndex !== null) this.startLogIndex = Math.max(0, this.startLogIndex - removed);
    }
    this.emit('log', entry);
  }

  beginStartLog() {
    this.startLogIndex = this.logs.length;
  }

  currentStartLogs() {
    return this.startLogIndex === null ? [] : this.logs.slice(this.startLogIndex);
  }

  async isReachable(baseUrl, guard) {
    const probed = await this._deps.probeHarnessReady(baseUrl, { fetchImpl: fetch, timeoutMs: 1500 });
    if (typeof guard === 'function' && guard() !== true) {
      return false;
    }
    if (probed.cookie) {
      this.sessionCookie = probed.cookie;
    }
    return probed.ok;
  }

  buildLaunch(config) {
    const host = config.host || '127.0.0.1';
    const port = Number(config.port) || 3080;
    const workspace = config.workspace;
    const nodeBin = this._deps.resolveNodeBin(config);
    const npxBin = this._deps.resolveNpx(nodeBin);
    const source = this._deps.sourceHarnessStatus();
    const args = ['web'];
    if (config.skipUserPlugins === true) {
      args.push('--skip-user-plugins');
    }
    for (const patchFile of Array.isArray(config.patchFiles) ? config.patchFiles : []) {
      if (typeof patchFile === 'string' && patchFile) {
        args.push('--patch', patchFile);
      }
    }
    // Electron owns the page in BrowserView. Official dsh web opens the OS
    // browser unless this invocation opts out.
    args.push('--host', host, '--port', String(port), '--no-open');

    if (source.present) {
      if (!source.installed || !source.built) {
        throw new Error(
          `已集成官方源码（vendor/deepseek-harness），但还没安装依赖或构建。请运行 npm run setup:harness`,
        );
      }
      if (!nodeBin) {
        throw new Error('未找到 Node.js。请安装 Node.js 22.19+ 或 24+。');
      }
      if (typeof source.root !== 'string' || !source.root) {
        throw new Error('终端 Ghostty 资源不完整，请运行 npm run setup:harness：缺少 harness 根路径');
      }
      const ghostty = this._deps.ensureGhosttyAssetsInHarness(source.root);
      if (!ghostty || ghostty.ok !== true) {
        const detail = ghostty && ghostty.detail ? String(ghostty.detail) : 'ensure 未返回 ok';
        throw new Error(`终端 Ghostty 资源不完整，请运行 npm run setup:harness：${detail}`);
      }
      const missingForks = this._deps.missingDesktopForkPackages(source.root);
      if (missingForks.length > 0) {
        throw new Error(
          `Harness 运行时缺少桌面组件包：${missingForks.join(', ')}。`
          + '「跳过用户插件」无法修复内置组件缺失——源码运行请执行 npm run setup:harness；'
          + '安装包请重新下载并重装当前版本。',
        );
      }
      return {
        command: nodeBin,
        args: [source.bin, ...args],
        nodeBin,
        kind: 'source',
        host,
        port,
        workspace,
      };
    }

    const dshBin = this._deps.resolveDshBin(config);
    if (dshBin) {
      return {
        command: dshBin,
        args,
        nodeBin,
        kind: 'dsh',
        host,
        port,
        workspace,
      };
    }

    if (!npxBin) {
      throw new Error('未找到 Node.js / npx。请安装 Node.js 22.19+ 或 24+ 并确保 npx 在 PATH 中。');
    }

    const pin = this._deps.readPin();
    const npm = pin && pin.npm;
    if (isUnpublishedHarnessNpm(npm)) {
      throw new Error(
        `官方 npm 尚未发布 @deepseek-ai/dsh@${npm}，不能用 npx 回落。请运行 npm run setup:harness 使用 vendor 源码。`,
      );
    }
    return {
      command: npxBin,
      args: ['--yes', `@deepseek-ai/dsh@${npm}`, ...args],
      nodeBin,
      kind: 'npx',
      host,
      port,
      workspace,
    };
  }

  spawnEnv(config, nodeBin) {
    const extras = [];
    if (process.env.APPDATA) {
      extras.push(path.join(process.env.APPDATA, 'npm'));
    }
    if (nodeBin) {
      extras.push(path.dirname(nodeBin));
    }
    let root = null;
    try {
      root = harnessRoot();
      extras.push(path.join(root, 'node_modules', '.bin'));
    } catch {
      // app not ready
    }
    const env = childSpawnEnv(config, { extras });
    env.npm_config_yes = 'true';
    if (root) {
      env.DSH_HARNESS_ROOT = root;
    }
    Object.assign(env, desktopInstallEnv());
    // Carrier declaration for Office rows in any profile layer that reads it;
    // the desktop overlay already carries absolute paths, so a missing
    // payload simply leaves this unset.
    Object.assign(env, officeRuntimeEnv());
    env.DSHD_TASK_CONTROL_TOKEN = taskControlToken();
    env.DSHD_PLATFORM_TOKEN = platformToken();
    // Producer-coverage declarations: the control plugin reports these as
    // `unavailable` (not `intentional-disabled`) when the flag is set but the
    // service is missing — a load failure must never read as "deliberately off".
    if (config.dshbotEnabled === true) env.DSHD_DSHBOT_ENABLED = '1';
    if (config.scheduleEnabled === true) env.DSHD_SCHEDULE_ENABLED = '1';
    return env;
  }

  attachOutput(child) {
    const pattern = readyUrlPattern(this.host);
    const onChunk = (chunk, source) => {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        this.log(line, source);
        const match = line.match(pattern);
        if (match) {
          // Wildcard hosts in the announced URL are bind targets, not connect
          // targets: rewrite them so reachability checks and the BrowserView
          // load use a connectable address.
          const url = new URL(match[1]);
          url.hostname = connectHost(url.hostname);
          this.baseUrl = url.toString().replace(/\/$/, '');
          this.webReady = true;
        }
      }
    };
    child.stdout?.on('data', (chunk) => onChunk(chunk, 'dsh'));
    child.stderr?.on('data', (chunk) => onChunk(chunk, 'dsh'));
  }

  /**
   * 单飞入口：已有 in-flight start 时直接复用；ready 且子进程存活时直接返回。
   */
  async start(options = {}) {
    if (this.inFlight) {
      return this.inFlight;
    }
    if (this.state === 'ready' && this.child && this.child.exitCode === null) {
      return this.baseUrl;
    }
    const run = this._start(options);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) {
        this.inFlight = null;
      }
    }
  }

  async _start(options = {}) {
    if (this._stopPromise) {
      // 与 stop 重叠：等 stop 收尾后再启动，避免互相踩踏
      await this._stopPromise;
    }
    // The controller opens the boundary before preparation; direct starts
    // open it here. Keep the full history for diagnostics, not attribution.
    if (this.state !== 'starting') this.beginStartLog();
    const gen = ++this.generation;
    const isCurrent = () => gen === this.generation;

    if (this.child) {
      const leftover = this.child.pid;
      this.log(`清理残留 dsh 进程（pid ${leftover}）`);
      this.child = null;
      await this._killTree(leftover);
      await this._sleep(300);
      if (!isCurrent()) {
        throw cancelledError();
      }
    }

    // A start may carry the one config snapshot its caller read, so the port,
    // workspace, plugin switches, and CLI flags all come from the same read
    // even if a Settings save lands while the child is being prepared.
    const config = options.configSnapshot || this._loadConfig();
    if (!config.workspace || !fs.existsSync(config.workspace)) {
      throw new Error(`工作区不存在：${config.workspace || '(空)'}`);
    }

    // An installed channel must work when the desktop is started directly,
    // without requiring the launcher or component settings window to be open.
    // A component failure is reported without preventing other channels.
    try {
      await require('../launcher/whalebridge').ensureWhaleBridgeRuntime();
    } catch (error) {
      this.log(`鲸桥不可用：${error.message}`, 'app');
    }

    const preparationAbort = new AbortController();
    this.preparationAbort = preparationAbort;
    try {
      await this._ensurePackagedHarness((line) => { if (isCurrent()) this.log(line); }, { signal: preparationAbort.signal });
      if (!isCurrent()) {
        throw cancelledError();
      }
    } catch (error) {
      if (!isCurrent()) {
        throw cancelledError();
      }
      if (error?.code === 'DSH_CANCELLED') {
        throw error;
      }
      throw new Error(`准备运行时失败：${error.message}`);
    } finally {
      if (this.preparationAbort === preparationAbort) this.preparationAbort = null;
    }

    const port = Number(options.port) || Number(config.port) || 3080;
    const launch = this._buildLaunch({ ...config, ...options, port });
    const expectedUrl = `http://${connectHost(launch.host)}:${launch.port}`;
    this.host = launch.host;
    this.port = launch.port;
    this.error = '';
    this.attached = false;
    this.webReady = false;
    this.sessionCookie = '';
    this.setState('starting', { baseUrl: expectedUrl, attached: false, failure: null });
    this.log(`工作区 ${config.workspace}`);
    this.log(`启动本机服务 ${expectedUrl}`);

    if (launch.kind === 'source') {
      this.log(`从官方源码启动 ${launch.args[0]}`);
    } else if (launch.kind === 'dsh') {
      this.log(`启动 ${launch.command}`);
    } else {
      this.log('通过 npx 启动 @deepseek-ai/dsh（首次会下载运行时）');
    }

    const readiness = deferred();
    let child = null;
    try {
      const env = this.spawnEnv(config, launch.nodeBin);
      this.log(`子进程 DSH_HOME ${env.DSH_HOME}`);
      child = this._spawnHarness(launch.command, launch.args, {
        cwd: config.workspace,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      this.attachOutput(child);
      this._writePidFile(child.pid);

      child.on('error', (error) => this._onChildError(gen, child, error, readiness));
      child.on('exit', (code, signal) => this._onChildExit(gen, child, code, signal, readiness));

      this.waitUntilReady(expectedUrl, child, gen).then(
        (url) => readiness.resolve(url),
        (error) => readiness.reject(error),
      );

      const url = await readiness.promise;
      if (!isCurrent()) {
        throw cancelledError();
      }
      this.setState('ready', { baseUrl: url, attached: false, failure: null });
      this.log(`Web UI 就绪 ${url}`);
      return url;
    } catch (error) {
      if (!isCurrent()) {
        const stalePid = child?.pid;
        if (stalePid && this.child === child) {
          this.child = null;
          this._clearPidFile();
          await this._killTree(stalePid);
        }
        // 本代已被 stop/restart 取消：状态由 stop 收尾为 idle，这里绝不改写
        throw error;
      }
      const pid = (child || this.child)?.pid;
      this.child = null;
      this._clearPidFile();
      if (!this.failure) {
        const message = error && error.message ? error.message : String(error);
        this.error = message;
        this.log(message, 'error');
        this.setState('error', {
          error: message,
          failure: failureRecord('startup', message, null, null),
        });
      }
      if (pid) {
        await this._killTree(pid);
      }
      throw error;
    }
  }

  /** 当前代 child 的 error 事件：立即失败，保留真实错误，不等超时。 */
  _onChildError(gen, child, error, readiness) {
    if (gen !== this.generation || this.child !== child) {
      return; // 旧 child 或已失效 generation 的事件，一律无效
    }
    const message = error && error.message ? error.message : String(error);
    this.child = null;
    this._clearPidFile();
    this.error = message;
    this.log(message, 'error');
    const phase = this.state === 'ready' ? 'runtime' : 'startup';
    const failure = failureRecord(phase, message, null, null);
    this.setState('error', { error: message, failure });
    readiness.reject(error instanceof Error ? error : new Error(message));
  }

  /** 当前代 child 的 exit 事件：就绪前立即失败；就绪后记录 runtime failure；同时清 PID。 */
  _onChildExit(gen, child, code, signal, readiness) {
    if (gen !== this.generation || this.child !== child) {
      return; // 旧 child 或已失效 generation 的事件，一律无效
    }
    this.child = null;
    this._clearPidFile();
    if (this.state === 'stopping' || this.state === 'idle') {
      return; // stop 主动结束，状态由 stop() 收尾
    }
    const message = `dsh 进程结束（code ${code ?? 'null'}, signal ${signal || 'none'}）`;
    const phase = this.state === 'ready' ? 'runtime' : 'startup';
    const failure = failureRecord(phase, message, code, signal);
    this.error = message;
    this.log(message, 'error');
    this.setState('error', { error: message, failure });
    if (phase === 'startup') {
      readiness.reject(new Error(message));
    }
  }

  /**
   * 就绪轮询：每一轮都校验 generation 与 child 身份；被 stop 取消时抛 DSH_CANCELLED。
   * 启动期失败由 error/exit 处理器即时 reject readiness，这里负责正常就绪与超时。
   */
  async waitUntilReady(baseUrl, child, gen) {
    const started = Date.now();
    while (true) {
      if (gen !== this.generation || this.child !== child) {
        throw cancelledError();
      }
      if (child.exitCode !== null) {
        throw new Error(this.error || `dsh 已退出（code ${child.exitCode}）`);
      }
      const target = this.baseUrl || baseUrl;
      const stillCurrent = () => gen === this.generation && this.child === child;
      if (this.webReady && await this._isReachable(target, stillCurrent)) {
        // 注入的探活实现可能忽略 guard：发布 URL 前必须再次校验代际与 child。
        if (!stillCurrent()) {
          throw cancelledError();
        }
        this.baseUrl = target;
        return target;
      }
      if (Date.now() - started >= READY_TIMEOUT_MS) {
        throw new Error('启动超时。若本机已安装 dsh，检查端口占用；否则确认 npx 能运行 @deepseek-ai/dsh。');
      }
      await this._sleep(400);
    }
  }

  async stop() {
    if (this._stopPromise) {
      return this._stopPromise;
    }
    const run = this._doStop();
    this._stopPromise = run;
    try {
      await run;
    } finally {
      if (this._stopPromise === run) {
        this._stopPromise = null;
      }
    }
  }

  async _doStop() {
    this.generation += 1; // 使 in-flight start 与旧 child 事件全部失效
    this.preparationAbort?.abort();
    this.inFlight = null; // 下一次 start 从全新代开始
    this.attached = false;
    const child = this.child;
    const pid = child?.pid || this._readPidFile();
    // Drop the live child before SIGTERM/killTree so a cancelled start catch
    // cannot also killTree the same pid during the non-Windows grace sleep.
    this.child = null;
    if (pid) {
      this.setState('stopping');
      this.log(`停止 dsh（pid ${pid}）`);
      if (child && process.platform !== 'win32') {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        await this._sleep(800);
      }
      await this._killTree(pid);
    }
    this._clearPidFile();
    if (this.state !== 'idle') {
      this.setState('idle');
    }
  }

  async restart() {
    await this.stop();
    await this._sleep(300);
    return this.start();
  }

  // 依赖访问器（默认即生产实现，测试可注入）
  _loadConfig() {
    return this._deps.loadConfig();
  }

  _ensurePackagedHarness(log, options) {
    return this._deps.ensurePackagedHarness(log, options);
  }

  _spawnHarness(command, args, options) {
    return this._deps.spawnHarness(command, args, options);
  }

  _isReachable(url, guard) {
    return this._deps.isReachable(url, guard);
  }

  _sleep(ms) {
    return this._deps.sleep(ms);
  }

  _readPidFile() {
    return this._deps.readPidFile();
  }

  _writePidFile(pid) {
    return this._deps.writePidFile(pid);
  }

  _clearPidFile() {
    return this._deps.clearPidFile();
  }

  _killTree(pid) {
    return this._deps.killTree(pid);
  }

  _buildLaunch(config) {
    return this._deps.buildLaunch(config);
  }
}

module.exports = {
  killTree,
  DshManager,
  resolveNodeBin,
  resolveDshBin,
  sourceHarnessStatus,
  missingDesktopForkPackages,
  probePort,
  findFreePort,
  ensureOwnedPort,
  canBindPort,
  connectHost,
  readyUrlPattern,
  harnessSpawnPlan,
};
