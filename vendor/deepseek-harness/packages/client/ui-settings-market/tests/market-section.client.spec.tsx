// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DISCOVER_PAGE_SIZE, MarketSection } from '../src/client/MarketSection.tsx'
import type { MarketSectionProps } from '../src/client/MarketSection.tsx'
import type { MarketCatalog, MarketItem, PluginOpResult } from '../src/client/desktop-shell.ts'
import { en, type MarketLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MarketLocaleKey, vars?: Record<string, string>): string => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, value)
  return text
}) as MarketSectionProps['t']

function item(overrides: Partial<MarketItem> = {}): MarketItem {
  return {
    id: 'acme/demo',
    owner: 'acme',
    repo: 'demo',
    description: 'A demo plugin',
    stars: 12,
    packageName: 'demo',
    homepage: 'https://github.com/acme/demo',
    installSpec: 'demo',
    category: 'workflow',
    npm: 'demo',
    ...overrides,
  }
}

function catalog(items: MarketItem[], overrides: Partial<MarketCatalog> = {}): MarketCatalog {
  return {
    ok: true,
    items,
    categories: [
      { id: 'all', label: 'All', count: items.length },
      { id: 'workflow', label: 'Workflow', count: items.filter(row => row.category === 'workflow').length },
    ],
    fetchedAt: Date.now(),
    source: 'live',
    warning: '',
    ...overrides,
  }
}

function renderMarket(overrides: Partial<MarketSectionProps> = {}) {
  const props = {
    getDetails: vi.fn(async () => ({ ok: true, partial: false, readme: '', version: '', requirements: [] })),
    getMarketState: vi.fn(async () => ({ ok: true, favorites: [], operations: [] })),
    setFavorite: vi.fn(async () => ({ ok: true, favorites: ['acme/demo'], operations: [] })),
    updateMany: vi.fn(async () => ({ ok: true, harnessStarted: true })),
    close: vi.fn(),
    t,
    listCatalog: vi.fn(async () => catalog([item()])),
    listInstalled: vi.fn(async () => []),
    checkUpdates: vi.fn(async () => ({ ok: true, updates: {}, checkedAt: Date.now() })),
    install: vi.fn(async () => ({ ok: true, harnessStarted: true })),
    update: vi.fn(async () => ({ ok: true, harnessStarted: true })),
    uninstall: vi.fn(async () => ({ ok: true, harnessStarted: true })),
    onProgress: vi.fn(() => () => {}),
    ...overrides,
  } as unknown as MarketSectionProps
  render(<MarketSection {...props} />)
  return props
}

async function clickMutation(button: HTMLElement) {
  fireEvent.click(button)
  fireEvent.click(await screen.findByRole('button', { name: en.confirmAction }))
}

describe('MarketSection', () => {
  it('expands all categories and retains the selected filter when collapsed', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => item({ id: `acme/plugin-${i}`, repo: `plugin-${i}`, category: `cat-${i}` }))
    renderMarket({ listCatalog: vi.fn(async () => catalog(rows, { categories: [
      { id: 'all', label: 'All', count: rows.length },
      ...rows.map((_row, i) => ({ id: `cat-${i}`, label: `Category ${i}`, count: 1 })),
    ] })) })
    const expand = await screen.findByRole('button', { name: en.expandCategories })
    expect(screen.queryByRole('radio', { name: /Category 6/ })).toBeNull()
    fireEvent.click(expand)
    fireEvent.click(screen.getByRole('radio', { name: /Category 6/ }))
    fireEvent.click(screen.getByRole('button', { name: en.collapseCategories }))
    expect(screen.getByRole('radio', { name: /Category 6/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('plugin-6')).toBeTruthy()
    expect(screen.queryByText('plugin-0')).toBeNull()
  })
  it('does not install before confirmation and cancellation performs no mutation', async () => {
    const props = renderMarket()
    fireEvent.click(await screen.findByRole('button', { name: en.install }))
    expect(props.install).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: en.confirmInstall })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.allowBuildsCancel }))
    expect(props.install).not.toHaveBeenCalled()
  })

  it('persists favorites through the desktop API and filters the favorites tab', async () => {
    const props = renderMarket({ listCatalog: vi.fn(async () => catalog([item(), item({ id: 'acme/other', repo: 'other' })])) })
    fireEvent.click((await screen.findAllByRole('button', { name: en.favorite }))[0]!)
    await waitFor(() => { expect(props.setFavorite).toHaveBeenCalledWith('acme/demo', true) })
    fireEvent.click(screen.getByRole('tab', { name: en.tabFavorites }))
    await waitFor(() => { expect(screen.queryByText('other')).toBeNull() })
    expect(screen.getByText('demo')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.unfavorite }).getAttribute('aria-pressed')).toBe('true')
  })

  it('sorts by stars and closes the selection menu', async () => {
    renderMarket({ listCatalog: vi.fn(async () => catalog([item(), item({ id: 'acme/other', repo: 'other', stars: 99 })])) })
    fireEvent.click(await screen.findByRole('button', { name: en.sort }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.sortStars }))
    await waitFor(() => { expect(document.querySelector('[data-market-item]')?.getAttribute('data-market-item')).toBe('acme/other') })
    expect(screen.getByRole('button', { name: en.sort }).getAttribute('aria-expanded')).toBe('false')
  })

  it('shows safe screenshots and README without executing remote HTML', async () => {
    renderMarket({
      listCatalog: vi.fn(async () => catalog([item({ screenshots: ['javascript:alert(1)', 'https://example.com/one.png', 'https://example.com/two.png'] })])),
      getDetails: vi.fn(async () => ({ ok: true, partial: false, readme: '# Documentation\n<script>alert(1)</script>', version: '1.2.0', requirements: ['dsh: >=0.1.0'] })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.details }))
    expect(await screen.findByRole('heading', { name: 'Documentation' })).toBeTruthy()
    expect(screen.getByText('dsh: >=0.1.0')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Plugin screenshot 1' }).getAttribute('src')).toBe('https://example.com/one.png')
    fireEvent.click(screen.getByRole('button', { name: en.nextImage }))
    expect(screen.getByRole('img', { name: 'Plugin screenshot 2' }).getAttribute('src')).toBe('https://example.com/two.png')
    expect(document.querySelector('script')).toBeNull()
  })

  it('reloads persisted operations when reopening the market', async () => {
    renderMarket({ getMarketState: vi.fn(async () => ({ ok: true, favorites: [], operations: [{ id: 'one', kind: 'update' as const,
      target: 'acme/demo', status: 'failed' as const, startedAt: 1788800000000, log: 'diagnostic output', error: 'network failed' }] })) })
    fireEvent.click(await screen.findByRole('tab', { name: en.tabHistory }))
    expect(await screen.findByText('Update: acme/demo')).toBeTruthy()
    expect(screen.getByText('diagnostic output')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.exportLog })).not.toHaveProperty('disabled', true)
  })

  it('confirms batch ids and sends one batch call', async () => {
    const props = renderMarket({ listInstalled: vi.fn(async () => [{ name: 'demo', spec: '1.0.0' }]),
      checkUpdates: vi.fn(async () => ({ ok: true, checkedAt: Date.now(), updates: { 'acme/demo': {
        id: 'acme/demo', packageName: 'demo', kind: 'npm' as const, current: '1.0.0', latest: '2.0.0', updateAvailable: true,
      } } })) })
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabInstalled} (1)` }))
    fireEvent.click(screen.getByRole('button', { name: en.updateAll }))
    expect(props.updateMany).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: en.confirmAction }))
    await waitFor(() => { expect(props.updateMany).toHaveBeenCalledWith(['acme/demo']) })
  })

  it('never hides a rollback failure behind build approval', async () => {
    renderMarket({ listInstalled: vi.fn(async () => [{ name: 'demo', spec: '1.0.0' }]),
      checkUpdates: vi.fn(async () => ({ ok: true, checkedAt: Date.now(), updates: { 'acme/demo': {
        id: 'acme/demo', packageName: 'demo', kind: 'npm' as const, current: '1.0.0', latest: '2.0.0', updateAvailable: true,
      } } })),
      update: vi.fn(async () => ({ ok: false, needsAllowBuilds: true, allowBuilds: ['demo'], rolledBack: false, error: 'rollback failed' })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.update }))
    expect(await screen.findByText('Operation failed: rollback failed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.allowBuildsConfirm })).toBeNull()
  })

  it('renders the catalog with search, categories, and install actions', async () => {
    renderMarket({
      listCatalog: vi.fn(async () => catalog([
        item(),
        item({ id: 'acme/other', repo: 'other', packageName: 'other', description: 'Second row', category: 'theme' }),
      ])),
    })
    await screen.findByText('demo')
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toMatchInlineSnapshot(`
      [
        "Discover",
        "Installed",
        "Favorites",
        "Operations",
      ]
    `)
    expect(screen.getByText('other')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.install })).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), { target: { value: 'second' } })
    await waitFor(() => { expect(screen.queryByText('demo')).toBeNull() })
    expect(screen.getByText('other')).toBeTruthy()
  })

  it('filters by category chips', async () => {
    renderMarket({
      listCatalog: vi.fn(async () => catalog([
        item(),
        item({ id: 'acme/paint', repo: 'paint', packageName: 'paint', category: 'theme' }),
      ])),
    })
    await screen.findByText('demo')
    expect(screen.getByRole('radiogroup', { name: en.categories })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Workflow/ }))
    await waitFor(() => { expect(screen.queryByText('paint')).toBeNull() })
    expect(screen.getByText('demo')).toBeTruthy()
  })

  it('shows a retry-able failure when the catalog cannot load', async () => {
    const listCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(catalog([item()]))
    renderMarket({ listCatalog: listCatalog as unknown as MarketSectionProps['listCatalog'] })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByText('demo')
  })

  it('installs by catalog id and reports success', async () => {
    const props = renderMarket()
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    await waitFor(() => { expect(props.install).toHaveBeenCalledWith('acme/demo', undefined) })
    await screen.findByText(en.installDone)
    expect(props.listInstalled).toHaveBeenCalled()
  })

  it.each([
    { name: 'unconfirmed restart', result: { ok: true }, text: en.opOutcomeUnknown },
    { name: 'failed restart', result: { ok: true, harnessStarted: false }, text: en.harnessDown },
    { name: 'history write failure after restart', result: { ok: true, harnessStarted: true, historyWarning: 'history write failed' }, text: 'history write failed' },
    { name: 'restart failure with history warning', result: { ok: true, harnessStarted: false, error: 'restart failed', historyWarning: 'history write failed' }, text: 'restart failed history write failed' },
    { name: 'operation failure with history warning', result: { ok: false, error: 'install failed', historyWarning: 'history write failed' }, text: 'Operation failed: install failed history write failed' },
  ] satisfies { name: string; result: PluginOpResult; text: string }[])('does not claim success for $name', async ({ result, text }) => {
    const props = renderMarket({ install: vi.fn(async () => result) })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    const feedback = await screen.findByText(text)
    expect(feedback.closest('[data-dsh-toast]')).toBeTruthy()
    expect(screen.queryByText(en.installDone)).toBeNull()
    expect(props.install).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: en.install })).not.toHaveProperty('disabled', true)
  })

  it('reports a rejected install and releases the pending action without claiming success', async () => {
    let rejectInstall: ((reason: Error) => void) | undefined
    const install = vi.fn(() => new Promise<PluginOpResult>((_resolve, reject) => { rejectInstall = reject }))
    renderMarket({ install })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    const installing = await screen.findByRole('button', { name: en.installing })
    expect(installing).toHaveProperty('disabled', true)
    expect(installing.getAttribute('aria-busy')).toBe('true')
    await act(async () => { rejectInstall!(new Error('bridge disconnected')) })
    expect((await screen.findByText('Operation failed: bridge disconnected')).closest('[role="alert"]')).toBeTruthy()
    expect(screen.queryByText(en.installDone)).toBeNull()
    expect(screen.getByRole('button', { name: en.install })).not.toHaveProperty('disabled', true)
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('shows a version difference and updates by catalog id', async () => {
    const props = renderMarket({
      listInstalled: vi.fn(async () => [{ name: 'demo', spec: '1.0.0' }]),
      checkUpdates: vi.fn(async () => ({
        ok: true,
        checkedAt: Date.now(),
        updates: {
          'acme/demo': {
            id: 'acme/demo',
            packageName: 'demo',
            kind: 'npm' as const,
            current: '1.0.0',
            latest: '2.0.0',
            updateAvailable: true,
          },
        },
      })),
    })
    expect(await screen.findByText('1.0.0 → 2.0.0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.update }))
    await waitFor(() => { expect(props.update).toHaveBeenCalledWith('acme/demo', undefined) })
    await screen.findByText(en.updateDone)
  })

  it('shows short GitHub commits in the installed tab', async () => {
    renderMarket({
      listInstalled: vi.fn(async () => [{ name: 'demo', spec: 'github:acme/demo' }]),
      checkUpdates: vi.fn(async () => ({
        ok: true,
        checkedAt: Date.now(),
        updates: {
          'acme/demo': {
            id: 'acme/demo',
            packageName: 'demo',
            kind: 'github' as const,
            current: '1111111111111111111111111111111111111111',
            latest: '2222222222222222222222222222222222222222',
            updateAvailable: true,
          },
        },
      })),
    })
    await screen.findByText('1111111 → 2222222')
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabInstalled} (1)` }))
    expect(await screen.findByText('1111111 → 2222222')).toBeTruthy()
  })

  it('retries an update after build-script approval', async () => {
    const update = vi.fn()
      .mockResolvedValueOnce({ ok: false, needsAllowBuilds: true, allowBuilds: ['demo'] })
      .mockResolvedValueOnce({ ok: true, harnessStarted: true })
    const props = renderMarket({
      listInstalled: vi.fn(async () => [{ name: 'demo', spec: '1.0.0' }]),
      checkUpdates: vi.fn(async () => ({
        ok: true,
        checkedAt: Date.now(),
        updates: {
          'acme/demo': {
            id: 'acme/demo', packageName: 'demo', kind: 'npm' as const,
            current: '1.0.0', latest: '2.0.0', updateAvailable: true,
          },
        },
      })),
      update: update as unknown as MarketSectionProps['update'],
    })
    fireEvent.click(await screen.findByRole('button', { name: en.update }))
    await screen.findByRole('dialog', { name: t('allowBuildsAsk', { name: 'demo' }) })
    fireEvent.click(screen.getByRole('button', { name: en.allowBuildsConfirm }))
    await waitFor(() => {
      expect(props.update).toHaveBeenLastCalledWith('acme/demo', { allowBuilds: ['demo'] })
    })
    await screen.findByText(en.updateDone)
  })

  it('surfaces install failures instead of staying silent', async () => {
    renderMarket({
      install: vi.fn(async () => ({ ok: false, error: '安装失败' })) as unknown as MarketSectionProps['install'],
    })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    const failure = await screen.findByText(t('opFailed', { message: '安装失败' }))
    expect(failure.closest('[role="alert"]')).toBeTruthy()
    expect(screen.queryByText(en.installDone)).toBeNull()
  })

  it('asks before allowing build scripts and retries with the keys', async () => {
    const install = vi.fn()
      .mockResolvedValueOnce({ ok: false, needsAllowBuilds: true, allowBuilds: ['demo@git+https://github.com/acme/demo.git'] })
      .mockResolvedValueOnce({ ok: true, harnessStarted: true })
    const props = renderMarket({ install: install as unknown as MarketSectionProps['install'] })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    await screen.findByRole('dialog', { name: t('allowBuildsAsk', { name: 'demo' }) })
    fireEvent.click(screen.getByRole('button', { name: en.allowBuildsConfirm }))
    await waitFor(() => {
      expect(props.install).toHaveBeenLastCalledWith('acme/demo', {
        allowBuilds: ['demo@git+https://github.com/acme/demo.git'],
      })
    })
    await screen.findByText(en.installDone)
  })

  it('does not offer a no-op approval when the failure has no allowBuilds key', async () => {
    const install = vi.fn(async () => ({ ok: false, needsAllowBuilds: true, allowBuilds: [] }))
    renderMarket({ install: install as unknown as MarketSectionProps['install'] })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    const failure = await screen.findByText(t('opFailed', { message: en.buildApprovalMissing }))
    expect(failure.closest('[role="alert"]')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: t('allowBuildsAsk', { name: 'demo' }) })).toBeNull()
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('closes the allow-builds ask on cancel without a second install call', async () => {
    const install = vi.fn()
      .mockResolvedValueOnce({ ok: false, needsAllowBuilds: true, allowBuilds: ['demo'] })
    const props = renderMarket({ install: install as unknown as MarketSectionProps['install'] })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    await screen.findByRole('dialog', { name: t('allowBuildsAsk', { name: 'demo' }) })
    fireEvent.click(screen.getByRole('button', { name: en.allowBuildsCancel }))
    expect(screen.queryByRole('dialog', { name: t('allowBuildsAsk', { name: 'demo' }) })).toBeNull()
    expect(props.install).toHaveBeenCalledTimes(1)
  })

  it('retains build approval actions when operation history could not be saved', async () => {
    const key = 'demo@git+https://github.com/acme/demo.git'
    const install = vi.fn()
      .mockResolvedValueOnce({ ok: false, needsAllowBuilds: true, allowBuilds: [key], historyWarning: 'history write failed' })
      .mockResolvedValueOnce({ ok: true, harnessStarted: true })
    renderMarket({ install })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    const dialog = await screen.findByRole('dialog', { name: t('allowBuildsAsk', { name: 'demo' }) })
    expect((await screen.findByText('history write failed')).closest('[role="alert"]')).toBeTruthy()
    expect(within(dialog).getByText(t('allowBuildsKeys', { keys: key }))).toBeTruthy()
    expect(install).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: en.allowBuildsConfirm }))
    await screen.findByText(en.installDone)
    expect(install).toHaveBeenLastCalledWith('acme/demo', { allowBuilds: [key] })
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('offers uninstall for installed rows and reports harness-down failures', async () => {
    const props = renderMarket({
      listInstalled: vi.fn(async () => [{ name: 'demo', spec: '1.0.0' }]),
      uninstall: vi.fn(async () => ({ ok: true, harnessStarted: false, error: en.harnessDown })) as unknown as MarketSectionProps['uninstall'],
    })
    await clickMutation(await screen.findByRole('button', { name: en.uninstall }))
    await waitFor(() => { expect(props.uninstall).toHaveBeenCalledWith('demo') })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(en.harnessDown)
  })

  it('shows the section heading, intro, and a discover/installed tab pair', async () => {
    renderMarket({ listInstalled: vi.fn(async () => [{ name: 'demo', spec: '1.0.0' }]) })
    await screen.findByText('demo')
    expect(screen.getByRole('heading', { name: en.heading })).toBeTruthy()
    expect(screen.getByText(en.intro)).toBeTruthy()
    expect(screen.getByRole('tab', { name: en.tabDiscover }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: `${en.tabInstalled} (1)` })).toBeTruthy()
  })

  it('renders owner, stars, category tag, and a homepage link on each card', async () => {
    renderMarket({ listCatalog: vi.fn(async () => catalog([item({ stars: 42 })])) })
    await screen.findByText('demo')
    expect(screen.getByText('acme')).toBeTruthy()
    expect(screen.getByText('★ 42')).toBeTruthy()
    const card = screen.getByText('demo').closest('li')!
    expect(within(card).getByText('Workflow')).toBeTruthy()
    const link = screen.getByRole('link', { name: en.homepage })
    expect(link.getAttribute('href')).toBe('https://github.com/acme/demo')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('falls back to an initial-letter avatar when the owner image fails', async () => {
    renderMarket()
    await screen.findByText('demo')
    const avatar = document.querySelector('img')!
    expect(avatar.getAttribute('src')).toContain('github.com/acme.png')
    fireEvent.error(avatar)
    await waitFor(() => { expect(document.querySelector('img')).toBeNull() })
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('marks deprecated catalog rows and skips zero-star and empty-homepage chrome', async () => {
    renderMarket({
      listCatalog: vi.fn(async () => catalog([
        item({ deprecated: true, stars: 0, homepage: '' }),
      ])),
    })
    await screen.findByText('demo')
    expect(screen.getByText(en.deprecated)).toBeTruthy()
    expect(screen.queryByText(/★/)).toBeNull()
    expect(screen.queryByRole('link', { name: en.homepage })).toBeNull()
  })

  it('shows the catalog warning and the filtered result count', async () => {
    renderMarket({
      listCatalog: vi.fn(async () => catalog([item()], { source: 'cache', warning: '离线目录' })),
    })
    await screen.findByText('demo')
    expect(screen.getByText('离线目录')).toBeTruthy()
    const count = screen.getByText(en.count.replace('{count}', '1'))
    expect(count.getAttribute('data-market-count')).toBe('1')
  })

  it('groups the installed tab by catalog category with uncatalogued rows last', async () => {
    renderMarket({
      listInstalled: vi.fn(async () => [
        { name: 'demo', spec: '1.0.0' },
        { name: 'mystery', spec: 'file:../mystery' },
      ]),
    })
    await screen.findByText('demo')
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabInstalled} (2)` }))
    expect(screen.getByRole('heading', { name: 'Workflow' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.ungrouped })).toBeTruthy()
    expect(screen.getByText('mystery')).toBeTruthy()
    expect(screen.getByText('file:../mystery')).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)
    expect(headings.indexOf(en.ungrouped)).toBeGreaterThan(headings.indexOf('Workflow'))
  })

  it('uninstalls from the installed tab and flags dropped rows', async () => {
    const props = renderMarket({
      listInstalled: vi.fn(async () => [
        { name: 'mystery', spec: 'file:../mystery', dropped: true },
      ]),
    })
    await screen.findByText('demo')
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabInstalled} (1)` }))
    expect(screen.getByText(en.dropped)).toBeTruthy()
    await clickMutation(screen.getByRole('button', { name: en.uninstall }))
    await waitFor(() => { expect(props.uninstall).toHaveBeenCalledWith('mystery') })
    await screen.findByText(en.uninstallDone)
  })

  it('shows the installed empty copy pointing back to Discover', async () => {
    renderMarket()
    await screen.findByText('demo')
    fireEvent.click(screen.getByRole('tab', { name: en.tabInstalled }))
    expect(screen.getByText(en.installedEmpty)).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: en.tabDiscover }))
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
  })

  it('offers no install button on deprecated rows while normal rows keep theirs', async () => {
    renderMarket({
      listCatalog: vi.fn(async () => catalog([
        item({ id: 'acme/old', repo: 'old', packageName: 'old', deprecated: true }),
        item(),
      ])),
    })
    await screen.findByText('old')
    expect(screen.getByText(en.deprecated)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.install })).toHaveLength(1)
    const deprecatedCard = screen.getByText('old').closest('li')!
    expect(within(deprecatedCard).queryByRole('button', { name: en.install })).toBeNull()
    const normalCard = screen.getByText('demo').closest('li')!
    expect(within(normalCard).getByRole('button', { name: en.install })).toBeTruthy()
  })

  it('offers no install button when the engine resolved no install spec', async () => {
    renderMarket({
      listCatalog: vi.fn(async () => catalog([
        item({ installSpec: '' }),
        item({ id: 'acme/blank', repo: 'blank', packageName: 'blank', installSpec: '   ' }),
      ])),
    })
    await screen.findByText('demo')
    expect(screen.getByText('blank')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.install })).toBeNull()
  })

  it('keeps the installed marker and uninstall on an already-installed deprecated row', async () => {
    const props = renderMarket({
      listCatalog: vi.fn(async () => catalog([item({ deprecated: true })])),
      listInstalled: vi.fn(async () => [{ name: 'demo', spec: '1.0.0' }]),
    })
    await screen.findByText('demo')
    expect(screen.getByText(en.installed)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.install })).toBeNull()
    await clickMutation(screen.getByRole('button', { name: en.uninstall }))
    await waitFor(() => { expect(props.uninstall).toHaveBeenCalledWith('demo') })
  })

  it('links each tab to its panel with tab/tabpanel semantics', async () => {
    renderMarket()
    await screen.findByText('demo')
    expect(screen.getByRole('tablist', { name: en.heading })).toBeTruthy()
    const discoverTab = screen.getByRole('tab', { name: en.tabDiscover })
    expect(discoverTab.id).toBe('market-tab-discover')
    expect(discoverTab.getAttribute('aria-controls')).toBe('market-panel-discover')
    expect(discoverTab.getAttribute('aria-selected')).toBe('true')
    const discoverPanel = screen.getByRole('tabpanel')
    expect(discoverPanel.id).toBe('market-panel-discover')
    expect(discoverPanel.getAttribute('aria-labelledby')).toBe('market-tab-discover')
    fireEvent.click(screen.getByRole('tab', { name: en.tabInstalled }))
    const installedTab = screen.getByRole('tab', { name: en.tabInstalled })
    expect(installedTab.id).toBe('market-tab-installed')
    expect(installedTab.getAttribute('aria-controls')).toBe('market-panel-installed')
    expect(installedTab.getAttribute('aria-selected')).toBe('true')
    expect(discoverTab.getAttribute('aria-selected')).toBe('false')
    const installedPanel = screen.getByRole('tabpanel')
    expect(installedPanel.id).toBe('market-panel-installed')
    expect(installedPanel.getAttribute('aria-labelledby')).toBe('market-tab-installed')
  })

  it('labels and titles the refresh control with the same copy', async () => {
    renderMarket()
    await screen.findByText('demo')
    const refresh = screen.getByRole('button', { name: en.refresh })
    expect(refresh.getAttribute('aria-label')).toBe(en.refresh)
    expect(refresh.getAttribute('title')).toBe(en.refresh)
  })

  it('keeps the shown catalog and offers retry when a refresh fails', async () => {
    const listCatalog = vi.fn()
      .mockResolvedValueOnce(catalog([item()]))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(catalog([item()]))
    renderMarket({ listCatalog: listCatalog as unknown as MarketSectionProps['listCatalog'] })
    await screen.findByText('demo')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(en.loadError)).toBeTruthy()
    expect(screen.getByText('demo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(screen.getByText('demo')).toBeTruthy()
    expect(listCatalog).toHaveBeenCalledTimes(3)
  })

  it('keeps the catalog and a working refresh action after dismissing its failure notice', async () => {
    const listCatalog = vi.fn()
      .mockResolvedValueOnce(catalog([item()]))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(catalog([item({ description: 'Recovered catalog' })]))
    renderMarket({ listCatalog })
    await screen.findByText('demo')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    const failure = await screen.findByText(en.loadError)
    const alert = failure.closest('[role="alert"]') as HTMLElement
    expect(alert).toBeTruthy()
    expect(within(alert).queryByRole('button', { name: en.close })).toBeNull()
    expect(screen.getByText('demo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await screen.findByText('Recovered catalog')
    expect(listCatalog).toHaveBeenCalledTimes(3)
  })

  it('keeps details and their refresh recovery after dismissing a failed details read', async () => {
    const getDetails = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, partial: false, readme: '# Recovered documentation', version: '2.0.0', requirements: [] })
    renderMarket({ getDetails })
    fireEvent.click(await screen.findByRole('button', { name: en.details }))
    const dialog = await screen.findByRole('dialog', { name: 'demo' })
    const failure = await screen.findByText(en.detailsFailed)
    const alert = failure.closest('[role="alert"]') as HTMLElement
    expect(alert).toBeTruthy()
    expect(within(alert).queryByRole('button', { name: en.close })).toBeNull()
    expect(within(dialog).getByText('A demo plugin')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: en.refresh }))
    await screen.findByRole('heading', { name: 'Recovered documentation' })
    expect(getDetails).toHaveBeenLastCalledWith('acme/demo', { force: true })
    expect(getDetails).toHaveBeenCalledTimes(2)
  })

  it('disables and relabels the refresh control while a reload is in flight', async () => {
    let resolveRefresh: ((value: MarketCatalog) => void) | null = null
    const listCatalog = vi.fn()
      .mockResolvedValueOnce(catalog([item()]))
      .mockImplementationOnce(() => new Promise<MarketCatalog>((resolve) => { resolveRefresh = resolve }))
    renderMarket({ listCatalog: listCatalog as unknown as MarketSectionProps['listCatalog'] })
    await screen.findByText('demo')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    const refreshing = await screen.findByRole('button', { name: en.refreshing })
    expect((refreshing as HTMLButtonElement).disabled).toBe(true)
    resolveRefresh!(catalog([item()]))
    const refresh = await screen.findByRole('button', { name: en.refresh })
    expect((refresh as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not mark a row installed from a longer repo-name spec', async () => {
    renderMarket({
      listInstalled: vi.fn(async () => [
        { name: 'demo-extra', spec: 'github:acme/demo-extra' },
      ]),
    })
    await screen.findByText('demo')
    expect(screen.getByRole('button', { name: en.install })).toBeTruthy()
    expect(screen.queryByText(en.installed)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabInstalled} (1)` }))
    expect(screen.getByRole('heading', { name: en.ungrouped })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Workflow' })).toBeNull()
  })

  it('marks a row installed from its exact github path spec', async () => {
    const props = renderMarket({
      listCatalog: vi.fn(async () => catalog([item({ packageName: '' })])),
      listInstalled: vi.fn(async () => [
        { name: 'demo-pkg', spec: 'github:acme/demo#path:/x' },
      ]),
    })
    await screen.findByText('demo')
    expect(screen.getByText(en.installed)).toBeTruthy()
    await clickMutation(screen.getByRole('button', { name: en.uninstall }))
    await waitFor(() => { expect(props.uninstall).toHaveBeenCalledWith('demo-pkg') })
  })

  it('prefers the exact package-name match over any spec fallback', async () => {
    renderMarket({
      listInstalled: vi.fn(async () => [
        { name: 'demo', spec: 'github:other/thing' },
      ]),
    })
    await screen.findByText('demo')
    expect(screen.getByText(en.installed)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.install })).toBeNull()
  })

  it('pages the discover grid and grows through show more', async () => {
    const rows = Array.from({ length: DISCOVER_PAGE_SIZE * 2 + 10 }, (_, position) => item({
      id: `acme/plugin-${position}`,
      repo: `plugin-${position}`,
      packageName: `plugin-${position}`,
    }))
    renderMarket({ listCatalog: vi.fn(async () => catalog(rows)) })
    await screen.findByText('plugin-0')
    expect(document.querySelectorAll('[data-market-item]')).toHaveLength(DISCOVER_PAGE_SIZE)
    // The count line still reports the full filtered total, not the page.
    expect(screen.getByText(en.count.replace('{count}', String(rows.length)))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {
      name: en.showMore.replace('{count}', String(DISCOVER_PAGE_SIZE + 10)),
    }))
    expect(document.querySelectorAll('[data-market-item]')).toHaveLength(DISCOVER_PAGE_SIZE * 2)
    fireEvent.click(screen.getByRole('button', { name: en.showMore.replace('{count}', '10') }))
    expect(document.querySelectorAll('[data-market-item]')).toHaveLength(rows.length)
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
  })

  it('resets discover paging when the search or category changes', async () => {
    const rows = Array.from({ length: DISCOVER_PAGE_SIZE + 20 }, (_, position) => item({
      id: `acme/plugin-${position}`,
      repo: `plugin-${position}`,
      packageName: `plugin-${position}`,
    }))
    renderMarket({ listCatalog: vi.fn(async () => catalog(rows)) })
    await screen.findByText('plugin-0')
    fireEvent.click(screen.getByRole('button', { name: en.showMore.replace('{count}', '20') }))
    expect(document.querySelectorAll('[data-market-item]')).toHaveLength(rows.length)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), { target: { value: 'plugin' } })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-market-item]')).toHaveLength(DISCOVER_PAGE_SIZE)
    })
    fireEvent.click(screen.getByRole('button', { name: en.showMore.replace('{count}', '20') }))
    expect(document.querySelectorAll('[data-market-item]')).toHaveLength(rows.length)
    fireEvent.click(screen.getByRole('radio', { name: /Workflow/ }))
    await waitFor(() => {
      expect(document.querySelectorAll('[data-market-item]')).toHaveLength(DISCOVER_PAGE_SIZE)
    })
  })

  it('keeps install progress in its busy button and unsubscribes after completion', async () => {
    let resolveInstall: ((value: PluginOpResult) => void) | undefined
    let publish: ((payload: { phase: string; line?: string }) => void) | undefined
    const unsubscribe = vi.fn()
    const install = vi.fn(() => new Promise<PluginOpResult>((resolve) => { resolveInstall = resolve }))
    renderMarket({ install, onProgress: vi.fn(listener => { publish = listener; return unsubscribe }) })
    await clickMutation(await screen.findByRole('button', { name: en.install }))
    const button = screen.getByRole('button', { name: en.installing })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
    expect(install).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
    act(() => { publish!({ phase: 'log', line: 'resolving demo' }) })
    expect(screen.getByRole('button', { name: 'resolving demo' })).toBe(button)
    act(() => { publish!({ phase: 'restart' }) })
    expect(screen.getByRole('button', { name: en.restarting })).toBe(button)
    expect(screen.queryByRole('log')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { resolveInstall!({ ok: true, harnessStarted: true }) })
    expect((await screen.findByText(en.installDone)).getAttribute('role')).toBe('status')
    expect(install).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
