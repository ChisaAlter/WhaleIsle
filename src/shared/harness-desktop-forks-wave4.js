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
];

module.exports = { WAVE4_FORK_FILE_MARKERS };
