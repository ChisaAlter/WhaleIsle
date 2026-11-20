'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  sanitizeIconUrl,
  normalizeWaterfallFrame,
  buildSettlementOutcome,
  createApprovalWireClient,
} = require('./wire');

class FakeWebSocket extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
}
FakeWebSocket.instances = [];

test('sanitizeIconUrl allows small base64 data images and same-origin loopback URLs only', () => {
  const origin = 'http://127.0.0.1:3080';
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(sanitizeIconUrl(tinyPng, origin), tinyPng);
  assert.equal(sanitizeIconUrl('http://127.0.0.1:3080/api/icon.png', origin), 'http://127.0.0.1:3080/api/icon.png');
  assert.equal(sanitizeIconUrl('http://127.0.0.1:9999/api/icon.png', origin), undefined);
  assert.equal(sanitizeIconUrl('https://evil.example/icon.png', origin), undefined);
  assert.equal(sanitizeIconUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', origin), undefined);
  const huge = `data:image/png;base64,${Buffer.alloc(65 * 1024, 1).toString('base64')}`;
  assert.equal(sanitizeIconUrl(huge, origin), undefined);
});

test('normalizeWaterfallFrame parses tool-approval, permission-approval, and plan-review while ignoring ordinary questions', () => {
  const origin = 'http://127.0.0.1:3080';
  const tool = normalizeWaterfallFrame({
    type: 'waterfall',
    event: 'approval/request',
    eventId: 'e-tool',
    agentId: 's-1',
    request: {
      toolName: 'bash',
      callId: 'c-1',
      reason: 'Execute shell command',
      displayReason: { zh: '执行 Shell 命令', en: 'Execute shell command' },
      requester: {
        sessionId: 'child-1',
        label: 'Build Agent',
        call: { callId: 'c-1', name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) },
      },
    },
  }, { origin, connectionEpoch: 1, now: 100 });
  assert.equal(tool?.item.kind, 'tool-approval');
  assert.equal(tool?.item.commandPreview, 'npm test');
  assert.equal(tool?.item.requester?.label, 'Build Agent');
  assert.deepEqual(buildSettlementOutcome(tool.recipe, 'allow-once'), { kind: 'result', value: 'allowed-once' });
  assert.deepEqual(buildSettlementOutcome(tool.recipe, 'reject'), { kind: 'result', value: 'rejected' });

  const perm = normalizeWaterfallFrame({
    type: 'waterfall',
    event: 'user-questions/request',
    eventId: 'e-perm',
    agentId: 's-2',
    request: {
      questions: [{
        id: 'cua-1',
        question: 'Allow controlling Safari?',
        intent: {
          kind: 'approval',
          approve: 'Allow once',
          reject: 'Deny',
          always: 'Always allow',
          subject: { name: 'Safari', icon: 'https://external.example/bad.png' },
          display: {
            question: { zh: '允许控制 Safari？', en: 'Allow controlling Safari?' },
            approve: { zh: '允许本次', en: 'Allow once' },
          },
        },
      }],
    },
  }, { origin, connectionEpoch: 1, now: 100 });
  assert.equal(perm?.item.kind, 'permission-approval');
  assert.equal(perm?.item.capabilities.allowAlways, true);
  assert.equal(perm?.item.subject?.icon, undefined, 'external subject icon URL is stripped');
  assert.deepEqual(buildSettlementOutcome(perm.recipe, 'allow-always'), {
    kind: 'result',
    value: { answers: [{ id: 'cua-1', selected: ['Always allow'] }] },
  });

  const plan = normalizeWaterfallFrame({
    type: 'waterfall',
    event: 'user-questions/request',
    eventId: 'e-plan',
    agentId: 's-3',
    request: {
      questions: [{
        id: 'plan-q',
        question: 'Approve plan?',
        detail: '# Upgrade Build Pipeline\n- Step 1: update config\n- Step 2: verify tests',
        options: [{ label: 'Approve plan' }],
        intent: { kind: 'plan-review', approve: 'Approve plan' },
      }],
    },
  }, { origin, connectionEpoch: 1, now: 100 });
  assert.equal(plan?.item.kind, 'plan-review');
  assert.equal(plan?.item.title.fallback, 'Upgrade Build Pipeline');
  assert.equal(plan?.item.capabilities.requestChanges, true);
  assert.deepEqual(buildSettlementOutcome(plan.recipe, 'request-changes'), {
    kind: 'rejected',
    error: {
      name: 'UserQuestionError',
      code: 'ASK_CANCELLED',
      message: 'the user cancelled ask_user_question',
    },
  });

  const ordinaryQuestion = normalizeWaterfallFrame({
    type: 'waterfall',
    event: 'user-questions/request',
    eventId: 'e-ask',
    agentId: 's-4',
    request: {
      wait: { callId: 'w-1', timed: true },
      questions: [{ id: 'q1', question: 'Pick a color', options: [{ label: 'Red' }, { label: 'Blue' }] }],
    },
  }, { origin });
  assert.equal(ordinaryQuestion, null, 'ordinary timed ask_user_question is ignored');
});

test('wire client multiplexes streams, ignores ordinary ask_user without sending next, settles with exact 3 keys, and aborts enrichment on cancel', async () => {
  FakeWebSocket.instances = [];
  const rpcCalls = [];
  let eventsAbortSignal = null;
  const upserts = [];
  const cancels = [];
  const titles = [];

  const client = createApprovalWireClient({
    WebSocketImpl: FakeWebSocket,
    reconcileDelayMs: 10,
    rpcImpl: async (origin, method, args, fetchFn, opts) => {
      rpcCalls.push({ origin, method, args, opts });
      if (method === 'session/events') {
        eventsAbortSignal = opts?.signal || null;
        await fetchFn(`${origin}/api/session/events`, opts?.signal ? { signal: opts.signal } : {});
        return new Promise((_resolve, reject) => {
          eventsAbortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      if (method === 'session/projections') {
        return { values: { title: 'Fallback Title' } };
      }
      return { ok: true };
    },
    fetchImpl: async (_url, init) => {
      eventsAbortSignal = init?.signal || null;
      return /** @type {any} */ ({ ok: true });
    },
    onApprovalUpsert: (item) => upserts.push(item),
    onApprovalCancel: (id) => cancels.push(id),
    onSessionTitles: (map) => titles.push(map),
  });

  client.connect('http://127.0.0.1:3080', 'dsh_session=abc');
  const ws = FakeWebSocket.instances[0];
  assert.equal(ws.url, 'ws://127.0.0.1:3080/api/remote.mux');
  assert.deepEqual(ws.options.headers, { origin: 'http://127.0.0.1:3080', cookie: 'dsh_session=abc' });

  ws.emit('open');
  assert.equal(ws.sent.length, 2);
  const eventsStreamId = ws.sent[0].streamId;
  const controlStreamId = ws.sent[1].streamId;
  assert.equal(ws.sent[0].endpoint, '$events');
  assert.equal(ws.sent[1].endpoint, 'session/control');

  ws.emit('message', JSON.stringify({
    type: 'item',
    streamId: controlStreamId,
    value: {
      type: 'baseline',
      value: { projections: { 's-1': { asOfSeq: 1, values: { title: 'Main Session' } } } },
    },
  }));
  assert.deepEqual(titles[0], { 's-1': 'Main Session' });

  ws.emit('message', JSON.stringify({
    type: 'item',
    streamId: eventsStreamId,
    value: { type: 'ready', clientId: 'client-42', host: { home: '/tmp' } },
  }));

  ws.emit('message', JSON.stringify({
    type: 'item',
    streamId: eventsStreamId,
    value: {
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'evt-ordinary',
      agentId: 's-1',
      request: { questions: [{ id: 'q1', question: 'Plain question' }] },
    },
  }));
  assert.equal(upserts.length, 0);
  assert.equal(rpcCalls.some((c) => c.method === '$events/result'), false, 'never replies next to ordinary ask_user_question');

  ws.emit('message', JSON.stringify({
    type: 'item',
    streamId: eventsStreamId,
    value: {
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'evt-abort',
      agentId: 's-1',
      request: { toolName: 'bash', callId: 'call-99' },
    },
  }));
  await new Promise((r) => setImmediate(r));
  assert.ok(eventsAbortSignal, 'tool-approval without preview fetches session/events');
  assert.equal(eventsAbortSignal.aborted, false);

  ws.emit('message', JSON.stringify({
    type: 'item',
    streamId: eventsStreamId,
    value: { type: 'cancel', eventId: 'evt-abort' },
  }));
  assert.equal(eventsAbortSignal.aborted, true, 'cancel aborts in-flight session/events enrichment');
  assert.deepEqual(cancels, ['evt-abort']);

  ws.emit('message', JSON.stringify({
    type: 'item',
    streamId: eventsStreamId,
    value: {
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'evt-settle',
      agentId: 's-1',
      request: { toolName: 'bash' },
    },
  }));
  await client.settle('evt-settle', 'allow-once');
  const resultCall = rpcCalls.find((c) => c.method === '$events/result');
  assert.ok(resultCall);
  assert.deepEqual(Object.keys(resultCall.args).sort(), ['clientId', 'eventId', 'outcome']);
  assert.deepEqual(resultCall.args, {
    clientId: 'client-42',
    eventId: 'evt-settle',
    outcome: { kind: 'result', value: 'allowed-once' },
  });
  assert.equal(client.hasRecipe('evt-settle'), false);

  client.dispose();
});
