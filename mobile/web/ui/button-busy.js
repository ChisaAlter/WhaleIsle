// Keep the original caption in flow; feedback never contributes to button sizing.
const activeButtons = new WeakMap();

function restoreAttribute(button, name, value) {
  if (value === null) button.removeAttribute(name);
  else button.setAttribute(name, value);
}

function stopScroll(record) {
  record.animation?.cancel();
  record.animation = null;
  record.distance = 0;
}

function measureFeedback(record) {
  if (!record.overlay.isConnected) return;
  if (record.iconOnly) return;
  const distance = Math.max(0, record.text.scrollWidth - record.viewport.clientWidth);
  record.viewport.toggleAttribute('data-overflow', distance > 1);
  if (distance <= 1 || record.motion.matches) {
    stopScroll(record);
    return;
  }
  if (distance === record.distance && record.animation) return;
  // Hold both ends, then travel at a readable pace. Updating progress keeps
  // the same iteration and direction instead of jumping back to the start.
  const duration = Math.max(1800, distance / 24 * 1000 + 1200);
  const frames = [
    { transform: 'translateX(0)', offset: 0 },
    { transform: 'translateX(0)', offset: 0.2 },
    { transform: `translateX(-${distance}px)`, offset: 0.8 },
    { transform: `translateX(-${distance}px)`, offset: 1 },
  ];
  if (record.animation) {
    const phase = Number(record.animation.currentTime || 0) / record.duration;
    record.animation.effect.setKeyframes(frames);
    record.animation.effect.updateTiming({ duration });
    record.animation.currentTime = phase * duration;
  } else {
    record.animation = record.text.animate(frames, { duration, iterations: Infinity, direction: 'alternate', easing: 'linear' });
  }
  record.distance = distance;
  record.duration = duration;
}

export function buttonBusy(button, busy, { label = '处理中…', iconOnly = false } = {}) {
  const pending = Boolean(busy);
  button.setAttribute('aria-busy', String(pending));
  let record = activeButtons.get(button);
  if (!pending) {
    if (!record) return button;
    record.observer?.disconnect();
    record.view.cancelAnimationFrame(record.frame);
    record.motion.removeEventListener('change', record.measure);
    stopScroll(record);
    record.overlay.remove();
    for (const wrapper of record.wrappers) {
      if (wrapper.parentNode === button) wrapper.replaceWith(...wrapper.childNodes);
    }
    restoreAttribute(button, 'aria-label', record.ariaLabel);
    restoreAttribute(button, 'title', record.title);
    button.classList.remove('button-busy', 'button-busy-icon');
    activeButtons.delete(button);
    return button;
  }
  if (!record) {
    const document = button.ownerDocument;
    const view = document.defaultView;
    const wrappers = [];
    // Bare captions need a reserve node too. Existing elements and their
    // event handlers stay intact (including icons, hints and picker marks).
    for (const child of [...button.childNodes]) {
      if (child.nodeType !== 3 || !child.textContent.trim()) continue;
      const wrapper = document.createElement('span');
      child.replaceWith(wrapper);
      wrapper.append(child);
      wrappers.push(wrapper);
    }
    const overlay = document.createElement('span');
    overlay.className = 'button-busy-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'button-busy-spinner';
    overlay.append(spinner);
    const viewport = document.createElement('span');
    viewport.className = 'button-busy-viewport';
    const text = document.createElement('span');
    text.className = 'button-busy-text';
    viewport.append(text);
    if (!iconOnly) overlay.append(viewport);
    record = {
      overlay, viewport, text, wrappers, view, iconOnly,
      ariaLabel: button.getAttribute('aria-label'), title: button.getAttribute('title'),
      motion: view.matchMedia('(prefers-reduced-motion: reduce)'),
      animation: null, distance: 0, duration: 0, frame: 0,
    };
    record.measure = () => measureFeedback(record);
    record.motion.addEventListener('change', record.measure);
    if (!iconOnly) {
      record.observer = new view.ResizeObserver(record.measure);
      record.observer.observe(button);
      record.observer.observe(viewport);
      record.observer.observe(text);
    }
    activeButtons.set(button, record);
    button.classList.add('button-busy');
    button.classList.toggle('button-busy-icon', iconOnly);
    button.append(overlay);
    record.frame = view.requestAnimationFrame(record.measure);
  }
  const caption = String(label);
  if (record.text.textContent !== caption) record.text.textContent = caption;
  button.setAttribute('aria-label', caption);
  button.title = caption;
  record.measure();
  return button;
}

// SPA renders replace entire subtrees. Release their observers/animations
// before removal, including buttons whose operation is still in progress.
export function clearButtonBusy(root) {
  for (const button of root.querySelectorAll('.button-busy')) buttonBusy(button, false);
}
