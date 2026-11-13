import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveStoreFile } from './presets.js';

const require = createRequire(import.meta.url);
// Required lazily: the 3.2MB vendor bundle's parse must not sit on the cordis
// plugin-import path — it would widen other plugins' deferred route windows.
let bundle = null;

let initPromise = null;
let initError = null;
let hostContext = null;
let owners = 0;

export function configureRuntimeHost(ctx) {
  hostContext = ctx;
  owners += 1;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (--owners !== 0) return;
    await initPromise?.catch(() => {});
    await bundle?.disposeAgentRuntime();
    initPromise = null; initError = null; hostContext = null;
  };
}

// One identity for authentication caches and live connection invalidation.
export function agentRuntimeIdentity(agent, commandPath = agent?.command) {
  return JSON.stringify({
    commandPath, args: agent?.args, env: Object.fromEntries(Object.entries(agent?.env || {}).sort(([a], [b]) => a.localeCompare(b))),
    profileDir: agent?.profileDir, registrySource: agent?.registrySource,
    registryAgentId: agent?.registryAgentId, acpAuthMethodId: agent?.acpAuthMethodId,
    authMethod: agent?.authMethod, permissionPolicy: agent?.permissionPolicy, enabled: agent?.enabled,
  });
}

function hostPtyAdapter() {
  let subprocess;
  try { subprocess = hostContext?.get?.('subprocess') || hostContext?.subprocess; } catch { return undefined; }
  if (!subprocess?.spawnTerminal) return undefined;
  const { effect } = runtimeBundle();
  return { spawn: (input) => effect.Effect.tryPromise({
    try: async () => {
      const terminal = await subprocess.spawnTerminal({ argv: [input.shell, ...(input.args || [])], cwd: input.cwd,
        env: input.env, cols: input.cols, rows: input.rows, terminalType: 'xterm-256color', graceMs: 5000 });
      return {
        pid: terminal.pid,
        write: (data) => { void terminal.write(data).catch(() => terminal.terminate()); },
        resize: (cols, rows) => { void terminal.resize(cols, rows).catch(() => terminal.terminate()); },
        kill: () => { void terminal.terminate(); },
        terminate: () => terminal.terminate(),
        onData: (fn) => { terminal.output.setEncoding('utf8'); terminal.output.on('data', fn); return () => terminal.output.off('data', fn); },
        onExit: (fn) => { let active = true; terminal.done.then((outcome) => { if (active) fn({ exitCode: outcome.exitCode ?? 1, signal: null }); }, () => { if (active) fn({ exitCode: 1, signal: null }); }); return () => { active = false; }; },
      };
    },
    catch: (cause) => new Error(`Could not open ACP authentication terminal: ${cause.message}`, { cause }),
  }).pipe(effect.Effect.tap((terminal) => effect.Effect.addFinalizer(() => effect.Effect.promise(() => terminal.terminate())))) };
}

/**
 * The vendored ACP runtime is a process-wide ManagedRuntime. It is initialized
 * lazily on first use; initialization failures are memoized so a broken vendor
 * bundle surfaces one consistent error instead of repeatedly half-starting.
 */
export function runtimeBundle() {
  if (!bundle) bundle = require('./vendor/agent-runtime.cjs');
  return bundle;
}

export function runtimeHomeDir() {
  const base = path.dirname(resolveStoreFile());
  const legacy = path.join(base, 't3');
  const dir = fs.existsSync(legacy) ? legacy : path.join(base, 'acp-runtime');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function initAgentRuntime() {
  if (initError) throw initError;
  if (!initPromise) {
    const base = runtimeHomeDir();
    initPromise = runtimeBundle()
      .initAgentRuntime({
        cacheDir: path.join(base, 'provider-status-cache'),
        toolsDir: path.join(base, 'tools'),
        ptyAdapter: hostPtyAdapter(),
        paths: {
          cwd: process.cwd(),
          baseDir: base,
          stateDir: base,
          attachmentsDir: path.join(base, 'attachments'),
        },
      })
      .catch((err) => {
        initError = err instanceof Error ? err : new Error(String(err));
        initPromise = null;
        throw initError;
      });
  }
  return initPromise;
}

/**
 * Registry settings the ACP runtime catalog/auth code consumes, from our agent record.
 * `authMethodId` is only a verified ACP method id — our `authMethod` field is a
 * UI label, so an empty id lets ACP runtime pick the first agent-managed method.
 */
export function registrySettingsFor(agent, commandPath) {
  const source = agent?.registrySource === 'registry' ? 'registry' : 'local';
  return {
    source,
    enabled: agent?.enabled !== false,
    agentId: String(agent?.registryAgentId || (source === 'registry' ? agent?.id : '') || ''),
    // commandPath is an override for registry agents, required for local.
    commandPath: String(commandPath || ''),
    commandArgs: Array.isArray(agent?.args) ? agent.args.map(String) : [],
    authMethodId: String(agent?.acpAuthMethodId || ''),
    distribution: 'auto',
    customModels: (Array.isArray(agent?.models) ? agent.models : [])
      .map((m) => String(m?.id || ''))
      .filter(Boolean),
  };
}

/** ACP agent environment as a process env record. */
export function agentEnvironment(agent) {
  const env = {};
  for (const [key, value] of Object.entries(agent?.env || {})) {
    if (value === undefined || value === null) continue;
    env[String(key)] = String(value);
  }
  return env;
}
