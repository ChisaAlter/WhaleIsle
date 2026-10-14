const { randomUUID } = require('node:crypto');
const { loadWorkspaceAuthority } = require('./workspace-authority');

let workspaceAuthority = null;

/** Test seam: pin the trust root (node:test runs outside Electron). */
function setWorkspaceAuthority(authority) {
  workspaceAuthority = authority;
}

function asCwd(cwd) {
  if (workspaceAuthority === null) {
    workspaceAuthority = loadWorkspaceAuthority({ allowScratchCwd: true });
  }
  return workspaceAuthority.resolveAuthorizedCwd(cwd);
}

// Copied from the external desktop `apps/server/src/terminal/Manager.ts`.
const DEFAULT_OPEN_COLS = 120;
const DEFAULT_OPEN_ROWS = 30;
const MIN_TERMINAL_COLUMNS = 1;
const MIN_TERMINAL_ROWS = 1;
const MAX_TERMINAL_COLUMNS = 1_000;
const MAX_TERMINAL_ROWS = 1_000;
const TERMINAL_ENV_BLOCKLIST = new Set(['PORT', 'ELECTRON_RENDERER_PORT', 'ELECTRON_RUN_AS_NODE']);
const leftoverEnvPrefix = ['T', '3CODE_'].join('');

/**
 * Terminal output coalescing window. A build or `cat` of a large file emits
 * thousands of small backend chunks; publishing each one crosses the IPC
 * boundary and re-copies the renderer replay buffer once per chunk. The first
 * chunk of a burst still goes out immediately so an interactive shell never
 * waits on this window at all.
 */
const PTY_OUTPUT_COALESCE_MS = 8;
/** UTF-8 byte ceiling for one coalesced payload; the window alone is unbounded. */
const PTY_OUTPUT_COALESCE_BYTES = 32 * 1024;

/**
 * Unacknowledged-byte ceiling before the backend PTY is paused, and the mark
 * it must fall back to before reads resume. Coalescing alone only reduces the
 * message count; it leaves the queue unbounded when the renderer cannot keep
 * up. Pausing the backend is what actually constrains the producer, and
 * `pause()`/`resume()` were measured to stop delivery (zero bytes arrive while
 * paused) rather than merely buffer in this process.
 *
 * The high mark sits well above one coalesced frame so ordinary bursts never
 * touch it and interactive echo keeps its latency. Lowering it below a single
 * frame would pause on every frame and turn backpressure into a stutter.
 */
const PTY_OUTPUT_HIGH_WATER_BYTES = 256 * 1024;
/** Resume mark. The gap to the high mark avoids pause/resume thrashing. */
const PTY_OUTPUT_LOW_WATER_BYTES = 64 * 1024;

function shouldExcludeTerminalEnvKey(key) {
  const normalizedKey = key.toUpperCase();
  if (normalizedKey.startsWith(leftoverEnvPrefix)) {
    return true;
  }
  if (normalizedKey.startsWith('VITE_')) {
    return true;
  }
  return TERMINAL_ENV_BLOCKLIST.has(normalizedKey);
}

function defaultShellResolver(platform, env) {
  if (platform === 'win32') {
    return 'pwsh.exe';
  }
  return env.SHELL ?? 'bash';
}

function defaultShell() {
  return defaultShellResolver(process.platform, process.env);
}

function normalizeShellCommand(value, platform) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (platform === 'win32') {
    return trimmed;
  }

  const firstToken = trimmed.split(/\s+/g)[0]?.trim();
  if (!firstToken) return null;
  return firstToken.replace(/^['"]|['"]$/g, '');
}

function basenameForPlatform(command, platform) {
  const normalized =
    platform === 'win32' ? command.replaceAll('/', '\\') : command.replaceAll('\\', '/');
  const parts = normalized
    .split(platform === 'win32' ? /\\+/ : /\/+/)
    .filter((part) => part.length > 0);
  return parts.at(-1) ?? normalized;
}

function joinWindowsPath(...parts) {
  return parts
    .map((part, index) => {
      if (index === 0) return part.replace(/[\\/]+$/g, '');
      return part.replace(/^[\\/]+|[\\/]+$/g, '');
    })
    .filter((part) => part.length > 0)
    .join('\\');
}

function shellCandidateFromCommand(command, platform) {
  if (!command || command.length === 0) return null;
  const shellName = basenameForPlatform(command, platform).toLowerCase();
  if (platform === 'win32' && (shellName === 'pwsh.exe' || shellName === 'powershell.exe')) {
    return { shell: command, args: ['-NoLogo'] };
  }
  if (platform !== 'win32' && shellName === 'zsh') {
    return { shell: command, args: ['-o', 'nopromptsp'] };
  }
  return { shell: command };
}

function windowsSystemRoot(env) {
  return env.SystemRoot?.trim() || env.windir?.trim() || 'C:\\Windows';
}

function windowsPowerShellPath(env) {
  return joinWindowsPath(
    windowsSystemRoot(env),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

function windowsCmdPath(env) {
  return joinWindowsPath(windowsSystemRoot(env), 'System32', 'cmd.exe');
}

function formatShellCandidate(candidate) {
  if (!candidate.args || candidate.args.length === 0) return candidate.shell;
  return `${candidate.shell} ${candidate.args.join(' ')}`;
}

function uniqueShellCandidates(candidates) {
  const seen = new Set();
  const ordered = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = formatShellCandidate(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }
  return ordered;
}

function resolveShellCandidates(shellResolver, platform, env) {
  const requested = shellCandidateFromCommand(
    normalizeShellCommand(shellResolver(), platform),
    platform,
  );

  if (platform === 'win32') {
    return uniqueShellCandidates([
      requested,
      shellCandidateFromCommand('pwsh.exe', platform),
      shellCandidateFromCommand(windowsPowerShellPath(env), platform),
      shellCandidateFromCommand('powershell.exe', platform),
      shellCandidateFromCommand(env.ComSpec ?? null, platform),
      shellCandidateFromCommand(windowsCmdPath(env), platform),
      shellCandidateFromCommand('cmd.exe', platform),
    ]);
  }

  return uniqueShellCandidates([
    requested,
    shellCandidateFromCommand(normalizeShellCommand(env.SHELL, platform), platform),
    shellCandidateFromCommand('/bin/zsh', platform),
    shellCandidateFromCommand('/bin/bash', platform),
    shellCandidateFromCommand('/bin/sh', platform),
    shellCandidateFromCommand('zsh', platform),
    shellCandidateFromCommand('bash', platform),
    shellCandidateFromCommand('sh', platform),
  ]);
}

function defaultShellArgs(platform = process.platform, env = process.env) {
  const candidate = shellCandidateFromCommand(
    normalizeShellCommand(defaultShellResolver(platform, env), platform),
    platform,
  );
  return candidate?.args ?? [];
}

// Marker variables the AppImage runtime injects into the process it launches.
// They describe the AppImage itself, not the user's session, so terminals must
// not inherit them.
const APPIMAGE_RUNTIME_ENV_KEYS = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];
// Colon-separated search-path variables the AppImage runtime points at its
// temporary mount (e.g. /tmp/.mount_*/usr/bin, the bundled glib schemas,
// and an $APPDIR/usr/share XDG data entry). Only the mount segments are
// dropped; the user's real entries are preserved. When nothing but mount
// segments remain the variable is removed entirely so consumers fall back to
// their platform default (e.g. gsettings finds the host schemas instead of
// reporting "No schemas installed"). See issues #1699 and #5059.
const APPIMAGE_PATH_LIKE_ENV_KEYS = [
  'PATH',
  'LD_LIBRARY_PATH',
  'XDG_DATA_DIRS',
  'GSETTINGS_SCHEMA_DIR',
];

function isPathSegmentUnderAppDir(segment, appDir) {
  return segment === appDir || segment.startsWith(`${appDir}/`);
}

// On Linux AppImage builds the runtime mounts the app under a temporary dir and
// injects APPIMAGE/APPDIR/ARGV0/OWD plus mount entries on PATH/LD_LIBRARY_PATH.
// The integrated terminal inherits the server process environment, so without
// this scrub those leak into the PTY and tools resolve against the AppImage
// mount instead of the user's real environment (e.g. `php` reporting
// PHP_BINARY as the AppImage path). See issue #1699. The scrub is gated on an
// actual AppImage launch so non-AppImage environments are left untouched.
function stripAppImageRuntimeEnv(env) {
  if (env.APPIMAGE === undefined && env.APPDIR === undefined) return env;

  const scrubbed = { ...env };
  for (const key of APPIMAGE_RUNTIME_ENV_KEYS) {
    delete scrubbed[key];
  }

  const appDir = env.APPDIR?.replace(/\/+$/, '');
  if (appDir) {
    for (const key of APPIMAGE_PATH_LIKE_ENV_KEYS) {
      const value = scrubbed[key];
      if (value === undefined) continue;
      const kept = value
        .split(':')
        .filter((segment) => segment.length > 0 && !isPathSegmentUnderAppDir(segment, appDir));
      if (kept.length > 0) {
        scrubbed[key] = kept.join(':');
      } else {
        delete scrubbed[key];
      }
    }
  }

  return scrubbed;
}

function createTerminalSpawnEnv(baseEnv, runtimeEnv) {
  const spawnEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (shouldExcludeTerminalEnvKey(key)) continue;
    spawnEnv[key] = value;
  }
  if (runtimeEnv) {
    for (const [key, value] of Object.entries(runtimeEnv)) {
      spawnEnv[key] = value;
    }
  }
  return stripAppImageRuntimeEnv(spawnEnv);
}

function ptySpawnOptions({ cwd, cols, rows }, platform = process.platform, env = process.env) {
  const spawnEnv = createTerminalSpawnEnv(env);
  // Windows node-pty never writes `name` into $TERM. Electron stamps
  // TERM=dumb on the GUI process; Ink then skips color. Drop only that stamp.
  if (platform === 'win32' && spawnEnv.TERM === 'dumb') {
    delete spawnEnv.TERM;
  }
  return {
    cwd,
    cols: cols ?? DEFAULT_OPEN_COLS,
    rows: rows ?? DEFAULT_OPEN_ROWS,
    name: platform === 'win32' ? 'xterm-color' : 'xterm-256color',
    env: spawnEnv,
  };
}

function defaultSpawn() {
  let pty;
  try {
    pty = require('node-pty');
  } catch {
    throw new Error('node-pty is not available');
  }
  return ({ cwd, cols, rows, onData, onExit }) => {
    const options = ptySpawnOptions({ cwd, cols, rows });
    const candidates = resolveShellCandidates(
      () => defaultShellResolver(process.platform, process.env),
      process.platform,
      process.env,
    );
    let term;
    let lastError;
    for (const candidate of candidates) {
      try {
        term = pty.spawn(candidate.shell, candidate.args ?? [], options);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!term) {
      throw lastError || new Error('node-pty is not available');
    }
    let resolveExit;
    const exited = new Promise((resolve) => {
      resolveExit = resolve;
    });
    term.onData(onData);
    term.onExit(({ exitCode }) => {
      onExit(exitCode ?? 0);
      resolveExit();
    });
    return {
      write(data) {
        term.write(data);
      },
      resize(nextCols, nextRows) {
        term.resize(nextCols, nextRows);
      },
      // node-pty's pause()/resume() stop and restart delivery from the backend.
      // Measured on Windows ConPTY: while paused, zero bytes arrive; the wall
      // clock of a 200k-line producer stretched by exactly the hold time.
      pause() {
        if (typeof term.pause === 'function') term.pause();
      },
      resume() {
        if (typeof term.resume === 'function') term.resume();
      },
      kill() {
        term.kill();
        return new Promise((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          exited.then(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
    };
  };
}

const BACKEND_UNAVAILABLE = 'terminal backend unavailable';

function validTerminalDimension(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeTerminalDimensions(cols, rows) {
  return {
    cols: validTerminalDimension(cols, DEFAULT_OPEN_COLS, MIN_TERMINAL_COLUMNS, MAX_TERMINAL_COLUMNS),
    rows: validTerminalDimension(rows, DEFAULT_OPEN_ROWS, MIN_TERMINAL_ROWS, MAX_TERMINAL_ROWS),
  };
}

/**
 * In-process PTY table used by Electron IPC. Tests inject a fake spawn that
 * echoes writes; production lazy-loads node-pty / conpty on the first create
 * so a missing optional native module cannot take down registerIpc.
 * @param {{ spawn?: Function | null, emit?: Function }} [options]
 */
function createPtyController(options = {}) {
  let spawn = options.spawn;
  const emit = options.emit ?? (() => {});
  const sessions = new Map();
  const eventListeners = new Set();
  /** Per-PTY output batching state; see {@link PTY_OUTPUT_COALESCE_MS}. */
  const outputStates = new Map();
  /**
   * PTYs that may still publish output. A backend may deliver a late `onData`
   * after `onExit`/`kill()`; without this guard that callback would recreate
   * batching state for a session the controller has already retired. The set
   * is keyed by live id, so it cannot grow across the process lifetime.
   */
  const activeOutputIds = new Set();
  const coalesceMs = Number.isFinite(options.coalesceMs) ? Math.max(0, options.coalesceMs) : PTY_OUTPUT_COALESCE_MS;
  const coalesceBytes = Number.isFinite(options.coalesceBytes) && options.coalesceBytes > 0
    ? options.coalesceBytes
    : PTY_OUTPUT_COALESCE_BYTES;
  const highWaterBytes = Number.isFinite(options.highWaterBytes) && options.highWaterBytes > 0
    ? options.highWaterBytes
    : PTY_OUTPUT_HIGH_WATER_BYTES;
  const lowWaterBytes = Number.isFinite(options.lowWaterBytes) && options.lowWaterBytes >= 0
    ? Math.min(options.lowWaterBytes, highWaterBytes)
    : Math.min(PTY_OUTPUT_LOW_WATER_BYTES, highWaterBytes);

  /**
   * Unacknowledged output bytes per PTY, plus the paused flag.
   *
   * `pending` counts every byte this process has published but the renderer
   * has not yet confirmed consuming. It is bounded by construction: once it
   * reaches {@link highWaterBytes} the backend is paused, so a producer that
   * ignores the socket's own buffering still cannot grow it without limit.
   */
  const flowStates = new Map();

  function flowState(id) {
    let state = flowStates.get(id);
    if (!state) {
      state = { unackedBytes: 0, paused: false, nextSeq: 1, inflight: [] };
      flowStates.set(id, state);
    }
    return state;
  }

  /**
   * Record one published frame and apply the watermarks.
   *
   * The frame is tracked before flow control runs so the pause decision sees
   * the byte that just crossed the mark. A frame the renderer never
   * acknowledges simply keeps the PTY paused, which is the correct failure
   * mode: the producer waits instead of the queue growing.
   */
  function trackPublishedFrame(id, data, session) {
    const state = flowState(id);
    const seq = state.nextSeq++;
    const bytes = Buffer.byteLength(data, 'utf8');
    state.unackedBytes += bytes;
    state.inflight.push({ seq, bytes });
    applyFlowControl(id, session);
    return seq;
  }

  /**
   * Apply the watermarks to the backend. Called after every publish and every
   * acknowledgement, so the producer is held exactly while the backlog is
   * above the high mark and released once it is back under the low one.
   */
  function applyFlowControl(id, session) {
    const state = flowStates.get(id);
    if (!state || !session || typeof session.pause !== 'function') return;
    if (!state.paused && state.unackedBytes >= highWaterBytes) {
      state.paused = true;
      session.pause();
      return;
    }
    if (state.paused && state.unackedBytes <= lowWaterBytes) {
      state.paused = false;
      session.resume();
    }
  }

  function publish(channel, payload) {
    emit(channel, payload);
    for (const listener of eventListeners) {
      try {
        listener(channel, payload);
      } catch {
        // Observers must not interrupt terminal I/O.
      }
    }
  }

  function resolveSpawn() {
    if (spawn === null) {
      throw new Error(BACKEND_UNAVAILABLE);
    }
    if (typeof spawn === 'function') return spawn;
    spawn = defaultSpawn();
    return spawn;
  }

  function outputState(id) {
    let state = outputStates.get(id);
    if (!state) {
      state = { pending: [], pendingBytes: 0, timer: null, lastPublishAt: 0 };
      outputStates.set(id, state);
    }
    return state;
  }

  function clearOutputTimer(state) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function flushOutput(id) {
    const state = outputStates.get(id);
    if (!state) return;
    clearOutputTimer(state);
    if (state.pending.length === 0) return;
    const data = state.pending.join('');
    state.pending = [];
    state.pendingBytes = 0;
    state.lastPublishAt = Date.now();
    publishData(id, data);
  }

  /** Publish one ordered output frame, tagging it for renderer acknowledgement. */
  function publishData(id, data) {
    const seq = trackPublishedFrame(id, data, sessions.get(id));
    publish('shell:pty-data', { id, data, seq });
  }

  function scheduleFlush(id, state) {
    if (state.timer !== null) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      flushOutput(id);
    }, coalesceMs);
  }

  /**
   * Split a payload into frames whose UTF-8 length never exceeds `budget`.
   * Iterates by code point so a multi-byte character is never cut in half.
   * @param {string} text
   * @param {number} budget
   * @returns {string[]}
   */
  function splitTextByByteBudget(text, budget) {
    const frames = [];
    let current = '';
    let currentBytes = 0;
    for (const char of text) {
      const charBytes = Buffer.byteLength(char, 'utf8');
      if (currentBytes + charBytes > budget && current.length > 0) {
        frames.push(current);
        current = '';
        currentBytes = 0;
      }
      current += char;
      currentBytes += charBytes;
    }
    if (current.length > 0) frames.push(current);
    return frames;
  }

  /**
   * Publish backend output without one IPC message per backend chunk. A chunk
   * arriving after an idle gap goes out immediately, so keystroke echo never
   * pays the window; chunks that follow a recent publish are joined until the
   * window (or the byte ceiling) is reached.
   *
   * The ceiling is enforced before a chunk is appended: two individually
   * small chunks must not produce an oversized payload, and a single chunk
   * larger than the ceiling is split on code-point boundaries.
   */
  function publishOutput(id, data) {
    if (!activeOutputIds.has(id)) return;
    const text = String(data);
    if (text.length === 0) return;
    const state = outputState(id);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (state.pending.length === 0 && Date.now() - state.lastPublishAt >= coalesceMs) {
      state.lastPublishAt = Date.now();
      if (bytes <= coalesceBytes) {
        publishData(id, text);
        return;
      }
      for (const frame of splitTextByByteBudget(text, coalesceBytes)) {
        publishData(id, frame);
      }
      return;
    }
    // Make room before appending: an oversized frame is never produced by
    // joining two individually compliant chunks.
    if (state.pending.length > 0 && state.pendingBytes + bytes > coalesceBytes) {
      flushOutput(id);
    }
    if (bytes > coalesceBytes) {
      for (const frame of splitTextByByteBudget(text, coalesceBytes)) {
        publishData(id, frame);
      }
      state.lastPublishAt = Date.now();
      return;
    }
    state.pending.push(text);
    state.pendingBytes += bytes;
    if (state.pendingBytes >= coalesceBytes) flushOutput(id);
    else scheduleFlush(id, state);
  }

  /** Flush whatever is buffered for this PTY; safe when nothing is pending. */
  function endOutputBurst(id) {
    flushOutput(id);
  }

  /** Retire a PTY so late backend callbacks cannot resurrect batching state. */
  function retireOutput(id) {
    endOutputBurst(id);
    activeOutputIds.delete(id);
    dropOutputState(id);
    flowStates.delete(id);
  }

  /**
   * Confirm that the renderer finished consuming everything up to `seq`.
   *
   * The acknowledgement is cumulative: frames are ordered and delivered in
   * order, so consuming frame `n` implies every earlier frame was consumed.
   * Unknown or already-acknowledged sequences are ignored rather than
   * throwing, because a late acknowledgement racing an exit is normal.
   */
  function acknowledgeOutput(id, seq) {
    const state = flowStates.get(id);
    if (!state) return;
    const confirmed = Number(seq);
    if (!Number.isFinite(confirmed) || confirmed < 1) return;
    let index = 0;
    while (index < state.inflight.length && state.inflight[index].seq <= confirmed) {
      state.unackedBytes -= state.inflight[index].bytes;
      index += 1;
    }
    if (index === 0) return;
    state.inflight.splice(0, index);
    if (state.unackedBytes < 0) state.unackedBytes = 0;
    applyFlowControl(id, sessions.get(id));
  }

  function dropOutputState(id) {
    const state = outputStates.get(id);
    if (!state) return;
    clearOutputTimer(state);
    outputStates.delete(id);
  }

  function requireSession(id) {
    const session = sessions.get(id);
    if (!session) {
      throw new Error(`unknown pty id: ${id}`);
    }
    return session;
  }

  return {
    async create(input = {}) {
      const cwd = asCwd(input.cwd);
      if (!cwd) {
        throw new Error('ptyCreate requires a project cwd');
      }
      let backend;
      try {
        backend = resolveSpawn();
      } catch (error) {
        console.error('[pty] backend unavailable:', error && error.message ? error.message : error);
        throw new Error(BACKEND_UNAVAILABLE);
      }
      const id = randomUUID();
      // Register before spawn: a backend is allowed to emit synchronously.
      activeOutputIds.add(id);
      let session;
      try {
        const dimensions = normalizeTerminalDimensions(input.cols, input.rows);
        session = backend({
          cwd,
          cols: dimensions.cols,
          rows: dimensions.rows,
          onData(data) {
            publishOutput(id, data);
          },
          onExit(code) {
            // Exit must not overtake buffered output: the tail of a command is
            // exactly what the user is waiting to see.
            retireOutput(id);
            sessions.delete(id);
            publish('shell:pty-exit', { id, code: Number(code) || 0 });
          },
        });
      } catch (error) {
        activeOutputIds.delete(id);
        console.error('[pty] spawn failed:', error && error.message ? error.message : error);
        throw new Error(BACKEND_UNAVAILABLE);
      }
      sessions.set(id, session);
      return { id };
    },

    async write(id, data) {
      requireSession(id).write(String(data ?? ''));
    },

    /**
     * Record the renderer's confirmation that it consumed output up to `seq`.
     * Exposed for `registerPtyIpc`; safe when the PTY already exited.
     */
    acknowledge(id, seq) {
      acknowledgeOutput(id, seq);
    },

    async resize(id, cols, rows) {
      const dimensions = normalizeTerminalDimensions(cols, rows);
      requireSession(id).resize(dimensions.cols, dimensions.rows);
    },

    async kill(id) {
      const session = sessions.get(id);
      if (!session) return;
      retireOutput(id);
      await session.kill();
      sessions.delete(id);
    },

    onEvent(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('PTY event listener must be a function');
      }
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },

    /** Live session count — read-only surface for task-protection prompts. */
    count() {
      return sessions.size;
    },

    /** Kill every live PTY (app quit, harness restart, renderer teardown). */
    killAll() {
      const cleanup = [];
      for (const id of [...outputStates.keys()]) {
        retireOutput(id);
      }
      for (const session of sessions.values()) {
        try {
          cleanup.push(Promise.resolve(session.kill()).catch(() => {}));
        } catch {
          // A backend that already exited must not block the sweep.
        }
      }
      sessions.clear();
      return Promise.all(cleanup);
    },
  };
}

/**
 * Register desktop PTY IPC on ipcMain.
 * @param {import('electron').IpcMain} ipcMain
 * @param {ReturnType<typeof createPtyController>} [controller]
 */
function registerPtyIpc(ipcMain, controller, options = {}) {
  const authorize = typeof options.authorize === 'function' ? options.authorize : () => {};
  const senderStates = new Map();
  /** PTY id -> owning webContents, so a dead renderer's PTYs can be reaped. */
  const owners = new Map();
  const live = controller ?? createPtyController({
    emit() {},
  });

  if (typeof live.onEvent === 'function') {
    live.onEvent((channel, payload) => {
      if (!payload || typeof payload.id !== 'string') return;
      const owner = owners.get(payload.id);
      if (channel === 'shell:pty-exit') owners.delete(payload.id);
      if (
        owner
        && typeof owner.send === 'function'
        && !(typeof owner.isDestroyed === 'function' && owner.isDestroyed())
      ) {
        owner.send(channel, payload);
      }
    });
  }

  function reapSender(sender) {
    for (const [id, owner] of [...owners]) {
      if (owner !== sender) continue;
      owners.delete(id);
      void Promise.resolve(live.kill(id)).catch(() => {});
    }
  }

  function invalidateSender(sender) {
    const state = senderStates.get(sender);
    if (state) state.generation += 1;
    reapSender(sender);
  }

  function track(event) {
    authorize(event);
    const sender = event.sender;
    if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
      const error = new Error('Unauthorized IPC sender');
      error.code = 'ERR_DSH_IPC_SENDER';
      throw error;
    }
    let state = senderStates.get(sender);
    if (!state) {
      state = { sender, generation: 0 };
      senderStates.set(sender, state);
      if (typeof sender.on === 'function') {
        // A cross-document navigation (reload included) or a crashed renderer
        // destroys the JS context that owned these PTYs; reap them so main
        // keeps no orphan shells. Same-document navigation fires
        // did-navigate-in-page instead and leaves the sessions alone.
        sender.on('render-process-gone', () => invalidateSender(sender));
        sender.on('did-navigate', () => invalidateSender(sender));
      }
      sender.once('destroyed', () => {
        senderStates.delete(sender);
        reapSender(sender);
      });
    }
    return { live, sender, state, generation: state.generation };
  }

  function isCurrent(context) {
    return senderStates.get(context.sender) === context.state
      && context.state.generation === context.generation
      && !(typeof context.sender.isDestroyed === 'function' && context.sender.isDestroyed());
  }

  function unauthorized() {
    const error = new Error('Unauthorized IPC sender');
    error.code = 'ERR_DSH_IPC_SENDER';
    return error;
  }

  function requireOwner(context, id) {
    if (owners.get(id) === context.sender) return;
    throw new Error(`unknown pty id: ${id}`);
  }

  ipcMain.handle('shell:pty-can-create', (event, cwd) => {
    authorize(event);
    return Boolean(asCwd(cwd));
  });
  ipcMain.handle('shell:pty-create', async (event, input) => {
    const context = track(event);
    const created = await context.live.create(input);
    if (!created || typeof created.id !== 'string') return created;
    if (!isCurrent(context)) {
      void Promise.resolve(context.live.kill(created.id)).catch(() => {});
      throw unauthorized();
    }
    owners.set(created.id, context.sender);
    return created;
  });
  ipcMain.handle('shell:pty-write', (event, id, data) => {
    const context = track(event);
    requireOwner(context, id);
    return context.live.write(id, data);
  });
  ipcMain.handle('shell:pty-ack', (event, id, seq) => {
    const context = track(event);
    requireOwner(context, id);
    return context.live.acknowledge(id, seq);
  });
  ipcMain.handle('shell:pty-resize', (event, id, cols, rows) => {
    const context = track(event);
    requireOwner(context, id);
    return context.live.resize(id, cols, rows);
  });
  ipcMain.handle('shell:pty-kill', (event, id) => {
    const context = track(event);
    if (owners.has(id)) requireOwner(context, id);
    return context.live.kill(id);
  });
  return live;
}

module.exports = {
  BACKEND_UNAVAILABLE,
  DEFAULT_OPEN_COLS,
  DEFAULT_OPEN_ROWS,
  createPtyController,
  registerPtyIpc,
  setWorkspaceAuthority,
  defaultShell,
  defaultShellArgs,
  ptySpawnOptions,
  createTerminalSpawnEnv,
  resolveShellCandidates,
};
