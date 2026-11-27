import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORT_DIR = path.join(ROOT, 'src', 'renderer', 'pet-live2d', 'ort');
const PET_RUNTIME_JS = path.join(ROOT, 'src', 'renderer', 'pet-live2d-runtime.js');

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
