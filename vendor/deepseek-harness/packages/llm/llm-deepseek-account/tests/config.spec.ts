/** Account configuration resolves the listing endpoint, cache timing, and model overrides in one step. */
import { expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Config, plainAccountOptions, resolveAccountOptions } from '../src/config.ts'

it('derives the listing endpoint from the Messages origin and applies the cache defaults', () => {
  expect(resolveAccountOptions({}).catalog).toEqual({ url: 'https://api.deepseek.com/models', timeoutMs: 5_000, maxAgeMs: 600_000 })
  expect(resolveAccountOptions({ baseURL: 'http://127.0.0.1:9/anthropic' }).catalog.url).toBe('http://127.0.0.1:9/models')
})

it.each([
  [{ modelsTimeoutMs: 0 }, /modelsTimeoutMs must be a positive finite number/],
  [{ modelsTimeoutMs: MAX_TIMER_DELAY_MS + 1 }, /modelsTimeoutMs must be a positive finite number/],
  [{ modelsMaxAgeMs: -1 }, /modelsMaxAgeMs must be a non-negative safe integer/],
  [{ modelsMaxAgeMs: 1.5 }, /modelsMaxAgeMs must be a non-negative safe integer/],
  [{ models: [{ id: 'custom', contextWindow: 0 }] }, /contextWindow must be a positive integer/],
  [{ models: [{ id: 'custom' }, { id: 'custom' }] }, /duplicate catalog model/],
  [{ modelOverrides: { '': {} } }, /modelOverrides keys must be non-empty model ids/],
  [{ modelOverrides: { 'deepseek-flash': { id: 'other' } } }, /modelOverrides\.deepseek-flash sets "id"/],
  [{ modelOverrides: { 'deepseek-flash': { disabled: 'true' } } }, /disabled must be a boolean/],
  [{ modelOverrides: { 'deepseek-flash': { contextWindow: 0 } } }, /modelOverrides\.deepseek-flash is invalid: .*contextWindow must be a positive integer/],
  [{ modelOverrides: { 'deepseek-flash': { inputModalities: ['text'], imageMaxBytes: 1 } } }, /modelOverrides\.deepseek-flash is invalid: .*cannot declare image request limits/],
])('rejects %j', (options, message) => {
  expect(() => { Reflect.apply(resolveAccountOptions, undefined, [options]) }).toThrow(message)
})

it('keeps the fields an override declares and drops inherited empty lists', () => {
  expect(resolveAccountOptions({ modelOverrides: {
    'deepseek-flash': { contextWindow: 524_288, imagePixelBudget: 'low', inputModalities: [] },
  } }).modelOverrides).toEqual({ 'deepseek-flash': { contextWindow: 524_288, imagePixelBudget: 'low' } })
})

it('reads the current value behind every Config reference', () => {
  const options = plainAccountOptions(Config({ modelsTimeoutMs: 7, modelOverrides: { 'deepseek-flash': { contextWindow: 9 } } }))
  expect(options).toMatchObject({ modelsTimeoutMs: 7, modelsMaxAgeMs: 600_000, modelOverrides: { 'deepseek-flash': { contextWindow: 9 } } })
  expect(options.models).toBeUndefined()
  expect(options).not.toHaveProperty('apiKeyEnv')
})

it('describes bundled legacy identities without an official provider or an active legacy catalog', () => {
  const form = new z(JSON.parse(JSON.stringify(Config.toJSON())))
  const models = form.dict?.models
  expect(models?.meta.default).toBeUndefined()
  expect(models?.meta.extra).toMatchObject({ legacyModelDefaults: [
    { id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' },
  ] })
  const options = plainAccountOptions(form({}))
  expect(options.models).toBeUndefined()
  expect(resolveAccountOptions(options).modelOverrides).toEqual({})
})

it('reads saved models as overrides without replacing the refreshed protocol catalog', () => {
  const saved = { models: [{ id: 'deepseek-flash', name: 'My Flash', contextWindow: 300_000, maxTokens: 8_192 }] }
  const resolved = resolveAccountOptions(plainAccountOptions(Config(JSON.parse(JSON.stringify(saved)))))
  expect(resolved.modelOverrides).toEqual({
    'deepseek-flash': { name: 'My Flash', contextWindow: 300_000, maxTokens: 8_192 },
    'deepseek-v4-pro': { disabled: true },
  })
  expect(resolved.protocol.models.map(model => model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
  const migrated = { modelOverrides: resolved.modelOverrides }
  expect(resolveAccountOptions(plainAccountOptions(Config(JSON.parse(JSON.stringify(migrated))))).modelOverrides).toEqual(resolved.modelOverrides)
})

it('keeps legacy custom ids and applies explicit overrides field by field', () => {
  const options = plainAccountOptions(Config({
    models: [{ id: 'custom-model', name: 'Saved model', contextWindow: 300_000, maxTokens: 8_192 }],
    modelOverrides: { 'custom-model': { name: 'Edited model', contextWindow: 400_000 }, 'deepseek-flash': { disabled: false } },
  }))
  expect(resolveAccountOptions(options).modelOverrides).toEqual({
    'custom-model': { name: 'Edited model', contextWindow: 400_000, maxTokens: 8_192 },
    'deepseek-flash': { disabled: false },
    'deepseek-v4-pro': { disabled: true },
  })
})

it('keeps an explicitly empty saved catalog empty until the user enables a model', () => {
  expect(resolveAccountOptions(plainAccountOptions(Config({ models: [] }))).modelOverrides).toEqual({
    'deepseek-flash': { disabled: true }, 'deepseek-v4-pro': { disabled: true },
  })
})
