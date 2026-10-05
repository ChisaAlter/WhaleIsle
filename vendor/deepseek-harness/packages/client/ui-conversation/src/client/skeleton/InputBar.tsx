/** The default composer body: the 'conversation.composer.bar' slot entry.
 * Machine state arrives through the standard provide channel
 * (useInput + inputActions); the keyboard/DOM command face and stop arrive
 * through this entry's own inject, whose hooks compartment binds
 * useNotices/useLexicon/useComposerBeam/useComposerResize; layout-phase inputs
 * (variant, placeholder, region-slot content) ride the owner props. Session
 * facts (running/removed/promptError) are self-selected via useSession.
 *
 * The text surface is the shell-owned Lexical editor bound here through
 * DraftEditor; chips render as decorator portals, and the
 * keymap registers submit/menu/paste gestures on the editor command layer.
 * The no-session state renders the SAME div inert as the Workspace-picker
 * trigger instead of a parallel tree.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import clsx from 'clsx'
import {
  IconCloseOutline16, IconPlusOutline16, IconWarningOutline16, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the `plan` projection key merge (the TodoDock posture — the
// composer reads a host-computed value; the domain owns the key).
import type {} from '@deepseek-ai/dsh-plan-mode/client'
// Type-only: the `goal` projection key merge (hint disambiguation).
import type {} from '@deepseek-ai/dsh-goal/client'
// The `imageLimits` projection key merge (intake pre-check) arrives with the
// wire types: apiproxy's sessions contract declares it, and client-runtime's
// api-remotes import already places it in every client program.
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import { ComposerBeam } from '../ComposerBeam.tsx'
import { TypingFxLayer } from '../TypingFxLayer.tsx'
import { DraftEditor } from '../input/editor/DraftEditor.tsx'
import {
  focusDraftEditor, installDraftFilePicker, installDraftKeymap, installDraftWheel,
  keepDraftFocus, revealDraftSelection,
} from '../input/editor/view-binding.ts'
import { resolveSubmitMode } from '../input/submission-policy.ts'
import { resolveTypingFxColors } from '../../submission-settings.ts'
import { attachmentErrorText, imageSizeText } from '../image-labels.ts'
import { ContextMeter } from './ContextMeter.tsx'
import { ComposerResizeHandles, useComposerResizeDrag } from './ComposerResizeHandles.tsx'
import css from './InputBar.module.css'

/** File-tree drag payload; kept local so this plugin does not import ui-files. */
const COMPOSER_MENTION_DRAG_TYPE = 'application/x-dshd-composer-mention'

export type InputBarProps = ComposerBarProps

export const InputBar = memo(function InputBar({
  useSession, useSessions, useInput, inputActions, keyboard, addFiles, removeAttachment, resolveDraftAttachments,
  retryFileUpload,
  toggleCommandMenu, stop, t,
  renderSlot, useBusyEnter, useFileUploads, useNotices, useLexicon, useMenuLauncher, useStopShortcut,
  useComposerBeam, useComposerBeamStyle, useComposerResize, useComposerResizeHeight, useComposerResizeWidth,
  useTypingFx, useTypingFxStyle,
  setComposerResizeSize,
  useProjection, sessionId, variant, disabled: inert = false, blocked,
  workspacePickerOpen = false, onRequestWorkspace,
  placeholder, accessory,
}: InputBarProps) {
  const input = useInput(s => s)
  const notice = useNotices(s => s)
  const busyEnter = useBusyEnter(s => s)
  const stopKeys = useStopShortcut(keys => keys)
  void useLexicon // hook seat stays bound by the inject compartment; text-ref decoration rides the shell's editor transforms
  const commandMenuOpen = useMenuLauncher(source => source === 'command')
  const composerBeam = useComposerBeam(value => value)
  const composerBeamStyle = useComposerBeamStyle(value => value)
  const composerResize = useComposerResize(value => value)
  const composerResizeHeight = useComposerResizeHeight(value => value)
  const composerResizeWidth = useComposerResizeWidth(value => value)
  const typingFx = useTypingFx(value => value)
  const typingFxStyle = useTypingFxStyle(value => value)
  // Scheme text stop recolors the whole composer input through a CSS var;
  // theme (null) leaves the token fallback untouched.
  const typingFxTextColor = typingFx ? resolveTypingFxColors(typingFxStyle.colors).text : null
  const sessionRow = useSessions(s => (sessionId === undefined ? undefined : s.byId[sessionId])) as
    { presentation?: { composer?: 'managed' } } | undefined
  const managed = sessionRow?.presentation?.composer === 'managed'
  const promptError = useSession(s => s.promptError) ?? null
  const running = useSession(s => s.running) ?? false
  const subagent = useSession(s => s.subagent) ?? null
  const removed = useSession(s => s.removed) ?? false
  // Plan mode swaps the composer placeholder (the projection is the folded
  // host value; owner-prop placeholders — hero, session-unavailable — win).
  const planActive = useProjection('plan', plan => plan !== undefined && (plan.pending ? !plan.active : plan.active))
  // Absent (undefined: no frame yet) and cleared (null) both mean no goal.
  const hasGoal = useProjection('goal', goal => goal != null)
  // Session-maybe: the machine faces are absent together while no session is
  // current; the bar renders the same DOM inert instead of a parallel tree.
  const live = input !== undefined && keyboard !== undefined && inputActions !== undefined
  const draft = input?.draft ?? ''
  const edit = input?.edit ?? null
  const editor = keyboard?.editor ?? null
  const attachments = useMemo(
    () => input === undefined || resolveDraftAttachments === undefined ? [] : resolveDraftAttachments(input.attachmentIds),
    [resolveDraftAttachments, input?.attachmentIds],
  )
  const empty = draft.trim() === '' && attachments.length === 0
  const uploads = useFileUploads(snapshot => snapshot)
  // Send waits for every picked file: uploading and failed drafts both hold
  // the gate (a failed upload is retried or removed, never silently dropped).
  const uploadsPending = attachments.some(
    attachment => attachment.kind === 'file' && uploads[attachment.id]?.status !== 'ready',
  )
  const uploadsFailed = attachments.some(
    attachment => attachment.kind === 'file' && uploads[attachment.id]?.status === 'error',
  )
  // Transient error banner (machine notices, image-intake rejections, and
  // prompt failures): the seq keys the Toast so an identical repeated message
  // restarts the hold-then-fade cycle instead of reusing the faded one.
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])
  const dismissToast = useCallback(() => { setToast(null) }, [])
  // The deployment's image-intake limits (absent while no attachment service
  // is composed — the pre-check below then defers entirely to the host).
  const imageLimits = useProjection('imageLimits')
  // Prompt failures are ordinary failures (no create/attach transaction exists
  // anymore): the toast announces promptError, the draft stays in the machine,
  // and the user resubmits. A remount over a session whose machine still holds
  // an unresolved promptError deliberately re-announces it once — the failure
  // is still pending, and a transient banner is its only surface. Attachment
  // rejections show product copy keyed by the wire reason — whichever domain
  // refused them. Writer contention has localized recovery guidance; other
  // failures retain the diagnostic message and code.
  useEffect(() => {
    if (promptError === null) return
    const { error } = promptError
    if (error.code === 'session/writer-held') {
      showToast(t('error.sessionInUse'))
      return
    }
    showToast(error.code === 'session/attachment-invalid' || error.code === 'subagent/attachment-invalid'
      ? attachmentErrorText(t, error.details.reason, imageLimits)
      : `${error.message} (${error.code})`)
  }, [promptError, showToast, t, imageLimits])
  useEffect(() => {
    if (notice?.level === 'error') showToast(notice.text)
  }, [notice, showToast])
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // A continuable child without its live parent cannot accept human input,
  // but its independent Stop below stays available while it runs.
  const continuable = subagent?.address.mode === 'continuable'
  const parentOffline = continuable && subagent.parentAvailable !== true
  // Running input stays free; locked = session removed, the
  // inert no-workspace state, the machine faces absent (no session), or a
  // parent-offline continuable child. An owner block also disables input;
  // adjudicating and submitting render read-only so the draft stays visible.
  const disabled = removed || inert || !live || blocked !== undefined || parentOffline
  const locked = disabled
  // The model seat is the ONE control a block leaves live: every block this
  // contract has is cleared by choosing a model, so locking it too would leave
  // the composer asking for the only thing it prevents. The other reasons to
  // be disabled do lock it — there is no session to choose a model for.
  const modelSeatLocked = removed || inert || !live
  const machineBusy = input?.phase === 'adjudicating' || input?.phase === 'submitting'
  // The no-workspace surface remains the resident DOM node but acts as the
  // existing picker trigger. Message controls stay locked until a Session
  // exists; the trigger itself is read-only rather than disabled so pointer
  // and keyboard users can reach the recovery action.
  const workspaceTrigger = inert && !removed && onRequestWorkspace !== undefined
  const editorDisabled = removed || (locked && !workspaceTrigger)
  const editable = live && !locked && !machineBusy
  const { onResizePointerDown, onResizePointerMove, onResizePointerUp }
    = useComposerResizeDrag(
      composerResize,
      cardRef,
      scrollRef,
      { height: composerResizeHeight, width: composerResizeWidth },
      setComposerResizeSize,
    )
  // Traveling border beam while a turn is in flight: send, think, and stream.
  const beamLive = !workspaceTrigger && (machineBusy || running)
  const showBeam = beamLive && composerBeam
  const steeringAvailable = subagent === null || subagent.address.mode === 'continuable'
  const canSteerQueue = !locked && !machineBusy && !commandMenuOpen && empty && running && steeringAvailable
    && input.queue.length > 0

  useEffect(() => {
    if (input === undefined || inputActions === undefined) return
    if (attachments.length !== input.attachmentIds.length) {
      inputActions.pruneAttachments(attachments.map(attachment => attachment.id))
    }
  }, [attachments, input?.attachmentIds, inputActions])

  // Scroll the draft scrollport the minimum that brings the selection focus
  // into view — the browser's own behavior for typing, performed for the
  // paths where it does not act (programmatic focus with preventScroll, and
  // session switches that land the caret off screen). The live DOM selection
  // is the ruler; no mirror layer exists to consult.
  const revealSelection = (): void => {
    revealDraftSelection(scrollRef)
  }

  // Unlock (mount / session switch) returns focus to the box, and owns the
  // reveal that comes with it. Lexical's focus() suppresses the browser's
  // scroll walk (preventScroll inside), so the reveal in our own scrollport
  // is ours to perform — switching to a longer draft otherwise leaves the
  // caret (restored at the draft's end) off screen.
  useEffect(() => {
    if (locked || editor === null) return
    focusDraftEditor(editor, revealSelection)
  }, [locked, sessionId, editor])

  // A persisted draft arrives AFTER the unlock effect: DefaultConversationViews
  // adopts it in its own mount effect, and a parent's mount effect runs after
  // its children's. Reveal when the draft becomes non-empty so a restored long
  // draft does not stay at its head with the caret at its end. This effect does
  // not focus: send-clear, failed-send restore, and first-character transitions
  // must not steal focus from another control the user moved to.
  useEffect(() => {
    if (locked || draft === '') return
    revealSelection()
  }, [draft !== ''])

  // Wheel chaining on the draft scrollport, one lifetime (it is never
  // unmounted — the inert state renders the same element disabled). While the
  // capped box can still move in this direction, keep the native scroll; only
  // at its own edge forward the delta to the active conversation scrollport, so
  // a short draft never traps the gesture and a long draft stays scrollable.
  // Hero mounts have no host and keep native wheel scrolling.
  useEffect(() => {
    return installDraftWheel(scrollRef)
  }, [])

  // Intake pre-check: an addition that would break a projected image limit is
  // refused as a whole batch, announced immediately, and never enters the
  // rail. Only the image subset is limit-checked: generic files carry no
  // client-side size or count limit and upload as soon as they are picked.
  // The host enforces the same image limits at submit for callers that bypass
  // this composer.
  const intakeFiles = useCallback((files: readonly File[], directories?: ReadonlySet<File>): void => {
    if (subagent !== null || addFiles === undefined) return
    const rejected = directories === undefined ? [] : [...directories]
    const accepted = directories === undefined ? files : files.filter(file => !directories.has(file))
    // One toast slot: collect every refusal from this batch into a single
    // announcement so a mixed folder + refused-file drop loses neither.
    const notices: string[] = []
    if (rejected.length > 0) {
      const first = rejected[0]
      notices.push(rejected.length === 1 && first !== undefined
        ? t('file.directoryRejected', { name: first.name || t('file.label') })
        : t('file.directoriesRejected', { count: rejected.length }))
    }
    if (accepted.length > 0) {
      const refused = ((): string | null => {
        if (imageLimits !== undefined) {
          const mediaTypes = imageLimits.mediaTypes as readonly string[]
          const images = accepted.filter(file => mediaTypes.includes(file.type))
          const imageAttachments = attachments.filter(attachment => attachment.kind === 'image')
          if (imageAttachments.length + images.length > imageLimits.maxImagesPerMessage) {
            return t('image.tooMany', { count: imageLimits.maxImagesPerMessage })
          }
          if (images.some(file => file.size > imageLimits.maxImageBytes)) {
            return t('image.fileTooLarge', { size: imageSizeText(imageLimits.maxImageBytes) })
          }
          const total = imageAttachments.reduce((sum, attachment) => sum + attachment.file.size, 0)
            + images.reduce((sum, file) => sum + file.size, 0)
          if (total > imageLimits.maxMessageImageBytes) {
            return t('image.totalTooLarge', { size: imageSizeText(imageLimits.maxMessageImageBytes) })
          }
        }
        return addFiles(accepted)
      })()
      if (refused !== null) notices.push(refused)
    }
    if (notices.length > 0) showToast(notices.join('\n'))
  }, [subagent, addFiles, attachments, imageLimits, showToast, t])

  const canAcceptDrop = subagent === null && !locked && !machineBusy && addFiles !== undefined

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onPickFiles = (e: ChangeEvent<HTMLInputElement>): void => {
    const picked = e.target.files === null ? [] : [...e.target.files]
    // Reset so picking the same file again re-fires the change event.
    e.target.value = ''
    if (picked.length > 0) intakeFiles(picked)
  }

  // File-image drops live on `conversation.input.attachments`. Mention payloads
  // (`application/x-dshd-composer-mention`) are claimed here so a file-tree
  // drag inserts into the draft instead of falling through as native text.
  useEffect(() => {
    const hasMention = (event: globalThis.DragEvent): boolean =>
      event.dataTransfer?.types.includes(COMPOSER_MENTION_DRAG_TYPE) ?? false
    const onDragOver = (event: globalThis.DragEvent): void => {
      if (!hasMention(event)) return
      event.preventDefault()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      if (!hasMention(event)) return
      event.preventDefault()
      const mention = event.dataTransfer?.getData(COMPOSER_MENTION_DRAG_TYPE) ?? ''
      if (mention.length === 0 || keyboard === undefined) return
      const current = keyboard.snapshot.draft
      keyboard.paste(current.length === 0 ? mention : ` ${mention}`)
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [keyboard])

  // The keymap handlers read live bar state through this ref so the editor
  // registration survives re-renders without re-arming per keystroke.
  const gate = useRef({
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles, uploadsPending, uploadsFailed, showToast, t, canAcceptDrop,
  })
  gate.current = {
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles, uploadsPending, uploadsFailed, showToast, t, canAcceptDrop,
  }

  useEffect(() => {
    if (keyboard === undefined) return
    return installDraftFilePicker(keyboard, gate, fileInputRef)
  }, [keyboard])

  useEffect(() => {
    if (editor === null || keyboard === undefined) return
    return installDraftKeymap(editor, keyboard, gate)
  }, [editor, keyboard])

  // Button presses steal focus from the editor; suppress at mousedown so
  // typing continues seamlessly. Lexical's focus() carries preventScroll and
  // restores the previous selection, so no reveal is needed: the caret has
  // not moved, and the next keystroke gets the browser's native one.
  const keepFocus = (e: MouseEvent<HTMLButtonElement>): void => {
    keepDraftFocus(e, editor)
  }

  const onToggleCommandMenu = (): void => {
    if (keyboard === undefined) return
    // The menu is a combobox over the editor, so the keyboard has to be there
    // before the launcher opens it: activating the button from the keyboard
    // leaves focus on the button, and restoring it afterwards would re-track an
    // empty draft and close the menu again.
    if (editor !== null) focusDraftEditor(editor, revealSelection)
    toggleCommandMenu?.(keyboard.caretSpan())
  }

  // The no-session Workspace trigger: the resident editable div acts as the
  // picker trigger for keyboard users (no editor is bound in this state).
  const onWorkspaceKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!workspaceTrigger) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRequestWorkspace()
    }
  }

  // An ordinary running session keeps Stop while the composer is empty or
  // owner-blocked; an actionable draft gets the busy Send action, delivered
  // through the same mode plain Enter resolves to. The label names that mode
  // only when the click would deliver a plain message right now — an enabled
  // button (no pending upload) over a non-empty draft that is neither a
  // claimed command nor a `/` line headed for adjudication — so it never
  // describes a delivery the click cannot or does not perform; every other
  // state keeps plain Send. A continuable child keeps Send primary and
  // exposes Stop independently.
  const primaryStops = running && subagent === null && (empty || blocked !== undefined)
  // Disabled native buttons may omit mouseleave; their tooltip must close from state.
  const primaryDisabled = primaryStops ? stop === undefined : empty || disabled || machineBusy || uploadsPending
  const interruptible = running && continuable
  const primarySubmitMode = resolveSubmitMode(busyEnter, running, 'enter', steeringAvailable)
  const plainMessageDraft = !empty && input?.phase === 'plain' && !draft.trimStart().startsWith('/')
  const primaryLabel = primaryStops
    ? t('input.stop')
    : running && steeringAvailable && !disabled && !uploadsPending && plainMessageDraft
      ? t(primarySubmitMode === 'steer' ? 'input.send.steer' : 'input.send.queue')
      : t('input.send')
  const onPrimary = (): void => {
    if (primaryStops) {
      stop?.()
      return
    }
    if (keyboard === undefined) return // absent machine: the button is disabled
    /* v8 ignore next -- defensive: the primary button is disabled for empty, disabled, and pending-upload states. */
    if (!empty && !disabled && !machineBusy && !uploadsPending) keyboard.submit(primarySubmitMode, 'click')
  }

  // Claim ghost hint: rendered by CSS as generated content after the last
  // paragraph while the claim's args are blank (a hint implies a single-line
  // token draft). The translated per-command hint wins over the claim's own.
  const claimActive = (input?.phase === 'claimed' || input?.phase === 'submitting')
    && input.claim !== undefined && draft.startsWith(input.claim.token)
  const rawHint = claimActive && input.claim.hint !== undefined
    && draft.slice(input.claim.token.length).trim() === ''
    ? input.claim.hint
    : null
  const hint = ((): string | null => {
    if (rawHint === null) return null
    const commandName = input?.claim?.name ?? ''
    const hintKey = `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}`
    // Dynamic lookup by claimed command name: unknown commands miss the
    // dictionary and keep the machine's own hint, so the call is wide.
    const translated = (t as Translate)(hintKey)
    return translated !== hintKey ? translated : rawHint
  })()

  const placeholderText = placeholder ?? (parentOffline
    ? t('placeholder.parentOffline')
    : disabled
      ? t('placeholder.unavailable')
      : managed
        ? t('placeholder.managed')
      // The steer hint deliberately outranks the plan placeholder:
      // while it shows, the whole-queue gesture is genuinely available
      // (the gate never consults plan mode), so the actionable hint wins.
        : canSteerQueue
          ? t('placeholder.steerQueue')
          : planActive ? t('placeholder.plan') : t('placeholder.default'))

  const inputVars: Record<string, string> = {}
  if (typingFxTextColor !== null) inputVars['--dsh-typing-fx-text-color'] = typingFxTextColor
  const inputStyle = Object.keys(inputVars).length === 0 ? undefined : inputVars as CSSProperties

  return (
    <div className={clsx(css.root, variant === 'hero' && css.hero)}>
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={cardRef.current}
          onDone={dismissToast}
        />
      )}
      {notice?.level === 'info' && (
        <div className={css.notice} role="status">
          {notice.text}
        </div>
      )}
      {/* Trigger clicks land on the card, not the editor: the toolbar row's
          disabled controls swallow clicks otherwise (the CSS state disarms
          their pointer events), so the WHOLE capsule is the pick target.
          pointerdown stops here so the Menu's outside-close cannot race the
          click's reopen (close-then-open flickers the chip's open echo). */}
      <div
        ref={cardRef}
        className={clsx(
          css.card,
          workspaceTrigger && css.cardWorkspaceTrigger,
        )}
        data-composer-card
        data-beam={showBeam || undefined}
        onClick={workspaceTrigger ? onRequestWorkspace : undefined}
        onPointerDown={workspaceTrigger ? (e) => { e.stopPropagation() } : undefined}
      >
        {composerResize && !workspaceTrigger && (
          <ComposerResizeHandles
            t={t}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
        )}
        {/* One unfiltered wrapper owns pointer-events:none. Chromium compositor
            hit-testing ignores that declaration on the filtered bloom child, so
            a sibling wrapper is what keeps the toolbar reachable while the
            send/think beam is live. */}
        <ComposerBeam active={showBeam} appearance={composerBeamStyle} />
        <div className={css.cardBody}>
          {sessionId !== undefined && (
            <div className={css.overlayAnchor}>{renderSlot('conversation.input.overlay', {})}</div>
          )}
          {accessory !== undefined && <div className={css.accessory}>{accessory}</div>}
          {edit !== null && (
            <div className={css.editRow} role="status" data-edit-session>
              <span className={css.editLabel}>{edit.label}</span>
              <Tooltip label={t('input.editCancel')} side="top" delayMs={500}>
                <button
                  type="button"
                  className={css.editCancel}
                  aria-label={t('input.editCancel')}
                  aria-keyshortcuts="Escape"
                  disabled={machineBusy}
                  onMouseDown={keepFocus}
                  onClick={() => keyboard?.cancelEdit()}
                >
                  <IconCloseOutline16 size={14} />
                </button>
              </Tooltip>
            </div>
          )}
          {renderSlot('conversation.input.attachments', {
            attachments,
            canAcceptDrop,
            onAddFiles: intakeFiles,
            onRemoveAttachment: (id) => { removeAttachment?.(id) },
            uploads,
            onRetryFile: (id) => { retryFileUpload?.(id) },
            dropLimits: imageLimits === undefined ? undefined : {
              count: imageLimits.maxImagesPerMessage,
              size: imageSizeText(imageLimits.maxImageBytes),
            },
          })}
          {/* One scrollport, one text surface: the contenteditable grows with
            its content and .scroll — capped at 14 lines in CSS — is the only
            thing that scrolls. Chips are decorator portals inside the same
            surface, so wrapping, caret geometry, and scrolling are the
            browser's own. */}
          <DraftEditor
            classNames={css}
            editor={editor}
            scrollRef={scrollRef}
            editable={editable}
            editorDisabled={editorDisabled}
            phase={input?.phase ?? 'inert'}
            placeholderText={placeholderText}
            ariaLabel={workspaceTrigger ? t('hero.chooseWorkspace') : placeholderText}
            workspaceTrigger={workspaceTrigger}
            workspacePickerOpen={workspacePickerOpen}
            onWorkspaceKeyDown={onWorkspaceKeyDown}
            hint={hint}
            showPlaceholder={draft === '' && attachments.length === 0 && !claimActive}
            inputStyle={inputStyle}
            typingFxCaret={typingFx && typingFxStyle.cursor !== 'native' ? typingFxStyle.cursor : undefined}
            layers={(
              <TypingFxLayer
                editor={workspaceTrigger ? null : editor}
                enabled={typingFx}
                style={typingFxStyle}
              />
            )}
          />
          <div className={css.row}>
            <div className={css.tools}>
              <Tooltip label={t('input.commands')} side="top" delayMs={500}>
                <button
                  type="button"
                  className={css.add}
                  aria-label={t('input.commands')}
                  aria-haspopup="listbox"
                  aria-expanded={commandMenuOpen}
                  disabled={locked || toggleCommandMenu === undefined}
                  onMouseDown={keepFocus}
                  onClick={onToggleCommandMenu}
                >
                  <IconPlusOutline16 size={14} />
                </button>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                disabled={subagent !== null}
                hidden
                onChange={onPickFiles}
              />
              <div className={css.modes}>
                {managed || sessionId === undefined
                  ? null
                  : renderSlot('conversation.input.permission', { locked })}
                {!managed && (sessionId === undefined ? null : renderSlot('conversation.input.plan', { locked }))}
              </div>
              {input === undefined || sessionId === undefined
                ? null
                : renderSlot('conversation.input.left', {})}
            </div>
            <div className={css.trailing}>
              {input === undefined || sessionId === undefined
                ? null
                : renderSlot('conversation.input.right', {})}
              {managed
                ? (sessionId === undefined ? null : renderSlot('conversation.input.managed', { locked: modelSeatLocked }))
                : (sessionId === undefined ? null : renderSlot('conversation.input.model', { locked: modelSeatLocked }))}
              {interruptible && (
                <Tooltip label={t('input.stop')} shortcutKeys={stopKeys} side="top" delayMs={500} disabled={stop === undefined}>
                  <button
                    type="button"
                    className={css.primary}
                    aria-label={t('input.stop')}
                    disabled={stop === undefined}
                    onMouseDown={keepFocus}
                    onClick={stop}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip label={primaryStops ? t('input.stop') : primaryLabel} shortcutKeys={primaryStops ? stopKeys : undefined} side="top" delayMs={500} disabled={primaryDisabled}>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={primaryLabel}
                  disabled={primaryDisabled}
                  onMouseDown={keepFocus}
                  onClick={onPrimary}
                >
                  {primaryStops ? (
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                      <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
                    </svg>
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
      <div className={css.dock} data-composer-dock data-composer-footer={variant === 'composer' && !managed ? '' : undefined}>
        {variant === 'composer' && input !== undefined && sessionId !== undefined
          ? managed ? null : renderSlot('conversation.composer.dock', {})
          : null}
        {managed ? null : <ContextMeter useProjection={useProjection} t={t} />}
      </div>
    </div>
  )
})
