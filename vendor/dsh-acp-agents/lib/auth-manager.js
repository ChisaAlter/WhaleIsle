import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  buildAgentRuntimeEnv,
  discoverDefaultAntigravityHome,
  inferBaseAgentId,
  resolveCommandBinary,
} from './presets.js';

const ACCOUNT_CACHE_TTL_MS = 30_000;
const CLI_PROBE_TIMEOUT_MS = 6_000;

/**
 * Available authentication methods per provider family (T3 Code parity).
 */
export function getAuthMethodsForBaseAgent(baseAgentId) {
  switch (baseAgentId) {
    case 'claude-code':
      return [
        {
          id: 'claude-oauth',
          type: 'oauth',
          label: 'Claude.ai / Console 账号登录 (OAuth)',
          description: '在浏览器中登录 Claude Pro / Max / Team 或 Anthropic Console 账号',
        },
        {
          id: 'api-key',
          type: 'api_key',
          label: 'Anthropic API Key / 自定义网关',
          description: '使用 ANTHROPIC_API_KEY（可选 ANTHROPIC_BASE_URL 接入第三方中转）',
          fields: [
            { key: 'ANTHROPIC_API_KEY', label: 'ANTHROPIC_API_KEY', secret: true, placeholder: 'sk-ant-...' },
            { key: 'ANTHROPIC_BASE_URL', label: 'ANTHROPIC_BASE_URL (可选)', secret: false, placeholder: 'https://api.anthropic.com' },
          ],
        },
      ];
    case 'codex':
      return [
        {
          id: 'chatgpt',
          type: 'oauth',
          label: 'ChatGPT 浏览器登录 (Plus / Pro / Team)',
          description: '通过浏览器登录 OpenAI ChatGPT 订阅账号',
        },
        {
          id: 'device-auth',
          type: 'device_code',
          label: 'ChatGPT 设备码登录 (Device Code)',
          description: '生成一次性设备验证码，在任意浏览器中输入授权',
        },
        {
          id: 'api-key',
          type: 'api_key',
          label: 'OpenAI API Key / 自定义网关',
          description: '使用 OPENAI_API_KEY（可选 OPENAI_BASE_URL）',
          fields: [
            { key: 'OPENAI_API_KEY', label: 'OPENAI_API_KEY', secret: true, placeholder: 'sk-...' },
            { key: 'OPENAI_BASE_URL', label: 'OPENAI_BASE_URL (可选)', secret: false, placeholder: 'https://api.openai.com/v1' },
          ],
        },
      ];
    case 'antigravity':
      return [
        {
          id: 'oauth-personal',
          type: 'oauth',
          label: 'Google 账号登录 (OAuth)',
          description: '通过 Google OAuth 浏览器授权登录 Antigravity / Gemini',
        },
        {
          id: 'gemini-api-key',
          type: 'api_key',
          label: 'Gemini API Key',
          description: '使用 Google AI Studio GEMINI_API_KEY',
          fields: [
            { key: 'GEMINI_API_KEY', label: 'GEMINI_API_KEY', secret: true, placeholder: 'AIzaSy...' },
          ],
        },
        {
          id: 'vertex-ai',
          type: 'api_key',
          label: 'Google Cloud Vertex AI',
          description: '使用 GOOGLE_CLOUD_PROJECT 与 GOOGLE_CLOUD_LOCATION',
          fields: [
            { key: 'GOOGLE_CLOUD_PROJECT', label: 'GOOGLE_CLOUD_PROJECT', secret: false, placeholder: 'my-gcp-project' },
            { key: 'GOOGLE_CLOUD_LOCATION', label: 'GOOGLE_CLOUD_LOCATION', secret: false, placeholder: 'us-central1' },
          ],
        },
      ];
    case 'devin':
      return [
        {
          id: 'devin-oauth',
          type: 'oauth',
          label: 'Devin 浏览器登录 (OAuth)',
          description: '通过浏览器登录 Cognition Devin 账号 (app.devin.ai)',
        },
        {
          id: 'api-key',
          type: 'api_key',
          label: 'Devin API Key',
          description: '使用 DEVIN_API_KEY 环境变量认证',
          fields: [
            { key: 'DEVIN_API_KEY', label: 'DEVIN_API_KEY', secret: true, placeholder: 'dv-...' },
          ],
        },
      ];
    default:
      return [
        {
          id: 'env-credentials',
          type: 'api_key',
          label: '环境变量 / CLI 本机登录态',
          description: '复用 CLI 本机配置或下方环境变量中的密钥',
          fields: [],
        },
      ];
  }
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function spawnShortCli(binary, args, env, timeoutMs = CLI_PROBE_TIMEOUT_MS, stdinText = null) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const needsCmd = isWin && /\.(cmd|bat)$/i.test(binary);
    const cmd = needsCmd ? (process.env.ComSpec || 'cmd.exe') : binary;
    const finalArgs = needsCmd ? ['/d', '/s', '/c', binary, ...args] : args;

    let child;
    try {
      child = spawn(cmd, finalArgs, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err?.message || String(err) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      resolve({ code: -1, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), timedOut: true });
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.once('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout: stripAnsi(stdout), stderr: err?.message || String(err) });
    });
    child.once('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) });
    });

    if (stdinText !== null) {
      try {
        child.stdin?.write(stdinText);
        child.stdin?.end();
      } catch {
        // ignore
      }
    } else {
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
    }
  });
}

export function openExternalUrl(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error('Only http(s) URLs can be opened.');
  }
  try {
    if (process.platform === 'win32') {
      const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', clean], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [clean], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [clean], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return true;
  } catch {
    return false;
  }
}

async function detectCliVersion(binary, baseId, env) {
  if (!binary) return null;
  if (baseId === 'antigravity') {
    const match = binary.replace(/\\/g, '/').match(/\/versions\/([^/]+)\//);
    if (match?.[1]) {
      const seg = match[1];
      if (/^[0-9a-f]{40,64}$/i.test(seg)) {
        return `1.3.0 (${seg.slice(0, 7)})`;
      }
      const v = seg.split('-')[0];
      return v || seg.slice(0, 12);
    }
    return '1.3.0';
  }
  const res = await spawnShortCli(binary, ['--version'], env, 3_500);
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  const firstLine = combined.split(/\r?\n/).find((l) => l.trim());
  if (!firstLine) return null;
  const verMatch = firstLine.match(/(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?)/);
  return verMatch ? verMatch[1] : firstLine.trim().slice(0, 36);
}

async function probeDevinAccount(agent, binary, env) {
  if (agent.env?.DEVIN_API_KEY) {
    return {
      authenticated: true,
      status: 'authenticated',
      authMethod: 'api-key',
      authLabel: 'API Key (DEVIN_API_KEY)',
      email: null,
      name: 'API Key',
      plan: 'API Key',
      message: '已配置 DEVIN_API_KEY',
    };
  }
  const res = await spawnShortCli(binary, ['auth', 'status'], env, 5_000);
  const text = `${res.stdout}\n${res.stderr}`;
  const loggedIn = /Logged in/i.test(text) && !/Not logged in/i.test(text);
  const emailMatch = text.match(/Email:\s*([^\r\n]+)/i);
  const nameMatch = text.match(/Name:\s*([^\r\n]+)/i);
  const tierMatch = text.match(/Tier:\s*([^\r\n]+)/i);
  const planMatch = text.match(/Plan:\s*([^\r\n]+)/i);
  const email = emailMatch ? emailMatch[1].trim() : null;
  const name = nameMatch ? nameMatch[1].trim() : null;
  const plan = tierMatch ? tierMatch[1].trim() : planMatch ? planMatch[1].trim() : null;

  return {
    authenticated: loggedIn,
    status: loggedIn ? 'authenticated' : 'unauthenticated',
    authMethod: 'devin-oauth',
    authLabel: loggedIn ? 'Devin OAuth' : '未登录',
    email,
    name,
    plan,
    message: loggedIn
      ? `已登录 Devin${plan ? ` (${plan})` : ''}`
      : '尚未登录 Devin 账号，请点击「登录账号」在浏览器完成授权。',
  };
}

async function probeCodexAccount(agent, binary, env) {
  if (agent.env?.OPENAI_API_KEY) {
    return {
      authenticated: true,
      status: 'authenticated',
      authMethod: 'api-key',
      authLabel: 'OpenAI API Key',
      email: null,
      name: 'OPENAI_API_KEY',
      plan: agent.env?.OPENAI_BASE_URL ? 'Custom Endpoint' : 'API Key',
      message: '已配置 OPENAI_API_KEY',
    };
  }
  const codexHome = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const authFile = path.join(codexHome, 'auth.json');
  let email = null;
  let name = null;
  let plan = null;
  let hasTokens = false;

  try {
    if (fs.existsSync(authFile)) {
      const raw = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      if (raw?.OPENAI_API_KEY) {
        return {
          authenticated: true,
          status: 'authenticated',
          authMethod: 'api-key',
          authLabel: 'OpenAI API Key',
          email: null,
          name: 'OPENAI_API_KEY',
          plan: 'API Key',
          message: '已通过 auth.json 配置 API Key',
        };
      }
      const idToken = raw?.tokens?.id_token;
      const accessToken = raw?.tokens?.access_token;
      hasTokens = Boolean(idToken || accessToken);
      const claims = decodeJwtPayload(idToken) || decodeJwtPayload(accessToken);
      if (claims) {
        email = claims.email || null;
        name = claims.name || claims.nickname || null;
        const authInfo = claims['https://api.openai.com/auth'] || {};
        const rawPlan = authInfo.chatgpt_plan_type || claims.chatgpt_plan_type || null;
        if (rawPlan) {
          plan = `ChatGPT ${String(rawPlan).charAt(0).toUpperCase()}${String(rawPlan).slice(1)}`;
        }
      }
    }
  } catch {
    // ignore
  }

  if (hasTokens) {
    return {
      authenticated: true,
      status: 'authenticated',
      authMethod: agent.authMethod || 'chatgpt',
      authLabel: 'ChatGPT OAuth',
      email,
      name,
      plan: plan || 'ChatGPT',
      message: `已通过 ChatGPT 登录${plan ? ` (${plan})` : ''}`,
    };
  }

  const res = await spawnShortCli(binary, ['login', 'status'], env, 4_500);
  const text = `${res.stdout}\n${res.stderr}`.trim();
  const loggedIn = /Logged in/i.test(text) && !/Not logged in/i.test(text);
  return {
    authenticated: loggedIn,
    status: loggedIn ? 'authenticated' : 'unauthenticated',
    authMethod: agent.authMethod || 'chatgpt',
    authLabel: loggedIn ? 'ChatGPT OAuth' : '未登录',
    email,
    name,
    plan,
    message: loggedIn ? text : '尚未登录 OpenAI Codex，请点击「登录账号」进行授权。',
  };
}

async function fetchGoogleEmailFromRefreshToken(tokenObj) {
  if (!tokenObj || typeof tokenObj !== 'object') return null;
  if (typeof tokenObj.email === 'string' && tokenObj.email) return tokenObj.email;
  const idClaims = decodeJwtPayload(tokenObj.id_token);
  if (idClaims?.email) return idClaims.email;
  return null;
}

async function probeAntigravityAccount(agent, _binary, env) {
  if (agent.env?.GEMINI_API_KEY) {
    return {
      authenticated: true,
      status: 'authenticated',
      authMethod: 'gemini-api-key',
      authLabel: 'Gemini API Key',
      email: null,
      name: 'GEMINI_API_KEY',
      plan: 'Google AI Studio',
      message: '已配置 GEMINI_API_KEY',
    };
  }
  const geminiHome = env.GEMINI_HOME || discoverDefaultAntigravityHome();
  const settingsFile = path.join(geminiHome, 'antigravity-acp', 'settings.json');
  const tokenFile = path.join(geminiHome, 'antigravity-acp', 'acp_token.json');
  const legacyOAuthFile = path.join(geminiHome, '.gemini', 'oauth_creds.json');

  let authType = agent.authMethod || 'oauth-personal';
  try {
    if (fs.existsSync(settingsFile)) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (settings?.auth?.type) authType = settings.auth.type;
    }
  } catch {
    // ignore
  }

  let tokenData = null;
  try {
    if (fs.existsSync(tokenFile)) {
      tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    } else if (fs.existsSync(legacyOAuthFile)) {
      tokenData = JSON.parse(fs.readFileSync(legacyOAuthFile, 'utf8'));
    }
  } catch {
    // ignore
  }

  const hasOAuth = Boolean(tokenData && (tokenData.refresh_token || tokenData.access_token));
  const email = await fetchGoogleEmailFromRefreshToken(tokenData);

  if (hasOAuth) {
    return {
      authenticated: true,
      status: 'authenticated',
      authMethod: authType,
      authLabel: 'Google OAuth',
      email,
      name: email ? email.split('@')[0] : 'Google Account',
      plan: 'Google DeepMind OAuth',
      profileDir: geminiHome,
      message: 'Google 账号已授权 (acp_token.json 就绪)',
    };
  }

  if (authType === 'vertex-ai' && (env.GOOGLE_CLOUD_PROJECT || agent.env?.GOOGLE_CLOUD_PROJECT)) {
    return {
      authenticated: true,
      status: 'authenticated',
      authMethod: 'vertex-ai',
      authLabel: 'Vertex AI',
      email: null,
      name: env.GOOGLE_CLOUD_PROJECT || agent.env?.GOOGLE_CLOUD_PROJECT,
      plan: 'Vertex AI',
      profileDir: geminiHome,
      message: `已配置 Vertex AI (${env.GOOGLE_CLOUD_PROJECT || agent.env?.GOOGLE_CLOUD_PROJECT})`,
    };
  }

  return {
    authenticated: false,
    status: 'unauthenticated',
    authMethod: authType,
    authLabel: '未登录',
    email: null,
    name: null,
    plan: null,
    profileDir: geminiHome,
    message: '尚未登录 Google 账号，请点击「登录账号」在浏览器完成 OAuth 授权。',
  };
}

async function probeClaudeAccount(agent, binary, env) {
  if (agent.env?.ANTHROPIC_API_KEY || agent.env?.ANTHROPIC_AUTH_TOKEN) {
    const customUrl = agent.env?.ANTHROPIC_BASE_URL;
    return {
      authenticated: true,
      status: 'authenticated',
      authMethod: 'api-key',
      authLabel: customUrl ? 'API Key (自定义网关)' : 'Anthropic API Key',
      email: null,
      name: customUrl || 'ANTHROPIC_API_KEY',
      plan: customUrl ? 'Custom Relay' : 'API Key',
      message: customUrl ? `已配置自定义网关 (${customUrl})` : '已配置 ANTHROPIC_API_KEY',
    };
  }

  const res = await spawnShortCli(binary, ['auth', 'status'], env, 5_000);
  const text = res.stdout.trim() || res.stderr.trim();
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const loggedIn = Boolean(parsed.loggedIn);
      const email = parsed.email || parsed.account?.email || null;
      const plan = parsed.subscriptionType
        ? `Claude ${String(parsed.subscriptionType).charAt(0).toUpperCase()}${String(parsed.subscriptionType).slice(1)}`
        : parsed.apiProvider && parsed.apiProvider !== 'firstParty'
          ? parsed.apiProvider
          : loggedIn
            ? 'Claude OAuth'
            : null;
      return {
        authenticated: loggedIn,
        status: loggedIn ? 'authenticated' : 'unauthenticated',
        authMethod: parsed.authMethod && parsed.authMethod !== 'none' ? parsed.authMethod : (agent.authMethod || 'claude-oauth'),
        authLabel: loggedIn ? (parsed.authMethod || 'Claude OAuth') : '未登录',
        email,
        name: parsed.name || (email ? email.split('@')[0] : null),
        plan,
        profileDir: parsed.configDirectory || null,
        message: loggedIn
          ? `已登录 Claude Code${email ? ` (${email})` : ''}`
          : '尚未登录 Claude Code，可使用浏览器 OAuth 登录或直接填写 ANTHROPIC_API_KEY。',
      };
    }
  } catch {
    // ignore JSON parse error
  }

  const loggedIn = /loggedIn"\s*:\s*true/i.test(text) || (/logged in/i.test(text) && !/not logged in/i.test(text));
  return {
    authenticated: loggedIn,
    status: loggedIn ? 'authenticated' : 'unauthenticated',
    authMethod: agent.authMethod || 'claude-oauth',
    authLabel: loggedIn ? 'Claude OAuth' : '未登录',
    email: null,
    name: null,
    plan: null,
    message: loggedIn ? '已登录 Claude Code' : '尚未登录 Claude Code，请点击「登录账号」或配置 API Key。',
  };
}

/**
 * Manages account status probing, caching, and interactive OAuth / Device-Code / API-Key flows
 * for all configured Agent instances.
 */
export class AgentAuthManager {
  constructor({ onFlowUpdated } = {}) {
    this.accountCache = new Map(); // Map<agentId, { timestamp, value }>
    this.versionCache = new Map(); // Map<binaryPath, string>
    this.activeFlows = new Map(); // Map<agentId, flowState>
    this.onFlowUpdated = onFlowUpdated;
  }

  invalidate(agentId) {
    if (agentId) {
      this.accountCache.delete(agentId);
    } else {
      this.accountCache.clear();
    }
  }

  getFlowState(agentId) {
    const flow = this.activeFlows.get(agentId);
    if (!flow) return null;
    return {
      status: flow.status,
      methodId: flow.methodId,
      url: flow.url || null,
      userCode: flow.userCode || null,
      message: flow.message || '',
      logs: flow.logs.slice(-12),
      startedAt: flow.startedAt,
    };
  }

  async getAgentAccountStatus(agent, { forceRefresh = false } = {}) {
    const baseId = agent.baseAgentId || inferBaseAgentId(agent);
    const availableMethods = getAuthMethodsForBaseAgent(baseId);
    const binary = resolveCommandBinary(agent.command, agent.env);
    if (!binary) {
      return {
        installed: false,
        version: null,
        authenticated: false,
        status: 'missing-binary',
        authMethod: agent.authMethod || availableMethods[0]?.id || 'oauth',
        authLabel: '未安装 CLI',
        email: null,
        name: null,
        plan: null,
        availableMethods,
        message: `未在系统中找到可执行文件 "${agent.command}"`,
      };
    }

    const cached = this.accountCache.get(agent.id);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < ACCOUNT_CACHE_TTL_MS) {
      return {
        ...cached.value,
        availableMethods,
      };
    }

    const env = buildAgentRuntimeEnv(agent, binary);
    let version = this.versionCache.get(binary) || null;
    if (!version) {
      version = await detectCliVersion(binary, baseId, env);
      if (version) this.versionCache.set(binary, version);
    }

    const binBase = path.basename(binary).toLowerCase();
    const isNativeCli =
      (baseId === 'devin' && binBase.startsWith('devin'))
      || (baseId === 'codex' && binBase.startsWith('codex'))
      || (baseId === 'antigravity' && (binBase.startsWith('agy') || binBase.startsWith('antigravity')))
      || (baseId === 'claude-code' && binBase.startsWith('claude'));

    let info;
    if (isNativeCli && baseId === 'devin') {
      info = await probeDevinAccount(agent, binary, env);
    } else if (isNativeCli && baseId === 'codex') {
      info = await probeCodexAccount(agent, binary, env);
    } else if (isNativeCli && baseId === 'antigravity') {
      info = await probeAntigravityAccount(agent, binary, env);
    } else if (isNativeCli && baseId === 'claude-code') {
      info = await probeClaudeAccount(agent, binary, env);
    } else {
      const hasEnvKeys = Object.keys(agent.env || {}).some((k) => /KEY|TOKEN|SECRET/i.test(k));
      info = {
        authenticated: true,
        status: 'authenticated',
        authMethod: 'env-credentials',
        authLabel: hasEnvKeys ? '环境变量密钥' : '本机 CLI 就绪',
        email: null,
        name: path.basename(binary),
        plan: 'ACP',
        message: '可执行文件已就绪',
      };
    }

    const result = {
      installed: true,
      version,
      ...info,
      availableMethods,
    };
    this.accountCache.set(agent.id, { timestamp: Date.now(), value: result });
    return result;
  }

  cancelLogin(agentId) {
    const flow = this.activeFlows.get(agentId);
    if (!flow) return;
    if (flow.pollTimer) clearInterval(flow.pollTimer);
    if (flow.timeoutTimer) clearTimeout(flow.timeoutTimer);
    try {
      flow.kill?.();
    } catch {
      // ignore
    }
    this.activeFlows.delete(agentId);
    this.onFlowUpdated?.(agentId);
  }

  async startLogin(agent, options = {}) {
    this.cancelLogin(agent.id);
    this.invalidate(agent.id);

    const baseId = agent.baseAgentId || inferBaseAgentId(agent);
    const methodId = String(options.methodId || agent.authMethod || getAuthMethodsForBaseAgent(baseId)[0]?.id || '');
    const binary = resolveCommandBinary(agent.command, agent.env);
    if (!binary) {
      throw new Error(`未找到 "${agent.command}" 可执行文件，请先安装对应 CLI 或在下方指定绝对路径。`);
    }

    const env = buildAgentRuntimeEnv(agent, binary);
    const flow = {
      agentId: agent.id,
      methodId,
      status: 'starting',
      url: null,
      userCode: null,
      message: '正在启动登录授权流程…',
      logs: [],
      startedAt: Date.now(),
      child: null,
      pollTimer: null,
      timeoutTimer: null,
      BrowserOpened: false,
      kill: () => {},
    };
    this.activeFlows.set(agent.id, flow);

    const pushLog = (line) => {
      const clean = stripAnsi(line).trim();
      if (!clean) return;
      flow.logs.push(clean);
      if (flow.logs.length > 30) flow.logs.shift();

      // Detect OAuth URL in stdout/stderr
      const urlMatch = clean.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch && !flow.url) {
        flow.url = urlMatch[0];
        flow.status = 'awaiting-browser';
        flow.message = '已在浏览器中打开登录页面，请完成授权（也可点击下方按钮复制链接）。';
        if (!flow.BrowserOpened && options.autoOpenBrowser !== false) {
          flow.BrowserOpened = true;
          openExternalUrl(flow.url);
        }
      }

      // Detect Device Code (e.g. XXXX-XXXX)
      const codeMatch = clean.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/);
      if (codeMatch && !flow.userCode) {
        flow.userCode = codeMatch[1];
        flow.status = 'awaiting-browser';
        flow.message = `请在浏览器中输入设备验证码：${flow.userCode}`;
      }
      this.onFlowUpdated?.(agent.id);
    };

    if (baseId === 'antigravity') {
      await this._startAntigravityLogin(agent, binary, env, flow, pushLog, options);
    } else if (baseId === 'devin') {
      await this._startCliAuthSubprocess(agent, binary, ['auth', 'login'], env, flow, pushLog);
    } else if (baseId === 'codex') {
      const loginArgs = methodId === 'device-auth' ? ['login', '--device-auth'] : ['login'];
      await this._startCliAuthSubprocess(agent, binary, loginArgs, env, flow, pushLog);
    } else if (baseId === 'claude-code') {
      await this._startCliAuthSubprocess(agent, binary, ['auth', 'login'], env, flow, pushLog);
    } else {
      flow.status = 'error';
      flow.message = '当前自定义 Agent 不支持交互式 OAuth 登录，请在环境变量中配置密钥。';
    }

    return this.getFlowState(agent.id);
  }

  async _startAntigravityLogin(agent, binary, env, flow, pushLog, options) {
    const geminiHome = env.GEMINI_HOME || discoverDefaultAntigravityHome();
    const acpConfigDir = path.join(geminiHome, 'antigravity-acp');
    fs.mkdirSync(acpConfigDir, { recursive: true });
    const settingsFile = path.join(acpConfigDir, 'settings.json');
    const tokenFile = path.join(acpConfigDir, 'acp_token.json');

    const authType = flow.methodId === 'vertex-ai'
      ? 'vertex-ai'
      : flow.methodId === 'gemini-api-key'
        ? 'gemini-api-key'
        : 'oauth-personal';

    fs.writeFileSync(settingsFile, JSON.stringify({ auth: { type: authType } }, null, 2), 'utf8');

    // If re-authenticating via OAuth, clear stale token so agy_acp_server triggers Google OAuth URL
    if (authType === 'oauth-personal' && options.forceNewToken) {
      try {
        if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile);
      } catch {
        // ignore
      }
    }

    const child = spawn(binary, [], {
      cwd: process.cwd(),
      env: {
        ...env,
        GEMINI_HOME: geminiHome,
        AGY_ACP_FORCE_FILE_STORAGE: '1',
        NO_BROWSER: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    flow.child = child;
    flow.kill = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    };

    child.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        pushLog(line);
      }
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let nextId = 1;
    const pending = new Map();
    const sendRpc = (method, params) => {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    };

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) {
        pushLog(trimmed);
        return;
      }
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || 'ACP error'));
          else p.resolve(msg.result);
        }
      } catch {
        pushLog(trimmed);
      }
    });

    flow.timeoutTimer = setTimeout(() => {
      if (flow.status === 'starting' || flow.status === 'awaiting-browser') {
        flow.status = 'error';
        flow.message = '登录等待超时（5分钟），请重试。';
        flow.kill();
      }
    }, 300_000);

    // Run initialize -> session/new asynchronously
    (async () => {
      try {
        await sendRpc('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
          clientInfo: { name: 'whaleisle-auth', version: '0.1.0' },
        });
        await sendRpc('session/new', { cwd: process.cwd(), mcpServers: [] });
        clearTimeout(flow.timeoutTimer);
        flow.status = 'authenticated';
        flow.message = 'Google 账号登录成功！';
        this.invalidate(agent.id);
        await this.getAgentAccountStatus(agent, { forceRefresh: true });
        this.onFlowUpdated?.(agent.id);
        setTimeout(() => {
          if (this.activeFlows.get(agent.id) === flow) {
            this.activeFlows.delete(agent.id);
          }
        }, 5_000);
      } catch (err) {
        if (flow.status !== 'cancelled') {
          flow.status = 'error';
          flow.message = `登录失败：${err?.message || String(err)}`;
          this.onFlowUpdated?.(agent.id);
        }
      } finally {
        try {
          rl.close();
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    })();
  }

  async _startCliAuthSubprocess(agent, binary, args, env, flow, pushLog) {
    const isWin = process.platform === 'win32';
    const needsCmd = isWin && /\.(cmd|bat)$/i.test(binary);
    const cmd = needsCmd ? (process.env.ComSpec || 'cmd.exe') : binary;
    const finalArgs = needsCmd ? ['/d', '/s', '/c', binary, ...args] : args;

    const child = spawn(cmd, finalArgs, {
      cwd: process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    flow.child = child;
    flow.kill = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    };

    child.stdout?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        pushLog(line);
      }
    });
    child.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        pushLog(line);
      }
    });

    flow.status = 'awaiting-browser';
    flow.message = `正在运行 ${path.basename(binary)} ${args.join(' ')}，请在弹出的浏览器中完成登录授权…`;

    // Poll account status every 2.5s while the CLI login process is running
    flow.pollTimer = setInterval(async () => {
      try {
        const status = await this.getAgentAccountStatus(agent, { forceRefresh: true });
        if (status.authenticated) {
          clearInterval(flow.pollTimer);
          clearTimeout(flow.timeoutTimer);
          flow.status = 'authenticated';
          flow.message = status.message || '账号登录成功！';
          this.onFlowUpdated?.(agent.id);
          setTimeout(() => {
            if (this.activeFlows.get(agent.id) === flow) {
              this.activeFlows.delete(agent.id);
            }
          }, 5_000);
        }
      } catch {
        // ignore
      }
    }, 2_500);

    flow.timeoutTimer = setTimeout(() => {
      clearInterval(flow.pollTimer);
      if (flow.status === 'starting' || flow.status === 'awaiting-browser') {
        flow.status = 'error';
        flow.message = '登录等待超时（5分钟），请重试。';
        flow.kill();
      }
    }, 300_000);

    child.once('close', async () => {
      clearInterval(flow.pollTimer);
      clearTimeout(flow.timeoutTimer);
      this.invalidate(agent.id);
      const status = await this.getAgentAccountStatus(agent, { forceRefresh: true });
      if (status.authenticated) {
        flow.status = 'authenticated';
        flow.message = status.message || '账号登录成功！';
        setTimeout(() => {
          if (this.activeFlows.get(agent.id) === flow) {
            this.activeFlows.delete(agent.id);
          }
        }, 5_000);
      } else if (flow.status !== 'authenticated') {
        flow.status = 'error';
        flow.message = flow.logs.slice(-2).join(' | ') || '登录流程已结束，但未检测到已登录状态。';
      }
      this.onFlowUpdated?.(agent.id);
    });
  }

  async logoutAgent(agent) {
    this.cancelLogin(agent.id);
    const baseId = agent.baseAgentId || inferBaseAgentId(agent);
    const binary = resolveCommandBinary(agent.command, agent.env);
    const env = buildAgentRuntimeEnv(agent, binary);

    if (baseId === 'devin' && binary) {
      await spawnShortCli(binary, ['auth', 'logout'], env, 6_000);
    } else if (baseId === 'codex' && binary) {
      await spawnShortCli(binary, ['logout'], env, 6_000);
    } else if (baseId === 'claude-code' && binary) {
      await spawnShortCli(binary, ['auth', 'logout'], env, 6_000);
    } else if (baseId === 'antigravity') {
      const geminiHome = env.GEMINI_HOME || discoverDefaultAntigravityHome();
      const tokenFile = path.join(geminiHome, 'antigravity-acp', 'acp_token.json');
      const legacyFile = path.join(geminiHome, '.gemini', 'oauth_creds.json');
      try {
        if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile);
        if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
      } catch {
        // ignore
      }
    }

    this.invalidate(agent.id);
    return this.getAgentAccountStatus(agent, { forceRefresh: true });
  }
}
