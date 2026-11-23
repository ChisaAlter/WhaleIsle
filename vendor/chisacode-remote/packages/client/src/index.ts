import type {
  AgentSnapshotPayload,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  DiagnosticsResponse,
  ProviderToolingActionResponseMessage,
  AgentPresetsListResponseMessage,
  ProjectPlacementPayload,
  RefreshProvidersSnapshotResponseMessage,
  SendAgentMessageRequest,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
} from "@chisacode/protocol/messages";
import {
  DaemonClient,
  type IceServerConfig,
  type RtcPeerConnectionFactory,
  type TransportMode,
} from "./daemon-client.js";
import type {
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
} from "./daemon-client.js";

export { DaemonClient };
export type {
  DaemonClientConfig,
  DaemonEvent,
  IceServerConfig,
  RtcDataChannelLike,
  RtcIceCandidateInitLike,
  RtcPeerConnectionFactory,
  RtcPeerConnectionLike,
  RtcSessionDescriptionLike,
  TransportMode,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client.js";
export {
  AdaptiveConnectionOfferV2Schema,
  DEFAULT_STUN_ICE_SERVERS,
  RtcChunkReassembler,
  SequencedCiphertextReorderBuffer,
  SerialSend,
  chunkRtcPayload,
  createRtcMessageIdGenerator,
  mergeIceServers,
  normalizeIceServers,
  orderIceServers,
  parseConnectionOfferV2FromUrl,
  unwrapDshuFrame,
  wrapDshuFrame,
  type AdaptiveConnectionOfferV2,
} from "./rtc-chunking.js";
export {
  buildLanWebSocketUrl,
  createAdaptiveTransport,
  createAdaptiveTransportFactory,
  defaultRtcPeerConnectionFactory,
} from "./daemon-client-adaptive-transport.js";

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface ChisaCodeLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ChisaCodeClientConfig {
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: ChisaCodeLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  lanEndpoints?: string[];
  lanUseTls?: boolean;
  iceServers?: IceServerConfig[];
  rtcPeerConnectionFactory?: RtcPeerConnectionFactory;
  webrtcUpgrade?: boolean;
  onTransportModeChange?: (mode: TransportMode) => void;
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type ChisaCodeWorkspace = WorkspaceDescriptorPayload;
export type ChisaCodeAgent = AgentSnapshotPayload;
export type ChisaCodeWorkspaceListOptions = Omit<
  FetchWorkspacesRequestMessage,
  "type" | "requestId"
> & {
  requestId?: string;
};

export interface ChisaCodeWorkspaceListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: ChisaCodeWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface ChisaCodeWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export interface ChisaCodeWorkspaceOpenResult {
  requestId: string;
  workspace: ChisaCodeWorkspaceHandle | null;
  error: string | null;
}

export interface ChisaCodeWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type ChisaCodeWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type ChisaCodeWorkspaceUpdateHandler = (update: ChisaCodeWorkspaceUpdate) => void;

/**
 * A handle is a stable typed reference to a daemon resource. Its identity is the
 * daemon id, and `latest()` only returns the most recent snapshot this handle has
 * seen through construction, `refetch()`, or this handle's local subscription.
 */
export interface ChisaCodeWorkspaceHandle {
  readonly id: string;
  latest(): ChisaCodeWorkspace | null;
  /**
   * Fetches a fresh workspace snapshot through the existing workspace list RPC,
   * exact-matches this handle id from the result, and updates `latest()`.
   */
  refetch(options?: { requestId?: string }): Promise<ChisaCodeWorkspace | null>;
  archive(requestId?: string): Promise<ChisaCodeWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: ChisaCodeWorkspaceUpdate) => void): () => void;
}

export interface ChisaCodeWorkspaceActions {
  list(options?: ChisaCodeWorkspaceListOptions): Promise<ChisaCodeWorkspaceListResult>;
  ref(workspace: string | ChisaCodeWorkspace): ChisaCodeWorkspaceHandle;
  open(
    input: string | ChisaCodeWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<ChisaCodeWorkspaceOpenResult>;
  create(
    input: string | ChisaCodeWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<ChisaCodeWorkspaceOpenResult>;
  archive(
    workspace: string | ChisaCodeWorkspaceHandle,
    requestId?: string,
  ): Promise<ChisaCodeWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: ChisaCodeWorkspaceUpdateHandler): () => void;
}

type ChisaCodeAgentSessionConfig = CreateAgentRequestMessage["config"];
type ChisaCodeAgentProvider = ChisaCodeAgentSessionConfig["provider"];
type ChisaCodeAgentConfigOverrides = Partial<Omit<ChisaCodeAgentSessionConfig, "provider" | "cwd">>;

export interface ChisaCodeAgentCreateOptions extends ChisaCodeAgentConfigOverrides {
  config?: ChisaCodeAgentSessionConfig;
  provider?: CreateAgentRequestMessage["config"]["provider"];
  cwd?: string;
  workspaceId?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export interface ChisaCodeAgentRefetchResult {
  agent: ChisaCodeAgent;
  project: ProjectPlacementPayload | null;
}

export interface ChisaCodeAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export interface ChisaCodeAgentSendOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

export type ChisaCodeAgentUpdate = Extract<
  SessionOutboundMessage,
  { type: "agent_update" }
>["payload"];

export type ChisaCodeAgentStream = Extract<
  SessionOutboundMessage,
  { type: "agent_stream" }
>["payload"];

export type ChisaCodeAgentUpdateHandler = (update: ChisaCodeAgentUpdate) => void;

export interface ChisaCodeAgentTimelineHandle {
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle's `latest()`
   * is updated to that snapshot.
   */
  refetch(options?: ChisaCodeAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: ChisaCodeAgentStream) => void): () => void;
}

/**
 * Agent handles follow the same identity/snapshot rule as workspace handles:
 * `id` is stable, while `latest()` is only the newest snapshot observed by this
 * handle through construction, `refetch()`, timeline refetch, archive, or local
 * agent_update subscription.
 */
export interface ChisaCodeAgentHandle {
  readonly id: string;
  readonly timeline: ChisaCodeAgentTimelineHandle;
  latest(): ChisaCodeAgent | null;
  refetch(requestId?: string): Promise<ChisaCodeAgentRefetchResult | null>;
  send(text: string, options?: ChisaCodeAgentSendOptions): Promise<{ pendingRun?: boolean }>;
  archive(): Promise<{ archivedAt: string }>;
  subscribe(handler: (update: ChisaCodeAgentUpdate) => void): () => void;
}

export interface ChisaCodeAgentActions {
  ref(agent: string | ChisaCodeAgent): ChisaCodeAgentHandle;
  create(options: ChisaCodeAgentCreateOptions): Promise<ChisaCodeAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: ChisaCodeAgentUpdateHandler): () => void;
}

export interface ChisaCodeProviderConfig extends ChisaCodeProviderConfigInput {
  provider: ChisaCodeAgentProvider;
}
export type ChisaCodeProviderFeatureValues = Record<string, unknown>;

export interface ChisaCodeProviderConfigInput {
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: ChisaCodeProviderFeatureValues;
}

export type ChisaCodeProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type ChisaCodeProviderModesResult = ListProviderModesResponseMessage["payload"];
export type ChisaCodeProviderFeaturesInput = ListProviderFeaturesRequestMessage["draftConfig"];
export type ChisaCodeProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type ChisaCodeProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type ChisaCodeProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type ChisaCodeProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type ChisaCodeProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type ChisaCodeProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];
/** Result returned by the public daemon diagnostics API. */
export type ChisaCodeDiagnosticsResult = DiagnosticsResponse["payload"];
export type ChisaCodeProviderToolingActionResult = ProviderToolingActionResponseMessage["payload"];
export type ChisaCodeAgentPresetsListResult = AgentPresetsListResponseMessage["payload"];

export interface ChisaCodeProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface ChisaCodeProviderRefreshOptions {
  cwd?: string;
  providers?: ChisaCodeAgentProvider[];
  requestId?: string;
}

export interface ChisaCodeProviderActions {
  codex(input?: ChisaCodeProviderConfigInput): ChisaCodeProviderConfig;
  claude(input?: ChisaCodeProviderConfigInput): ChisaCodeProviderConfig;
  opencode(input?: ChisaCodeProviderConfigInput): ChisaCodeProviderConfig;
  pi(input?: ChisaCodeProviderConfigInput): ChisaCodeProviderConfig;
  kimi(input?: ChisaCodeProviderConfigInput): ChisaCodeProviderConfig;
  grokbuild(input?: ChisaCodeProviderConfigInput): ChisaCodeProviderConfig;
  dsh(input?: ChisaCodeProviderConfigInput): ChisaCodeProviderConfig;
  config(
    provider: ChisaCodeAgentProvider,
    input?: ChisaCodeProviderConfigInput,
  ): ChisaCodeProviderConfig;
  listModels(
    provider: ChisaCodeAgentProvider,
    options?: ChisaCodeProviderListOptions,
  ): Promise<ChisaCodeProviderModelsResult>;
  listModes(
    provider: ChisaCodeAgentProvider,
    options?: ChisaCodeProviderListOptions,
  ): Promise<ChisaCodeProviderModesResult>;
  listFeatures(
    draftConfig: ChisaCodeProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<ChisaCodeProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<ChisaCodeProviderAvailabilityResult>;
  snapshot(options?: ChisaCodeProviderListOptions): Promise<ChisaCodeProviderSnapshotResult>;
  refresh(options?: ChisaCodeProviderRefreshOptions): Promise<ChisaCodeProviderRefreshResult>;
  diagnostic(
    provider: ChisaCodeAgentProvider,
    options?: { requestId?: string },
  ): Promise<ChisaCodeProviderDiagnosticResult>;
  toolingAction(
    provider: ChisaCodeAgentProvider,
    action: "install" | "update" | "reinstall",
    options?: { requestId?: string },
  ): Promise<ChisaCodeProviderToolingActionResult>;
  listPresets(options?: { requestId?: string }): Promise<ChisaCodeAgentPresetsListResult>;
  subscribe(handler: (update: ChisaCodeProviderSnapshotUpdate) => void): () => void;
}

export interface ChisaCodePresetActions {
  list(options?: { requestId?: string }): Promise<ChisaCodeAgentPresetsListResult>;
}

export interface ChisaCodeConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

/** Public daemon troubleshooting report operations. */
export interface ChisaCodeDiagnosticsActions {
  get(options?: {
    includeLogs?: boolean;
    maxLogLines?: number;
    requestId?: string;
  }): Promise<ChisaCodeDiagnosticsResult>;
}

export interface ChisaCodeClient {
  readonly workspaces: ChisaCodeWorkspaceActions;
  readonly agents: ChisaCodeAgentActions;
  readonly providers: ChisaCodeProviderActions;
  readonly presets: ChisaCodePresetActions;
  readonly config: ChisaCodeConfigActions;
  readonly diagnostics: ChisaCodeDiagnosticsActions;
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
  getTransportMode(): TransportMode | null;
}

export function createChisaCodeClient(config: ChisaCodeClientConfig): ChisaCodeClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient);
  const createAgentHandle = createAgentHandleFactory(daemonClient);

  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      ref: (agent) => createAgentHandle(agent),
      create: async (options) => {
        const agent = await daemonClient.createAgent(options);
        return createAgentHandle(agent);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      codex: (input) => providerConfig("codex", input),
      claude: (input) => providerConfig("claude", input),
      opencode: (input) => providerConfig("opencode", input),
      pi: (input) => providerConfig("pi", input),
      kimi: (input) => providerConfig("kimi", input),
      grokbuild: (input) => providerConfig("grokbuild", input),
      dsh: (input) => providerConfig("dsh", input),
      config: (provider, input) => providerConfig(provider, input),
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: (draftConfig, options) =>
        daemonClient.listProviderFeatures(draftConfig, options),
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      toolingAction: (provider, action, options) =>
        daemonClient.runProviderToolingAction(provider, action, options),
      listPresets: (options) => daemonClient.listAgentPresets(options),
      subscribe: (handler) =>
        daemonClient.on("providers_snapshot_update", (message) => {
          handler(message.payload);
        }),
    },
    presets: {
      list: (options) => daemonClient.listAgentPresets(options),
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
    diagnostics: {
      get: (options) => daemonClient.getDiagnostics(options),
    },
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
    getTransportMode: () => daemonClient.getTransportMode(),
  };
}

type WorkspaceHandleFactory = (workspace: string | ChisaCodeWorkspace) => ChisaCodeWorkspaceHandle;
type AgentHandleFactory = (agent: string | ChisaCodeAgent) => ChisaCodeAgentHandle;

function createWorkspaceHandleFactory(daemonClient: DaemonClient): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let latest = typeof workspace === "string" ? null : workspace;

    return {
      id,
      latest: () => latest,
      refetch: async (options) => {
        const result = await daemonClient.fetchWorkspaces({
          requestId: options?.requestId,
          filter: { idPrefix: id },
          page: { limit: 25 },
        });
        latest = result.entries.find((entry) => entry.id === id) ?? null;
        return latest;
      },
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (latest) {
          latest = { ...latest, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            latest = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            latest = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let latest = typeof agent === "string" ? null : agent;

    const handle: ChisaCodeAgentHandle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            latest = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          daemonClient.on("agent_stream", (message) => {
            if (message.payload.agentId === id) {
              handler(message.payload);
            }
          }),
      },
      latest: () => latest,
      refetch: async (requestId) => {
        const result = await daemonClient.fetchAgent(id, requestId);
        latest = result?.agent ?? null;
        return result;
      },
      send: (text, options) => daemonClient.sendAgentMessage(id, text, options),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (latest) {
          latest = { ...latest, archivedAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.agent.id === id) {
            latest = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            latest = null;
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | ChisaCodeWorkspaceOpenOptions,
  requestId?: string,
): Promise<ChisaCodeWorkspaceOpenResult> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  return {
    ...result,
    workspace: result.workspace ? createWorkspaceHandle(result.workspace) : null,
  };
}

function resolveWorkspaceId(workspace: string | ChisaCodeWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function providerConfig(
  provider: ChisaCodeAgentProvider,
  input: ChisaCodeProviderConfigInput = {},
): ChisaCodeProviderConfig {
  return {
    provider,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.modeId !== undefined ? { modeId: input.modeId } : {}),
    ...(input.thinkingOptionId !== undefined ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues !== undefined ? { featureValues: input.featureValues } : {}),
  };
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `chisacode-sdk-${randomId}`;
}
