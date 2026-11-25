import {
  initAgentRuntime,
  runtimeBundle,
  runtimeHomeDir,
  registrySettingsFor,
} from './agent-runtime.js';
import {
  buildAgentRuntimeEnv,
  resolveCommandBinary,
  sanitizeHostEnvForAgent,
} from './presets.js';
import { agentWiring } from './acp-session-utils.js';
import { modelsFromConfigOptions } from './acp-config-options.js';
import { AcpSessionConnection } from './acp-session.js';

const LIVE_PROBE_TIMEOUT_MS = 180_000;

/**
 * Explicit "sync models" probe for Antigravity. The model list only exists on
 * a live session's configOptions, so an explicit click boots the managed
 * runtime once (initialize + session/new with silent auth), harvests the
 * options, then disposes. Never invoked by background probes — the ~1 GB
 * PyInstaller unpack is far too heavy for those.
 */
async function probeAntigravityLiveSession(ctx, agent, cwd, { binaryPath, version }) {
  const probeCwd = cwd || process.cwd();
  const conn = new AcpSessionConnection({
    ctx,
    agentConfig: agent,
    cwd: probeCwd,
    resumeSessionId: null,
    getRuntimePolicy: () => ({
      cwd: probeCwd,
      runtimeMode: 'approval-required',
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'readOnly', writableRoots: [] },
    }),
  });
  let timer = null;
  try {
    await Promise.race([
      conn.ensureReady(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Antigravity session did not start within ${LIVE_PROBE_TIMEOUT_MS / 1000}s.`)),
          LIVE_PROBE_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
    // sessionSetupResult.configOptions arrives synchronously in start(); one
    // explicit refresh also catches agents that publish them only later.
    await conn._refreshModeAndConfig();
    return {
      ok: true,
      binaryPath,
      version,
      authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
      configOptions: conn.configOptions || [],
      models: modelsFromConfigOptions(conn.configOptions),
      currentModelId: conn.currentModel || null,
      slashCommands: conn.availableCommands || [],
      acpAuthenticated: conn.acpAuthenticated === true,
      probe: { agentInfo: { name: 'antigravity-acp', title: 'Google Antigravity' } },
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), binaryPath };
  } finally {
    if (timer) clearTimeout(timer);
    await conn.close().catch(() => { /* The probe result already carries success or failure; dispose its connection. */ });
  }
}

export async function probeAcpAgent(ctx, agent, cwd, options = {}) {
  const { providers, effect } = runtimeBundle();
  await initAgentRuntime();
  const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
  if (agent.registrySource !== 'registry' && !commandPath) {
    return { ok: false, error: `Command "${agent.command}" not found on PATH.` };
  }
  const environment = buildAgentRuntimeEnv(agent, commandPath, { ensureFiles: false });
  const wiring = agentWiring(agent, commandPath);
  if (wiring.isClaude) {
    environment.CLAUDE_AGENT_ACP_EXPERIMENTAL_V2 ??= '1';
  }
  // ACP runtime AntigravityDriver probe — static; the binary must never spawn for
  // capability discovery (PyInstaller bundle, ~1 GB unpack per launch).
  if (wiring.isAntigravity) {
    const { antigravityManagedExecutable } = runtimeBundle();
    const executable = await antigravityManagedExecutable({
      baseDir: runtimeHomeDir(),
      installIfMissing: false,
    }).catch(() => null);
    const binaryPath = executable?.executablePath || commandPath;
    // The static stub stays for implicit probes (agent toggle, catalog
    // refresh). An explicit "sync from CLI" click is the one place where the
    // user is asking for a real session — without it the sync is a no-op that
    // reports success anyway.
    if (options.liveSession) {
      return probeAntigravityLiveSession(ctx, agent, cwd, {
        binaryPath,
        version: executable?.version || null,
      });
    }
    return {
      ok: true,
      binaryPath,
      version: executable?.version || null,
      authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
      configOptions: [],
      models: [],
      currentModelId: null,
      slashCommands: [],
      probe: { agentInfo: { name: 'antigravity-acp', title: 'Google Antigravity' } },
    };
  }
  const settings = registrySettingsFor(agent, commandPath);
  try {
    const result = await effect.runCatch(
      providers.AcpRegistryProbe.probeAcpRegistryConfiguration({
        // Public probe results validate ProviderInstanceId as a slug. The
        // colon-prefixed legacy identity is reserved for existing auth/profile
        // storage; it is not a valid ID for the registry result contract.
        instanceId: `dsh-${agent.id}`,
        settings,
        cwd: cwd || process.cwd(),
        // Full sanitized process env required: the probe internally runs
        // catalog.resolve, which uses this as the complete environment.
        environment: { ...sanitizeHostEnvForAgent(process.env), ...environment },
      }),
    );
    const probe = result?.probe || {};
    return {
      ok: true,
      binaryPath: commandPath,
      version: probe.version || null,
      authMethods: probe.authMethods || [],
      configOptions: probe.configOptions || [],
      configOptionsFormat: 'descriptors',
      models: probe.models || [],
      currentModelId: probe.currentModelId || null,
      slashCommands: result?.slashCommands || [],
      probe,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), binaryPath: commandPath };
  }
}
