import { describe, expect, it } from 'vitest'
import { isVolatilePath } from '../../../settings/settings/src/schema.ts'
import { Config } from '../src/index.ts'
import { ConversationSettingsFields } from '../src/submission-settings.ts'

describe('conversation Host configuration', () => {
  it('accepts live writes for every preference exposed by the browser form', () => {
    const fields = Object.keys(ConversationSettingsFields)
    const allFields = [...fields, 'maxConcurrentFileUploads']
    expect(Object.keys(Config.dict ?? {})).toEqual(allFields)
    for (const field of allFields) expect(isVolatilePath(Config, [field])).toBe(true)
  })
})
