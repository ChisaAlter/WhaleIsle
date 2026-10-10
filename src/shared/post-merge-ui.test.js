'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const VENDOR = path.join(ROOT, 'vendor', 'deepseek-harness');

function readRel(base, rel) {
  return fs.readFileSync(path.join(base, ...rel.split('/')), 'utf8');
}

const UI_FEATURES = [
  {
    name: 'four-column AppFrame',
    file: 'packages/client/ui-layout/src/client/AppFrame.tsx',
    includes: ['four-column'],
  },
  {
    name: 'titlebar Git and panel toggles',
    file: 'packages/client/ui-titlebar/src/client/apply.ts',
    includes: ['shell.titlebar.trailing'],
  },
  {
    // Classic right column: SurfacesRoot hosts the seat tree and every open
    // path expands the track via ctx.layout.openSurfaces(); the native dock
    // survives only as the compat rail for upstream-exclusive kinds.
    name: 'single in-place right column',
    file: 'packages/client/ui-surfaces/src/client/apply.ts',
    includes: ['openWorkspaceSurface', 'openResourceIn', 'openTabIn'],
    excludes: ['collapseRightPanel', 'ctx.layout.openSurfaces()'],
  },
  {
    name: 'Files search work loop',
    file: 'packages/client/ui-files/src/client/FilesPanel.tsx',
    includes: ['data-files-panel', "t('search')"],
  },
  {
    name: 'Files composer mention MIME',
    file: 'packages/client/ui-files/src/client/composerMention.ts',
    includes: ["'application/x-dshd-composer-mention'"],
  },
  {
    name: 'InputBar has no local $ skill menu',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    excludes: ['listSkillNames', 'skillMenu'],
  },
  {
    name: 'InputBar mention drop',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    includes: ['application/x-dshd-composer-mention'],
  },
  {
    name: 'generic managed composer chrome',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    includes: ["presentation?.composer === 'managed'", "conversation.input.managed", 'managed ? null : <ContextMeter'],
    excludes: ["agentPreset === 'dshbot-room'", "origin === 'dshbot'"],
  },
  {
    name: 'transparent theme attr',
    file: 'packages/client/ui-theme/src/wallpaper.ts',
    includes: ["export const TRANSPARENT_ATTR = 'data-dsh-transparent'"],
  },
  {
    name: 'transparent wallpaper mask branch',
    file: 'packages/client/ui-theme/src/styles/wallpaper.css',
    includes: ['html[data-dsh-transparent] #dsh-wallpaper::after'],
  },
  {
    name: 'transparent composer seat gate',
    file: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css',
    includes: [':not([data-dsh-transparent])'],
  },
  {
    name: 'composer beam layer',
    file: 'packages/client/ui-conversation/src/client/ComposerBeam.tsx',
    includes: ['data-composer-beam'],
  },
  {
    name: 'StatsPills running row state',
    file: 'packages/client/ui-chat/src/client/chat/StatsPills.tsx',
    includes: ['data-stats-line'],
  },
  {
    name: 'Appearance wallpaper pick/browse row',
    file: 'packages/client/ui-theme/src/client/WallpaperRow.tsx',
    includes: ["t('wallpaper.choose')", "t('wallpaper.browse')"],
    excludes: ["t('wallpaper.catalogUrls')"],
  },
  {
    name: 'gallery sources live in the browse window',
    file: 'packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx',
    includes: ['WallpaperSources', "t('wallpaper.browse')", "t('wallpaper.sources')"],
  },
  {
    name: 'terminal drawer occupant',
    file: 'packages/client/ui-user-terminal/src/client/apply.ts',
    includes: ['shell.terminalDrawer'],
  },
  {
    name: 'rc.8 composer attachment slot',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    includes: ["'conversation.input.attachments'"],
  },
  {
    name: 'Agents surface',
    file: 'packages/client/ui-agents-panel/src/client/AgentsPanel.tsx',
    includes: ['data-agents-panel'],
  },
  {
    name: 'Diff surface',
    file: 'packages/client/ui-diff/src/client/DiffPanel.tsx',
    includes: ['data-diff-panel'],
  },
  {
    name: 'Browser preview surface',
    file: 'packages/client/ui-preview/src/client/PreviewPanel.tsx',
    includes: ['data-preview-panel'],
  },
  {
    name: 'titlebar Git actions',
    file: 'packages/client/ui-git/src/client/locales.ts',
    includes: ["'menu.options': 'Git actions'", "'branch.open': 'Switch branch'"],
  },
  {
    name: 'MCP settings page',
    file: 'packages/client/ui-settings-mcp/src/client/locales.ts',
    includes: ["title: 'MCP servers'"],
  },
  {
    name: 'Skills settings page',
    file: 'packages/client/ui-settings-skills/src/client/locales.ts',
    includes: ["title: 'Skills'"],
  },
  {
    name: 'message edit action',
    file: 'packages/client/ui-message-edit/src/client/MessageEditAction.tsx',
    includes: ['startEdit'],
  },
  {
    name: 'in-app directory picker',
    file: 'packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx',
    includes: ['DirectoryBrowser'],
  },
  {
    name: 'assembled post-merge web e2e',
    file: 'apps/web/tests/post-merge-desktop-ui.e2e.ts',
    includes: ['post-merge assembled desktop UI', 'Mention in composer', 'Browse gallery', 'composerDraft.innerText()', 'data-source="path"'],
  },
  {
    name: 'Files draft uses ctx.get sessions',
    file: 'packages/client/ui-files/src/client/draft.ts',
    includes: ["ctx.get('sessions')"],
    excludes: ['ctx.sessions'],
  },
  {
    name: 'preview draft uses ctx.get sessions',
    file: 'packages/client/ui-preview/src/client/draft.ts',
    includes: ["ctx.get('sessions')"],
    excludes: ['ctx.sessions'],
  },
  {
    name: 'terminal draft uses ctx.get sessions',
    file: 'packages/client/ui-user-terminal/src/client/draft.ts',
    includes: ["ctx.get('sessions')"],
    excludes: ['ctx.sessions'],
  },
  {
    name: 'ui-files apply has no path trigger registration',
    file: 'packages/client/ui-files/src/client/apply.ts',
    excludes: ['createPathTriggerSource', 'inputTriggers', "name: 'path'"],
  },
  {
    name: 'web-app loads ui-settings-remote',
    file: 'packages/bundle/web-app/cordis.patch.yml',
    includes: ['- id: ui-settings-remote', "'@deepseek-ai/dsh-client-ui-settings-remote'"],
    excludes: ['# - id: ui-settings-remote'],
  },
];

test('post-merge UI features remain in the vendor tree', () => {
  const missing = [];
  for (const feature of UI_FEATURES) {
    const source = readRel(VENDOR, feature.file);
    for (const snippet of feature.includes || []) {
      if (!source.includes(snippet)) {
        missing.push(`${feature.name}: missing ${snippet} in ${feature.file}`);
      }
    }
    for (const snippet of feature.excludes || []) {
      if (source.includes(snippet)) {
        missing.push(`${feature.name}: unexpected ${snippet} in ${feature.file}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('desktop path and local $ trigger modules stay deleted', () => {
  const gone = [
    'packages/client/ui-files/src/client/pathTrigger.ts',
    'packages/client/ui-files/tests/path-trigger.client.spec.ts',
    'packages/client/ui-conversation/src/client/composerTrigger.ts',
    'packages/client/ui-conversation/tests/composer-trigger.spec.ts',
  ];
  for (const rel of gone) {
    assert.equal(
      fs.existsSync(path.join(VENDOR, ...rel.split('/'))),
      false,
      `expected deleted: ${rel}`,
    );
  }
});

test('main process boots the ChisaCode remote face (RemoteGateway retired)', () => {
  const index = readRel(ROOT, 'src/main/index.js');
  assert.match(index, /new DshdRemote/);
  assert.doesNotMatch(index, /new RemoteGateway/);
  assert.doesNotMatch(index, /createDisabledRemote/);
});

test('desktop ships dshbot as a built-in vendored plugin', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'vendor/dshbot/package.json')), true);
  const manifest = JSON.parse(readRel(ROOT, 'package.json'));
  assert.match(JSON.stringify(manifest.build.extraResources), /dshbot/);
});

// Upstream ships zero -webkit-app-region (it is a web-only app), so every
// occurrence below is desktop fork content: fixed-position overlays must punch
// a no-drag hole or they cannot be clicked over the desktop caption band. The
// 0.1.5-rc.1 merge deleted TurnUsagePanel .panel and MessageFeedbackActions
// .notePanel; that contract now lives in the shared stat-dialog skin and the
// ui-dockkit / ui-sidebar-right surfaces. The v0.1.6-alpha.1 merge refactored
// JsonTree's copy affordance from a fixed .copyAnchor to an inline-absolute
// .copySlot — nothing in that file overlays the caption band anymore, so it
// left this list. The dsh-v0.1.7-rc.2 merge likewise retired the
// SidebarRight panel-wide app-region pulse in favor of dockkit's per-strip
// `data-window-drag` model, and moved ImageLightbox to ui-primitives and
// OnboardingSurface to ui-settings-account.
const NO_DRAG_FILES = [
  'packages/client/ui-attachment/src/DropOverlay.module.css',
  'packages/client/ui-primitives/src/ImageLightbox.module.css',
  'packages/client/ui-chat/src/client/chat/stat-dialog.module.css',
  'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css',
  'packages/client/ui-dockkit/src/components/dockkit.module.css',
  'packages/client/ui-files/src/client/FileTree.module.css',
  'packages/client/ui-git/src/client/GitActionsControl.module.css',
  'packages/client/ui-git/src/client/GitProgressToast.module.css',
  'packages/client/ui-layout/src/client/AppFrame.module.css',
  'packages/client/ui-primitives/src/ConnectionBanner.module.css',
  'packages/client/ui-primitives/src/HoverCard.module.css',
  'packages/client/ui-primitives/src/Menu.module.css',
  'packages/client/ui-primitives/src/Modal.module.css',
  'packages/client/ui-settings-account/src/client/OnboardingSurface.module.css',
  'packages/client/ui-primitives/src/Toast.module.css',
  'packages/client/ui-primitives/src/Tooltip.module.css',
  'packages/client/ui-schedule/src/client/ScheduleCatalogAction.module.css',
  'packages/client/ui-settings-general/src/client/SettingsRoot.module.css',
  'packages/client/ui-settings-remote/src/client/RemoteSection.module.css',
  'packages/client/ui-sidebar/src/client/SidebarRoot.module.css',
  'packages/client/ui-subagent/src/client/SubagentHeaderLineage.module.css',
  'packages/client/ui-titlebar/src/client/PanelToggles.module.css',
  'packages/extensions/ui-cordis/src/client/CordisPanel.module.css',
];

test('fixed overlays punch a no-drag hole over the caption band', () => {
  const missing = NO_DRAG_FILES.filter(
    (rel) => !readRel(VENDOR, rel).includes('-webkit-app-region: no-drag'),
  );
  assert.deepEqual(missing, []);
});
