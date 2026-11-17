import { describe, expect, it, vi } from 'vitest'
import {
  activateTerminalTarget,
  collectWrappedTerminalLinkLine,
  extractTerminalLinks,
  isLoopbackHttpUrl,
  isTerminalLinkActivation,
  linksOnBufferLine,
  resolveOpenPath,
  resolveWrappedTerminalLinkRange,
  splitPathAndPosition,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from '../src/client/links.ts'

describe('extractTerminalLinks', () => {
  it('prefers a URL over an overlapping path and keeps a relative file', () => {
    const matches = extractTerminalLinks('see https://example.com/src/main.ts and src/main.ts:12')
    expect(matches.map(match => match.kind)).toEqual(['url', 'path'])
    expect(matches[1]?.text).toBe('src/main.ts:12')
    expect(extractTerminalLinks('see (https://example.com/a).')[0]?.text).toBe('https://example.com/a')
    expect(extractTerminalLinks('see [https://example.com/a]')[0]?.text).toBe('https://example.com/a')
    expect(extractTerminalLinks('https://example.com/a, src/a.ts').map(match => match.kind)).toEqual(['url', 'path'])
  })
})

describe('resolveOpenPath', () => {
  it('joins a relative path and strips a line suffix', () => {
    expect(resolveOpenPath('src/main.ts:12', '/tmp/proj')).toBe('/tmp/proj/src/main.ts')
  })

  it('expands ~ from a /Users cwd', () => {
    expect(resolveOpenPath('~/src/a.ts', '/Users/ada/proj')).toBe('/Users/ada/src/a.ts')
  })

  it('expands ~ from /home and Windows user cwds', () => {
    expect(resolveOpenPath('~/a.ts', '/home/ada/proj')).toBe('/home/ada/a.ts')
    expect(resolveOpenPath('~/a.ts', 'C:\\Users\\ada\\proj')).toBe('C:\\Users\\ada\\a.ts')
    expect(resolveOpenPath('~/a.ts', '/tmp')).toBe('/tmp/~/a.ts')
  })

  it('joins a relative path on a Windows cwd', () => {
    expect(resolveOpenPath('src\\a.ts', 'C:\\work')).toBe('C:\\work\\src\\a.ts')
  })

  it('keeps a Windows absolute path', () => {
    expect(resolveOpenPath('C:\\work\\a.ts:3', 'C:\\work')).toBe('C:\\work\\a.ts')
  })
})

describe('splitPathAndPosition', () => {
  it('reads line and column suffixes', () => {
    expect(splitPathAndPosition('a.ts:10:4')).toEqual({ path: 'a.ts', line: '10', column: '4' })
    expect(splitPathAndPosition('src/a.ts:10:2')).toEqual({
      path: 'src/a.ts', line: '10', column: '2',
    })
    expect(splitPathAndPosition('a.ts')).toEqual({ path: 'a.ts', line: undefined, column: undefined })
  })
})

describe('isLoopbackHttpUrl', () => {
  it('accepts loopback hosts and rejects spoofs', () => {
    expect(isLoopbackHttpUrl('http://127.0.0.1:3000/app')).toBe(true)
    expect(isLoopbackHttpUrl('https://localhost/')).toBe(true)
    expect(isLoopbackHttpUrl('http://[::1]/')).toBe(true)
    expect(isLoopbackHttpUrl('https://example.com')).toBe(false)
    expect(isLoopbackHttpUrl('http://127.0.0.1.evil')).toBe(false)
    expect(isLoopbackHttpUrl('not a url')).toBe(false)
  })

  it('rejects embedded credentials even on a loopback host', () => {
    expect(isLoopbackHttpUrl('http://user:pass@127.0.0.1:57110')).toBe(false)
    expect(isLoopbackHttpUrl('http://user@localhost/')).toBe(false)
    expect(isLoopbackHttpUrl('https://evil@127.0.0.1/')).toBe(false)
  })
})
describe('activateTerminalTarget', () => {
  it('opens a loopback URL in the Browser surface', () => {
    const openLocalUrl = vi.fn()
    const openExternal = vi.fn()
    const openWorkspacePath = vi.fn()
    expect(activateTerminalTarget('http://127.0.0.1:3000', '/tmp', {
      openLocalUrl, openExternal, openWorkspacePath,
    })).toBe('url')
    expect(openLocalUrl).toHaveBeenCalledWith('http://127.0.0.1:3000')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens a non-loopback http(s) URL in the system browser', () => {
    const openLocalUrl = vi.fn()
    const openExternal = vi.fn()
    const openWorkspacePath = vi.fn()
    expect(activateTerminalTarget('https://example.com/docs', '/tmp', {
      openLocalUrl, openExternal, openWorkspacePath,
    })).toBe('url')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(openLocalUrl).not.toHaveBeenCalled()
  })

  it('hands a credential-bearing loopback URL to the system browser', () => {
    const openLocalUrl = vi.fn()
    const openExternal = vi.fn()
    const openWorkspacePath = vi.fn()
    expect(activateTerminalTarget('http://user:pass@127.0.0.1:57110/app', '/tmp', {
      openLocalUrl, openExternal, openWorkspacePath,
    })).toBe('url')
    expect(openExternal).toHaveBeenCalledWith('http://user:pass@127.0.0.1:57110/app')
    expect(openLocalUrl).not.toHaveBeenCalled()
  })

  it('opens a resolved path when cwd exists', () => {
    const openLocalUrl = vi.fn()
    const openExternal = vi.fn()
    const openWorkspacePath = vi.fn()
    expect(activateTerminalTarget('src/a.ts', '/tmp/proj', {
      openLocalUrl, openExternal, openWorkspacePath,
    })).toBe('path')
    expect(openWorkspacePath).toHaveBeenCalledWith('/tmp/proj/src/a.ts')
    expect(activateTerminalTarget('src/a.ts', undefined, {
      openLocalUrl, openExternal, openWorkspacePath,
    })).toBeNull()
  })

  it('passes a parsed :line into openWorkspacePath options', () => {
    const openLocalUrl = vi.fn()
    const openExternal = vi.fn()
    const openWorkspacePath = vi.fn()
    expect(activateTerminalTarget('src/a.ts:10:2', '/tmp/proj', {
      openLocalUrl, openExternal, openWorkspacePath,
    })).toBe('path')
    expect(openWorkspacePath).toHaveBeenCalledWith('/tmp/proj/src/a.ts', { line: 10 })
  })

  it('returns null when nothing matches', () => {
    expect(activateTerminalTarget('hello', '/tmp', {
      openLocalUrl: vi.fn(), openExternal: vi.fn(), openWorkspacePath: vi.fn(),
    })).toBeNull()
  })
})

describe('isTerminalLinkActivation', () => {
  it('requires Command on macOS and Ctrl elsewhere', () => {
    expect(isTerminalLinkActivation({ metaKey: true, ctrlKey: false }, 'MacIntel')).toBe(true)
    expect(isTerminalLinkActivation({ metaKey: false, ctrlKey: true }, 'MacIntel')).toBe(false)
    expect(isTerminalLinkActivation({ metaKey: false, ctrlKey: true }, 'Win32')).toBe(true)
    expect(isTerminalLinkActivation({ metaKey: true, ctrlKey: false }, 'Win32')).toBe(false)
    expect(isTerminalLinkActivation({ metaKey: true, ctrlKey: false }, 'Linux')).toBe(false)
    expect(isTerminalLinkActivation({ metaKey: true, ctrlKey: false }, '')).toBe(false)
    expect(isTerminalLinkActivation({ metaKey: true, ctrlKey: false }, 'iPhone')).toBe(true)
    expect(isTerminalLinkActivation({ metaKey: false, ctrlKey: true }, 'iPhone')).toBe(false)
  })
})

describe('wrapped terminal links', () => {
  it('rejoins a URL split across wrapped rows and maps the range', () => {
    const rows = [
      { text: 'see http://127.0.0.1:51', isWrapped: false },
      { text: '73/app', isWrapped: true },
    ]
    const getLine = (index: number) => {
      const row = rows[index]
      if (row === undefined) return undefined
      return { isWrapped: row.isWrapped, translateToString: () => row.text }
    }
    expect(collectWrappedTerminalLinkLine(99, getLine)).toBeNull()
    const wrapped = collectWrappedTerminalLinkLine(2, getLine)
    expect(wrapped?.text).toBe('see http://127.0.0.1:5173/app')
    const match = extractTerminalLinks(wrapped!.text)[0]!
    const range = resolveWrappedTerminalLinkRange(wrapped!, match)
    expect(range.start.y).toBe(1)
    expect(range.end.y).toBe(2)
    expect(wrappedTerminalLinkRangeIntersectsBufferLine(range, 1)).toBe(true)
    expect(wrappedTerminalLinkRangeIntersectsBufferLine(range, 3)).toBe(false)
    expect(linksOnBufferLine(1, getLine)[0]?.text).toBe('http://127.0.0.1:5173/app')
    expect(linksOnBufferLine(2, getLine)[0]?.text).toBe('http://127.0.0.1:5173/app')
  })

  it('returns null when a wrapped row has no previous line', () => {
    const getLine = (index: number) => index === 0
      ? { isWrapped: true, translateToString: () => 'tail' }
      : undefined
    expect(collectWrappedTerminalLinkLine(1, getLine)?.text).toBe('tail')
    const missingPrev = (index: number) => index === 1
      ? { isWrapped: true, translateToString: () => 'tail' }
      : null
    expect(collectWrappedTerminalLinkLine(2, missingPrev)).toBeNull()
  })

  it('maps a match past the last segment to the last cell', () => {
    const wrapped = collectWrappedTerminalLinkLine(1, () => ({
      translateToString: () => 'ab',
    }))!
    const range = resolveWrappedTerminalLinkRange(wrapped, { start: 80, end: 81 })
    expect(range.start).toEqual({ x: 2, y: 1 })
  })
})
