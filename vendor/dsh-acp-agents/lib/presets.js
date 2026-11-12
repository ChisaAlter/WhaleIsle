import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ACP_PROVIDER_PREFIX = 'acp:';

export const DEFAULT_REASONING_EFFORTS = Object.freeze([
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
]);

/**
 * Built-in v1 Agent presets (T3 Code parity):
 * - Claude Code (`claude -p --output-format stream-json --verbose`)
 * - Codex (`codex app-server`)
 * - Antigravity (`agy acp` / `agy_acp_server.exe`)
 * - Devin (`devin acp`)
 */
export const BUILTIN_AGENT_PRESETS = Object.freeze([
  {
    id: 'claude-code',
    baseAgentId: 'claude-code',
    driverKind: 'claude-stream-json',
    builtin: true,
    name: 'Claude Code',
    badge: 'Anthropic',
    description: 'Anthropic Claude Code CLI，支持 Claude OAuth 登录与 API Key / 自定义 Base URL',
    command: 'claude',
    args: ['-p', '--output-format', 'stream-json', '--verbose'],
    env: {},
    profileDir: '',
    authMethod: 'claude-oauth',
    enabled: false,
    permissionPolicy: 'ask',
    favoriteModels: ['claude-sonnet-4-6', 'claude-opus-4-6'],
    hiddenModels: [],
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', defaultEffort: 'medium' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', defaultEffort: 'high' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', defaultEffort: 'medium' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', defaultEffort: 'low' },
    ],
  },
  {
    id: 'codex',
    baseAgentId: 'codex',
    driverKind: 'codex-app-server',
    builtin: true,
    name: 'Codex',
    badge: 'OpenAI',
    description: 'OpenAI Codex CLI (codex app-server)，支持 ChatGPT Pro/Plus 登录、设备码与 API Key',
    command: 'codex',
    args: ['app-server'],
    env: {},
    profileDir: '',
    authMethod: 'chatgpt',
    enabled: false,
    permissionPolicy: 'ask',
    favoriteModels: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.5'],
    hiddenModels: [],
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', defaultEffort: 'high' },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', defaultEffort: 'high' },
      { id: 'gpt-6-sol', name: 'GPT-6 Sol', defaultEffort: 'medium' },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', defaultEffort: 'medium' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', defaultEffort: 'medium' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', defaultEffort: 'medium' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', defaultEffort: 'low' },
      { id: 'gpt-5.5', name: 'GPT-5.5', defaultEffort: 'medium' },
      { id: 'gpt-5.4', name: 'GPT-5.4', defaultEffort: 'medium' },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', defaultEffort: 'medium' },
      { id: 'o3', name: 'o3', defaultEffort: 'high' },
    ],
  },
  {
    id: 'antigravity',
    baseAgentId: 'antigravity',
    driverKind: 'acp',
    builtin: true,
    name: 'Antigravity (反重力)',
    badge: 'Google DeepMind',
    description: 'Google DeepMind Antigravity CLI (agy acp)，支持 Google OAuth 浏览器登录与 Gemini API Key',
    command: 'agy',
    args: ['acp'],
    env: {},
    profileDir: '',
    authMethod: 'oauth-personal',
    enabled: false,
    permissionPolicy: 'ask',
    favoriteModels: ['gemini-4-argon-high', 'gemini-3.8-flash-high'],
    hiddenModels: [],
    models: [
      { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)', defaultEffort: 'high' },
      { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)', defaultEffort: 'medium' },
      { id: 'gemini-4-argon-low', name: 'Gemini 4 Argon (Low)', defaultEffort: 'low' },
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', defaultEffort: 'high' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)', defaultEffort: 'medium' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)', defaultEffort: 'low' },
    ],
  },
  {
    id: 'devin',
    baseAgentId: 'devin',
    driverKind: 'acp',
    builtin: true,
    name: 'Devin',
    badge: 'Cognition',
    description: 'Cognition Devin CLI (devin acp)，支持 Devin OAuth 账号登录与 130+ 多厂商模型',
    command: 'devin',
    args: ['acp'],
    env: {},
    profileDir: '',
    authMethod: 'devin-oauth',
    enabled: false,
    permissionPolicy: 'ask',
    favoriteModels: ['swe-1-6', 'claude-sonnet-4-6', 'claude-opus-4-6', 'gpt-5-4-none'],
    hiddenModels: [],
    models: [
      { id: 'swe-1-6', name: 'SWE-1.6', defaultEffort: 'high' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', defaultEffort: 'medium' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', defaultEffort: 'high' },
      { id: 'gpt-5-4-none', name: 'GPT-5.4', defaultEffort: 'medium' },
      { id: 'deepseek-v4-pro-high', name: 'DeepSeek V4 Pro', defaultEffort: 'high' },
    ],
  },
]);

export function providerIdForAgent(agentId) {
  const clean = String(agentId || '').trim();
  return clean.startsWith(ACP_PROVIDER_PREFIX) ? clean : `${ACP_PROVIDER_PREFIX}${clean}`;
}

export function agentIdFromProvider(providerId) {
  const clean = String(providerId || '').trim();
  if (!clean.startsWith(ACP_PROVIDER_PREFIX)) return null;
  const id = clean.slice(ACP_PROVIDER_PREFIX.length).trim();
  return id || null;
}

export function isAcpProvider(providerId) {
  return (
    typeof providerId === 'string'
    && providerId.startsWith(ACP_PROVIDER_PREFIX)
    && providerId.length > ACP_PROVIDER_PREFIX.length
  );
}

export function sanitizeId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function inferBaseAgentId(raw = {}, preset = null) {
  if (preset?.baseAgentId) return preset.baseAgentId;
  const explicit = String(raw?.baseAgentId || '').trim().toLowerCase();
  if (['claude-code', 'codex', 'antigravity', 'devin', 'custom'].includes(explicit)) {
    return explicit;
  }
  const id = String(raw?.id || '').toLowerCase();
  const cmd = path.basename(String(raw?.command || '')).toLowerCase();
  if (id.startsWith('claude') || cmd.startsWith('claude')) return 'claude-code';
  if (id.startsWith('codex') || cmd.startsWith('codex')) return 'codex';
  if (id.startsWith('antigravity') || id.startsWith('agy') || cmd.startsWith('agy')) return 'antigravity';
  if (id.startsWith('devin') || cmd.startsWith('devin')) return 'devin';
  return 'custom';
}

export function inferDriverKind(raw = {}, preset = null) {
  const explicit = String(raw?.driverKind || '').trim();
  if (['acp', 'codex-app-server', 'claude-stream-json'].includes(explicit)) {
    return explicit;
  }
  const baseId = inferBaseAgentId(raw, preset);
  const cmdBase = path.basename(String(raw?.command ?? preset?.command ?? '')).toLowerCase();
  const args = Array.isArray(raw?.args) ? raw.args : (preset?.args || []);
  if (baseId === 'codex') {
    if (args.includes('app-server') || /^codex(\.(exe|cmd|bat))?$/.test(cmdBase)) {
      return 'codex-app-server';
    }
    return 'acp';
  }
  if (baseId === 'claude-code') {
    if (args.includes('stream-json') || /^claude(\.(exe|cmd|bat))?$/.test(cmdBase)) {
      return 'claude-stream-json';
    }
    return 'acp';
  }
  return preset?.driverKind || 'acp';
}

export function normalizeModelList(models, fallbackModels = []) {
  const list = Array.isArray(models) ? models : fallbackModels;
  const seen = new Set();
  const normalized = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = String(item.name || id).trim() || id;
    const defaultEffort = ['low', 'medium', 'high'].includes(String(item.defaultEffort || '').trim())
      ? String(item.defaultEffort).trim()
      : 'medium';
    normalized.push({ id, name, defaultEffort });
  }
  if (normalized.length === 0 && fallbackModels.length > 0 && models !== fallbackModels) {
    return normalizeModelList(fallbackModels, []);
  }
  if (normalized.length === 0) {
    normalized.push({ id: 'default', name: 'Default', defaultEffort: 'medium' });
  }
  return normalized;
}

export function normalizeStringIdArray(list, fallback = []) {
  const src = Array.isArray(list) ? list : fallback;
  const seen = new Set();
  const out = [];
  for (const item of src) {
    const clean = String(item || '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export function normalizeEnvRecord(env) {
  const out = {};
  if (!env || typeof env !== 'object' || Array.isArray(env)) return out;
  for (const [key, value] of Object.entries(env)) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) continue;
    if (value === undefined || value === null) continue;
    out[cleanKey] = String(value);
  }
  return out;
}

export function normalizeArgsList(args, fallback = []) {
  if (Array.isArray(args)) {
    return args.map((arg) => String(arg ?? '').trim()).filter((arg) => arg.length > 0);
  }
  if (typeof args === 'string') {
    return args
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  return [...fallback];
}

export function normalizePermissionPolicy(policy) {
  if (policy === 'auto-allow' || policy === 'auto-allow-read' || policy === 'ask') {
    return policy;
  }
  return 'ask';
}

export function normalizeAgentRecord(raw, preset = null) {
  const id = preset ? preset.id : sanitizeId(raw?.id || raw?.name);
  if (!id) return null;
  const baseAgentId = inferBaseAgentId({ ...raw, id }, preset);
  const basePreset = preset || BUILTIN_AGENT_PRESETS.find((p) => p.id === baseAgentId) || null;
  const command = String(raw?.command ?? basePreset?.command ?? '').trim() || (basePreset?.command ?? id);

  let rawArgs = raw?.args !== undefined ? raw.args : basePreset?.args;
  // Auto-migrate legacy default args for codex (`['acp']` -> `['app-server']`)
  // and claude-code (`['--acp']` -> `['-p', '--output-format', 'stream-json', '--verbose']`)
  if (
    baseAgentId === 'codex'
    && Array.isArray(rawArgs)
    && rawArgs.length === 1
    && rawArgs[0] === 'acp'
  ) {
    rawArgs = ['app-server'];
  }
  if (
    baseAgentId === 'claude-code'
    && Array.isArray(rawArgs)
    && rawArgs.length === 1
    && rawArgs[0] === '--acp'
  ) {
    rawArgs = ['-p', '--output-format', 'stream-json', '--verbose'];
  }

  const args = normalizeArgsList(rawArgs, basePreset?.args ?? ['--acp']);
  const driverKind = inferDriverKind({ driverKind: raw?.driverKind, id, baseAgentId, command, args }, basePreset);
  const name = String(raw?.name ?? basePreset?.name ?? id).trim() || id;
  const badge = String(raw?.badge ?? basePreset?.badge ?? 'ACP').trim() || 'ACP';
  const description = String(raw?.description ?? basePreset?.description ?? '').trim();
  const env = normalizeEnvRecord(raw?.env !== undefined ? raw.env : basePreset?.env);
  const profileDir = String(raw?.profileDir ?? basePreset?.profileDir ?? '').trim();
  const authMethod = String(raw?.authMethod ?? basePreset?.authMethod ?? '').trim();
  const enabled = Boolean(raw?.enabled ?? basePreset?.enabled ?? false);
  const permissionPolicy = normalizePermissionPolicy(raw?.permissionPolicy ?? basePreset?.permissionPolicy);
  const models = normalizeModelList(raw?.models, basePreset?.models ?? []);
  const favoriteModels = normalizeStringIdArray(raw?.favoriteModels, basePreset?.favoriteModels ?? []);
  const hiddenModels = normalizeStringIdArray(raw?.hiddenModels, basePreset?.hiddenModels ?? []);

  return {
    id,
    baseAgentId,
    driverKind,
    providerId: providerIdForAgent(id),
    builtin: Boolean(preset?.builtin),
    name,
    badge,
    description,
    command,
    args,
    env,
    profileDir,
    authMethod,
    enabled,
    permissionPolicy,
    models,
    favoriteModels,
    hiddenModels,
  };
}

export function mergeAgentsWithPresets(storedAgents = []) {
  const byId = new Map();
  if (Array.isArray(storedAgents)) {
    for (const entry of storedAgents) {
      if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
        const cleanId = sanitizeId(entry.id);
        if (!cleanId) continue;
        let patched = { ...entry, id: cleanId };
        // Migrate legacy placeholder model IDs from earlier preset versions
        if (
          cleanId === 'devin'
          && Array.isArray(patched.models)
          && patched.models.some((m) => m?.id === 'devin-default')
        ) {
          const { models: _drop, ...rest } = patched;
          patched = rest;
        }
        if (
          cleanId === 'antigravity'
          && Array.isArray(patched.models)
          && patched.models.some((m) => m?.id === 'gemini-2.5-pro')
        ) {
          const { models: _drop, ...rest } = patched;
          patched = rest;
        }
        if (
          cleanId === 'codex'
          && Array.isArray(patched.models)
          && patched.models.length <= 4
          && patched.models.every((m) => ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'o3'].includes(m?.id))
        ) {
          const { models: _drop, ...rest } = patched;
          patched = rest;
        }
        if (
          typeof patched.description === 'string'
          && (patched.description.includes('(claude --acp)') || patched.description.includes('(codex acp)'))
        ) {
          const { description: _dropDesc, ...rest } = patched;
          patched = rest;
        }
        byId.set(cleanId, patched);
      }
    }
  }
  const merged = [];
  const handled = new Set();
  for (const preset of BUILTIN_AGENT_PRESETS) {
    handled.add(preset.id);
    const saved = byId.get(preset.id);
    merged.push(normalizeAgentRecord(saved || preset, preset));
  }
  for (const [id, saved] of byId.entries()) {
    if (handled.has(id)) continue;
    const custom = normalizeAgentRecord(saved, null);
    if (custom) merged.push(custom);
  }
  return merged;
}

/**
 * Resolve the effective environment variables for spawning an agent or running its auth CLI,
 * including its isolated `profileDir` (`GEMINI_HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`) if configured.
 */
export function buildAgentRuntimeEnv(agentConfig, resolvedBinary = null) {
  const mergedEnv = {
    ...process.env,
    ...(agentConfig?.env || {}),
  };
  const baseId = agentConfig?.baseAgentId || inferBaseAgentId(agentConfig || {});
  const profileDir = String(agentConfig?.profileDir || '').trim();

  if (profileDir) {
    try {
      fs.mkdirSync(profileDir, { recursive: true });
    } catch {
      // ignore
    }
    if (baseId === 'antigravity' && !mergedEnv.GEMINI_HOME) {
      mergedEnv.GEMINI_HOME = profileDir;
    } else if (baseId === 'codex' && !mergedEnv.CODEX_HOME) {
      mergedEnv.CODEX_HOME = profileDir;
    } else if (baseId === 'claude-code' && !mergedEnv.CLAUDE_CONFIG_DIR) {
      mergedEnv.CLAUDE_CONFIG_DIR = profileDir;
    }
  }

  const binName = path.basename(String(resolvedBinary || agentConfig?.command || '')).toLowerCase();
  if (baseId === 'antigravity' || binName.startsWith('agy_acp_server')) {
    if (resolvedBinary) {
      const binDir = path.dirname(resolvedBinary);
      const harnessExe = process.platform === 'win32' ? 'localharness_external.exe' : 'localharness_external';
      const harnessCandidate = path.join(binDir, harnessExe);
      if (!mergedEnv.ANTIGRAVITY_HARNESS_PATH && fs.existsSync(harnessCandidate)) {
        mergedEnv.ANTIGRAVITY_HARNESS_PATH = harnessCandidate;
      }
    }
    if (!mergedEnv.AGY_ACP_FORCE_FILE_STORAGE) {
      mergedEnv.AGY_ACP_FORCE_FILE_STORAGE = '1';
    }
    if (!mergedEnv.PYTHONUNBUFFERED) {
      mergedEnv.PYTHONUNBUFFERED = '1';
    }
    if (!mergedEnv.ELECTRON_RUN_AS_NODE) {
      mergedEnv.ELECTRON_RUN_AS_NODE = '1';
    }
    if (!mergedEnv.GEMINI_HOME) {
      const discovered = discoverDefaultAntigravityHome();
      if (discovered) {
        mergedEnv.GEMINI_HOME = discovered;
      }
    }
    if (mergedEnv.GEMINI_HOME) {
      try {
        const agyAcpDir = path.join(mergedEnv.GEMINI_HOME, 'antigravity-acp');
        const tmpDir = path.join(mergedEnv.GEMINI_HOME, 'tmp');
        fs.mkdirSync(agyAcpDir, { recursive: true });
        fs.mkdirSync(tmpDir, { recursive: true });
        mergedEnv.TEMP = tmpDir;
        mergedEnv.TMP = tmpDir;
        const settingsFile = path.join(agyAcpDir, 'settings.json');
        if (!fs.existsSync(settingsFile)) {
          const authType = mergedEnv.GEMINI_API_KEY ? 'gemini-api-key' : 'oauth-personal';
          fs.writeFileSync(settingsFile, JSON.stringify({ auth: { type: authType } }), 'utf8');
        }
      } catch {
        // ignore
      }
    }
  }

  return mergedEnv;
}

export function discoverDefaultAntigravityHome() {
  const home = os.homedir();
  const dshAgyHome = path.join(process.env.DSH_HOME || path.join(home, '.dsh'), 'antigravity');
  if (fs.existsSync(path.join(dshAgyHome, 'antigravity-acp', 'settings.json'))) {
    return dshAgyHome;
  }
  const t3ProvidersDir = path.join(home, '.t3', 'userdata', 'providers', 'antigravity');
  try {
    if (fs.existsSync(t3ProvidersDir)) {
      for (const acc of fs.readdirSync(t3ProvidersDir)) {
        const candidateHome = path.join(t3ProvidersDir, acc);
        if (fs.existsSync(path.join(candidateHome, 'antigravity-acp', 'settings.json'))) {
          return candidateHome;
        }
      }
    }
  } catch {
    // ignore
  }
  return dshAgyHome;
}

/**
 * Resolve a CLI binary across PATH and common user tool directories (npm global,
 * .local/bin, .cargo/bin, .t3/tools, AppData/Local/devin, Tools/codex).
 */
export function resolveCommandBinary(command, customEnv = {}) {
  const raw = String(command || '').trim();
  if (!raw) return null;
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (path.extname(raw) ? [''] : ['.exe', '.cmd', '.bat', ''])
    : [''];

  const checkCandidate = (candidate) => {
    for (const ext of exts) {
      const full = candidate + ext;
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) return full;
      } catch {
        // ignore
      }
    }
    return null;
  };

  if (path.isAbsolute(raw) || raw.includes('/') || raw.includes('\\')) {
    return checkCandidate(raw);
  }

  const pathEnv = customEnv.PATH || customEnv.Path || process.env.PATH || process.env.Path || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  if (home) {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
    if (process.env.LOCALAPPDATA) {
      dirs.push(path.join(process.env.LOCALAPPDATA, 'devin', 'cli', 'bin'));
    }
    dirs.push(
      path.join(home, 'Tools', 'codex', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.cargo', 'bin'),
      path.join(home, '.claude', 'local'),
    );
    // Also check ~/.t3/tools/<tool>/<ver>/<arch> if present (e.g. devin, codex)
    const t3ToolsDir = path.join(home, '.t3', 'tools', raw);
    try {
      if (fs.existsSync(t3ToolsDir)) {
        for (const ver of fs.readdirSync(t3ToolsDir).sort().reverse()) {
          const verDir = path.join(t3ToolsDir, ver);
          if (!fs.statSync(verDir).isDirectory()) continue;
          for (const arch of fs.readdirSync(verDir)) {
            dirs.push(path.join(verDir, arch));
            dirs.push(path.join(verDir, arch, 'bin'));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  for (const dir of dirs) {
    const found = checkCandidate(path.join(dir, raw));
    if (found) return found;
  }

  // Fallback for Antigravity (`agy` / `agy_acp_server`): check ~/.t3/tools/antigravity-acp/<plat>/versions/<id>/agy_acp_server
  if (home && (raw === 'agy' || raw === 'agy_acp_server' || raw === 'antigravity-acp')) {
    const platKey = `${process.platform}-${process.arch}`;
    const agyBase = path.join(home, '.t3', 'tools', 'antigravity-acp', platKey);
    try {
      const activeFile = path.join(agyBase, 'active.json');
      if (fs.existsSync(activeFile)) {
        const active = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
        if (active?.releaseId) {
          const activeBin = checkCandidate(path.join(agyBase, 'versions', active.releaseId, 'agy_acp_server'));
          if (activeBin) return activeBin;
        }
      }
      const versionsDir = path.join(agyBase, 'versions');
      if (fs.existsSync(versionsDir)) {
        for (const ver of fs.readdirSync(versionsDir).sort().reverse()) {
          const verBin = checkCandidate(path.join(versionsDir, ver, 'agy_acp_server'));
          if (verBin) return verBin;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function resolveStoreFile(explicitFile) {
  if (explicitFile) return explicitFile;
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'acp-agents.json');
}

export function resolveProfilesBaseDir(storeFile) {
  const file = resolveStoreFile(storeFile);
  return path.join(path.dirname(file), 'acp-profiles');
}

export function loadAgentsConfig(storeFile) {
  const file = resolveStoreFile(storeFile);
  let stored = [];
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed?.agents)) {
        stored = parsed.agents;
      } else if (Array.isArray(parsed)) {
        stored = parsed;
      }
    }
  } catch {
    stored = [];
  }
  return mergeAgentsWithPresets(stored);
}

export function saveAgentsConfig(agents, storeFile) {
  const file = resolveStoreFile(storeFile);
  const normalized = mergeAgentsWithPresets(agents);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify({ version: 2, agents: normalized }, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, file);
  return normalized;
}
