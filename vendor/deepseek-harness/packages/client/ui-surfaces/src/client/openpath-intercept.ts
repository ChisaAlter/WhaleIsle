/** Wrap `workspaces.openPath` so desktop file opens land in surfaces. */

/** Optional jump-to-line carried beside a workspace path. */
export interface OpenPathOptions {
  line?: number
  presentation?: 'mini'
  /** Originating session; absent callers use the retained main-view session. */
  sessionId?: string
  /** Explicit root for an authorized Project deliverable outside the session cwd. */
  workingDirectory?: string
}

/** Minimal workspaces face the interceptor replaces. */
export interface OpenPathService {
  openPath(path: string, options?: OpenPathOptions): Promise<void>
}

/** Live facts the interceptor reads on each open. */
export interface OpenPathInterceptDeps {
  /** False outside the desktop app (no `window.shell.listDir`). */
  takeoverEnabled(): boolean
  /** Current session id, or undefined when the home is blank. */
  currentSessionId(): string | undefined
  /**
   * Open `path` in the surfaces column.
   * @returns false to fall through to the original `openPath`. May be async
   *   when a desktop preview IPC must settle before the interceptor returns.
   */
  openInSurfaces(
    path: string,
    sessionId: string,
    options?: OpenPathOptions,
  ): boolean | Promise<boolean>
}

/**
 * Install the Host opener on a Workspace service version that does not own it.
 * Existing implementations retain their identity and behavior.
 * @param workspaces - the live workspaces service object.
 * @param openHostPath - Host operation used only when the method is absent.
 * @returns a disposer that removes only the installed method.
 */
export function ensureBaseOpenPath(
  workspaces: Partial<OpenPathService>,
  openHostPath: (path: string) => Promise<void>,
): () => void {
  if (typeof workspaces.openPath === 'function') return () => {}
  const installed = async (path: string): Promise<void> => { await openHostPath(path) }
  workspaces.openPath = installed
  return () => {
    if (workspaces.openPath === installed) delete workspaces.openPath
  }
}

/**
 * Replace `workspaces.openPath` with a wrapper that takes over on desktop
 * when a current session exists and `openInSurfaces` accepts the path.
 * The disposer writes back the same function reference that was installed
 * when wrapping, so later wrappers can unwind in any order.
 * @param workspaces - the live workspaces service object.
 * @param deps - takeover predicates and the surfaces writer.
 * @returns a disposer that restores `openPath` when this wrapper is still current.
 */
export function wrapOpenPath(workspaces: Partial<OpenPathService>, deps: OpenPathInterceptDeps): () => void {
  // oxlint-disable-next-line typescript/unbound-method -- identity-preserving reference required by the wrap/restore contract
  const previous = workspaces.openPath
  if (typeof previous !== 'function') return () => {}
  const wrapped = async function openPathIntercept(
    path: string,
    options?: OpenPathOptions,
  ): Promise<void> {
    if (!deps.takeoverEnabled()) return previous.call(workspaces, path)
    const sessionId = options?.sessionId ?? deps.currentSessionId()
    if (sessionId === undefined) return previous.call(workspaces, path)
    const takeoverOptions = options?.line === undefined && options?.presentation === undefined && options?.workingDirectory === undefined
      ? undefined
      : { ...(options?.line === undefined ? {} : { line: options.line }),
        ...(options?.presentation === undefined ? {} : { presentation: options.presentation }),
        ...(options?.workingDirectory === undefined ? {} : { workingDirectory: options.workingDirectory }) }
    const accepted = takeoverOptions === undefined
      ? await deps.openInSurfaces(path, sessionId)
      : await deps.openInSurfaces(path, sessionId, takeoverOptions)
    if (!accepted) return previous.call(workspaces, path)
  }
  workspaces.openPath = wrapped
  return () => {
    if (workspaces.openPath === wrapped) workspaces.openPath = previous
  }
}
