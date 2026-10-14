// Real native settings API and DSH profile writes with isolated, unpaid models.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createWhaleBridgeService } from '../src/launcher/whalebridge.js';
import { reservePort } from './smoke-workspace.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'whalebridge-model-api-'));
const home = join(dir, 'dsh'); mkdirSync(home);
const port = await reservePort();
const service = createWhaleBridgeService({ root: join(dir, 'component'), dshHome: home, devPackage: join(root, '.tmp/whalebridge-package'),
  spawn: (file, args, options) => spawn(file, args, { ...options, env: { ...options.env, MAGPIE_ADDR: `127.0.0.1:${port}`, USERPROFILE: dir, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), CODEX_HOME: join(dir, 'codex'), CLAUDE_CONFIG_DIR: join(dir, 'claude') } }),
});
let failure;
try {
  const result = await service.install(); assert.ok(result.ok, result.message);
  const url = new URL(service.state().url);
  const cookie = `magpie_web_${url.port}=${url.searchParams.get('k')}`;
  const api = async (route, body) => {
    const res = await fetch(`${url.origin}/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok(res.ok, await res.clone().text()); return res.json();
  };
  const modelIDs = ['gpt-6.1-sol', 'claude-opus-5-5', 'gemini-3.7-flash', 'cursor-grok-4.7', 'muse-spark-1.3-contributor', 'hy3-paid', 'hy4-preview', 'custom-model'];
  await api('provider', { name: 'QA Channel', chat: 'http://127.0.0.1:1/v1', key: 'unpaid-qa', models: modelIDs });
  await api('provider', { name: 'Other Channel', chat: 'http://127.0.0.1:1/v1', key: 'unpaid-qa-other', models: ['keep'] });
  await api('group', { id: 'qa-route', name: 'QA Route', members: ['qa-channel/gpt-6.1-sol'], routing: 'order' });
  const initial = await api('state');
  for (const [model, supplier] of [['gpt-6.1-sol', 'openai'], ['claude-opus-5-5', 'anthropic'], ['gemini-3.7-flash', 'google'], ['cursor-grok-4.7', 'xai'], ['muse-spark-1.3-contributor', 'meta'], ['hy3-paid', 'tencent'], ['hy4-preview', 'tencent']]) {
    const row = initial.models.find(m => m.id === `qa-channel/${model}`);
    assert.equal(row.channelId, 'qa-channel'); assert.equal(row.channelName, 'QA Channel');
    assert.equal(row.supplierId, supplier); assert.ok(row.supplierName);
  }
  assert.equal(initial.models.find(m => m.id === 'group/qa-route').channelName, '路由组');
  assert.ok(!JSON.stringify(initial).includes('unpaid-qa'), 'source metadata never exposes credentials');
  await api('models/hidden', { id: 'other-channel/keep', hidden: true });
  const targets = ['qa-channel/gpt-6.1-sol', 'qa-channel/claude-opus-5-5'];
  await api('models/hidden', { ids: targets, hidden: true });
  const hidden = await api('state');
  assert.deepEqual(hidden.hidden.map(m => m.id).sort(), [...targets, 'other-channel/keep'].sort());
  const profile = join(home, 'profiles/web/cordis.patch.yml');
  assert.ok(!readFileSync(profile, 'utf8').includes('qa-channel/gpt-6.1-sol'));
  await api('models/hidden', { ids: targets, hidden: false });
  assert.deepEqual((await api('state')).hidden.map(m => m.id), ['other-channel/keep']);
  assert.ok(readFileSync(profile, 'utf8').includes('qa-channel/gpt-6.1-sol'));
  assert.equal((await service.stop()).ok, true);
  assert.equal((await service.start()).ok, true);
  const saved = await service.api('status'); assert.equal(saved.models, initial.models.length - 1);
  console.log('PASS native source grouping, single/bulk updates, preservation of unrelated visibility, DSH sync and persistence after restart');
} catch (error) {
  failure = error; console.error(error); throw error;
} finally {
  if (service.state()) { const stopped = await service.stop(); assert.ok(stopped.ok, stopped.message); }
  const rel = relative(tmpdir(), dir); assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
  try { rmSync(dir, { recursive: true, force: true }); }
  catch (error) { if (failure) console.error('Cleanup also failed:', error.message); else throw error; }
}
