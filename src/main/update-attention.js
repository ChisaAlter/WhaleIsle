'use strict';

/**
 * Best-effort background attention for a discovered update; never grants
 * update or task-stop authorization. Ported from upstream update-attention.ts.
 */

const { app, Notification } = require('electron');
const { systemNotificationsSupported } = require('./system-notifications');

/** Owns one reminder per discovered version until reset for a new check. */
class UpdateAttention {
  /**
   * @param {{ title: string, body: string }} text - notification copy.
   * @param {string} [platform]
   */
  constructor(text, platform = process.platform) {
    this.text = text;
    this.platform = platform;
    this.version = undefined;
    this.notification = undefined;
    this.stop = undefined;
  }

  /**
   * @param {string} version - available target whose update confirmation is waiting.
   * @param {any} parent - taskbar window; never restored or focused by the reminder.
   * @param {any} [modal] - existing update confirmation.
   * @param {() => void} returnToConfirmation - returns to UI without installing.
   */
  ready(version, parent, modal, returnToConfirmation) {
    if (this.version === version) return;
    this.version = version;
    if (parent.isFocused() || (modal && modal.isFocused())) return;
    const clear = () => { this.clear(); };
    let bounce;
    parent.on('focus', clear);
    if (modal) modal.on('focus', clear);
    this.stop = () => {
      parent.off('focus', clear);
      if (modal) modal.off('focus', clear);
      if (this.platform === 'win32' && !parent.isDestroyed()) parent.flashFrame(false);
      if (bounce !== undefined) app.dock?.cancelBounce(bounce);
    };
    try {
      if (this.platform === 'win32') parent.flashFrame(true);
      if (this.platform === 'darwin') bounce = app.dock?.bounce('informational');
    } catch (error) {
      console.warn('dshd update: attention unavailable', error);
    }
    try {
      if (!systemNotificationsSupported(Notification, { platform: this.platform })) return;
      const notification = new Notification({ title: this.text.title, body: this.text.body, silent: true });
      this.notification = notification;
      notification.on('failed', () => {
        if (this.notification === notification) this.notification = undefined;
        notification.removeAllListeners();
      });
      notification.once('click', () => {
        if (this.notification !== notification) return;
        this.clear();
        returnToConfirmation();
      });
      notification.show();
    } catch (error) {
      console.warn('dshd update: notification unavailable', error);
    }
  }

  /** Release owned native reminders without scheduling another for this target. */
  clear() {
    const notification = this.notification;
    this.notification = undefined;
    notification?.removeAllListeners();
    try { notification?.close(); } catch (error) { console.warn('dshd update: could not close notification', error); }
    const stop = this.stop;
    this.stop = undefined;
    try { stop?.(); } catch (error) { console.warn('dshd update: could not clear attention', error); }
  }

  /** Start a new update-check episode, or dispose all owned reminders. */
  reset() { this.clear(); this.version = undefined; }
}

module.exports = { UpdateAttention };
