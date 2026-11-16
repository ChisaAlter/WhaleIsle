/**
 * Run the installed dsh CLI with the desktop's Node and pnpm distributions.
 *
 * stdin contract on POSIX (same law as dshd-daemon-runner.mjs): the desktop
 * main process spawns this host as a process-group leader with a piped
 * stdin it never writes to or ends. A group kill of the Electron parent can
 * never reach this detached group, so the pipe is the lifeline — its close
 * means the parent is gone and this host must not linger as a ppid=1 orphan.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { watchParentLifeline } from './parent-lifeline.mjs'

const require = createRequire(import.meta.url)
const { signalProcessTree } = require('../shared/process-tree.js')

// Parent gone → stop this whole tree: signal the process group this host
// leads. Surviving the group SIGTERM keeps a sender around for the SIGKILL 5s
// later, so a descendant that ignored SIGTERM cannot outlive the host. Normal
// stops are unaffected — Electron holds stdin open, so this handler only runs
// once the parent is dead. POSIX only: the orphan comes from the detached
// process group, and on Windows an active stdin pipe read keeps the event
// loop alive despite unref, so one-shot commands (`dsh plugin …`) never exit.
if (process.platform !== 'win32') {
  watchParentLifeline({
    onParentGone: () => {
      process.on('SIGTERM', () => {})
      signalProcessTree(process.pid, { signal: 'SIGTERM' })
      setTimeout(() => {
        signalProcessTree(process.pid, { signal: 'SIGKILL' })
      }, 5000).unref()
    },
  })
}

const [cli, pnpm, ...args] = process.argv.slice(2)
if (!cli || !pnpm) throw new Error('Desktop CLI requires the dsh and pnpm entry paths')
process.argv = [process.execPath, cli, ...args]
const { runCli } = await import(pathToFileURL(cli).href)
await runCli({ packageManager: { command: process.execPath, args: [pnpm], env: {} } })
