/**
 * Node ESM resolve hook for standalone tests and QA scripts that directly import
 * vendored first-party plugins (such as `vendor/dsh-whale/lib/*`) outside a
 * staged profile. Resolves bare peer specifiers strictly from `vendor/deepseek-harness`.
 */
import fs from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS_ROOT = path.join(ROOT, 'vendor', 'deepseek-harness');
const INSTALLED = Symbol.for('whaleisle.harnessPeerHooksInstalled');
const EXTRA_ANCHORS = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/cordis',
];
const SCOPED_PARENTS = [
  '/vendor/dsh-whale/',
  '/vendor/dsh-task-control/',
];

/**
 * @param {string} harnessRoot
 * @returns {NodeRequire[]}
 */
function buildAnchors(harnessRoot) {
  const cliPkg = path.join(harnessRoot, 'apps', 'cli', 'package.json');
  if (!fs.existsSync(cliPkg)) return [];
  const cliReq = createRequire(cliPkg);
  const anchors = [cliReq];
  for (const name of EXTRA_ANCHORS) {
    for (const req of [...anchors]) {
      try {
        anchors.push(createRequire(req.resolve(`${name}/package.json`)));
        break;
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
export function resolveHarnessPeerUrl(specifier, harnessRoot = HARNESS_ROOT) {
  const anchors = buildAnchors(harnessRoot);
  if (!anchors.length) return null;
  for (const req of anchors) {
    try {
      const resolved = req.resolve(specifier);
      if (resolved.startsWith(harnessRoot)) return pathToFileURL(resolved).href;
    } catch {
      /* Try next anchor. */
    }
  }
  return null;
}

/**
 * @param {string} [harnessRoot]
 * @returns {boolean}
 */
export function installHarnessPeerHooks(harnessRoot = HARNESS_ROOT) {
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
