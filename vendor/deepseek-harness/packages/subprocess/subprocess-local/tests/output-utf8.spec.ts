import { describe, expect, it } from 'vitest'
import { OutputCollector } from '../src/output.ts'

describe('OutputCollector UTF-8 boundary truncation', () => {
  it('retains byte-exact tail for ASCII streams', () => {
    const collector = new OutputCollector(8, 'stdout', undefined)
    collector.push(Buffer.from('aaaa'))
    collector.push(Buffer.from('bbbbbb'))
    collector.push(Buffer.from('cc'))
    const result = collector.finalize()
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('bbbbbbcc')
  })

  it('skips UTF-8 continuation bytes when trimming single-chunk overflow to avoid \\uFFFD', () => {
    const collector = new OutputCollector(7, 'stdout', undefined)
    // 'a' (1) + '你好世界' (12 bytes: 4 x 3 bytes) = 13 bytes; excess = 6 drops 'a' + '你' + first 2 bytes of '好'.
    collector.push(Buffer.from('a你好世界', 'utf8'))
    const read = collector.readFrom(0)
    const result = collector.finalize()
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('世界')
    expect(read.text).toBe('世界')
    expect(result.text).not.toContain('\uFFFD')
  })

  it('skips UTF-8 continuation bytes across uneven split-chunk boundaries', () => {
    const collector = new OutputCollector(8, 'stdout', undefined)
    const emoji = Buffer.from('😀', 'utf8') // F0 9F 98 80 (4 bytes)
    const ok = Buffer.from('好ok!', 'utf8') // E5 A5 BD 6F 6B 21 (6 bytes)
    // Total = 10 bytes; excess = 2 trims into emoji continuation bytes split across chunks.
    collector.push(emoji.subarray(0, 3))
    collector.push(emoji.subarray(3))
    collector.push(ok)
    const result = collector.finalize()
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('好ok!')
    expect(result.text).not.toContain('\uFFFD')
  })
})
