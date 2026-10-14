/**
 * Composer submission policy. It owns the live busy-Enter preference and
 * resolves submission gestures into queue/steer delivery modes; Host and
 * Agent keep the actual delivery-window authority.
 */
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'
import {
  BUSY_ENTER_FIELD, COMPOSER_BEAM_FIELD, COMPOSER_BEAM_PRESETS_FIELD, COMPOSER_BEAM_STYLE_FIELD,
  COMPOSER_RESIZE_FIELD,
  COMPOSER_RESIZE_HEIGHT_FIELD, COMPOSER_RESIZE_WIDTH_FIELD,
  CUSTOM_INSTRUCTIONS_FIELD,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM, DEFAULT_COMPOSER_BEAM_PRESETS, DEFAULT_COMPOSER_BEAM_STYLE,
  DEFAULT_COMPOSER_RESIZE,
  DEFAULT_COMPOSER_RESIZE_HEIGHT, DEFAULT_COMPOSER_RESIZE_WIDTH,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_NEXT_PROMPT,
  DEFAULT_OFFICIAL_PEAK_VALLEY, DEFAULT_SESSION_COST, DEFAULT_SESSION_COST_PRICES,
  DEFAULT_STATS_LINE, DEFAULT_TYPING_FX, DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE, DEFAULT_VIEW_TABS,
  normalizeComposerBeamPresets, normalizeComposerBeamStyle,
  normalizeTypingFxPresets, normalizeTypingFxStyle,
  NEXT_PROMPT_FIELD,
  OFFICIAL_PEAK_VALLEY_FIELD, SESSION_COST_FIELD, SESSION_COST_PRICES_FIELD,
  STATS_LINE_FIELD, TYPING_FX_FIELD, TYPING_FX_PRESETS_FIELD, TYPING_FX_STYLE_FIELD, VIEW_TABS_FIELD,
} from '../../submission-settings.ts'
import type {
  ComposerBeamPresets, ComposerBeamStyle, ConversationSettings, SessionCostPrices,
  TypingFxPresets, TypingFxStyle,
} from '../../submission-settings.ts'

export {
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM, DEFAULT_COMPOSER_BEAM_PRESETS, DEFAULT_COMPOSER_BEAM_STYLE,
  DEFAULT_COMPOSER_RESIZE,
  DEFAULT_COMPOSER_RESIZE_HEIGHT, DEFAULT_COMPOSER_RESIZE_WIDTH,
  DEFAULT_NEXT_PROMPT,
  DEFAULT_OFFICIAL_PEAK_VALLEY, DEFAULT_SESSION_COST, DEFAULT_SESSION_COST_PRICES,
  DEFAULT_STATS_LINE, DEFAULT_TYPING_FX, DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE, DEFAULT_VIEW_TABS,
} from '../../submission-settings.ts'
export type { SessionCostModelPrice, SessionCostPrices } from '../../submission-settings.ts'
export type { TypingFxPresets, TypingFxStyle } from '../../submission-settings.ts'
export { normalizeComposerBeamPresets, normalizeComposerBeamStyle } from '../../submission-settings.ts'
export { normalizeTypingFxPresets, normalizeTypingFxStyle } from '../../submission-settings.ts'
export { CUSTOM_INSTRUCTIONS_MAX_LENGTH } from '../../submission-settings.ts'

/** Delay between the last keystroke and the durable custom-instructions write. */
const CUSTOM_INSTRUCTIONS_WRITE_DELAY = 400

const sameBeamStyle = (left: ComposerBeamStyle, right: ComposerBeamStyle): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const sameBeamPresets = (left: ComposerBeamPresets, right: ComposerBeamPresets): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const sameTypingFxStyle = (left: TypingFxStyle, right: TypingFxStyle): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const sameTypingFxPresets = (left: TypingFxPresets, right: TypingFxPresets): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

/** Last drag-committed composer box size (null = that axis is not customized). */
export interface ComposerResizeSize {
  height: number | null
  width: number | null
}

/**
 * Resolve one submission gesture against the busy-Enter preference. Plain
 * Enter and the primary Send button share the `enter` gesture, so the button
 * delivers exactly what Enter would. Direct `steer` is intentionally
 * best-effort: AgentLoop turns a closed-window submission into the next waking
 * Queue item.
 * @param preferred - the live busy-Enter preference.
 * @param running - whether the addressed agent currently reports busy.
 * @param gesture - plain Enter (or the Send button) or the Cmd/Ctrl-accelerated chord.
 * @param steeringAvailable - whether this session transport supports steering.
 * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
 */
export function resolveSubmitMode(
  preferred: BusyEnterBehavior,
  running: boolean,
  gesture: ComposerSubmitGesture,
  steeringAvailable: boolean,
): InputSubmitMode {
  if (!running || !steeringAvailable) return 'queue'
  if (gesture === 'enter') return preferred
  return preferred === 'queue' ? 'steer' : 'queue'
}

type DockPreferenceField = typeof STATS_LINE_FIELD | typeof SESSION_COST_FIELD | typeof OFFICIAL_PEAK_VALLEY_FIELD
  | typeof NEXT_PROMPT_FIELD
interface DockPreferenceWrite {
  readonly value: boolean
  accepted: boolean
}

/**
 * Busy-Enter preference shared by the composer bar inject face and its
 * Settings row: one live store the bar's submission gestures and Send label
 * read, backed by the Host user-settings document when one is composed.
 */
export class ComposerSubmissionPolicy {
  /** Reactive preference source for the composer bar and the Settings row. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR)
  /** Reactive composer-beam source for the Settings row and InputBar. */
  readonly composerBeam: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_COMPOSER_BEAM)
  /** Reactive beam-style source shared by Settings and every InputBar. */
  readonly composerBeamStyle: SnapshotStore<ComposerBeamStyle> = createSnapshotStore(DEFAULT_COMPOSER_BEAM_STYLE)
  /** Reactive user-preset source shared by the beam Settings modal. */
  readonly composerBeamPresets: SnapshotStore<ComposerBeamPresets> = createSnapshotStore(DEFAULT_COMPOSER_BEAM_PRESETS)
  /** Reactive composer drag-resize source for the Settings row and InputBar. */
  readonly composerResize: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_COMPOSER_RESIZE)
  /** Reactive last-dragged scrollport height for InputBar / ApprovalPanel remounts. */
  readonly composerResizeHeight: SnapshotStore<number | null> = createSnapshotStore(DEFAULT_COMPOSER_RESIZE_HEIGHT)
  /** Reactive last-dragged card width for InputBar / ApprovalPanel remounts. */
  readonly composerResizeWidth: SnapshotStore<number | null> = createSnapshotStore(DEFAULT_COMPOSER_RESIZE_WIDTH)
  /** Reactive stats-strip source for the Settings row and StatsLine. */
  readonly statsLine: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_STATS_LINE)
  /** Reactive official peak/valley source for the Settings row and PeakValleyRow. */
  readonly officialPeakValley: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_OFFICIAL_PEAK_VALLEY)
  /** Reactive session-cost source for the Settings row and the composer-dock cost figure. */
  readonly sessionCost: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_SESSION_COST)
  /** Reactive per-model custom peak prices for the price panel and the cost figure. */
  readonly sessionCostPrices: SnapshotStore<SessionCostPrices> = createSnapshotStore(DEFAULT_SESSION_COST_PRICES)
  /** Reactive view-tablist source for the Settings row and ConversationSessionHeader. */
  readonly viewTabs: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_VIEW_TABS)
  /** Reactive next-prompt preference shared by the Settings row and InputBar. */
  readonly nextPrompt: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_NEXT_PROMPT)
  /** Reactive custom-instructions source for the General Settings row. */
  readonly customInstructions: SnapshotStore<string> = createSnapshotStore(DEFAULT_CUSTOM_INSTRUCTIONS)
  /** Reactive typing-effect source for the Appearance row and every InputBar. */
  readonly typingFx: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_TYPING_FX)
  /** Reactive typing-style source shared by the Settings modal and every InputBar. */
  readonly typingFxStyle: SnapshotStore<TypingFxStyle> = createSnapshotStore(DEFAULT_TYPING_FX_STYLE)
  /** Reactive user-preset source shared by the typing-fx Settings modal. */
  readonly typingFxPresets: SnapshotStore<TypingFxPresets> = createSnapshotStore(DEFAULT_TYPING_FX_PRESETS)
  /** Host writability for the Interface Switch; true when no scope is bound. */
  readonly writable: SnapshotStore<boolean>
  private readonly host: ConfigForm<ConversationSettings> | undefined
  private readonly unsubscribe: (() => void) | undefined
  /** Text queued for or crossing the wire; adoptions leave it alone so keystrokes are never reverted. */
  private pendingCustomInstructions: string | undefined
  private customInstructionsTimer: ReturnType<typeof setTimeout> | undefined
  private readonly dockPreferenceWrites = new Map<DockPreferenceField, DockPreferenceWrite>()
  private disposed = false

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: ConfigForm<ConversationSettings>) {
    this.host = host
    this.writable = createSnapshotStore(host === undefined)
    if (host !== undefined) {
      this.unsubscribe = host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  dispose(): void {
    this.disposed = true
    this.dockPreferenceWrites.clear()
    this.unsubscribe?.()
    if (this.customInstructionsTimer !== undefined) clearTimeout(this.customInstructionsTimer)
  }

  /**
   * Change the busy-state submission behavior; the live value publishes
   * before the durable write starts.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    void this.host?.set(BUSY_ENTER_FIELD, behavior)
  }

  /**
   * Change whether the composer plays the send/think border beam; the live
   * value publishes before the durable write starts.
   * @param value - true paints `.cardBeam`; false suppresses it.
   */
  setComposerBeam(value: boolean): void {
    if (this.composerBeam.getSnapshot() === value) return
    this.composerBeam.set(value)
    void this.host?.set(COMPOSER_BEAM_FIELD, value)
  }

  /** Persist visual tuning for the running composer beam. */
  setComposerBeamStyle(value: ComposerBeamStyle): void {
    const next = normalizeComposerBeamStyle(value)
    if (sameBeamStyle(this.composerBeamStyle.getSnapshot(), next)) return
    this.composerBeamStyle.set(next)
    void this.host?.set(COMPOSER_BEAM_STYLE_FIELD, next)
  }

  /** Persist the active beam profile and its preset library as one namespace mutation. */
  async setComposerBeamConfiguration(value: ComposerBeamStyle, presets: ComposerBeamPresets): Promise<void> {
    const nextStyle = normalizeComposerBeamStyle(value)
    const nextPresets = normalizeComposerBeamPresets(presets)
    const styleChanged = !sameBeamStyle(this.composerBeamStyle.getSnapshot(), nextStyle)
    const presetsChanged = !sameBeamPresets(this.composerBeamPresets.getSnapshot(), nextPresets)
    if (!styleChanged && !presetsChanged) return
    if (this.host !== undefined && !this.host.getSnapshot().writable) {
      throw new Error('composer-beam settings are not writable')
    }
    this.composerBeamStyle.set(nextStyle)
    this.composerBeamPresets.set(nextPresets)
    if (this.host === undefined) return
    const ops: SettingsPathOpView[] = [
      { op: 'set', path: [COMPOSER_BEAM_STYLE_FIELD], value: nextStyle as unknown as JsonValue },
      { op: 'set', path: [COMPOSER_BEAM_PRESETS_FIELD], value: nextPresets as unknown as JsonValue },
    ]
    await this.host.mutate(ops, this.host.getSnapshot().revision)
    const accepted = this.host.getSnapshot().value
    if (accepted === undefined
      || !sameBeamStyle(normalizeComposerBeamStyle(accepted.composerBeamStyle), nextStyle)
      || !sameBeamPresets(normalizeComposerBeamPresets(accepted.composerBeamPresets), nextPresets)) {
      throw new Error('composer-beam settings were rejected by the Host')
    }
  }

  /**
   * Edit the standing custom instructions; the live value publishes
   * immediately while the durable write debounces the keystroke stream.
   * @param text - the full replacement text.
   */
  setCustomInstructions(text: string): void {
    if (this.customInstructions.getSnapshot() === text) return
    this.customInstructions.set(text)
    this.queueCustomInstructionsWrite(text)
  }

  private queueCustomInstructionsWrite(text: string): void {
    this.pendingCustomInstructions = text
    if (this.customInstructionsTimer !== undefined) clearTimeout(this.customInstructionsTimer)
    const host = this.host
    this.customInstructionsTimer = setTimeout(() => {
      this.customInstructionsTimer = undefined
      if (host === undefined) {
        this.pendingCustomInstructions = undefined
        return
      }
      const settle = (): void => {
        if (this.pendingCustomInstructions === text) this.pendingCustomInstructions = undefined
      }
      void host.set(CUSTOM_INSTRUCTIONS_FIELD, text).then(settle, settle)
    }, CUSTOM_INSTRUCTIONS_WRITE_DELAY)
  }

  /**
   * Change whether the composer plays typing echoes and a custom caret; the
   * live value publishes before the durable write starts.
   * @param value - true activates the overlay; false removes it entirely.
   */
  setTypingFx(value: boolean): void {
    if (this.typingFx.getSnapshot() === value) return
    this.typingFx.set(value)
    void this.host?.set(TYPING_FX_FIELD, value)
  }

  /** Persist visual tuning for the composer typing effect. */
  setTypingFxStyle(value: TypingFxStyle): void {
    const next = normalizeTypingFxStyle(value)
    if (sameTypingFxStyle(this.typingFxStyle.getSnapshot(), next)) return
    this.typingFxStyle.set(next)
    void this.host?.set(TYPING_FX_STYLE_FIELD, next)
  }

  /** Persist the active typing-fx profile and its preset library as one namespace mutation. */
  async setTypingFxConfiguration(value: TypingFxStyle, presets: TypingFxPresets): Promise<void> {
    const nextStyle = normalizeTypingFxStyle(value)
    const nextPresets = normalizeTypingFxPresets(presets)
    const styleChanged = !sameTypingFxStyle(this.typingFxStyle.getSnapshot(), nextStyle)
    const presetsChanged = !sameTypingFxPresets(this.typingFxPresets.getSnapshot(), nextPresets)
    if (!styleChanged && !presetsChanged) return
    if (this.host !== undefined && !this.host.getSnapshot().writable) {
      throw new Error('typing-fx settings are not writable')
    }
    this.typingFxStyle.set(nextStyle)
    this.typingFxPresets.set(nextPresets)
    if (this.host === undefined) return
    const ops: SettingsPathOpView[] = [
      { op: 'set', path: [TYPING_FX_STYLE_FIELD], value: nextStyle as unknown as JsonValue },
      { op: 'set', path: [TYPING_FX_PRESETS_FIELD], value: nextPresets as unknown as JsonValue },
    ]
    await this.host.mutate(ops, this.host.getSnapshot().revision)
    const accepted = this.host.getSnapshot().value
    if (accepted === undefined
      || !sameTypingFxStyle(normalizeTypingFxStyle(accepted.typingFxStyle), nextStyle)
      || !sameTypingFxPresets(normalizeTypingFxPresets(accepted.typingFxPresets), nextPresets)) {
      throw new Error('typing-fx settings were rejected by the Host')
    }
  }

  /**
   * Change whether the composer text box can be drag-resized; the live value
   * publishes before the durable write starts. Turning resize off also clears
   * any remembered box size so the next opt-in starts from auto-grow.
   * @param value - true shows the edge handles; false restores auto-grow.
   */
  setComposerResize(value: boolean): void {
    if (this.composerResize.getSnapshot() === value) return
    this.composerResize.set(value)
    void this.host?.set(COMPOSER_RESIZE_FIELD, value)
  }

  /**
   * Remember the last dragged composer box so remounts / session switches
   * restore it while resize stays enabled.
   * @param size - axes to update; omitted axes keep their previous value.
   */
  setComposerResizeSize(size: Partial<ComposerResizeSize>): void {
    if (size.height !== undefined && this.composerResizeHeight.getSnapshot() !== size.height) {
      this.composerResizeHeight.set(size.height)
      if (size.height !== null) void this.host?.set(COMPOSER_RESIZE_HEIGHT_FIELD, size.height)
    }
    if (size.width !== undefined && this.composerResizeWidth.getSnapshot() !== size.width) {
      this.composerResizeWidth.set(size.width)
      if (size.width !== null) void this.host?.set(COMPOSER_RESIZE_WIDTH_FIELD, size.width)
    }
  }

  /**
   * Change whether the composer dock paints the session stats strip; the live
   * value publishes before the durable write starts.
   * @param value - true paints StatsLine figures; false hides them and keeps the row gap.
   */
  setStatsLine(value: boolean): void {
    this.setDockPreference(STATS_LINE_FIELD, value)
  }

  /**
   * Change whether the peak/valley status row is force-enabled; the live value
   * publishes before the durable write starts. The row also shows without this
   * preference while a DeepSeek API route is detected, so off means "detection
   * only", never "off outright".
   * @param value - true force-paints the row; false leaves detection in charge.
   */
  setOfficialPeakValley(value: boolean): void {
    this.setDockPreference(OFFICIAL_PEAK_VALLEY_FIELD, value)
  }

  /**
   * Change whether the composer dock paints the session cost figure; the live
   * value publishes before the durable write starts. This gates the complete
   * cost and peak/valley row; cost figures also need the billed-usage projection.
   * @param value - true enables the cost and peak/valley row.
   */
  setSessionCost(value: boolean): void {
    this.setDockPreference(SESSION_COST_FIELD, value)
  }

  private setDockPreference(field: DockPreferenceField, value: boolean): void {
    if (this.disposed || this[field].getSnapshot() === value) return
    const host = this.host
    const write: DockPreferenceWrite = { value, accepted: false }
    if (host !== undefined) this.dockPreferenceWrites.set(field, write)
    this[field].set(value)
    if (host === undefined) return
    const settle = (accepted: boolean): void => {
      if (this.disposed || this.dockPreferenceWrites.get(field) !== write) return
      if (accepted) write.accepted = true
      else this.dockPreferenceWrites.delete(field)
      this.adopt(host)
    }
    void host.set(field, value).then(settle, () => { settle(false) })
  }

  private adoptDockPreference(field: DockPreferenceField, value: boolean): void {
    const pending = this.dockPreferenceWrites.get(field)
    // A superseded ConfigForm write can resolve before the namespace mirror
    // publishes. Keep its intent until both acceptance and reflection arrive.
    if (pending !== undefined) {
      if (!pending.accepted || value !== pending.value) return
      this.dockPreferenceWrites.delete(field)
    }
    if (this[field].getSnapshot() !== value) this[field].set(value)
  }

  /**
   * Replace the user's per-model custom peak prices; the live value publishes
   * before the durable write starts. Models absent from the record bill at
   * official (or first-column) prices.
   * @param prices - the complete replacement record.
   */
  setSessionCostPrices(prices: SessionCostPrices): void {
    if (this.sessionCostPrices.getSnapshot() === prices) return
    this.sessionCostPrices.set(prices)
    void this.host?.set(SESSION_COST_PRICES_FIELD, prices)
  }

  /**
   * Change whether the session header paints Chat/Trajectory tabs; the live
   * value publishes before the durable write starts.
   * @param value - true paints the tablist when more than one view exists.
   */
  setViewTabs(value: boolean): void {
    if (this.viewTabs.getSnapshot() === value) return
    this.viewTabs.set(value)
    void this.host?.set(VIEW_TABS_FIELD, value)
  }

  /**
   * Change whether the composer suggests the next user prompt; the live value
   * publishes before the durable write starts.
   * @param value - true enables suggestions; false stops requesting and displaying them.
   */
  setNextPrompt(value: boolean): void {
    this.setDockPreference(NEXT_PROMPT_FIELD, value)
  }

  /**
   * Adopt the scope's accepted durable behavior without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: ConfigForm<ConversationSettings>): void {
    const snap = host.getSnapshot()
    if (this.writable.getSnapshot() !== snap.writable) this.writable.set(snap.writable)
    const section = snap.value
    if (section === undefined) return
    if (this.busyEnter.getSnapshot() !== section.busyEnter) this.busyEnter.set(section.busyEnter)
    const nextBeam = section.composerBeam !== false
    if (this.composerBeam.getSnapshot() !== nextBeam) this.composerBeam.set(nextBeam)
    const nextBeamStyle = normalizeComposerBeamStyle(section.composerBeamStyle)
    if (!sameBeamStyle(this.composerBeamStyle.getSnapshot(), nextBeamStyle)) {
      this.composerBeamStyle.set(nextBeamStyle)
    }
    const nextBeamPresets = normalizeComposerBeamPresets(section.composerBeamPresets)
    if (!sameBeamPresets(this.composerBeamPresets.getSnapshot(), nextBeamPresets)) {
      this.composerBeamPresets.set(nextBeamPresets)
    }
    const nextResize = section.composerResize === true
    if (this.composerResize.getSnapshot() !== nextResize) this.composerResize.set(nextResize)
    const nextHeight = typeof section.composerResizeHeight === 'number' ? section.composerResizeHeight : null
    if (this.composerResizeHeight.getSnapshot() !== nextHeight) this.composerResizeHeight.set(nextHeight)
    const nextWidth = typeof section.composerResizeWidth === 'number' ? section.composerResizeWidth : null
    if (this.composerResizeWidth.getSnapshot() !== nextWidth) this.composerResizeWidth.set(nextWidth)
    this.adoptDockPreference(STATS_LINE_FIELD, section.statsLine !== false)
    this.adoptDockPreference(OFFICIAL_PEAK_VALLEY_FIELD, section.officialPeakValley === true)
    this.adoptDockPreference(SESSION_COST_FIELD, section.sessionCost === true)
    this.adoptDockPreference(NEXT_PROMPT_FIELD, section.nextPrompt !== false)
    // Sanitize the loosely schema'd record at the durable boundary: only a
    // plain string-keyed object adopts; anything else reads as "no custom
    // prices" instead of leaking into price lookups.
    const rawPrices: unknown = section.sessionCostPrices
    const nextPrices = rawPrices !== null && typeof rawPrices === 'object' && !Array.isArray(rawPrices)
      ? rawPrices as SessionCostPrices
      : DEFAULT_SESSION_COST_PRICES
    if (this.sessionCostPrices.getSnapshot() !== nextPrices) this.sessionCostPrices.set(nextPrices)
    const nextTabs = section.viewTabs !== false
    if (this.viewTabs.getSnapshot() !== nextTabs) this.viewTabs.set(nextTabs)
    const nextTypingFx = section.typingFx === true
    if (this.typingFx.getSnapshot() !== nextTypingFx) this.typingFx.set(nextTypingFx)
    const nextTypingFxStyle = normalizeTypingFxStyle(section.typingFxStyle)
    if (!sameTypingFxStyle(this.typingFxStyle.getSnapshot(), nextTypingFxStyle)) {
      this.typingFxStyle.set(nextTypingFxStyle)
    }
    const nextTypingFxPresets = normalizeTypingFxPresets(section.typingFxPresets)
    if (!sameTypingFxPresets(this.typingFxPresets.getSnapshot(), nextTypingFxPresets)) {
      this.typingFxPresets.set(nextTypingFxPresets)
    }
    // A queued or in-flight write owns the editor text; adopting the last
    // committed value here would revert keystrokes the user already typed.
    const rawInstructions: unknown = section.customInstructions
    const nextInstructions = typeof rawInstructions === 'string' ? rawInstructions : DEFAULT_CUSTOM_INSTRUCTIONS
    if (this.pendingCustomInstructions === undefined
      && this.customInstructions.getSnapshot() !== nextInstructions) {
      this.customInstructions.set(nextInstructions)
    }
  }
}
