// app/nodes.js — split from app.js (#442).


export function noticeNode(text) {
  const notice = document.createElement('p');
  notice.className = 'notice';
  notice.textContent = text;
  return notice;
}

function paneTitleNode(text) {
  const node = document.createElement('h3');
  node.className = 'pane-title';
  node.textContent = text;
  return node;
}

/**
 * Settings section: a small header (title + optional description) above its
 * controls. Every pane composes from these so the vertical rhythm is one
 * rule (24px between sections, 8px inside) instead of every element getting
 * the same gap regardless of what it is.
 */
export function sectionNode(title, desc, ...children) {
  const section = document.createElement('section');
  section.className = 'set-section';
  if (title || desc) {
    const head = document.createElement('div');
    head.className = 'set-section-head';
    if (title) {
      const heading = document.createElement('h3');
      heading.className = 'set-section-title';
      heading.textContent = title;
      head.append(heading);
    }
    if (desc) head.append(descNode(desc, 'set-section-desc'));
    section.append(head);
  }
  for (const child of children) {
    if (child) section.append(child);
  }
  return section;
}

/** Right-aligned read-only value for a hair row. */
export function valueNode(text) {
  const node = document.createElement('span');
  node.className = 'hair-value';
  node.textContent = text;
  node.title = text;
  return node;
}

/** Grouped card holding rows (hair rows, list items, inputs). */
export function groupNode(...children) {
  const group = document.createElement('div');
  group.className = 'group';
  for (const child of children) {
    if (child) group.append(child);
  }
  return group;
}

export function descNode(text, cls = 'row-desc') {
  const node = document.createElement('p');
  node.className = cls;
  node.textContent = text;
  return node;
}

export function ghostButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost-btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function primaryButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary-btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function fieldInput(value, placeholder, onInput) {
  const input = document.createElement('input');
  input.className = 'paste';
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function hairRow(title, desc, trailing) {
  const row = document.createElement('div');
  row.className = 'hair';
  const grow = document.createElement('div');
  grow.className = 'grow';
  const titleNode = document.createElement('div');
  titleNode.className = 'hair-title';
  titleNode.textContent = title;
  grow.append(titleNode);
  if (desc) grow.append(descNode(desc));
  row.append(grow);
  if (trailing) row.append(trailing);
  return row;
}

export function switchNode(on, onToggle) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(on));
  button.setAttribute('aria-pressed', String(on));
  button.addEventListener('click', onToggle);
  return button;
}
