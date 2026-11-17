#!/usr/bin/env node
/**
 * Desktop host for real phone pairing: force-start desktop, enable LAN remote,
 * print [PAIRING_URL], stay up. Pairing URL is not opened by this script.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSmokeDirs, electronSpawnEnv, initGitWorkspace, reservePort,
} from './smoke-workspace.mjs'
import { killProcessTree, spawnTreeOptions } from '../src/shared/process-tree.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const keepMs = Number(process.env.DSH_REMOTE_HOST_MS) || 900_000

function electronExecutable() {
  const candidates = [
    process.env.ELECTRON_PATH,
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ].filter(Boolean)
  const found = candidates.find((item) => existsSync(item))
  if (!found) throw new Error('Electron binary missing')
  return found
}

const dirs = createSmokeDirs('dsh-remote-phone-')
initGitWorkspace(dirs.workspace)
writeFileSync(path.join(dirs.workspace, 'note.md'), 'phone remote host\n')
const port = await reservePort()
writeFileSync(path.join(dirs.userData, 'config.json'), JSON.stringify({
  workspace: dirs.workspace,
  host: '127.0.0.1',
  port,
  closeToTray: false,
  openAtLogin: false,
  openDevTools: false,
  remoteEnabled: true,
  remoteMode: 'lan',
  remotePort: 3180,
  remoteRelayUrl: '',
  quitAfterStart: false,
  autoStartDesktop: true,
  askOnUpdate: false,
}, null, 2))

console.log(`Phone host userData: ${dirs.userData}`)
const child = spawn(electronExecutable(), ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run'], {
  cwd: root,
  env: electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_REMOTE_PHONE_HOST: '1',
    DSH_REMOTE_LAN: process.env.DSH_REMOTE_LAN || '192.168.53.182',
  }),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
  ...spawnTreeOptions(),
})

let url = ''
const onChunk = (chunk) => {
  const text = String(chunk)
  process.stdout.write(text)
  const match = text.match(/\[PAIRING_URL\]\s+(\S+)/)
  if (match) url = match[1]
}
child.stdout.on('data', onChunk)
child.stderr.on('data', onChunk)

const deadline = Date.now() + 180_000
while (!url && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500))
  const file = path.join(dirs.userData, 'pairing-url.txt')
  if (existsSync(file)) {
    url = readFileSync(file, 'utf8').trim()
  }
}

if (!url) {
  console.error('No pairing URL within 180s')
  await killProcessTree(child.pid).catch((error) => { console.warn('[scripts/run-remote-phone-host.mjs] background operation failed', error); })
  process.exit(1)
}

writeFileSync(path.join(dirs.userData, 'pairing-url.final.txt'), `${url}\n`)
console.log(`Host ready. Staying up ${Math.round(keepMs / 1000)}s.`)
console.log(`PAIR_URL=${url}`)
await new Promise((r) => setTimeout(r, keepMs))
await killProcessTree(child.pid).catch((error) => { console.warn('[scripts/run-remote-phone-host.mjs] background operation failed', error); })
