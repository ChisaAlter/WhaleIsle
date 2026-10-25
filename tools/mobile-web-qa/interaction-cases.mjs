/** Controlled DOM integration inside the collaborative preview, not a device test. */
export async function runInteractionCases() {
  if (!window.__qa) throw new Error('Only run against the fake-host QA server');
  const results = [];
  const pause = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Some embedded previews do not tick compositor animations between tools.
    for (const animation of document.getAnimations()) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    }
  };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (fn) => {
    for (let i = 0; i < 120; i++) { await pause(); if (fn()) return; }
    throw new Error('Timed out waiting for UI');
  };
  const click = async (selector) => {
    const node = typeof selector === 'string' ? document.querySelector(selector) : selector;
    assert(node && !node.disabled && !node.closest('[inert]'), `Unavailable control: ${selector}`);
    node.scrollIntoView({ block: 'nearest' });
    node.click(); await pause();
  };
  const textButton = (root, text) => [...document.querySelectorAll(`${root} button`)].find((node) => node.textContent.includes(text));
  const input = (selector, text) => {
    const node = document.querySelector(selector); assert(node, `Missing ${selector}`);
    node.value = text; node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const reset = async () => {
    for (let i = 0; i < 12; i++) { const result = window.__dshdNavigation.back(); await pause(); if (result === 'root') return; }
    throw new Error('Navigation did not return to root');
  };
  const check = async (name, run) => {
    try { await reset(); await run(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
  };
  const drawer = async () => { await click('#menu'); assert(document.querySelector('#phone').hasAttribute('data-drawer'), 'drawer did not open'); };
  const chooseSession = async (id) => {
    await drawer(); await click(`.session-row[data-session-id="${id}"] > .session`);
    await wait(() => document.querySelector('#phone').dataset.sessionId === id);
  };
  await check('session navigation closes drawer and retains keyboard silence', async () => {
    await chooseSession('s-2');
    assert(!document.querySelector('#phone').hasAttribute('data-drawer'), 'drawer remained open');
    assert(document.activeElement?.id !== 'draft', 'unexpected editor focus');
  });
  await check('model search, selection and effort stay in one panel', async () => {
    await click('#model-chip'); await wait(() => textButton('#sheet-root', '更多模型'));
    assert(document.querySelector('#sheet-root .modal-layer'), 'model picker must stay compact');
    await click(textButton('#sheet-root', '更多模型'));
    input('.model-search', 'Lite'); await pause();
    assert(document.querySelectorAll('.model-results .mode-row').length === 1, 'search not applied');
    await click('.model-results .mode-row');
    await wait(() => document.querySelector('#model-chip')?.textContent.includes('Lite'));
    assert(document.querySelector('#sheet-root .surface-panel'), 'picker closed after selection');
    input('.model-search', 'R3'); await click('.model-results .mode-row');
    await wait(() => document.querySelector('#model-chip')?.textContent.includes('R3'));
    await click('#sheet-root .surface-head [aria-label="返回"]');
    const effortDrill = [...document.querySelectorAll('#sheet-root .drill')].find((node) => node.querySelector('.drill-title')?.textContent === '思考强度');
    assert(effortDrill, 'reasoning model must expose the effort drill');
    await click(effortDrill);
    await click(textButton('#sheet-root', 'Low'));
    await wait(() => document.querySelector('#sheet-root [aria-pressed="true"]')?.textContent.includes('Low'));
  });
  await check('failed model switch leaves retryable error without changing session', async () => {
    window.__qa.setFail('session.selectModel', 'QA model offline');
    try {
      await click('#model-chip'); await wait(() => textButton('#sheet-root', '更多模型'));
      await click(textButton('#sheet-root', '更多模型'));
      await click([...document.querySelectorAll('.model-results .mode-row')].find((node) => node.textContent.includes('Lite')));
      await wait(() => document.querySelector('#toast-root')?.textContent.includes('QA model offline'));
      assert(document.querySelector('#model-chip').textContent.includes('R3'), 'failed selection did not roll back');
      assert(!document.querySelector('#toast-root .icon-btn'), 'error feedback gained a close button');
    } finally { window.__qa.setFail('session.selectModel', null); }
  });
  await check('keyboard Tab never enters the hidden mask', async () => {
    await click('#model-chip');
    document.querySelector('.surface-title').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert(!document.activeElement.classList.contains('sheet-mask'), 'mask received focus');
    assert(document.querySelector('#screen-chat').inert, 'background is interactive');
  });
  await check('settings Back restores directory, Close returns to chat', async () => {
    await drawer(); await click('#nav-settings');
    await click(textButton('#options', '外观'));
    assert(!document.querySelector('#settings-back').classList.contains('hidden'), 'no Back in detail');
    await click('#settings-back');
    assert(document.querySelector('#settings-title').textContent === '设置', 'did not return to settings directory');
    await click('#close-settings');
    assert(document.querySelector('#settings').classList.contains('hidden'), 'settings remained open');
  });
  await check('directory is a full task with reachable actions and step Back', async () => {
    await drawer(); await click('#new-session');
    await click(textButton('#sheet-root', '浏览本机目录'));
    await wait(() => document.querySelector('.task-actions'));
    const foot = document.querySelector('.task-actions').getBoundingClientRect();
    assert(foot.bottom <= innerHeight + 1, 'directory actions below viewport');
    await click('#sheet-root .surface-head [aria-label="返回"]');
    assert(document.querySelector('.surface-title').textContent.includes('选择工作区'), 'Back lost task hierarchy');
  });
  await check('drafts survive changing sessions', async () => {
    input('#draft', 'QA draft A'); await chooseSession('s-3');
    input('#draft', 'QA draft B'); await chooseSession('s-2');
    assert(document.querySelector('#draft').value === 'QA draft A', 'draft A lost');
    await chooseSession('s-3'); assert(document.querySelector('#draft').value === 'QA draft B', 'draft B lost');
    await chooseSession('s-2');
  });
  await check('Git branch task and nested create return without writes', async () => {
    await click('#git-pill');
    await click('#sheet-root .git-sheet-head');
    await wait(() => document.querySelector('#sheet-root input'));
    input('#sheet-root input', 'qa-no-create'); await pause();
    const before = window.__qa.calls.length;
    await click(textButton('#sheet-root', '创建并检出'));
    assert(document.querySelector('#dialog-root .modal-layer'), 'branch name entry must be a compact modal');
    assert(!document.querySelector('#dialog-root .task-layer'), 'branch name entry unexpectedly fills the screen');
    assert(window.__dshdNavigation.back() === 'handled', 'Back did not close branch name entry');
    await wait(() => document.querySelector('#sheet-root .task-layer input'));
    assert(document.querySelector('#sheet-root input').value === 'qa-no-create', 'branch query lost');
    assert(!window.__qa.calls.slice(before).some((call) => call.method === 'gitRpc' && call.args[0] === 'git-create-branch'), 'Back created a branch');
  });
  await check('20 open/close cycles do not accumulate active barriers', async () => {
    const baseline = history.length;
    for (let i = 0; i < 20; i++) { await drawer(); await click('#drawer-close'); }
    assert(history.length <= baseline + 1, 'history accumulated duplicate roots');
    assert(window.__dshdNavigation.back() === 'root', 'stranded navigation');
    history.forward(); await pause(); await pause();
    assert(!history.state?.dshdSurface, 'Forward restored a stale barrier');
  });
  await check('created session retry never repeats session.create', async () => {
    await drawer(); await click('#new-session');
    window.__qa.setFail('session.list', 'QA catalog unavailable');
    const before = window.__qa.calls.length;
    await click(textButton('#sheet-root', '无工作区'));
    await wait(() => textButton('#sheet-root', '打开已创建会话'));
    await click(textButton('#sheet-root', '打开已创建会话'));
    await wait(() => !document.querySelector('#sheet-root .surface-panel'));
    assert(window.__qa.calls.slice(before).filter((call) => call.method === 'session.create').length === 1, 'retry created another session');
    await chooseSession('s-2');
  });
  await check('Push and PR retry skips the successful push', async () => {
    const git = window.__qa.world.git;
    const original = structuredClone(git);
    const client = window.__qa.clients.at(-1);
    const rpc = client.gitRpc;
    let rejectPr = true;
    const writes = [];
    client.gitRpc = async function (action, ...args) {
      if (['git-push', 'git-create-change-request'].includes(action)) writes.push(action);
      if (action === 'git-create-change-request' && rejectPr) { rejectPr = false; throw new Error('QA PR unavailable'); }
      return rpc.call(this, action, ...args);
    };
    try {
      Object.assign(git, { hasWorkingTreeChanges: false, aheadCount: 1, behindCount: 0, hasUpstream: true, hasPrimaryRemote: true, isDefaultRef: false, pr: null });
      await chooseSession('s-3'); await chooseSession('s-2');
      await click('#git-pill'); await click(textButton('#sheet-root', 'Push & create PR'));
      await wait(() => textButton('#sheet-root', '继续未完成操作'));
      assert(document.querySelector('#toast-root')?.textContent.includes('已完成 push'), 'completed step missing');
      await click(textButton('#sheet-root', '继续未完成操作'));
      await wait(() => !document.querySelector('#sheet-root .surface-panel'));
      assert(JSON.stringify(writes) === JSON.stringify(['git-push', 'git-create-change-request', 'git-create-change-request']), 'retry repeated push or skipped PR');
    } finally { client.gitRpc = rpc; Object.assign(git, original); }
    await chooseSession('s-3'); await chooseSession('s-2');
  });
  await check('composer and visible task controls fit the viewport', async () => {
    const nodes = ['#menu', '#attach-toggle', '#model-chip', '#access-chip', '#send-btn'];
    for (const selector of nodes) {
      const node = document.querySelector(selector);
      const rect = node.getBoundingClientRect();
      const hit = getComputedStyle(node, '::before');
      const horizontal = hit.content === 'none' ? 0 : Math.max(0, -(parseFloat(hit.left) || 0)) + Math.max(0, -(parseFloat(hit.right) || 0));
      const vertical = hit.content === 'none' ? 0 : Math.max(0, -(parseFloat(hit.top) || 0)) + Math.max(0, -(parseFloat(hit.bottom) || 0));
      assert(rect.width + horizontal >= 43.9 && rect.height + vertical >= 43.9, `${selector} touch target too small`);
      assert(rect.left >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, `${selector} overflows`);
      if (selector === '#menu') {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        for (const [x, y] of [[centerX - 21.5, centerY], [centerX + 21.5, centerY], [centerX, centerY - 21.5], [centerX, centerY + 21.5]]) {
          const target = document.elementFromPoint(x, y);
          assert(target === node || node.contains(target), `${selector} 44px edge is not pointer-reachable at ${x},${y}`);
        }
      }
    }
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'document overflows horizontally');
  });
  await reset();
  return { viewport: [innerWidth, innerHeight], level: 'controlled DOM; animations snapped; not device/motion evidence', results };
}
