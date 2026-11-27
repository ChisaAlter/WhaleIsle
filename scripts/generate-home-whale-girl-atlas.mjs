#!/usr/bin/env node
/**
 * Generate the monochromatic halftone/code atlas (`breach-atlas.webp`) featuring
 * Whale Girl (`assets/whale-running.webp`) for the blank-home PixelWhale layer.
 *
 * Channel encoding expected by `ui-brand-official/src/client/home-whale/`:
 * - R: halftone dot radius (`0..106`, max ~41% of cell so dots retain crisp air)
 * - G: opacity & code-mask alpha (`0..185`, keeps rendered contrast <= 100)
 * - B: 0 (unused, mirrors reference RG atlas layout)
 */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_WEBP = path.join(ROOT, 'assets', 'whale-running.webp');
const TARGET_ATLAS = path.join(
  ROOT,
  'vendor',
  'deepseek-harness',
  'packages',
  'client',
  'ui-brand-official',
  'src',
  'client',
  'assets',
  'breach-atlas.webp',
);

const ATLAS = { width: 192, height: 108, columns: 12, frames: 137 };
const ROWS = Math.ceil(ATLAS.frames / ATLAS.columns);
const SHEET_W = ATLAS.width * ATLAS.columns;
const SHEET_H = ATLAS.height * ROWS;
const SPRITE_SIZE = 94;
const CHANNELS = 3;
const MAX_RADIUS = 106;
const MAX_ALPHA = 185;

/** Resolve `sharp` from existing workspace packages without creating new caches. */
function loadSharp() {
  const candidates = [
    path.join(ROOT, 'vendor', 'dsh-im', 'package.json'),
    path.join(ROOT, 'vendor', 'deepseek-harness', 'apps', 'web', 'package.json'),
    path.join(ROOT, 'package.json'),
  ];
  for (const manifest of candidates) {
    try {
      const req = createRequire(manifest);
      return req('sharp');
    } catch {
      // Try next workspace manifest that carries sharp.
    }
  }
  throw new Error('Could not resolve sharp from existing workspace dependencies');
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {number} t */
function smoothstep(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Downsample each animated frame of `whale-running.webp` and encode halftone (R, G).
 * @param {any} sharp
 * @returns {Promise<Array<{ r: Uint8Array, g: Uint8Array, size: number }>>}
 */
async function buildEncodedSprites(sharp) {
  const meta = await sharp(SOURCE_WEBP, { animated: true }).metadata();
  const pageCount = meta.pages || 1;
  const pageH = meta.pageHeight || meta.height;
  const { data } = await sharp(SOURCE_WEBP, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const encoded = [];
  for (let p = 0; p < pageCount; p += 1) {
    const startByte = p * meta.width * pageH * 4;
    const endByte = startByte + meta.width * pageH * 4;
    const frameBuf = Buffer.from(data.subarray(startByte, endByte));
    const resized = await sharp(frameBuf, {
      raw: { width: meta.width, height: pageH, channels: 4 },
    })
      .resize(SPRITE_SIZE, SPRITE_SIZE, { kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    encoded.push(encodeSpriteHalftone(resized, SPRITE_SIZE));
  }
  return encoded;
}

/**
 * Compute Sobel edge magnitude and luma contrast so anime linework, eyes,
 * ahoge, maid frills, and whale tail stay legible in both dot and code modes.
 * @param {Uint8Array} rgba
 * @param {number} size
 * @returns {{ r: Uint8Array, g: Uint8Array, size: number }}
 */
function encodeSpriteHalftone(rgba, size) {
  const total = size * size;
  const lum = new Float32Array(total);
  const alpha = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const o = i * 4;
    const a = rgba[o + 3] / 255;
    alpha[i] = a;
    lum[i] = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
  }

  const r = new Uint8Array(total);
  const g = new Uint8Array(total);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = y * size + x;
      const a = alpha[idx];
      if (a < 0.08) continue;
      const edge = sampleEdgeStrength(lum, alpha, size, x, y);
      const tone = 1 - lum[idx];
      // Separate bright skin/lace from rich hair, eye pupils, apron whale, and outline.
      const shaded = Math.pow(tone, 1.18);
      const inkWeight = clamp(shaded * 0.78 + edge * 0.92, 0, 1);
      const radiusVal = clamp(Math.round((24 + inkWeight * 82) * a), 0, MAX_RADIUS);
      const alphaVal = clamp(Math.round((44 + inkWeight * 141) * Math.pow(a, 0.78)), 0, MAX_ALPHA);
      r[idx] = radiusVal;
      g[idx] = alphaVal;
    }
  }
  return { r, g, size };
}

/**
 * @param {Float32Array} lum
 * @param {Float32Array} alpha
 * @param {number} size
 * @param {number} x
 * @param {number} y
 */
function sampleEdgeStrength(lum, alpha, size, x, y) {
  /** @param {number} sx @param {number} sy */
  const sample = (sx, sy) => {
    const cx = clamp(sx, 0, size - 1);
    const cy = clamp(sy, 0, size - 1);
    const i = cy * size + cx;
    // Treat transparent perimeter as bright exterior so outer silhouette gets crisp edge.
    return 1 - (1 - lum[i]) * alpha[i];
  };
  const gx = sample(x + 1, y) - sample(x - 1, y);
  const gy = sample(x, y + 1) - sample(x, y - 1);
  return clamp(Math.hypot(gx, gy) * 1.9, 0, 1);
}

/**
 * Paint one halftone disk or soft droplet into an atlas frame cell.
 * @param {Uint8Array} sheet
 * @param {number} frameIndex
 * @param {number} cx
 * @param {number} cy
 * @param {number} radiusVal
 * @param {number} alphaVal
 */
function blendPixel(sheet, frameIndex, cx, cy, radiusVal, alphaVal) {
  const x = Math.round(cx);
  const y = Math.round(cy);
  if (x < 0 || x >= ATLAS.width || y < 0 || y >= ATLAS.height) return;
  if (alphaVal <= 3 || radiusVal <= 3) return;
  const fx = (frameIndex % ATLAS.columns) * ATLAS.width + x;
  const fy = Math.floor(frameIndex / ATLAS.columns) * ATLAS.height + y;
  const offset = (fy * SHEET_W + fx) * CHANNELS;
  if (radiusVal > sheet[offset]) sheet[offset] = clamp(Math.round(radiusVal), 0, MAX_RADIUS);
  if (alphaVal > sheet[offset + 1]) sheet[offset + 1] = clamp(Math.round(alphaVal), 0, MAX_ALPHA);
}

/**
 * Draw trailing ocean surf ripples & splash droplets beneath/behind Whale Girl.
 * @param {Uint8Array} sheet
 * @param {number} frameIndex
 * @param {number} runnerX
 * @param {number} baseY
 * @param {number} frameFade
 */
function drawWakeAndBubbles(sheet, frameIndex, runnerX, baseY, frameFade) {
  // Trailing double wave crest gliding under her feet & sweeping behind the whale tail.
  for (let step = 0; step < 72; step += 1) {
    const t = step / 71;
    const wx = runnerX + 8 - step * 1.45;
    if (wx < 0 || wx >= ATLAS.width) continue;
    const crest = Math.pow(Math.sin(t * Math.PI), 0.72);
    const wy = baseY + Math.sin(wx * 0.21 - frameIndex * 0.36) * 2.8 + t * 2.2;
    const rad = (46 + 44 * crest) * (0.45 + 0.55 * frameFade);
    const alp = (44 + 88 * crest) * frameFade;
    blendPixel(sheet, frameIndex, wx, wy, rad, alp);
    if (step % 2 === 0) {
      blendPixel(sheet, frameIndex, wx - 1, wy + 2.6, rad * 0.82, alp * 0.78);
    }
  }
  // Sparkling spray droplets arcing off her stride and tail fin.
  for (let b = 0; b < 14; b += 1) {
    const phase = (frameIndex * 0.17 + b * 0.29) % 1;
    const bx = runnerX - 4 - b * 5.8 - phase * 11;
    const by = baseY - 3 - Math.sin(phase * Math.PI) * (12 + (b % 4) * 5.5) - (b % 3) * 3;
    const fade = Math.sin(phase * Math.PI) * frameFade;
    blendPixel(sheet, frameIndex, bx, by, (62 + (b % 3) * 14) * fade, 118 * fade);
  }
}

/**
 * Composite one frame of the 137-frame Whale Girl breach sequence.
 * @param {Uint8Array} sheet
 * @param {Array<{ r: Uint8Array, g: Uint8Array, size: number }>} sprites
 * @param {number} f
 */
function renderAtlasFrame(sheet, sprites, f) {
  if (f === 0 || f >= 122) return;
  const activeEnd = 121;
  const fadeIn = smoothstep(f / 8);
  const fadeOut = 1 - smoothstep((f - 102) / (activeEnd - 102));
  const frameFade = fadeIn * fadeOut;
  if (frameFade <= 0.02) return;

  // Sweep left -> right across frames 1..114, keeping center-left at frame 36 (1.5s).
  const travel = (f - 1) / 112;
  const centerX = -22 + travel * (ATLAS.width + 58);
  const strideCycle = f * 0.42;
  const hopY = Math.abs(Math.sin(strideCycle)) * 4.5 + Math.sin(clamp(travel, 0, 1) * Math.PI) * 5.0;
  const spriteTop = 6 - hopY;
  const spriteLeft = Math.round(centerX - SPRITE_SIZE / 2);

  drawWakeAndBubbles(sheet, f, centerX, 82 - hopY * 0.35, frameFade);

  if (f > 115) return;
  const spriteIndex = Math.floor(f * 0.36) % sprites.length;
  const sprite = sprites[spriteIndex];
  for (let sy = 0; sy < sprite.size; sy += 1) {
    for (let sx = 0; sx < sprite.size; sx += 1) {
      const si = sy * sprite.size + sx;
      const g = sprite.g[si] * frameFade;
      const r = sprite.r[si] * (0.45 + 0.55 * frameFade);
      if (g > 3) {
        blendPixel(sheet, f, spriteLeft + sx, Math.round(spriteTop + sy), r, g);
      }
    }
  }
}

/**
 * Render simulated preview PNGs matching `renderer.ts` dot & code modes in light/dark themes.
 * @param {any} sharp
 * @param {Uint8Array} sheet
 * @param {string} previewDir
 */
async function writePreviewImages(sharp, sheet, previewDir) {
  await fs.mkdir(previewDir, { recursive: true });
  const sampleFrames = [36, 60, 84];
  const scale = 5;
  const w = ATLAS.width * scale;
  const h = ATLAS.height * scale;

  for (const frame of sampleFrames) {
    await writeDotPreview(sharp, sheet, frame, w, h, scale, path.join(previewDir, `dots-f${frame}-light.png`), false);
    await writeDotPreview(sharp, sheet, frame, w, h, scale, path.join(previewDir, `dots-f${frame}-dark.png`), true);
  }
}

/**
 * @param {any} sharp
 * @param {Uint8Array} sheet
 * @param {number} frame
 * @param {number} w
 * @param {number} h
 * @param {number} scale
 * @param {string} outPath
 * @param {boolean} dark
 */
async function writeDotPreview(sharp, sheet, frame, w, h, scale, outPath, dark) {
  const bg = dark ? [18, 20, 24] : [248, 249, 251];
  const ink = dark ? [168, 174, 184] : [102, 108, 118];
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    rgb[i * 3] = bg[0];
    rgb[i * 3 + 1] = bg[1];
    rgb[i * 3 + 2] = bg[2];
  }
  const ox = (frame % ATLAS.columns) * ATLAS.width;
  const oy = Math.floor(frame / ATLAS.columns) * ATLAS.height;
  for (let cy = 0; cy < ATLAS.height; cy += 1) {
    for (let cx = 0; cx < ATLAS.width; cx += 1) {
      const idx = ((oy + cy) * SHEET_W + (ox + cx)) * CHANNELS;
      const a = (sheet[idx + 1] / 255) * 0.65 * 0.8;
      if (a <= 0.008) continue;
      const rad = (sheet[idx] / 255) * scale;
      paintDiskRgb(rgb, w, h, (cx + 0.5) * scale, (cy + 0.5) * scale, rad, ink, a);
    }
  }
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(outPath);
}

/**
 * @param {Buffer} rgb
 * @param {number} w
 * @param {number} h
 * @param {number} px
 * @param {number} py
 * @param {number} rad
 * @param {number[]} ink
 * @param {number} alpha
 */
function paintDiskRgb(rgb, w, h, px, py, rad, ink, alpha) {
  const minX = clamp(Math.floor(px - rad - 0.5), 0, w - 1);
  const maxX = clamp(Math.ceil(px + rad + 0.5), 0, w - 1);
  const minY = clamp(Math.floor(py - rad - 0.5), 0, h - 1);
  const maxY = clamp(Math.ceil(py + rad + 0.5), 0, h - 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      const cov = clamp(rad + 0.5 - d, 0, 1);
      if (cov <= 0) continue;
      const a = alpha * cov;
      const o = (y * w + x) * 3;
      rgb[o] = Math.round(rgb[o] * (1 - a) + ink[0] * a);
      rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + ink[1] * a);
      rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + ink[2] * a);
    }
  }
}

async function main() {
  const previewIdx = process.argv.indexOf('--preview-dir');
  const previewDir = previewIdx >= 0 ? process.argv[previewIdx + 1] : null;
  const sharp = loadSharp();
  const sprites = await buildEncodedSprites(sharp);
  const sheet = new Uint8Array(SHEET_W * SHEET_H * CHANNELS);

  for (let f = 0; f < ATLAS.frames; f += 1) {
    renderAtlasFrame(sheet, sprites, f);
  }

  await sharp(sheet, { raw: { width: SHEET_W, height: SHEET_H, channels: CHANNELS } })
    .webp({ quality: 92, effort: 6, alphaQuality: 100 })
    .toFile(TARGET_ATLAS);

  const stat = await fs.stat(TARGET_ATLAS);
  console.log(`Generated Whale Girl atlas: ${TARGET_ATLAS} (${stat.size} bytes, ${SHEET_W}x${SHEET_H})`);
  if (previewDir) {
    await writePreviewImages(sharp, sheet, previewDir);
    console.log(`Preview PNGs written to: ${previewDir}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
