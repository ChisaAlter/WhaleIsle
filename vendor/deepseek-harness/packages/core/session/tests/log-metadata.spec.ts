import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'fixture/auxiliary-request': { input: { text: string } }
  }
}

describe('Session log-only append metadata', () => {
  it('snapshots an optional informational record without creating a chat surface and restores it from a seed', () => {
    const session = Session.create(SessionId('log-only-metadata'))
    const data = { input: { text: 'Exact auxiliary model input' } }
    const required = session.append('fixture/auxiliary-request', data)
    const optional = session.append('fixture/auxiliary-request', data, { ignorable: true })
    data.input.text = 'A later caller mutation'
    expect(required.ignorable).toBeUndefined()
    expect(optional).toMatchObject({ ignorable: true, data: { input: { text: 'Exact auxiliary model input' } } })
    expect(optional).not.toHaveProperty('surfaceOp')
    expect(optional).not.toHaveProperty('sourceEventSeqs')
    expect(session.surface.nodes).toEqual([])
    expect(session.deriveMessages()).toEqual([])
    const restored = Session.create(session.id, session.snapshotEvents())
    const restoredEvents = restored.snapshotEvents()
    expect(restoredEvents).toHaveLength(3)
    expect(restoredEvents.slice(0, 2)).toEqual(session.snapshotEvents())
    expect(restoredEvents[2]).toEqual({ type: 'session/end-seed', seq: 2, time: expect.any(Number), data: {} })
    expect(restored.surface.nodes).toEqual([])
    expect(restored.deriveMessages()).toEqual([])
  })

  it('does not permit a producer to mark main messages ignorable or attach surface metadata to log records', () => {
    const session = Session.create(SessionId('required-main-history'))
    const message = createUserMessage({ content: [{ type: 'text', text: 'Human prompt' }], source: { kind: 'user' } })
    expect(() => Reflect.apply(session.append, session, [
      'user/message', message, { surfaceOp: 'append', ignorable: true },
    ])).toThrow('only valid for informational log-only appends')
    expect(() => Reflect.apply(session.append, session, [
      'fixture/auxiliary-request', { input: { text: 'Exact input' } }, { ignorable: false },
    ])).toThrow('only valid for informational log-only appends')
    expect(() => Reflect.apply(session.append, session, [
      'fixture/auxiliary-request', { input: { text: 'Exact input' } }, { ignorable: true, surfaceOp: 'append' },
    ])).toThrow('cannot carry surface metadata')
    const accepted = session.append('user/message', message, { surfaceOp: 'append' })
    expect(accepted.ignorable).toBeUndefined()
    expect(session.seq).toBe(1)
    expect(session.deriveMessages()).toEqual([message])
  })
})
