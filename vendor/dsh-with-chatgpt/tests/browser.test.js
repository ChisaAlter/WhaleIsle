import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChatGPTBrowser, discoverBrowserExecutable } from '../lib/browser.js';

const signal = () => new AbortController().signal;

function liveAgent(id, registry) {
  const cleanups = [];
  const agent = { id, session: { header: { cwd: os.tmpdir() } }, ctx: {
    get: name => name === 'agents' ? registry : undefined,
    effect(create) {
      const close = create();
      let pending;
      const dispose = () => pending ??= Promise.resolve().then(close);
      cleanups.push(dispose);
      return dispose;
    },
  } };
  registry.set(id, agent);
  agent.dispose = async () => { for (const close of cleanups) await close(); registry.delete(id); };
  return agent;
}

test('rejects main Chrome profile, invalid bridge origins, and unrelated navigation without starting a browser', async () => {
  const profile = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  if (process.platform === 'win32') assert.throws(() => new ChatGPTBrowser({ profileDir: profile }), /main Chrome/);
  const registry = new Map();
  const browser = new ChatGPTBrowser({ profileDir: path.join(os.tmpdir(), 'dsh-chatgpt-validation') });
  const agent = liveAgent('unstarted', registry);
  browser.setBridgeOrigin('https://trusted-bridge.example', agent);
  assert.throws(() => browser.setBridgeOrigin('http://external.example', agent), /HTTPS origin/);
  assert.throws(() => browser.setBridgeOrigin('https://trusted-bridge.example/oauth/authorize', agent), /origin/);
  await assert.rejects(browser.run(agent, { action: 'navigate', url: 'https://example.com' }, signal()), /restricted/);
  await assert.rejects(browser.run(agent, { action: 'navigate', url: 'https://trusted-bridge.example/oauth/token' }, signal()), /restricted/);
  assert.equal(browser.owner, undefined);
  assert.deepEqual(await browser.run(agent, { action: 'close' }, signal()), { closed: false });
  await browser.dispose();
});

test('managed browser operations use isolated targets, exact Session ownership, persistent login and allowed popups', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-chatgpt-browser-'));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<title>Local pairing</title><form method="POST" action="/oauth/authorize"><input type="hidden" name="request_id" value="SECRET-HIDDEN"><input id="pairing_code" name="pairing_code" autocomplete="one-time-code"><input id="other" aria-label="Unexpected token"><button>Connect</button></form><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.body.append('Connected locally')}</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = new ChatGPTBrowser({ profileDir: path.join(root, 'profile'), executablePath: discoverBrowserExecutable(), headless: true });
  const registry = new Map();
  const owner = liveAgent('owner', registry);
  const stranger = liveAgent('stranger', registry);
  browser.setBridgeOrigin(origin, owner);
  t.after(async () => { await browser.dispose(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await t.test('pairing input is the only bridge-editable value and tokens stay private', async () => {
    const state = await browser.run(owner, { action: 'navigate', url: `${origin}/oauth/authorize?code=SECRET-CALLBACK` }, signal());
    assert.match(state.title, /Local pairing/);
    assert.doesNotMatch(JSON.stringify(state), /SECRET-HIDDEN|SECRET-CALLBACK/);
    const code = state.targets.find(target => target.pairing);
    assert.ok(code);
    await assert.rejects(browser.run(owner, { action: 'fill', target: code.id, text: 'oauth-access-token' }, signal()), /short local pairing/);
    const filled = await browser.run(owner, { action: 'fill', target: code.id, text: 'ABCD-EFGH' }, signal());
    assert.doesNotMatch(JSON.stringify(filled), /ABCD-EFGH/);
    await browser.run(owner, { action: 'press', target: filled.targets.find(target => target.pairing).id, key: 'Enter' }, signal());
    assert.match((await browser.run(owner, { action: 'snapshot' }, signal())).body, /Connected locally/);
  });

  await t.test('other exact Agents cannot acquire or mutate the owned origin', async () => {
    await assert.rejects(browser.run(stranger, { action: 'snapshot' }, signal()), /another DSH Session/);
    assert.throws(() => browser.setBridgeOrigin('https://other-bridge.example', stranger), /another DSH Session/);
    const stale = { ...owner };
    await assert.rejects(browser.run(stale, { action: 'snapshot' }, signal()), /no longer active/);
  });

  const style = '<style>nav{position:fixed;left:0;top:0;width:200px}nav a{display:block;height:7px;font-size:7px}main{margin-left:220px}[data-message-author-role]{white-space:pre-wrap}[role="dialog"]{position:fixed;top:20px;left:230px;width:900px;height:230px;background:white}[role="dialog"] input,[role="dialog"] textarea{display:block}form.composer{position:fixed;bottom:20px;right:20px;width:500px;background:white}#prompt-textarea{height:40px;border:1px solid}a.authlink{position:fixed;left:230px;top:320px}a.outside{top:345px}</style>';
  const sidebar = `<nav>${Array.from({ length: 100 }, (_, index) => `<a href="https://chatgpt.com/c/sidebar-${index}">Sidebar ${index}</a>`).join('')}</nav>`;
  const html = `<title>Local ChatGPT fixture</title>${style}${sidebar}<main><div role="dialog"><input aria-label="Connector name"><textarea aria-label="Connector description"></textarea><input aria-label="Server URL"><input type="password" aria-label="Password" value="SECRET-PASSWORD"><input aria-label="Client secret" value="SECRET-CLIENT"><input type="checkbox" aria-label="Accept risk"><button onclick="document.body.append('Clicked fixture')">Create</button></div><div>${'old-history '.repeat(2200)}</div><div data-message-author-role="assistant">LATEST-REVIEW ready</div><form class="composer"><div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Message"></div><button aria-label="Send message">Send</button></form><a class="authlink" href="${origin}/oauth/authorize" target="_blank">Authorize connector</a><a class="authlink outside" href="https://example.com" target="_blank">Outside link</a></main>`;
  const longReply = `D2C/1 TASK_ID=long-task ITERATION=2 PLAN\n${'Plan rationale '.repeat(650)}MIDDLE-PLAN-INSTRUCTION\n${'Implementation section '.repeat(600)}LATEST-PLAN-END`;
  const longHtml = `<title>Local long reply</title>${style}${sidebar}<main><div data-message-author-role="assistant">${longReply}</div><form class="composer"><div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Message"></div><button aria-label="Send message">Send</button></form></main>`;
  // The real browser renders local fixture bytes; it never requests ChatGPT or OpenAI.
  await browser.owner.context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/long-reply') ? longHtml : html }));
  await browser.owner.context.route('https://auth.openai.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Local auth</title><input aria-label="Email"><button>Continue</button>' }));
  let page = await browser.run(owner, { action: 'navigate', url: 'https://chatgpt.com/plugins' }, signal());

  await t.test('snapshots retain latest long-chat replies and omit credential values', async () => {
    assert.match(page.body, /LATEST-REVIEW/);
    assert.match(page.snapshot, /LATEST-REVIEW/);
    assert.ok(page.body.length < 12_000);
    assert.doesNotMatch(JSON.stringify(page), /SECRET-PASSWORD|SECRET-CLIENT/);
    assert.deepEqual(page.recentMessages, [{ role: 'assistant', text: 'LATEST-REVIEW ready' }]);
    assert.ok(page.targets.some(target => target.composer), 'Composer remains available despite 100 visible sidebar links.');
    assert.ok(page.targets.some(target => target.label === 'Send message'), 'The composer submit control outranks sidebar links.');
  });

  await t.test('long PLAN replies keep protocol headers and support full pagination including the middle', async () => {
    const preview = await browser.run(owner, { action: 'navigate', url: 'https://chatgpt.com/long-reply' }, signal());
    assert.match(preview.body, /D2C\/1 TASK_ID=long-task ITERATION=2 PLAN/);
    assert.match(preview.body, /LATEST-PLAN-END/);
    assert.equal(preview.recentMessages[0].truncated, true);
    let collected = '';
    let offset = 0;
    do {
      const part = await browser.run(owner, { action: 'read_reply', offset, length: 6000 }, signal());
      assert.equal(part.totalLength, longReply.length);
      collected += part.text;
      offset = part.nextOffset;
    } while (offset !== null);
    assert.equal(collected, longReply);
    assert.match(collected, /MIDDLE-PLAN-INSTRUCTION/);
    await assert.rejects(browser.run(owner, { action: 'read_reply', offset: -1 }, signal()), /nonnegative/);
    page = await browser.run(owner, { action: 'navigate', url: 'https://chatgpt.com/plugins' }, signal());
  });

  await t.test('refs permit setup fields but reject arbitrary selectors, secrets and oversized control messages', async () => {
    const name = page.targets.find(target => target.label === 'Connector name');
    await assert.rejects(browser.run(owner, { action: 'fill', target: '#name', text: 'No selectors' }, signal()), /exact target id/);
    page = await browser.run(owner, { action: 'fill', target: name.id, text: 'DSH connection' }, signal());
    assert.equal(page.targets.find(target => target.label === 'Connector name').value, 'DSH connection');
    await assert.rejects(browser.run(owner, { action: 'fill', target: name.id, text: 'stale' }, signal()), /stale/);
    await assert.rejects(browser.run(owner, { action: 'fill', target: page.targets.find(target => target.type === 'password').id, text: 'do not type' }, signal()), /user-only/);
    await assert.rejects(browser.run(owner, { action: 'fill', target: page.targets.find(target => target.composer).id, text: 'x'.repeat(1025) }, signal()), /1 KiB/);
    page = await browser.run(owner, { action: 'fill', target: page.targets.find(target => target.label === 'Connector description').id, text: 'd'.repeat(1500) }, signal());
    const accepted = page.targets.find(target => target.label === 'Accept risk');
    page = await browser.run(owner, { action: 'click', target: accepted.id }, signal());
    assert.equal(page.targets.find(target => target.label === 'Accept risk').checked, true);
  });

  await t.test('pending cancellation performs no action and unsupported links are rejected', async () => {
    const controller = new AbortController();
    controller.abort(new Error('canceled queued call'));
    await assert.rejects(browser.run(owner, { action: 'click', target: page.targets.find(target => target.label === 'Create').id }, controller.signal), /canceled queued/);
    const current = await browser.run(owner, { action: 'snapshot' }, signal());
    assert.doesNotMatch(current.body, /Clicked fixture/);
    await assert.rejects(browser.run(owner, { action: 'click', target: current.targets.find(target => target.label === 'Outside link').id }, signal()), /leaves/);
  });

  await t.test('approved authorization popups become active and unknown navigation is intercepted', async () => {
    const current = await browser.run(owner, { action: 'snapshot' }, signal());
    const popup = browser.owner.context.waitForEvent('page');
    await browser.run(owner, { action: 'click', target: current.targets.find(target => target.label === 'Authorize connector').id }, signal());
    await (await popup).waitForLoadState('domcontentloaded');
    const active = await browser.run(owner, { action: 'snapshot' }, signal());
    assert.equal(new URL(active.url).origin, origin);
    assert.match(active.body, /Connect/);
    const rejectedPage = browser.owner.page;
    const closed = rejectedPage.waitForEvent('close');
    await assert.rejects(rejectedPage.goto('https://outside.invalid'), /ERR_BLOCKED_BY_CLIENT|net::/);
    await closed;
    assert.match(browser.owner.blocked, /outside\.invalid|chrome-error/);
  });

  await t.test('official auth stays user-only and browser close keeps dedicated cookies', async () => {
    const auth = await browser.run(owner, { action: 'navigate', url: 'https://auth.openai.com/login' }, signal());
    await assert.rejects(browser.run(owner, { action: 'click', target: auth.targets.find(target => target.label === 'Continue').id }, signal()), /user-only/);
    await browser.owner.context.addCookies([{ name: 'fixture-session', value: 'retained', domain: 'chatgpt.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600, secure: true }]);
    assert.deepEqual(await browser.run(owner, { action: 'close' }, signal()), { closed: true });
    assert.equal(browser.owner, undefined);
    browser.setBridgeOrigin(origin, stranger);
    await browser.run(stranger, { action: 'snapshot' }, signal());
    assert.equal((await browser.owner.context.cookies('https://chatgpt.com')).find(cookie => cookie.name === 'fixture-session').value, 'retained');
    await stranger.dispose();
    assert.equal(browser.owner, undefined);
  });
});

test('observed Google and Apple identity paths are user-only while snapshots show login progress', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-chatgpt-login-'));
  const browser = new ChatGPTBrowser({ profileDir: path.join(root, 'profile'), executablePath: discoverBrowserExecutable(), headless: true });
  const registry = new Map();
  const owner = liveAgent('login-owner', registry);
  t.after(async () => { await browser.dispose(); await rm(root, { recursive: true, force: true }); });
  await browser.run(owner, { action: 'snapshot' }, signal());
  const html = '<title>Local login choice</title><button>Continue with Google</button><button>Continue with Apple</button><input aria-label="Account identifier" value="PRIVATE-LOGIN-FIELD"><button>Continue</button><p>Login waits for the user.</p>';
  for (const origin of ['https://chatgpt.com', 'https://accounts.google.com', 'https://appleid.apple.com', 'https://auth.openai.com']) {
    await browser.owner.context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: html }));
  }
  for (const url of ['https://chatgpt.com/auth/login', 'https://accounts.google.com/signin', 'https://appleid.apple.com/auth/authorize', 'https://auth.openai.com/login']) {
    const state = await browser.run(owner, { action: 'navigate', url }, signal());
    assert.equal(state.url, url);
    assert.match(state.body, /waits for the user/);
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE-LOGIN-FIELD/);
    assert.ok(state.targets.length >= 4);
    assert.ok(state.targets.every(target => target.userOnly));
    const button = state.targets.find(target => target.role === 'button');
    const input = state.targets.find(target => target.editable);
    await assert.rejects(browser.run(owner, { action: 'click', target: button.id }, signal()), /user-only/);
    await assert.rejects(browser.run(owner, { action: 'fill', target: input.id, text: 'human credentials' }, signal()), /user-only/);
    await assert.rejects(browser.run(owner, { action: 'press', target: button.id, key: 'Enter' }, signal()), /user-only/);
  }
  const challenge = await browser.run(owner, { action: 'navigate', url: 'https://chatgpt.com/auth/login?__cf_chl_rt_tk=PRIVATE-CHALLENGE' }, signal());
  assert.doesNotMatch(JSON.stringify(challenge), /PRIVATE-CHALLENGE/);
  assert.equal(new URL(challenge.url).searchParams.get('__cf_chl_rt_tk'), '[redacted]');
  await assert.rejects(browser.run(owner, { action: 'navigate', url: 'https://login.microsoftonline.com' }, signal()), /restricted/);
});
