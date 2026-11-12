/** Consumer-owned navigation for Markdown links. */
import { createContext, useContext, useMemo } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import type { FileDragActions } from '../file-drag-actions.ts'
import type { ImageLightboxLabels } from '../ImageLightbox.tsx'

/**
 * Handle one sanitized absolute HTTP(S) URL selected from Markdown.
 * @param href - destination URL.
 */
export type MarkdownExternalLinkHandler = (href: string) => void

/** One rendered Markdown image offered for preview. */
export interface MarkdownPreviewImage {
  /** Displayable URL backing the rendered `<img>` (already past the protocol and vocabulary gates). */
  readonly src: string
  /** Authored alt text, possibly empty. */
  readonly alt: string
  /** Authored destination exactly as written. */
  readonly destination: string
}
/** Explicit object and viewport coordinates from the element owning a context gesture. */
export type MarkdownMenuTarget =
  | { kind: 'file'; path: string; line?: number }
  | { kind: 'url'; url: string }
  | { kind: 'image'; url: string; path?: string; name?: string; mediaType?: string }

/** Navigation capabilities supplied by the nearest Markdown owner. */
export interface MarkdownDelegate {
  /** Open an object menu without executing its normal activation. */
  readonly getTriggerProps?: ((target: MarkdownMenuTarget) => Pick<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onKeyDown' | 'tabIndex'>) | undefined
  /**
   * Image previews for decoded local paths in this owner's workspace. The renderer
   * appends a per-mount `load` query parameter to `api/file` route URLs.
   */
  readonly fileImages?: {
    fileDrag: FileDragActions
    resolve: (path: string) => string | undefined
    resourceAddress?: ((path: string) => string) | undefined
    labels: ImageLightboxLabels & { open: string; loading: string; failed: string }
  } | undefined
  /** Ordinary HTTP(S) activation; absent handlers retain native anchor behavior. */
  readonly openExternalLink?: MarkdownExternalLinkHandler | undefined
  /**
   * Open a decoded local destination from settled Markdown; absent handlers leave plain text.
   * @param path - Absolute or workspace-relative file path.
   * @param options - First line to reveal when the destination specifies a line or range.
   */
  readonly openFile?: ((path: string, options?: { line?: number }) => void) | undefined
  /**
   * Open the document-level preview for one rendered image; absent handlers keep
   * plain `<img>` output, and images inside links stay with the anchor's navigation.
   * @param image - The rendered image's resolved source and authored fields.
   */
  readonly openImage?: ((image: MarkdownPreviewImage) => void) | undefined
}

const MarkdownDelegateContext = createContext<MarkdownDelegate>({})

/** Props for one Markdown navigation scope. */
export interface MarkdownDelegateProviderProps extends MarkdownDelegate {
  readonly children: ReactNode
}

/**
 * Scope Markdown navigation without threading callbacks through renderers.
 * Nested providers replace the enclosing capabilities. Handler changes reach cached links.
 * @param props - Child tree and its file and HTTP(S) link handlers.
 * @returns the scoped child tree.
 */
export function MarkdownDelegateProvider({
  children,
  openExternalLink,
  openFile,
  openImage,
  fileImages,
  getTriggerProps,
}: MarkdownDelegateProviderProps): ReactNode {
  const delegate = useMemo(() => ({ openExternalLink, openFile, openImage, fileImages, getTriggerProps }),
    [openExternalLink, openFile, openImage, fileImages, getTriggerProps])
  return (
    <MarkdownDelegateContext.Provider value={delegate}>
      {children}
    </MarkdownDelegateContext.Provider>
  )
}

/**
 * Read the nearest Markdown navigation capabilities.
 * @returns Owner callbacks, or an empty delegate outside a provider.
 */
export function useMarkdownDelegate(): MarkdownDelegate {
  return useContext(MarkdownDelegateContext)
}
