'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { systemNotificationsAllowed, systemNotificationsSupported } = require('./system-notifications');

test('raw Windows Electron blocks support probing before its registration side effect', () => {
  const Notification = { isSupported() { throw new Error('must not initialize presenter'); } };
  const environment = { platform: 'win32', defaultApp: true };
  assert.equal(systemNotificationsAllowed(environment), false);
  assert.equal(systemNotificationsSupported(Notification, environment), false);
});

test('packaged Windows and other platforms keep native notification support checks', () => {
  for (const environment of [
    { platform: 'win32', defaultApp: false },
    { platform: 'win32' },
    { platform: 'linux', defaultApp: true },
    { platform: 'darwin', defaultApp: true },
  ]) {
    let calls = 0;
    const Notification = { isSupported() { calls++; return true; } };
    assert.equal(systemNotificationsAllowed(environment), true);
    assert.equal(systemNotificationsSupported(Notification, environment), true);
    assert.equal(calls, 1);
    Notification.isSupported = () => false;
    assert.equal(systemNotificationsSupported(Notification, environment), false);
  }
});

function notificationFixture(environment) {
  const counts = { support: 0, construct: 0, show: 0, close: 0 };
  const notifications = [];
  class Notification extends EventEmitter {
    static isSupported() { counts.support++; return true; }
    constructor(options) { super(); this.options = options; counts.construct++; notifications.push(this); }
    show() { counts.show++; }
    close() { counts.close++; }
  }
  const policyModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'system-notifications.js'), 'utf8'), {
    module: policyModule, process: environment,
  });
  return { Notification, counts, notifications, policy: policyModule.exports };
}

for (const argument of ['check', 'pending']) {
  test(`${argument === 'check' ? 'cold-start' : 'parked'} update notification reports availability and returns to the waiting confirmation without authorizing install`, async () => {
    const environment = { platform: 'win32', defaultApp: false };
    const fixture = notificationFixture(environment);
    const updateModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'update-attention.js'), 'utf8'), {
      module: updateModule, process: environment, console,
      require: name => name === 'electron' ? { app: {}, Notification: fixture.Notification } : fixture.policy,
    });
    const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8').replace(/\r\n/g, '\n');
    const setup = source.slice(source.indexOf('const updateAttention ='), source.indexOf('\n/**\n * Productized confirmation:'));
    const start = source.indexOf(`confirmUpdate: async (${argument})`);
    const end = source.indexOf('\n    },', start) + '\n    },'.length;
    const confirmation = source.slice(start, end);
    const ui = [];
    const parent = new EventEmitter();
    parent.isFocused = () => false;
    parent.isDestroyed = () => false;
    parent.isMinimized = () => true;
    parent.restore = () => ui.push('restore');
    parent.show = () => ui.push('show');
    parent.focus = () => ui.push('focus');
    parent.flashFrame = () => {};
    const modal = { focus: () => ui.push('confirmation-focus') };
    let respond;
    const confirm = vm.runInNewContext(`${setup}\n({ ${confirmation} }).confirmUpdate`, {
      UpdateAttention: updateModule.exports.UpdateAttention,
      shellConfirm: () => modal,
      getLauncherWindow: () => parent,
      updateAskDetail: () => 'release notes',
      confirmDialog: (win, options) => {
        assert.equal(win, parent);
        assert.equal(options.message, '是否更新到 0.4.0？');
        return new Promise(resolve => { respond = resolve; });
      },
    });
    let settled = false;
    const result = confirm({ latest: '0.4.0' }).then(value => { settled = true; return value; });
    assert.equal(fixture.notifications.length, 1);
    const notification = fixture.notifications[0];
    assert.equal(notification.options.title, '发现新版本');
    assert.equal(notification.options.body, '新版本可用，回到窗口查看更新说明。');
    notification.emit('click');
    assert.deepEqual(ui, ['restore', 'show', 'focus', 'confirmation-focus']);
    assert.equal(fixture.counts.close, 1);
    assert.equal(settled, false, 'clicking the notification must leave the update decision waiting');
    respond({ response: 1 });
    assert.equal(await result, false, 'the user can still decline after returning to the confirmation');
  });
}

for (const environment of [
  { platform: 'win32', defaultApp: true },
  { platform: 'win32', defaultApp: false },
  { platform: 'linux', defaultApp: true },
  { platform: 'darwin', defaultApp: true },
]) {
  const label = `${environment.platform} ${environment.defaultApp ? 'source' : 'package'}`;
  const expected = environment.platform === 'win32' && environment.defaultApp ? 0 : 1;
  test(`${label}: desktop tray hint guards support and constructor together`, () => {
    const { Notification, counts, policy } = notificationFixture(environment);
    const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8').replace(/\r\n/g, '\n');
    const snippet = source.slice(source.indexOf('const trayHideNotice ='), source.indexOf('\nfunction bindMainClose'));
    const notice = vm.runInNewContext(`${snippet}\ntrayHideNotice`, {
      app: { getPath: () => '/isolated-profile' },
      TrayHideNotice: class { constructor(options) { this.notify = options.notify; } },
      systemNotificationsSupported: policy.systemNotificationsSupported,
      require: name => name === 'electron' ? { Notification } : require(name),
    });
    notice.notify();
    assert.deepEqual(counts, { support: expected, construct: expected, show: expected, close: 0 });
  });

  test(`${label}: slim tray hint keeps the hide behavior without source registration`, () => {
    const { Notification, counts, policy } = notificationFixture(environment);
    const source = fs.readFileSync(path.join(__dirname, '../main-launcher/index.js'), 'utf8').replace(/\r\n/g, '\n');
    const snippet = source.slice(source.indexOf('function bindLauncherClose'), source.indexOf('async function confirmUnverified'));
    const bind = vm.runInNewContext(`${snippet}\nbindLauncherClose`, {
      quitting: false, tray: {}, Notification,
      loadConfig: () => ({}), saveConfig() {}, hideOnClose: () => true, trace() {},
      systemNotificationsSupported: policy.systemNotificationsSupported,
    });
    const win = new EventEmitter();
    let hidden = false, prevented = false;
    win.hide = () => { hidden = true; };
    bind(win);
    win.emit('close', { preventDefault() { prevented = true; } });
    assert.equal(hidden, true);
    assert.equal(prevented, true);
    assert.deepEqual(counts, { support: expected, construct: expected, show: expected, close: 0 });
  });

  test(`${label}: update reminder retains attention and cleanup while gating registration`, () => {
    const { Notification, counts, policy } = notificationFixture(environment);
    const updateModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'update-attention.js'), 'utf8'), {
      module: updateModule, process: environment, console,
      require: name => name === 'electron'
        ? { app: { dock: { bounce: () => 1, cancelBounce() {} } }, Notification }
        : policy,
    });
    const parent = new EventEmitter();
    const flashes = [];
    parent.isFocused = () => false;
    parent.isDestroyed = () => false;
    parent.flashFrame = value => flashes.push(value);
    const attention = new updateModule.exports.UpdateAttention({ title: 'update', body: 'confirm' });
    attention.ready('0.3.3', parent, undefined, () => {});
    assert.deepEqual(counts, { support: expected, construct: expected, show: expected, close: 0 });
    attention.ready('0.3.3', parent, undefined, () => {});
    assert.equal(counts.support, expected, 'one reminder per version');
    assert.equal(parent.listenerCount('focus'), 1);
    parent.emit('focus');
    assert.equal(parent.listenerCount('focus'), 0);
    assert.equal(counts.close, expected);
    if (environment.platform === 'win32') assert.deepEqual(flashes, [true, false]);
  });
}
