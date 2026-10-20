import { GenuiExportError, type GenuiArtifactV1 } from './types.ts'
import { serializeGenuiArtifact } from './json.ts'
import { buildStandaloneHtml } from './html.ts'

export type GenuiDownloadHandler = (blob: Blob, filename: string) => Promise<void>
let hostDownload: GenuiDownloadHandler | undefined
/** Opaque iframe hosts forward bytes through their existing download bridge. */
export function setGenuiDownloadHandler(handler: GenuiDownloadHandler): void { hostDownload = handler }
export function sanitizeArtifactFilename(title: string | undefined, extension: '.html' | '.genui.json'): string {
  const base = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 120).replace(/[. ]+$/g, '')
  return `${base || 'genui'}${extension}`
}
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (hostDownload !== undefined) return hostDownload(blob, filename)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.style.display = 'none'
  document.body.appendChild(anchor)
  try { anchor.click() } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0) }
}
export async function downloadGenuiArtifactJson(artifact: GenuiArtifactV1): Promise<void> {
  try { await downloadBlob(new Blob([serializeGenuiArtifact(artifact)], { type: 'application/json;charset=utf-8' }), sanitizeArtifactFilename(artifact.spec.title, '.genui.json')) }
  catch (error) { throw new GenuiExportError('download-failed', error instanceof Error ? error.message : 'artifact download failed') }
}
export async function downloadGenuiArtifactHtml(artifact: GenuiArtifactV1): Promise<void> {
  try {
    const html = await buildStandaloneHtml(artifact)
    await downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), sanitizeArtifactFilename(artifact.spec.title, '.html'))
  } catch (error) {
    if (error instanceof GenuiExportError) throw error
    throw new GenuiExportError('download-failed', error instanceof Error ? error.message : 'artifact download failed')
  }
}
