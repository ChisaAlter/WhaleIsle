'use strict';

/**
 * @template T
 * @param {(error: unknown) => void} [onError]
 * @returns {{ add: (listener: (value: T) => void) => () => void, emit: (value: T) => void }}
 */
function createListenerSet(onError) {
  /** @type {Set<(value: T) => void>} */
  const listeners = new Set();
  return {
    add(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(value) {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          onError?.(error);
        }
      }
    },
  };
}

/**
 * Queue a Harness session jump until `revealHarnessView` finishes when the
 * view is not yet ready; otherwise deliver `shell:open-session` immediately.
 */
function createSessionJumpQueue() {
  let pendingSessionId = '';

  /**
   * @param {any} win
   * @param {(win: any) => boolean} isLoaded
   * @param {(win: any) => any} getHarnessWc
   * @param {string} sessionId
   * @returns {boolean}
   */
  function dispatch(win, isLoaded, getHarnessWc, sessionId) {
    if (!win || !isLoaded(win)) return false;
    const wc = getHarnessWc(win);
    if (!wc || wc.isDestroyed()) return false;
    wc.send('shell:open-session', { sessionId });
    return true;
  }

  return {
    /**
     * @param {any} win
     * @param {(win: any) => boolean} isLoaded
     * @param {(win: any) => any} getHarnessWc
     * @param {unknown} rawSessionId
     * @returns {boolean}
     */
    request(win, isLoaded, getHarnessWc, rawSessionId) {
      const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
      if (!sessionId) return false;
      if (dispatch(win, isLoaded, getHarnessWc, sessionId)) {
        pendingSessionId = '';
        return true;
      }
      pendingSessionId = sessionId;
      return Boolean(win);
    },
    /**
     * @param {any} win
     * @param {(win: any) => boolean} isLoaded
     * @param {(win: any) => any} getHarnessWc
     */
    consume(win, isLoaded, getHarnessWc) {
      if (!pendingSessionId) return;
      if (dispatch(win, isLoaded, getHarnessWc, pendingSessionId)) {
        pendingSessionId = '';
      }
    },
    clear() {
      pendingSessionId = '';
    },
  };
}

module.exports = {
  createListenerSet,
  createSessionJumpQueue,
};
