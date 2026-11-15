#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ESLint } from 'eslint'

export const LONG_FILE_THRESHOLD = 800
export const TOP_SUPPRESSED_FILES = 10

export function parseSuppressions(data) {
  const byRule = new Map()
  const files = []
  let total = 0
  for (const [file, rules] of Object.entries(data)) {
    let fileCount = 0
    for (const [rule, entry] of Object.entries(rules)) {
      const count = Number(entry?.count ?? 0)
      byRule.set(rule, (byRule.get(rule) ?? 0) + count)
      fileCount += count
    }
    total += fileCount
    files.push({ file, count: fileCount })
  }
  files.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
  const rules = [...byRule.entries()]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule))
  return {
    total,
    fileCount: files.length,
    byRule: rules,
    topFiles: files.slice(0, TOP_SUPPRESSED_FILES),
  }
}

export function countLines(content) {
  if (content.length === 0) return 0
  let count = 0
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++
  }
  return content.endsWith('\n') ? count : count + 1
}

export function summarizeLongFiles(entries, threshold = LONG_FILE_THRESHOLD) {
  const files = entries
    .filter(entry => entry.lines > threshold)
    .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))
  return {
    threshold,
    checkedFiles: entries.length,
    checkedLines: entries.reduce((sum, entry) => sum + entry.lines, 0),
    count: files.length,
    files,
  }
}

export function parseTapSummary(text) {
  const summary = { tests: 0, suites: 0, pass: 0, fail: 0, skip: 0, cancelled: 0, todo: 0, durationMs: null }
  for (const line of text.split('\n')) {
    const match = /^#\s+(\w+)\s+(\d+(?:\.\d+)?)\s*$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    if (key === 'duration_ms') summary.durationMs = Number(value)
    else if (key === 'skipped') summary.skip = Number(value)
    else if (key in summary) summary[key] = Number(value)
  }
  return summary
}

export function parseCoverageSummary(text) {
  for (const line of text.split('\n')) {
    const match = /^#?\s*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/.exec(line)
    if (match) return { line: Number(match[1]), branch: Number(match[2]), funcs: Number(match[3]) }
  }
  return null
}

export function extractTestGlobs(testScript) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = pattern.exec(testScript)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  const args = tokens[0] === 'node' ? tokens.slice(1) : tokens
  return args.filter(token => !token.startsWith('-'))
}

export function formatText(report) {
  const out = ['项目健康指标', '']

  out.push('ESLint 豁免')
  const s = report.suppressions
  out.push(`  总数: ${s.total} 条（${s.fileCount} 个文件）`)
  if (s.byRule.length > 0) {
    out.push('  按规则:')
    for (const { rule, count } of s.byRule) out.push(`    ${String(count).padStart(4)}  ${rule}`)
  }
  if (s.topFiles.length > 0) {
    out.push(`  豁免最多的文件（前 ${TOP_SUPPRESSED_FILES} 个）:`)
    for (const { file, count } of s.topFiles) out.push(`    ${String(count).padStart(4)}  ${file}`)
  }
  out.push('')

  const l = report.longFiles
  out.push(`超长文件（> ${l.threshold} 行）`)
  out.push(`  检查范围: ${l.checkedFiles} 个文件 / ${l.checkedLines} 行`)
  out.push(`  超长文件: ${l.count} 个`)
  for (const { file, lines } of l.files) out.push(`    ${String(lines).padStart(6)}  ${file}`)
  out.push('')

  out.push('类型检查')
  out.push('  未接入')
  out.push('')

  out.push('测试')
  if (report.tests) {
    const t = report.tests
    const duration = t.durationMs === null ? '?' : `${Math.round(t.durationMs)}`
    out.push(`  总数 ${t.tests}，通过 ${t.pass}，失败 ${t.fail}，跳过 ${t.skip}，取消 ${t.cancelled}，todo ${t.todo}，耗时 ${duration} ms`)
  } else {
    out.push('  未运行（--tests 启用）')
  }
  out.push('')

  out.push('覆盖率')
  if (report.coverage) {
    const c = report.coverage
    out.push(`  行 ${c.line.toFixed(2)}%  分支 ${c.branch.toFixed(2)}%  函数 ${c.funcs.toFixed(2)}%`)
  } else {
    out.push('  未运行（--coverage 启用）')
  }
  return out.join('\n')
}

async function listLintedFiles(root) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.config.mjs') })
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(file => /\.(?:js|mjs|cjs)$/.test(file))
  const linted = []
  for (const file of tracked) {
    if (await eslint.isPathIgnored(file)) continue
    if ((await eslint.calculateConfigForFile(file)) === undefined) continue
    linted.push(file)
  }
  return linted
}

function runNpmTest(root, { coverage }) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const globs = extractTestGlobs(pkg.scripts?.test ?? '')
  const nodeArgs = ['--test', '--test-reporter=tap']
  if (coverage) nodeArgs.push('--experimental-test-coverage')
  nodeArgs.push(...globs)
  const result = spawnSync(process.execPath, nodeArgs, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  return { summary: parseTapSummary(output), coverage: parseCoverageSummary(output) }
}

export async function collectReport({ tests = false, coverage = false } = {}) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const suppressions = parseSuppressions(JSON.parse(readFileSync(join(root, 'eslint-suppressions.json'), 'utf8')))
  const entries = (await listLintedFiles(root))
    .map(file => ({ file, lines: countLines(readFileSync(join(root, file), 'utf8')) }))
  const report = {
    version: 1,
    suppressions,
    longFiles: summarizeLongFiles(entries),
    typecheck: { status: 'not-integrated' },
    tests: null,
    coverage: null,
  }
  if (tests) {
    const result = runNpmTest(root, { coverage })
    report.tests = result.summary
    report.coverage = result.coverage
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const coverage = args.includes('--coverage')
  const report = await collectReport({ tests: coverage || args.includes('--tests'), coverage })
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatText(report))
}
