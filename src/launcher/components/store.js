'use strict';

// Payload/state layout for the launcher components platform.
//   <userData>/components/registry.json          — installed records
//   <userData>/components/<id>/versions/<v>/     — immutable payload per version
//   <userData>/components/<id>/data/             — per-component data dir,
//                                                  survives update/rollback/uninstall
//
// A dedicated file was chosen over the `components` config field: records
// carry fast-changing runtime state (pid/state/lastError) that would churn
// config.json on every transition, and the 64KiB whitelist cap exists for
// renderer-owned blobs, not for main-process lifecycle bookkeeping.
const fs = require('fs');
const path = require('path');

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const RECORD_STATES = new Set(['installed', 'stopped', 'running', 'error']);

/** @param {any} id */
function validComponentId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function defaultUserDataDir() {
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    return '';
  }
}

// The launcher's OWN userData — never the managed desktop runtime dir and
// never inside a dsh-home / profiles tree.
/** @param {{ componentsRoot?: string, userDataDir?: string }} [deps] */
function componentsRoot(deps = {}) {
  if (deps.componentsRoot) {
    return deps.componentsRoot;
  }
  const base = deps.userDataDir || defaultUserDataDir();
  return base ? path.join(base, 'components') : '';
}

/** @param {string} root */
function registryFile(root) {
  return path.join(root, 'registry.json');
}

/**
 * @param {string} root
 * @param {string} id
 */
function versionsDir(root, id) {
  return path.join(root, id, 'versions');
}

/**
 * @param {string} root
 * @param {string} id
 * @param {any} version
 */
function versionDir(root, id, version) {
  return path.join(root, id, 'versions', String(version));
}

/**
 * @param {string} root
 * @param {string} id
 */
function stagingDir(root, id) {
  return path.join(root, id, 'versions', `.staging-${process.pid}-${Date.now()}`);
}

/**
 * @param {string} root
 * @param {string} id
 */
function dataDir(root, id) {
  return path.join(root, id, 'data');
}

/**
 * @param {string} root
 * @param {string} id
 */
function stateFile(root, id) {
  return path.join(dataDir(root, id), 'state.json');
}

/**
 * @param {string} root
 * @param {string} id
 */
function logFile(root, id) {
  return path.join(dataDir(root, id), 'component.log');
}

/**
 * @param {string} id
 * @param {any} raw
 */
function normalizeRecord(id, raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = {
    id,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '',
    version: typeof raw.version === 'string' ? raw.version : '',
    previous: typeof raw.previous === 'string' && raw.previous ? raw.previous : null,
    state: RECORD_STATES.has(raw.state) ? raw.state : 'installed',
    pid: Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null,
    url: typeof raw.url === 'string' ? raw.url.slice(0, 200) : '',
    source: typeof raw.source === 'string' ? raw.source.slice(0, 40) : '',
    installedAt: typeof raw.installedAt === 'string' ? raw.installedAt.slice(0, 40) : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : '',
    lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 500) : '',
  };
  return record.version ? record : null;
}

/** @param {any} raw */
function normalizeRegistry(raw) {
  /** @type {{ components: Record<string, any> }} */
  const out = { components: {} };
  if (!raw || typeof raw !== 'object' || typeof raw.components !== 'object' || !raw.components) {
    return out;
  }
  for (const [id, record] of Object.entries(raw.components)) {
    if (!validComponentId(id)) {
      continue;
    }
    const normalized = normalizeRecord(id, record);
    if (normalized) {
      out.components[id] = normalized;
    }
  }
  return out;
}

// Tolerant read: a torn/corrupt file is moved aside for evidence and the
// platform starts from an empty registry rather than crashing the panel.
/**
 * @param {string} root
 * @param {{ readFileSync?: typeof fs.readFileSync, renameSync?: typeof fs.renameSync }} [deps]
 */
function loadRegistry(root, deps = {}) {
  const readFile = deps.readFileSync || fs.readFileSync.bind(fs);
  const rename = deps.renameSync || fs.renameSync.bind(fs);
  const file = registryFile(root);
  let raw;
  try {
    raw = readFile(file, 'utf8');
  } catch {
    return { components: {}, corrupt: false };
  }
  try {
    return { ...normalizeRegistry(JSON.parse(raw)), corrupt: false };
  } catch {
    try {
      rename(file, `${file}.broken`);
    } catch {
      // evidence copy best effort
    }
    return { components: {}, corrupt: true };
  }
}

// Atomic-ish write: same-directory tmp + rename so a crash mid-write never
// leaves a half JSON; Windows rename replaces existing targets on modern Node.
/**
 * @param {string} root
 * @param {any} registry
 * @param {{ fs?: typeof fs }} [deps]
 */
function saveRegistry(root, registry, deps = {}) {
  const fsp = deps.fs || fs;
  const file = registryFile(root);
  const tmp = `${file}.tmp`;
  fsp.mkdirSync(root, { recursive: true });
  fsp.writeFileSync(tmp, `${JSON.stringify({ components: registry.components || {} }, null, 2)}\n`);
  try {
    fsp.renameSync(tmp, file);
  } catch {
    fsp.writeFileSync(file, fsp.readFileSync(tmp, 'utf8'));
    try {
      fsp.unlinkSync(tmp);
    } catch {
      // tmp cleanup best effort
    }
  }
}

module.exports = {
  validComponentId,
  componentsRoot,
  registryFile,
  versionsDir,
  versionDir,
  stagingDir,
  dataDir,
  stateFile,
  logFile,
  normalizeRegistry,
  loadRegistry,
  saveRegistry,
};
