'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildMarketplaceScript } = require('./marketplace-jump');

function marketPage({ open = false, mounted = true, trigger = true } = {}) {
  const clicks = [];
  let dialogOpen = open;
  let marketMounted = mounted;
  let mutation;
  let observed = false;
  let disconnected = false;
  const context = {
    document: {
      body: {},
      querySelector(selector) {
        if (selector === '[data-dsh-settings-trigger]' && trigger) {
          return {
            getAttribute: () => String(dialogOpen),
            click() { dialogOpen = true; clicks.push('settings'); },
          };
        }
        if (selector === '[data-dsh-settings-section="market"]' && dialogOpen && marketMounted) {
          return { click: () => clicks.push('market') };
        }
        return null;
      },
    },
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe() { observed = true; }
      disconnect() { disconnected = true; }
    },
    setTimeout,
    clearTimeout,
  };
  return {
    clicks,
    run: () => vm.runInNewContext(buildMarketplaceScript(), context),
    mountMarket() { marketMounted = true; mutation?.(); },
    get observed() { return observed; },
    get disconnected() { return disconnected; },
  };
}

test('marketplace opens Settings and selects its market section', () => {
  const page = marketPage();
  assert.equal(page.run(), true);
  assert.deepEqual(page.clicks, ['settings', 'market']);
});

test('marketplace switches an already open Settings dialog without closing it', () => {
  const page = marketPage({ open: true });
  assert.equal(page.run(), true);
  assert.deepEqual(page.clicks, ['market']);
});

test('marketplace waits for Settings navigation to mount', async () => {
  const page = marketPage({ mounted: false });
  const pending = page.run();
  assert.equal(page.observed, true);
  page.mountMarket();
  assert.equal(await pending, true);
  assert.equal(page.disconnected, true);
  assert.deepEqual(page.clicks, ['settings', 'market']);
});

test('marketplace reports a missing Settings launcher', () => {
  const page = marketPage({ trigger: false });
  assert.equal(page.run(), false);
  assert.deepEqual(page.clicks, []);
});
