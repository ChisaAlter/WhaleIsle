'use strict'
/*
 * Colour maths and the DOM walk behind `npm run qa:whale-contrast`.
 *
 * The file is injected as plain text into the Whale UI viewer frames (and the
 * HtmlView frames nested in them) and also `require`d by the unit tests, so it
 * must stay free of imports and use only `var` and function declarations at the
 * top level: re-evaluating it in the same frame must not redeclare anything.
 */

var CONTRAST_FAIL_BELOW = 3
var CONTRAST_AA_TEXT = 4.5
/** What Chromium paints a <select> popup over when neither the select nor the option brings an opaque background. */
var POPUP_FALLBACK = { r: 255, g: 255, b: 255, a: 1 }

function parseAlpha(text) {
  if (text === undefined) return 1
  return text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text)
}

/** Parses the forms getComputedStyle returns for sRGB colours; anything else yields null. */
function parseColor(text) {
  if (typeof text !== 'string') return null
  var value = text.trim().toLowerCase()
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  var rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value)
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: parseAlpha(rgb[4]) }
  var srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value)
  if (srgb) return { r: +srgb[1] * 255, g: +srgb[2] * 255, b: +srgb[3] * 255, a: parseAlpha(srgb[4]) }
  return null
}

function over(top, bottom) {
  var alpha = top.a + bottom.a * (1 - top.a)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  function mix(t, b) { return (t * top.a + b * bottom.a * (1 - top.a)) / alpha }
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: alpha }
}

/** A missing or unparsable computed number counts as the CSS default instead of turning a ratio into NaN, which would read as a pass. */
function numberOr(value, fallback) {
  var parsed = parseFloat(value)
  return isNaN(parsed) ? fallback : parsed
}

function withAlpha(color, factor) {
  return { r: color.r, g: color.g, b: color.b, a: color.a * factor }
}

function channelLuminance(value) {
  var scaled = value / 255
  return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
}

function luminance(color) {
  return 0.2126 * channelLuminance(color.r) + 0.7152 * channelLuminance(color.g) + 0.0722 * channelLuminance(color.b)
}

/** WCAG 2.x contrast ratio between two opaque colours. */
function contrastRatio(first, second) {
  var a = luminance(first)
  var b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** WCAG large text: 24px, or 18.66px and bold. */
function isLargeText(sizePx, weight) {
  return sizePx >= 24 || (sizePx >= 18.66 && weight >= 700)
}

/** Below 3:1 is unreadable (fail); normal text between 3:1 and 4.5:1 misses WCAG AA (warn). */
function classify(ratio, large) {
  if (ratio < CONTRAST_FAIL_BELOW) return 'fail'
  if (!large && ratio < CONTRAST_AA_TEXT) return 'warn'
  return 'ok'
}

/**
 * The popup list of a native <select> is its own surface: ancestors' backgrounds
 * never show through it. Chromium paints it with the option's background over the
 * select's own background over white.
 */
function popupBackground(optionBackground, selectBackground) {
  return over(optionBackground, over(selectBackground, POPUP_FALLBACK))
}

function rgbText(color) {
  return 'rgb(' + Math.round(color.r) + ', ' + Math.round(color.g) + ', ' + Math.round(color.b) + ')'
}

/** Any CSS colour syntax parseColor does not know is normalised to sRGB by a canvas. */
function resolveColor(value) {
  var parsed = parseColor(value)
  if (parsed) return parsed
  var context = resolveColor.context
  if (!context) {
    context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    resolveColor.context = context
  }
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = '#000'
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  var data = context.getImageData(0, 0, 1, 1).data
  return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 }
}

function ancestry(element) {
  var chain = []
  for (var node = element; node && node.nodeType === 1; node = node.parentElement) chain.unshift(node)
  return chain
}

/** Product of the opacity of an element and all its ancestors. */
function groupOpacity(element) {
  var factor = 1
  ancestry(element).forEach(function (node) { factor *= numberOr(getComputedStyle(node).opacity, 1) })
  return factor
}

/** The opaque colour a pixel of `element` shows: its ancestors' background layers over the host backdrop. */
function backgroundBehind(element, backdrop) {
  var accumulated = withAlpha(backdrop, 1)
  var gradient = false
  ancestry(element).forEach(function (node) {
    var style = getComputedStyle(node)
    if (style.backgroundImage && style.backgroundImage !== 'none') gradient = true
    var layer = resolveColor(style.backgroundColor)
    if (layer.a > 0) accumulated = over(withAlpha(layer, groupOpacity(node)), accumulated)
  })
  return { color: accumulated, gradient: gradient }
}

function describe(element) {
  var classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean) : []
  return element.tagName.toLowerCase() + classes.slice(0, 2).map(function (name) { return '.' + name }).join('')
}

function isRendered(element) {
  var style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || numberOr(style.opacity, 1) === 0) return false
  var box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}

var SKIPPED_TEXT_TAGS = /^(script|style|noscript|option|optgroup|select|textarea|datalist|title|desc|head)$/i
var NON_TEXT_INPUTS = /^(checkbox|radio|range|button|submit|reset|image|file|hidden|color)$/i

function ownText(element) {
  var text = ''
  element.childNodes.forEach(function (node) { if (node.nodeType === 3) text += node.textContent })
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Walks every rendered text-bearing element under `root` and measures its
 * foreground against the colour actually behind it. Controls are checked on their
 * value, placeholder and (for <select>) popup options. `backdrop` is the opaque
 * colour the transparent document sits on in the host.
 */
function auditContrast(options) {
  var backdrop = options.backdrop
  var root = document.documentElement
  var seen = {}
  var findings = []
  var checked = 0

  function measure(kind, element, text, foreground, background, extra) {
    var style = getComputedStyle(element)
    var size = parseFloat(style.fontSize)
    var large = isLargeText(size, parseInt(style.fontWeight, 10) || 400)
    var visible = over(foreground, background)
    var ratio = contrastRatio(visible, background)
    var severity = classify(ratio, large)
    checked++
    if (severity === 'ok') return
    var key = [kind, describe(element), rgbText(visible), rgbText(background)].join('|')
    if (seen[key]) { seen[key].count++; return }
    var finding = {
      kind: kind,
      severity: severity,
      selector: describe(element),
      text: text.slice(0, 40),
      foreground: rgbText(visible),
      background: rgbText(background),
      ratio: Math.round(ratio * 100) / 100,
      large: large,
      count: 1,
    }
    if (extra) Object.keys(extra).forEach(function (name) { finding[name] = extra[name] })
    seen[key] = finding
    findings.push(finding)
  }

  function textColor(element, property) {
    var color = resolveColor(getComputedStyle(element)[property])
    return withAlpha(color, groupOpacity(element))
  }

  root.querySelectorAll('*').forEach(function (element) {
    var tag = element.tagName.toLowerCase()
    if (element.closest(':disabled') || !isRendered(element)) return

    if (tag === 'select') {
      var behind = backgroundBehind(element, backdrop)
      var selected = element.selectedOptions[0]
      if (selected) measure('select-text', element, selected.textContent.trim(), textColor(element, 'color'), behind.color)
      var selectBackground = resolveColor(getComputedStyle(element).backgroundColor)
      Array.prototype.forEach.call(element.options, function (option) {
        var style = getComputedStyle(option)
        measure(
          'select-option', option, option.textContent.trim(), resolveColor(style.color),
          popupBackground(resolveColor(style.backgroundColor), selectBackground),
          { control: describe(element) },
        )
      })
      return
    }

    if (tag === 'input' || tag === 'textarea') {
      if (tag === 'input' && NON_TEXT_INPUTS.test(element.type)) return
      var field = backgroundBehind(element, backdrop)
      if (element.value) {
        measure('field-text', element, element.type === 'password' ? '••••' : element.value, textColor(element, 'color'), field.color)
      } else if (element.placeholder) {
        var placeholder = resolveColor(getComputedStyle(element, '::placeholder').color)
        measure('placeholder', element, element.placeholder, withAlpha(placeholder, groupOpacity(element)), field.color)
      }
      return
    }

    if (SKIPPED_TEXT_TAGS.test(tag)) return
    var text = ownText(element)
    if (!text) return
    var surface = backgroundBehind(element, backdrop)
    var svgText = tag === 'text' || tag === 'tspan'
    var color = svgText
      ? withAlpha(resolveColor(getComputedStyle(element).fill), numberOr(getComputedStyle(element).fillOpacity, 1) * groupOpacity(element))
      : textColor(element, 'color')
    measure(svgText ? 'svg-text' : 'text', element, text, color, surface.color, surface.gradient ? { gradient: true } : undefined)
  })

  return { checked: checked, findings: findings }
}

/** The opaque colour behind each HtmlView frame, in document order, for auditing the nested documents. */
function frameBackdrops(options) {
  return Array.prototype.map.call(document.querySelectorAll('iframe'), function (frame) {
    return backgroundBehind(frame, options.backdrop).color
  })
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    auditContrast, backgroundBehind, classify, contrastRatio, frameBackdrops, isLargeText,
    luminance, over, parseColor, popupBackground, rgbText,
  }
}
