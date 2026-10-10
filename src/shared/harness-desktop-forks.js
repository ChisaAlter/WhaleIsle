'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_PACKAGES = [
  { dir: 'packages/client/ui-agents-panel', name: '@deepseek-ai/dsh-client-ui-agents-panel' },
  { dir: 'packages/client/ui-diff', name: '@deepseek-ai/dsh-client-ui-diff' },
  { dir: 'packages/client/ui-files', name: '@deepseek-ai/dsh-client-ui-files' },
  { dir: 'packages/client/ui-git', name: '@deepseek-ai/dsh-client-ui-git' },
  { dir: 'packages/client/ui-message-edit', name: '@deepseek-ai/dsh-client-ui-message-edit' },
  { dir: 'packages/client/ui-preview', name: '@deepseek-ai/dsh-client-ui-preview' },
  { dir: 'packages/client/ui-settings-mcp', name: '@deepseek-ai/dsh-client-ui-settings-mcp' },
  { dir: 'packages/client/ui-settings-remote', name: '@deepseek-ai/dsh-client-ui-settings-remote' },
  { dir: 'packages/client/ui-settings-market', name: '@deepseek-ai/dsh-client-ui-settings-market' },
  { dir: 'packages/client/ui-settings-skills', name: '@deepseek-ai/dsh-client-ui-settings-skills' },
  { dir: 'packages/client/ui-surfaces', name: '@deepseek-ai/dsh-client-ui-surfaces' },
  { dir: 'packages/client/ui-titlebar', name: '@deepseek-ai/dsh-client-ui-titlebar' },
  { dir: 'packages/client/ui-user-terminal', name: '@deepseek-ai/dsh-client-ui-user-terminal' },
  { dir: 'packages/host/mcp-servers', name: '@deepseek-ai/dsh-host-mcp-servers' },
  { dir: 'packages/host/skill-inventory', name: '@deepseek-ai/dsh-host-skill-inventory' },
  { dir: 'packages/llm/llm-vision-fallback', name: '@deepseek-ai/dsh-llm-vision-fallback' },
  { dir: 'packages/mcp/mcp-servers-file', name: '@deepseek-ai/dsh-mcp-servers-file' },
  { dir: 'packages/client/ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
  { dir: 'packages/host/directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
];

const COMPOSITION_ROWS = [
  { file: 'packages/bundle/base/cordis.patch.yml', id: 'llm-vision-fallback', name: '@deepseek-ai/dsh-llm-vision-fallback', configIncludes: ['maxOutputTokens: 2048', 'timeoutMs: 120000'] },
  { file: 'packages/bundle/base/cordis.patch.yml', id: 'mcp-servers-file', name: '@deepseek-ai/dsh-mcp-servers-file' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'directory-picker', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'mcp-servers', name: '@deepseek-ai/dsh-host-mcp-servers' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'skill-inventory', name: '@deepseek-ai/dsh-host-skill-inventory' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-titlebar', name: '@deepseek-ai/dsh-client-ui-titlebar' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-git', name: '@deepseek-ai/dsh-client-ui-git' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-user-terminal', name: '@deepseek-ai/dsh-client-ui-user-terminal' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-surfaces', name: '@deepseek-ai/dsh-client-ui-surfaces' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-files', name: '@deepseek-ai/dsh-client-ui-files' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-diff', name: '@deepseek-ai/dsh-client-ui-diff' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-preview', name: '@deepseek-ai/dsh-client-ui-preview' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-agents-panel', name: '@deepseek-ai/dsh-client-ui-agents-panel' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-settings-remote', name: '@deepseek-ai/dsh-client-ui-settings-remote' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-settings-mcp', name: '@deepseek-ai/dsh-client-ui-settings-mcp' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-settings-skills', name: '@deepseek-ai/dsh-client-ui-settings-skills' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-message-edit', name: '@deepseek-ai/dsh-client-ui-message-edit' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
];

const LAYOUT_MARKERS = ['surfaces', 'shell.titlebar.trailing', 'shell.terminalDrawer'];

// Desktop content inside upstream-owned files. The whole-package registry above
// cannot see these: sync:harness keeps them only via git merge, so a conflict
// resolved towards upstream would drop them without failing any other assert.
const FORK_FILE_MARKERS = [
  // Local Project continuations use explicit cwd/preset and admission policy.
  // Ordinary Team and Session ownership are not changed by this feature.
  { file: 'apps/cli/src/profile-boot.ts', includes: ['export async function disposeProfileApplication', 'for (const release of [() => projects?.dispose?.(), () => ctx?.fiber.dispose()])', 'disposeProfileApplication(app.current)', 'installFailLoud(NAME, process, dispose)'] },
  { file: 'packages/subagent/subagent/src/types.ts', includes: ['interface ContinuableEnvironment', 'readonly cwd?: string', 'readonly agentPreset?: string', 'readonly admissionPolicy?: string'] },
  { file: 'packages/subagent/subagent/src/child-agent.ts', includes: ['environment?.cwd ?? parentHeader.cwd', 'environment?.agentPreset ?? agentPreset', 'await presets.mount(childCtx, composition.agentPreset)'] },
  { file: 'packages/subagent/subagent/src/descriptor.ts', includes: ['agentPreset', 'admissionPolicy'] },
  { file: 'packages/subagent/subagent/src/continuation.ts', includes: ['admitContinuation', "reason: 'start'", "reason: 'message'", 'agentPreset: descriptor.agentPreset'] },
  { file: 'packages/subagent/subagent/src/continuation-activation.ts', includes: ['notifyManagedSettlement', "reason: 'settlement'", 'activation.observer.runId'] },
  { file: 'packages/subagent/subagent/src/continuation-messages.ts', includes: ['readonly runId?: SubagentRunId'] },
  { file: 'packages/subagent/subagent/src/lifecycle.ts', includes: ['readonly runId: SubagentRunId'] },
  { file: 'packages/subagent/subagent/src/index.ts', includes: ['registerContinuationPolicy'] },
  { file: 'packages/subagent/subagent-in-process-driver/src/index.ts', includes: ['const setup = async', 'await applyChildComposition'] },
  { file: 'packages/api/session-controller/src/commands.ts', includes: ["await this.ctx.serial('session/before-cancel'", 'async cancel(request:', '&& !pluginPresentation'] },
  { file: 'packages/api/session-controller/src/index.ts', includes: ["'session/before-cancel'", 'cancel(request: SessionCancelRequest): Promise<SessionCancelValue>'] },
  { file: 'packages/client/ui-sidebar/src/client/index.ts', includes: ['selectTab'] },
  // WhaleBridge thresholds travel with each model and are consumed by
  // compaction; keeping only the configuration field would silently lose it.
  { file: 'packages/llm/llm-pi-ai/src/catalog.ts', includes: ['compactionThreshold?: number'] },
  { file: 'packages/llm/llm-pi-ai/src/config.ts', includes: ['configuredCompactionThresholds', 'compactionThreshold: z.number()'] },
  { file: 'packages/llm/llm-pi-ai/src/adapter.ts', includes: ['configuredCompactionThresholds'] },
  { file: 'packages/llm/llm/src/types.ts', includes: ['compactionThreshold?: number'] },
  { file: 'packages/llm/llm/src/index.ts', includes: ['compactionThreshold'] },
  { file: 'packages/compaction/compaction-basic/src/config.ts', includes: ['compactionThreshold'] },
  { file: 'packages/compaction/compaction-basic/src/index.ts', includes: ['info.context.compactionThreshold'] },
  // SettingsSelect: official Menu pill for every settings value dropdown.
  { file: 'packages/client/ui-primitives/src/index.ts', includes: ['export { SettingsSelect }', 'ReviewDiff'] },
  { file: 'packages/client/ui-settings-mcp/src/client/McpSection.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-skills/src/client/SkillsSection.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/CloseBehaviorRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/AutoStartDesktopRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/HarnessRestartRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/AboutSection.tsx', includes: ['openDshHome'] },
  // Remote workspace (SSH) toggle: desktop-only Interface row + config field
  // + dictionaries riding the upstream settings-general files.
  { file: 'packages/client/ui-settings-general/src/client/RemoteWorkspaceRow.tsx', includes: ['remoteWorkspaceEnabled'] },
  { file: 'packages/client/ui-settings-general/src/client/RemoteWorkspaceRow.module.css', includes: [] },
  { file: 'packages/client/ui-settings-general/src/client/index.ts', includes: ['RemoteWorkspaceRow'] },
  { file: 'packages/client/ui-settings-general/src/client/locales.ts', includes: ['remoteWorkspace.title'] },
  { file: 'packages/client/ui-settings-general/src/client/desktop-shell.ts', includes: ['remoteWorkspaceEnabled'] },
  { file: 'packages/client/locale/src/client/LanguageRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-permission-presets/src/client/PermissionRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-models/src/client/models-dev-metadata.ts', includes: ['models.dev'] },
  { file: 'packages/client/ui-settings-models/scripts/live-fetch-enrich-probe.ts', includes: [] },
  // Standing wallpaper fork on the upstream ui-theme package.
  { file: 'packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx', includes: [] },
  { file: 'packages/client/ui-theme/src/client/WallpaperRow.tsx', includes: [] },
  // Appearance section typography: the upstream sheet references
  // --dsw-font-size-* tokens nothing defines, so every styled text fell back
  // to the inherited 16px root size; the fork pins the documented settings
  // scale (16/24/500 section titles, 14/22 labels, 12/18 compact) and gives
  // collapsed effect rows the typing-fx 14/22 row title via .rowTitle.
  { file: 'packages/client/ui-theme/src/client/AppearanceSection.module.css', includes: ['.rowTitle'] },
  { file: 'packages/client/ui-theme/src/client/BackgroundEffectRow.tsx', includes: ['css.rowTitle'] },
  { file: 'packages/client/ui-theme/src/client/CursorEffectRow.tsx', includes: ['css.rowTitle'] },
  { file: 'packages/client/ui-theme/src/client/MetallicPaintRow.tsx', includes: ['css.rowTitle'] },
  // Composer family width linkage: the drag-resized input card publishes
  // --dsh-composer-resized-width on the seat AND the conversation column (so
  // the transcript sees it); the session stats line, the chat flow column,
  // and the dock cards (queue / todo / goal) consume it so they follow.
  // rc.1 renamed the stats row to StatsPills (stat-dialog pair); the follow
  // contract moved with it.
  { file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-chat/src/client/chat/ChatView.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/ComposerResizeHandles.tsx', includes: ['data-conversation-scroll'] },
  { file: 'packages/client/ui-conversation/src/client/queue/QueueDock.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-primitives/src/TaskDock.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-primitives/src/TaskDock.tsx', includes: ["import css from './TaskDock.module.css'", 'className={css.root}'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx', includes: ['<TaskDock'] },
  { file: 'packages/client/ui-goal/src/client/GoalBar.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-theme/src/wallpaper.ts', includes: ['TRANSPARENT_ATTR', 'data-dsh-transparent'] },
  { file: 'packages/client/ui-theme/src/styles/wallpaper.css', includes: ['html[data-dsh-transparent]'] },
  // Motion call sites the alpha.2/rc.2 merges resolved toward upstream,
  // deleting the theme recipes docs/motion.md requires: FlipText on the
  // model/reasoning and transcript triggers, and the presence markers on
  // menus, disclosure bodies, the compact hover card, and the tooltip.
  { file: 'packages/client/ui-model-selection/src/client/ModelSelect.tsx', includes: ['<FlipText className={css.triggerLabel} text={modelLabel} />', '<FlipText className={css.triggerEffort} text={effortLabel} />'] },
  { file: 'packages/client/ui-model-selection/src/client/ModelSelect.module.css', includes: ["/* FlipText's recipe root is inline-grid;", ".triggerLabel[data-dsh-motion='flip'],", ".triggerEffort[data-dsh-motion='flip'] {", 'display: var(--dsh-composer-model-text-display, inline-grid);'] },
  { file: 'packages/client/ui-chat/src/client/settings/PreferenceRow.tsx', includes: ['<FlipText className={css.selectorLabel} text={selectedLabel} />'] },
  { file: 'packages/client/ui-primitives/src/Menu.tsx', includes: ['const { mounted, state } = usePresence(open)', 'data-dsh-motion="popover"', 'data-state={state}'] },
  { file: 'packages/client/ui-primitives/src/DisclosureRow.tsx', includes: ['const { mounted, state } = usePresence(open)', 'data-dsh-motion="fade"', 'data-state={state}'] },
  { file: 'packages/client/ui-input-trigger/src/client/MenuView.tsx', includes: ['const lastOpen = useRef(state)', 'lastOpenCrumbs', 'lastOpen.current = state', 'const view = state.open ? state : lastOpen.current', 'const { mounted, state: motionState } = usePresence(state.open)', 'data-dsh-motion="popover"', 'data-state={motionState}'] },
  { file: 'packages/client/ui-primitives/src/HoverCard.tsx', includes: ["const compactMotion = variant === 'compact' && !inline", 'usePresence(compactMotion && open)', "data-dsh-motion={compactMotion ? 'popover' : undefined}", "data-state={compactMotion ? cardState : closing ? 'closed' : 'open'}"] },
  { file: 'packages/client/ui-primitives/src/Tooltip.tsx', includes: ["data-dsh-motion=\"fade\"", 'data-state={state}', 'usePresence(requestedVisible && !disabled)'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css', includes: [':not([data-dsh-transparent])', '.heroWorkspaceRow', 'max-width: var(--dsh-composer-resized-width', 'align-self: center'] },
  { file: 'packages/client/ui-conversation/src/client/ComposerBeam.tsx', includes: ['data-composer-beam', '--dsh-composer-beam-period', '--dsh-composer-beam-bloom-opacity', '--dsh-composer-beam-track-width', 'data-beam-breathing'] },
  { file: 'packages/client/ui-conversation/src/client/ComposerBeam.module.css', includes: ['.beamBloom::before', 'inset: -4px', 'blur(var(--dsh-composer-beam-glow-blur', '.beamStroke {', 'padding: var(--dsh-composer-beam-track-width', 'transparent 30%', '-webkit-mask-composite: source-in, xor', 'mask-composite: intersect, exclude', 'mask-composite: add', 'corner-shape: round'] },
  { file: 'packages/client/ui-chat/src/client/chat/StatsPills.tsx', includes: ['data-stats-line'] },
  // No-directory sessions (docs/features/no-directory-sessions.md): the Host
  // advertises the scratch cwd on the Workspace baseline, registering a
  // directory re-adopts its sessions, the hero picker offers "No workspace
  // folder", and the sidebar lists only Workspace members plus scratch tasks.
  { file: 'packages/api/workspace-controller/src/types.ts', includes: ['scratchCwd'] },
  { file: 'packages/api/workspace-controller/src/index.ts', includes: ['scratchWorkspaceCwd', "'no-workspace'"] },
  { file: 'packages/api/workspace-controller/src/client/model.ts', includes: ['scratchCwd'] },
  { file: 'packages/workspace/workspace/src/index.ts', includes: ['readoptableSessionIds'] },
  // The no-directory pick may be made while the Workspace list still shows its
  // loading status: connectScratchCwd waits for the baseline instead of
  // rejecting, so the chip does not silently fall back.
  { file: 'packages/client/ui-workspace/src/client/navigation.ts', includes: ['connectNoDirectory', 'connectScratchCwd', 'deleteWorkspace', 'scratchCwd', 'registerDirectoryAction'] },
  { file: 'packages/client/ui-workspace/src/client/tree.ts', includes: ['isNoDirectorySession', 'currentGroupKey'] },
  { file: 'packages/client/ui-workspace/src/client/WorkspacePicker.tsx', includes: ['NO_DIRECTORY', 'onPickNoDirectory'] },
  { file: 'packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx', includes: ['TasksSectionHeader', 'connectNoDirectory', 'GroupSessionRun'] },
  { file: 'packages/client/ui-workspace/src/client/locales.ts', includes: ['menu.noDirectory'], excludes: ['Ungrouped'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx', includes: ['selectNoDirectory', 'noDirectorySession'] },
  { file: 'packages/client/ui-conversation/src/client/apply.ts', includes: ['selectNoDirectory', 'openNoDirectory'] },
  { file: 'packages/client/ui-conversation/src/client/locales.ts', includes: ['hero.noDirectory'] },
  // Desktop launcher recovery flag reaches normal profile boot, not only dumps.
  { file: 'apps/cli/src/args.ts', includes: ['skip-user-plugins', 'patches, skipUserPlugins, args'] },
  { file: 'packages/boot/app-boot/src/profile.ts', includes: ["options.bundles === 'template'", 'template?.bundles ?? dropRetiredBundles'] },
  { file: 'packages/boot/app-boot/src/profile-context.ts', includes: ["bundles: context.skipUserPlugins === true ? 'template' : 'manifest'"] },
  { file: 'apps/cli/src/dump-config.ts', includes: ['skipUserPlugins'] },
  { file: 'tsconfig.host.json', includes: ['packages/host/mcp-servers', 'packages/host/skill-inventory', 'packages/llm/llm-vision-fallback', 'packages/mcp/mcp-servers-file'] },
  { file: 'packages/api/workspace-controller/tsconfig.host.json', includes: ['../../util/home-paths'] },
  { file: 'packages/api/workspace-controller/package.json', includes: ['@deepseek-ai/dsh-home-paths'] },
  { file: 'tsconfig.base.json', includes: ['dsh-host-mcp-servers', 'dsh-host-skill-inventory', 'dsh-llm-vision-fallback', 'dsh-mcp-servers-file'] },
  // Desktop composition carries the browse rows in the shipped base, so the
  // upstream preset e2e must re-insert only the host row.
  { file: 'apps/cli/tests/web-agent-presets.e2e.ts', includes: ["{ id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' }"] },
  // Hidden agent presets: DSHD's whale assistant registers an internal preset
  // (`hidden: true`) that must stay out of every mode picker while remaining
  // resolvable and mountable by id. The 0.1.7 registry rewrite dropped the
  // flag; these markers keep it from being merged back out.
  { file: 'packages/preset/agent-preset-registry/src/definition.ts', includes: ['hidden?: boolean'] },
  { file: 'packages/preset/agent-preset-registry/src/index.ts', includes: ['record.config.hidden === true', "row.hidden !== true || row.broken !== undefined"] },
  { file: 'packages/preset/agent-preset-registry/tests/registry.spec.ts', includes: ['keeps a healthy hidden preset off the roster'] },
  // Desktop-forked settings e2e drivers (SettingsSelect menus, section
  // navigation, zh boot copy, RPC interception).
  { file: 'apps/web/tests/settings-chrome.e2e.ts', includes: ['正在加载插件'] },
  // Desktop fork: the shipped web-app composition carries the browse rows, so
  // the scaffold's upstream -auto disable+insert pair must stay removed (it
  // duplicates the shipped client browse row and fails every boot sweep).
  // One full-height DSHD column owns guide and content; no second host or toggle.
  { file: 'packages/client/ui-layout/src/client/AppFrame.tsx', includes: ['surfaces: 0'], excludes: ["renderSlot('surfaces'"] },
  { file: 'packages/client/ui-surfaces/src/client/apply.ts', includes: ['openWorkspaceSurface', 'openResourceIn', 'openTabIn'], excludes: ['collapseRightPanel', 'ctx.layout.openSurfaces()'] },
  { file: 'packages/client/ui-sidebar-right/src/client/index.ts', includes: ['layout.openRightbar'], excludes: ['layout.closeSurfaces()'] },
  { file: 'packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx', includes: ['data-sidebar-right-guide-only'], excludes: ['restoreClassic'] },
  { file: 'packages/client/ui-titlebar/src/client/apply.ts', includes: ['toggleExpanded()'], excludes: ['layout.toggleSurfaces()'] },
  { file: 'packages/client/ui-titlebar/src/client/PanelToggles.tsx', includes: ['isSurfacesShortcut', 'rightbarShown'] },
  // Keyboard-shortcut adoption (keyboard-shortcuts card): explicit local-first
  // input policy, panel chords owned by the registry, terminal region marker.
  { file: 'packages/client/shortcuts/src/protocol.ts', includes: ["./policy.ts'"] },
  { file: 'packages/client/shortcuts/src/policy.ts', includes: ['localFirstProtected', 'local-first'] },
  { file: 'packages/client/shortcuts/src/client/registry.ts', includes: ['localFirstProtected', "'native-priority'"] },
  { file: 'packages/client/shortcuts/src/client/index.ts', includes: ['shortcutPolicy', "'local-first'"] },
  { file: 'packages/client/ui-titlebar/src/client/apply.ts', includes: ["'shortcuts'", 'surfaces.toggle', 'terminal.drawer.toggle'] },
  { file: 'packages/client/ui-titlebar/src/client/PanelToggles.tsx', includes: ['dataset.platform'] },
  { file: 'packages/client/ui-sidebar-right/src/client/shortcuts.ts', includes: ['DSHD: Ctrl+\\'] },
  { file: 'packages/client/ui-sidebar-terminal/src/client/index.ts', includes: ['terminal.drawer.toggle'] },
  { file: 'packages/client/ui-user-terminal/src/client/TerminalPane.tsx', includes: ['xterm'] },
  // Office preview routing (office-runtime card): binary Office files decline
  // the editable desktop viewer and the surfaces file editor, so the native
  // document preview claims them (Office→PDF, XLSX→Spreadsheet).
  { file: 'packages/client/ui-files/src/client/desktop-files.ts', includes: ['OFFICE_PREVIEW_EXTENSIONS', 'isOfficePreviewPath'] },
  { file: 'packages/client/ui-surfaces/src/client/apply.ts', includes: ['fileAddressFor', 'openResourceIn'] },
  { file: 'packages/client/ui-surfaces/src/client/SurfacesRoot.tsx', includes: ['openOfficeDocument'] },
  // Shared review diff renderer (P4 adoption): business-neutral unified/split
  // rows, wrap, sync scroll, and cancelable highlighting live in ui-primitives.
  // ui-deliverables keeps turn snapshots, ui-diff keeps Git state; both adapt
  // to the shared representation without cross-feature imports.
  { file: 'packages/client/ui-primitives/src/ReviewDiff.tsx', includes: ['data-review-view', 'data-diff-line', 'MAX_RENDERED_LINES'] },
  { file: 'packages/client/ui-primitives/src/ReviewDiff.module.css', includes: ['.add', '.del'] },
  { file: 'packages/client/ui-primitives/tests/review-diff.client.spec.tsx', includes: ['ReviewDiff'] },
  { file: 'packages/client/ui-deliverables/src/client/FileDiff.tsx', includes: ['ReviewDiff'] },
  { file: 'packages/client/ui-diff/src/client/review-hunks.ts', includes: ['ReviewHunk'] },
  { file: 'packages/client/ui-diff/src/client/DiffPanel.tsx', includes: ['ReviewDiff'] },
  { file: 'packages/client/ui-diff/src/client/shell.ts', includes: ["'eof'"] },
  { file: 'packages/client/ui-diff/src/client/locales.ts', includes: ["'view.split'", "'file.truncated'"] },
  { file: 'packages/client/ui-deliverables/src/client/locales.ts', includes: ["'diff.highlightSkipped'"] },
  // Diff highlight Worker (P4/D5): the first tokenize's per-rule scanner build
  // is one atomic ~50-200 ms call no inline slicing can interrupt, so the
  // shipped path tokenizes in a dedicated Worker built from an embedded ?raw
  // bundle; the main thread keeps a bounded sliced fallback.
  { file: 'packages/client/ui-primitives/src/markdown/highlight-engine.ts', includes: ['lineSpans', 'registerGrammarModules'] },
  { file: 'packages/client/ui-primitives/src/markdown/highlight.ts', includes: ['fetchGrammarModule', 'highlight-engine.ts'] },
  { file: 'packages/client/ui-primitives/src/markdown/highlight-jobs.ts', includes: ['dispatchHighlightJobs', 'highlight.worker.ts?raw'] },
  { file: 'packages/client/ui-primitives/src/markdown/highlight.worker.ts', includes: ["op: 'ready'", 'registerGrammarModules'] },
  { file: 'packages/client/ui-primitives/src/css-modules.d.ts', includes: ["'*.ts?raw'"] },
  { file: 'packages/client/ui-primitives/tsdown.config.ts', includes: ['highlight.worker.ts?raw'] },
  { file: 'benchmarks/review-diff/review-diff.bench.ts', includes: ['dsh.reviewDiff.slice', 'HIGHLIGHT_TASK_BUDGET_MS'] },
  { file: 'benchmarks/review-diff/fixtures.ts', includes: ['mixedHunks'] },
  { file: 'apps/web/tests/scaffold.ts', excludes: ['directory-picker-browse'] },
  { file: 'apps/web/tests/models-settings.e2e.ts', includes: ['llm.discoverModels'] },
  // Desktop fork: input.dock panels follow the drag-resized composer card.
  { file: 'apps/web/tests/composer-resize-dock.e2e.ts', includes: ['input.dock panels follow the composer drag width'] },
  // The composer-width e2e driver is host-plane; keep it out of the
  // client-registered apps/web tsc program so the phantom rootDir chain
  // (scaffold → dsh-session-snapshot → loader-smoke) cannot break build:lib.
  { file: 'apps/web/tsconfig.json', includes: ['composer-resize-dock.e2e.ts'] },
  // The conversation header uses More actions; the optional titlebar shortcut keeps the Session log capsule.
  { file: 'apps/web/tests/snapshots/agent-preset-selection/header.expected.md', excludes: ['button "Session log"'] },
  { file: 'package.json', includes: ['copy-ghostty-assets.mjs'] },
  // Composer typing effects (docs/features/composer-typing-fx.md): an
  // Appearance row slot on the upstream settings contract, a transient
  // echo/caret overlay on the Lexical composer (never its text DOM), and the
  // typing-fx preference fields inside the ui-conversation namespace.
  { file: 'packages/client/ui-settings/src/client/contract/slots.ts', includes: ["'settings.appearance.item'", 'SettingsAppearanceItemOwnerProps'] },
  { file: 'packages/client/ui-theme/src/client/index.ts', includes: ["'settings.appearance.item'"] },
  { file: 'packages/client/ui-theme/src/client/AppearanceSection.tsx', includes: ["renderSlot('settings.appearance.item'"] },
  { file: 'packages/client/ui-conversation/src/submission-settings.ts', includes: ['TYPING_FX_FIELD', 'TYPING_FX_EFFECTS', 'TYPING_FX_COLOR_SCHEMES', 'normalizeTypingFxStyle'] },
  { file: 'packages/client/ui-conversation/src/index.ts', includes: ['TYPING_FX_FIELD', 'DEFAULT_TYPING_FX_STYLE'] },
  { file: 'packages/client/ui-conversation/src/client/input/submission-policy.ts', includes: ['typingFxStyle', 'setTypingFxConfiguration'] },
  { file: 'packages/client/ui-conversation/src/client/input/editor/typing-fx.ts', includes: ['typingFxInsertedText', 'MAX_TYPING_FX_ECHOES'] },
  { file: 'packages/client/ui-conversation/src/client/TypingFxLayer.tsx', includes: ['data-typing-fx-echo', 'registerUpdateListener'] },
  { file: 'packages/client/ui-conversation/src/client/TypingFxLayer.module.css', includes: ['dsh-typing-fx-drop', 'prefers-reduced-motion'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx', includes: ['TypingFxLayer'] },
  { file: 'packages/client/ui-conversation/src/client/input/editor/DraftEditor.tsx', includes: ['data-typing-fx-caret'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css', includes: ['caret-color: transparent'] },
  { file: 'packages/client/ui-conversation/src/client/settings/TypingFxRow.tsx', includes: ["'settings.appearance.item'", 'TypingFxModal'] },
  { file: 'packages/client/ui-conversation/src/client/settings/TypingFxModal.tsx', includes: ["'dsh-typing-fx'", 'data-typing-fx-root'] },
  { file: 'packages/client/ui-conversation/src/client/settings/TypingFxModal.module.css', includes: [] },
  { file: 'packages/client/ui-conversation/src/client/apply.ts', includes: ['TypingFxRow', "'settings.appearance.item'", 'typingFx: submissionPolicy.typingFx'] },
  { file: 'packages/client/ui-conversation/src/client/locales.ts', includes: ["'settings.typingFx.title'"] },
  { file: 'packages/client/ui-conversation/tests/typing-fx.client.spec.ts', includes: ['diffInsertedText'] },
  { file: 'packages/client/ui-conversation/tests/typing-fx-layer.client.spec.tsx', includes: ['TypingFxLayer', 'data-typing-fx-echo'] },
  { file: 'packages/client/ui-conversation/tests/typing-fx-row.client.spec.tsx', includes: ['TypingFxRow'] },
  // Win32 drive selection in the in-app directory browser: the seam exports
  // the volume-picker sentinel and the browse backend answers it with the
  // enterable drive roots, prepending the crumb to every Win32 ancestry.
  // Upstream defers drive-root enumeration; the client half of this fork
  // (WINDOWS_VOLUME_ROOT in DirectoryBrowser.tsx) already renders it, so a
  // sync resolved towards upstream must not drop the host half silently.
  { file: 'packages/host/directory-picker/src/index.ts', includes: ['WINDOWS_VOLUME_ROOT'] },
  { file: 'packages/host/directory-picker-browse/src/index.ts', includes: ['WINDOWS_VOLUME_ROOT', 'volumeListing'] },
  { file: 'packages/host/directory-picker-browse/tests/service.spec.ts', includes: ['WINDOWS_VOLUME_ROOT'] },
  // Global main panels get the content row only: only the Conversation owns
  // the shared titlebar row through the centerCol subgrid. Without the
  // row-2 seat a panel lands in row 1, inflates the caption band's track,
  // and buries its top under the titlebar chrome and the window-drag strip
  // (upstream AppFrame files; a sync resolved towards upstream must keep
  // the desktop seat).
  { file: 'packages/client/ui-layout/src/client/AppFrame.tsx', includes: ['css.mainPanel', 'data-main-panel'] },
  { file: 'packages/client/ui-layout/src/client/AppFrame.module.css', includes: ['.mainPanel {', 'grid-row: 2;'] },
  { file: 'packages/client/ui-layout/src/client/index.ts', includes: ['every other key renders inside the content row only'] },
  // The lightbox close control drops below the frameless caption band
  // (--dshd-wco-caption, published by harness-chrome-inject) instead of
  // stacking under the window close button; the fallback keeps plain-browser
  // placement unchanged.
  { file: 'packages/client/ui-primitives/src/ImageLightbox.module.css', includes: ['--dshd-wco-caption'] },
  // The guide tab (开始) draws the same capsule grid the surfaces empty state
  // uses — one picker language across both right-side docks — instead of the
  // upstream row-capsule list. Locale keys give the heading copy.
  { file: 'packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx', includes: ['ShippedGuide', 'css.grid'] },
  { file: 'packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.module.css', includes: ['.grid {', 'aspect-ratio: 1 / 1'] },
  { file: 'packages/client/ui-sidebar-right/src/client/locales.ts', includes: ["'tab.guide.heading'"] },
  { file: 'packages/client/ui-sidebar-right/src/client/index.ts', includes: ['locale: NS'] },
  // ui-preview reads sidebarRightTabs via ctx.get at apply time; upstream's
  // inject list omits it because the web profile disables the Browser type
  // anyway. On our web+desktop profile the entry must register, so the
  // service is a declared injection and the get always resolves.
  { file: 'packages/client/ui-preview/src/client/apply.ts', includes: ["'sidebarRightTabs'"] },
  // The app frame's bg-base carries alpha (transparent-window product); a
  // docked rightbar pane painting it again double-darkens the column, and
  // every occupant root repeating it adds a third. The panel scopes the token
  // to transparent inside docked hosts so the frame's single ground shows
  // through; floats keep their own ground.
  { file: 'packages/client/ui-sidebar-right/src/client/shell/SidebarRight.module.css', includes: ['--dsw-alias-bg-base: transparent'] },
  // The sidebar terminal screen feeds its computed background into the xterm
  // theme; inside the merged dock bg-base resolves transparent, so the well
  // follows the dedicated terminal-pane token instead — the Appearance
  // terminal-opacity slider keeps it readable over the wallpaper.
  { file: 'packages/client/ui-sidebar-terminal/src/client/terminal.module.css', includes: ['--dsw-alias-terminal-pane'] },
];

function readRel(vendorRoot, rel) {
  return fs.readFileSync(path.join(vendorRoot, ...rel.split('/')), 'utf8');
}

function rowBlock(text, id) {
  const pattern = new RegExp(`^\\s*- id: ${id}\\s*$`, 'm');
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }
  const start = match.index;
  const after = text.slice(start + match[0].length);
  const next = after.search(/^\s*- id:/m);
  return text.slice(start, start + match[0].length + (next === -1 ? after.length : next));
}

/**
 * @param {string} vendorRoot
 * @param {string} npmVersion
 */
function assertDesktopForks(vendorRoot, npmVersion) {
  const missing = [];
  const webApp = JSON.parse(readRel(vendorRoot, 'packages/bundle/web-app/package.json'));
  const baseApp = JSON.parse(readRel(vendorRoot, 'packages/bundle/base/package.json'));
  const deps = {
    ...baseApp.dependencies,
    ...baseApp.devDependencies,
    ...webApp.dependencies,
    ...webApp.devDependencies,
  };
  const clientTsconfig = readRel(vendorRoot, 'tsconfig.client.json');
  const layout = readRel(vendorRoot, 'packages/client/ui-layout/src/client/index.ts');
  const scoped = readRel(vendorRoot, 'packages/client/ui-renderer/src/client/scoped-slots.tsx');

  for (const pkg of DESKTOP_PACKAGES) {
    const manifestPath = path.join(vendorRoot, ...pkg.dir.split('/'), 'package.json');
    if (!fs.existsSync(manifestPath)) {
      missing.push(pkg.dir);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== pkg.name) {
      throw new Error(`${pkg.dir} name is ${manifest.name}, expected ${pkg.name}`);
    }
    if (manifest.version !== npmVersion) {
      throw new Error(`${pkg.dir} version is ${manifest.version}, expected ${npmVersion}`);
    }
    if (!deps[pkg.name]) {
      throw new Error(`bundle package.json is missing ${pkg.name}`);
    }
    if (pkg.dir.startsWith('packages/client/') && !clientTsconfig.includes(`./${pkg.dir}`)) {
      throw new Error(`tsconfig.client.json is missing ${pkg.dir}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`missing desktop packages: ${missing.join(', ')}`);
  }

  const files = new Map();
  for (const row of COMPOSITION_ROWS) {
    if (!files.has(row.file)) {
      files.set(row.file, readRel(vendorRoot, row.file));
    }
    const block = rowBlock(files.get(row.file), row.id);
    if (!block) {
      throw new Error(`${row.file} is missing composition id ${row.id}`);
    }
    if (!block.includes(row.name)) {
      throw new Error(`${row.file} id ${row.id} does not name ${row.name}`);
    }
    for (const snippet of row.configIncludes || []) {
      if (!block.includes(snippet)) {
        throw new Error(`${row.file} id ${row.id} is missing ${snippet}`);
      }
    }
  }

  for (const marker of LAYOUT_MARKERS) {
    if (!layout.includes(marker)) {
      throw new Error(`ui-layout is missing ${marker}`);
    }
  }
  if (!scoped.includes('session-maybe') || !scoped.includes("{ key: '' }")) {
    throw new Error('scoped-slots.tsx no longer binds session-maybe to an empty string');
  }

  for (const marker of FORK_FILE_MARKERS) {
    const text = readRel(vendorRoot, marker.file);
    for (const snippet of marker.includes || []) {
      if (!text.includes(snippet)) {
        throw new Error(`${marker.file} no longer contains ${JSON.stringify(snippet)}`);
      }
    }
    for (const snippet of marker.excludes || []) {
      if (text.includes(snippet)) {
        throw new Error(`${marker.file} must not contain ${JSON.stringify(snippet)}`);
      }
    }
  }
}

module.exports = {
  DESKTOP_PACKAGES,
  COMPOSITION_ROWS,
  FORK_FILE_MARKERS,
  assertDesktopForks,
};
