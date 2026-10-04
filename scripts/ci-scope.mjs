#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Fixed groups, not a dependency graph or a generated acceptance plan.
export function selectChecks(paths, { manual = false } = {}) {
  const scope = { product: manual, vendor: manual, tools: manual, motion: manual }
  for (const path of paths) {
    if (/^(docs\/|\.devin\/|\.cursor\/|\.agents\/)/.test(path) ||
        /^[^/]+\.(md|i18n\.yaml)$/.test(path) ||
        /^\.github\/(ISSUE_TEMPLATE\/|.*\.md$)/.test(path) ||
        /^vendor\/[^/]+\/(docs\/|\.agents\/|\.github\/|[^/]+\.md$)/.test(path)) continue
    if (path.startsWith('scripts/')) scope.tools = true
    if (/^scripts\/(verify-md-links\.mjs|lib\/gate\.mjs|publish-release\.mjs|sync-cnb\.mjs|release-download\.mjs|ci-scope\.mjs)$/.test(path)) continue
    if (/\.test\.(js|mjs)$/.test(path)) {
      if (!path.startsWith('scripts/')) scope.product = true
      if (path.startsWith('vendor/')) scope.vendor = true
      continue
    }
    if (/^(src\/|mobile\/|vendor\/|assets\/|build\/|scripts\/|\.github\/workflows\/)/.test(path) ||
        /^(package(-lock)?\.json|pnpm(-lock\.yaml|-workspace\.yaml)|\.nvmrc|\.npmrc|electron-builder.*\.yml)$/.test(path)) scope.product = true
    if (/^vendor\//.test(path) || /^(package(-lock)?\.json|\.nvmrc|\.github\/workflows\/)/.test(path)) scope.vendor = true
    if (/^src\/main\/(native-window-motion|window-|index\.js|chrome-theme|shell-silhouette)/.test(path) ||
        /^(package(-lock)?\.json|vendor\/deepseek-harness\/)/.test(path)) scope.motion = true
    if (/^(package(-lock)?\.json|\.nvmrc|\.github\/workflows\/)/.test(path)) scope.tools = true
  }
  return scope
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = process.env.BASE_SHA
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !base || /^0+$/.test(base)
  const paths = manual ? [] : execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const scope = selectChecks(paths, { manual })
  const output = Object.entries(scope).map(([name, enabled]) => name + '=' + enabled).join('\n') + '\n'
  console.log(output.trim())
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
}
