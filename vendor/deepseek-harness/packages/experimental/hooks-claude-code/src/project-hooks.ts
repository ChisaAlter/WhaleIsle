/**
 * Per-session project-local hook discovery and mtime-validated caching for
 * Claude Code configs under `<cwd>/.claude/`.
 *
 * Priority order when merging per-event matcher groups:
 * 1. `<cwd>/.claude/settings.local.json`
 * 2. `<cwd>/.claude/settings.json`
 * 3. `<cwd>/.claude/hooks.json`
 *
 * Missing `.claude` directories or hook files skip without reading or parsing.
 * Cached parses invalidate automatically when any candidate file's `mtimeMs` or
 * `size` changes (or when a file is created/deleted).
 *
 * @module @deepseek-ai/dsh-hooks-claude-code/project-hooks
 */

import { readFileSync, statSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { parseClaudeCodeConfig, type ClaudeCodeHookConfig } from './config.ts'

/** Ordered project-local Claude Code hook config filenames inside `<cwd>/.claude/`. */
export const CLAUDE_PROJECT_HOOK_FILES = ['settings.local.json', 'settings.json', 'hooks.json'] as const

/** Options controlling project-local Claude Code hook discovery. */
export interface ClaudeProjectHookResolverOptions {
  readonly pluginRoot?: string
  readonly projectDir?: string
  readonly onWarn?: (message: string) => void
}

/** Cached project-local hook lookup result keyed by cwd + substitution roots. */
interface CachedProjectEntry {
  readonly signatures: readonly (string | null)[]
  readonly config: ClaudeCodeHookConfig
}

/** Dynamic per-cwd resolver with mtime-based caching and fast missing-file skip. */
export interface ClaudeProjectHookResolver {
  resolve(cwd: string): ClaudeCodeHookConfig
  clear(): void
}

function readFileSignature(filePath: string): string | null {
  const stat = statSync(filePath, { throwIfNoEntry: false })
  if (stat === undefined || !stat.isFile()) return null
  return `${stat.mtimeMs}:${stat.size}`
}

/**
 * Create a per-session project-local Claude Code hook resolver backed by an
 * in-memory `cwd` + `mtimeMs` cache.
 */
export function createClaudeProjectHookResolver(
  options: ClaudeProjectHookResolverOptions = {},
): ClaudeProjectHookResolver {
  const cache = new Map<string, CachedProjectEntry>()

  return {
    resolve(cwd: string): ClaudeCodeHookConfig {
      const resolvedCwd = resolvePath(cwd)
      const effectiveProjectDir = options.projectDir ?? resolvedCwd
      const cacheKey = `${resolvedCwd}\0${options.pluginRoot ?? ''}\0${effectiveProjectDir}`
      const claudeDir = join(resolvedCwd, '.claude')

      // Single non-throwing stat fast-paths away projects without a `.claude` directory.
      const dirStat = statSync(claudeDir, { throwIfNoEntry: false })
      if (dirStat === undefined || !dirStat.isDirectory()) {
        cache.delete(cacheKey)
        return {}
      }

      const signatures = CLAUDE_PROJECT_HOOK_FILES.map(file => readFileSignature(join(claudeDir, file)))
      const cached = cache.get(cacheKey)
      if (cached !== undefined && signatures.every((sig, idx) => sig === cached.signatures[idx])) {
        return cached.config
      }

      if (signatures.every(sig => sig === null)) {
        const empty: ClaudeCodeHookConfig = {}
        cache.set(cacheKey, { signatures, config: empty })
        return empty
      }

      const merged: ClaudeCodeHookConfig = {}
      for (const [index, fileName] of CLAUDE_PROJECT_HOOK_FILES.entries()) {
        if (signatures[index] === null) continue
        const filePath = join(claudeDir, fileName)
        try {
          const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
          const parsed = parseClaudeCodeConfig(raw, {
            ...options.pluginRoot !== undefined ? { pluginRoot: options.pluginRoot } : {},
            projectDir: effectiveProjectDir,
          })
          for (const skipped of parsed.skipped) {
            options.onWarn?.(`hooks-claude-code: skipping unsupported "${skipped.type}" hook on ${skipped.event} in "${filePath}" (only command hooks run)`)
          }
          for (const [event, groups] of Object.entries(parsed.config)) {
            const existing = merged[event]
            if (existing === undefined) merged[event] = [...groups]
            else existing.push(...groups)
          }
        } catch (error: unknown) {
          options.onWarn?.(`hooks-claude-code: could not load project hook config "${filePath}": ${String(error)} — skipping file`)
        }
      }

      cache.set(cacheKey, { signatures, config: merged })
      return merged
    },

    clear(): void {
      cache.clear()
    },
  }
}
