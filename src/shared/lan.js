const os = require('os');

/**
 * Desktop built-in public Away relay — hardcoded for packaged Setup.exe.
 * Do not move these behind env/config files; empty user config falls back here.
 */
const DEFAULT_RELAY_HOST = 'ayase.cn';
const DEFAULT_RELAY_PORT = 443;
const DEFAULT_RELAY_ENDPOINT = `${DEFAULT_RELAY_HOST}:${DEFAULT_RELAY_PORT}`;
const LEGACY_DEFAULT_RELAY_ENDPOINT = '125.124.85.212:8411';
const LEGACY_DEFAULT_PUBLIC_APP_BASE_URL = 'http://125.124.85.212:3389/dshd';
/** Public nginx SPA for Away-mode QR. Relay transport uses the same origin's exact /ws route. */
const DEFAULT_PUBLIC_APP_BASE_URL = `https://${DEFAULT_RELAY_HOST}/dshd`;
const DEFAULT_RELAY_USE_TLS = true;

function isIpv4(address, family) {
  return family === 'IPv4' || family === 4 || /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
}

/**
 * Adapter names that carry a private IPv4 but no phone can ever reach: Hyper-V /
 * WSL switches, Docker / VM bridges, VPN / proxy TUN devices. `os.networkInterfaces`
 * lists them alongside the real NIC with no other distinguishing fact, so the
 * name is the only usable signal (Windows: "vEthernet (WSL)", "singbox_tun").
 */
const VIRTUAL_ADAPTER_NAME = /vethernet|wsl|hyper-v|default switch|\btun\b|_tun|tun\d|\btap\b|vmware|vmnet|virtualbox|vbox|docker|br-|tailscale|zerotier|wireguard|\bwg\d|singbox|sing-box|clash|mihomo|utun|npcap|loopback|teredo|isatap/i;

/**
 * IPv4 candidates with their adapter name, real NICs first.
 * @returns {{ address: string, name: string, virtual: boolean }[]}
 */
function listLanCandidates() {
  const found = [];
  const seen = new Set();
  for (const [name, rows] of Object.entries(os.networkInterfaces())) {
    for (const row of rows || []) {
      if (!row || row.internal || !row.address || !isIpv4(row.address, row.family)) {
        continue;
      }
      if (seen.has(row.address)) {
        continue;
      }
      seen.add(row.address);
      found.push({ address: row.address, name, virtual: VIRTUAL_ADAPTER_NAME.test(name) });
    }
  }
  return found;
}

function listLanAddresses() {
  return listLanCandidates().map((row) => row.address);
}

/**
 * Link-local / CGNAT / common hypervisor adapters that should not land in a QR.
 * @param {string} address
 * @returns {boolean}
 */
function isVirtualOrLinkLocalIpv4(address) {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  // 169.254.0.0/16 link-local
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  // 100.64.0.0/10 CGNAT (often VPN/tailscale-ish)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return true;
  }
  return false;
}

function isPrivateLanIpv4(address) {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  if (parts[0] === 10) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  return false;
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isIpv4Hostname(hostname) {
  const parts = String(hostname || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  return parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
}

/**
 * Normalize a public SPA base URL for Away-mode QR (nginx path, not relay :8411).
 * @param {string} value
 * @param {{ relayEndpoint?: string }} [options]
 * @returns {string}
 */
function normalizePublicAppBaseUrl(value, options = {}) {
  const relayEndpoint = options.relayEndpoint ?? DEFAULT_RELAY_ENDPOINT;
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '';
  }
  const hostname = url.hostname;
  if (
    isLoopbackHostname(hostname)
    || (isIpv4Hostname(hostname)
      && (isVirtualOrLinkLocalIpv4(hostname) || isPrivateLanIpv4(hostname)))
  ) {
    return '';
  }
  const hostPort = url.port ? `${hostname}:${url.port}` : hostname;
  if (url.port === '8411' || hostPort === relayEndpoint) {
    return '';
  }
  const pathname = url.pathname.replace(/\/$/, '');
  return `${url.protocol}//${url.host}${pathname}`;
}

/**
 * Pick a phone-reachable LAN IPv4 for pairing QR / SPA base.
 * Skips link-local and prefers RFC1918; empty when no usable NIC.
 * @param {string[]} [addresses]
 * @returns {string}
 */
/**
 * Rank one candidate for the QR: lower sorts first. Real RFC1918 NICs beat
 * hypervisor / TUN adapters, and among private ranges 192.168/16 (home and
 * office Wi-Fi) beats 10/8 beats 172.16/12 — the last is what Hyper-V, WSL,
 * Docker and proxy TUNs hand out, and a `.1` host there is almost always the
 * virtual gateway side, not this machine on a real LAN.
 * @param {{ address: string, virtual: boolean }} row
 * @returns {number}
 */
function lanCandidateRank(row) {
  const parts = row.address.split('.').map((part) => Number(part));
  let rank = 0;
  if (row.virtual) rank += 100;
  if (!isPrivateLanIpv4(row.address)) {
    rank += 50;
  } else if (parts[0] === 172) {
    rank += 20;
    if (parts[3] === 1) rank += 5;
  } else if (parts[0] === 10) {
    rank += 10;
  }
  return rank;
}

/**
 * Pick the address a phone on the same network can reach.
 * @param {(string | { address: string, name?: string, virtual?: boolean })[]} [addresses]
 * @returns {string} best address, or '' when nothing qualifies.
 */
function preferredLanIp(addresses = listLanCandidates()) {
  const usable = (Array.isArray(addresses) ? addresses : [])
    .map((row) => (typeof row === 'string'
      ? { address: row.trim(), virtual: false }
      : { address: String(row?.address || '').trim(), virtual: row?.virtual === true || VIRTUAL_ADAPTER_NAME.test(String(row?.name || '')) }))
    .filter((row) => row.address && row.address !== '127.0.0.1' && !isVirtualOrLinkLocalIpv4(row.address));
  if (usable.length === 0) {
    return '';
  }
  // Stable sort keeps enumeration order among equal ranks.
  return usable
    .map((row, index) => ({ row, index, rank: lanCandidateRank(row) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)[0].row.address;
}

/**
 * ChisaCode Away relay host (`hostname:port`). Rejects chisacode.sh.
 * Built-in desktop default is always allowed.
 * @param {string} value
 * @returns {string}
 */
function normalizeRelayEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const withoutScheme = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!withoutScheme || /chisacode\.sh/i.test(withoutScheme)) {
    return '';
  }
  if (!/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(withoutScheme)) {
    return '';
  }
  return withoutScheme.includes(':') ? withoutScheme : `${withoutScheme}:443`;
}

function publicUrl(address, port, options = {}) {
  return `${options.tls === true ? 'https' : 'http'}://${address}:${Number(port) || 3180}/`;
}

module.exports = {
  DEFAULT_RELAY_ENDPOINT,
  LEGACY_DEFAULT_RELAY_ENDPOINT,
  LEGACY_DEFAULT_PUBLIC_APP_BASE_URL,
  DEFAULT_PUBLIC_APP_BASE_URL,
  DEFAULT_RELAY_USE_TLS,
  listLanAddresses,
  preferredLanIp,
  isVirtualOrLinkLocalIpv4,
  normalizeRelayEndpoint,
  normalizePublicAppBaseUrl,
  publicUrl,
};
