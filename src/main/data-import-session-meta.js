'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ZSTD_MAGIC = 0xFD2FB528;
const SESSION_PLAIN = /^session(?:\.v3)?\.jsonl$/i;
const SESSION_ZSTD = /^session(?:\.v3)?\.jsonl\.zstd$/i;
function emptySessionMeta() {
  return {
    id: '',
    cwd: '',
    title: '',
    createdAt: '',
    compressedLog: false,
  };
}

function idFromSessionRel(rel) {
  const text = String(rel || '');
  const slash = text.lastIndexOf('/');
  return slash === -1 ? text : text.slice(slash + 1);
}

/**
 * Fold one JSONL line into display meta. Last `session/title` wins.
 * @param {{ id: string, cwd: string, title: string, createdAt: string }} meta
 * @param {string} line
 */
function applySessionJsonlLine(meta, line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return;
  }
  if (!row || typeof row !== 'object') {
    return;
  }
  if (row.type === 'session') {
    if (typeof row.id === 'string' && row.id) {
      meta.id = row.id;
    }
    if (typeof row.cwd === 'string' && row.cwd) {
      meta.cwd = row.cwd;
    }
    if (typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)) {
      meta.createdAt = String(row.createdAt);
    } else if (typeof row.createdAt === 'string' && row.createdAt) {
      meta.createdAt = row.createdAt;
    }
    return;
  }
  if (row.type === 'session/title') {
    const title = row.data && typeof row.data.title === 'string'
      ? row.data.title
      : (typeof row.title === 'string' ? row.title : '');
    if (title.trim()) {
      meta.title = title.trim();
    }
  }
}

function foldSessionJsonlText(meta, text) {
  const chunks = String(text || '').split(/\n/);
  for (const line of chunks) {
    if (line) {
      applySessionJsonlLine(meta, line);
    }
  }
}

/**
 * Locate complete concatenated Zstandard frames (harness session layout).
 * Port of vendor scanZstdFrames; fail-soft callers catch thrown errors.
 * @param {Buffer} buffer
 * @returns {{ start: number, end: number }[]}
 */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      break;
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid zstd magic at ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) {
      break;
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`reserved zstd frame-header bit at ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      break;
    }
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) {
        return frames;
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) {
        throw new Error(`reserved zstd block type at ${offset - 3}`);
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        return frames;
      }
      offset += payloadBytes;
      if (lastBlock) {
        break;
      }
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        return frames;
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

function readPlainSessionMeta(file) {
  const meta = emptySessionMeta();
  try {
    foldSessionJsonlText(meta, fs.readFileSync(file, 'utf8'));
  } catch {
    // corrupt or unreadable log — keep empty meta
  }
  return meta;
}

function readZstdSessionMeta(file) {
  const meta = emptySessionMeta();
  meta.compressedLog = true;
  if (typeof zlib.zstdDecompressSync !== 'function') {
    return meta;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    return meta;
  }
  return foldZstdSessionMeta(meta, buffer);
}

function foldZstdSessionMeta(meta, buffer) {
  let frames;
  try {
    frames = scanZstdFrames(buffer);
  } catch {
    return meta;
  }
  if (!frames.length) {
    return meta;
  }
  meta.compressedLog = false;
  for (const frame of frames) {
    try {
      const text = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8');
      foldSessionJsonlText(meta, text);
    } catch {
      // skip one bad frame; keep prior meta
    }
  }
  return meta;
}

/**
 * Read display fields from a session dir without changing the import key (`rel`).
 * Prefers plaintext `session.jsonl`; otherwise uses Node built-in zstd (no extra dep).
 * @param {{ abs: string, rel: string, logs: string[], unsupported: boolean }} row
 */
function readSessionDisplayMeta(row) {
  if (!row || row.unsupported) {
    return {
      ...emptySessionMeta(),
      id: idFromSessionRel(row && row.rel),
    };
  }
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const plain = logs.find((name) => SESSION_PLAIN.test(name));
  if (plain) {
    const meta = readPlainSessionMeta(path.join(row.abs, plain));
    if (!meta.id) {
      meta.id = idFromSessionRel(row.rel);
    }
    return meta;
  }
  const zstd = logs.find((name) => SESSION_ZSTD.test(name));
  if (zstd) {
    const meta = readZstdSessionMeta(path.join(row.abs, zstd));
    if (!meta.id) {
      meta.id = idFromSessionRel(row.rel);
    }
    return meta;
  }
  return {
    ...emptySessionMeta(),
    id: idFromSessionRel(row.rel),
  };
}

async function readSessionDisplayMetaAsync(row) {
  if (!row || row.unsupported) return readSessionDisplayMeta(row);
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const plain = logs.find((name) => SESSION_PLAIN.test(name));
  const zstd = plain ? undefined : logs.find((name) => SESSION_ZSTD.test(name));
  const meta = emptySessionMeta();
  if (zstd) meta.compressedLog = true;
  if (plain || (zstd && typeof zlib.zstdDecompressSync === 'function')) {
    try {
      const buffer = await fs.promises.readFile(path.join(row.abs, plain || zstd));
      if (plain) foldSessionJsonlText(meta, buffer.toString('utf8'));
      else foldZstdSessionMeta(meta, buffer);
    } catch {
      // Keep the same fail-soft metadata as the synchronous import API.
    }
  }
  if (!meta.id) meta.id = idFromSessionRel(row.rel);
  return meta;
}

module.exports = { readSessionDisplayMeta, readSessionDisplayMetaAsync };
