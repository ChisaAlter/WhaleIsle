'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withOwnedTempDir } = require('../src/shared/fs-safe');

const filename = 'whale-window-acrylic.dll';
const source = path.join(__dirname, '..', 'src', 'native', 'window-acrylic.cpp');

/** @param {string} destination */
async function buildWindowAcrylic(destination) {
  if (process.platform !== 'win32') throw new Error('The Windows acrylic bridge requires a Windows build host');
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const vcvars = execFileSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-find', 'VC\\Auxiliary\\Build\\vcvars64.bat'],
  { encoding: 'utf8', windowsHide: true }).trim();
  if (!vcvars || !fs.existsSync(vcvars)) throw new Error('Install Visual Studio C++ x64 Build Tools and the Windows SDK to build window acrylic');
  await withOwnedTempDir('whale-window-acrylic-', (root) => {
    fs.copyFileSync(source, path.join(root, 'window-acrylic.cpp'));
    fs.writeFileSync(path.join(root, 'build.cmd'), '@echo off\r\n'
      + 'call "%WHALE_VCVARS%" >nul\r\nif errorlevel 1 exit /b %errorlevel%\r\n'
      + `cl /nologo /std:c++20 /EHsc /O2 /MT /LD window-acrylic.cpp /link /OUT:${filename} windowsapp.lib coremessaging.lib dwmapi.lib user32.lib\r\n`);
    execFileSync('cmd.exe', ['/d', '/c', 'build.cmd'], {
      cwd: root, env: { ...process.env, WHALE_VCVARS: vcvars }, stdio: 'inherit', windowsHide: true,
    });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, filename), destination);
  });
}

if (require.main === module) {
  void buildWindowAcrylic(path.resolve(__dirname, '..', 'build', filename)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildWindowAcrylic, filename };
