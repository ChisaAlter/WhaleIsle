/**
 * GIT_TRACE2_EVENT tail: emit hook start/finish from git's
 * JSON event stream instead of guessing leftover/husky from stdout.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * @param {{ child_id?: unknown, hook_name?: unknown }} record
 * @returns {string | null}
 */
function trace2ChildKey(record) {
  const childId = record.child_id;
  if (typeof childId === 'number' || typeof childId === 'string') return String(childId);
  const hookName = record.hook_name;
  return typeof hookName === 'string' && hookName.trim() ? hookName.trim() : null;
}

/**
 * @param {unknown} line
 * @returns {{ [key: string]: unknown } | null}
 */
function parseTrace2Line(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Create a TRACE2 event file and a poller that reports hook children.
 * @param {(event: { kind: 'started' | 'finished', hookName: string, exitCode?: number | null, durationMs?: number | null }) => void} onHook
 * @returns {{ env: NodeJS.ProcessEnv, poll: () => void, flush: () => void, close: () => void }}
 */
function createTrace2Monitor(onHook) {
  const emit = typeof onHook === 'function' ? onHook : () => {};
  const traceFilePath = path.join(
    os.tmpdir(),
    `dshd-git-trace2-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(traceFilePath, '');
  let processedChars = 0;
  let remainder = '';
  const hookStartByChildKey = new Map();

  const handleLine = (/** @type {string} */ line) => {
    const record = parseTrace2Line(line);
    if (!record || record.child_class !== 'hook') return;
    const childKey = trace2ChildKey(record);
    if (childKey === null) return;
    const started = hookStartByChildKey.get(childKey);
    const fromEvent = typeof record.hook_name === 'string' ? record.hook_name.trim() : '';
    const hookName = fromEvent || started?.hookName || '';
    if (!hookName) return;
    if (record.event === 'child_start') {
      hookStartByChildKey.set(childKey, { hookName, startedAtMs: Date.now() });
      emit({ kind: 'started', hookName });
      return;
    }
    if (record.event === 'child_exit') {
      hookStartByChildKey.delete(childKey);
      const code = record.exit_code ?? record.exitCode ?? record.code;
      const exitCode = typeof code === 'number' && Number.isInteger(code) ? code : null;
      const durationMs = started ? Math.max(0, Date.now() - started.startedAtMs) : null;
      emit({ kind: 'finished', hookName: started?.hookName || hookName, exitCode, durationMs });
    }
  };

  const poll = () => {
    let contents = '';
    try {
      contents = fs.readFileSync(traceFilePath, 'utf8');
    } catch {
      return;
    }
    if (contents.length <= processedChars) return;
    const appended = contents.slice(processedChars);
    processedChars = contents.length;
    const combined = remainder + appended;
    const lines = combined.split('\n');
    remainder = lines.pop() ?? '';
    for (const line of lines) handleLine(line.replace(/\r$/, ''));
  };

  const flush = () => {
    poll();
    const trailing = remainder.trim();
    remainder = '';
    if (trailing) handleLine(trailing);
  };

  const timer = setInterval(poll, 150);
  return {
    env: { GIT_TRACE2_EVENT: traceFilePath },
    poll,
    flush,
    close() {
      clearInterval(timer);
      flush();
      try {
        fs.unlinkSync(traceFilePath);
      } catch {
        // The temp trace file is best-effort cleanup after the git child exits.
      }
    },
  };
}

module.exports = {
  createTrace2Monitor,
  parseTrace2Line,
  trace2ChildKey,
};
