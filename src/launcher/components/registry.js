'use strict';

// Component catalog. v1 has one source: the bundled samples tree
//   <repoRoot>/components/samples/<id>/<version>/manifest.json + entry file
// A manifest is `{id,name,version,description,entry,kind?}`; the entry must
// be a relative path inside the payload dir (no absolute, no `..`).
// `source` on every catalog row reads 'bundled' — later remote catalog lanes
// plug in by adding rows with their own source id, not by changing shape.
const fs = require('fs');
const path = require('path');
const { validComponentId } = require('./store');

const SOURCE_BUNDLED = 'bundled';

function defaultSamplesRoot() {
  const candidates = [];
  try {
    const { projectRoot } = require('../../main/paths');
    candidates.push(path.join(projectRoot(), 'components', 'samples'));
  } catch {
    // outside Electron / missing paths module — fall through to repo-relative
  }
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'components', 'samples'));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  return candidates[0] || '';
}

/**
 * @param {any} a
 * @param {any} b
 */
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((part) => parseInt(part, 10) || 0);
  const pb = String(b || '').split('.').map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return 0;
}

/**
 * @param {string} dir
 * @param {any} entry
 */
function safeEntryPath(dir, entry) {
  if (typeof entry !== 'string' || !entry || path.isAbsolute(entry) || path.win32.isAbsolute(entry) || /^[a-z]:/i.test(entry)) {
    return '';
  }
  const base = path.resolve(dir);
  const resolved = path.resolve(base, entry.replaceAll('\\', '/'));
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    return '';
  }
  return resolved;
}

// A manifest that fails validation yields no catalog row — a broken payload
// must not become installable by accident.
/**
 * @param {string} dir
 * @param {{ fs?: typeof fs }} [deps]
 */
function readManifest(dir, deps = {}) {
  const fsp = deps.fs || fs;
  let manifest;
  try {
    manifest = JSON.parse(fsp.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object') {
    return null;
  }
  if (!validComponentId(manifest.id) || typeof manifest.version !== 'string' || !manifest.version) {
    return null;
  }
  const entryFile = safeEntryPath(dir, manifest.entry);
  if (!entryFile) {
    return null;
  }
  try {
    if (!fsp.statSync(entryFile).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    id: manifest.id,
    name: typeof manifest.name === 'string' && manifest.name ? manifest.name.slice(0, 120) : manifest.id,
    version: manifest.version,
    description: typeof manifest.description === 'string' ? manifest.description.slice(0, 400) : '',
    kind: manifest.kind === 'tool' ? 'tool' : 'service',
    entry: manifest.entry,
    entryFile,
    dir,
    source: SOURCE_BUNDLED,
  };
}

// Scan samplesRoot/<id>/<version>/ — a version dir only counts when its
// manifest id/version match the directory names.
/**
 * @param {{ samplesRoot?: string }} [options]
 * @param {{ fs?: typeof fs }} [deps]
 */
function scanCatalog(options = {}, deps = {}) {
  const fsp = deps.fs || fs;
  const root = options.samplesRoot !== undefined ? options.samplesRoot : defaultSamplesRoot();
  /** @type {Map<string, any>} */
  const components = new Map();
  if (!root) {
    return [];
  }
  let idDirs = [];
  try {
    idDirs = fsp.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const idDir of idDirs) {
    if (!idDir.isDirectory() || !validComponentId(idDir.name)) {
      continue;
    }
    const idPath = path.join(root, idDir.name);
    let versionDirs = [];
    try {
      versionDirs = fsp.readdirSync(idPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const vDir of versionDirs) {
      if (!vDir.isDirectory()) {
        continue;
      }
      const dir = path.join(idPath, vDir.name);
      const manifest = readManifest(dir, deps);
      if (!manifest || manifest.id !== idDir.name || manifest.version !== vDir.name) {
        continue;
      }
      if (!components.has(manifest.id)) {
        components.set(manifest.id, {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          kind: manifest.kind,
          source: manifest.source,
          versions: [],
          latest: '',
        });
      }
      components.get(manifest.id).versions.push(manifest);
    }
  }
  const list = [];
  for (const entry of components.values()) {
    entry.versions.sort((/** @type {any} */ a, /** @type {any} */ b) => compareVersions(a.version, b.version));
    entry.latest = entry.versions.length ? entry.versions[entry.versions.length - 1].version : '';
    entry.description = entry.description || (entry.versions[0]?.description ?? '');
    if (entry.versions.length) {
      list.push(entry);
    }
  }
  list.sort((a, b) => a.id.localeCompare(b.id));
  return list;
}

/**
 * @param {any} entry
 * @param {string} [version]
 */
function resolveCatalogVersion(entry, version) {
  if (!entry || !Array.isArray(entry.versions) || !entry.versions.length) {
    return null;
  }
  if (!version) {
    return entry.versions[entry.versions.length - 1];
  }
  return entry.versions.find((/** @type {any} */ row) => row.version === version) || null;
}

module.exports = {
  compareVersions,
  safeEntryPath,
  readManifest,
  scanCatalog,
  resolveCatalogVersion,
};
