// Bot avatar model: 28 mascots (8 WhaleIsle mascots W1–W8 + 20 classic mascots,
// 27 pickable + S2 retired), custom PNG upload validation, emoji compatibility,
// and initial fallback.

import {
  DEFAULT_BOT_AVATAR_COLOR,
  BOT_AVATAR_COLORS,
  BOT_AVATAR_COLOR_NAMES,
  TINT_MASCOT_SVG_CACHE_LIMIT,
  normalizeHexColor,
  isValidBotAvatarColor,
  relativeLuminance,
  isDarkBotAvatarColor,
  tintMascotSvg,
  clearTintMascotSvgCache,
  getTintMascotSvgCacheSize,
} from './bot-avatar-color.js';

export {
  DEFAULT_BOT_AVATAR_COLOR,
  BOT_AVATAR_COLORS,
  BOT_AVATAR_COLOR_NAMES,
  TINT_MASCOT_SVG_CACHE_LIMIT,
  normalizeHexColor,
  isValidBotAvatarColor,
  relativeLuminance,
  isDarkBotAvatarColor,
  tintMascotSvg,
  clearTintMascotSvgCache,
  getTintMascotSvgCacheSize,
};

/** The 8 WhaleIsle flagship mascots ("大肥鱼" family), shown first in pickers. */
export const WHALE_BOT_MASCOT_IDS = Object.freeze([
  'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8',
]);

/** Localized Chinese display labels for the 8 WhaleIsle mascots. */
export const WHALE_MASCOT_LABELS = Object.freeze({
  W1: '鲸鱼娘',
  W2: '蓝色大肥鱼',
  W3: '程序大肥鱼',
  W4: '皇冠大肥鱼',
  W5: '水手大肥鱼',
  W6: '干饭大肥鱼',
  W7: '星夜大肥鱼',
  W8: 'Q版鲸鱼娘',
});

/** Default mascot triad displayed in the empty-state onboarding card. */
export const EMPTY_CARD_MASCOT_IDS = Object.freeze(['W1', 'W2', 'W4']);

/** All 28 shipped mascots as `mascot:<id>` avatars; ids are stable across versions. */
export const BOT_MASCOT_IDS = Object.freeze([
  ...WHALE_BOT_MASCOT_IDS,
  'A1', 'B1', 'D1', 'E1', 'F1', 'G1', 'H1', 'H2', 'I1', 'J1',
  'K2', 'L2', 'M1', 'N1', 'O1', 'P3', 'Q1', 'R3', 'S2', 'T1',
]);

/** Retired from the picker; existing bots keep rendering it seamlessly. */
export const RETIRED_BOT_MASCOT_IDS = Object.freeze(['S2']);

/** The 27 mascots available for random selection and the avatar carousel. */
export const PICKABLE_BOT_MASCOT_IDS = Object.freeze(
  BOT_MASCOT_IDS.filter((id) => !RETIRED_BOT_MASCOT_IDS.includes(id)),
);

export const BOT_AVATAR_FILE = 'avatar.png';
export const BOT_AVATAR_SIZE = 512;
export const MAX_BOT_AVATAR_SIZE = 2000;
export const MAX_BOT_AVATAR_BYTES = 2 * 1024 * 1024;

export const BOT_AVATAR_SOURCE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);
export const MAX_BOT_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
export const MIN_BOT_AVATAR_SOURCE_SIDE = 128;

const MASCOT_PREFIX = 'mascot:';
const UPLOAD_PREFIX = 'upload:';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const IHDR_BYTES = [73, 72, 68, 82];

function readUint32Be(bytes, offset) {
  return (
    (((bytes[offset] << 24) >>> 0)
      | (bytes[offset + 1] << 16)
      | (bytes[offset + 2] << 8)
      | bytes[offset + 3]) >>> 0
  );
}

/** Pure-JS PNG IHDR dimension reader (zero Node/DOM dependency). */
export function readPngDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 24) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }
  if (readUint32Be(bytes, 8) !== 13) {
    return null;
  }
  for (let i = 0; i < IHDR_BYTES.length; i += 1) {
    if (bytes[12 + i] !== IHDR_BYTES[i]) {
      return null;
    }
  }
  const width = readUint32Be(bytes, 16);
  const height = readUint32Be(bytes, 20);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

/** True when `png` is a square PNG of 512..2000 px and at most 2 MB. */
export function isBotAvatarImage(png) {
  const size = readPngDimensions(png);
  return (
    size !== null
    && size.width === size.height
    && size.width >= BOT_AVATAR_SIZE
    && size.width <= MAX_BOT_AVATAR_SIZE
    && png.byteLength <= MAX_BOT_AVATAR_BYTES
  );
}

/**
 * Validates either a cropped PNG upload (`Uint8Array` or `{ bytes, requireCroppedPng: true }`)
 * or a source image drop/paste (`{ mimeType, byteLength, width, height }`).
 */
export function validateAvatarUpload(input) {
  if (input instanceof Uint8Array) {
    return validateCroppedPng(input);
  }
  if (!input || typeof input !== 'object') {
    return { ok: false, code: 'invalid_input', reason: 'Avatar upload input is required.' };
  }
  if (input.bytes instanceof Uint8Array && (input.requireCroppedPng || !input.mimeType)) {
    return validateCroppedPng(input.bytes);
  }
  return validateSourceAvatar(input);
}

function validateCroppedPng(bytes) {
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'empty', reason: 'Avatar image is empty.' };
  }
  if (bytes.byteLength > MAX_BOT_AVATAR_BYTES) {
    return { ok: false, code: 'too_large', reason: 'Avatar PNG must be at most 2 MB.' };
  }
  const size = readPngDimensions(bytes);
  if (!size) {
    return { ok: false, code: 'invalid_png', reason: 'Avatar upload must be a valid PNG image.' };
  }
  if (size.width !== size.height) {
    return { ok: false, code: 'not_square', reason: 'Avatar PNG must be square.' };
  }
  if (size.width < BOT_AVATAR_SIZE || size.width > MAX_BOT_AVATAR_SIZE) {
    return {
      ok: false,
      code: 'invalid_dimensions',
      reason: `Avatar PNG side must be between ${BOT_AVATAR_SIZE} and ${MAX_BOT_AVATAR_SIZE} px.`,
    };
  }
  return { ok: true, width: size.width, height: size.height, bytes: bytes.byteLength };
}

function validateSourceAvatar(input) {
  const mime = typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : '';
  if (!BOT_AVATAR_SOURCE_TYPES.has(mime)) {
    return {
      ok: false,
      code: 'unsupported_type',
      reason: 'Use a PNG, JPEG, WebP, GIF, or AVIF image (SVG is not allowed).',
    };
  }
  const byteLength = input.bytes instanceof Uint8Array ? input.bytes.byteLength : Number(input.byteLength ?? 0);
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return { ok: false, code: 'empty', reason: 'Source image is empty.' };
  }
  if (byteLength > MAX_BOT_AVATAR_SOURCE_BYTES) {
    return { ok: false, code: 'too_large', reason: 'Source image must be at most 10 MB.' };
  }
  const width = Number(input.width ?? 0);
  const height = Number(input.height ?? 0);
  if (width > 0 || height > 0) {
    if (Math.min(width, height) < MIN_BOT_AVATAR_SOURCE_SIDE) {
      return {
        ok: false,
        code: 'too_small',
        reason: `Source image short side must be at least ${MIN_BOT_AVATAR_SOURCE_SIDE} px.`,
      };
    }
  }
  return { ok: true, mimeType: mime, width, height, bytes: byteLength };
}

export function isBotMascotId(value) {
  return typeof value === 'string' && BOT_MASCOT_IDS.includes(value);
}

export function isPickableBotMascotId(value) {
  return typeof value === 'string' && PICKABLE_BOT_MASCOT_IDS.includes(value);
}

export function mascotAvatar(id) {
  return `${MASCOT_PREFIX}${id}`;
}

export function uploadAvatar(version) {
  return `${UPLOAD_PREFIX}${version}`;
}

export function isUploadAvatar(value) {
  return typeof value === 'string' && value.startsWith(UPLOAD_PREFIX);
}

/** Parses `mascot:<id>`, `upload:<version>`, legacy emoji, or returns `null` for empty/unknown mascot. */
export function parseBotAvatar(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  if (value.startsWith(MASCOT_PREFIX)) {
    const id = value.slice(MASCOT_PREFIX.length);
    return isBotMascotId(id) ? { kind: 'mascot', id } : null;
  }
  if (value.startsWith(UPLOAD_PREFIX)) {
    const version = value.slice(UPLOAD_PREFIX.length);
    return version ? { kind: 'upload', version } : null;
  }
  return { kind: 'emoji', emoji: value };
}

function extractMascotId(value) {
  if (isBotMascotId(value)) {
    return value;
  }
  const parsed = parseBotAvatar(value);
  return parsed?.kind === 'mascot' ? parsed.id : null;
}

function excludedMascotIds(current) {
  const excluded = new Set();
  if (Array.isArray(current) || current instanceof Set) {
    for (const entry of current) {
      const id = extractMascotId(entry);
      if (id) {
        excluded.add(id);
      }
    }
    return excluded;
  }
  const id = extractMascotId(current);
  if (id) {
    excluded.add(id);
  }
  return excluded;
}

/**
 * Picks a pickable mascot ID not in `current` (accepts raw ID, `mascot:<id>`, or an array/Set).
 * Prefers WhaleIsle mascots (`W1`–`W8`) and expands to all pickable mascots once all 8 are used.
 */
export function pickRandomMascot(current = null, random = Math.random) {
  const excluded = excludedMascotIds(current);
  const whalePool = WHALE_BOT_MASCOT_IDS.filter((id) => !excluded.has(id));
  const fullPool = PICKABLE_BOT_MASCOT_IDS.filter((id) => !excluded.has(id));
  const pool = whalePool.length > 0 ? whalePool : (fullPool.length > 0 ? fullPool : WHALE_BOT_MASCOT_IDS);
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index] ?? 'W1';
}

/** Returns `mascot:<id>` for a randomly chosen pickable mascot different from `current`. */
export function randomMascotAvatar(current = null, random = Math.random) {
  return mascotAvatar(pickRandomMascot(current, random));
}

/** What a client may set directly without going through avatar upload. */
export function isSettableBotAvatar(value) {
  return !isUploadAvatar(value) && (value === null || parseBotAvatar(value) !== null);
}

/** Single uppercase initial character for fallback tiles. */
export function botInitial(name) {
  if (typeof name !== 'string') {
    return '?';
  }
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

/** Legacy emoji if set, otherwise uppercase initial. */
export function botFallback(bot) {
  const parsed = parseBotAvatar(bot?.avatar ?? null);
  return parsed?.kind === 'emoji' ? parsed.emoji : botInitial(bot?.name ?? '');
}

/** Relative asset filenames for a mascot ID. */
export function getMascotAssetPaths(id, baseDir = '') {
  if (!isBotMascotId(id)) {
    return null;
  }
  const prefix = baseDir ? `${baseDir.replace(/\/+$/, '')}/` : '';
  return {
    id,
    svg: `${prefix}${id}.svg`,
    webp: `${prefix}${id}.webp`,
    rim: `${prefix}${id}-rim.webp`,
  };
}
