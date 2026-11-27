'use strict';

const { copyFile, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { basename, dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { LEGACY_PRODUCT_NAMES, LEGACY_LAUNCHER_NAMES } = require('../src/shared/product-identity');

/** Keep NSIS from traversing dependency junctions while retiring/rolling back a tree. */
function directoryRemovalScript(source, prefix = '') {
  return source.replace(/^([ \t]*)RMDir \/r (.+)$/gm, (_line, indent, argument) => {
    const directory = argument.trim().replace(/^"|"$/g, '').replace(/^\\\\\?\\/, '');
    return `${indent}!insertmacro dshRemoveDirectory "${prefix}" "${directory}"`;
  });
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`NSIS template changed: ${before}`);
  return source.replace(before, after);
}

/** Let a silent relocation failure reach the upstream exit and directory rollback. */
function silentUninstallFailureScript(source) {
  return replaceOnce(source,
    'MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"',
    'MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK');
}

const LEGACY_APP_FILENAMES = Object.freeze([
  ...LEGACY_PRODUCT_NAMES,
  ...LEGACY_LAUNCHER_NAMES,
]);

/**
 * Preserve existing legacy install roots on interactive upgrades instead of nesting a child folder.
 * @param {string} source
 */
function assistedInstallerScript(source) {
  const legacyChecks = LEGACY_APP_FILENAMES.flatMap((name) => [
    '      ${If} $0 == ""',
    `        \${StrContains} $0 "${name}" $INSTDIR`,
    '      ${EndIf}',
  ]).join('\n');
  return replaceOnce(
    source.replaceAll('\r\n', '\n'),
    [
      '    Function instFilesPre',
      '      ${StrContains} $0 "${APP_FILENAME}" $INSTDIR',
      '      ${If} $0 == ""',
      '        StrCpy $INSTDIR "$INSTDIR\\${APP_FILENAME}"',
      '      ${endIf}',
      '    FunctionEnd',
    ].join('\n'),
    [
      '    Function instFilesPre',
      '      ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation',
      '      ${If} $0 != ""',
      '      ${AndIf} $INSTDIR == $0',
      '        Return',
      '      ${EndIf}',
      '      ${StrContains} $0 "${APP_FILENAME}" $INSTDIR',
      legacyChecks,
      '      ${If} $0 == ""',
      '        StrCpy $INSTDIR "$INSTDIR\\${APP_FILENAME}"',
      '      ${endIf}',
      '    FunctionEnd',
    ].join('\n'),
  );
}

/**
 * Detect and stop legacy executable names in $INSTDIR or previous InstallLocation when PowerShell is unavailable.
 * @param {string} source
 */
function legacyProcessCheckScript(source) {
  const normalized = source.replaceAll('\r\n', '\n');
  const legacyInstBranches = LEGACY_APP_FILENAMES.flatMap((name, index) => [
    index === 0 ? `      \${If} \${FileExists} "$INSTDIR\\${name}.exe"` : `      \${ElseIf} \${FileExists} "$INSTDIR\\${name}.exe"`,
    `        StrCpy $dshRunningExeName "${name}.exe"`,
  ]).concat(['      ${EndIf}']).join('\n');
  const legacyRegBranches = LEGACY_APP_FILENAMES.flatMap((name, index) => [
    index === 0 ? `        \${If} \${FileExists} "$0\\${name}.exe"` : `        \${ElseIf} \${FileExists} "$0\\${name}.exe"`,
    `          StrCpy $dshRunningExeName "${name}.exe"`,
  ]).concat(['        ${EndIf}']).join('\n');
  let adapted = replaceOnce(
    normalized,
    '!macro _CHECK_APP_RUNNING\n  ${GetProcessInfo} 0 $pid $1 $2 $3 $4\n  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"',
    [
      'Var /GLOBAL dshRunningExeName',
      '!macro _CHECK_APP_RUNNING',
      '  StrCpy $dshRunningExeName "${APP_EXECUTABLE_FILENAME}"',
      '  ${IfNot} ${FileExists} "$INSTDIR\\$dshRunningExeName"',
      legacyInstBranches,
      '    ${If} $dshRunningExeName == "${APP_EXECUTABLE_FILENAME}"',
      '      ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation',
      '      ${If} $0 != ""',
      legacyRegBranches,
      '      ${EndIf}',
      '    ${EndIf}',
      '  ${EndIf}',
      '  ${GetProcessInfo} 0 $pid $1 $2 $3 $4',
      '  ${if} $3 != "$dshRunningExeName"',
    ].join('\n'),
  );
  adapted = adapted.replaceAll('!insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}"', '!insertmacro FIND_PROCESS "$dshRunningExeName"');
  adapted = adapted.replaceAll('!insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}"', '!insertmacro KILL_PROCESS "$dshRunningExeName"');
  return adapted;
}

/**
 * Preserve shortcut state and rewrite shortcut targets across product executable renames.
 * @param {string} source
 */
function desktopInstallSection(source) {
  const normalized = source.replaceAll('\r\n', '\n');
  const legacyShortcutFallback = LEGACY_APP_FILENAMES.flatMap((name, index) => [
    index === 0 ? `    \${If} \${FileExists} "$INSTDIR\\${name}.exe"` : `    \${ElseIf} \${FileExists} "$INSTDIR\\${name}.exe"`,
    `      StrCpy $oldShortcutName "${name}"`,
  ]).concat(['    ${EndIf}']).join('\n');
  let adapted = replaceOnce(
    normalized,
    '!insertmacro setLinkVars\n!insertmacro dshStageApplication',
    [
      '!insertmacro setLinkVars',
      'ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName',
      '${If} $R1 == ""',
      '${AndIfNot} ${FileExists} "$appExe"',
      legacyShortcutFallback,
      '  StrCpy $oldDesktopLink "$DESKTOP\\$oldShortcutName.lnk"',
      '  ${If} $oldMenuDirectory == ""',
      '    StrCpy $oldStartMenuLink "$SMPROGRAMS\\$oldShortcutName.lnk"',
      '  ${Else}',
      '    StrCpy $oldStartMenuLink "$SMPROGRAMS\\$oldMenuDirectory\\$oldShortcutName.lnk"',
      '  ${EndIf}',
      '${EndIf}',
      '!insertmacro dshStageApplication',
    ].join('\n'),
  );
  const legacyExistsOr = LEGACY_APP_FILENAMES
    .map((name) => `    \${orIf} \${FileExists} "$INSTDIR\\${name}.exe"`)
    .join('\n');
  adapted = replaceOnce(
    adapted,
    [
      '  ${if} $R1 == "true"',
      '  ${andIf} ${FileExists} "$appExe"',
      '    StrCpy $keepShortcuts "true"',
      '  ${endIf}',
    ].join('\n'),
    [
      '  ${if} $R1 == "true"',
      '    ${if} ${FileExists} "$appExe"',
      legacyExistsOr,
      '      StrCpy $keepShortcuts "true"',
      '    ${endIf}',
      '  ${endIf}',
    ].join('\n'),
  );
  return replaceOnce(
    adapted,
    '!insertmacro addStartMenuLink $keepShortcuts\n!insertmacro addDesktopLink $keepShortcuts',
    [
      '!insertmacro addStartMenuLink $keepShortcuts',
      '!insertmacro addDesktopLink $keepShortcuts',
      '${If} $oldStartMenuLink != $newStartMenuLink',
      '  ${If} ${FileExists} "$oldStartMenuLink"',
      '    Delete "$oldStartMenuLink"',
      '    WinShell::UninstShortcut "$oldStartMenuLink"',
      '    !insertmacro cleanupOldMenuDirectory',
      '  ${EndIf}',
      '  ${If} $keepShortcuts == "true"',
      '  ${AndIf} ${FileExists} "$newStartMenuLink"',
      '    Delete "$newStartMenuLink"',
      '    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"',
      '    ClearErrors',
      '    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"',
      '  ${EndIf}',
      '${EndIf}',
      '${If} $oldDesktopLink != $newDesktopLink',
      '  ${If} ${FileExists} "$oldDesktopLink"',
      '    Delete "$oldDesktopLink"',
      '    WinShell::UninstShortcut "$oldDesktopLink"',
      '  ${EndIf}',
      '  ${If} $keepShortcuts == "true"',
      '  ${AndIf} ${FileExists} "$newDesktopLink"',
      '    Delete "$newDesktopLink"',
      '    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"',
      '    ClearErrors',
      '    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"',
      '    System::Call \'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)\'',
      '  ${EndIf}',
      '${EndIf}',
    ].join('\n'),
  );
}

/** Commit the new installation before reporting a failed retirement cleanup. */
function directoryTransactionsScript(source) {
  let adapted = directoryRemovalScript(source.replaceAll('\r\n', '\n'));
  // The upstream failure log needs its installer.nsh; this build reports through build/installer.nsh,
  // and NSIS rejects the variable that would stay unset here.
  adapted = replaceOnce(adapted, 'Var dshDirectoryLogDirectory\n', '');
  adapted = replaceOnce(adapted,
    '  !ifdef DSH_INSTALLER_LOG_DIR\n    ; electron-builder defines the cache name after including our function bodies, before this section expands.\n    StrCpy $dshDirectoryLogDirectory "${DSH_INSTALLER_LOG_DIR}"\n  !endif\n',
    '');
  adapted = replaceOnce(adapted,
    '    !insertmacro dshRemoveDirectory "" "$dshFinalDirectory"\n    StrCpy $dshNewMoved ""',
    '    !insertmacro dshRemoveDirectory "" "$dshFinalDirectory"\n    ${If} ${Errors}\n      !insertmacro dshReportDirectoryRollback "$dshFinalDirectory" "$dshOldDirectory"\n      Return\n    ${EndIf}\n    StrCpy $dshNewMoved ""');
  adapted = replaceOnce(adapted,
    '      ; Leave the complete backup in place if another process prevents restoration.\n      DetailPrint $dshOldDirectory\n      !insertmacro dshRemoveDirectory "" "$dshNewDirectory"\n      Return',
    '      !insertmacro dshRemoveDirectory "" "$dshNewDirectory"\n      !insertmacro dshReportDirectoryRollback "$dshFinalDirectory" "$dshOldDirectory"\n      Return');
  adapted = replaceOnce(adapted, '    StrCpy $dshOldMoved ""\n  ${EndIf}\n  ${If} $dshNewDirectory != ""',
    '    StrCpy $dshOldMoved ""\n    Delete "$dshOldDirectory.rollback.txt"\n  ${EndIf}\n  ${If} $dshNewDirectory != ""');
  return replaceOnce(adapted,
    '    !insertmacro dshRemoveDirectory "" "$dshOldDirectory"\n    StrCpy $dshOldMoved ""',
    '    StrCpy $dshOldMoved ""\n    !insertmacro dshRemoveDirectory "" "$dshOldDirectory"\n    ${If} ${Errors}\n      !insertmacro dshReportDirectoryCleanup "$dshFinalDirectory" "$dshOldDirectory" "$EXEPATH"\n    ${EndIf}');
}

/** Keep upstream move/restore semantics, treating every reparse point as a leaf. */
function transactionalUninstallerScript(source) {
  const normalized = source.replaceAll('\r\n', '\n');
  const atomicStart = normalized.indexOf('Function un.atomicRMDir\n');
  const restoreStart = normalized.indexOf('Function un.restoreFiles\n');
  const end = normalized.indexOf('\n!ifndef UNINSTALL_SECTION_NAME', restoreStart);
  if (atomicStart < 0 || restoreStart < 0 || end < 0) throw new Error('NSIS uninstall transaction template changed');
  const classify = directory => [
    `System::Call 'kernel32::GetFileAttributesW(w "${directory}$R0\\$R2") i.r13'`,
    '    IntOp $R3 $R3 & 0x410',
    '    IntCmp $R3 0x10 isDir isNotDir isNotDir',
  ].join('\n');
  let atomic = normalized.slice(atomicStart, restoreStart)
    .replaceAll('$INSTDIR$R0', '$dshUninstallSource$R0')
    .replaceAll('$PLUGINSDIR\\old-install', '$dshUninstallBackupPath');
  atomic = replaceOnce(atomic, 'IfFileExists "$dshUninstallSource$R0\\$R2\\*.*" isDir isNotDir',
    classify('$dshUninstallSource'));
  atomic = replaceOnce(atomic, '  FindFirst $R1 $R2 $R3\n',
    '  ClearErrors\n  FindFirst $R1 $R2 $R3\n  ${If} ${Errors}\n    StrCpy $R3 "$dshUninstallSource$R0"\n    Goto done\n  ${EndIf}\n');
  atomic = replaceOnce(atomic, '      CreateDirectory "$dshUninstallBackupPath$R0\\$R2"',
    '      ClearErrors\n      CreateDirectory "$dshUninstallBackupPath$R0\\$R2"\n      ${If} ${Errors}\n        StrCpy $R3 "$dshUninstallSource$R0\\$R2"\n        Goto done\n      ${EndIf}');
  atomic = replaceOnce(atomic,
    '      # Ignore errors when renaming ourselves.\n      StrCmp "$R0\\$R2" "${UNINSTALL_FILENAME}" 0 +2\n      ClearErrors\n\n', '');
  let restore = normalized.slice(restoreStart, end)
    .replaceAll('$INSTDIR$R0', '$dshUninstallSource$R0')
    .replaceAll('$PLUGINSDIR\\old-install', '$dshUninstallBackupPath');
  restore = replaceOnce(restore, 'IfFileExists "$dshUninstallSource$R0\\$R2\\*.*" isDir isNotDir',
    classify('$dshUninstallBackupPath'));
  restore = replaceOnce(restore, '  Push $R3\n', '  Push $R3\n  Push $R4\n  StrCpy $R4 0\n');
  restore = replaceOnce(restore, '  FindFirst $R1 $R2 $R3\n',
    '  ClearErrors\n  FindFirst $R1 $R2 $R3\n  ${If} ${Errors}\n    StrCpy $R4 1\n    Goto break\n  ${EndIf}\n');
  restore = replaceOnce(restore, '      CreateDirectory "$dshUninstallSource$R0\\$R2"',
    '      ClearErrors\n      CreateDirectory "$dshUninstallSource$R0\\$R2"\n      ${If} ${Errors}\n        StrCpy $R4 1\n        Goto continue\n      ${EndIf}');
  restore = replaceOnce(restore, '      Pop $R3\n',
    '      Pop $R3\n      ${If} $R3 != 0\n        StrCpy $R4 1\n      ${EndIf}\n');
  restore = replaceOnce(restore, '      Rename "$dshUninstallBackupPath$R0\\$R2" "$dshUninstallSource$R0\\$R2"',
    '      ClearErrors\n      Rename "$dshUninstallBackupPath$R0\\$R2" "$dshUninstallSource$R0\\$R2"\n      ${If} ${Errors}\n        StrCpy $R4 1\n      ${EndIf}');
  restore = replaceOnce(restore, '    StrCpy $R0 0\n', '    StrCpy $R0 $R4\n');
  restore = replaceOnce(restore, '\n    Pop $R3\n    Pop $R2\n', '\n    Pop $R4\n    Pop $R3\n    Pop $R2\n');
  return directoryRemovalScript(normalized.slice(0, atomicStart) + atomic + restore + normalized.slice(end), 'un.');
}

/** @param {string} outDir */
async function cleanupDirectoryInstaller(outDir) {
  if (!outDir) return;
  const directory = join(outDir, '.nsis-directory-installer');
  if (basename(directory) !== '.nsis-directory-installer') return;
  await rm(directory, { recursive: true, force: true });
}

/** Reuse the pinned official adapter with this shell's electron-builder and branded UI. */
async function installWindowsDirectoryInstaller() {
  const official = await import(pathToFileURL(join(__dirname,
    '../vendor/deepseek-harness/apps/desktop/scripts/windows-directory-installer.mjs')).href);
  require('app-builder-lib');
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
  const templates = join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
  const originalHeader = NsisTarget.prototype.computeCommonInstallerScriptHeader;
  NsisTarget.prototype.computeCommonInstallerScriptHeader = async function (...args) {
    // The common header includes the branded installer before computeFinalScript.
    // Declare its eager include path here; the generated file is written before makensis runs.
    const directories = join(this.outDir, '.nsis-directory-installer', 'installer-directories.nsh');
    return `!define DSH_DIRECTORY_INSTALLER_PATH "${directories}"\n${await originalHeader.apply(this, args)}`;
  };
  const original = NsisTarget.prototype.computeFinalScript;
  NsisTarget.prototype.computeFinalScript = async function (source, ...args) {
    const directory = join(this.outDir, '.nsis-directory-installer');
    try {
      await mkdir(directory, { recursive: true });
      const section = join(directory, 'installSection.nsh');
      await writeFile(section, desktopInstallSection(official.directoryInstallSection(await readFile(join(templates, 'installSection.nsh'), 'utf8'))));
      const directories = join(directory, 'installer-directories.nsh');
      await writeFile(directories, directoryTransactionsScript(await readFile(join(__dirname,
        '../vendor/deepseek-harness/apps/desktop/scripts/installer-directories.nsh'), 'utf8')));
      const sourceTool = await getPath7za();
      const tool = join(directory, '7za.exe');
      await copyFile(sourceTool, tool);
      await this.packager.signIf(tool);
      function replaceInclude(text, name, target) {
        const before = `!include "${name}"`;
        if (text.split(before).length !== 2) throw new Error(`NSIS template changed: ${before}`);
        return text.replace(before, `!include "${target}"`);
      }
      let adapted = replaceInclude(source, 'installSection.nsh', section);
      if (adapted.includes('!include "assistedInstaller.nsh"')) {
        const assisted = join(directory, 'assistedInstaller.nsh');
        await writeFile(assisted, assistedInstallerScript(await readFile(join(templates, 'assistedInstaller.nsh'), 'utf8')));
        adapted = replaceInclude(adapted, 'assistedInstaller.nsh', assisted);
      }
      for (const helper of ['allowOnlyOneInstallerInstance.nsh', 'installUtil.nsh']) {
        const target = join(directory, helper);
        const helperSource = official.directoryInstallerExits(await readFile(join(templates, 'include', helper), 'utf8'));
        const adaptedHelper = helper === 'installUtil.nsh'
          ? silentUninstallFailureScript(helperSource)
          : legacyProcessCheckScript(helperSource);
        await writeFile(target, adaptedHelper);
        adapted = replaceInclude(adapted, helper, target);
      }
      // Preserve uninstall UI/data policy; recursive removal never follows runtime junctions.
      const uninstaller = join(directory, 'uninstaller.nsh');
      await writeFile(uninstaller, transactionalUninstallerScript(await readFile(join(templates, 'uninstaller.nsh'), 'utf8')));
      adapted = replaceInclude(adapted, 'uninstaller.nsh', uninstaller);
      return `!define DSH_SEVENZIP_PATH "${tool}"\n!define DSH_SEVENZIP_LICENSE_DIR "${dirname(dirname(sourceTool))}"\n${await original.call(this, adapted, ...args)}`;
    } catch (error) {
      await cleanupDirectoryInstaller(this.outDir).catch(() => {
        // Preserve the original script generation error while reclaiming staging.
      });
      throw error;
    }
  };
  const nsisProto = /** @type {any} */ (NsisTarget.prototype);
  const originalExecuteMakensis = nsisProto.executeMakensis;
  nsisProto.executeMakensis = /** @param {...any} args */ async function (...args) {
    try {
      return await originalExecuteMakensis.apply(this, args);
    } finally {
      await cleanupDirectoryInstaller(this.outDir);
    }
  };
}

module.exports = {
  assistedInstallerScript,
  desktopInstallSection,
  legacyProcessCheckScript,
  directoryRemovalScript,
  directoryTransactionsScript,
  transactionalUninstallerScript,
  silentUninstallFailureScript,
  cleanupDirectoryInstaller,
  installWindowsDirectoryInstaller,
};
