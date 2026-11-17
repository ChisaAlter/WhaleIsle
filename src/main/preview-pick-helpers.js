'use strict';

const THEME_VARS = Object.freeze({
  radius: '--dshd-preview-radius',
  background: '--dshd-preview-background',
  foreground: '--dshd-preview-foreground',
  popover: '--dshd-preview-popover',
  popoverForeground: '--dshd-preview-popover-foreground',
  primary: '--dshd-preview-primary',
  primaryForeground: '--dshd-preview-primary-foreground',
  muted: '--dshd-preview-muted',
  mutedForeground: '--dshd-preview-muted-foreground',
  accent: '--dshd-preview-accent',
  accentForeground: '--dshd-preview-accent-foreground',
  border: '--dshd-preview-border',
  input: '--dshd-preview-input',
  ring: '--dshd-preview-ring',
  fontSans: '--dshd-preview-font-sans',
  fontMono: '--dshd-preview-font-mono',
});

const DEFAULT_ANNOTATION_THEME = Object.freeze({
  colorScheme: 'light',
  radius: '8px',
  background: 'rgb(255, 255, 255)',
  foreground: 'rgb(15, 17, 21)',
  popover: 'rgb(255, 255, 255)',
  popoverForeground: 'rgb(15, 17, 21)',
  primary: 'rgb(15, 17, 21)',
  primaryForeground: 'rgb(255, 255, 255)',
  muted: 'rgba(38, 49, 72, 0.06)',
  mutedForeground: 'rgb(97, 102, 107)',
  accent: 'rgba(38, 49, 72, 0.06)',
  accentForeground: 'rgb(15, 17, 21)',
  border: 'rgba(0, 0, 0, 0.1)',
  input: 'rgba(0, 0, 0, 0.1)',
  ring: 'rgb(65, 118, 230)',
  fontSans: 'system-ui, sans-serif',
  fontMono: 'ui-monospace, monospace',
});

const HTML_PREVIEW_CAP = 2000;

function escapeIdent(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/([^\w-])/g, '\\$1');
}

/**
 * CSS path: `#id` when present, otherwise a `tag:nth-of-type(n)` chain.
 * @param {{ id?: string, tagName?: string, parentElement?: object | null, children?: object[] }} element
 * @returns {string}
 */
function cssSelector(element) {
  if (!element || typeof element.tagName !== 'string') return '';
  if (element.id) return `#${escapeIdent(element.id)}`;
  const parts = [];
  let current = element;
  while (current && typeof current.tagName === 'string') {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html') break;
    if (current.id) {
      parts.unshift(`#${escapeIdent(current.id)}`);
      break;
    }
    const parent = current.parentElement;
    if (!parent || !parent.children) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
    const index = same.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
    if (tag === 'body') break;
  }
  return parts.join(' > ');
}

/**
 * Truncated outerHTML for the pick payload.
 * @param {{ outerHTML?: string }} element
 * @returns {string}
 */
function htmlPreview(element) {
  const html = element && typeof element.outerHTML === 'string' ? element.outerHTML : '';
  return html.length > HTML_PREVIEW_CAP ? html.slice(0, HTML_PREVIEW_CAP) : html;
}

/**
 * Apply annotation theme fields onto `--dshd-preview-*` host variables.
 * @param {{ style: { colorScheme?: string, setProperty: Function } }} host
 * @param {Record<string, string> | null | undefined} theme
 */
function applyAnnotationTheme(host, theme) {
  if (!theme || !host || !host.style || typeof host.style.setProperty !== 'function') return;
  if (typeof theme.colorScheme === 'string') host.style.colorScheme = theme.colorScheme;
  for (const [field, cssVar] of Object.entries(THEME_VARS)) {
    const value = theme[field];
    if (typeof value === 'string') host.style.setProperty(cssVar, value);
  }
}

/**
 * Local element context without react-grab.
 * @param {{ id?: string, tagName: string, parentElement?: object | null, outerHTML?: string }} element
 * @param {{ href?: string, title?: string }} [page]
 */
function captureElement(element, page) {
  const loc = page || (typeof location !== 'undefined' ? location : {});
  const doc = typeof document !== 'undefined' ? document : {};
  const pageUrl = typeof loc.href === 'string' ? loc.href : '';
  const rawTitle = typeof loc.title === 'string'
    ? loc.title
    : (typeof doc.title === 'string' ? doc.title : '');
  const pageTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;
  return {
    pageUrl,
    pageTitle,
    tagName: element.tagName.toLowerCase(),
    selector: cssSelector(element),
    htmlPreview: htmlPreview(element),
    componentName: null,
    source: null,
    stack: null,
    styles: '',
    pickedAt: new Date().toISOString(),
  };
}

function isStringOrNull(value) {
  return value === null || typeof value === 'string';
}

function isFiniteNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isPickedStackFrame(value) {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value;
  return (
    isStringOrNull(frame.functionName) &&
    isStringOrNull(frame.fileName) &&
    isFiniteNumberOrNull(frame.lineNumber) &&
    isFiniteNumberOrNull(frame.columnNumber)
  );
}

function isPickedElementPayload(value) {
  if (typeof value !== 'object' || value === null) return false;
  const c = value;
  if (typeof c.pageUrl !== 'string') return false;
  if (typeof c.tagName !== 'string') return false;
  if (typeof c.htmlPreview !== 'string') return false;
  if (typeof c.styles !== 'string') return false;
  if (typeof c.pickedAt !== 'string') return false;
  if (!isStringOrNull(c.pageTitle)) return false;
  if (!isStringOrNull(c.selector)) return false;
  if (!isStringOrNull(c.componentName)) return false;
  if (c.source !== null && !isPickedStackFrame(c.source)) return false;
  if (c.stack !== null && !Array.isArray(c.stack)) return false;
  if (Array.isArray(c.stack) && !c.stack.every(isPickedStackFrame)) return false;
  return true;
}

function isRect(value) {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value;
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
  );
}

function isPoint(value) {
  if (typeof value !== 'object' || value === null) return false;
  const point = value;
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y);
}

function isPreviewAnnotationPayload(value) {
  if (typeof value !== 'object' || value === null) return false;
  const annotation = value;
  if (typeof annotation.id !== 'string') return false;
  if (typeof annotation.pageUrl !== 'string') return false;
  if (!isStringOrNull(annotation.pageTitle)) return false;
  if (typeof annotation.comment !== 'string') return false;
  if (typeof annotation.createdAt !== 'string') return false;
  if (annotation.screenshot !== null) return false;
  const elements = annotation.elements;
  if (!Array.isArray(elements)) return false;
  if (!elements.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    return typeof entry.id === 'string' && isPickedElementPayload(entry.element) && isRect(entry.rect);
  })) {
    return false;
  }
  const regions = annotation.regions;
  if (!Array.isArray(regions)) return false;
  if (!regions.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    return typeof entry.id === 'string' && isRect(entry.rect);
  })) {
    return false;
  }
  const strokes = annotation.strokes;
  if (!Array.isArray(strokes)) return false;
  if (!strokes.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    return typeof entry.id === 'string'
      && typeof entry.color === 'string'
      && typeof entry.width === 'number'
      && Number.isFinite(entry.width)
      && Array.isArray(entry.points)
      && entry.points.every(isPoint)
      && isRect(entry.bounds);
  })) {
    return false;
  }
  const styleChanges = annotation.styleChanges;
  if (!Array.isArray(styleChanges)) return false;
  if (!styleChanges.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    return typeof entry.targetId === 'string'
      && isStringOrNull(entry.selector)
      && typeof entry.property === 'string'
      && typeof entry.previousValue === 'string'
      && typeof entry.value === 'string';
  })) {
    return false;
  }
  return true;
}

/**
 * Floor origin and ceil size; reject non-positive extents.
 * @param {unknown} value
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function normalizeCaptureRect(value) {
  if (typeof value !== 'object' || value === null) return null;
  const rect = value;
  const x = rect.x;
  const y = rect.y;
  const width = rect.width;
  const height = rect.height;
  if (
    typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof width !== 'number' || !Number.isFinite(width)
    || typeof height !== 'number' || !Number.isFinite(height)
    || width <= 0 || height <= 0
  ) {
    return null;
  }
  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
  };
}

module.exports = {
  DEFAULT_ANNOTATION_THEME,
  cssSelector,
  htmlPreview,
  applyAnnotationTheme,
  captureElement,
  isPreviewAnnotationPayload,
  normalizeCaptureRect,
};
