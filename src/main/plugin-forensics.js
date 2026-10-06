'use strict';

const { OFFICIAL_TEMPLATE_BUNDLES } = require('./plugins');
const { DESKTOP_PACKAGES } = require('../shared/harness-desktop-forks');
const { DSH_IM_ALIASES } = require('./dsh-im-desktop');
const { DSHBOT_ALIASES } = require('./dshbot-desktop');
const { DSH_WHALE_ALIASES } = require('./dsh-whale-desktop');
const { DSH_REMOTE_ALIASES } = require('./dsh-remote-desktop');
const { USAGE_PANEL_ALIASES } = require('./usage-panel-preset');

const GENERIC_OOM = /heap out of memory|js heap|allocation failed|oom\b/i;
// listen EACCES = the port is unusable by policy (Windows excluded-port
// range, privileged port without elevation) while nobody holds it — a
// different failure from EADDRINUSE and one no plugin choice can fix.
const GENERIC_PORT_EXCLUDED = /\blisten\s+eacces\b/i;
const GENERIC_PORT = /eaddrinuse|address already in use/i;
const GENERIC_NODE = /node['"]?\s+is not recognized|cannot find node|enoent.*node(\.exe)?\b/i;

const EVIDENCE_PATTERNS = [
  { kind: 'loader', regex: /failed to (?:apply|import) loader entry [^()\r\n]+ \((@?[\w.-]+(?:\/[\w.-]+)*)\)/gi },
  { kind: 'bundle', regex: /cannot resolve profile bundle ['"]([^'"]+)['"]/gi },
  { kind: 'package', regex: /cannot find package ['"]([^'"]+)['"]/gi },
  { kind: 'module', regex: /err_module_not_found[^\n'"]*['"]([^'"]+)['"]/gi },
  { kind: 'compose', regex: /failed to compose[^\n]*['"](@?[\w./-]+)['"]/gi },
];
const WEB_BOOT_AUDIT_HEADER = /\bweb boot:\s+([1-9]\d*) entr(?:y|ies) did not activate\b/i;
const WEB_BOOT_AUDIT_ENTRY = /^\s*(?:\[(?:app|error|dsh)\]\s*)?(@?[\w.-]+(?:\/[\w.-]+)*): (?:import failed(?::[^\r\n]*| \(see console for the import error\))|pending \(waiting for services?:[^\r\n]*\)|failed|disposed|loading|unloading)\s*$/i;

// Preset plugins stay here to block `shell:remove-plugin` on a same-named
// profile row (the built-in itself never appears in the profile list — it
// mounts via the desktop overlay). dsh-usage-panel, dsh-im, and dshbot are
// desktop built-in modules now (not disableable), but the `preset` marker
// only gates removal; disable is blocked separately via IPC and config
// alias-stripping.
const PRESET_PLUGINS = new Set(['dsh-usage-panel', '@xmanrui/dsh-im', 'dsh-im', 'xmanrui-dsh-im', ...DSHBOT_ALIASES, ...DSH_WHALE_ALIASES, ...DSH_REMOTE_ALIASES]);
const EVIDENCE_LINE_MAX = 240;

// In-box names cover the harness fork packages plus the desktop built-in
// modules (dsh-im, dsh-usage-panel, and dshbot, all overlay-mounted from
// vendor): breakage in any is desktop runtime damage — disable and
// skip-user-plugins cannot repair it.
const IN_BOX_PACKAGE_NAMES = new Set([
  ...DESKTOP_PACKAGES.map((pkg) => pkg.name),
  ...DSH_IM_ALIASES,
  ...DSHBOT_ALIASES,
  ...DSH_WHALE_ALIASES,
  ...DSH_REMOTE_ALIASES,
  ...USAGE_PANEL_ALIASES,
]);

/**
 * A suspect that names an in-box desktop package (exactly or via a subpath
 * specifier like `@scope/pkg/client`) is desktop runtime damage, not a user
 * plugin: disabling plugins or skipping the user layer cannot repair it.
 * The desktop install overlay mounts a file:// insert from
 * `desktop-plugins/install-dsh-plugin`; a compose failure there surfaces the
 * path, not a package name, so the path marker is matched too.
 * @param {string} name
 * @returns {boolean}
 */
function isInBoxPackageName(name) {
  const text = String(name || '');
  if (IN_BOX_PACKAGE_NAMES.has(text)) {
    return true;
  }
  if (text.replace(/\\/g, '/').includes('desktop-plugins/install-dsh-plugin')) {
    return true;
  }
  for (const pkg of IN_BOX_PACKAGE_NAMES) {
    if (text.startsWith(`${pkg}/`)) {
      return true;
    }
  }
  return false;
}

function classifyGenericFailure(text) {
  const blob = String(text || '');
  if (GENERIC_OOM.test(blob)) return 'oom';
  if (GENERIC_PORT_EXCLUDED.test(blob)) return 'port-excluded';
  if (GENERIC_PORT.test(blob)) return 'port-in-use';
  if (GENERIC_NODE.test(blob)) return 'missing-node';
  if (/domain ['"]session_projcache['"]:[^\r\n]*does not match its schema/i.test(blob)) return 'session-cache';
  return '';
}

function extractSuspectNames(text) {
  return [...new Set(extractEvidence(text).map((row) => row.name))];
}

function truncateLine(line) {
  const text = String(line || '').trim();
  if (text.length <= EVIDENCE_LINE_MAX) {
    return text;
  }
  return `${text.slice(0, EVIDENCE_LINE_MAX - 1)}…`;
}

/**
 * @param {string} corpus
 * @returns {Array<{ name: string, line: string }>}
 */
function extractEvidence(corpus) {
  const blob = String(corpus || '');
  const lines = blob.split('\n');
  const evidence = [];
  const seen = new Set();
  const addEvidence = (name, rawLine) => {
    const key = `${name}\0${rawLine}`;
    if (name && !seen.has(key)) {
      seen.add(key);
      evidence.push({ name, line: truncateLine(rawLine) });
    }
  };
  let webEntriesRemaining = 0;
  for (const rawLine of lines) {
    const header = WEB_BOOT_AUDIT_HEADER.exec(rawLine);
    if (header) {
      webEntriesRemaining = Number(header[1]);
    } else if (webEntriesRemaining > 0) {
      // State labels are evidence only inside the boot audit, not ordinary logs.
      const entry = WEB_BOOT_AUDIT_ENTRY.exec(rawLine);
      if (entry) {
        addEvidence(entry[1], rawLine);
        webEntriesRemaining -= 1;
      } else {
        webEntriesRemaining = 0;
      }
    }
    for (const { regex } of EVIDENCE_PATTERNS) {
      regex.lastIndex = 0;
      let match = regex.exec(rawLine);
      while (match) {
        addEvidence(match[1], rawLine);
        match = regex.exec(rawLine);
      }
    }
  }
  return evidence;
}

function buildForensicsSummary(forensics) {
  if (!forensics || typeof forensics !== 'object') {
    return {
      genericCause: null,
      suspectCount: 0,
      pluginTreeFailure: false,
      hasOrphans: false,
    };
  }
  const suspects = Array.isArray(forensics.suspects) ? forensics.suspects : [];
  const orphans = Array.isArray(forensics.orphanSuspects) ? forensics.orphanSuspects : [];
  return {
    genericCause: forensics.genericCause || null,
    suspectCount: suspects.length + orphans.length,
    pluginTreeFailure: Boolean(forensics.pluginTreeFailure),
    hasOrphans: orphans.length > 0,
    desktopRuntimeDamage: Boolean(forensics.desktopRuntimeDamage),
  };
}

function inspectPlugins({
  logs,
  lastStartError,
  pluginTreeFailure,
  recovery,
  plugins,
  bundles,
  disabledPlugins,
} = {}) {
  const logText = Array.isArray(logs) ? logs.join('\n') : String(logs || '');
  const corpus = [logText, lastStartError, recovery?.reason].filter(Boolean).join('\n');
  const genericCause = classifyGenericFailure(corpus);
  const pluginNames = new Set((plugins || []).map((row) => row.name || row));
  const seenEvidence = new Set();
  const evidence = extractEvidence(corpus).map((row) => {
    // Profile dependencies and disableable bundles use the package root.
    const root = row.name.endsWith('/client') ? row.name.slice(0, -'/client'.length) : row.name;
    const name = !pluginNames.has(row.name) && pluginNames.has(root) ? root : row.name;
    return { ...row, name };
  }).filter((row) => {
    const key = `${row.name}\0${row.line}`;
    if (seenEvidence.has(key)) return false;
    seenEvidence.add(key);
    return true;
  });
  const suspects = genericCause ? [] : [...new Set(evidence.map((row) => row.name))];
  const suspectSet = new Set(suspects);
  const disabled = new Set(Array.isArray(disabledPlugins) ? disabledPlugins : []);
  const bundleSet = new Set(Array.isArray(bundles) ? bundles : []);
  const rows = (plugins || []).map((row) => {
    const name = row.name || row;
    return {
      name,
      spec: row.spec || '',
      bundle: bundleSet.has(name) || row.bundle === true,
      preset: PRESET_PLUGINS.has(name),
      officialTemplate: OFFICIAL_TEMPLATE_BUNDLES.has(name),
      disabled: disabled.has(name) || row.disabled === true,
      suspect: suspectSet.has(name),
      orphan: false,
    };
  });
  const orphanSuspects = suspects
    .filter((name) => !pluginNames.has(name))
    .map((name) => ({
      name,
      spec: '',
      bundle: false,
      preset: PRESET_PLUGINS.has(name),
      officialTemplate: OFFICIAL_TEMPLATE_BUNDLES.has(name),
      disabled: disabled.has(name),
      suspect: true,
      orphan: true,
      // Only names ABSENT from the profile can be in-box damage: a user
      // plugin that shadows an in-box name stays a normal disableable row.
      inBox: isInBoxPackageName(name),
    }));
  const payload = {
    genericCause: genericCause || null,
    desktopRuntimeDamage: orphanSuspects.some((row) => row.inBox),
    pluginTreeFailure: Boolean(pluginTreeFailure),
    recovery: recovery && typeof recovery === 'object'
      ? {
          skipUserPlugins: recovery.skipUserPlugins === true,
          reason: typeof recovery.reason === 'string' ? recovery.reason : '',
          at: typeof recovery.at === 'string' ? recovery.at : '',
          appVersion: typeof recovery.appVersion === 'string' ? recovery.appVersion : '',
        }
      : { skipUserPlugins: false, reason: '', at: '', appVersion: '' },
    suspects: suspects.map((name) => ({ name })),
    orphanSuspects,
    evidence,
    plugins: rows,
  };
  payload.summary = buildForensicsSummary(payload);
  return payload;
}

function isPresetPlugin(name) {
  return PRESET_PLUGINS.has(String(name || ''));
}

module.exports = {
  PRESET_PLUGINS,
  EVIDENCE_LINE_MAX,
  classifyGenericFailure,
  extractSuspectNames,
  extractEvidence,
  buildForensicsSummary,
  inspectPlugins,
  isPresetPlugin,
  isInBoxPackageName,
};
