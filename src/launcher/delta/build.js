'use strict';

// Build a delta artifact between two installed-runtime trees: hash both
// sides, emit add/patch/delete ops for the differences, and pack payload
// bytes + manifest.json into the zip container.
const fs = require('fs');
const path = require('path');
const manifest = require('./manifest');
const zip = require('./zip');

/** rel-path (forward slashes) -> { size, sha256 } for every file under dir. */
async function scanTree(dir, deps = {}) {
  const fsx = deps.fs || fs;
  const out = new Map();
  const walk = async (current) => {
    for (const entry of fsx.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        // Junctions into vendor/node_modules resolve to directories — the
        // zip format has no link type, so dir-links are skipped (not
        // recursed into twice); file-links ship as regular file bytes.
        let target;
        try { target = fsx.statSync(full); } catch { continue; }
        if (target.isDirectory()) {
          continue;
        }
        const rel = path.relative(dir, full).split(path.sep).join('/');
        out.set(rel, { size: target.size, sha256: await manifest.sha256File(full, deps) });
      } else if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(dir, full).split(path.sep).join('/');
        const stat = fsx.statSync(full);
        out.set(rel, { size: stat.size, sha256: await manifest.sha256File(full, deps) });
      }
    }
  };
  await walk(dir);
  return out;
}

function diffTrees(fromTree, toTree) {
  const ops = [];
  for (const [rel, to] of toTree) {
    const base = fromTree.get(rel);
    if (!base) {
      ops.push({ path: rel, op: 'add', sha256: to.sha256, size: to.size });
    } else if (base.sha256 !== to.sha256) {
      ops.push({ path: rel, op: 'patch', baseSha256: base.sha256, sha256: to.sha256, size: to.size });
    }
  }
  for (const [rel, base] of fromTree) {
    if (!toTree.has(rel)) {
      ops.push({ path: rel, op: 'delete', baseSha256: base.sha256 });
    }
  }
  ops.sort((a, b) => a.path.localeCompare(b.path));
  return ops;
}

/**
 * @returns {{outFile, manifest, sha512, size, stats}} — sha512 is the
 * artifact digest that lands in a release's SHA512SUMS.txt line.
 */
async function buildDelta(options, deps = {}) {
  const fsx = deps.fs || fs;
  const { fromDir, toDir, outFile } = options;
  const product = options.product || 'Whale-Isle';
  const fromVersion = options.fromVersion || 'unknown';
  const toVersion = options.toVersion || 'unknown';
  if (!fromDir || !toDir || !outFile) {
    throw new Error('buildDelta requires fromDir, toDir, outFile');
  }
  const fromTree = await scanTree(fromDir, deps);
  const toTree = await scanTree(toDir, deps);
  const ops = diffTrees(fromTree, toTree);

  const files = [];
  const entries = [];
  let payloadIndex = 0;
  for (const op of ops) {
    const row = { ...op };
    if (op.op === 'add' || op.op === 'patch') {
      row.payload = `payload/${payloadIndex}`;
      payloadIndex += 1;
      entries.push({ name: row.payload, file: path.join(toDir, ...op.path.split('/')) });
    }
    files.push(row);
  }
  const doc = {
    format: manifest.FORMAT,
    product,
    fromVersion,
    toVersion,
    files,
  };
  entries.push({ name: manifest.MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(doc, null, 2)) });
  fsx.mkdirSync(path.dirname(outFile), { recursive: true });
  zip.writeZip(outFile, entries, deps);
  const stat = fsx.statSync(outFile);
  return {
    outFile,
    manifest: doc,
    sha512: await manifest.sha512File(outFile, deps),
    size: stat.size,
    stats: {
      added: ops.filter((o) => o.op === 'add').length,
      patched: ops.filter((o) => o.op === 'patch').length,
      deleted: ops.filter((o) => o.op === 'delete').length,
      unchanged: [...toTree.keys()].filter((rel) => fromTree.get(rel)?.sha256 === toTree.get(rel)?.sha256).length,
    },
  };
}

module.exports = { scanTree, buildDelta };
