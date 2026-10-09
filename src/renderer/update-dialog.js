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
  const controls = [...document.querySelectorAll('button:not(:disabled), input:not(:disabled), #content:not([hidden]), details:not([hidden]) > summary, details[open]:not([hidden]) > pre')];
  const current = controls.indexOf(document.activeElement);
  const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
  event.preventDefault();
  controls[next].focus();
});
function applyWindowState(state) {
  document.documentElement.toggleAttribute('data-window-maximized', Boolean(state.maximized));
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
  document.getElementById('detail').textContent = state.detail;
  document.getElementById('detail').hidden = state.detail === '';
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
