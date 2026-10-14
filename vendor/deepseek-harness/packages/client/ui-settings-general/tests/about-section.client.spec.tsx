// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AboutSection } from '../src/client/AboutSection.tsx'
import type { AboutSectionProps } from '../src/client/AboutSection.tsx'
import type { UpdateInfo } from '../src/client/desktop-shell.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

function translate(key: string, params?: Record<string, unknown>) {
  let text = (en as Record<string, string>)[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

function mount(overrides: Pick<AboutSectionProps, 'openDesktopUpdate'> = {}) {
  const props = { t: translate, ...overrides } as AboutSectionProps
  render(<AboutSection {...props} />)
}

it('opens the shared Desktop confirmation for an available update without starting the old installer flow', async () => {
  const openDesktopUpdate = vi.fn()
  const installUpdate = vi.fn(async () => ({ launched: true }))
  ;(window as Window & { shell?: unknown }).shell = {
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9', assetUrl: 'https://example.test/app.exe' }),
    installUpdate,
  }
  mount({ openDesktopUpdate })
  const button = await screen.findByRole('button', { name: en['about.installUpdate'] })
  await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(button)
  expect(openDesktopUpdate).toHaveBeenCalledOnce()
  expect(installUpdate).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('New version 9.9.9 is available')
})

it('retains the shell reinstall action when the checked release is current', async () => {
  const openDesktopUpdate = vi.fn()
  const installUpdate = vi.fn(async () => ({ manualInstall: true, launched: false }))
  ;(window as Window & { shell?: unknown }).shell = {
    checkUpdate: async () => ({ status: 'current', latest: '9.9.9', assetUrl: 'https://example.test/app.dmg' }),
    installUpdate,
  }
  mount({ openDesktopUpdate })
  const button = await screen.findByRole('button', { name: en['about.installUpdate'] })
  await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(button)
  expect(await screen.findByText(en['about.updateManualInstall'])).toBeTruthy()
  expect(installUpdate).toHaveBeenCalledOnce()
  expect(openDesktopUpdate).not.toHaveBeenCalled()
})

const available: UpdateInfo = {
  status: 'available', current: '1.0.0', latest: '9.9.9', assetUrl: 'https://example.test/app.exe',
}

it('reports update cancellation and restores the About install action for another attempt', async () => {
  const pending = Promise.withResolvers<UpdateInfo>()
  const installUpdate = vi.fn(() => pending.promise)
  ;(window as Window & { shell?: unknown }).shell = {
    checkUpdate: async () => available,
    installUpdate,
  }
  mount()
  const install = await screen.findByRole('button', { name: en['about.installUpdate'] })
  await waitFor(() => { expect(install).toHaveProperty('disabled', false) })
  expect((await screen.findByRole('alert')).textContent).toBe(translate('about.updateAvailable', { latest: '9.9.9' }))
  fireEvent.click(install)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(install).toHaveProperty('disabled', true)
  install.click()
  expect(installUpdate).toHaveBeenCalledOnce()
  await act(async () => { pending.resolve({ ...available, launched: false, cancelled: true, code: 'cancelled' }) })
  expect((await screen.findByRole('alert')).textContent).toBe(en['about.updateCancelled'])
  expect(install).toHaveProperty('disabled', false)
  expect(install.getAttribute('aria-busy')).toBeNull()
  expect(screen.queryByText(en['about.updateInstalling'])).toBeNull()
})

it.each([
  ['Tasks could not be stopped', 'Tasks could not be stopped'],
  [undefined, 'install-gated'],
] as const)('reports a refused installer gate with message %s instead of confirming only the available release', async (message, diagnostic) => {
  ;(window as Window & { shell?: unknown }).shell = {
    checkUpdate: async () => available,
    installUpdate: async () => ({ ...available, launched: false, cancelled: false,
      code: 'install-gated', ...(message === undefined ? {} : { message }) }),
  }
  mount()
  const install = await screen.findByRole('button', { name: en['about.installUpdate'] })
  await waitFor(() => { expect(install).toHaveProperty('disabled', false) })
  fireEvent.click(install)
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe(translate('about.updateError', { message: diagnostic }))
  })
  expect(install).toHaveProperty('disabled', false)
  expect(screen.queryByText(en['about.updateInstalling'])).toBeNull()
})

it('shows manual DMG instructions and releases busy controls after opening the image', async () => {
  ;(window as Window & { shell?: unknown }).shell = {
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9', assetUrl: 'https://example.test/app.dmg' }),
    installUpdate: async () => ({ manualInstall: true, launched: false }),
  }
  mount()
  const button = await screen.findByRole('button', { name: en['about.installUpdate'] })
  await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(button)
  expect(await screen.findByText(en['about.updateManualInstall'])).toBeTruthy()
  expect((screen.getByRole('button', { name: en['about.checkUpdate'] }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByText(en['about.updateInstalling'])).toBeNull()
})

describe('AboutSection data folder', () => {
  it('hides the open-home control without a desktop opener', () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Open data folder' })).toBeNull()
  })

  it('shows the bound home path and opens it without a renderer path', async () => {
    const openDshHome = vi.fn(async () => ({ ok: true as const, path: 'C:\\Users\\me\\dsh-home' }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshHome: 'C:\\Users\\me\\dsh-home', appVersion: '0.2.7' }),
      openDshHome,
    }
    mount()
    await waitFor(() => {
      expect(screen.getByText('Data folder C:\\Users\\me\\dsh-home')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open data folder' }))
    await waitFor(() => {
      expect(openDshHome).toHaveBeenCalledTimes(1)
    })
    expect(openDshHome.mock.calls[0]).toEqual([])
  })
})

describe('AboutSection credential storage', () => {
  it('reports encrypted keychain storage as plain metadata', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ appVersion: '0.2.7', credentialStorage: 'encrypted' }),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByText(en['about.credEncrypted'])).toBeTruthy()
    })
    expect(screen.getByText(en['about.credEncrypted']).getAttribute('data-dsh-credential-storage')).toBe('encrypted')
  })

  it('surfaces the plaintext fallback as a visible status line', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ appVersion: '0.2.7', credentialStorage: 'plaintext' }),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByText(en['about.credPlaintext'])).toBeTruthy()
    })
    const line = screen.getByText(en['about.credPlaintext'])
    expect(line.getAttribute('data-dsh-credential-storage')).toBe('plaintext')
    expect(line.getAttribute('role')).toBe('status')
  })

  it('renders no credential line when the shell does not report a mode', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ appVersion: '0.2.7', credentialStorage: 'weird' }),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByText('Desktop version 0.2.7')).toBeTruthy()
    })
    expect(screen.queryByText(en['about.credEncrypted'])).toBeNull()
    expect(screen.queryByText(en['about.credPlaintext'])).toBeNull()
  })
})
