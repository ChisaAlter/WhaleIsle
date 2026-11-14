/** Browser plugin owning ZIP download and Markdown copy state, plus feedback controls. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionLogDownloadController } from './controller.ts'
import type { SessionLogDownloadDialogInjected } from './Dialog.tsx'
import { SessionMarkdownCopyController } from './copy-controller.ts'
import { SessionMarkdownCopyToast, type SessionMarkdownCopyToastInjected } from './CopyToast.tsx'
import {
  SessionLogDownloadHeaderAction, SessionLogDownloadTitlebarAction,
  type SessionLogDownloadHeaderInjected,
} from './HeaderAction.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type SessionLogDownloadKey } from './locales.ts'

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

/** Services required by the Session menu and download dialog. */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Provide the download controller, mount the Session menu and its shared modal,
 * the Markdown copy controller and its root toast.
 * @param ctx - browser context carrying slots, locale, and download services.
 */
export function apply(ctx: ClientContext): void {
  const controller = new SessionLogDownloadController()
  const copyController = new SessionMarkdownCopyController()
  ctx.provide('sessionLogDownload', controller)
  ctx.effect(() => async () => { await controller.dispose() }, 'session-log-download: browser download lifecycle')
  ctx.effect(() => async () => { await copyController.dispose() }, 'session-log-download: browser Markdown copy lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'session-log-download: browser dictionaries')
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

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-log-download.copy-toast',
    locale: NS,
    inject: (): SessionMarkdownCopyToastInjected => ({
      hooks: { sessionMarkdownCopy: copyController.store },
      dismiss: () => { copyController.dismiss() },
    }),
  }, SessionMarkdownCopyToast))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'session-log-download',
    order: 0,
    locale: NS,
    inject: (): SessionLogDownloadHeaderInjected => ({
      hooks: {
        sessionLogDownload: controller.store,
        sessionMarkdownCopy: copyController.store,
        feedbackAvailable,
      },
      request: (sessionId: SessionId) => controller.download(sessionId),
      copyMarkdown: (sessionId: SessionId) => copyController.copy(sessionId),
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
      hooks: { sessionLogDownload: controller.store },
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
    }),
  }, SessionLogDownloadTitlebarAction))
}

export type { SessionLogDownloadDialogInjected, SessionLogDownloadDialogProps } from './Dialog.tsx'
