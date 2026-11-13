import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initAgentRuntime,
  runtimeBundle,
  runtimeHomeDir,
  registrySettingsFor,
  agentEnvironment,
  agentRuntimeIdentity,
} from './agent-runtime.js';
import { agentWiring, antigravityAuthConfigFor } from './acp-session.js';
import {
  buildAgentRuntimeEnv,
  discoverDefaultAntigravityHome,
  resolveCommandBinary,
} from './presets.js';

// Env var names that point a CLI at an isolated config home. Kept in sync
// with the profileDir mapping inside buildAgentRuntimeEnv (presets.js).
const PROFILE_ENV_KEYS = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GEMINI_HOME'];

const SECRETISH_FIELD = /key|token|secret|password|passwd|credential/i;

// Credential input specs the client renders as the api_key form. `key` is
// the env var name — the agent/login RPC writes the values into agent.env
// and the spawn env then carries them to the agent. the runtime's ProviderAuthMethod
// carries advertised envVarNames. Presets remain a fallback for older agents
// that advertise a credentials method without its field metadata.
const CREDENTIAL_ENV_SPECS = {
  'claude-code': [
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', secret: true },
    { key: 'ANTHROPIC_AUTH_TOKEN', label: 'Anthropic auth token', secret: true },
    { key: 'ANTHROPIC_BASE_URL', label: 'Custom Anthropic base URL', secret: false },
  ],
  codex: [
    { key: 'OPENAI_API_KEY', label: 'OpenAI API key', secret: true },
    { key: 'OPENAI_BASE_URL', label: 'Custom OpenAI base URL', secret: false },
  ],
  antigravity: [
    { key: 'GEMINI_API_KEY', label: 'Gemini API key', secret: true },
    { key: 'GOOGLE_API_KEY', label: 'Google API key', secret: true },
  ],
  devin: [{ key: 'DEVIN_API_KEY', label: 'Devin API key', secret: true }],
};

const AGY_STATIC_METHODS = [
  { id: 'oauth-personal', label: 'Log in with Google', description: '', type: 'browser', fields: [] },
  {
    id: 'gemini-api-key',
    label: 'Gemini API Key',
    description: 'Use a Gemini API key instead of Google sign-in.',
    type: 'api_key',
    fields: CREDENTIAL_ENV_SPECS.antigravity.map((f) => ({ ...f })),
  },
];

/**
 * Agent authentication, backed by the runtime's ProviderAuthFlow + ACP registry auth.
 * Per-agent state mirrors driver.ts:522-788:
 * - `confirmedAuthentication` (authState) persists the "signed in" marker
 *   keyed by a binding hash of command/env/auth settings.
 * - `controller` owns flow phases/interactions; onChanged feeds authState.
 * Account status = catalog.inspect + authState.get(), no stdout scraping.
 */

export function openExternalUrl(url) {
  const target = String(url || '').trim();
  // \S guard: a URL containing whitespace would split into extra argv tokens
  // for the shell-free openers below (silent truncation, wrong page).
  if (!/^https?:\/\/\S+$/i.test(target)) return false;
  try {
    if (process.platform === 'win32') {
      // rundll32 takes the URL as plain argv — no cmd parsing, so '&' in an
      // OAuth query can't truncate the URL or chain commands. (`cmd /c start
      // "" <url>` reached cmd's parser unquoted: command-injection vector.)
      spawn('rundll32', ['url.dll,FileProtocolHandler', target], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

function settingsFingerprint(agent, commandPath) {
  return agentRuntimeIdentity(agent, commandPath);
}

/**
 * agent.env plus the profileDir-derived config-home vars — the same
 * isolation contract the session spawn uses (buildAgentRuntimeEnv). The
 * vars join the authState environment, which is hashed into the persisted
 * "signed in" binding, so a profileDir change can't reuse a stale marker.
 * buildAgentRuntimeEnv also creates the profile dir.
 */
function authEnvironmentFor(agent, commandPath) {
  const environment = agentEnvironment(agent);
  if (String(agent?.profileDir || '').trim()) {
    const runtimeEnv = buildAgentRuntimeEnv(agent, commandPath);
    for (const key of PROFILE_ENV_KEYS) {
      if (runtimeEnv[key] !== undefined) {
        environment[key] = String(runtimeEnv[key]);
      }
    }
  }
  return environment;
}

const isCredentialMethod = (method) =>
  method?.type === 'credentials' || method?.type === 'env_var';

function normalizeMethodField(field) {
  const key = String(field?.key || field?.name || '').trim();
  if (!key) return null;
  return {
    key,
    label: String(field?.label || field?.name || key),
    // Honor the field's own flag when the method spec provides one; infer
    // only when it doesn't (AC-034 — not every credential input is secret).
    secret: typeof field?.secret === 'boolean' ? field.secret : SECRETISH_FIELD.test(key),
    ...(field?.placeholder ? { placeholder: String(field.placeholder) } : {}),
  };
}

/**
 * Credential input fields for the client's api_key form. Sources, in
 * order: fields the method spec itself carries, env var names a probe
 * advertised (envVarNames), then the preset's env spec for credentials
 * methods. Non-credential methods get no synthesized fields.
 */
function methodFieldsFor(agent, method) {
  if (Array.isArray(method?.fields) && method.fields.length > 0) {
    return method.fields.map(normalizeMethodField).filter(Boolean);
  }
  if (Array.isArray(method?.envVarNames) && method.envVarNames.length > 0) {
    return method.envVarNames
      .map((name) => {
        const key = String(name || '').trim();
        return key ? { key, label: key, secret: SECRETISH_FIELD.test(key) } : null;
      })
      .filter(Boolean);
  }
  if (isCredentialMethod(method)) {
    return (CREDENTIAL_ENV_SPECS[agent?.baseAgentId] || []).map((f) => ({ ...f }));
  }
  return [];
}

function readJsonFileSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function decodeJwtPayloadSafe(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function titlePlanLabel(raw) {
  const clean = String(raw || '').trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : null;
}

function claudePlanLabel(raw) {
  const key = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (!key) return null;
  if (key.includes('enterprise')) return 'Enterprise';
  if (key.includes('team')) return 'Team';
  if (key.includes('max20')) return 'Max 20x';
  if (key.includes('max5')) return 'Max 5x';
  if (key.includes('max')) return 'Max';
  if (key.includes('pro')) return 'Pro';
  if (key.includes('free')) return 'Free';
  return titlePlanLabel(raw);
}

/**
 * Best-effort "which account is signed in" hints from the credential files
 * each CLI writes — the same sources the runtime's own drivers read
 * (CodexChatGptAuth / ClaudeProvider). Never throws; both fields stay null
 * when nothing is readable.
 */
function accountHintsFor(agent, wiring, { agyProfileDir } = {}) {
  const hints = { email: null, plan: null };
  try {
    const baseId = String(agent?.baseAgentId || '');
    if (wiring?.isAntigravity) {
      const dirs = [
        ...new Set(
          [agyProfileDir || agent?.profileDir || discoverDefaultAntigravityHome()]
            .map((d) => String(d || '').trim())
            .filter(Boolean),
        ),
      ];
      for (const dir of dirs) {
        const accounts = readJsonFileSafe(path.join(dir, 'google_accounts.json'));
        const email = String(
          accounts?.active || accounts?.email || accounts?.accounts?.[0]?.email || '',
        ).trim();
        if (email) {
          hints.email = email;
          break;
        }
        const token = readJsonFileSafe(
          path.join(dir, 'antigravity-acp', 'acp_token.json'),
        );
        const tokenEmail =
          String(token?.email || token?.user_email || '').trim()
          || decodeJwtPayloadSafe(token?.id_token || token?.idToken)?.email;
        if (tokenEmail) {
          hints.email = tokenEmail;
          break;
        }
      }
    } else if (baseId === 'claude-code' || wiring?.isClaude) {
      const dirs = [
        ...new Set(
          [agent?.profileDir || agent?.env?.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')]
            .map((d) => String(d || '').trim())
            .filter(Boolean),
        ),
      ];
      for (const dir of dirs) {
        const oauth = readJsonFileSafe(path.join(dir, '.credentials.json'))?.claudeAiOauth;
        if (!hints.plan && oauth?.subscriptionType) {
          hints.plan = claudePlanLabel(oauth.subscriptionType);
        }
        if (!hints.email && typeof oauth?.emailAddress === 'string' && oauth.emailAddress.trim()) {
          hints.email = oauth.emailAddress.trim();
        }
        if (hints.email && hints.plan) break;
      }
      if (!hints.email) {
        // oauthAccount lives in ~/.claude.json (home-relative, not the
        // config dir) — check the profile dir first, then home.
        for (const file of [
          ...dirs.map((dir) => path.join(dir, '.claude.json')),
          ...(!agent?.profileDir && !agent?.env?.CLAUDE_CONFIG_DIR ? [path.join(os.homedir(), '.claude.json')] : []),
        ]) {
          const account = readJsonFileSafe(file)?.oauthAccount;
          const email = String(account?.emailAddress || '').trim();
          if (email) {
            hints.email = email;
            break;
          }
        }
      }
    } else if (baseId === 'codex') {
      const dir = String(agent?.profileDir || agent?.env?.CODEX_HOME || '').trim() || path.join(os.homedir(), '.codex');
      const auth = readJsonFileSafe(path.join(dir, 'auth.json'));
      const payload = decodeJwtPayloadSafe(auth?.tokens?.id_token);
      const email = String(payload?.email || '').trim();
      if (email) hints.email = email;
      const plan =
        payload?.['https://api.openai.com/auth']?.chatgpt_plan_type
        || payload?.chatgpt_plan_type;
      if (plan) hints.plan = titlePlanLabel(plan);
    }
  } catch {
    // Account hints are cosmetic — never break status on a read failure.
  }
  return hints;
}

export class AgentAuthManager {
  constructor({ ctx, onAuthChanged, stopSessions }) {
    this.ctx = ctx;
    this.onAuthChanged = onAuthChanged;
    this.stopSessions = stopSessions;
    // agentId -> {fingerprint, authState, flow, api, lastState}
    this.entries = new Map();
    this.statusCache = new Map();
    this.inflightEntries = new Map();
    this.generations = new Map();
    this.pendingDisposals = new Set();
    this.pendingEntries = new Set();
    this.disposed = false;
  }

  clearAccountStatus(agentId) {
    for (const key of this.statusCache.keys()) {
      if (key.startsWith(`${agentId}:`)) this.statusCache.delete(key);
    }
  }

  credentialBindingFor(agent) {
    const binding = this.entries.get(agent.id)?.api?.credentialBinding;
    if (binding) return `${binding.owner}:${binding.key}`;
    if (agent.registryAgentId === 'antigravity-acp') return `antigravity:${agent.profileDir || agent.env?.GEMINI_HOME || agent.id}`;
    return `provider:acp:${agent.registrySource === 'registry' ? agent.registryAgentId : `local:dsh-${agent.id}`}`;
  }

  async assertCredentialsStable(agent, peers) {
    const binding = this.credentialBindingFor(agent);
    for (const peer of peers) {
      if (this.credentialBindingFor(peer) === binding && await this.entries.get(peer.id)?.api?.isChangingCredentials?.()) {
        throw new Error(`Authentication for "${peer.name}" is changing. Finish or cancel sign-in before starting an agent session.`);
      }
    }
  }

  async authenticationChanged(agentId, authState, authenticated) {
    // Match the registry driver's onChanged: persist confirmation, invalidate
    // account enrichment, then publish the change. Invalidating the auth flow
    // itself would clear valid credentials and discard its terminal state.
    await authState.set(authenticated);
    this.clearAccountStatus(agentId);
    await this.onAuthChanged?.(agentId, authenticated);
  }

  async _entry(agent) {
    if (this.disposed) throw new Error('Agent authentication manager is disposed.');
    const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
    const fingerprint = settingsFingerprint(agent, commandPath);
    const cached = this.entries.get(agent.id);
    if (cached?.fingerprint === fingerprint) return cached;
    const inflight = this.inflightEntries.get(agent.id);
    if (inflight?.fingerprint === fingerprint) return inflight.promise;
    const disposing = cached || inflight ? this.invalidate(agent.id) : Promise.resolve();
    const generation = this.generations.get(agent.id) || 0;
    const current = () => !this.disposed && (this.generations.get(agent.id) || 0) === generation;
    const promise = disposing.then(() => this._createEntry(agent, current)).then(async (entry) => {
      if (!current()) {
        await entry?.api?.dispose();
        throw new Error('Agent configuration changed while authentication was initializing. Retry with the current configuration.');
      }
      if (entry) {
        this.entries.set(agent.id, entry);
        entry.api.refreshMethods().catch(() => {});
      }
      return entry;
    });
    const pending = { fingerprint, promise };
    this.inflightEntries.set(agent.id, pending);
    this.pendingEntries.add(promise);
    try {
      return await promise;
    } finally {
      if (this.inflightEntries.get(agent.id) === pending) this.inflightEntries.delete(agent.id);
      this.pendingEntries.delete(promise);
    }
  }

  async _createEntry(agent, isCurrent = () => true) {
    const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
    const fingerprint = settingsFingerprint(agent, commandPath);
    if (!commandPath && agent.registrySource !== 'registry') return null;

    const { createAuthFlow, authFlowApi, makeAuthState } = runtimeBundle();
    await initAgentRuntime();
    const wiring = agentWiring(agent, commandPath);
    const environment = authEnvironmentFor(agent, commandPath);

    // ACP runtime AntigravityDriver: auth probes for antigravity must never spawn the
    // binary (PyInstaller bundle, ~1 GB unpack per launch). Method discovery is
    // static; sign-in runs a disposable runtime under the isolated profile.
    if (wiring.isAntigravity) {
      const { createAntigravityAuth, antigravityAuthApi, antigravityManagedExecutable } =
        runtimeBundle();
      const base = runtimeHomeDir();
      const authState = await makeAuthState({
        cacheDir: `${base}/provider-status-cache`,
        instanceId: `dsh:${agent.id}`,
        settings: registrySettingsFor(agent, commandPath),
        environment: Object.entries(environment).map(([name, value]) => ({
          name,
          value: String(value),
        })),
        processEnvironment: process.env,
      });
      const entry = {
        fingerprint,
        authState,
        flow: null,
        api: null,
        lastState: null,
      };
      const flow = await createAntigravityAuth(
        {
          instanceId: `dsh:${agent.id}`,
          stateDir: base,
          profileDirectory: environment.GEMINI_HOME,
          resolveExecutable: async () => {
            if (commandPath) return commandPath;
            const executable = await antigravityManagedExecutable({
              baseDir: base,
              installIfMissing: true,
            });
            if (!executable?.executablePath) {
              throw new Error('Antigravity installation did not produce a runtime executable.');
            }
            return String(executable.executablePath);
          },
          auth: antigravityAuthConfigFor(agent, environment),
          baseEnv: { ...process.env, ...environment },
          userHome: os.homedir(),
          onChanged: (authenticated) => isCurrent() ? this.authenticationChanged(agent.id, authState, authenticated) : undefined,
          stopSessions: () => this.stopSessions?.(agent, entry.api?.credentialBinding),
        },
        (state) => {
          if (!isCurrent()) return;
          entry.lastState = state
            ? { ...state, methods: state.methods ?? AGY_STATIC_METHODS }
            : state;
        },
      );
      entry.flow = flow;
      entry.api = antigravityAuthApi(flow);
      return entry;
    }
    if (wiring.isClaude) {
      environment.CLAUDE_AGENT_ACP_EXPERIMENTAL_V2 ??= '1';
    }
    const settings = registrySettingsFor(agent, commandPath);
    const base = runtimeHomeDir();

    const authState = await makeAuthState({
      cacheDir: `${base}/provider-status-cache`,
      instanceId: `dsh:${agent.id}`,
      settings,
      environment: Object.entries(environment).map(([name, value]) => ({
        name,
        value: String(value),
      })),
      processEnvironment: process.env,
    });

    const entry = {
      fingerprint,
      authState,
      flow: null,
      api: null,
      lastState: null,
    };
    // The flow uses profileDir as the subprocess cwd — it must exist or the
    // spawn dies with ENOENT before any auth code runs. If it can't be
    // created, fall back to a cwd that provably exists.
    let flowCwd = String(agent.profileDir || '').trim();
    if (flowCwd) {
      try {
        fs.mkdirSync(flowCwd, { recursive: true });
      } catch {
        flowCwd = '';
      }
    }
    const flow = await createAuthFlow(
      {
        instanceId: `dsh:${agent.id}`,
        settings,
        cwd: flowCwd || process.cwd(),
        // Same env contract as catalog.resolve: a provided environment is the
        // full process env (host fallback only on null), so an agent-only map
        // would strip PATH and break npm/uvx resolution.
        environment: { ...process.env, ...environment },
        onChanged: (authenticated) => isCurrent() ? this.authenticationChanged(agent.id, authState, authenticated) : undefined,
        stopSessions: () => this.stopSessions?.(agent, entry.api?.credentialBinding),
      },
      (state) => {
        if (isCurrent()) entry.lastState = state;
      },
    );
    entry.flow = flow;
    entry.api = authFlowApi(flow);
    return entry;
  }

  // Session-time authenticate (authenticateAfterRequired inside a turn) also
  // proves the account binding — persist it to the same confirmed-auth marker
  // the runtime's interactive flow writes, or the status check reads unauthenticated
  // forever and the UI re-prompts sign-in on every refresh. Building the
  // authState here is file I/O only — no agent spawn (unlike _entry, which
  // spawns for method discovery).
  async markAuthenticated(agent) {
    const entry = this.entries.get(agent.id) || (await this._authStateEntry(agent));
    await entry?.authState?.set(true).catch(() => {});
    this.clearAccountStatus(agent.id);
  }

  async _authStateEntry(agent) {
    const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
    // Same env as _createEntry — the profile vars are hashed into the
    // persisted binding, so the marker this writes must match what the
    // flow's authState reads back.
    const environment = authEnvironmentFor(agent, commandPath);
    const { makeAuthState } = runtimeBundle();
    const base = runtimeHomeDir();
    return {
      authState: await makeAuthState({
        cacheDir: `${base}/provider-status-cache`,
        instanceId: `dsh:${agent.id}`,
        settings: registrySettingsFor(agent, commandPath),
        environment: Object.entries(environment).map(([name, value]) => ({
          name,
          value: String(value),
        })),
        processEnvironment: process.env,
      }),
    };
  }

  /** ACP runtime ProviderAuthState passed through; client reads phase/interaction. */
  getFlowState(agentId) {
    return this.entries.get(agentId)?.lastState || null;
  }

  async getAgentAccountStatus(agent, { forceRefresh = false } = {}) {
    const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
    const cacheKey = `${agent.id}:${settingsFingerprint(agent, commandPath)}`;
    const cached = this.statusCache.get(cacheKey);
    if (cached && !forceRefresh && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Disabled agents get no live probing — entry creation spawns the
    // provider binary for method discovery, which a disabled route never
    // justifies.
    const entry = agent.enabled === false
      ? null
      : await this._entry(agent).catch(() => null);
    let authenticated = false;
    if (entry?.authState) {
      authenticated = await entry.authState.get().catch(() => false);
    }
    const wiring = agentWiring(agent, commandPath);
    // The isolated profile's token file proves sign-in even if our persisted
    // marker was cleared — the same signal the runtime's profile isolation produces.
    let agyDirs = null;
    if (wiring.isAntigravity) {
      const { antigravityInstanceDirs } = runtimeBundle();
      agyDirs = await antigravityInstanceDirs(runtimeHomeDir(), `dsh:${agent.id}`, authEnvironmentFor(agent, commandPath).GEMINI_HOME).catch(
        () => null,
      );
      if (!authenticated && agyDirs?.tokenPath && fs.existsSync(agyDirs.tokenPath)) {
        authenticated = true;
      }
    }

    let version = null;
    const stateMethods = entry?.lastState?.methods || [];
    if (wiring.isAntigravity) {
      const { antigravityManagedExecutable } = runtimeBundle();
      const executable = await antigravityManagedExecutable({
        baseDir: runtimeHomeDir(),
        installIfMissing: false,
      }).catch(() => null);
      version = executable?.version || null;
    } else if (commandPath) {
      try {
        const { catalog } = runtimeBundle();
        const environment = agentEnvironment(agent);
        if (wiring.isClaude) {
          environment.CLAUDE_AGENT_ACP_EXPERIMENTAL_V2 ??= '1';
        }
        const inspected = await catalog.inspect(
          registrySettingsFor(agent, commandPath),
          { ...process.env, ...environment },
        );
        version = inspected?.version || null;
      } catch {
        // Version probing is best-effort.
      }
    }

    // ACP runtime ProviderAuthMethod {id,name,description,type} → client's method cards.
    // Antigravity methods are static — the driver never probes the binary.
    // Credential methods become the client's 'api_key' form, with env-var
    // fields only when a spec exists — an empty credential sheet must never
    // render, so spec-less credential methods keep their own type (the Login
    // button then runs the flow's verify path instead).
    const availableMethods = (wiring.isAntigravity ? AGY_STATIC_METHODS : stateMethods).map(
      (m) => {
        const fields = methodFieldsFor(agent, m);
        return {
          id: m.id,
          label: m.label || m.name || m.id,
          description: m.description || '',
          type: isCredentialMethod(m) ? (fields.length > 0 ? 'api_key' : 'credentials') : m.type,
          ...(m.accountEmail ? { accountEmail: m.accountEmail } : {}),
          fields,
        };
      },
    );

    // Account surface (email/plan/authLabel/profileDir): provider-reported
    // accountEmail wins; otherwise read the credential files the CLIs write
    // — the same sources the runtime's own drivers probe.
    const activeMethodId = agent.acpAuthMethodId || agent.authMethod || '';
    const activeMethod =
      availableMethods.find((m) => m.id === activeMethodId) || availableMethods[0] || null;
    const hints = accountHintsFor(agent, wiring, { agyProfileDir: agyDirs?.profile });
    let authLabel = null;
    if (wiring.isAntigravity) {
      try {
        const labelFn = runtimeBundle().providers?.AntigravityAuthSupport?.antigravityAuthLabel;
        const auth = antigravityAuthConfigFor(agent, agentEnvironment(agent));
        authLabel = typeof labelFn === 'function' ? labelFn(auth.authMethod) || null : null;
      } catch {
        authLabel = null;
      }
    } else if (activeMethod?.type === 'api_key') {
      authLabel = 'API key';
    }

    // Login can finish while version/account enrichment is awaiting I/O.
    // Re-read confirmation so that request cannot re-cache the old status
    // alongside a succeeded flow and stop the client's polling on stale data.
    if (entry?.authState) {
      authenticated = await entry.authState.get().catch(() => authenticated);
      if (!authenticated && wiring.isAntigravity && agyDirs?.tokenPath && fs.existsSync(agyDirs.tokenPath)) authenticated = true;
    }
    const value = {
      authenticated,
      checkedAt: Date.now(),
      version,
      binaryFound: Boolean(commandPath) || agent.registrySource === 'registry',
      binaryPath: commandPath || null,
      availableMethods,
      authMethod: agent.authMethod || availableMethods[0]?.id || '',
      email: activeMethod?.accountEmail || hints.email || null,
      plan: hints.plan || null,
      authLabel,
      message: entry?.lastState?.message || null,
      profileDir: String(agent.profileDir || '').trim() || agyDirs?.profile || null,
    };
    this.statusCache.set(cacheKey, { value, expiresAt: Date.now() + 60_000 });
    return value;
  }

  async startLogin(agent, { methodId = '', forceNewToken = false } = {}) {
    if (forceNewToken) {
      // A cached entry's controller joins whatever flow it still owns
      // (ProviderAuthFlow.start re-enters on an in-flight auth op), so a
      // stale waiting phase swallows a relogin click. Drop the entry — and
      // any in-flight creation — so the rebuild below starts a real flow.
      await this.invalidate(agent.id);
    }
    // Explicit Login is also the explicit installation action. Passive account
    // polling never downloads an agent to discover its methods.
    await initAgentRuntime();
    if (agent.registrySource === 'registry' && agent.registryAgentId !== 'antigravity-acp') {
      await runtimeBundle().catalog.prepare({ agentId: agent.registryAgentId || agent.id });
    }
    const entry = await this._entry(agent);
    if (!entry?.api) {
      throw new Error(`ACP agent "${agent.name}" command "${agent.command}" was not found on PATH.`);
    }
    await entry.api.refreshMethods();
    const state = await entry.api.start({
      selectedMethodId: methodId || undefined,
      forceReauthentication: forceNewToken,
    });
    if (state) entry.lastState = state;
    return state;
  }

  /** ACP runtime respondProviderAuth: answers the live interaction (browser consent /
   * terminal input / credentials values). Returns false when stale. */
  async respondToInteraction(agentId, response) {
    const entry = this.entries.get(agentId);
    const state = entry?.lastState;
    const interaction = state?.interaction;
    if (
      !entry?.api ||
      !state?.flowId ||
      !interaction ||
      interaction.type !== response?.type
    ) {
      return false;
    }
    await entry.api.respond({
      flowId: state.flowId,
      interactionId: interaction.id,
      response,
    });
    return true;
  }

  /** ACP runtime completeProviderAuth: paste-the-callback-URL path for browser flows. */
  async completeLogin(agentId, callbackUrl) {
    const entry = this.entries.get(agentId);
    const state = entry?.lastState;
    if (!entry?.api || !state?.flowId) return false;
    await entry.api.complete({ flowId: state.flowId, callbackUrl: String(callbackUrl || '') });
    return true;
  }

  async cancelLogin(agentId) {
    const entry = this.entries.get(agentId);
    const flowId = entry?.lastState?.flowId;
    if (entry?.api && flowId) {
      await entry.api.cancel(flowId).catch(() => {});
    }
  }

  async logoutAgent(agent) {
    const entry = await this._entry(agent);
    if (!entry?.api) throw new Error(`ACP agent "${agent.name}" is unavailable for sign-out.`);
    await entry.api.logout();
    await entry.authState?.set(false);
    this.clearAccountStatus(agent.id);
  }

  invalidate(agentId) {
    this.generations.set(agentId, (this.generations.get(agentId) || 0) + 1);
    const entry = this.entries.get(agentId);
    this.entries.delete(agentId);
    this.inflightEntries.delete(agentId);
    this.statusCache.clear();
    const disposal = (async () => { if (entry?.api) { try { await entry.api.invalidate(); } finally { await entry.api.dispose(); } } })();
    this.pendingDisposals.add(disposal);
    disposal.finally(() => this.pendingDisposals.delete(disposal)).catch(() => {});
    return disposal;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const pending = [...this.pendingEntries];
    const ids = new Set([...this.entries.keys(), ...this.inflightEntries.keys()]);
    await Promise.allSettled([...ids].map((id) => this.invalidate(id)));
    await Promise.allSettled([...pending, ...this.pendingDisposals]);
  }
}
