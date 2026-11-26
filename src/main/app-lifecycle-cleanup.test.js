'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('cleanupDesktopResources awaits async pty.killAll() before returning', async () => {
  let resolveKill;
  let killResolved = false;
  const ptyKillPromise = new Promise((resolve) => {
    resolveKill = () => {
      killResolved = true;
      resolve();
    };
  });
  let previewClosed = false;
  let logsFlushed = false;

  const module = { exports: {} };
  const stubs = {
    electron: { app: { exit() {}, on() {} }, dialog: {} },
    './config': { loadConfig: () => ({}), saveConfig: () => {} },
    './close-behavior': { hideOnClose: () => false },
    './window': {
      getMainWindow: () => null,
      sendToLauncher: () => {},
      closeLauncherWindow: () => {},
      getHarnessWebContents: () => null,
    },
    './launcher-gate': {
      shouldCloseLauncherAfterDesktopStart: () => false,
      writeLastDesktopStart: () => {},
      recordLastDesktopStart: () => {},
      kernelLogTail: () => [],
    },
    './data-import': { readImportJournal: () => null, journalIsBlocked: () => false },
    './import-guard': {},
    './desktop-reload': { createReloadWithCleanup: () => async () => {} },
    './task-protection': { createTaskProtection: () => ({}), installTaskProtection: () => {} },
    './task-control-peer': { createTaskControlPeer: () => ({}) },
    './closing-overlay': { showClosingOverlay: () => {} },
    './desktop-live2d': { getLive2dPet: () => null },
    './desktop-install-control': { stopDesktopInstallControl: async () => {} },
    '../shared/launcher-bridges': {
      flushBootLogs: async () => {
        logsFlushed = true;
      },
    },
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app-lifecycle.js'), 'utf8'), {
    require: (id) => stubs[id] || {},
    module,
    exports: module.exports,
    __dirname,
    __filename: path.join(__dirname, 'app-lifecycle.js'),
    process,
    console,
    setTimeout,
    clearTimeout,
    Promise,
  });

  const { cleanupDesktopResources } = module.exports.createAppLifecycle({
    state: {
      desktopResources: {
        pty: { killAll: () => ptyKillPromise },
        preview: { closeAll: async () => { previewClosed = true; } },
      },
    },
    dsh: { state: 'idle', snapshot: () => ({ state: 'idle' }), log: () => {} },
    harness: {},
    quitApp: () => {},
    openLauncher: async () => {},
    confirmTaskStop: async () => true,
  });

  let finished = false;
  const pending = cleanupDesktopResources().then(() => { finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(killResolved, false);
  assert.equal(finished, false, 'cleanupDesktopResources must wait for pty.killAll()');
  assert.equal(previewClosed, false, 'preview cleanup runs after awaited pty.killAll()');

  resolveKill();
  await pending;
  assert.equal(killResolved, true);
  assert.equal(previewClosed, true);
  assert.equal(logsFlushed, true);
});

test('cleanupDesktopResources stops workspace watcher only when stoppingForQuit or stopWatchers is set', async () => {
  const module = { exports: {} };
  const stubs = {
    electron: { app: { exit() {}, on() {} }, dialog: {} },
    './config': { loadConfig: () => ({}), saveConfig: () => {} },
    './close-behavior': { hideOnClose: () => false },
    './window': {
      getMainWindow: () => null,
      sendToLauncher: () => {},
      closeLauncherWindow: () => {},
      getHarnessWebContents: () => null,
    },
    './launcher-gate': {
      shouldCloseLauncherAfterDesktopStart: () => false,
      writeLastDesktopStart: () => {},
      recordLastDesktopStart: () => {},
      kernelLogTail: () => [],
    },
    './data-import': { readImportJournal: () => null, journalIsBlocked: () => false },
    './import-guard': {},
    './desktop-reload': { createReloadWithCleanup: () => async () => {} },
    './task-protection': { createTaskProtection: () => ({}), installTaskProtection: () => {} },
    './task-control-peer': { createTaskControlPeer: () => ({}) },
    './closing-overlay': { showClosingOverlay: () => {} },
    './desktop-live2d': { getLive2dPet: () => null },
    './desktop-install-control': { stopDesktopInstallControl: async () => {} },
    '../shared/launcher-bridges': { flushBootLogs: async () => {} },
    './dsh': { harnessRoot: () => '' },
    './git-workspace-watch': { startGitWorkspaceWatch: () => () => {} },
    './workspace-authority': { invalidateWorkspaceAuthorities: () => {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app-lifecycle.js'), 'utf8'), {
    require: (id) => stubs[id] || {},
    module,
    exports: module.exports,
    __dirname,
    __filename: path.join(__dirname, 'app-lifecycle.js'),
    process,
    console,
    setTimeout,
    clearTimeout,
    Promise,
  });

  let watchStops = 0;
  const state = {
    stoppingForQuit: false,
    desktopResources: {
      pty: { killAll: async () => {} },
      preview: { closeAll: async () => {} },
      stopWorkspaceWatch: () => { watchStops++; },
    },
  };
  const { cleanupDesktopResources } = module.exports.createAppLifecycle({
    state,
    dsh: { state: 'idle', snapshot: () => ({ state: 'idle' }), log: () => {} },
    harness: {},
    quitApp: () => {},
    openLauncher: async () => {},
    confirmTaskStop: async () => true,
  });

  await cleanupDesktopResources();
  assert.equal(watchStops, 0, 'restart cleanup must preserve git workspace watcher');

  await cleanupDesktopResources({ stopWatchers: true });
  assert.equal(watchStops, 1, 'explicit stopWatchers must release workspace watcher');

  state.stoppingForQuit = true;
  state.desktopResources.stopWorkspaceWatch = () => { watchStops++; };
  await cleanupDesktopResources();
  assert.equal(watchStops, 2, 'quit cleanup must release workspace watcher');
});
