/** Desktop PTY methods the Electron preload exposes on `window.shell`. */
export interface PtyShell {
  ptyCanCreate?: (cwd: string) => Promise<boolean>
  ptyCreate?: (input: { cwd: string }) => Promise<{ id: string }>
  ptyWrite?: (id: string, data: string) => Promise<void>
  /** Cumulative acknowledgement: frame `seq` and every earlier frame were consumed. */
  ptyAck?: (id: string, seq: number) => Promise<void>
  ptyResize?: (id: string, cols: number, rows: number) => Promise<void>
  ptyKill?: (id: string) => Promise<void>
  onPtyData?: (handler: (payload: { id: string; data: string; seq: number }) => void) => () => void
  onPtyExit?: (handler: (payload: { id: string; code: number }) => void) => () => void
}

/** Injected PTY + layout writes shared by the drawer and the surface. */
export interface TerminalShellInjected {
  ptyCanCreate: (cwd: string) => Promise<boolean>
  ptyCreate: (input: { cwd: string }) => Promise<{ id: string }>
  ptyWrite: (id: string, data: string) => Promise<void>
  /** Cumulative acknowledgement: frame `seq` and every earlier frame were consumed. */
  ptyAck: (id: string, seq: number) => Promise<void>
  ptyResize: (id: string, cols: number, rows: number) => Promise<void>
  ptyKill: (id: string) => Promise<void>
  onPtyData: (handler: (payload: { id: string; data: string; seq: number }) => void) => () => void
  onPtyExit: (handler: (payload: { id: string; code: number }) => void) => () => void
  toggleTerminalDrawer: () => void
  setTerminalDrawer: (px: number) => void
  mentionTerminal: (sessionId: string, text: string) => void
  writeClipboard: (text: string) => Promise<void>
  openWorkspacePath: (absolutePath: string, options?: { line?: number }) => void
  openLocalUrl: (url: string) => void
  openExternal: (url: string) => void
}

function unavailable(): Promise<{ id: string }> {
  return Promise.reject(new Error('ptyCreate requires a project cwd'))
}

/**
 * Bind desktop PTY IPC when `window.shell` is present.
 * @returns injected PTY callbacks; each call no-ops outside the desktop app.
 */
export function readPtyShell(): Pick<
  TerminalShellInjected,
  'ptyCanCreate' | 'ptyCreate' | 'ptyWrite' | 'ptyAck' | 'ptyResize' | 'ptyKill' | 'onPtyData' | 'onPtyExit'
> {
  /* v8 ignore next -- browser-only module; Node coverage never sees a missing window. */
  const shell = typeof window === 'undefined'
    ? undefined
    : (window as Window & { shell?: PtyShell }).shell
  return {
    ptyCanCreate: cwd => shell?.ptyCanCreate?.(cwd) ?? Promise.resolve(false),
    ptyCreate: input => shell?.ptyCreate?.(input) ?? unavailable(),
    ptyWrite: (id, data) => shell?.ptyWrite?.(id, data) ?? Promise.resolve(),
    ptyAck: (id, seq) => shell?.ptyAck?.(id, seq) ?? Promise.resolve(),
    ptyResize: (id, cols, rows) => shell?.ptyResize?.(id, cols, rows) ?? Promise.resolve(),
    ptyKill: id => shell?.ptyKill?.(id) ?? Promise.resolve(),
    onPtyData: handler => shell?.onPtyData?.(handler) ?? (() => {}),
    onPtyExit: handler => shell?.onPtyExit?.(handler) ?? (() => {}),
  }
}
