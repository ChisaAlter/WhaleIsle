// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RunningWhaleGirl } from '../src/client/chat/RunningWhaleGirl.tsx'

afterEach(cleanup)

function webpChunks(name: string) {
  const file = readFileSync(resolve(import.meta.dirname, `../src/client/chat/${name}.webp`))
  expect(file.toString('ascii', 0, 4)).toBe('RIFF')
  expect(file.toString('ascii', 8, 12)).toBe('WEBP')
  expect(file.readUInt32LE(4) + 8).toBe(file.length)
  const chunks: { type: string; data: Buffer }[] = []
  for (let offset = 12; offset < file.length;) {
    const length = file.readUInt32LE(offset + 4)
    const end = offset + 8 + length
    expect(end).toBeLessThanOrEqual(file.length)
    chunks.push({ type: file.toString('ascii', offset, offset + 4), data: file.subarray(offset + 8, end) })
    offset = end + length % 2
  }
  return chunks
}

describe('RunningWhaleGirl', () => {
  it('keeps the mascot decorative without adding status announcements or inline image data', () => {
    const view = render(<RunningWhaleGirl />)
    expect(view.container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(view.container.querySelector('[role]')).toBeNull()
    expect(view.container.querySelector('[style]')).toBeNull()
  })

  it('ships the transparent whale-girl running cycle with infinite playback', () => {
    const chunks = webpChunks('running-whale-girl')
    const header = chunks.find(chunk => chunk.type === 'VP8X')!.data
    expect(header[0]! & 0x12).toBe(0x12) // Alpha and animation.
    expect([header.readUIntLE(4, 3) + 1, header.readUIntLE(7, 3) + 1]).toEqual([512, 512])
    expect(chunks.find(chunk => chunk.type === 'ANIM')!.data.readUInt16LE(4)).toBe(0)
    const frames = chunks.filter(chunk => chunk.type === 'ANMF')
    expect(frames).toHaveLength(8)
    expect(frames.map(frame => frame.data.readUIntLE(12, 3))).toEqual(Array<number>(8).fill(90))
  })

  it('ships the same first frame without animation for reduced motion and forced colors', () => {
    const png = readFileSync(resolve(import.meta.dirname, '../src/client/chat/running-whale-girl-still.png'))
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[25]]).toEqual([512, 512, 6])
    const chunks: string[] = []
    for (let offset = 8; offset < png.length;) {
      chunks.push(png.toString('ascii', offset + 4, offset + 8))
      offset += 12 + png.readUInt32BE(offset)
    }
    expect(chunks).not.toContain('acTL')
  })
})
