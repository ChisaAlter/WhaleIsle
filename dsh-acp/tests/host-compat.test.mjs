import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { patchLlm, patchCompaction, prepare } from '../tools/host-compat/context-owner.mjs';

const hostPackage = process.env.DSH_COMPAT_HOST_PACKAGE;
if (!hostPackage) throw new Error('Set DSH_COMPAT_HOST_PACKAGE to the supported DSH CLI package.json.');
const req = createRequire(fs.realpathSync(hostPackage));
async function patchedModule(name, patch) {
  const file = req.resolve(name);
  const source = patch(fs.readFileSync(file, 'utf8'))
    .replace(/from "(@[^"]+)"/g, (_, spec) => `from ${JSON.stringify(pathToFileURL(req.resolve(spec)).href)}`)
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { LlmRuntime } = await patchedModule('@deepseek-ai/dsh-llm', patchLlm);
const { BasicCompactionEngine } = await patchedModule('@deepseek-ai/dsh-compaction-basic', patchCompaction);

test('actual host normalizer preserves validated context ownership without inventing capacity', () => {
  const llm = Object.create(LlmRuntime.prototype);
  const registration = { provider: { id: 'acp:test' } };
  const input = { provider: 'acp:test', id: 'model', name: 'Model', contextManagement: 'provider' };
  const info = llm.normalizeModelInfo(registration, 'model', input);
  assert.equal(info.contextManagement, 'provider');
  assert.equal(info.context, undefined);
  assert.throws(() => llm.normalizeModelInfo(registration, 'model', { ...input, contextManagement: 'ignore' }), /invalid context management/);
  assert.equal(llm.normalizeModelInfo(registration, 'model', { ...input, contextManagement: undefined }).contextManagement, undefined);
});

test('actual host compaction skips native agent context but retains ordinary LLM capacity guards', async () => {
  let managed = true, capacity;
  const header = { config: { provider: 'acp:test', model: 'model' } };
  const agent = { session: { seq: 0, requestHeader: () => header } };
  const noMutation = () => { throw Error('Managed history must not be pruned or summarized'); };
  const engine = Object.assign(Object.create(BasicCompactionEngine.prototype), {
    config: { modelPolicies: [], thresholdRatio: 0.8, headroomTokens: 0, retainRatio: 0.2, maxTokens: 32 },
    ctx: {
      llm: { resolveModelInfo: async () => ({ ...(managed ? { contextManagement: 'provider' } : {}), ...(capacity ? { context: { contextWindow: capacity } } : {}) }) },
      tokenMeter: { measure: () => ({ totalTokens: 10 }) },
      get: () => ({ pruneSession: noMutation }),
    },
    compactRegion: noMutation,
  });
  const signal = new AbortController().signal;
  assert.equal(await engine.compactPressure(agent, header, signal, true), null);
  assert.equal(await engine.compactIfNeeded(agent, 'context-overflow', signal), null);
  await assert.rejects(engine.summarize({}, agent, signal), /manages its own context/);
  managed = false;
  await assert.rejects(engine.compactPressure(agent, header, signal, true), /no context capacity/);
  capacity = 4096;
  assert.equal(await engine.compactPressure(agent, header, signal, true), null);
});

test('compatibility preparation is write-once and rejects unknown builds without output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-host-compat-'));
  try {
    const output = path.join(root, 'prepared');
    assert.equal(prepare(hostPackage, output).length, 2);
    const original = fs.readFileSync(path.join(output, 'llm.original.js'), 'utf8');
    assert.throws(() => prepare(hostPackage, output), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(output, 'llm.original.js'), 'utf8'), original);
    assert.throws(() => patchCompaction('unknown build'), /Unsupported host module/);
    assert.throws(() => patchLlm('const context = resolved.context; const context = resolved.context;'), /Unsupported host module/);
    const unknownHost = path.join(root, 'unknown-host');
    const unknownLlm = path.join(unknownHost, 'node_modules/@deepseek-ai/dsh-llm');
    fs.mkdirSync(unknownLlm, { recursive: true });
    fs.writeFileSync(path.join(unknownHost, 'package.json'), '{}');
    fs.writeFileSync(path.join(unknownLlm, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm', version: '99.0.0' }));
    const rejected = path.join(root, 'rejected');
    assert.throws(() => prepare(path.join(unknownHost, 'package.json'), rejected), /Unsupported .* version/);
    assert.equal(fs.existsSync(rejected), false);
    const partial = path.join(root, 'partial');
    const write = fs.writeFileSync;
    let writes = 0;
    const mock = t.mock.method(fs, 'writeFileSync', (...args) => {
      if (++writes === 2) throw Error('Simulated disk write failure');
      return write(...args);
    });
    assert.throws(() => prepare(hostPackage, partial), /disk write failure/);
    mock.mock.restore();
    assert.equal(fs.existsSync(partial), false, 'failed preparation removes only its own partial output');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
