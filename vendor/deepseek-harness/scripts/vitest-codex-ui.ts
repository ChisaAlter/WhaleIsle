/** ESM test face for the Codex sidebar's committed browser-factory entry. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import * as primitives from '../packages/client/ui-primitives/src/index.ts'
import type { ClientBundleRegistration } from '@deepseek-ai/dsh-client-modules/client'
import type { Context, Plugin } from '@deepseek-ai/cordis'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/client/ui-codex-sidebar/lib/client.js'), 'utf8')
const registrationCall = 'window.__ModuleLoader__.load('
if (!source.includes(registrationCall)) throw new Error('Codex sidebar client must register its browser factory')

// Replace only registration; the factory keeps the test environment's real window.
const evaluate = runInThisContext(
  `(function () { ${source.replace(registrationCall, 'return (')}\n})`,
) as () => ClientBundleRegistration
const registration = evaluate()
if (registration.id !== 'dsh-plugin-codex-ui') throw new Error('Missing Codex sidebar browser factory')

const requireReact = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/client/ui-primitives/package.json'))
const requirePlatform = Object.assign((specifier: string): unknown => {
  if (specifier === 'react') return requireReact('react')
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`Unexpected Codex sidebar platform import: ${specifier}`)
}, {
  async: (specifier: string): Promise<never> => Promise.reject(new Error(`Unexpected Codex sidebar async import: ${specifier}`)),
})
const plugin = registration.factory(requirePlatform)
if (typeof plugin.apply !== 'function') throw new Error('Codex sidebar factory must export apply')
const activate = plugin.apply as (ctx: Context, config: unknown) => unknown
/** Activate the committed Codex plugin in the assembled test client. */
export const apply: Plugin.Function<unknown> = (ctx, config) => activate(ctx, config)
/** Required services declared by the committed Codex plugin. */
export const inject = plugin.inject as Plugin.Object<unknown>['inject']
