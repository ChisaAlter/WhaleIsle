(() => {
  /**
   * @typedef {'hidden' | 'visible' | 'starring' | 'success' | 'error'} StarPromptPhase
   * @typedef {'direct' | 'browser'} StarPromptMode
   * @typedef {'zh' | 'en'} StarPromptLocale
   * @typedef {'' | 'auth-failed' | 'request-failed'} StarPromptErrorCode
   * @typedef {'star' | 'open-browser' | 'snooze' | 'dismiss-forever'} StarPromptActionType
   * @typedef {{
   *   visible: boolean,
   *   phase: StarPromptPhase,
   *   mode: StarPromptMode,
   *   locale: StarPromptLocale,
   *   errorCode: StarPromptErrorCode,
   * }} StarPromptView
   * @typedef {{
   *   reportStarPromptActivity?: () => void,
   *   getStarPromptState?: () => Promise<StarPromptView>,
   *   starPromptAction?: (payload: { type: StarPromptActionType }) => Promise<StarPromptView>,
   *   onStarPromptChanged?: (cb: (view: StarPromptView) => void) => (() => void) | void,
   * }} StarPromptShellApi
   * @typedef {Window & typeof globalThis & {
   *   whaleDom?: import('../shared/dom.js'),
   *   shell?: StarPromptShellApi,
   *   __dshStarPromptBound?: boolean,
   *   __dshStarPromptEnsure?: () => void,
   * }} StarPromptWindow
   */

  const win = /** @type {StarPromptWindow} */ (/** @type {unknown} */ (window));
  const whaleDom = win.whaleDom;
  if (!whaleDom || typeof whaleDom.h !== 'function' || typeof whaleDom.mount !== 'function') {
    return { ready: false };
  }
  const { h, mount } = whaleDom;

  if (win.__dshStarPromptBound) {
    if (typeof win.__dshStarPromptEnsure === 'function') {
      win.__dshStarPromptEnsure();
    }
    return { ready: true, reinjected: true };
  }
  win.__dshStarPromptBound = true;

  const STYLE_ID = 'dshd-star-prompt-style';
  const CARD_ID = 'dshd-star-prompt-card';
  const ACTIVITY_THROTTLE_MS = 500;
  const EXIT_DURATION_MS = 160;
  const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

  const COPY = {
    zh: {
      title: '支持鲸屿项目',
      invite: '喜欢鲸屿的话，欢迎点个 Star 支持一下。',
      starBtn: '一键点 Star',
      starringBtn: '正在点 Star…',
      browserBtn: '打开 GitHub 页面点 Star',
      laterBtn: '稍后再说',
      dismissBtn: '不再提醒',
      closeLabel: '关闭',
      successText: '已感谢支持，Star 成功！',
      errors: {
        'auth-failed': '凭证授权不足，请前往 GitHub 页面点赞',
        'request-failed': '请求失败，请前往 GitHub 页面点赞',
      },
    },
    en: {
      title: 'Star Whale Isle',
      invite: 'Enjoying Whale Isle? Give it a Star on GitHub.',
      starBtn: 'Star on GitHub',
      starringBtn: 'Starring…',
      browserBtn: 'Open GitHub to Star',
      laterBtn: 'Later',
      dismissBtn: "Don't remind",
      closeLabel: 'Close',
      successText: 'Thank you for starring!',
      errors: {
        'auth-failed': 'Authorization failed. Open GitHub to star.',
        'request-failed': 'Request failed. Open GitHub to star.',
      },
    },
  };

  /** @type {StarPromptView} */
  let currentView = {
    visible: false,
    phase: 'hidden',
    mode: 'direct',
    locale: 'zh',
    errorCode: '',
  };
  let lastActivityAt = -1;
  let hideTimer = 0;
  let pendingAction = false;
  let hasAuthoritativeUpdate = false;

  const iconClose = () => h('svg', {
    viewBox: '0 0 12 12',
    width: '12',
    height: '12',
    'aria-hidden': 'true',
  }, h('path', {
    d: 'M3 3l6 6M9 3L3 9',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.25',
    'stroke-linecap': 'round',
  }));

  const iconStar = () => h('svg', {
    viewBox: '0 0 16 16',
    width: '16',
    height: '16',
    'aria-hidden': 'true',
  }, h('path', {
    d: 'M8 1.6l1.95 3.95 4.36.63-3.15 3.07.74 4.34L8 11.54l-3.9 2.05.74-4.34L1.69 6.18l4.36-.63L8 1.6z',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.3',
    'stroke-linejoin': 'round',
  }));

  const iconCheck = () => h('svg', {
    viewBox: '0 0 16 16',
    width: '16',
    height: '16',
    'aria-hidden': 'true',
  }, h('path', {
    d: 'M3.5 8.3l3 3 6-6.3',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));

  /**
   * @param {Partial<StarPromptView> | null | undefined} raw
   * @returns {StarPromptView}
   */
  function normalizeView(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const phase = src.phase === 'visible'
      || src.phase === 'starring'
      || src.phase === 'success'
      || src.phase === 'error'
      ? src.phase
      : 'hidden';
    return {
      visible: Boolean(src.visible) && phase !== 'hidden',
      phase,
      mode: src.mode === 'browser' ? 'browser' : 'direct',
      locale: src.locale === 'en' ? 'en' : 'zh',
      errorCode: src.errorCode === 'auth-failed' || src.errorCode === 'request-failed'
        ? src.errorCode
        : '',
    };
  }

  /**
   * @param {StarPromptView} a
   * @param {StarPromptView} b
   * @returns {boolean}
   */
  function sameView(a, b) {
    return a.visible === b.visible
      && a.phase === b.phase
      && a.mode === b.mode
      && a.locale === b.locale
      && a.errorCode === b.errorCode;
  }

  /** @returns {boolean} */
  function isReducedMotion() {
    if (document.documentElement.hasAttribute('data-dsh-minimal')) {
      return true;
    }
    if (typeof win.matchMedia === 'function') {
      return Boolean(win.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
    }
    return false;
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    const css = `
      @keyframes dshd-star-prompt-in {
        from {
          opacity: 0;
          transform: translateY(var(--ds-motion-distance-popover, 4px));
        }
      }
      #${CARD_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483645;
        box-sizing: border-box;
        width: 300px;
        max-width: calc(100vw - 40px);
        padding: 16px;
        border-radius: var(--dsw-radius-md, 12px);
        background: var(--dsw-alias-bg-layer-2, rgb(255, 255, 255));
        backdrop-filter: var(--dsw-menu-backdrop-filter, none);
        border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
        box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.12));
        color: var(--dsw-alias-label-primary, rgb(15, 17, 21));
        font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif);
        pointer-events: auto;
        -webkit-app-region: no-drag;
        opacity: 1;
        transform: none;
        animation: dshd-star-prompt-in var(--ds-motion-duration-popover, 160ms) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
        transition:
          opacity var(--ds-motion-duration-popover, 160ms) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)),
          transform var(--ds-motion-duration-popover, 160ms) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
      }
      #${CARD_ID}[data-state='closed'] {
        opacity: 0;
        transform: translateY(var(--ds-motion-distance-popover, 4px));
        pointer-events: none;
      }
      html[data-dsh-minimal] #${CARD_ID} {
        backdrop-filter: none;
        animation: none;
        transition: none;
      }
      @media (prefers-reduced-motion: reduce) {
        #${CARD_ID} {
          animation: none;
          transition: none;
        }
      }
      #${CARD_ID} .dshd-sp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${CARD_ID} .dshd-sp-title-wrap {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        color: var(--dsw-alias-label-primary, rgb(15, 17, 21));
      }
      #${CARD_ID} .dshd-sp-title {
        margin: 0;
        font-size: 14px;
        line-height: 22px;
        font-weight: 500;
        color: var(--dsw-alias-label-primary, rgb(15, 17, 21));
      }
      #${CARD_ID} .dshd-sp-body {
        margin: 6px 0 0;
        font-size: 12px;
        line-height: 18px;
        color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));
      }
      #${CARD_ID} .dshd-sp-error {
        margin: 6px 0 0;
        font-size: 12px;
        line-height: 18px;
        color: var(--dsw-alias-state-error-primary, rgb(236, 19, 19));
      }
      #${CARD_ID} .dshd-sp-success {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        line-height: 22px;
        font-weight: 500;
        color: var(--dsw-alias-label-primary, rgb(15, 17, 21));
      }
      #${CARD_ID} .dshd-sp-success-icon {
        display: inline-flex;
        color: var(--dsw-alias-state-success-primary, rgb(34, 197, 94));
        flex-shrink: 0;
      }
      #${CARD_ID} .dshd-sp-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      #${CARD_ID} .dshd-sp-spacer {
        flex: 1;
      }
      #${CARD_ID} button {
        box-sizing: border-box;
        font-family: inherit;
        cursor: pointer;
        -webkit-app-region: no-drag;
      }
      #${CARD_ID} button:focus-visible {
        outline: 2px solid var(--dsw-alias-border-focus, var(--dsw-static-deepseek-500, #4176e6));
        outline-offset: 2px;
      }
      #${CARD_ID} .dshd-sp-close {
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: var(--dsw-radius-sm, 8px);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));
        flex-shrink: 0;
      }
      #${CARD_ID} .dshd-sp-close:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
        color: var(--dsw-alias-label-primary, rgb(15, 17, 21));
      }
      #${CARD_ID} .dshd-sp-primary {
        height: 30px;
        padding: 0 12px;
        border: 0;
        border-radius: var(--dsw-radius-button-sm, 14px);
        background: var(--dsw-static-deepseek-500, #4176e6);
        color: #ffffff;
        font-size: 12px;
        line-height: 18px;
        font-weight: 500;
      }
      #${CARD_ID} .dshd-sp-primary:hover:not(:disabled) {
        filter: brightness(1.06);
      }
      #${CARD_ID} .dshd-sp-primary:disabled {
        opacity: 0.72;
        cursor: default;
      }
      #${CARD_ID} .dshd-sp-ghost {
        height: 28px;
        padding: 0 8px;
        border: 0;
        border-radius: var(--dsw-radius-sm, 8px);
        background: transparent;
        color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));
        font-size: 12px;
        line-height: 18px;
        font-weight: 400;
      }
      #${CARD_ID} .dshd-sp-ghost:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
        color: var(--dsw-alias-label-primary, rgb(15, 17, 21));
      }
    `;
    if (style.textContent !== css) {
      style.textContent = css;
    }
  }

  /** @param {StarPromptActionType} type */
  function dispatchAction(type) {
    const api = win.shell;
    if (!api || typeof api.starPromptAction !== 'function') {
      return;
    }
    pendingAction = true;
    Promise.resolve(api.starPromptAction({ type }))
      .then((nextView) => {
        pendingAction = false;
        if (nextView && typeof nextView === 'object') {
          hasAuthoritativeUpdate = true;
          applyView(nextView);
        }
      })
      .catch((error) => {
        pendingAction = false;
        console.warn('[src/main/star-prompt-inject.js] starPromptAction failed', error);
      });
  }

  /** @param {Event} event */
  function handleCardClick(event) {
    const target = /** @type {Element | null} */ (event.target);
    const button = target && typeof target.closest === 'function'
      ? target.closest('[data-star-action]')
      : null;
    if (!button || button.hasAttribute('disabled')) {
      return;
    }
    if (pendingAction || currentView.phase === 'starring') {
      return;
    }
    const action = /** @type {StarPromptActionType | null} */ (button.getAttribute('data-star-action'));
    if (action === 'star' || action === 'open-browser' || action === 'snooze' || action === 'dismiss-forever') {
      dispatchAction(action);
    }
  }

  /** @returns {Element} */
  function ensureCardHost() {
    const container = document.body || document.documentElement;
    let card = document.getElementById(CARD_ID);
    if (!card) {
      card = document.createElement('section');
      card.id = CARD_ID;
      card.setAttribute('role', 'region');
      card.setAttribute('aria-live', 'polite');
      card.addEventListener('click', handleCardClick);
      container.appendChild(card);
    } else if (card.parentNode !== container) {
      container.appendChild(card);
    }
    return card;
  }

  /**
   * @param {StarPromptView} view
   * @returns {import('../shared/dom.js').WhaleDomChild[]}
   */
  function buildCardChildren(view) {
    const copy = COPY[view.locale];
    if (view.phase === 'success') {
      return [
        h('div', { class: 'dshd-sp-success' },
          h('span', { class: 'dshd-sp-success-icon' }, iconCheck()),
          h('span', null, copy.successText)),
      ];
    }

    const isStarring = view.phase === 'starring';
    const isBrowserFallback = view.mode === 'browser' || view.phase === 'error';
    const primaryAction = isBrowserFallback ? 'open-browser' : 'star';
    const primaryLabel = isStarring
      ? copy.starringBtn
      : (isBrowserFallback ? copy.browserBtn : copy.starBtn);
    const showSecondary = view.phase === 'visible' || view.phase === 'error';
    const errorMessage = view.phase === 'error'
      ? (copy.errors[view.errorCode || 'request-failed'] || copy.errors['request-failed'])
      : '';

    return [
      h('div', { class: 'dshd-sp-header' },
        h('div', { class: 'dshd-sp-title-wrap' },
          iconStar(),
          h('h2', { class: 'dshd-sp-title' }, copy.title)),
        showSecondary
          ? h('button', {
            type: 'button',
            class: 'dshd-sp-close',
            'data-star-action': 'snooze',
            'aria-label': copy.closeLabel,
            title: copy.closeLabel,
          }, iconClose())
          : null),
      h('p', { class: 'dshd-sp-body' }, copy.invite),
      errorMessage ? h('p', { class: 'dshd-sp-error', role: 'alert' }, errorMessage) : null,
      h('div', { class: 'dshd-sp-actions' },
        h('button', {
          type: 'button',
          class: 'dshd-sp-primary',
          'data-star-action': primaryAction,
          disabled: isStarring,
          'aria-busy': isStarring ? 'true' : null,
        }, primaryLabel),
        showSecondary ? h('span', { class: 'dshd-sp-spacer', 'aria-hidden': 'true' }) : null,
        showSecondary
          ? h('button', {
            type: 'button',
            class: 'dshd-sp-ghost',
            'data-star-action': 'snooze',
          }, copy.laterBtn)
          : null,
        showSecondary
          ? h('button', {
            type: 'button',
            class: 'dshd-sp-ghost',
            'data-star-action': 'dismiss-forever',
          }, copy.dismissBtn)
          : null),
    ];
  }

  /** @param {StarPromptView} view */
  function renderView(view) {
    ensureStyle();
    if (!view.visible) {
      const existing = document.getElementById(CARD_ID);
      if (!existing) {
        return;
      }
      if (isReducedMotion()) {
        win.clearTimeout(hideTimer);
        hideTimer = 0;
        existing.remove();
        return;
      }
      existing.setAttribute('data-state', 'closed');
      existing.setAttribute('aria-hidden', 'true');
      if (!hideTimer) {
        hideTimer = win.setTimeout(() => {
          hideTimer = 0;
          if (!currentView.visible) {
            document.getElementById(CARD_ID)?.remove();
          }
        }, EXIT_DURATION_MS);
      }
      return;
    }

    if (hideTimer) {
      win.clearTimeout(hideTimer);
      hideTimer = 0;
    }
    const card = ensureCardHost();
    const copy = COPY[view.locale];
    card.setAttribute('aria-label', copy.title);
    card.setAttribute('data-state', 'open');
    card.setAttribute('data-phase', view.phase);
    card.setAttribute('data-mode', view.mode);
    card.removeAttribute('aria-hidden');
    mount(card, ...buildCardChildren(view));
  }

  /** @param {Partial<StarPromptView> | null | undefined} nextRaw */
  function applyView(nextRaw) {
    const next = normalizeView(nextRaw);
    if (next.phase !== 'starring') {
      pendingAction = false;
    }
    const cardPresent = Boolean(document.getElementById(CARD_ID));
    const stylePresent = Boolean(document.getElementById(STYLE_ID));
    if (sameView(currentView, next) && stylePresent && (!next.visible || cardPresent)) {
      return;
    }
    currentView = next;
    renderView(currentView);
  }

  function ensureActive() {
    ensureStyle();
    if (currentView.visible) {
      const existing = document.getElementById(CARD_ID);
      const container = document.body || document.documentElement;
      if (!existing || existing.parentNode !== container) {
        renderView(currentView);
      }
    }
  }

  win.__dshStarPromptEnsure = ensureActive;

  function reportActivity() {
    const api = win.shell;
    if (!api || typeof api.reportStarPromptActivity !== 'function') {
      return;
    }
    const now = Date.now();
    if (lastActivityAt >= 0 && now - lastActivityAt < ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastActivityAt = now;
    api.reportStarPromptActivity();
  }

  const listenerOpts = { passive: true, capture: true };
  for (const eventName of ACTIVITY_EVENTS) {
    win.addEventListener(eventName, reportActivity, listenerOpts);
  }

  if (typeof MutationObserver === 'function') {
    const healer = new MutationObserver(() => {
      if (!document.getElementById(STYLE_ID) || (currentView.visible && !document.getElementById(CARD_ID))) {
        ensureActive();
      }
    });
    healer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (win.shell && typeof win.shell.onStarPromptChanged === 'function') {
    win.shell.onStarPromptChanged((nextView) => {
      hasAuthoritativeUpdate = true;
      applyView(nextView);
    });
  }

  if (win.shell && typeof win.shell.getStarPromptState === 'function') {
    Promise.resolve(win.shell.getStarPromptState())
      .then((initialView) => {
        if (!hasAuthoritativeUpdate) {
          applyView(initialView);
        }
      })
      .catch((error) => {
        console.warn('[src/main/star-prompt-inject.js] getStarPromptState failed', error);
      });
  } else {
    ensureStyle();
  }

  return { ready: true, reinjected: false };
})();
