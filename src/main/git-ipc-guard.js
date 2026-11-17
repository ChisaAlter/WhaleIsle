/**
 * Last-resort guard for `shell:git-*` IPC handlers.
 *
 * `ipcMain.handle` propagates a thrown handler error to the renderer as an
 * `ipcRenderer.invoke` rejection. The titlebar Git UI consumes every git
 * channel as a resolving promise — either a status/diff snapshot (or `null`)
 * or an `{ ok, message }` result — and a rejection strands its progress toast
 * in the loading state. Wrapping the listener converts an unexpected throw
 * into the channel's failure payload so the renderer always receives a
 * drawable result. Authorization stays outside the wrap: `assertIpcSender`
 * runs before the wrapped listener and still rejects unauthorized senders.
 */

const GIT_IPC_FALLBACK_MESSAGE = 'Git action failed unexpectedly.';

/**
 * Failure payload for `{ ok, message }`-shaped git channels.
 * @param {unknown} error
 * @returns {{ ok: false, message: string }}
 */
function gitIpcFailure(error) {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : GIT_IPC_FALLBACK_MESSAGE;
  return { ok: false, message };
}

/** Fallback for snapshot channels where the renderer treats `null` as unavailable. */
function gitIpcNull() {
  return null;
}

/**
 * Wrap a git IPC listener so a throw resolves to `fallback(error)` instead of
 * rejecting the renderer's `invoke` promise.
 * @template {(...args: any[]) => any} T
 * @param {T} listener
 * @param {(error: unknown) => unknown} [fallback]
 */
function guardGitIpc(listener, fallback = gitIpcFailure) {
  return async (/** @type {unknown[]} */ ...args) => {
    try {
      return await listener(...args);
    } catch (error) {
      return fallback(error);
    }
  };
}

module.exports = {
  GIT_IPC_FALLBACK_MESSAGE,
  gitIpcFailure,
  gitIpcNull,
  guardGitIpc,
};
