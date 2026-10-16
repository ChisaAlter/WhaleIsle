/** Resolve Project peers from the same built Harness instances used by composition tests. */
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectPackage = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const harness = resolve(projectPackage, '../deepseek-harness');
export const cliRequire = createRequire(join(harness, 'apps/cli/package.json'));
const anchors = [cliRequire, ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-agent-team-profile'].map(name => createRequire(cliRequire.resolve(`${name}/package.json`)))];
anchors.push(createRequire(anchors[1].resolve('@deepseek-ai/dsh-storage-domain/package.json')));
export function resolvePackage(name) {
  for (const anchor of anchors) try { return anchor.resolve(name); }
  catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; }
  throw new Error(`Missing built Harness dependency ${name}.`);
}

export const projectUrl = pathToFileURL(`${projectPackage}${sep}`).href;
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(projectUrl) && !specifier.startsWith('.') && !specifier.startsWith('node:') && !specifier.startsWith('file:')) {
    return { url: pathToFileURL(resolvePackage(specifier)).href, shortCircuit: true };
  }
  return next(specifier, context);
} });

export const { ProjectService } = await import(pathToFileURL(join(projectPackage, 'lib/service.js')).href);
