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
  panel.setAttribute('role', surfaceVariant === 'menu' ? 'menu' : 'dialog');
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
  if (surfaceVariant === 'bottom') {
    // Composer-triggered bottom sheet: back (or close) on the left, a
    // centered title, and a matching spacer on the right.
    header.append(
      onBack ? icon('返回', 'M10 3 5 8l5 5', onBack) : icon('关闭', 'M4 4l8 8M12 4l-8 8', onClose),
      heading,
    );
    const spacer = document.createElement('span');
    spacer.className = 'surface-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    header.append(spacer);
  } else if (surfaceVariant !== 'menu') {
    if (onBack) header.append(icon('返回', 'M10 3 5 8l5 5', onBack));
    header.append(heading, icon('关闭', 'M4 4l8 8M12 4l-8 8', onClose));
  }
  const content = document.createElement('div');
  content.className = 'surface-content';
  if (surfaceVariant === 'menu') panel.append(content);
  else panel.append(header, content);
  layer.append(mask, panel);
  return { layer, panel, content, heading };
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
      current = next;
      key = nextKey;
      if (next && changed) {
        (next.querySelector('.surface-title, [role="menu"] button, h2') || next).focus({ preventScroll: true });
      } else if (!next && origin) {
        if (origin.isConnected && !origin.matches('input,textarea,[contenteditable]') && !origin.closest('[inert]')) {
          origin.focus({ preventScroll: true });
        }
        origin = null;
      }
    },
  };
}
