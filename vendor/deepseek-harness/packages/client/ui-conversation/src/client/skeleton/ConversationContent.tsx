import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { ConversationContentProps, ConversationViewsProps, InputZone } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

function ConversationSessionView({ renderSlot }: ConversationViewsProps) {
  return renderSlot('conversation.session', {})
}

function NoConversationWidthControls() {
  return null
}

/**
 * Render the shared Conversation body and its occurrence-selected local Components.
 * @param props - Factory input, standard Session sources, and Conversation seats.
 * @returns the Conversation view, Composer, and optional width controls.
 */
export function ConversationContent(props: ConversationContentProps) {
  const {
    sessionId, phase, hero, useSession, useSessions, useConversation, useSessionStatus,
    useWorkspaces, useInput, useComposerBlock, renderSlot, renderSlotChain,
    selectWorkspace, selectNoDirectory, t, useFactorySlot,
  } = props
  const session = useSession(snapshot => snapshot)
  const conversation = useConversation(snapshot => snapshot)
  const shellPhase = session === undefined || conversation === undefined
    ? 'blank'
    : conversationPhase(session, conversation)
  const presentationOwned = useSessions(s =>
    sessionId !== undefined && s.byId[sessionId]?.presentation !== undefined,
  )
  const Views = useFactorySlot('views', ConversationSessionView)
  const WidthControls = useFactorySlot('widthControls', NoConversationWidthControls)
  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const pendingInteraction = useSessionStatus(snapshot =>
    sessionId === undefined ? undefined : snapshot.get(sessionId)?.pendingInteraction)
  const inputState = useInput(s => s)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const [pendingNoDirectory, setPendingNoDirectory] = useState(false)
  const pickerAnchor = useRef<HTMLButtonElement>(null)

  // Publishes the two live measurements floating View chrome reads off the
  // scroll body: the seat's height as --dsh-composer-height, so controls clear
  // the composer as it grows, and the scrollport's own height as
  // --dsh-conversation-viewport-height, so a control can sit in the band the
  // seat leaves visible. Callback ref, not an effect; stable identity prevents
  // observer churn while the first blank session fills the resident body
  // outlet.
  const seatCleanup = useRef<(() => void) | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatCleanup.current?.()
    seatCleanup.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    const publishSize = () => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
      scroller.style.setProperty(
        '--dsh-conversation-viewport-height',
        `${scroller.clientHeight}px`,
      )
    }
    const observer = new ResizeObserver(publishSize)
    observer.observe(seat)
    observer.observe(scroller)
    publishSize()

    // A viewport-positioned child does not participate in its DOM parent's
    // native wheel chain. Preserve footer scrolling, while answer fields and
    // takeover bodies retain their own scroll until they reach a boundary.
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.shiftKey || event.deltaY === 0
        || getComputedStyle(seat).position !== 'absolute') return
      let target = event.target instanceof Element ? event.target : null
      while (target !== null && target !== seat) {
        if (target instanceof HTMLElement) {
          const style = getComputedStyle(target)
          if (/^(auto|scroll)$/.test(style.overflowY)) {
            const floor = target.scrollHeight - target.clientHeight
            if ((event.deltaY < 0 && target.scrollTop > 0)
              || (event.deltaY > 0 && target.scrollTop < floor)
              || style.overscrollBehaviorY === 'contain' || style.overscrollBehaviorY === 'none') return
          }
        }
        target = target.parentElement
      }
      const lineHeight = Number.parseFloat(getComputedStyle(scroller).lineHeight) || 24
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? lineHeight : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1)
      scroller.scrollBy({ top: delta })
      event.preventDefault()
    }
    seat.addEventListener('wheel', onWheel, { passive: false })
    seatCleanup.current = () => {
      observer.disconnect()
      seat.removeEventListener('wheel', onWheel)
    }
  }, [])

  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )
  // A no-directory task is a Session living in the Host scratch cwd with no
  // Workspace membership. Membership alone is not enough: a blank Session
  // whose Workspace was deleted from the sidebar is also unaccounted, and that
  // one must fall back to "Choose workspace", never unlock the composer.
  const noDirectorySession = sessionId !== undefined
    && !presentationOwned
    && workspaces.phase === 'ready'
    && sessionWorkspace === undefined
    && workspaces.scratchCwd !== undefined
    && cwd === workspaces.scratchCwd

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

  useEffect(() => {
    if (pendingNoDirectory && noDirectorySession) setPendingNoDirectory(false)
  }, [pendingNoDirectory, noDirectorySession])

  const stackRef = useRef<HTMLDivElement>(null)
  const previousComposer = useRef<{ sessionId: typeof sessionId; hero: boolean; top: number } | null>(null)
  useLayoutEffect(() => {
    const previous = previousComposer.current
    if (!hero && (previous?.hero !== true || previous.sessionId !== sessionId || !session?.promptAttempted)) {
      previousComposer.current = null
      return
    }
    const stack = stackRef.current
    const card = stack?.querySelector<HTMLElement>('[data-composer-card]')
    if (stack === null || card === undefined || card === null) return
    const top = card.getBoundingClientRect().top
    if (!hero && previous !== null) {
      let offset = previous.top - top
      stack.style.setProperty('--dsh-composer-enter-offset', `${offset}px`)
      stack.dataset.composerEntering = ''
      // The glide starts paused: the first-send commit mounts the transcript,
      // running chrome, and dock projections on the same frames a layout-
      // driven `top` animation would lose to that work. The card holds at the
      // draft position until the churn is quiet (or the cap passes); measured
      // drift meanwhile folds back into the offset so the hold stays exact.
      const holdTop = previous.top
      // jsdom leaves matchMedia unimplemented; the DOM type claims it always exists.
      const media = globalThis as { matchMedia?: (query: string) => MediaQueryList }
      const motionless = media.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      const quietMs = motionless ? 0 : 80
      const capMs = motionless ? 0 : 450
      let live = true
      let quietTimer: number | undefined
      const pin = () => {
        if (!live) return
        if (stack.dataset.composerEntering === undefined) {
          teardown()
          return
        }
        const drift = card.getBoundingClientRect().top - holdTop
        if (Math.abs(drift) > 0.5) {
          offset -= drift
          stack.style.setProperty('--dsh-composer-enter-offset', `${offset}px`)
        }
      }
      const rearm = () => {
        clearTimeout(quietTimer)
        quietTimer = setTimeout(start, quietMs)
      }
      const signal = () => {
        pin()
        if (live) rearm()
      }
      const onMutations = (records: MutationRecord[]) => {
        pin()
        // Text edits (the reply streaming in, typing into the live editor)
        // are light enough to paint through; only structural churn extends
        // the hold.
        if (live && records.some(record => record.type !== 'characterData'
          && !(record.type === 'attributes' && record.target === stack && record.attributeName === 'style'))) {
          rearm()
        }
      }
      const mutations = new MutationObserver(onMutations)
      const resizes = new ResizeObserver(signal)
      const scroller = stack.closest('[data-conversation-scroll]')
      const teardown = () => {
        live = false
        mutations.disconnect()
        resizes.disconnect()
        clearTimeout(quietTimer)
        scroller?.removeEventListener('scroll', signal)
      }
      const start = () => {
        const entering = stack.dataset.composerEntering !== undefined
        teardown()
        clearTimeout(capTimer)
        if (entering) stack.style.setProperty('animation-play-state', 'running')
      }
      const capTimer = setTimeout(start, capMs)
      mutations.observe(scroller ?? stack, { attributes: true, characterData: true, childList: true, subtree: true })
      resizes.observe(stack)
      if (scroller !== null) {
        resizes.observe(scroller)
        scroller.addEventListener('scroll', signal)
      }
      quietTimer = setTimeout(start, quietMs)
    }
    previousComposer.current = { sessionId, hero, top }
  })
  useLayoutEffect(() => {
    const stack = stackRef.current
    if (stack === null) return
    const finish = () => {
      delete stack.dataset.composerEntering
      stack.style.removeProperty('--dsh-composer-enter-offset')
      stack.style.removeProperty('animation-play-state')
    }
    const onEnd = (event: AnimationEvent) => {
      if (event.target === stack) finish()
    }
    stack.addEventListener('animationend', onEnd)
    stack.addEventListener('animationcancel', onEnd)
    // Keep the starting rectangle current through window and draft resizing.
    const observer = hero ? new ResizeObserver(() => {
      const card = stack.querySelector<HTMLElement>('[data-composer-card]')
      if (card !== null) previousComposer.current = { sessionId, hero, top: card.getBoundingClientRect().top }
    }) : null
    if (observer !== null) {
      observer.observe(stack)
      const scroller = stack.closest('[data-conversation-scroll]')
      if (scroller !== null) observer.observe(scroller)
    }
    return () => {
      observer?.disconnect()
      stack.removeEventListener('animationend', onEnd)
      stack.removeEventListener('animationcancel', onEnd)
      finish()
    }
  }, [hero, sessionId])

  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (pending) → its title;
  //   2. a just-picked or landed no-directory session → "No workspace folder"
  //      (membership + scratch cwd, never the scratch directory's basename);
  //   3. cold start, no session yet → placeholder ("Choose workspace");
  //   4. the blank session's workspace is in the list → its title;
  //   5. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   6. list ready but no owning workspace (deleted from the sidebar) →
  //      placeholder, never the deleted folder's name via cwd.
  const noDirectoryTitle = pendingNoDirectory || noDirectorySession ? t('hero.noDirectory') : undefined
  // A title still automatic reads in the reader's language, matching the
  // sidebar row the same Workspace has there.
  const storedChipTitle = pendingWorkspace?.title
    ?? noDirectoryTitle
    ?? (sessionId === undefined
      ? undefined
      : sessionWorkspace?.title
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? undefined
          : workspaceLabel(cwd)))
  const chipTitle = storedChipTitle === undefined
    ? undefined
    : workspaceDisplayTitle(storedChipTitle, t('workspace.defaultName'))

  // Building the row eagerly would still fire the workspace-picker slot for a
  // presentation-owned session, so the JSX only exists while the hero shows.
  const heroWorkspaceRow = !hero ? null : (
    <div className={css.heroWorkspaceRow}>
      <WorkspaceChip
        buttonRef={pickerAnchor}
        label={chipTitle}
        menuOpen={pickerOpen}
        onClick={() => { setPickerOpen(open => !open) }}
        t={t}
      />
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        noDirectorySelected: pendingWorkspaceId === undefined && (pendingNoDirectory || noDirectorySession),
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingNoDirectory(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onPickNoDirectory: () => {
          setPickerOpen(false)
          setPendingWorkspaceId(undefined)
          setPendingNoDirectory(true)
          void selectNoDirectory().catch(() => { setPendingNoDirectory(false) })
        },
        onClose: () => { setPickerOpen(false) },
      })}
      {renderSlot('conversation.hero.agentPreset', {})}
    </div>
  )

  // The placeholder chip ("Choose workspace") and the Workspace-trigger input travel
  // together: no workspace picked yet (cold start, no session at all), or a
  // blank session whose workspace vanished (deleted from the sidebar). The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: t('placeholder.hero') } : {}),
  })

  const composerBar = (
    <div ref={stackRef} className={clsx(css.composerStack, hero && css.composerHero)}>
      {hero && <HeroShell t={t} renderSlot={renderSlot} />}
      {heroWorkspaceRow}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
    </div>
  )

  const composer = renderSlotChain(
    'conversation.composer',
    { sessionId, session, pendingInteraction },
    { fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true },
  )

  // The viewport anchor wraps the whole chain output: overlay:true keeps
  // the hidden fallback and elected takeover as siblings in the same seat.
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="" data-conversation-region="composer">
      {composer}
    </div>
  )

  return (
    <div
      ref={setBody}
      className={clsx(css.body, props.variant === 'embedded' && css.embeddedBody)}
      data-conversation-content=""
      data-conversation-session={sessionId}
      data-conversation-region="chat"
      data-content-phase={phase}
    >
      <div className={css.scrollBody} data-conversation-scroll="">
        {presentationOwned && shellPhase === 'blank' && (
          <div className={css.viewArea} data-plugin-session-canvas="" aria-hidden="true" />
        )}
        {sessionId === undefined ? null : <Views />}
        {composerSeat}
      </div>
      <WidthControls container={body} phase={phase} />
    </div>
  )
}
