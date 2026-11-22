/**
 * AclSandbox orchestration failure-path tests: the win32 resolver is mocked
 * to hand each test a stub binding table, so every checked Win32 call in
 * init/spawn/dispose has a failing counterpart without opening real token or
 * ACL handles. Constructor validation, the fail-closed init cleanup, and the
 * dispose aggregation use the same stubs. Pure stubs — no real Win32 calls,
 * so these run on every platform; the real-FFI round-trip lives in
 * acl.spec.ts and runner.spec.ts (win32 only).
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Win32Error } from '@deepseek-ai/dsh-win32-process'
import { ERROR_BROKEN_PIPE } from '@deepseek-ai/dsh-win32-process/src/abi.ts'
import { processInformationType } from '@deepseek-ai/dsh-win32-process/src/ffi.ts'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { allocBytes, ptrAddress } from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import { AclSandbox, revokeWorkspaceGrant, workspaceWriteSid } from '../src/index.ts'
import * as abi from '../src/win32-abi.ts'

const PVOID = koffi.pointer('void')

function craftEmptyAcl(): NativePtr {
  const acl = allocBytes(8)
  koffi.encode(acl, 'uint8', 2)
  koffi.encode(acl, 2, 'uint16', 8)
  koffi.encode(acl, 4, 'uint16', 0)
  return acl
}

function craftSidBytes(authorityByte: number): NativePtr {
  const sid = allocBytes(8)
  koffi.encode(sid, 'uint8', 1)
  koffi.encode(sid, 1, 'uint8', 0)
  for (let i = 0; i < 5; i++) koffi.encode(sid, 2 + i, 'uint8', 0)
  koffi.encode(sid, 7, 'uint8', authorityByte)
  return sid
}

function craftGrantedAclWithWorldDeny(sidPtr: NativePtr, worldPtr: NativePtr): NativePtr {
  const acl = allocBytes(64)
  koffi.encode(acl, 'uint8', 2)
  koffi.encode(acl, 2, 'uint16', 40)
  koffi.encode(acl, 4, 'uint16', 2)
  // Entry 0: Everyone FILE_DELETE_CHILD deny (CONTAINER_INHERIT_ACE)
  koffi.encode(acl, 8, 'uint8', abi.ACCESS_DENIED_ACE_TYPE)
  koffi.encode(acl, 9, 'uint8', abi.CONTAINER_INHERIT_ACE)
  koffi.encode(acl, 10, 'uint16', 16)
  koffi.encode(acl, 12, 'uint32', abi.FILE_DELETE_CHILD)
  for (let i = 0; i < 8; i++) koffi.encode(acl, 16 + i, 'uint8', koffi.decode(worldPtr, i, 'uint8') as number)
  // Entry 1: Capability GRANT_MASK allow (SUB_CONTAINERS_AND_OBJECTS_INHERIT)
  koffi.encode(acl, 24, 'uint8', abi.ACCESS_ALLOWED_ACE_TYPE)
  koffi.encode(acl, 25, 'uint8', abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT)
  koffi.encode(acl, 26, 'uint16', 16)
  koffi.encode(acl, 28, 'uint32', abi.GRANT_MASK)
  for (let i = 0; i < 8; i++) koffi.encode(acl, 32 + i, 'uint8', koffi.decode(sidPtr, i, 'uint8') as number)
  return acl
}

type MockFn = ReturnType<typeof vi.fn>

/** The stub binding table plus the mocks the assertions inspect directly. */
interface HappyStubs {
  api: Win32Bindings
  createWellKnownSid: MockFn
  convertStringSidToSidW: MockFn
  setEntriesInAclW: MockFn
  deleteAce: MockFn
  setNamedSecurityInfoW: MockFn
  closeHandle: MockFn
  localFree: MockFn
  createRestrictedToken: MockFn
  createJobObjectW: MockFn
  getNamedSecurityInfoW: MockFn
  setTokenInformation: MockFn
  addMandatoryAce: MockFn
}

const state = vi.hoisted(() => ({ stubs: undefined as HappyStubs | undefined }))

vi.mock('../src/ffi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ffi.ts')>()
  return {
    ...actual,
    win32: () => Promise.resolve(state.stubs?.api as Win32Bindings),
    win32Sync: () => state.stubs?.api as Win32Bindings,
  }
})

const scratchDirs: string[] = []
afterAll(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-acl-index-'))
  scratchDirs.push(dir)
  return dir
}

/** Stub binding table: only the members a test drives, so the rest are never called. */
function stubBindings(overrides: Partial<Win32Bindings>): Win32Bindings {
  return overrides as Win32Bindings
}

/**
 * The stub the whole happy pipeline needs: token opening, capability-SID
 * parsing, workspace+temp grants, logon-SID scan, well-known SID, restricted token,
 * default-DACL merge, piped/inherited spawns, drains, and exit waits all
 * succeed. Every test flips one call per branch.
 */
function happyStubs(): HappyStubs {
  let next = 0n
  const fresh = (): NativePtr => ++next as NativePtr

  const openProcess = vi.fn(() => fresh())
  const openProcessToken = vi.fn((_process: unknown, _access: unknown, slot: NativePtr) => {
    koffi.encode(slot, PVOID, fresh())
    return 1
  })
  const convertStringSidToSidW = vi.fn((_sid: string, slot: NativePtr) => {
    koffi.encode(slot, PVOID, fresh())
    return 1
  })
  const getTempPathW = vi.fn((_length: number, buffer: Buffer) => {
    const temp = tmpdir().replace(/[\\/]$/u, '')
    buffer.write(temp, 'utf16le')
    return temp.length
  })
  const defaultDacl = craftEmptyAcl()
  const createFileW = vi.fn(() => fresh())
  const getNamedSecurityInfoW = vi.fn((
    _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
    dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
  ) => {
    koffi.encode(dacl, PVOID, ptrAddress(defaultDacl))
    koffi.encode(sacl, PVOID, 0n)
    koffi.encode(descriptor, PVOID, 0n)
    return 0
  })
  const setEntriesInAclW = vi.fn((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
    koffi.encode(newAcl, PVOID, fresh())
    return 0
  })
  const deleteAce = vi.fn(() => 1)
  const setNamedSecurityInfoW = vi.fn(() => 0)
  const localAlloc = vi.fn(() => fresh())
  const initializeAcl = vi.fn(() => 1)
  const addMandatoryAce = vi.fn(() => 1)
  const getTokenInformation = vi.fn((_token: unknown, cls: number, info: Buffer | null, _length: number, needed: NativePtr) => {
    if (info === null) {
      koffi.encode(needed, 'uint32', cls === abi.TokenGroups ? 24 : 8)
      return 0 // the size probe is expected to "fail"
    }
    if (cls === abi.TokenGroups) {
      info.writeUInt32LE(1, 0)
      info.writeBigUInt64LE(77n, abi.TOKEN_GROUPS_OFFSET)
      info.writeUInt32LE(abi.SE_GROUP_LOGON_ID, abi.TOKEN_GROUPS_OFFSET + 8)
    } else {
      info.writeBigUInt64LE(88n, 0) // the token's current default DACL
    }
    return 1
  })
  const getLengthSid = vi.fn(() => 12)
  const copySid = vi.fn(() => 1)
  const createWellKnownSid = vi.fn(() => 1)
  const isValidSid = vi.fn(() => 1)
  const createRestrictedToken = vi.fn((
    _existing: unknown, _flags: unknown, _dc: unknown, _ds: unknown, _pc: unknown, _pd: unknown,
    _rc: unknown, _rs: unknown, slot: NativePtr,
  ) => {
    koffi.encode(slot, PVOID, fresh())
    return 1
  })
  const setTokenInformation = vi.fn(() => 1)
  const createPipe = vi.fn((readSlot: NativePtr, writeSlot: NativePtr) => {
    koffi.encode(readSlot, PVOID, fresh())
    koffi.encode(writeSlot, PVOID, fresh())
    return 1
  })
  const setHandleInformation = vi.fn(() => 1)
  const createProcessAsUserW = vi.fn((
    _token: unknown, _app: unknown, _cmd: unknown, _pa: unknown, _ta: unknown,
    _inherit: unknown, _flags: unknown, _env: unknown, _cwd: unknown, _si: unknown, processInfo: NativePtr,
  ) => {
    koffi.encode(processInfo, processInformationType(), { hProcess: fresh(), hThread: fresh(), dwProcessId: 1234, dwThreadId: 5678 })
    return 1
  })
  const peekNamedPipe = vi.fn(() => 0)
  const readFile = vi.fn(() => 1)
  const waitForSingleObject = vi.fn(() => 0)
  const getExitCodeProcess = vi.fn((_process: unknown, slot: NativePtr) => {
    koffi.encode(slot, 'uint32', 42)
    return 1
  })
  const createJobObjectW = vi.fn(() => fresh())
  const setInformationJobObject = vi.fn(() => 1)
  const assignProcessToJobObject = vi.fn(() => 1)
  const resumeThread = vi.fn(() => 0)
  const terminateProcess = vi.fn(() => 1)
  const getStdHandle = vi.fn(() => fresh())
  const localFree = vi.fn(() => 0n as NativePtr)
  const closeHandle = vi.fn(() => 1)
  const getLastError = vi.fn(() => ERROR_BROKEN_PIPE) // the drains' clean EOF
  const formatMessageW = vi.fn(() => 0)

  const api = stubBindings({
    openProcess, openProcessToken, convertStringSidToSidW, getTempPathW, createFileW,
    lockFileEx: vi.fn(() => 1), unlockFileEx: vi.fn(() => 1),
    getNamedSecurityInfoW, setEntriesInAclW, setNamedSecurityInfoW, deleteAce, getTokenInformation,
    localAlloc, initializeAcl, addMandatoryAce,
    getLengthSid, copySid, createWellKnownSid, isValidSid, createRestrictedToken,
    setTokenInformation, createPipe, setHandleInformation, createProcessAsUserW,
    peekNamedPipe, readFile, waitForSingleObject, getExitCodeProcess, createJobObjectW,
    setInformationJobObject, assignProcessToJobObject, resumeThread, terminateProcess,
    getStdHandle,
    localFree, closeHandle, getLastError, formatMessageW,
  })
  return {
    api, createWellKnownSid, setEntriesInAclW, deleteAce, setNamedSecurityInfoW, convertStringSidToSidW, closeHandle, localFree,
    createRestrictedToken, createJobObjectW, getNamedSecurityInfoW, setTokenInformation, addMandatoryAce,
  }
}

beforeEach(() => {
  state.stubs = happyStubs()
})

describe('AclSandbox constructor validation', () => {
  it('rejects a writable directory that does not exist', () => {
    const missing = join(scratch(), 'missing')
    expect(() => new AclSandbox({ writableDirs: [missing], tempDir: null, mode: 'read-only' }))
      .toThrow(/writable dir does not exist/u)
  })

  it('resolves relative writable directories to absolute paths', () => {
    const dir = scratch()
    const sandbox = new AclSandbox({ writableDirs: [dir], tempDir: null, mode: 'read-only' })
    expect(sandbox.writableDirs).toEqual([resolve(dir)])
    expect(sandbox.mode).toBe('read-only')
    expect(sandbox.tempDir).toBeUndefined()
  })

  it('rejects temp authority under read-only', () => {
    const workspace = scratch()
    const temp = scratch()
    expect(() => new AclSandbox({ writableDirs: [workspace], tempDir: temp, mode: 'read-only' }))
      .toThrow(/read-only does not accept a temp directory/u)
    expect(() => new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-1', mode: 'read-only' }))
      .toThrow(/read-only does not accept write SIDs/u)
    expect(() => new AclSandbox({ writableDirs: [workspace], tempDir: null, tempWriteSid: 'S-1-4-9000-1-1', mode: 'read-only' }))
      .toThrow(/read-only does not accept write SIDs/u)
  })

  it('rejects a temp SID when temp writes are disabled', () => {
    const workspace = scratch()
    expect(() => new AclSandbox({
      writableDirs: [workspace],
      tempDir: null,
      writeSid: 'S-1-4-9000-2',
      tempWriteSid: 'S-1-4-9000-2-1',
      mode: 'workspace-write',
    })).toThrow(/temp write SID requires a temp directory/u)
  })
})

describe('AclSandbox init', () => {
  it('completes the happy workspace-write pipeline: workspace and temp grants, restricted token, resolved temp dir', async () => {
    const { setNamedSecurityInfoW } = state.stubs as HappyStubs
    const workspace = scratch()
    const temp = scratch()
    const sandbox = new AclSandbox({
      writableDirs: [workspace],
      tempDir: temp,
      writeSid: 'S-1-4-9000-1',
      tempWriteSid: 'S-1-4-9000-1-1',
      mode: 'workspace-write',
    })
    await sandbox.init()
    expect(sandbox.tempDir).toBe(resolve(temp))
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(2)
  })

  it('requires an explicit private temp directory or null under workspace-write', () => {
    const workspace = scratch()
    expect(() => new AclSandbox({ writableDirs: [workspace], writeSid: 'S-1-4-9000-2', mode: 'workspace-write' }))
      .toThrow(/requires an explicit private temp directory or null/u)
  })

  it('applies no grants when the temp dir option is null', async () => {
    const { setNamedSecurityInfoW } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-3', mode: 'workspace-write' })
    await sandbox.init()
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1) // workspace only
  })

  it('rejects a temp dir that does not exist', async () => {
    const workspace = scratch()
    const sandbox = new AclSandbox({
      writableDirs: [workspace],
      tempDir: join(scratch(), 'missing'),
      writeSid: 'S-1-4-9000-4',
      tempWriteSid: 'S-1-4-9000-4-1',
      mode: 'workspace-write',
    })
    await expect(sandbox.init()).rejects.toThrow(/temp dir does not exist/u)
  })

  it('builds a read-only token without parsing a write SID or applying grants', async () => {
    const { convertStringSidToSidW, setNamedSecurityInfoW } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, mode: 'read-only' })
    await sandbox.init()
    expect(convertStringSidToSidW).not.toHaveBeenCalled()
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
    expect(() => { sandbox.dispose() }).not.toThrow() // no write SID: nothing to revoke or free
  })

  it('applies no grants when the caller owns the DACLs (manageDacls: false)', async () => {
    const { setNamedSecurityInfoW } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-5', mode: 'workspace-write', manageDacls: false })
    await sandbox.init()
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
    expect(() => { sandbox.dispose() }).not.toThrow() // caller-owned DACLs: nothing to revoke
  })

  it('refuses a second init on the same instance', async () => {
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-6', mode: 'workspace-write' })
    await sandbox.init()
    await expect(sandbox.init()).rejects.toThrow(/already initialized/u)
  })

  it('reports a ConvertStringSidToSidW failure before granting anything', async () => {
    const { convertStringSidToSidW, setNamedSecurityInfoW } = state.stubs as HappyStubs
    convertStringSidToSidW.mockReturnValue(0)
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-7', mode: 'workspace-write' })
    await expect(sandbox.init()).rejects.toMatchObject({ api: 'ConvertStringSidToSidW' })
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
  })

  it('rejects a NULL write SID after ConvertStringSidToSidW succeeds', async () => {
    const { convertStringSidToSidW } = state.stubs as HappyStubs
    convertStringSidToSidW.mockImplementation(() => 1) // no out slot write
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-8', mode: 'workspace-write' })
    await expect(sandbox.init()).rejects.toBeInstanceOf(Win32Error)
  })

  it('aggregates failed current and restricted token closes after init', async () => {
    const { closeHandle, createRestrictedToken } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-9', mode: 'workspace-write' })
    const restrictedToken = 99n
    createRestrictedToken.mockImplementation((
      _existing: unknown, _flags: unknown, _dc: unknown, _ds: unknown, _pc: unknown, _pd: unknown,
      _rc: unknown, _rs: unknown, slot: NativePtr,
    ) => {
      koffi.encode(slot, PVOID, restrictedToken)
      return 1
    })
    // fresh() hands out 1n to OpenProcess and 2n to OpenProcessToken; the
    // token-layer close of 1n succeeds and init's close of 2n fails.
    closeHandle.mockImplementation((handle: NativePtr) => (handle === 2n || handle === restrictedToken ? 0 : 1))
    // The failure lands after this.token is stored but before this.api is
    // assigned. Cleanup retries the still-open handle and reports both close
    // failures plus the restricted-token close after releasing parsed SIDs.
    await expect(sandbox.init()).rejects.toMatchObject({
      errors: [
        { api: 'CloseHandle' },
        { api: 'CloseHandle' },
        { api: 'CloseHandle' },
      ],
    })
  })

  it('revokes the revocable grants and aggregates cleanup failures when the token pipeline fails', async () => {
    const { createRestrictedToken, localFree, getNamedSecurityInfoW } = state.stubs as HappyStubs
    const workspace = scratch()
    const temp = scratch()
    let inCleanup = false
    createRestrictedToken.mockImplementation(() => {
      inCleanup = true // the grants already landed: every later call is the cleanup's
      return 0
    })
    localFree.mockImplementation(() => (inCleanup ? 1n : 0n))
    const cleanDacl = craftEmptyAcl()
    getNamedSecurityInfoW.mockImplementation((
      _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
      dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
    ) => {
      if (inCleanup) return 2 // the cleanup's revocation read fails too
      koffi.encode(dacl, PVOID, ptrAddress(cleanDacl))
      koffi.encode(sacl, PVOID, 0n)
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    })
    const sandbox = new AclSandbox({
      writableDirs: [workspace],
      tempDir: temp,
      writeSid: 'S-1-4-9000-10',
      tempWriteSid: 'S-1-4-9000-10-1',
      mode: 'workspace-write',
    })
    // Five SID frees/mutations fail plus the Low label SID the init allocated.
    await expect(sandbox.init()).rejects.toThrow(/6 cleanup operation\(s\) also failed/u)
    expect(sandbox.tempDir).toBeUndefined()
  })
})

describe('AclSandbox spawn', () => {
  it('refuses control with piped stdio before starting a restricted process', async () => {
    const sandbox = new AclSandbox({ writableDirs: [], tempDir: null, mode: 'read-only' })
    await sandbox.init()
    expect(() => sandbox.spawn({ command: 'probe.exe', controlFileDescriptor: 7 })).toThrow('control pipe requires inherited stdio')
    sandbox.dispose()
  })

  it('forwards the inherited control pipe to the restricted child', async () => {
    const { api } = state.stubs as HappyStubs
    Object.assign(api, { uvGetOsfhandle: vi.fn(() => 107n), getFileType: vi.fn(() => 3) })
    const sandbox = new AclSandbox({ writableDirs: [], tempDir: null, mode: 'read-only' })
    await sandbox.init()
    const child = sandbox.spawn({ command: 'probe.exe', stdio: 'inherit', controlFileDescriptor: 7 })
    await expect(child.wait()).resolves.toEqual({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 42 })
    sandbox.dispose()
  })

  it('refuses to spawn before init', () => {
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-11', mode: 'workspace-write' })
    expect(() => sandbox.spawn({ command: 'probe.exe' })).toThrow(/not initialized/u)
  })

  it('pipe spawn drains empty pipes and settles with the child exit code', async () => {
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-12', mode: 'workspace-write' })
    await sandbox.init()
    const child = sandbox.spawn({ command: 'probe.exe', args: ['--flag'], cwd: workspace })
    expect(child.pid).toBe(1234)
    const expected = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 42 }
    await expect(child.wait()).resolves.toEqual(expected)
    // The second wait reuses the settled exit-code promise instead of re-waiting.
    await expect(child.wait()).resolves.toEqual(expected)
  })

  it('inherit spawn settles with empty stdio and closes the kill-on-close job', async () => {
    const { closeHandle } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-13', mode: 'workspace-write' })
    await sandbox.init()
    const child = sandbox.spawn({ command: 'probe.exe', stdio: 'inherit' })
    await expect(child.wait()).resolves.toEqual({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 42 })
    expect(closeHandle).toHaveBeenCalled()
  })

  it('inherit spawn reports a failed close of the kill-on-close job', async () => {
    const { closeHandle, createJobObjectW } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-14', mode: 'workspace-write' })
    await sandbox.init()
    let jobHandle = 0n
    closeHandle.mockImplementation((handle: NativePtr) => (handle === jobHandle ? 0 : 1))
    const child = sandbox.spawn({ command: 'probe.exe', stdio: 'inherit' })
    jobHandle = createJobObjectW.mock.results.at(-1)?.value as NativePtr
    await expect(child.wait()).rejects.toMatchObject({ api: 'CloseHandle' })
  })
})

describe('AclSandbox dispose', () => {
  it('is a no-op before init', () => {
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-15', mode: 'workspace-write' })
    expect(() => { sandbox.dispose() }).not.toThrow()
  })

  it('aggregates a failing temp revocation into an AggregateError', async () => {
    const { getNamedSecurityInfoW } = state.stubs as HappyStubs
    const workspace = scratch()
    const temp = scratch()
    const sandbox = new AclSandbox({
      writableDirs: [workspace],
      tempDir: temp,
      writeSid: 'S-1-4-9000-16',
      tempWriteSid: 'S-1-4-9000-16-1',
      mode: 'workspace-write',
    })
    await sandbox.init()
    getNamedSecurityInfoW.mockReturnValue(2)
    expect(() => { sandbox.dispose() }).toThrow(/1 cleanup failure/u)
  })

  it('aggregates SID and token cleanup failures into an AggregateError', async () => {
    const { localFree } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-17', mode: 'workspace-write' })
    await sandbox.init()
    localFree.mockReturnValue(1n)
    expect(() => { sandbox.dispose() }).toThrow(AggregateError)
  })

  it('reports a failed close of the restricted token', async () => {
    const { createRestrictedToken, closeHandle } = state.stubs as HappyStubs
    const workspace = scratch()
    const sandbox = new AclSandbox({ writableDirs: [workspace], tempDir: null, writeSid: 'S-1-4-9000-18', mode: 'workspace-write' })
    let restrictedToken = 0n
    createRestrictedToken.mockImplementation((
      _existing: unknown, _flags: unknown, _dc: unknown, _ds: unknown, _pc: unknown, _pd: unknown,
      _rc: unknown, _rs: unknown, slot: NativePtr,
    ) => {
      restrictedToken = 99n
      koffi.encode(slot, PVOID, restrictedToken)
      return 1
    })
    closeHandle.mockImplementation((handle: NativePtr) => (handle === restrictedToken ? 0 : 1))
    await sandbox.init()
    expect(() => { sandbox.dispose() }).toThrow(AggregateError)
  })
})

describe('AclSandbox extraDirs, extraWriteSids, and revokeWorkspaceAclOnDispose', () => {
  const ownedDirs: string[] = []
  afterEach(() => {
    for (const dir of ownedDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    ownedDirs.push(dir)
    return dir
  }

  it('merges validated extraDirs and extraWriteSids into writableDirs and writeSids and passes all SIDs to CreateRestrictedToken', async () => {
    const { createRestrictedToken } = state.stubs as HappyStubs
    const ws = tempDir('dsh-acl-ws-')
    const extra1 = tempDir('dsh-acl-extra1-')
    const extra2 = tempDir('dsh-acl-extra2-')
    const sandbox = new AclSandbox({
      writableDirs: [ws],
      extraDirs: [extra1, extra2],
      tempDir: null,
      writeSid: workspaceWriteSid(ws),
      extraWriteSids: ['S-1-4-9100-1', 'S-1-4-9100-2'],
      mode: 'workspace-write',
    })
    expect(sandbox.extraDirs).toEqual([resolve(extra1), resolve(extra2)])
    expect(sandbox.writableDirs).toEqual([resolve(ws), resolve(extra1), resolve(extra2)])
    expect(sandbox.extraWriteSids).toEqual(['S-1-4-9100-1', 'S-1-4-9100-2'])
    expect(sandbox.writeSids).toEqual([workspaceWriteSid(ws), 'S-1-4-9100-1', 'S-1-4-9100-2'])
    await sandbox.init()
    // 1 workspace SID + 2 extra SIDs + 2 baseline SIDs (logon + Everyone) = 5 restricting SIDs
    expect(createRestrictedToken.mock.calls[0]?.[6]).toBe(5)
    sandbox.dispose()
  })

  it('derives extraWriteSids via workspaceWriteSid when omitted and rejects symlinks/non-dirs/mismatches', () => {
    const ws = tempDir('dsh-acl-ws-')
    const extra = tempDir('dsh-acl-extra-')
    const file = join(ws, 'file.txt')
    writeFileSync(file, 'x')
    const linkDir = join(ws, 'link-dir')
    symlinkSync(extra, linkDir, process.platform === 'win32' ? 'junction' : 'dir')

    const derived = new AclSandbox({
      writableDirs: [ws],
      extraDirs: [extra],
      tempDir: null,
      writeSid: workspaceWriteSid(ws),
      mode: 'workspace-write',
    })
    expect(derived.extraWriteSids).toEqual([workspaceWriteSid(extra)])
    expect(derived.writeSids).toEqual([workspaceWriteSid(ws), workspaceWriteSid(extra)])

    expect(() => new AclSandbox({
      writableDirs: [ws],
      extraDirs: [linkDir],
      tempDir: null,
      writeSid: workspaceWriteSid(ws),
      mode: 'workspace-write',
    })).toThrow(/symbolic link/u)

    expect(() => new AclSandbox({
      writableDirs: [ws],
      extraDirs: [file],
      tempDir: null,
      writeSid: workspaceWriteSid(ws),
      mode: 'workspace-write',
    })).toThrow(/not a directory/u)

    expect(() => new AclSandbox({
      writableDirs: [ws],
      extraDirs: [extra],
      extraWriteSids: ['S-1-4-9100-1', 'S-1-4-9100-2'],
      tempDir: null,
      writeSid: workspaceWriteSid(ws),
      mode: 'workspace-write',
    })).toThrow(/length must match/u)

    expect(() => new AclSandbox({
      writableDirs: [ws],
      extraDirs: [extra],
      extraWriteSids: ['S-1-4-9100-1'],
      tempDir: null,
      mode: 'read-only',
    })).toThrow(/read-only does not accept write SIDs/u)
  })

  it('revokes workspace and extra grants plus world-deny ACEs when revokeWorkspaceAclOnDispose is true', async () => {
    const {
      createWellKnownSid, convertStringSidToSidW, getNamedSecurityInfoW,
      setEntriesInAclW, deleteAce, setNamedSecurityInfoW,
    } = state.stubs as HappyStubs
    const ws = tempDir('dsh-acl-ws-')
    const extra = tempDir('dsh-acl-extra-')
    const sid = craftSidBytes(5)
    const world = craftSidBytes(1)
    const grantedAcl = craftGrantedAclWithWorldDeny(sid, world)
    createWellKnownSid.mockImplementation((type: number, _domain: unknown, outSid: NativePtr) => {
      koffi.encode(outSid, 0, 'uint8', 1)
      koffi.encode(outSid, 1, 'uint8', 0)
      for (let i = 2; i < 7; i++) koffi.encode(outSid, i, 'uint8', 0)
      koffi.encode(outSid, 7, 'uint8', type === abi.WinLowLabelSid ? 16 : 1)
      return 1
    })
    convertStringSidToSidW.mockImplementation((_sid: string, slot: NativePtr) => {
      koffi.encode(slot, PVOID, ptrAddress(sid))
      return 1
    })

    const sandbox = new AclSandbox({
      writableDirs: [ws],
      extraDirs: [extra],
      tempDir: null,
      writeSid: workspaceWriteSid(ws),
      revokeWorkspaceAclOnDispose: true,
      mode: 'workspace-write',
    })
    await sandbox.init()
    const mergeCallsBeforeDispose = setEntriesInAclW.mock.calls.length

    getNamedSecurityInfoW.mockImplementation((
      _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
      dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
    ) => {
      koffi.encode(dacl, PVOID, ptrAddress(grantedAcl))
      koffi.encode(sacl, PVOID, 0n)
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    })
    setEntriesInAclW.mockImplementation((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
      koffi.encode(newAcl, PVOID, ptrAddress(grantedAcl))
      return 0
    })

    sandbox.dispose()
    const disposeMerges = setEntriesInAclW.mock.calls.slice(mergeCallsBeforeDispose)
    expect(disposeMerges.length).toBe(2) // ws + extra
    expect(disposeMerges.map(call => Number(call[0]))).toEqual([1, 1])
    expect(deleteAce).toHaveBeenCalledTimes(2)
    expect(setNamedSecurityInfoW.mock.calls.slice(-2).every(
      call => ((call[2] as number) & abi.LABEL_SECURITY_INFORMATION) !== 0,
    )).toBe(true)
  })

  it('keeps workspace grants standing on dispose when revokeWorkspaceAclOnDispose defaults to false', async () => {
    const { setEntriesInAclW } = state.stubs as HappyStubs
    const ws = tempDir('dsh-acl-ws-')
    const extra = tempDir('dsh-acl-extra-')
    const sandbox = new AclSandbox({
      writableDirs: [ws],
      extraDirs: [extra],
      tempDir: null,
      writeSid: workspaceWriteSid(ws),
      mode: 'workspace-write',
    })
    await sandbox.init()
    const mergeCallsBeforeDispose = setEntriesInAclW.mock.calls.length
    sandbox.dispose()
    expect(setEntriesInAclW.mock.calls.length).toBe(mergeCallsBeforeDispose)
  })

  it('revokeWorkspaceGrant revokes explicit or derived capability grants and aggregates cleanup failures', () => {
    const {
      api, createWellKnownSid, convertStringSidToSidW, getNamedSecurityInfoW,
      setEntriesInAclW, deleteAce, localFree,
    } = state.stubs as HappyStubs
    const ws = tempDir('dsh-acl-ws-')
    const sid = craftSidBytes(5)
    const world = craftSidBytes(1)
    const grantedAcl = craftGrantedAclWithWorldDeny(sid, world)
    createWellKnownSid.mockImplementation((type: number, _domain: unknown, outSid: NativePtr) => {
      koffi.encode(outSid, 0, 'uint8', 1)
      koffi.encode(outSid, 1, 'uint8', 0)
      for (let i = 2; i < 7; i++) koffi.encode(outSid, i, 'uint8', 0)
      koffi.encode(outSid, 7, 'uint8', type === abi.WinLowLabelSid ? 16 : 1)
      return 1
    })
    convertStringSidToSidW.mockImplementation((_sid: string, slot: NativePtr) => {
      koffi.encode(slot, PVOID, ptrAddress(sid))
      return 1
    })

    getNamedSecurityInfoW.mockImplementationOnce((
      _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
      dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
    ) => {
      koffi.encode(dacl, PVOID, 0n)
      koffi.encode(sacl, PVOID, 0n)
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    })
    expect(revokeWorkspaceGrant(ws, undefined, api)).toBe(false)

    getNamedSecurityInfoW.mockImplementation((
      _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
      dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
    ) => {
      koffi.encode(dacl, PVOID, ptrAddress(grantedAcl))
      koffi.encode(sacl, PVOID, 0n)
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    })
    setEntriesInAclW.mockImplementation((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
      koffi.encode(newAcl, PVOID, ptrAddress(grantedAcl))
      return 0
    })
    expect(revokeWorkspaceGrant(ws, 'S-1-4-9200-1', api)).toBe(true)
    expect(setEntriesInAclW.mock.calls.at(-1)?.[0]).toBe(1)
    expect(deleteAce).toHaveBeenCalledTimes(1)

    localFree.mockReturnValue(1n)
    expect(() => revokeWorkspaceGrant(ws, undefined, api)).toThrow(AggregateError)
  })
})
