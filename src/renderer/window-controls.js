// Aliased names: classic scripts share one global lexical scope, and
// launcher.js also destructures `h`/`mount` at top level on the same page.
const { h: wcH, mount: wcMount } = (typeof module !== 'undefined' && module.exports)
  ? require('../shared/dom')
  : window.whaleDom;

function iconMin() {
  return wcH('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' },
    wcH('rect', { x: '2', y: '5.4', width: '8', height: '1.2', rx: '0.6', fill: 'currentColor' }));
}

function iconMax() {
  return wcH('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' },
    wcH('rect', { x: '2.4', y: '2.4', width: '7.2', height: '7.2', rx: '1.4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2' }));
}

function iconRestore() {
  return wcH('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' },
    wcH('rect', { x: '3.4', y: '2.2', width: '6.2', height: '6.2', rx: '1.2', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.15' }),
    wcH('rect', { x: '2.2', y: '3.6', width: '6.2', height: '6.2', rx: '1.2', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.15' }));
}

function iconClose() {
  return wcH('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' },
    wcH('path', { d: 'M3 3l6 6M9 3L3 9', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.25', 'stroke-linecap': 'round' }));
}

function mountWindowControls(host) {
  if (!host) {
    return;
  }
  const hideMin = host.dataset.minimize === 'false';
  const hideMax = host.dataset.maximize === 'false';
  const nativeMac = (window.shell?.platform ?? document.documentElement.dataset.platform) === 'darwin';
  host.hidden = nativeMac;
  wcMount(host, ...(nativeMac ? [] : [
    ...(hideMin ? [] : [wcH('button', { type: 'button', 'data-act': 'minimize', 'aria-label': '最小化' }, iconMin())]),
    ...(hideMax ? [] : [wcH('button', { type: 'button', 'data-act': 'maximize', 'aria-label': '最大化' }, iconMax())]),
    wcH('button', { type: 'button', 'data-act': 'close', 'aria-label': '关闭' }, iconClose()),
  ]));

  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const button = event.target.closest('[data-act]');
    if (!button || !window.shell || typeof window.shell.windowAction !== 'function') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    host.dataset.pointerAct = '1';
    window.shell.windowAction(button.dataset.act);
    window.setTimeout(() => {
      delete host.dataset.pointerAct;
    }, 0);
  });
  host.addEventListener('click', (event) => {
    if (host.dataset.pointerAct === '1') {
      return;
    }
    const button = event.target.closest('[data-act]');
    if (!button || !window.shell || typeof window.shell.windowAction !== 'function') {
      return;
    }
    window.shell.windowAction(button.dataset.act);
  });

  const maxBtn = host.querySelector('[data-act="maximize"]');
  const applyState = (state) => {
    if (!state) {
      return;
    }
    document.documentElement.toggleAttribute('data-window-maximized', Boolean(state.maximized));
    document.documentElement.toggleAttribute('data-fullscreen', Boolean(state.fullscreen));
    if (!maxBtn) {
      return;
    }
    wcMount(maxBtn, state.maximized ? iconRestore() : iconMax());
    maxBtn.setAttribute('aria-label', state.maximized ? '还原' : '最大化');
  };

  if (window.shell && typeof window.shell.getWindowState === 'function') {
    Promise.resolve(window.shell.getWindowState()).then(applyState).catch(() => { /* The window-state push listener remains authoritative when the initial read races closure. */ });
  }
  if (window.shell && typeof window.shell.onWindowState === 'function') {
    window.shell.onWindowState(applyState);
  }
}

// Keep the silhouette ring one physical pixel at fractional Windows scaling.
function syncWindowHairline() {
  document.documentElement.style.setProperty('--dsh-window-hairline', `${1 / (window.devicePixelRatio || 1)}px`);
}
syncWindowHairline();
window.addEventListener('resize', syncWindowHairline);
document.querySelectorAll('.window-controls').forEach(mountWindowControls);
