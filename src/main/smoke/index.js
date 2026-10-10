'use strict';

/**
 * QA / smoke orchestration, extracted from src/main/index.js so the
 * production entry keeps only the qa-gate check and a lazy require of this
 * module. Nothing here runs unless `qaEnv('DSH_SMOKE')` passed the packaged
 * gate (see qa-gate.js); the QA driver modules themselves stay lazy inside
 * the paths that need them.
 *
 * The drivers remain in the packaged app on purpose: the qa:packaged /
 * smoke:packaged rehearsals run them inside the installed build behind
 * `DSHD_ALLOW_PACKAGED_QA=1`; excluding them from `build.files` would break
 * that gate.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { tryGetDesktopDshHome } = require('../../shared/dsh-home');
const { titlebarMenuLooksOpen } = require('./titlebar-menu');
const { waitForHarnessContents } = require('./client-ready');
const { getLive2dPet } = require('../desktop-live2d');

const SMOKE_SURFACES = 'right panel|surfaces|\u53f3\u4fa7\u680f';
const SMOKE_BRANCH = 'switch branch|\u5207\u6362\u5206\u652f';
const SMOKE_GIT = 'git actions|git \u64cd\u4f5c';
const SMOKE_TERMINAL = 'terminal|\u7ec8\u7aef';
// 0.1.2-alpha.2 concession: sidebar 280 + surfaces min 360 + center min 640.
const SMOKE_SURFACES_MIN_VIEWPORT = 1280;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) {
      return value;
    }
    await sleep(200);
  }
  return null;
}

async function clickClientCenter(wc, x, y) {
  const point = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
  await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
  await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
}

async function titlebarButtonRect(wc, pattern) {
  return wc.executeJavaScript(`(() => {
    const match = new RegExp(${JSON.stringify(pattern)}, 'i');
    const titlebar = document.querySelector('#dshd-shell-titlebar-trailing');
    if (!titlebar) return null;
    const buttons = Array.from(titlebar.querySelectorAll('button'));
    const button = buttons.find((el) =>
      match.test((el.getAttribute('aria-label') || el.textContent || '').trim()))
      || (match.test('right panel')
        ? titlebar.querySelector('[data-panel-layout-controls] button:nth-of-type(2)')
        : null);
    if (!button) return null;
    const box = button.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
}

async function titlebarMenuSnapshot(wc, pattern) {
  return wc.executeJavaScript(`(() => {
    const match = new RegExp(${JSON.stringify(pattern)}, 'i');
    const titlebar = document.querySelector('#dshd-shell-titlebar-trailing');
    const button = titlebar && Array.from(titlebar.querySelectorAll('button')).find((el) =>
      match.test((el.getAttribute('aria-label') || el.textContent || '').trim()));
    const menus = Array.from(document.querySelectorAll('[role="menu"], [data-dsh-motion="popover"][data-state="open"]'));
    return {
      found: Boolean(button),
      disabled: Boolean(button && button.disabled),
      expanded: button ? button.getAttribute('aria-expanded') : null,
      menuCount: menus.length,
      hasOpenPopover: Boolean(document.querySelector('[data-dsh-motion="popover"][data-state="open"]')),
    };
  })()`);
}

async function titlebarMenuOpen(wc, pattern) {
  return titlebarMenuLooksOpen(await titlebarMenuSnapshot(wc, pattern));
}

/**
 * Open a titlebar Menu with a single JS click.
 * CDP mousePressed is document pointerdown: if the first click already opened
 * the menu, a second click toggles it closed (CI: "branch menu did not open").
 */
async function openTitlebarMenu(wc, pattern, timeoutMs = 20_000) {
  const ready = await waitUntil(async () => {
    const snap = await titlebarMenuSnapshot(wc, pattern);
    return Boolean(snap && snap.found && !snap.disabled);
  }, timeoutMs);
  if (!ready) {
    return { ok: false, snapshot: await titlebarMenuSnapshot(wc, pattern).catch(() => null) };
  }
  if (await titlebarMenuOpen(wc, pattern)) {
    return { ok: true, snapshot: await titlebarMenuSnapshot(wc, pattern) };
  }
  if (!await clickTitlebarButton(wc, pattern)) {
    return { ok: false, snapshot: await titlebarMenuSnapshot(wc, pattern).catch(() => null) };
  }
  const opened = await waitUntil(() => titlebarMenuOpen(wc, pattern), 5_000);
  return {
    ok: Boolean(opened),
    snapshot: await titlebarMenuSnapshot(wc, pattern).catch(() => null),
  };
}

async function clickTitlebarButton(wc, pattern) {
  return wc.executeJavaScript(`(() => {
    const match = new RegExp(${JSON.stringify(pattern)}, 'i');
    const titlebar = document.querySelector('#dshd-shell-titlebar-trailing');
    if (!titlebar) return false;
    const buttons = Array.from(titlebar.querySelectorAll('button'));
    const button = buttons.find((el) =>
      match.test((el.getAttribute('aria-label') || el.textContent || '').trim()))
      || (match.test('right panel')
        ? titlebar.querySelector('[data-panel-layout-controls] button:nth-of-type(2)')
        : null);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function pressEscape(wc) {
  const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

function layoutSmokeHarnessViews(win) {
  if (!win || win.isDestroyed()) {
    return { width: 0, height: 0 };
  }
  win.setSize(1680, 1000);
  win.center();
  const bounds = win.getContentBounds();
  const width = Math.max(bounds.width || 0, 1680);
  const height = Math.max(bounds.height || 0, 1000);
  for (const view of win.getBrowserViews()) {
    try {
      view.setBounds({ x: 0, y: 0, width, height });
      view.setAutoResize({ width: true, height: true });
    } catch {
      // View may already be gone.
    }
  }
  return { width, height };
}

const SMOKE_FRAME_WIDTH_JS = `(() => {
  const caption = document.querySelector('[data-dshd-caption="band"]');
  const frame = caption && caption.parentElement;
  const frameW = frame ? Math.round(frame.getBoundingClientRect().width) : 0;
  const rightbar = document.querySelector('[data-rightbar-col]');
  return {
    inner: window.innerWidth,
    frameW,
    collapsed: frame ? frame.hasAttribute('data-rightbar-collapsed') : null,
    surfacesCollapsed: frame ? frame.hasAttribute('data-surfaces-collapsed') : null,
    rightbarWidth: rightbar ? Math.round(rightbar.getBoundingClientRect().width) : 0,
  };
})()`;

/** Packaged smoke often lands at ~1024px, where the pin auto-closes surfaces. */
async function ensureSurfacesViewport(win, wc) {
  layoutSmokeHarnessViews(win);
  let wide = await waitUntil(async () => {
    const sample = await wc.executeJavaScript(SMOKE_FRAME_WIDTH_JS);
    return sample && sample.inner >= SMOKE_SURFACES_MIN_VIEWPORT && sample.frameW >= SMOKE_SURFACES_MIN_VIEWPORT;
  }, 3_000);
  if (!wide && win && !win.isDestroyed()) {
    win.maximize();
    layoutSmokeHarnessViews(win);
    wide = await waitUntil(async () => {
      const sample = await wc.executeJavaScript(SMOKE_FRAME_WIDTH_JS);
      return sample && sample.inner >= SMOKE_SURFACES_MIN_VIEWPORT && sample.frameW >= SMOKE_SURFACES_MIN_VIEWPORT;
    }, 3_000);
  }
  if (wide) {
    await wc.executeJavaScript('window.dispatchEvent(new Event(\'resize\'))').catch(() => {});
    await sleep(400);
    return;
  }
  const sample = await wc.executeJavaScript(SMOKE_FRAME_WIDTH_JS).catch(() => ({}));
  throw new Error(
    `surfaces viewport inner=${sample.inner} frame=${sample.frameW} < ${SMOKE_SURFACES_MIN_VIEWPORT} (sidebar+surfaces+center min)`,
  );
}

/** First-run setup must not intercept desktop entry; never click it away. */
async function firstRunWorkspaceIsClear(wc) {
  return waitUntil(() => wc.executeJavaScript(`(() => {
    const root = document.getElementById('root');
    return Boolean(root && !root.inert) && !document.querySelector('[role="dialog"]');
  })()`), 5_000);
}

/** Real-coordinate clicks after surfaces opens. Zero hits fail the smoke. */
async function probeTitlebarHits(wc) {
  const hits = { surfaces: 0, branch: 0, git: 0 };
  const wasAttached = wc.debugger.isAttached();
  if (!wasAttached) {
    await wc.debugger.attach('1.3');
  }
  try {
    if (!await firstRunWorkspaceIsClear(wc)) {
      return { hits, error: 'onboarding still open' };
    }
    const surfaces = await waitUntil(() => titlebarButtonRect(wc, SMOKE_SURFACES), 5_000);
    if (surfaces) {
      await clickClientCenter(wc, surfaces.x, surfaces.y);
    } else if (!await clickTitlebarButton(wc, SMOKE_SURFACES)) {
      return { hits, error: 'surfaces toggle missing' };
    }
    hits.surfaces += 1;
    // The single visible right panel is the native rightbar; the retired
    // surfaces track must stay dormant at zero width either way.
    const surfacesOpenJs = `(() => {
      const caption = document.querySelector('[data-dshd-caption="band"]');
      const frame = caption && caption.parentElement;
      const rightbar = document.querySelector('[data-rightbar-col]');
      if (!frame || !rightbar) return false;
      if (frame.hasAttribute('data-surfaces-collapsed') === false) return false;
      return !frame.hasAttribute('data-rightbar-collapsed') && rightbar.getBoundingClientRect().width > 0;
    })()`;
    let opened = await waitUntil(() => wc.executeJavaScript(surfacesOpenJs), 10_000);
    if (!opened && surfaces && await clickTitlebarButton(wc, SMOKE_SURFACES)) {
      opened = await waitUntil(() => wc.executeJavaScript(surfacesOpenJs), 10_000);
    }
    if (!opened) {
      const sample = await wc.executeJavaScript(SMOKE_FRAME_WIDTH_JS).catch(() => ({}));
      return {
        hits,
        error: `rightbar did not open inner=${sample.inner} frame=${sample.frameW} collapsed=${sample.collapsed} surfacesCollapsed=${sample.surfacesCollapsed} rightbarWidth=${sample.rightbarWidth}`,
      };
    }

    const branchOpen = await openTitlebarMenu(wc, SMOKE_BRANCH);
    if (branchOpen.ok || branchOpen.snapshot?.found) {
      hits.branch += 1;
    }
    if (!branchOpen.ok) {
      return {
        hits,
        error: `branch menu did not open ${JSON.stringify(branchOpen.snapshot)}`,
      };
    }
    await pressEscape(wc);
    await waitUntil(async () => !(await titlebarMenuOpen(wc, SMOKE_BRANCH)), 3_000);
    await sleep(200);

    const gitOpen = await openTitlebarMenu(wc, SMOKE_GIT, 10_000);
    if (gitOpen.ok || gitOpen.snapshot?.found) {
      hits.git += 1;
    }
    if (!gitOpen.ok) {
      return {
        hits,
        error: `git menu did not open ${JSON.stringify(gitOpen.snapshot)}`,
      };
    }
    return { hits, error: null };
  } finally {
    if (!wasAttached && wc.debugger.isAttached()) {
      try {
        wc.debugger.detach();
      } catch {
        // Detach is best-effort before process exit.
      }
    }
  }
}

/** Open both terminal owners and report the colors that actually reach the DOM and canvas. */
async function probeThemeBackgrounds(wc) {
  const wasAttached = wc.debugger.isAttached();
  if (!wasAttached) {
    await wc.debugger.attach('1.3');
  }
  try {
    await pressEscape(wc);
    await waitUntil(() => wc.executeJavaScript(`(() => !document.querySelector('[role="menu"]'))()`), 3_000);
    if (!await firstRunWorkspaceIsClear(wc)) return { ok: false, error: 'onboarding still open' };
    await wc.executeJavaScript(`(() => {
      window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind: 'terminal' } }));
      return true;
    })()`);
    const surface = await waitUntil(() => wc.executeJavaScript(`(() => {
      const root = document.querySelector('[data-terminal-owner="surface"]');
      return root && root.getBoundingClientRect().height > 0;
    })()`), 10_000);
    if (!surface) return { ok: false, error: 'surface terminal did not open' };

    const terminalToggle = await waitUntil(() => titlebarButtonRect(wc, SMOKE_TERMINAL), 5_000);
    if (terminalToggle) {
      await clickClientCenter(wc, terminalToggle.x, terminalToggle.y);
    } else if (!await clickTitlebarButton(wc, SMOKE_TERMINAL)) {
      return { ok: false, error: 'terminal drawer toggle missing' };
    }
    const drawer = await waitUntil(() => wc.executeJavaScript(`(() => {
      const root = document.querySelector('[data-terminal-owner="drawer"]');
      return root && root.getBoundingClientRect().height > 0;
    })()`), 10_000);
    if (!drawer) return { ok: false, error: 'terminal drawer did not open' };

    await wc.executeJavaScript(`(() => {
      for (const owner of ['surface', 'drawer']) {
        const root = document.querySelector('[data-terminal-owner="' + owner + '"]');
        const button = root && Array.from(root.querySelectorAll('button')).find((el) =>
          /new terminal|\u65b0\u5efa\u7ec8\u7aef/i.test(el.getAttribute('aria-label') || el.textContent || ''));
        if (button && !button.disabled) button.click();
      }
      return true;
    })()`);
    const panesOpened = await waitUntil(() => wc.executeJavaScript(`(() => Boolean(
      document.querySelector('[data-terminal-owner="surface"] [data-terminal-pane]')
      && document.querySelector('[data-terminal-owner="drawer"] [data-terminal-pane]')
    ))()`), 15_000);
    if (!panesOpened) {
      return wc.executeJavaScript(`(() => {
        const read = (owner) => {
          const root = document.querySelector('[data-terminal-owner="' + owner + '"]');
          return {
            height: root?.getBoundingClientRect().height || 0,
            buttons: root ? Array.from(root.querySelectorAll('button')).map((el) => ({
              label: el.getAttribute('aria-label') || el.textContent || '',
              disabled: el.disabled,
            })) : [],
          };
        };
        return { ok: false, error: 'terminal panes did not open', debug: {
          surface: read('surface'),
          drawer: read('drawer'),
          cwd: document.querySelector('[data-terminal-owner="drawer"]')?.textContent || '',
        } };
      })()`);
    }

    return wc.executeJavaScript(`(() => {
      const stylesFor = (element) => {
        if (!element) return null;
        const styles = getComputedStyle(element);
        return {
          backgroundColor: styles.backgroundColor,
          backgroundImage: styles.backgroundImage,
          color: styles.color,
        };
      };
      const canvasPixel = (element) => {
        const canvas = element?.querySelector('canvas');
        if (!canvas || canvas.width < 1 || canvas.height < 1) return null;
        try {
          return Array.from(canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data || []);
        } catch {
          return null;
        }
      };
      // Ghostty renders straight into a canvas inside [data-terminal-pane];
      // there is no xterm DOM to probe.
      const readOwner = (owner) => {
        const root = document.querySelector('[data-terminal-owner="' + owner + '"]');
        const pane = root?.querySelector('[data-terminal-pane]');
        return {
          root: stylesFor(root),
          pane: stylesFor(pane),
          canvasPixel: canvasPixel(pane),
        };
      };
      const tokenStyles = getComputedStyle(document.body);
      const rootTokenStyles = getComputedStyle(document.documentElement);
      const frame = document.querySelector('[class*="frame"]');
      const frameTokenStyles = frame ? getComputedStyle(frame) : null;
      const tokenValue = (name) => tokenStyles.getPropertyValue(name).trim()
        || rootTokenStyles.getPropertyValue(name).trim()
        || frameTokenStyles?.getPropertyValue(name).trim()
        || '';
      const tokens = {
        base: tokenValue('--dsw-alias-bg-base'),
        layer2: tokenValue('--dsw-alias-bg-layer-2'),
      };
      const isBlack = (value) => {
        const match = String(value || '').match(/rgba?\\(\\s*0[ ,]+0[ ,]+0(?:[ ,/]+(?:0|1(?:\\.0*)?))?\\s*\\)/i);
        return Boolean(match);
      };
      const owners = { surface: readOwner('surface'), drawer: readOwner('drawer') };
      const backgrounds = [
        owners.surface?.root?.backgroundColor,
        owners.surface?.pane?.backgroundColor,
        owners.drawer?.root?.backgroundColor,
        owners.drawer?.pane?.backgroundColor,
      ];
      return {
        ok: Boolean(
          owners.surface?.root
          && owners.surface?.pane
          && owners.drawer?.root
          && owners.drawer?.pane
          && tokens.base
          && tokens.layer2
          && backgrounds.every(value => !isBlack(value)),
        ),
        tokens,
        owners,
      };
    })()`);
  } finally {
    if (!wasAttached && wc.debugger.isAttached()) {
      try {
        wc.debugger.detach();
      } catch {
        // Detach is best-effort before process exit.
      }
    }
  }
}

/**
 * Bind the smoke / QA entry points to the live main-process resources.
 * @param {object} deps
 *   qaEnv, dsh, harness, loadConfig, saveConfig, getHarnessWebContents,
 *   showMain, invokeTrayAction, probeRemoteSnapshot, setRemoteFromQa,
 *   getDesktopResources, getQuitIntercepted, resetQuitIntercepted — all
 *   supplied by src/main/index.js inside the DSH_SMOKE gate.
 */
function createSmokeRunner(deps) {
  const {
    qaEnv,
    qaRemoteMode,
    dsh,
    harness,
    loadConfig,
    saveConfig,
    getHarnessWebContents,
    getWelcomeWebContents = () => null,
    showMain,
    invokeTrayAction,
    probeRemoteSnapshot,
    setRemoteFromQa,
    getDesktopResources,
    getQuitIntercepted,
    resetQuitIntercepted,
  } = deps;

  /** Keep the desktop up with LAN remote on and print a pairing URL for phone QA. */
  async function keepRemotePhoneHost() {
    const { REMOTE_FEATURE_ENABLED } = require('../config');
    if (!REMOTE_FEATURE_ENABLED) {
      console.log('[DSH_REMOTE_PHONE_HOST]', JSON.stringify({ ok: false, reason: 'REMOTE_FEATURE_ENABLED=false' }));
      await app.exit(1);
      return;
    }
    const { pairingUrl, listLanAddresses } = require('../../shared/lan');
    const deadline = Date.now() + 120_000;
    let snap = null;
    while (Date.now() < deadline) {
      try {
        saveConfig({ remoteEnabled: true, remoteMode: 'lan' });
        snap = await probeRemoteSnapshot();
        const pairing = snap?.urls?.[0]?.url || snap?.urls?.[0]?.pairingUrl || '';
        if (snap && snap.listening === true && (/#offer=/.test(pairing) || snap.token)) {
          break;
        }
      } catch (error) {
        console.log('[DSH_REMOTE_PHONE_HOST] sync wait', String(error));
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const productPairing = snap?.urls?.[0]?.url || snap?.urls?.[0]?.pairingUrl || '';
    if (!snap || snap.listening !== true || (!/#offer=/.test(productPairing) && !snap.token)) {
      console.log('[DSH_REMOTE_PHONE_HOST]', JSON.stringify({
        ok: false,
        listening: snap?.listening,
        hasOffer: /#offer=/.test(productPairing),
      }));
      await app.exit(1);
      return;
    }
    const preferred = String(process.env.DSH_REMOTE_LAN || '').trim();
    const lan = preferred
      || listLanAddresses().find((a) => a.startsWith('192.168.'))
      || listLanAddresses()[0]
      || '127.0.0.1';
    const port = Number(snap.port) || 3180;
    const url = /#offer=/.test(productPairing)
      ? productPairing
      : pairingUrl(lan, port, snap.token, { mode: 'lan' });
    const out = path.join(app.getPath('userData'), 'pairing-url.txt');
    fs.writeFileSync(out, `${url}\n`, 'utf8');
    fs.writeFileSync(path.join(app.getPath('userData'), 'pairing-meta.json'), JSON.stringify({
      ok: true, url, lan, port, listening: true,
    }, null, 2));
    console.log(`[DSH_REMOTE_PHONE_HOST] ${JSON.stringify({ ok: true, url, file: out })}`);
    console.log(`[PAIRING_URL] ${url}`);
  }

  /** One-shot launch smoke: report the assembled chrome and exit with its status. */
  async function runSmoke(win) {
    // QA drivers are loaded lazily: they never stay resident in a production
    // main process that did not enter the smoke path.
    const { runReleaseUiWalk, connectConfiguredWorkspace, makeRecorder } = require('../release-ui-walk');
    const { runComposerOfficialQa } = require('../composer-official-qa');
    const { runRemoteGateQa } = require('../remote-gate-qa');
    const { runAppendixAQa } = require('../appendix-a-qa');
    const { runShellP0Qa, runPersistQa, runRecoveryQa } = require('../shell-p0-qa');
    const desktopResources = getDesktopResources();
    const pageErrors = [];
    const exitSmoke = async (code) => {
      await Promise.allSettled([
        Promise.resolve(desktopResources?.pty?.killAll()),
        Promise.resolve(desktopResources?.preview?.closeAll()),
      ]);
      await Promise.resolve(harness.shutdown()).catch(() => {});
      await getLive2dPet()?.dispose();
      app.exit(code);
    };
    let wc;
    try {
      wc = await waitForHarnessContents(getHarnessWebContents, win, undefined, getWelcomeWebContents);
    } catch (error) {
      fs.writeFileSync(path.join(app.getPath('userData'), 'dshd-smoke.json'), JSON.stringify({
        ok: false, error: error.message,
      }, null, 2));
      await exitSmoke(1);
      return;
    }
    const onError = (_event, error) => { pageErrors.push(String(error).slice(0, 500)); };
    wc.on('render-process-gone', (_event, details) => {
      pageErrors.push(`render-process-gone: ${details.reason}`);
    });
    wc.on('console-message', (details) => {
      const message = String(details?.message || '');
      if (message.includes('Uncaught') || /cannot get property ["']sessions["'] without inject/i.test(message)) {
        pageErrors.push(message.slice(0, 500));
      }
    });
    wc.on('did-fail-load', onError);
    try {
      const bootShellApi = await win.webContents.executeJavaScript(`(() => {
        const api = window.shell;
        return {
          hasBootShellApi: Boolean(
            api
            && typeof api.getState === 'function'
            && typeof api.restart === 'function'
            && typeof api.windowAction === 'function'
          ),
          bootShellApiIsScoped: Boolean(
            api
            && typeof api.writeFile === 'undefined'
            && typeof api.saveConfig === 'undefined'
            && typeof api.ptyCreate === 'undefined'
          ),
        };
      })()`);
      const result = await wc.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 60 && !document.querySelector('[class*="frame"]'); i += 1) await sleep(250);
        await sleep(2500);
        const frame = document.querySelector('[class*="frame"]');
        const titlebar = document.querySelector('#dshd-shell-titlebar-trailing');
        const buttons = titlebar ? Array.from(titlebar.querySelectorAll('button')).map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()) : [];
        const api = window.shell;
        return {
          hasFrame: Boolean(frame),
          gridColumns: frame ? getComputedStyle(frame).gridTemplateColumns : null,
          hasTitlebar: Boolean(titlebar),
          titlebarButtons: buttons,
          hasTerminalToggle: buttons.some(t => /terminal|\u7ec8\u7aef/i.test(t)),
          hasSurfacesToggle: buttons.some(t => /right panel|surfaces|\u53f3\u4fa7\u680f/i.test(t)),
          hasDragStrip: Boolean(document.getElementById('dshd-shell-drag-strip')),
          hasDragMark: Boolean(document.querySelector('[data-dshd-shell-drag]')),
          hasHitMark: Boolean(document.querySelector('[data-dshd-shell-hit]')),
          captionRegion: (() => {
            const caption = document.querySelector('[data-dshd-caption="band"]');
            return caption ? getComputedStyle(caption).webkitAppRegion : null;
          })(),
          hasHarnessShellApi: Boolean(
            api
            && typeof api.getConfig === 'function'
            && typeof api.listDir === 'function'
            && typeof api.ptyCreate === 'function'
            && typeof api.previewOpen === 'function'
          ),
          harnessShellApiIsScoped: Boolean(
            api
            && typeof api.restart === 'undefined'
            && typeof api.cancelRestart === 'undefined'
          ),
        };
      })()`);
      Object.assign(result, bootShellApi);
      console.log('[DSH_SMOKE]', JSON.stringify({ ...result, pageErrors }));
      // Real PTY probe: node-pty is the one native dependency; prove it can
      // spawn a shell inside Electron (or report the exact failure) so the
      // smoke distinguishes "UI renders" from "terminal backend actually works".
      let ptyStatus = 'skipped';
      let created = null;
      let unsubscribePty = () => {};
      let cancelPtyMarker = () => {};
      try {
        created = await Promise.race([
          desktopResources.pty.create({ cwd: loadConfig().workspace, cols: 80, rows: 24 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('pty-create timed out')), 15000)),
        ]);
        ptyStatus = `created:${created.id}`;
        const marker = `dshd-smoke-ok-${process.pid}-${Date.now()}`;
        let output = '';
        let markerSeen;
        const markerOutput = new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            settled = true;
            reject(new Error('pty marker timed out'));
          }, 10_000);
          cancelPtyMarker = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
            }
          };
          markerSeen = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
        });
        unsubscribePty = desktopResources.pty.onEvent((channel, payload) => {
          if (channel !== 'shell:pty-data' || payload.id !== created.id) {
            return;
          }
          output = `${output}${String(payload.data || '')}`.slice(-8_192);
          if (output.includes(marker)) {
            markerSeen();
          }
        });
        await desktopResources.pty.write(created.id, `echo ${marker}\r`);
        await markerOutput;
        ptyStatus = 'echoed:ok';
      } catch (error) {
        ptyStatus = `unavailable:${error.message}`;
      } finally {
        cancelPtyMarker();
        unsubscribePty();
        if (created) {
          await desktopResources.pty.kill(created.id).catch(() => {});
        }
      }
      console.log('[DSH_SMOKE_PTY]', ptyStatus);
      let packagedP0 = null;
      const siblingPath = typeof process.env.DSH_SMOKE_SIBLING === 'string'
        ? process.env.DSH_SMOKE_SIBLING.trim()
        : '';
      if (siblingPath) {
        try {
          const { runPackagedP0 } = require('../packaged-p0');
          const config = loadConfig();
          packagedP0 = await runPackagedP0({
            siblingPath,
            pty: desktopResources && desktopResources.pty,
            fetch,
            host: config.host || dsh.host || '127.0.0.1',
            port: dsh.port || config.port,
            userData: app.getPath('userData'),
            appVersion: app.getVersion(),
            resourcesPath: process.resourcesPath,
            runtimeRoot: require('../paths').harnessRoot(),
            bootLogs: dsh.logs,
          });
        } catch (error) {
          packagedP0 = {
            ok: false,
            error: String(error),
            steps: [],
          };
        }
        console.log('[DSH_SMOKE_PACKAGED_P0]', JSON.stringify({
          ok: packagedP0.ok,
          steps: packagedP0.steps,
        }));
      }
      let qaAttached = false;
      const needsComposerQa = qaEnv('DSH_QA_COMPOSER');
      const remoteGateMode = typeof qaRemoteMode === 'function' ? qaRemoteMode() : (qaEnv('DSH_QA_REMOTE') ? 'full' : null);
      const needsRemoteGateQa = remoteGateMode != null;
      const needsReleaseQa = qaEnv('DSH_QA');
      const needsAppendixQa = qaEnv('DSH_QA_APPENDIX');
      const needsShellQa = qaEnv('DSH_QA_SHELL');
      const needsPersistQa = qaEnv('DSH_QA_PERSIST');
      const needsRecoveryQa = qaEnv('DSH_QA_RECOVERY');
      const needsThemeSmoke = qaEnv('DSH_THEME_SMOKE');
      if (needsReleaseQa || needsComposerQa || needsRemoteGateQa || needsAppendixQa || needsShellQa || needsPersistQa) {
        if (!wc.debugger.isAttached()) {
          await wc.debugger.attach('1.3');
          qaAttached = true;
        }
        if (!win.isDestroyed()) {
          win.setSize(1680, 1000);
          win.center();
        }
        const connectSteps = [];
        try {
          await connectConfiguredWorkspace(wc, {
            pressEscape,
            workspacePath: loadConfig().workspace,
          }, makeRecorder(connectSteps));
        } catch (error) {
          connectSteps.push({
            name: 'workspace.connected',
            ok: false,
            detail: String(error).slice(0, 400),
          });
        }
        result.workspaceConnect = connectSteps;
      }
      let titlebarHits = { hits: { surfaces: 0, branch: 0, git: 0 }, error: 'not-run' };
      try {
        await ensureSurfacesViewport(win, wc);
        titlebarHits = await probeTitlebarHits(wc);
      } catch (error) {
        titlebarHits = { hits: { surfaces: 0, branch: 0, git: 0 }, error: String(error) };
      }
      result.titlebarHits = titlebarHits;
      console.log('[DSH_SMOKE_HITS]', JSON.stringify(titlebarHits));
      if (needsComposerQa) {
        try {
          result.composerOfficialQa = await runComposerOfficialQa(wc, {
            pressEscape,
            clickTitlebarButton,
            surfacesPattern: SMOKE_SURFACES,
            terminalPattern: SMOKE_TERMINAL,
            workspacePath: loadConfig().workspace,
            workspaceConnected: Array.isArray(result.workspaceConnect)
              && result.workspaceConnect.some((step) => step.name === 'workspace.connected' && step.ok),
            pageErrors,
            probeRemote: probeRemoteSnapshot,
          });
        } catch (error) {
          result.composerOfficialQa = {
            ok: false,
            error: String(error),
            steps: [],
            failed: ['composer-official-threw'],
          };
        }
        console.log('[DSH_QA_COMPOSER]', JSON.stringify(result.composerOfficialQa));
        try {
          const png = await wc.capturePage();
          fs.writeFileSync(path.join(app.getPath('userData'), 'dshd-composer-qa.png'), png.toPNG());
        } catch {
          // Screenshot is evidence, not the verdict.
        }
      }
      if (needsRemoteGateQa) {
        try {
          result.remoteGateQa = await runRemoteGateQa(wc, {
            pressEscape,
            probeRemote: probeRemoteSnapshot,
            setRemote: setRemoteFromQa,
          }, { mode: remoteGateMode });
        } catch (error) {
          result.remoteGateQa = {
            ok: false,
            error: String(error),
            steps: [],
            failed: ['remote-gate-threw'],
          };
        }
        console.log('[DSH_QA_REMOTE]', JSON.stringify(result.remoteGateQa));
        try {
          const png = await wc.capturePage();
          fs.writeFileSync(path.join(app.getPath('userData'), 'dshd-remote-gate-qa.png'), png.toPNG());
        } catch {
          // Screenshot is evidence, not the verdict.
        }
      }
      if (needsAppendixQa) {
        try {
          result.appendixQa = await runAppendixAQa(wc, {
            workspacePath: loadConfig().workspace,
            workspaceConnected: Array.isArray(result.workspaceConnect)
              && result.workspaceConnect.some((step) => step.name === 'workspace.connected' && step.ok),
          });
        } catch (error) {
          result.appendixQa = {
            ok: false,
            error: String(error),
            steps: [],
            failed: ['appendix-threw'],
          };
        }
        console.log('[DSH_QA_APPENDIX]', JSON.stringify({
          ok: result.appendixQa?.ok,
          failed: result.appendixQa?.failed,
          steps: (result.appendixQa?.steps || []).map((step) => ({
            name: step.name,
            ok: step.ok,
            detail: String(step.detail || '').slice(0, 240),
          })),
        }));
        try {
          const png = await wc.capturePage();
          fs.writeFileSync(path.join(app.getPath('userData'), 'dshd-appendix-qa.png'), png.toPNG());
        } catch {
          // Screenshot is evidence, not the verdict.
        }
      }
      if (needsReleaseQa) {
        try {
          result.qa = await runReleaseUiWalk(wc, {
            pressEscape,
            clickTitlebarButton,
            surfacesPattern: SMOKE_SURFACES,
            terminalPattern: SMOKE_TERMINAL,
            workspacePath: loadConfig().workspace,
            skipWorkspaceConnect: Array.isArray(result.workspaceConnect)
              && result.workspaceConnect.some((step) => step.name === 'workspace.connected' && step.ok),
            probeRemote: probeRemoteSnapshot,
          });
        } catch (error) {
          result.qa = { ok: false, error: String(error), steps: [], failed: ['walk-threw'] };
        }
        console.log('[DSH_QA]', JSON.stringify(result.qa));
        try {
          const png = await wc.capturePage();
          fs.writeFileSync(path.join(app.getPath('userData'), 'dshd-qa.png'), png.toPNG());
        } catch {
          // Screenshot is evidence, not the verdict.
        }
      }
      if (needsShellQa) {
        try {
          result.shellP0Qa = await runShellP0Qa(wc, {
            win,
            saveConfig,
            loadConfig,
            showMain,
            invokeTrayAction,
            getQuitIntercepted,
            resetQuitIntercepted,
            pressEscape,
            dsh,
            harness,
          });
        } catch (error) {
          result.shellP0Qa = {
            ok: false,
            error: String(error),
            steps: [],
            failed: ['shell-p0-threw'],
          };
        }
        console.log('[DSH_QA_SHELL]', JSON.stringify({
          ok: result.shellP0Qa?.ok,
          failed: result.shellP0Qa?.failed,
          trayQuitRequested: result.shellP0Qa?.trayQuitRequested === true,
          steps: (result.shellP0Qa?.steps || []).map((step) => ({
            name: step.name,
            ok: step.ok,
            detail: String(step.detail || '').slice(0, 200),
          })),
        }));
        if (result.shellP0Qa?.trayQuitRequested) {
          await exitSmoke(0);
          return;
        }
      }
      if (needsPersistQa) {
        try {
          result.persistQa = await runPersistQa(wc, {
            loadConfig,
            workspacePath: loadConfig().workspace,
          });
        } catch (error) {
          result.persistQa = {
            ok: false,
            error: String(error),
            steps: [],
            failed: ['persist-threw'],
          };
        }
        console.log('[DSH_QA_PERSIST]', JSON.stringify(result.persistQa));
      }
      if (needsRecoveryQa) {
        try {
          result.recoveryQa = await runRecoveryQa({
            win,
            dsh,
            harness,
            saveConfig,
          });
        } catch (error) {
          result.recoveryQa = {
            ok: false,
            error: String(error),
            steps: [],
            failed: ['recovery-threw'],
          };
        }
        console.log('[DSH_QA_RECOVERY]', JSON.stringify(result.recoveryQa));
      }
      if (qaAttached && wc.debugger.isAttached()) {
        try {
          wc.debugger.detach();
        } catch {
          // Detach is best-effort before process exit.
        }
      }
      if (needsThemeSmoke) {
        try {
          result.themeSmoke = await probeThemeBackgrounds(wc);
        } catch (error) {
          result.themeSmoke = { ok: false, error: String(error) };
        }
        console.log('[DSH_THEME_SMOKE]', JSON.stringify(result.themeSmoke));
      }
      const hitCount = titlebarHits.hits.surfaces + titlebarHits.hits.branch + titlebarHits.hits.git;
      const requireFullTitlebar = needsReleaseQa
        || needsComposerQa
        || needsAppendixQa
        || needsShellQa
        || needsPersistQa
        || needsRecoveryQa
        || !needsRemoteGateQa;
      const titlebarOk = !requireFullTitlebar || (
        hitCount > 0
        && titlebarHits.hits.surfaces > 0
        && titlebarHits.hits.branch > 0
        && titlebarHits.hits.git > 0
        && titlebarHits.error == null
      );
      const ok = result.hasFrame
        && result.hasTitlebar
        && result.hasTerminalToggle
        && result.hasSurfacesToggle
        && result.hasDragStrip !== true
        && result.hasDragMark !== true
        && result.hasHitMark !== true
        && result.captionRegion === 'drag'
        && result.hasBootShellApi
        && result.bootShellApiIsScoped
        && result.hasHarnessShellApi
        && result.harnessShellApiIsScoped
        && titlebarOk
        && ptyStatus === 'echoed:ok'
        && (!needsThemeSmoke || result.themeSmoke?.ok === true)
        && (!needsReleaseQa || result.qa?.ok === true)
        && (!needsComposerQa || result.composerOfficialQa?.ok === true)
        && (!needsRemoteGateQa || result.remoteGateQa?.ok === true)
        && (!needsAppendixQa || result.appendixQa?.ok === true)
        && (!needsShellQa || result.shellP0Qa?.ok === true)
        && (!needsPersistQa || result.persistQa?.ok === true)
        && (!needsRecoveryQa || result.recoveryQa?.ok === true)
        && (needsRecoveryQa || pageErrors.length === 0)
        && (!siblingPath || packagedP0?.ok === true);
      try {
        fs.writeFileSync(path.join(app.getPath('userData'), 'dshd-smoke.json'), JSON.stringify({
          ok,
          result,
          ptyStatus,
          pageErrors,
          desktopHome: tryGetDesktopDshHome(),
          homeLog: (Array.isArray(dsh.logs) ? dsh.logs : []).find((line) => /Harness \u5bb6\u76ee\u5f55/.test(String(line))) || '',
          electronEnv: {
            DSH_HOME: process.env.DSH_HOME || '',
            DSHD_HOME: process.env.DSHD_HOME || '',
          },
          bootLogs: Array.isArray(dsh.logs) ? dsh.logs.slice(-80) : [],
          packagedP0,
        }, null, 2));
      } catch {
        // Best-effort: the exit code still carries the verdict.
      }
      await exitSmoke(ok ? 0 : 1);
    } catch (error) {
      console.log('[DSH_SMOKE] failed', String(error));
      await exitSmoke(1);
    }
  }

  return { runSmoke, keepRemotePhoneHost };
}

module.exports = { createSmokeRunner };
