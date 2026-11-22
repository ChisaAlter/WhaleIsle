/**
 * Run the installed dsh CLI with the desktop's Node and pnpm distributions.
 *
 * stdin contract on POSIX (same law as dshd-daemon-runner.mjs): the desktop
 * main process spawns this host as a process-group leader with a piped
 * stdin it never ends. A group kill of the Electron parent can never reach
 * this detached group, so the pipe is the lifeline — its close means the
 * parent is gone and this host must not linger as a ppid=1 orphan.
 *
 * The same pipe also carries the internal secret channel (#427): for a
 * desktop-spawned `web` host the parent declares
 * DSHD_INTERNAL_SECRETS_VIA_STDIN=1 (non-secret flag) and writes the
 * `<name> <value>` token lines plus the end marker right after spawn. The
 * tokens land in the in-process store (globalThis, never process.env) before
 * the CLI and its plugins load, so model-spawned children cannot inherit
 * them. Only `web` runs with the flag read here — one-shot commands
 * (`dsh plugin …`) never read stdin: an open stdin read keeps the Windows
 * event loop alive despite unref, which is exactly why the lifeline is
 * POSIX-only.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { isResidentServiceArgs, watchParentLifeline, watchParentPid } from './parent-lifeline.mjs'

const require = createRequire(import.meta.url)
const { signalProcessTree } = require('../shared/process-tree.js')
const { collectInternalSecrets, INTERNAL_SECRETS_ENV } = require('../shared/secret.js')

const [cli, pnpm, ...args] = process.argv.slice(2)
if (!cli || !pnpm) throw new Error('Desktop CLI requires the dsh and pnpm entry paths')

const stopOwnedTreeOnParentLoss = (exitProcess) => {
  process.on('SIGTERM', () => {})
  const killed = signalProcessTree(process.pid, { signal: 'SIGTERM' })
  setTimeout(() => {
    signalProcessTree(process.pid, { signal: 'SIGKILL' })
  }, 5000).unref()
  if (exitProcess) {
    Promise.resolve(killed).finally(() => process.exit(1))
    setTimeout(() => process.exit(1), 1500).unref()
  }
}

// Parent gone → stop this whole tree: signal the process group this host
// leads. Surviving the group SIGTERM keeps a sender around for the SIGKILL 5s
// later, so a descendant that ignored SIGTERM cannot outlive the host. Normal
// stops are unaffected — Electron holds stdin open, so this handler only runs
// once the parent is dead. POSIX watches stdin; Windows one-shot invocations
// cannot keep an active stdin read without hanging exit, so only resident
// `web` services arm an unref'd parent-PID watcher there.
if (process.platform !== 'win32') {
  watchParentLifeline({
    onParentGone: () => stopOwnedTreeOnParentLoss(false),
  })
} else if (isResidentServiceArgs(args)) {
  const configuredParent = Number(process.env.DSHD_PARENT_PID)
  const parentPid = Number.isInteger(configuredParent) && configuredParent > 0
    ? configuredParent
    : process.ppid
  watchParentPid({
    parentPid,
    onParentGone: () => stopOwnedTreeOnParentLoss(true),
  })
}
// Reading coexists with the lifeline above: it only consumes the token lines
// and the end marker, then detaches — end/close keep reaching the lifeline.
// The lifeline unrefs stdin, so the collection window must ref it back or the
// loop could drain before the end marker arrives.
if (args[0] === 'web' && process.env[INTERNAL_SECRETS_ENV] === '1') {
  process.stdin.ref()
  try {
    await collectInternalSecrets(process.stdin)
  } finally {
    process.stdin.unref()
  }
}
process.argv = [process.execPath, cli, ...args]
const { runCli } = await import(pathToFileURL(cli).href)
await runCli({ packageManager: { command: process.execPath, args: [pnpm], env: {} } })
