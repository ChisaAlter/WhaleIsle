import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { directoryRemovalScript, directoryTransactionsScript, transactionalUninstallerScript } from './windows-directory-installer.cjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const nsisQuote = value => value.replaceAll('$', () => '$$').replaceAll('"', '$\\"')
const directoryTemplate = join(root, 'vendor/deepseek-harness/apps/desktop/scripts/installer-directories.nsh')
const installer = join(root, 'build/installer.nsh')
const templates = join(root, 'node_modules/app-builder-lib/templates/nsis')

async function compiler() {
  require('app-builder-lib')
  const { getMakeNsisPath, getNsisPluginsPath } = require('app-builder-lib/out/toolsets/windows.js')
  const tool = await getMakeNsisPath()
  const plugins = await getNsisPluginsPath()
  const { NsisScriptGenerator } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator.js')
  const flags = new NsisScriptGenerator()
  flags.flags(['updated'])
  return {
    header: `!addplugindir /x86-unicode "${nsisQuote(join(plugins, 'x86-unicode'))}"\n!include "${nsisQuote(join(templates, 'include/StdUtils.nsh'))}"\n${flags.build()}`,
    compile(source) {
      execFileSync(tool.path, ['/V2', source], { windowsHide: true, env: { ...process.env, ...tool.env } })
    },
  }
}

function holdFile(file) {
  const koffi = require('koffi')
  const kernel = koffi.load('kernel32.dll')
  const create = kernel.func('void * __stdcall CreateFileW(str16, uint32_t, uint32_t, void *, uint32_t, uint32_t, void *)')
  const close = kernel.func('int __stdcall CloseHandle(void *)')
  // FILE_SHARE_READ | FILE_SHARE_WRITE, deliberately excluding FILE_SHARE_DELETE.
  const handle = create(file, 0x80000000, 3, null, 3, 0x80, null)
  assert.ok(handle && handle !== -1n, 'held file handle')
  return () => close(handle)
}

function run(file, args) {
  const result = spawnSync(file, args, { windowsHide: true, timeout: 30_000 })
  assert.ifError(result.error)
  return result.status
}

function cleanupBranch() {
  const source = readFileSync(installer, 'utf8')
  return source.slice(source.indexOf('  # Explicit cleanup mode'), source.indexOf('  StrCpy $R1 "0"'))
}

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
      writeFileSync(directories, directoryTransactionsScript(readFileSync(directoryTemplate, 'utf8')))
      writeFileSync(source, `Unicode true
Name "Whale Isle runtime cleanup fixture"
OutFile "${nsisQuote(output)}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!define DSH_DIRECTORY_INSTALLER_PATH "${nsisQuote(directories)}"
!include "${nsisQuote(installer)}"
!insertmacro dshDefineRemoveDirectory "un."
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

test('updated uninstall restores locked old files and opaque junctions before failing',
  { skip: process.platform !== 'win32' }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'whale-nsis-updated-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const old = join(directory, 'application')
    const external = join(directory, 'user-data')
    mkdirSync(old)
    mkdirSync(external)
    writeFileSync(join(external, 'sentinel.txt'), 'user data survives')
    writeFileSync(join(old, 'a-unlocked.txt'), 'restore normal payload')
    writeFileSync(join(old, 'z-locked.txt'), 'retain locked payload')
    const deep = join(old, ...Array(6).fill('long-'.repeat(9)))
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'payload.txt'), 'restore long path')
    for (const name of ['a', 'b']) mkdirSync(join(old, name))
    symlinkSync(join(old, 'b'), join(old, 'a/b'), 'junction')
    symlinkSync(join(old, 'a'), join(old, 'b/a'), 'junction')
    symlinkSync(external, join(old, 'external'), 'junction')
    symlinkSync(join(directory, 'missing'), join(old, 'dangling'), 'junction')
    const output = join(directory, 'generator.exe')
    const uninstaller = join(directory, 'uninstall.exe')
    const source = join(directory, 'fixture.nsi')
    const tool = await compiler()
    const adapted = transactionalUninstallerScript(readFileSync(join(templates, 'uninstaller.nsh'), 'utf8'))
    const functions = adapted.slice(adapted.indexOf('Function un.atomicRMDir'), adapted.indexOf('!ifndef UNINSTALL_SECTION_NAME'))
    writeFileSync(source, `Unicode true
Name "Whale Isle updated removal fixture"
OutFile "${nsisQuote(output)}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
${tool.header}
!define BUILD_UNINSTALLER
!include "${nsisQuote(installer)}"
${functions}
Section
  WriteUninstaller "${nsisQuote(uninstaller)}"
SectionEnd
Section "Uninstall"
  InitPluginsDir
  !insertmacro customRemoveFiles
SectionEnd
`)
    tool.compile(source)
    assert.equal(run(output, ['/S']), 0)
    const close = holdFile(join(old, 'z-locked.txt'))
    try {
      assert.equal(run(uninstaller, ['/S', '--updated', `_?=${old}`]), 2)
      assert.equal(readFileSync(join(old, 'a-unlocked.txt'), 'utf8'), 'restore normal payload')
      assert.equal(readFileSync(join(old, 'z-locked.txt'), 'utf8'), 'retain locked payload')
      assert.equal(readFileSync(join(deep, 'payload.txt'), 'utf8'), 'restore long path')
      assert.equal(realpathSync(join(old, 'external')), realpathSync(external))
      assert.equal(realpathSync(join(old, 'a/b')), realpathSync(join(old, 'b')))
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'user data survives')
      assert.deepEqual(readdirSync(directory).filter(name => name.startsWith('application.uninstall-')), [])
    } finally { close() }
    assert.equal(run(uninstaller, ['/S', '--updated', `_?=${old}`]), 0)
    assert.equal(existsSync(old), false)
    assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'user data survives')
    assert.deepEqual(readdirSync(directory).filter(name => name.startsWith('application.uninstall-')), [])
    // A reparse point at the installation root is also moved/removed as one leaf.
    symlinkSync(external, old, 'junction')
    assert.equal(run(uninstaller, ['/S', '--updated', `_?=${old}`]), 0)
    assert.equal(existsSync(old), false)
    assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'user data survives')
  })

test('failed retirement leaves actionable cleanup instructions and preserves the committed application',
  { skip: process.platform !== 'win32' }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'whale-nsis-retirement-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const final = join(directory, 'application')
    const old = `${final}.old-{F73B1A31-94A3-4FDB-A96B-3E2F78E0A467}`
    const marker = join(directory, 'install-section.txt')
    for (const tree of [final, old]) mkdirSync(tree)
    writeFileSync(join(final, 'sentinel.txt'), 'new application remains available')
    writeFileSync(join(old, 'locked.txt'), 'retired payload')
    symlinkSync(final, join(old, 'current-runtime'), 'junction')
    const output = join(directory, 'retire.exe')
    const source = join(directory, 'fixture.nsi')
    const directories = join(directory, 'directories.nsh')
    writeFileSync(directories, directoryTransactionsScript(readFileSync(directoryTemplate, 'utf8')))
    const tool = await compiler()
    writeFileSync(source, `Unicode true
Name "Whale Isle retirement fixture"
OutFile "${nsisQuote(output)}"
RequestExecutionLevel user
SilentInstall silent
${tool.header}
!define DSH_DIRECTORY_INSTALLER_PATH "${nsisQuote(directories)}"
!include "${nsisQuote(installer)}"
Function .onInit
  StrCpy $INSTDIR "${nsisQuote(final)}"
${cleanupBranch()}
FunctionEnd
Section
  InitPluginsDir
  FileOpen $R0 "${nsisQuote(marker)}" w
  FileWrite $R0 "installation section ran"
  FileClose $R0
  StrCpy $dshFinalDirectory "${nsisQuote(final)}"
  StrCpy $dshOldDirectory "${nsisQuote(old)}"
  StrCpy $dshOldMoved "1"
  StrCpy $dshNewMoved "1"
  !insertmacro dshFinishDirectories
SectionEnd
`)
    tool.compile(source)
    const close = holdFile(join(old, 'locked.txt'))
    try {
      assert.equal(run(output, ['/S']), 0)
      assert.equal(existsSync(old), true)
      const instructions = readFileSync(`${old}.cleanup.txt`, 'utf16le')
      assert.ok(instructions.includes(`"${output}" /S "--cleanup-old=${old}" /D=${final}`))
      assert.equal(readFileSync(join(final, 'sentinel.txt'), 'utf8'), 'new application remains available')
      unlinkSync(marker)
      assert.equal(run(output, ['/S', `--cleanup-old=${old}`, `/D=${final}`]), 2)
      assert.equal(existsSync(marker), false, 'cleanup never enters the installation section')
    } finally { close() }
    assert.equal(run(output, ['/S', `--cleanup-old=${old}`, `/D=${final}`]), 0)
    assert.equal(existsSync(old), false)
    assert.equal(existsSync(`${old}.cleanup.txt`), false)
    assert.equal(existsSync(marker), false)
    assert.equal(readFileSync(join(final, 'sentinel.txt'), 'utf8'), 'new application remains available')
    assert.equal(run(output, ['/S', `--cleanup-old=${final}`, `/D=${final}`]), 2)
    assert.equal(readFileSync(join(final, 'sentinel.txt'), 'utf8'), 'new application remains available')
  })

test('post-promotion rollback preserves its state and complete old backup when final is locked',
  { skip: process.platform !== 'win32' }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'whale-nsis-rollback-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const final = join(directory, 'application')
    const old = `${final}.old-{1066CB48-BC02-43CD-B4F6-9F46836CCEC5}`
    const external = join(directory, 'user-data')
    for (const tree of [final, old, external]) mkdirSync(tree)
    writeFileSync(join(final, 'locked.txt'), 'incomplete new payload')
    writeFileSync(join(final, 'unlocked.txt'), 'new payload')
    writeFileSync(join(old, 'old.txt'), 'complete old application')
    writeFileSync(join(external, 'sentinel.txt'), 'user data survives rollback')
    symlinkSync(old, join(final, 'old-backup'), 'junction')
    symlinkSync(external, join(final, 'user-data'), 'junction')
    const output = join(directory, 'rollback.exe')
    const source = join(directory, 'fixture.nsi')
    const state = join(directory, 'state.txt')
    const directories = join(directory, 'directories.nsh')
    writeFileSync(directories, directoryTransactionsScript(readFileSync(directoryTemplate, 'utf8')))
    const tool = await compiler()
    writeFileSync(source, `Unicode true
Name "Whale Isle rollback fixture"
OutFile "${nsisQuote(output)}"
RequestExecutionLevel user
SilentInstall silent
${tool.header}
!define DSH_DIRECTORY_INSTALLER_PATH "${nsisQuote(directories)}"
!include "${nsisQuote(installer)}"
Section
  InitPluginsDir
  StrCpy $dshFinalDirectory "${nsisQuote(final)}"
  StrCpy $dshOldDirectory "${nsisQuote(old)}"
  StrCpy $dshNewMoved "1"
  StrCpy $dshOldMoved "1"
  Call dshRollbackDirectories
  FileOpen $R0 "${nsisQuote(state)}" w
  FileWrite $R0 "newMoved=$dshNewMoved;oldMoved=$dshOldMoved"
  FileClose $R0
SectionEnd
`)
    tool.compile(source)
    const close = holdFile(join(final, 'locked.txt'))
    try {
      assert.equal(run(output, ['/S']), 2)
      assert.equal(readFileSync(state, 'utf8'), 'newMoved=1;oldMoved=1')
      assert.equal(readFileSync(join(old, 'old.txt'), 'utf8'), 'complete old application')
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'user data survives rollback')
      const instructions = readFileSync(`${old}.rollback.txt`, 'utf16le')
      assert.ok(instructions.includes(old) && instructions.includes(final))
    } finally { close() }
    assert.equal(run(output, ['/S']), 0)
    assert.equal(readFileSync(state, 'utf8'), 'newMoved=;oldMoved=')
    assert.equal(readFileSync(join(final, 'old.txt'), 'utf8'), 'complete old application')
    assert.equal(existsSync(old), false)
    assert.equal(existsSync(`${old}.rollback.txt`), false)
    assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'user data survives rollback')
  })
