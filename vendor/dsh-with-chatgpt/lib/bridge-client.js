import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isSea } from 'node:sea';

const ENTRY = fileURLToPath(new URL('../bridge/bin/d2c.js', import.meta.url));
const OUTPUT_LIMIT = 1024 * 1024;

export function nodeRuntime(configured) {
  if (configured) {
    if (!path.isAbsolute(configured) || !fs.statSync(configured).isFile()) throw new Error('node must point to an existing absolute Node executable.');
    return { executable: configured, electron: false };
  }
  if (isSea()) throw new Error('A standalone Node executable must be configured for the DSH standalone binary.');
  return { executable: process.execPath, electron: Boolean(process.versions.electron) };
}

export class BridgeClient {
  constructor({ stateDir, node }) {
    this.stateDir = stateDir;
    this.runtime = nodeRuntime(node);
    this.pending = new Map();
  }

  run(args, workspace, signal) {
    signal?.throwIfAborted();
    const root = fs.realpathSync.native(workspace);
    const canonical = process.platform === 'win32' || process.platform === 'darwin' ? root.toLowerCase() : root;
    const key = args[0] === 'prefs' ? 'prefs' : `workspace:${canonical}`;
    let started = false;
    // Each CLI invocation is a separate process; Sessions share one workspace runtime and record index.
    const operation = (this.pending.get(key) ?? Promise.resolve()).then(() => {
      signal?.throwIfAborted();
      started = true;
      return this.runProcess(args, root, signal);
    });
    const tail = operation.then(() => {}, () => {});
    this.pending.set(key, tail);
    void tail.then(() => { if (this.pending.get(key) === tail) this.pending.delete(key); });
    if (!signal) return operation;
    return new Promise((resolve, reject) => {
      const abort = () => { if (!started) reject(signal.reason ?? new Error('Cancelled.')); };
      signal.addEventListener('abort', abort, { once: true });
      operation.then(
        value => { signal.removeEventListener('abort', abort); resolve(value); },
        error => { signal.removeEventListener('abort', abort); reject(error); },
      );
      if (signal.aborted) abort();
    });
  }

  runProcess(args, workspace, signal) {
    signal?.throwIfAborted();
    const persistentStartup = args[0] === 'setup' || (args[0] === 'doctor' && !args.includes('--no-fix'));
    const env = { ...process.env, D2C_STATE_DIR: this.stateDir };
    delete env.C2C_STATE_DIR;
    if (this.runtime.electron) env.ELECTRON_RUN_AS_NODE = '1';
    else delete env.ELECTRON_RUN_AS_NODE;
    return new Promise((resolve, reject) => {
      const child = spawn(this.runtime.executable, [ENTRY, ...args, '-w', workspace, '--json'], {
        cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = ''; let overflow = false;
      const collect = (stream, kind) => stream.on('data', (chunk) => {
        if (kind === 'out') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > OUTPUT_LIMIT) { overflow = true; child.kill(); }
      });
      collect(child.stdout, 'out'); collect(child.stderr, 'err');
      // Startup hands off to a persistent shared daemon. Keep its queue slot until that handoff settles.
      const abort = () => { if (!persistentStartup) child.kill(); };
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', (error) => { signal?.removeEventListener('abort', abort); reject(error); });
      child.once('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { reject(signal.reason ?? new Error('Cancelled.')); return; }
        if (overflow) { reject(new Error('ChatGPT bridge output exceeded its limit.')); return; }
        let result;
        try { result = JSON.parse(stdout.trim()); }
        catch { reject(new Error(`ChatGPT bridge returned no JSON (exit ${code}): ${stderr.slice(0, 1000)}`)); return; }
        // Doctor deliberately returns a diagnostic object on exit 1.
        if (code !== 0 && result.ok !== false && !result.report) { reject(new Error(`ChatGPT bridge failed (exit ${code}).`)); return; }
        resolve(result);
      });
      if (signal?.aborted) abort();
    });
  }
}
