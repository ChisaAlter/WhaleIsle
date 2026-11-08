/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 * Windows replacement retries the transient interference codes the shared
 * atomic-write primitive retries: `MOVEFILE_REPLACE_EXISTING` refuses while
 * any handle holds the target open — a concurrent reader of the unit file is
 * enough — and treating the first refusal as permanent would fail a write the
 * medium would accept moments later.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const WINDOWS_TRANSIENT_RENAME_ERRORS: ReadonlySet<string> = new Set(['EACCES', 'EBUSY', 'EPERM'])
const WINDOWS_RENAME_RETRY_INITIAL_MS = 20
const WINDOWS_RENAME_RETRY_MAX_MS = 200
const WINDOWS_RENAME_RETRY_LIMIT = 8

/** Whether Windows reported temporary interference with an atomic replacement. */
function isTransientWindowsRenameError(error: unknown): boolean {
  if (process.platform !== 'win32') return false
  return WINDOWS_TRANSIENT_RENAME_ERRORS.has((error as NodeJS.ErrnoException | null)?.code ?? '')
}

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @returns resolution after the replacement is crash-durable. On Windows a
 *   replacement that keeps meeting `EACCES`, `EBUSY`, or `EPERM` past the
 *   bounded retry budget rejects with that final error, leaving the previous
 *   target untouched.
 */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameAtomicTemp(tmp, path)
    await fsyncDirectory(dirname(path))
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/**
 * Replace `path` with the fully written temp sibling, retrying the transient
 * Windows interference codes. The rename source stays complete and the target
 * is never deleted, so every failed attempt leaves the previous content in
 * place; an exhausted budget rethrows the final filesystem error.
 * @param tmp - the temp sibling to move onto the target.
 * @param path - the target being replaced.
 * @returns resolution after the target holds the temp file's content.
 */
async function renameAtomicTemp(tmp: string, path: string): Promise<void> {
  let delay = WINDOWS_RENAME_RETRY_INITIAL_MS
  for (let retries = 0;; retries += 1) {
    try {
      await rename(tmp, path)
      return
    } catch (error) {
      if (!isTransientWindowsRenameError(error)) throw error
      if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS)
  }
}

/**
 * Persist directory-entry changes on POSIX; skip this unsupported operation on Windows.
 * @param path - Absolute directory path.
 * @returns resolution after the directory is synced, or immediately on Windows.
 */

/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
export async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */
