function iconMin() {
  return '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.4" width="8" height="1.2" rx="0.6" fill="currentColor"/></svg>';
}

function iconMax() {
  return '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
}

function iconRestore() {
  return '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3.4" y="2.2" width="6.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.15"/><rect x="2.2" y="3.6" width="6.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.15"/></svg>';
}

function iconClose() {
  return '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
}

function mountWindowControls(host) {
  if (!host) {
    return;
  }
  const hideMin = host.dataset.minimize === 'false';
  const hideMax = host.dataset.maximize === 'false';
  const nativeMac = (window.shell?.platform ?? document.documentElement.dataset.platform) === 'darwin';
  host.hidden = nativeMac;
  host.innerHTML = nativeMac ? '' : [
    hideMin ? '' : `<button type="button" data-act="minimize" aria-label="最小化">${iconMin()}</button>`,
    hideMax ? '' : `<button type="button" data-act="maximize" aria-label="最大化">${iconMax()}</button>`,
    `<button type="button" data-act="close" aria-label="关闭">${iconClose()}</button>`,
  ].join('');

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
    maxBtn.innerHTML = state.maximized ? iconRestore() : iconMax();
    maxBtn.setAttribute('aria-label', state.maximized ? '还原' : '最大化');
  };

  if (window.shell && typeof window.shell.getWindowState === 'function') {
    Promise.resolve(window.shell.getWindowState()).then(applyState).catch(() => {});
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
