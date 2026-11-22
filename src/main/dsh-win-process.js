'use strict';

const path = require('node:path');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/**
 * @typedef {(cmd: string, args: string[], timeoutMs: number, run: any) => Promise<string>} ExecTimedFn
 * @typedef {{ confirmedManagedShell?: boolean, expectedCommand?: string }} WindowsShellContext
 */
/** @type {{ OpenProcess: Function, CloseHandle: Function, GetProcessTimes: Function, FILETIME: unknown } | null | undefined} */
let winTimesApi;

function loadWinTimesApi() {
  if (winTimesApi !== undefined) return winTimesApi;
  if (process.platform !== 'win32') {
    winTimesApi = null;
    return null;
  }
  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const FILETIME = koffi.struct('DshWinProcessFileTime', {
      dwLowDateTime: 'uint32',
      dwHighDateTime: 'uint32',
    });
    winTimesApi = {
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'),
      GetProcessTimes: kernel32.func(
        'bool __stdcall GetProcessTimes(void* hProcess, _Out_ DshWinProcessFileTime* lpCreationTime, _Out_ DshWinProcessFileTime* lpExitTime, _Out_ DshWinProcessFileTime* lpKernelTime, _Out_ DshWinProcessFileTime* lpUserTime)',
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void* hObject)'),
      FILETIME,
    };
  } catch {
    // Koffi or kernel32 bindings unavailable; fall back to the PowerShell start-time path.
    winTimesApi = null;
  }
  return winTimesApi;
}

/**
 * Read a Windows process creation time without spawning PowerShell.
 * Returns `''` when the process is gone or cannot be opened; returns `null`
 * only when the native API is unavailable so callers can fall back.
 * @param {number} pid
 * @returns {string | null}
 */
function readWindowsStartTimeNative(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return '';
  const api = loadWinTimesApi();
  if (!api) return null;
  const handle = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, numericPid);
  if (!handle) return '';
  try {
    /** @type {{ dwLowDateTime?: number, dwHighDateTime?: number }} */
    const creation = {};
    const exit = {};
    const kernel = {};
    const user = {};
    if (!api.GetProcessTimes(handle, creation, exit, kernel, user)) return '';
    const ticks = (BigInt((creation.dwHighDateTime ?? 0) >>> 0) << 32n) | BigInt((creation.dwLowDateTime ?? 0) >>> 0);
    return ticks > 0n ? `winft:${ticks.toString()}` : '';
  } catch {
    // Process exited or query permission denied; return empty string so ownership fails closed.
    return '';
  } finally {
    try { api.CloseHandle(handle); } catch { /* Handle already closed or invalid. */ }
  }
}

/**
 * Non-blocking Windows process start time via GetProcessTimes, with PowerShell
 * fallback only when a test runner overrides `run` or Koffi is unavailable.
 * @param {number} pid
 * @param {any} run
 * @param {any} defaultRun
 * @param {ExecTimedFn} execTimed
 * @returns {Promise<string>}
 */
async function windowsProcessStartTime(pid, run, defaultRun, execTimed) {
  if (run === defaultRun) {
    const native = readWindowsStartTimeNative(pid);
    if (native !== null) return native;
  }
  try {
    return (await execTimed(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)}).StartTime.ToString('o')`],
      3000,
      run,
    )).trim();
  } catch {
    // PowerShell lookup timed out or process disappeared; return empty string so ownership fails closed.
    return '';
  }
}

/**
 * @param {number} pid
 * @param {any} run
 * @param {ExecTimedFn} execTimed
 * @returns {Promise<string>}
 */
async function processCommandLine(pid, run, execTimed) {
  try {
    return (await execTimed(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`],
      2500,
      run,
    )).trim();
  } catch {
    // CIM lookup failed or process exited; callers fall back to confirmedManagedShell context.
    return '';
  }
}

/**
 * @param {string} cmdLine
 * @param {string} [expectedCommand]
 * @returns {boolean}
 */
function isOwnedHarnessCommandLine(cmdLine, expectedCommand = '') {
  const text = String(cmdLine || '').trim();
  if (!text) return false;
  if (/(?:^|[\s"'\\/])dsh\.(?:cmd|bat)(?:["'\s]|$)/i.test(text)) return true;
  if (/(?:^|[\s"'\\/])npx\.(?:cmd|bat)\b.*@deepseek-ai\/dsh\b/i.test(text)) return true;
  if (/dsh-cli-runner\.mjs/i.test(text)) return true;
  if (expectedCommand) {
    const base = path.basename(String(expectedCommand)).toLowerCase();
    if (/\.(cmd|bat)$/i.test(base) && text.toLowerCase().includes(base) && /\bweb\b/i.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Allow cleanup of a Windows cmd.exe wrapper only when its live command line
 * proves it belongs to dsh/Harness, or when startTime+pidfile ownership was
 * already confirmed in a restricted environment where CIM cannot be queried.
 * @param {number} pid
 * @param {any} run
 * @param {ExecTimedFn} execTimed
 * @param {WindowsShellContext} [context]
 * @returns {Promise<boolean>}
 */
async function isSafeWindowsShell(pid, run, execTimed, context = {}) {
  const cmdLine = await processCommandLine(pid, run, execTimed);
  if (cmdLine) {
    return isOwnedHarnessCommandLine(cmdLine, context.expectedCommand);
  }
  return context.confirmedManagedShell === true;
}

/**
 * @param {any} runOrContext
 * @param {WindowsShellContext | undefined} maybeContext
 * @param {any} defaultRun
 * @returns {{ run: any, context: WindowsShellContext }}
 */
function resolveKillArgs(runOrContext, maybeContext, defaultRun) {
  return typeof runOrContext === 'function'
    ? { run: runOrContext, context: maybeContext || {} }
    : { run: defaultRun, context: runOrContext || {} };
}

/**
 * @param {{ shell?: boolean } | null | undefined} entry
 * @returns {WindowsShellContext | undefined}
 */
function pidFileShellContext(entry) {
  return entry && entry.shell === true ? { confirmedManagedShell: true } : undefined;
}

/**
 * @param {Map<number, string>} shellPids
 * @param {{ pid?: number, once?: Function } | null | undefined} child
 * @param {string} launchCommand
 * @returns {boolean}
 */
function trackManagedShell(shellPids, child, launchCommand) {
  if (!child?.pid || process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(String(launchCommand || ''))) {
    return false;
  }
  const pid = child.pid;
  shellPids.set(pid, launchCommand);
  child.once?.('exit', () => shellPids.delete(pid));
  return true;
}

/**
 * @param {Map<number, string>} shellPids
 * @param {number} pid
 * @returns {WindowsShellContext | undefined}
 */
function managedShellStopContext(shellPids, pid) {
  const expectedCommand = shellPids.get(pid);
  return expectedCommand === undefined
    ? undefined
    : { confirmedManagedShell: true, expectedCommand };
}

module.exports = {
  resolveKillArgs,
  pidFileShellContext,
  trackManagedShell,
  managedShellStopContext,
  readWindowsStartTimeNative,
  windowsProcessStartTime,
  processCommandLine,
  isOwnedHarnessCommandLine,
  isSafeWindowsShell,
};
