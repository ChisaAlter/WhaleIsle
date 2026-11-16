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
export function watchParentLifeline({ stdin = process.stdin, onParentGone } = {}) {
  let fired = false
  const fire = (reason) => {
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
