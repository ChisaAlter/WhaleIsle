/** Desktop workspace listing the Electron preload exposes on `window.shell`. */

/** One directory child. */
export interface DirEntry {
  name: string
  kind: 'file' | 'directory'
}

/** listDir IPC result. */
export interface ListDirResult {
  ok: boolean
  code?: string
  message?: string
  entries?: DirEntry[]
}

/** readFile IPC result. */
export interface ReadFileResult {
  ok: boolean
  message?: string
  text?: string
  binary?: boolean
  truncated?: boolean
}

/** readFileMedia IPC result for image bytes. */
export interface ReadFileMediaResult {
  ok: boolean
  message?: string
  mime?: string
  base64?: string
  truncated?: boolean
}

/** writeFile IPC result. */
export interface WriteFileResult {
  ok: boolean
  message?: string
}

/** Injected workspace listing callbacks. */
export interface FilesShellInjected {
  listDir: (cwd: string, relativePath: string) => Promise<ListDirResult>
  readFile: (cwd: string, relativePath: string) => Promise<ReadFileResult>
  readFileMedia: (cwd: string, relativePath: string) => Promise<ReadFileMediaResult>
  writeFile: (cwd: string, relativePath: string, text: string) => Promise<WriteFileResult>
  mentionFile: (sessionId: string, relativePath: string) => void
  appendComposerText?: ((sessionId: string, text: string) => void) | undefined
  listEditors?: (() => Promise<{ id: string, label: string }[]>) | undefined
  openInEditor?: ((input: {
    editor: string
    cwd: string
    relativePath: string
    line?: number
    column?: number
  }) => Promise<{ ok: boolean, message?: string }>) | undefined
  showItemInFolder?: ((cwd: string, relativePath: string) => Promise<{ ok: boolean, message?: string }>) | undefined
  openWithSystemDefault?: ((cwd: string, relativePath: string) => Promise<{ ok: boolean, message?: string }>) | undefined
}

interface FilesShell {
  listDir?: (cwd: string, relativePath?: string) => Promise<ListDirResult>
  readFile?: (cwd: string, relativePath: string) => Promise<ReadFileResult>
  readFileMedia?: (cwd: string, relativePath: string) => Promise<ReadFileMediaResult>
  writeFile?: (cwd: string, relativePath: string, text: string) => Promise<WriteFileResult>
  listEditors?: () => Promise<{ id: string, label: string }[]>
  openInEditor?: (input: {
    editor: string
    cwd: string
    relativePath: string
    line?: number
    column?: number
  }) => Promise<{ ok: boolean, message?: string }>
  showItemInFolder?: (cwd: string, relativePath: string) => Promise<{ ok: boolean, message?: string }>
  openWithSystemDefault?: (cwd: string, relativePath: string) => Promise<{ ok: boolean, message?: string }>
}

function missingList(): ListDirResult {
  return { ok: false, message: 'Workspace listing is unavailable.' }
}

function missingRead(): ReadFileResult {
  return { ok: false, message: 'Workspace listing is unavailable.' }
}

function missingMedia(): ReadFileMediaResult {
  return { ok: false, message: 'Workspace listing is unavailable.' }
}

function missingWrite(): WriteFileResult {
  return { ok: false, message: 'Workspace listing is unavailable.' }
}

/**
 * Bind desktop listing IPC when `window.shell` is present.
 * @returns injected list/read callbacks; each call no-ops outside the desktop app.
 */
export function readFilesShell(): Omit<FilesShellInjected, 'mentionFile' | 'appendComposerText'> {
  /* v8 ignore next -- browser-only module; Node coverage never sees a missing window. */
  const shell = typeof window === 'undefined'
    ? undefined
    : (window as Window & { shell?: FilesShell }).shell
  return {
    listDir: (cwd, relativePath) => shell?.listDir?.(cwd, relativePath) ?? Promise.resolve(missingList()),
    readFile: (cwd, relativePath) => shell?.readFile?.(cwd, relativePath) ?? Promise.resolve(missingRead()),
    readFileMedia: (cwd, relativePath) => shell?.readFileMedia?.(cwd, relativePath) ?? Promise.resolve(missingMedia()),
    writeFile: (cwd, relativePath, text) => shell?.writeFile?.(cwd, relativePath, text) ?? Promise.resolve(missingWrite()),
    listEditors: () => shell?.listEditors?.() ?? Promise.resolve([]),
    openInEditor: (input) => shell?.openInEditor?.(input) ?? Promise.resolve(missingWrite()),
    showItemInFolder: (cwd, relativePath) => (
      shell?.showItemInFolder?.(cwd, relativePath) ?? Promise.resolve(missingWrite())
    ),
    openWithSystemDefault: (cwd, relativePath) => (
      shell?.openWithSystemDefault?.(cwd, relativePath) ?? Promise.resolve(missingWrite())
    ),
  }
}
