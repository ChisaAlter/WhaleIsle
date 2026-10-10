const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { app, shell } = require('electron');

const APP_ID = 'ai.deepseek.harness.gui';
const { PRODUCT_NAME, LEGACY_PRODUCT_NAME } = require('../shared/product-identity');
// The desktop runtime keeps this identity even once a slim launcher package
// exists: the launcher then scans for this product, not for itself.
const DESKTOP_TARGET = { appId: APP_ID, productName: PRODUCT_NAME };
const WINDOWS_UNINSTALL_REL = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const WINDOWS_UNINSTALL_WOW = 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const SETTINGS_APPS_URL = 'ms-settings:appsfeatures';

function productNames(productName) {
  return productName === PRODUCT_NAME ? [PRODUCT_NAME, LEGACY_PRODUCT_NAME] : [productName];
}

// `deps.target` selects which product's install registration to inspect.
// Absent → self (today's full package installs the desktop identity).
function resolveTarget(deps = {}) {
  const target = deps.target;
  return {
    appId: typeof target?.appId === 'string' && target.appId ? target.appId : APP_ID,
    productName: typeof target?.productName === 'string' && target.productName ? target.productName : PRODUCT_NAME,
    explicit: Boolean(target),
  };
}

function currentVersion() {
  try {
    return app.getVersion();
  } catch {
    return '0.0.0';
  }
}

function readPackagedFlag() {
  try {
    return app.isPackaged;
  } catch {
    return false;
  }
}

function parseRegValue(output, name) {
  const match = String(output || '').match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function parseRegUninstallString(output) {
  return parseRegValue(output, 'UninstallString');
}

function uninstallExeCandidates(installDir, productName = PRODUCT_NAME) {
  if (!installDir) {
    return [];
  }
  return [
    ...productNames(productName).map((name) => path.join(installDir, `Uninstall ${name}.exe`)),
    path.join(installDir, 'Uninstall.exe'),
  ];
}

// exe name of an installed product — electron-builder emits `<productName>.exe`.
function desktopExeCandidates(installPath, productName = PRODUCT_NAME) {
  if (!installPath) {
    return [];
  }
  return productNames(productName).flatMap((name) => [
    path.join(installPath, `${name}.exe`),
    path.join(installPath, 'app', `${name}.exe`),
  ]);
}

function firstExistingPath(candidates, existsSync = fs.existsSync.bind(fs)) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

// Installs predating the product rename can leave DisplayVersion blank in the
// registry record; the runtime exe still carries its version resource, so probe
// it once per exe change (cached by path+mtime — a powershell spawn per status
// poll would be noticeable).
const exeVersionCache = new Map();

function exeProductVersion(exePath, deps = {}) {
  if (!exePath) {
    return '';
  }
  const stat = typeof deps.statSync === 'function' ? deps.statSync : fs.statSync.bind(fs);
  const exec = deps.execFileSync || execFileSync;
  let mtimeMs = 0;
  try {
    mtimeMs = stat(exePath).mtimeMs;
  } catch {
    return '';
  }
  const hit = exeVersionCache.get(exePath);
  if (hit && hit.mtimeMs === mtimeMs) {
    return hit.version;
  }
  let version = '';
  try {
    const quoted = exePath.replace(/'/g, "''");
    const out = exec('powershell', [
      '-NoProfile', '-Command',
      `(Get-Item -LiteralPath '${quoted}').VersionInfo.ProductVersion`,
    ], { windowsHide: true, timeout: 5000 });
    // Windows file versions are four-part; drop a trailing ".0" so it reads
    // like the semver the registry would have recorded.
    version = String(out).trim().replace(/^(\d+\.\d+\.\d+)\.0+$/, '$1');
  } catch {
    version = '';
  }
  exeVersionCache.set(exePath, { mtimeMs, version });
  return version;
}

function installedExeVersion(installPath, target, deps = {}) {
  const exe = firstExistingPath(
    desktopExeCandidates(installPath, target.productName),
    typeof deps.existsSync === 'function' ? deps.existsSync : undefined,
  );
  return exeProductVersion(exe, deps);
}

function extractUninstallExe(uninstallCommand) {
  const quoted = String(uninstallCommand || '').match(/^"([^"]+\.exe)"/i);
  if (quoted) {
    return quoted[1];
  }
  const bare = String(uninstallCommand || '').match(/^([^\s]+\.exe)/i);
  return bare ? bare[1] : '';
}

function parseRegBlock(block, keyPath = '') {
  const displayName = parseRegValue(block, 'DisplayName');
  const uninstallCommand = parseRegUninstallString(block);
  const installPath = parseRegValue(block, 'InstallLocation')
    || parseRegValue(block, 'DisplayIcon').replace(/\\[^\\]+$/, '');
  const displayVersion = parseRegValue(block, 'DisplayVersion');
  if (!displayName && !installPath && !uninstallCommand) {
    return null;
  }
  return {
    key: keyPath,
    displayName,
    uninstallCommand,
    installPath: installPath.trim(),
    displayVersion,
  };
}

function uninstallRegistryKeyPaths(target) {
  const appId = (target && target.appId) || APP_ID;
  const keys = [];
  for (const root of ['HKLM', 'HKCU']) {
    for (const rel of [WINDOWS_UNINSTALL_REL, WINDOWS_UNINSTALL_WOW]) {
      keys.push(`${root}\\${rel}\\${appId}`);
    }
  }
  return keys;
}

function uninstallSearchRoots() {
  const roots = [];
  for (const hive of ['HKLM', 'HKCU']) {
    for (const rel of [WINDOWS_UNINSTALL_REL, WINDOWS_UNINSTALL_WOW]) {
      roots.push(`${hive}\\${rel}`);
    }
  }
  return roots;
}

let registryGetValue;

function unicodeRegistryBlock(key) {
  const match = String(key).match(/^(HKCU|HKLM|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)\\(.+)$/i);
  if (!match) return '';
  if (!registryGetValue) {
    registryGetValue = require('koffi').load('advapi32.dll').func(
      'int32_t __stdcall RegGetValueW(intptr_t, str16, str16, uint32_t, void *, void *, _Inout_ uint32_t *)',
    );
  }
  const hive = /^(HKCU|HKEY_CURRENT_USER)$/i.test(match[1]) ? -2147483647 : -2147483646;
  const lines = [key];
  for (const name of ['DisplayName', 'DisplayVersion', 'InstallLocation', 'DisplayIcon', 'UninstallString']) {
    const size = [0];
    // Read Unicode strings directly; console encodings can lose path characters.
    const flags = 0x10000006; // REG_SZ/REG_EXPAND_SZ, without expansion.
    if (registryGetValue(hive, match[2], name, flags, null, null, size) !== 0 || !size[0]) continue;
    const data = Buffer.alloc(size[0]);
    if (registryGetValue(hive, match[2], name, flags, null, data, size) !== 0) continue;
    lines.push(`    ${name}    REG_SZ    ${data.subarray(0, size[0]).toString('utf16le').replace(/\0+$/, '')}`);
  }
  return lines.join('\n');
}

function queryRegKey(key, deps = {}) {
  const execReg = deps.execFileSync || execFileSync;
  try {
    const output = execReg('reg', ['query', key], {
      windowsHide: true,
    });
    return Buffer.isBuffer(output) ? unicodeRegistryBlock(key) : String(output || '');
  } catch {
    return '';
  }
}

function resolvePlatform(deps = {}) {
  return typeof deps.platform === 'string' ? deps.platform : process.platform;
}

function findRegisteredWindowsInstall(deps = {}) {
  if (resolvePlatform(deps) !== 'win32') {
    return null;
  }
  const target = resolveTarget(deps);
  for (const key of uninstallRegistryKeyPaths(target)) {
    const parsed = parseRegBlock(queryRegKey(key, deps), key);
    if (parsed) {
      return parsed;
    }
  }
  const execReg = deps.execFileSync || execFileSync;
  for (const root of uninstallSearchRoots()) {
    for (const name of productNames(target.productName)) {
      try {
        const output = execReg('reg', [
          'query',
          root,
          '/s',
          '/f',
          name,
        ], { windowsHide: true });
        const out = String(output);
        const blocks = out.split(/\r?\n\r?\n/);
        for (const block of blocks) {
          if (!/DisplayName/i.test(block)) {
            continue;
          }
          const keyMatch = block.match(/^HKEY_[^\r\n]+/m);
          const candidateKey = keyMatch ? keyMatch[0] : root;
          const parsed = parseRegBlock(Buffer.isBuffer(output) ? unicodeRegistryBlock(candidateKey) : block, candidateKey);
          if (parsed && (
            parsed.displayName.includes(name)
            || parsed.uninstallCommand.includes(name)
            || parsed.installPath.includes(name)
          )) {
            return parsed;
          }
        }
      } catch {
        // try next product name or registry root
      }
    }
  }
  return null;
}

function discoverWindowsInstall(deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync.bind(fs);
  const packaged = deps.isPackaged !== undefined ? deps.isPackaged : readPackagedFlag();
  const target = resolveTarget(deps);
  const searchedPaths = [];

  if (resolvePlatform(deps) !== 'win32') {
    return {
      registered: packaged,
      installPath: packaged ? path.dirname(process.execPath) : '',
      version: packaged ? currentVersion() : '',
      uninstallCommand: '',
      uninstallMode: 'none',
      searchedPaths,
    };
  }

  // The running-process install dir only belongs to the product being probed
  // when the probe targets self — a slim launcher asking about the desktop
  // must not claim its own directory as the desktop's install.
  if (packaged && !target.explicit) {
    const installDir = path.dirname(process.execPath);
    for (const candidate of uninstallExeCandidates(installDir, target.productName)) {
      searchedPaths.push(candidate);
    }
    const direct = firstExistingPath(uninstallExeCandidates(installDir, target.productName), existsSync);
    if (direct) {
      return {
        registered: true,
        installPath: installDir,
        version: currentVersion(),
        uninstallCommand: direct,
        uninstallMode: 'direct',
        searchedPaths,
      };
    }
  }

  const registered = findRegisteredWindowsInstall(deps);
  if (!registered) {
    const selfDir = packaged && !target.explicit ? path.dirname(process.execPath) : '';
    return {
      registered: false,
      installPath: selfDir,
      version: selfDir ? currentVersion() : '',
      uninstallCommand: '',
      uninstallMode: 'none',
      searchedPaths,
    };
  }

  if (registered.installPath) {
    for (const candidate of uninstallExeCandidates(registered.installPath, target.productName)) {
      searchedPaths.push(candidate);
    }
    const fromInstallDir = firstExistingPath(uninstallExeCandidates(registered.installPath, target.productName), existsSync);
    if (fromInstallDir) {
      return {
        registered: true,
        installPath: registered.installPath,
        version: registered.displayVersion || '',
        uninstallCommand: fromInstallDir,
        uninstallMode: 'direct',
        searchedPaths,
        registryKey: registered.key,
      };
    }
  }

  if (registered.uninstallCommand) {
    const uninstallExe = extractUninstallExe(registered.uninstallCommand);
    if (uninstallExe) {
      searchedPaths.push(uninstallExe);
      if (existsSync(uninstallExe)) {
        return {
          registered: true,
          installPath: registered.installPath,
          version: registered.displayVersion || '',
          uninstallCommand: registered.uninstallCommand,
          uninstallMode: 'direct',
          searchedPaths,
          registryKey: registered.key,
        };
      }
    }
    return {
      registered: true,
      installPath: registered.installPath,
      version: registered.displayVersion || '',
      uninstallCommand: registered.uninstallCommand,
      uninstallMode: 'settings',
      searchedPaths,
      registryKey: registered.key,
    };
  }

  return {
    registered: true,
    installPath: registered.installPath,
    version: registered.displayVersion || '',
    uninstallCommand: '',
    uninstallMode: 'settings',
    searchedPaths,
    registryKey: registered.key,
  };
}

async function openWindowsAppsSettings(deps = {}) {
  const doSpawn = deps.spawn || spawn;
  try {
    await shell.openExternal(SETTINGS_APPS_URL);
    return true;
  } catch {
    try {
      const child = doSpawn('control.exe', ['appwiz.cpl'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return true;
    } catch {
      return false;
    }
  }
}

function getInstalledAppInfo(deps = {}) {
  const packaged = deps.isPackaged !== undefined ? deps.isPackaged : readPackagedFlag();
  const target = resolveTarget(deps);
  let runningVersion = '0.0.0';
  try {
    runningVersion = currentVersion();
  } catch {
    // outside Electron (unit tests)
  }

  const discovery = discoverWindowsInstall(deps);
  const runningFromSource = !packaged;
  const registeredInstall = discovery.registered;
  const uninstallAvailable = discovery.uninstallMode === 'direct'
    || discovery.uninstallMode === 'settings';

  // For an explicit target the queried product's version comes only from the
  // registry record — the running process's own version says nothing about it.
  let version = target.explicit ? '' : runningVersion;
  let installPath = '';
  if (registeredInstall) {
    installPath = discovery.installPath || '';
    version = discovery.version
      || installedExeVersion(installPath, target, deps)
      || (target.explicit ? '' : runningVersion);
  } else if (packaged && !target.explicit) {
    try {
      installPath = path.dirname(process.execPath);
    } catch {
      installPath = '';
    }
  }

  const uninstallUsesSettings = discovery.uninstallMode === 'settings';
  const searchedLabel = discovery.searchedPaths.length
    ? discovery.searchedPaths.join('、')
    : '安装目录与注册表';

  let uninstallNote = '';
  if (runningFromSource && !registeredInstall) {
    uninstallNote = `当前为源码运行，无本机安装包可卸载。请用「设置 → 应用」卸载已安装的 ${target.productName}。`;
  } else if (runningFromSource && registeredInstall) {
    uninstallNote = discovery.uninstallMode === 'direct'
      ? '当前为源码运行；卸载将移除本机已安装的 Setup 版本。'
      : '已检测到本机安装记录，但未找到卸载程序。可打开「设置 → 应用」手动卸载。';
  } else if (uninstallUsesSettings) {
    uninstallNote = `未找到卸载程序（已查找：${searchedLabel}）。可打开「设置 → 应用」手动卸载。`;
  } else if (packaged && discovery.uninstallMode === 'none') {
    uninstallNote = `未找到卸载程序（已查找：${searchedLabel}）。可打开「设置 → 应用」手动卸载。`;
  }

  return {
    version,
    installPath,
    packaged,
    runningFromSource,
    registeredInstall,
    uninstallAvailable,
    uninstallUsesSettings,
    uninstallNote,
    searchedPaths: discovery.searchedPaths,
  };
}

async function launchUninstaller(deps = {}) {
  const packaged = deps.isPackaged !== undefined ? deps.isPackaged : readPackagedFlag();
  const existsSync = deps.existsSync || fs.existsSync.bind(fs);
  const doSpawn = deps.spawn || spawn;
  const target = resolveTarget(deps);
  const discovery = discoverWindowsInstall(deps);
  const searchedLabel = discovery.searchedPaths.length
    ? discovery.searchedPaths.join('、')
    : '安装目录与注册表';

  if (discovery.uninstallMode === 'direct' && discovery.uninstallCommand) {
    // Never spawn the registry UninstallString through a shell: the value is
    // attacker-influenceable text. Use the plain exe path when the command is
    // one, otherwise extract the quoted/leading exe and verify it exists.
    const uninstallExe = existsSync(discovery.uninstallCommand)
      ? discovery.uninstallCommand
      : extractUninstallExe(discovery.uninstallCommand);
    if (uninstallExe && existsSync(uninstallExe)) {
      const child = doSpawn(uninstallExe, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return { ok: true, mode: 'direct' };
    }
    const opened = await openWindowsAppsSettings(deps);
    if (opened) {
      return {
        ok: true,
        openedSettings: true,
        mode: 'settings',
        message: `已打开「设置 → 应用」，请在列表中卸载 ${target.productName}。`,
      };
    }
    return {
      ok: false,
      error: 'uninstaller-not-found',
      searchedPaths: discovery.searchedPaths,
      message: `未找到卸载程序（已查找：${searchedLabel}）。请在「设置 → 应用」中卸载 ${target.productName}。`,
    };
  }

  if (discovery.registered && discovery.uninstallMode === 'settings') {
    const opened = await openWindowsAppsSettings(deps);
    if (opened) {
      return {
        ok: true,
        openedSettings: true,
        mode: 'settings',
        message: `已打开「设置 → 应用」，请在列表中卸载 ${target.productName}。`,
      };
    }
    return {
      ok: false,
      error: 'uninstaller-not-found',
      searchedPaths: discovery.searchedPaths,
      message: `未找到卸载程序（已查找：${searchedLabel}）。请在「设置 → 应用」中卸载 ${target.productName}。`,
    };
  }

  if (target.explicit && !discovery.registered) {
    return {
      ok: false,
      error: 'target-not-installed',
      message: `未检测到已安装的 ${target.productName}。`,
    };
  }

  if (!packaged && !discovery.registered) {
    return {
      ok: false,
      error: 'source-run-no-install',
      message: `当前为源码运行，无本机安装包可卸载。请用「设置 → 应用」卸载已安装的 ${target.productName}。`,
    };
  }

  return {
    ok: false,
    error: 'uninstaller-not-found',
    searchedPaths: discovery.searchedPaths,
    message: `未找到卸载程序（已查找：${searchedLabel}）。请在「设置 → 应用」中卸载 ${target.productName}。`,
  };
}

// Whether a process with the product's exe image name is alive — the slim
// launcher's "desktop running" signal before a real control channel exists.
function probeDesktopProcess(deps = {}) {
  if (resolvePlatform(deps) !== 'win32') {
    return false;
  }
  const target = resolveTarget(deps);
  const execTasklist = deps.execFileSync || execFileSync;
  for (const name of productNames(target.productName)) {
    try {
      const out = execTasklist('tasklist', [
        '/FI', `IMAGENAME eq ${name}.exe`,
        '/FO', 'CSV',
        '/NH',
      ], { encoding: 'utf8', windowsHide: true });
      if (new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.exe"`, 'i').test(String(out))) {
        return true;
      }
    } catch {
      // try the other executable name
    }
  }
  return false;
}

module.exports = {
  APP_ID,
  PRODUCT_NAME,
  DESKTOP_TARGET,
  currentVersion,
  readPackagedFlag,
  resolveTarget,
  discoverWindowsInstall,
  getInstalledAppInfo,
  launchUninstaller,
  findRegisteredWindowsInstall,
  probeDesktopProcess,
  desktopExeCandidates,
  productNames,
  parseRegBlock,
  uninstallExeCandidates,
};
