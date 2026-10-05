'use strict';

const { copyFile, mkdir, readFile, writeFile } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');

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

/** Commit the new installation before reporting a failed retirement cleanup. */
function directoryTransactionsScript(source) {
  let adapted = directoryRemovalScript(source.replaceAll('\r\n', '\n'));
  adapted = replaceOnce(adapted,
    '    !insertmacro dshRemoveDirectory "" "$dshFinalDirectory"\n    StrCpy $dshNewMoved ""',
    '    !insertmacro dshRemoveDirectory "" "$dshFinalDirectory"\n    ${If} ${Errors}\n      !insertmacro dshReportDirectoryRollback "$dshFinalDirectory" "$dshOldDirectory"\n      Return\n    ${EndIf}\n    StrCpy $dshNewMoved ""');
  adapted = replaceOnce(adapted,
    '      ; Leave the complete backup in place if another process prevents restoration.\n      DetailPrint $dshOldDirectory\n      Return',
    '      !insertmacro dshReportDirectoryRollback "$dshFinalDirectory" "$dshOldDirectory"\n      Return');
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
    await mkdir(directory, { recursive: true });
    const section = join(directory, 'installSection.nsh');
    await writeFile(section, official.directoryInstallSection(await readFile(join(templates, 'installSection.nsh'), 'utf8')));
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
    for (const helper of ['allowOnlyOneInstallerInstance.nsh', 'installUtil.nsh']) {
      const target = join(directory, helper);
      const helperSource = official.directoryInstallerExits(await readFile(join(templates, 'include', helper), 'utf8'));
      await writeFile(target, helper === 'installUtil.nsh' ? silentUninstallFailureScript(helperSource) : helperSource);
      adapted = replaceInclude(adapted, helper, target);
    }
    // Preserve uninstall UI/data policy; recursive removal never follows runtime junctions.
    const uninstaller = join(directory, 'uninstaller.nsh');
    await writeFile(uninstaller, transactionalUninstallerScript(await readFile(join(templates, 'uninstaller.nsh'), 'utf8')));
    adapted = replaceInclude(adapted, 'uninstaller.nsh', uninstaller);
    return `!define DSH_SEVENZIP_PATH "${tool}"\n!define DSH_SEVENZIP_LICENSE_DIR "${dirname(dirname(sourceTool))}"\n${await original.call(this, adapted, ...args)}`;
  };
}

module.exports = { directoryRemovalScript, directoryTransactionsScript, transactionalUninstallerScript, silentUninstallFailureScript, installWindowsDirectoryInstaller };
