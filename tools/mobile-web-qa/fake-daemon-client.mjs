/**
 * Fake `chisacode/daemon-client.bundle.js` for browser integration QA.
 *
 * Served by server.mjs in place of the real bundle so the entire SPA stack
 * (app.js / session.js / parity.js / controller.js / directory.js /
 * timeline.js / approvals.js / commands.js) runs unmodified against an
 * in-memory daemon world. Every RPC is recorded on `window.__qa.calls`;
 * scenarios can inject stream events and connection状态 via `window.__qa`.
 *
 * QA tool only — never packaged (lives outside electron-builder `files`).
 */

const EPOCH = 'qa-epoch-1';
const TOTAL_AGENTS = 130;
const TIMELINE_SEQ_MAX = 262;
const TAIL_LIMIT_SPAN = 200;

function providerModes() {
  return [
    { id: 'plan', label: '规划', description: '只读计划' },
    { id: 'auto', label: '自动接受编辑', description: '' },
    { id: 'full', label: '完全访问', description: '危险' },
  ];
}

function providerModels() {
  return [
    { id: 'ds-r3', label: 'DeepSeek R3', isDefault: true },
    { id: 'ds-r3-mini', label: 'DeepSeek R3 Mini' },
    { id: 'ds-lite', label: 'ds-lite' },
  ];
}

function makeAgent(index) {
  const id = `agent-${index}`;
  return {
    id,
    title: `会话 ${index}`,
    status: index === 1 ? 'running' : 'idle',
    cwd: '/repo/mobile',
    provider: 'dsh',
    currentModeId: 'plan',
    availableModes: providerModes(),
    model: index === 1 ? 'ds-r3' : null,
    pendingPermissions: [],
    updatedAt: 1756100000000 - index * 1000,
  };
}

const PNG_1PX = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
), (char) => char.charCodeAt(0));

function textFileEntry(content) {
  return {
    kind: 'file', fileKind: 'text', mime: 'text/plain',
    bytes: new TextEncoder().encode(content),
  };
}

/** In-memory workspace file tree for the Files work loop. */
function buildFileTree() {
  const textFile = textFileEntry;
  // 40 vendor files force the listing to overflow → scroll-restore is testable.
  const vendorFiles = Array.from({ length: 40 }, (_, index) => (
    `vendor/pkg-${String(index).padStart(2, '0')}.js`
  ));
  const files = Object.fromEntries(vendorFiles.map((path) => [path, textFileEntry(`// ${path}\n`)]));
  return {
    '': ['src', 'assets', 'build', 'vendor', 'data.bin', 'README.md'],
    src: ['src/app', 'src/index.js'],
    'src/app': ['src/app/main.js'],
    assets: ['assets/logo.png'],
    build: ['build/bundle.min.js'],
    vendor: vendorFiles,
    files: {
      ...files,
      'src/index.js': textFile('import { main } from "./app/main.js";\nmain();\n'),
      'src/app/main.js': textFile('export function main() {\n  return "phase2";\n}\n'),
      'README.md': textFile('# Mobile QA repo\n\n用于 Phase 2 文件预览的样例仓库。\n'),
      'assets/logo.png': {
        kind: 'file', fileKind: 'image', mime: 'image/png', bytes: PNG_1PX,
      },
      'data.bin': {
        kind: 'file', fileKind: 'binary', mime: 'application/octet-stream',
        bytes: Uint8Array.from([0, 1, 2, 3]),
      },
      // Size above the 2MB preview gate — the SPA must refuse to fetch it.
      'build/bundle.min.js': {
        kind: 'file', fileKind: 'text', mime: 'text/javascript',
        bytes: new TextEncoder().encode('x'), sizeOverride: 3 * 1024 * 1024,
      },
    },
  };
}

function diffHunk() {
  return {
    oldStart: 10, oldCount: 3, newStart: 10, newCount: 4,
    lines: [
      { type: 'context', content: 'const before = 1;' },
      { type: 'remove', content: 'legacyCall();' },
      { type: 'add', content: 'phase2Call();' },
      { type: 'add', content: 'phase2Extra();' },
    ],
  };
}

/** Per-scope checkout diff payloads; scenarios mutate these via window.__qa. */
function buildDiffWorld() {
  return {
    uncommitted: {
      error: null,
      files: [
        {
          path: 'mobile/web/app.js', isNew: false, isDeleted: false,
          additions: 12, deletions: 3, status: 'ok', hunks: [diffHunk()],
        },
        {
          path: 'assets/logo.png', isNew: true, isDeleted: false,
          additions: 0, deletions: 0, status: 'binary', hunks: [],
        },
        {
          path: 'package-lock.json', isNew: false, isDeleted: false,
          additions: 900, deletions: 900, status: 'too_large', hunks: [],
        },
      ],
    },
    base: {
      error: null,
      files: [
        {
          path: 'docs/notes.md', isNew: true, isDeleted: false,
          additions: 5, deletions: 0, status: 'ok', hunks: [diffHunk()],
        },
      ],
    },
  };
}

function buildExtensionsWorld() {
  return {
    mcp: {
      servers: [
        {
          name: 'github', label: 'GitHub 工具', description: '仓库检索与 issue 操作',
          source: 'user', removable: true, editable: true,
          config: { type: 'http', url: 'https://mcp.example/github' },
          statusByScope: { global: 'enabled', providers: {}, agents: { 'agent-1': 'agent-disabled' } },
          errors: [],
        },
        {
          name: 'local-fs', label: 'local-fs', description: '',
          source: 'system', removable: false, editable: false,
          config: { type: 'stdio', command: 'fs-mcp' },
          statusByScope: { global: 'global-disabled', providers: {}, agents: {} },
          errors: ['上次握手超时'],
        },
      ],
      errors: [],
    },
    skills: {
      skills: [
        {
          name: 'release-notes', description: '生成发布说明',
          sources: [{ id: 's1', type: 'project', path: '/repo/mobile/.agents/skills/release-notes', removable: false }],
          statusByScope: { global: 'enabled', providers: {}, agents: {} },
          errors: [],
        },
        {
          name: 'db-migrate', description: '数据库迁移助手',
          sources: [{ id: 's2', type: 'claude-home', path: '/home/qa/.claude/skills/db-migrate', removable: true }],
          statusByScope: { global: 'global-disabled', providers: {}, agents: {} },
          errors: [],
        },
      ],
      errors: ['一个技能目录无法读取'],
    },
  };
}

const PNG_1PX_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FILE_TREE = buildFileTree();

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Session-scoped workspace files (`workspaceFiles.*`) over the in-memory tree. */
function workspaceFilesRpc(method, args = {}) {
  const rel = !args.path || args.path === '.' ? '' : String(args.path);
  if (method === 'workspaceFiles.list') {
    const children = FILE_TREE[rel];
    if (!Array.isArray(children)) throw new Error(`ENOENT: ${rel || '.'}`);
    return {
      path: rel,
      truncated: false,
      entries: children.map((child) => {
        const name = child.split('/').pop();
        const directory = Array.isArray(FILE_TREE[child]);
        const file = FILE_TREE.files[child];
        return directory
          ? { name, type: 'directory' }
          : { name, type: 'file', size: file?.sizeOverride ?? file?.bytes.length };
      }),
    };
  }
  const file = FILE_TREE.files[rel];
  if (!file) throw new Error(`ENOENT: ${rel}`);
  if (method === 'workspaceFiles.readImage') {
    if (file.fileKind !== 'image') throw new Error('不是图片文件');
    return { absolutePath: `/repo/mobile/${rel}`, version: 'v1', bytes: file.bytes.length, mediaType: file.mime, data: bytesToBase64(file.bytes) };
  }
  if (file.fileKind === 'binary') throw new Error('文件不是文本，无法按行读取');
  const lines = new TextDecoder().decode(file.bytes).replace(/\n$/, '').split('\n');
  const offset = args.range?.offset || 1;
  const limit = args.range?.limit || 200;
  const page = lines.slice(offset - 1, offset - 1 + limit);
  return {
    absolutePath: `/repo/mobile/${rel}`, version: 'v1', bytes: file.sizeOverride ?? file.bytes.length,
    offset, text: page.join('\n'), lines: page.length, eof: offset - 1 + page.length >= lines.length,
  };
}

function sessionProjectionValues(sessionId) {
  const session = findSession(sessionId);
  const values = qa.world.projections[sessionId] || {};
  return {
    title: session?.projections?.values?.title || '',
    permissions: { currentValue: session?.projections?.values?.permissionPreset || 'workspace-write' },
    usagePanel: { totals: { input: 15234, output: 2380, cacheRead: 8000, cacheWrite: 120 } },
    inbox: qa.world.inbox[sessionId] || {},
    ...values,
  };
}

function appendedEvents(sessionId) {
  return qa.world.appended[sessionId] || [];
}

function nextSeq(sessionId, base) {
  const all = [...base, ...appendedEvents(sessionId)];
  return all.reduce((max, entry) => Math.max(max, entry?.event?.seq ?? entry?.seq ?? 0), 0) + 1;
}

/** Poll windows (`maxMessages` below a page) keep only the newest messages. */
function tailWindow(events, maxMessages) {
  if (!Number.isInteger(maxMessages) || maxMessages >= 50) return { events, cut: false };
  let count = 0;
  let index = events.length;
  while (index > 0) {
    const type = events[index - 1]?.event?.type;
    if (type === 'user/message' || type === 'assistant/message') count += 1;
    if (count > maxMessages) break;
    index -= 1;
  }
  return { events: events.slice(index), cut: index > 0 };
}

function makeSession(id, title, extra = {}) {
  return {
    sessionId: id,
    blank: extra.blank === true,
    running: extra.running === true,
    cwd: extra.cwd || '/repo/mobile',
    origin: extra.origin || '',
    parentSessionId: extra.parentSessionId || '',
    projections: { values: { title, permissionPreset: extra.permission || 'workspace-write' } },
  };
}

function hostHistoryEvents(beforeSeq) {
  const max = TIMELINE_SEQ_MAX;
  const end = Number.isInteger(beforeSeq) ? Math.min(beforeSeq - 1, max) : max;
  const start = Math.max(1, end - 80);
  const events = [];
  for (let seq = start; seq <= end; seq += 1) {
    if (seq === max - 9) {
      events.push({ event: { type: 'plan/mode', seq, data: { enabled: true } } });
      continue;
    }
    if (seq === max - 8) {
      events.push({ event: { type: 'permission/preset', seq, data: { preset: 'workspace-write' } } });
      continue;
    }
    if (seq === max - 7) {
      events.push({
        item: {
          type: 'assistant_message',
          messageId: `m${seq}`,
          text: [
            '# 结果',
            '看 `app.js` 和 **重点**：',
            '```js',
            'const x = 1;',
            '```',
            '[文档](https://example.com/doc)',
            '<img src=x onerror=alert(1)>',
          ].join('\n'),
        },
        seq,
        seqStart: seq,
        seqEnd: seq,
      });
      continue;
    }
    if (seq === max - 6) {
      events.push({
        item: {
          type: 'tool_call',
          callId: `call-${seq}`,
          name: 'shell',
          status: 'completed',
          detail: { type: 'shell', command: 'npm test', output: 'ok 121 tests' },
        },
        seq,
        seqStart: seq,
        seqEnd: seq,
      });
      continue;
    }
    if (seq === max - 5) {
      events.push({ item: { type: 'reasoning', text: '先看目录结构再动手。' }, seq, seqStart: seq, seqEnd: seq });
      continue;
    }
    if (seq === max - 4) {
      events.push({
        item: {
          type: 'todo',
          items: [
            { text: '写测试', completed: true },
            { text: '跑测试', completed: false },
          ],
        },
        seq,
        seqStart: seq,
        seqEnd: seq,
      });
      continue;
    }
    if (seq === max - 3) {
      events.push({ item: { type: 'compaction', status: 'completed' }, seq, seqStart: seq, seqEnd: seq });
      continue;
    }
    if (seq === max - 2) {
      events.push({
        item: {
          type: 'turn_changes',
          changeSummary: '本轮改了 1 个文件',
          changedFiles: [{ path: 'mobile/web/app.js', additions: 12, deletions: 3 }],
        },
        seq,
        seqStart: seq,
        seqEnd: seq,
      });
      continue;
    }
    if (seq === max - 1) {
      events.push({ item: { type: 'qa_future_kind', payload: {} }, seq, seqStart: seq, seqEnd: seq });
      continue;
    }
    if (seq === max) {
      events.push({ item: { type: 'error', message: '演示错误行' }, seq, seqStart: seq, seqEnd: seq });
      continue;
    }
    events.push({
      event: seq % 2 === 0
        ? {
          type: 'assistant/message',
          seq,
          data: { message: { content: [{ type: 'text', text: `助手第 ${seq} 条` }] } },
        }
        : {
          type: 'user/message',
          seq,
          data: {
            source: { kind: 'user' },
            content: [{ type: 'text', text: seq === 40 ? 'unique-snippet-needle 工作区路径' : `用户第 ${seq} 条` }],
          },
        },
    });
  }
  return { events, hasMore: start > 1, projections: { asOfSeq: end, values: { title: '会话 1' } } };
}

/** Newest (or `beforeSeq`) host history page before appended live events. */
function historyPage(payload) {
  if (payload.sessionId === 's-1') return hostHistoryEvents(payload.beforeSeq);
  return {
    events: [
      {
        event: {
          type: 'user/message',
          seq: 1,
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
        },
      },
      {
        event: {
          type: 'assistant/message',
          seq: 2,
          data: { message: { content: [{ type: 'text', text: '助手回复' }] } },
        },
      },
    ],
    hasMore: false,
    projections: { values: { title: findSession(payload.sessionId)?.projections?.values?.title || '' } },
  };
}

function buildWorld() {
  const items = [
    makeSession('s-1', '会话 1', { running: true }),
    makeSession('s-sub', '子任务：跑测试', { parentSessionId: 's-1', origin: 'subagent' }),
    makeSession('s-2', '会话 2'),
    makeSession('s-3', '会话 3'),
    { sessionId: 'blank-1', blank: true, running: false, cwd: '/repo/mobile' },
    makeSession('bot-1', 'bot', { origin: 'dshbot' }),
    makeSession('s-arch', '归档的旧会话'),
  ];
  return {
    sessions: { items },
    workspaces: {
      items: [{
        workspaceId: 'ws-mobile',
        title: 'mobile',
        path: '/repo/mobile',
        sessionIds: items.map((item) => item.sessionId),
      }],
      archivedSessionIds: ['s-arch'],
    },
    directories: {
      '/repo': { path: '/repo', home: '/repo', crumbs: [{ name: 'repo', path: '/repo' }], entries: [{ name: 'mobile', path: '/repo/mobile', hidden: false }, { name: 'new-app', path: '/repo/new-app', hidden: false }], truncated: false },
      '/repo/mobile': { path: '/repo/mobile', home: '/repo', crumbs: [{ name: 'repo', path: '/repo' }, { name: 'mobile', path: '/repo/mobile' }], entries: [], truncated: false },
      '/repo/new-app': { path: '/repo/new-app', home: '/repo', crumbs: [{ name: 'repo', path: '/repo' }, { name: 'new-app', path: '/repo/new-app' }], entries: [], truncated: false },
    },
    git: {
      isRepo: true,
      refName: 'main',
      hasWorkingTreeChanges: true,
      hasUpstream: true,
      aheadCount: 1,
      behindCount: 0,
      isDefaultRef: true,
      hasPrimaryRemote: true,
      pr: null,
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'feat', isCurrent: false, isRemote: false },
      ],
    },
    appended: {},
    inbox: {},
    projections: {},
    mcp: [
      {
        id: 'm1', origin: 'managed', writable: true, enabled: true, fiberPhase: 'active',
        connection: { health: 'connected', tools: ['mcp__github__search', 'mcp__github__issue'] },
        spec: { id: 'm1', serverName: 'github', transport: 'streamable-http', url: 'https://mcp.example/github' },
      },
      {
        id: 'm2', origin: 'composition', writable: false, enabled: true, fiberPhase: 'failed',
        connection: { health: 'failed', lastError: 'spawn fs-mcp ENOENT' },
        spec: { id: 'm2', serverName: 'local-fs', transport: 'stdio', command: 'fs-mcp' },
      },
    ],
    skills: [
      { name: 'release-notes', description: '生成发布说明', source: 'project', groups: ['发布'], modelInvocable: true, userInvocable: true, writable: true, path: '/repo/mobile/.agents/skills/release-notes/SKILL.md', content: '# 发布说明\n\n- 读取变更\n- 生成摘要\n\n| 字段 | 说明 |\n|---|---|\n| version | 版本号 |' },
      { name: 'db-migrate', description: '数据库迁移助手', source: 'user', groups: [], modelInvocable: false, userInvocable: true, writable: false, path: '/home/qa/.dsh/skills/db-migrate', content: '迁移前先备份。' },
    ],
    plugins: [
      { entryId: 'p1', moduleName: '@dsh/plugin-git', fiberPhase: 'active', enabled: true, patchId: 'patch-1', readOnlyReason: '' },
      { entryId: 'p2', moduleName: '@dsh/core', fiberPhase: 'active', enabled: true, patchId: '', readOnlyReason: '内置插件，不能停用' },
    ],
    bundles: [
      { name: 'dsh-im', description: '即时通讯桥', version: '1.2.0', availability: 'installed', enabled: false, removable: true },
    ],
    models: {
      current: { provider: 'dsh', model: 'r3', reasoningEffort: 'high' },
      groups: [{
        id: 'dsh',
        name: 'DeepSeek',
        models: [
          { id: 'r3', name: 'DeepSeek R3', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
          { id: 'lite', name: 'Lite' },
        ],
      }],
      failures: [],
    },
  };
}

/** Rich item mix near the tail so logRowNode's branches all render. */
function timelineItem(seq) {
  const md = [
    '# 结果',
    '看 `app.js` 和 **重点**：',
    '- 甲项',
    '- 乙项',
    '```js',
    'const x = 1;',
    '```',
    '[文档](https://example.com/doc)',
    '<img src=x onerror=alert(1)>',
  ].join('\n');
  switch (seq) {
    case TIMELINE_SEQ_MAX - 7:
      return { type: 'assistant_message', messageId: `m${seq}`, text: md };
    case TIMELINE_SEQ_MAX - 6:
      return {
        type: 'tool_call',
        callId: `call-${seq}`,
        name: 'shell',
        status: 'completed',
        detail: { type: 'shell', command: 'npm test', output: 'ok 121 tests' },
      };
    case TIMELINE_SEQ_MAX - 5:
      return { type: 'reasoning', text: '先看目录结构再动手。' };
    case TIMELINE_SEQ_MAX - 4:
      return {
        type: 'todo',
        items: [
          { text: '写测试', completed: true },
          { text: '跑测试', completed: false },
        ],
      };
    case TIMELINE_SEQ_MAX - 3:
      return { type: 'compaction', status: 'completed' };
    case TIMELINE_SEQ_MAX - 2:
      return {
        type: 'turn_changes',
        changeSummary: '本轮改了 1 个文件',
        changedFiles: [{ path: 'mobile/web/app.js', additions: 12, deletions: 3 }],
      };
    case TIMELINE_SEQ_MAX - 1:
      return { type: 'qa_future_kind', payload: {} };
    case TIMELINE_SEQ_MAX:
      return { type: 'error', message: '演示错误行' };
    default:
      return seq % 2 === 0
        ? { type: 'assistant_message', messageId: `m${seq}`, text: `助手第 ${seq} 条` }
        : { type: 'user_message', messageId: `m${seq}`, text: `用户第 ${seq} 条` };
  }
}

function timelineEntry(seq) {
  return {
    seqStart: seq,
    seqEnd: seq,
    timestamp: 1756200000000 + seq,
    item: timelineItem(seq),
  };
}

const qa = {
  calls: [],
  world: buildWorld(),
  clients: [],
  failNext: {},
  setFail(method, message) {
    this.failNext[method] = message;
  },
  emitStream(agentId, event, seq) {
    for (const client of this.clients) {
      client._emit('agent_stream', {
        payload: { agentId, seq: seq ?? null, timestamp: Date.now(), event },
      });
    }
  },
  emitResolved(agentId, requestId) {
    for (const client of this.clients) {
      client._emit('agent_permission_resolved', { payload: { agentId, requestId } });
    }
  },
  emitAgentUpdate(kind, agentOrId) {
    for (const client of this.clients) {
      client._emit('agent_update', {
        payload: kind === 'remove'
          ? { kind, agentId: agentOrId }
          : { kind, agent: agentOrId },
      });
    }
  },
  emitStatus(status, reason) {
    for (const client of this.clients) {
      client._emitStatus({ status, reason });
    }
  },
  emitMux(frame) {
    for (const client of this.clients) {
      for (const listener of client.muxListeners || []) listener(frame);
    }
  },
  /** Append one durable event to a session's newest history page. */
  appendEvent(sessionId, event) {
    const list = this.world.appended[sessionId] || (this.world.appended[sessionId] = []);
    list.push({ event });
    return event.seq;
  },
  setInbox(sessionId, inbox) {
    this.world.inbox[sessionId] = inbox;
  },
};

if (typeof window !== 'undefined') {
  window.__qa = qa;
}

function record(method, args) {
  qa.calls.push({ method, args });
  const failure = qa.failNext[method];
  if (failure) {
    delete qa.failNext[method];
    return Promise.reject(new Error(failure));
  }
  return null;
}

function findSession(sessionId) {
  return qa.world.sessions.items.find((session) => session.sessionId === sessionId) || null;
}

function findAgent() {
  return null;
}

function ok(value) {
  return { ok: true, value };
}

function handleHostRpc(method, payload = {}) {
  const sessions = qa.world.sessions;
  const workspaces = qa.world.workspaces;
  if (method === 'commands/list') {
    return ok([
      { name: 'permission', description: '切换权限', input: { hint: '<id>' } },
      { name: 'plan', description: '计划模式', input: { hint: 'off' } },
    ]);
  }
  if (method === 'commands/execute') {
    const { agentId, line } = payload.args || {};
    const session = findSession(agentId);
    if (line?.startsWith('/permission ') && session) {
      session.projections.values.permissionPreset = line.slice('/permission '.length).trim();
    }
    return ok({ commandId: String(line || '').split(' ')[0], result: { kind: 'text', text: '' } });
  }
  if (method === 'host.describe') {
    return ok({ home: '/repo', scratchCwd: '/tmp' });
  }
  if (method === 'host.listDirectory') {
    const path = payload.path || '/repo';
    const listed = qa.world.directories[path];
    if (!listed) throw new Error(`ENOENT: ${path}`);
    return ok(listed);
  }
  if (method === 'host.createDirectory') {
    const created = `${payload.path}/${payload.name}`;
    const parent = qa.world.directories[payload.path];
    qa.world.directories[created] = {
      path: created,
      home: '/repo',
      crumbs: [...(parent?.crumbs || []), { name: payload.name, path: created }],
      entries: [],
      truncated: false,
    };
    if (parent) parent.entries.push({ name: payload.name, path: created, hidden: false });
    return ok({ path: created });
  }
  if (method === 'session.list') return ok(sessions);
  if (method === 'workspace.list') return ok(workspaces);
  if (method === 'session.search') {
    const query = String(payload.query || '').toLowerCase();
    const hits = [];
    if (query.includes('unique-snippet') || query.includes('needle')) {
      hits.push({ sessionId: 's-1', snippet: 'unique-snippet-needle 工作区路径' });
    } else {
      for (const session of sessions.items) {
        const title = session.projections?.values?.title || '';
        if (title.toLowerCase().includes(query)) {
          hits.push({ sessionId: session.sessionId, snippet: title });
        }
      }
    }
    return ok({ items: hits.slice(0, 20) });
  }
  if (method === 'session.history') {
    const page = historyPage(payload);
    if (payload.beforeSeq === undefined) page.events = [...page.events, ...appendedEvents(payload.sessionId)];
    const window = tailWindow(page.events, payload.maxMessages);
    page.events = window.events;
    page.hasMore = page.hasMore || window.cut;
    return ok(page);
  }
  if (method === 'session.projections') {
    return ok({ values: sessionProjectionValues(payload.sessionId) });
  }
  if (method.startsWith('workspaceFiles.')) return ok(workspaceFilesRpc(method, payload.args));
  if (method === 'mcpServers.list') return ok({ servers: qa.world.mcp });
  if (method.startsWith('mcpServers.')) {
    const request = payload.args?.request || {};
    const server = qa.world.mcp.find((row) => row.id === request.id);
    if (!server) throw new Error('MCP 服务器不存在');
    if (method === 'mcpServers.setEnabled') server.enabled = request.enabled === true;
    if (method === 'mcpServers.delete') qa.world.mcp = qa.world.mcp.filter((row) => row !== server);
    if (method === 'mcpServers.test') {
      return ok({ ok: true, serverName: server.spec.serverName, transport: server.spec.transport, toolNames: server.connection?.tools || [], toolCount: server.connection?.tools?.length || 0, elapsedMs: 38 });
    }
    return ok({});
  }
  if (method === 'skillInventory.list') {
    return ok({ skills: qa.world.skills.map(({ content, path, writable, ...row }) => row) });
  }
  if (method.startsWith('skillInventory.')) {
    const request = payload.args?.request || {};
    const skill = qa.world.skills.find((row) => row.name === request.name);
    if (!skill) throw new Error('技能不存在');
    if (method === 'skillInventory.get') return ok({ ...skill });
    if (method === 'skillInventory.setInvocation') {
      skill.modelInvocable = request.modelInvocable === true;
      skill.userInvocable = request.userInvocable === true;
    }
    if (method === 'skillInventory.delete') qa.world.skills = qa.world.skills.filter((row) => row !== skill);
    return ok({});
  }
  if (method === 'pluginInventory.list') return ok({ managementAvailable: true, entries: [] });
  if (method === 'pluginManager.listPlugins') return ok(qa.world.plugins);
  if (method === 'pluginManager.listBundles') return ok(qa.world.bundles);
  if (method === 'pluginManager.setPluginEnabled') {
    const plugin = qa.world.plugins.find((row) => row.entryId === payload.args?.id);
    if (plugin) plugin.enabled = payload.args.enabled === true;
    return ok({ application: 'applied' });
  }
  if (method === 'pluginManager.setBundleEnabled') {
    const bundle = qa.world.bundles.find((row) => row.name === payload.args?.name);
    if (bundle) bundle.enabled = payload.args.enabled === true;
    return ok({ application: 'restart-required', restartReason: '插件包需要重新加载' });
  }
  if (method === 'session.create') {
    const id = `s-new-${qa.calls.length}`;
    const workspace = workspaces.items.find((item) => item.workspaceId === payload.workspaceId);
    const session = makeSession(id, '新会话', { cwd: workspace?.path || '' });
    sessions.items.unshift(session);
    if (workspace) workspace.sessionIds.unshift(id);
    return ok({ sessionId: id });
  }
  if (method === 'session.rename') {
    const session = findSession(payload.sessionId);
    if (!session) throw new Error('session not found');
    session.projections = session.projections || { values: {} };
    session.projections.values = { ...session.projections.values, title: payload.title };
    return ok({ sessionId: payload.sessionId });
  }
  if (method === 'session.fork') {
    const source = findSession(payload.sessionId);
    const id = `s-fork-${qa.calls.length}`;
    const copy = makeSession(id, `${source?.projections?.values?.title || '会话'}（fork）`, {
      cwd: source?.cwd,
    });
    sessions.items.unshift(copy);
    return ok({ sessionId: id });
  }
  if (method === 'session.delete') {
    sessions.items = sessions.items.filter((session) => session.sessionId !== payload.sessionId);
    workspaces.archivedSessionIds = workspaces.archivedSessionIds.filter((id) => id !== payload.sessionId);
    return ok({});
  }
  if (method === 'session.models') return ok(qa.world.models);
  if (method === 'session.selectModel') {
    qa.world.models.current = {
      provider: payload.provider,
      model: payload.model,
      ...(payload.reasoningEffort ? { reasoningEffort: payload.reasoningEffort } : {}),
    };
    return ok({ selected: qa.world.models.current });
  }
  if (method === 'session.prompt') {
    const session = findSession(payload.sessionId);
    if (session) session.running = true;
    const text = payload.content?.[0]?.text || '';
    if (text.startsWith('/permission ') && session) {
      session.projections.values.permissionPreset = text.slice('/permission '.length).trim();
    }
    qa.world.lastPrompt = payload;
    if (!qa.world.holdPromptEcho) {
      const base = historyPage({ sessionId: payload.sessionId }).events;
      qa.appendEvent(payload.sessionId, {
        type: 'user/message',
        seq: nextSeq(payload.sessionId, base),
        data: { id: `u-${payload.requestId}`, source: { kind: 'user' }, content: payload.content || [] },
      });
    }
    return ok({ accepted: true, requestId: payload.requestId });
  }
  if (method === 'session.cancel') {
    const session = findSession(payload.sessionId);
    if (session) session.running = false;
    return ok({});
  }
  if (method === 'session.attachment') {
    if (String(payload.attachmentId || '').startsWith('broken')) throw new Error('附件已不可用');
    return ok({ attachment: { attachmentId: payload.attachmentId, mediaType: 'image/png' }, data: PNG_1PX_BASE64 });
  }
  if (method === 'session.updateQueue') {
    const inbox = qa.world.inbox[payload.sessionId] || {};
    for (const target of Object.keys(inbox)) {
      const index = inbox[target].findIndex((item) => item.id === payload.itemId);
      if (index < 0) continue;
      if (payload.action?.kind === 'edit') inbox[target][index] = { ...inbox[target][index], content: payload.action.content };
      else inbox[target].splice(index, 1);
    }
    return ok({ accepted: true });
  }
  if (method === 'workspace.create') {
    const id = `ws-${qa.calls.length}`;
    workspaces.items.push({
      workspaceId: id,
      title: payload.path.split('/').pop() || payload.path,
      path: payload.path,
      sessionIds: [],
    });
    return ok({ workspaceId: id });
  }
  if (method === 'workspace.rename') {
    const workspace = workspaces.items.find((item) => item.workspaceId === payload.workspaceId);
    if (workspace) workspace.title = payload.title;
    return ok({});
  }
  if (method === 'workspace.delete') {
    workspaces.items = workspaces.items.filter((item) => item.workspaceId !== payload.workspaceId);
    return ok({});
  }
  if (method === 'workspace.archiveSession') {
    if (!workspaces.archivedSessionIds.includes(payload.sessionId)) {
      workspaces.archivedSessionIds.push(payload.sessionId);
    }
    return ok({});
  }
  if (method === 'workspace.unarchiveSession') {
    workspaces.archivedSessionIds = workspaces.archivedSessionIds.filter((id) => id !== payload.sessionId);
    return ok({});
  }
  if (method === 'workspace.insertSessionBefore' || method === 'workspace.insertBefore') {
    return ok({});
  }
  if (method === 'respond') return ok({});
  if (method === 'agentPreset.list' || method === 'skill.list' || method === 'llm.models' || method === 'llm.providers') {
    return ok({ items: [] });
  }
  if (method === 'subagent.list') return ok({ items: [] });
  throw new Error(`unsupported host method ${method}`);
}

function handleGitRpc(action, cwd, payload = {}) {
  const git = qa.world.git;
  if (action === 'git-status' || action === 'git-fetch-status') {
    return ok({ ...git, cwd });
  }
  if (action === 'git-branch-list') {
    return ok({ ok: true, branches: git.branches });
  }
  if (action === 'git-init') {
    git.isRepo = true;
    git.refName = 'main';
    return ok({ ok: true });
  }
  if (action === 'git-create-branch') {
    for (const branch of git.branches) branch.isCurrent = false;
    git.branches.push({ name: payload.name, isCurrent: true, isRemote: false });
    git.refName = payload.name;
    return ok({ ok: true });
  }
  if (action === 'git-switch-branch') {
    git.refName = payload.ref;
    return ok({ ok: true });
  }
  if (action === 'git-commit') {
    git.hasWorkingTreeChanges = false;
    git.aheadCount += 1;
    return ok({ ok: true });
  }
  if (action === 'git-push') return ok({ ok: true });
  if (action === 'git-pull') {
    git.behindCount = 0;
    return ok({ ok: true });
  }
  if (action === 'git-create-change-request') return ok({ ok: true, url: 'https://example.com/pr/1' });
  if (action === 'git-publish') {
    git.hasPrimaryRemote = true;
    git.hasUpstream = true;
    return ok({ ok: true });
  }
  if (action === 'git-pull-request') return ok(git.pr);
  if (action === 'git-status-entries') return ok({ entries: [] });
  if (action === 'git-diff') {
    if (payload.options?.baseRef === 'missing') return ok(null);
    return ok({
      files: [
        {
          path: 'mobile/web/app.js', status: 'modified',
          hunks: [{ header: '@@ -10,3 +10,4 @@', lines: [
            { kind: 'context', text: 'const before = 1;' },
            { kind: 'del', text: 'legacyCall();' },
            { kind: 'add', text: 'phase2Call();' },
            { kind: 'add', text: 'phase2Extra();' },
          ] }],
        },
        { path: 'assets/logo.png', status: 'added', hunks: [] },
      ],
      ...(payload.options?.baseRef ? { baseRef: payload.options.baseRef } : {}),
    });
  }
  throw new Error(`unsupported git action ${action}`);
}

function pagedAgents(list, page) {
  const limit = Number.isInteger(page?.limit) ? page.limit : 100;
  const start = page?.cursor ? Number(String(page.cursor).replace('cur-', '')) : 0;
  const slice = list.slice(start, start + limit);
  const nextIndex = start + slice.length;
  return {
    entries: slice.map((agent) => ({ agent })),
    pageInfo: {
      nextCursor: nextIndex < list.length ? `cur-${nextIndex}` : null,
      hasMore: nextIndex < list.length,
    },
  };
}

class DaemonClient {
  setReconnectEnabled(enabled) { this.reconnectEnabled = enabled; }
  getConnectionState() { return this.connectionState || { status: 'connected' }; }
  ensureConnected() { record('ensureConnected', []); }
  async checkLiveness() { record('checkLiveness', []); }
  constructor(options) {
    this.options = options || {};
    this.handlers = new Map();
    this.statusListeners = new Set();
    qa.clients.push(this);
  }

  _emit(type, message) {
    for (const handler of this.handlers.get(type) || []) {
      handler(message);
    }
  }

  _emitStatus(state) {
    this.connectionState = state;
    for (const listener of this.statusListeners) {
      listener(state);
    }
  }

  async connect() {
    record('connect', []);
    this.options.onRelayDeviceAuthResult?.({
      ok: true,
      deviceId: this.options.relayDeviceAuth?.deviceId || 'dev_qa',
      deviceSecret: 'secret_qa',
    });
  }

  async close() {
    record('close', []);
  }

  on(type, handler) {
    const bucket = this.handlers.get(type) || new Set();
    bucket.add(handler);
    this.handlers.set(type, bucket);
    return () => bucket.delete(handler);
  }

  subscribeConnectionStatus(listener) {
    this.statusListeners.add(listener);
    listener({ status: 'connected' });
    return () => this.statusListeners.delete(listener);
  }

  async hostRpc(method, payload) {
    const failed = record('hostRpc', [method, payload]);
    if (failed) return failed;
    const named = record(method, [payload]);
    if (named) return named;
    return handleHostRpc(method, payload || {});
  }

  async gitRpc(action, cwd, payload) {
    const failed = record('gitRpc', [action, cwd, payload]);
    if (failed) return failed;
    const named = record(action, [cwd, payload]);
    if (named) return named;
    return handleGitRpc(action, cwd, payload || {});
  }

  subscribeHostMux(onFrame) {
    record('subscribeHostMux', []);
    this.muxListeners = this.muxListeners || new Set();
    this.muxListeners.add(onFrame);
    return () => this.muxListeners.delete(onFrame);
  }

  async fetchAgents(options) {
    record('fetchAgents', [options]);
    throw new Error('fetchAgents is not the paired host path');
  }

  async fetchAgentHistory(options) {
    const failed = record('fetchAgentHistory', [options]);
    if (failed) return failed;
    const list = options?.filter?.includeArchived
      ? qa.world.agents.slice()
      : qa.world.agents.filter((agent) => !agent.archivedAt);
    const sort = options?.sort?.[0];
    if (sort?.key === 'updated_at') {
      list.sort((a, b) => (sort.direction === 'desc'
        ? (b.updatedAt || 0) - (a.updatedAt || 0)
        : (a.updatedAt || 0) - (b.updatedAt || 0)));
    }
    return pagedAgents(list, options?.page);
  }

  async fetchAgentTimeline(agentId, options) {
    const failed = record('fetchAgentTimeline', [agentId, options]);
    if (failed) return failed;
    const agent = findAgent(agentId);
    if (!agent) return { error: 'agent not found', entries: [] };
    if (agentId !== 'agent-1') {
      return {
        agent,
        entries: [timelineEntry(1), timelineEntry(2)],
        startCursor: { epoch: EPOCH, seq: 1 },
        endCursor: { epoch: EPOCH, seq: 2 },
        hasOlder: false,
        hasNewer: false,
        reset: false,
        staleCursor: false,
      };
    }
    if (options?.direction === 'before') {
      const before = options?.cursor?.seq ?? 1;
      // Deliberate one-entry overlap with the tail window to prove seq dedup.
      const end = Math.min(before, TIMELINE_SEQ_MAX);
      const start = Math.max(1, end - (options?.limit ?? 200) + 1);
      const entries = [];
      for (let seq = start; seq <= end; seq += 1) entries.push(timelineEntry(seq));
      return {
        agent,
        entries,
        startCursor: { epoch: EPOCH, seq: start },
        endCursor: { epoch: EPOCH, seq: end },
        hasOlder: start > 1,
        hasNewer: true,
        reset: false,
        staleCursor: false,
      };
    }
    const start = TIMELINE_SEQ_MAX - TAIL_LIMIT_SPAN + 1;
    const entries = [];
    for (let seq = start; seq <= TIMELINE_SEQ_MAX; seq += 1) entries.push(timelineEntry(seq));
    return {
      agent,
      entries,
      startCursor: { epoch: EPOCH, seq: start },
      endCursor: { epoch: EPOCH, seq: TIMELINE_SEQ_MAX },
      hasOlder: true,
      hasNewer: false,
      reset: false,
      staleCursor: false,
    };
  }

  async fetchWorkspaces(options) {
    const failed = record('fetchWorkspaces', [options]);
    if (failed) return failed;
    return {
      entries: [
        {
          id: 'ws-mobile',
          name: 'mobile',
          projectDisplayName: 'acme/mobile',
          workspaceDirectory: '/repo/mobile',
          projectRootPath: '/repo/mobile',
          gitRuntime: { currentBranch: 'main' },
        },
        {
          id: 'ws-desktop',
          name: 'desktop',
          projectDisplayName: 'acme/desktop',
          workspaceDirectory: '/repo/desktop',
          projectRootPath: '/repo/desktop',
          gitRuntime: { currentBranch: 'dev' },
        },
      ],
    };
  }

  async getProvidersSnapshot(options) {
    const failed = record('getProvidersSnapshot', [options]);
    if (failed) return failed;
    return {
      entries: [
        {
          provider: 'dsh',
          status: 'ready',
          enabled: true,
          label: 'DeepSeek Harness',
          modes: providerModes(),
          defaultModeId: 'plan',
          models: providerModels(),
        },
        { provider: 'codex', status: 'unavailable', enabled: true },
      ],
    };
  }

  async listProviderModels(provider, options) {
    const failed = record('listProviderModels', [provider, options]);
    if (failed) return failed;
    return { models: providerModels() };
  }

  async listCommands(agentId) {
    const failed = record('listCommands', [agentId]);
    if (failed) return failed;
    return {
      commands: [
        { name: 'commit', description: '提交当前更改', argumentHint: '<message>' },
        { name: 'compact', description: '压缩上下文' },
        { name: 'review', description: '审查代码改动' },
      ],
    };
  }

  async createAgent(options) {
    record('createAgent', [options]);
    throw new Error('createAgent is not the paired host path');
  }

  async sendAgentMessage(agentId, text, options) {
    const failed = record('sendAgentMessage', [agentId, text, options]);
    if (failed) return failed;
  }

  async cancelAgent(agentId) {
    const failed = record('cancelAgent', [agentId]);
    if (failed) return failed;
  }

  async setAgentMode(agentId, modeId) {
    const failed = record('setAgentMode', [agentId, modeId]);
    if (failed) return failed;
    if (modeId === 'full') {
      throw new Error('provider rejected full access');
    }
    const agent = findAgent(agentId);
    if (agent) agent.currentModeId = modeId;
  }

  async setAgentModel(agentId, modelId) {
    const failed = record('setAgentModel', [agentId, modelId]);
    if (failed) return failed;
    const agent = findAgent(agentId);
    if (agent) agent.model = modelId;
  }

  async respondToPermission(agentId, requestId, response) {
    const failed = record('respondToPermission', [agentId, requestId, response]);
    if (failed) return failed;
    const agent = findAgent(agentId);
    if (agent) {
      agent.pendingPermissions = (agent.pendingPermissions || [])
        .filter((request) => request.id !== requestId);
    }
  }

  async archiveAgent(agentId) {
    const failed = record('archiveAgent', [agentId]);
    if (failed) return failed;
    const agent = findAgent(agentId);
    if (agent) {
      agent.archivedAt = new Date().toISOString();
      agent.updatedAt = Date.now();
    }
  }

  async deleteAgent(agentId) {
    const failed = record('deleteAgent', [agentId]);
    if (failed) return failed;
    qa.world.agents = qa.world.agents.filter((agent) => agent.id !== agentId);
  }

  async updateAgent(agentId, patch) {
    const failed = record('updateAgent', [agentId, patch]);
    if (failed) return failed;
    const agent = findAgent(agentId);
    if (!agent) throw new Error('agent not found');
    if (typeof patch?.name === 'string' && patch.name) {
      agent.title = patch.name;
    }
    if (patch?.regenerateTitle === true) {
      agent.title = `${agent.title}（已重生成）`;
    }
    qa.emitAgentUpdate('upsert', { ...agent });
  }

  async refreshAgent(agentId) {
    const failed = record('refreshAgent', [agentId]);
    if (failed) return failed;
    const agent = findAgent(agentId);
    if (agent) {
      delete agent.archivedAt;
      qa.emitAgentUpdate('upsert', { ...agent });
    }
  }

  // —— Phase 2：Files / Diff / Git status / MCP / Skills（只读） —— //

  async getCheckoutStatus(cwd) {
    const failed = record('getCheckoutStatus', [cwd]);
    if (failed) return failed;
    return {
      cwd,
      isGit: true,
      currentBranch: 'main',
      baseRef: 'main',
      isDirty: true,
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
      error: null,
    };
  }

  async checkoutPrStatus(cwd) {
    const failed = record('checkoutPrStatus', [cwd]);
    if (failed) return failed;
    return { cwd, status: null, error: null };
  }

  async listDirectory(cwd, path) {
    const failed = record('listDirectory', [cwd, path]);
    if (failed) return failed;
    const tree = qa.world.fileTree;
    const children = tree[path || ''];
    if (!children) throw new Error(`ENOENT: ${path}`);
    return {
      path: path || '',
      entries: children.map((childPath) => {
        const file = tree.files[childPath];
        return {
          name: childPath.split('/').pop(),
          path: childPath,
          kind: file ? 'file' : 'directory',
          size: file ? (file.sizeOverride ?? file.bytes.byteLength) : 0,
          modifiedAt: '2026-08-27T00:00:00Z',
        };
      }),
    };
  }

  async readFile(cwd, path) {
    const failed = record('readFile', [cwd, path]);
    if (failed) return failed;
    const file = qa.world.fileTree.files[path];
    if (!file) throw new Error(`File unavailable: ${path}`);
    return {
      bytes: file.bytes,
      mime: file.mime,
      size: file.sizeOverride ?? file.bytes.byteLength,
      path,
      kind: file.fileKind,
      modifiedAt: '2026-08-27T00:00:00Z',
    };
  }

  async getDirectorySuggestions(options) {
    const failed = record('getDirectorySuggestions', [options]);
    if (failed) return failed;
    const tree = qa.world.fileTree;
    const query = String(options?.query || '').toLowerCase();
    const directories = Object.keys(tree).filter((key) => key && key !== 'files');
    const filePaths = Object.keys(tree.files);
    const entries = [
      ...directories.map((path) => ({ path, kind: 'directory' })),
      ...filePaths.map((path) => ({ path, kind: 'file' })),
    ].filter((entry) => entry.path.toLowerCase().includes(query));
    return {
      directories: entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.path),
      entries,
      error: null,
    };
  }

  async getCheckoutDiff(cwd, compare) {
    const failed = record('getCheckoutDiff', [cwd, compare]);
    if (failed) return failed;
    const payload = qa.world.diff[compare?.mode];
    if (!payload) throw new Error(`unknown diff mode ${compare?.mode}`);
    return { cwd, files: payload.files, error: payload.error, requestId: 'qa-diff' };
  }

  async listAgentMcpServers() {
    const failed = record('listAgentMcpServers', []);
    if (failed) return failed;
    return {
      requestId: 'qa-mcp',
      scopes: [],
      servers: qa.world.extensions.mcp.servers,
      policy: {},
      errors: qa.world.extensions.mcp.errors,
    };
  }

  async listAgentSkills() {
    const failed = record('listAgentSkills', []);
    if (failed) return failed;
    return {
      requestId: 'qa-skills',
      scopes: [],
      skills: qa.world.extensions.skills.skills,
      policy: {},
      errors: qa.world.extensions.skills.errors,
    };
  }
}

function parseConnectionOfferFromUrl(offerUrl) {
  const match = /#offer=([A-Za-z0-9_-]+)/.exec(String(offerUrl || ''));
  if (!match || match[1] !== 'QAFAKE') {
    throw new Error('not a QA offer');
  }
  return {
    serverId: 'qa-server',
    relay: { endpoint: '127.0.0.1:9', useTls: false },
    authBootstrap: { pairingToken: 'qa-token' },
    daemonPublicKeyB64: 'qa-public-key',
  };
}

function createRelayDeviceId() {
  return 'dev_qa';
}

function buildRelayWebSocketUrl({ serverId }) {
  return `ws://qa-fake/${serverId}`;
}

export {
  DaemonClient,
  buildRelayWebSocketUrl,
  createRelayDeviceId,
  parseConnectionOfferFromUrl,
};
