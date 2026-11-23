// Mascot avatar tile colors, luminance detection, and SVG tinting with LRU cache.

export const DEFAULT_BOT_AVATAR_COLOR = '#b3dbf4';

export const BOT_AVATAR_COLORS = Object.freeze([
  DEFAULT_BOT_AVATAR_COLOR,
  '#ffffff',
  '#c9b8e8',
  '#f4c4cf',
  '#f8cfa8',
  '#f6e3a1',
  '#c5dfb5',
  '#b5e3d8',
  '#8fa3b8',
  '#3a3f4b',
  '#1f2126',
]);

export const BOT_AVATAR_COLOR_NAMES = Object.freeze({
  '#b3dbf4': 'bots.new.colorSky',
  '#ffffff': 'bots.new.colorWhite',
  '#c9b8e8': 'bots.new.colorLavender',
  '#f4c4cf': 'bots.new.colorPink',
  '#f8cfa8': 'bots.new.colorPeach',
  '#f6e3a1': 'bots.new.colorButter',
  '#c5dfb5': 'bots.new.colorSage',
  '#b5e3d8': 'bots.new.colorMint',
  '#8fa3b8': 'bots.new.colorSlate',
  '#3a3f4b': 'bots.new.colorGraphite',
  '#1f2126': 'bots.new.colorInk',
});

export const TINT_MASCOT_SVG_CACHE_LIMIT = 200;

const HEX_6_RE = /^#([0-9a-f]{6})$/i;
const HEX_3_RE = /^#([0-9a-f]{3})$/i;
const AVATAR_BG_VAR = `var(--avatar-bg,${DEFAULT_BOT_AVATAR_COLOR})`;
const AVATAR_RIM_VAR = 'var(--avatar-rim,0)';

const tintCache = new Map();

/**
 * Normalizes a CSS hex color (`#rgb`, `#rrggbb`, or without leading `#`) into lowercase `#rrggbb`.
 * Returns `null` if invalid.
 */
export function normalizeHexColor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const full = HEX_6_RE.exec(candidate);
  if (full) {
    return `#${full[1].toLowerCase()}`;
  }
  const short = HEX_3_RE.exec(candidate);
  if (short) {
    const [r, g, b] = short[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

export function isValidBotAvatarColor(value) {
  return typeof value === 'string' && HEX_6_RE.test(value);
}

function linearizeChannel(hexPair) {
  const c = Number.parseInt(hexPair, 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Computes WCAG relative luminance for a `#rrggbb` color.
 * Returns `null` when the input is not a valid hex color.
 */
export function relativeLuminance(color) {
  const hex = normalizeHexColor(color);
  if (!hex) {
    return null;
  }
  const r = linearizeChannel(hex.slice(1, 3));
  const g = linearizeChannel(hex.slice(3, 5));
  const b = linearizeChannel(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * True when the background color is dark enough (relative luminance < 0.18)
 * that a dark mascot needs the light rim glow enabled.
 */
export function isDarkBotAvatarColor(color) {
  const luminance = relativeLuminance(color);
  return luminance !== null && luminance < 0.18;
}

function hashSvgKey(svgText) {
  let hash = 2166136261;
  for (let i = 0; i < svgText.length; i += 1) {
    hash ^= svgText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${svgText.length}:${(hash >>> 0).toString(36)}`;
}

function applyMascotTint(svgText, hexColor) {
  const bgReplaced = svgText.replaceAll(AVATAR_BG_VAR, hexColor);
  const rimValue = isDarkBotAvatarColor(hexColor) ? '1' : '0';
  return bgReplaced.replaceAll(AVATAR_RIM_VAR, rimValue);
}

/**
 * Tints an Orca mascot SVG string by replacing `var(--avatar-bg,#b3dbf4)` and
 * `var(--avatar-rim,0)` with concrete values, backed by a 200-entry LRU cache.
 *
 * @param {string} svgText Raw mascot SVG source
 * @param {string | null | undefined} color Target hex color (defaults to `#b3dbf4`)
 * @param {{ asDataUri?: boolean, cacheKey?: string }} [options]
 * @returns {string}
 */
export function tintMascotSvg(svgText, color = DEFAULT_BOT_AVATAR_COLOR, options = {}) {
  if (typeof svgText !== 'string') {
    return '';
  }
  const hex = normalizeHexColor(color) ?? DEFAULT_BOT_AVATAR_COLOR;
  const asDataUri = options.asDataUri === true;
  const baseKey = options.cacheKey ? `${options.cacheKey}|${hex}` : `${hashSvgKey(svgText)}|${hex}`;
  const fullKey = `${baseKey}|${asDataUri ? 'uri' : 'svg'}`;

  const hit = tintCache.get(fullKey);
  if (hit !== undefined) {
    tintCache.delete(fullKey);
    tintCache.set(fullKey, hit);
    return hit;
  }

  const tinted = applyMascotTint(svgText, hex);
  const result = asDataUri ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}` : tinted;
  tintCache.set(fullKey, result);
  if (tintCache.size > TINT_MASCOT_SVG_CACHE_LIMIT) {
    const oldest = tintCache.keys().next();
    if (!oldest.done) {
      tintCache.delete(oldest.value);
    }
  }
  return result;
}

export function clearTintMascotSvgCache() {
  tintCache.clear();
}

export function getTintMascotSvgCacheSize() {
  return tintCache.size;
}
