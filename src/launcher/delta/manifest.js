'use strict';

// Delta manifest schema (frozen public edge):
//   manifest.json { format, product, fromVersion, toVersion,
//     files: [{ path, op: 'add'|'patch'|'delete', sha256, size }] }
// Internal fields this lane adds on top: `baseSha256` (expected content of
// the installed file a patch/delete replaces — the apply-time base check)
// and `payload` (zip entry path for add/patch bytes). Payloads carry whole
// replacement bytes; the delta's size win comes from shipping only changed
// files, not from binary diffs.
const crypto = require('crypto');
const fs = require('fs');
const { WINDOWS_DEVICE_NAME } = require('../../main/download-path');

const FORMAT = 'dshd-delta@1';
const MANIFEST_ENTRY = 'manifest.json';
const OPS = new Set(['add', 'patch', 'delete']);
// Version atoms inside `<slug>-delta-<from>-<to>.zip` follow the published tag
// shape (`v?` + digit + dot/alnum, plus `-`/`+` for pre-release and build
// suffixes, e.g. v0.3.6-rc.1+candidate). The greedy first group splits from/to
// on the LAST `-`, so a `from` carrying a prerelease round-trips; a `to`
// ending in `-<version-start>` is inherently ambiguous in this scheme and not
// produced by real release tags.
const ASSET_VERSION = 'v?[0-9][0-9A-Za-z.+-]*';
const ASSET_RE = new RegExp(`-delta-(${ASSET_VERSION})-(${ASSET_VERSION})\\.zip$`, 'i');

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(file, deps = {}) {
  const fsx = deps.fs || fs;
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsx.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function sha512File(file, deps = {}) {
  const fsx = deps.fs || fs;
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fsx.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Manifest paths are forward-slash relatives. Anything that could escape or
// alias the install dir is rejected outright — a hostile manifest must never
// reach outside targetDir. `:` in ANY segment is refused (win32 resolves
// `sub/a:` onto the A: drive and `a/c:d/x` aliases `a/d/x`), as are Windows
// device names and a trailing `.`/space on any segment — all of them alias or
// fail on the apply target.
function isSafeRelPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 512) {
    return false;
  }
  if (/[\\:]/.test(rel) || rel.startsWith('/') || /[\0-\x1f]/.test(rel)) {
    return false;
  }
  return rel.split('/').every((seg) => seg && seg !== '.' && seg !== '..'
    && !/[. ]$/.test(seg) && !WINDOWS_DEVICE_NAME.test(seg));
}

// Dedup key under Windows semantics: two manifest records that only differ in
// case or Unicode normalization form write the same file and must collide.
function relPathKey(rel) {
  return rel.normalize('NFC').toLowerCase();
}

function deltaAssetName(product, fromVersion, toVersion) {
  const slug = String(product || 'app').trim().replace(/\s+/g, '-').replace(/[^\w.\-]+/g, '');
  const version = (value) => String(value || '').replace(/[^0-9A-Za-z.+-]+/g, '');
  return `${slug}-delta-${version(fromVersion)}-${version(toVersion)}.zip`;
}

function parseDeltaAssetName(name) {
  const match = String(name || '').match(ASSET_RE);
  return match ? { from: match[1], to: match[2] } : null;
}

class DeltaManifestError extends Error {
  constructor(message) {
    super(message);
    this.code = 'manifest-invalid';
  }
}

function expectHex(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new DeltaManifestError(`manifest ${label} must be a sha256 hex`);
  }
  return value;
}

function validateFileEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new DeltaManifestError(`manifest files[${index}] is not an object`);
  }
  if (!isSafeRelPath(entry.path)) {
    throw new DeltaManifestError(`manifest files[${index}].path is unsafe: ${String(entry.path)}`);
  }
  if (!OPS.has(entry.op)) {
    throw new DeltaManifestError(`manifest files[${index}].op must be add|patch|delete`);
  }
  const out = { path: entry.path, op: entry.op };
  if (entry.op === 'patch' || entry.op === 'delete') {
    out.baseSha256 = expectHex(entry.baseSha256, `files[${index}].baseSha256`);
  }
  if (entry.op === 'add' || entry.op === 'patch') {
    out.sha256 = expectHex(entry.sha256, `files[${index}].sha256`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new DeltaManifestError(`manifest files[${index}].size invalid`);
    }
    out.size = entry.size;
    if (!isSafeRelPath(entry.payload)) {
      throw new DeltaManifestError(`manifest files[${index}].payload is unsafe: ${String(entry.payload)}`);
    }
    out.payload = entry.payload;
  }
  return out;
}

function validateManifest(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!doc || typeof doc !== 'object') {
    throw new DeltaManifestError('manifest is not an object');
  }
  if (doc.format !== FORMAT) {
    throw new DeltaManifestError(`manifest format must be ${FORMAT}`);
  }
  if (typeof doc.fromVersion !== 'string' || !doc.fromVersion
    || typeof doc.toVersion !== 'string' || !doc.toVersion) {
    throw new DeltaManifestError('manifest fromVersion/toVersion missing');
  }
  if (!Array.isArray(doc.files)) {
    throw new DeltaManifestError('manifest files must be an array');
  }
  const seen = new Map();
  const files = doc.files.map((entry, index) => {
    const out = validateFileEntry(entry, index);
    const key = relPathKey(out.path);
    if (seen.has(key)) {
      throw new DeltaManifestError(`manifest duplicate path: ${out.path}`);
    }
    seen.set(key, out.path);
    return out;
  });
  // No record may sit inside another record's path (`x-y` plus `x-y/a`): one
  // disk entry cannot be both the file the first op writes and the directory
  // the second needs — without this gate the contradiction surfaces as a raw
  // EEXIST/ENOTDIR mid-apply.
  for (const row of files) {
    const segs = relPathKey(row.path).split('/');
    for (let i = 1; i < segs.length; i += 1) {
      const prefix = segs.slice(0, i).join('/');
      if (seen.has(prefix)) {
        throw new DeltaManifestError(`manifest conflicting paths: ${seen.get(prefix)} vs ${row.path}`);
      }
    }
  }
  return {
    format: FORMAT,
    product: typeof doc.product === 'string' ? doc.product : '',
    fromVersion: doc.fromVersion,
    toVersion: doc.toVersion,
    files,
  };
}

module.exports = {
  FORMAT,
  MANIFEST_ENTRY,
  isSafeRelPath,
  deltaAssetName,
  parseDeltaAssetName,
  sha256Hex,
  sha256File,
  sha512File,
  validateManifest,
};
