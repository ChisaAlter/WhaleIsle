/**
 * ChisaCode same-protocol phone session (pairing + sticky reconnect + agent list/send).
 * Replaces HTTP Host SPA login for offer v2.
 */

const SECRET_KEY = 'dsh-chisacode-device-secrets';
const DEFAULT_COMPUTER_NAME = '我的电脑';

function loadSecrets() {
  try {
    return JSON.parse(localStorage.getItem(SECRET_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveSecret(serverId, record) {
  const all = loadSecrets();
  all[serverId] = {
    ...all[serverId],
    ...record,
    savedAt: Date.now(),
  };
  localStorage.setItem(SECRET_KEY, JSON.stringify(all));
}

function normalizeComputerName(value, serverId = '') {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name || name === serverId || /^srv_/i.test(name)) return '';
  return name;
}

function resolveComputerName(client, serverId, storedName = '') {
  const serverName = normalizeComputerName(
    client?.getLastServerInfoMessage?.()?.hostname,
    serverId,
  );
  return serverName || normalizeComputerName(storedName, serverId) || DEFAULT_COMPUTER_NAME;
}

function saveComputerName(serverId, computerName) {
  const name = normalizeComputerName(computerName, serverId);
  if (!name) return;
  const all = loadSecrets();
  const stored = all[serverId];
  if (!stored || stored.computerName === name) return;
  all[serverId] = { ...stored, computerName: name };
  try {
    localStorage.setItem(SECRET_KEY, JSON.stringify(all));
  } catch {
    // The connection is already live; optional display metadata must not tear it down.
  }
}

function computerNameSession(client, serverId) {
  const refreshComputerName = () => {
    const storedName = loadSecrets()[serverId]?.computerName;
    const computerName = resolveComputerName(client, serverId, storedName);
    saveComputerName(serverId, computerName);
    return computerName;
  };
  return { computerName: refreshComputerName(), refreshComputerName };
}

function clearSecret(serverId) {
  const all = loadSecrets();
  delete all[serverId];
  localStorage.setItem(SECRET_KEY, JSON.stringify(all));
}

function listStickyServerIds() {
  const all = loadSecrets();
  return Object.keys(all).filter((id) => (
    all[id]?.deviceId
    && all[id]?.deviceSecret
    && all[id]?.daemonPublicKeyB64
    && all[id]?.relayEndpoint
  ));
}

/**
 * Rows for the connect screen "已保存的电脑" chooser: complete sticky records
 * only, most recently saved first. Pure local state — no daemon RPC.
 * @param {Record<string, object>} secrets loadSecrets() shape
 * @returns {Array<{ serverId: string, computerName: string, relayEndpoint: string, savedAt: number }>}
 */
function savedComputerRows(secrets) {
  return Object.entries(secrets || {})
    .filter(([, record]) => (
      record?.deviceId
      && record?.deviceSecret
      && record?.daemonPublicKeyB64
      && record?.relayEndpoint
    ))
    .map(([serverId, record]) => ({
      serverId,
      computerName: normalizeComputerName(record.computerName, serverId) || DEFAULT_COMPUTER_NAME,
      relayEndpoint: String(record.relayEndpoint),
      savedAt: Number(record.savedAt) || 0,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

function getMostRecentStickyServerId() {
  const all = loadSecrets();
  let bestId = '';
  let bestAt = -1;
  for (const [id, record] of Object.entries(all)) {
    if (
      !record?.deviceId
      || !record?.deviceSecret
      || !record?.daemonPublicKeyB64
      || !record?.relayEndpoint
    ) {
      continue;
    }
    const at = Number(record.savedAt) || 0;
    if (at >= bestAt) {
      bestAt = at;
      bestId = id;
    }
  }
  return bestId;
}

// `crypto.randomUUID` only exists on secure origins (https / localhost). The
// pairing page is `http://<lan-ip>:3180`, so fall back to getRandomValues —
// available everywhere — like `host/rpc.js#mintRpcId`.
function randomIdHex(bytes = 8) {
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

const CLIENT_ID_KEY = 'dsh-chisacode-client-id';

function clientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `mob_${randomIdHex(8)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

/** The persisted mobile clientId (minted on first use). */
function currentClientId() {
  return clientId();
}

/**
 * Forget the persisted clientId so the next pairing registers as a new
 * client. The relay keeps the previous registration alive briefly after an
 * in-tab logout; reusing the id makes the fresh handshake stall silently.
 * @returns {string} the id that was discarded ('' when none).
 */
function rotateClientId() {
  const previous = localStorage.getItem(CLIENT_ID_KEY) || '';
  localStorage.removeItem(CLIENT_ID_KEY);
  return previous;
}

/**
 * @param {typeof import('./daemon-client.bundle.js')} api
 * @param {object} params
 * @param {string} params.endpoint
 * @param {boolean} params.useTls
 * @param {string} params.serverId
 */
function buildClientRelayUrl(api, { endpoint, useTls, serverId }) {
  return api.buildRelayWebSocketUrl({
    endpoint,
    useTls: useTls === true,
    serverId,
    role: 'client',
  });
}

function hasOfferFragment(value) {
  return /(?:^|#|&)offer=[^&]+/.test(String(value || ''));
}

function normalizeOfferUrl(value, currentUrl) {
  const text = String(value || '').trim();
  if (!text) return '';
  const base = new URL(currentUrl || globalThis.location?.href || 'http://localhost/');
  if (/^offer=[A-Za-z0-9_-]+$/.test(text)) {
    base.hash = `#${text}`;
    return base.toString();
  }
  if (/^#offer=[A-Za-z0-9_-]+$/.test(text)) {
    base.hash = text;
    return base.toString();
  }
  try {
    const parsed = new URL(text, base);
    return /^#offer=[A-Za-z0-9_-]+$/.test(parsed.hash) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function agentRows(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries.flatMap((entry) => {
    const agent = entry?.agent || entry;
    if (!agent || typeof agent.id !== 'string' || !agent.id) {
      return [];
    }
    return [{
      sessionId: agent.id,
      title: typeof agent.title === 'string' ? agent.title : '',
      projections: {
        values: {
          title: typeof agent.title === 'string' ? agent.title : '',
        },
      },
      running: agent.status === 'running' || agent.status === 'initializing',
      cwd: typeof agent.cwd === 'string' ? agent.cwd : '',
      chisacodeAgent: agent,
    }];
  });
}

/**
 * Friendly device name from a browser user-agent, sent as the pairing
 * `deviceName` so the desktop device list shows a real label instead of the
 * generic relay-pair one. Mirrors the desktop-side naming contract
 * (src/shared/remote-devices.js): iPhone/iPad/Android carry OS/model, other
 * computers read as 电脑, anything unknown stays 设备.
 * @param {string} userAgent
 * @returns {string} label capped at 120 chars (protocol + store cap)
 */
function deviceNameFromUa(userAgent) {
  const ua = String(userAgent || '');
  let name = '设备';
  if (/iPhone/i.test(ua)) {
    const ios = ua.match(/OS (\d+[_\d]*)/);
    name = ios ? `iPhone · iOS ${ios[1].replaceAll('_', '.')}` : 'iPhone';
  } else if (/iPad/i.test(ua)) {
    const ios = ua.match(/OS (\d+[_\d]*)/);
    name = ios ? `iPad · iOS ${ios[1].replaceAll('_', '.')}` : 'iPad';
  } else if (/Android/i.test(ua)) {
    const android = ua.match(/Android ([\d.]+)(?:; ([^;)]+))?/i);
    name = 'Android';
    if (android) {
      name = `Android ${android[1]}`;
      const model = (android[2] || '').replace(/\s*Build\/.*$/i, '').trim();
      if (model && !/^(wv|Mobile)$/i.test(model)) name += ` · ${model}`;
    }
  } else if (/Windows/i.test(ua) || /Mac OS X|Macintosh/i.test(ua) || /Linux/i.test(ua)) {
    name = '电脑';
  }
  return name.slice(0, 120);
}

/**
 * @param {typeof import('./daemon-client.bundle.js')} api
 * @param {string} offerUrl
 * @returns {Promise<{ client: import('@chisacode/client').DaemonClient, offer: object, serverId: string }>}
 */
export async function pairFromOfferUrl(api, offerUrl, { signal } = {}) {
  let offer;
  try {
    offer = api.parseConnectionOfferFromUrl(offerUrl);
  } catch {
    throw new Error('无效的配对链接（需要 dshd offer）');
  }
  if (!offer || !offer.serverId) {
    throw new Error('无效的配对链接（需要 dshd offer）');
  }

  const stored = loadSecrets()[offer.serverId];
  const deviceId = stored?.deviceId || api.createRelayDeviceId();
  const pairingToken = offer.authBootstrap?.pairingToken;
  const expiresAt = offer.authBootstrap?.expiresAtMs;
  if (pairingToken && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw new Error('配对码已过期，请在电脑端刷新配对码后重新扫码');
  }
  const relayEndpoint = offer.relay?.endpoint;
  if (!relayEndpoint) {
    throw new Error('配对 offer 缺少中继主机');
  }

  const useTls = offer.relay?.useTls === true;

  let relayDeviceAuth;
  // A freshly scanned offer must use its one-time token. This lets a desktop
  // revocation recover even when the phone still has the now-invalid secret.
  if (pairingToken) {
    relayDeviceAuth = {
      version: 1,
      serverId: offer.serverId,
      deviceId,
      pairingToken,
      // Report a real device name at first pairing; the desktop stores it as
      // the device label (renamable later from device management).
      deviceName: deviceNameFromUa(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    };
  } else if (stored?.deviceId && stored?.deviceSecret) {
    relayDeviceAuth = {
      version: 1,
      serverId: offer.serverId,
      deviceId: stored.deviceId,
      deviceSecret: stored.deviceSecret,
    };
  } else {
    throw new Error('需要扫码配对或已保存的设备密钥');
  }

  const url = buildClientRelayUrl(api, {
    endpoint: relayEndpoint,
    useTls,
    serverId: offer.serverId,
  });

  let authError = null;
  const client = new api.DaemonClient({
    clientId: clientId(),
    clientType: 'mobile',
    url,
    e2ee: {
      enabled: true,
      daemonPublicKeyB64: offer.daemonPublicKeyB64,
    },
    relayDeviceAuth,
    reconnect: { enabled: false },
    onRelayDeviceAuthResult: (result) => {
      if (result?.ok === false) {
        authError = new Error('配对授权已失效，请在电脑端刷新配对码后重新扫码');
        client.setReconnectEnabled(false);
        return;
      }
      if (!result?.ok || !result.deviceId || !result.deviceSecret) {
        return;
      }
      // The controller retains this credential record across transports.
      // Replace the consumed bootstrap before any automatic reconnect.
      relayDeviceAuth.deviceId = result.deviceId;
      relayDeviceAuth.deviceSecret = result.deviceSecret;
      delete relayDeviceAuth.pairingToken;
      delete relayDeviceAuth.deviceName;
      try { saveSecret(offer.serverId, {
        deviceId: result.deviceId,
        deviceSecret: result.deviceSecret,
        daemonPublicKeyB64: offer.daemonPublicKeyB64,
        relayEndpoint,
        useTls,
      }); } catch {
        authError = new Error('无法保存配对密钥，请检查浏览器存储权限后重试');
      }
    },
  });

  await connectInitial(client, signal, () => authError);
  const computerNameState = computerNameSession(client, offer.serverId);
  return {
    client,
    offer,
    serverId: offer.serverId,
    ...computerNameState,
    getAuthError: () => authError,
  };
}

/**
 * Reconnect with sticky deviceSecret (no new QR).
 * @param {typeof import('./daemon-client.bundle.js')} api
 * @param {string} serverId
 */
export async function reconnectSticky(api, serverId, { signal } = {}) {
  const stored = loadSecrets()[serverId];
  if (
    !stored?.deviceId
    || !stored?.deviceSecret
    || !stored.daemonPublicKeyB64
    || !stored.relayEndpoint
  ) {
    throw new Error('没有已保存的配对；请重新扫码');
  }
  const useTls = stored.useTls === true;
  const url = buildClientRelayUrl(api, {
    endpoint: stored.relayEndpoint,
    useTls,
    serverId,
  });
  let authError = null;
  const client = new api.DaemonClient({
    clientId: clientId(),
    clientType: 'mobile',
    url,
    e2ee: {
      enabled: true,
      daemonPublicKeyB64: stored.daemonPublicKeyB64,
    },
    relayDeviceAuth: {
      version: 1,
      serverId,
      deviceId: stored.deviceId,
      deviceSecret: stored.deviceSecret,
    },
    reconnect: { enabled: false },
    onRelayDeviceAuthResult: (result) => {
      if (result?.ok !== false) return;
      authError = new Error('这台设备的配对授权已失效，请重新扫码配对');
      client.setReconnectEnabled(false);
    },
  });
  await connectInitial(client, signal, () => authError);
  const computerNameState = computerNameSession(client, serverId);
  return { client, serverId, ...computerNameState, getAuthError: () => authError };
}

async function connectInitial(client, signal, getAuthError = () => null) {
  let onAbort;
  try {
    if (signal?.aborted) throw signal.reason || new Error('连接已取消');
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason || new Error('连接已取消'));
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    // Retry only established sessions; otherwise connect() never rejects on
    // transport failure and the saved-computer chooser stays locked forever.
    await Promise.race([client.connect(), cancelled]);
    if (getAuthError()) throw getAuthError();
    client.setReconnectEnabled(true);
  } catch (error) {
    await client.close();
    throw getAuthError() || error;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export {
  loadSecrets,
  clearSecret,
  currentClientId,
  rotateClientId,
  saveSecret,
  listStickyServerIds,
  getMostRecentStickyServerId,
  savedComputerRows,
  buildClientRelayUrl,
  deviceNameFromUa,
  hasOfferFragment,
  normalizeOfferUrl,
  agentRows,
};
