'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ensureDesktopInstallPlugin,
  DESKTOP_INSTALL_BEGIN,
  DESKTOP_INSTALL_END,
} = require('../src/main/plugins');
const {
  ensureDesktopDshIm,
  DSH_IM_PACKAGE,
  DSH_IM_BEGIN,
  DSH_IM_END,
  DSH_IM_INSERT_ID,
} = require('../src/main/dsh-im-desktop');
const {
  ensureDesktopUsagePanel,
  USAGE_PANEL_PACKAGE,
} = require('../src/main/usage-panel-preset');
const {
  ensureDesktopMarket,
  DSH_MARKET_INSERT_ID,
} = require('../src/main/dsh-market-desktop');
const {
  ensureDesktopDshbot,
  DSHBOT_PACKAGE,
  DSHBOT_INSERT_ID,
} = require('../src/main/dshbot-desktop');
const {
  DSHBOT_BEGIN,
  DSHBOT_END,
} = require('../src/main/legacy-dshbot-preset');
const {
  ensureDesktopDshWhale,
  DSH_WHALE_PACKAGE,
  DSH_WHALE_INSERT_ID,
  DSH_WHALE_BEGIN,
  DSH_WHALE_END,
} = require('../src/main/dsh-whale-desktop');
const {
  ensureDesktopDshRemote,
  DSH_REMOTE_PACKAGE,
  DSH_REMOTE_INSERT_ID,
  DSH_REMOTE_BEGIN,
  DSH_REMOTE_END,
} = require('../src/main/dsh-remote-desktop');
const {
  ensureSessionSearchOverlay,
} = require('../src/main/session-search-overlay');
const {
  ensureDesktopOfficeRuntime,
  OFFICE_SKILLS_DIRNAME,
  OFFICE_SKILL_FOLDERS,
} = require('../src/main/office-runtime');
const {
  ensureDesktopTaskControl,
  TASK_CONTROL_PACKAGE,
  TASK_CONTROL_INSERT_ID,
} = require('../src/main/task-control-overlay');

/**
 * Skip compose contract against the REAL dsh CLI (`dsh web --dump-config`):
 * every desktop start passes the desktop-owned install, usage, dsh-im,
 * market, and dshbot overlays via `--patch`; a skip start must compose
 * those overlays while the user layer stays out, and a full start must add
 * session search. The fixture also
 * replays the managed-block migration: the temp profile starts with a canary
 * user row PLUS the legacy install and dsh-im managed blocks, and ensure
 * must strip the blocks (keeping the canary) or the full round double-mounts
 * the desktop rows. Unit tests mock `dsh.start`, so only this check catches
 * CLI-side semantic drift (e.g. `--skip-user-plugins` no longer excluding
 * the user layer, or no longer applying `--patch` overlays). Runs in
 * after-pack against the assembled packaged runtime, and standalone against
 * a built source tree:
 *
 *   node scripts/check-skip-compose-contract.js [harnessRoot]
 */

const CANARY_ID = 'dshd-contract-canary-user-plugin';
const TASK_CONTROL_ID = TASK_CONTROL_INSERT_ID;
const INSTALL_ID = 'dshd-desktop-plugin-install';
const IM_ID = DSH_IM_INSERT_ID;
const USAGE_ID = 'usage-stats';
const MARKET_ID = DSH_MARKET_INSERT_ID;
const BOT_ID = DSHBOT_INSERT_ID;
const WHALE_ID = DSH_WHALE_INSERT_ID;
const REMOTE_ID = DSH_REMOTE_INSERT_ID;
const WORKSPACE_DEPS_ID = 'workspace-dependencies';
const SKILL_OFFICE_ID = 'skill-office';
const SESSION_SEARCH_ID = 'session-query-sqlite';
const DUMP_TIMEOUT_MS = 120_000;

const CANARY_PATCH = [
  '- insert:',
  `    - id: ${CANARY_ID}`,
  `      name: ${JSON.stringify(CANARY_ID)}`,
  '',
].join('\n');

// The exact block bodies earlier desktop versions upserted into the user's
// cordis.patch.yml; the fixture seeds them so the run proves the migration
// strips them (a stale copy composed next to the overlay double-mounts).
const LEGACY_MANAGED_BLOCK = (href) => [
  DESKTOP_INSTALL_BEGIN,
  '- insert:',
  `    - id: ${INSTALL_ID}`,
  `      name: ${JSON.stringify(href)}`,
  DESKTOP_INSTALL_END,
  '',
].join('\n');

const LEGACY_DSH_IM_BLOCK = [
  DSH_IM_BEGIN,
  '- insert:',
  `    - id: ${IM_ID}`,
  `      name: ${JSON.stringify(DSH_IM_PACKAGE)}`,
  DSH_IM_END,
  '',
].join('\n');

const LEGACY_DSHBOT_BLOCK = [
  DSHBOT_BEGIN,
  '- insert:',
  `    - id: ${BOT_ID}`,
  `      name: ${JSON.stringify(DSHBOT_PACKAGE)}`,
  DSHBOT_END,
  '',
].join('\n');

const LEGACY_DSH_WHALE_BLOCK = [
  DSH_WHALE_BEGIN,
  '- insert:',
  `    - id: ${WHALE_ID}`,
  `      name: ${JSON.stringify(DSH_WHALE_PACKAGE)}`,
  DSH_WHALE_END,
  '',
].join('\n');

// No desktop version ever upserted a dsh-remote managed block; the fixture
// still seeds one so the contract proves the strip keeps working if such a
// row ever lands in the user-owned patch file.
const LEGACY_DSH_REMOTE_BLOCK = [
  DSH_REMOTE_BEGIN,
  '- insert:',
  `    - id: ${REMOTE_ID}`,
  `      name: ${JSON.stringify(DSH_REMOTE_PACKAGE)}`,
  DSH_REMOTE_END,
  '',
].join('\n');

function countRows(text, id) {
  const expected = `- id: ${id}`;
  return String(text).split(/\r?\n/).filter((line) => line.trim() === expected).length;
}

function countConfigLines(text, value) {
  const expected = `${value}`;
  return String(text).split(/\r?\n/).filter((line) => line.trim() === expected).length;
}

/**
 * Minimal first-party dsh-im package fixture so the REAL ensureDesktopDshIm
 * can junction it into the throwaway profile and emit its overlay. The
 * packaged vendor copy's completeness is asserted separately in after-pack
 * (`assertVendoredPluginRuntimeDeps`); this contract only proves compose
 * semantics.
 * @param {string} home - the throwaway DSH_HOME.
 * @returns {string} the fixture source directory.
 */
function writeDshImFixture(home) {
  const dir = path.join(home, 'fixtures', 'dsh-im');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSH_IM_PACKAGE,
    version: '0.0.0-contract',
    main: './lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js' },
    dependencies: {},
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), 'export function apply() {}\n', 'utf8');
  return dir;
}

/**
 * Minimal first-party dshbot package fixture: the real ensureDesktopDshbot
 * junctions it into the throwaway profile and emits its overlay. The
 * packaged vendor copy's completeness is asserted separately in after-pack;
 * this contract only proves compose semantics.
 * @param {string} home - the throwaway DSH_HOME.
 * @returns {string} the fixture source directory.
 */
function writeDshbotFixture(home) {
  const dir = path.join(home, 'fixtures', 'dshbot');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSHBOT_PACKAGE,
    version: '0.0.0-contract',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './client/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
    },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'client', 'client.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${BOT_ID}\n      name: ${JSON.stringify(DSHBOT_PACKAGE)}\n`, 'utf8');
  return dir;
}

/**
 * Minimal first-party dsh-whale fixture: same contract as the dshbot
 * fixture — the REAL ensureDesktopDshWhale junctions it and emits the
 * overlay. The whale row is asserted exactly-once when its overlay rides
 * `--patch` (production gates the overlay on whaleAssistantEnabled).
 * @param {string} home - the throwaway DSH_HOME.
 * @returns {string} the fixture source directory.
 */
function writeDshWhaleFixture(home) {
  const dir = path.join(home, 'fixtures', 'dsh-whale');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSH_WHALE_PACKAGE,
    version: '0.0.0-contract',
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './client/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
    },
    dependencies: {},
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'client', 'client.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${WHALE_ID}\n      name: ${JSON.stringify(DSH_WHALE_PACKAGE)}\n`, 'utf8');
  return dir;
}

/**
 * Minimal first-party dsh-remote fixture: same contract as the dshbot
 * fixture — the REAL ensureDesktopDshRemote junctions it and emits the
 * overlay. The remote row is asserted exactly-once when its overlay rides
 * `--patch` (production gates the overlay on remoteWorkspaceEnabled, default ON).
 * @param {string} home - the throwaway DSH_HOME.
 * @returns {string} the fixture source directory.
 */
function writeDshRemoteFixture(home) {
  const dir = path.join(home, 'fixtures', 'dsh-remote');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSH_REMOTE_PACKAGE,
    version: '0.0.0-contract',
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './cordis.patch.yml': './cordis.patch.yml',
    },
    dependencies: {},
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${REMOTE_ID}\n      name: ${JSON.stringify(DSH_REMOTE_PACKAGE)}\n`, 'utf8');
  return dir;
}

/**
 * Minimal first-party dsh-task-control fixture: the real
 * ensureDesktopTaskControl junctions it into the throwaway profile and emits
 * its overlay. Task control rides EVERY start (skip included) — the contract
 * asserts exactly-once composition of its row.
 * @param {string} home - the throwaway DSH_HOME.
 * @returns {string} the fixture source directory.
 */
function writeTaskControlFixture(home) {
  const dir = path.join(home, 'fixtures', 'dsh-task-control');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: TASK_CONTROL_PACKAGE,
    version: '0.0.0-contract',
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './cordis.patch.yml': './cordis.patch.yml',
    },
    dependencies: {},
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${TASK_CONTROL_ID}\n      name: ${JSON.stringify(TASK_CONTROL_PACKAGE)}\n`, 'utf8');
  return dir;
}

/**
 * Minimal bundled Office payload fixture so the REAL
 * ensureDesktopOfficeRuntime writes its overlay in the contract run: a
 * runtime.json matching the host, a stub standalone Node binary, and the
 * sibling office-skills tree. The kit CLI/engine checks run against the real
 * harnessRoot passed to runSkipComposeContract.
 * @param {string} home - Throwaway DSH_HOME fixture root.
 * @returns {string} the payload directory to pass as bundledRuntimeDir.
 */
function writeOfficeRuntimeFixture(home) {
  const source = path.join(home, 'fixtures', 'primary-runtime');
  fs.mkdirSync(path.join(source, 'dependencies', 'node', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(source, 'runtime.json'), `${JSON.stringify({
    platform: process.platform,
    arch: process.arch,
    payloadDigest: 'contract-fixture',
  })}\n`, 'utf8');
  fs.writeFileSync(
    path.join(source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    'stub\n',
    'utf8',
  );
  const assetRoot = path.join(path.dirname(source), OFFICE_SKILLS_DIRNAME);
  for (const folder of OFFICE_SKILL_FOLDERS) {
    fs.mkdirSync(path.join(assetRoot, folder), { recursive: true });
    fs.writeFileSync(path.join(assetRoot, folder, 'SKILL.md'), '---\ndescription: stub\n---\n', 'utf8');
  }
  return source;
}

/**
 * Pure verdict on one dump-config round. The positive assertion comes first:
 * an empty or truncated dump must fail on the missing desktop rows, never
 * pass because the canary also vanished with everything else. Exactly one
 * install row, one dsh-im row, and one dshbot row per round — a second copy
 * means a stale managed block composed next to the overlay (the CLI's
 * `insert` does not dedupe by id).
 * @param {'skip'|'full'} round
 * @param {string} stdout
 * @returns {string[]} problems, empty when the round honors the contract.
 */
function composeContractProblems(round, stdout) {
  const text = String(stdout || '');
  const problems = [];
  const requiredRows = [
    [TASK_CONTROL_ID, '桌面内置任务保护'],
    [INSTALL_ID, '桌面安装插件'],
    [USAGE_ID, '桌面内置用量统计'],
    [IM_ID, '桌面内置 dsh-im'],
    [MARKET_ID, '桌面内置市场'],
    [BOT_ID, '桌面内置 dshbot'],
    [WHALE_ID, '桌面内置 dsh-whale'],
    [REMOTE_ID, '桌面内置 dsh-remote'],
    [WORKSPACE_DEPS_ID, '桌面内置 Office 工作区依赖'],
    [SKILL_OFFICE_ID, '桌面内置 Office 技能'],
  ];
  for (const [id, label] of requiredRows) {
    const count = countRows(text, id);
    if (count === 0) {
      problems.push(`${round}: dump 输出缺少${label}行 ${id}`);
    } else if (count > 1) {
      problems.push(`${round}: ${label}行出现 ${count} 次——受管块残留与 overlay 双挂载`);
    }
  }
  // The base Web bundle always has session-query-sqlite with openAt: never;
  // only the desktop overlay changes it to first-search on full starts.
  const searchCount = countConfigLines(text, 'openAt: first-search');
  if (round === 'skip' && searchCount > 0) {
    problems.push(`${round}: session-search overlay 不应随 --skip-user-plugins compose`);
  } else if (round === 'full' && searchCount === 0) {
    problems.push(`${round}: dump 输出缺少 full-start session-search 行 ${SESSION_SEARCH_ID}`);
  } else if (round === 'full' && searchCount > 1) {
    problems.push(`${round}: session-search 行出现 ${searchCount} 次——overlay 重复挂载`);
  }
  if (round === 'skip') {
    if (text.includes(CANARY_ID)) {
      problems.push(`${round}: 用户层 canary 行仍被 compose——--skip-user-plugins 未生效`);
    }
  } else if (!text.includes(CANARY_ID)) {
    problems.push(`${round}: 用户层 canary 行未被 compose——canary 植入或用户层读取失效`);
  }
  return problems;
}

/**
 * The two dump-config invocations, mirroring the desktop's production argv:
 * install, usage, dsh-im, market, and dshbot overlays ride `--patch` on
 * BOTH rounds; full starts add session-search between usage and dsh-im
 * (launcher flags stay in the CLI grammar prefix, before any app arg).
 * @param {string} binJs - absolute path of apps/cli/lib/bin.js.
 * @param {string[]} overlayFiles - desktop-owned overlays on skip and full starts.
 * @param {string[]} fullOverlayFiles - exact full-start order, including full-only overlays.
 * @returns {Array<{ round: 'skip'|'full', args: string[] }>}
 */
function composeContractRounds(binJs, overlayFiles, fullOverlayFiles = overlayFiles) {
  const overlays = (Array.isArray(overlayFiles) ? overlayFiles : [overlayFiles])
    .flatMap((file) => ['--patch', file]);
  const full = (Array.isArray(fullOverlayFiles) ? fullOverlayFiles : [fullOverlayFiles])
    .flatMap((file) => ['--patch', file]);
  return [
    { round: 'skip', args: [binJs, 'web', '--skip-user-plugins', ...overlays, '--dump-config'] },
    { round: 'full', args: [binJs, 'web', ...full, '--dump-config'] },
  ];
}

/**
 * Run the contract against one harness root (source tree with built lib, or
 * the assembled packaged runtime). Throws with every collected problem on
 * violation; a missing built CLI is a hard error too — callers must gate on
 * a runtime that is supposed to be complete.
 * @param {string} harnessRoot
 * @param {{ spawnSync?: typeof spawnSync, nodeBin?: string, log?: (line: string) => void }} [options]
 * @returns {Promise<{ ok: true, rounds: number }>}
 */
async function runSkipComposeContract(harnessRoot, options = {}) {
  const spawn = options.spawnSync || spawnSync;
  const nodeBin = options.nodeBin || process.execPath;
  const log = options.log || (() => {});
  const binJs = path.join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js');
  if (!fs.existsSync(binJs)) {
    throw new Error(`skip compose 契约门禁：缺少已构建的 CLI ${binJs}`);
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-compose-contract-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    // Migration replay: the profile starts as an upgraded install would —
    // a canary user row plus the managed blocks an earlier desktop version
    // upserted (install + dsh-im + dshbot). The ensures must strip the
    // blocks (keeping the canary) and write their overlays; the full round
    // then proves exactly one copy of each desktop row composes.
    const stalePlaceholderHref = 'file:///stale/desktop-plugins/install-dsh-plugin/install-dsh-plugin.mjs';
    fs.writeFileSync(
      path.join(profileDir, 'cordis.patch.yml'),
      `${CANARY_PATCH}\n${LEGACY_MANAGED_BLOCK(stalePlaceholderHref)}\n${LEGACY_DSH_IM_BLOCK}\n${LEGACY_DSHBOT_BLOCK}\n${LEGACY_DSH_WHALE_BLOCK}\n${LEGACY_DSH_REMOTE_BLOCK}`,
      'utf8',
    );
    const taskControlEnsure = ensureDesktopTaskControl({
      sourceDir: writeTaskControlFixture(home),
      profileDir,
    });
    if (!taskControlEnsure || taskControlEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopTaskControl 失败（${(taskControlEnsure && taskControlEnsure.error) || 'unknown'}）`);
    }
    const ensure = ensureDesktopInstallPlugin({ profileDir });
    if (!ensure || ensure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopInstallPlugin 失败（${(ensure && ensure.reason) || 'unknown'}）`);
    }
    // Office is built-in on every start: the fixture payload stands in for
    // the packaged resources/runtime payload; kit resolution runs against
    // the real harnessRoot under test.
    const officeEnsure = ensureDesktopOfficeRuntime({
      profileDir,
      bundledRuntimeDir: writeOfficeRuntimeFixture(home),
      harnessRoot,
      dshHome: home,
      isPackaged: false,
    });
    if (!officeEnsure || officeEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopOfficeRuntime 失败（${(officeEnsure && officeEnsure.error) || 'unknown'}）`);
    }
    const imEnsure = ensureDesktopDshIm({ sourceDir: writeDshImFixture(home), profileDir });
    if (!imEnsure || imEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopDshIm 失败（${(imEnsure && imEnsure.error) || 'unknown'}）`);
    }
    const usageSource = path.join(home, 'fixtures', 'usage-panel');
    fs.mkdirSync(usageSource, { recursive: true });
    fs.writeFileSync(path.join(usageSource, 'package.json'), JSON.stringify({
      name: USAGE_PANEL_PACKAGE,
      version: '0.0.0-contract',
      main: './index.js',
      dependencies: {},
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(usageSource, 'index.js'), 'export function apply() {}\n', 'utf8');
    const usageEnsure = await ensureDesktopUsagePanel({ sourceDir: usageSource, profileDir });
    if (!usageEnsure || usageEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopUsagePanel 失败（${(usageEnsure && usageEnsure.error) || 'unknown'}）`);
    }
    const marketEnsure = ensureDesktopMarket({ sourceDir: null, profileDir });
    if (!marketEnsure || marketEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopMarket 失败（${(marketEnsure && marketEnsure.error) || 'unknown'}）`);
    }
    const botEnsure = ensureDesktopDshbot({ sourceDir: writeDshbotFixture(home), profileDir, enabled: true });
    if (!botEnsure || botEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopDshbot 失败（${(botEnsure && botEnsure.error) || 'unknown'}）`);
    }
    // The whale overlay composes only when the built-in assistant is
    // enabled — the contract proves the enabled path mounts exactly once.
    const whaleEnsure = ensureDesktopDshWhale({ sourceDir: writeDshWhaleFixture(home), profileDir, enabled: true });
    if (!whaleEnsure || whaleEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopDshWhale 失败（${(whaleEnsure && whaleEnsure.error) || 'unknown'}）`);
    }
    // The remote overlay composes on every start while remoteWorkspaceEnabled is on
    // (default ON) — the contract proves the enabled path mounts exactly once.
    const remoteEnsure = ensureDesktopDshRemote({ sourceDir: writeDshRemoteFixture(home), profileDir, enabled: true });
    if (!remoteEnsure || remoteEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureDesktopDshRemote 失败（${(remoteEnsure && remoteEnsure.error) || 'unknown'}）`);
    }
    const searchEnsure = ensureSessionSearchOverlay({ profileDir, dshHome: home });
    if (!searchEnsure || searchEnsure.ok !== true) {
      throw new Error(`skip compose 契约门禁：ensureSessionSearchOverlay 失败（${(searchEnsure && searchEnsure.error) || 'unknown'}）`);
    }
    const migrated = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    if (migrated.includes(DESKTOP_INSTALL_BEGIN) || migrated.includes(DSH_IM_BEGIN)
      || migrated.includes(DSHBOT_BEGIN) || migrated.includes(DSH_WHALE_BEGIN)
      || migrated.includes(DSH_REMOTE_BEGIN)) {
      throw new Error('skip compose 契约门禁：受管块迁移失败——cordis.patch.yml 仍含桌面受管块');
    }
    if (!migrated.includes(CANARY_ID)) {
      throw new Error('skip compose 契约门禁：受管块迁移弄丢了用户行——canary 从 cordis.patch.yml 消失');
    }
    // The child must compose against the throwaway home only — never an
    // inherited desktop/official home (dsh-home rule).
    const env = { ...process.env, DSH_HOME: home };
    delete env.DSHD_HOME;
    delete env.DSH_HARNESS_ROOT;
    const problems = [];
    // Keep this order identical to HarnessController: session-search is
    // inserted before dsh-im on full starts, while dsh-im, market, and
    // dshbot remain present on skip starts too.
    const overlayFiles = [
      taskControlEnsure.overlayFile,
      ensure.overlayFile,
      officeEnsure.overlayFile,
      usageEnsure.overlayFile,
      imEnsure.overlayFile,
      marketEnsure.overlayFile,
      botEnsure.overlayFile,
      whaleEnsure.overlayFile,
      remoteEnsure.overlayFile,
    ];
    const fullOverlayFiles = [
      taskControlEnsure.overlayFile,
      ensure.overlayFile,
      officeEnsure.overlayFile,
      usageEnsure.overlayFile,
      searchEnsure.overlayFile,
      imEnsure.overlayFile,
      marketEnsure.overlayFile,
      botEnsure.overlayFile,
      whaleEnsure.overlayFile,
      remoteEnsure.overlayFile,
    ];
    for (const { round, args } of composeContractRounds(binJs, overlayFiles, fullOverlayFiles)) {
      log(`dump-config ${round} 轮…`);
      const result = spawn(nodeBin, args, {
        encoding: 'utf8',
        env,
        timeout: DUMP_TIMEOUT_MS,
        windowsHide: true,
      });
      if (result.error) {
        problems.push(`${round}: 无法运行 dump-config：${result.error.message}`);
        continue;
      }
      if (result.status !== 0) {
        const stderr = String(result.stderr || '').trim().slice(0, 400);
        problems.push(`${round}: dump-config 退出码 ${result.status}${stderr ? `：${stderr}` : ''}`);
        continue;
      }
      problems.push(...composeContractProblems(round, result.stdout));
    }
    if (problems.length > 0) {
      throw new Error(`skip compose 契约失败：${problems.join('；')}`);
    }
    return { ok: true, rounds: 2 };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

module.exports = {
  CANARY_ID,
  TASK_CONTROL_ID,
  INSTALL_ID,
  IM_ID,
  USAGE_ID,
  MARKET_ID,
  BOT_ID,
  WHALE_ID,
  REMOTE_ID,
  WORKSPACE_DEPS_ID,
  SKILL_OFFICE_ID,
  SESSION_SEARCH_ID,
  composeContractProblems,
  composeContractRounds,
  runSkipComposeContract,
};

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'vendor', 'deepseek-harness'));
  runSkipComposeContract(root, { log: (line) => console.log(line) }).then(() => {
    console.log(`skip compose 契约通过（${root}）`);
  }).catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  });
}
