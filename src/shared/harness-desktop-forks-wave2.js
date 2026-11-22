'use strict';

/**
 * Wave 2 upstream fork markers kept separate from harness-desktop-forks.js
 * and harness-desktop-forks-wave1.js to keep every guard file concise.
 */
const WAVE2_FORK_FILE_MARKERS = [
  // Client streaming event buffer, single-frame rAF coalescing, and delta batching.
  { file: 'packages/api/session-controller/src/client/contract/events.ts', includes: ['APPEND_SEGMENT_SIZE = 256', 'interface EventWindowBuffer'] },
  { file: 'packages/client/ui-chat/src/client/conversation-nodes/assistant.ts', includes: ['interface PendingDelta', 'materializePending'] },
  { file: 'packages/client/ui-conversation/src/client/conversation/assembly.ts', includes: ['Coalesce burst stream updates to publish on the next animation frame.'] },
  // Provider headers, pi-ai compat switches, and non-blocking connection testing UI.
  { file: 'packages/client/ui-settings-models/src/client/CustomProviderCard.tsx', includes: ['filterCompatForProtocol', 'ConnectionTestControl'] },
  { file: 'packages/client/ui-settings-models/src/client/ProviderEditor.tsx', includes: ['ConnectionTestControl', 'HeadersEditor', 'CompatEditor'] },
  { file: 'packages/client/ui-settings-models/src/client/HeadersEditor.tsx', includes: ['validateHeaderRows', 'headersFromValue'] },
  { file: 'packages/client/ui-settings-models/src/client/CompatEditor.tsx', includes: ['filterCompatForProtocol', 'COMPAT_FIELDS'] },
  { file: 'packages/client/ui-settings-models/src/client/ConnectionTestControl.tsx', includes: ['ConnectionTestControl'] },
  { file: 'packages/client/ui-settings-models/src/client/locales.ts', includes: ['headersTitle', 'compatSupportsDeveloperRole', 'testConnection'] },
  { file: 'packages/client/ui-settings-models/src/client/ModelsSection.module.css', includes: ['.compatGrid', '.connectionTestRow'] },
  // Core LLM mid-convo caching, DeepSeek gateway safe compat, timeout ceiling, stream recovery, abort drain, and proactive image offload.
  { file: 'packages/compaction/compaction-image-offload/src/index.ts', includes: ['DEFAULT_HIGH_WATERMARK_IMAGES = 20', 'countProactiveEvictions'] },
  { file: 'packages/core/agent-loop/src/agent.ts', includes: ['settlePartialOrAttempt'] },
  { file: 'packages/core/tools/src/batch.ts', includes: ['DEFAULT_ABORT_DRAIN_TIMEOUT_MS = 5_000', 'abortedStartedToolResult'] },
  { file: 'packages/llm/llm-deepseek/src/models.ts', includes: ["systemPromptUpdate: 'in-history'", "toolUpdate: 'addition-only'"] },
  { file: 'packages/llm/llm-pi-ai/src/adapter.ts', includes: ['nextWithinDeadline', "'LLM_REQUEST_TIMEOUT'"] },
  { file: 'packages/llm/llm-pi-ai/src/catalog.ts', includes: ['DEEPSEEK_COMPLETIONS_SAFE_COMPAT', "supportsMidConvoSystemMessages: 'offer'"] },
  { file: 'packages/llm/llm-pi-ai/src/config.ts', includes: ['DEFAULT_TOTAL_REQUEST_TIMEOUT_MS = 600_000', 'supportsMidConvoSystemMessages: z.boolean()'] },
  { file: 'packages/llm/llm-pi-ai/src/stream.ts', includes: ['partialToolCallOf'] },
  // MCP schema disk cache, deferred search/call meta-tools, and opt-in project-local CLI hooks.
  { file: 'apps/cli/config/agent-presets/standard/agent.cordis.yml', includes: ['hooks-claude-code', 'hooks-codex', 'DSH_PROJECT_HOOKS'] },
  { file: 'packages/experimental/hooks-claude-code/src/index.ts', includes: ['discoverProjectHooks?: boolean'] },
  { file: 'packages/experimental/hooks-claude-code/src/project-hooks.ts', includes: ['CLAUDE_PROJECT_HOOK_FILES'] },
  { file: 'packages/experimental/hooks-codex/src/index.ts', includes: ['discoverProjectHooks?: boolean'] },
  { file: 'packages/experimental/hooks-codex/src/project-hooks.ts', includes: ['.codex/hooks.json'] },
  { file: 'packages/mcp/mcp-client/src/connection.ts', includes: ['createMcpSchemaCache', 'toolDiscoveryMode'] },
  { file: 'packages/mcp/mcp-client/src/index.ts', includes: ['DEFAULT_INLINE_TOOL_THRESHOLD', 'toolDiscoveryMode?: ToolDiscoveryMode'] },
  { file: 'packages/mcp/mcp-client/src/tools.ts', includes: ['createDeferredToolDefinitions', 'resolveToolDiscoveryStrategy'] },
  { file: 'packages/mcp/mcp-client/src/deferred-tools.ts', includes: ['DEFAULT_INLINE_TOOL_THRESHOLD = 16', 'createDeferredToolDefinitions'] },
  { file: 'packages/mcp/mcp-client/src/schema-cache.ts', includes: ['createMcpSchemaCache'] },
  // Filesystem partial-read guard, durable backfill, multi-file rollback, editor CRLF/size cap, bare-dir glob, and fsio messaging.
  { file: 'packages/bundle/base/cordis.patch.yml', includes: ['DSH_FS_OBSERVATION_POLICY'] },
  { file: 'packages/fs/fs/src/types.ts', includes: ['readonly partial?: boolean'] },
  { file: 'packages/fs/fs-local/src/fsio.ts', includes: ['ambiguousEditError'] },
  { file: 'packages/fs/fs-observation-policy/src/index.ts', includes: ['rejectOverwriteAfterPartialRead', 'getOrBackfill'] },
  { file: 'packages/fs/fs-observation-policy/src/types.ts', includes: ['FsObservedSession'] },
  { file: 'packages/fs/tool-fs/src/patch/execute.ts', includes: ['captureSnapshots', 'rollbackCompleted'] },
  { file: 'packages/fs/tool-fs/src/read.ts', includes: ['const lineTruncated', 'partial: true'] },
  { file: 'packages/fs/tool-fs-search/src/glob.ts', includes: ['--no-require-git'] },
  { file: 'packages/fs/tool-str-replace-editor/src/index.ts', includes: ['MAX_EDITABLE_FILE_BYTES', 'restoreLineEndings'] },
];

module.exports = { WAVE2_FORK_FILE_MARKERS };
