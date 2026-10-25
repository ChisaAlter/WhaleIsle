// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { desktopShell, hasRemoteApi } from '../src/client/desktop-shell.ts'

describe('desktopShell', () => {
  it('returns null without a shell bridge', () => {
    delete (window as Window & { shell?: unknown }).shell
    expect(desktopShell()).toBeNull()
    expect(hasRemoteApi(null)).toBe(false)
  })

  it('returns the preload object when present and gates incomplete APIs', () => {
    const incomplete = { getRemote: async () => ({}) }
    ;(window as Window & { shell?: unknown }).shell = incomplete
    expect(desktopShell()).toBe(incomplete)
    expect(hasRemoteApi(incomplete)).toBe(false)
    const api = {
      getRemote: async () => ({ enabled: false }),
      saveRemote: async () => ({ enabled: true }),
      rotateRemoteToken: async () => ({ enabled: true }),
      revokeRemotePairingLink: async () => ({ enabled: true }),
      unbindRemoteDevice: async () => ({ enabled: true, devices: [] }),
      renameRemoteDevice: async () => ({ enabled: true, devices: [] }),
    }
    ;(window as Window & { shell?: unknown }).shell = api
    expect(hasRemoteApi(api)).toBe(true)
    // A preload without rename is an older desktop build — not a Remote surface.
    const { renameRemoteDevice: _omit, ...withoutRename } = api
    expect(hasRemoteApi(withoutRename)).toBe(false)
    delete (window as Window & { shell?: unknown }).shell
  })
})
