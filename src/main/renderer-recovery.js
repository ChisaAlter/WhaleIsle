'use strict';

/**
 * A page that crashed, hung or failed to load recovers on its own: it is
 * reloaded a couple of times, and only when that does not help does the
 * surface show a static failure page with a retry link. Recovery never raises
 * a dialog or an overlay (feature card: desktop-launcher).
 */

const UNRESPONSIVE = '界面无响应';
// Waits before each automatic reload; a Harness that is restarting needs a few
// seconds before its page can load again.
const RELOAD_DELAYS_MS = [1000, 3000, 8000];
const RELOAD_WINDOW_MS = 120_000;
// A busy page often answers again by itself; only a long hang is reloaded.
const UNRESPONSIVE_GRACE_MS = 30_000;
const DETAIL_TAIL_LINES = 8;
const DETAIL_BUDGET = 1200;
// The failure page has no bridge, so its retry link is a URL the shell
// intercepts instead of a script.
const RETRY_URL = 'dshd-retry://now';

// Line separators U+2028 and U+2029 break a regex literal, so build it.
const LINE_BREAK = new RegExp(`\\r\\n|[\\n\\r${String.fromCharCode(0x2028, 0x2029)}]`, 'u');

function createReloadBudget({ delaysMs = RELOAD_DELAYS_MS, windowMs = RELOAD_WINDOW_MS, now = Date.now } = {}) {
  let taken = [];
  return {
    // The wait before the next automatic reload, or null once the budget for
    // this window is spent.
    take() {
      const at = now();
      taken = taken.filter((time) => at - time < windowMs);
      if (taken.length >= delaysMs.length) return null;
      const delay = delaysMs[taken.length];
      taken.push(at);
      return delay;
    },
    reset() {
      taken = [];
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function reasonDetail(why) {
  const text = String(why ?? '');
  const tail = text.split(LINE_BREAK).slice(-DETAIL_TAIL_LINES).join('\n');
  const shortened = tail.slice(-DETAIL_BUDGET).replace(/^[\uDC00-\uDFFF]/u, '');
  return shortened === text ? text : `（已截断）\n${shortened}`;
}

function failurePageHtml({ label, why, reportPath }) {
  const report = reportPath ? `<p>诊断已写入 ${escapeHtml(reportPath)}</p>` : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>界面异常</title>
<style>
:root { color-scheme: light dark; }
html, body { height: 100%; margin: 0; background: Canvas; color: CanvasText; font: 14px/1.6 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
main { box-sizing: border-box; max-width: 560px; margin: 0 auto; padding: 12vh 24px 24px; }
h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
p { margin: 0 0 12px; color: GrayText; overflow-wrap: anywhere; }
pre { margin: 0 0 16px; padding: 12px; border: 1px solid GrayText; border-radius: 8px; color: CanvasText; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
a { display: inline-block; padding: 6px 16px; border: 1px solid CanvasText; border-radius: 8px; color: CanvasText; text-decoration: none; }
a:focus-visible { outline: 2px solid CanvasText; outline-offset: 2px; }
</style></head>
<body><main role="alert">
<h1>${escapeHtml(label)}界面没有恢复</h1>
<p>已自动重新加载，仍然失败。可以再试一次；反复出现请退出后重新打开。</p>
<pre>${escapeHtml(reasonDetail(why))}</pre>
${report}
<a href="${RETRY_URL}">重新加载</a>
</main></body></html>`;
}

function failurePageUrl(details) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(failurePageHtml(details))}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {import('electron').WebContents} contents
 * @param {{
 *   label: string,
 *   report: (why: string) => Promise<string | undefined>,
 *   budget?: ReturnType<typeof createReloadBudget>,
 *   wait?: (ms: number) => Promise<void>,
 *   graceMs?: number,
 * }} options `report` records the diagnostics for one failure and returns
 *   the report path.
 */
function attachRecovery(contents, {
  label, report, budget = createReloadBudget(), wait = sleep, graceMs = UNRESPONSIVE_GRACE_MS,
}) {
  let lastUrl = '';
  let hangTimer = null;
  let recovering = false;
  const showingFailure = () => contents.getURL().startsWith('data:');

  const reload = () => {
    if (contents.isDestroyed()) return;
    if (lastUrl && showingFailure()) void Promise.resolve(contents.loadURL(lastUrl)).catch(() => {});
    else contents.reloadIgnoringCache();
  };

  const recover = async (why) => {
    if (recovering || contents.isDestroyed()) return;
    recovering = true;
    try {
      const reportPath = await report(why);
      if (contents.isDestroyed() || showingFailure()) return;
      const delay = budget.take();
      if (delay !== null) {
        await wait(delay);
        reload();
        return;
      }
      void Promise.resolve(contents.loadURL(failurePageUrl({ label, why, reportPath }))).catch(() => {});
    } finally {
      recovering = false;
    }
  };

  contents.on('did-finish-load', () => {
    const url = contents.getURL();
    if (url && !url.startsWith('data:')) lastUrl = url;
  });
  contents.on('render-process-gone', (_event, details) => {
    const reason = details && details.reason;
    if (reason === 'clean-exit' || reason === 'killed') return;
    void recover(reason || '渲染进程退出');
  });
  contents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
    if (isMainFrame === false || code === -3 || String(url).startsWith('data:')) return;
    void recover(`页面加载失败（${desc || code}）`);
  });
  contents.on('unresponsive', () => {
    clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      hangTimer = null;
      void recover(UNRESPONSIVE);
    }, graceMs);
    hangTimer.unref?.();
  });
  contents.on('responsive', () => {
    clearTimeout(hangTimer);
    hangTimer = null;
  });
  contents.once('destroyed', () => clearTimeout(hangTimer));
  contents.on('will-navigate', (event, url) => {
    if (url !== RETRY_URL) return;
    event.preventDefault();
    budget.reset();
    reload();
  });

  return { recover, budget };
}

module.exports = {
  UNRESPONSIVE,
  RETRY_URL,
  createReloadBudget,
  reasonDetail,
  failurePageHtml,
  failurePageUrl,
  attachRecovery,
};
