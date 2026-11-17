import { launchSpa, pairInto, pairingUrl, sleep, openDrawer } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await page.evaluateOnNewDocument(() => { localStorage.setItem('dshd-debug-mux', '1'); });
  await pairInto(page, url);
  await sleep(2500);
  await openDrawer(page);
  const info = await page.evaluate(async () => {
    const raw = await window.__dshdDebug.hostCall('session.list', {});
    const items = raw?.items || raw?.value?.items || raw;
    const list = Array.isArray(items) ? items : [];
    const hits = list.filter((s) => /SEED|dshd-qa-bk-841217/.test(JSON.stringify(s?.projections?.values?.title || '')));
    const ws = window.__dshdDebug.workspaces();
    const inWs = new Set((ws?.items || []).flatMap((w) => w.sessionIds || []));
    const archived = new Set(ws?.archivedSessionIds || []);
    return {
      total: list.length,
      hits: hits.map((s) => ({
        id: (s.sessionId || '').slice(0, 14),
        title: s.projections?.values?.title,
        blank: s.projections?.values?.sessionListMetadata?.blank,
        origin: s.origin,
        parent: s.parentSessionId || s.chisacodeAgent?.relation?.parentAgentId || '',
        inWorkspace: inWs.has(s.sessionId),
        archived: archived.has(s.sessionId),
        cwd: s.cwd,
      })),
      stateHas: window.__dshdDebug.sessions().filter((s) => /SEED|841217/.test(s.title)).map((s) => s.title),
      drawerHas: [...document.querySelectorAll('#session-list .session-row b')].map((b) => b.textContent.trim()).filter((t) => /SEED|841217/.test(t)),
    };
  });
  console.log(JSON.stringify(info, null, 1));
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
