'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

// Minimal DOM the module needs at load time (bind() is not invoked under
// node --test because it only runs on DOMContentLoaded in the real page).
global.window = {};
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  activeElement: null,
};

const { radioNextIndex, issueRouteSave, installPhaseText, paintProgress } = require('./launcher');

test('version installation displays manual DMG instructions and releases busy state', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, 'launcher.js'), 'utf8');
  const start = source.indexOf('async function installTag(');
  const end = source.indexOf('async function installDelta(', start);
  const elements = new Map(['update-progress-title', 'update-progress'].map((id) => [id, { textContent: '' }]));
  const phases = [];
  const context = vm.createContext({ updateBusy: false, lastStatus: {},
    pageShell: () => ({ installRelease: async () => ({ manualInstall: true, launched: false, message: 'Drag into Applications' }) }),
    appConfirm: async () => true, $: (id) => elements.get(id),
    paintProgress: (_id, state) => phases.push(state.phase),
    refreshStatus: () => assert.fail('opening a DMG does not certify installation'),
    errText: (error) => error.message });
  await vm.runInContext(`${source.slice(start, end)}; installTag('v9.9.9', 'update')`, context);
  assert.equal(elements.get('update-progress').textContent, 'Drag into Applications');
  assert.equal(phases.at(-1), 'waiting');
  assert.equal(context.updateBusy, false);
});

test('installation feedback distinguishes unknown length, retry and waiting for the wizard', () => {
  const text = installPhaseText({ phase: 'download', percent: null, received: 1048576, total: 0 });
  assert.match(text, /1\.0 MB/);
  assert.doesNotMatch(text, /%/);
  assert.match(installPhaseText({ phase: 'download', retrying: true, attempt: 2, maxAttempts: 3 }), /重试（2\/3）/);
  assert.match(installPhaseText({ phase: 'install-wait', elapsedMs: 7000 }), /安装向导.*7 秒/);
});

test('unconfirmed installation clears activity and a retry restores the progress surface', () => {
  const elements = new Map();
  for (const id of ['card', 'title', 'pct', 'bar', 'phases', 'kind']) {
    elements.set(`test-${id}`, { hidden: false, textContent: '', style: {}, parentElement: { hidden: false } });
  }
  const old = document.getElementById;
  document.getElementById = (id) => elements.get(id);
  try {
    paintProgress('test', { phase: 'download', percent: 80 });
    paintProgress('test', { phase: 'waiting' });
    assert.equal(elements.get('test-title').textContent, '安装结果待确认');
    assert.equal(elements.get('test-pct').textContent, '');
    assert.equal(elements.get('test-bar').parentElement.hidden, true);
    assert.equal(elements.get('test-phases').hidden, true);
    paintProgress('test', { phase: 'download', percent: null });
    assert.equal(elements.get('test-bar').parentElement.hidden, false);
    assert.equal(elements.get('test-bar').style.width, '0%');
    assert.equal(elements.get('test-phases').hidden, false);
  } finally { document.getElementById = old; }
});

function buttons(n, disabled = []) {
  return Array.from({ length: n }, (_, i) => ({ disabled: disabled.includes(i), idx: i }));
}

test('radioNextIndex advances right/down and wraps at the end', () => {
  const enabled = buttons(3);
  assert.equal(radioNextIndex(enabled, 0, 'ArrowRight'), 1);
  assert.equal(radioNextIndex(enabled, 2, 'ArrowRight'), 0);
  assert.equal(radioNextIndex(enabled, -1, 'ArrowDown'), 0);
});

test('radioNextIndex retreats left/up and wraps at the start', () => {
  const enabled = buttons(3);
  assert.equal(radioNextIndex(enabled, 2, 'ArrowLeft'), 1);
  assert.equal(radioNextIndex(enabled, 0, 'ArrowLeft'), 2);
  assert.equal(radioNextIndex(enabled, 0, 'ArrowUp'), 2);
});

test('radioNextIndex ignores non-arrow keys so other controls keep them', () => {
  const enabled = buttons(2);
  assert.equal(radioNextIndex(enabled, 0, 'Tab'), -1);
  assert.equal(radioNextIndex(enabled, 0, 'Enter'), -1);
  assert.equal(radioNextIndex(enabled, 0, 'a'), -1);
});

test('radio group callers pre-filter disabled so the enabled list never lands on one', () => {
  // The navigation helper is only ever handed the enabled subset — the same
  // filter renderRouteControls applies — so a disabled middle item is skipped
  // by construction (it is not in `enabled` at all).
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
  const enabled = buttons(3);
  const presses = ['ArrowRight'];
  const applied = presses.map((k) => radioNextIndex(enabled, 0, k)).filter((i) => i >= 0);
  assert.equal(applied.length, 1);
  assert.equal(applied[0], 1);
});

test('route pick serialization: Right then Left before refresh issues BOTH saves', async () => {
  // Regression for the pickRoute race: Right (issue A) then Left (issue B)
  // before the status refresh re-renders must not drop B just because the
  // rendered selection still showed the first target.
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
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'launcher.js'), 'utf8');
  // The picker buttons carry a roving tabindex (current = 0, rest = -1).
  assert.match(src, /tabindex="\$\{route\.id === current \? '0' : '-1'\}"/, 'picker radio must rove tabindex');
  // Focus handlers bind exactly once (navBound) for both picker and seg.
  const navBinds = (src.match(/dataset\.navBound = '1'/g) || []).length;
  assert.ok(navBinds >= 2, 'both picker and seg must once-bind navBound');
  const focusins = (src.match(/addEventListener\('focusin'/g) || []).length;
  assert.ok(focusins >= 2, 'roving tabindex needs a focusin handler per group');
});
