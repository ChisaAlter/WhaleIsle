/**
 * Desktop shell bridge used by the Remote popup.
 * Absent outside the desktop app, so registration branches on it.
 */

/** One LAN address the desktop gateway currently advertises. */
export type RemoteUrl = {
  address: string
  url: string
  pairingUrl: string
}

/** A device bound to this desktop after scanning the pairing QR. */
export type RemoteDevice = {
  id: string
  name: string
  createdAt?: string
  lastSeenAt?: string
  online?: boolean
  /** Last four characters of `id`, for telling two same-named devices apart. */
  shortId?: string
  /** OS / model / browser parsed from the stored user-agent; never the raw UA. */
  detail?: string
}

/** Snapshot returned by `window.shell.getRemote`. */
export type RemoteSnapshot = {
  protocol?: string
  /** Stored retired credentials; unrelated to v2 relay readiness. */
  legacyRelayTokenSet?: boolean
  /** False when the desktop has parked or cannot supply the remote gateway. */
  available?: boolean
  enabled?: boolean
  listening?: boolean
  port?: number
  token?: string
  mode?: 'lan' | 'relay'
  /** Gateway listen address: `0.0.0.0`, `127.0.0.1`, or one NIC IPv4. */
  bindAddress?: string
  /** Whether the LAN listener serves self-signed HTTPS. */
  lanTls?: boolean
  /** SHA-256 of the self-signed certificate (lower-case hex), when lanTls. */
  tlsFingerprint?: string
  /** Every LAN IPv4 the desktop currently has (bind-scope options). */
  addresses?: string[]
  relayUrl?: string
  /** Built-in public relay origin (may be HTTP for the desktop default host). */
  defaultRelayUrl?: string
  /** True when a host token is stored (never the token itself). */
  relayTokenSet?: boolean
  /** True when both HTTPS relay origin and host token are configured. */
  relayConfigured?: boolean
  relayConnected?: boolean
  relayError?: string
  error?: string
  urls?: RemoteUrl[]
  devices?: RemoteDevice[]
}

/** Patch accepted by `window.shell.saveRemote`. */
export type RemotePatch = {
  remoteEnabled?: boolean
  remotePort?: number
  remoteMode?: 'lan' | 'relay'
  remoteBindAddress?: string
  remoteLanTls?: boolean
  remoteRelayUrl?: string
  /** Host token for the outbound relay; empty string clears the stored secret. */
  remoteRelayToken?: string
}

/** The preload-exposed desktop API used by the Remote popup. */
export type DesktopShell = {
  getRemote?: () => Promise<RemoteSnapshot | null>
  saveRemote?: (patch: RemotePatch) => Promise<RemoteSnapshot | null>
  rotateRemoteToken?: () => Promise<RemoteSnapshot | null>
  unbindRemoteDevice?: (id: string) => Promise<RemoteSnapshot | null>
  renameRemoteDevice?: (id: string, name: string) => Promise<RemoteSnapshot | null>
}

/**
 * Read the desktop bridge if present.
 * @returns the preload API, or null in a plain browser.
 */
export function desktopShell(): DesktopShell | null {
  /* v8 ignore next -- the browser bundle always has window */
  if (typeof window === 'undefined') return null
  const api = (window as Window & { shell?: DesktopShell }).shell
  return api && typeof api === 'object' ? api : null
}

/** Desktop shell object that actually implements the Remote IPC methods. */
type RemoteDesktopApi = Required<Pick<DesktopShell, 'getRemote' | 'saveRemote' | 'rotateRemoteToken' | 'unbindRemoteDevice' | 'renameRemoteDevice'>>

/**
 * Whether the preload object can drive the Remote popup.
 * @param shell - `window.shell`, or null in a plain browser.
 * @returns true only when get/save/rotate/unbind/rename are all functions.
 */
export function hasRemoteApi(shell: DesktopShell | null): shell is RemoteDesktopApi {
  return Boolean(
    shell?.getRemote
      && shell.saveRemote
      && shell.rotateRemoteToken
      && shell.unbindRemoteDevice
      && shell.renameRemoteDevice,
  )
}
