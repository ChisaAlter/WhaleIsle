import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { apiEndpoint, requestApi, wavChunks } from '../lib/api.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Optional read-only reuse of an installed Harness for cross-version acceptance.
const harness = process.env.DSH_DEEPSEEK_TEST_HARNESS_ROOT || join(root, 'vendor/deepseek-harness');
const require = createRequire(join(harness, 'apps/cli/package.json'));
const { createLaunchEnvironmentSnapshot } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-launch-environment')).href);
const { LlmAdapter, createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
const { runProfile, prepareProfile, disposeProfileApplication } = await import(pathToFileURL(join(harness, 'apps/cli/lib/profile-boot.js')).href);
const { ensureDesktopDeepSeekTools } = require(join(root, 'src/main/deepseek-tools-desktop.js'));

function wav() {
  const data = Buffer.alloc(44 + 2400 * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(24000, 24); data.writeUInt32LE(48000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}

async function removeOwned(root, profileDir) {
  assert.ok(resolve(root).startsWith(join(tmpdir(), 'whale-deepseek-tools-')));
  const link = join(profileDir, 'node_modules/dsh-deepseek-tools');
  if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link);
  await rm(root, { recursive: true, force: true });
}

test('streaming WAV validation rejects truncated or non-audio responses', async () => {
  const signal = new AbortController().signal;
  const collect = async bytes => { const result = []; for await (const chunk of wavChunks((async function* () {
    for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7);
  })(), signal)) result.push(chunk); return Buffer.concat(result); };
  assert.deepEqual(await collect(wav()), wav());
  await assert.rejects(collect(wav().subarray(0, 100)), /incomplete/);
  await assert.rejects(collect(Buffer.from('{"error":"busy"}')), /invalid WAV/);
  assert.equal(apiEndpoint('https://api.deepseek.com/v1/tools/', 'tts'), 'https://api.deepseek.com/v1/tools/tts');
  assert.throws(() => apiEndpoint('https://user:secret@example.com', 'tts'), /without credentials/);
  const invalid = await requestApi({ baseURL: 'http://127.0.0.1:1', operation: 'tts', apiKeyEnv: 'QA_KEY',
    signal, body: {}, credentials: { resolve: async () => ({ value: 'invalid\ncredential' }) } }).catch(error => error);
  assert.match(invalid.message, /not a valid API key/);
  assert.doesNotMatch(invalid.message, /invalid\ncredential/);
});

test('real web profile: persistent settings, native tools, file permissions, streamed attachments and cancellation', { timeout: 180000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'whale-deepseek-tools-'));
  const home = join(scratch, 'home'), profileDir = join(home, 'profiles/web');
  const oldEnv = { DSH_HOME: process.env.DSH_HOME, DSHD_DEEPSEEK_TOOLS_ENABLED: process.env.DSHD_DEEPSEEK_TOOLS_ENABLED, DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED, DSHD_PROFILE_DEFAULT_PATCH: process.env.DSHD_PROFILE_DEFAULT_PATCH };
  Object.assign(process.env, { DSH_HOME: home, DSHD_DEEPSEEK_TOOLS_ENABLED: '1', DSH_TELEMETRY_DISABLED: '1' });
  let ctx;
  let current = 'ok';
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (current === 'unauthorized') { res.writeHead(401); res.end('do not expose this body'); return; }
    if (current === 'redirect') { res.writeHead(307, { location: '/redirect-target' }); res.end(); return; }
    if (current === 'wait') { req.socket.on('close', () => res.destroy()); return; }
    if (req.url === '/v1/tools/tts') {
      res.writeHead(200, { 'content-type': 'audio/wav' });
      const bytes = current === 'truncated' ? wav().subarray(0, 100) : wav();
      res.write(bytes.subarray(0, 18)); res.end(bytes.subarray(18)); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('asr') ? { request_id: 'qa', text: '测试音频', duration_ms: 100 }
      : { id: 'ocr-qa', object: 'ocr.result', page_count: 2, pages: [
        { index: 0, text: '文档正文'.repeat(9000), finish_reason: 'stop' },
        { index: 1, text: 'incomplete page', finish_reason: 'length' },
      ], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    console.log('DeepSeek integration: disposing profile');
    if (ctx) {
      await ctx.loader.await();
      // Let startup's post-Loader observers settle before tearing down this just-restarted profile.
      await new Promise(done => setTimeout(done, 100));
    }
    await disposeProfileApplication(ctx);
    console.log('DeepSeek integration: closing protocol server');
    server.closeAllConnections(); await new Promise(done => server.close(done));
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await removeOwned(scratch, profileDir);
    console.log('DeepSeek integration: owned scratch removed');
  });
  await mkdir(home, { recursive: true });
  if (process.env.DSH_DEEPSEEK_TEST_HARNESS_ROOT) {
    // An installed runtime predates this PR's base row. Supply the same row
    // through its supported desktop-default layer, beneath profile settings.
    const defaults = join(scratch, 'application-tools.patch.yml');
    await writeFile(defaults, '- insert:\n    - id: dsh-deepseek-tools\n      name: dsh-deepseek-tools\n');
    process.env.DSHD_PROFILE_DEFAULT_PATCH = defaults;
  }
  prepareProfile('web');
  const mount = ensureDesktopDeepSeekTools({ sourceDir: join(root, 'vendor/dsh-deepseek-tools'), profileDir });
  assert.equal(mount.ok, true, mount.error);
  const launch = async () => (await runProfile({ profile: 'web', patchFiles: [], args: ['--no-open', '--port', '0'], environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...process.env } }]) })).ctx;
  ctx = await launch();
  console.log('DeepSeek integration: initial profile ready');
  const state = () => ctx.settings.describe().find(row => row.ns === 'dsh-deepseek-tools');
  assert.ok(state(), 'the actual shipped web profile serves the application settings namespace');
  assert.equal(ctx.tools.schemas().some(tool => tool.name === 'deepseek_tts'), false);
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/tools`;
  await ctx.credentials.set('WHALE_DEEPSEEK_QA_KEY', 'qa-credential');
  await ctx.settings.update('dsh-deepseek-tools', { baseURL: endpoint, apiKeyEnv: 'WHALE_DEEPSEEK_QA_KEY', tts: true, asr: true, ocr: true, voice: 'tide' }, state().revision);
  for (const name of ['deepseek_tts', 'deepseek_asr', 'deepseek_ocr']) assert.ok(ctx.tools.schemas().some(tool => tool.name === name), name);
  const signal = new AbortController().signal;
  let number = 0;
  const execute = async (name, args, callerSignal = signal) => {
    const callId = `qa-${++number}`;
    // Current main uses the plugin-owned batch executor; this branch's pinned
    // Harness still has the single-call registry. Exercise each real entry point.
    if (typeof ctx.tools.setExecutor === 'function') {
      const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }], signal: callerSignal });
      return batch.results[0].result;
    }
    return ctx.tools.execute({ callId, name, arguments: args, signal: callerSignal });
  };
  const spoken = await execute('deepseek_tts', { text: '你好，鲸屿。' });
  assert.equal(spoken.isError, false, JSON.stringify(spoken));
  assert.deepEqual(await readFile(spoken.value.path), wav());
  assert.equal(spoken.content[0].type, 'file');
  assert.equal(JSON.parse(requests.at(-1).body).voice_id, 'tide');
  assert.equal(requests.at(-1).headers.authorization, 'Bearer qa-credential');
  // Exercise the model-facing contract through the real Agent loop; only external model decisions are scripted.
  let sawSchema = false, sawAudio = false;
  class SpeechModel extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(options) {
      const toolResult = options.messages.findLast(message => message.role === 'tool');
      if ((options.tools ?? []).some(tool => tool.name === 'deepseek_tts')) {
        sawSchema = true;
        if (!toolResult) {
          yield* [{ type: 'block-start', index: 0, blockType: 'tool-call' },
            { type: 'tool-call-delta', index: 0, id: 'qa-speech', name: 'deepseek_tts', argumentsDelta: '{"text":"鲸屿语音测试"}' },
            { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'qa-speech', name: 'deepseek_tts', arguments: '{"text":"鲸屿语音测试"}' } },
            { type: 'finish', reason: { kind: 'tool-calls' } }];
          return;
        }
        // Provider assembly projects durable file blocks to read-only file-handle text.
        sawAudio = toolResult.content.some(block => block.type === 'text' && block.text.includes('deepseek-speech.wav'));
      }
      yield* [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '音频已生成。' },
        { type: 'block-end', index: 0, block: { type: 'text', text: '音频已生成。' } }, { type: 'finish', reason: { kind: 'stop' } }];
    }
  }
  ctx.llm.registerAdapter(['speech-qa'], new SpeechModel());
  const handle = await ctx.agents.create({ sessionId: 'deepseek-speech-qa', meta: { cwd: scratch }, agentOptions: { provider: 'speech-qa', model: 'speech-model' } });
  try {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '请生成语音' }], source: { kind: 'user' } }));
    await handle.agent.whenIdle();
    assert.equal(sawSchema, true, 'the real model request includes the configured TTS tool');
    assert.equal(sawAudio, true, 'the real Agent calls TTS and receives the saved audio handle');
  } finally { await handle.dispose(); }
  await writeFile(join(scratch, 'audio.wav'), wav());
  const asr = await execute('deepseek_asr', { file_path: join(scratch, 'audio.wav') });
  assert.equal(asr.isError, false, JSON.stringify(asr)); assert.equal(asr.value.text, '测试音频');
  assert.match(requests.at(-1).headers['content-type'], /^multipart\/form-data; boundary=/);
  await writeFile(join(scratch, 'document.pdf'), '%PDF-1.7\nqa');
  const ocr = await execute('deepseek_ocr', { file_path: join(scratch, 'document.pdf'), purpose: 'rich_layout_recognition' });
  assert.equal(ocr.isError, false, JSON.stringify(ocr)); assert.equal(ocr.value.truncated, true);
  assert.equal(ocr.value.pages[0].text.length, 24000);
  assert.equal(JSON.parse(await readFile(ocr.value.path, 'utf8')).pages[1].finish_reason, 'length');
  assert.ok(requests.at(-1).body.indexOf('rich_layout_recognition') < requests.at(-1).body.indexOf('filename='));
  const beforeBadInput = requests.length;
  assert.equal((await execute('deepseek_tts', { text: '鲸'.repeat(5001) })).isError, true);
  assert.equal((await execute('deepseek_asr', { file_path: join(scratch, 'absent.wav') })).isError, true);
  assert.equal(requests.length, beforeBadInput);
  current = 'truncated';
  assert.equal((await execute('deepseek_tts', { text: 'cut off' })).isError, true);
  current = 'unauthorized';
  const denied = await execute('deepseek_tts', { text: 'denied' });
  assert.equal(denied.isError, true); assert.match(denied.error.message, /401/); assert.doesNotMatch(JSON.stringify(denied), /do not expose|qa-credential/);
  current = 'redirect';
  assert.equal((await execute('deepseek_tts', { text: 'redirect' })).isError, true);
  assert.equal(requests.some(row => row.url === '/redirect-target'), false);
  current = 'wait';
  const cancellation = new AbortController();
  const pending = execute('deepseek_tts', { text: 'cancel' }, cancellation.signal);
  setTimeout(() => cancellation.abort(), 80);
  assert.equal((await pending).isError, true);
  current = 'ok';
  await ctx.settings.update('dsh-deepseek-tools', { tts: false }, state().revision);
  assert.equal(ctx.tools.schemas().some(tool => tool.name === 'deepseek_tts'), false);
  assert.equal((await execute('deepseek_tts', { text: 'disabled' })).isError, true);
  const patch = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /apiKeyEnv: WHALE_DEEPSEEK_QA_KEY/); assert.doesNotMatch(patch, /qa-credential/);
  await disposeProfileApplication(ctx); ctx = undefined;
  ctx = await launch();
  console.log('DeepSeek integration: restarted profile ready');
  assert.equal(state().value.voice, 'tide'); assert.equal(state().value.tts, false); assert.equal(state().value.asr, true);
  assert.ok(ctx.tools.schemas().some(tool => tool.name === 'deepseek_asr'));
  console.log('DeepSeek integration: persisted settings and tools confirmed');
  if (process.env.DSH_DEEPSEEK_UI_QA === '1') {
    const env = { ...process.env };
    const outcome = await new Promise((done, reject) => {
      const uiUrl = ctx.connection.authenticatedUrl(ctx.webApp.getAdvertisedUrl());
      const child = spawn(process.execPath, [join(root, 'vendor/dsh-deepseek-tools/tests/ui-qa.mjs'), uiUrl, join(scratch, 'browser'), process.env.DSH_DEEPSEEK_QA_EVIDENCE || ''], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      child.on('error', reject); child.on('exit', code => done({ code, output }));
    });
    console.log(outcome.output); assert.equal(outcome.code, 0, outcome.output);
  }
});
