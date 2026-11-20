'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatBadgeText,
  encodeRgbaPng,
  premultipliedBgraToStraightRgba,
  renderOverlayBadgePng,
  composeTrayBadgePng,
  createBadgePresenter,
} = require('./badge');

function parsePngDimensions(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
  };
}

test('formatBadgeText clamps counts to empty, 1..99, and 99+', () => {
  assert.equal(formatBadgeText(0), '');
  assert.equal(formatBadgeText(-3), '');
  assert.equal(formatBadgeText(1), '1');
  assert.equal(formatBadgeText(99), '99');
  assert.equal(formatBadgeText(100), '99+');
  assert.equal(formatBadgeText(250), '99+');
});

test('renderOverlayBadgePng outputs valid 16x16 and 32x32 RGBA PNGs across count ranges', () => {
  for (const size of [16, 32]) {
    for (const count of [1, 12, 120]) {
      const png = renderOverlayBadgePng(count, size);
      const header = parsePngDimensions(png);
      assert.deepEqual(header, { width: size, height: size, colorType: 6 });
    }
  }
});

test('premultipliedBgraToStraightRgba unpremultiplies and swaps channels accurately', () => {
  // Straight RGBA (200, 100, 50, 128) premultiplied -> BGRA (25, 50, 100, 128)
  const bgra = Buffer.from([25, 50, 100, 128, 0, 0, 0, 0]);
  const rgba = premultipliedBgraToStraightRgba(bgra, 2, 1);
  assert.equal(rgba[0], 199);
  assert.equal(rgba[1], 100);
  assert.equal(rgba[2], 50);
  assert.equal(rgba[3], 128);
  assert.deepEqual([...rgba.subarray(4, 8)], [0, 0, 0, 0]);
});

test('composeTrayBadgePng composites onto 24x24 base bitmap without mutating input', () => {
  const bgra = Buffer.alloc(24 * 24 * 4, 0);
  for (let i = 0; i < bgra.length; i += 4) {
    bgra[i] = 200;
    bgra[i + 1] = 100;
    bgra[i + 2] = 50;
    bgra[i + 3] = 255;
  }
  const snapshot = Buffer.from(bgra);
  const png = composeTrayBadgePng({ width: 24, height: 24, bgra }, 5);
  assert.deepEqual(parsePngDimensions(png), { width: 24, height: 24, colorType: 6 });
  assert.deepEqual(bgra, snapshot, 'base tray bitmap buffer is not mutated');

  const rawPng = encodeRgbaPng(new Uint8Array(4 * 4 * 4), 4, 4);
  assert.deepEqual(parsePngDimensions(rawPng), { width: 4, height: 4, colorType: 6 });
});

test('createBadgePresenter updates Windows overlay + tray with caching and clears cleanly on zero', () => {
  const overlayCalls = [];
  const trayCalls = [];
  const representations = [];
  const fakeWin = {
    isDestroyed: () => false,
    setOverlayIcon: (img, desc) => overlayCalls.push({ img, desc }),
  };
  const baseBgra = Buffer.alloc(24 * 24 * 4, 255);
  let createBufferCount = 0;
  const fakeNativeImage = {
    createEmpty: () => ({
      addRepresentation: (rep) => representations.push(rep),
    }),
    createFromBuffer: (buf, opts) => {
      createBufferCount += 1;
      return { buf, opts };
    },
  };

  const presenter = createBadgePresenter({
    platform: 'win32',
    nativeImage: fakeNativeImage,
    getMainWindow: () => fakeWin,
    getBaseTrayIcon: () => ({ width: 24, height: 24, bgra: baseBgra }),
    setTrayBadge: (indicator) => trayCalls.push(indicator),
    getLocale: () => 'zh',
  });

  presenter.applyCount(3);
  assert.equal(overlayCalls.length, 1);
  assert.equal(overlayCalls[0].desc, '3 项待审批');
  assert.equal(representations.length, 2, 'overlay registers both 1x and 2x representations');
  assert.equal(trayCalls[0]?.tooltip, 'Whale Isle（3 项待审批）');
  assert.ok(trayCalls[0]?.image);

  presenter.applyCount(3);
  assert.equal(createBufferCount, 1, 'identical count reuses cached tray NativeImage');

  const recreatedWin = {
    isDestroyed: () => false,
    setOverlayIcon: (img, desc) => overlayCalls.push({ img, desc, recreated: true }),
  };
  presenter.reapplyOverlay(recreatedWin);
  assert.equal(overlayCalls.at(-1).recreated, true);
  assert.equal(overlayCalls.at(-1).desc, '3 项待审批');

  presenter.clear();
  assert.equal(overlayCalls.at(-1).img, null);
  assert.equal(overlayCalls.at(-1).desc, '');
  assert.equal(trayCalls.at(-1), null);
});

test('createBadgePresenter updates macOS Dock badge and tray tooltip', () => {
  const dockBadges = [];
  const badgeCounts = [];
  const trayCalls = [];
  const presenter = createBadgePresenter({
    platform: 'darwin',
    app: {
      dock: { setBadge: (text) => dockBadges.push(text) },
      setBadgeCount: (n) => badgeCounts.push(n),
    },
    setTrayBadge: (indicator) => trayCalls.push(indicator),
    getLocale: () => 'en',
  });

  presenter.applyCount(1);
  assert.deepEqual(dockBadges, ['1']);
  assert.deepEqual(badgeCounts, [1]);
  assert.deepEqual(trayCalls[0], { tooltip: 'Whale Isle (1 pending approval)' });

  presenter.applyCount(120);
  assert.deepEqual(dockBadges, ['1', '99+']);

  presenter.clear();
  assert.equal(dockBadges.at(-1), '');
  assert.equal(badgeCounts.at(-1), 0);
  assert.equal(trayCalls.at(-1), null);
});
