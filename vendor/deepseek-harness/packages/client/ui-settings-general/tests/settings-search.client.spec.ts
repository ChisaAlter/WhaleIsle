// @vitest-environment jsdom
/**
 * Settings navigation groups and search: sections land in their group with
 * unknown plugin pages under Features; the DOM index reads slot rows, control
 * blocks and heading blocks; matching ranks title hits first; a result in a
 * hidden tab reveals its tab before scrolling.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupSections } from '../src/client/settings-placement.ts'
import { indexSection, revealSetting, searchSettings } from '../src/client/settings-search.ts'

function page(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

afterEach(() => { document.body.innerHTML = '' })

describe('groupSections', () => {
  it('orders sections by group and places unknown pages under features', () => {
    const rows = [
      { id: 'about', order: 90 }, { id: 'antigravity', order: 50 }, { id: 'models', order: 10 },
      { id: 'general', order: 0 }, { id: 'conversation', order: 7 }, { id: 'usage-stats', order: 25 },
      { id: 'pet', order: 40 }, { id: 'features', order: 30 }, { id: 'zeta', order: 45 },
    ]
    expect(groupSections(rows).map(group => [group.id, group.rows.map(row => row.id)])).toEqual([
      ['account', ['usage-stats']],
      ['general', ['general', 'conversation']],
      ['agent', ['models']],
      ['features', ['features', 'pet', 'zeta', 'antigravity']],
      ['other', ['about']],
    ])
  })
})

describe('indexSection', () => {
  it('reads slot rows, control blocks and heading blocks without control text', () => {
    const root = page(`
      <div data-slot="settings.general.item">
        <div><div><div>Language</div><div>Choose the interface language</div></div><button>English</button></div>
        <div><div><div>Font size</div></div><div role="switch">On</div></div>
      </div>
      <section><h2>Wallpaper</h2><p>Choose an image</p><div><button>Choose image</button></div></section>
      <div><span>Remote</span><input value="x"></div>
      <div><span>100%</span><input value="1"></div>
      <div><div>Text size</div><div><span>14</span><button>+</button></div></div>
    `)
    expect(indexSection('general', root)).toEqual([
      { sectionId: 'general', title: 'Language', desc: 'Choose the interface language' },
      { sectionId: 'general', title: 'Font size', desc: '' },
      { sectionId: 'general', title: 'Wallpaper', desc: 'Choose an image' },
      { sectionId: 'general', title: 'Remote', desc: '' },
      { sectionId: 'general', title: 'Text size', desc: '14' },
    ])
  })
})

describe('searchSettings', () => {
  const entries = [
    { sectionId: 'general', title: 'Language', desc: 'Interface language' },
    { sectionId: 'appearance', title: 'Font size', desc: 'Text size of the app' },
    { sectionId: 'conversation', title: 'Custom instructions', desc: 'Added to every session' },
  ]
  const label = (id: string) => ({ general: 'General', appearance: 'Appearance', conversation: 'Conversation' })[id] ?? id

  it('ranks title matches before description and page matches', () => {
    expect(searchSettings(entries, 'size', label).map(hit => hit.title)).toEqual(['Font size'])
    expect(searchSettings(entries, 'language', label).map(hit => hit.title)).toEqual(['Language'])
    expect(searchSettings(entries, 'session', label).map(hit => [hit.title, hit.rank])).toEqual([['Custom instructions', 2]])
    expect(searchSettings(entries, 'appearance', label).map(hit => [hit.title, hit.rank])).toEqual([['Font size', 3]])
  })

  it('requires every term and ignores blank queries', () => {
    expect(searchSettings(entries, 'font app', label).map(hit => hit.title)).toEqual(['Font size'])
    expect(searchSettings(entries, 'font language', label)).toEqual([])
    expect(searchSettings(entries, '   ', label)).toEqual([])
  })
})

describe('revealSetting', () => {
  it('opens the hidden tab that holds the setting', () => {
    const root = page(`
      <button id="tab-a" role="tab">A</button><button id="tab-b" role="tab">B</button>
      <div role="tabpanel" aria-labelledby="tab-b" hidden>
        <div><div>Click sound</div><div role="switch">On</div></div>
      </div>
    `)
    const clicked = vi.fn()
    document.getElementById('tab-b')!.addEventListener('click', clicked)
    const block = revealSetting(root, 'Click sound')
    expect(block?.textContent).toContain('Click sound')
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(revealSetting(root, 'Missing')).toBeNull()
  })
})
