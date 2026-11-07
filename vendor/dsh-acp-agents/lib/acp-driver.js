import { spawn as nodeSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  buildAgentRuntimeEnv,
  inferDriverKind,
  resolveCommandBinary,
} from './presets.js';

const ACP_PROTOCOL_VERSION = 1;
const HANDSHAKE_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 1_500;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Async queue for bridging push-based ACP / App-Server / Stream-JSON notifications
 * into pull-based `AsyncIterable<StreamChunk>` steps in `ReactLoopAgent`.
 */
class AsyncEventQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter.resolve({ value: undefined, done: true });
    }
  }

  next(signal) {
    if (this.items.length > 0) {
      return Promise.resolve({ value: this.items.shift(), done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    const deferred = createDeferred();
    const waiter = {
      resolve: (res) => {
        cleanup();
        deferred.resolve(res);
      },
      reject: (err) => {
        cleanup();
        deferred.reject(err);
      },
    };
    const onAbort = () => {
      const idx = this.waiters.indexOf(waiter);
      if (idx >= 0) this.waiters.splice(idx, 1);
      waiter.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    this.waiters.push(waiter);
    return deferred.promise;
  }
}

/**
 * Map an ACP tool kind / title to a readable tool name that does NOT collide
 * with lowercase DSH built-in tools (so PTC mode never collapses it).
 */
export function mapAcpToolName(update, agentName = 'ACP') {
  const kind = String(update?.kind || '').toLowerCase();
  if (kind === 'execute' || kind === 'bash' || kind === 'command') return 'Terminal';
  if (kind === 'read') return 'ReadFile';
  if (kind === 'edit' || kind === 'write') return 'EditFile';
  if (kind === 'delete') return 'DeleteFile';
  if (kind === 'move') return 'MoveFile';
  if (kind === 'search' || kind === 'grep' || kind === 'glob') return 'Search';
  if (kind === 'fetch' || kind === 'webfetch') return 'WebFetch';
  if (kind === 'think') return 'Think';
  if (typeof update?.title === 'string' && /^[A-Z][A-Za-z0-9_]+$/.test(update.title.trim())) {
    return update.title.trim();
  }
  const cleanAgent = String(agentName || 'ACP').replace(/[^A-Za-z0-9_-]/g, '') || 'ACP';
  return `${cleanAgent}_Tool`;
}

export function formatAcpToolArguments(update) {
  const args = {};
  if (typeof update?.title === 'string' && update.title.trim()) {
    args.title = update.title.trim();
  }
  if (typeof update?.kind === 'string' && update.kind.trim()) {
    args.kind = update.kind.trim();
  }
  if (Array.isArray(update?.locations) && update.locations.length > 0) {
    args.locations = update.locations
      .map((loc) => (typeof loc?.path === 'string' ? (loc.line ? `${loc.path}:${loc.line}` : loc.path) : null))
      .filter(Boolean);
  }
  if (update?.rawInput !== undefined && update.rawInput !== null) {
    args.input = update.rawInput;
  }
  return args;
}

export function extractAcpToolOutput(update) {
  const parts = [];
  if (Array.isArray(update?.content)) {
    for (const item of update.content) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'content' && item.content?.type === 'text' && typeof item.content.text === 'string') {
        parts.push(item.content.text);
      } else if (item.type === 'text' && typeof item.text === 'string') {
        parts.push(item.text);
      } else if (item.type === 'diff' && typeof item.path === 'string') {
        parts.push(`Modified ${item.path}`);
      } else if (item.type === 'terminal' && typeof item.terminalId === 'string') {
        parts.push(`[Terminal ${item.terminalId}]`);
      }
    }
  }
  if (parts.length === 0 && update?.rawOutput !== undefined && update.rawOutput !== null) {
    if (typeof update.rawOutput === 'string') {
      parts.push(update.rawOutput);
    } else {
      try {
        parts.push(JSON.stringify(update.rawOutput, null, 2));
      } catch {
        parts.push(String(update.rawOutput));
      }
    }
  }
  if (parts.length === 0 && typeof update?.title === 'string' && update.title.trim()) {
    parts.push(`Completed: ${update.title.trim()}`);
  }
  return parts.join('\n').trim() || 'Completed';
}

function selectPermissionOptionId(options, approved) {
  const list = Array.isArray(options) ? options : [];
  if (approved) {
    const allowOnce = list.find((opt) => opt?.kind === 'allow_once');
    if (allowOnce?.optionId) return allowOnce.optionId;
    const allowAlways = list.find((opt) => opt?.kind === 'allow_always');
    if (allowAlways?.optionId) return allowAlways.optionId;
    const byName = list.find((opt) => /allow|approve|yes|accept/i.test(String(opt?.name || opt?.optionId || '')));
    if (byName?.optionId) return byName.optionId;
    return list[0]?.optionId || 'allow';
  }
  const rejectOnce = list.find((opt) => opt?.kind === 'reject_once');
  if (rejectOnce?.optionId) return rejectOnce.optionId;
  const rejectAlways = list.find((opt) => opt?.kind === 'reject_always');
  if (rejectAlways?.optionId) return rejectAlways.optionId;
  const byName = list.find((opt) => /reject|deny|no|cancel/i.test(String(opt?.name || opt?.optionId || '')));
  if (byName?.optionId) return byName.optionId;
  return null;
}

function spawnAgentProcess(ctx, agentConfig, command, args, cwd) {
  const resolvedCommand = resolveCommandBinary(command, agentConfig?.env) || command;
  const mergedEnv = buildAgentRuntimeEnv(agentConfig, resolvedCommand);
  let effectiveArgs = Array.isArray(args) ? [...args] : [];
  const baseName = path.basename(resolvedCommand).toLowerCase();
  if (baseName.startsWith('agy_acp_server')) {
    if (effectiveArgs[0] === 'acp' || effectiveArgs[0] === '--acp') {
      effectiveArgs = effectiveArgs.slice(1);
    }
  }
  const isWin = process.platform === 'win32';
  const needsCmdWrapper = isWin && /\.(cmd|bat)$/i.test(resolvedCommand);
  const finalCommand = needsCmdWrapper ? (process.env.ComSpec || 'cmd.exe') : resolvedCommand;
  const finalArgs = needsCmdWrapper ? ['/d', '/s', '/c', resolvedCommand, ...effectiveArgs] : effectiveArgs;

  let subprocessSvc = null;
  try {
    subprocessSvc = typeof ctx?.get === 'function' ? ctx.get('subprocess') : ctx?.subprocess;
  } catch {
    subprocessSvc = null;
  }

  if (subprocessSvc && typeof subprocessSvc.spawn === 'function' && !needsCmdWrapper) {
    const child = subprocessSvc.spawn({
      command: finalCommand,
      args: finalArgs,
      cwd,
      env: mergedEnv,
      stdin: 'pipe',
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      terminate() {
        try {
          child.terminate();
        } catch {
          // ignore
        }
      },
      kill() {
        try {
          child.kill();
        } catch {
          // ignore
        }
      },
    };
  }

  const child = nodeSpawn(finalCommand, finalArgs, {
    cwd,
    env: mergedEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    terminate() {
      try {
        if (isWin && child.pid) {
          nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    },
    kill() {
      try {
        if (isWin && child.pid) {
          nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    },
  };
}

/**
 * One persistent client connection bound to a `(sessionId, agentId)` pair.
 * Supports:
 * - `acp`: Standard ACP stdio (`devin acp`, `agy_acp_server`, custom ACP)
 * - `codex-app-server`: OpenAI Codex `codex app-server` JSON-RPC 2.0
 * - `claude-stream-json`: Anthropic Claude Code `claude -p --output-format stream-json --verbose`
 */
export class AcpClientConnection {
  constructor({ ctx, agentConfig, cwd, onPermissionRequest, onModelsDiscovered }) {
    this.ctx = ctx;
    this.agentConfig = agentConfig;
    this.driverKind = inferDriverKind(agentConfig);
    this.cwd = cwd || process.cwd();
    this.onPermissionRequest = onPermissionRequest;
    this.onModelsDiscovered = onModelsDiscovered;

    this.child = null;
    this.rl = null;
    this.nextRpcId = 1;
    this.pendingRequests = new Map();
    this.stderrTail = [];
    this.acpSessionId = null;
    this.configOptions = [];
    this.agentInfo = null;
    this.currentModel = null;
    this.currentEffort = null;
    this.activeTurn = null;
    this.closed = false;
    this.readyPromise = null;
  }

  async ensureReady(signal) {
    if (this.closed) {
      throw new Error(`ACP connection for ${this.agentConfig.name} is closed`);
    }
    if (this.driverKind === 'claude-stream-json') {
      const binary = resolveCommandBinary(this.agentConfig.command, this.agentConfig.env);
      if (!binary) {
        throw new Error(`Command "${this.agentConfig.command}" was not found in PATH.`);
      }
      if (!this.acpSessionId) {
        this.acpSessionId = `claude-${crypto.randomUUID()}`;
      }
      return {
        sessionId: this.acpSessionId,
        agentInfo: { name: 'Claude Code', version: 'stream-json' },
        configOptions: [],
      };
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.readyPromise = this._connectAndInitialize(signal).catch(async (err) => {
      this.readyPromise = null;
      await this.close().catch(() => {});
      throw err;
    });
    return this.readyPromise;
  }

  async _connectAndInitialize(signal) {
    let spawnArgs = this.agentConfig.args || [];
    if (this.driverKind === 'codex-app-server' && (spawnArgs.length === 0 || spawnArgs[0] === 'acp')) {
      spawnArgs = ['app-server'];
    }

    this.child = spawnAgentProcess(
      this.ctx,
      this.agentConfig,
      this.agentConfig.command,
      spawnArgs,
      this.cwd,
    );

    this.child.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          this.stderrTail.push(line.trim());
          if (this.stderrTail.length > 30) this.stderrTail.shift();
        }
      }
    });

    this.rl = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => {
      this._handleStdoutLine(line);
    });

    this.child.exited.then(
      (outcome) => {
        this._handleProcessExit(
          new Error(
            `ACP agent "${this.agentConfig.name}" exited (${outcome?.signal || `code ${outcome?.code ?? 0}`}): ${
              this.stderrTail.slice(-5).join(' | ') || 'no stderr'
            }`,
          ),
        );
      },
      (err) => {
        this._handleProcessExit(
          new Error(`Failed to spawn ACP agent "${this.agentConfig.name}" (${this.agentConfig.command}): ${err.message}`),
        );
      },
    );

    if (this.driverKind === 'codex-app-server') {
      const initRes = await this.sendRequest(
        'initialize',
        {
          clientInfo: {
            name: 'WhaleIsle',
            title: 'WhaleIsle',
            version: '0.1.0',
          },
          capabilities: {
            experimentalApi: true,
          },
        },
        signal,
        HANDSHAKE_TIMEOUT_MS,
      );
      this.sendNotification('initialized', {});
      this.agentInfo = {
        name: 'Codex App Server',
        userAgent: initRes?.userAgent || 'codex',
      };

      try {
        const modelRes = await this.sendRequest('model/list', {}, signal, 10_000);
        const list = Array.isArray(modelRes?.data) ? modelRes.data : [];
        const options = list
          .filter((m) => m && !m.hidden && (m.model || m.id))
          .map((m) => ({
            value: String(m.model || m.id),
            name: String(m.displayName || m.model || m.id),
          }));
        if (options.length > 0) {
          this.configOptions = [
            {
              id: 'model',
              category: 'model',
              type: 'select',
              options,
            },
          ];
          this._publishDiscoveredModels();
        }
      } catch {
        // non-fatal
      }

      const approvalPolicy = this.agentConfig.permissionPolicy === 'auto-allow' ? 'never' : 'on-request';
      const threadRes = await this.sendRequest(
        'thread/start',
        {
          cwd: this.cwd,
          approvalPolicy,
        },
        signal,
        HANDSHAKE_TIMEOUT_MS,
      );
      const threadId = threadRes?.thread?.id || threadRes?.threadId || `codex-${crypto.randomUUID()}`;
      this.acpSessionId = threadId;
      return {
        sessionId: this.acpSessionId,
        agentInfo: this.agentInfo,
        configOptions: this.configOptions,
      };
    }

    const initResult = await this.sendRequest(
      'initialize',
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: false,
        },
        clientInfo: {
          name: 'whaleisle-acp-agents',
          title: 'WhaleIsle ACP Agents',
          version: '0.1.0',
        },
      },
      signal,
      HANDSHAKE_TIMEOUT_MS,
    );
    this.agentInfo = initResult?.agentInfo || null;

    const sessionResult = await this.sendRequest(
      'session/new',
      {
        cwd: this.cwd,
        mcpServers: [],
      },
      signal,
      HANDSHAKE_TIMEOUT_MS,
    );

    if (!sessionResult || typeof sessionResult.sessionId !== 'string' || !sessionResult.sessionId) {
      throw new Error(`ACP agent "${this.agentConfig.name}" returned no sessionId from session/new`);
    }
    this.acpSessionId = sessionResult.sessionId;
    if (Array.isArray(sessionResult.configOptions)) {
      this.configOptions = sessionResult.configOptions;
      this._publishDiscoveredModels();
    } else if (Array.isArray(sessionResult.models?.availableModels)) {
      this._publishDiscoveredModels(sessionResult.models.availableModels);
    }

    return {
      sessionId: this.acpSessionId,
      agentInfo: this.agentInfo,
      configOptions: this.configOptions,
    };
  }

  _publishDiscoveredModels(explicitModels) {
    if (typeof this.onModelsDiscovered !== 'function') return;
    const discovered = [];
    if (Array.isArray(explicitModels)) {
      for (const m of explicitModels) {
        const id = String(m?.modelId || m?.id || '').trim();
        if (id) discovered.push({ id, name: String(m?.name || id).trim() || id });
      }
    }
    for (const opt of this.configOptions || []) {
      if (opt?.type === 'select' && (opt.category === 'model' || opt.id === 'model')) {
        const opts = Array.isArray(opt.options) ? opt.options : [];
        for (const item of opts) {
          if (Array.isArray(item?.options)) {
            for (const sub of item.options) {
              const id = String(sub?.value || '').trim();
              if (id) discovered.push({ id, name: String(sub?.name || id).trim() || id });
            }
          } else {
            const id = String(item?.value || '').trim();
            if (id) discovered.push({ id, name: String(item?.name || id).trim() || id });
          }
        }
      }
    }
    if (discovered.length > 0) {
      this.onModelsDiscovered(this.agentConfig.id, discovered);
    }
  }

  _handleStdoutLine(rawLine) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed || !trimmed.startsWith('{')) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // JSON-RPC response to a request we sent
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) {
          const err = new Error(msg.error.message || `ACP RPC error (${msg.error.code ?? 'unknown'})`);
          err.code = msg.error.code;
          err.data = msg.error.data;
          pending.reject(err);
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // JSON-RPC request from the agent (e.g. session/request_permission or codex approval)
    if (msg.id !== undefined && typeof msg.method === 'string') {
      void this._handleIncomingRequest(msg.id, msg.method, msg.params);
      return;
    }

    // JSON-RPC notification from the agent
    if (typeof msg.method === 'string') {
      this._handleIncomingNotification(msg.method, msg.params);
    }
  }

  async _handleIncomingRequest(reqId, method, params) {
    try {
      if (method === 'session/request_permission') {
        const outcome = await this._resolvePermissionRequest(params);
        this._sendResponse(reqId, outcome);
        return;
      }
      if (
        method === 'item/commandExecution/requestApproval'
        || method === 'item/fileChange/requestApproval'
      ) {
        const policy = this.agentConfig.permissionPolicy || 'ask';
        if (policy === 'auto-allow') {
          this._sendResponse(reqId, { decision: 'accept' });
          return;
        }
        const outcome = await this._resolvePermissionRequest({
          toolCall: {
            toolCallId: params?.itemId || `codex-perm-${reqId}`,
            title: params?.command ? `Run: ${params.command}` : 'File Modification Approval',
            kind: method.includes('commandExecution') ? 'execute' : 'edit',
            rawInput: params,
          },
          options: [
            { optionId: 'accept', kind: 'allow_once', name: 'Allow' },
            { optionId: 'decline', kind: 'reject_once', name: 'Reject' },
          ],
        });
        const decision = outcome?.outcome?.optionId === 'accept' ? 'accept' : 'decline';
        this._sendResponse(reqId, { decision });
        return;
      }
      if (method === 'fs/read_text_file') {
        const filePath = String(params?.path ?? '');
        const content = await fs.promises.readFile(filePath, 'utf8');
        this._sendResponse(reqId, { content });
        return;
      }
      if (method === 'fs/write_text_file') {
        const filePath = String(params?.path ?? '');
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, String(params?.content ?? ''), 'utf8');
        this._sendResponse(reqId, {});
        return;
      }
      this._sendError(reqId, -32601, `Unsupported client method: ${method}`);
    } catch (err) {
      this._sendError(reqId, -32603, err?.message || String(err));
    }
  }

  async _resolvePermissionRequest(params) {
    const options = Array.isArray(params?.options) ? params.options : [];
    const toolCall = params?.toolCall || {};
    const toolCallId = String(toolCall.toolCallId || `perm-${crypto.randomUUID()}`);
    const kind = String(toolCall.kind || '').toLowerCase();

    const policy = this.agentConfig.permissionPolicy || 'ask';
    if (policy === 'auto-allow') {
      const optionId = selectPermissionOptionId(options, true);
      return { outcome: { outcome: 'selected', optionId } };
    }
    if (policy === 'auto-allow-read' && (kind === 'read' || kind === 'search' || kind === 'think')) {
      const optionId = selectPermissionOptionId(options, true);
      return { outcome: { outcome: 'selected', optionId } };
    }

    const turn = this.activeTurn;
    if (turn) {
      let entry = turn.toolCalls.get(toolCallId);
      if (!entry) {
        entry = turn.registerToolCall({
          toolCallId,
          title: toolCall.title || 'Permission Request',
          kind: toolCall.kind || 'other',
          rawInput: toolCall.rawInput,
          locations: toolCall.locations,
          status: 'pending',
        });
      }
      const decisionDeferred = createDeferred();
      entry.pendingPermission = {
        params,
        options,
        toolCall,
        resolve: decisionDeferred.resolve,
      };
      if (entry.onPermissionArrived) {
        entry.onPermissionArrived();
      }
      const approved = await decisionDeferred.promise;
      if (approved === 'cancelled') {
        return { outcome: { outcome: 'cancelled' } };
      }
      const optionId = selectPermissionOptionId(options, approved === true);
      if (!optionId) {
        return { outcome: { outcome: 'cancelled' } };
      }
      return { outcome: { outcome: 'selected', optionId } };
    }

    const optionId = selectPermissionOptionId(options, true);
    return { outcome: { outcome: 'selected', optionId } };
  }

  _handleIncomingNotification(method, params) {
    if (this.driverKind === 'codex-app-server') {
      if (this.activeTurn) {
        this.activeTurn.handleCodexNotification(method, params);
      }
      return;
    }

    if (method !== 'session/update') return;
    const update = params?.update;
    if (!update || typeof update !== 'object') return;

    if (update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions)) {
      this.configOptions = update.configOptions;
      this._publishDiscoveredModels();
      return;
    }

    if (this.activeTurn) {
      this.activeTurn.handleSessionUpdate(update);
    }
  }

  _handleProcessExit(error) {
    this.closed = true;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    if (this.activeTurn) {
      this.activeTurn.fail(error);
    }
  }

  _writeJsonRpc(payload) {
    if (this.closed || !this.child?.stdin || this.child.stdin.destroyed) {
      throw new Error(`ACP stdin for "${this.agentConfig.name}" is not writable`);
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  _sendResponse(id, result) {
    try {
      this._writeJsonRpc({ jsonrpc: '2.0', id, result });
    } catch {
      // ignore
    }
  }

  _sendError(id, code, message) {
    try {
      this._writeJsonRpc({ jsonrpc: '2.0', id, error: { code, message } });
    } catch {
      // ignore
    }
  }

  sendNotification(method, params) {
    try {
      this._writeJsonRpc({ jsonrpc: '2.0', method, params });
    } catch {
      // ignore
    }
  }

  sendRequest(method, params, signal, timeoutMs = 0) {
    if (this.closed) {
      return Promise.reject(new Error(`ACP connection for "${this.agentConfig.name}" is closed`));
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    const id = this.nextRpcId++;
    const deferred = createDeferred();
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        deferred.reject(
          new Error(
            `ACP request "${method}" to ${this.agentConfig.name} timed out after ${timeoutMs}ms (${
              this.stderrTail.slice(-3).join(' | ') || 'no stderr'
            })`,
          ),
        );
      }, timeoutMs);
    }
    const onAbort = () => {
      if (this.pendingRequests.has(id)) {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        deferred.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    this.pendingRequests.set(id, {
      resolve: (val) => {
        signal?.removeEventListener('abort', onAbort);
        deferred.resolve(val);
      },
      reject: (err) => {
        signal?.removeEventListener('abort', onAbort);
        deferred.reject(err);
      },
      timer,
    });

    try {
      this._writeJsonRpc({ jsonrpc: '2.0', id, method, params });
    } catch (err) {
      this.pendingRequests.delete(id);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      return Promise.reject(err);
    }

    return deferred.promise;
  }

  async syncModelAndEffort(modelId, reasoningEffort, signal) {
    await this.ensureReady(signal);
    if (this.driverKind === 'codex-app-server' || this.driverKind === 'claude-stream-json') {
      if (modelId) this.currentModel = modelId;
      if (reasoningEffort) this.currentEffort = reasoningEffort;
      return;
    }

    const options = Array.isArray(this.configOptions) ? this.configOptions : [];
    if (modelId && modelId !== this.currentModel) {
      const modelOpt = options.find(
        (opt) => opt?.type === 'select' && (opt.category === 'model' || opt.id === 'model'),
      );
      try {
        if (modelOpt?.id) {
          const res = await this.sendRequest(
            'session/set_config_option',
            { sessionId: this.acpSessionId, configId: modelOpt.id, value: modelId },
            signal,
            10_000,
          );
          if (Array.isArray(res?.configOptions)) this.configOptions = res.configOptions;
        } else {
          await this.sendRequest(
            'session/set_model',
            { sessionId: this.acpSessionId, modelId },
            signal,
            5_000,
          ).catch(() => {});
        }
        this.currentModel = modelId;
      } catch {
        this.currentModel = modelId;
      }
    }

    if (reasoningEffort && reasoningEffort !== this.currentEffort) {
      const effortOpt = options.find(
        (opt) =>
          opt?.type === 'select'
          && (opt.category === 'thought_level'
            || opt.category === 'reasoning_effort'
            || /effort|thought|thinking/i.test(String(opt.id || ''))),
      );
      if (effortOpt?.id) {
        try {
          const res = await this.sendRequest(
            'session/set_config_option',
            { sessionId: this.acpSessionId, configId: effortOpt.id, value: reasoningEffort },
            signal,
            10_000,
          );
          if (Array.isArray(res?.configOptions)) this.configOptions = res.configOptions;
          this.currentEffort = reasoningEffort;
        } catch {
          this.currentEffort = reasoningEffort;
        }
      }
    }
  }

  async close() {
    if (this.closed && !this.child) return;
    this.closed = true;
    try {
      this.rl?.close();
    } catch {
      // ignore
    }
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    const grace = new Promise((resolve) => setTimeout(() => resolve('timeout'), SHUTDOWN_GRACE_MS));
    const settled = await Promise.race([child.exited.catch(() => 'exited'), grace]);
    if (settled === 'timeout') {
      child.terminate();
      const killGrace = new Promise((resolve) => setTimeout(() => resolve('timeout'), 1_000));
      const afterTerm = await Promise.race([child.exited.catch(() => 'exited'), killGrace]);
      if (afterTerm === 'timeout') {
        child.kill();
      }
    }
  }
}

/**
 * Tracks a single multi-step user turn driven by:
 * - Standard ACP `session/prompt`
 * - Codex `turn/start` (`codex app-server`)
 * - Claude Code `claude -p --output-format stream-json --verbose`
 */
export class AcpTurnExecution {
  constructor({ connection, agent, promptBlocks, signal }) {
    this.connection = connection;
    this.agent = agent;
    this.queue = new AsyncEventQueue();
    this.toolCalls = new Map();
    this.usage = { inputTokens: 0, outputTokens: 0 };
    this.promptDone = false;
    this.promptError = null;
    this.stopReason = 'end_turn';
    this.codexTurnId = null;

    if (this.connection.driverKind === 'codex-app-server') {
      this._startCodexTurn(promptBlocks, signal);
    } else if (this.connection.driverKind === 'claude-stream-json') {
      this._startClaudeStreamTurn(promptBlocks, signal);
    } else {
      this._startAcpTurn(promptBlocks, signal);
    }
  }

  _startAcpTurn(promptBlocks, signal) {
    const onAbort = () => {
      if (!this.promptDone && this.connection.acpSessionId) {
        this.connection.sendNotification('session/cancel', {
          sessionId: this.connection.acpSessionId,
        });
      }
      this._cancelPendingTools();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    this.promptPromise = this.connection
      .sendRequest(
        'session/prompt',
        {
          sessionId: this.connection.acpSessionId,
          prompt: promptBlocks,
        },
        signal,
      )
      .then(
        (result) => {
          this.promptDone = true;
          if (result?.stopReason) this.stopReason = result.stopReason;
          if (result?.usage) {
            this.usage = {
              inputTokens: Number(result.usage.inputTokens) || this.usage.inputTokens,
              outputTokens: Number(result.usage.outputTokens) || this.usage.outputTokens,
            };
          }
          this._completeOpenTools();
          this.queue.push({ type: 'prompt-done', result });
          this.queue.close();
        },
        (error) => {
          this.fail(error);
        },
      )
      .finally(() => {
        signal?.removeEventListener('abort', onAbort);
        if (this.connection.activeTurn === this) {
          this.connection.activeTurn = null;
        }
      });
  }

  _startCodexTurn(promptBlocks, signal) {
    const textPrompt = promptBlocks
      .map((b) => (typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n\n') || 'Continue.';

    const onAbort = () => {
      if (!this.promptDone && this.connection.acpSessionId && this.codexTurnId) {
        this.connection
          .sendRequest('turn/interrupt', {
            threadId: this.connection.acpSessionId,
            turnId: this.codexTurnId,
          })
          .catch(() => {});
      }
      this._cancelPendingTools();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const turnParams = {
      threadId: this.connection.acpSessionId,
      input: [{ type: 'text', text: textPrompt }],
    };
    if (this.connection.currentModel && this.connection.currentModel !== 'default') {
      turnParams.model = this.connection.currentModel;
    }
    if (this.connection.currentEffort) {
      turnParams.effort = this.connection.currentEffort;
    }

    this.connection
      .sendRequest('turn/start', turnParams, signal)
      .then((res) => {
        this.codexTurnId = res?.turn?.id || res?.turnId || null;
      })
      .catch((err) => {
        signal?.removeEventListener('abort', onAbort);
        this.fail(err);
      });
  }

  _startClaudeStreamTurn(promptBlocks, signal) {
    const textPrompt = promptBlocks
      .map((b) => (typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n\n') || 'Continue.';

    const args = ['-p', textPrompt, '--output-format', 'stream-json', '--verbose'];
    if (this.connection.currentModel && this.connection.currentModel !== 'default') {
      args.push('--model', this.connection.currentModel);
    }
    if (this.connection.claudeResumeSessionId) {
      args.push('--resume', this.connection.claudeResumeSessionId);
    }
    const policy = this.connection.agentConfig.permissionPolicy || 'ask';
    if (policy === 'auto-allow') {
      args.push('--dangerously-skip-permissions');
    }

    const child = spawnAgentProcess(
      this.connection.ctx,
      this.connection.agentConfig,
      this.connection.agentConfig.command,
      args,
      this.connection.cwd,
    );
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }

    const stderrLines = [];
    child.stderr?.on('data', (chunk) => {
      for (const l of String(chunk).split(/\r?\n/)) {
        if (l.trim()) stderrLines.push(l.trim());
      }
    });

    const onAbort = () => {
      child.terminate();
      this._cancelPendingTools();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        const ev = JSON.parse(trimmed);
        this._handleClaudeStreamEvent(ev);
      } catch {
        // ignore
      }
    });

    child.exited
      .then((outcome) => {
        if (this.promptDone) return;
        if (outcome?.code && outcome.code !== 0) {
          this.fail(
            new Error(
              `Claude Code exited with code ${outcome.code}: ${stderrLines.slice(-3).join(' | ') || 'not logged in or error'}`,
            ),
          );
          return;
        }
        this.promptDone = true;
        this._completeOpenTools();
        this.queue.push({ type: 'prompt-done', result: {} });
        this.queue.close();
      })
      .catch((err) => {
        this.fail(err);
      })
      .finally(() => {
        signal?.removeEventListener('abort', onAbort);
        try {
          rl.close();
        } catch {
          // ignore
        }
        if (this.connection.activeTurn === this) {
          this.connection.activeTurn = null;
        }
      });
  }

  _handleClaudeStreamEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.session_id && typeof ev.session_id === 'string') {
      this.connection.claudeResumeSessionId = ev.session_id;
    }
    if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          this.queue.push({ type: 'thought', text: block.thinking });
        } else if (block.type === 'text' && typeof block.text === 'string') {
          this.queue.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          this.registerToolCall({
            toolCallId: block.id || `claude-tc-${crypto.randomUUID()}`,
            title: block.name || 'Tool',
            kind: String(block.name || '').toLowerCase(),
            rawInput: block.input,
            status: 'in_progress',
          });
        }
      }
      return;
    }
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const existing = this.toolCalls.get(String(block.tool_use_id));
          const text = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map((c) => c?.text || '').join('\n')
              : 'Completed';
          if (existing) {
            this._applyToolCallUpdate(existing, {
              status: block.is_error ? 'failed' : 'completed',
              rawOutput: text,
            });
          }
        }
      }
      return;
    }
    if (ev.type === 'result') {
      if (ev.usage) {
        this.usage = {
          inputTokens: Number(ev.usage.input_tokens) || this.usage.inputTokens,
          outputTokens: Number(ev.usage.output_tokens) || this.usage.outputTokens,
        };
      }
      if (ev.is_error) {
        this.fail(new Error(ev.result || ev.error || 'Claude Code turn failed'));
        return;
      }
      this.promptDone = true;
      this._completeOpenTools();
      this.queue.push({ type: 'prompt-done', result: ev });
      this.queue.close();
    }
  }

  handleCodexNotification(method, params) {
    if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
      this.queue.push({ type: 'text', text: params.delta });
      return;
    }
    if (
      (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta')
      && typeof params?.delta === 'string'
    ) {
      this.queue.push({ type: 'thought', text: params.delta });
      return;
    }
    if (method === 'item/started' && params?.item) {
      const item = params.item;
      if (item.type === 'commandExecution') {
        this.registerToolCall({
          toolCallId: item.id,
          title: item.command ? `Run: ${item.command}` : 'Terminal Command',
          kind: 'execute',
          rawInput: { command: item.command, cwd: item.cwd },
          status: 'in_progress',
        });
      } else if (item.type === 'fileChange') {
        this.registerToolCall({
          toolCallId: item.id,
          title: 'Edit Files',
          kind: 'edit',
          rawInput: item.changes,
          status: 'in_progress',
        });
      } else if (item.type === 'mcpToolCall' || item.type === 'webSearch') {
        this.registerToolCall({
          toolCallId: item.id,
          title: item.tool || item.query || item.type,
          kind: item.type === 'webSearch' ? 'search' : 'other',
          rawInput: item.arguments || { query: item.query },
          status: 'in_progress',
        });
      }
      return;
    }
    if (method === 'item/completed' && params?.item) {
      const item = params.item;
      const existing = this.toolCalls.get(String(item.id || ''));
      if (existing) {
        this._applyToolCallUpdate(existing, {
          status: item.status === 'failed' ? 'failed' : 'completed',
          rawOutput: item.aggregatedOutput || item.output || 'Completed',
        });
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated' && params?.tokenUsage?.total) {
      const tot = params.tokenUsage.total;
      this.usage = {
        inputTokens: Number(tot.inputTokens) || this.usage.inputTokens,
        outputTokens: Number(tot.outputTokens) || this.usage.outputTokens,
      };
      return;
    }
    if (method === 'turn/completed') {
      const turn = params?.turn || {};
      if (turn.status === 'failed' && turn.error) {
        this.fail(new Error(turn.error.message || 'Codex turn failed'));
        return;
      }
      this.promptDone = true;
      this._completeOpenTools();
      this.queue.push({ type: 'prompt-done', result: turn });
      this.queue.close();
      if (this.connection.activeTurn === this) {
        this.connection.activeTurn = null;
      }
    }
  }

  _cancelPendingTools() {
    for (const [, tc] of this.toolCalls) {
      if (tc.pendingPermission) {
        tc.pendingPermission.resolve('cancelled');
        tc.pendingPermission = null;
      }
      for (const w of tc.waiters) w();
      tc.waiters.length = 0;
    }
  }

  _completeOpenTools() {
    for (const [, tc] of this.toolCalls) {
      if (tc.status !== 'completed' && tc.status !== 'failed') {
        tc.status = 'completed';
      }
      for (const w of tc.waiters) w();
      tc.waiters.length = 0;
    }
  }

  registerToolCall(update) {
    const rawId = String(update.toolCallId || `acp-tc-${crypto.randomUUID()}`);
    let entry = this.toolCalls.get(rawId);
    if (!entry) {
      const toolName = mapAcpToolName(update, this.connection.agentConfig.name);
      const argsObj = formatAcpToolArguments(update);
      entry = {
        toolCallId: rawId,
        name: toolName,
        args: argsObj,
        title: update.title || toolName,
        kind: update.kind || 'other',
        status: update.status || 'pending',
        outputText: extractAcpToolOutput(update),
        emittedToStream: false,
        pendingPermission: null,
        onPermissionArrived: null,
        waiters: [],
      };
      this.toolCalls.set(rawId, entry);
      this.queue.push({ type: 'tool-call', entry });
    } else {
      this._applyToolCallUpdate(entry, update);
    }
    return entry;
  }

  _applyToolCallUpdate(entry, update) {
    if (typeof update.title === 'string' && update.title.trim()) {
      entry.title = update.title.trim();
    }
    if (typeof update.kind === 'string' && update.kind.trim()) {
      entry.kind = update.kind.trim();
    }
    if (typeof update.status === 'string') {
      entry.status = update.status;
    }
    const text = extractAcpToolOutput(update);
    if (text && text !== 'Completed') {
      entry.outputText = text;
    }
    if (entry.status === 'completed' || entry.status === 'failed' || this.promptDone) {
      for (const w of entry.waiters) w();
      entry.waiters.length = 0;
    }
  }

  handleSessionUpdate(update) {
    const kind = update.sessionUpdate;
    if (kind === 'agent_thought_chunk') {
      const text = update.content?.type === 'text' ? update.content.text : update.text;
      if (typeof text === 'string' && text.length > 0) {
        this.queue.push({ type: 'thought', text });
      }
      return;
    }
    if (kind === 'agent_message_chunk') {
      const text = update.content?.type === 'text' ? update.content.text : update.text;
      if (typeof text === 'string' && text.length > 0) {
        this.queue.push({ type: 'text', text });
      }
      return;
    }
    if (kind === 'plan' && Array.isArray(update.entries) && update.entries.length > 0) {
      const lines = update.entries
        .map((e) => {
          const mark = e.status === 'completed' ? '[x]' : e.status === 'in_progress' ? '[~]' : '[ ]';
          return `${mark} ${e.content || ''}`.trim();
        })
        .filter(Boolean);
      if (lines.length > 0) {
        this.queue.push({ type: 'thought', text: `\nPlan:\n${lines.join('\n')}\n` });
      }
      return;
    }
    if (kind === 'usage_update') {
      if (typeof update.used === 'number') {
        this.usage.inputTokens = update.used;
      }
      return;
    }
    if (kind === 'tool_call') {
      this.registerToolCall(update);
      return;
    }
    if (kind === 'tool_call_update') {
      const rawId = String(update.toolCallId || '');
      const existing = this.toolCalls.get(rawId);
      if (existing) {
        this._applyToolCallUpdate(existing, update);
      } else if (rawId) {
        this.registerToolCall(update);
      }
    }
  }

  fail(error) {
    if (this.promptDone) return;
    this.promptDone = true;
    this.promptError = error;
    for (const [, tc] of this.toolCalls) {
      tc.status = 'failed';
      tc.outputText = error?.message || String(error);
      for (const w of tc.waiters) w();
      tc.waiters.length = 0;
    }
    this.queue.push({ type: 'prompt-error', error });
    this.queue.close();
  }
}

/**
 * Probe an ACP / App-Server / Claude-Stream agent configuration.
 */
export async function testAcpAgentConfig(ctx, agentConfig, cwd = process.cwd()) {
  const binary = resolveCommandBinary(agentConfig.command, agentConfig.env);
  if (!binary) {
    return {
      ok: false,
      binaryFound: false,
      binaryPath: null,
      error: `Command "${agentConfig.command}" was not found in PATH.`,
    };
  }
  const conn = new AcpClientConnection({
    ctx,
    agentConfig: { ...agentConfig, command: binary },
    cwd,
  });
  try {
    const info = await conn.ensureReady();
    return {
      ok: true,
      binaryFound: true,
      binaryPath: binary,
      sessionId: info.sessionId,
      agentInfo: info.agentInfo,
      configOptions: info.configOptions,
    };
  } catch (err) {
    return {
      ok: false,
      binaryFound: true,
      binaryPath: binary,
      error: err?.message || String(err),
    };
  } finally {
    await conn.close();
  }
}
