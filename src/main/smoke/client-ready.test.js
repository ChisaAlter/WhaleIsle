'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waitForHarnessContents } = require('./client-ready');

test('smoke waits for the actual Harness view instead of inspecting the boot document', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const owner = { webContents: { boot: true } };
  const harness = { isDestroyed: () => false };
  let ready = false;
  const pending = waitForHarnessContents(win => {
    assert.strictEqual(win, owner);
    return ready ? harness : null;
  }, owner, 1000);
  t.mock.timers.tick(200);
  await Promise.resolve();
  ready = true;
  t.mock.timers.tick(200);
  assert.strictEqual(await pending, harness);
});

test('a missing or destroyed Harness view fails instead of falling back to boot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const pending = waitForHarnessContents(() => ({ isDestroyed: () => true }), { webContents: {} }, 1000);
  const rejected = assert.rejects(pending, /Harness WebContents was not created/);
  t.mock.timers.tick(1000);
  await rejected;
});

test('smoke rejects upstream welcome instead of automatically skipping it', async () => {
  for (const ready of [false, true]) {
    const harness = { isDestroyed: () => false };
    await assert.rejects(waitForHarnessContents(
      () => ready ? harness : null, {}, 1000,
      () => ({ isDestroyed: () => false, executeJavaScript: () => assert.fail('must not click skip') }),
    ), /Unexpected welcome window/);
  }
});

test('a destroyed welcome window does not block direct entry', async () => {
  const harness = { isDestroyed: () => false };
  assert.equal(await waitForHarnessContents(() => harness, {}, 1000,
    () => ({ isDestroyed: () => true })), harness);
});

test('a recorded desktop startup failure is reported immediately instead of waiting for a view', async () => {
  await assert.rejects(waitForHarnessContents(
    () => assert.fail('must not wait on a rejected desktop start'), {}, 300_000,
    () => null, () => '安装包缺少 Office 运行时',
  ), /Desktop startup failed: 安装包缺少 Office 运行时/);
});
