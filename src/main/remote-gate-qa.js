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
 * Pairing chrome follows the live control socket: QR only when connected.
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

function readMainClipboard() {
  try {
    return require('electron').clipboard.readText() || '';
  } catch {
    return '';
  }
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

  const footer = await pageEval(wc, () => {
    const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
    if (trigger && dshShown(trigger)) return 'trigger';
    return dshFind('^remote$|^远程$') ? 'label' : null;
  });

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
      await pageEval(wc, () => {
        const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
        if (trigger) trigger.click();
        return Boolean(trigger);
      });
      const qr = await waitUntil(() => pageEval(wc, () => {
        const root = document.querySelector('[data-dsh-remote-panel], [role="dialog"]') || document.body;
        const mark = root.querySelector('[data-dsh-remote-qr] img, [data-dsh-remote-qr] svg');
        const status = root.querySelector('[data-dsh-remote-status]');
        if (!mark && !status) return null;
        return {
          hasQr: Boolean(mark),
          kind: mark ? mark.tagName.toLowerCase() : '',
          hasStatus: Boolean(status),
        };
      }), 8_000);
      const live = await helpers.probeRemote().catch(() => enabled);
      const connected = Boolean(live && live.relayConnected);
      qrOk = pairingChromeMatchesRelay(qr, connected);
      qrDetail = qr
        ? `${JSON.stringify(qr)}; relayConnected=${connected}`
        : 'popup opened but no [data-dsh-remote-qr] face or status';
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
    // Preset-on boot: wait for listening + offer. Never call setRemote before open.
    const cold = await waitUntil(async () => {
      const next = await helpers.probeRemote();
      return next && next.listening === true && pairingOffer(next) && !remoteHasError(next) ? next : null;
    }, 20_000) || snap;

    let coldQrOk = false;
    let coldQrDetail = 'remote trigger missing';
    let bareOffer = true;
    let copyOk = false;
    let rotateOk = false;
    let clipboard = '';
    if (footer) {
      await pageEval(wc, () => {
        const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
        if (trigger) trigger.click();
        return Boolean(trigger);
      });
      const face = await waitUntil(() => pageEval(wc, () => {
        const root = document.querySelector('[data-dsh-remote-panel], [role="dialog"]') || document.body;
        const mark = root.querySelector('[data-dsh-remote-qr] img, [data-dsh-remote-qr] svg');
        const status = root.querySelector('[data-dsh-remote-status]');
        const copy = root.querySelector('[data-dsh-remote-copy-link]');
        const rotate = root.querySelector('[data-dsh-remote-rotate]');
        const text = root.innerText || '';
        if (!mark && !status) return null;
        return {
          hasQr: Boolean(mark),
          kind: mark ? mark.tagName.toLowerCase() : '',
          hasStatus: Boolean(status),
          bareOffer: text.includes('#offer='),
          copy: Boolean(copy && dshShown(copy)),
          rotate: Boolean(rotate && dshShown(rotate)),
        };
      }), 8_000);
      const live = await helpers.probeRemote().catch(() => cold);
      const connected = Boolean(live && live.relayConnected);
      coldQrOk = pairingChromeMatchesRelay(face, connected);
      coldQrDetail = face
        ? `${JSON.stringify(face)}; relayConnected=${connected}`
        : 'popup opened but no [data-dsh-remote-qr] face or status';
      bareOffer = Boolean(!face || face.bareOffer);
      copyOk = Boolean(face && face.copy);
      rotateOk = Boolean(face && face.rotate);
      if (copyOk) {
        await pageEval(wc, () => {
          const copy = document.querySelector('[data-dsh-remote-copy-link]');
          if (copy) copy.click();
          return Boolean(copy);
        });
        await sleep(200);
        clipboard = readMainClipboard();
      }
      await helpers.pressEscape(wc);
      const offer = pairingOffer(cold);
      let clipHostOk = false;
      try {
        const host = clipboard ? new URL(clipboard).hostname : '';
        clipHostOk = Boolean(
          clipboard.includes('#offer=')
          && !['127.0.0.1', 'localhost', '::1'].includes(host),
        );
      } catch {
        clipHostOk = false;
      }
      rec(
        'cold.openShowsQr',
        coldQrOk && Boolean(offer) && !remoteHasError(cold),
        coldQrDetail,
      );
      rec(
        'cold.noBareOfferText',
        Boolean(face) && !bareOffer,
        bareOffer ? 'popup text still dumps #offer=' : 'no bare #offer= in popup text',
      );
      rec(
        'cold.copyAndRotateControls',
        pairingControlsMatchRelay(face, connected, clipHostOk),
        `copy=${copyOk}; rotate=${rotateOk}; clipboardOffer=${clipHostOk}; relayConnected=${connected}`,
      );
    } else {
      rec('cold.openShowsQr', false, coldQrDetail);
      rec('cold.noBareOfferText', false, 'remote trigger missing');
      rec('cold.copyAndRotateControls', false, 'remote trigger missing');
    }
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
  pairingChromeMatchesRelay,
  pairingControlsMatchRelay,
};
