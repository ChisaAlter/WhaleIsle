'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { childSpawnEnv } = require('./child-spawn-env');
const { setDesktopDshHome, clearDesktopDshHome } = require('./dsh-home');

const HOME = path.resolve(path.sep, 'desktop', 'user-data', 'dsh-home');

test.beforeEach(() => {
  delete process.env.DSHD_HOME;
  setDesktopDshHome(HOME);
});

test.afterEach(() => {
  clearDesktopDshHome();
});

test('childSpawnEnv 强制桌面 DSH_HOME 并清掉 Electron 启动变量', () => {
  const env = childSpawnEnv({}, {
    baseEnv: {
      DSH_HOME: '/home/user/.dsh',
      dsh_home: '/home/user/.dsh-variant',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ASAR: '1',
      PATH: '/usr/bin',
    },
  });
  assert.equal(env.DSH_HOME, HOME);
  assert.equal(env.dsh_home, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.ELECTRON_NO_ASAR, undefined);
  assert.equal(env.npm_config_update_notifier, 'false');
  assert.equal(env.DSHD_PLUGIN_MARKET_INDEX, 'https://realguan.github.io/dsh-plugin-market/dsh-index.json');
});

test('childSpawnEnv 按调用方给定顺序把 extras 前置到 PATH', () => {
  const env = childSpawnEnv({}, {
    baseEnv: { PATH: '/usr/bin' },
    extras: ['/first', '/second'],
  });
  assert.equal(env.PATH, ['/first', '/second', '/usr/bin'].join(path.delimiter));
});

test('childSpawnEnv 官方网关才写 DEEPSEEK_*，第三方网关不别名', () => {
  const official = childSpawnEnv(
    { apiKey: 'sk-official', baseUrl: 'https://api.deepseek.com' },
    { baseEnv: {} },
  );
  assert.equal(official.DEEPSEEK_API_KEY, 'sk-official');
  // dsh 0.1.6+ 官方端点归一到 Messages 协议根 https://api.deepseek.com/anthropic
  assert.equal(official.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/anthropic');

  const thirdParty = childSpawnEnv(
    { apiKey: 'sk-gateway', baseUrl: 'https://gateway.example.com' },
    { baseEnv: {} },
  );
  assert.equal(thirdParty.DEEPSEEK_API_KEY, undefined);
  assert.equal(thirdParty.DEEPSEEK_BASE_URL, undefined);
});

test('childSpawnEnv 不改动 baseEnv 本体', () => {
  const baseEnv = { DSH_HOME: '/home/user/.dsh', PATH: '/usr/bin' };
  childSpawnEnv({}, { baseEnv, extras: ['/x'] });
  assert.deepEqual(baseEnv, { DSH_HOME: '/home/user/.dsh', PATH: '/usr/bin' });
});
