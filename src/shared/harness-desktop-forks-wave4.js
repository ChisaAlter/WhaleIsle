'use strict';

/**
 * Wave 4 upstream fork markers kept separate from harness-desktop-forks.js,
 * wave1, wave2, and wave3 to keep every guard file concise.
 * @type {Array<{ file: string, includes?: string[], excludes?: string[] }>}
 */
const WAVE4_FORK_FILE_MARKERS = [
  // IDE-level Diff review: hunk staging, inline line comments, progressive chunking, and on-demand single-file diffs.
  { file: 'packages/client/ui-primitives/src/index.ts', includes: ['DEFAULT_PROGRESSIVE_CHUNK_LINES', 'ReviewLineCommentTarget', 'ReviewDiffProps'] },
  { file: 'packages/client/ui-primitives/src/ReviewDiff.tsx', includes: ['DEFAULT_PROGRESSIVE_CHUNK_LINES = 400', 'interface ReviewLineCommentTarget', 'interface ReviewDiffProps', 'renderHunkActions', 'onLineComment', 'progressiveChunkLines', 'data-diff-hunk-actions', 'data-diff-line-comment', 'data-diff-progressive'] },
  { file: 'packages/client/ui-primitives/src/ReviewDiff.module.css', includes: ['.hunkActions', '.lineCommentBtn', '.progressiveBar', '.progressiveBtn'] },
  { file: 'packages/client/ui-diff/src/client/hunk-patch.ts', includes: ['isSafePatchPath', 'buildSingleHunkPatch', 'formatDiffLineComment'] },
  { file: 'packages/client/ui-diff/src/client/draft.ts', includes: ['appendToDraft', "ctx.get('conversation')"] },
  { file: 'packages/client/ui-diff/src/client/panel-model.ts', includes: ['buildVisibleRows', 'needsSingleFileFetch', 'canPatchSingleHunk'] },
  { file: 'packages/client/ui-diff/src/client/shell.ts', includes: ['path?: string', 'staged?: boolean', 'gitStagePatch?:', 'gitUnstagePatch?:', 'appendComposerText?:'] },
  { file: 'packages/client/ui-diff/src/client/apply.ts', includes: ['appendToDraft', 'appendComposerText'] },
  { file: 'packages/client/ui-diff/src/client/index.ts', includes: ['GitDiffOptions'] },
  { file: 'packages/client/ui-diff/src/client/DiffPanel.tsx', includes: ['DEFAULT_PROGRESSIVE_CHUNK_LINES', 'buildSingleHunkPatch', 'formatDiffLineComment', 'canPatchSingleHunk', 'needsSingleFileFetch', 'data-diff-hunk-action'] },
  { file: 'packages/client/ui-diff/src/client/DiffPanel.module.css', includes: ['.hunkAction'] },
  { file: 'packages/client/ui-diff/src/client/locales.ts', includes: ["'hunk.stage'", "'hunk.unstage'", "'line.comment'", "'diff.showMore'", "'diff.expandRemaining'", "'file.loading'"] },
  // IDE code editor UX inside FilePreview: synchronized line gutter, async syntax highlight backdrop, Tab/Enter ergonomics, and Ctrl/Cmd+F find bar.
  { file: 'packages/client/ui-files/src/client/codeEditorHelpers.ts', includes: ['CODE_EDITOR_INDENT', 'countLines', 'applyTabIndent', 'applyEnterIndent', 'splitLineSpansWithMatches'] },
  { file: 'packages/client/ui-files/src/client/CodeEditorSurface.tsx', includes: ['CodeEditorSurfaceHandle', 'useCodeHighlighter', 'data-file-find-bar', 'data-code-gutter', 'data-code-highlight'] },
  { file: 'packages/client/ui-files/src/client/CodeEditorSurface.module.css', includes: ['.findBar', '.gutter', '.highlight', '.textarea'] },
  { file: 'packages/client/ui-files/src/client/FilePreview.tsx', includes: ['CodeEditorSurface', 'onFindKeyDown', 'onEscapeCapture'] },
  { file: 'packages/client/ui-files/src/client/FilePreview.module.css', includes: ['.editorBody > .message'] },
  { file: 'packages/client/ui-files/src/client/locales.ts', includes: ["'find.label'", "'find.placeholder'", "'find.noResults'"] },
  // Core polish & CI snapshot fix: time-context injection policy, spill-policy read cap, skill-filesystem compatible roots, compaction logging, and mcp-client status helper.
  { file: 'packages/context/time-context/src/index.ts', includes: ['TimeInjectionPolicy', 'injectionPolicy', 'shouldSkipInjection', 'validateInjectionPolicy'] },
  { file: 'packages/spill/spill-policy/src/index.ts', includes: ['maxReadInlineTokens', 'readCap', 'DEFAULT_IMAGE_TOKENS = 1600'] },
  { file: 'packages/skill/skill-filesystem/src/index.ts', includes: ['includeCompatibleRoots', 'PROJECT_CLAUDE_RANK = 210', 'USER_CODEX_RANK = 520', 'defaultAgentsHome'] },
  { file: 'packages/compaction/compaction-basic/src/index.ts', includes: ['formatStepCompactionWarning', 'logPreStepCompactionFailure'] },
  { file: 'packages/mcp/mcp-client/src/index.ts', includes: ['statusLastError'] },
  { file: 'snapshots/session/malformed-tool-call-retry/session.v4.jsonl', includes: ['STREAM_CLOSED'] },
  // Sign in with ChatGPT (OpenAI OAuth subscription) & streaming authorization seams across credentials, remotes, llm-pi-ai, and ui-settings-models.
  { file: 'packages/credentials/credentials/src/types.ts', includes: ['export interface CredentialRecordInfo'] },
  { file: 'packages/credentials/credentials/src/index.ts', includes: ['CredentialRecordInfo'] },
  { file: 'packages/credentials/authorization/src/types.ts', includes: ['export type AuthorizationWirePrompt', "'authorization/settled'"] },
  { file: 'packages/credentials/authorization/src/index.ts', includes: ['revoke?: () => Promise<void>', 'async revoke(key: CredentialKey)'] },
  { file: 'packages/api/settings-controller/src/types.ts', includes: ['export type AuthorizationStreamEvent', 'readonly key: string'] },
  { file: 'packages/api/settings-controller/src/key.ts', includes: ['export function parseCredentialKeyOrBadRequest'] },
  { file: 'packages/api/settings-controller/src/credentials.ts', includes: ['describeRecords(', 'deleteRecord(', 'projectCredentialRecordInfo'] },
  { file: 'packages/api/settings-controller/src/authorization.ts', includes: ['export class AuthorizationController', 'async *start(', 'respondPrompt(', 'cancel('] },
  { file: 'packages/api/settings-controller/src/index.ts', includes: ['AuthorizationController'] },
  { file: 'packages/api/remotes/src/remote-events.ts', includes: ["{ event: 'authorization/settled', mode: 'emit' }"] },
  { file: 'packages/api/remotes/src/index.ts', includes: ["'@deepseek-ai/dsh-authorization/types'"] },
  { file: 'packages/api/remotes/src/client/index.ts', includes: ['AuthorizationStreamEvent', 'CredentialRecordInfo'] },
  { file: 'packages/experimental/liveshare/src/endpoint-classification.ts', includes: ["'authorization/start'", "'credentials/describeRecords'"] },
  { file: 'packages/llm/llm/src/error.ts', includes: ['(?:quota|usage[\\s_-]+limit)[\\s_-]+(?:exceeded|exhausted|reached)'] },
  { file: 'packages/llm/llm-pi-ai/src/auth.ts', includes: ['DEVICE_ID_KEY', 'export async function getOrCreateDeviceId'] },
  { file: 'packages/llm/llm-pi-ai/src/login.ts', includes: ['OPENAI_OAUTH_REVOKE_URL', 'revokeOpenAIOAuth', "agentName: 'Whale Isle'", 'getDeviceId'] },
  { file: 'packages/llm/llm-pi-ai/src/discovery.ts', includes: ['visibility', "visibility === 'list'"] },
  { file: 'patches/@earendil-works__pi-ai@1.3.0.patch', includes: ['isChatGPTSignIn', 'forceDeveloperRole', 'listenCallbackServer', 'subscription_sharing_workplace_individual_usage_limit_exceeded'] },
  { file: 'packages/llm/llm-pi-ai/tests/siwc-patch.spec.ts', includes: ['nonReasoningOpenAIModel'] },
  { file: 'packages/client/ui-settings-models/src/client/index.ts', includes: ["'authorization/settled'"] },
  { file: 'packages/client/ui-settings-models/src/client/operations.ts', includes: ['authorizationRemoteOf', 'startAuthorization:', 'respondAuthorizationPrompt:', 'cancelAuthorization:', 'removeCredentialRecord:', 'openExternalUrl:'] },
  { file: 'packages/client/ui-settings-models/src/client/store.ts', includes: ['oauthKey?: string', 'oauthFlow?: AuthorizationEntry', 'oauthCredential?: CredentialRecordInfo', 'readAuthorizations'] },
  { file: 'packages/client/ui-settings-models/src/client/ProviderOAuthControl.tsx', includes: ['export function ProviderOAuthControl', 'https://chatgpt.com/settings/usage'] },
  { file: 'packages/client/ui-settings-models/src/client/ProviderEditor.tsx', includes: ['ProviderOAuthControl', 'handleOAuthAuthorized'] },
  { file: 'packages/client/ui-settings-models/src/client/ModelsSection.tsx', includes: ['onAuthorizationChange', 'row.oauthCredential?.configured === true'] },
  { file: 'packages/client/ui-settings-models/src/client/ModelsSection.module.css', includes: ['.oauthBox', '.oauthPrompt'] },
  { file: 'packages/client/ui-settings-models/src/client/locales.ts', includes: ['oauthSignInChatGpt', 'oauthManageUsage', 'oauthSignOut'] },
  { file: 'packages/client/ui-settings-models/tests/provider-oauth.client.spec.tsx', includes: ["describe('ProviderOAuthControl'"] },
];

module.exports = { WAVE4_FORK_FILE_MARKERS };
