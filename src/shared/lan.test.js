'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PUBLIC_APP_BASE_URL,
  DEFAULT_RELAY_ENDPOINT,
  DEFAULT_RELAY_USE_TLS,
  LEGACY_DEFAULT_PUBLIC_APP_BASE_URL,
  LEGACY_DEFAULT_RELAY_ENDPOINT,
  normalizePublicAppBaseUrl,
  preferredLanIp,
  isVirtualOrLinkLocalIpv4,
} = require('./lan');

test('preferredLanIp skips link-local and prefers RFC1918', () => {
  assert.equal(preferredLanIp(['169.254.1.2', '192.168.1.8']), '192.168.1.8');
  assert.equal(preferredLanIp(['100.64.1.2', '10.0.0.4']), '10.0.0.4');
  assert.equal(preferredLanIp(['127.0.0.1', '169.254.9.9']), '');
  assert.equal(preferredLanIp(['8.8.8.8']), '8.8.8.8');
});

test('preferredLanIp ranks the real Wi-Fi / Ethernet NIC above WSL, Hyper-V and proxy TUN adapters', () => {
  // The Windows enumeration order this regressed on: virtual adapters first,
  // all in 172.16/12, and the proxy TUN at 172.19.0.1 used to win the QR.
  const rows = [
    { address: '172.22.240.1', name: 'vEthernet (WSL (Hyper-V firewall))' },
    { address: '172.21.48.1', name: 'vEthernet (Default Switch)' },
    { address: '169.254.26.133', name: '本地连接' },
    { address: '192.168.53.56', name: '以太网' },
    { address: '192.168.53.58', name: 'WLAN' },
    { address: '172.19.0.1', name: 'singbox_tun' },
  ];
  assert.equal(preferredLanIp(rows), '192.168.53.56');
  // A single real 172.x NIC still wins over a virtual 192.168 bridge.
  assert.equal(preferredLanIp([
    { address: '192.168.99.1', name: 'VMware Network Adapter VMnet8' },
    { address: '172.20.5.7', name: 'Ethernet' },
  ]), '172.20.5.7');
  // With no adapter names the address heuristics alone still avoid the .1 host of 172.16/12.
  assert.equal(preferredLanIp(['172.19.0.1', '192.168.1.8']), '192.168.1.8');
  assert.equal(preferredLanIp(['172.19.0.1', '10.0.0.4']), '10.0.0.4');
  // Only virtual candidates: pick the best of them rather than nothing.
  assert.equal(preferredLanIp([{ address: '172.19.0.1', name: 'singbox_tun' }]), '172.19.0.1');
});

test('isVirtualOrLinkLocalIpv4 covers APIPA and CGNAT', () => {
  assert.equal(isVirtualOrLinkLocalIpv4('169.254.10.1'), true);
  assert.equal(isVirtualOrLinkLocalIpv4('100.64.0.1'), true);
  assert.equal(isVirtualOrLinkLocalIpv4('100.127.0.1'), true);
  assert.equal(isVirtualOrLinkLocalIpv4('192.168.0.1'), false);
});

test('server defaults use the ayase.cn TLS relay and nginx SPA path', () => {
  assert.equal(DEFAULT_RELAY_ENDPOINT, 'ayase.cn:443');
  assert.equal(DEFAULT_RELAY_USE_TLS, true);
  assert.equal(DEFAULT_PUBLIC_APP_BASE_URL, 'https://ayase.cn/dshd');
  assert.doesNotMatch(DEFAULT_PUBLIC_APP_BASE_URL, /:8411/);
  assert.match(DEFAULT_PUBLIC_APP_BASE_URL, /\/dshd$/);
  assert.equal(LEGACY_DEFAULT_RELAY_ENDPOINT, '125.124.85.212:8411');
  assert.equal(LEGACY_DEFAULT_PUBLIC_APP_BASE_URL, 'http://125.124.85.212:3389/dshd');
});

test('normalizePublicAppBaseUrl keeps empty and rejects relay port / RFC1918', () => {
  assert.equal(normalizePublicAppBaseUrl(''), '');
  assert.equal(normalizePublicAppBaseUrl('   '), '');
  assert.equal(normalizePublicAppBaseUrl('http://125.124.85.212:8411'), '');
  assert.equal(normalizePublicAppBaseUrl('http://125.124.85.212:8411/'), '');
  assert.equal(normalizePublicAppBaseUrl('http://192.168.1.8:3180'), '');
  assert.equal(normalizePublicAppBaseUrl('http://10.0.0.4/dshd'), '');
  assert.equal(normalizePublicAppBaseUrl('not a url'), '');
  assert.equal(normalizePublicAppBaseUrl('ftp://125.124.85.212/dshd'), '');
  assert.equal(
    normalizePublicAppBaseUrl('http://125.124.85.212/dshd/'),
    'http://125.124.85.212/dshd',
  );
  assert.equal(
    normalizePublicAppBaseUrl('http://125.124.85.212/dshd', { relayEndpoint: DEFAULT_RELAY_ENDPOINT }),
    'http://125.124.85.212/dshd',
  );
  assert.equal(
    normalizePublicAppBaseUrl('http://125.124.85.212:3389/dshd/'),
    'http://125.124.85.212:3389/dshd',
  );
  assert.equal(normalizePublicAppBaseUrl('https://ayase.cn/dshd/'), 'https://ayase.cn/dshd');
});
