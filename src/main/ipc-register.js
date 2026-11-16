'use strict';

/**
 * Single registration path for main-process IPC channels. Every listener is
 * wrapped so caller authorization (`assertIpcSender` role checks or a
 * channel-owned `authorize`, e.g. an ownership-frame check) and argument
 * shape validation run before the handler — a channel can no longer be
 * mounted with either gate forgotten.
 *
 * `authorize(event)` runs first and its return value is handed to
 * `validate(args, auth)`, so ownership helpers that double as tracking
 * (pty `track`, preview `remember`) or produce a useful result (a role, the
 * owning window/view) fold it into the normalized handler arguments instead
 * of re-running the check inside the handler.
 *
 * `kind: 'invoke'` in the contract mounts `ipcMain.handle`: authorization
 * and validation throws become `invoke` rejections, same as before.
 * `kind: 'send'` mounts `ipcMain.on`: any failure is dropped and logged —
 * a bad `send` must not turn into an uncaught main-process exception.
 */

/** Coded rejection shared by channel-owned sender checks. */
function unauthorizedError() {
  const error = new Error('Unauthorized IPC sender');
  error.code = 'ERR_DSH_IPC_SENDER';
  return error;
}

/**
 * Validator for channels that take no arguments. The call is normalized to
 * zero handler arguments: renderer-supplied payloads are dropped before the
 * handler runs (the old handlers ignored their argument list the same way,
 * so an "evil" extra arg can never reach them).
 */
function noArgs() {
  return [];
}

/** Generous ceiling for renderer-supplied strings; real payloads are small. */
const MAX_IPC_STRING = 128 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Single required plain-object argument. */
function requiredObject(args) {
  const [value] = args;
  if (!isPlainObject(value)) throw new Error('expected a plain object argument');
  return [value];
}

/** Optional plain-object argument (undefined stays undefined). */
function optionalObject(args) {
  const [value] = args;
  if (value !== undefined && !isPlainObject(value)) throw new Error('expected a plain object argument');
  return [value];
}

/** Single required string argument. */
function requiredString(args) {
  const [value] = args;
  if (typeof value !== 'string' || value.length > MAX_IPC_STRING) throw new Error('expected a string argument');
  return [value];
}

/** Optional string argument (undefined stays undefined). */
function optionalString(args) {
  const [value] = args;
  if (value !== undefined && (typeof value !== 'string' || value.length > MAX_IPC_STRING)) throw new Error('expected a string argument');
  return [value];
}

// #436: kind/roles/validate live in src/shared/ipc-contract.js, not at the
// call site. `contractEntries` is injected only by tests; production code
// resolves the contract lazily so this module never cycles with it.
function contractEntry(channel, contractEntries) {
  const entries = contractEntries || require('../shared/ipc-contract').IPC_CONTRACT;
  return entries.find((candidate) => (
    candidate.channel === channel && candidate.kind !== 'event' && candidate.pending !== true
  ));
}

function mount(ipc, spec, contractEntries) {
  const { channel, authorize, senderOptions, handler } = spec;
  if (typeof channel !== 'string' || channel === '') {
    throw new TypeError('registerIpc requires a channel name');
  }
  if (spec.kind !== undefined || spec.roles !== undefined || spec.validate !== undefined) {
    throw new TypeError(
      `registerIpc(${channel}): kind/roles/validate are declared in src/shared/ipc-contract.js`,
    );
  }
  if (typeof handler !== 'function') {
    throw new TypeError(`registerIpc(${channel}) requires a handler function`);
  }
  const entry = contractEntry(channel, contractEntries);
  if (!entry) {
    throw new TypeError(
      `registerIpc(${channel}): channel is not declared in src/shared/ipc-contract.js`,
    );
  }
  const validate = entry.validate;
  if (typeof validate !== 'function') {
    throw new TypeError(`registerIpc(${channel}) requires validate and handler functions`);
  }
  if (entry.authorize === 'channel-owned') {
    if (typeof authorize !== 'function') {
      throw new TypeError(`registerIpc(${channel}) requires the module-owned authorize`);
    }
  } else if (authorize !== undefined) {
    throw new TypeError(
      `registerIpc(${channel}) uses role authorization; a call-site authorize is not allowed`,
    );
  }
  const kind = entry.kind === 'send' ? 'on' : 'handle';
  // Resolved at call time: tests swap './ipc-authorization' in require.cache
  // before loading a module that registers channels through here.
  const check = typeof authorize === 'function'
    ? authorize
    : (event) => require('./ipc-authorization').assertIpcSender(event, entry.roles, senderOptions);
  // The listener mirrors the handler's declared syncness: tests (and any
  // caller invoking the captured listener directly) see a synchronous throw
  // for sync handlers and a rejection for async ones — identical to the
  // direct ipcMain.handle registration this wrapper replaces.
  const dispatch = (event, args) => {
    const auth = check(event);
    const normalized = validate(args, auth);
    if (!Array.isArray(normalized)) {
      throw new TypeError(`registerIpc(${channel}) validate must return an argument array`);
    }
    return handler(event, ...normalized);
  };
  const listener = handler.constructor.name === 'AsyncFunction'
    ? async (event, ...args) => dispatch(event, args)
    : (event, ...args) => dispatch(event, args);
  if (kind === 'on') {
    ipc.on(channel, (event, ...args) => {
      try {
        const result = listener(event, ...args);
        if (result && typeof result.catch === 'function') {
          result.catch((error) => console.warn(`dshd ipc: ${channel} handler failed`, error));
        }
      } catch (error) {
        console.warn(`dshd ipc: dropped ${channel} message`, error);
      }
    });
    return;
  }
  if (kind !== 'handle') {
    throw new TypeError(`registerIpc(${channel}): unknown kind "${kind}"`);
  }
  ipc.handle(channel, listener);
}

/** Register on Electron's ipcMain (resolved at call time for test seams). */
function registerIpc(spec) {
  mount(require('electron').ipcMain, spec);
}

/** Bind registration to an injected ipcMain-compatible object. */
function createRegisterIpc(ipc, contractEntries) {
  return (spec) => mount(ipc, spec, contractEntries);
}

module.exports = {
  registerIpc,
  createRegisterIpc,
  noArgs,
  unauthorizedError,
  isPlainObject,
  MAX_IPC_STRING,
  requiredObject,
  optionalObject,
  requiredString,
  optionalString,
};
