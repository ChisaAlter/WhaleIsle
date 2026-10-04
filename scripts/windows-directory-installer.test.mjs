import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { directoryRemovalScript } from './windows-directory-installer.cjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const nsisQuote = value => value.replaceAll('$', () => '$$').replaceAll('"', '$\\"')

test('directory removal adapter preserves the requested tree and uninstaller prefix', () => {
  assert.equal(directoryRemovalScript('  RMDir /r "\\\\?\\$dshOldDirectory"\r\n'),
    '  !insertmacro dshRemoveDirectory "" "$dshOldDirectory"\r\n')
  assert.equal(directoryRemovalScript('RMDir /r "$APPDATA\\${APP_FILENAME}"\n', 'un.'),
    '!insertmacro dshRemoveDirectory "un." "$APPDATA\\${APP_FILENAME}"\n')
})

test('native NSIS cleanup removes staged/retired cyclic junctions without touching final runtime',
  { skip: process.platform !== 'win32' }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'whale-nsis-cleanup-'))
    try {
      const final = join(directory, 'final')
      const stage = join(directory, 'stage')
      const old = join(directory, 'old')
      const uninstall = join(directory, 'uninstall')
      for (const tree of [final, stage, old, uninstall]) mkdirSync(tree)
      writeFileSync(join(final, 'sentinel.txt'), 'preserve installed runtime')
      for (const tree of [stage, old, uninstall]) {
        mkdirSync(join(tree, 'a'))
        mkdirSync(join(tree, 'b'))
        writeFileSync(join(tree, 'a', 'payload.txt'), 'old payload')
        symlinkSync(join(tree, 'b'), join(tree, 'a', 'b'), 'junction')
        symlinkSync(join(tree, 'a'), join(tree, 'b', 'a'), 'junction')
        symlinkSync(final, join(tree, 'final'), 'junction')
        symlinkSync(join(directory, 'missing'), join(tree, 'dangling'), 'junction')
      }
      const deep = join(stage, ...Array(6).fill('long-'.repeat(9)))
      mkdirSync(deep, { recursive: true })
      writeFileSync(join(deep, 'payload.txt'), 'long path')
      const output = join(directory, 'cleanup.exe')
      const uninstaller = join(directory, 'remove.exe')
      const source = join(directory, 'cleanup.nsi')
      const directories = join(directory, 'installer-directories.nsh')
      writeFileSync(directories, directoryRemovalScript(readFileSync(join(root,
        'vendor/deepseek-harness/apps/desktop/scripts/installer-directories.nsh'), 'utf8')))
      writeFileSync(source, `Unicode true
Name "Whale Isle runtime cleanup fixture"
OutFile "${nsisQuote(output)}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!include "${nsisQuote(join(root, 'build/remove-directory.nsh'))}"
!insertmacro dshDefineRemoveDirectory ""
!insertmacro dshDefineRemoveDirectory "un."
!include "${nsisQuote(directories)}"
Section
  StrCpy $dshFinalDirectory "${nsisQuote(final)}"
  StrCpy $dshNewDirectory "${nsisQuote(stage)}"
  StrCpy $dshOldDirectory "${nsisQuote(old)}"
  Call dshRollbackDirectories
  IfErrors 0 +3
    SetErrorLevel 2
    Quit
  StrCpy $dshOldMoved "1"
  !insertmacro dshFinishDirectories
  IfErrors 0 +3
    SetErrorLevel 3
    Quit
  StrCpy $dshFinalDirectory ""
  WriteUninstaller "${nsisQuote(uninstaller)}"
SectionEnd
Section "Uninstall"
  !insertmacro dshRemoveDirectory "un." "${nsisQuote(uninstall)}"
  IfErrors 0 +3
    SetErrorLevel 4
    Quit
SectionEnd
`)
      const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js')
      const compiler = await getMakeNsisPath()
      execFileSync(compiler.path, ['/V2', source], { windowsHide: true, env: { ...process.env, ...compiler.env } })
      execFileSync(output, ['/S'], { windowsHide: true, timeout: 30_000 })
      execFileSync(uninstaller, ['/S', `_?=${directory}`], { windowsHide: true, timeout: 30_000 })
      assert.equal(readFileSync(join(final, 'sentinel.txt'), 'utf8'), 'preserve installed runtime')
      for (const tree of [stage, old, uninstall]) assert.equal(existsSync(tree), false, tree)
    } finally {
      assert.ok(directory.startsWith(join(tmpdir(), 'whale-nsis-cleanup-')))
      rmSync(directory, { recursive: true, force: true })
    }
  })
