import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORT_DIR = path.join(ROOT, 'src', 'renderer', 'pet-live2d', 'ort');
const PET_RUNTIME_JS = path.join(ROOT, 'src', 'renderer', 'pet-live2d-runtime.js');
const ANIME4K_JS = path.join(ROOT, 'src', 'renderer', 'pet-live2d', 'anime4k.js');
const ANIME4K_LICENSE = path.join(ROOT, 'src', 'renderer', 'pet-live2d', 'anime4k.LICENSE');

// Exact ordered WebGL shaderSource SHA-256 digests captured from main's full anime4k.js@1.1.3 ANIME4KJS_SIMPLE_M_2X.
const EXPECTED_SIMPLE_M_2X_SHADER_SHA256 = [
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  'f97ee2dbeaa1f4ee0c2ea36d0a537416f30ac9f7974fc9d4ac15d348f17cbb55',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  'c889fcffa40378df5b8a619559b7a851c77dafe1161510e9086ddcc96e3e4ea3',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '0a5a4619c4eab9e09fd76be089024dbf1b81bcefeaa0f6505621f1d803afcf27',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '9a4bee929f69eaafe19e8320e773edaa674264e09c0cdbb9b1ff866a884a57dd',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  'e2076885c11003766ebb4b5935e793640e41b59c095820aa6a8f89e83eacb65d',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  'b8fccf5b66643b47e16e7c090674739e2a107bb1f74b0f146275523a75937540',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '032762e9484e80312295669cba702e3acfb532942387ea6e70e011c34d745d07',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  'bf8390f507c129f319999c5e4936aea991dc064214cf890e97fbb87ec6e1678f',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '14f0528bdc2531a39afacd132b240df3a5324cabcc6462b42055a9643bce8896',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '7d3a02283f776663dee4858e08d339a086374fbcffcb9c61e21e7c46defff6d3',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '3dd40b96b027ec919f64c324f4ab6d7136cfa85fbca772cb4f3239b8f3240540',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '88aed480d7b721cd5bc49c03bb6b1fd147a88cc48cf80cb9e2c909c36e684751',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  'e9ea808c4974695f628a07717f71b4a6e6bb98a152b205bac164595e3e6c2d3b',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '88fef4f2d7e418a3e49ce29499e6f1d12697e5449c3dafbb46707dd28145caeb',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '3e498034ffdc3f99a62ebbf0c2925a381003e566d05038e8b3de7a8e7e6f9d2e',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '01708ce05915c6b10ea7dd7a2ec467486790410e1615adcf2c73b4694164c22c',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '8aa5448a97b4999f19cdc2ee0654accffed3b8491e8ae9269b6a2cd07644e00f',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  'e33538bbfe7335f07b625c79fbbf8dc3a621690e3293b525f8d1fe805c224648',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '26f0a9325a9f4bfc2bac26e39a1373558601e15a67f580c00e194fdf3d4b93d5',
  'd9c0802918fb4b79048b87b93a9290a5ce9de201d0601e5edd8d90b3d41e2dd0',
  '9268f490fd5c75ac22af8c9f8652f5ca068fc01beff8f2c2344d76fa8450e1ca',
];

test('ORT directory contains only loader-referenced JSEP backend files and proxy worker remains disabled', () => {
  const runtimeSource = fs.readFileSync(PET_RUNTIME_JS, 'utf8');
  assert.doesNotMatch(runtimeSource, /\.wasm\.proxy\s*=\s*true/);

  const referenced = new Set(['ort.all.min.js']);
  const scriptsToScan = fs.readdirSync(ORT_DIR).filter((name) => name === 'ort.all.min.js' || name.endsWith('.mjs'));
  for (const name of scriptsToScan) {
    const content = fs.readFileSync(path.join(ORT_DIR, name), 'utf8');
    const matches = content.match(/ort-wasm[\w.-]*\.(?:m?js|wasm)/g) || [];
    for (const ref of matches) {
      if (ref.startsWith('ort-wasm-proxy-worker')) continue;
      referenced.add(ref);
    }
  }

  for (const expectedFile of referenced) {
    assert.equal(
      fs.existsSync(path.join(ORT_DIR, expectedFile)),
      true,
      `Missing loader-referenced ORT asset: ${expectedFile}`,
    );
  }

  const actualFiles = new Set(fs.readdirSync(ORT_DIR));
  assert.deepEqual([...actualFiles].sort(), [...referenced].sort());
});

test('trimmed anime4k.js is <= 300 KiB, carries MIT + provenance, and matches baseline ANIME4KJS_SIMPLE_M_2X GLSL shaders identically', () => {
  const stat = fs.statSync(ANIME4K_JS);
  assert.ok(stat.size <= 300_000, `anime4k.js exceeds 300 KB cap: ${stat.size}`);

  const code = fs.readFileSync(ANIME4K_JS, 'utf8');
  assert.match(code, /MIT/);
  assert.match(code, /anime4k\.js@1\.1\.3/);

  const license = fs.readFileSync(ANIME4K_LICENSE, 'utf8');
  assert.match(license, /もにょ～ん/);
  assert.match(license, /bloc97/);

  /** @type {Record<string, unknown>} */
  const sandbox = { self: {} };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: ANIME4K_JS });

  const exportsObj = /** @type {{ ImageUpscaler?: unknown; ANIME4KJS_SIMPLE_M_2X?: Array<new (gl: unknown) => unknown> }} */ (sandbox.Anime4KJS);
  assert.equal(typeof exportsObj?.ImageUpscaler, 'function');
  assert.equal(Array.isArray(exportsObj?.ANIME4KJS_SIMPLE_M_2X), true);
  assert.equal(exportsObj.ANIME4KJS_SIMPLE_M_2X.length, 3);

  /** @type {string[]} */
  const capturedDigests = [];
  const glProxy = new Proxy({
    COMPILE_STATUS: 0x8B81,
    LINK_STATUS: 0x8B82,
    VERTEX_SHADER: 0x8B31,
    FRAGMENT_SHADER: 0x8B30,
    createShader: (type) => ({ type }),
    shaderSource: (_shader, src) => {
      capturedDigests.push(crypto.createHash('sha256').update(src.trim()).digest('hex'));
    },
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : () => ({})),
  });

  for (const ShaderCtor of exportsObj.ANIME4KJS_SIMPLE_M_2X) {
    new ShaderCtor(glProxy);
  }
  assert.deepEqual(capturedDigests, EXPECTED_SIMPLE_M_2X_SHADER_SHA256);
});
