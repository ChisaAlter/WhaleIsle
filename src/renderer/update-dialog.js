'use strict';
/** Main-owned copy and responses; Escape is cancellation, never acceptance. */
const api = window.dshUpdateDialog;
let view;
let responding = false;

// The dialog is a transparent child BrowserWindow: the shell token table
// (`dsh-webui-tokens.css`) ships its dark half behind `data-ds-dark-theme`.
// `applyTheme` mirrors what `theme.js` does for boot/launcher surfaces; the
// initial scheme arrives inside `view` and later flips land via `onTheme`.
function applyScheme(scheme) {
  const dark = scheme === 'dark';
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.body?.toggleAttribute('data-ds-dark-theme', dark);
}

function respond(index) {
  if (responding || view === undefined) return;
  responding = true;
  const downloadMode = document.querySelector('input[name="download-method"]:checked')?.value;
  void api.respond(view.revision, index, downloadMode).catch(() => { responding = false; });
}
document.getElementById('close').addEventListener('click', () => { respond(view.cancelId); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && view !== undefined) { event.preventDefault(); respond(view.cancelId); }
  if (event.key !== 'Tab') return;
  const controls = [...document.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), #content:not([hidden]), #request-secret:not([hidden]), details:not([hidden]) > summary, details[open]:not([hidden]) > pre')]
    .filter((el) => !(/** @type {HTMLElement} */ (el)).hidden && !el.closest('[hidden]'));
  if (!controls.length) return;
  const current = controls.indexOf(document.activeElement);
  const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
  event.preventDefault();
  controls[next].focus();
});
function applyWindowState(state) {
  document.documentElement.toggleAttribute('data-window-maximized', Boolean(state.maximized));
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function createSvgPath(attrs) {
  const path = document.createElementNS(SVG_NS, 'path');
  for (const [key, value] of Object.entries(attrs)) path.setAttribute(key, value);
  return path;
}
function renderToneIcon(tone, isUpdate) {
  const iconHost = document.getElementById('tone-icon');
  iconHost.replaceChildren();
  if (isUpdate || (tone !== 'danger' && tone !== 'warning' && tone !== 'info')) {
    iconHost.hidden = true;
    return;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  if (tone === 'info') {
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.append(
      createSvgPath({
        d: 'M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z',
        fill: 'currentColor',
      }),
      createSvgPath({ d: 'M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127Z', fill: 'currentColor' }),
      createSvgPath({ d: 'M7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z', fill: 'currentColor' }),
    );
  } else {
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('stroke-width', '1.3');
    svg.setAttribute('stroke-linecap', 'round');
    svg.append(
      createSvgPath({
        d: 'M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z',
        stroke: 'currentColor',
      }),
      createSvgPath({ d: 'M8 4.29199V9.79199', stroke: 'currentColor' }),
      createSvgPath({ d: 'M8 10.708V11.708', stroke: 'currentColor' }),
    );
  }
  iconHost.append(svg);
  iconHost.hidden = false;
}
function renderContext(state) {
  const contextEl = document.getElementById('context');
  contextEl.replaceChildren();
  const attr = state.attribution;
  if (attr && (attr.source || attr.level)) {
    contextEl.dataset.layout = 'badges';
    if (attr.source) {
      const sourceChip = document.createElement('span');
      sourceChip.className = 'context-source';
      sourceChip.textContent = attr.source;
      contextEl.append(sourceChip);
    }
    if (attr.level) {
      const levelChip = document.createElement('span');
      levelChip.className = 'context-level';
      levelChip.dataset.tone = attr.tone || 'neutral';
      levelChip.textContent = attr.level;
      contextEl.append(levelChip);
    }
    contextEl.hidden = false;
    return;
  }
  delete contextEl.dataset.layout;
  contextEl.textContent = state.context || '';
  contextEl.hidden = !state.context;
}
function renderRequestCard(state) {
  const card = document.getElementById('request-card');
  const captionEl = document.getElementById('request-caption');
  const summaryEl = document.getElementById('request-summary');
  const secretEl = document.getElementById('request-secret');
  const detailsEl = document.getElementById('request-details');
  const hintEl = document.getElementById('request-hint');
  const dialog = document.getElementById('dialog');
  const req = state.kind !== 'update' ? state.requestSection : null;
  if (!req) {
    card.hidden = true;
    captionEl.textContent = '';
    summaryEl.textContent = '';
    secretEl.textContent = '';
    detailsEl.textContent = '';
    hintEl.textContent = '';
    dialog.setAttribute('aria-describedby', 'detail');
    return false;
  }
  document.getElementById('detail').hidden = true;
  document.getElementById('detail').textContent = '';
  captionEl.textContent = req.caption || '';
  captionEl.hidden = !req.caption;
  summaryEl.textContent = req.summary || '';
  summaryEl.hidden = !req.summary;
  secretEl.textContent = req.isSecret ? (req.details || '') : '';
  secretEl.hidden = !(req.isSecret && req.details);
  detailsEl.textContent = !req.isSecret ? (req.details || '') : '';
  detailsEl.hidden = !(!req.isSecret && req.details);
  hintEl.textContent = req.hint || '';
  hintEl.hidden = !req.hint;
  card.hidden = false;
  dialog.setAttribute('aria-describedby', 'request-card');
  return true;
}
function renderNotes(state) {
  const tabs = document.getElementById('notes-tabs');
  const content = document.getElementById('content');
  const detail = document.getElementById('detail');
  const sections = state.kind === 'update' ? state.detailTabs || [] : [];
  const tabbed = sections.length > 1;
  tabs.replaceChildren();
  tabs.hidden = !tabbed;
  document.getElementById('dialog').classList.toggle('has-notes-tabs', tabbed);
  content.setAttribute('role', tabbed ? 'tabpanel' : 'region');
  content.removeAttribute('aria-labelledby');
  detail.removeAttribute('lang');
  detail.textContent = state.detail;
  detail.hidden = !state.detail;
  if (!tabbed) return;

  const select = (index, focus = false) => {
    for (const [i, tab] of [...tabs.children].entries()) {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    }
    const tab = tabs.children[index];
    content.setAttribute('aria-labelledby', tab.id);
    detail.textContent = sections[index].text;
    detail.lang = sections[index].id;
    detail.hidden = false;
    content.scrollTop = 0;
    if (focus) tab.focus();
  };
  for (const [index, section] of sections.entries()) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `notes-tab-${section.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'content');
    tab.textContent = section.label;
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
      else if (event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = sections.length - 1;
      else return;
      event.preventDefault();
      select(next, true);
    });
    tabs.append(tab);
  }
  const preferred = sections.findIndex((section) => section.id === state.locale);
  select(preferred < 0 ? 0 : preferred);
}
function render(state) {
  if (state === null) {
    responding = true;
    document.body.classList.remove('visible');
    return;
  }
  if (view !== undefined && state.revision <= view.revision) { applyWindowState(state); return; }
  responding = false;
  view = state;
  applyWindowState(state);
  applyScheme(state.scheme);
  document.documentElement.lang = state.locale;
  document.title = state.title;
  document.getElementById('title').textContent = state.message;
  const dialog = document.getElementById('dialog');
  dialog.dataset.kind = state.kind || 'confirmation';
  dialog.dataset.tone = state.kind === 'update' ? '' : (state.tone || '');
  renderToneIcon(state.tone, state.kind === 'update');
  renderContext(state);
  const methods = state.downloadMethods || [];
  document.getElementById('download-methods').hidden = methods.length === 0;
  const options = document.getElementById('download-method-options');
  options.replaceChildren();
  const selected = methods.find((method) => !method.disabledReason)?.id;
  for (const method of methods) {
    const label = document.createElement('label');
    label.className = 'download-method';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'download-method';
    input.value = method.id;
    input.disabled = Boolean(method.disabledReason);
    input.checked = method.id === selected;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = method.label;
    const description = document.createElement('span');
    description.textContent = method.disabledReason || method.description;
    copy.append(title, description);
    label.append(input, copy);
    options.append(label);
  }
  renderNotes(state);
  const hasRequestCard = renderRequestCard(state);
  document.getElementById('close').setAttribute('aria-label', state.closeLabel);
  document.getElementById('technical-details').hidden = state.technicalDetails === '';
  document.getElementById('technical-details-label').textContent = state.technicalDetailsLabel;
  document.getElementById('technical-details-content').textContent = state.technicalDetails;
  document.getElementById('technical-details').open = false;
  document.getElementById('content').setAttribute('aria-label', state.kind === 'update' ? '更新说明' : '详情');
  document.getElementById('content').hidden = !hasRequestCard && !state.detail && !state.technicalDetails;
  document.getElementById('actions').replaceChildren();
  for (const [index, label] of state.buttons.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    const danger = Array.isArray(state.dangerIds) && state.dangerIds.includes(index);
    button.className = danger ? 'danger' : (index === 0 ? 'primary' : 'secondary');
    button.addEventListener('click', () => { respond(index); });
    document.getElementById('actions').append(button);
  }
  document.querySelector('main').hidden = false;
  document.getElementById('content').scrollTop = 0;
  document.body.classList.add('visible');
  document.getElementById('dialog').focus();
}
let received = false;
const unsubscribe = api.subscribe((state) => { received = true; render(state); });
window.addEventListener('pagehide', unsubscribe, { once: true });
void api.status().then((state) => { if (!received) render(state); });
if (typeof api.onTheme === 'function') {
  api.onTheme((theme) => applyScheme(theme?.scheme));
}
