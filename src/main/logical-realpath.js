'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolve links on the application's logical filesystem plane. On Windows,
 * legacy realpath retains DOS short names; expand those names component by
 * component without adopting native realpath's package-virtualized location.
 */
function logicalRealpathSync(target) {
  const real = fs.realpathSync(target);
  if (process.platform !== 'win32') return real;
  const root = path.parse(real).root;
  let current = root;
  for (const name of real.slice(root.length).split(path.sep).filter(Boolean)) {
    const original = path.join(current, name);
    if (/~\d+(?:\.[^.]*)?$/.test(name)) {
      const native = fs.realpathSync.native(original);
      const expanded = path.join(current, path.basename(native));
      // Only a name for the same node within the logical parent may replace
      // the short component. Native parent paths never become trust roots.
      if (fs.realpathSync.native(expanded).toLowerCase() === native.toLowerCase()) {
        current = expanded;
        continue;
      }
    }
    current = original;
  }
  return current;
}

module.exports = { logicalRealpathSync };
