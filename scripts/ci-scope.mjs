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

/** @typedef {{ product: boolean, harness: boolean, vendor_plugins: boolean, whale_web: boolean, tools: boolean, motion: boolean }} CiScope */

/** @param {string} path */
function isIgnoredDocPath(path) {
  return /^(docs\/|\.devin\/|\.cursor\/|\.agents\/)/.test(path) ||
    /^[^/]+\.(md|i18n\.yaml)$/.test(path) ||
    /^\.github\/(ISSUE_TEMPLATE\/|.*\.md$)/.test(path) ||
    /^(vendor\/[^/]+|dsh-acp)\/(docs\/|\.agents\/|\.github\/|[^/]+\.md$)/.test(path)
}

/** @param {string} path */
function isHarnessTrigger(path) {
  return /^vendor\/deepseek-harness\//.test(path) ||
    /^vendor\/harness-upstream\.json$/.test(path) ||
    /^src\/shared\/harness-(?:desktop-forks.*|upstream\.js)$/.test(path) ||
    /^scripts\/(?:setup-harness\.js|sync-upstream\.js|check-skip-compose-contract\.js|check-built-shell\.mjs)$/.test(path) ||
    /^(?:\.nvmrc|\.github\/workflows\/test\.yml|\.github\/actions\/)/.test(path)
}

/**
 * @param {string} path
 * @param {CiScope} scope
 */
function classifyTestPath(path, scope) {
  if (!path.startsWith('scripts/')) scope.product = true
  if (/^vendor\/deepseek-harness\//.test(path)) { scope.harness = true; scope.whale_web = true }
  if (/^(vendor\/(?!deepseek-harness\/)[^/]+|dsh-acp)\//.test(path)) scope.vendor_plugins = true
  if (/^vendor\/dsh-whale\//.test(path)) scope.whale_web = true
}

/** @param {string} path */
function isMotionPath(path) {
  return /^src\/main\/(native-window-motion|window-|index\.js|chrome-theme|shell-silhouette)/.test(path) ||
    /^src\/native\//.test(path) ||
    /^scripts\/build-window-acrylic\.cjs$/.test(path) ||
    /^(package(-lock)?\.json|vendor\/deepseek-harness\/)/.test(path)
}

/**
 * @param {string} path
 * @param {CiScope} scope
 */
function classifyPath(path, scope) {
  if (path.startsWith('scripts/')) scope.tools = true
  // #437/#438: checkJs covers all own JS — shared/preload/main directly;
  // main-launcher/host/launcher/renderer, mobile/web, scripts and own vendor
  // plugins via the tsconfig.check* programs (test files excluded). A
  // source edit in any of them still has to run the tools job's typecheck.
  if (/^tsconfig\.check(\.(dom|launcher|pet))?\.json$/.test(path) ||
      (/^(src\/(shared|preload|main|main-launcher|host|launcher|renderer)\/|mobile\/web\/)/.test(path) && !/\.test\.(js|mjs|cjs)$/.test(path))) {
    scope.tools = true
  }
  if (/^(eslint\.config\.mjs|eslint-suppressions\.json)$/.test(path)) { scope.product = true; scope.tools = true }
  if (/^\.github\/workflows\/(?:magpie-)?cnb-mirror\.yml$/.test(path)) { scope.tools = true; return }
  if (/^scripts\/(verify-md-links\.mjs|lib\/(?:gate|cnb-client)\.mjs|publish-release\.mjs|publish-macos-supplement\.mjs|sync-cnb\.mjs|sync-magpie-cnb\.mjs|release-download\.mjs|ci-scope\.mjs)$/.test(path)) return
  if (/\.test\.(js|mjs)$/.test(path)) { classifyTestPath(path, scope); return }
  if (/^(src\/|mobile\/|vendor\/|dsh-acp\/|assets\/|build\/|scripts\/|\.github\/workflows\/)/.test(path) ||
      /^(package(-lock)?\.json|pnpm(-lock\.yaml|-workspace\.yaml)|\.nvmrc|\.npmrc|electron-builder.*\.yml)$/.test(path)) scope.product = true
  if (isHarnessTrigger(path)) scope.harness = true
  if (/^(vendor\/(?!deepseek-harness\/)[^/]+|dsh-acp)\//.test(path)) scope.vendor_plugins = true
  if (/^vendor\/dsh-whale\//.test(path) ||
      /^scripts\/(?:build-dsh-whale-client|run-whale-big-fish-qa)\.mjs$/.test(path)) scope.whale_web = true
  // Vendor content changes can tamper with checked-in artifacts; the tools
  // job runs check-vendor-provenance so those edits still gate.
  if (/^vendor\//.test(path)) scope.tools = true
  if (generatedWatch.some((watch) => path === watch || path.startsWith(watch + '/'))) scope.tools = true
  if (isMotionPath(path)) scope.motion = true
  if (/^(package(-lock)?\.json|\.nvmrc|\.github\/workflows\/)/.test(path)) scope.tools = true
}

// Fixed groups, not a dependency graph or a generated acceptance plan.
/**
 * @param {string[]} paths
 * @param {{ manual?: boolean }} [options]
 * @returns {CiScope}
 */
export function selectChecks(paths, { manual = false } = {}) {
  const scope = {
    product: manual,
    harness: manual,
    vendor_plugins: manual,
    whale_web: manual,
    tools: manual,
    motion: manual,
  }
  for (const path of paths) {
    if (!isIgnoredDocPath(path)) classifyPath(path, scope)
  }
  if (scope.harness) scope.whale_web = true
  return scope
}

// The main push that changes package.json's version is the build Release
// publishes, so it also builds the macOS installer.
/**
 * @param {string} baseManifest
 * @param {string} headManifest
 */
export function versionChanged(baseManifest, headManifest) {
  return JSON.parse(headManifest).version !== JSON.parse(baseManifest).version
}

/**
 * @param {CiScope} scope
 * @param {boolean} release
 */
export function applyReleaseScope(scope, release) {
  const result = { ...scope, release: Boolean(release) }
  if (result.release) {
    result.harness = true
    result.whale_web = true
    result.motion = true
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = process.env.BASE_SHA
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !base || /^0+$/.test(base)
  const paths = manual ? [] : execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const mainPush = !manual && process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main'
  /** @param {string} rev */
  const manifest = (rev) => execFileSync('git', ['show', rev + ':package.json'], { encoding: 'utf8' })
  const release = mainPush && versionChanged(manifest(base), manifest('HEAD'))
  const scope = applyReleaseScope(selectChecks(paths, { manual }), release)
  const output = Object.entries(scope).map(([name, enabled]) => name + '=' + enabled).join('\n') + '\n'
  console.log(output.trim())
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
}
