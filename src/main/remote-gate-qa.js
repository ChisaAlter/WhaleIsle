'use strict';

/**
 * Real-machine gate for Remote: parked TC-NEG-001, or unparked TC-NEG-001 + TC-REM-001.
 * Does not open the pairing URL / phone SPA (that is the scan-link path).
 */

const net = require('net');
const { PAGE_HELPERS, summarizeRemoteQaDetail } = require('./release-ui-walk');

const REMOTE_GATE_NEG_REM_CASES = Object.freeze([
  { id: 'neg.available', title: 'Remote snapshot is available by default' },
  { id: 'neg.notEnabled', title: 'Remote stays off until the user turns it on' },
  { id: 'neg.notListening', title: 'Default config does not listen on the remote port' },
  { id: 'neg.footerPresent', title: 'Sidebar exposes the remote trigger' },
  { id: 'rem.enabledListening', title: 'Turning remote on opens the LAN listener' },
  { id: 'rem.pairingOffer', title: 'Enabled remote exposes a hash offer URL (not opened)' },
  { id: 'rem.qrVisible', title: 'Remote popup shows a QR face' },
  { id: 'rem.disabledStopped', title: 'Turning remote off stops the listener' },
]);

const REMOTE_GATE_COLD_CASES = Object.freeze([
  { id: 'cold.openShowsQr', title: 'Preset-on: open popup without toggling shows QR' },
  { id: 'cold.noBareOfferText', title: 'Popup text has no raw #offer= dump' },
  { id: 'cold.copyAndRotateControls', title: 'Popup exposes copy-link and rotate controls' },
]);

const REMOTE_GATE_PARKED_CASES = Object.freeze([
  { id: 'parked.unavailable', title: 'Parked remote snapshot is unavailable' },
  { id: 'parked.notListening', title: 'Parked remote does not listen' },
  { id: 'parked.noFooter', title: 'Parked remote has no sidebar trigger' },
]);

const REMOTE_GATE_CASES = Object.freeze([
  ...REMOTE_GATE_NEG_REM_CASES,
  ...REMOTE_GATE_COLD_CASES,
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(probe, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

function pageEval(wc, fn) {
  return wc.executeJavaScript(`(() => { ${PAGE_HELPERS}; return (${fn.toString()})(); })()`);
}

function makeRecorder(steps) {
  return (name, ok, detail, optional = false) => {
    const row = {
      name,
      ok: Boolean(ok),
      detail: detail == null ? '' : String(detail).slice(0, 600),
    };
    if (optional) row.optional = true;
    steps.push(row);
    console.log(`[DSH_QA_REMOTE] ${ok ? 'PASS' : (optional ? 'SKIP' : 'FAIL')} ${name}${row.detail ? ` — ${row.detail}` : ''}`);
  };
}

function remoteHasError(snap) {
  const err = snap?.error;
  return typeof err === 'string' ? err.trim().length > 0 : err != null;
}

function pairingOffer(snap) {
  const raw = Array.isArray(snap && snap.urls)
    ? (snap.urls.find((row) => row && row.pairingUrl) || {}).pairingUrl
    : '';
  return typeof raw === 'string' && raw.includes('#offer=') ? raw : '';
}

/**
 * Return whether the current transport is ready for pairing QR display.
 * @param {any} snap
 * @returns {boolean}
 */
function pairingTransportReady(snap) {
  if (!snap) return false;
  if (snap.mode === 'lan' && snap.lanReady === true) {
    return Boolean(snap.listening);
  }
  return Boolean(snap.relayConnected);
}

/**
 * Pairing chrome follows the live transport state: QR when ready.
 * @param {{ hasQr?: boolean, hasStatus?: boolean } | null} face
 * @param {boolean} connected
 * @returns {boolean}
 */
function pairingChromeMatchesRelay(face, connected) {
  if (!face) return false;
  if (connected) return Boolean(face.hasQr);
  return !face.hasQr && Boolean(face.hasStatus);
}

/**
 * Copy / rotate ride the same gate as the QR.
 * @param {{ copy?: boolean, rotate?: boolean } | null} face
 * @param {boolean} connected
 * @param {boolean} clipHostOk
 * @returns {boolean}
 */
function pairingControlsMatchRelay(face, connected, clipHostOk) {
  if (!face) return false;
  if (connected) return Boolean(face.copy && face.rotate && clipHostOk);
  return !face.copy && !face.rotate;
}

function portOpen(port) {
  const target = Number(port);
  if (!Number.isInteger(target) || target <= 0) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: target }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function assertRemoteGateQaResult(qa, { required } = {}) {
  const expected = required || (qa && qa.parked === true ? REMOTE_GATE_PARKED_CASES : REMOTE_GATE_CASES);
  if (!qa || qa.ok !== true) {
    const failed = (qa?.failed && qa.failed.length > 0)
      ? qa.failed
      : (qa?.steps || []).filter((s) => !s.ok && !s.optional).map((s) => `${s.name}: ${s.detail || ''}`);
    throw new Error(`Remote gate QA failed:\n${failed.join('\n')}\n${JSON.stringify(qa)}`);
  }
  const names = new Set((qa.steps || []).map((s) => s.name));
  const missing = expected.map((c) => c.id).filter((id) => !names.has(id));
  if (missing.length > 0) {
    throw new Error(`Remote gate QA omitted required cases: ${missing.join(', ')}`);
  }
}

/** @returns {Promise<string>} */
async function readMainClipboard() {
  try {
    const text = await require('electron').clipboard.readText();
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

/**
 * Inspect or click the current Remote entry (sidebar fallback or account menu).
 * @param {Electron.WebContents} wc
 * @param {'open-entry' | 'find-menu' | 'click-menu'} action
 * @returns {Promise<string | boolean>}
 */
function evalRemoteEntryStep(wc, action) {
  return wc.executeJavaScript(`(() => {
    ${PAGE_HELPERS};
    const action = ${JSON.stringify(action)};
    if (action === 'open-entry') {
      const footer = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
      if (footer && dshShown(footer)) { footer.click(); return 'footer'; }
      const account = dshFind('^account menu|^账号菜单')
        || Array.from(document.querySelectorAll('[data-dsh-settings-trigger]')).find(dshShown);
      if (account && typeof account.click === 'function') { account.click(); return 'account'; }
      return '';
    }
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).find(dshShown);
    const remote = menu && dshFind('^remote$|^远程$', menu);
    if (!remote) return false;
    if (action === 'find-menu') return true;
    if (remote.disabled) return false;
    remote.click();
    return true;
  })()`);
}

/**
 * Check whether the current Remote entry exists without leaving menus open.
 * @param {Electron.WebContents} wc
 * @param {any} helpers
 * @param {number} [timeoutMs]
 * @returns {Promise<string | null>}
 */
async function probeRemoteTrigger(wc, helpers, timeoutMs = 5_000) {
  const footer = await pageEval(wc, () => {
    const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
    return trigger && dshShown(trigger) ? 'footer' : '';
  });
  if (footer) return 'footer';
  const entry = await pageEval(wc, () => {
    const account = dshFind('^account menu|^账号菜单')
      || Array.from(document.querySelectorAll('[data-dsh-settings-trigger]')).find((el) => el.getBoundingClientRect().width > 0);
    if (account instanceof HTMLElement) account.click();
    return Boolean(account);
  });
  if (!entry) return null;
  const menuHit = await waitUntil(() => evalRemoteEntryStep(wc, 'find-menu'), timeoutMs);
  await helpers.pressEscape(wc);
  return menuHit ? 'account-menu' : null;
}

/**
 * Open the Remote pairing dialog from the sidebar fallback or account menu.
 * @param {Electron.WebContents} wc
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
async function openRemotePopup(wc, timeoutMs = 5_000) {
  const clicked = await evalRemoteEntryStep(wc, 'open-entry');
  if (clicked === 'footer') return true;
  if (clicked !== 'account') return false;
  return Boolean(await waitUntil(() => evalRemoteEntryStep(wc, 'click-menu'), timeoutMs));
}

/**
 * Wait for the Remote pairing popup QR face or status line.
 * @param {Electron.WebContents} wc
 * @param {{ includeControls?: boolean }} [options]
 * @returns {Promise<any>}
 */
async function readPairingFace(wc, { includeControls = false } = {}) {
  return waitUntil(() => pageEval(wc, () => {
    const root = document.querySelector('[data-dsh-remote-panel], [role="dialog"]') || document.body;
    const mark = root.querySelector('[data-dsh-remote-qr] img, [data-dsh-remote-qr] svg');
    const status = root.querySelector('[data-dsh-remote-status]');
    if (!mark && !status) return null;
    const copy = root.querySelector('[data-dsh-remote-copy-link]');
    const rotate = root.querySelector('[data-dsh-remote-rotate]');
    const text = root instanceof HTMLElement ? root.innerText || '' : '';
    return {
      hasQr: Boolean(mark),
      kind: mark ? mark.tagName.toLowerCase() : '',
      hasStatus: Boolean(status),
      bareOffer: text.includes('#offer='),
      copy: Boolean(copy && dshShown(copy)),
      rotate: Boolean(rotate && dshShown(rotate)),
    };
  }), 8_000).then((face) => (includeControls || !face ? face : {
    hasQr: face.hasQr,
    kind: face.kind,
    hasStatus: face.hasStatus,
  }));
}

/**
 * Open the pairing popup and inspect its QR face against live transport state.
 * @param {Electron.WebContents} wc
 * @param {any} helpers
 * @param {any} fallbackSnap
 * @param {{ includeControls?: boolean }} [options]
 */
async function probeRemotePopupQr(wc, helpers, fallbackSnap, { includeControls = false } = {}) {
  const opened = await openRemotePopup(wc);
  const face = opened ? await readPairingFace(wc, { includeControls }) : null;
  const live = await helpers.probeRemote().catch(() => fallbackSnap);
  const connected = pairingTransportReady(live);
  const qrOk = pairingChromeMatchesRelay(face, connected);
  const relayConnected = Boolean(live && live.relayConnected);
  const detail = !opened
    ? 'remote trigger failed to open popup'
    : face
      ? `${JSON.stringify(face)}; transportReady=${connected}; relayConnected=${relayConnected}`
      : 'popup opened but no [data-dsh-remote-qr] face or status';
  return { opened, face, connected, qrOk, detail };
}

/**
 * Verify clipboard offer URL has `#offer=` and matches the expected pairing host (or is non-loopback when omitted).
 * @param {string} clipboard
 * @param {string} [expectedOffer]
 * @returns {boolean}
 */
function clipboardOfferMatchesExpectedHost(clipboard, expectedOffer = '') {
  if (typeof clipboard !== 'string' || !clipboard.includes('#offer=')) return false;
  let clipHost = '';
  try {
    clipHost = new URL(clipboard).hostname;
  } catch {
    return false;
  }
  if (!clipHost) return false;
  let expectedHost = '';
  if (expectedOffer) {
    try {
      expectedHost = new URL(expectedOffer).hostname;
    } catch {
      expectedHost = '';
    }
  }
  if (expectedHost) {
    const loopbackHosts = ['127.0.0.1', 'localhost', '::1'];
    if (!loopbackHosts.includes(expectedHost) && loopbackHosts.includes(clipHost)) return false;
    return clipHost === expectedHost;
  }
  return !['127.0.0.1', 'localhost', '::1'].includes(clipHost);
}

/**
 * Read redacted clipboard offer status without exposing secret fragments.
 * @param {string} [expectedOffer]
 * @returns {Promise<{ ok: boolean, clipLen: number, clipHost: string, hasOffer: boolean }>}
 */
async function readClipboardOfferStatus(expectedOffer = '') {
  const clipboard = await readMainClipboard();
  const hasOffer = clipboard.includes('#offer=');
  let clipHost = '';
  try {
    clipHost = clipboard ? new URL(clipboard).hostname : '';
  } catch {
    clipHost = '';
  }
  const ok = clipboardOfferMatchesExpectedHost(clipboard, expectedOffer);
  return { ok, clipLen: clipboard.length, clipHost, hasOffer };
}

/**
 * Click the copy-link button via real pointer activation and inspect clipboard status.
 * @param {Electron.WebContents} wc
 * @param {string} [expectedOffer]
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
async function clipboardHasPublicOffer(wc, expectedOffer = '') {
  try {
    require('electron').clipboard.clear();
  } catch {
    // Ignore clipboard clear errors in restricted environments.
  }
  if (typeof wc.focus === 'function') wc.focus();
  const btn = await pageEval(wc, () => {
    const copy = document.querySelector('[data-dsh-remote-copy-link]');
    if (!(copy instanceof HTMLElement)) return null;
    const r = copy.getBoundingClientRect();
    return {
      disabled: copy instanceof HTMLButtonElement ? copy.disabled : copy.getAttribute('aria-disabled') === 'true',
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  });
  if (btn && !btn.disabled && wc.debugger && wc.debugger.isAttached()) {
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btn.x, y: btn.y });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  } else {
    await wc.executeJavaScript(`(() => {
      const copy = document.querySelector('[data-dsh-remote-copy-link]');
      if (copy instanceof HTMLElement) copy.click();
      return Boolean(copy);
    })()`, true);
  }
  const matched = await waitUntil(async () => {
    const st = await readClipboardOfferStatus(expectedOffer);
    return st.ok ? st : null;
  }, 2_500, 100);
  const finalStatus = matched || (await readClipboardOfferStatus(expectedOffer));
  const copyDisabled = btn ? btn.disabled : null;
  return {
    ok: finalStatus.ok,
    detail: `copyDisabled=${copyDisabled}; clipLen=${finalStatus.clipLen}; clipHost=${finalStatus.clipHost}; hasOffer=${finalStatus.hasOffer}`,
  };
}

/**
 * Run preset-on cold Remote verification steps.
 * @param {Electron.WebContents} wc
 * @param {any} helpers
 * @param {string | null} footer
 * @param {any} snap
 * @param {Function} rec
 */
async function runColdRemoteCases(wc, helpers, footer, snap, rec) {
  const cold = await waitUntil(async () => {
    const next = await helpers.probeRemote();
    return next && next.listening === true && pairingOffer(next) && !remoteHasError(next) ? next : null;
  }, 20_000) || snap;

  if (!footer) {
    rec('cold.openShowsQr', false, 'remote trigger missing');
    rec('cold.noBareOfferText', false, 'remote trigger missing');
    rec('cold.copyAndRotateControls', false, 'remote trigger missing');
    return;
  }
  const { face, connected, qrOk, detail } = await probeRemotePopupQr(wc, helpers, cold, { includeControls: true });
  const bareOffer = Boolean(!face || face.bareOffer);
  const copyOk = Boolean(face && face.copy);
  const rotateOk = Boolean(face && face.rotate);
  const offer = pairingOffer(cold);
  const clipResult = copyOk ? await clipboardHasPublicOffer(wc, offer) : { ok: false, detail: 'copyNotShown' };
  await helpers.pressEscape(wc);
  rec('cold.openShowsQr', qrOk && Boolean(offer) && !remoteHasError(cold), detail);
  rec(
    'cold.noBareOfferText',
    Boolean(face) && !bareOffer,
    bareOffer ? 'popup text still dumps #offer=' : 'no bare #offer= in popup text',
  );
  rec(
    'cold.copyAndRotateControls',
    pairingControlsMatchRelay(face, connected, clipResult.ok),
    `copy=${copyOk}; rotate=${rotateOk}; clipboardOffer=${clipResult.ok}; ${clipResult.detail}; relayConnected=${connected}`,
  );
}

/**
 * @param {Electron.WebContents} wc
 * @param {{
 *   pressEscape: Function,
 *   probeRemote: () => Promise<object>,
 *   setRemote: (patch: object) => Promise<object>,
 * }} helpers
 */
async function runRemoteGateQa(wc, helpers, { mode = 'full' } = {}) {
  const steps = [];
  const rec = makeRecorder(steps);
  const coldOnly = mode === 'cold';
  const { REMOTE_FEATURE_ENABLED } = require('./config');

  await helpers.pressEscape(wc);

  let snap = null;
  try {
    snap = await helpers.probeRemote();
  } catch (error) {
    snap = { error: String(error) };
  }

  const footer = await probeRemoteTrigger(wc, helpers);

  if (!REMOTE_FEATURE_ENABLED) {
    rec(
      'parked.unavailable',
      snap && snap.available === false && snap.enabled === false,
      summarizeRemoteQaDetail(snap),
    );
    rec(
      'parked.notListening',
      snap != null && snap.listening !== true,
      snap ? `listening=${snap.listening}` : 'no snapshot',
    );
    rec('parked.noFooter', footer == null, footer || 'no remote trigger');
    const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
    return {
      ok: failed.length === 0,
      parked: true,
      failed,
      steps,
      cases: REMOTE_GATE_PARKED_CASES.map((c) => c.id),
    };
  }

  if (!coldOnly) {
    rec(
      'neg.available',
      snap && snap.available === true && !remoteHasError(snap),
      summarizeRemoteQaDetail(snap),
    );
    rec(
      'neg.notEnabled',
      snap != null && snap.enabled !== true && !remoteHasError(snap),
      snap ? `enabled=${snap.enabled}` : 'no snapshot',
    );
    const defaultPort = Number(snap && snap.port) || 3180;
    const listeningBefore = snap != null && snap.listening === true;
    const portBefore = await portOpen(defaultPort);
    rec(
      'neg.notListening',
      snap != null && !listeningBefore && !portBefore && !remoteHasError(snap),
      `listening=${snap && snap.listening}; portOpen=${portBefore}`,
    );
    rec('neg.footerPresent', footer != null, footer || 'no remote footer');

    let enabled = null;
    try {
      enabled = await helpers.setRemote({ remoteEnabled: true, remoteMode: 'lan' });
    } catch (error) {
      enabled = { error: String(error) };
    }
    enabled = await waitUntil(async () => {
      const next = await helpers.probeRemote();
      return next && next.listening === true ? next : null;
    }, 15_000) || enabled;

    const offer = pairingOffer(enabled);
    const portAfter = await portOpen(Number(enabled && enabled.port) || defaultPort);
    rec(
      'rem.enabledListening',
      enabled
        && enabled.available === true
        && enabled.enabled === true
        && enabled.listening === true
        && portAfter
        && !remoteHasError(enabled),
      `${summarizeRemoteQaDetail(enabled)}; portOpen=${portAfter}`,
    );
    rec(
      'rem.pairingOffer',
      Boolean(offer),
      offer ? 'pairingUrl has #offer= (not fetched)' : 'no pairingUrl with #offer=',
    );

    let qrDetail = 'remote trigger missing';
    let qrOk = false;
    if (footer) {
      const popup = await probeRemotePopupQr(wc, helpers, enabled);
      qrOk = popup.qrOk;
      qrDetail = popup.detail;
      await helpers.pressEscape(wc);
    }
    rec('rem.qrVisible', qrOk, qrDetail);

    let disabled = null;
    try {
      disabled = await helpers.setRemote({ remoteEnabled: false });
    } catch (error) {
      disabled = { error: String(error) };
    }
    disabled = await waitUntil(async () => {
      const next = await helpers.probeRemote();
      return next && next.listening !== true ? next : null;
    }, 15_000) || disabled;
    const portStopped = !(await portOpen(Number(disabled && disabled.port) || defaultPort));
    rec(
      'rem.disabledStopped',
      disabled != null
        && disabled.enabled !== true
        && disabled.listening !== true
        && portStopped
        && !remoteHasError(disabled),
      `${summarizeRemoteQaDetail(disabled)}; portClosed=${portStopped}`,
    );
  }

  if (coldOnly) {
    await runColdRemoteCases(wc, helpers, footer, snap, rec);
  }

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  const cases = (coldOnly ? REMOTE_GATE_COLD_CASES : REMOTE_GATE_NEG_REM_CASES).map((c) => c.id);
  return {
    ok: failed.length === 0,
    failed,
    steps,
    cases,
  };
}

module.exports = {
  REMOTE_GATE_CASES,
  REMOTE_GATE_NEG_REM_CASES,
  REMOTE_GATE_COLD_CASES,
  REMOTE_GATE_PARKED_CASES,
  runRemoteGateQa,
  assertRemoteGateQaResult,
  pairingOffer,
  pairingTransportReady,
  clipboardOfferMatchesExpectedHost,
  pairingChromeMatchesRelay,
  pairingControlsMatchRelay,
};
