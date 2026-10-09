const OVERLAY_ID = 'dshd-shell-closing';
let closingGeneration = 0;

function overlayCss(theme) {
  return `
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  background: ${theme.bg};
  color: ${theme.fg};
  color-scheme: ${theme.scheme || 'dark'};
  font: 14px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-app-region: no-drag;
  pointer-events: all;
  user-select: none;
}
#${OVERLAY_ID} .dshd-shell-closing-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 240px;
  padding: 24px 24px 24px;
  border: 1px solid ${theme.line};
  border-radius: 24px;
  background: ${theme.field};
  box-shadow: 0 0 1px 0 rgba(0, 0, 0, 0.2), 0 12px 32px 0 rgba(0, 0, 0, 0.08);
}
#${OVERLAY_ID} .dshd-shell-closing-spinner {
  width: 36px;
  height: 36px;
  border: 2px solid ${theme.line};
  border-top-color: ${theme.accent};
  border-radius: 50%;
  animation: dshd-shell-closing-spin 0.85s linear infinite;
}
#${OVERLAY_ID} .dshd-shell-closing-title {
  margin: 8px 0 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}
#${OVERLAY_ID} .dshd-shell-closing-detail {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: ${theme.muted};
}
@keyframes dshd-shell-closing-spin {
  to { transform: rotate(360deg); }
}
`;
}

function closingCopy(locale) {
  if (locale === 'en') {
    return {
      title: 'Closing',
      detail: 'Stopping the local Harness service…',
    };
  }
  return {
    title: '关闭中',
    detail: '正在停止本机 Harness 服务，请稍候',
  };
}

function overlayScript(copy, generation) {
  return `(() => {
    const id = ${JSON.stringify(OVERLAY_ID)};
    const pick = (...keys) => {
      const styles = getComputedStyle(document.documentElement);
      for (const key of keys) {
        const value = styles.getPropertyValue(key).trim();
        if (value) return value;
      }
      return '';
    };
    const root = document.getElementById(id) || document.createElement('div');
    if (Number(root.dataset.closingGeneration || 0) > ${JSON.stringify(generation)}) return;
    root.dataset.closingGeneration = ${JSON.stringify(String(generation))};
    if (!root.id) {
      root.id = id;
      root.setAttribute('role', 'alertdialog');
      root.setAttribute('aria-busy', 'true');
      root.setAttribute('aria-live', 'assertive');
      root.setAttribute('aria-labelledby', id + '-title');
      const card = document.createElement('div');
      card.className = 'dshd-shell-closing-card';
      const spinner = document.createElement('div');
      spinner.className = 'dshd-shell-closing-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      const title = document.createElement('p');
      title.id = id + '-title';
      title.className = 'dshd-shell-closing-title';
      title.textContent = ${JSON.stringify(copy.title)};
      const detail = document.createElement('p');
      detail.className = 'dshd-shell-closing-detail';
      detail.textContent = ${JSON.stringify(copy.detail)};
      card.append(spinner, title, detail);
      root.append(card);
      (document.body || document.documentElement).append(root);
    }
    const bg = pick('--dsw-alias-bg-base', '--bg');
    const fg = pick('--dsw-alias-label-primary', '--fg');
    const muted = pick('--dsw-alias-label-tertiary', '--muted');
    const accent = pick('--dsw-alias-state-business-primary', '--dsw-alias-button-info-fill', '--accent');
    const field = pick('--dsw-alias-bg-layer-2', '--dsw-alias-bg-module-platform', '--field');
    const line = pick('--dsw-alias-border-l2', '--line');
    if (bg) root.style.background = bg;
    if (fg) root.style.color = fg;
    if (field) root.firstElementChild.style.background = field;
    if (line) root.firstElementChild.style.borderColor = line;
    if (muted) root.querySelector('.dshd-shell-closing-detail').style.color = muted;
    const spinner = root.querySelector('.dshd-shell-closing-spinner');
    if (line) spinner.style.borderColor = line;
    if (accent) spinner.style.borderTopColor = accent;
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(true));
      });
    });
  })()`;
}

async function showClosingOverlay(win, locale, contents = win?.webContents) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const { currentTheme } = require('./chrome');
  const theme = currentTheme();
  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  win.setBackgroundColor(theme.bg);
  win.focus();
  let paintTimeout;
  let cssKey;
  let dismissed = false;
  const generation = ++closingGeneration;
  const dismiss = async () => {
    dismissed = true;
    if (!contents || contents.isDestroyed()) return;
    await Promise.allSettled([
      contents.executeJavaScript(`(() => {
        const root = document.getElementById(${JSON.stringify(OVERLAY_ID)});
        if (root?.dataset.closingGeneration === ${JSON.stringify(String(generation))}) root.remove();
      })()`),
      cssKey ? contents.removeInsertedCSS(cssKey) : Promise.resolve(),
    ]);
  };
  try {
    // Covered/hidden boot pages can suspend animation frames indefinitely.
    // Painting is best effort; its host deadline must never hold shutdown.
    await Promise.race([
      (async () => {
        cssKey = await contents.insertCSS(overlayCss(theme));
        if (dismissed) return;
        await contents.executeJavaScript(overlayScript(closingCopy(locale), generation));
      })().finally(() => {
        // A hidden/unresponsive page may finish painting after cancellation.
        if (dismissed) void dismiss().catch(() => {});
      }),
      new Promise(resolve => { paintTimeout = setTimeout(resolve, 500); }),
    ]);
  } catch {
    // The page may already be gone; quit continues without the overlay.
  } finally {
    clearTimeout(paintTimeout);
  }
  return dismiss;
}

module.exports = {
  overlayCss,
  closingCopy,
  showClosingOverlay,
};
