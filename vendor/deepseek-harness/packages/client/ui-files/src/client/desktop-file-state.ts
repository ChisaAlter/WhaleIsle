/** Browser-local editor drafts and the shared unsaved-file close prompt. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { DesktopFileBuffer } from './desktop-files.ts'

const DRAFT_PREFIX = 'dshd.files.draft.v1:'

/** JSON-compatible state rendered by the Files close-confirmation overlay. */
export interface FileCloseRequest {
  readonly path: string
  readonly busy: boolean
  readonly failed: boolean
}

interface PendingClose {
  readonly key: string
  readonly address: string
  readonly path: string
  readonly proceed: () => boolean
  readonly editor: DesktopFileSave | undefined
  waiting: boolean
  failed: boolean
}

/**
 * Save controls leased by one mounted editor. Pause stops unissued automatic
 * writes immediately and returns the outstanding queue (null when idle).
 * Only explicit Save may write until Resume.
 */
export interface DesktopFileSave {
  (): Promise<boolean>
  readonly pause: () => Promise<boolean> | null
  readonly resume: () => void
}

/** Inputs injected into one desktop file viewer. */
export interface DesktopFileStateInjected {
  readFileBuffer: (address: string) => DesktopFileBuffer | undefined
  writeFileBuffer: (address: string, buffer: DesktopFileBuffer | null) => void
  registerFileSave: (tabId: string, address: string, save: DesktopFileSave | null) => void
}

/** Owns drafts for one plugin lifetime; dirty contents are persisted on each edit. */
export class DesktopFileState {
  private readonly buffers = new Map<string, DesktopFileBuffer>()
  private readonly persisted = new Set<string>()
  private readonly saves = new Map<string, DesktopFileSave>()
  private readonly pending: PendingClose[] = []
  private readonly source = createSnapshotStore<FileCloseRequest | undefined>(undefined)
  /** Registrant-private source bound to the overlay by its framework hook. */
  readonly closeRequest: ObservableSnapshot<FileCloseRequest | undefined> = this.source

  /**
   * Read a remembered buffer, including a draft restored after reload.
   * @param address - stable resource address.
   * @returns the disk baseline and edited contents, or undefined.
   */
  read(address: string): DesktopFileBuffer | undefined {
    const remembered = this.buffers.get(address)
    if (remembered !== undefined) return { ...remembered }
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + address)
      if (raw === null) return undefined
      const stored: unknown = JSON.parse(raw)
      if (typeof stored !== 'object' || stored === null
        || !('text' in stored) || typeof stored.text !== 'string'
        || !('draft' in stored) || typeof stored.draft !== 'string') return undefined
      const buffer = { text: stored.text, draft: stored.draft }
      this.buffers.set(address, buffer)
      this.persisted.add(address)
      return { ...buffer }
    } catch (_error: unknown) {
      // Unavailable storage or invalid persisted JSON has no restorable draft.
      return undefined
    }
  }

  /**
   * Remember an editor update; only dirty contents consume persistent storage.
   * @param address - stable resource address.
   * @param buffer - editor baseline and draft, or null to discard it.
   */
  write(address: string, buffer: DesktopFileBuffer | null): void {
    const previous = this.buffers.get(address)
    if (buffer !== null && this.persisted.has(address)
      && previous?.text === buffer.text && previous.draft === buffer.draft) return
    if (buffer === null) this.buffers.delete(address)
    else this.buffers.set(address, { ...buffer })
    this.persisted.delete(address)
    try {
      if (buffer === null || buffer.text === buffer.draft) localStorage.removeItem(DRAFT_PREFIX + address)
      else localStorage.setItem(DRAFT_PREFIX + address, JSON.stringify(buffer))
      if (buffer !== null) this.persisted.add(address)
    } catch (_error: unknown) {
      // Keep the current editor usable when the browser refuses local storage.
    }
  }

  /**
   * Bind a mounted editor's serialized Save operation.
   * @param tabId - owning tab occurrence.
   * @param address - Session-scoped resource address; tab ids alone are not globally unique.
   * @param save - Save and autosave controls, or null when the editor unmounts.
   */
  registerSave(tabId: string, address: string, save: DesktopFileSave | null): void {
    const key = JSON.stringify([address, tabId])
    if (save === null) this.saves.delete(key)
    else this.saves.set(key, save)
  }

  /**
   * Pause autosave before deferring dirty-file removal to the shared Modal.
   * Issued writes settle before decisions are enabled; repeated requests coalesce.
   * @param tabId - owning tab occurrence.
   * @param address - resource whose draft must be protected.
   * @param path - visible workspace-relative file name.
   * @param proceed - one-shot removal supplied by the Sidebar controller.
   * @returns false while confirmation is required, otherwise true.
   */
  requestClose(tabId: string, address: string, path: string, proceed: () => boolean): boolean {
    const buffer = this.read(address)
    if (buffer === undefined || buffer.text === buffer.draft) {
      this.write(address, null)
      return true
    }
    const key = JSON.stringify([address, tabId])
    if (!this.pending.some(request => request.key === key)) {
      const editor = this.saves.get(key)
      const writing = editor?.pause() ?? null
      const request: PendingClose = { key, address, path, proceed, editor, waiting: writing !== null, failed: false }
      this.pending.push(request)
      if (this.pending.length === 1) this.publish()
      if (writing !== null) {
        void writing.then(
          () => { this.settleClose(request, false) },
          () => { this.settleClose(request, true) },
        )
      }
    }
    return false
  }

  /** Cancel the current close request and leave its draft untouched. */
  cancelClose(): void {
    if (this.source.getSnapshot()?.busy) return
    this.pending.shift()?.editor?.resume()
    this.publish()
  }

  /** Discard the current dirty buffer and continue the original close or replacement. */
  discardClose(): void {
    if (this.source.getSnapshot()?.busy) return
    this.finishClose()
  }

  /** Save through the editor queue; failure or newer edits keep the prompt and tab. */
  async saveClose(): Promise<void> {
    const request = this.pending[0]
    if (request === undefined || this.source.getSnapshot()?.busy) return
    const before = this.read(request.address)
    if (before === undefined || before.text === before.draft) {
      this.finishClose()
      return
    }
    this.source.set({ path: request.path, busy: true, failed: false })
    let ok = false
    try { ok = await request.editor?.() ?? false }
    catch (_error: unknown) {
      // A failed Save keeps the prompt and the recoverable draft in place.
    }
    if (this.pending[0] !== request) return
    const buffer = this.read(request.address)
    if (!ok || (buffer !== undefined && buffer.draft !== buffer.text)) {
      this.source.set({ path: request.path, busy: false, failed: !ok })
      return
    }
    this.finishClose()
  }

  /** Release interaction callbacks without deleting recoverable dirty drafts. */
  dispose(): void {
    this.pending.length = 0
    this.saves.clear()
    this.source.set(undefined)
  }

  private finishClose(): void {
    const request = this.pending.shift()
    if (request !== undefined) {
      if (request.proceed()) this.write(request.address, null)
      else request.editor?.resume()
    }
    this.publish()
  }

  private publish(): void {
    let request = this.pending[0]
    while (request !== undefined && !request.waiting && !request.failed) {
      const buffer = this.read(request.address)
      if (buffer !== undefined && buffer.text !== buffer.draft) break
      this.pending.shift()
      if (request.proceed()) this.write(request.address, null)
      else request.editor?.resume()
      request = this.pending[0]
    }
    this.source.set(request === undefined ? undefined
      : { path: request.path, busy: request.waiting, failed: request.failed })
  }

  private settleClose(request: PendingClose, failed: boolean): void {
    if (!this.pending.includes(request)) return
    request.waiting = false
    request.failed = failed
    if (this.pending[0] === request) this.publish()
  }
}
