import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular,
  FileTypeIcon, fileSizeText, IconEditOutlineRegular, InlineEditor, IconQueueOutlineRegular, IconSendOutlineRegular,
  IconTrashOutlineRegular, Tooltip, usePresence,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { QueueAction } from '@deepseek-ai/dsh-api-session-controller/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { UserTextFacts } from '../index.ts'
import { NS } from '../locales.ts'
import css from './QueueDock.module.css'

const EMPTY_QUEUE = [] as const
/**
 * A queued row the user did not write (a goal round, a notice) is normally taken
 * within moments; opening the card for it would flash it open and shut between
 * goal rounds, so such rows only open it once they linger this long.
 */
const SYSTEM_ROW_SETTLE_MS = 400
/** Custom drag type, so dropping a row on the composer text box inserts nothing. */
const DRAG_TYPE = 'application/x-dsh-queue-item'
const QUEUE_TEXT_FACTS: Readonly<Partial<UserTextFacts>> = {
  collapseWhitespace: true,
  trimWhitespace: true,
}

function textOf(content: InboxState['next-turn'][number]['content']): string | null {
  if (!content.every(block => block.type === 'text')) return null
  return content.map(block => block.text).join('')
}

/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
  updateQueue: (itemId: MessageId, action: QueueAction) => Promise<void>
  notify: (level: 'info' | 'error', text: string) => void
  /** Resolve one durable queued image into a session-scoped browser URL. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
}

/**
 * Durable references carried by one queued row. Inbox projections are wire data
 * despite their typed face, so an image block without a reference is skipped
 * rather than trusted.
 * @param content - the row's wire content blocks.
 * @returns the row's durable image references in block order.
 */
function queueAttachments(content: InboxState['next-turn'][number]['content']): Array<
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'file'; readonly attachment: FileAttachmentRef }
> {
  const attachments: Array<
    | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
    | { readonly type: 'file'; readonly attachment: FileAttachmentRef }
  > = []
  for (const block of content) {
    if (block.type === 'image') {
      const { attachment } = block as { attachment?: ImageAttachmentRef }
      if (attachment !== undefined) attachments.push({ type: 'image', attachment })
    }
    if (block.type === 'file') {
      const { attachment } = block as { attachment?: FileAttachmentRef }
      if (attachment !== undefined) attachments.push({ type: 'file', attachment })
    }
  }
  return attachments
}

/** Compact file identity used beside queue thumbnails. */
function QueueFile({ attachment, label }: { attachment: FileAttachmentRef; label: string }) {
  return (
    <span className={css.file} aria-label={label} title={attachment.name}>
      <span className={css.fileIcon} aria-hidden><FileTypeIcon path={attachment.name} size={16} /></span>
      <span className={css.fileName}>{attachment.name}</span>
      <span className={css.fileSize}>{fileSizeText(attachment.bytes)}</span>
    </span>
  )
}

/** One durable queued image as a fixed-size thumbnail; a load failure keeps the empty placeholder. */
function QueueThumb({ attachment, loadImage, label }: {
  attachment: ImageAttachmentRef
  loadImage: QueueDockInjected['loadImage']
  label: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadImage(attachment).then(
      (resolved) => { if (alive) setUrl(resolved) },
      () => { /* placeholder retained; the durable transcript surfaces read errors */ },
    )
    return () => { alive = false }
  }, [attachment, loadImage])
  return url === null
    ? <span className={css.thumb} aria-hidden />
    : <img className={css.thumb} src={url} alt={label} />
}

/** Six-dot grip that marks a row as reorderable. */
function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden focusable="false">
      {[4, 10].flatMap(x => [3, 7, 11].map(y => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.1" />))}
    </svg>
  )
}

/** True once `active` has held for `delayMs`; drops with it at once. */
function useLingering(active: boolean, delayMs: number): boolean {
  const [lingered, setLingered] = useState(false)
  useEffect(() => {
    if (!active) {
      setLingered(false)
      return
    }
    const timer = setTimeout(() => { setLingered(true) }, delayMs)
    return () => { clearTimeout(timer) }
  }, [active, delayMs])
  return active && lingered
}

/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>
  & PropsRenderFactories

/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header. An emptied queue retains its last panel through the
 * closing transition and immediately disables interaction. Local queued submissions
 * show sending status and disabled actions until their Host queue rows arrive.
 */
export function QueueDock({ useSession, useProjection, updateQueue, notify, loadImage, renderFactorySlot, t }: QueueDockProps) {
  const inbox = useProjection('inbox') as unknown as InboxState | undefined
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  const queue = useMemo(() => {
    const rows = inbox?.['next-turn'] ?? EMPTY_QUEUE
    const inChat = new Set(pendingSubmissions.filter(item => item.placement === 'transcript').map(item => item.requestId))
    return inChat.size === 0 ? rows : rows.filter(({ source }) => (
      source.kind !== 'user' || !('rpcId' in source) || !inChat.has(source.rpcId)
    ))
  }, [inbox, pendingSubmissions])
  const pendingQueue = useMemo(() => {
    const admitted = new Set(queue.flatMap(({ source }) => (
      source.kind === 'user' && 'rpcId' in source ? [source.rpcId] : []
    )))
    return pendingSubmissions.filter(submission => (
      submission.placement === 'queued' && !admitted.has(submission.requestId)
    ))
  }, [pendingSubmissions, queue])
  const rowCount = queue.length + pendingQueue.length
  const userRows = pendingQueue.length > 0 || queue.some(({ source }) => source.kind === 'user')
  const systemRowsLinger = useLingering(rowCount > 0 && !userRows, SYSTEM_ROW_SETTLE_MS)
  const running = useSession(s => s.running)
  const queueMutable = useSession(s => s.subagent === null || s.subagent.address.mode === 'continuable')
  const [editing, setEditing] = useState<{ id: MessageId; text: string } | null>(null)
  const [busy, setBusy] = useState<MessageId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()
  const open = rowCount > 0 && (userRows || systemRowsLinger)
  const presence = usePresence(open)
  const retained = useRef<ReactNode>(null)
  // Reorder positions address the Host's whole turn queue, which can hold rows hidden from this list.
  const hostRows = inbox?.['next-turn'] ?? EMPTY_QUEUE
  const [drag, setDrag] = useState<{ id: MessageId; over: { id: MessageId; after: boolean } | null } | null>(null)
  const handles = useRef(new Map<MessageId, HTMLElement>())
  const refocus = useRef<MessageId | null>(null)

  useEffect(() => {
    if (rowCount === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!queueMutable || !queue.some(row => row.id === editing.id))) setEditing(null)
    if (drag !== null && (!queueMutable || !queue.some(row => row.id === drag.id))) setDrag(null)
  }, [collapsed, drag, editing, queue, queueMutable, rowCount])

  // A keyboard move re-orders the rows under the focused grip; put focus back on it once they settle.
  useEffect(() => {
    const id = refocus.current
    if (id === null) return
    refocus.current = null
    handles.current.get(id)?.focus()
  }, [queue])

  if (!presence.mounted) return null

  const interactionActive = queueMutable && (editing !== null || busy !== null)
  const reorderable = queueMutable && queue.length > 1
  const expanded = !collapsed || interactionActive
  const listVisible = rowCount === 1 || expanded

  const applyAction = async (
    itemId: MessageId,
    action: QueueAction,
    failure: string,
  ): Promise<boolean> => {
    setBusy(itemId)
    try {
      await updateQueue(itemId, action)
      return true
    } catch {
      notify('error', failure)
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null || editing.text.trim() === '') return
    if (await applyAction(
      editing.id,
      { kind: 'edit', content: [{ type: 'text', text: editing.text }] },
      t('queue.editFailed'),
    )) setEditing(null)
  }

  /** Put one row beside another; the Host clamps and keeps the message's identity. */
  const moveBeside = async (id: MessageId, targetId: MessageId, after: boolean): Promise<boolean> => {
    const from = hostRows.findIndex(row => row.id === id)
    const target = hostRows.findIndex(row => row.id === targetId)
    if (from < 0 || target < 0) return false
    const slot = after ? target + 1 : target
    const toIndex = slot > from ? slot - 1 : slot
    if (toIndex === from) return true
    return applyAction(id, { kind: 'move', toIndex }, t('queue.moveFailed'))
  }

  const dragOver = (id: MessageId, event: DragEvent<HTMLElement>): void => {
    if (drag === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const box = event.currentTarget.getBoundingClientRect()
    const over = id === drag.id ? null : { id, after: event.clientY > box.top + box.height / 2 }
    setDrag(current => (current === null || (current.over?.id === over?.id && current.over?.after === over?.after))
      ? current
      : { ...current, over })
  }

  const dropDragged = (event: DragEvent<HTMLElement>): void => {
    if (drag === null) return
    event.preventDefault()
    const { id, over } = drag
    setDrag(null)
    if (over !== null) void moveBeside(id, over.id, over.after)
  }

  const panel = (
    <div className={css.panel}>
      <div className={css.panelBody}>
        {rowCount > 1 && (
          <button
            type="button"
            className={css.header}
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <span className={css.lead} aria-hidden><IconQueueOutlineRegular /></span>
            <span className={css.count}>{t('queue.count', { n: rowCount })}</span>
            {!listVisible && pendingQueue.length > 0 && (
              <span className={css.status} role="status">{t('queue.sending')}</span>
            )}
            <span className={css.chevron} aria-hidden>
              {expanded ? <IconChevronDownOutlineRegular /> : <IconChevronUpOutlineRegular />}
            </span>
          </button>
        )}
        <ul id={listId} className={css.list} hidden={!listVisible}>
          {listVisible && queue.map((row, index) => {
            const attachments = queueAttachments(row.content)
            const text = textOf(row.content)
            return (
              <li
                key={row.id}
                className={[
                  css.row,
                  drag?.id === row.id ? css.dragging : '',
                  drag?.over?.id === row.id ? (drag.over.after ? css.dropAfter : css.dropBefore) : '',
                ].filter(Boolean).join(' ')}
                onDragOver={drag === null ? undefined : (event) => { dragOver(row.id, event) }}
                onDrop={drag === null ? undefined : dropDragged}
              >
                {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
                {rowCount === 1 && <span className={css.lead} aria-hidden><IconQueueOutlineRegular /></span>}
                {reorderable && editing?.id !== row.id && (row.source.kind === 'user'
                  ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className={css.handle}
                      ref={(element) => {
                        if (element === null) handles.current.delete(row.id)
                        else handles.current.set(row.id, element)
                      }}
                      draggable={busy === null}
                      aria-label={t('queue.reorder', { n: index + 1, total: queue.length })}
                      aria-disabled={busy !== null || undefined}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      title={t('queue.reorder.hint')}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(DRAG_TYPE, row.id)
                        const rowElement = event.currentTarget.closest('li')
                        if (rowElement !== null && typeof event.dataTransfer.setDragImage === 'function') {
                          event.dataTransfer.setDragImage(rowElement, 16, 18)
                        }
                        setDrag({ id: row.id, over: null })
                      }}
                      onDragEnd={() => { setDrag(null) }}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                        event.preventDefault()
                        const neighbor = queue[event.key === 'ArrowUp' ? index - 1 : index + 1]
                        if (neighbor === undefined || busy !== null) return
                        refocus.current = row.id
                        void moveBeside(row.id, neighbor.id, event.key === 'ArrowDown').then((moved) => {
                          if (!moved) refocus.current = null
                        })
                      }}
                    >
                      <GripIcon />
                    </span>
                  )
                  : <span className={css.handleSpacer} aria-hidden />)}
                {editing?.id === row.id
                  ? (
                    <InlineEditor
                      value={editing.text}
                      label={t('queue.edit')}
                      onChange={(text) => { setEditing({ id: row.id, text }) }}
                      onSave={() => { void saveEdit() }}
                      onCancel={() => { setEditing(null) }}
                    />
                  )
                  : (
                    <>
                      {attachments.length > 0 && (
                        <span className={css.attachments}>
                          {attachments.map((item, index) => item.type === 'image'
                            ? (
                              <QueueThumb
                                key={`${item.attachment.attachmentId}:${index}`}
                                attachment={item.attachment}
                                loadImage={loadImage}
                                label={t('queue.image')}
                              />
                            )
                            : (
                              <QueueFile
                                key={`${item.attachment.attachmentId}:${item.attachment.name}:${index}`}
                                attachment={item.attachment}
                                label={t('queue.file', { name: item.attachment.name })}
                              />
                            ))}
                        </span>
                      )}
                      <span className={css.preview}>{renderFactorySlot('conversation.user.text', {
                        text: row.content.filter(block => block.type === 'text').map(block => block.text).join(''),
                        facts: QUEUE_TEXT_FACTS,
                        interactive: false, ellipsis: true,
                      })}</span>
                    </>
                  )}
                {queueMutable && <div className={css.actions}>
                  {editing?.id === row.id
                    ? (
                      <>
                        <Tooltip portal label={t('queue.save')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.save')}
                            disabled={busy !== null || editing.text.trim() === ''}
                            onClick={() => { void saveEdit() }}
                          >
                            <IconCheckOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip portal label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.cancelEdit')}
                            disabled={busy !== null}
                            onClick={() => { setEditing(null) }}
                          >
                            <IconCloseOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                      </>
                    )
                    : (
                      <>
                        <Tooltip portal label={t('queue.edit')} side="bottom" delayMs={500} disabled={text === null}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.edit')}
                            // Disabled buttons fire no hover events, so the
                            // unsupported hint stays a native title.
                            title={text === null ? t('queue.edit.unsupported') : undefined}
                            disabled={busy !== null || text === null}
                            onClick={() => {
                              if (text !== null) setEditing({ id: row.id, text: text })
                            }}
                          >
                            <IconEditOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip portal label={t('queue.remove')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.remove')}
                            disabled={busy !== null}
                            onClick={() => {
                              void applyAction(
                                row.id,
                                { kind: 'remove' },
                                t('queue.removeFailed'),
                              )
                            }}
                          >
                            <IconTrashOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip portal label={t('queue.steer')} side="bottom" delayMs={500} disabled={!running}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.steer')}
                            title={running ? undefined : t('queue.steer.unavailable')}
                            disabled={busy !== null || !running}
                            onClick={() => {
                              void applyAction(
                                row.id,
                                { kind: 'steer' },
                                t('queue.steerFailed'),
                              )
                            }}
                          >
                            <IconSendOutlineRegular />
                          </button>
                        </Tooltip>
                      </>
                    )}
                </div>}
              </li>
            )
          })}
          {listVisible && pendingQueue.map((submission) => {
            return (
              <li key={submission.requestId} className={`${css.row} ${css.pendingRow}`} data-submission-echo="">
                {rowCount === 1 && <span className={css.lead} aria-hidden><IconQueueOutlineRegular /></span>}
                {submission.attachments.length > 0 && (
                  <span className={css.attachments}>
                    {submission.attachments.map((attachment, index) => attachment.type === 'image'
                      ? (
                        <img
                          key={`${attachment.value.previewUrl}:${index}`}
                          className={css.thumb}
                          src={attachment.value.previewUrl}
                          alt={t('queue.image')}
                        />
                      )
                      : (
                        <QueueFile
                          key={`${attachment.value.attachmentId}:${attachment.value.name}:${index}`}
                          attachment={attachment.value}
                          label={t('queue.file', { name: attachment.value.name })}
                        />
                      ))}
                  </span>
                )}
                <span className={css.preview}>{renderFactorySlot('conversation.user.text', {
                  text: submission.text,
                  facts: QUEUE_TEXT_FACTS,
                  interactive: false, ellipsis: true,
                })}</span>
                <span className={css.status} role="status">{t('queue.sending')}</span>
                {queueMutable && <div className={css.actions}>
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.edit')}
                    title={t('queue.sending')}
                    disabled
                  >
                    <IconEditOutlineRegular size={14} />
                  </button>
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.remove')}
                    title={t('queue.sending')}
                    disabled
                  >
                    <IconTrashOutlineRegular size={14} />
                  </button>
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.steer')}
                    title={t('queue.sending')}
                    disabled
                  >
                    <IconSendOutlineRegular />
                  </button>
                </div>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
  if (open) retained.current = panel
  return (
    <div className={css.dock} data-queue-dock="" data-state={presence.state} aria-hidden={open ? undefined : true} {...open ? {} : { inert: '' }}>
      <div className={css.clip}>
        <div className={css.surface} data-state={presence.state}>
          {open ? panel : retained.current}
        </div>
      </div>
    </div>
  )
}

/** Registers queue actions backed by the session-scoped conversation service. */
export const queueDockEntry = {
  name: 'conversation-queue-dock',
  inject: ['slots', 'conversation', 'sessions', 'uiConversation'],
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'queue',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId): QueueDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
        const conversation = actx.get('conversation')
        if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
        return {
          updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
          notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
          loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
        }
      },
    }, QueueDock))
  },
}
