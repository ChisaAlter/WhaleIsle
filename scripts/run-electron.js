const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const ENGINE_BOOLEAN_SWITCH_RE = /^--(disable-gpu|enable-logging|headless)$/;
const ENGINE_VALUE_SWITCH_RE = /^--(inspect(-brk)?|remote-debugging-(port|address)|use-gl|v|vmodule)(?:=(.*))?$/;

/**
 * Partition CLI arguments so V8 inspector and Chromium switches precede `'.'`.
 * @param {string[]} argv
 * @returns {string[]}
 */
function buildElectronArgs(argv = []) {
  /** @type {string[]} */
  const engineFlags = [];
  /** @type {string[]} */
  const appArgs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      appArgs.push(...argv.slice(i));
      break;
    }
    if (ENGINE_BOOLEAN_SWITCH_RE.test(arg)) {
      engineFlags.push(arg);
      continue;
    }
    const valMatch = ENGINE_VALUE_SWITCH_RE.exec(arg);
    if (valMatch) {
      engineFlags.push(arg);
      if (valMatch[4] === undefined && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        engineFlags.push(argv[++i]);
      }
      continue;
    }
    appArgs.push(arg);
  }
  return [...engineFlags, '.', ...appArgs];
}

/**
 * Clone environment for child Electron launch without ELECTRON_RUN_AS_NODE.
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {NodeJS.ProcessEnv}
 */
function buildChildEnv(baseEnv = process.env) {
  const childEnv = { ...baseEnv };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return childEnv;
}

function candidates() {
  const list = [];
  if (process.env.ELECTRON_PATH) {
    list.push(process.env.ELECTRON_PATH);
  }
  list.push(
    path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
    path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron'),
  );
  return list;
}

function main() {
  const electronBin = candidates().find((item) => item && fs.existsSync(item));
  if (!electronBin) {
    console.error('未找到本机 Electron。设置环境变量 ELECTRON_PATH 指向 electron.exe，或把已有的 dist 目录放到 node_modules/electron/dist。');
    process.exit(1);
  }

  const args = buildElectronArgs(process.argv.slice(2));
  const child = spawn(electronBin, args, {
    cwd: repoRoot,
    env: buildChildEnv(process.env),
    stdio: 'inherit',
    windowsHide: false,
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildElectronArgs,
  buildChildEnv,
};
