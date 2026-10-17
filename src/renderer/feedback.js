'use strict';

// Shell surfaces use the same floating feedback contract as ui-primitives Toast.
(function () {
  let stack;
  let placementFrame = 0;

  function schedulePlacement() {
    if (placementFrame) return;
    placementFrame = requestAnimationFrame(() => {
      placementFrame = 0;
      placeStack();
    });
  }

  // Keep real page controls and confirmation cards outside the floating layer.
  // Narrow pages can put a toolbar under the normal centered Toast position.
  function placeStack() {
    if (!stack) return;
    const modal = document.querySelector('#app-confirm:not([hidden]) .modal-card');
    const main = modal ? null : document.querySelector('main');
    const column = main?.getBoundingClientRect();
    stack.style.left = column?.width ? column.left + column.width / 2 + 'px' : '50%';
    stack.style.width = Math.min(640, Math.max(0, (column?.width || innerWidth) - 48)) + 'px';
    // Width is applied before reading height, so wrapping uses the real main column.
    const boxes = [...stack.children].filter(node => node.checkVisibility()).map(node => {
      const surface = node.classList.contains('shell-feedback-task')
        ? [...node.children].find(child => child.checkVisibility()) : node;
      return surface?.getBoundingClientRect();
    }).filter(Boolean);
    if (!boxes.length) return;
    const activePage = document.querySelector('.panel.is-active') || document;
    const controls = modal
      ? [modal, ...document.querySelectorAll('.window-controls button')]
      : [...activePage.querySelectorAll('header, button, input, select, textarea, summary, [role="button"], .scene .brand, .scene .status'),
        ...document.querySelectorAll('.window-controls button, nav.tabs button')];
    const intersectsX = rect => boxes.some(box => box.left < rect.right && box.right > rect.left);
    const intervals = controls.filter(node => node.checkVisibility() && !node.closest('.shell-feedback-stack'))
      .map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height && intersectsX(rect))
      .map(rect => [Math.max(24, rect.top - 8), Math.min(innerHeight - 24, rect.bottom + 8)])
      .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
    const bands = [];
    let cursor = 24;
    for (const [start, end] of intervals) {
      if (start > cursor) bands.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < innerHeight - 24) bands.push([cursor, innerHeight - 24]);
    const contentHeight = stack.scrollHeight;
    const normalTop = 120;
    const normalBottom = Math.min(innerHeight - 24, normalTop + contentHeight);
    if (!intervals.some(([start, end]) => start < normalBottom && end > normalTop)) {
      stack.style.top = normalTop + 'px';
      stack.style.maxHeight = Math.max(0, innerHeight - normalTop - 24) + 'px';
      return;
    }
    const fitting = bands.filter(([start, end]) => end - start >= contentHeight)
      .map(([start, end]) => ({ top: Math.max(start, Math.min(normalTop, end - contentHeight)), end }));
    fitting.sort((a, b) => Math.abs(a.top - normalTop) - Math.abs(b.top - normalTop));
    // When several persistent results cannot fit together, retain a scrollable
    // floating band instead of covering the confirmation or losing an action.
    const available = fitting[0] || bands.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
      .map(([top, end]) => ({ top, end }))[0];
    if (!available) return;
    stack.style.top = available.top + 'px';
    stack.style.maxHeight = Math.max(0, available.end - available.top) + 'px';
  }

  function host() {
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'shell-feedback-stack';
      stack.className = 'shell-feedback-stack';
      document.body.append(stack);
      new ResizeObserver(schedulePlacement).observe(stack);
      new MutationObserver(schedulePlacement).observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'],
      });
      window.addEventListener('resize', schedulePlacement);
    }
    return stack;
  }

  function closeButton(label, close) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shell-feedback-close';
    button.setAttribute('aria-label', label);
    button.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    button.addEventListener('click', close);
    return button;
  }

  // Every notice fades on its own; failures and notices with actions hold longer.
  function notice({ title = '', body, tone = 'info', holdMs, actions = [] }) {
    const hold = holdMs ?? (tone === 'error' || actions.length ? 6000 : 3000);
    if (!body) return { close() {} };
    const node = document.createElement('div');
    node.className = 'shell-feedback-toast';
    node.dataset.tone = tone;
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    if (tone === 'success') {
      const icon = document.createElement('span');
      icon.className = 'shell-feedback-success';
      icon.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5 8 2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      node.append(icon);
    }
    const text = document.createElement('span');
    text.className = 'shell-feedback-text';
    text.textContent = title && title !== '提示' ? title + '：' + body : body;
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shell-feedback-action';
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
      text.append(button);
    }
    let timer;
    const close = () => { clearTimeout(timer); node.remove(); };
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    node.append(text);
    host().append(node);
    node.style.setProperty('--dsh-toast-hold', hold + 'ms');
    node.classList.add('shell-feedback-transient');
    timer = setTimeout(close, hold + 1000);
    return { close };
  }

  // Closing a live progress panel keeps a floating entry to its state and cancel action.
  function mountProgress(node, { title = '操作进度' } = {}) {
    const wrapper = document.createElement('section');
    wrapper.className = 'shell-feedback-task';
    wrapper.hidden = true;
    node.classList.add('shell-feedback-pane');
    node.setAttribute('role', 'status');
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'shell-feedback-task-summary';
    summary.hidden = true;
    let pending = false;
    let dismissed = false;
    let dismissedAfterCompletion = false;
    const dismiss = () => {
      dismissed = true;
      dismissedAfterCompletion = !pending;
      node.hidden = true;
      summary.hidden = !pending;
      wrapper.hidden = !pending;
    };
    const close = closeButton('关闭进度提示', dismiss);
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
    });
    close.classList.add('shell-feedback-pane-close');
    node.append(close);
    summary.addEventListener('click', () => {
      dismissed = false;
      dismissedAfterCompletion = false;
      summary.hidden = true;
      node.hidden = false;
    });
    wrapper.append(node, summary);
    host().append(wrapper);
    return {
      show({ reset = false, active = true, label = title } = {}) {
        pending = active;
        node.setAttribute('aria-busy', active ? 'true' : 'false');
        if (reset) {
          dismissed = false;
          dismissedAfterCompletion = false;
        }
        summary.textContent = '查看' + label;
        summary.setAttribute('aria-busy', active ? 'true' : 'false');
        wrapper.hidden = dismissedAfterCompletion;
        node.hidden = dismissed;
        summary.hidden = !dismissed || dismissedAfterCompletion;
      },
      hide() { wrapper.hidden = true; },
      dispose() { wrapper.remove(); },
    };
  }

  function progress({ title, body }) {
    const node = document.createElement('div');
    node.className = 'shell-feedback-progress';
    const heading = document.createElement('strong');
    heading.className = 'shell-feedback-progress-title';
    heading.textContent = title;
    const line = document.createElement('p');
    line.textContent = body;
    node.append(heading, line);
    const mounted = mountProgress(node, { title });
    mounted.show({ reset: true });
    return {
      update(text) { line.textContent = text; },
      close() { mounted.dispose(); },
    };
  }

  window.shellFeedback = { notice, mountProgress, progress };
})();
