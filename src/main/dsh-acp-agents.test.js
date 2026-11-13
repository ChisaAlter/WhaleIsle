'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const {
  DSH_ACP_AGENTS_PACKAGE,
  DSH_ACP_AGENTS_OVERLAY_FILENAME,
  ensureDesktopAcpAgents,
  withoutAcpAgentsAliases,
} = require('./dsh-acp-agents-desktop');
const {
  BUILTIN_AGENT_PRESETS,
  loadAgentsConfig,
  saveAgentsConfig,
} = require('../../dsh-acp/lib/presets');
const {
  apply: applyAcpAgentsPlugin,
} = require('../../dsh-acp/lib/index');

function createMockAcpServerScript(dir) {
  const scriptPath = path.join(dir, 'mock-acp-server.js');
  const code = `
const readline = require('node:readline');

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let nextServerId = 100;
const pendingServerRequests = new Map();
let turnCount = 0;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n');
}

function sendNotification(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function sendRequest(method, params) {
  const id = nextServerId++;
  return new Promise((resolve, reject) => {
    pendingServerRequests.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.id !== undefined && msg.method === undefined) {
    const pending = pendingServerRequests.get(msg.id);
    if (pending) {
      pendingServerRequests.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    }
    return;
  }

  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: 'mock-acp-agent', version: '1.0.0' },
        agentCapabilities: { loadSession: true },
        authMethods: [],
      },
    });
    return;
  }

  if (method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        sessionId: 'acp_sess_test_1',
        models: {
          currentModelId: 'mock-fast',
          availableModels: [
            { modelId: 'mock-fast', name: 'Mock Fast' },
            { modelId: 'mock-pro', name: 'Mock Pro' },
          ],
        },
        configOptions: [
          {
            id: 'reasoning_effort',
            name: 'Reasoning Effort',
            category: 'thought_level',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
          },
        ],
      },
    });
    return;
  }

  if (method === 'session/set_config_option') {
    send({ jsonrpc: '2.0', id, result: { configOptions: [{
      id: 'reasoning_effort', name: 'Reasoning Effort', category: 'thought_level',
      type: 'select', currentValue: params.value,
      options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }],
    }] } });
    return;
  }

  if (method === 'session/set_model') {
    send({
      jsonrpc: '2.0',
      id,
      result: {},
    });
    return;
  }

  if (method === 'session/prompt') {
    turnCount += 1;
    const sessionId = params.sessionId;
    const promptText = Array.isArray(params.prompt)
      ? params.prompt.map((b) => b.text || '').join('')
      : '';

    sendNotification('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Thinking about: ' + promptText },
      },
    });

    if (turnCount === 1 && promptText.includes('USE_TOOL')) {
      sendNotification('session/update', {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call_acp_1',
          title: 'Edit file src/demo.js',
          kind: 'edit',
          status: 'in_progress',
          rawInput: { path: 'src/demo.js' },
        },
      });

      const perm = await sendRequest('session/request_permission', {
        sessionId,
        toolCall: {
          toolCallId: 'call_acp_1',
          title: 'Write to src/demo.js',
          kind: 'edit',
          status: 'pending',
        },
        options: [
          { optionId: 'opt_allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'opt_reject_once', name: 'Reject once', kind: 'reject_once' },
        ],
      });

      const selectedOption = perm && perm.outcome && perm.outcome.optionId;
      sendNotification('session/update', {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_acp_1',
          title: 'Edit file src/demo.js',
          kind: 'edit',
          status: selectedOption === 'opt_allow_once' ? 'completed' : 'failed',
          rawOutput: 'Permission outcome: ' + selectedOption,
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'Permission outcome: ' + selectedOption,
              },
            },
          ],
        },
      });
    }

    sendNotification('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'Turn ' + turnCount + ' reply for: ' + promptText,
        },
      },
    });

    send({
      jsonrpc: '2.0',
      id,
      result: {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
        },
      },
    });
  }
});
`;
  fs.writeFileSync(scriptPath, code, 'utf8');
  return scriptPath;
}

test('ensureDesktopAcpAgents writes overlay and links dsh-acp package into profile node_modules', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-acp-overlay-'));
  try {
    const result = ensureDesktopAcpAgents({ profileDir: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.ok(result.overlayFile.endsWith(DSH_ACP_AGENTS_OVERLAY_FILENAME));
    assert.equal(fs.existsSync(result.overlayFile), true);
    const overlayText = fs.readFileSync(result.overlayFile, 'utf8');
    assert.match(overlayText, /- id: dsh-acp-agents/);
    assert.match(overlayText, /name: "dsh-acp-agents"/);

    const linkedPkg = path.join(tmpDir, 'node_modules', DSH_ACP_AGENTS_PACKAGE, 'package.json');
    assert.equal(fs.existsSync(linkedPkg), true);

    const second = ensureDesktopAcpAgents({ profileDir: tmpDir });
    assert.equal(second.ok, true);
    assert.equal(second.added, false);

    assert.deepEqual(
      withoutAcpAgentsAliases(['foo', 'dsh-acp-agents', 'bar']),
      ['foo', 'bar'],
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('presets include Claude Code, Codex, Antigravity, and Devin with config persistence', () => {
  const presetIds = BUILTIN_AGENT_PRESETS.map((item) => item.id);
  assert.deepEqual(presetIds, ['claude-code', 'codex', 'antigravity', 'devin']);

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-acp-presets-'));
  const storeFile = path.join(tmpHome, 'acp-agents.json');
  try {
    const initial = loadAgentsConfig(storeFile);
    assert.equal(initial.length, 4);
    assert.equal(initial.every((a) => a.enabled === false), true);

    initial[0].enabled = true;
    saveAgentsConfig(initial, storeFile);

    const reloaded = loadAgentsConfig(storeFile);
    assert.equal(reloaded.find((a) => a.id === 'claude-code').enabled, true);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('host plugin registers dynamic LLM adapter, handles RPC catalog/toggle/test, and streams multi-turn ACP with tool calls and permissions', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-acp-host-'));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmpHome;
  const disposeCallbacks = [];

  try {
    const mockScript = createMockAcpServerScript(tmpHome);
    const registeredAdapters = [];
    const routes = new Map();
    const waterfalls = new Map();
    const approvalCalls = [];
    const fakeDshAgent = {
      id: 'dsh_agent_1',
      session: { id: 'dsh_sess_1', header: { cwd: tmpHome } },
    };

    const mockCtx = {
      baseDir: tmpHome,
      agents: {
        get: id => id === fakeDshAgent.session.id ? fakeDshAgent : undefined,
        currentInitiator: () => fakeDshAgent,
      },
      on(name, fn) {
        if (name === 'dispose') disposeCallbacks.push(fn);
        else waterfalls.set(name, fn);
      },
      effect(fn) {
        const cleanup = fn();
        if (typeof cleanup === 'function') disposeCallbacks.push(cleanup);
      },
      inject(deps, fn) {
        if (deps.every(name => mockCtx[name])) fn(mockCtx);
      },
      tools: {
        canonicalResults: new WeakMap(),
        markCanonical(exec, result) {
          this.canonicalResults.set(result, exec.token);
          return result;
        },
      },
      llm: {
        registerAdapter(providers, adapter) {
          const entry = {
            providers: [...providers],
            adapter,
            replace(nextProviders) {
              entry.providers = [...nextProviders];
            },
            dispose() {},
          };
          registeredAdapters.push(entry);
          return entry;
        },
      },
      webServer: {
        register(spec) {
          routes.set(spec.path, spec.handler);
          return () => routes.delete(spec.path);
        },
      },
      approval: {
        policyOf() { return 'ask'; },
        async request(req) {
          approvalCalls.push(req);
          return 'allowed-once';
        },
      },
      get(serviceName) {
        return this[serviceName];
      },
    };

    const allowedCtxProps = new Set([
      'baseDir',
      'on',
      'effect',
      'inject',
      'get',
      'llm',
      'connection',
      'webServer',
      'tools',
      'approval',
      'agents',
    ]);
    const strictCordisCtx = new Proxy(mockCtx, {
      get(target, prop) {
        if (typeof prop === 'symbol' || allowedCtxProps.has(prop)) {
          return target[prop];
        }
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      },
    });

    applyAcpAgentsPlugin(strictCordisCtx, { storeFile: path.join(tmpHome, 'acp-agents.json') });
    assert.equal(registeredAdapters.length, 0, 'default presets must not enable unconfigured agents');

    const routeHandler = routes.get('/dsh-acp-agents');
    assert.equal(typeof routeHandler, 'function');

    async function callRpc(subpath, body = {}) {
      let statusCode = 200;
      let responseBody = '';
      const envelope = {
        type: 'client-request',
        rpcId: 'test-rpc-1',
        method: subpath,
        payload: body,
      };
      const req = {
        method: 'POST',
        url: `/dsh-acp-agents/${subpath}`,
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify(envelope), 'utf8');
        },
      };
      const res = {
        writeHead(code) {
          statusCode = code;
        },
        end(payload) {
          responseBody = payload;
        },
      };
      await routeHandler(req, res);
      const parsed = JSON.parse(responseBody);
      assert.equal(parsed.type, 'server-response');
      assert.equal(parsed.result.ok, true, parsed.result?.error?.message);
      return { statusCode, data: parsed.result.value };
    }

    // 1. Query catalog
    const catalogRes = await callRpc('catalog');
    assert.equal(catalogRes.statusCode, 200);
    assert.equal(catalogRes.data.agents.length, 4);

    // 2. Save custom command on codex pointing to our mock ACP stdio server
    const saveRes = await callRpc('agent/save', {
      agent: {
        id: 'codex',
        enabled: true,
        registrySource: 'local',
        authMethod: '',
        command: process.execPath,
        args: [mockScript],
        permissionPolicy: 'ask',
      },
    });
    assert.equal(saveRes.statusCode, 200);
    assert.equal(registeredAdapters.length, 1);
    assert.deepEqual(registeredAdapters[0].providers, ['acp:codex']);
    assert.equal(registeredAdapters[0].adapter.providerRetryPolicy('acp:codex').maxRetries, 0);
    assert.deepEqual(registeredAdapters[0].adapter.providerRetryPolicy('acp:codex').retryableCodes, []);
    assert.equal((await registeredAdapters[0].adapter.listModels('acp:codex')).length > 0, true);

    // Auxiliary work must not start an ACP turn or invent a title.
    const titleChunks = [];
    for await (const chunk of registeredAdapters[0].adapter.stream({
      provider: 'acp:codex',
      model: 'mock-fast',
      purpose: 'session-title',
      messages: [{ role: 'user', content: '{"currentTitle":null,"messages":["帮我修复反重力报错"]}' }],
    })) {
      titleChunks.push(chunk);
    }
    assert.equal(
      titleChunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''),
      '',
    );

    // 3. Test ACP handshake endpoint
    const testRes = await callRpc('agent/test', { id: 'codex' });
    assert.equal(testRes.statusCode, 200);
    assert.equal(testRes.data.ok, true, testRes.data.error);
    assert.equal(testRes.data.binaryPath, process.execPath);
    assert.ok(testRes.data.modelsFound >= 2, 'the live probe must discover the fixture model catalog');

    // 4. Multi-turn streaming with tool_call + session/request_permission + tool_call_update
    const adapter = registeredAdapters[0].adapter;
    const preExecuteHook = waterfalls.get('tools/pre-execute');
    const executeHook = waterfalls.get('tools/execute');
    assert.equal(typeof preExecuteHook, 'function');
    assert.equal(typeof executeHook, 'function');

    // Turn 1: prompt with tool call & permission request
    const chunks1 = [];
    for await (const chunk of adapter.stream({
      provider: 'acp:codex',
      model: 'mock-fast',
      agent: fakeDshAgent,
      messages: [{ id: 'user-1', role: 'user', content: 'Hello USE_TOOL please' }],
      reasoningEffort: 'high',
    })) {
      chunks1.push(chunk);
    }

    assert.equal(
      chunks1.some((c) => c.type === 'reasoning-delta' && c.text.includes('Thinking about:') && c.text.includes('Hello USE_TOOL please')),
      true,
      JSON.stringify(chunks1),
    );
    const toolCallChunk = chunks1.find((c) => c.type === 'block-end' && c.block?.type === 'tool-call');
    assert.ok(toolCallChunk, 'expected a tool-call block-end chunk for the ACP tool call');
    assert.equal(chunks1.find((c) => c.type === 'finish')?.reason?.kind, 'tool-calls');

    // Simulate ReactLoopAgent running pre-execute and execute for the tool call
    const parsedArgs = JSON.parse(toolCallChunk.block.arguments);
    const preResult = await preExecuteHook(
      {
        callId: toolCallChunk.block.id,
        name: toolCallChunk.block.name,
        args: parsedArgs,
        agent: fakeDshAgent,
      },
      async () => ({ kind: 'deny' }),
    );
    assert.deepEqual(preResult, { kind: 'allow' });

    const execResult = await executeHook(
      {
        callId: toolCallChunk.block.id,
        name: toolCallChunk.block.name,
        args: parsedArgs,
        agent: fakeDshAgent,
      },
      async () => ({ content: [{ type: 'text', text: 'fallback' }], isError: false }),
    );
    assert.equal(execResult.isError, false, JSON.stringify(execResult));
    assert.match(execResult.content[0].text, /Permission outcome: opt_allow_once/);
    assert.equal(approvalCalls.length, 1);
    assert.equal(approvalCalls[0].callId, 'call_acp_1', 'approval refers to the ACP server tool call');

    // Resume stream in the same turn after tool execution completes
    const chunks1Resume = [];
    for await (const chunk of adapter.stream({
      provider: 'acp:codex',
      model: 'mock-fast',
      agent: fakeDshAgent,
      messages: [
        { id: 'user-1', role: 'user', content: 'Hello USE_TOOL please' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: toolCallChunk.block.id, name: toolCallChunk.block.name, arguments: toolCallChunk.block.arguments }],
        },
        {
          role: 'tool',
          toolCallId: toolCallChunk.block.id,
          content: execResult.content[0].text,
        },
      ],
    })) {
      chunks1Resume.push(chunk);
    }

    const replyText1 = chunks1Resume
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.text)
      .join('');
    assert.match(replyText1, /Turn 1 reply for:[\s\S]*Hello USE_TOOL please/);
    assert.equal(chunks1Resume.find((c) => c.type === 'finish')?.reason?.kind, 'stop');

    // Turn 2: second user message in the same session reuses the persistent ACP connection
    const chunks2 = [];
    for await (const chunk of adapter.stream({
      provider: 'acp:codex',
      model: 'mock-fast',
      agent: fakeDshAgent,
      messages: [
        { id: 'user-1', role: 'user', content: 'Hello USE_TOOL please' },
        { role: 'assistant', content: replyText1 },
        { id: 'user-2', role: 'user', content: 'Second turn question' },
      ],
    })) {
      chunks2.push(chunk);
    }
    const replyText2 = chunks2
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.text)
      .join('');
    assert.match(replyText2, /Turn 2 reply for:[\s\S]*Second turn question/);

  } finally {
    for (const fn of disposeCallbacks.reverse()) await fn();
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('client bundle registers Settings -> Agent and extends the native model menu without replacing it', () => {
  const clientCode = fs.readFileSync(
    path.join(__dirname, '..', '..', 'dsh-acp', 'client', 'client.js'),
    'utf8',
  );
  let capturedEntry = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          capturedEntry = entry;
        },
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      CustomEvent: class CustomEvent {
        constructor(type, init) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
      localStorage: {
        getItem() { return null; },
        setItem() {},
      },
    },
    document: {
      getElementById() { return null; },
      createElement() {
        return { style: {}, appendChild() {} };
      },
      head: { appendChild() {} },
      body: {},
    },
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(clientCode, sandbox);
  assert.ok(capturedEntry, 'window.__ModuleLoader__.load should be called');
  assert.equal(typeof capturedEntry.factory, 'function');

  const registeredSlots = [];
  const fakeModules = {
    react: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      Fragment: 'Fragment',
      useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
      useEffect: () => {},
      useLayoutEffect: () => {},
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: (v) => ({ current: v }),
      useId: () => 'id-1',
      useSyncExternalStore: () => null,
    },
    'react-dom': {
      createPortal: (node) => node,
    },
    '@deepseek-ai/dsh-client-ui-primitives': {},
  };

  const exportedModule = capturedEntry.factory((specifier) => {
    assert.ok(specifier in fakeModules, `unexpected require specifier: ${specifier}`);
    return fakeModules[specifier];
  });

  const pluginFn = exportedModule.default || exportedModule.apply;
  assert.equal(typeof pluginFn, 'function');

  const fakeSlots = {
    entriesOfSlot() { return []; },
    subscribe() { return () => {}; },
    inject(slotName, fn) {
      fn();
    },
    register(spec, component) {
      registeredSlots.push({ spec, component });
      return () => {};
    },
  };

  let registeredLocale = null;
  const fakeCtx = {
    effect(fn) {
      fn();
    },
    locale: {
      register: (_ns, dicts) => {
        registeredLocale = dicts;
        return () => {};
      },
      bind: () => (key) => key,
    },
    connection: {
      rpc: { call: async () => ({ value: { agents: [] } }) },
    },
    slots: fakeSlots,
    modelDirectories: {
      directoryFor: () => ({ store: {}, load: async () => {}, select: async () => {} }),
    },
    sessions: {
      subagentAddress: () => undefined,
    },
    inject(_deps, fn) {
      if (_deps.every(name => fakeCtx[name])) fn(fakeCtx);
    },
  };

  pluginFn(fakeCtx);

  assert.ok(registeredLocale, 'expected locale dictionaries to be registered');
  assert.deepEqual(
    Object.keys(registeredLocale.zh).sort(),
    Object.keys(registeredLocale.en).sort(),
    'zh and en locale dictionaries must have identical key sets',
  );

  const settingsSlot = registeredSlots.find((s) => s.spec.name === 'settings.section');
  assert.ok(settingsSlot, 'expected settings.section registration');
  assert.equal(settingsSlot.spec.id, 'acp-agents');
  assert.equal(settingsSlot.spec.order, 12);

  const modelSlot = registeredSlots.find((s) => s.spec.name === 'conversation.input.model.options');
  assert.ok(modelSlot, 'expected native model menu options registration');
  assert.equal(modelSlot.spec.id, 'dsh-acp-options');
  assert.equal(modelSlot.spec.order, 20);
  assert.equal(registeredSlots.some(s => s.spec.name === 'conversation.input.model'), false,
    'the host retains ownership of its picker, reasoning and Team controls');
  assert.equal(modelSlot.spec.children, undefined, 'must not redeclare child slot keys owned by ui-model-selection');
});
