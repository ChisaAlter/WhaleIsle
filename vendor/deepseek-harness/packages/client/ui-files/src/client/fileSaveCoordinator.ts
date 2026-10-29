export interface FileSaveResult { ok: boolean }

export interface FileSaveCoordinatorOptions {
  readonly debounceMs: number
  readonly persist: (contents: string) => Promise<FileSaveResult>
  readonly onPendingChange: (pending: boolean) => void
  readonly onConfirmed: (contents: string) => void
}

/**
 * Serializes every write of one file: debounced draft edits (`change`) and
 * explicit saves (`flush`) share a single persist queue, so two writes can
 * never interleave. Each queued run persists the newest contents at run time;
 * `onConfirmed` reports the exact contents that were written.
 */
export class FileSaveCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null
  private latestContents = ''
  private latestRevision = 0
  private persistedRevision = 0
  private queue: Promise<boolean> | null = null
  private paused = false

  constructor(private readonly options: FileSaveCoordinatorOptions) {}

  change(contents: string): void {
    this.latestContents = contents
    this.latestRevision += 1
    this.options.onPendingChange(true)
    if (!this.paused) this.schedule()
  }

  /**
   * Persist contents now, serialized behind any in-flight write; a pending
   * debounce write is folded into this flush instead of running separately.
   * @param contents - draft snapshot to write.
   * @returns whether a write covering this revision was confirmed.
   */
  flush(contents: string): Promise<boolean> {
    this.latestContents = contents
    this.latestRevision += 1
    this.options.onPendingChange(true)
    this.clearTimer()
    return this.enqueuePersist(true)
  }

  /** Pause automatic saves synchronously; the returned queue settles before close decisions. */
  pause(): Promise<boolean> | null {
    this.paused = true
    this.clearTimer()
    return this.queue
  }

  /** Resume the latest dirty draft after Keep editing or an obsolete close request. */
  resume(): void {
    this.paused = false
    if (this.latestRevision > this.persistedRevision) this.schedule()
  }

  dispose(): void {
    this.clearTimer()
    if (this.latestRevision > this.persistedRevision) void this.enqueuePersist()
  }

  private schedule(): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.enqueuePersist()
    }, this.options.debounceMs)
  }

  private clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private enqueuePersist(explicit = false): Promise<boolean> {
    const run = (this.queue ?? Promise.resolve(true)).then(() =>
      this.paused && !explicit ? false : this.persistLatest())
    this.queue = run
    const finish = (): void => { if (this.queue === run) this.queue = null }
    void run.then(finish, finish)
    return run
  }

  private async persistLatest(): Promise<boolean> {
    const revision = this.latestRevision
    if (revision <= this.persistedRevision) return true
    const contents = this.latestContents
    let result: FileSaveResult
    try {
      result = await this.options.persist(contents)
    } catch {
      // A rejected persist counts as a failed write; the queue stays alive.
      result = { ok: false }
    }
    if (!result.ok) return false
    this.persistedRevision = revision
    this.options.onConfirmed(contents)
    // A change during the await bumped latestRevision; its own timer (or a
    // dispose-time enqueue) still covers it, so pending stays true until then.
    if (revision === this.latestRevision) this.options.onPendingChange(false)
    return true
  }
}
