import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialKey, CredentialRecordInfo } from '@deepseek-ai/dsh-credentials/types'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import CredentialsController from '../src/credentials.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

/** A store whose `describe` carries more than the view declares, as a foreign provider might. */
class LeakyCredentials extends MemoryCredentials {
  override describe(): Promise<CredentialInfo> {
    return Promise.resolve(
      { configured: true, source: 'memory', writable: true, masked: '•'.repeat(9), value: 'sk-leaked', preview: 'sk…ed' } as CredentialInfo,
    )
  }

  override describeRecord(): Promise<CredentialRecordInfo> {
    return Promise.resolve(
      { configured: true, kind: 'grant', writable: true, payload: { token: 'leaked-record-token' } } as CredentialRecordInfo,
    )
  }
}

/** A store whose write rejects with a bare string, the way some client libraries do. */
class LiteralRejectingCredentials extends MemoryCredentials {
  override async set(): Promise<void> {
    throw 'the store refused'
  }
}

/** A store whose provider-owned policy rejects an otherwise valid write. */
class RejectingCredentials extends MemoryCredentials {
  override set(): Promise<void> {
    return Promise.reject(new Error('the stored document no longer parses'))
  }

  override deleteRecord(): Promise<void> {
    return Promise.reject(new Error('cannot delete locked store'))
  }
}

async function boot(
  seed: Record<string, string> = {},
  provider: typeof MemoryCredentials = MemoryCredentials,
): Promise<CredentialsController> {
  const ctx = new Context()
  await ctx.plugin(provider, seed)
  await ctx.plugin(CredentialsController)
  return ctx.credentialsController
}

describe('the credentials Remote namespace a configuration surface calls', () => {
  it('publishes the credentials namespace from its own service key', async () => {
    const controller = await boot()
    const binding = controller.typertRemote
    expect(binding.serviceKey).toBe('credentialsController')
    expect(binding.namespace).toBe('credentials')
    expect(remoteMethods(controller)).toEqual([
      { method: 'describe', invocation: { kind: 'direct' } },
      { method: 'set', invocation: { kind: 'direct' } },
      { method: 'unset', invocation: { kind: 'direct' } },
      { method: 'describeRecords', invocation: { kind: 'direct' } },
      { method: 'deleteRecord', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the actionable configuration error while no credential provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(CredentialsController)
    for (const call of [
      () => ctx.credentialsController.describe(['DEEPSEEK_API_KEY']),
      () => ctx.credentialsController.set('DEEPSEEK_API_KEY', 'sk-live'),
      () => ctx.credentialsController.unset('DEEPSEEK_API_KEY'),
      () => ctx.credentialsController.describeRecords(['llm-pi-ai/openai']),
      () => ctx.credentialsController.deleteRecord('llm-pi-ai/openai'),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'gateway/internal',
        message: 'credentials service is absent: this deployment does not mount a credential provider (e.g. @deepseek-ai/dsh-credentials-local) in its composition',
        details: {},
      })
    }
  })

  it('describes a batch of references as one map, values excluded', async () => {
    const controller = await boot({ DEEPSEEK_API_KEY: 'sk-seeded' })
    const described = await controller.describe(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'])
    expect(described).toEqual({
      DEEPSEEK_API_KEY: { configured: true, source: 'memory', writable: true },
      OPENAI_API_KEY: { configured: false, writable: true },
    })
    expect(JSON.stringify(described)).not.toContain('sk-seeded')
  })

  it('reports an invalid reference as bad-request', async () => {
    const controller = await boot()
    for (const call of [
      () => controller.describe(['DEEPSEEK_API_KEY', 'not a var']),
      () => controller.set('not a var', 'sk-live'),
      () => controller.unset('not a var'),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('answers the largest batch it accepts and reports one reference more as bad-request', async () => {
    const controller = await boot()
    const accepted = Array.from({ length: 64 }, (_unused, index) => `REF_${String(index)}`)
    expect(Object.keys(await controller.describe(accepted))).toHaveLength(64)
    const failure = await controller.describe([...accepted, 'REF_64']).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('answers only the fields the view declares, whatever a provider returns', async () => {
    const controller = await boot({}, LeakyCredentials)
    const described = await controller.describe(['DEEPSEEK_API_KEY'])
    expect(described.DEEPSEEK_API_KEY).toEqual({ configured: true, source: 'memory', writable: true, masked: '•'.repeat(9) })
    expect(JSON.stringify(described)).not.toContain('sk-leaked')
    expect(JSON.stringify(described)).not.toContain('sk…ed')
  })

  it('stores and removes through the same references the batch describes', async () => {
    const controller = await boot()
    await controller.set('DEEPSEEK_API_KEY', 'sk-live')
    expect(await controller.describe(['DEEPSEEK_API_KEY']))
      .toEqual({ DEEPSEEK_API_KEY: { configured: true, source: 'memory', writable: true } })
    await controller.unset('DEEPSEEK_API_KEY')
    expect(await controller.describe(['DEEPSEEK_API_KEY']))
      .toEqual({ DEEPSEEK_API_KEY: { configured: false, writable: true } })
  })

  it('reports a refused write as credential/rejected naming only the reference', async () => {
    const controller = await boot({}, RejectingCredentials)
    const failure = await controller.set('DEEPSEEK_API_KEY', 'sk-live').catch((error: unknown) => error)
    const { code, message, details } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('credential/rejected')
    expect(message).toContain('no longer parses')
    expect(details).toEqual({ ref: 'DEEPSEEK_API_KEY' })
  })

  it('reports an empty value as bad-request', async () => {
    const controller = await boot()
    const failure = await controller.set('DEEPSEEK_API_KEY', '').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('stringifies a refusal that is not an Error', async () => {
    const controller = await boot({}, LiteralRejectingCredentials)
    const failure = await controller.set('DEEPSEEK_API_KEY', 'sk-live').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.message).toBe('the store refused')
  })

  it('describes a batch of records with strict field projection and no payload leakage', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(CredentialsController)
    const storedKey: CredentialKey = credentialKey('llm-pi-ai', 'openai')
    await ctx.credentials.modifyRecord(storedKey, () =>
      Promise.resolve({ kind: 'grant', payload: { access: 'secret-access-token' } }))

    const described = await ctx.credentialsController.describeRecords(['llm-pi-ai/openai', 'llm-pi-ai/anthropic'])
    expect(described).toEqual({
      'llm-pi-ai/openai': { configured: true, kind: 'grant', writable: true },
      'llm-pi-ai/anthropic': { configured: false, writable: true },
    })
    expect(JSON.stringify(described)).not.toContain('secret-access-token')

    const leaky = await boot({}, LeakyCredentials)
    const leakyDescribed = await leaky.describeRecords(['llm-pi-ai/openai'])
    expect(leakyDescribed['llm-pi-ai/openai']).toEqual({ configured: true, kind: 'grant', writable: true })
    expect(JSON.stringify(leakyDescribed)).not.toContain('leaked-record-token')
  })

  it('rejects invalid record keys or oversized batches in describeRecords and deleteRecord', async () => {
    const controller = await boot()
    for (const call of [
      () => controller.describeRecords(['llm-pi-ai/openai', 'invalid-key']),
      () => controller.describeRecords(['BadScope/openai']),
      () => controller.deleteRecord('not-a-key'),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }

    const accepted = Array.from({ length: 64 }, (_unused, index) => `scope/id-${String(index)}`)
    expect(Object.keys(await controller.describeRecords(accepted))).toHaveLength(64)
    const oversized = await controller.describeRecords([...accepted, 'scope/id-64']).catch((error: unknown) => error)
    expect(remoteErrorOf(oversized)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('deletes records directly when authorization is absent and via revoke when authorization is mounted', async () => {
    const ctxNoAuth = new Context()
    await ctxNoAuth.plugin(MemoryCredentials)
    await ctxNoAuth.plugin(CredentialsController)
    const key = credentialKey('llm-pi-ai', 'openai')
    await ctxNoAuth.credentials.modifyRecord(key, () =>
      Promise.resolve({ kind: 'grant', payload: { token: 't1' } }))

    await ctxNoAuth.credentialsController.deleteRecord('llm-pi-ai/openai')
    expect(await ctxNoAuth.credentials.readRecord(key)).toBeUndefined()

    const ctxWithAuth = new Context()
    await ctxWithAuth.plugin(MemoryCredentials)
    await ctxWithAuth.plugin(AuthorizationService)
    await ctxWithAuth.plugin(CredentialsController)
    await ctxWithAuth.credentials.modifyRecord(key, () =>
      Promise.resolve({ kind: 'grant', payload: { token: 't2' } }))
    const revokeHook = vi.fn().mockResolvedValue(undefined)
    ctxWithAuth.authorization.registerFlow({
      key,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      run: () => Promise.resolve(),
      revoke: revokeHook,
    })

    await ctxWithAuth.credentialsController.deleteRecord('llm-pi-ai/openai')
    expect(revokeHook).toHaveBeenCalledTimes(1)
    expect(await ctxWithAuth.credentials.readRecord(key)).toBeUndefined()
  })

  it('reports a refused deleteRecord as credential/rejected naming only the key', async () => {
    const controller = await boot({}, RejectingCredentials)
    const failure = await controller.deleteRecord('llm-pi-ai/openai').catch((error: unknown) => error)
    const { code, message, details } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('credential/rejected')
    expect(message).toContain('cannot delete locked store')
    expect(details).toEqual({ key: 'llm-pi-ai/openai' })
  })
})
