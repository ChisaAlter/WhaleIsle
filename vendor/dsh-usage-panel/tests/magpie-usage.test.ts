// Locks the optional Magpie gateway ledger source: row parsing (agent filter,
// foreign/broken lines skipped, cache fields mapped), the fold shape
// (totals/byModel/byProvider/byDay/modelProviders/range), the mtime+size cache,
// and the clean fallback (missing/unusable file → null) the host relies on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAGPIE_AGENT,
  foldMagpieLines,
  loadMagpieSource,
  parseMagpieRow,
  resetMagpieCache,
  resolveMagpieUsageFile,
} from '../src/host/magpie-usage.ts'

const row = (over: Record<string, unknown>): string =>
  JSON.stringify({
    agent: MAGPIE_AGENT,
    t: '2026-10-21T10:00:00.0000000+08:00',
    // The gateway's route id (`req`) is the model id DSH logs; `model` is the
    // served id and must never become a panel key.
    req: 'codex/gpt-6.1-sol',
    model: 'gpt-6.1-sol',
    provider: 'codex',
    in: 100,
    out: 20,
    cache_read: 900,
    cache_write: 0,
    ...over,
  })

function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-usage-'))
  const file = join(dir, name)
  writeFileSync(file, content, 'utf8')
  return file
}

test('resolveMagpieUsageFile honors MAGPIE_USAGE_FILE, else ~/.config/magpie/usage.jsonl', () => {
  assert.equal(
    resolveMagpieUsageFile({ MAGPIE_USAGE_FILE: 'D:/ledger/usage.jsonl' }, 'C:/Users/x'),
    'D:/ledger/usage.jsonl',
  )
  assert.equal(resolveMagpieUsageFile({}, 'C:/Users/x'), join('C:/Users/x', '.config', 'magpie', 'usage.jsonl'))
  // An empty override is not a path.
  assert.equal(resolveMagpieUsageFile({ MAGPIE_USAGE_FILE: '   ' }, '/home/x'), join('/home/x', '.config', 'magpie', 'usage.jsonl'))
})

test('parseMagpieRow keeps only agent=dsh rows and maps the four buckets', () => {
  const parsed = parseMagpieRow(row({}))
  assert.ok(parsed)
  assert.deepEqual(parsed!.buckets, { input: 100, output: 20, cacheRead: 900, cacheWrite: 0 })
  // The panel key is the requested route, NOT the served model.
  assert.equal(parsed!.model, 'codex/gpt-6.1-sol')
  assert.equal(parsed!.provider, 'codex')
  // +08:00 timestamp → epoch ms.
  assert.equal(parsed!.at, Date.parse('2026-10-21T10:00:00.0000000+08:00'))
  // Foreign agents, blanks and broken lines are not our usage.
  assert.equal(parseMagpieRow(row({ agent: 'codex' })), null)
  assert.equal(parseMagpieRow(''), null)
  assert.equal(parseMagpieRow('{"agent":"dsh"'), null)
  assert.equal(parseMagpieRow('null'), null)
})

test('parseMagpieRow falls back to the served model when a row has no req', () => {
  const parsed = parseMagpieRow(JSON.stringify({ agent: 'dsh', t: '2026-10-21T10:00:00+08:00', model: 'served-only', provider: 'p' }))
  assert.ok(parsed)
  assert.equal(parsed!.model, 'served-only')
  assert.deepEqual(parsed!.buckets, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.equal(parseMagpieRow(JSON.stringify({ agent: 'dsh', model: '' }))!.model, 'unknown')
  const noTime = parseMagpieRow(JSON.stringify({ agent: 'dsh', req: 'r/m' }))
  assert.equal(noTime!.at, null)
})

test('foldMagpieLines aggregates totals, models, upstream providers and UTC day buckets', () => {
  const lines = [
    row({}),
    row({ in: 50, out: 5, cache_read: 0, cache_write: 7 }),
    // 2026-10-20T23:30+08:00 = 2026-10-20T15:30Z (same UTC day as 10-20).
    row({ req: 'p2/m2', model: 'm2', provider: 'p2', t: '2026-10-20T23:30:00.0000000+08:00', in: 10, out: 1, cache_read: 0, cache_write: 0 }),
    // 2026-10-21T01:00+08:00 = 2026-10-20T17:00Z — still the UTC 10-20 bucket.
    row({ req: 'p2/m2', model: 'm2', provider: 'p2', t: '2026-10-21T01:00:00.0000000+08:00', in: 3, out: 2, cache_read: 0, cache_write: 0 }),
    // 2026-10-21T09:00+08:00 = 2026-10-21T01:00Z.
    row({ req: 'p2/m2', model: 'm2', provider: 'p2', t: '2026-10-21T09:00:00.0000000+08:00', in: 4, out: 1, cache_read: 2, cache_write: 0 }),
    row({ agent: 'codex', in: 999999, out: 999999 }),
    'not json',
  ]
  const source = foldMagpieLines(lines, 'C:/ledger.jsonl')
  assert.equal(source.file, 'C:/ledger.jsonl')
  assert.equal(source.calls, 5)
  assert.deepEqual(source.totals, { input: 167, output: 29, cacheRead: 902, cacheWrite: 7 })
  // The headline total this plugin derives is in + out, never with cache.
  assert.equal(source.totals.input + source.totals.output, 196)
  // Keys are the requested routes (what DSH logs), not the served model ids.
  assert.deepEqual(source.byModel['codex/gpt-6.1-sol'], { input: 150, output: 25, cacheRead: 900, cacheWrite: 7 })
  assert.deepEqual(source.byModel['p2/m2'], { input: 17, output: 4, cacheRead: 2, cacheWrite: 0 })
  assert.equal(source.byModel['gpt-6.1-sol'], undefined)
  assert.deepEqual(source.upstreamProviders, { 'codex/gpt-6.1-sol': 'codex', 'p2/m2': 'p2' })
  assert.deepEqual(Object.keys(source.byDay).sort(), ['2026-10-20', '2026-10-21'])
  assert.deepEqual(source.byDay['2026-10-20']!['p2/m2'], { input: 13, output: 3, cacheRead: 0, cacheWrite: 0 })
  assert.equal(source.byDay['2026-10-20']!['p2/m2']!.input + source.byDay['2026-10-20']!['p2/m2']!.output, 16)
  assert.deepEqual(source.byDay['2026-10-21']!['codex/gpt-6.1-sol'], { input: 150, output: 25, cacheRead: 900, cacheWrite: 7 })
  assert.deepEqual(source.byDay['2026-10-21']!['p2/m2'], { input: 4, output: 1, cacheRead: 2, cacheWrite: 0 })
  assert.equal(source.from, Date.parse('2026-10-20T23:30:00.0000000+08:00'))
  assert.equal(source.to, Date.parse('2026-10-21T10:00:00.0000000+08:00'))
})

test('loadMagpieSource returns null when the file is missing (log fallback)', async () => {
  resetMagpieCache()
  assert.equal(await loadMagpieSource(join(tmpdir(), 'magpie-usage-absent', 'usage.jsonl')), null)
})

test('loadMagpieSource folds a real file, caches by mtime+size and reloads on change', async () => {
  resetMagpieCache()
  const file = tempFile('usage.jsonl', row({}) + '\n' + row({ in: 1000, out: 200 }) + '\n')
  const first = await loadMagpieSource(file)
  assert.ok(first)
  assert.equal(first!.calls, 2)
  assert.deepEqual(first!.totals, { input: 1100, output: 220, cacheRead: 1800, cacheWrite: 0 })
  assert.equal(await loadMagpieSource(file), first) // same mtime+size → cached object

  writeFileSync(file, row({}) + '\n', 'utf8') // size changed → refold
  const second = await loadMagpieSource(file)
  assert.equal(second!.calls, 1)
  assert.deepEqual(second!.totals, { input: 100, output: 20, cacheRead: 900, cacheWrite: 0 })

  resetMagpieCache()
  assert.notEqual(await loadMagpieSource(file), second)
})

test('loadMagpieSource returns null for a ledger with no agent=dsh rows', async () => {
  resetMagpieCache()
  const warnings: string[] = []
  const file = tempFile('usage.jsonl', row({ agent: 'codex' }) + '\n')
  assert.equal(await loadMagpieSource(file, (message) => warnings.push(message)), null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0]!, /no agent=dsh rows/)
})

test('loadMagpieSource ignores a partial trailing line of a live ledger', async () => {
  resetMagpieCache()
  const file = tempFile('usage.jsonl', row({}) + '\n' + '{"agent":"dsh","in":')
  const source = await loadMagpieSource(file)
  assert.equal(source!.calls, 1)
  assert.equal(source!.totals.input, 100)
})
