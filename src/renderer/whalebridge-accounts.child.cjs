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
        version: 'fixture', gateway: 'http://127.0.0.1', presets: [], hidden: [], groups: [], providers,
        models: providers.flatMap(provider => (provider.models || []).map(id => ({ id: `${provider.id}/${id}` }))),
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
      if (pathname === '/api/accounts/cursor') return json([]);
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
  const js = source => win.webContents.executeJavaScript(source);
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
    const rect = success?.getBoundingClientRect();
    return { open: get('#editor').open, title: get('#editor-title').textContent,
      visible: !!rect && rect.width > 0 && rect.height > 0,
      detail: success?.querySelector('p').textContent || '', instruction: success?.querySelector('.muted').textContent || '',
      primary: get('#save').textContent, primaryHidden: get('#save').hidden, primaryDisabled: get('#save').disabled,
      completion: get('#cancel-editor').textContent, fieldCount: get('#fields').querySelectorAll('input,select,textarea').length,
      error: get('#form-error').hidden ? '' : get('#form-error').textContent };
  })()`);
  const waitForSuccess = async () => {
    await waitFor(`document.querySelector('.connection-success') && !document.querySelector('#refresh').disabled`);
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
      names: [...document.querySelectorAll('.provider-card .title')].map(element => element.textContent),
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

    return { initial, beforeInstall, installed: installedForm, signin, migrated, failureDefault, failed, failureRefreshes, addAccount, catalogs,
      promptValidationError, promptSignin, immediateSuccess, promptSuccess, providerSuccess, providerCompletion,
      desktopAdapterGap, narrowAdapterGap, polled, unsuccessful,
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
