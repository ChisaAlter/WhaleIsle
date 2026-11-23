import type { z } from "zod/v3";
import {
  CheckoutRenameBranchResponseSchema,
  RestartRequestedStatusPayloadSchema,
  ShutdownRequestedStatusPayloadSchema,
  SessionInboundMessageSchema,
  type ServerInfoStatusPayload,
} from "@chisacode/protocol/messages";
import type {
  AgentSnapshotPayload,
  CreateChisaCodeWorktreeRequest,
  FileDownloadTokenResponse,
  FileExplorerResponse,
  CheckoutStatusResponse,
  CheckoutCommitResponse,
  CheckoutMergeResponse,
  CheckoutMergeFromBaseResponse,
  CheckoutPullResponse,
  CheckoutPushResponse,
  CheckoutRefreshResponse,
  CheckoutPrCreateResponse,
  CheckoutPrMergeResponse,
  CheckoutPrMergeMethod,
  CheckoutGithubSetAutoMergeResponse,
  CheckoutPrStatusResponse,
  PullRequestTimelineResponse,
  CheckoutSwitchBranchResponse,
  StashSaveResponse,
  StashPopResponse,
  StashListResponse,
  ValidateBranchResponse,
  BranchSuggestionsResponse,
  GitHubSearchResponse,
  GitHubSearchRequest,
  DirectorySuggestionsResponse,
  ChisaCodeWorktreeListResponse,
  ChisaCodeWorktreeArchiveResponse,
  ProjectIconResponse,
  ListAvailableEditorsResponseMessage,
  OpenInEditorResponseMessage,
  OpenProjectResponseMessage,
  ArchiveWorkspaceResponseMessage,
  WorkspaceSetupStatusResponseMessage,
  ListCommandsResponse,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ListProviderModesResponseMessage,
  ListAvailableProvidersResponse,
  GetProvidersSnapshotResponseMessage,
  RefreshProvidersSnapshotResponseMessage,
  ProviderDiagnosticResponseMessage,
  DiagnosticsResponse,
  ProviderToolingActionResponseMessage,
  AgentPresetsListResponseMessage,
  ModelGatewayMoaTestResponseMessage,
  ModelGatewayTestResponseMessage,
  DaemonGetStatusResponse,
  DaemonGetPairingOfferResponse,
  AgentSkillManagementScope,
  AgentSkillsListResponse,
  AgentSkillsPolicyPatchResponse,
  AgentSkillsInstallResponse,
  AgentSkillsInstallSourceSchema,
  AgentSkillsUninstallResponse,
  AgentRewindResponseMessage,
  AgentMcpServerManagementScope,
  AgentMcpServersListResponse,
  AgentMcpServersUpsertResponse,
  AgentMcpServersPolicyPatchResponse,
  AgentMcpServersDeleteResponse,
  ManagedMcpServerConfig,
  SubscribeTerminalRequest,
  CloseItemsResponse,
  TerminalInput,
  SessionInboundMessage,
  SessionOutboundMessage,
  EditorTargetId,
  ChisaCodeConfigRaw,
  ChisaCodeConfigRevision,
} from "@chisacode/protocol/messages";
import type { SyntheticModelConfig } from "@chisacode/protocol/provider-config";
import type {
  AgentPersistenceHandle,
  AgentPermissionResponse,
  AgentProvider,
  AgentSessionConfig,
} from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@chisacode/protocol/messages";

import { safeRandomId } from "./daemon-client-transport-utils.js";
import { CheckoutCommandClient } from "./daemon-client-checkout-commands.js";
import { CheckoutSubscriptionClient } from "./daemon-client-checkout-subscriptions.js";
import { ConfigCommandClient } from "./daemon-client-config-commands.js";
import { ProviderCommandClient } from "./daemon-client-provider-commands.js";
import { AgentExtensionCommandClient } from "./daemon-client-agent-extension-commands.js";
import { AutomationCommandClient } from "./daemon-client-automation-commands.js";
import { CindyCommandClient } from "./daemon-client-cindy-commands.js";
import { WorkspaceCommandClient } from "./daemon-client-workspace-commands.js";
import {
  QueryCommandClient,
  type ExportUsageOptions,
  type FetchAgentHistoryEntry,
  type FetchAgentHistoryOptions,
  type FetchAgentHistoryPayload,
  type FetchAgentHistoryPageInfo,
  type FetchAgentsEntry,
  type FetchAgentsOptions,
  type FetchAgentsPayload,
  type FetchAgentsPageInfo,
  type FetchRecentProviderSessionEntry,
  type FetchRecentProviderSessionsOptions,
  type FetchRecentProviderSessionsPayload,
  type FetchUsageSummaryOptions,
  type FetchWorkspacesEntry,
  type FetchWorkspacesOptions,
  type FetchWorkspacesPayload,
  type FetchWorkspacesPageInfo,
  type UsageClearPayload,
  type UsageExportPayload,
  type UsageSummaryPayload,
} from "./daemon-client-query-commands.js";
import { DaemonClientRuntimeMetrics } from "./daemon-client-runtime-metrics.js";
import {
  BinaryFileTransferManager,
  legacyExplorerFileToBytes,
  type FileReadResult,
} from "./daemon-client-file-transfer.js";
import {
  TerminalClient,
  type CaptureTerminalPayload,
  type CreateTerminalPayload,
  type KillTerminalPayload,
  type ListTerminalsPayload,
  type RenameTerminalInput,
  type RenameTerminalResult,
  type SubscribeTerminalPayload,
  type TerminalStreamEvent,
} from "./daemon-client-terminal-client.js";
import { VoiceClient, type SetVoiceModePayload } from "./daemon-client-voice-client.js";
import {
  AgentLifecycleClient,
  type AgentRefreshedStatusPayload,
  type CreateAgentRequestOptions,
  type CreateAgentResult,
  type FetchAgentResult,
  type ImportAgentInput,
} from "./daemon-client-agent-lifecycle.js";
import {
  AgentInteractionClient,
  type FetchAgentTimelineCursor,
  type FetchAgentTimelineDirection,
  type FetchAgentTimelineOptions,
  type FetchAgentTimelinePayload,
  type FetchAgentTimelineProjection,
  type SendMessageOptions,
} from "./daemon-client-agent-interaction.js";
import { DaemonRequestCoordinator } from "./daemon-client-request-coordinator.js";
import {
  DaemonConnectionController,
  type ConnectionState,
  type DaemonClientConfig,
  type Logger,
} from "./daemon-client-connection-controller.js";
import type { TransportMode } from "./daemon-client-transport.js";
import {
  DaemonClientInboundController,
  type DaemonEventHandler,
} from "./daemon-client-inbound-controller.js";
import {
  AgentWaitClient,
  type AgentPermissionResolvedPayload,
  type WaitForFinishResult,
} from "./daemon-client-agent-waits.js";

export type { FileReadResult } from "./daemon-client-file-transfer.js";
export type {
  ConnectionState,
  DaemonClientConfig,
  Logger,
} from "./daemon-client-connection-controller.js";

const consoleLogger: Logger = {
  debug: () => {},
  info: (obj, msg) => console.log(msg, obj),
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

export type {
  DaemonTransport,
  DaemonTransportFactory,
  IceServerConfig,
  RtcDataChannelLike,
  RtcIceCandidateInitLike,
  RtcPeerConnectionFactory,
  RtcPeerConnectionLike,
  RtcSessionDescriptionLike,
  TransportMode,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client-transport.js";

export type {
  CreateAgentRequestOptions,
  CreateAgentResult,
  FetchAgentResult,
  ImportAgentInput,
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelineOptions,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
  SendMessageOptions,
  RenameTerminalInput,
  RenameTerminalResult,
  TerminalStreamEvent,
  ExportUsageOptions,
  FetchAgentHistoryEntry,
  FetchAgentHistoryOptions,
  FetchAgentHistoryPageInfo,
  FetchAgentsEntry,
  FetchAgentsOptions,
  FetchAgentsPageInfo,
  FetchRecentProviderSessionEntry,
  FetchRecentProviderSessionsOptions,
  FetchUsageSummaryOptions,
  FetchWorkspacesEntry,
  FetchWorkspacesOptions,
  FetchWorkspacesPageInfo,
  UsageClearPayload,
  UsageExportPayload,
  UsageSummaryPayload,
};

export type { DaemonEvent, DaemonEventHandler } from "./daemon-client-inbound-controller.js";
export type { WaitForFinishResult } from "./daemon-client-agent-waits.js";

export interface CreateChisaCodeWorktreeInput extends Pick<
  CreateChisaCodeWorktreeRequest,
  | "cwd"
  | "projectId"
  | "worktreeSlug"
  | "firstAgentContext"
  | "refName"
  | "action"
  | "githubPrNumber"
> {}

type CheckoutStatusPayload = CheckoutStatusResponse["payload"];
type SubscribeCheckoutDiffPayload = Extract<
  SessionOutboundMessage,
  { type: "subscribe_checkout_diff_response" }
>["payload"];
type CheckoutDiffPayload = Omit<SubscribeCheckoutDiffPayload, "subscriptionId">;
type CheckoutCommitPayload = CheckoutCommitResponse["payload"];
type CheckoutMergePayload = CheckoutMergeResponse["payload"];
type CheckoutMergeFromBasePayload = CheckoutMergeFromBaseResponse["payload"];
type CheckoutPullPayload = CheckoutPullResponse["payload"];
type CheckoutPushPayload = CheckoutPushResponse["payload"];
type CheckoutRefreshPayload = CheckoutRefreshResponse["payload"];
type CheckoutPrCreatePayload = CheckoutPrCreateResponse["payload"];
type CheckoutPrMergePayload = CheckoutPrMergeResponse["payload"];
type CheckoutGithubSetAutoMergePayload = CheckoutGithubSetAutoMergeResponse["payload"];
type CheckoutPrStatusPayload = CheckoutPrStatusResponse["payload"];
type PullRequestTimelinePayload = PullRequestTimelineResponse["payload"];
type CheckoutSwitchBranchPayload = CheckoutSwitchBranchResponse["payload"];
export type RenameBranchResult = z.infer<typeof CheckoutRenameBranchResponseSchema>["payload"];
type StashSavePayload = StashSaveResponse["payload"];
type StashPopPayload = StashPopResponse["payload"];
type StashListPayload = StashListResponse["payload"];
type ValidateBranchPayload = ValidateBranchResponse["payload"];
type BranchSuggestionsPayload = BranchSuggestionsResponse["payload"];
type GitHubSearchPayload = GitHubSearchResponse["payload"];
type DirectorySuggestionsPayload = DirectorySuggestionsResponse["payload"];
type ChisaCodeWorktreeListPayload = ChisaCodeWorktreeListResponse["payload"];
type ChisaCodeWorktreeArchivePayload = ChisaCodeWorktreeArchiveResponse["payload"];
type CreateChisaCodeWorktreePayload = Extract<
  SessionOutboundMessage,
  { type: "create_chisacode_worktree_response" }
>["payload"];
type FileExplorerPayload = FileExplorerResponse["payload"];
export type FileExplorerDirectoryPayload = NonNullable<FileExplorerPayload["directory"]>;
type FileDownloadTokenPayload = FileDownloadTokenResponse["payload"];
type ListProviderFeaturesPayload = ListProviderFeaturesResponseMessage["payload"];
type ListProviderModelsPayload = ListProviderModelsResponseMessage["payload"];
type ListProviderModesPayload = ListProviderModesResponseMessage["payload"];
type ListAvailableProvidersPayload = ListAvailableProvidersResponse["payload"];
type GetProvidersSnapshotPayload = GetProvidersSnapshotResponseMessage["payload"];
type RefreshProvidersSnapshotPayload = RefreshProvidersSnapshotResponseMessage["payload"];
type ProviderDiagnosticPayload = ProviderDiagnosticResponseMessage["payload"];
/** Payload returned by the daemon-wide diagnostics report RPC. */
export type DiagnosticsPayload = DiagnosticsResponse["payload"];
type ProviderToolingActionPayload = ProviderToolingActionResponseMessage["payload"];
type AgentPresetsListPayload = AgentPresetsListResponseMessage["payload"];
type ModelGatewayMoaTestPayload = ModelGatewayMoaTestResponseMessage["payload"];
type ModelGatewayTestPayload = ModelGatewayTestResponseMessage["payload"];
type DaemonStatusPayload = DaemonGetStatusResponse["payload"];
type DaemonPairingOfferPayload = DaemonGetPairingOfferResponse["payload"];
type ReadProjectConfigPayload = Extract<
  SessionOutboundMessage,
  { type: "read_project_config_response" }
>["payload"];
type WriteProjectConfigPayload = Extract<
  SessionOutboundMessage,
  { type: "write_project_config_response" }
>["payload"];
type ListCommandsPayload = ListCommandsResponse["payload"];
type AgentSkillsListPayload = AgentSkillsListResponse["payload"];
type AgentSkillsPolicyPatchPayload = AgentSkillsPolicyPatchResponse["payload"];
type AgentSkillsInstallPayload = AgentSkillsInstallResponse["payload"];
type AgentSkillsInstallSource = z.infer<typeof AgentSkillsInstallSourceSchema>;
type AgentSkillsUninstallPayload = AgentSkillsUninstallResponse["payload"];
type AgentMcpServersListPayload = AgentMcpServersListResponse["payload"];
type AgentMcpServersUpsertPayload = AgentMcpServersUpsertResponse["payload"];
type AgentMcpServersPolicyPatchPayload = AgentMcpServersPolicyPatchResponse["payload"];
type AgentMcpServersDeletePayload = AgentMcpServersDeleteResponse["payload"];
type ListCommandsDraftConfig = Pick<
  AgentSessionConfig,
  "provider" | "cwd" | "modeId" | "model" | "thinkingOptionId" | "featureValues"
>;
export interface WriteProjectConfigInput {
  repoRoot: string;
  config: ChisaCodeConfigRaw;
  expectedRevision: ChisaCodeConfigRevision | null;
  requestId?: string;
}
interface ListCommandsOptions {
  requestId?: string;
  draftConfig?: ListCommandsDraftConfig;
}

export interface RunModelGatewayMoaTestInput {
  gatewayId: string;
  syntheticModel: SyntheticModelConfig;
  prompt: string;
  requestId?: string;
}

export interface RunModelGatewayTestInput {
  gatewayId: string;
  modelId: string;
  targetFormat?: "anthropic" | "chatCompletions" | "responses";
  requestId?: string;
}
type CloseItemsPayload = CloseItemsResponse["payload"];
type ChatCreatePayload = Extract<
  SessionOutboundMessage,
  { type: "chat/create/response" }
>["payload"];
type ChatListPayload = Extract<SessionOutboundMessage, { type: "chat/list/response" }>["payload"];
type ChatInspectPayload = Extract<
  SessionOutboundMessage,
  { type: "chat/inspect/response" }
>["payload"];
type ChatDeletePayload = Extract<
  SessionOutboundMessage,
  { type: "chat/delete/response" }
>["payload"];
type ChatPostPayload = Extract<SessionOutboundMessage, { type: "chat/post/response" }>["payload"];
type ChatReadPayload = Extract<SessionOutboundMessage, { type: "chat/read/response" }>["payload"];
type ChatWaitPayload = Extract<SessionOutboundMessage, { type: "chat/wait/response" }>["payload"];
type LoopRunPayload = Extract<SessionOutboundMessage, { type: "loop/run/response" }>["payload"];
type LoopListPayload = Extract<SessionOutboundMessage, { type: "loop/list/response" }>["payload"];
type LoopInspectPayload = Extract<
  SessionOutboundMessage,
  { type: "loop/inspect/response" }
>["payload"];
type LoopLogsPayload = Extract<SessionOutboundMessage, { type: "loop/logs/response" }>["payload"];
type LoopStopPayload = Extract<SessionOutboundMessage, { type: "loop/stop/response" }>["payload"];
type ScheduleCreatePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/create/response" }
>["payload"];
type ScheduleListPayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/list/response" }
>["payload"];
type ScheduleInspectPayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/inspect/response" }
>["payload"];
type ScheduleLogsPayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/logs/response" }
>["payload"];
type SchedulePausePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/pause/response" }
>["payload"];
type ScheduleResumePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/resume/response" }
>["payload"];
type ScheduleDeletePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/delete/response" }
>["payload"];
type ScheduleRunOncePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/run-once/response" }
>["payload"];
type ScheduleUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/update/response" }
>["payload"];
type RestartRequestedStatusPayload = z.infer<typeof RestartRequestedStatusPayloadSchema>;
type ShutdownRequestedStatusPayload = z.infer<typeof ShutdownRequestedStatusPayloadSchema>;
export interface CreateChatRoomOptions {
  name: string;
  purpose?: string | null;
  requestId?: string;
}
export interface InspectChatRoomOptions {
  room: string;
  requestId?: string;
}
export interface DeleteChatRoomOptions {
  room: string;
  requestId?: string;
}
export interface PostChatMessageOptions {
  room: string;
  body: string;
  authorAgentId?: string;
  replyToMessageId?: string | null;
  requestId?: string;
}
export interface ReadChatMessagesOptions {
  room: string;
  limit?: number;
  since?: string;
  authorAgentId?: string;
  requestId?: string;
}
export interface WaitForChatMessagesOptions {
  room: string;
  afterMessageId?: string | null;
  timeoutMs?: number;
  requestId?: string;
}
export interface RunLoopOptions {
  prompt: string;
  cwd: string;
  provider?: string;
  model?: string;
  modeId?: string;
  verifierProvider?: string;
  verifierModel?: string;
  verifierModeId?: string;
  verifyPrompt?: string | null;
  verifyChecks?: string[];
  name?: string | null;
  sleepMs?: number;
  maxIterations?: number;
  maxTimeMs?: number;
  requestId?: string;
}
export interface InspectLoopOptions {
  id: string;
  requestId?: string;
}
export interface LoopLogsOptions {
  id: string;
  afterSeq?: number;
  requestId?: string;
}
export interface StopLoopOptions {
  id: string;
  requestId?: string;
}
export interface CreateScheduleOptions {
  prompt: string;
  name?: string | null;
  cadence:
    | {
        type: "every";
        everyMs: number;
      }
    | {
        type: "cron";
        expression: string;
      };
  target:
    | {
        type: "self";
        agentId: string;
      }
    | {
        type: "agent";
        agentId: string;
      }
    | {
        type: "new-agent";
        config: {
          provider: AgentProvider;
          cwd: string;
          modeId?: string;
          model?: string;
          thinkingOptionId?: string;
          title?: string | null;
          approvalPolicy?: string;
          sandboxMode?: string;
          networkAccess?: boolean;
          webSearch?: boolean;
          extra?: AgentSessionConfig["extra"];
          systemPrompt?: string;
          mcpServers?: AgentSessionConfig["mcpServers"];
        };
      };
  maxRuns?: number;
  expiresAt?: string;
  runOnCreate?: boolean;
  requestId?: string;
}
export interface InspectScheduleOptions {
  id: string;
  requestId?: string;
}
export interface UpdateScheduleNewAgentConfig {
  provider?: string;
  model?: string | null;
  modeId?: string | null;
  cwd?: string;
}
export interface UpdateScheduleOptions {
  id: string;
  name?: string | null;
  prompt?: string;
  cadence?:
    | {
        type: "every";
        everyMs: number;
      }
    | {
        type: "cron";
        expression: string;
      };
  newAgentConfig?: UpdateScheduleNewAgentConfig;
  maxRuns?: number | null;
  expiresAt?: string | null;
  requestId?: string;
}
export interface RenameBranchInput {
  cwd: string;
  branch: string;
  requestId?: string;
}
type ListAvailableEditorsPayload = ListAvailableEditorsResponseMessage["payload"];
type OpenInEditorPayload = OpenInEditorResponseMessage["payload"];
type OpenProjectPayload = OpenProjectResponseMessage["payload"];
type ArchiveWorkspacePayload = ArchiveWorkspaceResponseMessage["payload"];
type WorkspaceSetupStatusPayload = WorkspaceSetupStatusResponseMessage["payload"];
export type EditorTargetDescriptor = ListAvailableEditorsPayload["editors"][number];

export class DaemonClient {
  private readonly connection: DaemonConnectionController;
  private readonly inbound: DaemonClientInboundController;

  private readonly requests: DaemonRequestCoordinator;
  private readonly checkoutCommands: CheckoutCommandClient;
  private readonly checkoutSubscriptions: CheckoutSubscriptionClient;
  private readonly configCommands: ConfigCommandClient;
  private readonly providerCommands: ProviderCommandClient;
  private readonly agentExtensionCommands: AgentExtensionCommandClient;
  private readonly automationCommands: AutomationCommandClient;
  private readonly cindyCommands: CindyCommandClient;
  private readonly workspaceCommands: WorkspaceCommandClient;
  private readonly queryCommands: QueryCommandClient;
  private readonly terminalClient: TerminalClient;
  private readonly voiceClient: VoiceClient;
  private readonly agentLifecycle: AgentLifecycleClient;
  private readonly agentInteraction: AgentInteractionClient;
  private readonly agentWaits: AgentWaitClient;
  private readonly binaryFileTransfers = new BinaryFileTransferManager();
  private logger: Logger;
  private runtimeMetricsInterval: ReturnType<typeof setInterval> | null = null;
  private runtimeMetrics: DaemonClientRuntimeMetrics | null = null;

  constructor(config: DaemonClientConfig) {
    this.logger = config.logger ?? consoleLogger;
    this.connection = new DaemonConnectionController(config, this.logger, {
      onMessage: (data) => this.inbound.handle(data),
      onConnected: () => {
        this.checkoutSubscriptions.resubscribe();
        this.terminalClient.resubscribeDirectories();
        void this.terminalClient.resubscribeStreams();
        this.requests.flushPendingSends();
      },
      onReset: (error, terminal) => this.handleConnectionReset(error, terminal),
    });
    this.requests = new DaemonRequestCoordinator({
      createRequestId: (requestId) => this.createRequestId(requestId),
      getConnectionStatus: () => this.connection.getState().status,
      sendConnectedMessage: (message) => this.connection.sendSessionMessageStrict(message),
    });
    this.checkoutCommands = new CheckoutCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.checkoutSubscriptions = new CheckoutSubscriptionClient({
      createRequestId: (requestId) => this.createRequestId(requestId),
      sendRequest: (params) => this.requests.request(params),
      sendMessage: (message) => this.connection.sendSessionMessage(message),
    });
    this.configCommands = new ConfigCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.providerCommands = new ProviderCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.agentExtensionCommands = new AgentExtensionCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.automationCommands = new AutomationCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.cindyCommands = new CindyCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.workspaceCommands = new WorkspaceCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.queryCommands = new QueryCommandClient({
      request: (params) => this.requests.requestSession(params),
    });
    this.terminalClient = new TerminalClient({
      request: (params) => this.requests.requestSession(params),
      isConnected: () => this.connection.isConnected,
      sendMessage: (message) => this.connection.sendSessionMessage(message),
      sendBinaryFrame: (frame) => this.connection.sendBinaryFrame(frame),
    });
    this.voiceClient = new VoiceClient({
      request: (params) => this.requests.requestSession(params),
      sendMessage: (message) => this.connection.sendSessionMessage(message),
      sendStrictMessage: (message) => this.connection.sendSessionMessageStrict(message),
      waitFor: (predicate, timeout) =>
        this.requests.waitForWithCancel(predicate, timeout, { skipQueue: true }),
    });
    this.agentLifecycle = new AgentLifecycleClient({
      request: (params) => this.requests.requestSession(params),
      createRequestId: (requestId) => this.createRequestId(requestId),
      requestStatus: (params) => this.requests.request({ ...params, options: { skipQueue: true } }),
    });
    this.agentInteraction = new AgentInteractionClient({
      request: (params) => this.requests.requestSession(params),
      createRequestId: (requestId) => this.createRequestId(requestId),
      supportsGenerativeUi: () => this.inbound.supportsGenerativeUi(),
    });
    this.inbound = new DaemonClientInboundController({
      fileTransfers: this.binaryFileTransfers,
      getRuntimeMetrics: () => this.runtimeMetrics,
      isConnecting: () => this.connection.isConnecting,
      logger: this.logger,
      markConnected: () => this.connection.markConnected(),
      onInboundActivity: () => this.connection.recordInboundActivity(),
      onRequestMessage: (message) => this.requests.handleMessage(message),
      onTerminalFrame: (frame) => this.terminalClient.handleFrame(frame),
      onTerminalStreamExit: (terminalId) => this.terminalClient.handleStreamExit(terminalId),
      resolvePong: () => this.connection.resolvePong(),
    });
    this.agentWaits = new AgentWaitClient({
      createRequestId: (requestId) => this.createRequestId(requestId),
      fetchAgent: (agentId) => this.agentLifecycle.fetchAgent(agentId),
      requests: this.requests,
      sendMessage: (message) => this.connection.sendSessionMessage(message),
      subscribeAgentUpdates: (handler) => this.inbound.subscribeMessage("agent_update", handler),
    });
    const runtimeMetricsIntervalMs =
      typeof config.runtimeMetricsIntervalMs === "number" && config.runtimeMetricsIntervalMs > 0
        ? config.runtimeMetricsIntervalMs
        : 0;
    if (runtimeMetricsIntervalMs > 0) {
      const runtimeMetricsWindowMs =
        typeof config.runtimeMetricsWindowMs === "number" && config.runtimeMetricsWindowMs > 0
          ? Math.max(config.runtimeMetricsWindowMs, runtimeMetricsIntervalMs)
          : undefined;
      this.runtimeMetrics = new DaemonClientRuntimeMetrics(
        this.logger,
        {
          connectionPath: this.connection.connectionPath,
          serverId: this.connection.serverId,
          getConnectionStatus: () => this.connection.getState().status,
        },
        runtimeMetricsWindowMs ? { windowMs: runtimeMetricsWindowMs } : undefined,
      );
      this.runtimeMetricsInterval = setInterval(() => {
        this.runtimeMetrics?.flush();
      }, runtimeMetricsIntervalMs);
    }
  }

  // ============================================================================
  // Connection
  // ============================================================================

  async connect(): Promise<void> {
    return this.connection.connect();
  }

  async close(): Promise<void> {
    return this.connection.close();
  }

  ensureConnected(): void {
    this.connection.ensureConnected();
  }

  getConnectionState(): ConnectionState {
    return this.connection.getState();
  }

  subscribeConnectionStatus(listener: (status: ConnectionState) => void): () => void {
    return this.connection.subscribe(listener);
  }

  getTransportMode(): TransportMode | null {
    return this.connection.getTransportMode();
  }

  subscribeTransportMode(listener: (mode: TransportMode) => void): () => void {
    return this.connection.subscribeTransportMode(listener);
  }

  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  get isConnecting(): boolean {
    return this.connection.isConnecting;
  }

  get lastError(): string | null {
    return this.connection.lastError;
  }

  // ============================================================================
  // Message Subscription
  // ============================================================================

  subscribe(handler: DaemonEventHandler): () => void {
    return this.inbound.subscribe(handler);
  }

  subscribeRawMessages(handler: (message: SessionOutboundMessage) => void): () => void {
    return this.inbound.subscribeRaw(handler);
  }

  on<TType extends SessionOutboundMessage["type"]>(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void;
  on(handler: DaemonEventHandler): () => void;
  on(
    arg1: SessionOutboundMessage["type"] | DaemonEventHandler,
    arg2?: (message: SessionOutboundMessage) => void,
  ): () => void {
    if (typeof arg1 === "function") {
      return this.subscribe(arg1);
    }
    return this.inbound.subscribeMessage(arg1, arg2!);
  }
  // ============================================================================
  // Core Send Helpers
  // ============================================================================

  private sendSessionMessage(message: SessionInboundMessage): void {
    this.connection.sendSessionMessage(message);
  }

  async clearAgentAttention(agentId: string | string[]): Promise<void> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "clear_agent_attention",
      agentId,
      requestId,
    });
    await this.requests.request({
      requestId,
      message,
      timeout: 15000,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "clear_agent_attention_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  sendHeartbeat(params: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: string;
    appVisible: boolean;
    appVisibilityChangedAt?: string;
  }): void {
    this.sendSessionMessage({
      type: "client_heartbeat",
      deviceType: params.deviceType,
      focusedAgentId: params.focusedAgentId,
      lastActivityAt: params.lastActivityAt,
      appVisible: params.appVisible,
      appVisibilityChangedAt: params.appVisibilityChangedAt,
    });
  }

  registerPushToken(token: string): void {
    this.sendSessionMessage({
      type: "register_push_token",
      token,
    });
  }

  async ping(params?: { requestId?: string; timeoutMs?: number }): Promise<{
    requestId: string;
    clientSentAt: number;
    serverReceivedAt: number;
    serverSentAt: number;
    rttMs: number;
  }> {
    const requestId =
      params?.requestId ?? `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clientSentAt = Date.now();

    const payload = await this.requests.request({
      requestId,
      message: { type: "ping", requestId, clientSentAt },
      timeout: params?.timeoutMs ?? 5000,
      select: (msg) => {
        if (msg.type !== "pong") return null;
        if (msg.payload.requestId !== requestId) return null;
        if (typeof msg.payload.serverReceivedAt !== "number") return null;
        if (typeof msg.payload.serverSentAt !== "number") return null;
        return msg.payload;
      },
    });

    return {
      requestId,
      clientSentAt,
      serverReceivedAt: payload.serverReceivedAt,
      serverSentAt: payload.serverSentAt,
      rttMs: Date.now() - clientSentAt,
    };
  }

  checkLiveness(params?: { timeoutMs?: number }): Promise<{ rttMs: number }> {
    return this.connection.checkLiveness(params);
  }

  // ============================================================================
  // Agent RPCs (requestId-correlated)
  // ============================================================================

  async fetchAgents(options?: FetchAgentsOptions): Promise<FetchAgentsPayload> {
    return this.queryCommands.fetchAgents(options);
  }

  async fetchAgentHistory(options?: FetchAgentHistoryOptions): Promise<FetchAgentHistoryPayload> {
    return this.queryCommands.fetchAgentHistory(options);
  }

  async fetchRecentProviderSessions(
    options?: FetchRecentProviderSessionsOptions,
  ): Promise<FetchRecentProviderSessionsPayload> {
    return this.queryCommands.fetchRecentProviderSessions(options);
  }

  async fetchUsageSummary(options?: FetchUsageSummaryOptions): Promise<UsageSummaryPayload> {
    return this.queryCommands.fetchUsageSummary(options);
  }

  async exportUsage(options?: ExportUsageOptions): Promise<UsageExportPayload> {
    return this.queryCommands.exportUsage(options);
  }

  async clearUsage(requestId?: string): Promise<UsageClearPayload> {
    return this.queryCommands.clearUsage(requestId);
  }

  async fetchWorkspaces(options?: FetchWorkspacesOptions): Promise<FetchWorkspacesPayload> {
    return this.queryCommands.fetchWorkspaces(options);
  }
  async openProject(cwd: string, requestId?: string): Promise<OpenProjectPayload> {
    return this.workspaceCommands.openProject(cwd, requestId);
  }

  async startWorkspaceScript(
    workspaceId: string,
    scriptName: string,
    requestId?: string,
  ): Promise<
    Extract<SessionOutboundMessage, { type: "start_workspace_script_response" }>["payload"]
  > {
    return this.workspaceCommands.startWorkspaceScript(workspaceId, scriptName, requestId);
  }

  async listAvailableEditors(requestId?: string): Promise<ListAvailableEditorsPayload> {
    return this.workspaceCommands.listAvailableEditors(requestId);
  }

  async openInEditor(
    path: string,
    editorId: EditorTargetId,
    requestId?: string,
  ): Promise<OpenInEditorPayload> {
    return this.workspaceCommands.openInEditor(path, editorId, requestId);
  }

  async archiveWorkspace(
    workspaceId: string,
    requestId?: string,
  ): Promise<ArchiveWorkspacePayload> {
    return this.workspaceCommands.archiveWorkspace(workspaceId, requestId);
  }

  async fetchWorkspaceSetupStatus(
    workspaceId: string,
    requestId?: string,
  ): Promise<WorkspaceSetupStatusPayload> {
    return this.workspaceCommands.fetchWorkspaceSetupStatus(workspaceId, requestId);
  }

  async fetchAgent(agentId: string, requestId?: string): Promise<FetchAgentResult | null> {
    return this.agentLifecycle.fetchAgent(agentId, requestId);
  }

  // ============================================================================
  // Agent Lifecycle
  // ============================================================================

  async createAgent(options: CreateAgentRequestOptions): Promise<CreateAgentResult> {
    return this.agentLifecycle.createAgent(options);
  }

  async deleteAgent(agentId: string): Promise<void> {
    return this.agentLifecycle.deleteAgent(agentId);
  }

  async archiveAgent(agentId: string): Promise<{ archivedAt: string }> {
    return this.agentLifecycle.archiveAgent(agentId);
  }

  async updateAgent(
    agentId: string,
    updates: {
      name?: string;
      labels?: Record<string, string>;
      regenerateTitle?: boolean;
    },
  ): Promise<void> {
    return this.agentLifecycle.updateAgent(agentId, updates);
  }

  async renameProject(
    projectId: string,
    customName: string | null,
    requestId?: string,
  ): Promise<{ customName: string | null }> {
    return this.agentLifecycle.renameProject(projectId, customName, requestId);
  }

  async resumeAgent(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSnapshotPayload> {
    return this.agentLifecycle.resumeAgent(handle, overrides);
  }

  async importAgent(input: ImportAgentInput): Promise<AgentSnapshotPayload> {
    return this.agentLifecycle.importAgent(input);
  }

  async refreshAgent(agentId: string, requestId?: string): Promise<AgentRefreshedStatusPayload> {
    return this.agentLifecycle.refreshAgent(agentId, requestId);
  }

  async fetchAgentTimeline(
    agentId: string,
    options: FetchAgentTimelineOptions = {},
  ): Promise<FetchAgentTimelinePayload> {
    return this.agentInteraction.fetchAgentTimeline(agentId, options);
  }

  // ============================================================================
  // Agent Interaction
  // ============================================================================

  async sendAgentMessage(
    agentId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<{ pendingRun?: boolean }> {
    return this.agentInteraction.sendAgentMessage(agentId, text, options);
  }

  async sendMessage(
    agentId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<{ pendingRun?: boolean }> {
    return this.sendAgentMessage(agentId, text, options);
  }

  /**
   * Sends a generative UI user-interaction callback to the server.
   * The server formats the action as system context and injects it into the
   * next turn's conversation.
   *
   * @param agentId Target agent session ID
   * @param instanceId Generative UI component instance ID
   * @param action Action name as defined in the component's actions
   * @param payload Action-specific payload
   * @param options Optional configuration (timeout etc.)
   * @throws {DaemonRpcError} If the server rejects the action or times out
   */
  async sendGenerativeUiAction(
    agentId: string,
    instanceId: string,
    action: string,
    payload: unknown,
    options?: { timeout?: number },
  ): Promise<void> {
    return this.agentInteraction.sendGenerativeUiAction(
      agentId,
      instanceId,
      action,
      payload,
      options,
    );
  }

  async rewindAgent(
    agentId: string,
    messageId: string,
    mode: "conversation" | "files" | "both",
  ): Promise<AgentRewindResponseMessage["payload"]> {
    return this.agentLifecycle.rewindAgent(agentId, messageId, mode);
  }

  async cancelAgent(agentId: string): Promise<void> {
    return this.agentLifecycle.cancelAgent(agentId);
  }

  async setAgentMode(agentId: string, modeId: string): Promise<void> {
    return this.agentLifecycle.setAgentMode(agentId, modeId);
  }

  async setAgentModel(
    agentId: string,
    modelId: string | null,
    runtimeProvider?: string | null,
  ): Promise<void> {
    return this.agentLifecycle.setAgentModel(agentId, modelId, runtimeProvider);
  }

  async setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void> {
    return this.agentLifecycle.setAgentFeature(agentId, featureId, value);
  }

  async setAgentThinkingOption(agentId: string, thinkingOptionId: string | null): Promise<void> {
    return this.agentLifecycle.setAgentThinkingOption(agentId, thinkingOptionId);
  }

  async restartServer(reason?: string, requestId?: string): Promise<RestartRequestedStatusPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "restart_server_request",
      ...(reason && reason.trim().length > 0 ? { reason } : {}),
      requestId: resolvedRequestId,
    });
    return this.requests.request({
      requestId: resolvedRequestId,
      message,
      timeout: 10000,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const restarted = RestartRequestedStatusPayloadSchema.safeParse(msg.payload);
        if (!restarted.success) {
          return null;
        }
        if (restarted.data.requestId !== resolvedRequestId) {
          return null;
        }
        return restarted.data;
      },
    });
  }

  async shutdownServer(requestId?: string): Promise<ShutdownRequestedStatusPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "shutdown_server_request",
      requestId: resolvedRequestId,
    });
    return this.requests.request({
      requestId: resolvedRequestId,
      message,
      timeout: 10000,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const shutdown = ShutdownRequestedStatusPayloadSchema.safeParse(msg.payload);
        if (!shutdown.success) {
          return null;
        }
        if (shutdown.data.requestId !== resolvedRequestId) {
          return null;
        }
        return shutdown.data;
      },
    });
  }

  // ============================================================================
  // Audio / Voice
  // ============================================================================

  async setVoiceMode(enabled: boolean, agentId?: string): Promise<SetVoiceModePayload> {
    return this.voiceClient.setVoiceMode(enabled, agentId);
  }

  async sendVoiceAudioChunk(audio: string, format: string, isLast = false): Promise<void> {
    return this.voiceClient.sendVoiceAudioChunk(audio, format, isLast);
  }

  async startDictationStream(dictationId: string, format: string): Promise<void> {
    return this.voiceClient.startDictationStream(dictationId, format);
  }

  sendDictationStreamChunk(dictationId: string, seq: number, audio: string, format: string): void {
    this.voiceClient.sendDictationStreamChunk(dictationId, seq, audio, format);
  }

  async finishDictationStream(
    dictationId: string,
    finalSeq: number,
  ): Promise<{ dictationId: string; text: string }> {
    return this.voiceClient.finishDictationStream(dictationId, finalSeq);
  }

  cancelDictationStream(dictationId: string): void {
    this.voiceClient.cancelDictationStream(dictationId);
  }

  async abortRequest(): Promise<void> {
    return this.voiceClient.abortRequest();
  }

  async audioPlayed(id: string): Promise<void> {
    return this.voiceClient.audioPlayed(id);
  }

  // ============================================================================
  // Git Operations
  // ============================================================================

  async getCheckoutStatus(
    cwd: string,
    options?: { requestId?: string },
  ): Promise<CheckoutStatusPayload> {
    return this.checkoutSubscriptions.getStatus(cwd, options);
  }

  async getCheckoutDiff(
    cwd: string,
    compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean },
    requestId?: string,
  ): Promise<CheckoutDiffPayload> {
    return this.checkoutSubscriptions.getDiff(cwd, compare, requestId);
  }

  async subscribeCheckoutDiff(
    cwd: string,
    compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean },
    options?: { subscriptionId?: string; requestId?: string },
  ): Promise<SubscribeCheckoutDiffPayload> {
    return this.checkoutSubscriptions.subscribe(cwd, compare, options);
  }

  unsubscribeCheckoutDiff(subscriptionId: string): void {
    this.checkoutSubscriptions.unsubscribe(subscriptionId);
  }

  async checkoutCommit(
    cwd: string,
    input: { message?: string; addAll?: boolean },
    requestId?: string,
  ): Promise<CheckoutCommitPayload> {
    return this.checkoutCommands.checkoutCommit(cwd, input, requestId);
  }

  async checkoutMerge(
    cwd: string,
    input: { baseRef?: string; strategy?: "merge" | "squash"; requireCleanTarget?: boolean },
    requestId?: string,
  ): Promise<CheckoutMergePayload> {
    return this.checkoutCommands.checkoutMerge(cwd, input, requestId);
  }

  async checkoutMergeFromBase(
    cwd: string,
    input: { baseRef?: string; requireCleanTarget?: boolean },
    requestId?: string,
  ): Promise<CheckoutMergeFromBasePayload> {
    return this.checkoutCommands.checkoutMergeFromBase(cwd, input, requestId);
  }

  async checkoutPull(cwd: string, requestId?: string): Promise<CheckoutPullPayload> {
    return this.checkoutCommands.checkoutPull(cwd, requestId);
  }

  async checkoutPush(cwd: string, requestId?: string): Promise<CheckoutPushPayload> {
    return this.checkoutCommands.checkoutPush(cwd, requestId);
  }

  async checkoutRefresh(cwd: string, requestId?: string): Promise<CheckoutRefreshPayload> {
    return this.checkoutCommands.checkoutRefresh(cwd, requestId);
  }

  async checkoutPrCreate(
    cwd: string,
    input: { title?: string; body?: string; baseRef?: string },
    requestId?: string,
  ): Promise<CheckoutPrCreatePayload> {
    return this.checkoutCommands.checkoutPrCreate(cwd, input, requestId);
  }

  async checkoutPrMerge(
    cwd: string,
    input: { method: CheckoutPrMergeMethod },
    requestId?: string,
  ): Promise<CheckoutPrMergePayload> {
    return this.checkoutCommands.checkoutPrMerge(cwd, input, requestId);
  }

  async checkoutGithubSetAutoMerge(
    cwd: string,
    input: { enabled: true; method: CheckoutPrMergeMethod } | { enabled: false },
    requestId?: string,
  ): Promise<CheckoutGithubSetAutoMergePayload> {
    return this.checkoutCommands.checkoutGithubSetAutoMerge(cwd, input, requestId);
  }

  async checkoutPrStatus(cwd: string, requestId?: string): Promise<CheckoutPrStatusPayload> {
    return this.checkoutCommands.checkoutPrStatus(cwd, requestId);
  }

  async pullRequestTimeline(
    input: { cwd: string; prNumber: number; repoOwner: string; repoName: string },
    requestId?: string,
  ): Promise<PullRequestTimelinePayload> {
    return this.checkoutCommands.pullRequestTimeline(input, requestId);
  }

  async checkoutSwitchBranch(
    cwd: string,
    branch: string,
    requestId?: string,
  ): Promise<CheckoutSwitchBranchPayload> {
    return this.checkoutCommands.checkoutSwitchBranch(cwd, branch, requestId);
  }

  async renameBranch(input: RenameBranchInput): Promise<RenameBranchResult> {
    return this.checkoutCommands.renameBranch(input);
  }

  async stashSave(
    cwd: string,
    options?: { branch?: string },
    requestId?: string,
  ): Promise<StashSavePayload> {
    return this.checkoutCommands.stashSave(cwd, options, requestId);
  }

  async stashPop(cwd: string, stashIndex: number, requestId?: string): Promise<StashPopPayload> {
    return this.checkoutCommands.stashPop(cwd, stashIndex, requestId);
  }

  async stashList(
    cwd: string,
    options?: { chisacodeOnly?: boolean },
    requestId?: string,
  ): Promise<StashListPayload> {
    return this.checkoutCommands.stashList(cwd, options, requestId);
  }

  async getChisaCodeWorktreeList(
    input: { cwd?: string; repoRoot?: string },
    requestId?: string,
  ): Promise<ChisaCodeWorktreeListPayload> {
    return this.checkoutCommands.getChisaCodeWorktreeList(input, requestId);
  }

  async archiveChisaCodeWorktree(
    input: { worktreePath?: string; repoRoot?: string; branchName?: string },
    requestId?: string,
  ): Promise<ChisaCodeWorktreeArchivePayload> {
    return this.checkoutCommands.archiveChisaCodeWorktree(input, requestId);
  }

  async createChisaCodeWorktree(
    input: CreateChisaCodeWorktreeInput,
    requestId?: string,
  ): Promise<CreateChisaCodeWorktreePayload> {
    return this.checkoutCommands.createChisaCodeWorktree(input, requestId);
  }

  async validateBranch(
    options: { cwd: string; branchName: string },
    requestId?: string,
  ): Promise<ValidateBranchPayload> {
    return this.checkoutCommands.validateBranch(options, requestId);
  }

  async getBranchSuggestions(
    options: { cwd: string; query?: string; limit?: number },
    requestId?: string,
  ): Promise<BranchSuggestionsPayload> {
    return this.checkoutCommands.getBranchSuggestions(options, requestId);
  }

  async searchGitHub(
    options: { cwd: string; query: string; limit?: number; kinds?: GitHubSearchRequest["kinds"] },
    requestId?: string,
  ): Promise<GitHubSearchPayload> {
    return this.checkoutCommands.searchGitHub(options, requestId);
  }

  async getDirectorySuggestions(
    options: {
      query: string;
      limit?: number;
      cwd?: string;
      includeFiles?: boolean;
      includeDirectories?: boolean;
      matchMode?: "fuzzy" | "suffix";
    },
    requestId?: string,
  ): Promise<DirectorySuggestionsPayload> {
    return this.checkoutCommands.getDirectorySuggestions(options, requestId);
  }
  // ============================================================================
  // File Explorer
  // ============================================================================

  private async requestFileExplorer(
    cwd: string,
    path: string,
    mode: "list" | "file",
    requestId?: string,
    acceptBinary = false,
  ): Promise<FileExplorerPayload> {
    // Metadata list/file JSON stays on the short RPC timeout. Binary transfers
    // only need the request waiter open for begin/progress/end; use a generous
    // upper bound so slow-but-progressing 64MB reads are not killed at 10s.
    // Restart/shutdown keep their own 10s timeouts elsewhere.
    const timeout = acceptBinary ? 15 * 60_000 : 10_000;
    return this.requests.requestSession({
      requestId,
      message: {
        type: "file_explorer_request",
        cwd,
        path,
        mode,
        ...(acceptBinary ? { acceptBinary: true } : {}),
      },
      responseType: "file_explorer_response",
      timeout,
    });
  }

  async listDirectory(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<FileExplorerDirectoryPayload> {
    return this.workspaceCommands.listDirectory(cwd, path, requestId);
  }

  async readFile(cwd: string, path: string, requestId?: string): Promise<FileReadResult> {
    const resolvedRequestId = this.createRequestId(requestId);
    this.binaryFileTransfers.startRead(resolvedRequestId, cwd, path);
    try {
      const payload = await this.requestFileExplorer(cwd, path, "file", resolvedRequestId, true);
      if (payload.error) {
        throw new Error(payload.error);
      }
      const binaryResult = this.binaryFileTransfers.takeCompletedRead(resolvedRequestId);
      if (binaryResult) {
        return binaryResult;
      }
      if (!payload.file) {
        throw new Error("File unavailable.");
      }
      return legacyExplorerFileToBytes(payload.file);
    } finally {
      this.binaryFileTransfers.cleanupRead(resolvedRequestId);
    }
  }

  async requestDownloadToken(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<FileDownloadTokenPayload> {
    return this.workspaceCommands.requestDownloadToken(cwd, path, requestId);
  }

  async requestProjectIcon(
    cwd: string,
    requestId?: string,
  ): Promise<ProjectIconResponse["payload"]> {
    return this.workspaceCommands.requestProjectIcon(cwd, requestId);
  }

  // ============================================================================
  // Provider Models / Commands
  // ============================================================================

  async listProviderModels(
    provider: AgentProvider,
    options?: { cwd?: string; requestId?: string },
  ): Promise<ListProviderModelsPayload> {
    return this.providerCommands.listProviderModels(provider, options);
  }

  async listProviderModes(
    provider: AgentProvider,
    options?: { cwd?: string; requestId?: string },
  ): Promise<ListProviderModesPayload> {
    return this.providerCommands.listProviderModes(provider, options);
  }

  async listProviderFeatures(
    draftConfig: ListCommandsDraftConfig,
    options?: { requestId?: string },
  ): Promise<ListProviderFeaturesPayload> {
    return this.providerCommands.listProviderFeatures(draftConfig, options);
  }

  async listAvailableProviders(options?: {
    requestId?: string;
  }): Promise<ListAvailableProvidersPayload> {
    return this.providerCommands.listAvailableProviders(options);
  }

  async getProvidersSnapshot(options?: {
    cwd?: string;
    requestId?: string;
  }): Promise<GetProvidersSnapshotPayload> {
    return this.providerCommands.getProvidersSnapshot(options);
  }

  async getDaemonConfig(
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }> {
    return this.configCommands.getDaemonConfig(requestId);
  }

  async getDaemonStatus(requestId?: string): Promise<DaemonStatusPayload> {
    return this.configCommands.getDaemonStatus(requestId);
  }

  async getDaemonPairingOffer(requestId?: string): Promise<DaemonPairingOfferPayload> {
    return this.configCommands.getDaemonPairingOffer(requestId);
  }

  async patchDaemonConfig(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }> {
    return this.configCommands.patchDaemonConfig(config, requestId);
  }

  async readProjectConfig(repoRoot: string, requestId?: string): Promise<ReadProjectConfigPayload> {
    return this.configCommands.readProjectConfig(repoRoot, requestId);
  }

  async writeProjectConfig(input: WriteProjectConfigInput): Promise<WriteProjectConfigPayload> {
    return this.configCommands.writeProjectConfig(input);
  }

  async refreshProvidersSnapshot(options?: {
    cwd?: string;
    providers?: AgentProvider[];
    requestId?: string;
  }): Promise<RefreshProvidersSnapshotPayload> {
    return this.providerCommands.refreshProvidersSnapshot(options);
  }

  async getProviderDiagnostic(
    provider: AgentProvider,
    options?: { requestId?: string },
  ): Promise<ProviderDiagnosticPayload> {
    return this.providerCommands.getProviderDiagnostic(provider, options);
  }

  /** Generates a bounded, redacted daemon troubleshooting report. */
  async getDiagnostics(options?: {
    includeLogs?: boolean;
    maxLogLines?: number;
    requestId?: string;
  }): Promise<DiagnosticsPayload> {
    return this.providerCommands.getDiagnostics(options);
  }

  async runProviderToolingAction(
    provider: AgentProvider,
    action: "install" | "update" | "reinstall",
    options?: { requestId?: string },
  ): Promise<ProviderToolingActionPayload> {
    return this.providerCommands.runProviderToolingAction(provider, action, options);
  }

  async listAgentPresets(options?: { requestId?: string }): Promise<AgentPresetsListPayload> {
    return this.providerCommands.listAgentPresets(options);
  }

  async runModelGatewayMoaTest(
    input: RunModelGatewayMoaTestInput,
  ): Promise<ModelGatewayMoaTestPayload> {
    return this.providerCommands.runModelGatewayMoaTest(input);
  }

  async runModelGatewayTest(input: RunModelGatewayTestInput): Promise<ModelGatewayTestPayload> {
    return this.providerCommands.runModelGatewayTest(input);
  }

  async listCommands(agentId: string, requestId?: string): Promise<ListCommandsPayload>;
  async listCommands(agentId: string, options?: ListCommandsOptions): Promise<ListCommandsPayload>;
  async listCommands(
    agentId: string,
    requestIdOrOptions?: string | ListCommandsOptions,
  ): Promise<ListCommandsPayload> {
    return this.agentExtensionCommands.listCommands(agentId, requestIdOrOptions);
  }

  async listAgentSkills(options?: { requestId?: string }): Promise<AgentSkillsListPayload> {
    return this.agentExtensionCommands.listAgentSkills(options);
  }

  async patchAgentSkillPolicy(input: {
    requestId?: string;
    scope: AgentSkillManagementScope;
    policy: {
      enabledSkillNames?: string[];
      disabledSkillNames?: string[];
    };
  }): Promise<AgentSkillsPolicyPatchPayload> {
    return this.agentExtensionCommands.patchAgentSkillPolicy(input);
  }

  async installAgentSkills(input: {
    requestId?: string;
    source: AgentSkillsInstallSource;
    replace?: boolean;
  }): Promise<AgentSkillsInstallPayload> {
    return this.agentExtensionCommands.installAgentSkills(input);
  }

  async uninstallAgentSkill(input: {
    requestId?: string;
    sourceId: string;
  }): Promise<AgentSkillsUninstallPayload> {
    return this.agentExtensionCommands.uninstallAgentSkill(input);
  }

  async listAgentMcpServers(options?: { requestId?: string }): Promise<AgentMcpServersListPayload> {
    return this.agentExtensionCommands.listAgentMcpServers(options);
  }

  async upsertAgentMcpServer(input: {
    requestId?: string;
    server: ManagedMcpServerConfig;
    originalName?: string;
  }): Promise<AgentMcpServersUpsertPayload> {
    return this.agentExtensionCommands.upsertAgentMcpServer(input);
  }

  async patchAgentMcpServerPolicy(input: {
    requestId?: string;
    scope: AgentMcpServerManagementScope;
    policy: {
      enabledServerNames?: string[];
      disabledServerNames?: string[];
    };
  }): Promise<AgentMcpServersPolicyPatchPayload> {
    return this.agentExtensionCommands.patchAgentMcpServerPolicy(input);
  }

  async deleteAgentMcpServer(input: {
    requestId?: string;
    name: string;
  }): Promise<AgentMcpServersDeletePayload> {
    return this.agentExtensionCommands.deleteAgentMcpServer(input);
  }

  // ============================================================================
  // Permissions
  // ============================================================================

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    return this.agentWaits.respondToPermission(agentId, requestId, response);
  }

  async respondToPermissionAndWait(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
    timeout = 15_000,
  ): Promise<AgentPermissionResolvedPayload> {
    return this.agentWaits.respondToPermissionAndWait(agentId, requestId, response, timeout);
  }

  // ============================================================================
  // Waiting / Streaming Helpers
  // ============================================================================

  async waitForAgentUpsert(
    agentId: string,
    predicate: (snapshot: AgentSnapshotPayload) => boolean,
    timeout = 60_000,
  ): Promise<AgentSnapshotPayload> {
    return this.agentWaits.waitForAgentUpsert(agentId, predicate, timeout);
  }

  async waitForFinish(agentId: string, timeout = 60_000): Promise<WaitForFinishResult> {
    return this.agentWaits.waitForFinish(agentId, timeout);
  }

  // ============================================================================
  // Terminals
  // ============================================================================

  subscribeTerminals(input: { cwd: string }): void {
    this.terminalClient.subscribeDirectories(input);
  }

  unsubscribeTerminals(input: { cwd: string }): void {
    this.terminalClient.unsubscribeDirectories(input);
  }

  async listTerminals(cwd?: string, requestId?: string): Promise<ListTerminalsPayload> {
    return this.terminalClient.listTerminals(cwd, requestId);
  }

  async createTerminal(
    cwd: string,
    name?: string,
    requestId?: string,
    options?: { agentId?: string; command?: string; args?: string[] },
  ): Promise<CreateTerminalPayload> {
    return this.terminalClient.createTerminal(cwd, name, requestId, options);
  }

  async renameTerminal(input: RenameTerminalInput): Promise<RenameTerminalResult> {
    return this.terminalClient.renameTerminal(input);
  }

  async subscribeTerminal(
    terminalId: string,
    optionsOrRequestId?:
      | { restore?: SubscribeTerminalRequest["restore"]; requestId?: string }
      | string,
  ): Promise<SubscribeTerminalPayload> {
    return this.terminalClient.subscribeTerminal(terminalId, optionsOrRequestId);
  }

  unsubscribeTerminal(terminalId: string): void {
    this.terminalClient.unsubscribeTerminal(terminalId);
  }

  sendTerminalInput(terminalId: string, message: TerminalInput["message"]): void {
    this.terminalClient.sendInput(terminalId, message);
  }

  async killTerminal(terminalId: string, requestId?: string): Promise<KillTerminalPayload> {
    return this.terminalClient.killTerminal(terminalId, requestId);
  }

  async closeItems(
    input: { agentIds?: string[]; terminalIds?: string[] },
    requestId?: string,
  ): Promise<CloseItemsPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "close_items_request",
      agentIds: input.agentIds ?? [],
      terminalIds: input.terminalIds ?? [],
      requestId: resolvedRequestId,
    });
    // Bulk archive can take well over 10s for multi-agent batches (each
    // archive_agent_request alone often runs 5–12s under load). Give the
    // batched close_items path enough headroom so the UI does not time out
    // and roll back optimistic removals.
    return this.requests.requestCorrelated({
      requestId: resolvedRequestId,
      message,
      responseType: "close_items_response",
      timeout: 60_000,
      options: { skipQueue: true },
    });
  }

  async captureTerminal(
    terminalId: string,
    options?: { start?: number; end?: number; stripAnsi?: boolean },
    requestId?: string,
  ): Promise<CaptureTerminalPayload> {
    return this.terminalClient.captureTerminal(terminalId, options, requestId);
  }

  async createChatRoom(options: CreateChatRoomOptions): Promise<ChatCreatePayload> {
    return this.automationCommands.createChatRoom(options);
  }

  async listChatRooms(requestId?: string): Promise<ChatListPayload> {
    return this.automationCommands.listChatRooms(requestId);
  }

  async inspectChatRoom(options: InspectChatRoomOptions): Promise<ChatInspectPayload> {
    return this.automationCommands.inspectChatRoom(options);
  }

  async deleteChatRoom(options: DeleteChatRoomOptions): Promise<ChatDeletePayload> {
    return this.automationCommands.deleteChatRoom(options);
  }

  async postChatMessage(options: PostChatMessageOptions): Promise<ChatPostPayload> {
    return this.automationCommands.postChatMessage(options);
  }

  async readChatMessages(options: ReadChatMessagesOptions): Promise<ChatReadPayload> {
    return this.automationCommands.readChatMessages(options);
  }

  async waitForChatMessages(options: WaitForChatMessagesOptions): Promise<ChatWaitPayload> {
    return this.automationCommands.waitForChatMessages(options);
  }

  async scheduleCreate(options: CreateScheduleOptions): Promise<ScheduleCreatePayload> {
    return this.automationCommands.scheduleCreate(options);
  }

  async scheduleList(requestId?: string): Promise<ScheduleListPayload> {
    return this.automationCommands.scheduleList(requestId);
  }

  async scheduleInspect(options: InspectScheduleOptions): Promise<ScheduleInspectPayload> {
    return this.automationCommands.scheduleInspect(options);
  }

  async scheduleLogs(options: InspectScheduleOptions): Promise<ScheduleLogsPayload> {
    return this.automationCommands.scheduleLogs(options);
  }

  async schedulePause(options: InspectScheduleOptions): Promise<SchedulePausePayload> {
    return this.automationCommands.schedulePause(options);
  }

  async scheduleResume(options: InspectScheduleOptions): Promise<ScheduleResumePayload> {
    return this.automationCommands.scheduleResume(options);
  }

  async scheduleDelete(options: InspectScheduleOptions): Promise<ScheduleDeletePayload> {
    return this.automationCommands.scheduleDelete(options);
  }

  async scheduleRunOnce(options: InspectScheduleOptions): Promise<ScheduleRunOncePayload> {
    return this.automationCommands.scheduleRunOnce(options);
  }

  async scheduleUpdate(options: UpdateScheduleOptions): Promise<ScheduleUpdatePayload> {
    return this.automationCommands.scheduleUpdate(options);
  }

  async loopRun(options: RunLoopOptions): Promise<LoopRunPayload> {
    return this.automationCommands.loopRun(options);
  }

  async loopList(requestId?: string): Promise<LoopListPayload> {
    return this.automationCommands.loopList(requestId);
  }

  async loopInspect(options: string | InspectLoopOptions): Promise<LoopInspectPayload> {
    return this.automationCommands.loopInspect(options);
  }

  async loopLogs(options: string | LoopLogsOptions, afterSeq?: number): Promise<LoopLogsPayload> {
    return this.automationCommands.loopLogs(options, afterSeq);
  }

  async loopStop(options: string | StopLoopOptions): Promise<LoopStopPayload> {
    return this.automationCommands.loopStop(options);
  }

  /** Cindy-module commands: goal, team, context, snapshot, migration, learn. */
  get cindy(): CindyCommandClient {
    return this.cindyCommands;
  }

  onTerminalStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    return this.terminalClient.onStreamEvent(handler);
  }

  async waitForTerminalStreamEvent(
    predicate: (event: TerminalStreamEvent) => boolean,
    timeout = 5000,
  ): Promise<TerminalStreamEvent> {
    return this.terminalClient.waitForStreamEvent(predicate, timeout);
  }

  // ============================================================================
  // Internals
  // ============================================================================

  private createRequestId(requestId?: string): string {
    // safeRandomId: `crypto.randomUUID` does not exist on insecure origins
    // (http://<lan-ip> pairing pages) — only localhost/https get it.
    return requestId ?? safeRandomId();
  }

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return this.inbound.getLastServerInfoMessage();
  }

  setReconnectEnabled(enabled: boolean): void {
    this.connection.setReconnectEnabled(enabled);
  }

  async hostRpc(
    method: string,
    payload?: unknown,
    requestId?: string,
  ): Promise<{ ok: boolean; value?: unknown; error?: unknown }> {
    const resolved = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "dshd.host.rpc.request",
      requestId: resolved,
      method,
      payload,
    });
    return this.requests.request({
      requestId: resolved,
      message,
      timeout: 30_000,
      select: (msg) => {
        if (msg.type !== "dshd.host.rpc.response") return null;
        if (msg.payload.requestId !== resolved) return null;
        return msg.payload;
      },
    });
  }

  async gitRpc(
    action: string,
    cwd: string,
    payload?: unknown,
    requestId?: string,
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const resolved = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "dshd.git.rpc.request",
      requestId: resolved,
      action,
      cwd,
      payload,
    });
    return this.requests.request({
      requestId: resolved,
      message,
      timeout: 120_000,
      select: (msg) => {
        if (msg.type !== "dshd.git.rpc.response") return null;
        if (msg.payload.requestId !== resolved) return null;
        return msg.payload;
      },
    });
  }

  subscribeHostMux(
    onFrame: (frame: { rpcId: string; envelope: unknown }) => void,
  ): () => void {
    const requestId = this.createRequestId();
    this.sendSessionMessage(
      SessionInboundMessageSchema.parse({
        type: "dshd.host.mux.subscribe",
        requestId,
      }),
    );
    const stop = this.on("dshd.host.mux.frame", (message) => {
      onFrame({
        rpcId: message.payload.rpcId,
        envelope: message.payload.envelope ?? null,
      });
    });
    return () => {
      stop();
      this.sendSessionMessage(
        SessionInboundMessageSchema.parse({
          type: "dshd.host.mux.unsubscribe",
          requestId: this.createRequestId(),
        }),
      );
    };
  }

  private handleConnectionReset(error: Error, terminal: boolean): void {
    this.requests.clear(error);
    this.terminalClient.clearStreamSlots();
    this.binaryFileTransfers.clearActiveTransfers();
    this.inbound.reset();
    if (!terminal || !this.runtimeMetricsInterval) return;
    clearInterval(this.runtimeMetricsInterval);
    this.runtimeMetricsInterval = null;
    this.runtimeMetrics?.flush({ final: true });
    this.runtimeMetrics = null;
  }
}
