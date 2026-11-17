function applyDarkAttribute(dark) {
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
  document.body?.toggleAttribute('data-ds-dark-theme', dark);
}

function isBootTheme() {
  return document.documentElement.hasAttribute('data-boot-theme');
}

function isOfficialShell() {
  return document.documentElement.getAttribute('data-shell-theme') === 'official';
}

function clearWallpaperOverrides(root) {
  for (const name of [
    '--dsw-alias-bg-base',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-state-business-primary',
    '--dsw-alias-button-info-fill',
    '--dsw-alias-border-l2',
  ]) {
    root.style.removeProperty(name);
  }
  document.body?.style.removeProperty('background');
}

function applyTheme(theme) {
  if (!theme) {
    return;
  }
  const dark = theme.scheme === 'dark';
  applyDarkAttribute(dark);
  const root = document.documentElement;
  root.style.colorScheme = theme.scheme || 'dark';
  if (isBootTheme() || isOfficialShell()) {
    clearWallpaperOverrides(root);
    return;
  }
  if (theme.bg) {
    root.style.setProperty('--dsw-alias-bg-base', theme.bg);
  }
  if (theme.fg) {
    root.style.setProperty('--dsw-alias-label-primary', theme.fg);
  }
  if (theme.muted) {
    root.style.setProperty('--dsw-alias-label-tertiary', theme.muted);
    root.style.setProperty('--dsw-alias-label-secondary', theme.muted);
  }
  if (theme.accent) {
    root.style.setProperty('--dsw-alias-state-business-primary', theme.accent);
    root.style.setProperty('--dsw-alias-button-info-fill', theme.accent);
  }
  if (theme.line) {
    root.style.setProperty('--dsw-alias-border-l2', theme.line);
  }
  document.body?.style.setProperty('background', theme.bg || '');
}

function watchTheme() {
  const api = window.shell;
  if (api && typeof api.onTheme === 'function') {
    api.onTheme(applyTheme);
  }
  if (api && typeof api.getConfig === 'function') {
    Promise.resolve(api.getConfig())
      .then((config) => applyTheme(config.themeTokens))
      .catch((error) => { console.warn('[src/renderer/theme.js] background operation failed', error); });
  }
}

window.applyShellTheme = applyTheme;
window.watchShellTheme = watchTheme;
