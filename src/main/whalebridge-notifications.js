'use strict';

const { systemNotificationsSupported } = require('./system-notifications');

function quotaNotification(alert) {
  const name = [alert.Name || alert.Provider, alert.User].filter(Boolean).join(' · ');
  const when = alert.ResetsAt ? new Date(alert.ResetsAt).toLocaleString('zh-CN') : '';
  let body;
  if (alert.Kind === 'expires') {
    body = `${alert.Credits} 次额度重置将在 ${when} 到期。`;
  } else if (alert.Kind === 'renews') {
    body = `${alert.Window} 将在 ${when} 重置，当前已使用 ${Math.round(alert.Used)}%。`;
  } else if (alert.Balance) {
    body = `余额已降至 ${alert.Balance}。`;
  } else {
    body = `${alert.Window} 已使用 ${Math.round(alert.Used)}%。${when ? `下次重置：${when}。` : ''}`;
  }
  return { title: `鲸桥 · ${name}`, body };
}

// The desktop process owns reminders, independently of the management
// window. A component restart gives its notice queue a new cursor.
function startWhaleBridgeNotifications(options = {}) {
  const service = options.service || require('../launcher/whalebridge').whaleBridgeService();
  const Notification = options.Notification || require('electron').Notification;
  const schedule = options.setInterval || setInterval;
  const cancel = options.clearInterval || clearInterval;
  const onError = options.onError || (error => console.warn('whalebridge: quota reminder unavailable', error.message));
  let pid = null, sequence = 0, reading = false, stopped = false;
  async function poll() {
    if (stopped || reading) return;
    const current = service.state();
    if (!current) { pid = null; sequence = 0; return; }
    if (!systemNotificationsSupported(Notification, options.environment)) return;
    if (current.pid !== pid) { pid = current.pid; sequence = 0; }
    reading = true;
    try {
      const notices = await service.alerts(current);
      if (stopped || service.state()?.pid !== current.pid) return;
      for (const notice of notices.alerts) {
        if (notice.sequence <= sequence) continue;
        const notification = new Notification(quotaNotification(notice.alert));
        notification.once('click', () => {
          const live = service.state();
          if (live) require('./whalebridge-window').openWhaleBridgeWindow(live.url);
        });
        notification.show();
        sequence = notice.sequence;
      }
      sequence = Math.max(sequence, notices.sequence);
    } catch (error) { if (!stopped) onError(error); }
    finally { reading = false; }
  }
  const timer = schedule(() => void poll(), 30_000);
  timer.unref?.();
  void poll();
  return () => { stopped = true; cancel(timer); };
}

module.exports = { startWhaleBridgeNotifications, quotaNotification };
