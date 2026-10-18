// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { GatewaySettingsTab } from '../src/client/GatewaySettingsTab.tsx'
import { RemoteSettingsSection } from '../src/client/RemoteSettingsSection.tsx'
import type { GatewaySettingsTabProps } from '../src/client/GatewaySettingsTab.tsx'
import type { RemotePatch, RemoteSnapshot } from '../src/client/desktop-shell.ts'
import { en, zh, type RemoteLocaleKey } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

const t = ((key: RemoteLocaleKey, vars?: Record<string, string>): string => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, value)
  return text
}) as GatewaySettingsTabProps['t']

// `satisfies` keeps every field's definite type so mock echoes like
// `patch.remoteRelayUrl ?? SNAP.relayUrl` stay assignable under
// exactOptionalPropertyTypes.
const SNAP = {
  enabled: true,
  listening: true,
  port: 3180,
  mode: 'lan',
  bindAddress: '0.0.0.0',
  lanTls: false,
  addresses: ['10.0.0.4'],
  relayUrl: 'https://relay.example',
  defaultRelayUrl: 'ayase.cn:443',
  relayTokenSet: true,
  relayConfigured: true,
  urls: [],
  devices: [],
} satisfies RemoteSnapshot

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function renderGateway(overrides: Partial<GatewaySettingsTabProps> = {}) {
  const props = {
    close: () => {},
    t,
    getRemote: vi.fn(async () => SNAP),
    saveRemote: vi.fn(async () => SNAP),
    rotateRemoteToken: vi.fn(async () => SNAP),
    ...overrides,
  } as GatewaySettingsTabProps
  render(<GatewaySettingsTab {...props} />)
  return props
}

function declareShell(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-remote settings section', () => {
  it('registers Settings → Remote with a gateway tab when shell is present', async () => {
    const b = await bench()
    declareShell(b.slots)
    ;(window as Window & { shell?: unknown }).shell = {
      getRemote: vi.fn(async () => SNAP),
      saveRemote: vi.fn(async () => SNAP),
      rotateRemoteToken: vi.fn(async () => SNAP),
      unbindRemoteDevice: vi.fn(async () => SNAP),
      renameRemoteDevice: vi.fn(async () => SNAP),
    }
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const section = b.slots.entries('settings.section').find(entry => entry.options.id === 'remote')
    expect(section?.component).toBe(RemoteSettingsSection)
    expect(section?.options).toMatchObject({ id: 'remote', order: 18 })
    expect(b.slots.spec('settings.remote.tab')).toMatchObject({ kind: 'list', scope: 'root' })
    const gateway = b.slots.entries('settings.remote.tab')[0]!
    expect(gateway.component).toBe(GatewaySettingsTab)
    expect(gateway.options).toMatchObject({ id: 'gateway', order: 0 })
    await b.ctx.fiber.dispose()
  })
})

describe('GatewaySettingsTab', () => {
  it('offers v2 retired credentials only as collapsed cleanup and clears them', async () => {
    const snapshot = { ...SNAP, protocol: 'chisacode-v2', legacyRelayTokenSet: true }
    const saveRemote = vi.fn(async () => ({ ...snapshot, legacyRelayTokenSet: false }))
    renderGateway({ getRemote: vi.fn(async () => snapshot), saveRemote })
    const disclosure = await screen.findByRole('button', { name: en.legacyConfiguration })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText(en.relayToken)).toBeNull()
    fireEvent.click(disclosure)
    fireEvent.click(await screen.findByRole('button', { name: en.relayTokenClear }))
    await waitFor(() => { expect(saveRemote).toHaveBeenCalledWith({ remoteRelayToken: '' }) })
    expect(await screen.findByText(en.legacyEmpty)).toBeTruthy()
  })

  it('labels the relay as Server and selects it when no mode has been saved', async () => {
    expect(zh.modeRelay).toBe('服务器')
    expect(en.modeRelay).toBe('Server')
    renderGateway({ getRemote: vi.fn(async () => ({ relayConfigured: true, urls: [], devices: [] })) })
    const server = await screen.findByRole('radio', { name: 'Server' })
    await waitFor(() => { expect(server.getAttribute('aria-checked')).toBe('true') })
    expect(screen.getByRole('radio', { name: en.modeLan }).getAttribute('aria-checked')).toBe('false')
  })

  it('orders relay credentials before connection mode (T1)', async () => {
    renderGateway()
    const root = await screen.findByLabelText(en.relayUrl).then(el => el.closest('[data-dsh-remote-gateway]')!)
    const text = root.textContent || ''
    const urlAt = text.indexOf(en.relayUrl)
    const tokenAt = text.indexOf(en.relayToken)
    const modeAt = text.indexOf(en.mode)
    expect(urlAt).toBeGreaterThanOrEqual(0)
    expect(tokenAt).toBeGreaterThan(urlAt)
    expect(modeAt).toBeGreaterThan(tokenAt)
  })

  it('applies the desktop default relay origin in one click', async () => {
    const saveRemote = vi.fn(async (patch: RemotePatch) => ({
      ...SNAP,
      relayUrl: patch.remoteRelayUrl ?? SNAP.relayUrl,
      relayConfigured: Boolean((patch.remoteRelayUrl ?? SNAP.relayUrl) && SNAP.relayTokenSet),
    }))
    renderGateway({
      getRemote: vi.fn(async () => ({
        ...SNAP,
        relayUrl: '',
        relayTokenSet: false,
        relayConfigured: false,
      })),
      saveRemote,
    })
    fireEvent.click(await screen.findByRole('button', { name: en.relayUseDefault }))
    await waitFor(() => {
      expect(saveRemote).toHaveBeenCalledWith({ remoteRelayUrl: SNAP.defaultRelayUrl })
    })
  })

  it('shows relayNeedsBoth when neither credential exists (T2)', async () => {
    renderGateway({
      getRemote: vi.fn(async () => ({
        ...SNAP,
        relayUrl: '',
        relayTokenSet: false,
        relayConfigured: false,
      })),
    })
    expect(await screen.findByText(en.relayNeedsBoth)).toBeTruthy()
    const relay = await screen.findByRole('radio', { name: en.modeRelay }) as HTMLButtonElement
    expect(relay.disabled).toBe(true)
  })

  it('shows relayNeedsToken when only URL is set (T3)', async () => {
    const blocked = vi.fn(async () => SNAP)
    renderGateway({
      getRemote: vi.fn(async () => ({
        ...SNAP,
        relayUrl: 'https://relay.example',
        relayTokenSet: false,
        relayConfigured: false,
      })),
      saveRemote: blocked,
    })
    expect(await screen.findByText(en.relayNeedsToken)).toBeTruthy()
    const relay = await screen.findByRole('radio', { name: en.modeRelay }) as HTMLButtonElement
    expect(relay.disabled).toBe(true)
    fireEvent.click(relay)
    expect(blocked).not.toHaveBeenCalled()
  })

  it('switches to relay when credentials exist (T4/T5)', async () => {
    const saveRemote = vi.fn(async (patch: RemotePatch) => ({
      ...SNAP,
      mode: patch.remoteMode ?? SNAP.mode,
    }))
    renderGateway({ saveRemote })
    const group = await screen.findByRole('radiogroup', { name: en.mode })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    fireEvent.click(await screen.findByRole('radio', { name: en.modeRelay }))
    await waitFor(() => { expect(saveRemote).toHaveBeenCalledWith({ remoteMode: 'relay' }) })
  })

  it('saves port, relay URL, and relay token through saveRemote', async () => {
    const saveRemote = vi.fn(async (patch: RemotePatch) => ({
      ...SNAP,
      port: patch.remotePort ?? SNAP.port,
      relayUrl: patch.remoteRelayUrl ?? SNAP.relayUrl,
      relayTokenSet: patch.remoteRelayToken === '' ? false : SNAP.relayTokenSet,
      relayConfigured: patch.remoteRelayToken === '' ? false : SNAP.relayConfigured,
    }))
    renderGateway({ saveRemote })
    await screen.findByLabelText(en.relayUrl)
    fireEvent.change(screen.getByLabelText(en.relayUrl), { target: { value: 'https://relay.example/path' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.save })[0]!)
    await waitFor(() => {
      expect(saveRemote).toHaveBeenCalledWith({ remoteRelayUrl: 'https://relay.example/path' })
    })

    fireEvent.change(screen.getByLabelText(en.relayToken), { target: { value: 'a'.repeat(32) } })
    fireEvent.click(screen.getAllByRole('button', { name: en.save })[1]!)
    await waitFor(() => {
      expect(saveRemote).toHaveBeenCalledWith({ remoteRelayToken: 'a'.repeat(32) })
    })

    fireEvent.change(screen.getByLabelText(en.port), { target: { value: '3200' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.save })[2]!)
    await waitFor(() => { expect(saveRemote).toHaveBeenCalledWith({ remotePort: 3200 }) })
  })

  it('explains encryption without a LAN TLS control even for a legacy TLS snapshot', async () => {
    const saveRemote = vi.fn(async () => SNAP)
    renderGateway({ saveRemote, getRemote: vi.fn(async () => ({ ...SNAP, lanTls: true })) })
    await screen.findByLabelText(en.bindScope)
    expect(screen.getByText(en.lanTlsHint)).toBeTruthy()
    expect(screen.queryByRole('radio', { name: en.transportTls })).toBeNull()
    expect(screen.queryByRole('radio', { name: en.transportPlain })).toBeNull()
    expect(saveRemote).not.toHaveBeenCalled()
  })

  it('marks a saved bind address missing from the live NIC scan as unavailable', async () => {
    renderGateway({
      getRemote: vi.fn(async () => ({ ...SNAP, bindAddress: '172.24.64.1', addresses: ['10.0.0.4'] })),
    })
    const select = await screen.findByLabelText(en.bindScope)
    await waitFor(() => {
      expect(select.textContent).toContain('172.24.64.1')
      expect(select.textContent).toContain(en.bindUnavailable)
    })
  })

  it('rotates the pairing token through rotateRemoteToken', async () => {
    const rotateRemoteToken = vi.fn(async () => SNAP)
    renderGateway({ rotateRemoteToken })
    fireEvent.click(await screen.findByRole('button', { name: en.rotateTokenConfirm }))
    await waitFor(() => { expect(rotateRemoteToken).toHaveBeenCalled() })
  })

  it.each(['null', 'unavailable', 'rejected', 'service-error'] as const)('keeps the token draft after a %s save result without reporting success', async (outcome) => {
    let resolveSave: (value: RemoteSnapshot | null) => void = () => {}
    let rejectSave: (error: Error) => void = () => {}
    const saveRemote = vi.fn((_patch: RemotePatch) => new Promise<RemoteSnapshot | null>((resolve, reject) => {
      resolveSave = resolve
      rejectSave = reject
    }))
    renderGateway({ saveRemote })
    const token = await screen.findByLabelText(en.relayToken) as HTMLInputElement
    const controls = within(token.parentElement!)
    const save = controls.getByRole('button', { name: en.save }) as HTMLButtonElement
    const draft = 'a'.repeat(32)
    fireEvent.change(token, { target: { value: draft } })
    fireEvent.click(save)
    expect(saveRemote).toHaveBeenCalledExactlyOnceWith({ remoteRelayToken: draft })
    expect(save.disabled).toBe(true)
    expect(save.getAttribute('aria-busy')).toBe('true')
    expect(controls.getByRole('button', { name: en.save })).toBe(save)
    expect(token.disabled).toBe(true)
    expect(token.value).toBe(draft)
    fireEvent.click(save)
    expect(saveRemote).toHaveBeenCalledTimes(1)
    await act(async () => {
      if (outcome === 'rejected') rejectSave(new Error('write failed'))
      else resolveSave(outcome === 'null' ? null : outcome === 'unavailable' ? { available: false } : { ...SNAP, error: 'gateway stopped' })
    })
    const alert = await screen.findByRole('alert')
    const expected = outcome === 'rejected' ? t('statusError', { message: 'write failed' })
      : outcome === 'service-error' ? t('savedServiceError', { message: 'gateway stopped' }) : en.error
    expect(alert.textContent).toBe(expected)
    expect(screen.queryByText(en.saved)).toBeNull()
    expect(token.value).toBe(draft)
    expect(token.disabled).toBe(false)
    expect(save.disabled).toBe(false)
    expect(save.getAttribute('aria-busy')).toBeNull()
    expect(token.closest('[data-dsh-remote-gateway]')!.contains(alert)).toBe(false)
    expect(token.value).toBe(draft)
    expect(controls.getByRole('button', { name: en.save })).toBe(save)
  })

  it('clears the token draft only after a healthy save result', async () => {
    let resolveSave: (value: RemoteSnapshot) => void = () => {}
    const saveRemote = vi.fn((_patch: RemotePatch) => new Promise<RemoteSnapshot>((resolve) => { resolveSave = resolve }))
    renderGateway({ saveRemote })
    const token = await screen.findByLabelText(en.relayToken) as HTMLInputElement
    const save = within(token.parentElement!).getByRole('button', { name: en.save })
    fireEvent.change(token, { target: { value: 'b'.repeat(32) } })
    fireEvent.click(save)
    expect(token.value).toBe('b'.repeat(32))
    expect(screen.queryByText(en.saved)).toBeNull()
    await act(async () => { resolveSave(SNAP) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(en.saved)
    expect(alert.getAttribute('data-persistent')).toBeNull()
    expect(token.value).toBe('')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(save.getAttribute('aria-busy')).toBeNull()
  })

  it('keeps port validation after dismissing its Toast and clears it for a valid save', async () => {
    let resolveSave: (value: RemoteSnapshot) => void = () => {}
    const saveRemote = vi.fn((_patch: RemotePatch) => new Promise<RemoteSnapshot>((resolve) => { resolveSave = resolve }))
    renderGateway({ saveRemote })
    const port = await screen.findByLabelText(en.port) as HTMLInputElement
    const save = within(port.parentElement!).getByRole('button', { name: en.save }) as HTMLButtonElement
    fireEvent.change(port, { target: { value: '1' } })
    fireEvent.click(save)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(en.portInvalid)
    expect(port.getAttribute('aria-invalid')).toBe('true')
    expect(port.title).toBe(en.portInvalid)
    expect(saveRemote).not.toHaveBeenCalled()
    expect(port.parentElement!.contains(alert)).toBe(false)
    expect(port.getAttribute('aria-invalid')).toBe('true')
    expect(port.value).toBe('1')
    fireEvent.change(port, { target: { value: '3200' } })
    fireEvent.click(save)
    expect(saveRemote).toHaveBeenCalledExactlyOnceWith({ remotePort: 3200 })
    expect(port.getAttribute('aria-invalid')).toBeNull()
    expect(port.title).toBe('')
    expect(save.getAttribute('aria-busy')).toBe('true')
    await act(async () => { resolveSave({ ...SNAP, port: 3200 }) })
    expect((await screen.findByRole('alert')).textContent).toBe(en.saved)
    expect(port.value).toBe('3200')
    expect(save.disabled).toBe(false)
  })

  it('keeps a retry control after an initial read failure and recovers without stale feedback', async () => {
    const getRemote = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(SNAP)
    renderGateway({ getRemote })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(t('statusError', { message: 'offline' }))
    const retry = screen.getByRole('button', { name: en.retry }) as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    expect(screen.getByRole('button', { name: en.retry })).toBe(retry)
    fireEvent.click(retry)
    await screen.findByLabelText(en.relayUrl)
    expect(getRemote).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: en.retry })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
