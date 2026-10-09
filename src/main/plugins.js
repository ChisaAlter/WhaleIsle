const fs = require('fs');
const { createRequire } = require('module');
const path = require('path');
const { pathToFileURL } = require('url');
const { getDesktopDshHome } = require('../shared/dsh-home');

const PROFILE = 'web';
const DROPPED = [
  '@dsh-external/dsh-genui',
  '@huanlin/dsh-plugin-yet-another-subagent',
  // The marketplace is desktop-owned (settings section `market` +
  // main-process curated engine). Mounting the third-party plugin again
  // would register a second `market` section, so it stays out of the
  // composition; its files are never deleted by this list.
  'dshmarket',
  // Settings → Remote → Channels ships first-party from vendor/dsh-im.
  // Reject marketplace installs of the same package to avoid a second mount.
  '@xmanrui/dsh-im',
  'dsh-im',
  'xmanrui-dsh-im',
  // Settings → 用量统计 ships first-party from vendor/dsh-usage-panel.
  // Reject marketplace installs of the same package to avoid a second mount.
  'dsh-usage-panel',
  // Bots ships first-party from vendor/dshbot.
  // Reject marketplace installs of the same package to avoid a second mount.
  'dshbot',
  'dsh-project',
  // The whale-girl assistant ships first-party from vendor/dsh-whale.
  'dsh-whale',
  // Remote workspaces (SSH) ship first-party from vendor/dsh-remote.
  // Reject marketplace installs of the same package to avoid a second mount.
  'dsh-remote',
];
// Exact unscoped basenames of the dropped families. A rename that only moves
// the package to a new scope (e.g. `@changfenhuang/dsh-genui`) or a new
// GitHub owner keeps the basename, so basename matching closes the rename
// bypass. Segment-exact only — `dsh-genui-viewer` is a different package.
const DROPPED_BASENAMES = [
  'dsh-genui',
  'dsh-plugin-yet-another-subagent',
  'dshmarket',
  'dsh-im',
  'xmanrui-dsh-im',
  'dsh-usage-panel',
  'dshbot',
  'dsh-project',
  'dsh-whale',
  'dsh-remote',
];

/** The npm name without its scope (`@scope/name` → `name`). */
function unscopedName(name) {
  const text = String(name || '').trim();
  if (text.startsWith('@')) {
    const slash = text.indexOf('/');
    return slash === -1 ? text : text.slice(slash + 1);
  }
  return text;
}

/**
 * Whether a package name belongs to a dropped plugin family: an exact
 * `DROPPED` entry, or any scope-rename whose unscoped basename matches a
 * dropped basename exactly.
 * @param {string} name - npm package name (scoped or bare).
 * @returns {boolean}
 */
function isDroppedPluginName(name) {
  const text = String(name || '').trim();
  if (!text) {
    return false;
  }
  return DROPPED.includes(text) || DROPPED_BASENAMES.includes(unscopedName(text));
}
const PATCH_BEGIN = '# --- dshd-gui-plugin-toggles ---';
const PATCH_END = '# --- end dshd-gui-plugin-toggles ---';
const DESKTOP_INSTALL_BEGIN = '# --- dshd-gui-desktop-install ---';
const DESKTOP_INSTALL_END = '# --- end dshd-gui-desktop-install ---';
const LEGACY_DESKTOP_INSTALL_BEGIN = '# --- dsh-gui-desktop-install ---';
const LEGACY_DESKTOP_INSTALL_END = '# --- end dsh-gui-desktop-install ---';
const DESKTOP_INSTALL_FILES = [
  'install-dsh-plugin.mjs',
  'install-dsh-plugin-client.js',
];
const DESKTOP_INSTALL_OVERLAY_FILENAME = 'desktop-install.patch.yml';
const LEGACY_SKIP_OVERLAY_FILENAME = 'skip-user-plugins.patch.yml';
const OFFICIAL_TEMPLATE_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
]);
// Older full-runtime installs made these bundles resolvable without a profile
// install. Preserve an explicit selection when the slim runtime no longer does.
const OPTIONAL_PROVIDER_BUNDLES = new Set([
  '@deepseek-ai/dsh-subagent-codex',
  '@deepseek-ai/dsh-subagent-claude-code',
]);

function dshHome() {
  return getDesktopDshHome();
}

function webProfileDir() {
  return path.join(dshHome(), 'profiles', PROFILE);
}

function defaultInstallAnchor() {
  try {
    const { harnessRoot } = require('./paths');
    return path.join(harnessRoot(), 'apps', 'cli', 'package.json');
  } catch {
    return '';
  }
}

function packageDirFromAnchor(anchor, packageName) {
  if (!anchor || !fs.existsSync(anchor)) return '';
  try {
    const searchPaths = createRequire(anchor).resolve.paths(packageName) || [];
    for (const searchPath of searchPaths) {
      const candidate = path.join(searchPath, packageName);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    }
  } catch {
    // Invalid anchors are treated as unresolved bundle names.
  }
  return '';
}

function bundleResolves(packageName, profileDir, installAnchor) {
  return [installAnchor, path.join(profileDir, 'package.json')]
    .filter(Boolean)
    .some((anchor) => Boolean(packageDirFromAnchor(anchor, packageName)));
}

/** Repair unresolved bundles while preserving selected optional providers. */
function healDanglingBundles(options = {}) {
  const profileDir = options.profileDir || webProfileDir();
  const file = path.join(profileDir, 'package.json');
  if (!fs.existsSync(file)) return { ok: false, reason: 'missing-profile', changed: false };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid-profile', changed: false };
  }
  const current = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(current)) return { ok: true, changed: false, removed: [] };
  const installAnchor = options.installAnchor || defaultInstallAnchor();
  const unresolved = current.filter((name) => (
    typeof name === 'string'
    && !OFFICIAL_TEMPLATE_BUNDLES.has(name)
    && !bundleResolves(name, profileDir, installAnchor)
  ));
  const requiresInstall = unresolved.filter(name => OPTIONAL_PROVIDER_BUNDLES.has(name));
  const removed = unresolved.filter(name => !OPTIONAL_PROVIDER_BUNDLES.has(name));
  if (removed.length === 0) return { ok: true, changed: false, removed: [], requiresInstall };
  const bundles = current.filter((name) => !removed.includes(name));
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh.profile, bundles },
  };
  writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, changed: true, removed, requiresInstall };
}

function manifestPath() {
  return path.join(webProfileDir(), 'package.json');
}

function patchPath() {
  return path.join(webProfileDir(), 'cordis.patch.yml');
}

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function replaceManagedBlock(text, begin, end, block) {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start !== -1 && stop !== -1 && stop > start) {
    return `${text.slice(0, start)}${block}${text.slice(stop + end.length).replace(/^\r?\n/, '')}`;
  }
  // The shipped profile template is comments plus a lone `[]`. Appending a
  // second document after that array is invalid YAML and loadProfile fails.
  const withoutEmpty = text.replace(/(^|\r?\n)\[\s*\][ \t]*(\r?\n)*$/, '$1');
  const prefix = withoutEmpty.trimEnd();
  return prefix ? `${prefix}\n\n${block}` : block;
}

function upsertManagedBlock(file, begin, end, body) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const block = `${begin}\n${body.trimEnd()}\n${end}\n`;
  const next = replaceManagedBlock(existing, begin, end, block);
  if (next === existing) {
    return false;
  }
  writeAtomic(file, next);
  return true;
}

function stripNamedBlock(text, begin, end) {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) {
    return text;
  }
  return `${text.slice(0, start)}${text.slice(stop + end.length)}`.replace(/\n{3,}/g, '\n\n');
}

/** Whether the text carries any YAML document content (a non-comment line). */
function hasYamlContent(text) {
  return String(text).split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
}

/**
 * A patch file whose managed blocks were stripped can end up comments-only,
 * which parses to null — and the CLI's parsePatchList rejects anything that
 * is not a top-level YAML array, failing every start. Restore the template's
 * `[]` terminal so the file stays a valid (empty) patch list.
 */
function normalizeEmptyPatchDocument(text) {
  if (hasYamlContent(text)) {
    return text;
  }
  const prefix = String(text).trimEnd();
  return prefix ? `${prefix}\n[]\n` : '[]\n';
}

function stripBlockFromFile(file, begin, end) {
  if (!fs.existsSync(file)) {
    return false;
  }
  const text = fs.readFileSync(file, 'utf8');
  const next = normalizeEmptyPatchDocument(stripNamedBlock(text, begin, end));
  if (next === text) {
    return false;
  }
  writeAtomic(file, next);
  return true;
}

function stripManagedPatch() {
  return stripBlockFromFile(patchPath(), PATCH_BEGIN, PATCH_END);
}

function hostPluginDir() {
  return path.join(__dirname, '..', 'host');
}

/**
 * Copy the desktop-only install_dsh_plugin Host plugin into the web profile
 * and keep its insert in a single desktop-owned overlay beside the copy.
 * EVERY start (full and skip) mounts the plugin through `--patch <overlay>`;
 * the profile's `cordis.patch.yml` is purely user-owned — this function only
 * strips the managed blocks earlier desktop versions wrote there (both marker
 * generations) and never writes one back. The strip and the overlay write
 * happen in the same call before every spawn, so no start can compose both
 * copies (the CLI's `insert` does not dedupe by id — two copies would
 * double-mount). Skip starts stay exact by construction: user layer =
 * profile patch + home patch, and neither is ever passed to `--patch`.
 * @param options - optional sourceDir / profileDir overrides for tests.
 */
function ensureDesktopInstallPlugin(options = {}) {
  const sourceDir = options.sourceDir || hostPluginDir();
  const profileDir = options.profileDir || webProfileDir();
  const destDir = path.join(profileDir, 'desktop-plugins', 'install-dsh-plugin');
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of DESKTOP_INSTALL_FILES) {
    const src = path.join(sourceDir, name);
    if (!fs.existsSync(src)) {
      return { ok: false, reason: `missing-source:${name}` };
    }
    fs.copyFileSync(src, path.join(destDir, name));
  }
  // The overlay mounts install-dsh-plugin.mjs by file URL. The request-time
  // plugin-package inventory resolves such an entry's owning manifest by
  // walking up from the module path; without this package.json it reaches
  // the versionless profile marker and throws, failing every DeepSeek
  // request.
  const manifestFile = path.join(destDir, 'package.json');
  const manifestContents = `${JSON.stringify({
    name: 'dshd-desktop-plugin-install',
    version: require('../../package.json').version,
    private: true,
  }, null, 2)}\n`;
  const existingManifest = fs.existsSync(manifestFile)
    ? fs.readFileSync(manifestFile, 'utf8')
    : '';
  if (existingManifest !== manifestContents) {
    writeAtomic(manifestFile, manifestContents);
  }
  const entry = path.join(destDir, 'install-dsh-plugin.mjs');
  const href = pathToFileURL(entry).href;
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  const strippedLegacy = stripBlockFromFile(
    patchFile,
    LEGACY_DESKTOP_INSTALL_BEGIN,
    LEGACY_DESKTOP_INSTALL_END,
  );
  const strippedManaged = stripBlockFromFile(
    patchFile,
    DESKTOP_INSTALL_BEGIN,
    DESKTOP_INSTALL_END,
  );
  const body = [
    '- insert:',
    '    - id: dshd-desktop-plugin-install',
    `      name: ${JSON.stringify(href)}`,
  ].join('\n');
  const overlayFile = path.join(destDir, DESKTOP_INSTALL_OVERLAY_FILENAME);
  const overlayContents = [
    '# Desktop-managed overlay passed to every start (full and skip) via',
    '# --patch: only the install plugin insert, never the profile user layer.',
    '# Regenerated on every start; do not edit.',
    body,
    '',
  ].join('\n');
  const existingOverlay = fs.existsSync(overlayFile)
    ? fs.readFileSync(overlayFile, 'utf8')
    : '';
  if (existingOverlay !== overlayContents) {
    writeAtomic(overlayFile, overlayContents);
  }
  const legacyOverlay = path.join(destDir, LEGACY_SKIP_OVERLAY_FILENAME);
  if (fs.existsSync(legacyOverlay)) {
    try {
      fs.unlinkSync(legacyOverlay);
    } catch {
      // Stale skip-era overlay; never passed to --patch anymore, so a locked
      // file is only cosmetic residue.
    }
  }
  return {
    ok: true,
    destDir,
    href,
    patchFile,
    overlayFile,
    patchChanged: strippedManaged || strippedLegacy,
  };
}

/** Drop retired community plugins from the live web profile so they cannot boot. */
function stripDroppedPlugins() {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'missing-profile' };
  }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  if (manifest.dependencies) {
    for (const name of Object.keys(manifest.dependencies)) {
      if (isDroppedPluginName(name)) {
        delete manifest.dependencies[name];
        changed = true;
      }
    }
  }
  const current = manifest.dsh?.profile?.bundles;
  if (Array.isArray(current)) {
    const bundles = current.filter((name) => !isDroppedPluginName(name));
    if (bundles.length !== current.length) {
      manifest.dsh = {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh.profile,
          bundles,
        },
      };
      changed = true;
    }
  }
  if (changed) {
    writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const patchChanged = stripManagedPatch();
  return { ok: true, changed, patchChanged };
}

function listInstalledPlugins() {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return { ok: true, profile: PROFILE, profileDir: webProfileDir(), plugins: [], bundles: [] };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object'
      ? manifest.dependencies
      : {};
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
    return {
      ok: true,
      profile: PROFILE,
      profileDir: webProfileDir(),
      plugins: Object.entries(dependencies).map(([name, spec]) => ({
        name,
        spec: String(spec || ''),
        bundle: bundles.includes(name),
        dropped: isDroppedPluginName(name),
      })),
      bundles,
    };
  } catch {
    return { ok: false, profile: PROFILE, profileDir: webProfileDir(), plugins: [], bundles: [] };
  }
}

function uniqueNames(names) {
  return [...new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))];
}

/**
 * Drop disabled user bundles from the live profile. Official template
 * bundles stay loaded. Enabling a name puts it back when it is still a
 * dependency.
 */
function applyDisabledBundles(names, options = {}) {
  const file = options.manifestPath || manifestPath();
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'missing-profile', changed: false, bundles: [] };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid-profile', changed: false, bundles: [] };
  }
  const disabled = new Set(uniqueNames(names).filter((name) => !OFFICIAL_TEMPLATE_BUNDLES.has(name)));
  const current = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
  const bundles = current.filter((name) => typeof name === 'string' && !disabled.has(name));
  const changed = bundles.length !== current.length || bundles.some((name, index) => name !== current[index]);
  if (changed) {
    manifest.dsh = {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles,
      },
    };
    writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { ok: true, changed, bundles, disabled: [...disabled] };
}

function setBundleEnabled(name, enabled, options = {}) {
  const raw = String(name || '').trim();
  if (!raw) {
    return { ok: false, reason: 'missing-name', changed: false };
  }
  if (OFFICIAL_TEMPLATE_BUNDLES.has(raw) && enabled === false) {
    return { ok: false, reason: 'official-template', changed: false };
  }
  const file = options.manifestPath || manifestPath();
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'missing-profile', changed: false };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid-profile', changed: false };
  }
  const current = Array.isArray(manifest.dsh?.profile?.bundles) ? [...manifest.dsh.profile.bundles] : [];
  const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object'
    ? manifest.dependencies
    : {};
  let bundles;
  if (enabled) {
    if (!Object.prototype.hasOwnProperty.call(dependencies, raw)) {
      return { ok: false, reason: 'missing-dependency', changed: false, bundles: current };
    }
    bundles = current.includes(raw) ? current : [...current, raw];
  } else {
    bundles = current.filter((item) => item !== raw);
  }
  const changed = bundles.length !== current.length || bundles.some((item, index) => item !== current[index]);
  if (changed) {
    manifest.dsh = {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles,
      },
    };
    writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { ok: true, changed, bundles };
}

module.exports = {
  PROFILE,
  DROPPED,
  DROPPED_BASENAMES,
  unscopedName,
  isDroppedPluginName,
  OFFICIAL_TEMPLATE_BUNDLES,
  webProfileDir,
  stripDroppedPlugins,
  healDanglingBundles,
  listInstalledPlugins,
  applyDisabledBundles,
  setBundleEnabled,
  ensureDesktopInstallPlugin,
  upsertManagedBlock,
  stripBlockFromFile,
  DESKTOP_INSTALL_BEGIN,
  DESKTOP_INSTALL_END,
  LEGACY_DESKTOP_INSTALL_BEGIN,
  LEGACY_DESKTOP_INSTALL_END,
};
