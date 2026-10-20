/** Engines are host-supplied standalone IIFEs. No plugin or boot-graph lookup. */
export type GenuiAssetName = 'mermaid' | 'three' | 'echarts-core' | 'echarts-full' | 'icons'
export type GenuiAssetResolver = (filename: string) => string
let assetBase: string | undefined
let resolver: GenuiAssetResolver | undefined
let engineLoader: ((name: GenuiAssetName) => Promise<unknown>) | undefined
let bundleLoader: ((filename: string) => Promise<Uint8Array>) | undefined
const pending = new Map<string, Promise<unknown>>()

export function setGenuiAssetBase(baseURL: string): void {
  assetBase = new URL(baseURL, document.baseURI).href.replace(/\/?$/, '/')
}
/** May return a data: or blob: URL for an opaque sandbox. */
export function setGenuiAssetResolver(next: GenuiAssetResolver): void { resolver = next }
/** Optional direct factory hook for hosts that already own loaded engines. */
export function setGenuiAssetLoader(next: (name: GenuiAssetName) => Promise<unknown>): void { engineLoader = next }
/** Supplies engine/runtime bytes for self-contained HTML export. */
export function setGenuiBundleLoader(next: (filename: string) => Promise<Uint8Array>): void { bundleLoader = next }
export function assetUrl(file: string): string {
  if (resolver !== undefined) return resolver(file)
  if (assetBase !== undefined) return new URL(file, assetBase).href
  throw new Error(`GenUI asset URL is not configured: ${file}`)
}
export async function loadGenuiBundle(file: string): Promise<Uint8Array> {
  if (bundleLoader !== undefined) return bundleLoader(file)
  const response = await fetch(assetUrl(file))
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
function preloadedAsset(name: GenuiAssetName): unknown {
  const key = name.replace(/-(\w)/g, (_match, char: string) => char.toUpperCase())
  return (window as unknown as { __GenuiAssets__?: Record<string, unknown> }).__GenuiAssets__?.[key]
}
export function loadGenuiAsset<T>(name: GenuiAssetName): Promise<T> {
  const preloaded = preloadedAsset(name)
  if (preloaded !== undefined) return Promise.resolve(preloaded as T)
  const existing = pending.get(name)
  if (existing !== undefined) return existing as Promise<T>
  const task = engineLoader !== undefined ? engineLoader(name) : new Promise<T>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = assetUrl(`${name}.js`)
    script.async = true
    script.onload = () => {
      const api = preloadedAsset(name)
      if (api === undefined) reject(new Error(`GenUI ${name}.js registered no engine`))
      else resolve(api as T)
    }
    script.onerror = () => reject(new Error(`GenUI ${name}.js failed to load`))
    document.head.appendChild(script)
  })
  pending.set(name, task)
  return task as Promise<T>
}
