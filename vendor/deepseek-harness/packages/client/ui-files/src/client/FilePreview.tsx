import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconChevronRightOutline14,
  MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import {
  formatFileCommentRange,
  normalizeFileCommentRange,
  selectionToLineRange,
  type SelectedLineRange,
} from './fileCommentAnnotations.ts'
import { installFileEditorDismissal } from './fileEditorDismissal.ts'
import { FloatingPreviewButton } from './FloatingPreviewButton.tsx'
import { fileBreadcrumbs } from './filePath.ts'
import { clampFileLine, resolveCenteredFileLineScrollTop } from './fileLineReveal.ts'
import { isMarkdownPreviewFile } from './filePreviewMode.ts'
import { FileSaveCoordinator, type FileSaveResult } from './fileSaveCoordinator.ts'
import { NS } from './locales.ts'
import type { FilesShellInjected } from './shell.ts'
import { isWorkspaceImagePreviewPath } from './workspacePreview.ts'
import { desktopFileTitle, parseDesktopFileAddress, type DesktopFileBuffer } from './desktop-files.ts'
import { SidebarFilesPanel, type SidebarFilesPanelProps } from './FilesPanel.tsx'
import type { DesktopFileStateInjected } from './desktop-file-state.ts'
import css from './FilePreview.module.css'

/** Everything the editor reads: its file identity, buffer, IPC, and copy. */
export interface FilePreviewProps extends PropsLocale<typeof NS>, FilesShellInjected {
  sessionId: string | undefined
  useSessions: UseSessions
  relativePath: string
  revealLine?: number | undefined
  revealRequestId?: number | undefined
  active: boolean
  onDirtyChange: (dirty: boolean) => void
  readBuffer: () => DesktopFileBuffer | undefined
  writeBuffer: (buffer: DesktopFileBuffer | null) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
  /** Workspace root override for a caller that owns the file's Session (the Sidebar adapter). */
  workspaceCwd?: string | undefined
}

/** Props the Sidebar adapter needs from its tab plus the shared shell face. */
export type SidebarFilePreviewProps =
  & UseSidebarRightTabInfoProps
  & SidebarFilesPanelProps
  & DesktopFileStateInjected

/** The one framework seat the adapter needs from the keyed tab slot. */
type UseSidebarRightTabInfoProps = { useTabInfo: () => { readonly tab: SidebarTabRecord } }
type SidebarTabRecord = Pick<ReturnType<UseSidebarRightTabInfo>['tab'], 'id' | 'contentId' | 'visible'> & {
  readonly navigation: Pick<ReturnType<UseSidebarRightTabInfo>['tab']['navigation'], 'params' | 'revision'>
}

/** Live title projection also covers empty viewer records restored from older layouts. */
export function SidebarFileTitle({ useTabInfo, t }: Pick<SidebarFilePreviewProps, 'useTabInfo' | 't'>): ReactNode {
  return desktopFileTitle(useTabInfo().tab.contentId, t)
}

const RENDER_MARKDOWN_KEY = 'dshd.renderMarkdown'
const FILE_WORD_WRAP_KEY = 'dshd.fileWordWrap'
const FILE_SAVE_DEBOUNCE_MS = 500
function currentCwd(sessionId: string | undefined, useSessions: FilePreviewProps['useSessions']): string | undefined {
  return useSessions((s) => {
    if (sessionId !== undefined) return sessionWorkingDirectory(s.byId[sessionId as SessionId])
    const id = Object.values(s.byId)
      .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
    const next = id === undefined ? undefined : sessionWorkingDirectory(s.byId[id])
    return next ? next : undefined
  })
}

/**
 * Adapt one Sidebar file tab to the existing editor.
 *
 * The editor's implementation is unchanged: this only translates the tab's
 * stable address into the session/relative-path pair it already consumes and
 * binds that tab's draft slot.
 * @param props - live tab information, shell face, and copy.
 * @returns the editable file viewer.
 */
export function SidebarFilePreview(props: SidebarFilePreviewProps): ReactNode {
  const {
    useTabInfo, useSessions, listDir, readFile, readFileMedia, mentionFile, writeFile,
    listEditors, openInEditor, showItemInFolder, openWithSystemDefault, appendComposerText,
    readFileBuffer, writeFileBuffer, registerFileSave, t,
  } = props
  const { tab } = useTabInfo()
  const parsed = parseDesktopFileAddress(tab.contentId)
  const sessionId = parsed?.sessionId
  const relativePath = parsed?.path
  const revealLine = typeof tab.navigation.params === 'object'
    && 'line' in tab.navigation.params
    && typeof tab.navigation.params.line === 'number'
    ? tab.navigation.params.line
    : undefined
  const workspaceCwd = useSessions(state => sessionId === undefined
    ? undefined
    : sessionWorkingDirectory(state.byId[sessionId as SessionId]))
  const address = tab.contentId
  // Earlier guide entries persisted a page address for this resource viewer.
  // Reuse the directory body without changing its layout or reading that URI.
  if (relativePath === undefined) return <SidebarFilesPanel {...props} />
  return (
    <FilePreview
      key={address}
      useSessions={useSessions}
      sessionId={sessionId}
      relativePath={relativePath}
      revealLine={revealLine}
      revealRequestId={tab.navigation.revision}
      active={tab.visible}
      workspaceCwd={workspaceCwd}
      onDirtyChange={() => {}}
      readBuffer={() => readFileBuffer(address)}
      writeBuffer={(buffer: DesktopFileBuffer | null) => { writeFileBuffer(address, buffer) }}
      registerSave={(save) => { registerFileSave(tab.id, address, save) }}
      listDir={listDir}
      readFile={readFile}
      readFileMedia={readFileMedia}
      mentionFile={mentionFile}
      writeFile={writeFile}
      listEditors={listEditors}
      openInEditor={openInEditor}
      showItemInFolder={showItemInFolder}
      openWithSystemDefault={openWithSystemDefault}
      appendComposerText={appendComposerText}
      t={t}
    />
  )
}

function fileName(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash < 0 ? relativePath : relativePath.slice(slash + 1)
}

function basenameOf(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/')
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  const slash = trimmed.lastIndexOf('/')
  return slash < 0 ? trimmed : trimmed.slice(slash + 1)
}

/**
 * @param key - localStorage flag stored as `'1'` / `'0'`.
 * @returns true only when the stored value is `'1'`; missing or unreadable is false.
 */
function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/**
 * Persist a boolean flag as `'1'` / `'0'`.
 * @param key - localStorage key.
 * @param value - stored preference.
 */
function writeStoredFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Quota / private mode: the in-memory toggle still applies this session.
  }
}

/**
 * Format a selected line span as the composer payload for 「添加到对话」.
 * @param relativePath - workspace-relative path, backtick-wrapped in the header.
 * @param startLine - inclusive 1-based first line.
 * @param endLine - inclusive 1-based last line.
 * @param contents - full editor text; whole lines in the span are fenced as `text`.
 * @returns header plus a `text` fence of the selected lines.
 */
function formatFileCommentComposerText(
  relativePath: string,
  startLine: number,
  endLine: number,
  contents: string,
): string {
  const selectedLines = contents.split('\n').slice(startLine - 1, endLine).join('\n')
  const header = `${formatFileCommentRange(startLine, endLine)} \`${relativePath}\``
  return `${header}\n\n\`\`\`text\n${selectedLines}\n\`\`\``
}

/**
 * Single-file occupant of `surfaces.file`. Clean text that is not truncated can
 * be edited and saved through desktop `writeFile`. Draft changes debounce 500ms
 * through `FileSaveCoordinator`; persist rereads first and refuses once when
 * disk diverged from both the remembered baseline and the draft (`error.changed`
 * still wins: persist returns `{ ok: false }` and pending stays). Explicit Save /
 * Ctrl+S / `registerSave` flush through the same coordinator queue, so a
 * debounce write and an explicit save never interleave, and characters typed
 * while a save is in flight stay dirty. The occupant rereads disk
 * when `active` becomes true. A dirty draft stays in the editor (Markdown Source
 * included) when the last reread failed, returned truncated or binary bytes, or
 * ran without a cwd; Save writes whenever cwd exists. A successful write clears
 * truncated/binary so the editor remains. Ctrl/Cmd+S saves only while this tab
 * is active. The surfaces shell persists dirty buffers across reload. Markdown
 * Source/Rendered defaults to Source via `dshd.renderMarkdown`. Jump-to-line
 * (`revealLine` / `revealRequestId`) scrolls the source textarea and shows
 * source while that reveal is pending. A non-collapsed textarea selection
 * shows 「添加到对话」; that control appends an `L` range plus a `text` fence
 * through `appendComposerText`. Outside click and Escape dismiss the selection.
 * @param props - session-maybe seats, relativePath owner, read/write IPC, and copy.
 * @returns the preview panel.
 */
export function FilePreview({
  sessionId,
  useSessions,
  relativePath,
  revealLine,
  revealRequestId,
  active,
  onDirtyChange,
  readBuffer,
  writeBuffer,
  registerSave,
  readFile,
  readFileMedia,
  writeFile,
  appendComposerText,
  workspaceCwd,
  t,
}: FilePreviewProps): ReactNode {
  const selectedCwd = currentCwd(sessionId, useSessions)
  const cwd = workspaceCwd ?? selectedCwd
  const isImage = isWorkspaceImagePreviewPath(relativePath)
  const isMarkdown = isMarkdownPreviewFile(relativePath)
  const floatingPreviewAddress = sessionId === undefined
    ? undefined
    : sessionFileAddress(sessionId, relativePath)
  const sessions = useSessions(state => state)
  const projectName = cwd === undefined ? '' : basenameOf(cwd)
  const crumbs = fileBreadcrumbs(projectName, relativePath)
  const seed = readBuffer()
  const [text, setText] = useState<string>(() => seed?.text ?? '')
  const [draft, setDraft] = useState<string>(() => seed?.draft ?? '')
  const [media, setMedia] = useState<{ mime: string; base64: string } | null>(null)
  const [binary, setBinary] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [renderMarkdown, setRenderMarkdown] = useState(() => readStoredFlag(RENDER_MARKDOWN_KEY))
  const [wordWrap, setWordWrap] = useState(() => readStoredFlag(FILE_WORD_WRAP_KEY))
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(null)
  const [saved, setSaved] = useState(false)
  const [ready, setReady] = useState(seed !== undefined)
  const loadedRef = useRef(seed !== undefined)
  const textRef = useRef(seed?.text ?? '')
  const draftRef = useRef(seed?.draft ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const handledRevealRequestIdRef = useRef<number | null>(null)
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null)
  textRef.current = text
  draftRef.current = draft

  const readBufferRef = useRef(readBuffer)
  readBufferRef.current = readBuffer
  const writeBufferRef = useRef(writeBuffer)
  writeBufferRef.current = writeBuffer
  const readFileRef = useRef(readFile)
  readFileRef.current = readFile
  const writeFileRef = useRef(writeFile)
  writeFileRef.current = writeFile
  const tRef = useRef(t)
  tRef.current = t
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  useEffect(() => {
    if (cwd === undefined) {
      setError(t('empty.cwd'))
      setSaveError(null)
      // Keep text/draft: a transient missing cwd must not wipe unsaved edits.
      return
    }
    if (!active && loadedRef.current) return
    let cancelled = false
    const markReady = (): void => {
      loadedRef.current = true
      setReady(true)
    }
    const applyError = (message: string): void => {
      const remembered = readBufferRef.current()
      setError(message)
      setSaveError(null)
      setMedia(null)
      if (remembered !== undefined && remembered.draft !== remembered.text) {
        setText(remembered.text)
        setDraft(remembered.draft)
        markReady()
        return
      }
      if (draftRef.current !== textRef.current) {
        markReady()
        return
      }
      setText('')
      setDraft('')
      writeBufferRef.current(null)
      markReady()
    }
    if (isImage) {
      void readFileMedia(cwd, relativePath).then((result) => {
        if (cancelled) return
        if (!result.ok || result.mime === undefined || result.base64 === undefined) {
          applyError(result.message ?? t('error.read'))
          return
        }
        setError(null)
        setSaveError(null)
        setBinary(false)
        setTruncated(result.truncated === true)
        setMedia({ mime: result.mime, base64: result.base64 })
        setText('')
        setDraft('')
        writeBufferRef.current(null)
        markReady()
      }).catch(() => {
        if (!cancelled) applyError(t('error.read'))
      })
    } else {
      void readFile(cwd, relativePath).then((result) => {
        if (cancelled) return
        if (!result.ok) {
          applyError(result.message ?? t('error.read'))
          return
        }
        setError(null)
        setSaveError(null)
        setBinary(result.binary === true)
        setTruncated(result.truncated === true)
        const next = result.text ?? ''
        const remembered = readBufferRef.current()
        const localDirty = draftRef.current !== textRef.current
        if (localDirty) {
          setText(next)
          setDraft(draftRef.current)
          writeBufferRef.current({ text: next, draft: draftRef.current })
        } else if (remembered !== undefined && remembered.draft !== remembered.text) {
          setText(next)
          setDraft(remembered.draft)
          writeBufferRef.current({ text: next, draft: remembered.draft })
        } else if (remembered !== undefined && remembered.text === next) {
          setText(remembered.text)
          setDraft(remembered.draft)
        } else {
          setText(next)
          setDraft(next)
          writeBufferRef.current({ text: next, draft: next })
        }
        setMedia(null)
        setSaved(false)
        markReady()
      }).catch(() => {
        if (!cancelled) applyError(t('error.read'))
      })
    }
    return () => { cancelled = true }
  }, [cwd, relativePath, readFile, readFileMedia, t, isImage, active])

  const editable = ready && error === null && !isImage && !binary && !truncated
  // Dirty tracks buffer divergence even when cwd/error/truncated/binary block a
  // clean preview, so tab-close confirm still runs and Save/Source stay reachable.
  const dirty = !isImage && draft !== text
  const canSave = cwd !== undefined && dirty
  const showEditor = ready && !isImage && (dirty || editable)
  const revealActive = typeof revealLine === 'number' && typeof revealRequestId === 'number'
  const revealHandled = handledReveal?.path === relativePath && handledReveal.requestId === revealRequestId
  const showRenderedMarkdown = isMarkdown && renderMarkdown && !(revealActive && !revealHandled)
  const codeLabels = { copyLabel: t('preview.copy'), copiedLabel: t('preview.copied') }

  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  useEffect(() => {
    onDirtyChangeRef.current(dirty)
  }, [dirty])
  useEffect(() => () => { onDirtyChangeRef.current(false) }, [])

  useEffect(() => {
    if (!loadedRef.current) return
    if (isImage) return
    writeBufferRef.current({ text, draft })
  }, [isImage, text, draft])

  useEffect(() => {
    handledRevealRequestIdRef.current = null
  }, [relativePath])

  useEffect(() => {
    if (typeof revealLine !== 'number' || typeof revealRequestId !== 'number') return
    if (handledRevealRequestIdRef.current === revealRequestId) return
    if (!ready) return
    const textarea = textareaRef.current
    if (textarea === null) return
    const line = clampFileLine(draft, revealLine)
    const rect = textarea.getBoundingClientRect()
    const parsed = Number.parseFloat(window.getComputedStyle(textarea).lineHeight)
    const lineHeight = Number.isFinite(parsed) && parsed > 0 ? parsed : 20
    textarea.scrollTop = resolveCenteredFileLineScrollTop({
      scrollTop: textarea.scrollTop,
      scrollHeight: textarea.scrollHeight,
      viewportTop: rect.top,
      viewportHeight: textarea.clientHeight,
      fileTop: 0,
      estimatedLine: { top: (line - 1) * lineHeight, height: lineHeight },
    })
    handledRevealRequestIdRef.current = revealRequestId
  }, [ready, draft, revealLine, revealRequestId, showRenderedMarkdown])

  const persistContents = async (
    persistCwd: string | undefined,
    persistPath: string,
    contents: string,
    isCurrent: () => boolean,
  ): Promise<FileSaveResult> => {
    if (persistCwd === undefined) return { ok: false }
    try {
      const latest = await readFileRef.current(persistCwd, persistPath)
      if (!isCurrent()) return { ok: false }
      if (
        latest.ok
        && latest.binary !== true
        && latest.truncated !== true
        && typeof latest.text === 'string'
        && latest.text !== textRef.current
        && latest.text !== contents
      ) {
        setText(latest.text)
        writeBufferRef.current({ text: latest.text, draft: draftRef.current })
        setSaveError(tRef.current('error.changed'))
        return { ok: false }
      }
      const result = await writeFileRef.current(persistCwd, persistPath, contents)
      if (!isCurrent()) return { ok: result.ok }
      if (!result.ok) {
        setSaveError(result.message ?? tRef.current('error.write'))
        return { ok: false }
      }
      setSaveError(null)
      setError(null)
      setTruncated(false)
      setBinary(false)
      return { ok: true }
    } catch {
      if (isCurrent()) setSaveError(tRef.current('error.write'))
      return { ok: false }
    }
  }

  const persistContentsRef = useRef(persistContents)
  persistContentsRef.current = persistContents

  // Unmount/Discard must not flush. Hook destroy runs in declaration order, so
  // this empty-deps cleanup runs before dispose; relativePath change skips it.
  useEffect(() => () => {
    persistContentsRef.current = () => Promise.resolve({ ok: false })
  }, [])

  const coordinatorRef = useRef<FileSaveCoordinator | null>(null)
  useEffect(() => {
    const persistPath = relativePath
    let disposed = false
    const coordinator = new FileSaveCoordinator({
      debounceMs: FILE_SAVE_DEBOUNCE_MS,
      persist: contents => persistContentsRef.current(cwdRef.current, persistPath, contents, () => !disposed),
      onPendingChange: () => {},
      onConfirmed: (contents) => {
        if (disposed) return
        setText(contents)
        writeBufferRef.current({ text: contents, draft: draftRef.current })
      },
    })
    coordinatorRef.current = coordinator
    return () => {
      disposed = true
      coordinator.dispose()
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null
    }
  }, [relativePath])

  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
  const save = async (): Promise<boolean> => {
    if (cwd === undefined || !dirty) return false
    // Snapshot the draft before any await: characters typed while the write is
    // in flight must stay dirty instead of being marked saved. The coordinator
    // queue also serializes this write with the 500ms debounce persist, and
    // onConfirmed records the exact written contents as the new baseline.
    const contents = draftRef.current
    const coordinator = coordinatorRef.current
    /* v8 ignore next -- the coordinator effect runs before any save trigger can fire. */
    if (coordinator === null) return false
    const ok = await coordinator.flush(contents)
    if (!ok) return false
    setSaved(true)
    window.setTimeout(() => { setSaved(false) }, 1200)
    return true
  }
  saveRef.current = save

  useEffect(() => {
    registerSave(() => saveRef.current())
    return () => { registerSave(null) }
  }, [registerSave])

  useEffect(() => {
    if (!active || !canSave) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void saveRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [active, canSave])

  useEffect(() => {
    const root = rootRef.current
    const editor = textareaRef.current
    if (root === null || editor === null) return
    return installFileEditorDismissal({
      root,
      editor,
      isBlocked: () => false,
      onDismiss: () => { setSelectedLineRange(null) },
    })
  }, [showEditor, showRenderedMarkdown])

  const applyDraft = (next: string): void => {
    setDraft(next)
    writeBufferRef.current({ text: textRef.current, draft: next })
    coordinatorRef.current?.change(next)
  }

  const syncTextareaSelection = (textarea: HTMLTextAreaElement): void => {
    if (textarea.selectionStart === textarea.selectionEnd) {
      setSelectedLineRange(null)
      return
    }
    setSelectedLineRange(
      selectionToLineRange(textarea.value, textarea.selectionStart, textarea.selectionEnd),
    )
  }

  const addSelectionToChat = (range: SelectedLineRange): void => {
    /* v8 ignore next -- optional inject / session-maybe; production apply always binds it. */
    if (appendComposerText === undefined || sessionId === undefined) return
    const { startLine, endLine } = normalizeFileCommentRange(range)
    appendComposerText(
      sessionId,
      formatFileCommentComposerText(relativePath, startLine, endLine, draftRef.current),
    )
  }

  return (
    <div ref={rootRef} className={css.root} data-file-preview>
      <div className={css.toolbar}>
        <p className={css.crumbs} data-file-breadcrumbs>
          {crumbs.map((crumb, index) => (
            <span key={crumb.path || 'project'} className={css.crumb}>
              {index > 0 ? <IconChevronRightOutline14 className={css.crumbSep} /> : null}
              <span
                className={clsx(css.crumbLabel, crumb.kind === 'file' && css.crumbFile)}
                title={crumb.path || projectName}
              >
                {crumb.label}
              </span>
            </span>
          ))}
        </p>
        {isMarkdown && (editable || dirty) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = !showRenderedMarkdown
              setRenderMarkdown(next)
              writeStoredFlag(RENDER_MARKDOWN_KEY, next)
              if (typeof revealRequestId !== 'number') return
              setHandledReveal(next ? { path: relativePath, requestId: revealRequestId } : null)
            }}
          >
            {showRenderedMarkdown ? t('preview.source') : t('preview.render')}
          </Button>
        ) : null}
        {editable || dirty ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={wordWrap}
            aria-label={t('preview.wrap')}
            onClick={() => {
              setWordWrap((open) => {
                const next = !open
                writeStoredFlag(FILE_WORD_WRAP_KEY, next)
                return next
              })
            }}
          >
            {t('preview.wrap')}
          </Button>
        ) : null}
        {floatingPreviewAddress === undefined ? null : (
          <FloatingPreviewButton
            resourceAddress={floatingPreviewAddress}
            sessions={sessions}
            t={t}
          />
        )}
        {selectedLineRange !== null && showEditor && !showRenderedMarkdown ? (
          <Tooltip label={t('preview.comment')} side="bottom">
            <Button
              variant="ghost"
              size="sm"
              onMouseDown={(event) => { event.preventDefault() }}
              onClick={() => { addSelectionToChat(selectedLineRange) }}
            >
              {t('preview.comment')}
            </Button>
          </Tooltip>
        ) : null}
        {editable || dirty ? (
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            onClick={() => { void save() }}
          >
            {saved ? t('preview.saved') : t('preview.save')}
          </Button>
        ) : null}
      </div>
      <div className={clsx(css.body, showEditor && !showRenderedMarkdown && css.editorBody)}>
        {saveError !== null ? (
          <p className={css.saveError} role="alert">{saveError}</p>
        ) : null}
        {error !== null ? (
          <p className={css.message}>{error}</p>
        ) : null}
        {media !== null ? (
          // A truncated image payload is not decodable; show the notice alone
          // instead of a broken <img>.
          truncated ? (
            <p className={css.message}>{t('preview.truncated')}</p>
          ) : (
            <img
              className={css.image}
              alt={fileName(relativePath)}
              src={`data:${media.mime};base64,${media.base64}`}
            />
          )
        ) : binary && !dirty ? (
          <p className={css.message}>{t('preview.binary')}</p>
        ) : !ready ? (
          null
        ) : showEditor ? (
          <>
            {truncated ? <p className={css.message}>{t('preview.truncated')}</p> : null}
            {binary ? <p className={css.message}>{t('preview.binary')}</p> : null}
            {isMarkdown && showRenderedMarkdown ? (
              <MarkdownText
                text={draft}
                labels={{ code: codeLabels, footnotes: t('preview.footnotes') }}
              />
            ) : (
              <textarea
                ref={textareaRef}
                className={clsx(css.editor, wordWrap && css.wrap)}
                value={draft}
                aria-label={relativePath}
                onChange={(event) => { applyDraft(event.target.value) }}
                onSelect={(event) => { syncTextareaSelection(event.currentTarget) }}
              />
            )}
          </>
        ) : truncated ? (
          <>
            <p className={css.message}>{t('preview.truncated')}</p>
            {isMarkdown ? (
              <MarkdownText
                text={text}
                labels={{ code: codeLabels, footnotes: t('preview.footnotes') }}
              />
            ) : (
              <pre className={css.code}>{text}</pre>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
