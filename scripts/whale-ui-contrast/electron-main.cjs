'use strict'
/**
 * Electron entry of the Whale UI contrast audit (started by scripts/audit-whale-ui-contrast.mjs).
 *
 * Loads the built viewer.html in a real Chromium frame the way the chat host does,
 * renders every audit page under each theme, and measures foreground/background
 * contrast of what the browser computed. Writes one JSON document to --out.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const programs = require('./programs.cjs')

const root = path.resolve(__dirname, '..', '..')
const flags = Object.fromEntries(process.argv.slice(2)
  .filter((arg) => arg.startsWith('--') && arg.includes('='))
  .map((arg) => [arg.slice(2, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]))
const viewerPath = path.resolve(flags.viewer || path.join(root, 'src', 'renderer', 'whale-ui', 'viewer.html'))
const outPath = flags.out
const shotsDir = flags.shots
const tokensPath = path.join(root, 'src', 'shared', 'dsh-webui-tokens.css')
const auditSource = fs.readFileSync(path.join(__dirname, 'audit-page.cjs'), 'utf8')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The opaque canvas the chat paints behind a transparent document: the desktop token mirror's page background. */
function hostBackdrops() {
  const css = fs.readFileSync(tokensPath, 'utf8')
  const values = [...css.matchAll(/--dsw-alias-bg-base:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)]
    .map((match) => ({ r: +match[1], g: +match[2], b: +match[3], a: 1 }))
  if (values.length !== 2) throw new Error(`expected a light and a dark --dsw-alias-bg-base in dsh-webui-tokens.css, found ${values.length}`)
  return { light: values[0], dark: values[1] }
}

function themeCases() {
  const backdrop = hostBackdrops()
  // The shell can make the page background transparent over a wallpaper; the document then inherits the backdrop colour.
  const transparent = { '--dsw-alias-bg-base': 'transparent' }
  return [
    { name: 'light', appearance: 'light', variables: {}, backdrop: backdrop.light },
    { name: 'dark', appearance: 'dark', variables: {}, backdrop: backdrop.dark },
    { name: 'light, transparent host', appearance: 'light', variables: transparent, backdrop: backdrop.light },
    { name: 'dark, transparent host', appearance: 'dark', variables: transparent, backdrop: backdrop.dark },
  ]
}

function writeHostPage(directory) {
  const file = path.join(directory, 'host.html')
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(tokensPath).href}"><style>html,body{margin:0;background:transparent}iframe{display:block;border:0;width:900px;height:3200px}</style>`
    + `<iframe id="viewer" name="whale-ui:audit" src="${pathToFileURL(viewerPath).href}"></iframe>`
    + `<script>window.__messages=[];addEventListener('message',function(e){if(e.source===document.getElementById('viewer').contentWindow)window.__messages.push(e.data)});`
    + `window.__variables=function(dark){var root=document.documentElement;root.toggleAttribute('data-ds-dark-theme',dark);var computed=getComputedStyle(root),out={};Array.from(computed).forEach(function(n){if(n.indexOf('--dsw-')===0)out[n]=computed.getPropertyValue(n).trim()});return out};`
    + `window.__send=function(m){document.getElementById('viewer').contentWindow.postMessage(Object.assign({channel:'whale-ui',version:2,instanceId:'audit'},m),'*')}</script>`)
  return file
}

/** Runs the audit module inside one frame without leaving globals behind. */
function inFrame(frame, call) {
  return frame.executeJavaScript(`(function(){${auditSource}\n;return ${call}})()`)
}

async function waitFor(check, what, timeout = 20000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${what}`)
    await sleep(100)
  }
}

async function auditPage(win, hostFile, theme, page) {
  await win.loadFile(hostFile)
  const host = win.webContents
  await waitFor(() => host.executeJavaScript('window.__messages.some(function(m){return m.type==="ready"})'), 'the viewer ready message')
  const hostVariables = await host.executeJavaScript(`window.__variables(${theme.appearance === 'dark'})`)
  await host.executeJavaScript(`window.__send(${JSON.stringify({
    type: 'render', program: page.program, language: page.language, streaming: false,
    state: {}, theme: { appearance: theme.appearance, variables: { ...hostVariables, ...theme.variables } }, locale: 'en',
  })})`)
  const viewer = host.mainFrame.frames[0]
  if (!viewer) throw new Error('the viewer frame did not load')
  await waitFor(() => host.executeJavaScript('window.__messages.some(function(m){return m.type==="diagnostics"&&m.complete})'), 'the page to render').catch(async (error) => {
    const sent = await host.executeJavaScript('JSON.stringify(window.__messages).slice(0, 1500)')
    const shown = await viewer.executeJavaScript('(document.getElementById("root")||{innerHTML:""}).innerHTML.slice(0, 600)')
    throw new Error(`${error.message}\nviewer messages: ${sent}\nroot html: ${shown}`)
  })
  await sleep(1500)

  const messages = await host.executeJavaScript('window.__messages')
  const diagnostics = messages.filter((m) => m.type === 'diagnostics').flatMap((m) => m.diagnostics)
  const options = JSON.stringify({ backdrop: theme.backdrop })
  const main = await inFrame(viewer, `auditContrast(${options})`)
  const backdrops = await inFrame(viewer, `frameBackdrops(${options})`)
  const frames = []
  for (const [index, child] of viewer.frames.entries()) {
    const result = await inFrame(child, `auditContrast(${JSON.stringify({ backdrop: backdrops[index] || theme.backdrop })})`)
    frames.push({ label: `HtmlView #${index + 1}`, ...result })
  }

  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true })
    const image = await host.capturePage()
    fs.writeFileSync(path.join(shotsDir, `${page.name}-${theme.name.replace(/\W+/g, '-')}.png`), image.toPNG())
  }
  return { theme: theme.name, appearance: theme.appearance, page: page.name, diagnostics, main, frames }
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-contrast-'))
  const win = new BrowserWindow({
    width: 900, height: 1200, show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  })
  try {
    if (!fs.existsSync(viewerPath)) throw new Error(`${viewerPath} is missing; run npm run prepare:whale-ui first`)
    const hostFile = writeHostPage(directory)
    const results = []
    for (const theme of themeCases()) {
      for (const page of programs) results.push(await auditPage(win, hostFile, theme, page))
    }
    return { viewer: viewerPath, results }
  } finally {
    win.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

app.whenReady().then(async () => {
  const watchdog = setTimeout(() => app.exit(3), 240000)
  let code = 0
  try {
    fs.writeFileSync(outPath, JSON.stringify(await run(), null, 2))
  } catch (error) {
    code = 2
    fs.writeFileSync(outPath, JSON.stringify({ error: error instanceof Error ? error.stack || error.message : String(error) }))
  }
  clearTimeout(watchdog)
  app.exit(code)
})
