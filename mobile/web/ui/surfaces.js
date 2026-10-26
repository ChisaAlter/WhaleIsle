const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]';

export function createSurface(document, {
  title = '', task = false, variant, anchor = 'viewport', onClose, onBack, family = 'sheet',
}) {
  const surfaceVariant = variant || (task ? 'task' : family === 'dialog' ? 'modal' : 'menu');
  const layer = document.createElement('div');
  layer.className = `${family}-layer surface-layer ${surfaceVariant}-layer${task ? ' task-layer' : ''}`;
  layer.dataset.surface = surfaceVariant;
  layer.dataset.anchor = anchor;
  const mask = document.createElement('button');
  mask.type = 'button';
  mask.className = `${family}-mask`;
  mask.tabIndex = -1;
  mask.setAttribute('aria-label', '关闭');
  mask.addEventListener('click', onClose);
  const panel = document.createElement('section');
  panel.className = `${family} surface-panel`;
  panel.tabIndex = -1;
  panel.setAttribute('role', surfaceVariant === 'menu' ? 'menu' : 'dialog');
  panel.setAttribute('aria-label', title);
  if (surfaceVariant !== 'menu') panel.setAttribute('aria-modal', 'true');
  const header = document.createElement('header');
  header.className = 'surface-head';
  const heading = document.createElement('h2');
  heading.className = 'surface-title';
  heading.textContent = title;
  heading.tabIndex = -1;
  const icon = (label, path, action) => {
    const button = document.createElement('button');
    button.className = 'icon-btn surface-control';
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(svg.namespaceURI, 'path');
    line.setAttribute('d', path); line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1.4'); line.setAttribute('fill', 'none');
    line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
    svg.append(line); button.append(svg);
    button.addEventListener('click', action);
    return button;
  };
  if (surfaceVariant === 'menu') {
    if (onBack) {
      header.classList.add('menu-head');
      header.append(icon('返回', 'M10 3 5 8l5 5', onBack), heading);
    }
  } else {
    if (onBack) header.append(icon('返回', 'M10 3 5 8l5 5', onBack));
    header.append(heading, icon('关闭', 'M4 4l8 8M12 4l-8 8', onClose));
  }
  const content = document.createElement('div');
  content.className = 'surface-content';
  if (surfaceVariant === 'menu' && !onBack) panel.append(content);
  else panel.append(header, content);
  layer.append(mask, panel);
  return { layer, panel, content, heading };
}

/** Keep one visible menu next to its live trigger as the viewport and content change. */
export function createMenuPositioner(document, frame) {
  const view = document.defaultView;
  let current = null;
  const place = () => {
    if (!current?.layer.isConnected || !current.trigger?.isConnected) return;
    const { layer, trigger, preferAbove, alignEnd } = current;
    const panel = layer.querySelector('.surface-panel');
    const bounds = trigger.getBoundingClientRect();
    const area = frame.getBoundingClientRect();
    const viewport = view.visualViewport;
    const inset = view.getComputedStyle(frame);
    const top = Math.max(area.top, viewport?.offsetTop || 0) + (parseFloat(inset.paddingTop) || 0) + 12;
    const left = Math.max(area.left, viewport?.offsetLeft || 0) + (parseFloat(inset.paddingLeft) || 0) + 12;
    const bottom = Math.min(area.bottom, (viewport?.offsetTop || 0) + (viewport?.height || view.innerHeight)) - (parseFloat(inset.paddingBottom) || 0) - 12;
    const right = Math.min(area.right, (viewport?.offsetLeft || 0) + (viewport?.width || view.innerWidth)) - (parseFloat(inset.paddingRight) || 0) - 12;
    const aboveSpace = Math.max(0, bounds.top - 8 - top);
    const belowSpace = Math.max(0, bottom - bounds.bottom - 8);
    const above = preferAbove ? aboveSpace >= Math.min(120, belowSpace) : belowSpace < Math.min(120, aboveSpace);
    layer.dataset.placement = above ? 'above' : 'below';
    layer.style.setProperty('--menu-width', `${Math.min(280, Math.max(0, right - left))}px`);
    layer.style.setProperty('--menu-height', `${Math.min(480, above ? aboveSpace : belowSpace)}px`);
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const x = Math.max(left, Math.min(alignEnd ? bounds.right - width : bounds.left, right - width));
    const y = Math.max(top, Math.min(above ? bounds.top - 8 - height : bounds.bottom + 8, bottom - height));
    layer.style.setProperty('--menu-x', `${x - area.left}px`);
    layer.style.setProperty('--menu-y', `${y - area.top}px`);
  };
  const observer = new view.ResizeObserver(place);
  const listen = (method) => {
    view[method]('resize', place);
    view[method]('scroll', place, true);
    view.visualViewport?.[method]('resize', place);
    view.visualViewport?.[method]('scroll', place);
  };
  return {
    sync(layer, trigger, { preferAbove = false, alignEnd = false } = {}) {
      observer.disconnect();
      if (current) listen('removeEventListener');
      current = layer && trigger ? { layer, trigger, preferAbove, alignEnd } : null;
      if (!current) return;
      listen('addEventListener');
      observer.observe(frame);
      observer.observe(trigger);
      observer.observe(layer.querySelector('.surface-panel'));
      const composer = trigger.closest('.composer');
      if (composer) observer.observe(composer);
      place();
    },
  };
}

export function createFocusScope(document) {
  let current = null;
  let key = '';
  let origin = null;
  const visible = (node) => !node.closest('[inert],.hidden') && node.getClientRects().length > 0;
  document.addEventListener('keydown', (event) => {
    if (!current || event.key !== 'Tab') return;
    const panel = current.querySelector('.surface-panel') || current;
    const items = [...panel.querySelectorAll(FOCUSABLE), ...document.querySelectorAll('#toast-root button')]
      .filter((node) => !node.disabled && node.tabIndex >= 0 && visible(node));
    if (!items.length) { event.preventDefault(); return; }
    const index = items.indexOf(document.activeElement);
    const next = index < 0
      ? (event.shiftKey ? items.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
  });
  return {
    sync(next, nextKey) {
      if (!current && next) origin = document.activeElement;
      const changed = key !== nextKey;
      const menu = next?.querySelector('[role="menu"]');
      const displaced = menu && !document.activeElement.closest('#toast-root')
        && (document.activeElement === document.body || !next.contains(document.activeElement));
      current = next;
      key = nextKey;
      if (next && (changed || displaced)) {
        (next.querySelector('.surface-title, [role="menu"] button:not([disabled]), h2') || next.querySelector('.surface-panel') || next).focus({ preventScroll: true });
      } else if (!next && origin) {
        if (origin.isConnected && !origin.matches('input,textarea,[contenteditable]') && !origin.closest('[inert]')) {
          origin.focus({ preventScroll: true });
        }
        origin = null;
      }
    },
  };
}
