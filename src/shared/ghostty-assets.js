'use strict';

const fs = require('fs');
const path = require('path');

/** Filenames served from dirname(client.js)/assets/ by the client module host. */
const GHOSTTY_ASSET_FILES = Object.freeze([
  'ghostty-vt.wasm',
  'ghostty-write-pty.wasm',
  'SymbolsNerdFontMono-Regular.woff2',
]);

/**
 * Candidate package roots inside a harness tree (workspace layout and flattened node_modules).
 * @param {string} harnessRoot
 * @returns {string[]}
 */
function terminalPackageRoots(harnessRoot) {
  return [
    path.join(harnessRoot, 'packages', 'client', 'ui-user-terminal'),
    path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal'),
  ];
}

/**
 * @param {string} packageRoot
 * @returns {boolean}
 */
function hasTerminalClientJs(packageRoot) {
  return fs.existsSync(path.join(packageRoot, 'lib', 'client.js'));
}

/**
 * @param {string} packageRoot
 * @returns {boolean}
 */
function ghosttyAssetsComplete(packageRoot) {
  const assets = path.join(packageRoot, 'lib', 'assets');
  return GHOSTTY_ASSET_FILES.every((name) => fs.existsSync(path.join(assets, name)));
}

/**
 * Copy vendored Ghostty wasm/font into lib/assets when sources exist beside the package.
 * Mirrors packages/client/ui-user-terminal/scripts/copy-ghostty-assets.mjs.
 * @param {string} packageRoot
 * @param {{ fromPackageRoot?: string }} [options]
 * @returns {{ copied: boolean, reason?: string }}
 */
function copyGhosttyAssetsInto(packageRoot, options = {}) {
  const sourceRoot = options.fromPackageRoot || packageRoot;
  const sources = [
    {
      from: path.join(sourceRoot, 'src', 'client', 'ghostty', 'vendor', 'ghostty-vt.wasm'),
      to: path.join(packageRoot, 'lib', 'assets', 'ghostty-vt.wasm'),
    },
    {
      from: path.join(sourceRoot, 'src', 'client', 'ghostty', 'vendor', 'ghostty-write-pty.wasm'),
      to: path.join(packageRoot, 'lib', 'assets', 'ghostty-write-pty.wasm'),
    },
    {
      from: path.join(sourceRoot, 'src', 'client', 'ghostty', 'fonts', 'SymbolsNerdFontMono-Regular.woff2'),
      to: path.join(packageRoot, 'lib', 'assets', 'SymbolsNerdFontMono-Regular.woff2'),
    },
  ];
  const assetFallback = GHOSTTY_ASSET_FILES.map((name) => ({
    from: path.join(sourceRoot, 'lib', 'assets', name),
    to: path.join(packageRoot, 'lib', 'assets', name),
  }));

  let pairs = sources;
  if (!sources.every(({ from }) => fs.existsSync(from))) {
    if (assetFallback.every(({ from }) => fs.existsSync(from))) {
      pairs = assetFallback;
    } else {
      return { copied: false, reason: `missing source under ${sourceRoot}` };
    }
  }
  fs.mkdirSync(path.join(packageRoot, 'lib', 'assets'), { recursive: true });
  for (const { from, to } of pairs) {
    fs.copyFileSync(from, to);
  }
  return { copied: true };
}

/**
 * Roots that already ship lib/client.js (the host serves assets next to that file).
 * @param {string} harnessRoot
 * @returns {string[]}
 */
function terminalRootsWithClient(harnessRoot) {
  return terminalPackageRoots(harnessRoot).filter((root) => hasTerminalClientJs(root));
}

/**
 * Ensure every terminal package that has client.js also has Ghostty assets.
 * Copies from src (or a sibling package's lib/assets) when possible.
 * @param {string} harnessRoot
 * @returns {{ ok: boolean, roots: string[], detail: string }}
 */
function ensureGhosttyAssetsInHarness(harnessRoot) {
  const roots = terminalRootsWithClient(harnessRoot);
  if (roots.length === 0) {
    return {
      ok: false,
      roots: [],
      detail: 'no ui-user-terminal lib/client.js under packages/ or node_modules/',
    };
  }
  const donor = roots.find((root) => ghosttyAssetsComplete(root))
    || roots.find((root) => {
      const vendor = path.join(root, 'src', 'client', 'ghostty', 'vendor', 'ghostty-vt.wasm');
      return fs.existsSync(vendor);
    });
  const details = [];
  for (const root of roots) {
    if (ghosttyAssetsComplete(root)) {
      details.push(`${root}: already complete`);
      continue;
    }
    const result = copyGhosttyAssetsInto(root, donor && donor !== root ? { fromPackageRoot: donor } : undefined);
    if (!result.copied) {
      details.push(`${root}: ${result.reason}`);
      continue;
    }
    details.push(`${root}: copied`);
  }
  const ok = roots.every((root) => ghosttyAssetsComplete(root));
  return { ok, roots, detail: details.join('; ') };
}

/**
 * True when every terminal client.js has a complete assets/ sibling set.
 * @param {string} harnessRoot
 * @returns {boolean}
 */
function harnessHasGhosttyAssets(harnessRoot) {
  const roots = terminalRootsWithClient(harnessRoot);
  return roots.length > 0 && roots.every((root) => ghosttyAssetsComplete(root));
}

/**
 * Human-readable missing paths for assert errors.
 * @param {string} harnessRoot
 * @returns {string[]}
 */
function missingGhosttyAssetPaths(harnessRoot) {
  const missing = [];
  const roots = terminalRootsWithClient(harnessRoot);
  if (roots.length === 0) {
    missing.push(path.join('packages', 'client', 'ui-user-terminal', 'lib', 'client.js'));
    missing.push(path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal', 'lib', 'client.js'));
    return missing;
  }
  for (const root of roots) {
    for (const name of GHOSTTY_ASSET_FILES) {
      const relative = path.relative(harnessRoot, path.join(root, 'lib', 'assets', name));
      if (!fs.existsSync(path.join(root, 'lib', 'assets', name))) {
        missing.push(relative);
      }
    }
  }
  return missing;
}

module.exports = {
  GHOSTTY_ASSET_FILES,
  ghosttyAssetsComplete,
  copyGhosttyAssetsInto,
  ensureGhosttyAssetsInHarness,
  harnessHasGhosttyAssets,
  missingGhosttyAssetPaths,
};
