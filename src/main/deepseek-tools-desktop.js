'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir } = require('./plugins');

/** Link desktop-owned settings and tools. The base bundle mounts them below user configuration. */
function ensureDesktopDeepSeekTools(options = {}) {
  const name = 'dsh-deepseek-tools';
  const sourceDir = options.sourceDir || path.join(require('./paths').projectRoot(), 'vendor', name);
  const profileDir = options.profileDir || webProfileDir();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
    const missing = [...missingDeclaredEntries(sourceDir, manifest), ...missingRuntimeFiles(sourceDir)];
    if (manifest.name !== name) missing.push('package.json:name');
    if (missing.length) return { ok: false, error: `missing-source:${missing.join(',')}` };
  } catch (error) { return { ok: false, error: `missing-source: ${error.message}` }; }
  ensureDirectoryLink(sourceDir, path.join(profileDir, 'node_modules', name));
  return { ok: true, sourceDir };
}

module.exports = { ensureDesktopDeepSeekTools };
