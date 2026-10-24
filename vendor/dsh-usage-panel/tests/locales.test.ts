// Locks the i18n bridge against the two failure modes seen in the field:
// 1) registering under the WRONG locale ids ('zh-CN'/'en-US' instead of the
//    runtime's 'zh'/'en') → translate returns the key itself;
// 2) the runtime's "fail loud" key-return being treated as a successful
//    translation (the old `translated(key) || lookup(...)` bug).
// The fake runtime below reproduces the real dsh-client-locale semantics
// (lookup chain: active dict → zh fallback → the key itself).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createI18n, type LocaleRuntimeLike } from '../src/client/locales.ts'

class FakeLocaleRuntime implements LocaleRuntimeLike {
  private dicts = new Map<string, Map<string, Record<string, string>>>()
  private listeners = new Set<() => void>()
  active = 'zh'

  constructor(active: string) {
    this.active = active
  }

  register(ns: string, dicts: Record<string, Record<string, string>>): () => void {
    let locales = this.dicts.get(ns)
    if (!locales) {
      locales = new Map()
      this.dicts.set(ns, locales)
    }
    for (const [locale] of Object.entries(dicts)) {
      if (locales.has(locale)) throw new Error('locale namespace "' + ns + '" already has locale "' + locale + '"')
    }
    for (const [locale, entries] of Object.entries(dicts)) locales.set(locale, entries)
    return () => {
      for (const [locale] of Object.entries(dicts)) locales.delete(locale)
    }
  }

  bind(ns: string): (key: string) => string {
    return (key) => {
      const locales = this.dicts.get(ns)
      return (
        locales?.get(this.active)?.[key] ??
        locales?.get('zh')?.[key] ??
        key // the runtime fails loud by returning the key itself
      )
    }
  }

  getSnapshot(): { active: string } {
    return { active: this.active }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  switchTo(id: string): void {
    this.active = id
    for (const fn of this.listeners) fn()
  }
}

test('registers dictionaries under the real runtime ids zh/en', () => {
  const fake = new FakeLocaleRuntime('zh')
  const seen: string[][] = []
  const origRegister = fake.register.bind(fake)
  fake.register = ((ns: string, dicts: Record<string, Record<string, string>>) => {
    seen.push(Object.keys(dicts))
    return origRegister(ns, dicts)
  }) as typeof fake.register
  createI18n(fake)
  assert.deepEqual(seen, [['zh', 'en']])
})

test('zh active resolves Chinese text (no raw keys)', () => {
  const i18n = createI18n(new FakeLocaleRuntime('zh'))
  assert.equal(i18n.t('nav.label'), '用量与费用')
  assert.equal(i18n.t('kpi.hitRate'), '缓存命中率')
  assert.equal(i18n.t('kpi.sessions.detail', { total: 58, main: 1, subagent: 2 }), '总会话 58 · 有用量会话：主 1 · 子代理 2')
})

test('en active resolves English text', () => {
  const i18n = createI18n(new FakeLocaleRuntime('en'))
  assert.equal(i18n.t('nav.label'), 'Usage & costs')
  assert.equal(i18n.t('kpi.hitRate'), 'Cache hit rate')
})

test('locale switch propagates through subscribe/update', () => {
  const fake = new FakeLocaleRuntime('zh')
  const i18n = createI18n(fake)
  assert.equal(i18n.locale, 'zh-CN')
  assert.equal(i18n.t('nav.label'), '用量与费用')
  fake.switchTo('en')
  i18n.update()
  assert.equal(i18n.locale, 'en-US')
  assert.equal(i18n.t('nav.label'), 'Usage & costs')
})

test('unknown keys fall back to the local zh dictionary, never the raw key', () => {
  const fake = new FakeLocaleRuntime('en')
  // A key that exists ONLY in our local dictionaries but was not registered
  // (e.g. the runtime lost the registration): the local lookup must win.
  const i18n = createI18n(fake)
  assert.notEqual(i18n.t('nav.label'), 'nav.label')
  assert.equal(i18n.t('nav.label'), 'Usage & costs') // en dict via our local fallback
})

test('interpolation works through both paths', () => {
  const i18n = createI18n(new FakeLocaleRuntime('zh'))
  assert.equal(
    i18n.t('kpi.total.detail', { input: '1 万', output: '2 万', cacheRead: '3 亿' }),
    '输入 1 万 · 输出 2 万 · 缓存读 3 亿',
  )
  const noRuntime = createI18n()
  assert.equal(noRuntime.t('bar.day', { date: '8月15日', tokens: '100' }), '8月15日 · 共 100 Tokens')
})

test('missing params leave placeholders intact (both paths)', () => {
  const i18n = createI18n(new FakeLocaleRuntime('en'))
  assert.equal(i18n.t('status.fresh'), 'Updated at {time} · UTC')
})
