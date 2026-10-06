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
        version: 'fixture', gateway: 'http://127.0.0.1', models: [], hidden: [], groups: [],
        providers: [{ id: 'cursor', name: 'Cursor', account: true, modelCount: 0 }],
      });
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
      if (pathname === '/api/subscription/prompt') return json(null);
      if (pathname === '/api/signin') return json({ state: 'done' });
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
    throw new Error(`DOM did not settle: ${expression}`);
  };
  const read = () => js(`(() => {
    const get = selector => document.querySelector(selector);
    const button = get('#fields [data-action="install-adapter"]');
    return { selected: get('#f-agent')?.value, methods: [...(get('#f-method')?.options || [])].map(option => option.textContent),
      hasAdapterButton: !!button, adapterDisabled: button?.disabled,
      error: get('#form-error').hidden ? '' : get('#form-error').textContent };
  })()`);
  const open = async () => {
    await js(`document.querySelector('#dismiss-message').click(); document.querySelector('#content [data-action="subscription"]').click()`);
    await waitFor(`document.querySelector('#editor').open && document.querySelector('#f-agent')`);
  };
  const chooseCursor = () => js(`(() => {
    const select = document.querySelector('#f-agent'); select.value = 'cursor';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
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
    await install();
    const installedForm = await read();
    await js(`document.querySelector('#save').click()`);
    await waitFor(`!document.querySelector('#editor').open && !document.querySelector('#save').disabled`);
    const signin = calls.find(call => call.path === '/api/signin')?.body;

    scenario = 'migrated'; installed = false;
    await open(); await chooseCursor(); await install();
    const migrated = await read();
    await js(`document.querySelector('#cancel-editor').click()`);

    scenario = 'failure'; installed = false;
    await open();
    const failureDefault = (await read()).selected;
    await chooseCursor();
    const previousCatalogs = catalogs.length;
    await js(`document.querySelector('#fields [data-action="install-adapter"]').click()`);
    await waitFor(`!document.querySelector('#form-error').hidden && !document.querySelector('#fields [data-action="install-adapter"]').disabled`);
    const failed = await read(), failureRefreshes = catalogs.length - previousCatalogs;
    await js(`document.querySelector('#cancel-editor').click()`);

    scenario = 'normal'; installed = true;
    await js(`document.querySelector('[data-tab="providers"]').click(); document.querySelector('#content [data-action="accounts"][data-id="cursor"]').click()`);
    await waitFor(`document.querySelector('#editor').open && document.querySelector('#fields [data-action="add-account"]')`);
    await js(`document.querySelector('#fields [data-action="add-account"]').click()`);
    await waitFor(`document.querySelector('#f-agent') && !document.querySelector('#save').hidden`);
    const addAccount = await read();

    return { initial, beforeInstall, installed: installedForm, signin, migrated, failureDefault, failed, failureRefreshes, addAccount, catalogs,
      installs: calls.filter(call => call.path === '/api/subscription/adapter'),
      prompts: calls.filter(call => call.path === '/api/subscription/prompt'),
    };
  } finally {
    win.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

run().then(result => {
  process.stdout.write('WHALEBRIDGE_ACCOUNTS_RESULT:' + JSON.stringify(result) + '\n', () => app.exit(0));
}).catch(error => {
  process.stderr.write(String(error.stack) + '\n', () => app.exit(1));
});
