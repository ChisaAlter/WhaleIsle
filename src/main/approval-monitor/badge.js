'use strict';

/**
 * Zero-dependency badge PNG rasterizer (SDF anti-aliased pill + bitmap digits)
 * and cross-platform taskbar / tray / Dock badge presenter.
 */

const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Mirrors --dsw-static-red-600 so the badge matches the design system alert red.
const BADGE_FILL = [236, 19, 19, 255];
const BADGE_RIM = [255, 255, 255, 235];
const BADGE_TEXT = [255, 255, 255, 255];

/** @type {Readonly<Record<string, readonly string[]>>} */
const GLYPHS_3X5 = Object.freeze({
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
});

/** @type {Readonly<Record<string, readonly string[]>>} */
const GLYPHS_5X7 = Object.freeze({
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Encode a straight-alpha RGBA buffer into a valid PNG buffer.
 * @param {Uint8Array | Buffer} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function encodeRgbaPng(rgba, width, height) {
  const stride = width * 4;
  if (rgba.length !== stride * height) {
    throw new RangeError(`Expected ${stride * height} RGBA bytes, got ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dstOffset = y * (stride + 1);
    raw[dstOffset] = 0; // filter None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, dstOffset + 1);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {number} count
 * @returns {string}
 */
function formatBadgeText(count) {
  const n = Math.floor(Number(count) || 0);
  if (n <= 0) return '';
  return n > 99 ? '99+' : String(n);
}

/**
 * Porter-Duff source-over blend onto straight-alpha RGBA destination buffer.
 * @param {Uint8Array} dst
 * @param {number} offset
 * @param {number} sr
 * @param {number} sg
 * @param {number} sb
 * @param {number} sa01
 */
function blendPixel(dst, offset, sr, sg, sb, sa01) {
  if (sa01 <= 0) return;
  const da01 = dst[offset + 3] / 255;
  const outA = sa01 + da01 * (1 - sa01);
  if (outA <= 0) {
    dst[offset] = 0;
    dst[offset + 1] = 0;
    dst[offset + 2] = 0;
    dst[offset + 3] = 0;
    return;
  }
  const inv = 1 / outA;
  dst[offset] = Math.round((sr * sa01 + dst[offset] * da01 * (1 - sa01)) * inv);
  dst[offset + 1] = Math.round((sg * sa01 + dst[offset + 1] * da01 * (1 - sa01)) * inv);
  dst[offset + 2] = Math.round((sb * sa01 + dst[offset + 2] * da01 * (1 - sa01)) * inv);
  dst[offset + 3] = Math.round(outA * 255);
}

/**
 * Signed distance to an axis-aligned rounded box centered at origin.
 * @param {number} px
 * @param {number} py
 * @param {number} bx
 * @param {number} by
 * @param {number} radius
 * @returns {number}
 */
function sdRoundBox(px, py, bx, by, radius) {
  const qx = Math.abs(px) - bx;
  const qy = Math.abs(py) - by;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
function clamp01(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Draw an anti-aliased rounded pill with centered bitmap digits onto an RGBA buffer.
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {{ cx: number, cy: number, halfW: number, halfH: number, rimWidth: number, text: string, largeFont: boolean, textScale: number }} spec
 */
function drawBadgePill(rgba, width, height, spec) {
  const radius = Math.min(spec.halfW, spec.halfH);
  const bx = Math.max(0, spec.halfW - radius);
  const by = Math.max(0, spec.halfH - radius);

  const minX = Math.max(0, Math.floor(spec.cx - spec.halfW - 1));
  const maxX = Math.min(width - 1, Math.ceil(spec.cx + spec.halfW + 1));
  const minY = Math.max(0, Math.floor(spec.cy - spec.halfH - 1));
  const maxY = Math.min(height - 1, Math.ceil(spec.cy + spec.halfH + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dist = sdRoundBox(x + 0.5 - spec.cx, y + 0.5 - spec.cy, bx, by, radius);
      const outerCoverage = 1 - clamp01(-0.5, 0.5, dist);
      if (outerCoverage <= 0) continue;
      const offset = (y * width + x) * 4;
      if (spec.rimWidth > 0) {
        const innerCoverage = 1 - clamp01(-0.5, 0.5, dist + spec.rimWidth);
        const rimAlpha = outerCoverage * (BADGE_RIM[3] / 255);
        blendPixel(rgba, offset, BADGE_RIM[0], BADGE_RIM[1], BADGE_RIM[2], rimAlpha);
        if (innerCoverage > 0) {
          blendPixel(rgba, offset, BADGE_FILL[0], BADGE_FILL[1], BADGE_FILL[2], innerCoverage);
        }
      } else {
        blendPixel(rgba, offset, BADGE_FILL[0], BADGE_FILL[1], BADGE_FILL[2], outerCoverage);
      }
    }
  }

  const font = spec.largeFont ? GLYPHS_5X7 : GLYPHS_3X5;
  const glyphW = spec.largeFont ? 5 : 3;
  const glyphH = spec.largeFont ? 7 : 5;
  const scale = spec.textScale;
  const gap = Math.max(1, scale);
  const chars = [...spec.text];
  const totalW = chars.length * glyphW * scale + Math.max(0, chars.length - 1) * gap;
  const totalH = glyphH * scale;
  const startX = Math.round(spec.cx - totalW / 2);
  const startY = Math.round(spec.cy - totalH / 2);

  for (let idx = 0; idx < chars.length; idx += 1) {
    const bitmap = font[chars[idx]];
    if (!bitmap) continue;
    const gx = startX + idx * (glyphW * scale + gap);
    for (let row = 0; row < glyphH; row += 1) {
      const bits = bitmap[row];
      for (let col = 0; col < glyphW; col += 1) {
        if (bits[col] !== '1') continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const px = gx + col * scale + sx;
            const py = startY + row * scale + sy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const offset = (py * width + px) * 4;
            blendPixel(rgba, offset, BADGE_TEXT[0], BADGE_TEXT[1], BADGE_TEXT[2], 1);
          }
        }
      }
    }
  }
}

/**
 * Render a standalone Windows taskbar overlay badge PNG (16px or 32px).
 * @param {number} count
 * @param {number} [size]
 * @returns {Buffer}
 */
function renderOverlayBadgePng(count, size = 16) {
  const text = formatBadgeText(count);
  const rgba = new Uint8Array(size * size * 4);
  if (!text) return encodeRgbaPng(rgba, size, size);

  const isHiDpi = size >= 28;
  const useLargeFont = isHiDpi && text.length <= 2;
  const textScale = isHiDpi ? 2 : 1;
  const rimWidth = isHiDpi ? 1.5 : 0.85;
  const halfH = isHiDpi ? 14 : 7.2;
  const halfW = text.length >= 3 ? size / 2 - 0.5 : (isHiDpi && text.length === 2 ? 15 : halfH);

  drawBadgePill(rgba, size, size, {
    cx: size / 2,
    cy: size / 2,
    halfW,
    halfH,
    rimWidth,
    text,
    largeFont: useLargeFont,
    textScale,
  });
  return encodeRgbaPng(rgba, size, size);
}

/**
 * Convert Electron NativeImage `toBitmap()` (premultiplied BGRA) to straight RGBA.
 * @param {Buffer | Uint8Array} bgra
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function premultipliedBgraToStraightRgba(bgra, width, height) {
  const expected = width * height * 4;
  if (bgra.length !== expected) {
    throw new RangeError(`Expected ${expected} BGRA bytes, got ${bgra.length}`);
  }
  const rgba = new Uint8Array(expected);
  for (let i = 0; i < expected; i += 4) {
    const b = bgra[i];
    const g = bgra[i + 1];
    const r = bgra[i + 2];
    const a = bgra[i + 3];
    if (a === 0) {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    } else if (a === 255) {
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    } else {
      const inv = 255 / a;
      rgba[i] = Math.min(255, Math.round(r * inv));
      rgba[i + 1] = Math.min(255, Math.round(g * inv));
      rgba[i + 2] = Math.min(255, Math.round(b * inv));
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

/**
 * Composite a bottom-right numeric badge onto a cached tray bitmap (e.g. 24x24).
 * @param {{ width: number, height: number, bgra: Buffer | Uint8Array }} baseBitmap
 * @param {number} count
 * @returns {Buffer}
 */
function composeTrayBadgePng(baseBitmap, count) {
  const { width, height, bgra } = baseBitmap;
  const rgba = premultipliedBgraToStraightRgba(bgra, width, height);
  const text = formatBadgeText(count);
  if (!text) return encodeRgbaPng(rgba, width, height);

  const halfH = Math.min(height / 2 - 0.5, 6.2);
  const desiredHalfW = text.length === 1 ? halfH : text.length === 2 ? 7.8 : 9.2;
  const halfW = Math.min(width / 2 - 0.5, desiredHalfW);
  const cx = width - halfW - 0.5;
  const cy = height - halfH - 0.5;

  drawBadgePill(rgba, width, height, {
    cx,
    cy,
    halfW,
    halfH,
    rimWidth: 0.9,
    text,
    largeFont: false,
    textScale: 1,
  });
  return encodeRgbaPng(rgba, width, height);
}

/**
 * @param {number} count
 * @param {'zh' | 'en'} locale
 * @returns {{ tooltip: string, overlayDescription: string }}
 */
function formatBadgeLabels(count, locale) {
  if (count <= 0) {
    return { tooltip: 'Whale Isle', overlayDescription: '' };
  }
  if (locale === 'en') {
    const noun = count === 1 ? 'approval' : 'approvals';
    return {
      tooltip: `Whale Isle (${count} pending ${noun})`,
      overlayDescription: `${count} pending ${noun}`,
    };
  }
  return {
    tooltip: `Whale Isle（${count} 项待审批）`,
    overlayDescription: `${count} 项待审批`,
  };
}

/**
 * @param {object} deps
 * @param {string} [deps.platform]
 * @param {any} [deps.app]
 * @param {any} [deps.nativeImage]
 * @param {() => any} [deps.getMainWindow]
 * @param {() => ({ width: number, height: number, bgra: Buffer } | null)} [deps.getBaseTrayIcon]
 * @param {(indicator: { image?: any, tooltip?: string } | null) => void} [deps.setTrayBadge]
 * @param {() => 'zh' | 'en'} [deps.getLocale]
 */
function createBadgePresenter(deps = {}) {
  const platform = deps.platform || process.platform;
  const app = deps.app;
  const nativeImage = deps.nativeImage;
  const getMainWindow = deps.getMainWindow || (() => null);
  const getBaseTrayIcon = deps.getBaseTrayIcon || (() => null);
  const setTrayBadge = deps.setTrayBadge || (() => {});
  const getLocale = deps.getLocale || (() => 'zh');

  /** @type {Map<string, any>} */
  const overlayCache = new Map();
  /** @type {Map<string, any>} */
  const trayCache = new Map();
  let currentCount = 0;

  /** @param {number} count */
  function getOverlayImage(count) {
    const text = formatBadgeText(count);
    if (!text || !nativeImage) return null;
    const cached = overlayCache.get(text);
    if (cached) return cached;
    const png16 = renderOverlayBadgePng(count, 16);
    const png32 = renderOverlayBadgePng(count, 32);
    let img;
    if (typeof nativeImage.createEmpty === 'function') {
      img = nativeImage.createEmpty();
      if (typeof img.addRepresentation === 'function') {
        img.addRepresentation({ scaleFactor: 1, width: 16, height: 16, buffer: png16 });
        img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: png32 });
      } else {
        img = nativeImage.createFromBuffer(png16, { width: 16, height: 16 });
      }
    } else {
      img = nativeImage.createFromBuffer(png16, { width: 16, height: 16 });
    }
    overlayCache.set(text, img);
    return img;
  }

  /** @param {number} count */
  function getTrayBadgedImage(count) {
    const text = formatBadgeText(count);
    if (!text || !nativeImage) return null;
    const baseBitmap = getBaseTrayIcon();
    if (!baseBitmap || !baseBitmap.bgra || baseBitmap.width <= 0 || baseBitmap.height <= 0) {
      return null;
    }
    const cacheKey = `${baseBitmap.width}x${baseBitmap.height}:${text}`;
    const cached = trayCache.get(cacheKey);
    if (cached) return cached;
    const png = composeTrayBadgePng(baseBitmap, count);
    const img = nativeImage.createFromBuffer(png, { width: baseBitmap.width, height: baseBitmap.height });
    trayCache.set(cacheKey, img);
    return img;
  }

  /** @param {any} win */
  function applyOverlayToWindow(win) {
    if (platform !== 'win32' || !win || typeof win.setOverlayIcon !== 'function') return;
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
    const locale = getLocale();
    if (currentCount <= 0) {
      win.setOverlayIcon(null, '');
      return;
    }
    const img = getOverlayImage(currentCount);
    const { overlayDescription } = formatBadgeLabels(currentCount, locale);
    win.setOverlayIcon(img, overlayDescription);
  }

  /** @param {number} count */
  function applyCount(count) {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    currentCount = safeCount;
    const locale = getLocale();
    const text = formatBadgeText(safeCount);
    const { tooltip } = formatBadgeLabels(safeCount, locale);

    if (platform === 'win32') {
      applyOverlayToWindow(getMainWindow());
      if (safeCount <= 0) {
        setTrayBadge(null);
      } else {
        const image = getTrayBadgedImage(safeCount);
        setTrayBadge(image ? { image, tooltip } : { tooltip });
      }
      return;
    }

    if (platform === 'darwin') {
      if (app?.dock && typeof app.dock.setBadge === 'function') {
        app.dock.setBadge(text);
      }
      if (app && typeof app.setBadgeCount === 'function') {
        app.setBadgeCount(safeCount);
      }
      setTrayBadge(safeCount > 0 ? { tooltip } : null);
      return;
    }

    if (app && typeof app.setBadgeCount === 'function') {
      app.setBadgeCount(safeCount);
    }
    if (safeCount <= 0) {
      setTrayBadge(null);
    } else {
      const image = getTrayBadgedImage(safeCount);
      setTrayBadge(image ? { image, tooltip } : { tooltip });
    }
  }

  /** @param {any} [win] */
  function reapplyOverlay(win = getMainWindow()) {
    applyOverlayToWindow(win);
  }

  function clear() {
    applyCount(0);
  }

  return {
    applyCount,
    reapplyOverlay,
    clear,
    getCount: () => currentCount,
  };
}

module.exports = {
  formatBadgeText,
  formatBadgeLabels,
  encodeRgbaPng,
  premultipliedBgraToStraightRgba,
  renderOverlayBadgePng,
  composeTrayBadgePng,
  createBadgePresenter,
};
