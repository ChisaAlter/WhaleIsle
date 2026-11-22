'use strict';

/**
 * Wave 3 upstream fork markers kept separate from harness-desktop-forks.js,
 * wave1, and wave2 to keep every guard file concise.
 * @type {Array<{ file: string, includes?: string[], excludes?: string[] }>}
 */
const WAVE3_FORK_FILE_MARKERS = [
  // Windows ACL sandbox fail-closed NULL-DACL guard, extra-dir grants, adaptive job polling, and hook sandbox policy passthrough.
  { file: 'packages/experimental/hook-protocol/src/runner.ts', includes: ["sandboxPolicy?: NonNullable<ShellExecRequest['sandboxPolicy']>"] },
  { file: 'packages/experimental/hooks-claude-code/src/index.ts', includes: ['resolveHookSandboxPolicy', 'discoverProjectHooks?: boolean'] },
  { file: 'packages/experimental/hooks-codex/src/index.ts', includes: ['resolveHookSandboxPolicy', 'discoverProjectHooks?: boolean'] },
  { file: 'packages/sandbox/sandbox-local/src/index.ts', includes: ['revokeWorkspaceAclOnDispose?: boolean', 'materializeWorkspaceGrant', 'assertExtraRootOutsideTemp'] },
  { file: 'packages/sandbox/sandbox-windows-acl/src/acl.ts', includes: ['refusing to modify directory with NULL DACL', 'stripExactDenyFromNewAcl'] },
  { file: 'packages/sandbox/sandbox-windows-acl/src/ffi.ts', includes: ['deleteAce'] },
  { file: 'packages/sandbox/sandbox-windows-acl/src/grant.ts', includes: ['revokeWrite(this.api, path, this.sidPtr, this.worldSidPtr)'] },
  { file: 'packages/sandbox/sandbox-windows-acl/src/index.ts', includes: ['extraDirs?: readonly string[]', 'extraWriteSids?: readonly string[]', 'revokeWorkspaceAclOnDispose?: boolean', 'export function revokeWorkspaceGrant'] },
  { file: 'packages/sandbox/sandbox-windows-acl/src/runner.ts', includes: ["'--extra-dir'", "'--extra-sid'", 'requireExtraDirectory'] },
  { file: 'packages/subprocess/subprocess-local/src/spawn-runner.ts', includes: ['POLL_BACKOFF_MS = [2, 5, 10, 25, 50]', 'schedulePoll', 'clearPollTimer'] },
  // Persistent LSP publishDiagnostics cache, LRU document lifecycle, idle timeout, post-edit diagnostics, and bare catch-all glob fix.
  { file: 'packages/fs/tool-fs-search/src/glob.ts', includes: ['omitCatchAllGlob', "input.noIgnore !== true && (input.pattern === '**/*' || input.pattern === '**')"] },
  { file: 'packages/lsp/lsp/src/types.ts', includes: ["'diagnostics'", 'LspDiagnosticSeverity', 'interface LspDiagnostic', 'supportsFile?(filePath: string): boolean'] },
  { file: 'packages/lsp/lsp/src/index.ts', includes: ['supportsFile(filePath: string): boolean', "request.operation !== 'diagnostics'"] },
  { file: 'packages/lsp/lsp-stdio/src/connection.ts', includes: ['private readonly onNotification?: (method: string, params: unknown) => void', 'get failure(): Error | undefined'] },
  { file: 'packages/lsp/lsp-stdio/src/protocol.ts', includes: ['publishDiagnostics:', 'versionSupport: true', 'export interface WirePublishDiagnosticsParams'] },
  { file: 'packages/lsp/lsp-stdio/src/translate.ts', includes: ['export const MAX_DIAGNOSTICS_PER_FILE = 200', 'export function supportsDocumentChange', 'export function normalizeDocumentUri', 'export function normalizePublishDiagnostics'] },
  { file: 'packages/lsp/lsp-stdio/src/instance.ts', includes: ['export const DEFAULT_MAX_OPEN_DOCUMENTS = 32', 'export const DEFAULT_DIAGNOSTICS_WAIT_MS = 1_500', 'UNVERSIONED_DIAGNOSTICS_SETTLE_MS', 'ensureDocumentOpen', 'waitForDiagnostics'] },
  { file: 'packages/lsp/lsp-stdio/src/index.ts', includes: ['export const DEFAULT_IDLE_TIMEOUT_MS = 300_000', 'armIdleTimer', 'clearIdleTimer', 'keepDocumentsOpen', 'maxOpenDocuments', 'diagnosticsWaitMs', 'idleTimeoutMs'] },
  { file: 'packages/lsp/tool-lsp/src/render.ts', includes: ["'diagnostics'", 'export function formatDiagnostics', 'export function extractEditedFilePaths', 'export function appendDiagnosticsContent'] },
  { file: 'packages/lsp/tool-lsp/src/index.ts', includes: ['export const DEFAULT_AUTO_DIAGNOSTICS_TIMEOUT_MS = 2_000', 'autoDiagnosticsAfterEdit', "ctx.on('tools/post-execute'"] },
  // Subagent cascading interrupt, SDK session/cancel wire cancellation, Git worktree isolation, and Team board reactive wakeup.
  { file: 'packages/experimental/tool-agent-team/src/board-events.ts', includes: ['class TeamBoardCoordinator', 'onBoardMutation', 'registerWaiter', 'consumeUnread'] },
  { file: 'packages/experimental/tool-agent-team/src/index.ts', includes: ['TeamBoardCoordinator', 'board.onBoardMutation', 'board.consumeUnread'] },
  { file: 'packages/subagent/subagent/src/types.ts', includes: ['SubagentInterruptOptions', 'SubagentWorktreeSpec', 'SubagentWorktreeOutcome'] },
  { file: 'packages/subagent/subagent/src/activation.ts', includes: ['readonly worktree?: SubagentWorktreeSpec | undefined'] },
  { file: 'packages/subagent/subagent/src/continuation-messages.ts', includes: ['formatWorktreeOutcomeNotice'] },
  { file: 'packages/subagent/subagent/src/worktree.ts', includes: ['createIsolatedSubagentWorktree', 'finalizeIsolatedSubagentWorktree', 'rollbackIsolatedSubagentWorktree', 'formatWorktreeOutcomeNotice'] },
  { file: 'packages/subagent/subagent/src/manager.ts', includes: ['options?: SubagentInterruptOptions', 'private readonly interrupting', 'finalizeIsolatedSubagentWorktree'] },
  { file: 'packages/subagent/subagent/src/index.ts', includes: ['resolveDirectory', 'createIsolatedSubagentWorktree', 'SubagentInterruptOptions'] },
  { file: 'packages/subagent/subagent-dsh-sdk/src/run.ts', includes: ['DEFAULT_CANCEL_TIMEOUT_MS = 2_000', 'cancelTimeoutMs?: number', "'session/cancel'"] },
  { file: 'packages/subagent/tool-subagent-control/src/index.ts', includes: ['cascade:', 'args.cascade === undefined ? undefined : { cascade: args.cascade }'] },
  { file: 'packages/subagent/tool-subagent/src/index.ts', includes: ['worktreeIsolation?: boolean', 'worktreeIsolationEnabled', "isolation === 'worktree'", 'worktreePath'] },
];

module.exports = { WAVE3_FORK_FILE_MARKERS };
