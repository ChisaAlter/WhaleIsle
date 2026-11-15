import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectReport,
  countLines,
  extractTestGlobs,
  formatText,
  parseCoverageSummary,
  parseSuppressions,
  parseTapSummary,
  summarizeLongFiles,
} from './health.mjs'

const TAP_OUTPUT = `TAP version 13
# Subtest: first
ok 1 - first
  ---
  duration_ms: 0.3
  ...
# Subtest: second
not ok 2 - second
  ---
  duration_ms: 1.2
  ...
1..2
# tests 2
# suites 0
# pass 1
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 107.257443
`

const COVERAGE_BLOCK = `# start of coverage report
# -------------------------------------------------------------------
# file               | line % | branch % | funcs % | uncovered lines
# -------------------------------------------------------------------
# scripts            |        |          |         |
#  ci-scope.mjs      |  79.63 |    97.06 |   50.00 | 44-54
#  ci-scope.test.mjs | 100.00 |   100.00 |  100.00 |
# -------------------------------------------------------------------
# all files          |  91.13 |    98.04 |   88.24 |
# -------------------------------------------------------------------
# end of coverage report
`

test('suppression ledger aggregates counts per rule and per file', () => {
  const result = parseSuppressions({
    'b.js': { 'rule-a': { count: 3 }, 'rule-b': { count: 1 } },
    'a.js': { 'rule-a': { count: 2 } },
    'c.js': { 'rule-b': { count: 4 } },
  })
  assert.equal(result.total, 10)
  assert.equal(result.fileCount, 3)
  assert.deepEqual(result.byRule, [
    { rule: 'rule-a', count: 5 },
    { rule: 'rule-b', count: 5 },
  ])
  assert.deepEqual(result.topFiles, [
    { file: 'b.js', count: 4 },
    { file: 'c.js', count: 4 },
    { file: 'a.js', count: 2 },
  ])
})

test('suppression top file list is capped at ten entries', () => {
  const data = {}
  for (let i = 0; i < 12; i++) data[`f${String(i).padStart(2, '0')}.js`] = { 'rule-a': { count: 1 } }
  const result = parseSuppressions(data)
  assert.equal(result.topFiles.length, 10)
  assert.equal(result.total, 12)
})

test('empty suppression ledger reports zero without file/rule sections', () => {
  const result = parseSuppressions({})
  assert.deepEqual(result, { total: 0, fileCount: 0, byRule: [], topFiles: [] })
})

test('line counting matches newline-terminated and unterminated files', () => {
  assert.equal(countLines(''), 0)
  assert.equal(countLines('a'), 1)
  assert.equal(countLines('a\n'), 1)
  assert.equal(countLines('a\nb'), 2)
  assert.equal(countLines('a\nb\n'), 2)
  assert.equal(countLines('a\nb\n\n'), 3)
})

test('long file summary keeps only files above the threshold, sorted by lines', () => {
  const result = summarizeLongFiles([
    { file: 'small.js', lines: 10 },
    { file: 'big.js', lines: 1200 },
    { file: 'edge.js', lines: 800 },
    { file: 'huge.js', lines: 2000 },
  ], 800)
  assert.equal(result.threshold, 800)
  assert.equal(result.checkedFiles, 4)
  assert.equal(result.checkedLines, 4010)
  assert.equal(result.count, 2)
  assert.deepEqual(result.files, [
    { file: 'huge.js', lines: 2000 },
    { file: 'big.js', lines: 1200 },
  ])
})

test('TAP summary extracts test, pass, fail and skip counts', () => {
  assert.deepEqual(parseTapSummary(TAP_OUTPUT), {
    tests: 2,
    suites: 0,
    pass: 1,
    fail: 1,
    skip: 0,
    cancelled: 0,
    todo: 0,
    durationMs: 107.257443,
  })
})

test('coverage summary extracts the all-files line, branch and funcs totals', () => {
  assert.deepEqual(parseCoverageSummary(COVERAGE_BLOCK), { line: 91.13, branch: 98.04, funcs: 88.24 })
  assert.deepEqual(parseCoverageSummary(TAP_OUTPUT + COVERAGE_BLOCK), { line: 91.13, branch: 98.04, funcs: 88.24 })
  assert.equal(parseCoverageSummary(TAP_OUTPUT), null)
})

test('test globs come from the npm test script, quoted or not', () => {
  assert.deepEqual(
    extractTestGlobs('node --test "src/**/*.test.js" "mobile/web/**/*.test.js" "vendor/dsh-project/tests/*.test.mjs" "vendor/dsh-deepseek-tools/tests/*.test.mjs"'),
    ['src/**/*.test.js', 'mobile/web/**/*.test.js', 'vendor/dsh-project/tests/*.test.mjs', 'vendor/dsh-deepseek-tools/tests/*.test.mjs'])
  assert.deepEqual(extractTestGlobs('node --test a.test.js'), ['a.test.js'])
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(extractTestGlobs(pkg.scripts.test).length > 0)
})

test('text report renders totals, not-integrated typecheck and skipped optional sections', () => {
  const text = formatText({
    suppressions: parseSuppressions({ 'a.js': { 'rule-a': { count: 2 } } }),
    longFiles: summarizeLongFiles([{ file: 'a.js', lines: 900 }], 800),
    typecheck: { status: 'not-integrated' },
    tests: null,
    coverage: null,
  })
  assert.match(text, /总数: 2 条（1 个文件）/)
  assert.match(text, /rule-a/)
  assert.match(text, /a\.js/)
  assert.match(text, /检查范围: 1 个文件 \/ 900 行/)
  assert.match(text, /超长文件: 1 个/)
  assert.match(text, /未接入/)
  assert.match(text, /--tests/)
  assert.match(text, /--coverage/)
})

test('collectReport produces the stable JSON shape without optional sections', async () => {
  const report = await collectReport()
  assert.equal(report.version, 1)
  assert.equal(typeof report.suppressions.total, 'number')
  assert.equal(report.longFiles.threshold, 800)
  assert.ok(report.longFiles.checkedFiles > 0)
  assert.deepEqual(report.typecheck, { status: 'not-integrated' })
  assert.equal(report.tests, null)
  assert.equal(report.coverage, null)
})
