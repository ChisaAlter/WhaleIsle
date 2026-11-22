'use strict';

/**
 * Wave 1 upstream fork markers kept separate from harness-desktop-forks.js
 * so each file stays well under the 800-line ESLint ceiling.
 */
const WAVE1_FORK_FILE_MARKERS = [
  // Desktop session lifecycle & UI responsiveness hardening.
  { file: 'packages/api/session-controller/src/agent.ts', includes: ['waitForRelease(sessionId)', 'releasingIds.has(sessionId)'] },
  { file: 'packages/api/session-controller/src/commands.ts', includes: ['BEFORE_CANCEL_TIMEOUT_MS = 3_000', 'beforeCancelTimedOut'] },
  { file: 'packages/api/session-controller/src/idle-release.ts', includes: ['trackRelease(id'] },
  { file: 'packages/api/session-controller/src/lifecycle.ts', includes: ['trackRelease(id: SessionId', 'releasePromises'] },
  { file: 'packages/client/ui-approval/src/client/ApprovalCard.tsx', includes: ['setSubmitError', 'submitFailed'] },
  { file: 'packages/client/ui-approval/src/client/ApprovalPanel.module.css', includes: ['.submitError'] },
  { file: 'packages/client/ui-approval/src/client/locales.ts', includes: ['submitFailed'] },
  { file: 'packages/client/ui-diff/src/client/DiffPanel.tsx', includes: ['file.tooLarge === true', 'data-diff-note'] },
  { file: 'packages/client/ui-diff/src/client/locales.ts', includes: ["'file.tooLarge'"] },
  { file: 'packages/client/ui-diff/src/client/shell.ts', includes: ['tooLarge?: boolean'] },
  { file: 'packages/client/ui-settings-models/src/client/ModelListEditor.tsx', includes: ['enrichEpochRef'] },
  { file: 'packages/client/ui-settings-models/src/client/models-dev-metadata.ts', includes: ['MODELS_DEV_TIMEOUT_MS', 'isPrivateIPv4Octets'] },
  // WhaleUI prompt bloat reduction, visual-replies deduplication, and plan-mode hard enforcement.
  { file: 'packages/client/ui-chat/src/index.ts', includes: ['WHALE_UI_COMPACT_GUIDE', 'whaleUiGuideTool'] },
  { file: 'packages/client/ui-chat/src/whale-ui-guide.ts', includes: ['WHALE_UI_COMPACT_GUIDE', 'whaleUiGuideTool'] },
  { file: 'packages/client/ui-chat/tsconfig.client.json', includes: ['"src/whale-ui-guide.ts"'] },
  { file: 'packages/client/ui-chat/tsconfig.host.json', includes: ['"src/whale-ui-guide.ts"'] },
  { file: 'packages/client/ui-visual-replies/src/tools.ts', includes: ['Follow the HTML page authoring, styling, sizing, and constraint rules in the visual-replies system prompt section.'], excludes: ['+ VISUAL_REPLY_PAGE_GUIDE'] },
  { file: 'packages/plan/plan-mode/src/index.ts', includes: ['evaluatePlanModeToolGate'] },
  { file: 'packages/plan/plan-mode/src/execution-gate.ts', includes: ['evaluatePlanModeToolGate'] },
  // Context compaction overflow fallback, pruner archive, and CJK-aware token estimation.
  { file: 'packages/compaction/compaction-basic/src/index.ts', includes: ['protectRecentToolResults: 0'] },
  { file: 'packages/compaction/compaction-basic/src/region.ts', includes: ['overflowFallback?: boolean', 'isProtectedBaselineNode'] },
  { file: 'packages/compaction/compaction-basic/src/summarizer.ts', includes: ['isOverflowOrSummarySizeFailure'] },
  { file: 'packages/compaction/compaction-tool-result-pruner/src/config.ts', includes: ['protectRecentToolResults: 2', "'archiveDir'"] },
  { file: 'packages/compaction/compaction-tool-result-pruner/src/index.ts', includes: ['PruneSessionOptions'] },
  { file: 'packages/compaction/compaction-tool-result-pruner/src/types.ts', includes: ['protectRecentToolResults?: number', 'archiveDir?: string'] },
  { file: 'packages/llm/token-meter/src/estimate.ts', includes: ['WEIGHT_DENOMINATOR = 20', 'CJK_WEIGHT = 24'] },
  // Core loop retry, malformed JSON recovery, max_tokens continuation, and runaway guards.
  { file: 'packages/bundle/sdk-minimal/cordis.patch.yml', includes: ['streamIdleTimeoutMs: 300000'] },
  { file: 'packages/core/agent-loop/src/agent.ts', includes: ["'max-tokens-recovery'", 'consecutiveMaxTokensRecoveries'] },
  { file: 'packages/core/agent-loop/src/constants.ts', includes: ['DEFAULT_MAX_TOKENS_RECOVERY_LIMIT = 2', 'DEFAULT_MAX_STEPS_PER_TURN = 200'] },
  { file: 'packages/core/agent-loop/src/index.ts', includes: ['maxTokensRecoveryLimit'] },
  { file: 'packages/core/tools/src/batch.ts', includes: ['VALID_JSON_ESCAPES', 'escapeControlCharacter'] },
  { file: 'packages/core/tools/src/json-schema.ts', includes: ['tryCoerceStringToNumber', 'coerceJsonSchemaValue'] },
  { file: 'packages/core/tools/src/malformed-json.ts', includes: ['malformedJsonViolation', 'arguments must be an object'] },
  { file: 'packages/core/tools/src/pipeline.ts', includes: ["typeof exec.arguments === 'string'", 'malformedJsonViolation(exec.arguments)'] },
  { file: 'packages/core/tools/src/schema.ts', includes: ['coerceJsonSchemaValue(parameters, args)', 'malformedJsonViolation'] },
  { file: 'packages/guard/repeat-tool-reminder/src/index.ts', includes: ['DEFAULT_HARD_STOP_THRESHOLD = 10', 'GENTLE_OSCILLATION_REMINDER'] },
  { file: 'packages/jobs/tool-jobs/src/index.ts', includes: ['DEFAULT_MAX_CONSECUTIVE_WAKES = 20'] },
  { file: 'packages/llm/llm-pi-ai/src/adapter.ts', includes: ['parseRetryAfterMs'] },
  { file: 'packages/llm/llm-pi-ai/src/config.ts', includes: ['DEFAULT_CONTEXT_WINDOW = 128_000'] },
  { file: 'packages/llm/llm-pi-ai/src/stream.ts', includes: ['RECEIVED_ARGUMENTS_MARKER'] },
  { file: 'packages/llm/llm-retry/src/index.ts', includes: ['DEFAULT_MAX_RETRY_AFTER_MS = 60_000', 'FATAL_ALWAYS_CODES'] },
  { file: 'packages/llm/llm/src/retry-policy.ts', includes: ["'STREAM_CLOSED'"] },
  // File edit fallback, search filtering, cross-turn task tracking, spill, MCP cleanup, and Windows shell hardening.
  { file: 'packages/fs/fs-local/src/fsio.ts', includes: ['FORMAT_SAMPLE_BYTES = 65_536', 'hasUtf8Bom'] },
  { file: 'packages/fs/fs-local/src/index.ts', includes: ['readExistingTextFormat', 'restoreUtf8Bom'] },
  { file: 'packages/fs/fs-patch/src/apply.ts', includes: ['hadTrailingNewline'] },
  { file: 'packages/fs/tool-fs-search/src/glob.ts', includes: ['noIgnore?: boolean'] },
  { file: 'packages/fs/tool-fs-search/src/grep.ts', includes: ['GrepOutputMode', 'case_insensitive', 'head_limit'] },
  { file: 'packages/fs/tool-fs-search/src/index.ts', includes: ['GrepOutputMode'] },
  { file: 'packages/fs/tool-fs-search/src/search-core.ts', includes: ['rawTruncated: boolean', 'sliceCompleteLinesWithinBytes'] },
  { file: 'packages/mcp/mcp-client/src/connection.ts', includes: ['reconnect(): Promise<void>'] },
  { file: 'packages/shell/bash-local/src/index.ts', includes: ["GIT_TERMINAL_PROMPT: '0'"] },
  { file: 'packages/shell/pwsh-local/src/index.ts', includes: ["PYTHONUTF8: '1'", "GIT_TERMINAL_PROMPT: '0'"] },
  { file: 'packages/shell/tool-bash-persistent/src/index.ts', includes: ['tailWithoutSplittingSurrogatePair'] },
  { file: 'packages/shell/tool-pwsh-persistent/src/index.ts', includes: ['tailWithoutSplittingSurrogatePair'] },
  { file: 'packages/shell/tool-pwsh/src/background.ts', includes: ['STATUS_DLL_INIT_FAILED_U32 = 3221225794'] },
  { file: 'packages/shell/tool-pwsh/src/index.ts', includes: ['isSandboxDllInitFailure', 'assertNoSandboxInitFailure'] },
  { file: 'packages/spill/spill-policy/src/index.ts', includes: ['DEFAULT_IMAGE_TOKENS = 1600'] },
  { file: 'packages/subprocess/subprocess-local/src/output.ts', includes: ['trimmedHead'] },
  { file: 'packages/subprocess/subprocess-local/src/runner-launch.ts', includes: ['${command}${separator}bat', '${command}${separator}cmd'] },
  { file: 'packages/todo/tool-todo/src/index.ts', includes: ["if (event.type === 'turn/start')"] },
];

module.exports = { WAVE1_FORK_FILE_MARKERS };
