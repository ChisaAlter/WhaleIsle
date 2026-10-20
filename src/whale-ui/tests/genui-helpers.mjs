import { createRequire, Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
export const packageRoot = fileURLToPath(new URL('..', import.meta.url))
export const requireGenui = createRequire(new URL('../package.json', import.meta.url))
export const esbuild = requireGenui('esbuild')
export const React = requireGenui('react')
export const { JSDOM } = requireGenui('jsdom')

/** Bundle the actual TS/TSX implementation in memory; only CSS class maps are mocked. */
export async function loadGenui(exportsSource, additionalPlugins = []) {
  const result = await esbuild.build({
    absWorkingDir: packageRoot,
    stdin: { contents: exportsSource, resolveDir: packageRoot, sourcefile: 'genui-probe.tsx', loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
    packages: 'external',
    plugins: [...additionalPlugins, { name: 'test-css-modules', setup(build) {
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get:(_,key)=>key})', loader: 'js' }))
    } }],
  })
  const filename = path.join(packageRoot, 'genui-probe.cjs')
  const compiled = new Module(filename)
  compiled.filename = filename
  compiled.paths = Module._nodeModulePaths(packageRoot)
  compiled._compile(result.outputFiles[0].text, filename)
  return compiled.exports
}

export function installDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://whale.invalid/viewer/' })
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'getComputedStyle']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 1)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  return { dom, container: dom.window.document.querySelector('#root'), restore() {
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  } }
}
export function changeInput(input, value) {
  const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
}
