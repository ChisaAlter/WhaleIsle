'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Codex pet atlases: v1 is a 1536x1872 sheet of 8x9 cells (192x208 each);
// the Desktop v2 sheet is 1536x2288 (8x11) with two extra look-direction rows.
const ATLASES = Object.freeze([
  Object.freeze({ version: 1, width: 1536, height: 1872, cols: 8, rows: 9 }),
  Object.freeze({ version: 2, width: 1536, height: 2288, cols: 8, rows: 11 }),
]);

/**
 * Directory Codex scans for community pets: `${CODEX_HOME:-~/.codex}/pets`.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homedir]
 * @returns {string}
 */
function codexPetsRoot(env = process.env, homedir = os.homedir()) {
  const home = typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim()
    ? env.CODEX_HOME.trim()
    : path.join(homedir, '.codex');
  return path.join(home, 'pets');
}

/**
 * Image size from a WebP RIFF header (VP8X / VP8L / VP8 lossy layouts).
 * Only the first 30 bytes are needed; anything else returns null.
 * @param {Buffer | null | undefined} buf
 * @returns {{ width: number, height: number } | null}
 */
function webpSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 30
    || buf.toString('latin1', 0, 4) !== 'RIFF'
    || buf.toString('latin1', 8, 12) !== 'WEBP') {
    return null;
  }
  const tag = buf.toString('latin1', 12, 16);
  if (tag === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (tag === 'VP8L') {
    if (buf[20] !== 0x2f) {
      return null;
    }
    const packed = buf.readUInt32LE(21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
  }
  if (tag === 'VP8 ') {
    if (buf.readUIntLE(23, 3) !== 0x2a019d) {
      return null;
    }
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/**
 * Match a pixel size to a supported Codex atlas layout.
 * @param {{ width: number, height: number } | null} size
 * @returns {{ version: number, width: number, height: number, cols: number, rows: number } | null}
 */
function atlasForSize(size) {
  if (!size) {
    return null;
  }
  return ATLASES.find((atlas) => atlas.width === size.width && atlas.height === size.height) || null;
}

/**
 * Resolve a manifest `spritesheetPath` inside its pet directory. Only safe
 * relative paths resolve; absolute paths and `..` escapes return null.
 * @param {string} petDir
 * @param {unknown} rel
 * @returns {string | null}
 */
function resolveSpritesheetPath(petDir, rel) {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    return null;
  }
  const resolved = path.resolve(petDir, rel);
  const root = path.resolve(petDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} file
 * @returns {{ [key: string]: unknown } | null}
 */
function readPetManifest(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}

/**
 * @param {string} file
 * @returns {Buffer | null}
 */
function readSheetHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64);
    const read = fs.readSync(fd, buf, 0, 64, 0);
    return buf.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Already closed.
      }
    }
  }
}

/**
 * Load one `<root>/<pet-id>/` entry. Invalid manifests, unsafe or missing
 * spritesheet paths, and atlases whose header size matches no supported
 * layout are ignored.
 * @param {string} petDir
 * @returns {{ id: string, displayName: string, description: string, kind: string,
 *   version: number, cols: number, rows: number, cellWidth: number, cellHeight: number,
 *   sheetPath: string } | null}
 */
function loadCodexPet(petDir) {
  const manifest = readPetManifest(path.join(petDir, 'pet.json'));
  if (!manifest) {
    return null;
  }
  const id = typeof manifest.id === 'string' && manifest.id.trim()
    ? manifest.id.trim()
    : path.basename(petDir);
  const sheetPath = resolveSpritesheetPath(petDir, manifest.spritesheetPath);
  if (!sheetPath) {
    return null;
  }
  const atlas = atlasForSize(webpSize(readSheetHeader(sheetPath)));
  if (!atlas) {
    return null;
  }
  return {
    id,
    displayName: typeof manifest.displayName === 'string' && manifest.displayName.trim()
      ? manifest.displayName.trim()
      : id,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    kind: typeof manifest.kind === 'string' ? manifest.kind : '',
    version: atlas.version,
    cols: atlas.cols,
    rows: atlas.rows,
    cellWidth: atlas.width / atlas.cols,
    cellHeight: atlas.height / atlas.rows,
    sheetPath,
  };
}

/**
 * Scan the Codex pets root. A missing or unreadable root yields an empty
 * list; entries sort by id for a stable picker order.
 * @param {{ root?: string }} [options]
 * @returns {NonNullable<ReturnType<typeof loadCodexPet>>[]}
 */
function discoverCodexPets(options = {}) {
  const root = options.root || codexPetsRoot();
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const pets = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pet = loadCodexPet(path.join(root, entry.name));
    if (pet) {
      pets.push(pet);
    }
  }
  pets.sort((a, b) => a.id.localeCompare(b.id));
  return pets;
}

module.exports = {
  codexPetsRoot,
  webpSize,
  atlasForSize,
  resolveSpritesheetPath,
  loadCodexPet,
  discoverCodexPets,
};
