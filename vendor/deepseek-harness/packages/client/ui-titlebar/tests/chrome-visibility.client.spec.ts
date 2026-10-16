import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { ChromeVisibility } from '../src/client/chrome-visibility.ts'

interface Section {
  terminalToggle: boolean
}

describe('ChromeVisibility', () => {
  it('stays shown while the Host section is loading or unavailable', () => {
    const host = stubSettingsScope<Section>()
    const chrome = new ChromeVisibility(host.scope, 'terminalToggle')
    expect(chrome.visible.getSnapshot()).toBe(true)
    expect(chrome.writable.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false })
    expect(chrome.visible.getSnapshot()).toBe(true)
    expect(chrome.writable.getSnapshot()).toBe(false)
  })

  it('hides only when the field is explicitly false and publishes a Switch write locally first', () => {
    const host = stubSettingsScope<Section>()
    const chrome = new ChromeVisibility(host.scope, 'terminalToggle')
    host.publish({ status: 'ready', value: { terminalToggle: true }, revision: 1, writable: true })
    expect(chrome.visible.getSnapshot()).toBe(true)
    expect(chrome.writable.getSnapshot()).toBe(true)
    chrome.setVisible(false)
    expect(chrome.visible.getSnapshot()).toBe(false)
    expect(host.set).toHaveBeenCalledWith('terminalToggle', false)
    chrome.setVisible(false)
    expect(host.set).toHaveBeenCalledOnce()
    chrome.setVisible(true)
    expect(chrome.visible.getSnapshot()).toBe(true)
    host.publish({ value: { terminalToggle: false }, revision: 2 })
    expect(chrome.visible.getSnapshot()).toBe(false)
    host.publish({ value: {} as Section, revision: 3 })
    expect(chrome.visible.getSnapshot()).toBe(true)
  })
})
