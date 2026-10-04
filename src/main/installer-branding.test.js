'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const nsis = pkg.build.nsis;

function readBmp(relative) {
  const buf = fs.readFileSync(path.join(ROOT, relative));
  return {
    magic: buf.toString('ascii', 0, 2),
    width: buf.readInt32LE(18),
    height: buf.readInt32LE(22),
    bitsPerPixel: buf.readUInt16LE(28),
    compression: buf.readUInt32LE(30),
  };
}

test('nsis keeps the assisted-installer product contract', () => {
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, true);
  assert.equal(nsis.createDesktopShortcut, true);
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.shortcutName, 'Whale Isle');
  assert.equal(nsis.artifactName, 'Whale-Isle-Setup-${version}.${ext}');
  // Per-user default install path (%LOCALAPPDATA%\Programs) — TC-INST-013
  // opens resources\node.exe there; do not flip to perMachine.
  assert.equal(nsis.perMachine, undefined);
  // Uninstall must never delete userData (desktop dsh-home lives there).
  assert.equal(nsis.deleteAppDataOnUninstall, undefined);
});

test('branded installer bitmaps are classic 24-bit BMPs at MUI2 geometry', () => {
  const cases = [
    [nsis.installerSidebar, 'build/installerSidebar.bmp', 164, 314],
    [nsis.uninstallerSidebar, 'build/uninstallerSidebar.bmp', 164, 314],
    [nsis.installerHeader, 'build/installerHeader.bmp', 150, 57],
  ];
  for (const [configured, expectedPath, width, height] of cases) {
    assert.equal(configured, expectedPath);
    const bmp = readBmp(expectedPath);
    assert.equal(bmp.magic, 'BM', `${expectedPath} must be a BMP`);
    assert.equal(bmp.width, width, `${expectedPath} width`);
    assert.equal(bmp.height, height, `${expectedPath} height`);
    assert.equal(bmp.bitsPerPixel, 24, `${expectedPath} must be 24-bit`);
    assert.equal(bmp.compression, 0, `${expectedPath} must be uncompressed (BI_RGB)`);
  }
});

test('installer and uninstaller icons share the application brand icon', () => {
  assert.equal(pkg.build.win.icon, 'assets/icon.ico');
  assert.equal(nsis.installerIcon, 'assets/icon.ico');
  assert.equal(nsis.uninstallerIcon, 'assets/icon.ico');
  const ico = fs.readFileSync(path.join(ROOT, 'assets', 'icon.ico'));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'assets/icon.ico must be an ICO container');
});

test('license page shows the repository MIT license', () => {
  assert.equal(nsis.license, 'LICENSE');
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License/);
});

test('installer languages are Chinese-first with an English fallback', () => {
  // zh_CN first: unmatched OS locales fall back to the first MUI language.
  assert.deepEqual(nsis.installerLanguages, ['zh_CN', 'en_US']);
});

test('installer.nsh preserves branded pages and keeps installation work silent-install (/S) safe', () => {
  assert.equal(nsis.include, 'build/installer.nsh');
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  // Directory transaction/extraction/removal hooks also run during /S. The
  // branded pages and registry hygiene remain; work hooks do not open UI.
  const macros = [...nsh.matchAll(/^!macro\s+(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(macros, [
    'customRemoveFiles', 'customInstall', 'customInstallerExtract',
    'customWelcomePage', 'customUnWelcomePage', 'customHeader',
    '_DSHD_IS_ABS', '_DSHD_CHECK_UNINSTALL', 'customInit',
  ]);
  assert.match(nsh, /!insertmacro MUI_PAGE_WELCOME/);
  // customUnWelcomePage *replaces* the stock un-welcome insertion in
  // electron-builder's assistedInstaller.nsh, so it must (a) re-insert the
  // page — or the uninstaller loses its welcome page entirely — and (b)
  // re-define the 3-line title, because MUI2 unsets MUI_WELCOMEPAGE_* after
  // every page and the installer-side define never reaches the uninstaller
  // (that was the clipped "…Uninstall" third line).
  // \r?\n: Windows CI checks out with autocrlf (no .gitattributes), so the
  // file arrives CRLF there while local/macOS/Linux trees keep LF.
  const unWelcome = nsh.match(/^!macro customUnWelcomePage\r?\n([\s\S]*?)^!macroend/m);
  assert.ok(unWelcome, 'customUnWelcomePage macro body');
  assert.match(unWelcome[1], /!define MUI_WELCOMEPAGE_TITLE_3LINES/);
  assert.match(unWelcome[1], /!insertmacro MUI_UNPAGE_WELCOME/);
  assert.match(nsh, /BrandingText "Whale Isle \$\{VERSION\}"/);
  const code = nsh
    .split('\n')
    .filter((line) => !line.trim().startsWith('#') && !line.trim().startsWith(';'))
    .join('\n');
  assert.doesNotMatch(code, /MessageBox/i);
  assert.doesNotMatch(code, /RequestExecutionLevel/i);
  assert.doesNotMatch(code, /^\s*Section\b/im);
  assert.doesNotMatch(code, /ExecWait|ExecShell\b/);
  const extract = nsh.match(/^!macro customInstallerExtract[^\r\n]*\r?\n([\s\S]*?)^!macroend/m);
  assert.match(extract[1], /Pop \$R0/);
  assert.match(extract[1], /\$\{If\} \$R0 == 0/);
  assert.match(extract[1], /install-harness\.cjs/);
});

test('customInit purges dead install records and repairs a poisoned $INSTDIR', () => {
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  const init = nsh.match(/^!macro customInit\r?\n([\s\S]*?)^!macroend/m);
  assert.ok(init, 'customInit macro body');
  const body = init[1];
  // InstallLocation survives only while it is a live record: absolute AND the
  // app executable is still there. Dead entries (drive-relative "C:foo" from
  // a bash-mangled /D=, or a wiped target dir) are deleted, never trusted.
  assert.match(body, /ReadRegStr \$0 SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/);
  assert.match(body, /\$\{FileExists\} "\$0\\\$\{APP_EXECUTABLE_FILENAME\}"/);
  assert.match(body, /\$\{FileExists\} "\$0\\Deepseek-Harness-Desktop\.exe"/);
  assert.match(body, /\$\{FileExists\} "\$0\\Deepseek-Harness-Launcher\.exe"/);
  assert.match(body, /DeleteRegValue SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/);
  // The UninstallString fallback applies the same liveness rule to the quoted
  // uninstaller path; dead records lose the whole key. A surviving uninstaller
  // may still supply the upgrade dir via GetFileParent.
  const un = nsh.match(/^!macro _DSHD_CHECK_UNINSTALL[\s\S]*?^!macroend/m);
  assert.ok(un, '_DSHD_CHECK_UNINSTALL helper');
  assert.match(un[0], /Call GetInQuotes/);
  assert.match(un[0], /\$\{FileExists\} "\$2"/);
  assert.match(un[0], /DeleteRegKey SHELL_CONTEXT "\$\{key\}"/);
  // $INSTDIR resolution order: /D > live InstallLocation > live uninstaller
  // dir > per-user default; the trailing guard also rejects a mangled /D.
  assert.match(body, /GetDParameter/);
  assert.match(body, /Call GetFileParent/);
  assert.match(body, /StrCpy \$INSTDIR "\$LocalAppData\\Programs\\\$\{APP_FILENAME\}"/);
  // The helper treats X:\, "X:\", \\ and "\\" as absolute.
  const abs = nsh.match(/^!macro _DSHD_IS_ABS[\s\S]*?^!macroend/m);
  assert.ok(abs, '_DSHD_IS_ABS helper');
  assert.match(abs[0], /== ":\\"/);
  assert.match(abs[0], /== "\\\\"/);
});

test('bitmap renderer pins the MUI2 geometry and stays regenerable', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'render-installer-assets.js'), 'utf8');
  assert.match(source, /SIDEBAR_WIDTH = 164/);
  assert.match(source, /SIDEBAR_HEIGHT = 314/);
  assert.match(source, /HEADER_WIDTH = 150/);
  assert.match(source, /HEADER_HEIGHT = 57/);
  // Bitmap literals mirror the official light table in dsh-webui-tokens.css
  // (launcher-aligned): sidebar fill, label primary, brand-blue accent.
  assert.match(source, /rgb\(249, 250, 251\)/); // --dsw-specific-sidebar-fill
  assert.match(source, /rgb\(15, 17, 21\)/); // --dsw-alias-label-primary
  assert.match(source, /rgb\(65, 118, 230\)/); // --dsw-static-deepseek-500
  // Sidebar carries the product name, not a parallel marketing wordmark.
  assert.match(source, /Whale Isle/);
  // The near-black icon-tile marketing panel (a second skin) must not return,
  // and boot instrument-canvas tokens never reach the installer.
  assert.doesNotMatch(source, /#0b0d12/i);
  assert.doesNotMatch(source, /--boot-/);
  assert.equal(pkg.scripts['installer:assets'], 'node scripts/run-render-installer-assets.js');
});
