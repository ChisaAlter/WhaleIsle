/**
 * Parent-lifeline watcher for plain-Node child hosts spawned by the desktop.
 * The parent holds the child's stdin pipe open without ever writing to or
 * ending it, so the pipe only closes when the parent is gone — terminal
 * Ctrl+C on a group that cannot reach this detached child, a QA
 * killProcessTree(electron), or SIGKILL. Any of 'end', 'close' or 'error'
 * fires onParentGone exactly once, whichever arrives first.
 *
 * stdin is resumed so EOF is actually observed, then unref'd: the lifeline
 * must report a dead parent but never keep a finished one-shot invocation
 * (e.g. `dsh plugin …`) alive on its own.
 */
/**
 * @param {{ stdin?: NodeJS.ReadStream & { unref?: () => void },
 *           onParentGone: (reason: string) => void }} options
 */
export function watchParentLifeline({ stdin = process.stdin, onParentGone }) {
  let fired = false
  const fire = (/** @type {string} */ reason) => {
    if (fired) return
    fired = true
    onParentGone(reason)
  }
  stdin.on('end', () => fire('stdin-end'))
  stdin.on('close', () => fire('stdin-close'))
  stdin.on('error', () => fire('stdin-error'))
  stdin.resume()
  if (typeof stdin.unref === 'function') stdin.unref()
}

const ONE_SHOT_FLAGS = new Set([
  '--help',
  '-h',
  '--version',
  '-V',
  '--dump-config',
  '--dump-default-config',
  '--dump-config-schema',
  '--json',
])

/**
 * Identify long-lived `dsh web` invocations as opposed to one-shot queries or
 * subcommands (`plugin`, `--help`, `--version`, `--dump-config`, `--json`).
 * @param {readonly string[]} [args]
 */
export function isResidentServiceArgs(args = []) {
  if (!Array.isArray(args) || args[0] !== 'web') return false
  for (const arg of args.slice(1)) {
    const token = String(arg || '')
    const flag = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
    if (ONE_SHOT_FLAGS.has(flag)) return false
  }
  return true
}

/** @param {number} pid */
export function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ESRCH'
  }
}

/**
 * Unref'd parent PID watcher for Windows resident service processes where
 * resuming stdin would keep Node's event loop alive across one-shot exits.
 * @param {{ parentPid?: number,
 *           intervalMs?: number,
 *           isAlive?: (pid: number) => boolean,
 *           onParentGone: (reason: string) => void }} options
 * @returns {() => void}
 */
export function watchParentPid({
  parentPid = process.ppid,
  intervalMs = 2000,
  isAlive = defaultIsProcessAlive,
  onParentGone,
}) {
  if (!Number.isInteger(parentPid) || parentPid <= 0 || parentPid === process.pid) {
    return () => {}
  }
  let stopped = false
  let fired = false
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null
  const stop = () => {
    stopped = true
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
  const check = () => {
    if (stopped || fired) return
    let alive = true
    try {
      alive = Boolean(isAlive(parentPid))
    } catch {
      // A probe failure means parent liveness can no longer be verified; treat as gone to avoid orphaned servers.
      alive = false
    }
    if (alive) return
    fired = true
    stop()
    onParentGone(`parent-pid-gone:${parentPid}`)
  }
  timer = setInterval(check, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  queueMicrotask(check)
  return stop
}
