'use strict';

// Follow relative `import … from './x'` / `require('./x')` edges from one
// source file across the desktop tree. Used by the asarUnpack coverage
// checks and by packaging fixtures so a new dependency of an unpacked
// entry cannot stay inside app.asar, where plain Node cannot read it.

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} root - absolute directory the results are made relative to.
 * @param {string} entry - absolute path of the root module.
 * @returns {string[]} root-relative posix paths of every reachable file, sorted.
 */
function localImportClosure(root, entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = fs.readFileSync(file, 'utf8');
    const pattern = /(?:from\s+|require\()\s*['"](\.[^'"]+)['"]/g;
    for (const match of src.matchAll(pattern)) {
      queue.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  return [...seen].sort();
}

module.exports = { localImportClosure };
