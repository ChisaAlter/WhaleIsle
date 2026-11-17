#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Generated artifacts registered in scripts/generated-artifacts.json and their
// declared inputs (rebuild.inputs/outputs, hashed.sources/artifacts,
// artifacts.paths) gate the tools job that runs check:generated — e.g. mobile
// web, src/renderer/welcome and icon sources do not otherwise reach it.
const generatedWatch = (() => {
  try {
    const registry = JSON.parse(readFileSync(new URL('./generated-artifacts.json', import.meta.url), 'utf8'))
    const paths = []
    for (const entry of Object.values(registry.artifacts ?? {})) {
      paths.push(
        ...entry.rebuild?.inputs ?? [],
        ...entry.rebuild?.outputs ?? [],
        ...entry.hashed?.sources ?? [],
        ...entry.hashed?.artifacts ?? [],
        ...entry.artifacts?.sources ?? [],
        ...entry.artifacts?.paths ?? [],
      )
    }
    return paths
  } catch {
    return []
  }
})()

// Fixed groups, not a dependency graph or a generated acceptance plan.
export function selectChecks(paths, { manual = false } = {}) {
  const scope = { product: manual, vendor: manual, tools: manual, motion: manual }
  for (const path of paths) {
    // Historical component source/build deletions and external-package QA
    // do not rebuild the unrelated Harness runtime.
    if (/^(vendor\/whalebridge\/|scripts\/(build-whalebridge|qa-whalebridge[^/]*)\.(mjs|cjs)$|\.github\/workflows\/whalebridge\.yml$)/.test(path)) continue
    if (/^(docs\/|\.devin\/|\.cursor\/|\.agents\/)/.test(path) ||
        /^[^/]+\.(md|i18n\.yaml)$/.test(path) ||
        /^\.github\/(ISSUE_TEMPLATE\/|.*\.md$)/.test(path) ||
        /^(vendor\/[^/]+|dsh-acp)\/(docs\/|\.agents\/|\.github\/|[^/]+\.md$)/.test(path)) continue
    if (path.startsWith('scripts/')) scope.tools = true
    // #437/#438: checkJs covers all own JS — shared/preload/main directly;
    // main-launcher/host/launcher/renderer, mobile/web, scripts and own vendor
    // plugins via the tsconfig.check* programs (test files excluded). A
    // source edit in any of them still has to run the tools job's typecheck.
    if (/^tsconfig\.check(\.(dom|launcher|pet))?\.json$/.test(path) ||
        (/^(src\/(shared|preload|main|main-launcher|host|launcher|renderer)\/|mobile\/web\/)/.test(path) && !/\.test\.(js|mjs|cjs)$/.test(path))) scope.tools = true
    if (/^(eslint\.config\.mjs|eslint-suppressions\.json)$/.test(path)) { scope.product = true; scope.tools = true }
    if (path === '.github/workflows/cnb-mirror.yml') { scope.tools = true; continue }
    if (/^scripts\/(verify-md-links\.mjs|lib\/gate\.mjs|publish-release\.mjs|publish-macos-supplement\.mjs|sync-cnb\.mjs|release-download\.mjs|ci-scope\.mjs)$/.test(path)) continue
    if (/\.test\.(js|mjs)$/.test(path)) {
      if (!path.startsWith('scripts/')) scope.product = true
      if (/^(vendor|dsh-acp)\//.test(path)) scope.vendor = true
      continue
    }
    if (/^(src\/|mobile\/|vendor\/|dsh-acp\/|assets\/|build\/|scripts\/|\.github\/workflows\/)/.test(path) ||
        /^(package(-lock)?\.json|pnpm(-lock\.yaml|-workspace\.yaml)|\.nvmrc|\.npmrc|electron-builder.*\.yml)$/.test(path)) scope.product = true
    if (/^(vendor|dsh-acp)\//.test(path) || /^(package(-lock)?\.json|\.nvmrc|\.github\/workflows\/)/.test(path)) scope.vendor = true
    // Vendor content changes can tamper with checked-in artifacts; the tools
    // job runs check-vendor-provenance so those edits still gate.
    if (/^vendor\//.test(path)) scope.tools = true
    if (generatedWatch.some((watch) => path === watch || path.startsWith(watch + '/'))) scope.tools = true
    if (/^src\/main\/(native-window-motion|window-|index\.js|chrome-theme|shell-silhouette)/.test(path) ||
        /^(package(-lock)?\.json|vendor\/deepseek-harness\/)/.test(path)) scope.motion = true
    if (/^(package(-lock)?\.json|\.nvmrc|\.github\/workflows\/)/.test(path)) scope.tools = true
  }
  return scope
}

// The main push that changes package.json's version is the build Release
// publishes, so it also builds the macOS installer.
export function versionChanged(baseManifest, headManifest) {
  return JSON.parse(headManifest).version !== JSON.parse(baseManifest).version
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = process.env.BASE_SHA
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !base || /^0+$/.test(base)
  const paths = manual ? [] : execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const scope = selectChecks(paths, { manual })
  const mainPush = !manual && process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main'
  const manifest = (rev) => execFileSync('git', ['show', rev + ':package.json'], { encoding: 'utf8' })
  scope.release = mainPush && versionChanged(manifest(base), manifest('HEAD'))
  const output = Object.entries(scope).map(([name, enabled]) => name + '=' + enabled).join('\n') + '\n'
  console.log(output.trim())
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
}
