import { join } from 'node:path'
import { Rolldown, type UserConfig } from 'tsdown'
import { staticLinked } from '../tsdown.client.ts'

const bundle = staticLinked(
  import.meta.dirname,
  ['lib/types/index.js'],
)

/**
 * Embed the review-diff highlight Worker as self-contained script text. The
 * statically linked artifact is consumed inside the shell's Vite bundle, which
 * gives this module no URL of its own to resolve a Worker file from — a Blob
 * URL built from embedded source is context-free and needs no serving seam.
 * The sub-build inlines the engine's shiki dependencies (an iife has no loader)
 * while `highlight-engine.ts` keeps the worker free of lazy-grammar imports.
 */
const highlightWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-highlight-worker-source',
  resolveId(source) {
    return source === './highlight.worker.ts?raw' ? '\0dsh-highlight-worker-source' : null
  },
  async load(id) {
    if (id !== '\0dsh-highlight-worker-source') return null
    const worker = await Rolldown.rolldown({
      input: join(import.meta.dirname, 'src/markdown/highlight.worker.ts'), platform: 'browser',
      transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    })
    try {
      const result = await worker.generate({ format: 'iife', minify: true })
      const chunk = result.output[0]
      if (chunk?.type !== 'chunk') throw new Error('highlight worker did not emit a JavaScript chunk')
      for (const path of Object.keys(chunk.modules)) this.addWatchFile(path)
      return `export default ${JSON.stringify(chunk.code)};`
    } finally { await worker.close() }
  },
}]

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).map(config =>
  config.name?.endsWith('ui-primitives') === true
    ? { ...config, plugins: [...(config.plugins as unknown[] ?? []), ...highlightWorker] }
    : config,
)
