'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const detect = require('./install-detect');
const { execFileSync } = require('node:child_process');

test('native Windows registration preserves Chinese and emoji paths with redirected output', { skip: process.platform !== 'win32' }, () => {
  const appId = `codex-whale-install-encoding-${process.pid}`;
  const key = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}`;
  const installPath = 'C:\\软件 🐳 é\\Encoding QA';
  const fields = {
    DisplayName: 'Encoding QA',
    DisplayVersion: '1.2.3',
    InstallLocation: installPath,
    UninstallString: `"${installPath}\\Uninstall Encoding QA.exe" /currentuser`,
  };
  try {
    for (const [name, value] of Object.entries(fields)) {
      execFileSync('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, stdio: 'pipe' });
    }
    const result = detect.findRegisteredWindowsInstall({ target: { appId, productName: 'Encoding QA' } });
    assert.equal(result.installPath, installPath);
    assert.equal(result.uninstallCommand, fields.UninstallString);
    assert.equal(result.displayVersion, '1.2.3');
  } finally {
    assert.equal(key, `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\codex-whale-install-encoding-${process.pid}`);
    execFileSync('reg', ['delete', key, '/f'], { windowsHide: true, stdio: 'pipe' });
  }
});

test('current desktop target still accepts the previous installed executables', () => {
  const candidates = detect.desktopExeCandidates('C:\\Apps\\WhaleIsle');
  assert.deepEqual(candidates, [
    path.join('C:\\Apps\\WhaleIsle', 'WhaleIsle.exe'),
    path.join('C:\\Apps\\WhaleIsle', 'app', 'WhaleIsle.exe'),
    path.join('C:\\Apps\\WhaleIsle', 'Whale Isle.exe'),
    path.join('C:\\Apps\\WhaleIsle', 'app', 'Whale Isle.exe'),
    path.join('C:\\Apps\\WhaleIsle', 'Deepseek-Harness-Desktop.exe'),
    path.join('C:\\Apps\\WhaleIsle', 'app', 'Deepseek-Harness-Desktop.exe'),
  ]);
});

test('legacy install registration remains discoverable after the rename', () => {
  const previous = 'Deepseek-Harness-Desktop';
  const result = detect.findRegisteredWindowsInstall({
    platform: 'win32',
    execFileSync: (_command, args) => {
      if (args.includes(previous)) {
        return 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\old\n    DisplayName    REG_SZ    Deepseek-Harness-Desktop\n    InstallLocation    REG_SZ    C:\\Apps\\Deepseek-Harness-Desktop\n    DisplayVersion    REG_SZ    0.3.3\n\n';
      }
      throw new Error('not found');
    },
  });
  assert.equal(result?.displayName, previous);
  assert.equal(result?.displayVersion, '0.3.3');
});

test('running legacy desktop executable is still detected by the launcher', () => {
  const legacy = detect.probeDesktopProcess({
    platform: 'win32',
    execFileSync: (_command, args) => args.some((arg) => arg.includes('Deepseek-Harness-Desktop.exe'))
      ? '"Deepseek-Harness-Desktop.exe","100","Console","1","50 K"'
      : 'INFO: No tasks',
  });
  assert.equal(legacy, true);
});

test('empty DisplayVersion falls back to the runtime exe product version', () => {
  const info = detect.getInstalledAppInfo({
    platform: 'win32',
    isPackaged: true,
    target: { appId: 'ai.deepseek.harness.gui', productName: 'WhaleIsle' },
    existsSync: () => true,
    statSync: () => ({ mtimeMs: 1 }),
    execFileSync: (command, args) => {
      if (command === 'reg') {
        return 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\old\n    DisplayName    REG_SZ    Deepseek-Harness-Desktop\n    InstallLocation    REG_SZ    C:\\Apps\\Deepseek-Harness-Desktop\n    UninstallString    REG_SZ    C:\\Apps\\Deepseek-Harness-Desktop\\Uninstall Deepseek-Harness-Desktop.exe\n\n';
      }
      if (command === 'powershell') {
        return '0.3.2.0\r\n';
      }
      throw new Error(`unexpected ${command} ${args}`);
    },
  });
  assert.equal(info.registeredInstall, true);
  assert.equal(info.version, '0.3.2');
});

test('NSIS UUIDv5 uninstall keys match builder-util-runtime and prevent WhaleIsle Launcher self-collision', () => {
  const { UUID } = require('builder-util-runtime');
  const ns = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3');
  const guiUuid = UUID.v5('ai.deepseek.harness.gui', ns);
  const launcherUuid = UUID.v5('ai.deepseek.harness.launcher', ns);
  assert.equal(detect.nsisUninstallRegistryId('ai.deepseek.harness.gui'), guiUuid);
  assert.equal(detect.nsisUninstallRegistryId('ai.deepseek.harness.launcher'), launcherUuid);

  const launcherBlock = [
    `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${launcherUuid}`,
    '    DisplayName    REG_SZ    WhaleIsle Launcher 0.3.17',
    '    DisplayVersion    REG_SZ    0.3.17',
    '    InstallLocation    REG_SZ    C:\\Apps\\WhaleIsle Launcher',
    '    UninstallString    REG_SZ    "C:\\Apps\\WhaleIsle Launcher\\Uninstall WhaleIsle Launcher.exe" /currentuser',
  ].join('\r\n');
  const legacyDesktopBlock = [
    `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guiUuid}`,
    '    DisplayName    REG_SZ    Whale Isle 0.3.16',
    '    DisplayVersion    REG_SZ    0.3.16',
    '    InstallLocation    REG_SZ    C:\\Apps\\Whale Isle',
    '    UninstallString    REG_SZ    "C:\\Apps\\Whale Isle\\Uninstall Whale Isle.exe" /currentuser',
  ].join('\r\n');
  const newDesktopBlock = [
    `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guiUuid}`,
    '    DisplayName    REG_SZ    WhaleIsle 0.3.17',
    '    DisplayVersion    REG_SZ    0.3.17',
    '    InstallLocation    REG_SZ    C:\\Apps\\WhaleIsle',
    '    UninstallString    REG_SZ    "C:\\Apps\\WhaleIsle\\Uninstall WhaleIsle.exe" /currentuser',
  ].join('\r\n');

  const makeScanOnlyRegExec = (blocks) => (_cmd, args) => {
    if (!args.includes('/s')) throw new Error('force fallback scan');
    const needle = args[args.indexOf('/f') + 1];
    const matched = blocks.filter((b) => b.toLowerCase().includes(needle.toLowerCase()));
    if (!matched.length) throw new Error('not found');
    return matched.join('\r\n\r\n');
  };

  const legacyCoexist = detect.getInstalledAppInfo({
    platform: 'win32',
    isPackaged: true,
    target: detect.DESKTOP_TARGET,
    existsSync: (p) => p.startsWith('C:\\Apps\\Whale Isle\\'),
    execFileSync: makeScanOnlyRegExec([launcherBlock, legacyDesktopBlock]),
  });
  assert.equal(legacyCoexist.installPath, 'C:\\Apps\\Whale Isle');
  assert.equal(legacyCoexist.version, '0.3.16');

  const newCoexist = detect.getInstalledAppInfo({
    platform: 'win32',
    isPackaged: true,
    target: detect.DESKTOP_TARGET,
    existsSync: (p) => p.startsWith('C:\\Apps\\WhaleIsle\\'),
    execFileSync: makeScanOnlyRegExec([launcherBlock, newDesktopBlock]),
  });
  assert.equal(newCoexist.installPath, 'C:\\Apps\\WhaleIsle');
  assert.equal(newCoexist.version, '0.3.17');

  const launcherOnly = detect.getInstalledAppInfo({
    platform: 'win32',
    isPackaged: true,
    target: detect.DESKTOP_TARGET,
    existsSync: () => true,
    execFileSync: makeScanOnlyRegExec([launcherBlock]),
  });
  assert.equal(launcherOnly.registeredInstall, false);
  assert.equal(launcherOnly.installPath, '');
});
