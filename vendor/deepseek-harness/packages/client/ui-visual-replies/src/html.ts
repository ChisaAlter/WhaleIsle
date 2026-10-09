/** Prepare self-contained pages in the calling filesystem's execution world. */
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  MAX_HTML_INPUT_BYTES, MAX_LOCAL_IMAGE_BYTES, MAX_PREPARED_HTML_BYTES,
  VISUAL_REPLY_SIZE_MESSAGE, VISUAL_REPLY_THEME_MESSAGE,
} from './constants.ts'

const IMAGE_EXTENSIONS = 'png|jpe?g|gif|webp|svg|avif|bmp|ico'
// Match whole quoted absolute paths and unquoted CSS url(...) values. Remote
// URLs, protocol-relative URLs, and relative paths are not filesystem reads.
const LOCAL_IMAGES = new RegExp(
  String.raw`(["'\x60])((?:/(?!/)|[a-z]:[\\/])(?:(?!\1)[^\r\n]){0,2048}?\.(?:${IMAGE_EXTENSIONS}))\1`
  + String.raw`|url\(\s*((?:/(?!/)|[a-z]:[\\/])[^\s"'\x60()]{0,2048}?\.(?:${IMAGE_EXTENSIONS}))\s*\)`,
  'gid',
)

/** Identify actual image bytes instead of trusting a renamed file's extension. */
function imageMime(data: Uint8Array): string | undefined {
  const head = String.fromCharCode(...data.subarray(0, 12))
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  if (head.startsWith('\0\0\x01\0')) return 'image/x-icon'
  if (head.startsWith('BM') && head.slice(6, 10) === '\0\0\0\0') return 'image/bmp'
  if (/^ftyp(?:avif|avis|mif1)$/u.test(head.slice(4, 12))) return 'image/avif'
  const xml = new TextDecoder().decode(data.subarray(0, 4096))
  if (/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s/>]/u.test(xml)) return 'image/svg+xml'
  return undefined
}

const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

/** The same bridge runs in screenshots and in historical inline pages. */
const BOOTSTRAP = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<style>:root{color-scheme:dark;--bg:Canvas;--surface:Canvas;--accent:LinkText;--text:CanvasText;--text-secondary:GrayText;--background:Canvas;--border:GrayText}html,body{margin:0;background:transparent;color:var(--text);font-family:system-ui,sans-serif}body{overflow-x:hidden}*{box-sizing:border-box}</style>
<script>(()=>{
const sizeType=${JSON.stringify(VISUAL_REPLY_SIZE_MESSAGE)};
const themeType=${JSON.stringify(VISUAL_REPLY_THEME_MESSAGE)};
const measure=()=>{const body=document.body;if(!body)return 1;const children=[...body.children].filter(el=>!['SCRIPT','STYLE','LINK'].includes(el.tagName));const paddingBottom=parseFloat(getComputedStyle(body).paddingBottom)||0;const childBottom=children.reduce((height,el)=>Math.max(height,el.getBoundingClientRect().bottom+window.scrollY,el.scrollHeight),0);return Math.max(1,Math.ceil(Math.max(body.getBoundingClientRect().height,childBottom+paddingBottom)));};
window.__whaleVisualReplyHeight=measure;
let last=0;const report=()=>{const height=measure();if(height!==last){last=height;parent.postMessage({type:sizeType,height},'*');}};
addEventListener('message',event=>{if(event.source!==parent||event.data?.type!==themeType)return;const data=event.data;if(data.appearance==='light'||data.appearance==='dark')document.documentElement.style.colorScheme=data.appearance;for(const [key,value] of Object.entries(data.variables||{})){if(/^--[a-zA-Z0-9_-]+$/.test(key)&&typeof value==='string')document.documentElement.style.setProperty(key,value);}report();});
addEventListener('DOMContentLoaded',()=>{new ResizeObserver(report).observe(document.body);new MutationObserver(report).observe(document.body,{childList:true,subtree:true});report();document.fonts?.ready.then(report);});
})();</script>`

export async function prepareHtml(
  ctx: Context,
  exec: ToolRunContext,
  html: string,
  tolerateMissing: boolean,
): Promise<{ html: string; missingImages: string[] }> {
  if (!html.trim() || Buffer.byteLength(html, 'utf8') > MAX_HTML_INPUT_BYTES) {
    throw new Error(`html must be non-empty and at most ${MAX_HTML_INPUT_BYTES} UTF-8 bytes`)
  }
  exec.signal.throwIfAborted()
  const references = Array.from(html.matchAll(LOCAL_IMAGES)).flatMap(match => {
    const span = match.indices?.[2] ?? match.indices?.[3]
    return span === undefined ? [] : [{ start: span[0], end: span[1], path: html.slice(span[0], span[1]) }]
  })
  const replacements = new Map<string, string>()
  const missingImages: string[] = []
  let preparedBytes = Buffer.byteLength(html, 'utf8') + Buffer.byteLength(BOOTSTRAP, 'utf8')
  for (const rawPath of new Set(references.map(reference => reference.path))) {
    exec.signal.throwIfAborted()
    const filePath = /^[a-z]:/iu.test(rawPath) ? rawPath.replaceAll('\\\\', '\\') : rawPath
    let data: Uint8Array
    try {
      const cwd = exec.agent?.session.header.cwd
      const target = await ctx.fs.resolve(filePath, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
      const info = await ctx.fs.stat(target, exec.signal)
      if (info?.type !== 'file') throw new Error('image is not a regular file')
      if (info.size !== undefined && info.size > MAX_LOCAL_IMAGE_BYTES) throw new FsError(`Local image ${filePath} exceeds 10 MiB (${info.size} bytes); resize it or remove the reference.`, 'FS_TOO_LARGE')
      data = await ctx.fs.readBytes(target, exec.signal, MAX_LOCAL_IMAGE_BYTES)
      const mime = imageMime(data)
      if (mime === undefined) throw new Error('file bytes are not a supported image')
      replacements.set(rawPath, `data:${mime};base64,${Buffer.from(data).toString('base64')}`)
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
    } catch (error) {
      exec.signal.throwIfAborted()
      if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
        throw new FsError(`Local image ${filePath} exceeds 10 MiB; resize it or remove the reference.`, 'FS_TOO_LARGE', { cause: error })
      }
      missingImages.push(rawPath)
    }
    const embedded = replacements.get(rawPath)
    if (embedded !== undefined) {
      preparedBytes += references.filter(reference => reference.path === rawPath).length
        * (Buffer.byteLength(embedded) - Buffer.byteLength(rawPath))
      if (preparedBytes > MAX_PREPARED_HTML_BYTES) throw new Error(`Prepared HTML exceeds 25 MiB after embedding ${filePath}; reduce the images or page size.`)
    }
  }
  if (!tolerateMissing && missingImages.length > 0) {
    throw new Error(`Local images could not be embedded: ${missingImages.join(', ')}. Use readable absolute image paths, embed data: images, or remove the missing references.`)
  }
  const parts: string[] = []
  let cursor = 0
  for (const reference of references) {
    const replacement = replacements.get(reference.path)
    if (replacement === undefined) continue
    parts.push(html.slice(cursor, reference.start), replacement)
    cursor = reference.end
  }
  parts.push(html.slice(cursor))
  const inlined = parts.join('')
  // Start the parser's implicit head ourselves. A malformed page with a script
  // before its own <head> must still encounter the restrictive CSP first.
  const prepared = `<!doctype html>${BOOTSTRAP}${inlined.replace(/^\s*<!doctype[^>]*>/iu, '')}`
  if (Buffer.byteLength(prepared, 'utf8') > MAX_PREPARED_HTML_BYTES) throw new Error('prepared HTML exceeds 25 MiB')
  return { html: prepared, missingImages }
}
