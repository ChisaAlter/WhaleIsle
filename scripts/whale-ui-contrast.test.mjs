import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { classify, formatReport, tally, verdict } from './whale-ui-contrast/report.mjs'

const require = createRequire(import.meta.url)
const audit = require('./whale-ui-contrast/audit-page.cjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const WHITE = { r: 255, g: 255, b: 255, a: 1 }
const NEAR_BLACK = { r: 21, g: 21, b: 23, a: 1 }
const NO_COLOR = { r: 0, g: 0, b: 0, a: 0 }

test('contrast ratio follows WCAG 2.x', () => {
  assert.equal(Math.round(audit.contrastRatio({ r: 0, g: 0, b: 0 }, WHITE) * 100) / 100, 21)
  assert.equal(audit.contrastRatio(WHITE, WHITE), 1)
  // The light-on-white option text from the dark-theme dropdown report.
  assert.ok(audit.contrastRatio({ r: 249, g: 250, b: 251 }, WHITE) < 1.1)
})

test('computed colour strings parse in every form Chromium returns', () => {
  assert.deepEqual(audit.parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 })
  assert.deepEqual(audit.parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 })
  assert.deepEqual(audit.parseColor('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 })
  assert.deepEqual(audit.parseColor('color(srgb 1 0 0 / 0.25)'), { r: 255, g: 0, b: 0, a: 0.25 })
  assert.deepEqual(audit.parseColor('transparent'), NO_COLOR)
  assert.equal(audit.parseColor('oklch(0.5 0.1 200)'), null)
})

test('only contrast below 3:1 fails; normal text under 4.5:1 warns; large text passes at 3:1', () => {
  assert.equal(audit.classify(2.9, false), 'fail')
  assert.equal(audit.classify(2.9, true), 'fail')
  assert.equal(audit.classify(3.5, false), 'warn')
  assert.equal(audit.classify(3.5, true), 'ok')
  assert.equal(audit.classify(4.5, false), 'ok')
  assert.equal(audit.isLargeText(24, 400), true)
  assert.equal(audit.isLargeText(19, 700), true)
  assert.equal(audit.isLargeText(19, 400), false)
})

test('a select popup is painted over white unless the option or the select brings an opaque background', () => {
  assert.deepEqual(audit.rgbText(audit.popupBackground(NO_COLOR, NO_COLOR)), 'rgb(255, 255, 255)')
  assert.deepEqual(audit.rgbText(audit.popupBackground(NEAR_BLACK, NO_COLOR)), 'rgb(21, 21, 23)')
  assert.deepEqual(audit.rgbText(audit.popupBackground(NO_COLOR, NEAR_BLACK)), 'rgb(21, 21, 23)')
  // A half-transparent select tints the white popup instead of replacing it.
  assert.deepEqual(audit.rgbText(audit.popupBackground(NO_COLOR, { r: 0, g: 0, b: 0, a: 0.5 })), 'rgb(128, 128, 128)')
})

let jsdom
try {
  jsdom = createRequire(path.join(root, 'src', 'whale-ui', 'package.json'))('jsdom')
} catch {
  jsdom = null
}

/** Runs the real DOM walk in jsdom; geometry is stubbed because jsdom lays nothing out. */
function auditHtml(html, backdrop = NEAR_BLACK) {
  const dom = new jsdom.JSDOM(`<!doctype html><html><body>${html}</body></html>`)
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 })
  const previous = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle }
  globalThis.document = dom.window.document
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  try {
    return audit.auditContrast({ backdrop })
  } finally {
    globalThis.document = previous.document
    globalThis.getComputedStyle = previous.getComputedStyle
    dom.window.close()
  }
}

test('text is measured against the layers behind it', { skip: !jsdom && 'jsdom is not installed' }, () => {
  const pale = auditHtml('<div style="background:rgb(255,255,255)"><p style="color:rgb(240,240,240)">pale</p></div>')
  assert.equal(pale.findings.length, 1)
  assert.equal(pale.findings[0].severity, 'fail')
  assert.equal(pale.findings[0].text, 'pale')
  const ink = auditHtml('<div style="background:rgb(255,255,255)"><p style="color:rgb(0,0,0)">ink</p></div>')
  assert.equal(ink.findings.length, 0)
  // Half-opaque black over white is mid grey: white text on it is readable but under AA.
  const tinted = auditHtml('<div style="background:rgba(0,0,0,0.5)"><p style="color:rgb(255,255,255)">tint</p></div>', WHITE)
  assert.deepEqual(tinted.findings.map((finding) => finding.severity), ['warn'])
})

test('a transparent select with theme-ink options is flagged, an opaque option background is not', { skip: !jsdom && 'jsdom is not installed' }, () => {
  // jsdom drops the declarations after a `background` shorthand, so the test spells out the longhand.
  const control = 'style="background-color:transparent;color:rgb(249,250,251)"'
  const broken = auditHtml(`<select ${control}><option>ESP32-S3</option><option>nRF52840</option></select>`)
  const options = broken.findings.filter((finding) => finding.kind === 'select-option')
  assert.equal(options.length, 1)
  assert.equal(options[0].count, 2)
  assert.equal(options[0].severity, 'fail')
  assert.equal(options[0].background, 'rgb(255, 255, 255)')
  // The closed select sits on the dark page, so its own text is fine.
  assert.equal(broken.findings.some((finding) => finding.kind === 'select-text'), false)

  const optionStyle = 'style="background-color:rgb(21,21,23);color:rgb(249,250,251)"'
  const fixed = auditHtml(`<select ${control}><option ${optionStyle}>ESP32-S3</option><option ${optionStyle}>nRF52840</option></select>`)
  assert.equal(fixed.findings.length, 0)
})

test('disabled and hidden elements are not measured', { skip: !jsdom && 'jsdom is not installed' }, () => {
  const result = auditHtml('<button disabled style="color:rgb(30,30,30)">off</button><p style="display:none;color:rgb(30,30,30)">gone</p>')
  assert.deepEqual(result.findings, [])
})

function finding(overrides) {
  return { kind: 'text', severity: 'fail', selector: 'p', text: 'Success', foreground: 'rgb(34, 197, 94)', background: 'rgb(255, 255, 255)', ratio: 2.28, large: false, count: 1, ...overrides }
}
function entry(overrides, findings) {
  return { theme: 'light', appearance: 'light', page: 'display', diagnostics: [], main: { checked: 10, findings }, frames: [], ...overrides }
}
const knownSuccess = { appearance: 'light', page: 'display', kind: 'text', text: 'Success', reason: 'no text variant yet' }

test('a recorded finding is reported as known and does not fail the run', () => {
  const result = { viewer: 'viewer.html', results: [entry({}, [finding({})])] }
  assert.deepEqual(tally(result, [knownSuccess]), { checked: 10, fail: 0, known: 1, warn: 0, diagnostics: 0, stale: 0 })
  assert.equal(verdict(result, { known: [knownSuccess] }).ok, true)
  assert.equal(verdict(result).ok, false)
  assert.match(formatReport(result, { known: [knownSuccess] }), /KNOWN {1}text .*"Success"/)
})

test('a known finding does not hide the same finding under the other appearance or on another page', () => {
  const dark = { viewer: 'viewer.html', results: [entry({ theme: 'dark', appearance: 'dark' }, [finding({})])] }
  assert.equal(verdict(dark, { known: [knownSuccess] }).ok, false)
  const elsewhere = { viewer: 'viewer.html', results: [entry({ page: 'controls' }, [finding({})])] }
  assert.equal(verdict(elsewhere, { known: [knownSuccess] }).ok, false)
})

test('a recorded finding that no longer reproduces is stale and fails only in strict mode', () => {
  const clean = { viewer: 'viewer.html', results: [entry({}, [])] }
  assert.equal(classify(clean, [knownSuccess]).stale.length, 1)
  assert.equal(verdict(clean, { known: [knownSuccess] }).ok, true)
  assert.equal(verdict(clean, { known: [knownSuccess], strict: true }).ok, false)
  assert.match(formatReport(clean, { known: [knownSuccess] }), /STALE known finding/)
})

test('warnings fail only in strict mode, page diagnostics and audit errors always fail', () => {
  const warned = { viewer: 'viewer.html', results: [entry({}, [finding({ severity: 'warn', ratio: 4 })])] }
  assert.equal(verdict(warned).ok, true)
  assert.equal(verdict(warned, { strict: true }).ok, false)
  const broken = { viewer: 'viewer.html', results: [entry({ diagnostics: [{ phase: 'parse', code: 'x', message: 'bad page' }] }, [])] }
  assert.equal(verdict(broken).ok, false)
  assert.match(formatReport(broken), /DIAG {2}parse\/x: bad page/)
  assert.equal(verdict({ error: 'boom' }).ok, false)
  assert.match(formatReport({ error: 'boom' }), /could not run/)
  assert.equal(verdict({ viewer: 'viewer.html', results: [] }).ok, false)
})
