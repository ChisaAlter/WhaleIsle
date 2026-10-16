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
  const controls = [...document.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), #content:not([hidden]), details:not([hidden]) > summary, details[open]:not([hidden]) > pre')];
  const current = controls.indexOf(document.activeElement);
  const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
  event.preventDefault();
  controls[next].focus();
});
function applyWindowState(state) {
  document.documentElement.toggleAttribute('data-window-maximized', Boolean(state.maximized));
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
  document.getElementById('dialog').dataset.kind = state.kind || 'confirmation';
  document.getElementById('context').textContent = state.context || '';
  document.getElementById('context').hidden = !state.context;
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
  document.getElementById('close').setAttribute('aria-label', state.closeLabel);
  document.getElementById('technical-details').hidden = state.technicalDetails === '';
  document.getElementById('technical-details-label').textContent = state.technicalDetailsLabel;
  document.getElementById('technical-details-content').textContent = state.technicalDetails;
  document.getElementById('technical-details').open = false;
  document.getElementById('content').setAttribute('aria-label', state.kind === 'update' ? '更新说明' : '详情');
  document.getElementById('content').hidden = !state.detail && !state.technicalDetails;
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
