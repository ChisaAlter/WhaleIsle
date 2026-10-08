/**
 * Desktop file tab definitions and the editor buffer shape.
 *
 * The native Sidebar owns tab lifetime and persistence; this module only
 * supplies the two Desktop extension types. File bodies remain mounted while
 * hidden so their save queue survives tab changes; desktop-file-state owns
 * the recoverable browser-local drafts keyed by stable resource address.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { isAbsoluteWorkspacePath, parseFileAddress, type FileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

/** Implementation identity and keyed body key for the Desktop file tree. */
export const DESKTOP_FILES_ID = '@deepseek-ai/dsh-client-ui-files/files'

/** Page kind that shadows the builtin tree. */
export const DESKTOP_FILES_KIND = 'files'

/** Implementation identity and keyed body key for the Desktop file viewer. */
export const DESKTOP_FILE_ID = '@deepseek-ai/dsh-client-ui-files/file'

/** Resource-viewer kind, distinct from the builtin `text` fallback. */
export const DESKTOP_FILE_KIND = 'desktop-file'

/** One editor buffer: the disk baseline and the draft currently shown. */
export interface DesktopFileBuffer {
  text: string
  draft: string
}

/**
 * Binary Office formats this viewer declines: the document preview's own
 * read-only renderers (Office→PDF, XLSX→Spreadsheet) serve them through the
 * `text` fallback type, so the desktop editor never receives their bytes as
 * an undecodable blob. Text-shaped tables (csv/tsv) stay editable here.
 */
const OFFICE_PREVIEW_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'])

/**
 * Whether a workspace path ends in an Office extension routed to the
 * authorized document preview.
 * @param filePath - workspace-relative path from the file address.
 * @returns true when the document preview owns this file's rendering.
 */
export function isOfficePreviewPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0 || dot === filePath.length - 1) return false
  return OFFICE_PREVIEW_EXTENSIONS.has(filePath.slice(dot + 1).toLowerCase())
}

/**
 * Whether this Desktop viewer can serve an address.
 *
 * Only a session-scoped address with a real cwd is accepted. An absolute
 * address, malformed address, a session without a workspace, or an Office
 * document stays with the native document preview, which has its own
 * host-side authority path.
 * @param address - candidate resource address.
 * @param cwdOf - resolves the owning session's workspace root.
 * @returns true when the address has a session and that session has a cwd.
 */
export function canOpenDesktopFile(
  address: string,
  cwdOf: (sessionId: string) => string | undefined,
): boolean {
  const parsed = parseDesktopFileAddress(address)
  if (parsed === undefined) return false
  // External deliverables retain an absolute path. Use the Host read-only
  // preview instead of rebasing them onto this session's editable workspace.
  if (isAbsoluteWorkspacePath(parsed.path)) return false
  if (isOfficePreviewPath(parsed.path)) return false
  const cwd = cwdOf(parsed.sessionId)
  return cwd !== undefined && cwd !== ''
}

/**
 * Parse a concrete file that this editor can bind to a Session.
 * @param address - a persisted tab address or candidate resource address.
 * @returns session file parts, excluding page addresses and workspace roots.
 */
export function parseDesktopFileAddress(address: string): Extract<FileAddress, { scope: 'session' }> | undefined {
  const parsed = parseFileAddress(address)
  return parsed?.scope === 'session' && parsed.path !== '' ? parsed : undefined
}

/**
 * Name a file tab, or its directory fallback for an older empty viewer.
 * @param address - file resource or restored page address.
 * @param t - bound copy for this plugin.
 * @returns the filename or the shared Files title.
 */
export function desktopFileTitle(address: string, t: TranslateNS<'files'>): string {
  return parseDesktopFileAddress(address) === undefined ? t('type.label') : resourceTitle(address)
}

/**
 * Declare the Desktop file tree page type.
 * @param t - bound copy for this plugin.
 * @returns the registry definition.
 */
export function desktopFilesDefinition(t: TranslateNS<'files'>): SidebarRightTabDefinition {
  return {
    id: DESKTOP_FILES_ID,
    kind: DESKTOP_FILES_KIND,
    priority: 'extension',
    title: () => t('type.label'),
    guide: [{
      id: 'desktop-files',
      order: 10,
      title: () => t('guide.files.title'),
      description: () => t('guide.files.description'),
    }],
  }
}

/**
 * Declare the Desktop file-resource viewer.
 * @param t - bound copy for this plugin.
 * @param cwdOf - resolves a session's workspace root.
 * @returns the registry definition.
 */
export function desktopFileDefinition(
  t: TranslateNS<'files'>,
  cwdOf: (sessionId: string) => string | undefined,
): SidebarRightTabDefinition {
  return {
    id: DESKTOP_FILE_ID,
    kind: DESKTOP_FILE_KIND,
    keepMounted: true,
    patterns: ['dsh-resource://file/session/**'],
    priority: 'extension',
    canOpen: address => canOpenDesktopFile(address, cwdOf),
    title: address => desktopFileTitle(address, t),
  }
}

/**
 * The viewer's tab title: the decoded final address segment.
 * @param address - a file resource address.
 * @returns the basename, or the address when it has no usable final segment.
 */
export function resourceTitle(address: string): string {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) return address
  const segment = parsed.path.slice(parsed.path.lastIndexOf('/') + 1)
  if (segment === '') return address
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
