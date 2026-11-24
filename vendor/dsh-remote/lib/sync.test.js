import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadSyncState, pushOneFile, pushTree, saveSyncState, syncTree } from './sync.js'

function tempDir(t, name = 'mirror') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-sync-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const local = path.join(root, 'local')
  fsMkdir(local)
  return { root, local, remote: '/srv/remote' }
}

function fsMkdir(dir) {
  mkdirSync(dir, { recursive: true })
}

function setMtime(file, seconds) {
  const at = new Date(seconds * 1000)
  utimesSync(file, at, at)
}

/** Minimal SFTP double: only the stat/readdir/readFile/writeFile contract sync uses. */
function makeSftp(remoteEntries) {
  const files = new Map(remoteEntries.map((entry) => [entry.path, { ...entry }]))
  return {
    files,
    async readdir(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`
      const rows = []
      for (const entry of files.values()) {
        if (!entry.path.startsWith(prefix)) continue
        const rest = entry.path.slice(prefix.length)
        const slash = rest.indexOf('/')
        const filename = slash === -1 ? rest : rest.slice(0, slash)
        if (rows.some((row) => row.filename === filename)) continue
        rows.push({
          filename,
          attrs: {
            isDirectory: () => slash !== -1,
            size: entry.size,
            mtime: entry.mtime,
          },
        })
      }
      return rows
    },
    async stat(target) {
      const entry = files.get(target)
      if (!entry) throw new Error(`ENOENT: ${target}`)
      return { size: entry.size, mtime: entry.mtime, isDirectory: () => entry.dir === true }
    },
    async readFile(target) {
      const entry = files.get(target)
      if (!entry) throw new Error(`ENOENT: ${target}`)
      return Buffer.from(entry.body)
    },
    async writeFile(target, body) {
      const mtime = Date.now() / 1000
      files.set(target, { path: target, body: Buffer.from(body), size: Buffer.byteLength(body), mtime })
    },
    async mkdir() {},
  }
}

function localStatAt(file, seconds) {
  setMtime(file, seconds)
  return statSync(file)
}

test('syncTree turns a divergent remote/local change into a conflict and does not write', async (t) => {
  const { local, remote } = tempDir(t)
  const file = path.join(local, 'a.txt')
  writeFileSync(file, 'local-new')
  localStatAt(file, 200)
  const sftp = makeSftp([
    { path: `${remote}/a.txt`, body: 'remote-new', size: Buffer.byteLength('remote-new'), mtime: 300 },
  ])
  const state = { 'a.txt': { size: Buffer.byteLength('synced'), mtime: 100 } }
  const { stats } = await syncTree(sftp, remote, local, { state })
  assert.equal(stats.conflicts.length, 1)
  assert.match(stats.conflicts[0].reason, /both-modified/)
  assert.equal(readFileSync(file, 'utf8'), 'local-new')
})

test('syncTree refuses to clobber a local-only edit when the remote is unchanged', async (t) => {
  const { local, remote } = tempDir(t)
  const file = path.join(local, 'a.txt')
  writeFileSync(file, 'local-edit')
  localStatAt(file, 200)
  const sftp = makeSftp([
    { path: `${remote}/a.txt`, body: 'synced', size: Buffer.byteLength('synced'), mtime: 100 },
  ])
  const { stats } = await syncTree(sftp, remote, local, {
    state: { 'a.txt': { size: Buffer.byteLength('synced'), mtime: 100 } },
  })
  assert.equal(stats.conflicts.length, 1)
  assert.match(stats.conflicts[0].reason, /local-modified/)
  assert.equal(readFileSync(file, 'utf8'), 'local-edit')
})

test('pushTree reports a both-modified conflict and leaves the remote untouched', async (t) => {
  const { local, remote } = tempDir(t)
  const file = path.join(local, 'a.txt')
  writeFileSync(file, 'local-new')
  const sftp = makeSftp([
    { path: `${remote}/a.txt`, body: 'remote-new', size: Buffer.byteLength('remote-new'), mtime: 300 },
  ])
  const { stats } = await pushTree(sftp, local, remote, {
    state: { 'a.txt': { size: Buffer.byteLength('synced'), mtime: 100 } },
  })
  assert.equal(stats.conflicts.length, 1)
  assert.match(stats.conflicts[0].reason, /both-modified/)
  assert.equal(sftp.files.get(`${remote}/a.txt`).body.toString(), 'remote-new')
})

test('pushTree reports a remote-modified conflict when the local side was untouched', async (t) => {
  const { local, remote } = tempDir(t)
  const file = path.join(local, 'a.txt')
  writeFileSync(file, 'synced')
  setMtime(file, 100)
  const sftp = makeSftp([
    { path: `${remote}/a.txt`, body: 'remote-new', size: Buffer.byteLength('remote-new'), mtime: 300 },
  ])
  const { stats } = await pushTree(sftp, local, remote, {
    state: { 'a.txt': { size: Buffer.byteLength('synced'), mtime: 100 } },
  })
  assert.equal(stats.conflicts.length, 1)
  assert.match(stats.conflicts[0].reason, /remote-modified/)
  assert.equal(sftp.files.get(`${remote}/a.txt`).body.toString(), 'remote-new')
})

test('pushOneFile returns a conflict instead of overwriting a divergent remote file', async (t) => {
  const { local, remote } = tempDir(t)
  const file = path.join(local, 'a.txt')
  writeFileSync(file, 'local-new')
  const sftp = makeSftp([
    { path: `${remote}/a.txt`, body: 'remote-new', size: Buffer.byteLength('remote-new'), mtime: 300 },
  ])
  const result = await pushOneFile(sftp, local, remote, 'a.txt', {
    state: { 'a.txt': { size: Buffer.byteLength('synced'), mtime: 100 } },
  })
  assert.equal(result.status, 'conflict')
  assert.equal(result.reason, 'both-modified')
  assert.equal(sftp.files.get(`${remote}/a.txt`).body.toString(), 'remote-new')
})

test('force is the explicit opt-in that overwrites a conflict', async (t) => {
  const { local, remote } = tempDir(t)
  const file = path.join(local, 'a.txt')
  writeFileSync(file, 'local-new')
  const sftp = makeSftp([
    { path: `${remote}/a.txt`, body: 'remote-new', size: Buffer.byteLength('remote-new'), mtime: 300 },
  ])
  const { stats } = await pushTree(sftp, local, remote, {
    force: true,
    state: { 'a.txt': { size: Buffer.byteLength('synced'), mtime: 100 } },
  })
  assert.equal(stats.conflicts.length, 0)
  assert.equal(stats.pushed.length, 1)
  assert.equal(sftp.files.get(`${remote}/a.txt`).body.toString(), 'local-new')
})

test('sync state round-trips atomically and malformed state loads as empty', (t) => {
  const { local } = tempDir(t)
  saveSyncState(local, { 'a.txt': { size: 1, mtime: 1 } })
  assert.deepEqual(loadSyncState(local), { 'a.txt': { size: 1, mtime: 1 } })
  writeFileSync(path.join(local, '.dsh-remote-sync-state.json'), '{broken')
  assert.deepEqual(loadSyncState(local), {})
})

test('syncTree rejects path traversal, drive prefixes, NUL bytes, and remote symlinks', async (t) => {
  const { root, local, remote } = tempDir(t)
  const evilNames = [
    '../escape.txt',
    '..\\escape2.txt',
    'sub/nested.txt',
    'sub\\nested2.txt',
    'C:drive.txt',
    'bad\0null.txt',
    '.',
    '..',
    '',
  ]
  const rawEntries = [
    ...evilNames.map((filename) => ({
      filename,
      attrs: { isDirectory: () => false, isSymbolicLink: () => false, size: 4, mtime: 100 },
    })),
    {
      filename: '../evil-dir',
      attrs: { isDirectory: () => true, isSymbolicLink: () => false, size: 0, mtime: 100 },
    },
    {
      filename: 'sym-by-fn.txt',
      attrs: { isDirectory: () => false, isSymbolicLink: () => true, size: 4, mtime: 100 },
    },
    {
      filename: 'sym-by-mode.txt',
      attrs: { isDirectory: () => false, mode: 0o120777, size: 4, mtime: 100 },
    },
    {
      filename: 'sym-by-lstat.txt',
      attrs: { isDirectory: () => false, isSymbolicLink: () => false, size: 4, mtime: 100 },
    },
    {
      filename: '..good.txt',
      attrs: { isDirectory: () => false, isSymbolicLink: () => false, size: 4, mtime: 100 },
    },
  ]
  const sftp = {
    async readdir(dir) {
      return dir === remote ? rawEntries : []
    },
    async lstat(target) {
      if (target === `${remote}/sym-by-lstat.txt`) {
        return { size: 4, mtime: 100, isDirectory: () => false, isSymbolicLink: () => true }
      }
      return { size: 4, mtime: 100, isDirectory: () => false, isSymbolicLink: () => false }
    },
    async stat() {
      return { size: 4, mtime: 100, isDirectory: () => false }
    },
    async readFile() {
      return Buffer.from('good')
    },
  }

  const { stats } = await syncTree(sftp, remote, local)
  assert.equal(stats.files, 1)
  assert.deepEqual(stats.touched, [`${remote}/..good.txt`])
  assert.equal(readFileSync(path.join(local, '..good.txt'), 'utf8'), 'good')
  assert.equal(existsSync(path.join(root, 'escape.txt')), false)
  assert.equal(existsSync(path.join(root, 'escape2.txt')), false)
  assert.equal(existsSync(path.join(root, 'evil-dir')), false)
  assert.equal(existsSync(path.join(local, 'sym-by-fn.txt')), false)
  assert.equal(existsSync(path.join(local, 'sym-by-mode.txt')), false)
  assert.equal(existsSync(path.join(local, 'sym-by-lstat.txt')), false)
})

test('syncTree refuses to traverse or write through a local symlink or junction', async (t) => {
  const { root, local, remote } = tempDir(t)
  const outside = path.join(root, 'outside')
  fsMkdir(outside)
  symlinkSync(outside, path.join(local, 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir')

  const sftp = makeSftp([
    { path: `${remote}/linked-dir/pwned.txt`, body: 'evil', size: 4, mtime: 200 },
    { path: `${remote}/safe.txt`, body: 'safe', size: 4, mtime: 200 },
  ])
  const { stats } = await syncTree(sftp, remote, local)
  assert.equal(existsSync(path.join(outside, 'pwned.txt')), false)
  assert.equal(stats.files, 1)
  assert.equal(readFileSync(path.join(local, 'safe.txt'), 'utf8'), 'safe')
})
