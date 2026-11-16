'use strict';

/**
 * Self-signed TLS material generation (test fixtures and local dev services).
 *
 * Zero-dependency X.509 v3 generation on Node crypto (ECDSA P-256,
 * ecdsa-with-SHA256): the desktop app carries no runtime npm dependency and
 * Electron's Node cannot mint certificates natively.
 */

const crypto = require('crypto');

const VALID_DAYS = 3650;
const SUBJECT_CN = 'Whale Isle Remote';

// ---------------------------------------------------------------------------
// Minimal DER encoding (only the forms this certificate needs).

function derLength(length) {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes = [];
  let rest = length;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...parts) {
  return der(0x30, Buffer.concat(parts));
}

function derSet(...parts) {
  return der(0x31, Buffer.concat(parts));
}

function derInteger(value) {
  let content = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  // DER INTEGER content must be minimal: drop redundant leading zero bytes
  // (a 0x00 is only kept when it pads a high bit). Without this, a random
  // serial starting 0x00 0x00-0x7f is "illegal padding" to OpenSSL 3.
  let start = 0;
  while (start < content.length - 1 && content[start] === 0x00 && !(content[start + 1] & 0x80)) {
    start += 1;
  }
  content = content.subarray(start);
  // INTEGER is signed: a leading high bit needs a zero pad to stay positive.
  if (content.length === 0 || content[0] & 0x80) {
    content = Buffer.concat([Buffer.from([0x00]), content]);
  }
  return der(0x02, content);
}

function derOid(dotted) {
  const arcs = dotted.split('.').map((part) => Number(part));
  const bytes = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunk = [];
    let rest = arc;
    do {
      chunk.unshift(rest & 0x7f);
      rest = Math.floor(rest / 128);
    } while (rest > 0);
    for (let i = 0; i < chunk.length - 1; i += 1) {
      chunk[i] |= 0x80;
    }
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

function derUtf8String(text) {
  return der(0x0c, Buffer.from(text, 'utf8'));
}

function derIa5String(text) {
  return der(0x16, Buffer.from(text, 'ascii'));
}

function derUtcTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const text = pad(date.getUTCFullYear() % 100)
    + pad(date.getUTCMonth() + 1)
    + pad(date.getUTCDate())
    + pad(date.getUTCHours())
    + pad(date.getUTCMinutes())
    + pad(date.getUTCSeconds())
    + 'Z';
  return der(0x17, Buffer.from(text, 'ascii'));
}

function derBitString(content) {
  return der(0x03, Buffer.concat([Buffer.from([0x00]), content]));
}

function derOctetString(content) {
  return der(0x04, content);
}

function derExplicit(tagNumber, content) {
  return der(0xa0 | tagNumber, content);
}

function derContextPrimitive(tagNumber, content) {
  return der(0x80 | tagNumber, content);
}

// ---------------------------------------------------------------------------
// Certificate assembly.

function rdnCommonName(name) {
  return derSequence(derSet(derSequence(derOid('2.5.4.3'), derUtf8String(name))));
}

function ipv4Bytes(address) {
  const parts = String(address || '').split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (!octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return null;
  }
  return Buffer.from(octets);
}

function subjectAltNames(addresses) {
  const names = [derContextPrimitive(2, Buffer.from('localhost', 'ascii'))];
  const seen = new Set();
  for (const address of ['127.0.0.1', ...addresses]) {
    const bytes = ipv4Bytes(address);
    if (!bytes || seen.has(address)) {
      continue;
    }
    seen.add(address);
    names.push(derContextPrimitive(7, bytes));
  }
  return derSequence(...names);
}

function extension(oid, content) {
  return derSequence(derOid(oid), derOctetString(content));
}

/**
 * Generate a fresh self-signed ECDSA P-256 certificate.
 * @param {object} [options]
 * @param {string[]} [options.addresses] - LAN IPv4 addresses for the SAN.
 * @param {Date} [options.now] - clock override for tests.
 * @returns {{ key: string, cert: string, fingerprint256: string }} PEM pair
 * plus the certificate DER SHA-256 (lower-case hex, no separators).
 */
function generateTlsMaterial(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const addresses = Array.isArray(options.addresses) ? options.addresses : [];
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const serial = crypto.randomBytes(12);
  serial[0] &= 0x7f;
  const algorithm = derSequence(derOid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const name = rdnCommonName(SUBJECT_CN);
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000);
  const extensions = derSequence(
    // basicConstraints: not a CA (empty SEQUENCE keeps the cA=false default).
    extension('2.5.29.19', derSequence()),
    // extendedKeyUsage: serverAuth.
    extension('2.5.29.37', derSequence(derOid('1.3.6.1.5.5.7.3.1'))),
    extension('2.5.29.17', subjectAltNames(addresses)),
  );

  const tbs = derSequence(
    derExplicit(0, derInteger(2)), // v3
    derInteger(serial),
    algorithm,
    name,
    derSequence(derUtcTime(notBefore), derUtcTime(notAfter)),
    name,
    spki,
    derExplicit(3, extensions),
  );

  const signature = crypto.sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const certDer = derSequence(tbs, algorithm, derBitString(signature));

  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: pemCertificate(certDer),
    fingerprint256: crypto.createHash('sha256').update(certDer).digest('hex'),
  };
}

function pemCertificate(der) {
  const body = der.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd();
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

module.exports = {
  generateTlsMaterial,
};
