'use strict';

(function () {
  /** @type {any} */
  const shell = /** @type {any} */ (window).shell;
  if (!shell) return;

  if (shell.platform) {
    document.documentElement.dataset.platform = shell.platform;
  }

  const OWNERSHIP_LABELS = {
    external: '已复用本机 Magpie',
    'external-ui-companion': '已复用本机 Magpie',
    'managed-shared-config': '托管 · 共享本机配置',
    managed: '托管 Magpie',
  };

  /** @param {any} meta */
  function renderMeta(meta) {
    if (!meta || typeof meta !== 'object') return;
    const dark = meta.theme?.scheme === 'dark';
    document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

    const badge = document.getElementById('magpie-ownership');
    const label = OWNERSHIP_LABELS[/** @type {keyof typeof OWNERSHIP_LABELS} */ (meta.ownership)] || '';
    if (badge) {
      badge.textContent = label;
      badge.hidden = !label;
    }
    const ver = document.getElementById('magpie-version');
    if (ver) {
      ver.textContent = meta.version ? `v${meta.version}` : '';
    }
    const updateBtn = document.getElementById('magpie-update-btn');
    if (updateBtn) {
      const hasExternalUpdate = Boolean(meta.externalUpdateUrl && meta.latestVersion);
      updateBtn.hidden = !hasExternalUpdate;
      if (hasExternalUpdate) {
        updateBtn.textContent = `发现新版 v${meta.latestVersion}`;
      }
    }
  }

  document.getElementById('magpie-reload-btn')?.addEventListener('click', () => {
    shell.reloadPage?.();
  });
  document.getElementById('magpie-update-btn')?.addEventListener('click', () => {
    void shell.openExternalUpdate?.();
  });

  if (typeof shell.onMeta === 'function') {
    shell.onMeta(renderMeta);
  }
  if (typeof shell.getMeta === 'function') {
    Promise.resolve(shell.getMeta()).then(renderMeta).catch(() => {
      // Meta updates continue arriving via onMeta if the initial pull races close.
    });
  }
})();
