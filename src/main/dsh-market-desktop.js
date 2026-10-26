'use strict';

const fs = require('fs');
const path = require('path');
const { webProfileDir } = require('./plugins');

/** npm package name (the desktop fork package under the vendored harness). */
const DSH_MARKET_PACKAGE = '@deepseek-ai/dsh-client-ui-settings-market';
/** Scoped path under profile node_modules. */
const DSH_MARKET_DIR = path.join('@deepseek-ai', 'dsh-client-ui-settings-market');
/** Forensics / market / DROPPED aliases (market is desktop built-in: the
 * aliases are stripped from the disable list, never honored). */
const DSH_MARKET_ALIASES = ['dshmarket'];
/** Loader insert id used by the desktop overlay. */
const DSH_MARKET_INSERT_ID = 'ui-settings-market';
const DSH_MARKET_OVERLAY_FILENAME = 'desktop-dsh-market.patch.yml';

function resolveMarketSourceDir(root) {
  const candidates = [
    path.join(root, 'packages', 'client', 'ui-settings-market'),
    path.join(root, 'node_modules', DSH_MARKET_DIR),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'package.json')))
    || null;
}

function defaultSourceDir() {
  try {
    const { harnessRoot } = require('./paths');
    return resolveMarketSourceDir(harnessRoot());
  } catch {
    return null;
  }
}

/**
 * Mount the desktop Settings market on full and recovery starts through a
 * desktop-owned overlay. Catalog, installation and saved UI state use the
 * existing desktop APIs.
 *
 * @param {{ sourceDir?: string, profileDir?: string }} [options]
 * @returns {{
 *   ok: boolean,
 *   added?: boolean,
 *   sourceDir?: string|null,
 *   overlayFile?: string,
 *   error?: string,
 * }}
 */
function ensureDesktopMarket(options = {}) {
  const sourceDir = options.sourceDir === undefined ? defaultSourceDir() : options.sourceDir;
  if (sourceDir && !fs.existsSync(path.join(sourceDir, 'package.json'))) {
    return { ok: false, added: false, sourceDir: null, error: 'missing-source:package.json' };
  }
  const profileDir = options.profileDir || webProfileDir();

  const destDir = path.join(profileDir, 'desktop-plugins', 'dsh-market');
  fs.mkdirSync(destDir, { recursive: true });
  const overlayFile = path.join(destDir, DSH_MARKET_OVERLAY_FILENAME);
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: Settings > Market stays available during recovery.',
    '# Regenerated; do not edit.',
    '- insert:',
    `    - id: ${DSH_MARKET_INSERT_ID}`,
    `      name: ${JSON.stringify(DSH_MARKET_PACKAGE)}`,
    '',
  ].join('\n');
  const existed = fs.existsSync(overlayFile);
  const existing = existed ? fs.readFileSync(overlayFile, 'utf8') : '';
  if (existing !== overlayContents) {
    const tmp = `${overlayFile}.tmp`;
    fs.writeFileSync(tmp, overlayContents, 'utf8');
    fs.renameSync(tmp, overlayFile);
  }
  return {
    ok: true,
    added: !existed,
    sourceDir,
    overlayFile,
  };
}

/** @deprecated Use ensureDesktopMarket — kept as alias for harness wiring. */
function ensureMarketPlugin(options) {
  return ensureDesktopMarket(options);
}

function withoutMarketAliases(list) {
  const blocked = new Set(DSH_MARKET_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  DSH_MARKET_PACKAGE,
  DSH_MARKET_DIR,
  DSH_MARKET_ALIASES,
  DSH_MARKET_INSERT_ID,
  DSH_MARKET_OVERLAY_FILENAME,
  resolveMarketSourceDir,
  withoutMarketAliases,
  ensureDesktopMarket,
  ensureMarketPlugin,
};
