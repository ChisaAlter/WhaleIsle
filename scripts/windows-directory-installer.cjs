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
    await writeFile(directories, directoryRemovalScript(await readFile(join(__dirname,
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
      await writeFile(target, official.directoryInstallerExits(await readFile(join(templates, 'include', helper), 'utf8')));
      adapted = replaceInclude(adapted, helper, target);
    }
    // Preserve uninstall UI/data policy; recursive removal never follows runtime junctions.
    const uninstaller = join(directory, 'uninstaller.nsh');
    await writeFile(uninstaller, directoryRemovalScript(await readFile(join(templates, 'uninstaller.nsh'), 'utf8'), 'un.'));
    adapted = replaceInclude(adapted, 'uninstaller.nsh', uninstaller);
    return `!define DSH_SEVENZIP_PATH "${tool}"\n!define DSH_SEVENZIP_LICENSE_DIR "${dirname(dirname(sourceTool))}"\n${await original.call(this, adapted, ...args)}`;
  };
}

module.exports = { directoryRemovalScript, installWindowsDirectoryInstaller };
