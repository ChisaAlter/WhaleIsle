'use strict';

const fs = require('node:fs');
const { createRequire, registerHooks } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const HARNESS_ROOT = path.join(ROOT, 'vendor', 'deepseek-harness');
const INSTALLED = Symbol.for('whaleisle.harnessPeerHooksInstalled');
const EXTRA_ANCHORS = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/cordis',
];
const SCOPED_PARENTS = [
  '/vendor/dsh-whale/',
  '/vendor/dsh-task-control/',
];

/**
 * @param {string} canonicalHarness
 * @returns {NodeRequire[]}
 */
function buildAnchors(canonicalHarness) {
  const cliPkg = path.join(canonicalHarness, 'apps', 'cli', 'package.json');
  if (!fs.existsSync(cliPkg)) return [];
  const anchors = [createRequire(cliPkg)];
  for (const name of EXTRA_ANCHORS) {
    for (const req of [...anchors]) {
      try {
        const resolved = fs.realpathSync(req.resolve(`${name}/package.json`));
        if (resolved.startsWith(canonicalHarness)) {
          anchors.push(createRequire(resolved));
          break;
        }
      } catch {
        /* Try next anchor inside Harness. */
      }
    }
  }
  return anchors;
}

/**
 * @param {string} specifier
 * @param {string} [harnessRoot]
 * @returns {string | null}
 */
function resolveHarnessPeerPath(specifier, harnessRoot = HARNESS_ROOT) {
  if (!fs.existsSync(path.join(harnessRoot, 'apps', 'cli', 'package.json'))) return null;
  const canonicalHarness = fs.realpathSync(harnessRoot);
  for (const req of buildAnchors(canonicalHarness)) {
    try {
      const target = fs.realpathSync(req.resolve(specifier));
      if (target.startsWith(canonicalHarness)) return target;
    } catch {
      /* Try next anchor inside Harness. */
    }
  }
  return null;
}

/**
 * @param {string} [harnessRoot]
 * @returns {boolean}
 */
function installHarnessPeerHooks(harnessRoot = HARNESS_ROOT) {
  const state = /** @type {Record<symbol, boolean | undefined>} */ (/** @type {unknown} */ (globalThis));
  if (state[INSTALLED]) return false;
  if (!fs.existsSync(path.join(harnessRoot, 'apps', 'cli', 'package.json'))) return false;
  const canonicalHarness = fs.realpathSync(harnessRoot);
  const anchors = buildAnchors(canonicalHarness);
  state[INSTALLED] = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        !specifier.startsWith('.')
        && !specifier.startsWith('node:')
        && !specifier.startsWith('file:')
        && !path.isAbsolute(specifier)
        && SCOPED_PARENTS.some((seg) => (context.parentURL || '').includes(seg))
      ) {
        for (const req of anchors) {
          try {
            const target = fs.realpathSync(req.resolve(specifier));
            if (target.startsWith(canonicalHarness)) {
              return { url: pathToFileURL(target).href, shortCircuit: true };
            }
          } catch {
            /* Fall through to next anchor or default resolver. */
          }
        }
      }
      return nextResolve(specifier, context);
    },
  });
  return true;
}

installHarnessPeerHooks();

module.exports = {
  installHarnessPeerHooks,
  resolveHarnessPeerPath,
};
