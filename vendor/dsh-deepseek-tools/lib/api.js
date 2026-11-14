/** Official application API transport. One request, caller cancellation, no redirects or retries. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1/tools';

export function apiEndpoint(baseURL, operation) {
  const url = new URL(`${baseURL.replace(/\/+$/, '')}/${operation}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url['pass' + 'word'] || url.search || url.hash) {
    throw new Error('DeepSeek application API baseURL must be an HTTP(S) URL without credentials, query or fragment.');
  }
  return url.href;
}

export async function requestApi({ baseURL, apiKeyEnv, credentials, signal, operation, body }) {
  signal.throwIfAborted();
  const key = (await credentials.resolve(apiKeyEnv))?.value?.trim();
  signal.throwIfAborted();
  if (!key) throw new Error(`Configure credential ${apiKeyEnv} in Settings → DeepSeek application APIs before calling ${operation}.`);
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error(`Credential ${apiKeyEnv} is not a valid API key; remove spaces, line breaks or non-ASCII characters.`);
  const multipart = body instanceof FormData;
  const response = await fetch(apiEndpoint(baseURL, operation), {
    method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, ...multipart ? {} : { 'Content-Type': 'application/json' } },
    body: multipart ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    // Upstream/gateway bodies can contain request data or secrets. Keep diagnostics status-only.
    await response.body?.cancel();
    throw new Error(`DeepSeek ${operation} returned HTTP ${response.status}. ${response.status === 401 || response.status === 403
      ? 'Check the API key and endpoint permissions.' : response.status === 429
        ? 'Account request limit reached; try again later.' : 'Check the endpoint, input format and account balance.'}`);
  }
  return response;
}

export async function jsonResponse(response, operation) {
  const value = await response.json();
  if (!value || typeof value !== 'object' || value.error) throw new Error(`DeepSeek ${operation} returned an error or invalid response.`);
  return value;
}

/** Read through Harness's execution-world FS, never node:fs or unchecked host paths. */
export async function readUpload(ctx, exec, filePath, maxBytes) {
  if (!filePath.trim()) throw new Error('file_path must not be empty.');
  const cwd = exec.agent ? await ctx.workingDirectory.ensure(exec.agent, exec.signal) : undefined;
  const target = await ctx.fs.resolve(filePath, { cwd, signal: exec.signal });
  const info = await ctx.fs.stat(target, exec.signal);
  if (info?.type !== 'file') throw new Error('file_path must point to an existing regular file.');
  const data = await ctx.fs.readBytes(target, exec.signal, maxBytes);
  if (!data.length || data.length > maxBytes) throw new Error(`File must contain 1–${maxBytes} bytes.`);
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec);
  return { data, name: target.displayPath.split(/[\\/]/).pop() };
}

/** Validate RIFF chunks as they stream; a cut-off 200 response must never become a successful attachment. */
export async function* wavChunks(body, signal) {
  if (!body) throw new Error('DeepSeek TTS returned no audio.');
  let header = Buffer.alloc(0);
  let pending = Buffer.alloc(0);
  let chunkRemaining = 0;
  let chunkPadding = 0;
  let total = 0;
  let declaredSize;
  let hasFormat = false;
  let hasAudio = false;
  for await (const bytes of body) {
    signal.throwIfAborted();
    total += bytes.length;
    if (total > 24_000 * 2 * 60 * 30 + 65_536) throw new Error('DeepSeek TTS audio exceeds the 30-minute limit.');
    let data = Buffer.from(bytes);
    if (header.length < 12) {
      const count = Math.min(12 - header.length, data.length);
      header = Buffer.concat([header, data.subarray(0, count)]);
      data = data.subarray(count);
      if (header.length === 12) {
        if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('DeepSeek TTS returned invalid WAV audio.');
        declaredSize = header.readUInt32LE(4);
      }
    }
    while (data.length) {
      if (chunkRemaining) {
        const count = Math.min(chunkRemaining, data.length);
        chunkRemaining -= count;
        data = data.subarray(count);
      } else if (chunkPadding) {
        data = data.subarray(1);
        chunkPadding = 0;
      } else {
        const count = Math.min(8 - pending.length, data.length);
        pending = Buffer.concat([pending, data.subarray(0, count)]);
        data = data.subarray(count);
        if (pending.length === 8) {
          const tag = pending.toString('ascii', 0, 4);
          const size = pending.readUInt32LE(4);
          if (tag === 'fmt ') hasFormat = size >= 16;
          if (tag === 'data') hasAudio = size > 0;
          // Streaming WAV may use unknown-length sentinels. EOF then closes the data chunk.
          chunkRemaining = tag === 'data' && (size === 0xffffffff || size === 0) ? Infinity : size;
          if (tag === 'data' && chunkRemaining === Infinity) hasAudio = true;
          chunkPadding = size % 2;
          pending = Buffer.alloc(0);
        }
      }
    }
    yield bytes;
  }
  signal.throwIfAborted();
  if (header.length !== 12 || !hasFormat || !hasAudio || pending.length || (chunkRemaining !== 0 && chunkRemaining !== Infinity)
    || (declaredSize !== 0 && declaredSize !== 0xffffffff && declaredSize + 8 !== total) || total <= 44) {
    throw new Error('DeepSeek TTS audio is incomplete; no audio file was committed.');
  }
}
