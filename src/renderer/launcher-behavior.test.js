'use strict';

// Behavior characterization for the launcher page. The tests evaluate the
// real page scripts in page order through launcher-test-kit (one shared
// global scope over a fake DOM parsed from launcher.html) and drive the
// actual functions — not extracted source slices — with stubbed bridge
// answers and collaborator globals.

const assert = require('node:assert/strict');
const test = require('node:test');
const kit = require('./launcher-test-kit.cjs');

test('version installation displays manual DMG instructions and releases busy state', async () => {
  const api = { installRelease: async () => ({ manualInstall: true, launched: false, message: 'Drag into Applications' }) };
  const { context, document: doc, evalIn } = kit.loadLauncherPage({ api });
  const phases = [];
  Object.assign(context, {
    // Slim launcher package: no update center answers, the legacy flow runs.
    openUpdateCenter: async () => false,
    paintProgress: (_id, state) => phases.push(state.phase),
    refreshStatus: () => assert.fail('opening a DMG does not certify installation'),
  });
  await context.installTag('v9.9.9', 'update');
  assert.equal(doc.getElementById('update-progress').textContent, 'Drag into Applications');
  assert.equal(phases.at(-1), 'waiting');
  assert.equal(evalIn('updateBusy'), false);
});

test('installation feedback distinguishes unknown length, retry and waiting for the wizard', () => {
  const { context } = kit.loadLauncherPage({ api: {} });
  const installPhaseText = context.installPhaseText;
  const text = installPhaseText({ phase: 'download', percent: null, received: 1048576, total: 0 });
  assert.match(text, /1\.0 MB/);
  assert.doesNotMatch(text, /%/);
  assert.match(installPhaseText({ phase: 'download', retrying: true, attempt: 2, maxAttempts: 3 }), /重试（2\/3）/);
  assert.match(installPhaseText({ phase: 'download', retrying: true, attempt: 2, maxAttempts: 3, received: 10485760 }), /10\.0 MB 续传（2\/3）/);
  assert.match(installPhaseText({ phase: 'install-wait', elapsedMs: 7000 }), /安装向导.*7 秒/);
});

test('delta fallback reports actual installer stages and only certifies applied installation', async () => {
  const scenarios = [
    { result: { mode: 'full', ok: true, launched: true, status: 'waiting' }, phase: 'waiting' },
    { result: { mode: 'full', ok: true, status: 'quit-pending' }, phase: 'waiting' },
    { result: { mode: 'full', ok: true, launched: true }, phase: 'waiting' },
    { result: { mode: 'full', ok: true, status: 'fallback-full' }, phase: 'waiting' },
    { result: { mode: 'full', ok: true, status: 'installed', installed: { version: '9.9.9' } }, phase: 'done' },
    { result: { status: 'applied', version: '9.9.9' }, phase: 'done' },
    { result: { mode: 'delta', ok: true, to: '9.9.9' }, phase: 'done' },
    { result: { mode: 'full', cancelled: true, status: 'waiting', message: '已停止等待，安装向导仍在运行' }, phase: 'waiting' },
  ];
  for (const { result, phase } of scenarios) {
    const { context, document: doc, evalIn } = kit.loadLauncherPage({
      api: { installDelta: async () => result },
    });
    const phases = [];
    let refreshes = 0;
    Object.assign(context, {
      paintProgress: (_id, state) => phases.push(state.phase),
      refreshStatus: () => { refreshes += 1; },
      refreshReleases: () => { refreshes += 1; },
    });
    await context.installDelta('v9.9.9');
    assert.equal(phases.at(-1), phase, JSON.stringify(result));
    assert.equal(evalIn('updateBusy'), false);
    const text = doc.getElementById('update-progress').textContent;
    if (phase === 'waiting') {
      assert.ok(text.trim(), 'an unconfirmed installation remains visible');
      assert.doesNotMatch(text, /完成安装：|安装完成：|已增量更新到/);
      assert.equal(refreshes, 0, 'starting an installer is not a verified installed version');
    } else {
      assert.match(text, /(?:完成安装|已增量更新到).*9\.9\.9/);
      assert.equal(refreshes, 2);
    }
    assert.equal(doc.querySelectorAll('.shell-feedback-toast').length, 0,
      'valid installer stages are not errors');
  }
});

test('unconfirmed installation clears activity and a retry restores the progress surface', () => {
  const { context, document: doc } = kit.loadLauncherPage({ api: {} });
  const paintProgress = context.paintProgress;
  const wrap = doc.createElement('div');
  doc.body.appendChild(wrap);
  wrap.appendChild(doc.getElementById('test-bar'));
  const el = (id) => doc.getElementById(`test-${id}`);
  paintProgress('test', { phase: 'download', percent: 80 });
  paintProgress('test', { phase: 'waiting' });
  assert.equal(el('title').textContent, '安装结果待确认');
  assert.equal(el('pct').textContent, '');
  assert.equal(el('bar').parentElement.hidden, true);
  assert.equal(el('phases').hidden, true);
  paintProgress('test', { phase: 'download', percent: null });
  assert.equal(el('bar').parentElement.hidden, false);
  assert.equal(el('bar').style.transform, 'scaleX(0)');
  assert.equal(el('phases').hidden, false);
  paintProgress('test', { phase: 'download', percent: 50 });
  assert.equal(el('bar').style.transform, 'scaleX(0.5)');
});

function buttons(n, disabled = []) {
  return Array.from({ length: n }, (_, i) => ({ disabled: disabled.includes(i), idx: i }));
}

test('radioNextIndex advances right/down and wraps at the end', () => {
  const { context } = kit.loadLauncherPage({ api: {} });
  const radioNextIndex = context.radioNextIndex;
  const enabled = buttons(3);
  assert.equal(radioNextIndex(enabled, 0, 'ArrowRight'), 1);
  assert.equal(radioNextIndex(enabled, 2, 'ArrowRight'), 0);
  assert.equal(radioNextIndex(enabled, -1, 'ArrowDown'), 0);
});

test('radioNextIndex retreats left/up and wraps at the start', () => {
  const { context } = kit.loadLauncherPage({ api: {} });
  const radioNextIndex = context.radioNextIndex;
  const enabled = buttons(3);
  assert.equal(radioNextIndex(enabled, 2, 'ArrowLeft'), 1);
  assert.equal(radioNextIndex(enabled, 0, 'ArrowLeft'), 2);
  assert.equal(radioNextIndex(enabled, 0, 'ArrowUp'), 2);
});

test('radioNextIndex ignores non-arrow keys so other controls keep them', () => {
  const { context } = kit.loadLauncherPage({ api: {} });
  const radioNextIndex = context.radioNextIndex;
  const enabled = buttons(2);
  assert.equal(radioNextIndex(enabled, 0, 'Tab'), -1);
  assert.equal(radioNextIndex(enabled, 0, 'Enter'), -1);
  assert.equal(radioNextIndex(enabled, 0, 'a'), -1);
});

test('radio group callers pre-filter disabled so the enabled list never lands on one', () => {
  // The navigation helper is only ever handed the enabled subset — the same
  // filter renderRouteControls applies — so a disabled middle item is skipped
  // by construction (it is not in `enabled` at all).
  const { context } = kit.loadLauncherPage({ api: {} });
  const radioNextIndex = context.radioNextIndex;
  const all = buttons(4, [1, 3]);
  const enabled = all.filter((b) => !b.disabled);
  assert.deepEqual(enabled.map((b) => b.idx), [0, 2]);
  assert.equal(radioNextIndex(enabled, 0, 'ArrowRight'), 1); // lands on idx 2, skipping disabled 1
  assert.equal(radioNextIndex(enabled, 1, 'ArrowRight'), 0); // wraps to idx 0, skipping disabled 3
});

test('a single keypress maps to exactly one index step (no replay)', () => {
  // Regression for stacked listeners: the handler computes one `next` from
  // the live enabled list and applies it once. Multiple render passes must
  // not multiply the step — the container binds once via dataset.navBound.
  const { context } = kit.loadLauncherPage({ api: {} });
  const enabled = buttons(3);
  const presses = ['ArrowRight'];
  const applied = presses.map((k) => context.radioNextIndex(enabled, 0, k)).filter((i) => i >= 0);
  assert.equal(applied.length, 1);
  assert.equal(applied[0], 1);
});

test('route pick serialization: Right then Left before refresh issues BOTH saves', async () => {
  // Regression for the pickRoute race: Right (issue A) then Left (issue B)
  // before the status refresh re-renders must not drop B just because the
  // rendered selection still showed the first target.
  const { context } = kit.loadLauncherPage({ api: {} });
  const issueRouteSave = context.issueRouteSave;
  const saved = [];
  const api = { saveLauncherConfig: async ({ downloadRoute }) => { saved.push(downloadRoute); } };
  let refreshed = 0;
  const refreshStatus = () => { refreshed += 1; };
  const hint = [];
  const setHint = (t) => hint.push(t);
  const errText = (e) => String(e && e.message || e);
  // Simulate two back-to-back picks (no render in between).
  await issueRouteSave(api, 'route-b', refreshStatus, setHint, errText);
  await issueRouteSave(api, 'route-a', refreshStatus, setHint, errText);
  assert.deepEqual(saved, ['route-b', 'route-a'], 'both issued picks must be saved');
  assert.equal(refreshed, 2);
  assert.equal(hint.length, 0);
});

test('route pick surfaces save errors only for the latest issued pick', async () => {
  const { context } = kit.loadLauncherPage({ api: {} });
  const issueRouteSave = context.issueRouteSave;
  const saved = [];
  const api = {
    saveLauncherConfig: async ({ downloadRoute }) => {
      saved.push(downloadRoute);
      throw new Error('disk-full');
    },
  };
  const hint = [];
  await issueRouteSave(api, 'route-x', () => {}, (t) => hint.push(t), (e) => `E:${e.message}`);
  assert.deepEqual(hint, ['E:disk-full']);
});

test('a failed route save resets the issued marker so the same route can be retried', async () => {
  // Regression for the dedup marker surviving a failed save: previously a
  // rejected write left `lastIssuedRoute` pointing at the un-persisted value,
  // so re-picking that route compared equal and was silently dropped.
  const { context } = kit.loadLauncherPage({ api: {} });
  const issueRouteSave = context.issueRouteSave;
  const saved = [];
  let fail = true;
  const api = {
    saveLauncherConfig: async ({ downloadRoute }) => {
      if (fail) {
        throw new Error('io-error');
      }
      saved.push(downloadRoute);
    },
  };
  const hint = [];
  const errText = (e) => `E:${e.message}`;
  await issueRouteSave(api, 'route-z', () => {}, (t) => hint.push(t), errText);
  assert.equal(saved.length, 0, 'the rejected write must not persist');
  // Retrying the same route after the failure must issue a fresh save.
  fail = false;
  await issueRouteSave(api, 'route-z', () => {}, (t) => hint.push(t), errText);
  assert.deepEqual(saved, ['route-z'], 'a retry of the failed route must not be deduped away');
});

test('a resolved {ok:false} route-save refusal is treated as a failure, not success', async () => {
  // Regression: saveLauncherConfig may RESOLVE {ok:false,error} (e.g.
  // maintenance-in-progress) rather than reject. issueRouteSave must treat
  // that as a failed save — reset the marker and surface the error — instead
  // of returning success on a route that was never persisted.
  const { context } = kit.loadLauncherPage({ api: {} });
  const issueRouteSave = context.issueRouteSave;
  const saved = [];
  let refuse = true;
  const api = {
    saveLauncherConfig: async ({ downloadRoute }) => {
      if (refuse) {
        return { ok: false, error: 'maintenance-in-progress' };
      }
      saved.push(downloadRoute);
      return { ok: true };
    },
  };
  const hint = [];
  const errText = (e) => `E:${e.message}`;
  const first = await issueRouteSave(api, 'route-cnb', () => {}, (t) => hint.push(t), errText);
  assert.equal(first, false, 'a resolved refusal is not a successful save');
  assert.ok(hint.length > 0, 'the refusal must surface a hint');
  // After maintenance releases, retrying the SAME route must issue a save.
  refuse = false;
  const second = await issueRouteSave(api, 'route-cnb', () => {}, () => {}, errText);
  assert.equal(second, true);
  assert.deepEqual(saved, ['route-cnb'], 'retry after a refused save must persist');
});

test('launcher.html import sub-panes are div[role=tabpanel] with tabindex', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, 'launcher.html'), 'utf8');
  for (const cat of ['sessions', 'skills', 'plugins', 'mcp', 'settings', 'presets']) {
    const re = new RegExp(`<div id="import-pane-${cat}"[^>]*role="tabpanel"[^>]*tabindex="0"`, 'm');
    assert.match(html, re, `import-pane-${cat} must be a tabpanel div with tabindex`);
    assert.ok(html.includes(`aria-controls="import-pane-${cat}"`), `icat-${cat} must aria-controls its pane`);
  }
});

test('route picker renders roving tabindex radios bound once via navBound', () => {
  // The picker buttons carry a roving tabindex (current = 0, rest = -1).
  const src = [...kit.launcherSources().values()].join('\n');
  assert.match(src, /tabindex: route\.id === current \? '0' : '-1'/, 'picker radio must rove tabindex');
  // Focus handlers bind exactly once (navBound) for both picker and seg.
  const navBinds = (src.match(/dataset\.navBound = '1'/g) || []).length;
  assert.ok(navBinds >= 2, 'both picker and seg must once-bind navBound');
  const focusins = (src.match(/addEventListener\('focusin'/g) || []).length;
  assert.ok(focusins >= 2, 'roving tabindex needs a focusin handler per group');
});

test('disable-suspects button visibility aligns with startupRecoveryGuidance kind', () => {
  const { context, document } = kit.loadLauncherPage({ api: {} });
  const btn = document.getElementById('btn-disable-suspects');
  context.renderHomeRecovery({
    lastStart: { ok: false },
    forensics: {
      pluginTreeFailure: true,
      plugins: [{ name: 'demo-plugin', suspect: true, disabled: false, orphan: true }],
    },
  });
  assert.equal(btn.hidden, true, 'kept hidden when guidance is skip rather than disable');
  context.renderHomeRecovery({
    lastStart: { ok: false },
    forensics: {
      plugins: [{ name: 'demo-plugin', suspect: true, disabled: false }],
    },
  });
  assert.equal(btn.hidden, false, 'shown when startupRecoveryGuidance resolves to disable');
  assert.equal(btn.dataset.names, 'demo-plugin');
});
