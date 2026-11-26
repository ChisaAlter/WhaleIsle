import express from "express";
import { createServer as createHTTPServer, type IncomingMessage, type ServerResponse } from "http";
import { constants, existsSync, unlinkSync } from "fs";
import { open } from "fs/promises";
import { randomUUID } from "node:crypto";
import { hostname as getHostname } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "pino";
import type {
  McpServerManagementConfig,
  SkillManagementConfig,
} from "@chisacode/protocol/messages";
import { createBranchChangeRouteHandler } from "./script-route-branch-handler.js";

export type ListenTarget =
  | { type: "tcp"; host: string; port: number }
  | { type: "socket"; path: string }
  | { type: "pipe"; path: string };

function resolveBoundListenTarget(
  listenTarget: ListenTarget,
  httpServer: ReturnType<typeof createHTTPServer>,
): ListenTarget {
  if (listenTarget.type !== "tcp") {
    return listenTarget;
  }

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP address after listening");
  }

  return {
    type: "tcp",
    host: listenTarget.host,
    port: address.port,
  };
}

// Matches a Windows drive-letter path like C:\ or D:\
const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;
// Body size limits per route class. The previous 512mb default on every RPC
// route let any authenticated client (or, under wildcard-no-auth, any LAN
// peer) exhaust daemon memory with a few concurrent POSTs. Model-gateway
// routes legitimately carry image attachments and long prompts, so they get a
// generous but still bounded 50mb cap; ordinary control RPCs (agent, loop,
// settings, chat) never need more than 1mb.
const DEFAULT_JSON_LIMIT = "1mb";
const MODEL_GATEWAY_JSON_LIMIT = "50mb";

function isHttpExchangeClosed(req: express.Request, res: express.Response): boolean {
  return req.aborted || res.destroyed;
}

// Lightweight per-IP fixed-window rate limiter (no new dependency). Bounds the
// request rate from any single source so a compromised or runaway client
// cannot flood the daemon with cheap-but-numerous requests. Health checks and
// CORS preflight bypass the limiter. Tuned for interactive agent workloads:
// 600 requests / 10s / IP — well above any legitimate burst, low enough to
// stop a tight infinite loop from saturating the event loop.
//
// Env overrides (mainly for e2e tests that drive many requests in bursts):
//   CHISACODE_DISABLE_RATE_LIMIT=1 — bypass entirely
//   CHISACODE_RATE_LIMIT_MAX=<n>   — override max requests per window
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 600;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly statusCode: number;
  readonly reason: string;
}

// Whether to honor client-supplied forwarding headers (X-Forwarded-For, etc.).
// Default false: a direct daemon has no trusted upstream proxy, so the socket
// remote address is the only honest client identifier. Setting this to `1`
// is appropriate when the daemon sits behind a reverse proxy that overwrites
// these headers. Trusting client-supplied XFF otherwise lets any peer forge
// a fresh rate-limit bucket per request by rotating the header value, defeating
// per-IP limiting (especially dangerous for wildcard-no-auth deployments).
export function isTrustForwardHeadersEnabled(): boolean {
  return process.env.CHISACODE_TRUST_FORWARD_HEADERS === "1";
}

export function rateLimitKey(req: express.Request): string {
  return rateLimitKeyFromRequestParts({
    headers: req.headers,
    ip: req.ip,
    remoteAddress: req.socket?.remoteAddress,
  });
}

export function rateLimitKeyFromRequestParts(params: {
  headers: IncomingMessage["headers"];
  ip?: string;
  remoteAddress?: string;
}): string {
  if (isTrustForwardHeadersEnabled()) {
    const xff = params.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return xff.split(",")[0].trim();
    }
  }
  return params.ip ?? params.remoteAddress ?? "unknown";
}

function resolveRateLimitMaxRequests(): number {
  return Number.parseInt(process.env.CHISACODE_RATE_LIMIT_MAX ?? "", 10) || RATE_LIMIT_MAX_REQUESTS;
}

export function checkRateLimitForKey(key: string): RateLimitDecision {
  if (process.env.CHISACODE_DISABLE_RATE_LIMIT === "1") {
    return { allowed: true, statusCode: 200, reason: "OK" };
  }
  const max = resolveRateLimitMaxRequests();
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, statusCode: 200, reason: "OK" };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { allowed: false, statusCode: 429, reason: "Too Many Requests" };
  }
  return { allowed: true, statusCode: 200, reason: "OK" };
}

function checkRateLimitForIncomingMessage(req: IncomingMessage): RateLimitDecision {
  const key = rateLimitKeyFromRequestParts({
    headers: req.headers,
    remoteAddress: req.socket?.remoteAddress,
  });
  return checkRateLimitForKey(key);
}

function createRateLimitMiddleware(): express.RequestHandler {
  if (process.env.CHISACODE_DISABLE_RATE_LIMIT === "1") {
    return (_req, _res, next) => next();
  }
  return (req, res, next) => {
    if (req.method === "OPTIONS" || req.path === "/api/health") {
      next();
      return;
    }
    const decision = checkRateLimitForKey(rateLimitKey(req));
    if (decision.allowed) {
      next();
      return;
    }
    res.status(decision.statusCode).json({ error: decision.reason });
  };
}

export function parseListenString(listen: string): ListenTarget {
  // 1. Windows named pipes: \\.\pipe\... or pipe://...
  if (listen.startsWith("\\\\.\\pipe\\") || listen.startsWith("pipe://")) {
    return {
      type: "pipe",
      path: listen.startsWith("pipe://") ? listen.slice("pipe://".length) : listen,
    };
  }
  // 2. Explicit unix:// prefix
  if (listen.startsWith("unix://")) {
    return { type: "socket", path: listen.slice(7) };
  }
  // 3. Reject Windows absolute drive paths — they are not Unix sockets
  if (WINDOWS_DRIVE_RE.test(listen)) {
    throw new Error(`Invalid listen string (Windows path is not a valid listen target): ${listen}`);
  }
  // 4. POSIX absolute path (/ or ~) — Unix socket
  if (listen.startsWith("/") || listen.startsWith("~")) {
    return { type: "socket", path: listen };
  }
  // 5. Pure numeric — TCP port on 127.0.0.1
  const trimmed = listen.trim();
  if (/^\d+$/.test(trimmed)) {
    const port = parseInt(trimmed, 10);
    return { type: "tcp", host: "127.0.0.1", port };
  }
  // 6. host:port — TCP
  if (listen.includes(":")) {
    const [host, portStr] = listen.split(":");
    const parsedPort = parseInt(portStr, 10);
    if (!Number.isFinite(parsedPort)) {
      throw new Error(`Invalid port in listen string: ${listen}`);
    }
    return { type: "tcp", host: host || "127.0.0.1", port: parsedPort };
  }
  throw new Error(`Invalid listen string: ${listen}`);
}

function formatListenTarget(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget) {
    return null;
  }
  if (listenTarget.type === "tcp") {
    return `${listenTarget.host}:${listenTarget.port}`;
  }
  return listenTarget.path;
}

function getWildcardAuthWarning(
  listenTarget: ListenTarget,
  auth: DaemonAuthConfig | undefined,
): string | null {
  if (listenTarget.type !== "tcp") {
    return null;
  }
  const isWildcard = listenTarget.host === "0.0.0.0" || listenTarget.host === "::";
  if (!isWildcard) {
    return null;
  }
  if (!auth?.password) {
    return (
      `Listening on wildcard address ${listenTarget.host}:${listenTarget.port} without a password exposes the daemon to the local network. ` +
      "Set CHISACODE_PASSWORD (or persist a password in config), or bind to 127.0.0.1 / a specific interface instead."
    );
  }
  return null;
}

/**
 * Refuse to start when the daemon is bound to a wildcard address
 * (`0.0.0.0` or `::`) without a password configured. Without authentication,
 * any host on the same network can invoke privileged daemon APIs (shell
 * execution via loop verify-checks, file access, agent control). Loopback and
 * explicit interface binds are unaffected.
 *
 * Opt-in compat escape hatch: set `CHISACODE_ALLOW_WILDCARD_NO_AUTH=1` to
 * preserve the pre-1.0.3 behavior (warn-and-continue). This is intended only
 * for staged rollouts and self-hosted deployments that accept the LAN-exposure
 * risk; the default remains fail-closed so new deployments are safe by default.
 *
 * History: `95400d5bf` introduced fail-closed semantics; `d1dcd2d3c` weakened
 * them to warn-only for patch compatibility (root cause A/D in the audit
 * roadmap). This restores fail-closed with an explicit opt-in so "compatibility"
 * and "safe by default" are no longer mutually exclusive.
 */
export function assertWildcardAuth(
  listenTarget: ListenTarget,
  auth: DaemonAuthConfig | undefined,
): void {
  const warning = getWildcardAuthWarning(listenTarget, auth);
  if (warning === null) return;
  if (allowWildcardNoAuth()) return;
  throw new Error(
    `${warning} Set CHISACODE_ALLOW_WILDCARD_NO_AUTH=1 to opt in to the legacy warn-and-continue behavior (not recommended).`,
  );
}

function allowWildcardNoAuth(): boolean {
  const flag = process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH;
  return flag === "1" || flag === "true";
}

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";
import type { SessionLifecycleIntent } from "./session.js";
import { createGitHubService } from "../services/github-service.js";
import { createChisaCodeWorktree as createRegisteredChisaCodeWorktree } from "./chisacode-worktree-service.js";
import { createChisaCodeWorktreeWorkflow } from "./worktree-session.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import type { OpenAiSpeechProviderConfig } from "./speech/providers/openai/config.js";
import type { LocalSpeechProviderConfig } from "./speech/providers/local/config.js";
import type { MimoSpeechProviderConfig } from "./speech/providers/mimo/config.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { createSpeechService } from "./speech/speech-runtime.js";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentSessionReaper } from "./agent/agent-session-reaper.js";
import { FileBackedUsageStore } from "./usage/usage-store.js";
import { resolveEffectiveManagedMcpServers } from "./agent/mcp-server-management.js";
import { resolveAgentSkillPolicy } from "./agent/skill-policy.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { rebuildAgentIndexIfEmpty } from "./agent-index/agent-index-rebuilder.js";
import { createSqliteAgentIndex } from "./agent-index/sqlite-agent-index.js";
import { attachAgentStoragePersistence } from "./persistence-hooks.js";
import { createAgentMcpServer } from "./agent/mcp-server.js";
import { AgentPresetStore } from "./agent/agent-preset-store.js";
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { createDaemonDiagnosticReport } from "./diagnostics-report.js";
import { bootstrapWorkspaceRegistries } from "./workspace-registry-bootstrap.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "./workspace-registry.js";
import { FileBackedChatService } from "./chat/chat-service.js";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { LoopService } from "./loop-service.js";
import { ScheduleService } from "./schedule/service.js";
import { DaemonConfigStore } from "./daemon-config-store.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";
import { archivePersistedWorkspaceRecord } from "./workspace-archive-service.js";
import { setupAutoArchiveOnMerge } from "./auto-archive-on-merge/index.js";
import { wrapSessionMessage, type SessionOutboundMessage } from "./messages.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { createConfiguredTerminalManager } from "../terminal/terminal-manager-factory.js";
import { workspaceMutationCoordinator } from "./workspace-mutation-coordinator.js";
import { createConnectionOfferV2, encodeOfferToFragmentUrl } from "./connection-offer.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { startRelayTransport, type RelayTransportController } from "./relay-transport.js";
import { startLanE2eeTransport, type LanE2eeTransportController } from "./lan-e2ee-transport.js";
import type { IceServerConfig } from "@chisacode/protocol/connection-offer";
import type { PushNotificationSender } from "./push/notifications.js";
import { getOrCreateServerId } from "./server-id.js";
import { resolveDaemonVersion } from "./daemon-version.js";
import { CHISACODE_SOURCE_OFFER } from "./legal-source.js";
import type { AgentClient, AgentProvider } from "./agent/agent-sdk-types.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import type { PersistedConfig } from "./persisted-config.js";
import {
  ScriptRouteStore,
  createScriptProxyMiddleware,
  createScriptProxyUpgradeHandler,
} from "./script-proxy.js";
import { ScriptHealthMonitor } from "./script-health-monitor.js";
import { createScriptStatusEmitter } from "./script-status-projection.js";
import { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import { isHostnameAllowed, type HostnamesConfig } from "./hostnames.js";
import { createRequireBearerMiddleware, type DaemonAuthConfig } from "./auth.js";
import {
  handleModelGatewayRequest,
  listModelGatewayModels,
  type ModelGatewayTargetFormat,
} from "./model-gateway/model-gateway.js";
import type { ModelGatewayConfigs } from "./agent/provider-launch-config.js";

type AgentMcpTransportMap = Map<string, StreamableHTTPServerTransport>;

const MAX_MCP_DEBUG_BATCH_ITEMS = 10;
const REDACTED_LOG_VALUE = "[redacted]";
const DOWNLOAD_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;

function formatHostForHttpUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function resolveAgentMcpClientHost(host: string): string {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::" || host === "[::]") {
    return "::1";
  }
  return host;
}

function createAgentMcpBaseUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/mcp/agents",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

function createModelGatewayBaseUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`;
}

function summarizeAgentMcpDebugMessage(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      type: body === null ? "null" : typeof body,
    };
  }

  const record = body as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : undefined;
  return {
    type: "object",
    ...(typeof record.jsonrpc === "string" ? { jsonrpc: record.jsonrpc } : {}),
    ...(method ? { method } : {}),
    hasId: Object.prototype.hasOwnProperty.call(record, "id"),
    hasParams: Object.prototype.hasOwnProperty.call(record, "params"),
  };
}

function summarizeAgentMcpDebugBody(body: unknown): Record<string, unknown> {
  if (!Array.isArray(body)) {
    return summarizeAgentMcpDebugMessage(body);
  }

  const messages = body.slice(0, MAX_MCP_DEBUG_BATCH_ITEMS).map(summarizeAgentMcpDebugMessage);
  return {
    type: "batch",
    count: body.length,
    messages,
    ...(body.length > messages.length ? { omitted: body.length - messages.length } : {}),
  };
}

function firstQueryString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}

export type ChisaCodeOpenAIConfig = OpenAiSpeechProviderConfig;
export type ChisaCodeLocalSpeechConfig = LocalSpeechProviderConfig;
export type ChisaCodeMimoSpeechConfig = MimoSpeechProviderConfig;

export interface ChisaCodeSpeechSttLanguages {
  dictation: string;
  voice: string;
}

export interface ChisaCodeSpeechConfig {
  providers: RequestedSpeechProviders;
  sttLanguages?: ChisaCodeSpeechSttLanguages;
  local?: ChisaCodeLocalSpeechConfig;
}

export type DaemonLifecycleIntent =
  | {
      type: "shutdown";
      clientId: string;
      requestId: string;
    }
  | {
      type: "restart";
      clientId: string;
      requestId: string;
      reason?: string;
    };

export interface ChisaCodeDaemonConfig {
  listen: string;
  chisacodeHome: string;
  corsAllowedOrigins: string[];
  allowedHosts?: HostnamesConfig;
  hostnames?: HostnamesConfig;
  mcpEnabled?: boolean;
  mcpInjectIntoAgents?: boolean;
  autoArchiveAfterMerge?: boolean;
  appendSystemPrompt?: string;
  skills?: SkillManagementConfig;
  mcpServers?: McpServerManagementConfig;
  staticDir: string;
  mcpDebug: boolean;
  isDev?: boolean;
  /** Register dev-only providers (mock) in non-dev daemons for e2e/packaged gates. */
  enableDevProviders?: boolean;
  agentClients: Partial<Record<AgentProvider, AgentClient>>;
  agentStoragePath: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  lanE2eeEnabled?: boolean;
  iceServers?: IceServerConfig[];
  appBaseUrl?: string;
  auth?: DaemonAuthConfig;
  openai?: ChisaCodeOpenAIConfig;
  mimo?: ChisaCodeMimoSpeechConfig;
  speech?: ChisaCodeSpeechConfig;
  voiceLlmProvider?: AgentProvider | null;
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  downloadTokenTtlMs?: number;
  agentProviderSettings?: AgentProviderRuntimeSettingsMap;
  metadataGeneration?: {
    providers?: Array<{
      provider: string;
      model?: string;
      thinkingOptionId?: string;
    }>;
  };
  providerOverrides?: Record<string, ProviderOverride>;
  modelGateways?: ModelGatewayConfigs;
  visionFallbackModel?: { provider: string; modelId: string } | null;
  modelGatewayToken?: string;
  log?: PersistedConfig["log"];
  onLifecycleIntent?: (intent: DaemonLifecycleIntent) => void;
  pushNotificationSender?: PushNotificationSender;
}

export interface ChisaCodeDaemon {
  config: ChisaCodeDaemonConfig;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager;
  scriptRouteStore: ScriptRouteStore;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore;
  start(): Promise<void>;
  stop(): Promise<void>;
  disconnectDevice(deviceId: string): Promise<number>;
  getListenTarget(): ListenTarget | null;
}

interface SpeechServiceBootstrapCleanupResources {
  logger: Logger;
  config: ChisaCodeDaemonConfig;
  scriptHealthMonitor: ScriptHealthMonitor;
  detachAgentStoragePersistence: () => void;
  agentStorage: AgentStorage;
  providerSnapshotManager: ProviderSnapshotManager;
  agentIndex: ReturnType<typeof createSqliteAgentIndex>;
  terminalManager: TerminalManager;
  scheduleService: ScheduleService;
}

async function createSpeechServiceWithBootstrapCleanup(
  resources: SpeechServiceBootstrapCleanupResources,
): Promise<ReturnType<typeof createSpeechService>> {
  try {
    return createSpeechService({
      logger: resources.logger,
      mimoConfig: resources.config.mimo,
      openaiConfig: resources.config.openai,
      speechConfig: resources.config.speech,
    });
  } catch (error) {
    await cleanupFailedSpeechBootstrap(resources);
    throw error;
  }
}

async function cleanupFailedSpeechBootstrap(
  resources: SpeechServiceBootstrapCleanupResources,
): Promise<void> {
  resources.scriptHealthMonitor.stop();
  resources.detachAgentStoragePersistence();
  await resources.agentStorage.flush().catch(() => undefined);
  await resources.providerSnapshotManager.shutdown().catch(() => undefined);
  try {
    resources.agentIndex?.close();
  } catch {
    // Preserve the original bootstrap error; startup cleanup is best-effort.
  }
  resources.terminalManager.killAll();
  await resources.scheduleService.stop().catch(() => undefined);
}

function buildInitialMutableDaemonConfig(config: ChisaCodeDaemonConfig) {
  return {
    mcp: { injectIntoAgents: config.mcpInjectIntoAgents ?? true },
    providers: Object.fromEntries(
      Object.entries(config.providerOverrides ?? {}).map(([providerId, override]) => [
        providerId,
        {
          ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
          ...(override.additionalModels ? { additionalModels: override.additionalModels } : {}),
        },
      ]),
    ),
    modelGateways: config.modelGateways ?? {},
    visionFallbackModel: config.visionFallbackModel ?? null,
    metadataGeneration: {
      providers: config.metadataGeneration?.providers ?? [],
    },
    autoArchiveAfterMerge: config.autoArchiveAfterMerge ?? false,
    appendSystemPrompt: config.appendSystemPrompt ?? "",
    skills: config.skills ?? {
      global: { disabledSkillNames: [] },
      providers: {},
      agents: {},
      installedSources: {},
    },
    mcpServers: config.mcpServers ?? {
      servers: {},
      global: { disabledServerNames: [] },
      providers: {},
      agents: {},
    },
  };
}

export async function createChisaCodeDaemon(
  config: ChisaCodeDaemonConfig,
  rootLogger: Logger,
): Promise<ChisaCodeDaemon> {
  const logger = rootLogger.child({ module: "bootstrap" });
  const bootstrapStart = performance.now();
  const elapsed = () => `${(performance.now() - bootstrapStart).toFixed(0)}ms`;
  const daemonVersion = resolveDaemonVersion(import.meta.url);
  const daemonConfigStore = new DaemonConfigStore(
    config.chisacodeHome,
    buildInitialMutableDaemonConfig(config),
    logger,
  );

  const serverId = getOrCreateServerId(config.chisacodeHome, { logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(config.chisacodeHome, logger);
  let relayTransport: RelayTransportController | null = null;
  let lanE2eeTransport: LanE2eeTransportController | null = null;

  const staticDir = config.staticDir;
  const downloadTokenTtlMs = config.downloadTokenTtlMs ?? 60000;

  const downloadTokenStore = new DownloadTokenStore({
    ttlMs: downloadTokenTtlMs,
  });

  const listenTarget = parseListenString(config.listen);
  assertWildcardAuth(listenTarget, config.auth);
  const wildcardAuthWarning = getWildcardAuthWarning(listenTarget, config.auth);
  if (wildcardAuthWarning) {
    // Only reachable when CHISACODE_ALLOW_WILDCARD_NO_AUTH=1 (otherwise
    // assertWildcardAuth above would have thrown). Log the warning so the
    // operator sees the risk they opted into.
    logger.warn(
      {
        listen: formatListenTarget(listenTarget),
        authRequired: false,
        optIn: "CHISACODE_ALLOW_WILDCARD_NO_AUTH",
      },
      `${wildcardAuthWarning} (running because CHISACODE_ALLOW_WILDCARD_NO_AUTH=1)`,
    );
  }
  const modelGatewayToken = config.modelGatewayToken ?? randomUUID();
  const modelGatewayBaseUrl = createModelGatewayBaseUrl(listenTarget);

  const app = express();
  let boundListenTarget: ListenTarget | null = null;
  let workspaceRegistry: FileBackedWorkspaceRegistry | null = null;

  const scriptRouteStore = new ScriptRouteStore();
  const scriptRuntimeStore = new WorkspaceScriptRuntimeStore();
  const configuredHostnames = config.hostnames ?? config.allowedHosts;
  let wsServer: VoiceAssistantWebSocketServer | null = null;
  const scriptHealthMonitor = new ScriptHealthMonitor({
    routeStore: scriptRouteStore,
    onChange: createScriptStatusEmitter({
      sessions: () =>
        wsServer?.listActiveSessions().map((session) => ({
          emit: (message) => session.emitServerMessage(message),
        })) ?? [],
      routeStore: scriptRouteStore,
      runtimeStore: scriptRuntimeStore,
      daemonPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
      resolveWorkspaceDirectory: async (workspaceId) =>
        (await workspaceRegistry?.get(workspaceId))?.cwd ?? null,
      logger,
    }),
  });
  const handleBranchChange = createBranchChangeRouteHandler({
    routeStore: scriptRouteStore,
    onRoutesChanged: (workspaceId) => {
      scriptHealthMonitor.invalidateWorkspace(workspaceId);
    },
    logger,
  });

  // Host allowlist / DNS rebinding protection with loopback-only IP defaults.
  // For non-TCP (unix sockets), skip host validation.
  if (listenTarget.type === "tcp") {
    app.use((req, res, next) => {
      const hostHeader = typeof req.headers.host === "string" ? req.headers.host : undefined;
      if (!isHostnameAllowed(hostHeader, configuredHostnames)) {
        res.status(403).json({ error: "Invalid Host header" });
        return;
      }
      next();
    });
  }

  // CORS - allow same-origin + configured origins
  const allowedOrigins = new Set([
    ...config.corsAllowedOrigins,
    // Packaged desktop renderers use the custom chisacode:// protocol scheme.
    "chisacode://app",
    // For TCP, add localhost variants
    ...(listenTarget.type === "tcp"
      ? [
          `http://${listenTarget.host}:${listenTarget.port}`,
          `http://localhost:${listenTarget.port}`,
          `http://127.0.0.1:${listenTarget.port}`,
        ]
      : []),
  ]);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.has("*") || allowedOrigins.has(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Per-IP rate limit before bearer auth so a flood does not pay the bcrypt
  // cost. Health/OPTIONS bypass inside the middleware.
  app.use(createRateLimitMiddleware());

  app.use(
    createRequireBearerMiddleware(config.auth, (context) => {
      logger.warn(context, "Rejected HTTP request with invalid daemon password");
    }),
  );

  // Script proxy — intercepts requests for registered *.localhost hostnames
  // and forwards them to the corresponding local script port. Placed after
  // host/CORS/auth checks but before the rest of the routes.
  app.use(createScriptProxyMiddleware({ routeStore: scriptRouteStore, logger }));

  // Serve static files from public directory
  app.use("/public", express.static(staticDir));

  // Middleware
  const defaultJsonParser = express.json({ limit: DEFAULT_JSON_LIMIT });
  const modelGatewayJsonParser = express.json({ limit: MODEL_GATEWAY_JSON_LIMIT });

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/source", (_req, res) => {
    res.json({
      status: "source_info",
      name: "ChisaCode",
      version: daemonVersion,
      ...CHISACODE_SOURCE_OFFER,
    });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "server_info",
      serverId,
      hostname: getHostname(),
      version: daemonVersion,
      listen: formatListenTarget(boundListenTarget ?? listenTarget),
      sourceCode: CHISACODE_SOURCE_OFFER,
    });
  });

  const sendModelGatewayResponse = async (
    response: Response,
    res: express.Response,
    stream: boolean,
    signal: AbortSignal,
  ): Promise<void> => {
    res.status(response.status);
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }

    if (!stream) {
      res.send(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (!response.body) {
      res.end();
      return;
    }

    res.flushHeaders();
    // Node and DOM currently declare different BYOB view bounds for the same WHATWG stream.
    const body = response.body as unknown as NodeReadableStream;
    await pipeline(Readable.fromWeb(body), res, { signal });
  };

  const runModelGatewayRequest = async (
    req: express.Request,
    res: express.Response,
    targetFormat: ModelGatewayTargetFormat,
  ): Promise<void> => {
    const authHeader = req.header("authorization") ?? "";
    const apiKeyHeader = req.header("x-api-key") ?? "";
    if (authHeader !== `Bearer ${modelGatewayToken}` && apiKeyHeader !== modelGatewayToken) {
      res.status(401).json({ error: "Model gateway token required" });
      return;
    }

    const gatewayId = typeof req.params.id === "string" ? req.params.id : "";
    const gateway = daemonConfigStore.get().modelGateways[gatewayId];
    if (!gateway || gateway.enabled === false) {
      res.status(404).json({ error: "Unknown model gateway" });
      return;
    }

    const baseRequestBody =
      req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const modelOverride =
      typeof req.params.modelOverride === "string" && req.params.modelOverride.trim().length > 0
        ? req.params.modelOverride.trim()
        : null;
    const requestBody = modelOverride
      ? { ...baseRequestBody, model: modelOverride }
      : baseRequestBody;
    const abortController = new AbortController();
    const abortUpstream = (): void => {
      if (!res.writableEnded && !abortController.signal.aborted) {
        abortController.abort();
      }
    };
    req.once("aborted", abortUpstream);
    res.once("close", abortUpstream);
    if (isHttpExchangeClosed(req, res)) {
      abortUpstream();
    }

    try {
      const response = await handleModelGatewayRequest({
        gateway,
        targetFormat,
        requestBody,
        signal: abortController.signal,
      });
      await sendModelGatewayResponse(
        response,
        res,
        requestBody.stream === true,
        abortController.signal,
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      logger.warn({ err: error, gatewayId, targetFormat }, "Model gateway request failed");
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ error: message });
    } finally {
      req.off("aborted", abortUpstream);
      res.off("close", abortUpstream);
    }
  };

  app.post(
    "/api/model-gateways/:id/model-overrides/:modelOverride/v1/messages",
    modelGatewayJsonParser,
    (req, res) => {
      void runModelGatewayRequest(req, res, "anthropic");
    },
  );
  app.post(
    "/api/model-gateways/:id/model-overrides/:modelOverride/v1/chat/completions",
    modelGatewayJsonParser,
    (req, res) => {
      void runModelGatewayRequest(req, res, "chatCompletions");
    },
  );
  app.post(
    "/api/model-gateways/:id/model-overrides/:modelOverride/v1/responses",
    modelGatewayJsonParser,
    (req, res) => {
      void runModelGatewayRequest(req, res, "responses");
    },
  );

  app.post("/api/model-gateways/:id/v1/messages", modelGatewayJsonParser, (req, res) => {
    void runModelGatewayRequest(req, res, "anthropic");
  });
  app.post("/api/model-gateways/:id/v1/chat/completions", modelGatewayJsonParser, (req, res) => {
    void runModelGatewayRequest(req, res, "chatCompletions");
  });
  app.post("/api/model-gateways/:id/v1/responses", modelGatewayJsonParser, (req, res) => {
    void runModelGatewayRequest(req, res, "responses");
  });
  app.get("/api/model-gateways/:id/v1/models", (req, res) => {
    const authHeader = req.header("authorization") ?? "";
    const apiKeyHeader = req.header("x-api-key") ?? "";
    if (authHeader !== `Bearer ${modelGatewayToken}` && apiKeyHeader !== modelGatewayToken) {
      res.status(401).json({ error: "Model gateway token required" });
      return;
    }
    const gatewayId = typeof req.params.id === "string" ? req.params.id : "";
    const gateway = daemonConfigStore.get().modelGateways[gatewayId];
    if (!gateway || gateway.enabled === false) {
      res.status(404).json({ error: "Unknown model gateway" });
      return;
    }
    res.json(listModelGatewayModels(gateway));
  });

  app.use(defaultJsonParser);

  const handleFileDownload = async (req: express.Request, res: express.Response): Promise<void> => {
    const token =
      typeof req.query.token === "string" && req.query.token.trim().length > 0
        ? req.query.token.trim()
        : null;

    if (!token) {
      res.status(400).json({ error: "Missing download token" });
      return;
    }

    const entry = downloadTokenStore.consumeToken(token);
    if (!entry) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }

    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      fileHandle = await open(entry.absolutePath, DOWNLOAD_OPEN_FLAGS);
      const fileStats = await fileHandle.stat();
      if (!fileStats.isFile()) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      // RFC 6266: prefer `filename*` with percent-encoded UTF-8 so downstream
      // clients/ proxies cannot misparse backslashes, control chars, or quotes
      // in a user-supplied file name. A best-effort ASCII fallback is included
      // for legacy clients. The name is already bounded by path rules; this
      // only neutralizes header-injection and parse-confusion characters.
      // Avoid regex control-char matching (lint: no-control-regex).
      const asciiFallbackName = entry.fileName
        .replace(/["\\;]/g, "_")
        .replace(/./g, (ch) => ((ch.codePointAt(0) ?? 0x20) < 0x20 ? "_" : ch));
      const encodedName = encodeURIComponent(entry.fileName);
      res.setHeader("Content-Type", entry.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiFallbackName}"; filename*=UTF-8''${encodedName}`,
      );
      res.setHeader("Content-Length", fileStats.size.toString());

      const stream = fileHandle.createReadStream();
      fileHandle = null;
      stream.on("error", (err) => {
        logger.error({ err }, "Failed to stream download");
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to read file" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      logger.error({ err }, "Failed to download file");
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    } finally {
      await fileHandle?.close().catch(() => undefined);
    }
  };

  app.get("/api/files/download", (req, res) => {
    void handleFileDownload(req, res);
  });

  const httpServer = createHTTPServer(app);

  // Script proxy WebSocket upgrade handler — must be registered before the
  // VoiceAssistantWebSocketServer attaches its own "upgrade" listener so that
  // script-bound upgrades are forwarded first. The handler is a no-op for
  // requests that don't match a registered script route.
  const scriptProxyUpgradeHandler = createScriptProxyUpgradeHandler({
    routeStore: scriptRouteStore,
    logger,
    guard: {
      auth: config.auth,
      allowedOrigins,
      hostnames: configuredHostnames,
      allowUpgradeRequest: checkRateLimitForIncomingMessage,
    },
  });
  httpServer.on("upgrade", scriptProxyUpgradeHandler);

  const agentStorage = new AgentStorage(config.agentStoragePath, logger);
  const agentPresetStore = new AgentPresetStore({
    chisacodeHome: config.chisacodeHome,
    logger,
  });
  const usageStore = new FileBackedUsageStore(
    path.join(config.chisacodeHome, "usage", "usage-events.jsonl"),
  );
  const agentIndex = createSqliteAgentIndex(
    path.join(config.chisacodeHome, "index", "agent-index.sqlite"),
    logger,
  );
  agentStorage.setMutationHook(agentIndex);
  const projectRegistry = new FileBackedProjectRegistry(
    path.join(config.chisacodeHome, "projects", "projects.json"),
    logger,
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(config.chisacodeHome, "projects", "workspaces.json"),
    logger,
  );
  const chatService = new FileBackedChatService({
    chisacodeHome: config.chisacodeHome,
    logger,
  });
  const terminalManager = createConfiguredTerminalManager(workspaceMutationCoordinator);
  const github = createGitHubService();
  const workspaceGitService = new WorkspaceGitServiceImpl({
    logger,
    chisacodeHome: config.chisacodeHome,
    deps: {
      github,
    },
  });
  const providerSnapshotLogger = logger.child({ module: "provider-snapshot-manager" });
  const providerSnapshotManager = new ProviderSnapshotManager({
    logger: providerSnapshotLogger,
    runtimeSettings: config.agentProviderSettings,
    providerOverrides: config.providerOverrides,
    modelGateways: config.modelGateways,
    modelGatewayBaseUrl: modelGatewayBaseUrl ?? undefined,
    modelGatewayToken,
    workspaceGitService,
    isDev: config.isDev === true,
    enableDevProviders: config.enableDevProviders === true,
    extraClients: config.agentClients,
  });
  const initialAgentManagerState = providerSnapshotManager.getAgentManagerProviderState();
  const agentManager = new AgentManager({
    clients: initialAgentManagerState.clients,
    providerDefinitions: initialAgentManagerState.providerDefinitions,
    registry: agentStorage,
    usageStore,
    appendSystemPrompt: config.appendSystemPrompt,
    resolveCachedModels: (cwd, provider) => {
      const entry = providerSnapshotManager
        .getSnapshot(cwd)
        .find((candidate) => candidate.provider === provider);
      if (!entry || entry.status !== "ready" || !entry.models || entry.models.length === 0) {
        return undefined;
      }
      return entry.models;
    },
    resolveSkillPolicy: (agentId, sessionConfig) =>
      resolveAgentSkillPolicy(daemonConfigStore.get(), agentId, sessionConfig.provider),
    resolveMcpServers: (agentId, sessionConfig) =>
      resolveEffectiveManagedMcpServers(agentId, sessionConfig, daemonConfigStore.get()),
    workspaceWriteCoordinator: workspaceMutationCoordinator,
    logger,
  });
  const agentSessionReaper = new AgentSessionReaper({
    agentManager,
    logger: logger.child({ module: "agent-session-reaper" }),
  });

  const detachAgentStoragePersistence = attachAgentStoragePersistence(
    logger,
    agentManager,
    agentStorage,
  );
  await agentStorage.initialize();
  await rebuildAgentIndexIfEmpty({ index: agentIndex, agentStorage });
  logger.info({ elapsed: elapsed() }, "Agent storage initialized");
  await bootstrapWorkspaceRegistries({
    chisacodeHome: config.chisacodeHome,
    agentStorage,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    logger,
  });
  logger.info({ elapsed: elapsed() }, "Workspace registries bootstrapped");
  const workspaceReconciliation = new WorkspaceReconciliationService({
    projectRegistry,
    workspaceRegistry,
    logger,
    workspaceGitService,
  });
  void (async () => {
    try {
      const result = await workspaceReconciliation.runOnce();
      logger.info(
        {
          elapsed: elapsed(),
          changeCount: result.changesApplied.length,
        },
        "Workspace registries reconciled",
      );
    } catch (error) {
      logger.error({ err: error }, "Background workspace reconciliation failed");
    }
  })();
  await chatService.initialize();
  logger.info({ elapsed: elapsed() }, "Chat service initialized");
  const checkoutDiffManager = new CheckoutDiffManager({
    logger,
    chisacodeHome: config.chisacodeHome,
    workspaceGitService,
  });
  const loopService = new LoopService({
    chisacodeHome: config.chisacodeHome,
    logger,
    agentManager,
  });
  await loopService.initialize();
  logger.info({ elapsed: elapsed() }, "Loop service initialized");
  const scheduleService = new ScheduleService({
    chisacodeHome: config.chisacodeHome,
    logger,
    agentManager,
    agentStorage,
  });
  await scheduleService.start();
  agentManager.setAgentArchivedCallback(async (agentId) => {
    try {
      await scheduleService.deleteForAgent(agentId);
    } catch (error) {
      logger.warn({ err: error, agentId }, "Failed to delete schedules for archived agent");
    }
  });
  logger.info({ elapsed: elapsed() }, "Schedule service initialized");
  logger.info({ elapsed: elapsed() }, "Loading persisted agent registry");
  const persistedRecords = await agentStorage.list();
  logger.info(
    { elapsed: elapsed() },
    `Agent registry loaded (${persistedRecords.length} record${persistedRecords.length === 1 ? "" : "s"}); agents will initialize on demand`,
  );
  logger.info(
    "Voice mode configured for agent-scoped resume flow (no dedicated voice assistant provider)",
  );
  logger.info({ elapsed: elapsed() }, "Preparing voice and MCP runtime");

  const archiveWorkspaceRecordExternal = async (workspaceId: string) => {
    const sessions = wsServer?.listActiveSessions() ?? [];
    if (sessions.length > 0) {
      await Promise.all(
        sessions.map((session) => session.archiveWorkspaceRecordForExternalMutation(workspaceId)),
      );
      return;
    }

    await archivePersistedWorkspaceRecord({
      workspaceId,
      workspaceRegistry,
      projectRegistry,
    });
  };
  const markWorkspaceArchivingExternal = (workspaceIds: Iterable<string>, archivingAt: string) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listActiveSessions() ?? []) {
      session.markWorkspaceArchivingForExternalMutation(workspaceIdList, archivingAt);
    }
  };
  const clearWorkspaceArchivingExternal = (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listActiveSessions() ?? []) {
      session.clearWorkspaceArchivingForExternalMutation(workspaceIdList);
    }
  };
  const emitWorkspaceUpdatesExternal = async (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    await Promise.all(
      (wsServer?.listActiveSessions() ?? []).map((session) =>
        session.emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIdList),
      ),
    );
  };
  const emitExternalSessionMessage = (message: SessionOutboundMessage) => {
    wsServer?.broadcast(wrapSessionMessage(message));
  };

  setupAutoArchiveOnMerge({
    chisacodeHome: config.chisacodeHome,
    daemonConfigStore,
    workspaceGitService,
    github,
    agentManager,
    agentStorage,
    terminalManager,
    logger,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
  });

  const mcpEnabled = config.mcpEnabled ?? true;
  let agentMcpBaseUrl: string | null = null;
  if (mcpEnabled) {
    const agentMcpRoute = "/mcp/agents";
    const agentMcpTransports: AgentMcpTransportMap = new Map();

    const createAgentMcpTransport = async (transportInput?: {
      callerAgentId?: string;
      companionParentAgentId?: string;
      companionToken?: string;
    }) => {
      const agentMcpServer = await createAgentMcpServer({
        agentManager,
        agentStorage,
        terminalManager,
        getDaemonTcpPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
        scheduleService,
        chatService,
        loopService,
        providerSnapshotManager,
        getDiagnostics: () =>
          createDaemonDiagnosticReport(
            {
              chisacodeHome: config.chisacodeHome,
              daemonVersion,
              daemonRuntimeConfig: {
                listen: formatListenTarget(boundListenTarget ?? listenTarget),
                relay: {
                  enabled: config.relayEnabled ?? true,
                  useTls:
                    config.relayUseTls ??
                    (config.relayEndpoint ?? "relay.chisacode.sh:443") === "relay.chisacode.sh:443",
                  publicUseTls:
                    config.relayPublicUseTls ??
                    config.relayUseTls ??
                    (config.relayEndpoint ?? "relay.chisacode.sh:443") === "relay.chisacode.sh:443",
                },
              },
              daemonConfigStore,
              agentManager,
              providerSnapshotManager,
            },
            { includeLogs: false },
          ),
        github,
        workspaceGitService,
        usageStore,
        listAgentPresets: () => agentPresetStore.list(),
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        createChisaCodeWorktree: async (input, serviceOptions) => {
          return createChisaCodeWorktreeWorkflow(
            {
              chisacodeHome: config.chisacodeHome,
              createChisaCodeWorktree: async (workflowInput, workflowOptions) => {
                return createRegisteredChisaCodeWorktree(workflowInput, {
                  github,
                  ...(workflowOptions?.resolveDefaultBranch
                    ? {
                        resolveDefaultBranch: workflowOptions.resolveDefaultBranch,
                      }
                    : {}),
                  projectRegistry,
                  workspaceRegistry,
                  workspaceGitService,
                });
              },
              warmWorkspaceGitData: async (workspace) => {
                await Promise.all(
                  wsServer
                    ?.listActiveSessions()
                    .map((session) => session.warmWorkspaceGitDataForWorkspace(workspace)) ?? [],
                );
              },
              emitWorkspaceUpdateForCwd: async (cwd, emitOptions) => {
                await Promise.all(
                  wsServer
                    ?.listActiveSessions()
                    .map((session) => session.emitWorkspaceUpdatesForExternalCwds([cwd])) ?? [],
                );
                void emitOptions;
              },
              cacheWorkspaceSetupSnapshot: () => {},
              emit: emitExternalSessionMessage,
              sessionLogger: logger,
              terminalManager,
              archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
              scriptRouteStore,
              scriptRuntimeStore,
              getDaemonTcpPort: () =>
                boundListenTarget?.type === "tcp" ? boundListenTarget.port : null,
              getDaemonTcpHost: () =>
                boundListenTarget?.type === "tcp" ? boundListenTarget.host : null,
              onScriptsChanged: null,
            },
            input,
            serviceOptions,
          );
        },
        chisacodeHome: config.chisacodeHome,
        callerAgentId: transportInput?.callerAgentId,
        companionParentAgentId: transportInput?.companionParentAgentId,
        companionToken: transportInput?.companionToken,
        enableVoiceTools: false,
        resolveSpeakHandler: (agentId) => wsServer?.resolveVoiceSpeakHandler(agentId) ?? null,
        resolveCallerContext: (agentId) => wsServer?.resolveVoiceCallerContext(agentId) ?? null,
        logger,
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          agentMcpTransports.set(sessionId, transport);
          logger.debug({ sessionId }, "Agent MCP session initialized");
        },
        onsessionclosed: (sessionId) => {
          agentMcpTransports.delete(sessionId);
          logger.debug({ sessionId }, "Agent MCP session closed");
        },
        // NOTE: We enforce a Vite-like host allowlist at the app/websocket layer.
        // StreamableHTTPServerTransport's built-in check requires exact Host header matches.
        enableDnsRebindingProtection: false,
      });

      Object.assign(transport, {
        onclose: () => {
          if (transport.sessionId) {
            agentMcpTransports.delete(transport.sessionId);
          }
        },
        onerror: (err: Error) => {
          logger.error({ err }, "Agent MCP transport error");
        },
      });

      await agentMcpServer.connect(transport);
      return transport;
    };

    const runAgentMcpRequest = async (
      req: express.Request,
      res: express.Response,
    ): Promise<void> => {
      if (config.mcpDebug) {
        logger.debug(
          {
            method: req.method,
            url: req.originalUrl,
            sessionId: req.header("mcp-session-id"),
            authorization: req.header("authorization") ? REDACTED_LOG_VALUE : undefined,
            body: summarizeAgentMcpDebugBody(req.body),
          },
          "Agent MCP request",
        );
      }
      try {
        const sessionId = req.header("mcp-session-id");
        let transport = sessionId ? agentMcpTransports.get(sessionId) : undefined;

        if (!transport) {
          if (req.method !== "POST") {
            res.status(400).json({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Missing or invalid MCP session",
              },
              id: null,
            });
            return;
          }
          if (!isInitializeRequest(req.body)) {
            res.status(400).json({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Initialization request expected",
              },
              id: null,
            });
            return;
          }
          transport = await createAgentMcpTransport({
            callerAgentId: firstQueryString(req.query.callerAgentId),
            companionParentAgentId: firstQueryString(req.query.parentAgentId),
            companionToken: firstQueryString(req.query.companionToken),
          });
        }

        await transport.handleRequest(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse,
          req.body,
        );
      } catch (err) {
        logger.error({ err }, "Failed to handle Agent MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal MCP server error",
            },
            id: null,
          });
        }
      }
    };

    const handleAgentMcpRequest: express.RequestHandler = (req, res) => {
      void runAgentMcpRequest(req, res);
    };

    app.post(agentMcpRoute, handleAgentMcpRequest);
    app.get(agentMcpRoute, handleAgentMcpRequest);
    app.delete(agentMcpRoute, handleAgentMcpRequest);
    logger.info({ route: agentMcpRoute }, "Agent MCP server mounted on main app");
  } else {
    logger.info("Agent MCP HTTP endpoint disabled");
  }

  const speechService = await createSpeechServiceWithBootstrapCleanup({
    logger,
    config,
    scriptHealthMonitor,
    detachAgentStoragePersistence,
    agentStorage,
    providerSnapshotManager,
    agentIndex,
    terminalManager,
    scheduleService,
  });
  logger.info({ elapsed: elapsed() }, "Speech service created");

  logger.info({ elapsed: elapsed() }, "Bootstrap complete, ready to start listening");

  const start = async () => {
    // Start main HTTP server
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        httpServer.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        const logAndResolve = async () => {
          boundListenTarget = resolveBoundListenTarget(listenTarget, httpServer);
          const mcpBaseUrl = mcpEnabled ? createAgentMcpBaseUrl(boundListenTarget) : null;
          agentMcpBaseUrl = mcpBaseUrl;
          agentManager.setMcpBaseUrl(agentMcpBaseUrl);
          providerSnapshotManager.setMcpInjectionState({
            enabled: agentMcpBaseUrl !== null && daemonConfigStore.get().mcp.injectIntoAgents,
            baseUrl: mcpBaseUrl,
          });
          daemonConfigStore.onFieldChange("mcp.injectIntoAgents", (value) => {
            providerSnapshotManager.setMcpInjectionState({
              enabled: mcpBaseUrl !== null && value === true,
              baseUrl: mcpBaseUrl,
            });
          });
          daemonConfigStore.onFieldChange("appendSystemPrompt", (value) => {
            agentManager.setAppendSystemPrompt(typeof value === "string" ? value : "");
          });
          const relayEnabled = config.relayEnabled ?? true;
          const relayEndpoint = config.relayEndpoint ?? "relay.chisacode.sh:443";
          const relayPublicEndpoint = config.relayPublicEndpoint ?? relayEndpoint;
          const relayUseTls = config.relayUseTls ?? relayEndpoint === "relay.chisacode.sh:443";
          const relayPublicUseTls = config.relayPublicUseTls ?? relayUseTls;
          const appBaseUrl = config.appBaseUrl ?? "https://app.chisacode.sh";

          if (boundListenTarget.type === "tcp") {
            logger.info(
              {
                host: boundListenTarget.host,
                port: boundListenTarget.port,
                authRequired: !!config.auth?.password,
                elapsed: elapsed(),
              },
              `Server listening on http://${boundListenTarget.host}:${boundListenTarget.port}`,
            );
          } else {
            logger.info(
              {
                path: boundListenTarget.path,
                authRequired: !!config.auth?.password,
                elapsed: elapsed(),
              },
              `Server listening on ${boundListenTarget.path}`,
            );
          }
          if (config.auth?.password) {
            logger.info("Daemon password authentication enabled");
          }

          wsServer = new VoiceAssistantWebSocketServer(
            httpServer,
            logger,
            serverId,
            agentManager,
            agentStorage,
            downloadTokenStore,
            config.chisacodeHome,
            daemonConfigStore,
            mcpBaseUrl,
            {
              allowedOrigins,
              hostnames: configuredHostnames,
              allowUpgradeRequest: checkRateLimitForIncomingMessage,
            },
            config.auth,
            speechService,
            terminalManager,
            daemonVersion,
            (intent: SessionLifecycleIntent) => {
              try {
                config.onLifecycleIntent?.(intent);
              } catch (error) {
                logger.error({ err: error, intent }, "Failed to handle daemon lifecycle intent");
              }
            },
            projectRegistry,
            workspaceRegistry,
            chatService,
            loopService,
            scheduleService,
            checkoutDiffManager,
            scriptRouteStore,
            scriptRuntimeStore,
            handleBranchChange,
            () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
            () => (boundListenTarget?.type === "tcp" ? boundListenTarget.host : null),
            (hostname: string) => scriptHealthMonitor.getHealthForHostname(hostname),
            workspaceGitService,
            github,
            config.pushNotificationSender,
            providerSnapshotManager,
            {
              listen: formatListenTarget(boundListenTarget ?? listenTarget),
              relay: {
                enabled: relayEnabled,
                endpoint: relayEndpoint,
                publicEndpoint: relayPublicEndpoint,
                useTls: relayUseTls,
                publicUseTls: relayPublicUseTls,
              },
            },
            usageStore,
          );

          if (config.lanE2eeEnabled !== false) {
            lanE2eeTransport?.stop().catch(() => undefined);
            lanE2eeTransport = startLanE2eeTransport({
              httpServer,
              logger,
              attachSocket: (ws, metadata) => {
                if (!wsServer) {
                  throw new Error("WebSocket server not initialized");
                }
                return wsServer.attachExternalSocket(ws, metadata);
              },
              serverId,
              daemonKeyPair: daemonKeyPair.keyPair,
              chisacodeHome: config.chisacodeHome,
              daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
              requireDeviceAuth: true,
              iceServers: config.iceServers,
            });
          }

          if (relayEnabled) {
            const deviceStore = new RelayDeviceCredentialStore(config.chisacodeHome);
            const pairingBootstrap = deviceStore.issuePairingToken(10 * 60_000);
            const offer = await createConnectionOfferV2({
              serverId,
              daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
              relayAuthPublicKeyB64: daemonKeyPair.relayAuthPublicKeyB64,
              authBootstrap: {
                version: 1,
                pairingToken: pairingBootstrap.token,
                expiresAtMs: pairingBootstrap.expiresAtMs,
              },
              relay: {
                endpoint: relayPublicEndpoint,
                useTls: relayPublicUseTls,
              },
              ...(config.iceServers && config.iceServers.length > 0
                ? { iceServers: config.iceServers }
                : {}),
            });

            encodeOfferToFragmentUrl({ offer, appBaseUrl });

            relayTransport?.stop().catch(() => undefined);
            const allowUnauthenticatedRelayRecovery =
              process.env.CHISACODE_RELAY_ALLOW_UNAUTHENTICATED_RECOVERY === "1";
            if (allowUnauthenticatedRelayRecovery) {
              logger.error(
                { securityLevel: "legacy", env: "CHISACODE_RELAY_ALLOW_UNAUTHENTICATED_RECOVERY" },
                "Relay device authentication disabled by emergency recovery override",
              );
            }
            relayTransport = startRelayTransport({
              logger,
              attachSocket: (ws, metadata) => {
                if (!wsServer) {
                  throw new Error("WebSocket server not initialized");
                }
                return wsServer.attachExternalSocket(ws, metadata);
              },
              relayEndpoint,
              relayUseTls,
              serverId,
              daemonKeyPair: daemonKeyPair.keyPair,
              daemonRelayAuthKeyPair: daemonKeyPair.relayAuthKeyPair,
              chisacodeHome: config.chisacodeHome,
              daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
              // COMPAT(relayUnauthenticatedRecovery): emergency downgrade; remove after 2026-11-10.
              requireDeviceAuth: !allowUnauthenticatedRelayRecovery,
              iceServers: config.iceServers,
            });
          }
        };

        logAndResolve().then(resolve, reject);
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);

      if (listenTarget.type === "tcp") {
        httpServer.listen(listenTarget.port, listenTarget.host);
      } else {
        if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
          unlinkSync(listenTarget.path);
        }
        httpServer.listen(listenTarget.path);
      }
    });

    // Start speech service after listening so synchronous Sherpa native
    // model loading doesn't block the server from accepting connections.
    speechService.start();
    scriptHealthMonitor.start();
    agentSessionReaper.start();
  };

  const stop = async () => {
    agentSessionReaper.stop();
    scriptHealthMonitor.stop();
    await closeAllAgents(logger, agentManager);
    await agentManager.flush().catch(() => undefined);
    detachAgentStoragePersistence();
    await agentStorage.flush().catch(() => undefined);
    await providerSnapshotManager.shutdown();
    agentIndex?.close();
    terminalManager.killAll();
    speechService.stop();
    await scheduleService.stop().catch(() => undefined);
    await lanE2eeTransport?.stop().catch(() => undefined);
    await relayTransport?.stop().catch(() => undefined);
    if (wsServer) {
      await wsServer.close();
    }
    // Force-drop remaining sockets so httpServer.close() resolves promptly.
    // We've already closed wsServer (which sent ws-layer close frames) and
    // stopped every other service, so anything still attached is a TCP
    // socket whose higher-level shutdown hasn't fully released it (e.g.
    // upgraded WS sockets in the closing handshake, or HTTP keep-alive
    // sockets in CLOSE_WAIT). closeIdleConnections() does not catch
    // upgraded sockets, so we use closeAllConnections() here.
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    // Clean up socket files
    if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
      unlinkSync(listenTarget.path);
    }
  };

  return {
    config,
    agentManager,
    agentStorage,
    terminalManager,
    scriptRouteStore,
    scriptRuntimeStore,
    start,
    stop,
    disconnectDevice: (deviceId: string) =>
      wsServer ? wsServer.disconnectDevice(deviceId) : Promise.resolve(0),
    getListenTarget: () => boundListenTarget,
  };
}

async function closeAllAgents(logger: Logger, agentManager: AgentManager): Promise<void> {
  const agents = agentManager.listAgents();
  await Promise.all(
    agents.map(async (agent) => {
      try {
        await agentManager.closeAgent(agent.id);
      } catch (err) {
        logger.error({ err, agentId: agent.id }, "Failed to close agent");
      }
    }),
  );
}
