'use strict';

// In-window confirmations for the launcher surface: the main process asks on
// `shell:app-confirm`, the launcher renderer renders its own app-confirm card,
// and the answer returns on `shell:app-confirm:response` (mounted as a lane
// channel through registerLauncherChannels' extraChannels). ask() resolves
// `null` when the bridge cannot reach the renderer — callers then use their
// native-messagebox fallback, so a dead window can never silently authorize.

const CONFIRM_EVENT = 'shell:app-confirm';
const RESPONSE_CHANNEL = 'shell:app-confirm:response';

/** @param {{ getWindow?: () => any }} [deps] */
function createLauncherConfirm({ getWindow } = {}) {
  let seq = 0;
  // appConfirm is a single shared modal in the renderer — serialize asks so a
  // second confirm waits for the first to settle instead of racing it.
  let queue = Promise.resolve();
  /** @type {Map<string, { resolve: (value: any) => void, cleanup: () => void }>} */
  const pending = new Map();

  /**
   * @param {string} id
   * @param {any} value
   */
  function settle(id, value) {
    const item = pending.get(id);
    if (!item) {
      return false;
    }
    pending.delete(id);
    item.cleanup();
    item.resolve(value);
    return true;
  }

  /** @param {any} payload */
  function respond(payload) {
    const id = payload && payload.id;
    if (typeof id !== 'string' || !id) {
      return false;
    }
    return settle(id, payload.ok === true);
  }

  /** @param {{ title?: any, body?: any, confirmText?: any, cancelText?: any, danger?: boolean }} [options] */
  function ask(options = {}) {
    const run = () => new Promise((resolve) => {
      const win = typeof getWindow === 'function' ? getWindow() : null;
      const contents = win && !win.isDestroyed() ? win.webContents : null;
      if (!contents || contents.isDestroyed()) {
        resolve(null);
        return;
      }
      const id = `lc${++seq}`;
      const onGone = () => settle(id, null);
      pending.set(id, {
        resolve,
        cleanup: () => contents.removeListener('destroyed', onGone),
      });
      contents.once('destroyed', onGone);
      try {
        contents.send(CONFIRM_EVENT, {
          id,
          title: String(options.title || ''),
          body: String(options.body || ''),
          confirmText: options.confirmText ? String(options.confirmText) : '',
          cancelText: options.cancelText ? String(options.cancelText) : '',
          danger: options.danger === true,
        });
      } catch {
        settle(id, null);
      }
    });
    const result = queue.then(run, run);
    queue = result.then(() => {}, () => {});
    return result;
  }

  // Lane-module seam: registerLauncherChannels mounts this through the same
  // authorized `handle` wrapper as every other launcher channel.
  /** @param {{ handle: (channel: string, listener: (event: any, payload?: any) => any) => void }} ctx */
  function register(ctx) {
    ctx.handle(RESPONSE_CHANNEL, (/** @type {any} */ _event, /** @type {any} */ payload) => respond(payload));
  }

  return { ask, respond, register };
}

module.exports = { createLauncherConfirm, CONFIRM_EVENT, RESPONSE_CHANNEL };
