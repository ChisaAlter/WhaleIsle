(function () {
  'use strict';

  /**
   * @typedef {'tool-approval' | 'permission-approval' | 'plan-review'} ApprovalKind
   * @typedef {'allow-once' | 'allow-always' | 'reject' | 'request-changes'} ApprovalAction
   * @typedef {{ scheme?: string, minimalMode?: boolean }} ThemePayload
   * @typedef {{
   *   eventId: string,
   *   kind: ApprovalKind,
   *   sessionId: string,
   *   sessionTitle: string | null,
   *   title: string,
   *   description: string | null,
   *   toolName: string | null,
   *   commandPreview: string | null,
   *   planSummary: string | null,
   *   subject: { name: string, icon?: string } | null,
   *   requester: { sessionId: string, label: string } | null,
   *   approveLabel: string | null,
   *   capabilities: { allowOnce: boolean, allowAlways: boolean, reject: boolean, requestChanges: boolean },
   *   busyAction: ApprovalAction | null,
   * }} ProjectedItem
   * @typedef {{
   *   visible: boolean,
   *   locale: 'zh' | 'en',
   *   theme?: ThemePayload,
   *   total: number,
   *   selectedIndex: number,
   *   activeItem: ProjectedItem | null,
   *   items: { eventId: string, kind: ApprovalKind }[],
   *   error: { eventId: string, message: string, at: number } | null,
   * }} PopupSnapshot
   * @typedef {{
   *   getState: () => Promise<PopupSnapshot>,
   *   decide: (eventId: string, action: ApprovalAction) => Promise<{ ok?: boolean, error?: string }>,
   *   select: (eventId: string) => void,
   *   openSession: (sessionId: string) => Promise<unknown>,
   *   dismiss: () => void,
   *   onState: (listener: (view: PopupSnapshot) => void) => () => void,
   *   onTheme: (listener: (theme: ThemePayload) => void) => () => void,
   * }} ApprovalPopupBridge
   */

  const rawBridge = /** @type {ApprovalPopupBridge | undefined} */ (
    /** @type {any} */ (window).dshApprovalPopup
  );
  if (!rawBridge) return;
  /** @type {ApprovalPopupBridge} */
  const bridge = rawBridge;

  const COPY = {
    zh: {
      'tool-approval': '等待工具审批',
      'permission-approval': '等待权限审批',
      'plan-review': '等待计划审阅',
      viewSession: '查看会话',
      dismiss: '暂收提醒',
      prev: '上一项',
      next: '下一项',
      reject: '拒绝',
      allowOnce: '允许一次',
      allowAlways: '始终允许',
      approvePlan: '批准执行',
      requestChanges: '修改建议',
      busy: '处理中…',
      untitledSession: '当前会话',
      delegatedBy: (/** @type {string} */ label) => `由 ${label} 委托`,
      actionFailed: '操作失败，请重试',
    },
    en: {
      'tool-approval': 'Tool approval',
      'permission-approval': 'Permission approval',
      'plan-review': 'Plan review',
      viewSession: 'View session',
      dismiss: 'Dismiss for now',
      prev: 'Previous',
      next: 'Next',
      reject: 'Reject',
      allowOnce: 'Allow once',
      allowAlways: 'Always allow',
      approvePlan: 'Approve',
      requestChanges: 'Request changes',
      busy: 'Working…',
      untitledSession: 'Current session',
      delegatedBy: (/** @type {string} */ label) => `Via ${label}`,
      actionFailed: 'Action failed, please retry',
    },
  };

  const els = {
    card: document.getElementById('card'),
    kindLabel: document.getElementById('kind-label'),
    pager: document.getElementById('pager'),
    pagerCount: document.getElementById('pager-count'),
    prevBtn: /** @type {HTMLButtonElement | null} */ (document.getElementById('prev-btn')),
    nextBtn: /** @type {HTMLButtonElement | null} */ (document.getElementById('next-btn')),
    dismissBtn: /** @type {HTMLButtonElement | null} */ (document.getElementById('dismiss-btn')),
    body: document.getElementById('body'),
    metaRow: document.getElementById('meta-row'),
    sessionName: document.getElementById('session-name'),
    requesterTag: document.getElementById('requester-tag'),
    subjectRow: document.getElementById('subject-row'),
    subjectIcon: /** @type {HTMLImageElement | null} */ (document.getElementById('subject-icon')),
    subjectName: document.getElementById('subject-name'),
    title: document.getElementById('card-title'),
    description: document.getElementById('card-description'),
    preview: document.getElementById('card-preview'),
    openSessionBtn: /** @type {HTMLButtonElement | null} */ (document.getElementById('open-session-btn')),
    actions: document.getElementById('actions'),
    toast: document.getElementById('toast'),
  };

  /** @type {PopupSnapshot | null} */
  let currentView = null;
  let lastErrorAt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let toastTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let toastHideTimer = null;
  /** @type {Map<string, number>} */
  const lockedWidths = new Map();

  /** @param {ThemePayload | undefined} theme */
  function applyTheme(theme) {
    if (!theme) return;
    if (typeof theme.scheme === 'string') {
      const isDark = theme.scheme === 'dark';
      document.documentElement.toggleAttribute('data-ds-dark-theme', isDark);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    }
    if (typeof theme.minimalMode === 'boolean') {
      document.documentElement.toggleAttribute('data-dsh-minimal', theme.minimalMode);
    }
  }

  /** @param {string} message */
  function showToast(message) {
    const toast = els.toast;
    if (!toast || !message) return;
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastHideTimer !== null) {
      clearTimeout(toastHideTimer);
      toastHideTimer = null;
    }
    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => {
      toast.setAttribute('data-visible', 'true');
    });
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast.removeAttribute('data-visible');
      toastHideTimer = setTimeout(() => {
        toastHideTimer = null;
        if (!toast.hasAttribute('data-visible')) toast.hidden = true;
      }, 200);
    }, 4000);
  }

  /**
   * @param {ProjectedItem} item
   * @param {typeof COPY.zh} copy
   * @returns {Array<{ action: ApprovalAction, label: string, variant: 'primary' | 'outline' | 'danger' }>}
   */
  function buildActionSpecs(item, copy) {
    /** @type {Array<{ action: ApprovalAction, label: string, variant: 'primary' | 'outline' | 'danger' }>} */
    const specs = [];
    const caps = item.capabilities;
    if (caps.reject) {
      specs.push({ action: 'reject', label: copy.reject, variant: 'danger' });
    }
    if (caps.requestChanges) {
      specs.push({ action: 'request-changes', label: copy.requestChanges, variant: 'outline' });
    }
    if (caps.allowOnce) {
      const label = item.kind === 'plan-review'
        ? copy.approvePlan
        : (item.approveLabel || copy.allowOnce);
      specs.push({
        action: 'allow-once',
        label,
        variant: caps.allowAlways ? 'outline' : 'primary',
      });
    }
    if (caps.allowAlways) {
      specs.push({ action: 'allow-always', label: copy.allowAlways, variant: 'primary' });
    }
    return specs;
  }

  /**
   * @param {HTMLButtonElement & { _actionCtx?: { eventId: string, action: ApprovalAction }, _copy?: typeof COPY.zh }} btn
   * @param {ProjectedItem} item
   * @param {{ action: ApprovalAction, label: string, variant: 'primary' | 'outline' | 'danger' }} spec
   * @param {typeof COPY.zh} copy
   * @param {boolean} isBusy
   */
  function updateActionButton(btn, item, spec, copy, isBusy) {
    btn.className = spec.variant === 'primary'
      ? 'action-btn action-btn-primary'
      : spec.variant === 'danger'
        ? 'action-btn action-btn-outline action-btn-danger'
        : 'action-btn action-btn-outline';
    const key = `${item.eventId}:${spec.action}`;
    const activeBusy = item.busyAction === spec.action;
    const label = activeBusy ? copy.busy : spec.label;
    if (btn.textContent !== label) btn.textContent = label;
    btn.disabled = isBusy;
    btn.setAttribute('aria-label', spec.label);
    btn.dataset.actionKey = key;
    btn._actionCtx = { eventId: item.eventId, action: spec.action };
    btn._copy = copy;
    if (activeBusy) {
      btn.setAttribute('aria-busy', 'true');
      const locked = lockedWidths.get(key);
      btn.style.minWidth = locked ? `${locked}px` : '';
    } else {
      btn.removeAttribute('aria-busy');
      btn.style.minWidth = '';
    }
  }

  /**
   * @param {ProjectedItem} item
   * @param {typeof COPY.zh} copy
   */
  function renderActions(item, copy) {
    const container = els.actions;
    if (!container) return;
    const specs = buildActionSpecs(item, copy);
    const isBusy = item.busyAction !== null;
    const existing = /** @type {Array<HTMLButtonElement & { _actionCtx?: { eventId: string, action: ApprovalAction }, _copy?: typeof COPY.zh }>} */ (
      [...container.children]
    );
    const sameShape = existing.length === specs.length
      && specs.every((spec, idx) => existing[idx]?.dataset?.actionKey === `${item.eventId}:${spec.action}`);
    if (sameShape) {
      specs.forEach((spec, idx) => updateActionButton(existing[idx], item, spec, copy, isBusy));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const spec of specs) {
      const btn = /** @type {HTMLButtonElement & { _actionCtx?: { eventId: string, action: ApprovalAction }, _copy?: typeof COPY.zh }} */ (
        document.createElement('button')
      );
      btn.type = 'button';
      updateActionButton(btn, item, spec, copy, isBusy);
      btn.addEventListener('click', () => {
        const ctx = btn._actionCtx;
        if (!ctx || !currentView?.activeItem || currentView.activeItem.busyAction !== null) return;
        const key = `${ctx.eventId}:${ctx.action}`;
        lockedWidths.set(key, Math.ceil(btn.getBoundingClientRect().width));
        const activeCopy = btn._copy || copy;
        void bridge.decide(ctx.eventId, ctx.action).then((result) => {
          if (result && result.ok === false && result.error) {
            showToast(result.error);
          }
        }).catch(() => {
          showToast(activeCopy.actionFailed);
        });
      });
      fragment.appendChild(btn);
    }
    container.replaceChildren(fragment);
  }

  const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

  /**
   * @param {unknown} raw
   * @param {unknown} harnessOrigin
   * @returns {string | null}
   */
  function sanitizeSubjectIcon(raw, harnessOrigin) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (SAFE_DATA_IMAGE_RE.test(trimmed)) return trimmed;
    if (typeof harnessOrigin !== 'string' || !harnessOrigin.trim()) return null;
    try {
      const iconUrl = new URL(trimmed);
      const originUrl = new URL(harnessOrigin);
      if (iconUrl.protocol !== 'http:' && iconUrl.protocol !== 'https:') return null;
      return iconUrl.origin === originUrl.origin ? iconUrl.href : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {ProjectedItem} item
   * @param {typeof COPY.zh} copy
   * @param {string} [harnessOrigin]
   */
  function renderItemBody(item, copy, harnessOrigin) {
    if (els.metaRow && els.sessionName && els.requesterTag) {
      els.metaRow.hidden = false;
      els.sessionName.textContent = item.sessionTitle || copy.untitledSession;
      if (item.requester) {
        els.requesterTag.textContent = copy.delegatedBy(item.requester.label);
        els.requesterTag.hidden = false;
      } else {
        els.requesterTag.hidden = true;
      }
    }

    if (els.subjectRow && els.subjectIcon && els.subjectName) {
      if (item.subject) {
        els.subjectRow.hidden = false;
        els.subjectName.textContent = item.subject.name;
        const safeIcon = sanitizeSubjectIcon(item.subject.icon, harnessOrigin);
        if (safeIcon) {
          els.subjectIcon.src = safeIcon;
          els.subjectIcon.hidden = false;
        } else {
          els.subjectIcon.removeAttribute('src');
          els.subjectIcon.hidden = true;
        }
      } else {
        els.subjectRow.hidden = true;
      }
    }

    if (els.title) els.title.textContent = item.title;
    if (els.description) {
      const hasDesc = Boolean(item.description);
      els.description.hidden = !hasDesc;
      els.description.textContent = item.description || '';
    }
    if (els.preview) {
      const previewText = item.commandPreview || item.planSummary || '';
      els.preview.hidden = !previewText;
      els.preview.textContent = previewText;
    }
  }

  /** @param {readonly { eventId: string }[]} items */
  function pruneLockedWidths(items) {
    const activeIds = new Set(items.map((entry) => entry.eventId));
    for (const key of lockedWidths.keys()) {
      const eventId = key.slice(0, key.lastIndexOf(':'));
      if (!activeIds.has(eventId)) lockedWidths.delete(key);
    }
  }

  /** @param {PopupSnapshot} view */
  function render(view) {
    currentView = view;
    applyTheme(view.theme);
    const locale = view.locale === 'en' ? 'en' : 'zh';
    document.documentElement.lang = locale;
    const copy = COPY[locale];

    if (els.card) {
      els.card.setAttribute('data-state', view.visible && view.activeItem ? 'open' : 'closed');
    }
    if (els.dismissBtn) {
      els.dismissBtn.title = copy.dismiss;
      els.dismissBtn.setAttribute('aria-label', copy.dismiss);
    }
    if (els.prevBtn) {
      els.prevBtn.title = copy.prev;
      els.prevBtn.setAttribute('aria-label', copy.prev);
    }
    if (els.nextBtn) {
      els.nextBtn.title = copy.next;
      els.nextBtn.setAttribute('aria-label', copy.next);
    }
    if (els.openSessionBtn) {
      els.openSessionBtn.textContent = copy.viewSession;
    }

    pruneLockedWidths(view.items);

    const item = view.activeItem;
    if (!item) return;

    if (els.kindLabel) els.kindLabel.textContent = copy[item.kind] || copy['tool-approval'];
    if (els.pager && els.pagerCount && els.prevBtn && els.nextBtn) {
      const multi = view.total > 1;
      els.pager.hidden = !multi;
      if (multi) {
        els.pagerCount.textContent = `${view.selectedIndex + 1} / ${view.total}`;
        els.prevBtn.disabled = view.selectedIndex <= 0;
        els.nextBtn.disabled = view.selectedIndex >= view.total - 1;
      }
    }

    renderItemBody(item, copy, /** @type {any} */ (view).harnessOrigin);
    renderActions(item, copy);

    if (view.error && view.error.at > lastErrorAt) {
      lastErrorAt = view.error.at;
      showToast(view.error.message);
    }
  }

  /** @param {number} delta */
  function stepSelection(delta) {
    if (!currentView || currentView.items.length <= 1) return;
    const targetIndex = currentView.selectedIndex + delta;
    if (targetIndex < 0 || targetIndex >= currentView.items.length) return;
    bridge.select(currentView.items[targetIndex].eventId);
  }

  els.prevBtn?.addEventListener('click', () => stepSelection(-1));
  els.nextBtn?.addEventListener('click', () => stepSelection(1));
  els.dismissBtn?.addEventListener('click', () => bridge.dismiss());
  els.openSessionBtn?.addEventListener('click', () => {
    const sessionId = currentView?.activeItem?.sessionId;
    if (!sessionId) return;
    void bridge.openSession(sessionId).catch(() => {
      const copy = COPY[currentView?.locale === 'en' ? 'en' : 'zh'];
      showToast(copy.actionFailed);
    });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      bridge.dismiss();
    }
  });

  bridge.onState(render);
  bridge.onTheme(applyTheme);
  void bridge.getState().then(render).catch(() => {
    // Window teardown can cancel the initial IPC fetch; push events stay authoritative.
  });
})();
