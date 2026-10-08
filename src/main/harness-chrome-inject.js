(() => {
  const STYLE_ID = 'dshd-shell-integrated-chrome';
  const CONTROLS_ID = 'dshd-shell-controls';
  const CONTROL_SIZE = 32;
  const CONTROL_GAP = 0;
  const FRAME_CANVAS_ID = 'dshd-frame-canvas';
  const FRAME_RING_ID = 'dshd-frame-ring';
  const EDGE = 8;
  const CLUSTER = 8;
  /** Full titlebar height so the no-drag plate covers drag padding around the 32px buttons. */
  const CAPTION_HEIGHT = 48;
  /** Transparent-window silhouette radius; every injected layer that draws the
      rounded edge shares this value outside the native Windows frame. */
  const FRAME_RADIUS = 20;

  const ICON_MIN = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.4" width="8" height="1.2" rx="0.6" fill="currentColor"/></svg>';
  const ICON_MAX = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  const ICON_RESTORE = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3.4" y="2.2" width="6.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.15"/><rect x="2.2" y="3.6" width="6.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.15"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';

  function toHex(input) {
    if (!input || input === 'transparent') {
      return '';
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillStyle = input;
    const painted = String(ctx.fillStyle || '');
    if (painted.startsWith('#')) {
      if (painted.length === 4) {
        return `#${painted[1]}${painted[1]}${painted[2]}${painted[2]}${painted[3]}${painted[3]}`;
      }
      return painted.slice(0, 7);
    }
    const match = painted.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*([\d.]+)/i);
    if (!match) {
      return '';
    }
    const hex = (value) => Math.max(0, Math.min(255, Math.round(Number(value)))).toString(16).padStart(2, '0');
    return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`;
  }

  function opaqueBg(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      const hex = toHex(bg);
      if (hex && bg && bg !== 'transparent' && !String(bg).endsWith(', 0)') && bg !== 'rgba(0, 0, 0, 0)') {
        return hex;
      }
      node = node.parentElement;
    }
    return toHex(getComputedStyle(document.body).backgroundColor)
      || toHex(getComputedStyle(document.documentElement).backgroundColor)
      || '#ffffff';
  }

  function windowControlsRight() {
    return EDGE + CONTROL_SIZE * 3 + CONTROL_GAP * 2 + CLUSTER;
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    const css = `
      :root {
        --dshd-wco-controls: ${windowControlsRight()}px;
        --dshd-wco-caption: ${CAPTION_HEIGHT}px;
      }
      #${CONTROLS_ID} {
        position: fixed;
        top: 0;
        right: 0;
        z-index: 2147483647;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: ${CONTROL_GAP}px;
        width: ${windowControlsRight()}px;
        height: ${CAPTION_HEIGHT}px;
        padding: ${EDGE}px;
        background: transparent;
        pointer-events: auto;
        user-select: none;
        -webkit-app-region: no-drag;
      }
      #${CONTROLS_ID} button {
        width: ${CONTROL_SIZE}px;
        height: ${CONTROL_SIZE}px;
        margin: 0;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        cursor: pointer;
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
      #${CONTROLS_ID} button svg {
        width: 12px;
        height: 12px;
        display: block;
        pointer-events: none;
      }
      #${CONTROLS_ID} button:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      #${CONTROLS_ID} button[data-act="close"]:hover {
        background: #e81123;
        color: #fff;
      }
      /* The conversation-header corner expander (new seat in the rc.1 merge)
         duplicates the titlebar's own right-panel toggle. */
      [data-sidebar-right-expand] {
        display: none;
      }
      /* Transparent-window silhouette: the page itself draws the rounded
         outer frame. html/body stay transparent so nothing paints the
         native corners; #dshd-frame-canvas supplies the interior surface
         color inside the rounded clip, and the fixed wallpaper layer gets
         its own matching radius (fixed elements escape body's overflow clip).
         The window silhouette opts out of the client-wide squircle
         (corner-shape: superellipse(1.5)) — the shell frame keeps the plain
         circular arc a desktop window is expected to have. */
      html, body {
        background: transparent !important;
      }
      html {
        /* Without this, body's overflow:hidden propagates to the viewport
           and body computes to visible — the rounded clip would silently
           never apply to in-flow descendants. */
        overflow: hidden;
      }
      body {
        /* relative so absolutely-positioned descendants (frame canvas,
           overlay layers) use body as containing block and fall inside the
           rounded overflow clip — a static body would let them escape it. */
        position: relative;
        border-radius: ${FRAME_RADIUS}px;
        corner-shape: round;
        overflow: hidden;
      }
      #${FRAME_CANVAS_ID} {
        position: absolute;
        inset: 0;
        z-index: -1;
        background: var(--dsw-alias-bg-base);
        border-radius: ${FRAME_RADIUS}px;
        corner-shape: round;
        pointer-events: none;
      }
      #dsh-wallpaper {
        border-radius: ${FRAME_RADIUS}px;
        corner-shape: round;
        overflow: hidden;
      }
      /* A hairline ring just inside the silhouette anchors the rounded edge:
         the bare alpha-AA edge reads as blur on a transparent window. A real
         element (not body::after) keeps the ring immune to client stylesheets
         claiming body's pseudo-elements, and lets the self-heal observer
         watch it by id like the other chrome nodes. */
      #${FRAME_RING_ID} {
        position: fixed;
        inset: 0;
        border-radius: ${FRAME_RADIUS}px;
        corner-shape: round;
        box-shadow: inset 0 0 0 var(--dsh-window-hairline, 1px) var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
        pointer-events: none;
        z-index: 2147483646;
      }
      html[data-window-maximized] body,
      html[data-window-maximized] #dsh-wallpaper,
      html[data-window-maximized] #${FRAME_CANVAS_ID} {
        border-radius: 0;
      }
      html[data-window-maximized] #${FRAME_RING_ID} {
        display: none;
      }
    `;
    if (style.textContent !== css) {
      style.textContent = css;
    }
  }

  function ensureFrameCanvas() {
    if (!document.body || document.getElementById(FRAME_CANVAS_ID)) {
      return;
    }
    const el = document.createElement('div');
    el.id = FRAME_CANVAS_ID;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }

  function ensureFrameRing() {
    if (!document.body || document.getElementById(FRAME_RING_ID)) {
      return;
    }
    const el = document.createElement('div');
    el.id = FRAME_RING_ID;
    el.setAttribute('aria-hidden', 'true');
    // Inside body: the --dsw-alias-* tokens are defined on body (light/dark
    // tables), so a ring sibling to body would only ever see the fallback.
    // position:fixed still escapes body's rounded overflow clip.
    document.body.appendChild(el);
  }

  function ensureControls() {
    ensureFrameCanvas();
    ensureFrameRing();
    let host = document.getElementById(CONTROLS_ID);
    if (host) {
      return host;
    }
    host = document.createElement('div');
    host.id = CONTROLS_ID;
    host.innerHTML = [
      `<button type="button" data-act="minimize" aria-label="最小化">${ICON_MIN}</button>`,
      `<button type="button" data-act="maximize" aria-label="最大化">${ICON_MAX}</button>`,
      `<button type="button" data-act="close" aria-label="关闭">${ICON_CLOSE}</button>`,
    ].join('');
    const dispatch = (event) => {
      if (event.type === 'pointerdown' && event.button !== 0) {
        return;
      }
      const button = event.target.closest('[data-act]');
      if (!button || !window.shell || typeof window.shell.windowAction !== 'function') {
        return;
      }
      if (event.type === 'pointerdown') {
        event.preventDefault();
        event.stopPropagation();
        host.dataset.pointerAct = '1';
        window.shell.windowAction(button.dataset.act);
        window.setTimeout(() => {
          delete host.dataset.pointerAct;
        }, 0);
        return;
      }
      if (host.dataset.pointerAct === '1') {
        return;
      }
      window.shell.windowAction(button.dataset.act);
    };
    host.addEventListener('pointerdown', dispatch);
    host.addEventListener('click', dispatch);
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function placeControls(host) {
    host.style.top = '0px';
    host.style.right = '0px';
    host.style.width = `${windowControlsRight()}px`;
    host.style.height = `${CAPTION_HEIGHT}px`;
    host.style.gap = `${CONTROL_GAP}px`;
    host.style.padding = `${EDGE}px`;
  }

  function applyControlTheme(host, maximized) {
    const maxBtn = host.querySelector('[data-act="maximize"]');
    if (!maxBtn) {
      return;
    }
    const mode = maximized ? 'restore' : 'maximize';
    if (maxBtn.dataset.mode === mode) {
      return;
    }
    maxBtn.dataset.mode = mode;
    maxBtn.innerHTML = maximized ? ICON_RESTORE : ICON_MAX;
    maxBtn.setAttribute('aria-label', maximized ? '还原' : '最大化');
  }

  function measure() {
    document.documentElement.style.setProperty('--dsh-window-hairline', `${1 / (window.devicePixelRatio || 1)}px`);
    ensureStyle();
    const host = ensureControls();
    placeControls(host);
    document.documentElement.style.setProperty('--dshd-wco-controls', `${windowControlsRight()}px`);
    document.documentElement.style.setProperty('--dshd-wco-caption', `${CAPTION_HEIGHT}px`);
    if (window.__dshShellMaximized) {
      document.documentElement.setAttribute('data-window-maximized', '');
    } else {
      document.documentElement.removeAttribute('data-window-maximized');
    }
    applyControlTheme(host, Boolean(window.__dshShellMaximized));
    const sample = { bg: opaqueBg(document.body) };
    if (window.shell && typeof window.shell.reportChrome === 'function') {
      window.shell.reportChrome(sample);
    }
    return sample;
  }

  if (!window.__dshShellChromeBound) {
    window.__dshShellChromeBound = true;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 80);
    };
    window.addEventListener('resize', schedule);
    // A page rebuild between navigations can drop the injected nodes; grow
    // them back instead of staying chromeless until the next re-assert.
    if (typeof MutationObserver === 'function') {
      const healer = new MutationObserver(() => {
        if (
          !document.getElementById(STYLE_ID)
          || !document.getElementById(CONTROLS_ID)
          || !document.getElementById(FRAME_CANVAS_ID)
          || !document.getElementById(FRAME_RING_ID)
        ) {
          schedule();
        }
      });
      healer.observe(document.documentElement, { childList: true, subtree: true });
    }
    if (window.shell && typeof window.shell.onWindowState === 'function') {
      window.shell.onWindowState((state) => {
        window.__dshShellMaximized = Boolean(state && state.maximized);
        measure();
      });
    }
    // State pushes only arrive on transitions; a fresh document injected while
    // the window is already maximized would otherwise draw the rounded
    // silhouette until the next geometry event.
    if (window.shell && typeof window.shell.getWindowState === 'function') {
      Promise.resolve(window.shell.getWindowState()).then((state) => {
        window.__dshShellMaximized = Boolean(state && state.maximized);
        measure();
      }).catch(() => {});
    }
    window.setTimeout(measure, 200);
    window.setTimeout(measure, 800);
    window.setTimeout(measure, 2000);
  }

  return measure();
})();
