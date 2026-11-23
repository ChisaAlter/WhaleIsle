/**
 * ChisaCode v2 phone controller: connection lifecycle, reconnect resync,
 * and per-session draft persistence. Pure logic over an injected DaemonClient
 * so app.js stays a thin UI binder and this file stays unit-testable.
 */

import { historyQuery } from '../host/history.js';

const DRAFT_KEY_PREFIX = 'dsh-chisacode-drafts:';

/**
 * Map a transport mode ('lan' | 'p2p' | 'turn' | 'relay') to its Chinese UI label.
 * @param {string | null | undefined} mode
 * @returns {string}
 */
function transportModeLabel(mode) {
  switch (mode) {
    case 'lan':
      return '局域网直连 · 端到端加密';
    case 'p2p':
      return 'P2P 直连 · 端到端加密';
    case 'turn':
      return 'TURN 中继 · 端到端加密';
    case 'relay':
      return '服务器中继 · 端到端加密';
    default:
      return 'dshd · 端到端加密';
  }
}

/**
 * Observe active transport mode changes on a DaemonClient.
 * @param {{ subscribeTransportMode?: (cb: (mode: string) => void) => () => void, getTransportMode?: () => string | null }} client
 * @param {(mode: string) => void} onChange
 * @returns {() => void}
 */
function watchTransportMode(client, onChange) {
  if (typeof onChange !== 'function') return () => {};
  if (typeof client?.subscribeTransportMode === 'function') {
    return client.subscribeTransportMode((/** @type {string} */ mode) => {
      onChange(mode || '');
    });
  }
  const initial = typeof client?.getTransportMode === 'function' ? client.getTransportMode() : '';
  if (initial) onChange(initial);
  return () => {};
}

/**
 * Map a DaemonClient ConnectionState to the three UI phases.
 * @param {{ status?: string, reason?: string, attempt?: number }} state
 * @returns {{ phase: 'online'|'connecting'|'offline', label: string }}
 */
function connectionPhase(state) {
  const status = state?.status;
  if (status === 'connected') {
    return { phase: 'online', label: '' };
  }
  if (status === 'connecting') {
    return { phase: 'connecting', label: '正在重新连接电脑…' };
  }
  const reason = typeof state?.reason === 'string' && state.reason ? `：${state.reason}` : '';
  return { phase: 'offline', label: `连接已断开${reason}；正在等待重连` };
}

/**
 * Observe DaemonClient connection status. The subscription fires immediately
 * with the current state; an initial `connected` must NOT count as a
 * reconnect. Only connected → (connecting|disconnected) → connected triggers
 * onReconnected, and only once per drop.
 * @param {{ subscribeConnectionStatus: (listener: (state: object) => void) => () => void }} client
 * @param {{ onStatus?: (phase: object, state: object) => void, onReconnected?: () => void }} handlers
 * @returns {() => void} disposer
 */
function watchConnection(client, handlers = {}) {
  if (typeof client?.subscribeConnectionStatus !== 'function') {
    throw new Error('DaemonClient 不支持连接状态订阅');
  }
  let sawDrop = false;
  return client.subscribeConnectionStatus((state) => {
    handlers.onStatus?.(connectionPhase(state), state);
    if (state?.status === 'connected') {
      if (sawDrop) {
        sawDrop = false;
        handlers.onReconnected?.();
      }
      return;
    }
    if (state?.status === 'connecting' || state?.status === 'disconnected') {
      sawDrop = true;
    }
  });
}

/** Probe foreground sockets; two failures trigger DaemonClient's reconnect threshold. */
async function checkForegroundConnection(client) {
  if (client.getConnectionState().status !== 'connected') {
    client.ensureConnected();
    return false;
  }
  try {
    await client.checkLiveness({ timeoutMs: 3000 });
  } catch {
    await client.checkLiveness({ timeoutMs: 3000 });
  }
  return true;
}

/**
 * Authoritative resync after a reconnect: re-fetch host session.list +
 * workspace.list and, when a session is open, session.history.
 * Errors propagate to the caller — a failed resync must be visible, never a
 * silently stale page.
 * @param {object} client DaemonClient
 * @param {{ sessionId?: string, address?: object | null }} options
 * @returns {Promise<{ sessions: object, workspaces: object, history: object | null }>}
 */
async function resyncAfterReconnect(client, { sessionId = '', address = null } = {}) {
  if (typeof client?.hostRpc !== 'function') {
    throw new Error('桌面端未启动');
  }
  const unwrap = async (method, payload) => {
    const result = await client.hostRpc(method, payload);
    if (result && result.ok === false) {
      const error = result.error;
      const message = typeof error === 'string' ? error : error?.message;
      throw new Error(message || method);
    }
    return result?.value !== undefined ? result.value : result;
  };
  const [sessions, workspaces] = await Promise.all([
    unwrap('session.list', {}),
    unwrap('workspace.list', {}),
  ]);
  let history = null;
  if (sessionId) {
    history = await unwrap('session.history', historyQuery(sessionId, address ? { address } : {}));
  }
  return { sessions, workspaces, history };
}

/**
 * Per-server draft store: keeps unsent composer text per sessionId so drafts
 * survive reconnects and session switches. Best-effort local convenience —
 * storage failures degrade to in-memory for this page load, never throw.
 *
 * Attachments are kept per session in memory only: image bytes would blow
 * the localStorage quota, so they survive session switches but not a page
 * reload (documented product behavior, not a bug).
 * @param {Storage | null} storage
 * @param {string} serverId
 */
function createDraftStore(storage, serverId) {
  const key = `${DRAFT_KEY_PREFIX}${serverId}`;
  const memory = {};
  const attachmentsBySession = new Map();

  function readAll() {
    try {
      const parsed = JSON.parse(storage.getItem(key) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return { ...memory };
    }
  }

  function writeAll(all) {
    Object.assign(memory, all);
    for (const id of Object.keys(memory)) {
      if (!(id in all)) delete memory[id];
    }
    try {
      storage.setItem(key, JSON.stringify(all));
    } catch { /* storage unavailable → memory only */ }
  }

  return {
    load(sessionId) {
      if (!sessionId) return '';
      const value = readAll()[sessionId];
      return typeof value === 'string' ? value : '';
    },
    save(sessionId, text) {
      if (!sessionId) return;
      const all = readAll();
      if (typeof text === 'string' && text) {
        all[sessionId] = text;
      } else {
        delete all[sessionId];
      }
      writeAll(all);
    },
    clear(sessionId) {
      if (!sessionId) return;
      const all = readAll();
      delete all[sessionId];
      writeAll(all);
      attachmentsBySession.delete(sessionId);
    },
    clearAll() {
      for (const id of Object.keys(memory)) delete memory[id];
      attachmentsBySession.clear();
      try {
        storage.removeItem(key);
      } catch { /* ignore */ }
    },
    loadAttachments(sessionId) {
      if (!sessionId) return [];
      return attachmentsBySession.get(sessionId)?.slice() || [];
    },
    saveAttachments(sessionId, images) {
      if (!sessionId) return;
      if (Array.isArray(images) && images.length) {
        attachmentsBySession.set(sessionId, images.slice());
      } else {
        attachmentsBySession.delete(sessionId);
      }
    },
  };
}

export {
  checkForegroundConnection,
  connectionPhase,
  watchConnection,
  watchTransportMode,
  transportModeLabel,
  resyncAfterReconnect,
  createDraftStore,
};
