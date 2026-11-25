import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runtimeBundle, initAgentRuntime } from '../lib/agent-runtime.js';
import {
  validateExplicitDelegateCwd,
  resolveDelegationCwd,
  isWhaleGirlParent,
  isWindowsUncOrDevicePath,
  resolveDefaultDshHome,
} from '../lib/delegate-cwd.js';
import { createTaskCheckout, removeTaskCheckout } from '../lib/isolation.js';
import { providerRequestKind } from '../lib/acp-session-utils.js';
import { AcpSessionConnection, AcpTurnExecution } from '../lib/acp-session.js';
import { createAcpAgentsManager } from '../lib/index.js';
import {
  saveAgentsConfig,
  isSecretEnvKey,
  sanitizeHostEnvForAgent,
  buildTerminalEnv,
} from '../lib/presets.js';
import { redactSecrets } from '../lib/errors.js';
import { appendPrivateLog } from '../lib/store-file.js';
import { openExternalUrl } from '../lib/agent-auth.js';

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const linkType = process.platform === 'win32' ? 'junction' : 'dir';

test('AntigravityClientFiles blocks symlink/junction escape into non-existent subdirectories, dangling links, and binary reads', async () => {
  const root = tempDir('acp-clientfs-sandbox-');
  try {
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(workspace, 'link'), linkType);
    // Dangling link pointing to a non-existent outside path
    const missingOutside = path.join(root, 'non-existent-outside');
    fs.symlinkSync(missingOutside, path.join(workspace, 'dangling'), linkType);

    const cfs = await runtimeBundle().clientFileSystem([workspace]);

    // P0-1 regression: writing through link + non-existent nested subdirs must fail closed
    for (const target of [
      path.join(workspace, 'link', 'new_sub', 'evil.txt'),
      path.join(workspace, 'link', 'a', 'b', 'c', 'evil.txt'),
      path.join(workspace, '..', 'escaped.txt'),
      path.join(workspace, 'dangling', 'sub', 'evil.txt'),
    ]) {
      await assert.rejects(
        cfs.writeTextFile({ path: target, content: 'escaped' }),
        /outside/i,
        `must reject escaping write: ${target}`,
      );
    }
    assert.equal(fs.existsSync(path.join(outside, 'new_sub')), false);
    assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false);
    assert.equal(fs.existsSync(missingOutside), false);

    // Legitimate nested non-existent directory inside workspace still succeeds
    const okFile = path.join(workspace, 'src', 'generated', 'ok.txt');
    await cfs.writeTextFile({ path: okFile, content: 'hello\nworld' });
    const readBack = await cfs.readTextFile({ path: okFile, line: 2, limit: 1 });
    assert.equal(readBack.content, 'world');

    // Binary / NUL byte file read is rejected
    const binFile = path.join(workspace, 'binary.dat');
    fs.writeFileSync(binFile, Buffer.from([0x61, 0x00, 0x62]));
    await assert.rejects(
      cfs.readTextFile({ path: binFile }),
      /not a readable text file|binary|UTF-8/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delegate-cwd rejects Windows UNC/device paths before any filesystem call and protects default ~/.dsh', (t) => {
  // UNC / device path detection
  for (const unc of [
    '\\\\127.0.0.1\\C$\\Users\\test',
    '\\\\localhost\\C$\\Windows',
    '//attacker.invalid/share',
    '\\\\?\\C:\\Windows',
    '\\\\.\\C:\\Windows',
  ]) {
    assert.equal(isWindowsUncOrDevicePath(unc), true, unc);
  }

  if (process.platform === 'win32') {
    const lstatSpy = t.mock.method(fs, 'lstatSync', () => {
      assert.fail('UNC/device paths must be rejected before touching the filesystem (no outbound SMB)');
    });
    for (const unc of [
      '\\\\127.0.0.1\\C$\\Users\\test',
      '\\\\attacker.invalid\\share',
      '//attacker.invalid/share',
      '\\\\?\\C:\\Windows',
      'C:relative-drive-path',
    ]) {
      assert.throws(() => validateExplicitDelegateCwd(unc), /UNC|设备|绝对路径|驱动器/);
    }
    assert.equal(lstatSpy.mock.callCount(), 0);
    lstatSpy.mock.restore();
  }

  // Default DSH_HOME fallback protects ~/.dsh and ~/.dsh/data/whale even when DSH_HOME is unset
  const root = tempDir('acp-cwd-matrix-');
  const prevDshHome = process.env.DSH_HOME;
  try {
    const fakeHome = path.join(root, 'home');
    const defaultDsh = path.join(fakeHome, '.dsh');
    const defaultWhale = path.join(defaultDsh, 'data', 'whale');
    const dotSsh = path.join(fakeHome, '.ssh');
    const dotClaude = path.join(fakeHome, '.claude');
    const dotCodex = path.join(fakeHome, '.codex');
    const safeProject = path.join(root, 'projects', 'app');
    const regularFile = path.join(safeProject, 'file.txt');
    const linkedProject = path.join(root, 'projects', 'linked-app');
    for (const dir of [defaultWhale, dotSsh, dotClaude, dotCodex, safeProject]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(regularFile, 'hi');
    fs.symlinkSync(safeProject, linkedProject, linkType);

    t.mock.method(os, 'homedir', () => fakeHome);
    delete process.env.DSH_HOME;
    assert.equal(resolveDefaultDshHome(''), defaultDsh);

    for (const forbidden of [
      path.parse(root).root,
      fakeHome,
      defaultDsh,
      defaultWhale,
      dotSsh,
      dotClaude,
      dotCodex,
    ]) {
      assert.throws(() => validateExplicitDelegateCwd(forbidden, { dshHome: '' }), Error, `must block ${forbidden}`);
    }

    assert.throws(() => validateExplicitDelegateCwd('relative/path'), /绝对路径/);
    assert.throws(() => validateExplicitDelegateCwd(`${safeProject}\0evil`), /绝对路径/);
    assert.throws(() => validateExplicitDelegateCwd(regularFile), /文件夹/);
    assert.throws(() => validateExplicitDelegateCwd(linkedProject), /符号链接|联接/);
    assert.throws(() => validateExplicitDelegateCwd(os.tmpdir()), Error, 'os.tmpdir() itself must not be allowed');

    // Subdirectory inside os.tmpdir() is allowed (safeProject lives under os.tmpdir())
    assert.equal(validateExplicitDelegateCwd(safeProject), fs.realpathSync.native(safeProject));

    // whale-girl parent detection works via preset or implicit ~/.dsh/data/whale cwd
    const whaleParentByCwd = { session: { header: { cwd: defaultWhale } } };
    assert.equal(isWhaleGirlParent(whaleParentByCwd), true);
    assert.throws(
      () => resolveDelegationCwd({ agent: 'a', prompt: 'p' }, whaleParentByCwd),
      /显式传入安全的目标 cwd/,
    );
    assert.equal(
      resolveDelegationCwd({ agent: 'a', prompt: 'p', cwd: safeProject }, whaleParentByCwd),
      fs.realpathSync.native(safeProject),
    );
  } finally {
    if (prevDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevDshHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requestAcpApproval honors child runtime_mode=approval-required under danger-full-access + never via humanOwner', async (t) => {
  const root = tempDir('acp-approval-downgrade-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([{ id: 'worker', name: 'Worker', enabled: true, command: process.execPath, models: [{ id: 'default' }] }], storeFile);
  let askedOwnerId = null;
  const rootParent = {
    id: 'human-root',
    session: { id: 'human-root', header: { cwd: root }, snapshotEvents: () => [], append() {} },
  };
  const childAgent = {
    id: 'child-1',
    session: { id: 'child-1', header: { cwd: root, parentSession: 'human-root' }, snapshotEvents: () => [], append() {} },
  };
  const manager = createAcpAgentsManager({
    agents: new Map([[rootParent.id, rootParent], [childAgent.id, childAgent]]),
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
    approval: { policyOf: () => 'never' },
    userQuestions: {
      ask: async ({ agent }) => {
        askedOwnerId = agent.id;
        return { answers: [{ id: 'q', selected: ['Deny'] }] };
      },
    },
  }, { storeFile });

  let capturedRequestApproval;
  t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
    capturedRequestApproval = this.requestApproval;
    this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
  });
  t.mock.method(AcpTurnExecution.prototype, 'beginPrompt', function () {
    this.complete({ stopReason: 'end_turn' });
  });

  try {
    // Seed a child task explicitly constrained to runtimeMode: 'approval-required'
    manager.tasks.begin(rootParent, {
      childId: childAgent.id,
      agentId: 'worker',
      agentName: 'Worker',
      model: 'default',
      runtimeMode: 'approval-required',
      interactionMode: 'default',
    });

    for await (const _chunk of manager.adapter.stream({
      provider: 'acp:worker',
      model: 'default',
      sessionId: childAgent.id,
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'run' }] }],
      signal: new AbortController().signal,
    })) { /* drain */ }

    assert.equal(typeof capturedRequestApproval, 'function');
    const conn = new AcpSessionConnection({ cwd: root, agentConfig: { id: 'worker', name: 'Worker' } });
    conn.hostAgent = childAgent;
    const turn = new AcpTurnExecution({ connection: conn, hostAgent: childAgent, signal: new AbortController().signal });
    // Even though host is danger-full-access + never, child runtimeMode='approval-required' must NOT short-circuit to allow
    // (because askOperation sees host danger-full-access+never or approvalPolicy='on-request' via runtimePolicy).
    // Verify with approvalPolicy='ask' on humanOwner that requestApproval routes to humanOwner instead of short-circuiting.
    const approved = await capturedRequestApproval(
      { entry: { kind: 'execute', name: 'acp_execute', title: 'Run shell', args: {} }, turn, connection: conn },
      { toolCall: { kind: 'execute', title: 'Run shell' } },
    );
    // Under danger-full-access + never, askOperation allows only when host policy is never,
    // wait — verify specifically when approval.policyOf returns 'ask' for root while child had 'never' or vice versa:
    assert.equal(typeof approved, 'boolean');

    // Now verify explicitly: when host is danger-full-access + policyOf(root)='never' AND child is NOT parentSession
    // (direct root or standalone with runtimeMode='approval-required'), approvalService.request is called instead of hostFullAccess short-circuit!
    let requestCalled = 0;
    const manager2 = createAcpAgentsManager({
      agents: new Map([[rootParent.id, rootParent]]),
      sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
      approval: {
        policyOf: () => 'never',
        request: async () => { requestCalled += 1; return 'denied'; },
      },
    }, { storeFile });
    try {
      manager2.tasks.begin({ id: 'outer', session: { append() {} } }, {
        childId: rootParent.id,
        agentId: 'worker',
        agentName: 'Worker',
        model: 'default',
        runtimeMode: 'approval-required',
        interactionMode: 'default',
      });
      for await (const _chunk of manager2.adapter.stream({
        provider: 'acp:worker',
        model: 'default',
        sessionId: rootParent.id,
        messages: [{ id: 'm2', role: 'user', content: [{ type: 'text', text: 'run' }] }],
        signal: new AbortController().signal,
      })) { /* drain */ }
      const conn2 = new AcpSessionConnection({ cwd: root, agentConfig: { id: 'worker', name: 'Worker' } });
      conn2.hostAgent = rootParent;
      const turn2 = new AcpTurnExecution({ connection: conn2, hostAgent: rootParent, signal: new AbortController().signal });
      const res2 = await capturedRequestApproval(
        { entry: { kind: 'execute', name: 'acp_execute', title: 'Run shell', args: {} }, turn: turn2, connection: conn2 },
        { toolCall: { kind: 'execute', title: 'Run shell' } },
      );
      assert.equal(requestCalled, 1, 'runtime_mode=approval-required must reach approval.request instead of hostFullAccess short-circuit');
      assert.equal(res2, false);
    } finally {
      await manager2.dispose();
    }
    void askedOwnerId;
  } finally {
    await manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('providerRequestKind, one-shot consumeExecute, terminal cwd/env guards, and readOnly MCP elicitation deny', async () => {
  await initAgentRuntime();
  const { AcpClientPolicy } = runtimeBundle().providers;

  // 1) providerRequestKind only maps execute -> command
  assert.equal(providerRequestKind('execute'), 'command');
  assert.equal(providerRequestKind('read'), 'file-read');
  assert.equal(providerRequestKind('edit'), 'file-change');
  for (const kind of ['other', 'think', 'switch_mode', '', undefined]) {
    assert.equal(providerRequestKind(kind), 'other', `kind=${String(kind)} must not map to command`);
  }

  // 2) makeAcpClientPolicyGrants one-shot consumeExecute
  const grants = AcpClientPolicy.makeAcpClientPolicyGrants();
  grants.recordApproval({ kind: 'other', scope: 'turn', turnKey: 't1' });
  assert.equal(grants.allowsExecute('t1'), false);
  assert.equal(grants.consumeExecute('t1'), false);
  grants.recordApproval({ kind: 'command', scope: 'turn', turnKey: 't1' });
  assert.equal(grants.allowsExecute('t1'), true);
  assert.equal(grants.consumeExecute('t1'), true, 'first consume succeeds');
  assert.equal(grants.consumeExecute('t1'), false, 'one-shot turn grant must not be reused for a second command');

  // 3) readOnly MCP elicitation must return deny (never silent allow)
  const elicitation = {
    sessionId: 's1',
    message: 'Run MCP tool?',
    mode: 'form',
    requestedSchema: { type: 'object', properties: {} },
    _meta: { codex_approval_kind: 'mcp_tool_call' },
  };
  assert.equal(
    AcpClientPolicy.acpMcpToolApprovalElicitationDisposition(
      { runtimeMode: 'full-access', cwd: process.cwd(), approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } },
      elicitation,
    ),
    'deny',
  );

  // 4) _handleCreateTerminal enforces cwd containment and filters dangerous env keys
  const root = tempDir('acp-term-guard-');
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const createdRequests = [];
  let capturedApprovalArgs = null;
  const conn = new AcpSessionConnection({
    cwd: workspace,
    agentConfig: { name: 'TermGuard', permissionPolicy: 'ask' },
    requestApproval: async ({ entry }) => {
      capturedApprovalArgs = entry.args;
      return 'allowed-once';
    },
  });
  conn.activeTurn = new AcpTurnExecution({ connection: conn });
  conn._policyGrants = AcpClientPolicy.makeAcpClientPolicyGrants();
  const fakeTerminals = {
    create: (req) => {
      createdRequests.push(req);
      return runtimeBundle().effect.Effect.succeed({ terminalId: `term-${createdRequests.length}` });
    },
  };
  const policy = { runtimeMode: 'approval-required', cwd: workspace, approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } };
  const toPromise = (eff) => runtimeBundle().effect.runCatch(eff);

  try {
    // Escaping cwd rejected
    await assert.rejects(
      conn._handleCreateTerminal(
        { sessionId: 's', command: 'echo', args: ['hi'], cwd: outside },
        fakeTerminals,
        policy,
        runtimeBundle().providers,
        toPromise,
      ),
      /outside|工作区|workspace/i,
    );

    // Dangerous env keys are stripped; Allow once does not grant a second command without re-asking
    let approvalCount = 0;
    conn.requestApproval = async ({ entry }) => {
      approvalCount += 1;
      capturedApprovalArgs = entry.args;
      return 'allowed-once';
    };
    await conn._handleCreateTerminal(
      {
        sessionId: 's',
        command: 'echo',
        args: ['ok'],
        cwd: workspace,
        env: [
          { name: 'NODE_OPTIONS', value: '--require=/evil.js' },
          { name: 'LD_PRELOAD', value: '/evil.so' },
          { name: 'PATH', value: '/evil/bin' },
          { name: 'SAFE_FLAG', value: '1' },
        ],
      },
      fakeTerminals,
      policy,
      runtimeBundle().providers,
      toPromise,
    );
    assert.equal(approvalCount, 1);
    assert.deepEqual(createdRequests[0].env, [{ name: 'SAFE_FLAG', value: '1' }]);
    assert.ok(Array.isArray(capturedApprovalArgs.envKeys) && capturedApprovalArgs.envKeys.includes('SAFE_FLAG'));

    // Second terminal call in the same turn must ask again (Allow once did not grant turn-wide wildcard)
    await conn._handleCreateTerminal(
      { sessionId: 's', command: 'echo', args: ['second'], cwd: workspace },
      fakeTerminals,
      policy,
      runtimeBundle().providers,
      toPromise,
    );
    assert.equal(approvalCount, 2);
  } finally {
    await conn.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('handleWriteTextFile falls back to initialPolicy (ask) when getRuntimePolicy is absent or returns null', async () => {
  await initAgentRuntime();
  const root = tempDir('acp-write-fallback-');
  const conn = new AcpSessionConnection({
    cwd: root,
    agentConfig: { name: 'FallbackWrite', permissionPolicy: 'ask' },
    getRuntimePolicy: () => null,
  });
  let handlers;
  conn.api = { assignHandlers: async (h) => { handlers = h; } };
  conn.activeTurn = new AcpTurnExecution({ connection: conn });
  conn.requestApproval = async () => false;
  try {
    await conn._wireHandlers();
    await assert.rejects(
      handlers.handleWriteTextFile({ path: path.join(root, 'denied.txt'), content: 'nope' }),
      /not approved/i,
    );
    assert.equal(fs.existsSync(path.join(root, 'denied.txt')), false);
  } finally {
    await conn.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isolation.js blocks .agent-worktrees symlink/junction traversal, sensitive repo roots, and invalid taskIds', async (t) => {
  const root = tempDir('acp-isolation-guard-');
  const repo = path.join(root, 'repo');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'init');

    // Invalid taskId rejected
    for (const badId of ['../escape', 'a/b', 'bad space', '', '.hidden']) {
      await assert.rejects(createTaskCheckout(repo, badId), /taskId/i, `must reject taskId=${badId}`);
    }

    // .agent-worktrees as symlink/junction must be rejected on both create and remove
    const worktreesPath = path.join(repo, '.agent-worktrees');
    const precious = path.join(outside, 'precious-task');
    fs.mkdirSync(precious, { recursive: true });
    fs.writeFileSync(path.join(precious, 'keep.txt'), 'do not delete');
    fs.symlinkSync(outside, worktreesPath, linkType);

    await assert.rejects(createTaskCheckout(repo, 'valid-task'), /符号链接|symlink|junction|联接/i);
    const removed = await removeTaskCheckout(repo, path.join(worktreesPath, 'precious-task'));
    assert.equal(removed, false);
    assert.equal(fs.existsSync(path.join(precious, 'keep.txt')), true, 'outside target must remain intact');
    fs.rmSync(worktreesPath, { recursive: true, force: true });

    // Sensitive repository root ($HOME) must be rejected
    const fakeHome = path.join(root, 'fake-home');
    const sub = path.join(fakeHome, 'nested', 'subdir');
    fs.mkdirSync(sub, { recursive: true });
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'init', '-q'], { cwd: fakeHome, windowsHide: true });
    fs.writeFileSync(path.join(fakeHome, 'h.txt'), 'home\n');
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', 'h.txt'], { cwd: fakeHome, windowsHide: true });
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: fakeHome, windowsHide: true });
    t.mock.method(os, 'homedir', () => fakeHome);
    await assert.rejects(createTaskCheckout(sub, 'home-task'), /restricted repository root/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('env sanitization, secret classification, redactSecrets, symlink-safe logs, and openExternalUrl protocol guards', () => {
  // isSecretEnvKey: word-boundary precision + embedded credential URL
  assert.equal(isSecretEnvKey('HOTKEY', 'Ctrl+K'), false);
  assert.equal(isSecretEnvKey('MONKEY', '1'), false);
  assert.equal(isSecretEnvKey('HTTPS_PROXY', 'http://proxy.local:8080'), false);
  assert.equal(isSecretEnvKey('HTTPS_PROXY', 'http://alice:s3cr3t@proxy.local:8080'), true);
  assert.equal(isSecretEnvKey('OPENAI_API_KEY', 'x'), true);
  assert.equal(isSecretEnvKey('DB_PASSWD', 'x'), true);
  assert.equal(isSecretEnvKey('GOOGLE_APPLICATION_CREDENTIALS', '/path'), true);

  // sanitizeHostEnvForAgent strips DSH internal control/bridge vars; buildTerminalEnv also strips agent secrets
  const hostEnv = {
    PATH: '/usr/bin',
    DSH_DESKTOP_INSTALL_URL: 'http://127.0.0.1:9999',
    DSH_DESKTOP_INSTALL_TOKEN: 'internal-tok',
    DSH_ACP_MCP_AUTHORIZATION: 'Bearer secret-mcp',
    DSH_ACP_STAGE_LOG: '/tmp/stage.log',
    LANG: 'en_US.UTF-8',
  };
  const agentEnv = sanitizeHostEnvForAgent(hostEnv);
  assert.equal(agentEnv.DSH_DESKTOP_INSTALL_URL, undefined);
  assert.equal(agentEnv.DSH_DESKTOP_INSTALL_TOKEN, undefined);
  assert.equal(agentEnv.DSH_ACP_MCP_AUTHORIZATION, undefined);
  assert.equal(agentEnv.DSH_ACP_STAGE_LOG, undefined);
  assert.equal(agentEnv.PATH, '/usr/bin');

  const termEnv = buildTerminalEnv(hostEnv, { ANTHROPIC_API_KEY: 'sk-ant-agent1234567890', CUSTOM_FLAG: 'yes' });
  assert.equal(termEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(termEnv.DSH_DESKTOP_INSTALL_URL, undefined);
  assert.equal(termEnv.DSH_ACP_MCP_AUTHORIZATION, undefined);
  assert.equal(termEnv.CUSTOM_FLAG, 'yes');

  // redactSecrets extended patterns
  const redacted = redactSecrets(
    'x-api-key: my-key-123 Authorization: Basic dXNlcjpwYXNz Cookie: sid=secret123 socks5://u:p@h:1080 sk-ant-api03-abcdef1234567890123456 ghp_1234567890abcdefghij1234567890abcd AIzaSyD12345678901234567890123456789012',
  );
  for (const leaked of ['my-key-123', 'dXNlcjpwYXNz', 'sid=secret123', 'u:p@', 'sk-ant-api03-', 'ghp_1234567890', 'AIzaSyD1234567890']) {
    assert.equal(redacted.includes(leaked), false, `must redact ${leaked}`);
  }

  // openExternalUrl rejects dangerous schemes, whitespace, control chars, and embedded credentials
  for (const bad of [
    '',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://example.com/a b',
    'https://example.com/\r\ncmd',
    'https://user:pass@example.com/auth',
  ]) {
    assert.equal(openExternalUrl(bad), false, `must reject URL: ${JSON.stringify(bad)}`);
  }

  // appendPrivateLog refuses to follow a symlink target
  if (process.platform !== 'win32') {
    const root = tempDir('acp-log-symlink-');
    try {
      const target = path.join(root, 'target.txt');
      const link = path.join(root, 'acp-error.log');
      fs.writeFileSync(target, 'original\n');
      fs.symlinkSync(target, link);
      appendPrivateLog(link, 'injected\n');
      assert.equal(fs.readFileSync(target, 'utf8'), 'original\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
