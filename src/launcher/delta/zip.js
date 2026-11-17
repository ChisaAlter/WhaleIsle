'use strict';

// Minimal ZIP container (store + deflate) over node:zlib — no archive
// dependency exists in package.json and unzipper (transitive) is read-only,
// so the delta lane ships its own ~150-line reader/writer. Only what the
// delta format needs: UTF-8 names, no zip64 (<4 GiB payloads), no comments.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_UTF8 = 0x0800;
const MAX_ENTRIES = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(now = new Date()) {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { time, date };
}

/**
 * Write a zip archive. `entries`: [{ name, data } | { name, file }] — file
 * entries are read once, deflated when that actually shrinks, and appended
 * so peak memory stays at one file's contents.
 */
function writeZip(outFile, entries, deps = {}) {
  const fsx = deps.fs || fs;
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`zip entry count ${entries.length} exceeds limit`);
  }
  const fd = fsx.openSync(outFile, 'w');
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();
  try {
    for (const entry of entries) {
      const name = Buffer.from(String(entry.name), 'utf8');
      const raw = entry.data !== undefined
        ? Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
        : fsx.readFileSync(entry.file);
      const crc = crc32(raw);
      const deflated = zlib.deflateRawSync(raw, { level: 9 });
      const useDeflate = deflated.length < raw.length;
      const payload = useDeflate ? deflated : raw;
      const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;

      const local = Buffer.alloc(30);
      local.writeUInt32LE(SIG_LOCAL, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(FLAG_UTF8, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(payload.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      fsx.writeSync(fd, local);
      fsx.writeSync(fd, name);
      fsx.writeSync(fd, payload);
      central.push({ name, method, crc, compSize: payload.length, size: raw.length, offset });
      offset += 30 + name.length + payload.length;
    }
    const cdStart = offset;
    for (const row of central) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(SIG_CENTRAL, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(FLAG_UTF8, 8);
      cd.writeUInt16LE(row.method, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(row.crc, 16);
      cd.writeUInt32LE(row.compSize, 20);
      cd.writeUInt32LE(row.size, 24);
      cd.writeUInt16LE(row.name.length, 28);
      cd.writeUInt32LE(row.offset, 42);
      fsx.writeSync(fd, cd);
      fsx.writeSync(fd, row.name);
      offset += 46 + row.name.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(offset - cdStart, 12);
    eocd.writeUInt32LE(cdStart, 16);
    fsx.writeSync(fd, eocd);
  } finally {
    fsx.closeSync(fd);
  }
  return outFile;
}

/** Parse the central directory. Returns [{name, method, crc32, size, compressedSize, localOffset}]. */
function readZip(zipFile, deps = {}) {
  const fsx = deps.fs || fs;
  const stat = fsx.statSync(zipFile);
  const fd = fsx.openSync(zipFile, 'r');
  try {
    const tail = Buffer.alloc(Math.min(stat.size, 66 * 1024));
    fsx.readSync(fd, tail, 0, tail.length, Math.max(0, stat.size - tail.length));
    let eocdAt = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocdAt = i;
        break;
      }
    }
    if (eocdAt < 0) {
      throw new Error('not a zip archive (no end-of-central-directory)');
    }
    const count = tail.readUInt16LE(eocdAt + 10);
    const cdOffset = tail.readUInt32LE(eocdAt + 16);
    const cdSize = tail.readUInt32LE(eocdAt + 12);
    const cd = Buffer.alloc(cdSize);
    fsx.readSync(fd, cd, 0, cdSize, cdOffset);
    const entries = [];
    let at = 0;
    for (let i = 0; i < count; i += 1) {
      if (cd.readUInt32LE(at) !== SIG_CENTRAL) {
        throw new Error('corrupt central directory');
      }
      const method = cd.readUInt16LE(at + 10);
      const crc = cd.readUInt32LE(at + 16);
      const compSize = cd.readUInt32LE(at + 20);
      const size = cd.readUInt32LE(at + 24);
      const nameLen = cd.readUInt16LE(at + 28);
      const extraLen = cd.readUInt16LE(at + 30);
      const commentLen = cd.readUInt16LE(at + 32);
      const localOffset = cd.readUInt32LE(at + 42);
      const name = cd.slice(at + 46, at + 46 + nameLen).toString('utf8');
      entries.push({ name, method, crc32: crc, size, compressedSize: compSize, localOffset });
      at += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    fsx.closeSync(fd);
  }
}

function entryDataRange(zipFile, entry, deps = {}) {
  const fsx = deps.fs || fs;
  const fd = fsx.openSync(zipFile, 'r');
  try {
    const head = Buffer.alloc(30);
    fsx.readSync(fd, head, 0, 30, entry.localOffset);
    if (head.readUInt32LE(0) !== SIG_LOCAL) {
      throw new Error(`bad local header for ${entry.name}`);
    }
    const nameLen = head.readUInt16LE(26);
    const extraLen = head.readUInt16LE(28);
    const start = entry.localOffset + 30 + nameLen + extraLen;
    return { start, end: start + entry.compressedSize - 1 };
  } finally {
    fsx.closeSync(fd);
  }
}

function readEntry(zipFile, entry, deps = {}) {
  const fsx = deps.fs || fs;
  const range = entryDataRange(zipFile, entry, deps);
  const fd = fsx.openSync(zipFile, 'r');
  try {
    const raw = Buffer.alloc(entry.compressedSize);
    fsx.readSync(fd, raw, 0, entry.compressedSize, range.start);
    const data = entry.method === METHOD_DEFLATE
      ? zlib.inflateRawSync(raw)
      : entry.method === METHOD_STORE
        ? raw
        : (() => { throw new Error(`unsupported zip method ${entry.method} for ${entry.name}`); })();
    if (data.length !== entry.size || crc32(data) !== entry.crc32) {
      throw new Error(`crc32 mismatch on ${entry.name}`);
    }
    return data;
  } finally {
    fsx.closeSync(fd);
  }
}

/**
 * Stream one entry to `dest` — the inflate runs through zlib streams so a
 * multi-hundred-MB payload never lands in memory whole. CRC + declared size
 * are verified while writing; a mismatch deletes the partial and throws.
 */
async function extractEntryTo(zipFile, entry, dest, deps = {}) {
  const fsx = deps.fs || fs;
  const range = entryDataRange(zipFile, entry, deps);
  fsx.mkdirSync(path.dirname(dest), { recursive: true });
  if (entry.method !== METHOD_DEFLATE && entry.method !== METHOD_STORE) {
    throw new Error(`unsupported zip method ${entry.method} for ${entry.name}`);
  }
  // pipeline owns 'error' wiring for the whole chain and destroys every
  // stream on any failure; the only uncovered window is a synchronous throw
  // between createReadStream and the pipeline call (e.g. createWriteStream
  // failing on a read-only target), which must close the source itself —
  // destroy() alone still lets the pending open/read emit 'error', so a
  // listener is needed to keep it out of uncaughtException.
  const source = fsx.createReadStream(zipFile, { start: range.start, end: range.end });
  const decoded = entry.method === METHOD_DEFLATE ? zlib.createInflateRaw() : source;
  let out;
  try {
    out = fsx.createWriteStream(dest);
  } catch (error) {
    source.on('error', () => {});
    source.destroy();
    if (decoded !== source) decoded.destroy();
    throw error;
  }
  let size = 0;
  let crc = 0xffffffff;
  decoded.on('data', (chunk) => {
    size += chunk.length;
    crc = crc32Chunk(crc, chunk);
  });
  try {
    if (entry.method === METHOD_DEFLATE) {
      await pipeline(source, decoded, out);
    } else {
      await pipeline(source, out);
    }
  } catch (error) {
    try { fsx.unlinkSync(dest); } catch { /* partial already gone */ }
    throw error;
  }
  const actual = (crc ^ 0xffffffff) >>> 0;
  if (size !== entry.size || actual !== entry.crc32) {
    try { fsx.unlinkSync(dest); } catch { /* partial already gone */ }
    throw new Error(`crc32 mismatch on ${entry.name}`);
  }
  return dest;
}

// crc32 with a carry-in so streaming extract can fold chunks incrementally.
function crc32Chunk(crcIn, buf) {
  let crc = crcIn;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc;
}

module.exports = {
  METHOD_STORE,
  METHOD_DEFLATE,
  crc32,
  writeZip,
  readZip,
  readEntry,
  extractEntryTo,
};
