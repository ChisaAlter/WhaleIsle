const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const https = require('https');
const { generateTlsMaterial } = require('./remote-tls');

test('generateTlsMaterial stays parseable when the random serial starts with zero bytes', (t) => {
  // Regression: a serial of 0x00 0x00-0x7f … used to produce a non-minimal
  // DER INTEGER ("illegal padding" in OpenSSL 3) roughly once in 256 runs.
  const realRandomBytes = crypto.randomBytes;
  t.mock.method(crypto, 'randomBytes', (size) => {
    const bytes = realRandomBytes(size);
    if (size === 12) {
      bytes[0] = 0x00;
      bytes[1] = 0x42; // high bit clear: the zero byte above is redundant padding
    }
    return bytes;
  });
  const material = generateTlsMaterial();
  // Before the fix this constructor threw ERR_OSSL_ASN1_ILLEGAL_PADDING.
  const x509 = new crypto.X509Certificate(material.cert);
  assert.equal(x509.checkPrivateKey(crypto.createPrivateKey(material.key)), true);
});

test('serial DER edge shapes stay parseable: multi-zero stripping and high-bit zero retention', (t) => {
  // Beyond the 0x00 0x42 regression: several redundant zero bytes must all be
  // stripped, while a zero byte that pads a following high bit must be kept
  // (dropping it would flip the INTEGER negative).
  const realRandomBytes = crypto.randomBytes;
  const fixtures = [
    [0x00, 0x00, 0x42],
    [0x00, 0x9c, 0x11],
  ];
  let fixture = fixtures[0];
  t.mock.method(crypto, 'randomBytes', (size) => {
    const bytes = realRandomBytes(size);
    if (size === 12) {
      [bytes[0], bytes[1], bytes[2]] = fixture;
    }
    return bytes;
  });
  for (fixture of fixtures) {
    const material = generateTlsMaterial();
    const x509 = new crypto.X509Certificate(material.cert);
    assert.equal(x509.checkPrivateKey(crypto.createPrivateKey(material.key)), true);
    // Minimal encoding: parsed serial must not carry redundant leading zeros.
    assert.doesNotMatch(x509.serialNumber || '', /^00(?:[0-7])/i);
  }
});

test('generateTlsMaterial mints a parseable self-signed P-256 certificate', () => {
  const material = generateTlsMaterial({ addresses: ['192.168.1.20', 'not-an-ip', '192.168.1.20'] });
  const x509 = new crypto.X509Certificate(material.cert);
  assert.match(x509.subject, /WhaleIsle Remote/);
  assert.equal(x509.subject, x509.issuer);
  assert.match(x509.subjectAltName || '', /DNS:localhost/);
  assert.match(x509.subjectAltName || '', /IP Address:127\.0\.0\.1/);
  assert.match(x509.subjectAltName || '', /IP Address:192\.168\.1\.20/);
  // Junk and duplicate addresses never enter the SAN.
  assert.equal((x509.subjectAltName || '').split('192.168.1.20').length, 2);
  assert.equal(x509.checkPrivateKey(crypto.createPrivateKey(material.key)), true);
  assert.ok(Date.parse(x509.validTo) - Date.now() > 9 * 365 * 24 * 60 * 60 * 1000);
  assert.ok(Date.parse(x509.validFrom) < Date.now());
  assert.match(material.fingerprint256, /^[0-9a-f]{64}$/);
  assert.equal(
    material.fingerprint256,
    crypto.createHash('sha256').update(x509.raw).digest('hex'),
  );
});

test('an https server on the generated material serves and matches the pinned fingerprint', async () => {
  const material = generateTlsMaterial({ addresses: ['127.0.0.1'] });
  const server = https.createServer({ key: material.key, cert: material.cert }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('tls-ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const { status, body, fingerprint } = await new Promise((resolve, reject) => {
      const request = https.request({
        host: '127.0.0.1',
        port,
        path: '/',
        // Fingerprint pinning instead of CA trust.
        rejectUnauthorized: false,
      }, (response) => {
        const socket = response.socket;
        const peer = socket.getPeerCertificate();
        let text = '';
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({
          status: response.statusCode,
          body: text,
          fingerprint: crypto.createHash('sha256').update(peer.raw).digest('hex'),
        }));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 200);
    assert.equal(body, 'tls-ok');
    assert.equal(fingerprint, material.fingerprint256);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
