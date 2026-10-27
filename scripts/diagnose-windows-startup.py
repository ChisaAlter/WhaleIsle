"""Inspect a new Electron child, optionally reproducing a low-integrity launch.

Usage: python scripts/diagnose-windows-startup.py --exe C:\\path\\electron.exe --output C:\\scratch\\probe [--low-token]
The executable must be an Electron distribution with default_app.asar, not a product
app.asar. The command never changes executable ACLs, an existing process or profile.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    if sys.platform != 'win32':
        raise SystemExit('This diagnosis uses Windows process tokens.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--low-token', action='store_true', help='Lower only the new child token to Low; keep file labels unchanged.')
    args = parser.parse_args()
    exe = args.exe.resolve(strict=True)
    output = args.output.resolve()
    if output.exists():
        raise SystemExit('Output must be a new directory so old results cannot look like success.')
    resources = exe.parent / 'resources'
    if (resources / 'app.asar').exists() or (resources / 'app' / 'package.json').exists():
        raise SystemExit('Use an unmodified Electron distribution or a copy with only default_app.asar. A product executable ignores the probe entry point.')
    if not (resources / 'default_app.asar').is_file():
        raise SystemExit('Electron default_app.asar is missing.')
    fixture = Path(__file__).parent / 'fixtures' / 'windows-startup-minimal.cjs'
    output.mkdir(parents=True)
    (output / 'temp').mkdir()
    k = c.WinDLL('kernel32', use_last_error=True)
    a = c.WinDLL('advapi32', use_last_error=True)
    k.GetCurrentProcess.restype = w.HANDLE
    k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    k.OpenProcess.restype = w.HANDLE
    k.CloseHandle.argtypes = [w.HANDLE]
    k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    k.GetExitCodeProcess.argtypes = [w.HANDLE, c.POINTER(w.DWORD)]
    k.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
    a.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
    a.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
    a.CreateRestrictedToken.argtypes = [w.HANDLE, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, c.c_void_p, w.DWORD, c.c_void_p, c.POINTER(w.HANDLE)]
    a.ConvertStringSidToSidW.argtypes = [w.LPCWSTR, c.POINTER(c.c_void_p)]
    a.SetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
    a.GetLengthSid.argtypes = [c.c_void_p]
    a.GetLengthSid.restype = w.DWORD

    class SidAndAttributes(c.Structure):
        _fields_ = [('sid', c.c_void_p), ('attributes', w.DWORD)]

    class Startup(c.Structure):
        _fields_ = [('cb', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR), ('title', w.LPWSTR),
                    ('x', w.DWORD), ('y', w.DWORD), ('xs', w.DWORD), ('ys', w.DWORD), ('xc', w.DWORD), ('yc', w.DWORD),
                    ('fill', w.DWORD), ('flags', w.DWORD), ('show', w.WORD), ('res2', w.WORD), ('resptr', c.c_void_p),
                    ('input', w.HANDLE), ('output', w.HANDLE), ('error', w.HANDLE)]

    class Process(c.Structure):
        _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE), ('pid', w.DWORD), ('tid', w.DWORD)]

    create_args = [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(Startup), c.POINTER(Process)]
    k.CreateProcessW.argtypes = create_args
    a.CreateProcessAsUserW.argtypes = [w.HANDLE, *create_args]
    k.ResumeThread.argtypes = [w.HANDLE]
    k.ResumeThread.restype = w.DWORD

    def check(ok):
        if not ok:
            raise c.WinError(c.get_last_error())

    def integrity(process):
        token = w.HANDLE()
        check(a.OpenProcessToken(process, 0x0008, c.byref(token)))
        try:
            size = w.DWORD()
            a.GetTokenInformation(token, 25, None, 0, c.byref(size))
            buf = c.create_string_buffer(size.value)
            check(a.GetTokenInformation(token, 25, buf, len(buf), c.byref(size)))
            sid = c.c_void_p.from_buffer(buf).value
            count = c.c_ubyte.from_address(sid + 1).value
            return c.c_uint32.from_address(sid + 8 + (count - 1) * 4).value
        finally:
            k.CloseHandle(token)

    # Make the environment case-insensitively unique and exclude host app state.
    env = {}
    seen = set()
    for key, value in os.environ.items():
        upper = key.upper()
        if upper in seen or upper.startswith(('DSH_', 'DSHD_', 'CHISACODE_', 'ELECTRON_')):
            continue
        seen.add(upper)
        env[key] = value
    env.update(WINDOWS_STARTUP_PROBE_OUTPUT=str(output), TEMP=str(output / 'temp'), TMP=str(output / 'temp'))
    env_block = c.create_unicode_buffer('\0'.join(f'{key}={value}' for key, value in sorted(env.items(), key=lambda item: item[0].upper())) + '\0\0')
    argv = [str(exe), str(fixture.resolve()), f'--user-data-dir={output / "profile"}', '--no-first-run', '--enable-logging=stderr']
    cmd = c.create_unicode_buffer(subprocess.list2cmdline(argv))
    startup = Startup()
    startup.cb = c.sizeof(startup)
    proc = Process()
    parent_token = w.HANDLE()
    low_token = w.HANDLE()
    low_sid = c.c_void_p()
    started = time.time()
    finished = False
    with exe.open('rb') as binary:
        sha256 = hashlib.file_digest(binary, 'sha256').hexdigest()
    try:
        # Suspended launch makes the measured child token belong to this process,
        # even when a pre-JS failure would otherwise exit before inspection.
        flags = 0x00000004 | 0x00000400
        if args.low_token:
            check(a.OpenProcessToken(k.GetCurrentProcess(), 0x008B, c.byref(parent_token)))
            check(a.CreateRestrictedToken(parent_token, 0, 0, None, 0, None, 0, None, c.byref(low_token)))
            check(a.ConvertStringSidToSidW('S-1-16-4096', c.byref(low_sid)))
            label = SidAndAttributes(low_sid, 0x20)
            check(a.SetTokenInformation(low_token, 25, c.byref(label), c.sizeof(label) + a.GetLengthSid(low_sid)))
            check(a.CreateProcessAsUserW(low_token, str(exe), cmd, None, None, False, flags, env_block, str(exe.parent), c.byref(startup), c.byref(proc)))
        else:
            check(k.CreateProcessW(str(exe), cmd, None, None, False, flags, env_block, str(exe.parent), c.byref(startup), c.byref(proc)))
        result = {
            'exe': str(exe), 'sha256': sha256,
            'pid': proc.pid, 'parentIntegrityRid': integrity(k.GetCurrentProcess()),
            'childIntegrityRid': integrity(proc.process), 'lowTokenRequested': args.low_token,
            'fileLabelsChanged': False,
        }
        check(k.ResumeThread(proc.thread) != 0xFFFFFFFF)
        wait = k.WaitForSingleObject(proc.process, 25000)
        if wait == 258:
            k.TerminateProcess(proc.process, 1)
            k.WaitForSingleObject(proc.process, 5000)
        code = w.DWORD()
        check(k.GetExitCodeProcess(proc.process, c.byref(code)))
        result.update(exitCode=f'0x{code.value:08x}', timedOut=wait == 258, elapsedMs=round((time.time() - started) * 1000),
                      reachedJs=(output / 'events.json').is_file(), capturedWindow=(output / 'window.png').is_file())
        (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result))
        finished = True
    finally:
        if proc.process and not finished:
            # Never leave a suspended or timed-out diagnosis child behind.
            k.TerminateProcess(proc.process, 1)
            k.WaitForSingleObject(proc.process, 5000)
        for handle in [proc.thread, proc.process, parent_token, low_token]:
            if handle:
                k.CloseHandle(handle)
        if low_sid:
            k.LocalFree.argtypes = [c.c_void_p]
            k.LocalFree(low_sid)


if __name__ == '__main__':
    main()
