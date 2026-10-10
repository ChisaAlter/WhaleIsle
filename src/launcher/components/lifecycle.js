'use strict';

// Process supervision for installed components: spawn through the host
// binary (Electron runs as plain node under ELECTRON_RUN_AS_NODE, which keeps
// components working without a separately installed Node), a native PID
// liveness probe, and tree kill — Windows-first: taskkill /PID <pid> /T /F,
// never kill -9.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const LOG_MAX_BYTES = 256 * 1024;

function resolvePlatform(deps = {}) {
  return typeof deps.platform === 'string' ? deps.platform : process.platform;
}

function isPidAlive(pid, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    // Signal 0 only asks the OS whether the PID exists. Spawning tasklist for
    // every status row can block the main process for hundreds of milliseconds.
    (deps.processKill || process.kill)(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'EPERM') return true;
    if (error && error.code === 'ESRCH') return false;
    throw error;
  }
}

function killPid(pid, { force = true } = {}, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (resolvePlatform(deps) === 'win32') {
    const exec = deps.execFileSync || execFileSync;
    try {
      exec('taskkill', force
        ? ['/PID', String(pid), '/T', '/F']
        : ['/PID', String(pid)], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function openLogStream(file, deps = {}) {
  const fsp = deps.fs || fs;
  try {
    fsp.mkdirSync(path.dirname(file), { recursive: true });
    const size = (() => {
      try {
        return fsp.statSync(file).size;
      } catch {
        return 0;
      }
    })();
    return fsp.createWriteStream(file, { flags: size > LOG_MAX_BYTES ? 'w' : 'a' });
  } catch {
    return null;
  }
}

// Spawn one component generation. Child output lands in <dataDir>/component.log
// so a crashed service leaves evidence for the panel/error state.
function spawnComponent({ entryFile, dir, dataDir: dataPath, logFile: logPath, id, version }, deps = {}) {
  const doSpawn = deps.spawn || spawn;
  const fsp = deps.fs || fs;
  try {
    fsp.mkdirSync(dataPath, { recursive: true });
  } catch {
    // best effort; spawn still attempted so the error surfaces normally
  }
  const logStream = openLogStream(logPath, deps);
  const child = doSpawn(deps.execPath || process.execPath, [entryFile], {
    cwd: dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LAUNCHER_COMPONENT_ID: id,
      LAUNCHER_COMPONENT_VERSION: String(version || ''),
      LAUNCHER_COMPONENT_DATA_DIR: dataPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (logStream) {
    if (child.stdout && typeof child.stdout.pipe === 'function') {
      child.stdout.pipe(logStream);
    }
    if (child.stderr && typeof child.stderr.pipe === 'function') {
      child.stderr.pipe(logStream);
    }
    if (typeof child.once === 'function') {
      child.once('exit', () => {
        try {
          logStream.end();
        } catch {
          // already closed
        }
      });
    }
  }
  return child;
}

// Cooperative components write <dataDir>/state.json {pid,port,url,...} once
// their endpoint is up. Poll briefly; an absent file is not an error (plain
// tools never write one) — liveness is the spawn/alive probe, this is only
// how `url` reaches the panel.
async function waitForStateFile(file, { timeoutMs = 4000, pollMs = 200, isDead } = {}, deps = {}) {
  const fsp = deps.fs || fs;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (typeof isDead === 'function' && isDead()) {
      return null;
    }
    try {
      const parsed = JSON.parse(fsp.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.pid) {
        return parsed;
      }
    } catch {
      // not written yet / mid-write
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
  return null;
}

function readStateFile(file, deps = {}) {
  const fsp = deps.fs || fs;
  try {
    const parsed = JSON.parse(fsp.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Keep manual traversal for ASAR payloads, with asynchronous filesystem calls
// so staging a component does not block Electron's main event loop.
async function copyDir(src, dest, deps = {}) {
  const fsp = (deps.fs || fs).promises;
  await fsp.mkdir(dest, { recursive: true });
  for (const item of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, item.name);
    const to = path.join(dest, item.name);
    if (item.isDirectory()) {
      await copyDir(from, to, deps);
    } else if (item.isFile()) {
      await fsp.copyFile(from, to);
    }
  }
}

async function removeDir(dir, deps = {}) {
  const fsp = (deps.fs || fs).promises;
  try {
    await fsp.rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isPidAlive,
  killPid,
  spawnComponent,
  waitForStateFile,
  readStateFile,
  copyDir,
  removeDir,
  LOG_MAX_BYTES,
};
