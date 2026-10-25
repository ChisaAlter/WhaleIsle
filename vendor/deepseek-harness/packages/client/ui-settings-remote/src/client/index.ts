/**
 * Desktop-gated Remote surfaces — account-menu pairing popup (sidebar fallback) plus Settings → Remote
 * (gateway advanced knobs; IM channels arrive via settings.remote.tab).
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { desktopShell, hasRemoteApi } from './desktop-shell.ts'
import { GatewaySettingsTab } from './GatewaySettingsTab.tsx'
import { RemoteMenuAction, RemoteSection, type RemoteSectionInjected } from './RemoteSection.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  RemoteSettingsSection,
  type RemoteSettingsSectionInjected,
  type RemoteSettingsTabEntry,
} from './RemoteSettingsSection.tsx'
import { en, zh, type RemoteLocaleKey } from './locales.ts'

export type { RemoteSectionInjected, RemoteSectionProps } from './RemoteSection.tsx'
export type {
  RemoteSettingsSectionInjected,
  RemoteSettingsSectionProps,
  RemoteSettingsTabEntry,
} from './RemoteSettingsSection.tsx'
export type { GatewaySettingsTabInjected, GatewaySettingsTabProps } from './GatewaySettingsTab.tsx'
export type { RemoteLocaleKey } from './locales.ts'
export type { RemotePatch, RemoteSnapshot, RemoteDevice } from './desktop-shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Remote popup and Settings → Remote copy. */
    'settings.remote': RemoteLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.remote'

/** Services required by the menu, sidebar fallback, and settings registrations. */
export const inject = ['slots', 'locale']

/**
 * Contribute the Remote popup and Settings → Remote section when the desktop
 * shell exposes remote APIs.
 * @param ctx - client context with slots and locale.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-remote: dictionaries')

  const shell = desktopShell()
  if (!hasRemoteApi(shell)) return

  const t = ctx.locale.bind(NS)

  const popupInjected = (): RemoteSectionInjected => ({
    getRemote: () => shell.getRemote(),
    saveRemote: patch => shell.saveRemote(patch),
    rotateRemoteToken: () => shell.rotateRemoteToken(),
    revokeRemotePairingLink: () => shell.revokeRemotePairingLink(),
    unbindRemoteDevice: id => shell.unbindRemoteDevice(id),
    renameRemoteDevice: (id, name) => shell.renameRemoteDevice(id, name),
  })

  ctx.slots.inject('settings.launcher.action', () => ctx.slots.register({
    name: 'settings.launcher.action', id: 'remote', order: 50, label: () => t('trigger'),
    locale: NS, inject: popupInjected,
  }, RemoteMenuAction))

  ctx.slots.inject('sidebar.footer.action', () => {
    let unregister: (() => void) | undefined
    let disposed = false
    const sync = () => {
      if (disposed) return
      if (ctx.slots.entries('settings.launcher').length > 0) {
        unregister?.()
        unregister = undefined
      } else {
        unregister ??= ctx.slots.register({
          name: 'sidebar.footer.action', id: 'remote', order: 80,
          locale: NS, inject: popupInjected,
        }, RemoteSection)
      }
    }
    const off = ctx.slots.subscribe('settings.launcher', sync)
    sync()
    return () => { disposed = true; off(); unregister?.() }
  })

  let tabsVersion = -1
  let tabsRevision = -1
  let tabs: readonly RemoteSettingsTabEntry[] = []
  const sectionInjected = (): RemoteSettingsSectionInjected => ({
    hooks: {
      tabs: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.remote.tab')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== tabsVersion || revision !== tabsRevision) {
            tabsVersion = version
            tabsRevision = revision
            tabs = ctx.slots.entries('settings.remote.tab')
              .map(entry => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: entry.options.id ?? '',
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return tabs
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.remote.tab', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
    children: { 'settings.remote.tab': { kind: 'list', scope: 'root' } },
  }, RemoteSettingsSection))

  ctx.slots.inject('settings.remote.tab', () => ctx.slots.register({
    name: 'settings.remote.tab',
    id: 'gateway',
    order: 0,
    label: () => t('gatewayTab'),
    locale: NS,
    inject: () => ({
      getRemote: () => shell.getRemote(),
      saveRemote: patch => shell.saveRemote(patch),
      rotateRemoteToken: () => shell.rotateRemoteToken(),
    }),
  }, GatewaySettingsTab))
}
