/**
 * Event-only filesystem observation policy; it registers no service. A weak owner/target map
 * records every authoritative presence/absence observation, single-slot intent listeners derive
 * guards from that state, and the provider performs the atomic freshness/no-clobber check. Without
 * this plugin, tools retain the bare provider's unconditional mutation behavior. See the package
 * README for composition rules.
 * @module @deepseek-ai/dsh-fs-observation-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsObservation, FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { FsObservationActor, FsObservedSession, FsSessionContentBlock, FsSessionMessage } from './types.ts'

export type {
  FsObservationActor,
  FsObservedSession,
  FsSessionContentBlock,
  FsSessionMessage,
} from './types.ts'

/** Policy configuration controlling partial-read overwrite safety. */
export interface Config {
  /**
   * Reject whole-file overwrites (`write` / `apply_patch` add) when the prior
   * observation came from a partial read (`offset`, `limit`, or output truncation).
   * Targeted edits (`edit` / `apply_patch` update) against the observed version remain allowed.
   * @default true
   */
  readonly rejectOverwriteAfterPartialRead?: boolean
}

interface HistoricalCall {
  readonly name: string
  readonly args: Record<string, unknown>
}

interface HistoricalRecord {
  readonly path: string
  readonly kind: 'present' | 'absent'
  readonly partial: boolean
}

interface ParsedHistoryCache {
  readonly messageCount: number
  readonly records: readonly HistoricalRecord[]
}

const READ_ENVELOPE_RE = /^<path>([^\r\n<]+)<\/path>\r?\n<type>(file|image)<\/type>\r?\n<content>\r?\n([\s\S]*?)\r?\n?<\/content>$/
const READ_EOF_RE = /\(End of file - total \d+ lines\)\s*$/
const LINE_TRUNCATED_RE = /\.\.\. \(line truncated to \d+ chars\)/m
const EDIT_OK_RE = /^The file (.+?) has been updated(?: successfully\.|\. All occurrences were successfully replaced\.)$/
const EDITOR_VIEW_RE = /^Here's the content of (.+?) with line numbers \(which has a total of \d+ lines\)/
const EDITOR_CREATE_RE = /^New file created successfully at: (.+)$/
const EDITOR_EDIT_RE = /^The file (.+?) has been edited successfully\.$/
const READ_ABSENT_RE = /^(?:Error: )?cannot read "([^"]+)": not found$/
const EDITOR_ABSENT_RE = /^(?:Error: )?The path (.+?) does not exist\. /

function safeJsonArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    // Ignore malformed historical tool-call JSON rather than aborting resume backfill.
    return {}
  }
}

function extractText(blocks: readonly FsSessionContentBlock[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .filter((block): block is FsSessionContentBlock & { text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

function parsePatchSuccessRecords(text: string): HistoricalRecord[] {
  if (!text.startsWith('Success. Updated the following files:\n')) return []
  const records: HistoricalRecord[] = []
  for (const line of text.split('\n').slice(1)) {
    const prefix = line.slice(0, 2)
    const path = line.slice(2).trimEnd()
    if (path.length === 0) continue
    if (prefix === 'D ') records.push({ path, kind: 'absent', partial: false })
    else if (prefix === 'A ' || prefix === 'M ') records.push({ path, kind: 'present', partial: false })
  }
  return records
}

function parseToolResultRecords(msg: FsSessionMessage, call: HistoricalCall | undefined): HistoricalRecord[] {
  const text = extractText(msg.content)
  if (text.length === 0) return []
  if (msg.isError === true) {
    const readAbsent = READ_ABSENT_RE.exec(text)
    if (readAbsent?.[1] !== undefined) return [{ path: readAbsent[1], kind: 'absent', partial: false }]
    const editorAbsent = EDITOR_ABSENT_RE.exec(text)
    if (editorAbsent?.[1] !== undefined) return [{ path: editorAbsent[1], kind: 'absent', partial: false }]
    return []
  }

  const envelope = READ_ENVELOPE_RE.exec(text)
  if (envelope?.[1] !== undefined && envelope[2] !== undefined && envelope[3] !== undefined) {
    const path = envelope[1]
    if (envelope[2] === 'image' || call?.name === 'write') {
      return [{ path, kind: 'present', partial: false }]
    }
    const offset = typeof call?.args.offset === 'number' ? call.args.offset : 1
    const body = envelope[3]
    const partial = offset > 1 || !READ_EOF_RE.test(body) || LINE_TRUNCATED_RE.test(body)
    return [{ path, kind: 'present', partial }]
  }

  const editMatch = EDIT_OK_RE.exec(text)
  if (editMatch?.[1] !== undefined) return [{ path: editMatch[1], kind: 'present', partial: false }]

  const viewMatch = EDITOR_VIEW_RE.exec(text)
  if (viewMatch?.[1] !== undefined) {
    const hasRange = call?.args.view_range !== undefined && call.args.view_range !== null
    return [{ path: viewMatch[1], kind: 'present', partial: hasRange || text.includes('<response clipped>') }]
  }

  const createMatch = EDITOR_CREATE_RE.exec(text)
  if (createMatch?.[1] !== undefined) return [{ path: createMatch[1], kind: 'present', partial: false }]

  const editorEditMatch = EDITOR_EDIT_RE.exec(text)
  if (editorEditMatch?.[1] !== undefined) return [{ path: editorEditMatch[1], kind: 'present', partial: false }]

  return parsePatchSuccessRecords(text)
}

function extractHistoricalRecords(messages: readonly FsSessionMessage[]): HistoricalRecord[] {
  const callsById = new Map<string, HistoricalCall>()
  const records: HistoricalRecord[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && message.content !== undefined) {
      for (const block of message.content) {
        if (block.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string') {
          callsById.set(block.id, { name: block.name, args: safeJsonArgs(block.arguments) })
        }
      }
      continue
    }
    if (message.role === 'tool' && typeof message.toolCallId === 'string') {
      records.push(...parseToolResultRecords(message, callsById.get(message.toolCallId)))
    }
  }
  return records
}

function sessionCwdOf(owner: object): string | undefined {
  if (!('header' in owner)) return undefined
  const header = (owner as { readonly header: unknown }).header
  if (header === null || typeof header !== 'object' || !('cwd' in header)) return undefined
  const cwd = (header as { readonly cwd: unknown }).cwd
  return typeof cwd === 'string' ? cwd : undefined
}

function sessionMessagesOf(owner: object): readonly FsSessionMessage[] | undefined {
  if (!('deriveMessages' in owner)) return undefined
  const fn = (owner as { readonly deriveMessages: unknown }).deriveMessages
  if (typeof fn !== 'function') return undefined
  return (fn as FsObservedSession['deriveMessages'] & (() => readonly FsSessionMessage[])).call(owner)
}

/**
 * Per-context observed-file state and the `fs/*` decisions over it. One
 * instance is created per `apply()` so disposal can drop all state for HMR.
 */
class ObservedStateGate {
  /**
   * Observed-file state, keyed first by the owner object (weakly held, so a
   * collected session frees its state), then by {@link FsTarget.targetKey}. An
   * entry's presence is the prior-observation record; its discriminant keeps
   * confirmed absence distinct from an unseen target.
   */
  private observed = new WeakMap<object, Map<string, FsObservation>>()
  private historyCache = new WeakMap<object, ParsedHistoryCache>()
  private resolvedPathCache = new WeakMap<object, Map<string, string | null>>()
  private readonly ctx: Context
  private readonly rejectOverwriteAfterPartialRead: boolean

  constructor(ctx: Context, rejectOverwriteAfterPartialRead: boolean) {
    this.ctx = ctx
    this.rejectOverwriteAfterPartialRead = rejectOverwriteAfterPartialRead
  }

  /**
   * Derive the observed-state owner from the opaque event actor — normally the
   * active agent session. `undefined` when no owner can be derived (e.g. a
   * direct tool call with no agent); such calls read freely but cannot satisfy
   * the write/edit prior-observation policy.
   */
  private owner(actor: object | undefined): object | undefined {
    // tsgolint treats object as assignable to weak FsObservationActor, while tsc still requires the structural cast for property access.
    // See the analyzer-divergence consequence in .agents/notes/archived/process/2026-07-29-oxlint-linter.md.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- The analyzers disagree on this weak type.
    return (actor as FsObservationActor | undefined)?.agent?.session
  }

  private get(owner: object, targetKey: string): FsObservation | undefined {
    return this.observed.get(owner)?.get(targetKey)
  }

  private set(owner: object, targetKey: string, observation: FsObservation): void {
    let byTarget = this.observed.get(owner)
    if (!byTarget) {
      byTarget = new Map()
      this.observed.set(owner, byTarget)
    }
    byTarget.set(targetKey, observation)
  }

  /** Drop all recorded state (HMR safety / disposal). */
  clear(): void {
    this.observed = new WeakMap()
    this.historyCache = new WeakMap()
    this.resolvedPathCache = new WeakMap()
  }

  private readHistory(owner: object): readonly HistoricalRecord[] {
    const messages = sessionMessagesOf(owner)
    if (messages === undefined) return []
    const cached = this.historyCache.get(owner)
    if (cached !== undefined && cached.messageCount === messages.length) {
      return cached.records
    }
    const records = extractHistoricalRecords(messages)
    this.historyCache.set(owner, { messageCount: messages.length, records })
    return records
  }

  private async resolveHistoricalTargetKey(
    owner: object,
    path: string,
    fs: FileSystem,
    cwd: string | undefined,
  ): Promise<string | null> {
    let byPath = this.resolvedPathCache.get(owner)
    if (byPath === undefined) {
      byPath = new Map()
      this.resolvedPathCache.set(owner, byPath)
    }
    const cacheKey = `${cwd ?? ''}\0${path}`
    const cached = byPath.get(cacheKey)
    if (cached !== undefined) return cached
    try {
      const resolved = await fs.resolve(path, cwd === undefined ? undefined : { cwd })
      byPath.set(cacheKey, resolved.targetKey)
      return resolved.targetKey
    } catch {
      // Unresolvable historical paths (e.g. deleted root or invalid path) cannot authorize targets.
      byPath.set(cacheKey, null)
      return null
    }
  }

  private async matchesTarget(
    owner: object,
    target: FsTarget,
    recordPath: string,
    fs: FileSystem | undefined,
    cwd: string | undefined,
  ): Promise<boolean> {
    if (recordPath === target.displayPath || recordPath === (target.targetKey as string)) return true
    if (fs === undefined) return false
    return await this.resolveHistoricalTargetKey(owner, recordPath, fs, cwd) === target.targetKey
  }

  private async materializeObservation(
    target: FsTarget,
    record: HistoricalRecord,
    fs: FileSystem | undefined,
  ): Promise<FsObservation | undefined> {
    if (record.kind === 'absent') return { kind: 'absent' }
    if (fs === undefined) return undefined
    const info = await fs.stat(target)
    if (info === undefined) return { kind: 'absent' }
    if (info.type !== 'file') return undefined
    return record.partial ? { kind: 'present', version: info.version, partial: true } : { kind: 'present', version: info.version }
  }

  private async getOrBackfill(target: FsTarget, owner: object | undefined): Promise<FsObservation | undefined> {
    if (!owner) return undefined
    const existing = this.get(owner, target.targetKey)
    if (existing !== undefined) return existing
    const history = this.readHistory(owner)
    if (history.length === 0) return undefined

    const fs = this.ctx.get('fs')
    const cwd = sessionCwdOf(owner)
    for (let i = history.length - 1; i >= 0; i--) {
      const record = history[i]
      if (!record) continue
      if (!await this.matchesTarget(owner, target, record.path, fs, cwd)) continue
      const restored = await this.materializeObservation(target, record, fs)
      if (restored !== undefined) this.set(owner, target.targetKey, restored)
      return restored
    }
    return undefined
  }

  /**
   * Decide the write intent: unseen or confirmed absent -> `createIfAbsent`;
   * confirmed full presence -> `replaceIfVersion` at the observed version;
   * partial read throws `FS_NOT_OBSERVED` when {@link Config.rejectOverwriteAfterPartialRead}
   * is enabled.
   */
  async writeIntent(target: FsTarget, actor: object | undefined): Promise<FsWriteIntent> {
    const owner = this.owner(actor)
    const prior = await this.getOrBackfill(target, owner)
    if (prior?.kind === 'present') {
      if (prior.partial === true && this.rejectOverwriteAfterPartialRead) {
        throw new FsError(
          `cannot overwrite "${target.displayPath}": file was only partially read`
            + ' — read the full file before overwriting or use edit',
          'FS_NOT_OBSERVED',
        )
      }
      return { kind: 'replaceIfVersion', version: prior.version }
    }
    return { kind: 'createIfAbsent' }
  }

  /**
   * Decide the edit version guard: unseen rejects with `FS_NOT_OBSERVED`,
   * confirmed absence rejects with `FS_NOT_FOUND`, and presence supplies the
   * observed version as the CAS basis.
   */
  async editIntent(target: FsTarget, actor: object | undefined): Promise<{ version: FsVersion }> {
    return this.requirePresent(target, actor, 'edit')
  }

  /** Deletion requires the same authoritative present observation as editing. */
  async deleteIntent(target: FsTarget, actor: object | undefined): Promise<{ version: FsVersion }> {
    return this.requirePresent(target, actor, 'delete')
  }

  private async requirePresent(target: FsTarget, actor: object | undefined, verb: 'edit' | 'delete'): Promise<{ version: FsVersion }> {
    const owner = this.owner(actor)
    const prior = await this.getOrBackfill(target, owner)
    if (!owner || prior === undefined) {
      throw new FsError(`${verb} requires reading "${target.displayPath}" first`, 'FS_NOT_OBSERVED')
    }
    if (prior.kind === 'absent') {
      throw new FsError(`cannot ${verb} "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    }
    return { version: prior.version }
  }

  /** Record an authoritative present or absent observation for this owner and target. */
  observe(target: FsTarget, observation: FsObservation, actor: object | undefined): void {
    const owner = this.owner(actor)
    if (owner) this.set(owner, target.targetKey, observation)
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'fs-observation-policy'

/**
 * Register the four `fs/*` listeners. No required `inject` — when `ctx.fs` is
 * mounted, resumed sessions lazily backfill historical observations from
 * session history without creating temp files on disk.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const rejectOverwriteAfterPartialRead = config.rejectOverwriteAfterPartialRead ?? true
  const gate = new ObservedStateGate(ctx, rejectOverwriteAfterPartialRead)

  ctx.effect(() => () => {
    // Drop all recorded state on disposal so a reloaded plugin starts clean
    // (HMR safety). The WeakMap itself would be GC'd, but replacing it makes the
    // release observable and immediate for tests.
    gate.clear()
  }, 'fs-observation-policy observed-state teardown')

  // fs/write-intent: occupy the single decision slot — do NOT call next().
  ctx.on('fs/write-intent', (target, actor) => gate.writeIntent(target, actor))

  // fs/edit-intent: occupy the single decision slot — do not call next().
  ctx.on('fs/edit-intent', (target, actor) => gate.editIntent(target, actor))

  ctx.on('fs/delete-intent', (target, actor) => gate.deleteIntent(target, actor))

  // fs/observed must remain synchronous and non-throwing: emit does not await
  // promises, and successful mutations have already committed. WeakMap.set
  // satisfies that contract for both presence and absence.
  ctx.on('fs/observed', (target, observation, actor) => {
    gate.observe(target, observation, actor)
  })
}
