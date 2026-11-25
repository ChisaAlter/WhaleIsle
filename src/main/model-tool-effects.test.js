'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { register: registerLoaderHooks, registerHooks } = require('node:module');

const { TOOLS, BOT_TOOLS, LEGACY_TOOLS, ENDPOINTS, LEVELS, effectOf } = require('../shared/model-tool-effects');
const { storeInternalSecrets, INTERNAL_SECRETS_KEY } = require('../shared/secret');
const {
  startDesktopInstallControl,
  stopDesktopInstallControl,
} = require('./desktop-install-control');

const ROOT = path.join(__dirname, '..', '..');
const HIGH_RISK = new Set(['destructive', 'external', 'code']);

// 本文件所有 mkdtemp 目录统一登记，套件结束后无论成败一并回收（#478）。
const tempDirs = [];
test.after(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
const DECLINED_TEXT = '用户拒绝了这次操作，不要重试，除非用户再次明确要求。';

// ---------------------------------------------------------------------------
// Static scan: every model-callable tool name registered in the listed scope.
// ---------------------------------------------------------------------------

const SCAN_DIRS = [
  'vendor/dsh-whale/lib',
  'vendor/dsh-pad/lib',
  'vendor/dsh-project/lib',
  'vendor/dsh-deepseek-tools/lib',
  'vendor/dsh-task-control/lib',
  'vendor/dsh-platform-session/lib',
  'src/host',
  'dsh-acp/lib',
];

// The dsh-im host bundle is generated/minified; its source module registers
// the only model-callable tool and is the authoritative declaration site.
const SCAN_FILES = [
  'vendor/dsh-im/src/channels/shared/semantic/artifact.mjs',
];

// Files are only scanned for tool names when they actually register tools.
const REGISTRATION_HINT = /tools\.register|defineTool|projectTool|TOOL_DEFINITIONS|AGENT_TOOLS|register\(\s*['"]/;

const NAME_LITERAL = /name:\s*['"]([a-z][a-z0-9_]*)['"]/g;
const REGISTER_HELPER = /[^\w.]register\(\s*['"]([a-z][a-z0-9_]*)['"]/g;

// `name:` literals in scanned files that are not model-callable tools:
// storage domains, the MCP server info block and ACP session field literals.
const NON_TOOL_NAMES = new Set([
  'whaleisle',
  'authorization',
  'whale_todos',
  'whale_tasks',
  'whale_project_local',
]);

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function extractScanText(source) {
  const assign = /\b(?:var|const|let)\s+(?:__dshPadHostBody|body)\s*=\s*(?=['"])/.exec(source);
  if (!assign) return source;
  const start = assign.index + assign[0].length;
  const quote = source[start];
  let out = '';
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === quote) return `${source}\n${out}`;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    const esc = source[i];
    if (esc === 'n') out += '\n';
    else if (esc === 'r') out += '\r';
    else if (esc === 't') out += '\t';
    else if (esc === 'b') out += '\b';
    else if (esc === 'f') out += '\f';
    else if (esc === 'v') out += '\v';
    else if (esc === '0') out += '\0';
    else if (esc === 'x') {
      out += String.fromCharCode(Number.parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (esc === 'u') {
      if (source[i + 1] === '{') {
        const end = source.indexOf('}', i + 2);
        out += String.fromCodePoint(Number.parseInt(source.slice(i + 2, end), 16));
        i = end;
      } else {
        out += String.fromCharCode(Number.parseInt(source.slice(i + 1, i + 5), 16));
        i += 4;
      }
    } else {
      out += esc;
    }
  }
  return source;
}

function scanToolNames() {
  /** @type {Map<string, Set<string>>} tool name -> files defining it */
  const found = new Map();
  const files = [];
  for (const rel of SCAN_DIRS) collectFiles(path.join(ROOT, rel), files);
  for (const rel of SCAN_FILES) files.push(path.join(ROOT, rel));
  for (const file of files) {
    const source = extractScanText(fs.readFileSync(file, 'utf8'));
    if (!REGISTRATION_HINT.test(source)) continue;
    const names = new Set();
    for (const match of source.matchAll(NAME_LITERAL)) names.add(match[1]);
    for (const match of source.matchAll(REGISTER_HELPER)) names.add(match[1]);
    for (const name of names) {
      if (NON_TOOL_NAMES.has(name)) continue;
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(path.relative(ROOT, file).split(path.sep).join("/"));
    }
  }
  return found;
}

function endpointKeys() {
  const source = fs.readFileSync(path.join(ROOT, 'src/main/desktop-install-control.js'), 'utf8');
  const keys = new Set();
  for (const match of source.matchAll(/req\.method === '(GET|POST)' && pathname === '([^']+)'/g)) {
    keys.add(`${match[1]} ${match[2]}`);
  }
  return keys;
}

const EFFECTIVE_CONFIRM = new Set([true, 'keys', 'endpoint']);

function effectiveLevels(entry) {
  const levels = [entry.level];
  for (const action of Object.values(entry.actions ?? {})) levels.push(action.level);
  return levels;
}

const LEVEL_RANK = Object.freeze({
  read: 0,
  'harness-governed': 0,
  local: 1,
  external: 2,
  destructive: 3,
  code: 4,
});

// ---------------------------------------------------------------------------
// Static scan: every (tool, action) pair a plugin posts to /desktop/confirm
// must resolve to an explicit registry action entry whose level is not below
// the plugin's self-reported effect.
// ---------------------------------------------------------------------------

// Call sites whose tool or action expression is not a literal resolve against
// the exact values the plugin can pass, verified against the source.
const CONFIRM_TOOL_DOMAIN = {
  // confirmRiskySources(toolName, …) is shared by the three pad tools.
  'vendor/dsh-pad/lib/index.js': ['pad_test_source', 'pad_create', 'pad_update'],
  // confirmUpload(tool, …) fans out over the three DeepSeek upload tools.
  'vendor/dsh-deepseek-tools/lib/index.js': ['deepseek_tts', 'deepseek_asr', 'deepseek_ocr'],
};
const CONFIRM_ACTION_DOMAIN = {
  // remove skips the dialog; only steer/edit confirm.
  whale_update_queue: ['steer', 'edit'],
};

/** Slice a `{…}` literal starting at `open` (index of '{'), honoring quotes. */
function objectLiteralAt(source, open) {
  // Each frame tracks its own brace count: 'code' for normal code (a
  // `${`…`}` interpolation inside a template gets its own code frame whose
  // closing brace returns to template mode), quotes for string literals.
  const stack = [{ type: 'code', braces: 0, template: false }];
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const top = stack[stack.length - 1];
    if (top.type === "'" || top.type === '"') {
      if (ch === '\\') i += 1;
      else if (ch === top.type) stack.pop();
      continue;
    }
    if (top.type === '`') {
      if (ch === '\\') i += 1;
      else if (ch === '`') stack.pop();
      else if (ch === '$' && source[i + 1] === '{') { stack.push({ type: 'code', braces: 0, template: true }); i += 1; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { stack.push({ type: ch, braces: 0, template: false }); continue; }
    if (ch === '{') { top.braces += 1; continue; }
    if (ch === '}') {
      if (top.braces === 0) {
        if (top.template) { stack.pop(); continue; }
        return null;
      }
      top.braces -= 1;
      if (stack.length === 1 && top.braces === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/** String-literal values inside an expression ('a' | `b` | "c"). */
function stringLiterals(expr) {
  const out = [];
  for (const match of expr.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    out.push(match[1] ?? match[2] ?? match[3]);
  }
  return out;
}

/** Extract the raw `name:` expression from a confirm request object literal. */
function fieldExpr(block, name) {
  // Confirm request fields are literals, identifiers or simple conditionals:
  // the expression ends at the first comma, closing brace or newline.
  const keyed = new RegExp(`\\b${name}\\s*:\\s*([^\\n,}]+)`).exec(block);
  if (keyed) return keyed[1].trim();
  // Shorthand `{ name }` means a same-named variable — a dynamic value.
  if (new RegExp(`[{,\\s]${name}\\s*[,}]`).test(block)) return { dynamic: true };
  return null;
}

const CONFIRM_CALL = /confirmModelAction\s*\(\s*\{/g;

function confirmCalls() {
  const files = [];
  for (const rel of SCAN_DIRS) collectFiles(path.join(ROOT, rel), files);
  for (const rel of SCAN_FILES) files.push(path.join(ROOT, rel));
  /** @type {Array<{file:string, tool:?, action:?, effect:?}>} */
  const calls = [];
  for (const file of files) {
    const source = extractScanText(fs.readFileSync(file, 'utf8'));
    for (const match of source.matchAll(CONFIRM_CALL)) {
      const open = match.index + match[0].length - 1;
      const block = objectLiteralAt(source, open);
      calls.push({
        file: path.relative(ROOT, file).split(path.sep).join("/"),
        block,
        tool: block && fieldExpr(block, 'tool'),
        action: block && fieldExpr(block, 'action'),
        effect: block && fieldExpr(block, 'effect'),
      });
    }
  }
  return calls;
}

describe('model tool effect registry', () => {
  const discovered = scanToolNames();
  const confirms = confirmCalls();
  const allEffects = Object.entries({ ...TOOLS, ...BOT_TOOLS, ...LEGACY_TOOLS });

  test('every registered tool name appears in the registry', () => {
    const missing = [...discovered.keys()].filter((name) => !(name in TOOLS) && !(name in BOT_TOOLS));
    assert.deepEqual(missing, []);
  });

  test('registry contains no stale tool names', () => {
    const stale = Object.keys(TOOLS).filter((name) => !discovered.has(name));
    assert.deepEqual(stale, []);
  });

  test('legacy confirmation entries are only for the retired, separately installed bundle', () => {
    assert.deepEqual(Object.keys(LEGACY_TOOLS).sort(), [
      'chatgpt_browser', 'chatgpt_checkpoint', 'chatgpt_connection', 'chatgpt_record',
    ]);
    for (const name of Object.keys(LEGACY_TOOLS)) {
      assert.ok(!discovered.has(name) && !Object.hasOwn(TOOLS, name), `${name} is not supplied by the desktop`);
    }
  });

  test('registry levels and confirm flags are well formed', () => {
    for (const [name, entry] of allEffects) {
      assert.ok(LEVELS.includes(entry.level), `${name}: bad level ${entry.level}`);
      assert.ok(
        entry.confirm === true || entry.confirm === false || entry.confirm === 'keys' || entry.confirm === 'endpoint',
        `${name}: bad confirm flag`,
      );
      if (entry.confirm === 'keys') {
        assert.ok(Array.isArray(entry.keys) && entry.keys.length > 0, `${name}: keys list required`);
      }
      for (const [action, sub] of Object.entries(entry.actions ?? {})) {
        assert.ok(LEVELS.includes(sub.level), `${name}.${action}: bad level ${sub.level}`);
      }
    }
  });

  test('every high-risk action requires a confirmation path', () => {
    const unguarded = [];
    for (const [name, entry] of allEffects) {
      const risky = effectiveLevels(entry).some((level) => HIGH_RISK.has(level));
      if (risky && !EFFECTIVE_CONFIRM.has(entry.confirm)) unguarded.push(name);
    }
    assert.deepEqual(unguarded, []);
  });

  test('tools confirmed in-module call the confirm client in their defining file', () => {
    const failures = [];
    for (const [name, entry] of Object.entries(TOOLS)) {
      const files = discovered.get(name) ?? new Set();
      for (const file of files) {
        const source = extractScanText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        if ((entry.confirm === true || entry.confirm === 'keys') && !/confirmModelAction\s*\(/.test(source)) {
          failures.push(`${name} (${file})`);
        }
        if (entry.confirm === 'endpoint' && !/\/desktop\/|\/install|DSH_DESKTOP_INSTALL/.test(source)) {
          failures.push(`${name} endpoint (${file})`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });

  test('every routed /desktop endpoint appears in the endpoint registry', () => {
    const routed = endpointKeys();
    const missing = [...routed].filter((key) => !(key in ENDPOINTS));
    const stale = Object.keys(ENDPOINTS).filter((key) => !routed.has(key));
    assert.deepEqual({ missing, stale }, { missing: [], stale: [] });
  });

  test('shipped dsh-im bundle keeps the confirm endpoint call', () => {
    const bundle = fs.readFileSync(path.join(ROOT, 'vendor/dsh-im/lib/index.js'), 'utf8');
    assert.ok(bundle.includes('dsh_im_return_file'));
    assert.ok(bundle.includes('/desktop/confirm'));
  });

  test('every /desktop/confirm call resolves a registered action at or above its self-reported effect', () => {
    assert.ok(confirms.length > 0, 'confirm call scan found no /desktop/confirm call sites');
    const failures = [];
    const domain = (expr, kind, toolName, file) => {
      if (expr == null) return null;
      if (!expr.dynamic) {
        const literals = stringLiterals(expr);
        if (literals.length) return literals;
      }
      return kind === 'tool' ? CONFIRM_TOOL_DOMAIN[file] : CONFIRM_ACTION_DOMAIN[toolName];
    };
    for (const call of confirms) {
      if (!call.block) {
        failures.push(`${call.file}: unterminated confirmModelAction request`);
        continue;
      }
      const tools = domain(call.tool, 'tool', null, call.file);
      if (!tools?.length) {
        failures.push(`${call.file}: cannot resolve tool expression ${JSON.stringify(call.tool)}`);
        continue;
      }
      const effectLiterals = call.effect && !call.effect.dynamic ? stringLiterals(call.effect) : [];
      if (!effectLiterals.length) {
        failures.push(`${call.file} ${tools.join('|')}: cannot resolve self-reported effect`);
        continue;
      }
      const selfReported = effectLiterals.reduce(
        (lowest, level) => (LEVEL_RANK[level] < LEVEL_RANK[lowest] ? level : lowest),
      );
      for (const tool of tools) {
        const actions = domain(call.action, 'action', tool, call.file);
        if (!actions?.length) {
          failures.push(`${call.file} ${tool}: cannot resolve action expression ${JSON.stringify(call.action)}`);
          continue;
        }
        for (const action of actions) {
          const sub = TOOLS[tool]?.actions?.[action];
          if (!sub) {
            failures.push(`${call.file}: ${tool} ${action} has no explicit registry action entry`);
            continue;
          }
          if (LEVEL_RANK[sub.level] < LEVEL_RANK[selfReported]) {
            failures.push(`${call.file}: ${tool} ${action} resolves '${sub.level}' below self-reported '${selfReported}'`);
          }
        }
      }
    }
    assert.deepEqual(failures, []);
  });
});

describe('effectOf level resolution', () => {
  test('declared actions resolve to their own level', () => {
    assert.equal(effectOf('whale_update_queue', 'steer'), 'external');
    assert.equal(effectOf('whale_update_queue', 'edit'), 'external');
    assert.equal(effectOf('whale_update_queue', 'remove'), 'local');
    assert.equal(effectOf('whale_desktop_plugin', 'list'), 'read');
    assert.equal(effectOf('chatgpt_connection', 'unpair'), 'external');
    assert.equal(effectOf('whale_send_to_session', 'send'), 'external');
    assert.equal(effectOf('pad_create', 'run-sources'), 'code');
    assert.equal(effectOf('pad_update', 'run-sources'), 'code');
    assert.equal(effectOf('whale_desktop_config', 'patch'), 'external');
    assert.equal(effectOf('whale_desktop_config', 'patch-credentials'), 'destructive');
    assert.equal(effectOf('bot_work_start', 'start'), 'harness-governed');
    assert.equal(effectOf('bot_send', 'send'), 'harness-governed');
    assert.equal(effectOf('bot_tools_manage', 'list'), 'read');
    assert.equal(effectOf('bot_tools_manage', 'add'), 'code');
    assert.equal(effectOf('bot_tools_manage', 'update'), 'code');
    assert.equal(effectOf('bot_tools_manage', 'remove'), 'destructive');
    assert.equal(effectOf('bot_automation_create', 'create'), 'local');
    assert.equal(effectOf('bot_automation_create', 'delete'), 'local');
    assert.equal(effectOf('bot_reply', 'reply'), 'external');
    assert.equal(effectOf('bot_new_chat', 'create'), 'harness-governed');
  });

  test('an unknown action falls back to the strictest level the tool can reach', () => {
    assert.equal(effectOf('whale_update_queue', 'bogus'), 'external');
    assert.equal(effectOf('whale_desktop_plugin', 'bogus'), 'code');
    assert.equal(effectOf('chatgpt_connection', 'bogus'), 'external');
    assert.equal(effectOf('chatgpt_checkpoint', 'bogus'), 'local');
    assert.equal(effectOf('pad_create', 'bogus'), 'code');
    assert.equal(effectOf('whale_desktop_config', 'bogus'), 'destructive');
    assert.equal(effectOf('bot_tools_manage', 'bogus'), 'code');
    assert.equal(effectOf('bot_automation_create', 'bogus'), 'local');
  });

  test('a registered tool with no actions table treats an unknown action as unverifiable', () => {
    assert.equal(effectOf('whale_notify', 'anything'), undefined);
    assert.equal(effectOf('whale_marketplace', 'x'), undefined);
  });

  test('missing actions resolve to the tool level', () => {
    assert.equal(effectOf('whale_notify'), 'local');
    assert.equal(effectOf('whale_delete_session'), 'destructive');
    assert.equal(effectOf('whale_desktop_config'), 'local');
    assert.equal(effectOf('whale_desktop_plugin'), 'read');
  });

  test('unregistered tools resolve to undefined so callers can default to code', () => {
    assert.equal(effectOf('not_a_tool'), undefined);
    assert.equal(effectOf('not_a_tool', 'x'), undefined);
  });
});

// ---------------------------------------------------------------------------
// Refusal path: when the desktop confirmation declines (or the channel is
// unavailable), the side-effecting call behind each tool must not run.
// ---------------------------------------------------------------------------

// Several vendor modules import @deepseek-ai packages that only resolve inside
// vendor/dsh-whale. A resolve hook maps those specifiers (plus the chatgpt
// bridge build output and playwright-core, which are absent in the worktree)
// so the real tool modules can be loaded in tests.
let loaderHooksRegistered = false;
function ensureLoaderHooks() {
  if (loaderHooksRegistered) return;
  loaderHooksRegistered = true;
  const { installHarnessPeerHooks, resolveHarnessPeerPath } = require('../../scripts/lib/harness-peer-hook.cjs');
  installHarnessPeerHooks();
  const peerUrl = (specifier) => {
    const resolved = resolveHarnessPeerPath(specifier);
    if (!resolved) throw new Error(`Harness peer unavailable: ${specifier}`);
    return pathToFileURL(resolved).href;
  };
  // No installed schemastery has .volatile(); the Config schema is inert for
  // these tests, so a proxy wrapper adds it as a no-op on the Harness copy.
  const schemasteryShim = `data:text/javascript,${encodeURIComponent(
    `import RealSchema from ${JSON.stringify(peerUrl('@deepseek-ai/schemastery'))};
     const handler = {
       get(target, key) {
         if (key === 'volatile') return () => wrap(target);
         return wrap(Reflect.get(target, key));
       },
       apply(target, thisArg, args) { return wrap(Reflect.apply(target, thisArg, args)); },
     };
     function wrap(value) {
       return value !== null && (typeof value === 'object' || typeof value === 'function') ? new Proxy(value, handler) : value;
     }
     export default wrap(RealSchema);`,
  )}`;
  const map = {
    '@deepseek-ai/schemastery': schemasteryShim,
    '@deepseek-ai/dsh-tools': peerUrl('@deepseek-ai/dsh-tools'),
    '@deepseek-ai/dsh-llm': peerUrl('@deepseek-ai/dsh-llm'),
  };
  const needyParents = ['/vendor/dsh-pad/', '/vendor/dsh-deepseek-tools/'];
  const hooks = `export async function resolve(specifier, context, next) {
    const map = ${JSON.stringify(map)};
    const needy = ${JSON.stringify(needyParents)}.some((dir) => (context.parentURL || '').includes(dir));
    if (needy && Object.hasOwn(map, specifier)) return { url: map[specifier], shortCircuit: true };
    return next(specifier, context);
  }`;
  registerLoaderHooks(`data:text/javascript,${encodeURIComponent(hooks)}`);
  const cjsMap = {
    '@deepseek-ai/schemastery': peerUrl('@deepseek-ai/schemastery'),
    '@deepseek-ai/dsh-tools': peerUrl('@deepseek-ai/dsh-tools'),
    '@deepseek-ai/dsh-llm': peerUrl('@deepseek-ai/dsh-llm'),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if ((context.parentURL || '').includes('/vendor/dsh-pad/') && Object.hasOwn(cjsMap, specifier)) {
        return { url: cjsMap[specifier], shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

let savedEnv;
function stashEnv() {
  savedEnv ??= {
    url: process.env.DSH_DESKTOP_INSTALL_URL,
    store: globalThis[INTERNAL_SECRETS_KEY],
  };
}
function clearControlEnv() {
  stashEnv();
  delete process.env.DSH_DESKTOP_INSTALL_URL;
  storeInternalSecrets([]);
}

afterEach(() => {
  if (savedEnv) {
    if (savedEnv.url === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
    else process.env.DSH_DESKTOP_INSTALL_URL = savedEnv.url;
    globalThis[INTERNAL_SECRETS_KEY] = savedEnv.store;
    savedEnv = undefined;
  }
  stopDesktopInstallControl();
});

function controlEnv(url, token) {
  stashEnv();
  process.env.DSH_DESKTOP_INSTALL_URL = url;
  // The token is a credential: plugins read it from the in-process store
  // (#427), not env.
  storeInternalSecrets([['DSH_DESKTOP_INSTALL_TOKEN', token]]);
}

/** Start the real control server with a confirmer that always declines. */
async function decliningControl(desktop = {}) {
  const control = startDesktopInstallControl({
    confirmModelAction: async () => false,
    showSecret: async () => false,
    installPlugin: async () => ({ ok: true, spec: 'test' }),
    startHarness: () => {},
    desktop,
  });
  const { url, token } = await control.ready;
  controlEnv(url, token);
  return { url, token };
}

/** Start the real control server with a confirmer answering 'always'. */
async function alwaysControl(onRequest, desktop = {}) {
  const control = startDesktopInstallControl({
    confirmModelAction: async (request) => {
      onRequest?.(request);
      return 'always';
    },
    showSecret: async () => false,
    installPlugin: async () => ({ ok: true, spec: 'test' }),
    startHarness: () => {},
    desktop,
  });
  const { url, token } = await control.ready;
  controlEnv(url, token);
  return { url, token };
}

function makeCtx(services = {}) {
  const tools = new Map();
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); } },
    get: (key) => services[key],
    provide: () => {},
    effect: (fn) => { fn(); return () => {}; },
    on: () => {},
    emit: () => {},
    agents: services.agents,
    skills: services.skills ?? { register: () => {} },
    settings: services.settings ?? { configure: () => {} },
    credentials: services.credentials,
    subagents: services.subagents ?? { registerProvider: () => {} },
    sessionController: services.sessionController,
    systemPrompt: services.systemPrompt,
  };
  return { ctx, tools };
}

const agentAt = (cwd) => ({ id: 'agent-1', session: { header: { cwd } } });
const execFor = (agent) => ({ agent, signal: new AbortController().signal });

describe('refusal path', () => {
  test('whale_delete_session does not delete when confirmation declines', async () => {
    ensureLoaderHooks();
    const { registerSessionTools } = await import('../../vendor/dsh-whale/lib/session-tools.js');
    const deleted = [];
    const { ctx, tools } = makeCtx({ sessionController: { delete: async (args) => { deleted.push(args); return {}; } } });
    registerSessionTools(ctx);
    await decliningControl();
    const result = await tools.get('whale_delete_session').execute({ sessionId: 's-1' }, execFor(agentAt(ROOT)));
    assert.equal(result.ok, false);
    assert.equal(result.detail, DECLINED_TEXT);
    assert.equal(deleted.length, 0);
  });

  test('whale_delete_session fails closed when the channel is missing', async () => {
    ensureLoaderHooks();
    const { registerSessionTools } = await import('../../vendor/dsh-whale/lib/session-tools.js');
    const deleted = [];
    const { ctx, tools } = makeCtx({ sessionController: { delete: async (args) => { deleted.push(args); return {}; } } });
    registerSessionTools(ctx);
    clearControlEnv();
    const result = await tools.get('whale_delete_session').execute({ sessionId: 's-1' }, execFor(agentAt(ROOT)));
    assert.equal(result.ok, false);
    assert.equal(deleted.length, 0);
  });

  test('whale_send_to_session does not deliver when confirmation declines', async () => {
    ensureLoaderHooks();
    const { apply } = await import('../../vendor/dsh-whale/lib/tools.js');
    const agentGets = [];
    const { ctx, tools } = makeCtx({
      agents: { get: (id) => { agentGets.push(id); return undefined; } },
      sessionController: {},
    });
    apply(ctx);
    await decliningControl();
    const result = await tools.get('whale_send_to_session').execute({ sessionId: 's-2', text: 'hello' }, execFor(agentAt(ROOT)));
    assert.equal(result.ok, false);
    assert.equal(result.detail, DECLINED_TEXT);
    assert.equal(agentGets.length, 0);
  });

  test('whale_new_session does not create when confirmation declines', async () => {
    ensureLoaderHooks();
    const { apply } = await import('../../vendor/dsh-whale/lib/tools.js');
    const created = [];
    const { ctx, tools } = makeCtx({
      sessionController: { create: async (request) => { created.push(request); return { sessionId: 's' }; } },
    });
    apply(ctx);
    await decliningControl();
    const result = await tools.get('whale_new_session').execute({ cwd: ROOT }, execFor(agentAt(ROOT)));
    assert.equal(result.ok, false);
    assert.equal(result.detail, DECLINED_TEXT);
    assert.equal(created.length, 0);
  });

  test('whale_update_queue steer/edit do not inject when confirmation declines', async () => {
    ensureLoaderHooks();
    const { registerSessionTools } = await import('../../vendor/dsh-whale/lib/session-tools.js');
    const updates = [];
    const { ctx, tools } = makeCtx({
      sessionController: { updateQueue: async (args) => { updates.push(args); return {}; } },
    });
    registerSessionTools(ctx);
    await decliningControl();
    for (const action of ['steer', 'edit']) {
      const result = await tools.get('whale_update_queue').execute(
        { sessionId: 's-1', itemId: 'q-1', action, text: 'impersonate me' },
        execFor(agentAt(ROOT)),
      );
      assert.equal(result.ok, false);
      assert.equal(result.detail, DECLINED_TEXT);
    }
    assert.equal(updates.length, 0);
  });

  test('whale_desktop_config sensitive patch never reaches the config endpoint', async () => {
    ensureLoaderHooks();
    const { registerDesktopTools } = await import('../../vendor/dsh-whale/lib/desktop-tools.js');
    const applied = [];
    const { ctx, tools } = makeCtx();
    registerDesktopTools(ctx);
    await decliningControl({ applyConfig: async (patch) => { applied.push(patch); return { ok: true }; } });
    const result = await tools.get('whale_desktop_config').execute({ patch: { githubToken: 'ghp_x' } }, execFor(agentAt(ROOT)));
    assert.equal(result.ok, false);
    assert.equal(result.detail, DECLINED_TEXT);
    assert.equal(applied.length, 0);
  });

  test('acp_delegate tool does not delegate when confirmation declines', async () => {
    const { registerDelegation } = await import('../../dsh-acp/lib/delegation.js');
    const delegated = [];
    const manager = {
      listDelegationAgents: () => [],
      delegate: async (...args) => { delegated.push(args); return { childId: 'c', taskId: 't' }; },
      tasks: { get: () => ({}), snapshot: () => ({}) },
      waitTask: async () => ({}),
    };
    const { ctx, tools } = makeCtx();
    registerDelegation(ctx, manager);
    await decliningControl();
    await assert.rejects(
      tools.get('acp_delegate').execute({ agent: 'a1', prompt: 'run ls' }, { agent: { id: 'p1' }, signal: new AbortController().signal }),
      /拒绝了这次操作/,
    );
    assert.equal(delegated.length, 0);
  });

  test('acp_delegate over the whaleisle MCP endpoint does not delegate when declined', async () => {
    const { createWhaleIsleMcp } = await import('../../dsh-acp/lib/mcp-server.js');
    const delegated = [];
    const parent = { id: 'p1', session: { snapshotEvents: () => [] } };
    const { ctx } = makeCtx({ agents: { get: (id) => (id === 'p1' ? parent : undefined) } });
    const mcp = createWhaleIsleMcp({
      ctx,
      diag: () => {},
      listAgents: () => [],
      delegate: async (...args) => { delegated.push(args); return { childId: 'c', taskId: 't' }; },
      tasks: { latest: () => undefined, get: () => ({}), snapshot: () => ({}), cancel: async () => ({}), followup: async () => 'm1' },
      waitTask: async () => ({}),
    });
    const token = mcp.issueToken({ cwd: ROOT, agentName: 'acp', dshSession: { id: 'p1' } });
    mcp.bindSession(token, { id: 'p1' }, new AbortController().signal);
    const session = mcp.sessionFor(token);
    await decliningControl();
    const response = await mcp.dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'acp_delegate', arguments: { agent: 'a1', prompt: 'run ls' } } },
      session,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.result.isError, true);
    assert.equal(delegated.length, 0);
  });

  test('dsh_im_return_file does not stage the artifact when confirmation declines', async () => {
    const { createOutboundArtifactTool } = await import('../../vendor/dsh-im/src/channels/shared/semantic/artifact.mjs');
    const staged = [];
    const registry = { stage: async (...args) => { staged.push(args); return {}; } };
    const tool = createOutboundArtifactTool({ registry });
    await decliningControl();
    await assert.rejects(
      tool.definition.execute({ path: '/tmp/file.txt' }, {}),
      /拒绝了这次操作/,
    );
    assert.equal(staged.length, 0);
  });

  test('deepseek_tts does not call the API when confirmation declines', async () => {
    ensureLoaderHooks();
    const { apply } = await import('../../vendor/dsh-deepseek-tools/lib/index.js');
    const fetched = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, ...rest) => { fetched.push(String(url)); return originalFetch(url, ...rest); };
    try {
      const { ctx, tools } = makeCtx();
      apply(ctx, {
        baseURL: { get: () => 'https://api.deepseek.com' },
        apiKeyEnv: { get: () => 'DEEPSEEK_API_KEY' },
        tts: { get: () => true },
        asr: { get: () => true },
        ocr: { get: () => true },
        voice: { get: () => 'stella' },
        filterMarkdown: { get: () => true },
      });
      const { url } = await decliningControl();
      await assert.rejects(
        tools.get('deepseek_tts').execute({ text: '你好' }, { signal: new AbortController().signal }),
        /拒绝了这次操作/,
      );
      assert.ok(fetched.every((hit) => hit.startsWith(url)), `unexpected fetch: ${fetched.join(', ')}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('pad_test_source does not run a command source when confirmation declines', async () => {
    ensureLoaderHooks();
    const { registerTools } = await import('../../vendor/dsh-pad/lib/index.js');
    const marker = path.join(tempDir('pad-test-'), 'ran');
    const { ctx, tools } = makeCtx();
    registerTools({
      ctx,
      store: { get: () => undefined, list: () => [], approved: () => false },
      hub: { pushData: () => {}, runAll: async () => [], views: () => [] },
      refresher: undefined,
      limits: { minIntervalSec: 5, minAgentMinutes: 15 },
      autoApprove: true,
      resolveSecret: async () => 'x',
    });
    await decliningControl();
    await assert.rejects(
      tools.get('pad_test_source').execute(
        { source: { id: 's1', kind: 'command', command: `touch ${marker}`, parse: 'lines' } },
        { signal: new AbortController().signal },
      ),
      /拒绝了这次操作/,
    );
    assert.equal(fs.existsSync(marker), false);
  });

  test('pad_create does not persist a panel with a risky source when declined', async () => {
    ensureLoaderHooks();
    const { registerTools } = await import('../../vendor/dsh-pad/lib/index.js');
    const created = [];
    const { ctx, tools } = makeCtx();
    registerTools({
      ctx,
      store: { get: () => undefined, list: () => [], approved: () => false, create: async (...args) => { created.push(args); return { id: 'p1' }; } },
      hub: { pushData: () => {}, runAll: async () => [], views: () => [] },
      refresher: undefined,
      limits: { minIntervalSec: 5, minAgentMinutes: 15 },
      autoApprove: true,
      resolveSecret: async () => 'x',
    });
    await decliningControl();
    await assert.rejects(
      tools.get('pad_create').execute(
        { title: 't', html: '', css: '', script: '', height: 'auto', sources: [{ id: 's1', kind: 'command', command: 'echo hi', parse: 'lines', intervalSec: 5 }] },
        { signal: new AbortController().signal },
      ),
      /拒绝了这次操作/,
    );
    assert.equal(created.length, 0);
  });

  test('pad_delete does not remove the panel when confirmation declines', async () => {
    ensureLoaderHooks();
    const { registerTools } = await import('../../vendor/dsh-pad/lib/index.js');
    const removed = [];
    const panel = { id: 'p1', definition: { title: 't', sources: [] }, approvedSources: 'x' };
    const { ctx, tools } = makeCtx();
    registerTools({
      ctx,
      store: { get: () => panel, list: () => [panel], approved: () => true, remove: async (...args) => { removed.push(args); } },
      hub: { pushData: () => {}, runAll: async () => [], views: () => [] },
      refresher: undefined,
      limits: { minIntervalSec: 5, minAgentMinutes: 15 },
      autoApprove: false,
      resolveSecret: async () => 'x',
    });
    await decliningControl();
    await assert.rejects(
      tools.get('pad_delete').execute({ id: 'p1' }, { signal: new AbortController().signal }),
      /拒绝了这次操作/,
    );
    assert.equal(removed.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Run-scoped "always allow" grants (issue #513 F1/F2): a grant must never
// cover a different command or a different sensitive key set.
// ---------------------------------------------------------------------------

describe('run-scoped always grants', () => {
  test('pad_create command sources still ask after an always grant', async () => {
    ensureLoaderHooks();
    const { registerTools } = await import('../../vendor/dsh-pad/lib/index.js');
    const created = [];
    const { ctx, tools } = makeCtx();
    registerTools({
      ctx,
      store: {
        list: () => created,
        get: (id) => created.find((panel) => panel.id === id),
        approved: () => false,
        approve: async () => {},
        create: async (definition) => {
          const panel = { id: `p${created.length + 1}`, definition };
          created.push(panel);
          return panel;
        },
      },
      hub: { pushData: () => {}, runAll: async () => [], views: () => [] },
      refresher: undefined,
      limits: { minIntervalSec: 5, minAgentMinutes: 15 },
      autoApprove: true,
      resolveSecret: async () => 'x',
    });
    const asked = [];
    await alwaysControl((request) => asked.push(request));
    const exec = { signal: new AbortController().signal };
    const run = (command) => tools.get('pad_create').execute(
      { title: 't', html: '', css: '', script: '', height: 'auto', sources: [{ id: 's1', kind: 'command', command, parse: 'lines', intervalSec: 5 }] },
      exec,
    );
    await run('echo one');
    await run('echo two');
    assert.equal(created.length, 2);
    // F1: run-sources resolves 'code', which never remembers 'always' — the
    // second, different command must have asked again.
    assert.equal(asked.length, 2);
    assert.ok(asked.every((request) => request.effect === 'code'));
  });

  test('whale_desktop_config remembers per sensitive key set; credentials always re-ask', async () => {
    const { registerDesktopTools } = await import('../../vendor/dsh-whale/lib/desktop-tools.js');
    const applied = [];
    const { ctx, tools } = makeCtx();
    registerDesktopTools(ctx);
    const asked = [];
    await alwaysControl((request) => asked.push(request), {
      applyConfig: async (patch) => { applied.push(patch); return { ok: true }; },
    });
    const exec = execFor(agentAt(ROOT));
    const patch = (body) => tools.get('whale_desktop_config').execute({ patch: body }, exec);
    // First sensitive write asks; 'always' remembers only the {projectEnabled} set.
    assert.equal((await patch({ projectEnabled: true })).ok, true);
    assert.equal((await patch({ projectEnabled: true })).ok, true);
    assert.equal(asked.length, 1);
    // F2: a different sensitive key set asks again — the grant for
    // {projectEnabled} must not cover it.
    assert.equal((await patch({ openAtLogin: true })).ok, true);
    assert.equal(asked.length, 2);
    assert.equal(asked[0].effect, 'external');
    // Credential writes resolve 'patch-credentials' → destructive, so they
    // never store a remembered grant and every write asks.
    assert.equal((await patch({ githubToken: 'ghp_a' })).ok, true);
    assert.equal(asked.length, 3);
    assert.equal((await patch({ githubToken: 'ghp_b' })).ok, true);
    assert.equal(asked.length, 4);
    assert.equal(asked[2].effect, 'destructive');
    assert.equal(applied.length, 5);
  });
});
