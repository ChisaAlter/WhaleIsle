/**
 * Desktop shell bridge: the `window.shell` API the Electron preload exposes.
 * Absent outside the desktop app, so every consumer branches on `desktopShell()`.
 */

/** Update snapshot returned by the shell's check/install calls. */
export type UpdateInfo = {
  status?: string
  current?: string
  latest?: string
  htmlUrl?: string
  repoUrl?: string
  releasesUrl?: string
  assetName?: string
  assetUrl?: string
  message?: string
  launched?: boolean
  openedPage?: boolean
  manualInstall?: boolean
  cancelled?: boolean
  code?: string
}

/** Download/install progress pushed by the shell during installUpdate. */
export type ProgressPayload = {
  phase?: string
  percent?: number
}

/**
 * Harness auto-recovery policy the desktop shell persists and enforces: when
 * the Harness process exits unexpectedly, restart it up to
 * `harnessRestartMaxAttempts` times, backing off `harnessRestartBaseDelayMs`
 * between attempts. Values are optional on the wire; the row normalizes them
 * (see `normalizeHarnessRestart`).
 */
export type HarnessRestartConfig = {
  harnessAutoRestart: boolean
  harnessRestartMaxAttempts: number
  harnessRestartBaseDelayMs: number
}

/** The max-attempt choices the settings row offers. */
export const HARNESS_RESTART_MAX_ATTEMPTS = [1, 3, 5] as const

/** The base-delay choices the settings row offers (ms). */
export const HARNESS_RESTART_BASE_DELAYS_MS = [1000, 2000, 5000] as const

/** Fallback policy for a shell that reports nothing for a preference. */
export const HARNESS_RESTART_DEFAULTS: HarnessRestartConfig = {
  harnessAutoRestart: true,
  harnessRestartMaxAttempts: 3,
  harnessRestartBaseDelayMs: 1000,
}

/**
 * Coerce a shell-reported (possibly partial) harness restart configuration
 * into the row's canonical values: any value outside the offered option sets
 * falls back to the product defaults, including an enabled switch.
 * @param input - the raw config from getConfig/saveConfig, or nothing.
 * @returns the normalized policy the row renders and writes from.
 */
export function normalizeHarnessRestart(input?: Partial<HarnessRestartConfig> | null): HarnessRestartConfig {
  const attempts = input?.harnessRestartMaxAttempts
  const delay = input?.harnessRestartBaseDelayMs
  return {
    harnessAutoRestart: typeof input?.harnessAutoRestart === 'boolean'
      ? input.harnessAutoRestart
      : HARNESS_RESTART_DEFAULTS.harnessAutoRestart,
    harnessRestartMaxAttempts: attempts === 1 || attempts === 3 || attempts === 5
      ? attempts
      : HARNESS_RESTART_DEFAULTS.harnessRestartMaxAttempts,
    harnessRestartBaseDelayMs: delay === 1000 || delay === 2000 || delay === 5000
      ? delay
      : HARNESS_RESTART_DEFAULTS.harnessRestartBaseDelayMs,
  }
}

/** Live2D pet settings (`live2dPet.settings`) the 桌宠 section edits. Every
 * field is optional on the wire — the shell normalizes each patch with the
 * same rules the pet window uses. */
export type Live2dPetSettings = {
  scale?: number
  opacity?: number
  personality?: string
  activity?: string
  selfTalk?: boolean
  wander?: boolean
  lockPosition?: boolean
  shiftToDrag?: boolean
  powerSave?: boolean
  clickSound?: boolean
  chatEnabled?: boolean
  approvalButtons?: boolean
  /** Vision model for 「看看屏幕」; empty keeps the look cell hidden. */
  lookModel?: string
  /** Provider id of the picked vision route; informational for the select. */
  lookProvider?: string
}

/** The pet slice of the public config: the overlay switch plus settings. */
export type Live2dPetConfig = {
  enabled?: boolean
  settings?: Live2dPetSettings
}

/** Result of the `saveLive2dPetSettings` write channel. */
export type Live2dPetSettingsResult = {
  ok?: boolean
  enabled?: boolean
  settings?: Live2dPetSettings
  reason?: string
}

/** Public desktop config fields the settings UI reads or writes. */
export type DesktopConfig = {
  appVersion?: string
  repoUrl?: string
  releasesUrl?: string
  closeToTray?: boolean
  autoStartDesktop?: boolean
  dshHome?: string
  /**
   * Whether the desktop mounts the built-in dshbot Bots plugin; the shell
   * restarts Harness after this field changes.
   */
  dshbotEnabled?: boolean
  /**
   * Whether the desktop mounts the built-in dsh-whale assistant plugin;
   * the shell restarts Harness after this field changes.
   */
  whaleAssistantEnabled?: boolean
  /**
   * Whether the desktop mounts the built-in dsh-remote SSH remote-workspace
   * plugin (default on); the shell restarts Harness after this field
   * changes. Distinct from `remoteEnabled`, the phone/LAN pairing flag.
   */
  remoteWorkspaceEnabled?: boolean
  /** Desktop pet state — `settings` is written via saveLive2dPetSettings. */
  live2dPet?: Live2dPetConfig
  /**
   * How the desktop persists credentials.json: `encrypted` via the OS
   * keychain (safeStorage), or `plaintext` on platforms without one.
   */
  credentialStorage?: 'encrypted' | 'plaintext'
} & Partial<HarnessRestartConfig>

/** The preload-exposed desktop API surface used by the settings UI. */
export type OpenDshHomeResult =
  | { ok: true; path: string }
  | { ok: false; error: string }

export type DesktopShell = {
  getConfig?: () => Promise<DesktopConfig>
  saveConfig?: (patch: Partial<DesktopConfig>) => Promise<DesktopConfig>
  checkUpdate?: () => Promise<UpdateInfo>
  installUpdate?: () => Promise<UpdateInfo>
  onUpdateProgress?: (handler: (payload: ProgressPayload) => void) => () => void
  openDshHome?: () => Promise<OpenDshHomeResult>
  /**
   * Live2D pet write channel: `{patch}` merges normalized fields,
   * `{reset:true}` restores defaults, `enabled` shows or hides the overlay.
   * Routing through the pet manager keeps the live pet in sync — pet
   * settings are intentionally absent from the saveConfig whitelist.
   */
  saveLive2dPetSettings?: (body: {
    enabled?: boolean
    patch?: Live2dPetSettings
    reset?: boolean
  }) => Promise<Live2dPetSettingsResult>
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

/**
 * Whether the desktop bridge can persist the close-window preference.
 * @param shell - preload API, or the live bridge when omitted.
 * @returns true only when both getConfig and saveConfig exist.
 */
export function canPersistCloseBehavior(shell: DesktopShell | null = desktopShell()): boolean {
  return Boolean(shell?.getConfig && shell.saveConfig)
}
