/** Resolve Project peers from the same built Harness instances used by composition tests. */
import '../../../scripts/lib/harness-peer-hook.mjs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectPackage = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const harness = resolve(projectPackage, '../deepseek-harness');
export const cliRequire = createRequire(join(harness, 'apps/cli/package.json'));
const anchors = [
  cliRequire,
  ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].map((pkgName) =>
    createRequire(cliRequire.resolve(`${pkgName}/package.json`)),
  ),
];

export function resolvePackage(pkgName) {
  for (const anchor of anchors) {
    try {
      return anchor.resolve(pkgName);
    } catch (error) {
      if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    }
  }
  throw new Error(`Missing built Harness dependency ${pkgName}.`);
}

export const projectUrl = pathToFileURL(`${projectPackage}${sep}`).href;
registerHooks({
  resolve(specifier, context, next) {
    if (
      context.parentURL?.startsWith(projectUrl)
      && !specifier.startsWith('.')
      && !specifier.startsWith('node:')
      && !specifier.startsWith('file:')
    ) {
      return { url: pathToFileURL(resolvePackage(specifier)).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

export const { ProjectService } = await import(pathToFileURL(join(projectPackage, 'lib/service.js')).href);
export const { apply } = await import(pathToFileURL(join(projectPackage, 'lib/index.js')).href);
export const { registerProjectTools } = await import(pathToFileURL(join(projectPackage, 'lib/tools.js')).href);
export const { createWorkerScopeGuard } = await import(pathToFileURL(join(projectPackage, 'lib/scope-guard.js')).href);
