/** Acrylic window material support threshold. */
import { describe, expect, it } from 'vitest'
import { ACRYLIC_MINIMUM_WINDOWS_BUILD, windowsAcrylicSupported } from '../src/window-material.ts'

describe('windowsAcrylicSupported', () => {
  it.each([
    ['win32', '10.0.22631', true],
    ['win32', '10.0.22621', true],
    ['win32', '10.0.22000', false],
    ['win32', '10.0.19045', false],
    ['win32', 'not-a-version', false],
    ['darwin', '23.5.0', false],
    ['linux', '6.8.0-47-generic', false],
  ] as const)('reports %s release %s as %s', (platform, osRelease, expected) => {
    expect(windowsAcrylicSupported(platform, osRelease)).toBe(expected)
  })

  it('pins the minimum to the Windows 11 22H2 build', () => {
    expect(ACRYLIC_MINIMUM_WINDOWS_BUILD).toBe(22621)
  })
})
