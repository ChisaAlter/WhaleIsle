'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetChat, PERSONA_PROMPTS, HISTORY_TURNS, personaPrompt } = require('./pet-chat');

function okFetch(reply = '好呀') {
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: reply } }] }),
  });
}

test('chat without credentials short-circuits to no-credentials', async () => {
  const pc = createPetChat({ getCreds: () => ({}) });
  const res = await pc.chat({ text: '你好' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-credentials');
});

test('chat refuses a cleartext off-host baseUrl before any fetch', async () => {
  let fetched = false;
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'sk-test', baseUrl: 'http://gateway.example.com' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
  });
  const res = await pc.chat({ text: '你好' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'cleartext-base-url');
  assert.equal(fetched, false);
});

test('chat still uses a loopback http gateway', async () => {
  let seen = null;
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:8080/v1' }),
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '在' } }] }) };
    },
  });
  const res = await pc.chat({ text: '你好' });
  assert.equal(res.ok, true);
  assert.equal(seen.url, 'http://127.0.0.1:8080/v1/chat/completions');
});

test('chat posts to baseUrl/chat/completions with persona system prompt', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '尾巴摇摇' } }] }) };
  };
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1/' }),
    fetchImpl,
  });
  const res = await pc.chat({ text: '今天吃什么', personality: 'tsundere' });
  assert.equal(res.ok, true);
  assert.equal(res.reply, '尾巴摇摇');
  assert.equal(seen.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[0].content.includes('傲娇'));
  assert.equal(body.messages.at(-1).content, '今天吃什么');
});

test('history window keeps at most HISTORY_TURNS pairs', async () => {
  let lastBody = null;
  const fetchImpl = async (url, init) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '嗯' } }] }) };
  };
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl,
  });
  for (let i = 0; i < HISTORY_TURNS + 3; i += 1) {
    await pc.chat({ text: `第${i}句` });
  }
  // system + at most 6 pairs + current user message
  assert.equal(lastBody.messages.length, 1 + HISTORY_TURNS * 2 + 1);
  // Trim happens post-push, so on the last call the window holds pairs 2..7
  // and the oldest retained user line is 第2句.
  assert.equal(lastBody.messages[1].content, '第2句');
});

test('failed responses do not enter history', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, json: async () => ({ choices: [{ message: { content: '回' } }] }) };
  };
  const pc = createPetChat({ getCreds: () => ({ apiKey: 'k' }), fetchImpl });
  await pc.chat({ text: '失败句' });
  let seenBody;
  const peek = async (url, init) => { seenBody = JSON.parse(init.body); return okFetch()(url, init); };
  const pc2 = createPetChat({ getCreds: () => ({ apiKey: 'k' }), fetchImpl: peek });
  await pc2.chat({ text: 'a' });
  assert.equal(seenBody.messages.length, 2); // system + user, no stale pair
});

test('reply is trimmed and capped', async () => {
  const long = ` ${'长'.repeat(300)} `;
  const pc = createPetChat({ getCreds: () => ({ apiKey: 'k' }), fetchImpl: okFetch(long) });
  const res = await pc.chat({ text: 'hi' });
  assert.equal(res.ok, true);
  assert.equal(res.reply.length, 240);
});

test('abort/timeout maps to a clean reason', async () => {
  const fetchImpl = () => new Promise((_, rej) => {
    const e = new Error('aborted'); e.name = 'AbortError';
    setTimeout(() => rej(e), 5);
  });
  const pc = createPetChat({ getCreds: () => ({ apiKey: 'k' }), fetchImpl });
  const res = await pc.chat({ text: 'hi' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'timeout');
});

test('look without a configured vision model is a clean no', async () => {
  const pc = createPetChat({ getCreds: () => ({ apiKey: 'k' }) });
  const res = await pc.look({ image: 'aGk=' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-vision-model');
});

test('look posts an image_url message when a model is configured', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '屏幕有点乱' } }] }) };
  };
  const pc = createPetChat({ getCreds: () => ({ apiKey: 'k' }), fetchImpl, lookModel: 'vision-x' });
  const res = await pc.look({ image: 'aGk=', personality: 'poison' });
  assert.equal(res.ok, true);
  assert.equal(seen.model, 'vision-x');
  const content = seen.messages[1].content;
  assert.equal(content[0].type, 'image_url');
  assert.ok(content[0].image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.ok(seen.messages[0].content.includes('毒舌'));
});

test('look accepts a model getter so settings edits take effect live', async () => {
  let current = '';
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '看到了' } }] }) };
  };
  const pc = createPetChat({ getCreds: () => ({ apiKey: 'k' }), fetchImpl, lookModel: () => current });
  assert.equal((await pc.look({ image: 'aGk=' })).reason, 'no-vision-model');
  current = '  vis-live  ';
  const res = await pc.look({ image: 'aGk=' });
  assert.equal(res.ok, true);
  assert.equal(seen.model, 'vis-live'); // getter output is trimmed too
});

test('every personality has a persona prompt', () => {
  for (const p of ['natural', 'genki', 'tsundere', 'poison']) {
    assert.ok(PERSONA_PROMPTS[p].includes('鲸鱼娘'));
  }
});

// ── whale settings on the offline path ──
// The legacy direct call is still her: when the harness is down the prompt
// must carry the configured name, user title and extra persona instead of a
// stock 「鲸鱼娘」.

test('personaPrompt applies the whale settings name, title and extra persona', () => {
  const prompt = personaPrompt('natural', {
    name: '吃白饭的', userTitle: '爸爸', personaText: '爱喝汽水',
  });
  assert.ok(prompt.startsWith('你是吃白饭的，一只住在用户桌面上的软萌小鲸鱼'));
  assert.ok(prompt.includes('你称呼用户为「爸爸」。'));
  assert.ok(prompt.includes('用户给你的额外人设：爱喝汽水'));
  // The pet's own select is the single control — it wins over the catalog
  // value, which can lag while a mirror write is parked.
  const styled = personaPrompt('natural', { personality: 'poison' });
  assert.ok(styled.includes('软萌'));
  // Catalog personality is the fallback when the pet's value is invalid.
  const catalogWins = personaPrompt('bogus', { personality: 'poison' });
  assert.ok(catalogWins.includes('毒舌'));
  // No settings → the stock prompt stays byte-identical.
  assert.equal(personaPrompt('genki', undefined), PERSONA_PROMPTS.genki);
  assert.equal(personaPrompt('genki', {}), PERSONA_PROMPTS.genki);
});

test('the legacy chat fallback sends the configured persona as the system message', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '嗯' } }] }) };
  };
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl,
    getWhaleSettings: () => ({ name: '吃白饭的', userTitle: '爸爸' }),
  });
  const res = await pc.chat({ text: '你叫什么' });
  assert.equal(res.ok, true);
  assert.equal(seen.messages[0].role, 'system');
  assert.ok(seen.messages[0].content.includes('你是吃白饭的'));
  assert.ok(seen.messages[0].content.includes('你称呼用户为「爸爸」'));
});

// ── whale shared-session path ──
// The card talks to her persistent session through whale.post('pet/chat').
// Session-layer failures must surface honestly (via:'whale'); only a
// transport miss may fall back to the legacy REST call.

function whaleStub(behavior) {
  const calls = [];
  return {
    calls,
    whale: {
      enabled: () => true,
      post: async (endpoint, payload, timeoutMs) => {
        calls.push({ endpoint, payload, timeoutMs });
        return behavior(endpoint, payload);
      },
    },
  };
}

test('chat preserves the text after character 200 and visibly rejects over-limit input', async () => {
  const { whale, calls } = whaleStub(() => ({ ok: true, value: { ok: true, reply: '收到' } }));
  const pc = createPetChat({ whale });
  const text = '甲'.repeat(200) + '重要结尾';
  assert.equal((await pc.chat({ text })).ok, true);
  assert.equal(calls[0].payload.text, text);
  assert.equal((await pc.chat({ text: '甲'.repeat(2001) })).reason, 'input-too-long');
  assert.equal(calls.length, 1);
});

test('failed whale turns retain their partial reply without reporting success', async () => {
  const { whale } = whaleStub(() => ({ ok: true, value: { ok: false, error: 'turn-error', reply: '完成了第一步' } }));
  const res = await createPetChat({ whale }).chat({ text: '执行任务' });
  assert.equal(res.ok, false);
  assert.equal(res.reply, '完成了第一步');
  assert.equal(res.reason, 'turn-error');
});

test('whale path: ok reply returns via:whale and never touches fetch', async () => {
  let fetched = false;
  const { whale, calls } = whaleStub(() => ({ ok: true, value: { ok: true, reply: ' 在呢 ' } }));
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale,
  });
  const res = await pc.chat({ text: '在吗' });
  assert.equal(res.ok, true);
  assert.equal(res.reply, '在呢');
  assert.equal(res.via, 'whale');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, 'pet/chat');
  assert.equal(calls[0].payload.text, '在吗');
  assert.ok(calls[0].timeoutMs > 120000); // must outlive the plugin-side turn wait
  assert.equal(fetched, false);
});

test('whale path: session-level failure is honest, no legacy fork', async () => {
  let fetched = false;
  const { whale } = whaleStub(() => ({ ok: true, value: { ok: false, error: 'turn-error' } }));
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale,
  });
  const res = await pc.chat({ text: 'hi' });
  assert.equal(res.ok, false);
  assert.equal(res.via, 'whale');
  assert.equal(res.reason, 'turn-error');
  assert.equal(fetched, false);
});

test('whale path: endpoint throw (200 + result.ok:false) is honest, not transport', async () => {
  let fetched = false;
  const { whale } = whaleStub(() => ({ ok: false, reason: 'boom' })); // no transport flag
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale,
  });
  const res = await pc.chat({ text: 'hi' });
  assert.equal(res.ok, false);
  assert.equal(res.via, 'whale');
  assert.equal(fetched, false);
});

test('whale path: transport miss falls back to the legacy REST call', async () => {
  let fetched = false;
  const { whale } = whaleStub(() => ({ ok: false, transport: true, reason: 'harness-unavailable' }));
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch('兜底回复')(); },
    whale,
  });
  const res = await pc.chat({ text: '在吗' });
  assert.equal(res.ok, true);
  assert.equal(res.reply, '兜底回复');
  assert.equal(fetched, true);
});

test('whale path: post throwing counts as transport miss and falls back', async () => {
  let fetched = false;
  const { whale } = whaleStub(() => { throw new Error('dead'); });
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch('直连')(); },
    whale,
  });
  const res = await pc.chat({ text: '在吗' });
  assert.equal(res.ok, true);
  assert.equal(res.reply, '直连');
  assert.equal(fetched, true);
});

// ── whale look path ──
// A picked catalog provider can only resolve inside the harness — the
// desktop's own baseUrl cannot express catalog routes — so look() rides
// whale.post('pet/look') and never falls back to legacy REST for it.

test('look dispatches the picked provider+model through whale pet/look', async () => {
  let fetched = false;
  const { whale, calls } = whaleStub(() => ({ ok: true, value: { ok: true, reply: ' 看到了 ' } }));
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale,
  });
  const res = await pc.look({ image: 'aGk=', provider: ' openai ', model: ' gpt-4o ' });
  assert.equal(res.ok, true);
  assert.equal(res.reply, '看到了');
  assert.equal(res.via, 'whale');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, 'pet/look');
  assert.deepEqual(calls[0].payload, { image: 'aGk=', provider: 'openai', model: 'gpt-4o' });
  assert.ok(calls[0].timeoutMs > 45000); // must outlive the plugin-side vision call
  assert.equal(fetched, false);
});

test('look whale endpoint failure is honest and carries detail', async () => {
  let fetched = false;
  const { whale } = whaleStub(() => ({
    ok: true,
    value: { ok: false, error: 'model-error', detail: 'MODEL_NOT_FOUND', status: 404 },
  }));
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale,
  });
  const res = await pc.look({ image: 'aGk=', provider: 'p', model: 'm' });
  assert.equal(res.ok, false);
  assert.equal(res.via, 'whale');
  assert.equal(res.reason, 'model-error');
  assert.ok(res.detail.includes('MODEL_NOT_FOUND'));
  assert.ok(res.detail.includes('404'));
  assert.equal(fetched, false);
});

test('look with a provider + transport miss reports assistant-off, never legacy', async () => {
  let fetched = false;
  const { whale } = whaleStub(() => ({ ok: false, transport: true, reason: 'harness-unavailable' }));
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale,
  });
  const res = await pc.look({ image: 'aGk=', provider: 'p', model: 'm' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'assistant-off');
  assert.equal(fetched, false);
});

test('look with a provider + assistant disabled reports assistant-off', async () => {
  let fetched = false;
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale: { enabled: () => false, post: async () => { throw new Error('unreachable'); } },
  });
  const res = await pc.look({ image: 'aGk=', provider: 'p', model: 'm' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'assistant-off');
  assert.equal(fetched, false);
});

test('look with a provider + endpoint throw stays honest, no legacy fork', async () => {
  let fetched = false;
  const { whale } = whaleStub(() => ({ ok: false, reason: 'boom' })); // answered rejection
  const pc = createPetChat({
    getCreds: () => ({ apiKey: 'k' }),
    fetchImpl: async () => { fetched = true; return okFetch()(); },
    whale,
  });
  const res = await pc.look({ image: 'aGk=', provider: 'p', model: 'm' });
  assert.equal(res.ok, false);
  assert.equal(res.via, 'whale');
  assert.equal(res.reason, 'boom');
  assert.equal(fetched, false);
});
