'use strict';

// CSP guards for the desktop-pet pages. pet.html loads via file:// and only
// needs self + file: images; pet-live2d.html runs on the privileged pet://
// scheme and needs ORT wasm compilation plus blob: workers — wasm-unsafe-eval
// covers WebAssembly without granting script eval.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function cspOf(file) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(match, `${file} must declare a Content-Security-Policy meta tag`);
  return match[1];
}

test('pet pages declare a CSP without unsafe-eval', () => {
  for (const file of ['pet.html', 'pet-live2d.html']) {
    const csp = cspOf(file);
    assert.match(csp, /default-src 'none'/, `${file} should default-deny`);
    assert.ok(!/'unsafe-eval'/.test(csp), `${file} must not allow unsafe-eval`);
    assert.ok(!/https?:/.test(csp), `${file} must not reach the network`);
  }
});

test('pet.html CSP allows only its own scripts, styles and images', () => {
  const csp = cspOf('pet.html');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src 'self' file: data:/);
  assert.ok(!/wasm-unsafe-eval/.test(csp), 'pet.html runs no wasm');
});

test('pet-live2d.html CSP scopes wasm, blob workers and pet:// assets', () => {
  const csp = cspOf('pet-live2d.html');
  // ORT compiles .wasm (wasm-unsafe-eval, never unsafe-eval) and spawns
  // blob: workers; everything else stays same-origin on pet://pet.
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /img-src 'self' data:/);
});
