import { describe, expect, it } from 'vitest'
import {
  resolveTitlebarDensity, titlebarConversationReserve,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/titlebar-density.ts'

describe('resolveTitlebarDensity', () => {
  it('stays full when the cluster is not over the conversation column', () => {
    expect(resolveTitlebarDensity(400, false)).toBe('full')
  })

  it('keeps full labels at and above the cozy threshold', () => {
    expect(resolveTitlebarDensity(900, true)).toBe('full')
    expect(resolveTitlebarDensity(901, true)).toBe('full')
  })

  it('is cozy between the compact and cozy thresholds', () => {
    expect(resolveTitlebarDensity(899, true)).toBe('cozy')
    expect(resolveTitlebarDensity(720, true)).toBe('cozy')
  })

  it('is compact below the compact threshold', () => {
    expect(resolveTitlebarDensity(719, true)).toBe('compact')
  })
})

describe('titlebarConversationReserve', () => {
  it('is 0 when the cluster is hidden', () => {
    expect(titlebarConversationReserve(false, 400, 0)).toBe(0)
  })

  it('is the trailing width when details is closed', () => {
    expect(titlebarConversationReserve(true, 400, 0)).toBe(400)
  })

  it('subtracts an open details column and never goes negative', () => {
    expect(titlebarConversationReserve(true, 400, 300)).toBe(100)
    expect(titlebarConversationReserve(true, 280, 360)).toBe(0)
  })
})
