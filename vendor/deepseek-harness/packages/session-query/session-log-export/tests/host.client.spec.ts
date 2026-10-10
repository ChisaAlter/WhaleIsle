import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import * as SessionLogDownload from '../src/index.ts'

describe('session-log-export host', () => {
  it('validates the titlebar visibility preference in the plugin Config', () => {
    expect(SessionLogDownload.Config({}).titlebarAction).toBe(false)
    for (const titlebarAction of [false, true]) {
      expect(SessionLogDownload.Config({ titlebarAction }).titlebarAction).toBe(titlebarAction)
    }
    expect(() => SessionLogDownload.Config({ titlebarAction: 'no' } as never)).toThrow()
  })

  it('registers and disposes the export command independently of titlebar visibility', async () => {
    const ctx = new Context()
    const commands = new Set<CommandDefinition>()
    ctx.provide('commands', {
      register(next: CommandDefinition) {
        commands.add(next)
        return () => { commands.delete(next) }
      },
    } as never)
    ctx.provide('connection', {
      fetch: { register() { return async () => {} } },
    } as never)
    for (const titlebarAction of [false, true]) {
      const fiber = await ctx.plugin(SessionLogDownload, { titlebarAction })
      expect([...commands].map(command => command.name)).toEqual(['export'])
      await fiber.dispose()
      expect(commands.size).toBe(0)
    }
  })
})
