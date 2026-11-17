'use strict';

const fs = require('fs');
const path = require('path');
const { getDesktopDshHome } = require('../shared/dsh-home');
const { atomicWriteFileSync } = require('../shared/fs-safe');
const { webProfileDir } = require('./plugins');

const SESSION_SEARCH_OVERLAY_FILENAME = 'desktop-session-search.patch.yml';

function resolveDshHome(options = {}) {
  if (typeof options.dshHome === 'string' && options.dshHome.trim()) {
    return path.resolve(options.dshHome.trim());
  }
  try {
    return getDesktopDshHome();
  } catch {
    return '';
  }
}

function overlayContents(indexPath) {
  const posix = indexPath.replace(/\\/g, '/');
  return [
    '# Desktop-managed overlay passed to full starts via --patch.',
    '# Enables Web content search (session.search snippets). Skip starts do',
    '# not pass this file. Regenerated on every full start; do not edit.',
    '- id: session-query-sqlite',
    '  config:',
    `    path: ${JSON.stringify(posix)}`,
    '    openAt: first-search',
    '',
  ].join('\n');
}

/**
 * Write a desktop-owned overlay that opts the shipped `session-query-sqlite`
 * row into content search (`openAt: first-search`) with a durable index under
 * dsh-home. Skip starts must not pass this file. Does not write the
 * user-owned profile `cordis.patch.yml`.
 * @param {{ profileDir?: string, dshHome?: string }} [options]
 */
function ensureSessionSearchOverlay(options = {}) {
  const home = resolveDshHome(options);
  if (!home) {
    return { ok: false, added: false, error: 'desktop DSH home is not configured' };
  }
  const profileDir = options.profileDir || webProfileDir();
  const destDir = path.join(profileDir, 'desktop-plugins', 'session-search');
  const overlayFile = path.join(destDir, SESSION_SEARCH_OVERLAY_FILENAME);
  const contents = overlayContents(path.join(home, 'session-query.sqlite'));
  fs.mkdirSync(destDir, { recursive: true });
  const existing = fs.existsSync(overlayFile) ? fs.readFileSync(overlayFile, 'utf8') : '';
  if (existing !== contents) {
    atomicWriteFileSync(overlayFile, contents, { encoding: 'utf8' });
  }
  return { ok: true, overlayFile };
}

module.exports = {
  ensureSessionSearchOverlay,
};
