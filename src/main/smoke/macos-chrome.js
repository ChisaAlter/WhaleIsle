'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, nativeImage } = require('electron');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const VISIBLE_CONTROL = `(el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight
      || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return hit === el || el.contains(hit);
}`;

async function waitFor(probe, label) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await sleep(150);
  }
  throw new Error(`${label} did not settle`);
}

// BrowserWindow's macOS handle is an NSView*. Query actual AppKit buttons,
// then invoke their normal target/action. This does not test physical hit areas.
function cocoaButtons() {
  const objc = require('koffi').load('/usr/lib/libobjc.A.dylib');
  const selector = objc.func('sel_registerName', 'void *', ['str']);
  const object = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const button = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'uintptr_t']);
  const flag = objc.func('objc_msgSend', 'int8_t', ['void *', 'void *']);
  const number = objc.func('objc_msgSend', 'intptr_t', ['void *', 'void *']);
  const action = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *']);
  const names = new Map();
  const sel = name => {
    if (!names.has(name)) names.set(name, selector(name));
    return names.get(name);
  };
  const windowFor = win => object(win.getNativeWindowHandle().readBigUInt64LE(), sel('window'));
  return {
    snapshot(win) {
      const nsWindow = windowFor(win);
      assert.ok(nsWindow, 'NSView must belong to the packaged NSWindow');
      return {
        windowNumber: Number(number(nsWindow, sel('windowNumber'))),
        position: win.getWindowButtonPosition(),
        buttons: ['close', 'minimize', 'zoom'].map((name, type) => {
          const native = button(nsWindow, sel('standardWindowButton:'), type);
          return {
            name,
            present: Boolean(native),
            hidden: native ? Boolean(flag(native, sel('isHiddenOrHasHiddenAncestor'))) : true,
            enabled: native ? Boolean(flag(native, sel('isEnabled'))) : false,
          };
        }),
      };
    },
    click(win, type) {
      const native = button(windowFor(win), sel('standardWindowButton:'), type);
      assert.ok(native, `native window button ${type} must exist`);
      assert.ok(flag(native, sel('isEnabled')), `native window button ${type} must be enabled`);
      action(native, sel('performClick:'), null);
    },
  };
}

function captureWindow(win, native, dir, name) {
  const file = path.join(dir, `${name}.png`);
  const snapshot = native.snapshot(win);
  execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', String(snapshot.windowNumber), file], { timeout: 10_000 });
  const image = nativeImage.createFromPath(file);
  assert.equal(image.isEmpty(), false, `${name}: OS capture must be readable`);
  const size = image.getSize();
  const pixels = image.toBitmap();
  const colors = new Set();
  let lit = 0;
  let sampled = 0;
  for (let offset = 0; offset + 3 < pixels.length; offset += 64) {
    sampled += 1;
    if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 16) lit += 1;
    if (colors.size < 32) colors.add(pixels.subarray(offset, offset + 3).toString('hex'));
  }
  assert.ok(size.width > 200 && size.height > 200 && lit / sampled > 0.02 && colors.size > 12,
    `${name}: OS screenshot is empty, black, or a flat surface`);
  return { file: path.basename(file), size, native: snapshot };
}

async function mainLayout(wc) {
  return wc.executeJavaScript(`(() => {
    const visibleControl = ${VISIBLE_CONTROL};
    const frame = document.querySelector('[data-sidebar-collapsed]') || document.querySelector('[class*="frame"]');
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const fullscreen = document.documentElement.hasAttribute('data-fullscreen');
    const leading = document.querySelector('[data-shell-leading-band]');
    const reopen = leading && Array.from(leading.querySelectorAll('button')).find(el =>
      /open sidebar|打开侧边栏/i.test(el.getAttribute('aria-label') || ''));
    const overlap = fullscreen ? [] : Array.from(document.querySelectorAll('button, input, a[href]')).filter(el => {
      const r = el.getBoundingClientRect();
      return visibleControl(el) && r.y < 40 && r.bottom > 8 && r.x < 80 && r.right > 8;
    }).map(el => ({ label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 50), rect: rect(el) }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      platform: document.documentElement.dataset.platform,
      fullscreen,
      collapsed: frame?.hasAttribute('data-sidebar-collapsed') || false,
      leading: leading ? rect(leading) : null,
      reopen: reopen ? { rect: rect(reopen), visibleAndHit: visibleControl(reopen) } : null,
      overlap,
      customButtons: document.querySelectorAll('#dshd-shell-controls [data-act]').length,
      bodyRadius: getComputedStyle(document.body).borderTopLeftRadius,
      ringDisplay: getComputedStyle(document.getElementById('dshd-frame-ring')).display,
    };
  })()`);
}

async function setSidebar(wc, collapsed) {
  if ((await mainLayout(wc)).collapsed === collapsed) return;
  const clicked = await wc.executeJavaScript(`(() => {
    const visibleControl = ${VISIBLE_CONTROL};
    const scope = ${collapsed} ? document : document.querySelector('[data-shell-leading-band]');
    const button = scope && Array.from(scope.querySelectorAll('button')).find(el => {
      const r = el.getBoundingClientRect();
      return visibleControl(el) && r.y < 60 && /open sidebar|collapse sidebar|打开侧边栏|收起侧边栏/i.test(el.getAttribute('aria-label') || '');
    });
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  assert.ok(clicked, 'the sidebar toggle must be visible, inside the viewport, and hit at its center');
  wc.sendInputEvent({ type: 'mouseMove', ...clicked });
  wc.sendInputEvent({ type: 'mouseDown', ...clicked, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', ...clicked, button: 'left', clickCount: 1 });
  await waitFor(async () => (await mainLayout(wc)).collapsed === collapsed, 'sidebar toggle');
  await sleep(300);
}

async function runMacosChromeQa(win, wc, helpers) {
  const dir = process.env.DSH_MACOS_CHROME_EVIDENCE_DIR || path.join(app.getPath('userData'), 'macos-chrome');
  fs.mkdirSync(dir, { recursive: true });
  const result = { ok: false, nativeAction: 'NSButton performClick:, not physical mouse hit testing', visualReview: 'pending', steps: [], screenshots: [] };
  const originalBounds = win.getBounds();
  const originalConfig = helpers.loadConfig();
  let launcher;
  const record = async (name, work) => {
    const detail = await work();
    result.steps.push({ name, ok: true, detail });
    return detail;
  };
  try {
    const native = cocoaButtons();
    win.show();
    win.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
    await sleep(250);
    await record('main.1440.workspace-baseline', async () => {
      win.setSize(1440, 780);
      await waitFor(async () => Math.abs((await mainLayout(wc)).viewport.width - 1440) < 2, 'baseline main width');
      await setSidebar(wc, false);
      result.screenshots.push(captureWindow(win, native, dir, 'main-1440-baseline'));
      return 'original workspace view before the long-caption Session';
    });
    await record('main.persisted-long-title', async () => {
      const { rpc } = require('../workspace-rpc');
      const title = '验证 macOS 原生窗口按钮、标题栏留白与侧栏折叠后的完整长会话标题 / Reviewing native window controls, narrow layouts and sidebar reopening';
      const auth = { cookie: helpers.dsh.sessionCookie };
      // The built-in assistant's product entry opens a real persistent Session
      // without a prompt. Use its existing window reference: blank/owned
      // Sessions are intentionally absent from the ordinary sidebar.
      await waitFor(() => wc.executeJavaScript(`typeof window.__dshWhaleOpen === 'function'`), 'built-in Session navigation');
      const sessionId = await wc.executeJavaScript('window.__dshWhaleOpen()');
      assert.equal(typeof sessionId, 'string', 'the product entry must open a real Session');
      await rpc(helpers.dsh.baseUrl, 'session/rename', { request: { sessionId, title } }, fetch, auth);
      await rpc(helpers.dsh.baseUrl, 'session/setPresentation', { request: {
        sessionId, presentation: { owner: 'mac-caption-qa', title },
      } }, fetch, auth);
      await waitFor(() => wc.executeJavaScript(`Boolean(document.querySelector('[data-dshd-caption="title"]')?.textContent.includes(${JSON.stringify(title)}))`), 'persisted long caption');
      return { sessionId, title, entry: 'window.__dshWhaleOpen', presentationOwner: 'mac-caption-qa', modelCalls: 0 };
    });
    await record('main.native-buttons', async () => {
      const snapshot = native.snapshot(win);
      assert.deepEqual(snapshot.position, { x: 16, y: 18 });
      assert.ok(snapshot.buttons.every(item => item.present && !item.hidden && item.enabled));
      return snapshot;
    });
    await record('boot.native-buttons-layout', async () => {
      const { getHarnessView, setBootHarnessCovered } = require('../window');
      const view = getHarnessView();
      assert.ok(view && view.webContents === wc && win.getBrowserViews().includes(view));
      const bounds = view.getBounds();
      try {
        win.removeBrowserView(view);
        setBootHarnessCovered(win, false);
        await waitFor(() => win.webContents.executeJavaScript(`Boolean(document.body && !document.body.hasAttribute('data-harness-covered') && getComputedStyle(document.body).visibility === 'visible')`), 'real boot visibility');
        await sleep(250);
        result.screenshots.push(captureWindow(win, native, dir, 'boot'));
        return 'existing boot document uncovered; live Harness view retained';
      } finally {
        win.addBrowserView(view);
        view.setBounds(bounds);
        setBootHarnessCovered(win, true);
        await waitFor(() => win.webContents.executeJavaScript(`Boolean(document.body?.hasAttribute('data-harness-covered'))`), 'Harness coverage restored');
      }
    });
    for (const { width, collapsed } of [
      { width: 1440, collapsed: false },
      { width: 960, collapsed: false },
      { width: 960, collapsed: true },
    ]) {
      win.setSize(width, 780);
      win.center();
      await waitFor(async () => Math.abs((await mainLayout(wc)).viewport.width - width) < 2, `main width ${width}`);
      await setSidebar(wc, collapsed);
      await record(`main.${width}.${collapsed ? 'collapsed' : 'expanded'}`, async () => {
        const layout = await mainLayout(wc);
        assert.equal(layout.platform, 'darwin');
        assert.equal(layout.customButtons, 0);
        assert.deepEqual(layout.overlap, [], 'HTML controls must clear native traffic lights');
        if (collapsed) {
          assert.ok(layout.leading && layout.leading.x >= 80, 'collapsed sidebar controls must clear traffic lights');
          assert.ok(layout.reopen?.visibleAndHit && layout.reopen.rect.x >= 80, 'the leading seat must contain a visible and hittable reopen button');
        }
        result.screenshots.push(captureWindow(win, native, dir, `main-${width}-${collapsed ? 'collapsed' : 'expanded'}`));
        return layout;
      });
    }
    await record('main.collapsed-seat-reopens-sidebar', async () => {
      await setSidebar(wc, false);
      assert.equal((await mainLayout(wc)).collapsed, false);
      await setSidebar(wc, true);
      return 'visible leading-seat button coordinate input reopened the sidebar; sidebar collapsed again for fullscreen';
    });
    await record('main.native-minimize-restore', async () => {
      native.click(win, 1);
      await waitFor(() => win.isMinimized(), 'native minimize');
      win.restore();
      win.show();
      win.focus();
      await waitFor(() => !win.isMinimized() && win.isVisible(), 'restore');
      assert.ok(native.snapshot(win).buttons.every(item => !item.hidden));
      return 'native yellow target/action minimized; Electron restore reopened the window';
    });
    await record('main.native-fullscreen-enter-exit', async () => {
      native.click(win, 2);
      await waitFor(async () => win.isFullScreen() && (await mainLayout(wc)).fullscreen, 'native fullscreen entry and preload');
      await sleep(500);
      const layout = await mainLayout(wc);
      assert.equal(layout.bodyRadius, '0px');
      assert.equal(layout.ringDisplay, 'none');
      assert.ok(native.snapshot(win).buttons.every(item => item.hidden), 'native buttons must hide in fullscreen');
      result.screenshots.push(captureWindow(win, native, dir, 'main-fullscreen'));
      win.setFullScreen(false);
      await waitFor(async () => !win.isFullScreen() && !(await mainLayout(wc)).fullscreen, 'fullscreen exit and preload');
      await sleep(500);
      assert.ok(native.snapshot(win).buttons.every(item => !item.hidden), 'native buttons must return after fullscreen');
      return { layout, entry: 'native green NSButton performClick:', exit: 'Electron win.setFullScreen(false); native and preload state synchronized' };
    });
    await record('main.native-close-to-tray', async () => {
      helpers.saveConfig({ closeToTray: true });
      native.click(win, 0);
      await waitFor(() => !win.isVisible(), 'native close-to-tray');
      assert.equal(win.isDestroyed(), false);
      win.show();
      win.focus();
      return 'native red target/action hid the live main window';
    });
    await record('launcher.860.native-buttons-layout-close', async () => {
      await wc.executeJavaScript('window.shell.openLauncher()');
      launcher = require('../window').getLauncherWindow();
      assert.ok(launcher && !launcher.isDestroyed(), 'product launcher must open');
      launcher.setSize(860, 660);
      launcher.center();
      launcher.show();
      launcher.focus();
      await sleep(400);
      const snapshot = native.snapshot(launcher);
      assert.deepEqual(snapshot.position, { x: 16, y: 9 });
      assert.ok(snapshot.buttons.every(item => item.present && !item.hidden && item.enabled));
      const layout = await launcher.webContents.executeJavaScript(`(() => ({
        width: innerWidth,
        platform: document.documentElement.dataset.platform,
        customButtons: document.querySelectorAll('.window-controls [data-act]').length,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      }))()`);
      assert.equal(layout.platform, 'darwin');
      assert.equal(layout.customButtons, 0);
      assert.equal(layout.horizontalOverflow, false);
      result.screenshots.push(captureWindow(launcher, native, dir, 'launcher-860'));
      native.click(launcher, 0);
      await waitFor(() => launcher.isDestroyed(), 'native launcher close');
      assert.equal(win.isDestroyed(), false, 'closing the launcher must preserve the main window');
      return { native: snapshot, layout };
    });
    result.ok = true;
  } catch (error) {
    result.error = String(error);
    result.steps.push({ name: 'macos-chrome-failed', ok: false, detail: String(error) });
  } finally {
    helpers.saveConfig({ closeToTray: originalConfig.closeToTray });
    if (launcher && !launcher.isDestroyed()) launcher.destroy();
    if (!win.isDestroyed()) {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMinimized()) win.restore();
      win.setBounds(originalBounds);
      win.show();
    }
    fs.writeFileSync(path.join(dir, 'macos-chrome.json'), JSON.stringify(result, null, 2));
  }
  return result;
}

module.exports = { runMacosChromeQa };
