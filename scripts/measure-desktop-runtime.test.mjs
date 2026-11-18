import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assess, summary, measurementEnv } from './measure-desktop-runtime.mjs';

const require = createRequire(import.meta.url);
const {
  parseSmapsRollup,
  readLinuxProcMemory,
  captureProcessSnapshotEntry,
  summarizeProcessSnapshot,
  capturePeakProcessSnapshot,
} = require('./lib/desktop-runtime-perf.cjs');

const report = { ok: true, platform: 'linux', arch: 'x64', startupMs: 30000, restartMs: 1000,
  mainThreadLagMs: 201, peakWorkingSetMiB: 512 };

test('runtime budgets preserve the boundary and flag the observed excess', () => {
  const rows = assess(report);
  assert.equal(rows.find(row => row.metric === 'startupMs').exceeded, false);
  assert.equal(rows.find(row => row.metric === 'mainThreadLagMs').exceeded, true);
  assert.equal(rows.find(row => row.metric === 'peakWorkingSetMiB').limit, 1024);
  assert.match(summary(report, rows), /OVER BUDGET/);
});

test('missing, negative and nonfinite measurements cannot look healthy', () => {
  for (const value of [undefined, -1, NaN, Infinity]) assert.throws(() => assess({ ...report, restartMs: value }));
  assert.throws(() => assess({ ...report, ok: false, error: 'restart refused' }), /restart refused/);
});

test('trend deltas compare only successful same-platform reports', () => {
  const previous = { ...report, startupMs: 29000 };
  assert.equal(assess(report, undefined, previous)[0].delta, 1000);
  for (const prior of [{ ...previous, platform: 'darwin' }, { ...previous, arch: 'arm64' }, { ...previous, ok: false }]) {
    assert.equal(assess(report, undefined, prior)[0].delta, null);
  }
});

test('ambient smoke and Node-mode flags cannot run another driver or disable Electron', () => {
  const base = { ELECTRON_RUN_AS_NODE: '1', DSH_SMOKE: '1', DSH_QA_SHELL: '1', DSH_REMOTE_PHONE_HOST: '1', DISPLAY: ':99' };
  assert.deepEqual(measurementEnv(base), { DISPLAY: ':99' });
  assert.equal(base.DSH_SMOKE, '1');
});

test('parseSmapsRollup extracts private, PSS and shared MiB while ignoring Pss_* subfields', () => {
  const smaps = [
    '55a1c2d00000-7fff89abc000 ---p 00000000 00:00 0                          [rollup]',
    'Rss:              204800 kB',
    'Pss:              122880 kB',
    'Pss_Dirty:         81920 kB',
    'Pss_Anon:          81920 kB',
    'Shared_Clean:      98304 kB',
    'Shared_Dirty:       4096 kB',
    'Private_Clean:     20480 kB',
    'Private_Dirty:     81920 kB',
    'SwapPss:               0 kB',
  ].join('\n');
  assert.deepEqual(parseSmapsRollup(smaps), {
    privateMiB: 100,
    pssMiB: 120,
    sharedMiB: 100,
  });
  assert.equal(parseSmapsRollup(''), null);
  assert.equal(parseSmapsRollup('THPeligible: 0\n'), null);
});

test('readLinuxProcMemory only reads procfs on linux and degrades cleanly on failure', () => {
  assert.equal(readLinuxProcMemory(1234, {
    platform: 'win32',
    readFileSync: () => { throw new Error('should not read procfs on win32'); },
  }), null);
  assert.equal(readLinuxProcMemory(1234, {
    platform: 'linux',
    readFileSync: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
  }), null);
  assert.deepEqual(readLinuxProcMemory(1234, {
    platform: 'linux',
    readFileSync: (filePath) => {
      assert.equal(filePath, '/proc/1234/smaps_rollup');
      return 'Pss: 32768 kB\nPrivate_Clean: 4096 kB\nPrivate_Dirty: 12288 kB\n';
    },
  }), { privateMiB: 16, pssMiB: 32 });
});

test('capturePeakProcessSnapshot records Windows privateBytes and Linux smaps_rollup cleanly', () => {
  const winSnap = capturePeakProcessSnapshot([
    { pid: 10, type: 'Browser', memory: { workingSetSize: 204800, privateBytes: 102400 } },
    { pid: 20, type: 'Tab', memory: { workingSetSize: 307200, privateBytes: 153600 } },
  ], 'startup', 1234.5, { platform: 'win32' });
  assert.deepEqual(winSnap, {
    phase: 'startup',
    elapsedMs: 1234.5,
    processes: [
      { pid: 10, type: 'Browser', workingSetMiB: 200, privateMiB: 100 },
      { pid: 20, type: 'Tab', workingSetMiB: 300, privateMiB: 150 },
    ],
    totals: {
      workingSetMiB: 500,
      processCount: 2,
      privateMiB: 250,
      privateProcessCount: 2,
    },
  });

  const linuxSnap = capturePeakProcessSnapshot([
    { pid: 100, type: 'Browser', memory: { workingSetSize: 204800 } },
    { pid: 200, type: 'Tab', memory: { workingSetSize: 102400 } },
  ], 'restart', 2500, {
    platform: 'linux',
    readFileSync: (filePath) => {
      if (filePath === '/proc/100/smaps_rollup') {
        return 'Pss: 122880 kB\nPrivate_Clean: 10240 kB\nPrivate_Dirty: 71680 kB\nShared_Clean: 122880 kB\nShared_Dirty: 0 kB\n';
      }
      throw new Error('ENOENT');
    },
  });
  assert.deepEqual(linuxSnap.processes, [
    { pid: 100, type: 'Browser', workingSetMiB: 200, privateMiB: 80, pssMiB: 120, sharedMiB: 120 },
    { pid: 200, type: 'Tab', workingSetMiB: 100 },
  ]);
  assert.deepEqual(linuxSnap.totals, {
    workingSetMiB: 300,
    processCount: 2,
    privateMiB: 80,
    privateProcessCount: 1,
    pssMiB: 120,
    pssProcessCount: 1,
    sharedMiB: 120,
    sharedProcessCount: 1,
  });

  const degraded = captureProcessSnapshotEntry(
    { pid: 30, type: 'GPU', memory: { workingSetSize: 51200, privateBytes: -5 } },
    { platform: 'darwin' },
  );
  assert.deepEqual(degraded, { pid: 30, type: 'GPU', workingSetMiB: 50 });
  assert.deepEqual(summarizeProcessSnapshot([degraded]), { workingSetMiB: 50, processCount: 1 });
});

test('summary renders optional private/PSS/shared columns and degrades cleanly when absent', () => {
  const baseRows = assess(report);

  const linuxReport = {
    ...report,
    peakWorkingSetMiB: 500,
    peakProcessSnapshot: {
      phase: 'startup',
      elapsedMs: 4200,
      processes: [
        { pid: 1, type: 'Browser', workingSetMiB: 200, privateMiB: 80, pssMiB: 120, sharedMiB: 120 },
        { pid: 2, type: 'Tab', workingSetMiB: 300, privateMiB: 170, pssMiB: 220, sharedMiB: 130 },
      ],
    },
  };
  const linuxMd = summary(linuxReport, assess(linuxReport));
  assert.match(linuxMd, /\| PID \| Electron process type \| Working set MiB at total peak \| Private MiB \| PSS MiB \| Shared MiB \|/);
  assert.match(linuxMd, /\| 1 \| Browser \| 200\.00 \| 80\.00 \| 120\.00 \| 120\.00 \|/);
  assert.match(linuxMd, /Peak memory breakdown \(2 processes\): summed working set 500\.00 MiB \(counts shared pages per process\); summed PSS 340\.00 MiB \(proportional shared-page attribution\); summed private 250\.00 MiB \(process-exclusive resident memory\); summed shared 250\.00 MiB\./);

  const winReport = {
    ...report,
    platform: 'win32',
    peakWorkingSetMiB: 500,
    peakProcessSnapshot: {
      phase: 'startup',
      elapsedMs: 4200,
      processes: [
        { pid: 1, type: 'Browser', workingSetMiB: 200, privateMiB: 90 },
        { pid: 2, type: 'Tab', workingSetMiB: 300, privateMiB: 140 },
      ],
    },
  };
  const winMd = summary(winReport, assess(winReport));
  assert.match(winMd, /\| PID \| Electron process type \| Working set MiB at total peak \| Private MiB \|/);
  assert.doesNotMatch(winMd, /\| PSS MiB \|/);
  assert.match(winMd, /summed private 230\.00 MiB \(process privateBytes\); working-set minus private 270\.00 MiB; PSS unavailable\./);

  const winGpuCommitReport = {
    ...report,
    platform: 'win32',
    peakWorkingSetMiB: 410,
    peakProcessSnapshot: {
      phase: 'restart',
      elapsedMs: 4800,
      processes: [
        { pid: 1, type: 'GPU', workingSetMiB: 210, privateMiB: 570 },
        { pid: 2, type: 'Tab', workingSetMiB: 200, privateMiB: 100 },
      ],
    },
  };
  const winGpuMd = summary(winGpuCommitReport, assess(winGpuCommitReport));
  assert.match(winGpuMd, /summed private 670\.00 MiB \(process privateBytes commit; exceeds resident working set in 1 process\); PSS unavailable\./);
  assert.doesNotMatch(winGpuMd, /working-set minus private/);

  const partialReport = {
    ...report,
    peakProcessSnapshot: {
      phase: 'startup',
      elapsedMs: 4200,
      processes: [
        { pid: 1, type: 'Browser', workingSetMiB: 200, privateMiB: 80, pssMiB: 120 },
        { pid: 2, type: 'Tab', workingSetMiB: 300 },
      ],
    },
  };
  const partialMd = summary(partialReport, baseRows);
  assert.match(partialMd, /\| 2 \| Tab \| 300\.00 \| unavailable \| unavailable \|/);
  assert.match(partialMd, /summed PSS 120\.00 MiB \(1\/2 processes\)/);
  assert.match(partialMd, /summed private 80\.00 MiB \(1\/2 processes\)/);

  const legacyReport = {
    ...report,
    measuredAt: '2026-11-18T00:00:00.000Z',
    peakProcessSnapshot: {
      phase: 'startup',
      elapsedMs: 4200,
      processes: [{ pid: 1, type: 'Browser', workingSetMiB: 200 }],
    },
  };
  const legacyMd = summary(legacyReport, baseRows);
  assert.match(legacyMd, /\| PID \| Electron process type \| Working set MiB at total peak \|/);
  assert.match(legacyMd, /per-process private\/PSS metrics unavailable\./);
  assert.doesNotMatch(legacyMd, /\bNaN\b|\bundefined\b/);
});
