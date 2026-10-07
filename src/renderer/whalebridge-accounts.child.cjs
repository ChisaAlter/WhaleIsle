'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

app.setPath('userData', process.argv[2]);
app.on('window-all-closed', () => {});

const assets = path.resolve(__dirname, '../../vendor/whalebridge/internal/whalebridge/assets');
const assetNames = new Set(fs.readdirSync(assets));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const builtins = [
  { id: 'claude', name: 'Claude', plugin: false },
  { id: 'codex', name: 'Codex', plugin: false },
  { id: 'cursor', name: 'Cursor', plugin: false, package: '@fixture/cursor-auth' },
];
const adapter = id => ({ id, pid: 'cursor', name: 'Cursor', plugin: true, methods: [
  { type: 'oauth', label: 'Cursor OAuth' },
  { type: 'api', label: 'Cursor API key' },
] });
let scenario = 'normal', installed = false;
const calls = [], catalogs = [];
const providers = [{ id: 'cursor', name: 'Cursor', account: true, modelCount: 0 }];
const flows = new Map();

// Only this loopback fixture receives writes; static content is the production UI.
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const json = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (pathname.startsWith('/api/')) {
      let bytes = '';
      for await (const chunk of req) bytes += chunk;
      const body = bytes ? JSON.parse(bytes) : undefined;
      calls.push({ scenario, path: pathname, body });
      if (pathname === '/api/state') return json({
        version: 'fixture', gateway: 'http://127.0.0.1',
        presets: scenario === 'layout' ? [{ id: 'layout-preset', name: 'Fixture region provider', regions: [
          { id: 'fixture-region', name: 'Fixture region', chat: 'https://fixture.example/v1',
            decide: 'https://fixture.example/workspaces/{WorkspaceId}/decide', models: ['fixture-model'] },
        ] }] : [],
        hidden: [], groups: scenario === 'layout' ? [{ id: 'group/fixture-long-route-identifier',
          name: 'Fixture route with a longer readable name', routing: 'rotate',
          members: ['fixture-api/fixture-model', 'fixture-provider/long-model-identifier-that-must-wrap-without-overflow'],
        }] : [],
        providers: scenario === 'layout' ? [...providers, { id: 'fixture-layout-provider',
          name: 'Fixture provider with a longer readable name', chat: 'https://fixture.example/long-provider-endpoint/v1',
          modelCount: 20, routing: 'rotate', off: true }] : providers,
        models: [...providers.flatMap(provider => (provider.models || []).map(id => ({ id: `${provider.id}/${id}` }))),
          ...(scenario === 'layout' ? [{ id: 'fixture-provider/long-model-identifier-that-must-wrap-without-overflow',
            name: 'Fixture model with a longer readable name', images: true, context: 128000, efforts: ['low', 'medium', 'high'] },
          { id: 'group/fixture-long-route-identifier', name: 'Fixture route', group: true }] : [])],
      });
      if (pathname === '/api/provider') {
        providers.push({ ...body, id: 'fixture-api', account: false, modelCount: body.models.length });
        return json({ ok: true });
      }
      if (pathname === '/api/subscriptions') {
        const rows = !installed ? builtins : scenario === 'migrated'
          ? [...builtins.filter(row => row.id !== 'cursor'), adapter('cursor')]
          : [...builtins, adapter('cursor-plugin')];
        catalogs.push({ scenario, installed, ids: rows.map(row => row.id) });
        return json(rows);
      }
      if (pathname === '/api/subscription/adapter') {
        if (scenario === 'failure') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          return res.end('fixture adapter installation failed');
        }
        installed = true;
        return json({ ok: true });
      }
      if (pathname === '/api/subscription/prompt') {
        const inputs = { ...(body.inputs || {}) };
        if (scenario !== 'prompts') return json({ prompt: null, inputs });
        if (body.key) {
          const expected = { tenant: 'fixture-tenant', region: 'eu' }[body.key];
          if (body.value !== expected) return json({ error: `fixture ${body.key} rejected` });
          inputs[body.key] = body.value;
        }
        const prompt = !inputs.tenant
          ? { type: 'text', key: 'tenant', message: 'Fixture tenant' }
          : !inputs.region ? { type: 'select', key: 'region', message: 'Fixture region', options: [
            { label: 'US', value: 'us' }, { label: 'Europe', value: 'eu' },
          ] } : null;
        return json({ prompt, inputs });
      }
      if (pathname === '/api/signin') {
        if (!scenario.startsWith('polled-') && !scenario.startsWith('signin-')) return json({ state: 'done' });
        const id = `${scenario}-flow`;
        flows.set(id, { scenario, agent: body.agent, polls: 0 });
        return json({ id, agent: body.agent, state: 'waiting' });
      }
      if (/^\/api\/signin\/[^/]+\/cancel$/.test(pathname)) return json({ ok: true });
      if (/^\/api\/signin\/[^/]+$/.test(pathname)) {
        const id = pathname.slice('/api/signin/'.length), flow = flows.get(id);
        if (flow) {
          flow.polls++;
          const state = { id, agent: flow.agent };
          if (flow.scenario === 'signin-failed') return json({ ...state, state: 'failed', error: 'fixture sign-in failed' });
          if (flow.scenario === 'signin-canceled') return json({ ...state, state: 'canceled' });
          if (flow.scenario === 'signin-pending-cancel' || flow.scenario === 'polled-success' && flow.polls === 1) {
            return json({ ...state, state: 'waiting' });
          }
          if (!providers.some(provider => provider.id === flow.agent)) {
            providers.push({ id: flow.agent, name: builtins.find(row => row.id === flow.agent).name,
              account: true, modelCount: 1, models: ['fixture-subscription-model'] });
          }
          return json({ ...state, state: 'done', user: 'fixture@example.test', again: flow.scenario === 'polled-renewed' });
        }
      }
      if (pathname === '/api/accounts/cursor') return json(scenario === 'layout' ? [
        { user: 'fixture.long.account.identity@example.test', plan: 'Fixture subscription', active: true },
        { user: 'second.fixture.account@example.test', plan: 'Fixture subscription', on: true },
      ] : []);
      if (pathname === '/api/keys/fixture-api') return json([
        { id: 'fixture-primary', name: 'Fixture primary key', masked: 'fixture-***-primary', weight: 1, active: true },
        { id: 'fixture-second', name: 'Fixture second key with a longer name', masked: 'fixture-***-second', weight: 2, on: true },
      ]);
    } else {
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (assetNames.has(name)) {
        res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream' });
        return res.end(fs.readFileSync(path.join(assets, name)));
      }
    }
    res.writeHead(404); res.end('unknown fixture request');
  } catch (error) {
    res.writeHead(500); res.end(error.message);
  }
});

async function run() {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ width: 1120, height: 800, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'whalebridge-accounts-test' },
  });
  const js = async (source, timeout = 5000) => {
    let timer;
    try {
      return await Promise.race([
        win.webContents.executeJavaScript(source),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`renderer command did not settle: ${source}`)), timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const waitFor = async expression => {
    const deadline = Date.now() + 5000;
    do {
      if (await js(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    const status = await js(`({ editorType: editor?.type, closed: editor?.closed, request: editor?.request,
      loginFlow, open: document.querySelector('#editor').open, fields: document.querySelector('#fields').textContent,
      error: document.querySelector('#form-error').textContent })`);
    throw new Error(`DOM did not settle: ${expression}\n${JSON.stringify({ scenario, status,
      calls: calls.slice(-12), flows: [...flows.entries()] })}`);
  };
  const read = () => js(`(() => {
    const get = selector => document.querySelector(selector);
    const button = get('#fields [data-action="install-adapter"]');
    return { selected: get('#f-agent')?.value, methods: [...(get('#f-method')?.options || [])].map(option => option.textContent),
      hasAdapterButton: !!button, adapterDisabled: button?.disabled,
      error: get('#form-error').hidden ? '' : get('#form-error').textContent };
  })()`);
  const readSuccess = () => js(`(() => {
    const get = selector => document.querySelector(selector), success = get('.connection-success');
    const rect = success?.getBoundingClientRect(), status = success?.querySelector('.connection-success-status');
    const summary = success?.querySelector('.connection-result-head'), statusRect = status?.getBoundingClientRect();
    const summaryRect = summary?.getBoundingClientRect(), whale = success?.querySelector('.connection-next img');
    return { open: get('#editor').open, title: get('#editor-title').textContent,
      visible: !!rect && rect.width > 0 && rect.height > 0,
      detail: success?.querySelector('.connection-result > p')?.textContent || '',
      instruction: success?.querySelector('.connection-next .muted')?.textContent || '',
      sourceName: success?.querySelector('.connection-identity strong')?.textContent || '',
      identity: success?.querySelector('.connection-identity .caption')?.textContent || '',
      status: status?.textContent || '', checkedStatus: status?.querySelector('use')?.getAttribute('href') === '/icons.svg#check',
      statusWithinSummary: !!statusRect && statusRect.width > 0 && statusRect.left >= summaryRect.left &&
        statusRect.right <= summaryRect.right && statusRect.top >= summaryRect.top && statusRect.bottom <= summaryRect.bottom,
      nextStep: success?.querySelector('.connection-next h3')?.textContent || '',
      whaleRendered: !!whale && whale.complete && whale.naturalWidth > 0 && whale.getBoundingClientRect().width > 0,
      primary: get('#save').textContent, primaryHidden: get('#save').hidden, primaryDisabled: get('#save').disabled,
      completion: get('#cancel-editor').textContent, fieldCount: get('#fields').querySelectorAll('input,select,textarea').length,
      error: get('#form-error').hidden ? '' : get('#form-error').textContent };
  })()`);
  const waitForSuccess = async () => {
    await waitFor(`document.querySelector('.connection-success') && !document.querySelector('#refresh').disabled`);
    await js(`(async () => { await Promise.all(document.querySelector('#editor').getAnimations().map(animation => animation.finished)); })()`);
    return readSuccess();
  };
  // The close event is queued separately from removing the dialog's open state.
  const closeEditor = (control = '#cancel-editor') => js(`new Promise(resolve => {
    document.querySelector('#editor').addEventListener('close', () => resolve(), { once: true });
    document.querySelector(${JSON.stringify(control)}).click();
  })`);
  const readAdapterGap = () => js(`(async () => {
    await Promise.all(document.querySelector('#editor').getAnimations().map(animation => animation.finished));
    const button = document.querySelector('#fields [data-action="install-adapter"]');
    const hint = button.parentElement.previousElementSibling, body = document.querySelector('.dialog-body');
    const rect = button.getBoundingClientRect(), hintRect = hint.getBoundingClientRect(), bodyRect = body.getBoundingClientRect();
    return { width: innerWidth, gap: rect.top - hintRect.bottom, visible: rect.width > 0 && rect.height > 0,
      insideDialog: rect.left >= bodyRect.left && rect.right <= bodyRect.right };
  })()`);
  const open = async () => {
    await js(`document.querySelector('#dismiss-message').click(); document.querySelector('#content [data-action="subscription"]').click()`);
    await waitFor(`document.querySelector('#editor').open && document.querySelector('#f-agent')`);
  };
  const chooseSubscription = id => js(`(() => {
    const select = document.querySelector('#f-agent'); select.value = ${JSON.stringify(id)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const chooseCursor = () => chooseSubscription('cursor');
  const install = async () => {
    await js(`document.querySelector('#fields [data-action="install-adapter"]').click()`);
    await waitFor(`!document.querySelector('#message').hidden`);
  };
  const screenshots = [];
  const capture = async name => {
    if (!process.env.WHALEBRIDGE_QA_SCREENSHOTS) return;
    const directory = path.resolve(process.env.WHALEBRIDGE_QA_SCREENSHOTS);
    fs.mkdirSync(directory, { recursive: true });
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error(`hidden renderer capture is empty: ${name}`);
    const file = path.join(directory, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    screenshots.push({ file, ...image.getSize() });
  };

  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await waitFor(`document.querySelector('#content').getAttribute('aria-busy') === 'false'`);
    await open();
    const initial = await read();
    await chooseCursor();
    const beforeInstall = await read();
    const desktopAdapterGap = await readAdapterGap();
    win.setContentSize(420, 760);
    await waitFor(`innerWidth === 420`);
    const narrowAdapterGap = await readAdapterGap();
    win.setContentSize(1120, 760);
    await waitFor(`innerWidth === 1120`);
    await install();
    const installedForm = await read();
    await js(`document.querySelector('#save').click()`);
    const immediateSuccess = await waitForSuccess();
    const signin = calls.find(call => call.path === '/api/signin')?.body;
    await closeEditor();

    scenario = 'migrated'; installed = false;
    await open(); await chooseCursor(); await install();
    const migrated = await read();
    await closeEditor();

    scenario = 'failure'; installed = false;
    await open();
    const failureDefault = (await read()).selected;
    await chooseCursor();
    const previousCatalogs = catalogs.length;
    await js(`document.querySelector('#fields [data-action="install-adapter"]').click()`);
    await waitFor(`!document.querySelector('#form-error').hidden && !document.querySelector('#fields [data-action="install-adapter"]').disabled`);
    const failed = await read(), failureRefreshes = catalogs.length - previousCatalogs;
    await closeEditor();

    scenario = 'normal'; installed = true;
    await js(`document.querySelector('[data-tab="providers"]').click(); document.querySelector('#content [data-action="accounts"][data-id="cursor"]').click()`);
    await waitFor(`document.querySelector('#editor').open && document.querySelector('#fields [data-action="add-account"]')`);
    await js(`document.querySelector('#fields [data-action="add-account"]').click()`);
    await waitFor(`document.querySelector('#f-agent') && !document.querySelector('#save').hidden`);
    const addAccount = await read();
    await closeEditor();

    scenario = 'prompts';
    await open();
    await js(`(() => {
      const select = document.querySelector('#f-agent'); select.value = 'cursor-plugin';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#save').click();
    })()`);
    await waitFor(`document.querySelector('input#f-answer') && !document.querySelector('#save').disabled`);
    await js(`document.querySelector('#f-answer').value = 'invalid'; document.querySelector('#save').click()`);
    await waitFor(`!document.querySelector('#form-error').hidden && !document.querySelector('#save').disabled`);
    const promptValidationError = (await read()).error;
    await js(`document.querySelector('#f-answer').value = 'fixture-tenant'; document.querySelector('#save').click()`);
    await waitFor(`document.querySelector('select#f-answer') && !document.querySelector('#save').disabled`);
    await js(`document.querySelector('#f-answer').value = 'eu'; document.querySelector('#save').click()`);
    const promptSuccess = await waitForSuccess();
    const promptSignin = calls.find(call => call.scenario === 'prompts' && call.path === '/api/signin')?.body;
    await closeEditor();

    scenario = 'api-provider';
    await js(`document.querySelector('#content [data-action="add-provider"]').click()`);
    await waitFor(`document.querySelector('#editor').open && document.querySelector('#f-name')`);
    await js(`(() => {
      document.querySelector('#f-name').value = 'Fixture API';
      document.querySelector('#f-key').value = 'fixture-api-key';
      document.querySelector('#f-chat').value = 'https://fixture.example/v1';
      document.querySelector('#f-models').value = 'fixture-model';
      document.querySelector('#save').click();
    })()`);
    const providerSuccess = await waitForSuccess();
    await closeEditor('#save');
    await waitFor(`!document.querySelector('#editor').open && document.querySelector('[data-tab="providers"]').getAttribute('aria-current') === 'page'`);
    const providerCompletion = await js(`({
      names: [...document.querySelectorAll('.source-identity strong')].map(element => element.textContent),
      selectedTab: document.querySelector('[data-tab][aria-current="page"]').dataset.tab,
    })`);
    providerCompletion.writes = calls.filter(call => call.path === '/api/provider').length;

    const polled = [];
    for (const [next, agent] of [['polled-success', 'claude'], ['polled-renewed', 'codex']]) {
      scenario = next;
      await open(); await chooseSubscription(agent);
      const refreshesBefore = calls.filter(call => call.path === '/api/state').length;
      await js(`document.querySelector('#save').click()`);
      await waitFor(`document.querySelector('#save').hidden && !document.querySelector('#f-agent')`);
      const success = await waitForSuccess();
      await closeEditor();
      polled.push({ scenario, success, polls: flows.get(`${scenario}-flow`).polls,
        refreshes: calls.filter(call => call.path === '/api/state').length - refreshesBefore });
    }

    const unsuccessful = [];
    for (const next of ['signin-failed', 'signin-canceled']) {
      scenario = next;
      await open(); await chooseSubscription('claude');
      await js(`document.querySelector('#save').click()`);
      await waitFor(`!document.querySelector('#form-error').hidden`);
      unsuccessful.push({ scenario, ...(await readSuccess()) });
      await closeEditor();
    }

    scenario = 'signin-pending-cancel';
    await open(); await chooseSubscription('claude');
    await js(`document.querySelector('#save').click()`);
    await waitFor(`document.querySelector('#save').hidden && !document.querySelector('#f-agent')`);
    await closeEditor();
    const cancelDeadline = Date.now() + 5000;
    while (!calls.some(call => call.path === '/api/signin/signin-pending-cancel-flow/cancel')) {
      if (Date.now() > cancelDeadline) throw new Error('closing an unfinished sign-in did not cancel it');
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Layout scenarios use the same production surface and only fixture reads.
    scenario = 'layout'; installed = true;
    await js(`load()`);
    await js(`window.layoutQA = {
      phase: 'initial',
      bounded: async (promise, stage) => {
        let timer;
        try {
          return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('layout stage did not settle: ' + stage)), 4000);
          })]);
        } finally { clearTimeout(timer); }
      },
      settle: async () => {
        for (const dialog of document.querySelectorAll('dialog')) {
          if (!dialog.open) continue;
          await layoutQA.bounded(Promise.all(dialog.getAnimations().map(animation => animation.finished)), layoutQA.phase + ' animation');
        }
      },
      close: (selector = '#editor', control = '#cancel-editor') => layoutQA.bounded(new Promise(resolve => {
        document.querySelector(selector).addEventListener('close', () => resolve(), { once: true });
        document.querySelector(control).click();
      }), layoutQA.phase + ' close'),
      gap: (before, after) => Math.round((document.querySelector(after).getBoundingClientRect().top - document.querySelector(before).getBoundingClientRect().bottom) * 1000) / 1000,
      clippedRect: element => {
        const rect = element.getBoundingClientRect(); let left = rect.left, right = rect.right;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) {
            const bound = parent.getBoundingClientRect(); left = Math.max(left, bound.left); right = Math.min(right, bound.right);
          }
        }
        return { ...rect.toJSON(), left, right, width: Math.max(0, right - left) };
      },
      advancedGap: () => {
        const body = document.querySelector('#fields .advanced-body');
        return body.querySelector('label').getBoundingClientRect().top - body.getBoundingClientRect().top - parseFloat(getComputedStyle(body).borderTopWidth);
      },
      dialog: (selector = '#editor') => {
        const dialog = document.querySelector(selector), body = dialog.querySelector('.dialog-body');
        body.scrollTop = body.scrollHeight;
        const bounds = dialog.getBoundingClientRect(), bodyRect = body.getBoundingClientRect();
        const buttons = [...dialog.querySelectorAll('.dialog-head button,.dialog-actions button')].filter(button => !button.hidden);
        const inside = rect => rect.width > 0 && rect.height > 0 && rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
        return { open: dialog.open, width: innerWidth, height: innerHeight, bodyOverflowX: body.scrollWidth - body.clientWidth,
          bodyScrollable: body.scrollHeight > body.clientHeight, scrollTop: body.scrollTop,
          buttons: buttons.map(button => ({ text: button.textContent.trim() || button.getAttribute('aria-label'),
            visibleInside: inside(button.getBoundingClientRect()) })),
          fieldsInside: [...body.querySelectorAll('input,select,textarea')].filter(field => field.getClientRects().length).every(field => {
            const rect = field.getBoundingClientRect(), table = field.closest('.management-table-wrap');
            if (table) {
              const bound = table.getBoundingClientRect();
              return rect.width <= table.clientWidth && bound.left >= bodyRect.left - 1 && bound.right <= bodyRect.right + 1;
            }
            return rect.left >= bodyRect.left - 1 && rect.right <= bodyRect.right + 1;
          }),
          dialogInsideViewport: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
        };
      },
      page: () => {
        const root = document.documentElement, main = document.querySelector('#main'), content = document.querySelector('#content');
        return { width: innerWidth, documentOverflowX: root.scrollWidth - root.clientWidth,
          bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
          mainOverflowX: main.scrollWidth - main.clientWidth, contentOverflowX: content.scrollWidth - content.clientWidth,
          overflowingElements: [...document.querySelectorAll('#content *, .sidebar *')].filter(element => {
            const rect = layoutQA.clippedRect(element);
            return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
          }).slice(0, 8).map(element => ({ tag: element.tagName, className: element.className,
            text: element.textContent.slice(0, 80), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })),
        };
      },
    }; true`);
    const layout = { pages: [], subscriptions: [], callbacks: [], accounts: [], keys: [], providers: [], routes: [], successes: [], confirmations: [] };
    for (const scheme of ['dark', 'light']) {
      for (const width of [1120, 820, 600, 420, 380]) {
        win.setContentSize(width, 760);
        await waitFor(`innerWidth === ${width}`);
        const label = `${scheme}-${width}`;
        process.stderr.write(`layout start ${label}\n`);
        const inspectDialogs = width === 1120 || width === 420;
        const first = await js(`(async () => {
          layoutQA.phase = 'pages';
          document.documentElement.toggleAttribute('data-ds-dark-theme', ${scheme === 'dark'});
          const pages = [];
          for (const page of ['overview', 'providers', 'models', 'routing', 'help']) {
            await go(page); pages.push({ page, ...layoutQA.page() });
          }
          if (!${inspectDialogs}) return { pages };
          layoutQA.phase = 'subscription'; await go('providers'); await openSubscription();
          document.querySelector('#f-agent').value = 'cursor-plugin';
          document.querySelector('#f-agent').dispatchEvent(new Event('change', { bubbles: true }));
          await layoutQA.settle();
          const methodGap = layoutQA.gap('#f-agent', 'label[for="f-method"]');
          document.querySelector('#f-method').value = '1';
          document.querySelector('#f-method').dispatchEvent(new Event('change', { bubbles: true }));
          return { pages, subscription: { methodGap, keyGap: layoutQA.gap('#f-method', 'label[for="f-key"]'), dialog: layoutQA.dialog() } };
        })()`, 15000);
        layout.pages.push(...first.pages.map(row => ({ scheme, ...row })));
        if (!inspectDialogs) { process.stderr.write(`layout complete ${label}\n`); continue; }
        layout.subscriptions.push({ scheme, ...first.subscription });
        if (width === 1120 || width === 420) await capture(`${label}-subscription`);
        const middle = await js(`(async () => {
          layoutQA.phase = 'callback';
          showLogin({ state: 'waiting', instructions: 'Fixture authorization instructions',
            url: 'https://fixture.example/authorize', code: 'FIXTURE-CODE', pasteCallback: true });
          const rows = [...document.querySelector('.login-progress').children];
          const callback = { callbackGap: layoutQA.gap('#f-callback', '[data-action="signin-callback"]'),
            progressGaps: rows.slice(1).map((row, index) => row.getBoundingClientRect().top - rows[index].getBoundingClientRect().bottom),
            dialog: layoutQA.dialog() };
          layoutQA.phase = 'callback close'; await layoutQA.close();
          layoutQA.phase = 'account open'; await layoutQA.bounded(openAccounts('cursor'), layoutQA.phase);
          layoutQA.phase = 'account settle'; await layoutQA.settle();
          const account = { actionGap: layoutQA.gap('#fields .toolbar', '#fields .form-hint'),
            rowCount: document.querySelectorAll('#fields .management-table tbody tr').length, dialog: layoutQA.dialog() };
          layoutQA.phase = 'account close'; await layoutQA.close();
          layoutQA.phase = 'keys open'; await layoutQA.bounded(openKeys('fixture-api'), layoutQA.phase);
          layoutQA.phase = 'keys settle'; await layoutQA.settle();
          const keysTable = layoutQA.dialog(); activateEditorSection('new-key');
          const key = { nameGap: layoutQA.gap('#fields [data-section="new-key"] h3', 'label[for="f-name"]'), table: keysTable, dialog: layoutQA.dialog() };
          layoutQA.phase = 'keys close'; await layoutQA.close();
          layoutQA.phase = 'provider open'; openProvider();
          document.querySelector('#f-preset').value = 'layout-preset';
          document.querySelector('#f-preset').dispatchEvent(new Event('change', { bubbles: true }));
          activateEditorSection('network');
          document.querySelector('#f-proxyMode').value = 'custom';
          document.querySelector('#f-proxyMode').dispatchEvent(new Event('change', { bubbles: true }));
          layoutQA.phase = 'provider settle'; await layoutQA.settle();
          const proxyGap = layoutQA.gap('#f-proxyMode', 'label[for="f-proxy"]'); activateEditorSection('connection');
          const regionGap = layoutQA.gap('.credential-tools', 'label[for="f-region"]'), workspaceGap = layoutQA.gap('#f-region', 'label[for="f-workspace"]');
          const sections = [...document.querySelectorAll('#editor-nav [data-section-target]')].map(button => { activateEditorSection(button.dataset.sectionTarget); return { id: button.dataset.sectionTarget, dialog: layoutQA.dialog() }; });
          activateEditorSection('limits');
          const provider = { regionGap, workspaceGap, proxyGap, sections, dialog: layoutQA.dialog() };
          layoutQA.phase = 'provider done'; return { callback, account, key, provider };
        })()`, 15000).catch(async error => { throw new Error(`${error.message}\nphase: ${await js('layoutQA.phase')}`); });
        layout.callbacks.push({ scheme, ...middle.callback });
        layout.accounts.push({ scheme, ...middle.account });
        layout.keys.push({ scheme, ...middle.key });
        layout.providers.push({ scheme, ...middle.provider });
        if (width === 1120 || width === 420) await capture(`${label}-provider`);
        const route = await js(`(async () => {
          await layoutQA.close(); await go('routing'); openGroup();
          document.querySelector('#fields details.advanced').open = true; await layoutQA.settle();
          const gridGap = layoutQA.gap('[data-section="members"] .editor-section-head', '[data-section="members"] .form-grid');
          const advancedGap = layoutQA.advancedGap(), sections = [...document.querySelectorAll('#editor-nav [data-section-target]')].map(button => { activateEditorSection(button.dataset.sectionTarget); return { id: button.dataset.sectionTarget, dialog: layoutQA.dialog() }; });
          activateEditorSection('members'); return { gridGap, advancedGap, sections, dialog: layoutQA.dialog() };
        })()`, 10000);
        layout.routes.push({ scheme, ...route });
        if (width === 1120 || width === 420) await capture(`${label}-route`);
        const successDialog = await js(`(async () => {
          await layoutQA.close(); await openSubscription();
          await showConnectionSuccess('\u8ba2\u9605\u8d26\u53f7\u63a5\u5165\u6210\u529f',
            'Cursor \u8ba2\u9605\u8d26\u53f7\u5df2\u6dfb\u52a0\uff0c\u6a21\u578b\u5df2\u540c\u6b65\u5230\u9cb8\u5c7f\u3002',
            { name: 'Cursor', kind: '\u8ba2\u9605\u8d26\u53f7', user: 'fixture.long.account.identity@example.test' });
          await layoutQA.settle(); return layoutQA.dialog();
        })()`, 10000);
        const success = await readSuccess();
        if (width === 1120 || width === 420) await capture(`${label}-success`);
        layout.successes.push({ scheme, success, dialog: successDialog });
        const confirmation = await js(`(async () => {
          await layoutQA.close();
          void ask('Fixture key weight', 'A positive weight determines how often this key is chosen.', 'Save fixture weight', 2);
          await layoutQA.settle();
          const confirmation = { fieldGap: layoutQA.gap('#confirm-body', 'label[for="f-weight"]'), dialog: layoutQA.dialog('#confirmation') };
          await layoutQA.close('#confirmation', '#cancel-confirm'); return confirmation;
        })()`, 10000);
        layout.confirmations.push({ scheme, ...confirmation });
        process.stderr.write(`layout complete ${label}\n`);
      }
    }
    layout.windowVisible = win.isVisible();
    layout.windowFocused = win.isFocused();

    return { initial, beforeInstall, installed: installedForm, signin, migrated, failureDefault, failed, failureRefreshes, addAccount, catalogs,
      promptValidationError, promptSignin, immediateSuccess, promptSuccess, providerSuccess, providerCompletion,
      desktopAdapterGap, narrowAdapterGap, polled, unsuccessful, layout, screenshots,
      installs: calls.filter(call => call.path === '/api/subscription/adapter'),
      prompts: calls.filter(call => call.path === '/api/subscription/prompt'),
      cancellations: calls.filter(call => call.path.endsWith('/cancel')),
    };
  } finally {
    win.destroy();
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

run().then(result => {
  process.stdout.write('WHALEBRIDGE_ACCOUNTS_RESULT:' + JSON.stringify(result) + '\n', () => app.exit(0));
}).catch(error => {
  process.stderr.write(String(error.stack) + '\n', () => app.exit(1));
});
