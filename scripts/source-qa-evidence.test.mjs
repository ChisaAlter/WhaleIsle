import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';
import { writeSourceQaEvidence } from './source-qa-evidence.mjs';

for (const nested of [false, true]) {
  test(`exports the ${nested ? 'nested' : 'direct'} walkthrough without copying its profile or diagnostic secrets`, async () => {
    await withOwnedTempDir('whale-source-evidence-test-', async root => {
      const userData = path.join(root, 'profile');
      mkdirSync(userData);
      writeFileSync(path.join(userData, 'credentials.json'), 'SECRET');
      writeFileSync(path.join(userData, 'dshd-qa.png'), 'synthetic screenshot');
      const qa = { ok: true, steps: [{ name: 'settings.trigger', ok: true, detail: 'SECRET' }, { name: 'optional', ok: false, optional: true }] };
      const resultPath = path.join(root, 'result.json');
      writeFileSync(resultPath, JSON.stringify({ ok: true, log: 'SECRET', ...(nested ? { result: { qa } } : { qa }) }));
      const out = path.join(root, 'out');
      writeSourceQaEvidence({ resultPath, userData }, out);
      assert.deepEqual(readdirSync(out).sort(), ['summary.json', 'summary.txt', 'walkthrough.png']);
      assert.equal(JSON.parse(readFileSync(path.join(out, 'summary.json'))).ok, true);
      assert.match(readFileSync(path.join(out, 'summary.txt'), 'utf8'), /SKIP optional/);
      assert.doesNotMatch(readFileSync(path.join(out, 'summary.json'), 'utf8'), /SECRET/);
      assert.equal(readFileSync(path.join(out, 'walkthrough.png'), 'utf8'), 'synthetic screenshot');
    });
  });
}

test('missing result and an exception produce a failed summary without leaking the exception', async () => {
  await withOwnedTempDir('whale-source-evidence-test-', async root => {
    const dirs = { resultPath: path.join(root, 'missing'), userData: root };
    const out = path.join(root, 'out');
    writeSourceQaEvidence(dirs, out, { error: new Error('SECRET token in startup log') });
    const raw = readFileSync(path.join(out, 'summary.json'), 'utf8');
    assert.equal(JSON.parse(raw).ok, false);
    assert.doesNotMatch(raw, /SECRET/);
    assert.equal(existsSync(path.join(out, 'walkthrough.png')), false);
    writeSourceQaEvidence(dirs, undefined);
    assert.deepEqual(readdirSync(root), ['out']);
  });
});
