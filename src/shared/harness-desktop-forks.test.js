'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DESKTOP_PACKAGES,
  COMPOSITION_ROWS,
  FORK_FILE_MARKERS,
  assertDesktopForks,
} = require('./harness-desktop-forks');

function writeFile(root, rel, content) {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeFixture(t, npmVersion = '0.1.0-rc.5') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-forks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deps = {};
  const clientRefs = [];
  for (const pkg of DESKTOP_PACKAGES) {
    writeFile(root, `${pkg.dir}/package.json`, `${JSON.stringify({ name: pkg.name, version: npmVersion }, null, 2)}\n`);
    deps[pkg.name] = 'workspace:^';
    if (pkg.dir.startsWith('packages/client/')) {
      clientRefs.push(`    { "path": "./${pkg.dir}" }`);
    }
  }
  writeFile(root, 'packages/bundle/web-app/package.json', `${JSON.stringify({ dependencies: deps }, null, 2)}\n`);
  writeFile(root, 'packages/bundle/base/package.json', `${JSON.stringify({ dependencies: deps }, null, 2)}\n`);
  writeFile(root, 'tsconfig.client.json', `{\n  "references": [\n${clientRefs.join(',\n')}\n  ]\n}\n`);
  writeFile(root, 'packages/bundle/base/cordis.patch.yml', [
    '- insert:',
    '    - id: llm-vision-fallback',
    "      name: '@deepseek-ai/dsh-llm-vision-fallback'",
    '      config:',
    '        maxOutputTokens: 2048',
    '        timeoutMs: 120000',
    '    - id: mcp-servers-file',
    "      name: '@deepseek-ai/dsh-mcp-servers-file'",
    '',
  ].join('\n'));
  const webRows = COMPOSITION_ROWS
    .filter((row) => row.file === 'packages/bundle/web-app/cordis.patch.yml')
    .map((row) => `    - id: ${row.id}\n      name: '${row.name}'`)
    .join('\n');
  writeFile(root, 'packages/bundle/web-app/cordis.patch.yml', `- insert:\n${webRows}\n`);
  writeFile(root, 'packages/client/ui-layout/src/client/index.ts', [
    "export interface TitlebarTrailingOwnerProps { surfaces: number }",
    "    'surfaces': { kind: 'single', scope: 'session-maybe' },",
    "    'shell.titlebar.trailing': { kind: 'list', scope: 'root' },",
    "    'shell.terminalDrawer': { kind: 'single', scope: 'session-maybe' },",
    '',
  ].join('\n'));
  writeFile(root, 'packages/client/ui-layout/src/client/AppFrame.tsx', [
    'return <div className={css.mainPanel} data-main-panel>{panel}</div>',
    'surfaces: layoutInfo.surfaces,',
    '',
  ].join('\n'));
  writeFile(root, 'packages/client/ui-surfaces/src/client/apply.ts', [
    "name: 'surfaces'",
    'SurfacesRoot',
    'openClassicSurfaces',
    'collapseRightPanel',
    'ctx.layout.openSurfaces()',
    '',
  ].join('\n'));
  writeFile(root, 'packages/client/ui-titlebar/src/client/apply.ts', "ctx.layout.toggleSurfaces()\n");
  writeFile(root, 'packages/client/ui-titlebar/src/client/PanelToggles.tsx', 'isSurfacesShortcut\n');
  writeFile(root, 'packages/client/ui-renderer/src/client/scoped-slots.tsx', [
    "  const scopedStoreBinding = scope === 'session-maybe' && scopeBinding?.key === undefined ? { key: '' } : scopeBinding",
    '',
  ].join('\n'));
  for (const marker of FORK_FILE_MARKERS) {
    const content = {
      'packages/experimental/agent-team/src/index.ts': 'registerManagedPolicy\n',
      'packages/experimental/agent-team/src/managed.ts': 'ManagedTeamController\n',
      'packages/experimental/agent-team/src/types.ts': 'PrepareTeamMemberRequest\n',
      'packages/subagent/subagent/src/index.ts': 'registerContinuationPolicy\n',
      'packages/subagent/subagent/src/descriptor.ts': 'agentPreset admissionPolicy\n',
      'packages/api/session-controller/src/index.ts': 'registerManagedPolicy bindManagedSession\n',
      'packages/client/ui-sidebar/src/client/index.ts': 'selectTab\n',
      'packages/client/ui-primitives/src/index.ts': "export { SettingsSelect } from './SettingsSelect.tsx'\nexport { ReviewDiff } from './ReviewDiff.tsx'\n",
      'packages/client/ui-primitives/src/ReviewDiff.tsx': 'export const MAX_RENDERED_LINES = 5000\ndata-review-view\ndata-diff-line\n',
      'packages/client/ui-primitives/src/ReviewDiff.module.css': '.add {}\n.del {}\n',
      'packages/client/ui-primitives/tests/review-diff.client.spec.tsx': 'import { ReviewDiff }\n',
      'packages/client/ui-deliverables/src/client/FileDiff.tsx': 'import { ReviewDiff }\n',
      'packages/client/ui-diff/src/client/review-hunks.ts': 'import type { ReviewHunk }\n',
      'packages/client/ui-diff/src/client/DiffPanel.tsx': 'import { ReviewDiff }\n',
      'packages/client/ui-diff/src/client/shell.ts': "kind: 'context' | 'add' | 'del' | 'eof'\n",
      'packages/client/ui-diff/src/client/locales.ts': "'view.split': '分栏视图',\n'file.truncated': '仅显示前 {count} 行',\n",
      'packages/client/ui-deliverables/src/client/locales.ts': "'diff.highlightSkipped': '部分内容过大，未语法高亮',\n",
      'packages/client/ui-primitives/src/markdown/highlight-engine.ts': 'export function lineSpans() {}\nexport function registerGrammarModules() {}\n',
      'packages/client/ui-primitives/src/markdown/highlight.ts': "export function fetchGrammarModule() {}\nimport './highlight-engine.ts'\n",
      'packages/client/ui-primitives/src/markdown/highlight-jobs.ts': "export function dispatchHighlightJobs() {}\nimport('./highlight.worker.ts?raw')\n",
      'packages/client/ui-primitives/src/markdown/highlight.worker.ts': "{ op: 'ready' }\nregisterGrammarModules\n",
      'packages/client/ui-primitives/src/css-modules.d.ts': "declare module '*.ts?raw' {}\n",
      'packages/client/ui-primitives/tsdown.config.ts': 'highlight.worker.ts?raw\n',
      'benchmarks/review-diff/review-diff.bench.ts': "dsh.reviewDiff.slice\nconst HIGHLIGHT_TASK_BUDGET_MS = 50\n",
      'benchmarks/review-diff/fixtures.ts': 'export function mixedHunks() {}\n',
      'packages/client/ui-settings-mcp/src/client/McpSection.tsx': 'export const editor = () => <SettingsSelect variant="block" />\n',
      'packages/client/ui-settings-skills/src/client/SkillsSection.tsx': 'export const filter = () => <SettingsSelect aria-label="source" />\n',
      'packages/client/ui-settings-general/src/client/CloseBehaviorRow.tsx': 'export const close = () => <SettingsSelect aria-label="close" />\n',
      'packages/client/ui-settings-general/src/client/AutoStartDesktopRow.tsx': 'export const autoStart = () => <SettingsSelect aria-label="auto-start" />\n',
      'packages/client/ui-settings-general/src/client/HarnessRestartRow.tsx': 'export const restart = () => <SettingsSelect aria-label="restart" />\n',
      'packages/client/ui-settings-general/src/client/AboutSection.tsx': 'export function AboutSection() { return shell.openDshHome() }\n',
      'packages/client/ui-settings-general/src/client/RemoteWorkspaceRow.tsx': 'export const remote = () => shell.saveConfig({ remoteWorkspaceEnabled: next })\n',
      'packages/client/ui-settings-general/src/client/RemoteWorkspaceRow.module.css': '.row { display: flex; }\n',
      'packages/client/ui-settings-general/src/client/index.ts': "import { RemoteWorkspaceRow } from './RemoteWorkspaceRow.tsx'\n",
      'packages/client/ui-settings-general/src/client/locales.ts': "'remoteWorkspace.title': '远程工作区（SSH）',\n",
      'packages/client/ui-settings-general/src/client/desktop-shell.ts': 'remoteWorkspaceEnabled?: boolean\n',
      'packages/client/locale/src/client/LanguageRow.tsx': 'export const language = () => <SettingsSelect aria-label="language" />\n',
      'packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx': 'export const enter = () => <SettingsSelect aria-label="enter" />\n',
      'packages/client/ui-permission-presets/src/client/PermissionRow.tsx': 'export const permission = () => <SettingsSelect aria-label="permission" />\n',
      'packages/client/ui-settings-models/src/client/models-dev-metadata.ts': 'export const MODELS_DEV_URL = "https://models.dev/api.json"\n',
      'packages/client/ui-settings-models/scripts/live-fetch-enrich-probe.ts': '// live probe\n',
      'packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx': 'export const gallery = () => null\n',
      'packages/client/ui-theme/src/client/WallpaperRow.tsx': 'export const row = () => null\n',
      'packages/client/ui-theme/src/client/AppearanceSection.module.css': '.rowTitle { font-size: 14px; }\n',
      'packages/client/ui-theme/src/client/BackgroundEffectRow.tsx': 'className={css.rowTitle}\n',
      'packages/client/ui-theme/src/client/CursorEffectRow.tsx': 'className={css.rowTitle}\n',
      'packages/client/ui-theme/src/client/MetallicPaintRow.tsx': 'className={css.rowTitle}\n',
      'packages/client/ui-chat/src/client/chat/StatsPills.module.css': '.root { max-width: calc(var(--dsh-composer-resized-width, 100%) - 32px); }\n',
      'packages/client/ui-chat/src/client/chat/ChatView.module.css': '.column { max-width: calc(var(--dsh-composer-resized-width, 100%) - 32px); }\n',
      'packages/client/ui-conversation/src/client/skeleton/ComposerResizeHandles.tsx': 'export const host = () => el?.closest("[data-conversation-scroll]")\n',
      'packages/client/ui-conversation/src/client/queue/QueueDock.module.css': '.dock { max-width: calc(var(--dsh-composer-resized-width, 100%) - 16px); }\n',
      'packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css': '.root { max-width: calc(var(--dsh-composer-resized-width, 100%) - 32px); }\n',
      'packages/client/ui-goal/src/client/GoalBar.module.css': '.bar { max-width: calc(var(--dsh-composer-resized-width, 100%) - 32px); }\n',
      'packages/client/ui-theme/src/wallpaper.ts': "export const TRANSPARENT_ATTR = 'data-dsh-transparent'\n",
      'packages/client/ui-theme/src/styles/wallpaper.css': 'html[data-dsh-transparent] #dsh-wallpaper::after { background: transparent }\n',
      'packages/client/ui-model-selection/src/client/ModelSelect.tsx': "<FlipText className={css.triggerLabel} text={modelLabel} />\n<FlipText className={css.triggerEffort} text={effortLabel} />\n",
      'packages/client/ui-model-selection/src/client/ModelSelect.module.css': "/* FlipText's recipe root is inline-grid;\n.triggerLabel[data-dsh-motion='flip'],\n.triggerEffort[data-dsh-motion='flip'] {\n  display: var(--dsh-composer-model-text-display, inline-grid);\n}\n",
      'packages/client/ui-chat/src/client/settings/PreferenceRow.tsx': '<FlipText className={css.selectorLabel} text={selectedLabel} />\n',
      'packages/client/ui-primitives/src/Menu.tsx': 'const { mounted, state } = usePresence(open)\ndata-dsh-motion="popover"\ndata-state={state}\n',
      'packages/client/ui-primitives/src/DisclosureRow.tsx': 'const { mounted, state } = usePresence(open)\ndata-dsh-motion="fade"\ndata-state={state}\n',
      'packages/client/ui-input-trigger/src/client/MenuView.tsx': "const lastOpen = useRef(state)\nconst lastOpenCrumbs = useRef(crumbs)\nif (state.open) {\n  lastOpen.current = state\n  lastOpenCrumbs.current = crumbs\n}\nconst view = state.open ? state : lastOpen.current\nconst { mounted, state: motionState } = usePresence(state.open)\ndata-dsh-motion=\"popover\"\ndata-state={motionState}\n",
      'packages/client/ui-primitives/src/HoverCard.tsx': "const compactMotion = variant === 'compact' && !inline\nconst { mounted: cardMounted, state: cardState } = usePresence(compactMotion && open)\ndata-dsh-motion={compactMotion ? 'popover' : undefined}\ndata-state={compactMotion ? cardState : closing ? 'closed' : 'open'}\n",
      'packages/client/ui-primitives/src/Tooltip.tsx': 'data-dsh-motion="fade"\ndata-state={state}\nusePresence(requestedVisible && !disabled)\n',
      'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css': ':global(html[data-dsh-wallpaper]:not([data-dsh-transparent])) .composerSeat {}\n.heroWorkspaceRow { max-width: var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width)); align-self: center; }\n',
      'packages/client/ui-conversation/src/client/ComposerBeam.tsx': '<div data-composer-beam="" data-beam-breathing="off" style={{ "--dsh-composer-beam-period": "1.96s", "--dsh-composer-beam-bloom-opacity": 0.36, "--dsh-composer-beam-track-width": "2px" }} />\n',
      'packages/client/ui-conversation/src/client/ComposerBeam.module.css': '.beamLayer { inset: -4px; corner-shape: round; }\n.beamStroke { padding: var(--dsh-composer-beam-track-width, 2px); mask: conic-gradient(transparent 30%); -webkit-mask-composite: source-in, xor; mask-composite: intersect, exclude; }\n.beamInner { mask-composite: add; }\n.beamBloom { filter: blur(var(--dsh-composer-beam-glow-blur, 8px)); }\n.beamBloom::before {}\n',
      'packages/client/ui-chat/src/client/chat/StatsPills.tsx': '<div data-stats-line={rowState} />\n',
      'packages/api/workspace-controller/src/types.ts': 'export interface WorkspaceBaseline { readonly scratchCwd: string }\n',
      'packages/api/workspace-controller/src/index.ts': "export function scratchWorkspaceCwd() { return dshHomePath('no-workspace') }\n",
      'packages/api/workspace-controller/src/client/model.ts': 'export interface WorkspaceSnapshot { readonly scratchCwd?: string }\n',
      'packages/workspace/workspace/src/index.ts': 'private async readoptableSessionIds(canonical: string) {} workspace/session-before-archive\n',
      'packages/client/ui-workspace/src/client/navigation.ts': 'connectNoDirectory() { return this.workspaces.list.getSnapshot().scratchCwd }\nconnectScratchCwd() { return this.workspaces.list.getSnapshot().scratchCwd }\ndeleteWorkspace() {}\nregisterDirectoryAction() {}\n',
      'packages/client/ui-workspace/src/client/tree.ts': 'export function isNoDirectorySession() {}\nexport function currentGroupKey() {}\n',
      'packages/client/ui-workspace/src/client/WorkspacePicker.tsx': "const NO_DIRECTORY = '::no-directory'\nonPickNoDirectory?.()\n",
      'packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx': '<TasksSectionHeader onCreate={() => { connectNoDirectory() }} /><GroupSessionRun open={group.expanded} />\n',
      'packages/client/ui-workspace/src/client/locales.ts': "'menu.noDirectory': 'No workspace folder',\n",
      'packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx': 'const noDirectorySession = false\nvoid selectNoDirectory()\n',
      'packages/client/ui-conversation/src/client/apply.ts': "selectNoDirectory: async () => { await workspaceNavigation.openNoDirectory() }\nimport { TypingFxRow } from './settings/TypingFxRow.tsx'\nctx.slots.inject('settings.appearance.item', () => {})\ntypingFx: submissionPolicy.typingFx\n",
      'packages/client/ui-conversation/src/client/locales.ts': "'hero.noDirectory': 'No workspace folder',\n'settings.typingFx.title': '输入特效',\n",
      'packages/api/workspace-controller/tsconfig.host.json': '{"references":[{"path":"../../util/home-paths"}]}\n',
      'packages/api/workspace-controller/package.json': '{"peerDependencies":{"@deepseek-ai/dsh-home-paths":"workspace:^"}}\n',
      'apps/cli/src/args.ts': "program.option('--skip-user-plugins', 'boot the shipped bundle template')\nconst { patches, skipUserPlugins, args } = opts\n",
      'packages/boot/app-boot/src/profile.ts': "options.bundles === 'template'\ntemplate?.bundles ?? dropRetiredBundles\n",
      'packages/boot/app-boot/src/profile-context.ts': "bundles: context.skipUserPlugins === true ? 'template' : 'manifest'\n",
      'apps/cli/src/dump-config.ts': 'export function dumpConfigLayers(options: { skipUserPlugins?: boolean }) {}\n',
      'tsconfig.host.json': '{"references":[{"path":"packages/host/mcp-servers"},{"path":"packages/host/skill-inventory"},{"path":"packages/llm/llm-vision-fallback"},{"path":"packages/mcp/mcp-servers-file"}]}\n',
      'tsconfig.base.json': '{"paths":{"@deepseek-ai/dsh-host-mcp-servers":[],"@deepseek-ai/dsh-host-skill-inventory":[],"@deepseek-ai/dsh-llm-vision-fallback":[],"@deepseek-ai/dsh-mcp-servers-file":[]}}\n',
      'apps/cli/tests/web-agent-presets.e2e.ts': "    { insert: [\n      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },\n    ] },\n",
      'packages/preset/agent-preset-registry/src/definition.ts': 'export interface PresetDefinition { readonly hidden?: boolean }\n',
      'packages/preset/agent-preset-registry/src/index.ts': "...(record.config.hidden === true ? { hidden: true } : {}),\n.filter(row => row.hidden !== true || row.broken !== undefined)\n",
      'packages/preset/agent-preset-registry/tests/registry.spec.ts': "it('keeps a healthy hidden preset off the roster while resolving and mounting it by id', () => {})\n",
      'apps/web/tests/settings-chrome.e2e.ts': "const loading = page.getByText(/正在加载插件/)\n",
      'packages/client/ui-layout/src/client/index.ts': "surfaces: number\nsurfaces: { kind: 'single', scope: 'session-maybe' }\nshell.titlebar.trailing\nshell.terminalDrawer\n",
      'packages/client/ui-layout/src/client/AppFrame.tsx': "surfaces: 0 css.mainPanel data-main-panel\n",
      'packages/client/ui-surfaces/src/client/apply.ts': "openWorkspaceSurface openResourceIn openTabIn fileAddressFor\n",
      'packages/client/ui-titlebar/src/client/apply.ts': "toggleExpanded() 'shortcuts' surfaces.toggle terminal.drawer.toggle\n",
      'packages/client/ui-titlebar/src/client/PanelToggles.tsx': "isSurfacesShortcut rightbarShown dataset.platform\n",
      'packages/client/ui-surfaces/src/client/SurfacesRoot.tsx': 'SurfaceTabs EmptyState\nopenOfficeDocument\n',
      'packages/client/ui-sidebar-right/src/client/index.ts': "layout.openRightbar locale: NS\n",
      'packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx': 'ShippedGuide\ncss.grid\n',
      'packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.module.css': '.grid {\naspect-ratio: 1 / 1\n',
      'packages/client/ui-sidebar-right/src/client/locales.ts': "'tab.guide.heading'\n",
      'packages/client/ui-sidebar-right/src/client/shell/SidebarRight.module.css': '--dsw-alias-bg-base: transparent\n',
      'packages/client/ui-sidebar-terminal/src/client/terminal.module.css': 'background: var(--dsw-alias-terminal-pane, var(--dsw-alias-bg-base));\n',
      'packages/client/ui-preview/src/client/apply.ts': "'sidebarRightTabs'\n",
      'packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx': "data-sidebar-right-guide-only\n",
      'apps/web/tests/models-settings.e2e.ts': "await page.route('**/api/llm.discoverModels', async (route) => {\n",
      'apps/web/tests/composer-resize-dock.e2e.ts': "describe('desktop fork: input.dock panels follow the composer drag width', () => {\n",
      'apps/web/tsconfig.json': '{\n  "exclude": ["tests/composer-resize-dock.e2e.ts"]\n}\n',
      'apps/web/tests/snapshots/agent-preset-selection/header.expected.md': '- navigation "Session hierarchy"\n',
      'package.json': '"build:lib:client": "node packages/client/ui-user-terminal/scripts/copy-ghostty-assets.mjs"\n',
      'packages/client/ui-settings/src/client/contract/slots.ts': "'settings.appearance.item': { kind: 'list', scope: 'root', owner: SettingsAppearanceItemOwnerProps }\ninterface SettingsAppearanceItemOwnerProps {}\n",
      'packages/client/ui-theme/src/client/index.ts': "children: { 'settings.appearance.item': { kind: 'list', scope: 'root' } }\n",
      'packages/client/ui-theme/src/client/AppearanceSection.tsx': "{renderSlot('settings.appearance.item', {})}\n",
      'packages/client/ui-conversation/src/submission-settings.ts': "const TYPING_FX_FIELD = 'typingFx'\nconst TYPING_FX_EFFECTS = ['drop']\nconst TYPING_FX_COLOR_SCHEMES = ['ocean']\nfunction normalizeTypingFxStyle() {}\n",
      'packages/client/ui-conversation/src/index.ts': "export { TYPING_FX_FIELD, DEFAULT_TYPING_FX_STYLE }\n",
      'packages/client/ui-conversation/src/client/input/submission-policy.ts': 'readonly typingFxStyle = {}\nsetTypingFxConfiguration() {}\n',
      'packages/client/ui-conversation/src/client/input/editor/typing-fx.ts': 'export function typingFxInsertedText() {}\nexport const MAX_TYPING_FX_ECHOES = 24\n',
      'packages/client/ui-conversation/src/client/TypingFxLayer.tsx': 'data-typing-fx-echo={echo.id}\neditor.registerUpdateListener\n',
      'packages/client/ui-conversation/src/client/TypingFxLayer.module.css': '@keyframes dsh-typing-fx-drop {}\n@media (prefers-reduced-motion: reduce) {}\n',
      'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx': 'import { TypingFxLayer } from "../TypingFxLayer.tsx"\ndata-typing-fx-caret\n',
      'packages/client/ui-conversation/src/client/input/editor/DraftEditor.tsx': 'data-typing-fx-caret\n',
      'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css': '.input[data-typing-fx-caret] { caret-color: transparent; }\n.dock { max-width: var(--dsh-composer-resized-width); }\n',
      'packages/client/ui-conversation/src/client/settings/TypingFxRow.tsx': "PropsRuntime<'settings.appearance.item'>\nimport { TypingFxModal } from './TypingFxModal.tsx'\n",
      'packages/client/ui-conversation/src/client/settings/TypingFxModal.tsx': "const TYPING_FX_EXPORT_CORE = 'dsh-typing-fx'\ndata-typing-fx-root\n",
      'packages/client/ui-conversation/tests/typing-fx.client.spec.ts': 'diffInsertedText(\n',
      'packages/client/ui-conversation/tests/typing-fx-layer.client.spec.tsx': 'import { TypingFxLayer }\ndata-typing-fx-echo\n',
      'packages/client/ui-conversation/tests/typing-fx-row.client.spec.tsx': 'import { TypingFxRow }\n',
      'packages/host/directory-picker/src/index.ts': "export const WINDOWS_VOLUME_ROOT = '\\\\.\\\\dsh-computer'\n",
      'packages/host/directory-picker-browse/src/index.ts': 'async function volumeListing() {}\nconst sentinel = WINDOWS_VOLUME_ROOT\n',
      'packages/host/directory-picker-browse/tests/service.spec.ts': 'WINDOWS_VOLUME_ROOT\n',
      'packages/client/ui-layout/src/client/AppFrame.tsx': "surfaces: 0 css.mainPanel data-main-panel\n",
      'packages/client/ui-layout/src/client/AppFrame.module.css': '.mainPanel { grid-row: 2; }\n',
      'packages/client/ui-primitives/src/ImageLightbox.module.css': '.close { top: calc(20px + var(--dshd-wco-caption, 0px)); }\n',
      'packages/client/ui-layout/src/client/index.ts': "surfaces: number\n    'surfaces': { kind: 'single', scope: 'session-maybe' },\n    'shell.titlebar.trailing': { kind: 'list', scope: 'root' },\n    'shell.terminalDrawer': { kind: 'single', scope: 'session-maybe' },\n    // every other key renders inside the content row only\n",
      'packages/client/ui-surfaces/src/client/apply.ts': "openWorkspaceSurface openResourceIn openTabIn fileAddressFor\n",
      'packages/client/ui-surfaces/src/client/EmptyState.tsx': 'SidebarRightGuideBox\nEmptyStateGuide\n',
      'packages/client/ui-surfaces/tests/empty-state.client.spec.tsx': 'guide(\n',
      'packages/client/ui-surfaces/src/client/SurfacesRoot.tsx': 'SurfaceTabs\nEmptyState\nopenOfficeDocument\nuseSyncExternalStore\n',
      'packages/client/ui-files/src/client/desktop-files.ts': 'OFFICE_PREVIEW_EXTENSIONS\nisOfficePreviewPath\n',
      'packages/client/ui-titlebar/src/client/apply.ts': "toggleExpanded() 'shortcuts' surfaces.toggle terminal.drawer.toggle\n",
      'packages/client/ui-titlebar/src/client/PanelToggles.tsx': "isSurfacesShortcut rightbarShown dataset.platform\n",
      'packages/client/shortcuts/src/protocol.ts': "export * from './policy.ts'\n",
      'packages/client/shortcuts/src/policy.ts': 'localFirstProtected\nlocal-first\n',
      'packages/client/shortcuts/src/client/registry.ts': "localFirstProtected\n'native-priority'\n",
      'packages/client/shortcuts/src/client/index.ts': "shortcutPolicy\n'local-first'\n",
      'packages/llm/llm-pi-ai/src/catalog.ts': 'compactionThreshold?: number\n',
      'packages/llm/llm-pi-ai/src/config.ts': 'configuredCompactionThresholds\ncompactionThreshold: z.number()\n',
      'packages/llm/llm-pi-ai/src/adapter.ts': 'configuredCompactionThresholds\n',
      'packages/llm/llm/src/types.ts': 'compactionThreshold?: number\n',
      'packages/llm/llm/src/index.ts': 'compactionThreshold\n',
      'packages/compaction/compaction-basic/src/config.ts': 'compactionThreshold\n',
      'packages/compaction/compaction-basic/src/index.ts': 'info.context.compactionThreshold\n',
      'packages/client/ui-sidebar-right/src/client/shortcuts.ts': 'DSHD: Ctrl+\\\n',
      'packages/client/ui-sidebar-terminal/src/client/index.ts': 'terminal.drawer.toggle\n',
      'packages/client/ui-user-terminal/src/client/TerminalPane.tsx': 'xterm\n',
    };
    const projectSeams = {
      'apps/cli/src/profile-boot.ts': 'export async function disposeProfileApplication\nfor (const release of [() => projects?.dispose?.(), () => ctx?.fiber.dispose()])\ndisposeProfileApplication(app.current)\ninstallFailLoud(NAME, process, dispose)\n',
      'packages/subagent/subagent/src/types.ts': 'interface ContinuableEnvironment { readonly cwd?: string; readonly agentPreset?: string; readonly admissionPolicy?: string }\n',
      'packages/subagent/subagent/src/child-agent.ts': 'environment?.cwd ?? parentHeader.cwd\nenvironment?.agentPreset ?? agentPreset\nawait presets.mount(childCtx, composition.agentPreset)\n',
      'packages/subagent/subagent/src/descriptor.ts': 'agentPreset admissionPolicy\n',
      'packages/subagent/subagent/src/continuation.ts': "admitContinuation reason: 'start' reason: 'message' agentPreset: descriptor.agentPreset\n",
      'packages/subagent/subagent/src/continuation-activation.ts': "notifyManagedSettlement reason: 'settlement' activation.observer.runId\n",
      'packages/subagent/subagent/src/continuation-messages.ts': 'readonly runId?: SubagentRunId\n',
      'packages/subagent/subagent/src/lifecycle.ts': 'readonly runId: SubagentRunId\n',
      'packages/subagent/subagent/src/index.ts': 'registerContinuationPolicy\n',
      'packages/subagent/subagent-in-process-driver/src/index.ts': 'const setup = async\nawait applyChildComposition\n',
      'packages/api/session-controller/src/commands.ts': "await this.ctx.serial('session/before-cancel'\nasync cancel(request:\n&& !pluginPresentation\n",
      'packages/api/session-controller/src/index.ts': "'session/before-cancel'\ncancel(request: SessionCancelRequest): Promise<SessionCancelValue>\n",
      'packages/client/ui-sidebar/src/client/index.ts': 'selectTab\n',
    };
    writeFile(root, marker.file, projectSeams[marker.file] ?? content[marker.file] ?? 'export {}\n');
  }
  return root;
}

test('assertDesktopForks accepts a complete fixture', (t) => {
  const root = makeFixture(t);
  assert.doesNotThrow(() => assertDesktopForks(root, '0.1.0-rc.5'));
});

test('assertDesktopForks throws when ui-titlebar is missing', (t) => {
  const root = makeFixture(t);
  fs.rmSync(path.join(root, 'packages', 'client', 'ui-titlebar'), { recursive: true, force: true });
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /ui-titlebar/);
});

test('assertDesktopForks throws when a parked fork marker regresses', (t) => {
  const root = makeFixture(t);
  const indexPath = path.join(root, ...'packages/client/ui-primitives/src/index.ts'.split('/'));
  fs.writeFileSync(indexPath, "export { Button } from './Button.tsx'\n");
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /SettingsSelect/);
});

test('assertDesktopForks throws when the ModelSelect model label stops using FlipText', (t) => {
  const root = makeFixture(t);
  const modelSelectPath = path.join(root, ...'packages/client/ui-model-selection/src/client/ModelSelect.tsx'.split('/'));
  const text = fs.readFileSync(modelSelectPath, 'utf8');
  const reverted = text.replace(
    '<FlipText className={css.triggerLabel} text={modelLabel} />',
    '<span className={css.triggerLabel}>{modelLabel}</span>',
  );
  assert.notStrictEqual(reverted, text);
  fs.writeFileSync(modelSelectPath, reverted);
  assert.throws(
    () => assertDesktopForks(root, '0.1.0-rc.5'),
    /ModelSelect\.tsx no longer contains .*triggerLabel} text=\{modelLabel\}/,
  );
});

test('assertDesktopForks throws when the ModelSelect effort label stops using FlipText', (t) => {
  const root = makeFixture(t);
  const modelSelectPath = path.join(root, ...'packages/client/ui-model-selection/src/client/ModelSelect.tsx'.split('/'));
  const text = fs.readFileSync(modelSelectPath, 'utf8');
  const reverted = text.replace(
    '<FlipText className={css.triggerEffort} text={effortLabel} />',
    '<span className={css.triggerEffort}>{effortLabel}</span>',
  );
  assert.notStrictEqual(reverted, text);
  fs.writeFileSync(modelSelectPath, reverted);
  assert.throws(
    () => assertDesktopForks(root, '0.1.0-rc.5'),
    /ModelSelect\.tsx no longer contains .*triggerEffort} text=\{effortLabel\}/,
  );
});

test('assertDesktopForks throws when the ModelSelect flip display selector is removed', (t) => {
  const root = makeFixture(t);
  const modelSelectCssPath = path.join(root, ...'packages/client/ui-model-selection/src/client/ModelSelect.module.css'.split('/'));
  const text = fs.readFileSync(modelSelectCssPath, 'utf8');
  const reverted = text.replace(
    ".triggerLabel[data-dsh-motion='flip'],\n.triggerEffort[data-dsh-motion='flip'] {\n  display: var(--dsh-composer-model-text-display, inline-grid);\n}",
    '',
  );
  assert.notStrictEqual(reverted, text);
  fs.writeFileSync(modelSelectCssPath, reverted);
  assert.throws(
    () => assertDesktopForks(root, '0.1.0-rc.5'),
    /ModelSelect\.module\.css no longer contains .*triggerLabel\[data-dsh-motion='flip'\]/,
  );
});

test('assertDesktopForks throws when the ModelSelect flip display fallback regresses', (t) => {
  const root = makeFixture(t);
  const modelSelectCssPath = path.join(root, ...'packages/client/ui-model-selection/src/client/ModelSelect.module.css'.split('/'));
  const text = fs.readFileSync(modelSelectCssPath, 'utf8');
  const reverted = text.replace(
    'display: var(--dsh-composer-model-text-display, inline-grid);',
    'display: var(--dsh-composer-model-text-display, block);',
  );
  assert.notStrictEqual(reverted, text);
  fs.writeFileSync(modelSelectCssPath, reverted);
  assert.throws(
    () => assertDesktopForks(root, '0.1.0-rc.5'),
    /ModelSelect\.module\.css no longer contains .*inline-grid/,
  );
});

test('assertDesktopForks throws when the header golden regains Session log', (t) => {
  const root = makeFixture(t);
  const goldenPath = path.join(root, ...'apps/web/tests/snapshots/agent-preset-selection/header.expected.md'.split('/'));
  fs.writeFileSync(goldenPath, '- button "Session log"\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /Session log/);
});

test('assertDesktopForks throws when hidden agent-preset support drops back out', (t) => {
  const root = makeFixture(t);
  const registryPath = path.join(root, ...'packages/preset/agent-preset-registry/src/index.ts'.split('/'));
  fs.writeFileSync(registryPath, 'return { presets: await this.list() }\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /hidden|roster/);
});

test('assertDesktopForks throws when the single right-panel contract regresses', (t) => {
  const root = makeFixture(t);
  const applyPath = path.join(root, ...'packages/client/ui-surfaces/src/client/apply.ts'.split('/'));
  fs.writeFileSync(applyPath, "ctx.slots.inject('surfaces', () => {})\n");
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /ui-surfaces\/src\/client\/apply\.ts no longer contains/);
});

test('assertDesktopForks throws when transparent theme markers drop', (t) => {
  const root = makeFixture(t);
  const wallpaperPath = path.join(root, ...'packages/client/ui-theme/src/wallpaper.ts'.split('/'));
  fs.writeFileSync(wallpaperPath, 'export const WALLPAPER_ATTR = "data-dsh-wallpaper"\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /TRANSPARENT_ATTR|data-dsh-transparent/);
});

test('assertDesktopForks throws when composer beam corner coverage regresses', (t) => {
  const root = makeFixture(t);
  const beamPath = path.join(root, ...'packages/client/ui-conversation/src/client/ComposerBeam.module.css'.split('/'));
  fs.writeFileSync(beamPath, '.beamLayer { inset: 0; overflow: hidden; }\n.beamBloom { filter: blur(8px); }\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /beamBloom::before|inset: -4px|track-width|source-in, xor/);
});

test('assertDesktopForks throws when the no-directory picker entry or the Ungrouped bucket regress', (t) => {
  const root = makeFixture(t);
  const pickerPath = path.join(root, ...'packages/client/ui-workspace/src/client/WorkspacePicker.tsx'.split('/'));
  fs.writeFileSync(pickerPath, "const ADD_WORKSPACE = '::add-workspace'\n");
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /NO_DIRECTORY/);

  const fixed = makeFixture(t);
  const localesPath = path.join(fixed, ...'packages/client/ui-workspace/src/client/locales.ts'.split('/'));
  fs.writeFileSync(localesPath, "'menu.noDirectory': 'No workspace folder',\n'group.ungrouped': 'Ungrouped',\n");
  assert.throws(() => assertDesktopForks(fixed, '0.1.0-rc.5'), /Ungrouped/);
});

test('assertDesktopForks throws when copy-ghostty-assets drops out of package.json', (t) => {
  const root = makeFixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /copy-ghostty-assets/);
});

test('assertDesktopForks accepts the current pinned vendor tree', () => {
  const root = path.join(__dirname, '..', '..');
  const vendor = path.join(root, 'vendor', 'deepseek-harness');
  const pin = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'harness-upstream.json'), 'utf8'));
  assertDesktopForks(vendor, pin.npm);
});
