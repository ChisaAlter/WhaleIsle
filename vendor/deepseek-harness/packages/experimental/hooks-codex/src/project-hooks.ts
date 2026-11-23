/**
 * Per-session project-local hook discovery and mtime-validated caching for
 * Codex configs at `<cwd>/.codex/hooks.json`.
 *
 * Missing files skip immediately via a single non-throwing `statSync` call.
 * Cached parses invalidate automatically when `mtimeMs` or `size` changes.
 *
 * @module @deepseek-ai/dsh-hooks-codex/project-hooks
 */

import { readFileSync, statSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { parseCodexConfig, type CodexHookConfig } from './config.ts'

/** Options controlling project-local Codex hook discovery. */
export interface CodexProjectHookResolverOptions {
  readonly onWarn?: (message: string) => void
}

interface CachedCodexEntry {
  readonly signature: string
  readonly config: CodexHookConfig
}

/** Dynamic per-cwd Codex project hook resolver with mtime-based caching. */
export interface CodexProjectHookResolver {
  resolve(cwd: string): CodexHookConfig
  clear(): void
}

/**
 * Create a per-session project-local Codex hook resolver backed by an
 * in-memory `cwd` + `mtimeMs` cache.
 */
export function createCodexProjectHookResolver(
  options: CodexProjectHookResolverOptions = {},
): CodexProjectHookResolver {
  const cache = new Map<string, CachedCodexEntry>()

  return {
    resolve(cwd: string): CodexHookConfig {
      const resolvedCwd = resolvePath(cwd)
      const filePath = join(resolvedCwd, '.codex', 'hooks.json')
      const stat = statSync(filePath, { throwIfNoEntry: false })
      if (stat === undefined || !stat.isFile()) {
        cache.delete(resolvedCwd)
        return {}
      }

      const signature = `${stat.mtimeMs}:${stat.size}`
      const cached = cache.get(resolvedCwd)
      if (cached !== undefined && cached.signature === signature) {
        return cached.config
      }

      let config: CodexHookConfig = {}
      try {
        const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
        const parsed = parseCodexConfig(raw)
        config = parsed.config
        for (const skipped of parsed.skipped) {
          options.onWarn?.(`hooks-codex: skipping ${skipped.reason} on ${skipped.event} in "${filePath}" (only sync command hooks run)`)
        }
      } catch (error: unknown) {
        options.onWarn?.(`hooks-codex: could not load project hook config "${filePath}": ${String(error)} — skipping file`)
      }

      cache.set(resolvedCwd, { signature, config })
      return config
    },

    clear(): void {
      cache.clear()
    },
  }
}
