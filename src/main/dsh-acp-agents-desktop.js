'use strict';

/**
 * Wire the desktop-owned `dsh-acp-agents` Host + Client plugin via a `--patch`
 * overlay and a profile `node_modules/dsh-acp-agents` directory link on every
 * start (full and skip), mirroring `platform-session-overlay.js`.
 */

const fs = require('fs');
const path = require('path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir } = require('./plugins');

const DSH_ACP_AGENTS_PACKAGE = 'dsh-acp-agents';
const DSH_ACP_AGENTS_DIR = 'dsh-acp';
const DSH_ACP_AGENTS_INSERT_ID = 'dsh-acp-agents';
const DSH_ACP_AGENTS_ALIASES = [DSH_ACP_AGENTS_PACKAGE, DSH_ACP_AGENTS_INSERT_ID];
const DSH_ACP_AGENTS_OVERLAY_FILENAME = 'desktop-dsh-acp-agents.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), DSH_ACP_AGENTS_DIR);
  } catch {
    return path.join(__dirname, '..', '..', DSH_ACP_AGENTS_DIR);
  }
}

function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', DSH_ACP_AGENTS_PACKAGE);
  ensureDirectoryLink(sourceDir, linked);
}

/** @param {{ sourceDir?: string, profileDir?: string }} [options] */
function ensureDesktopAcpAgents(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  const profileDir = options.profileDir || webProfileDir();
  const pkgFile = path.join(sourceDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    return { ok: false, added: false, sourceDir: null, error: 'missing-source:package.json' };
  }
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  } catch {
    // An unreadable manifest cannot declare entries; reported below.
  }
  const missingEntries = manifest ? missingDeclaredEntries(sourceDir, manifest) : ['package.json'];
  const missingDeps = missingRuntimeFiles(sourceDir);
  if (missingEntries.length || missingDeps.length) {
    return {
      ok: false,
      added: false,
      sourceDir,
      error: `missing-source:${[...missingEntries, ...missingDeps].join(',')}`,
    };
  }

  const destDir = path.join(profileDir, 'desktop-plugins', DSH_ACP_AGENTS_PACKAGE);
  const overlayFile = path.join(destDir, DSH_ACP_AGENTS_OVERLAY_FILENAME);
  const existed = fs.existsSync(overlayFile);

  linkIntoProfileModules(sourceDir, profileDir);

  fs.mkdirSync(destDir, { recursive: true });
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: mounts Settings -> Agent (agent-presets) and the T3 Code-style',
    '# Agent-first model selector (conversation.input.model).',
    '# Regenerated on every start; do not edit.',
    '- insert:',
    `    - id: ${DSH_ACP_AGENTS_INSERT_ID}`,
    `      name: ${JSON.stringify(DSH_ACP_AGENTS_PACKAGE)}`,
    '',
  ].join('\n');
  const tmp = `${overlayFile}.tmp`;
  fs.writeFileSync(tmp, overlayContents, 'utf8');
  fs.renameSync(tmp, overlayFile);
  return {
    ok: true,
    added: !existed,
    sourceDir,
    overlayFile,
  };
}

function withoutAcpAgentsAliases(list) {
  const blocked = new Set(DSH_ACP_AGENTS_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  DSH_ACP_AGENTS_PACKAGE,
  DSH_ACP_AGENTS_INSERT_ID,
  DSH_ACP_AGENTS_ALIASES,
  DSH_ACP_AGENTS_OVERLAY_FILENAME,
  withoutAcpAgentsAliases,
  ensureDesktopAcpAgents,
};
