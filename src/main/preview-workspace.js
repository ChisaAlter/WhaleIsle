/** Loopback workspace file preview: GET-only, token-prefixed, cwd-confined. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pipeline } = require('node:stream');
const { loadWorkspaceAuthority } = require('./workspace-authority');

/** Byte cap for text-like documents (HTML/CSS/JS/JSON/SVG). */
const TEXT_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
/** Byte cap for binary documents (images, fonts, wasm, pdf, fallback). */
const BINARY_DOCUMENT_MAX_BYTES = 64 * 1024 * 1024;

const MIME = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

function mimeFor(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function maxBytesFor(mime) {
  const textLike = mime.startsWith('text/')
    || mime === 'application/xhtml+xml'
    || mime === 'application/json'
    || mime === 'image/svg+xml';
  return textLike ? TEXT_DOCUMENT_MAX_BYTES : BINARY_DOCUMENT_MAX_BYTES;
}

function hostIsLoopback(host) {
  if (typeof host !== 'string' || host.trim() === '') return false;
  const hostname = host.trim().split(':')[0].toLowerCase();
  return hostname === '127.0.0.1';
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function parseByteRange(header, size) {
  if (typeof header !== 'string' || header.trim() === '') return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return false;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      return false;
    }
    if (start >= size) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function isSandboxedDocumentMime(/** @type {string} */ mime) {
  return mime.startsWith('text/html')
    || mime === 'application/xhtml+xml'
    || mime === 'image/svg+xml';
}

/**
 * Serve workspace files on 127.0.0.1 behind an unguessable path token.
 * @param {{ authority?: { resolveInside: Function, resolveAuthorizedCwd: Function } }} [options]
 */
function createWorkspacePreviewController(options = {}) {
  const authority = options.authority ?? loadWorkspaceAuthority();
  const tokenTargets = new Map();
  const fileTokens = new Map();
  let server = null;
  let port = 0;
  let listening = null;

  function ensureListen() {
    if (listening) return listening;
    listening = new Promise((resolve, reject) => {
      server = http.createServer(handle);
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        port = address && typeof address === 'object' ? address.port : 0;
        resolve();
      });
    });
    return listening;
  }

  function handle(req, res) {
    if (req.method !== 'GET') {
      send(res, 405, 'Method Not Allowed', { Allow: 'GET' });
      return;
    }
    if (!hostIsLoopback(req.headers.host)) {
      send(res, 400, 'Bad Host');
      return;
    }
    let parsed;
    try {
      parsed = new URL(req.url, 'http://127.0.0.1');
    } catch {
      send(res, 400, 'Bad URL');
      return;
    }
    const segments = parsed.pathname.split('/').filter((part) => part.length > 0);
    const token = segments[0];
    let rest;
    try {
      rest = segments.slice(1).map((part) => decodeURIComponent(part));
    } catch {
      send(res, 400, 'Bad URL');
      return;
    }
    // Decode exactly once, then reject path separators and traversal before
    // giving the real filenames to the shared workspace authority.
    if (!token || rest.length === 0 || rest.some((part) => (
      part === '.' || part === '..' || /[\\/\0]/.test(part)
    ))) {
      send(res, 404, 'Not Found');
      return;
    }
    const entry = tokenTargets.get(token);
    if (entry === undefined) {
      send(res, 404, 'Not Found');
      return;
    }
    const relative = rest.join('/');
    if (relative !== entry.relativePath) {
      send(res, 404, 'Not Found');
      return;
    }
    const target = authority.resolveInside(entry.cwd, entry.relativePath);
    if (!target) {
      send(res, 404, 'Not Found');
      return;
    }
    void serveFile(req, res, target);
  }

  /**
   * Stream one resolved workspace file. Async stat + `pipeline` keep large
   * reads off the main-process event loop; per-MIME byte caps reject
   * oversized documents with 413 before any bytes are read.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} target - absolute path already confined to the cwd.
   */
  async function serveFile(req, res, target) {
    let stat;
    try {
      stat = await fs.promises.stat(target);
    } catch {
      send(res, 404, 'Not Found');
      return;
    }
    if (stat.isDirectory()) {
      send(res, 403, 'Forbidden');
      return;
    }
    const mime = mimeFor(target);
    if (stat.size > maxBytesFor(mime)) {
      send(res, 413, 'Payload Too Large');
      return;
    }
    const range = parseByteRange(req.headers.range, stat.size);
    if (range === false) {
      send(res, 416, 'Range Not Satisfiable', { 'Content-Range': `bytes */${stat.size}` });
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, stat.size - 1);
    const length = stat.size === 0 ? 0 : end - start + 1;
    res.writeHead(range ? 206 : 200, {
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': mime,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      ...(isSandboxedDocumentMime(mime) ? { 'Content-Security-Policy': 'sandbox' } : {}),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
    });
    if (stat.size === 0) {
      res.end();
      return;
    }
    pipeline(fs.createReadStream(target, { start, end }), res, (error) => {
      // A mid-stream read error cannot switch to an error status after the
      // 200 header; dropping the socket signals the truncated transfer.
      if (error) res.destroy();
    });
  }

  async function fileUrl(input = {}) {
    const cwd = input.cwd;
    const relativePath = input.relativePath;
    if (typeof relativePath !== 'string' || relativePath.trim() === '') {
      return { ok: false, message: 'File path is required.' };
    }
    const base = authority.resolveAuthorizedCwd(cwd);
    const target = authority.resolveInside(cwd, relativePath);
    if (!base || !target) {
      return { ok: false, message: 'Path is outside the workspace.' };
    }
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return { ok: false, message: 'File not found.' };
    }
    if (stat.isDirectory()) {
      return { ok: false, message: 'Directories cannot be previewed.' };
    }
    await ensureListen();
    const relative = path.relative(base, target).split(path.sep).join('/');
    const fileKey = process.platform === 'win32'
      ? `${base.toLowerCase()}\0${relative.toLowerCase()}`
      : `${base}\0${relative}`;
    let token = fileTokens.get(fileKey);
    if (token === undefined) {
      token = crypto.randomBytes(16).toString('base64url');
      fileTokens.set(fileKey, token);
      tokenTargets.set(token, { cwd: base, relativePath: relative });
    }
    const encoded = relative.split('/').map((part) => encodeURIComponent(part)).join('/');
    return { ok: true, url: `http://127.0.0.1:${port}/${token}/${encoded}` };
  }

  function close() {
    const current = server;
    server = null;
    port = 0;
    listening = null;
    tokenTargets.clear();
    fileTokens.clear();
    if (!current) return Promise.resolve();
    return new Promise((resolve) => {
      current.close(() => resolve());
    });
  }

  return { fileUrl, close };
}

module.exports = { createWorkspacePreviewController };
