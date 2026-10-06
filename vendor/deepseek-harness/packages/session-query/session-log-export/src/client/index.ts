/** Browser plugin owning Session export download state and its shared modal. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionLogDownloadController } from './controller.ts'
import type { SessionLogDownloadDialogInjected } from './Dialog.tsx'
import {
  SessionLogDownloadHeaderAction, SessionLogDownloadTitlebarAction,
  type SessionLogDownloadHeaderInjected,
} from './HeaderAction.tsx'
import type { SessionLogChromeRowInjected } from './SessionLogChromeRow.tsx'
import { SessionLogChromeRow } from './SessionLogChromeRow.tsx'
import { ChromeVisibility } from './chrome-visibility.ts'
import {
  DEFAULT_TITLEBAR_ACTION,
  SESSION_LOG_EXPORT_SETTINGS_NAMESPACE,
  TITLEBAR_ACTION_FIELD,
  type SessionLogExportSettings,
} from '../export-settings.ts'
import { en, NS, zh, type SessionLogDownloadKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionLogDownload: SessionLogDownloadController
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'session-log-download': SessionLogDownloadKey
  }
}

export type { SessionLogDownloadEntry, SessionLogDownloadState } from './controller.ts'

/** Services required by the titlebar Session-log capsule and Interface row. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms']

/**
 * Provide the download controller, mount the Session menu and optional titlebar
 * shortcut with its shared modal, and contribute the Interface Settings visibility row.
 * @param ctx - browser context carrying slots, locale, and settings services.
 */
export function apply(ctx: ClientContext): void {
  const controller = new SessionLogDownloadController()
  ctx.provide('sessionLogDownload', controller)
  ctx.effect(() => async () => { await controller.dispose() }, 'session-log-download: browser download lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-log-download: browser dictionaries')
  const feedbackAvailable = createSnapshotStore(false)
  ctx.inject(['feedbackUi'], (scope: ClientContext) => {
    scope.effect(() => {
      feedbackAvailable.set(true)
      return () => { feedbackAvailable.set(false) }
    }, 'session-log-download: feedback availability')
  })
  ctx.on('command/executed', (sessionId, commandName, result) => {
    if (commandName === 'export' && result.kind === 'success') void controller.download(sessionId)
  })

  const chrome = new ChromeVisibility<SessionLogExportSettings>(
    ctx.configForms.get<SessionLogExportSettings>(SESSION_LOG_EXPORT_SETTINGS_NAMESPACE),
    TITLEBAR_ACTION_FIELD,
    DEFAULT_TITLEBAR_ACTION,
  )

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-log-download',
    order: 10,
    locale: NS,
    inject: (): SessionLogDownloadHeaderInjected => ({
      hooks: { sessionLogDownload: controller.store, feedbackAvailable },
      request: (sessionId: SessionId) => controller.download(sessionId),
      // Feedback can unload while the menu is open.
      openFeedback: (sessionId: SessionId) => { ctx.get('feedbackUi')?.openSession(sessionId) },
    }),
  }, SessionLogDownloadHeaderAction))

  ctx.slots.inject('shell.titlebar.trailing', () => ctx.slots.register({
    name: 'shell.titlebar.trailing',
    id: 'session-log-download',
    order: 10,
    locale: NS,
    inject: (): SessionLogDownloadDialogInjected => ({
      hooks: { sessionLogDownload: controller.store, titlebarAction: chrome.visible },
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
    }),
  }, SessionLogDownloadTitlebarAction))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'session-log-export',
    order: 10,
    locale: NS,
    inject: (): SessionLogChromeRowInjected => ({
      hooks: { titlebarAction: chrome.visible, writable: chrome.writable },
      setTitlebarAction: (value) => { chrome.setVisible(value) },
    }),
  }, SessionLogChromeRow))
}

export type { SessionLogDownloadDialogInjected, SessionLogDownloadDialogProps } from './Dialog.tsx'
