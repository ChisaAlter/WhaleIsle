'use strict';

const { StringDecoder } = require('node:string_decoder');

/**
 * Streaming UTF-8 line buffer using StringDecoder so multi-byte characters and
 * readiness lines split across stdout/stderr chunks are decoded intact.
 * @param {(line: string) => void} onLine
 */
function createLineBuffer(onLine) {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  /**
   * @param {string} text
   */
  const drain = (text) => {
    if (!text) return;
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      onLine(line);
    }
  };

  return {
    /**
     * @param {string | Buffer | Uint8Array | null | undefined} chunk
     */
    push(chunk) {
      if (chunk === undefined || chunk === null) return;
      const text = typeof chunk === 'string'
        ? chunk
        : decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      drain(text);
    },
    flush() {
      const tail = decoder.end();
      if (tail) pending += tail;
      if (pending) {
        const last = pending;
        pending = '';
        onLine(last);
      }
    },
  };
}

/**
 * Bind a streaming UTF-8 line buffer to a readable child stdio stream.
 * @param {import('node:stream').Readable | null | undefined} stream
 * @param {(line: string) => void} onLine
 */
function attachLineStream(stream, onLine) {
  if (!stream) return null;
  const buffer = createLineBuffer(onLine);
  stream.on('data', (chunk) => buffer.push(chunk));
  stream.once('end', () => buffer.flush());
  return buffer;
}

module.exports = { createLineBuffer, attachLineStream };
