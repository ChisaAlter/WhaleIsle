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
}

/** Inputs injected into one desktop file viewer. */
export interface DesktopFileStateInjected {
  readFileBuffer: (address: string) => DesktopFileBuffer | undefined
  writeFileBuffer: (address: string, buffer: DesktopFileBuffer | null) => void
  registerFileSave: (tabId: string, address: string, save: (() => Promise<boolean>) | null) => void
}

/** Owns drafts for one plugin lifetime; dirty contents are persisted on each edit. */
export class DesktopFileState {
  private readonly buffers = new Map<string, DesktopFileBuffer>()
  private readonly persisted = new Set<string>()
  private readonly saves = new Map<string, () => Promise<boolean>>()
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
   * @param save - Save operation, or null when the editor unmounts.
   */
  registerSave(tabId: string, address: string, save: (() => Promise<boolean>) | null): void {
    const key = JSON.stringify([address, tabId])
    if (save === null) this.saves.delete(key)
    else this.saves.set(key, save)
  }

  /**
   * Defer dirty-file removal to the shared Modal; repeated requests coalesce.
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
      this.pending.push({ key, address, path, proceed })
      if (this.pending.length === 1) this.publish()
    }
    return false
  }

  /** Cancel the current close request and leave its draft untouched. */
  cancelClose(): void {
    if (this.source.getSnapshot()?.busy) return
    this.pending.shift()
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
    try { ok = await this.saves.get(request.key)?.() ?? false }
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
    }
    this.publish()
  }

  private publish(): void {
    const request = this.pending[0]
    this.source.set(request === undefined ? undefined : { path: request.path, busy: false, failed: false })
  }
}
