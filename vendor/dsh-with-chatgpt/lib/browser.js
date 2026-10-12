import { statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const AUTH_ORIGINS = new Set(['https://auth.openai.com', 'https://accounts.google.com', 'https://appleid.apple.com']);
const PAGE_ORIGINS = new Set(['https://chatgpt.com', 'https://www.chatgpt.com', ...AUTH_ORIGINS]);
const TARGET_ATTRIBUTE = 'data-dsh-chatgpt-target';
const TARGET_ID = /^r[0-9a-f]{8}-\d{1,3}$/;
const KEYS = new Set(['Enter', 'Control+Enter', 'Meta+Enter', 'Tab', 'Shift+Tab', 'Escape', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete']);

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

export function discoverBrowserExecutable(configured) {
  if (configured !== undefined) {
    if (!path.isAbsolute(configured) || !isFile(configured)) throw new Error('browserExecutable must name an existing absolute Chrome or Edge executable.');
    return configured;
  }
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, process.env.CHROME_PATH, process.env.CHROME_BIN];
  if (process.platform === 'win32') {
    for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA, 'C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (root) candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const root of (process.env.PATH ?? '').split(path.delimiter)) {
      if (root) candidates.push(...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map(name => path.join(root, name)));
    }
  }
  candidates.push(chromium.executablePath());
  const found = candidates.find(candidate => candidate && path.isAbsolute(candidate) && isFile(candidate));
  if (!found) throw new Error('No installed Chrome or Edge found. Install one or configure browserExecutable; the plugin does not download a browser.');
  return found;
}

function validateProfile(profileDir) {
  if (typeof profileDir !== 'string' || !path.isAbsolute(profileDir)) throw new Error('ChatGPT browser requires its own absolute profile directory.');
  const resolved = path.resolve(profileDir);
  const mainProfiles = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data'), path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Edge', 'User Data')]
    : process.platform === 'darwin'
      ? [path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'), path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge')]
      : [path.join(os.homedir(), '.config', 'google-chrome'), path.join(os.homedir(), '.config', 'chromium'), path.join(os.homedir(), '.config', 'microsoft-edge')];
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  for (const main of mainProfiles) {
    const root = process.platform === 'win32' ? main.toLowerCase() : main;
    if (normalized === root || normalized.startsWith(`${root}${path.sep}`)) throw new Error('The ChatGPT browser cannot use the main Chrome or Edge profile.');
  }
  return resolved;
}

function trustedOrigin(value) {
  if (value === undefined || value === null) return undefined;
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('The trusted bridge origin must be an HTTPS origin or a loopback HTTP origin.');
  }
  return url.origin;
}

function canceled(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('ChatGPT browser action canceled.');
}

function displayUrl(value) {
  try {
    const url = new URL(value);
    for (const name of [...url.searchParams.keys()]) {
      if (/^(code|token|access_token|refresh_token|id_token|client_secret|password|__cf_chl_rt_tk)$/i.test(name)) url.searchParams.set(name, '[redacted]');
    }
    if (/access_token|refresh_token|id_token|code=/i.test(url.hash)) url.hash = '[redacted]';
    return url.href;
  } catch { return ''; }
}

function topNavigation(request) {
  if (!request.isNavigationRequest()) return false;
  // A popup's first navigation arrives before Playwright creates its Frame.
  try { return request.frame().parentFrame() === null; } catch { return true; }
}

function userLoginPage(value) {
  const url = new URL(value);
  return AUTH_ORIGINS.has(url.origin) || (['https://chatgpt.com', 'https://www.chatgpt.com'].includes(url.origin) && /^\/auth\/login(?:\/|$)/.test(url.pathname));
}

/** A single dedicated browser, acquired only by an explicit ChatGPT operation. */
export class ChatGPTBrowser {
  constructor({ profileDir, executablePath, headless = false }) {
    this.profileDir = validateProfile(profileDir);
    this.executablePath = executablePath;
    this.headless = headless;
    this.owner = undefined;
    this.tail = Promise.resolve();
    this.disposed = false;
    this.bridgeOrigins = new WeakMap();
    this.defaultBridgeOrigin = undefined;
  }

  assertOwner(agent) {
    if (this.disposed) throw new Error('ChatGPT browser plugin is disposed.');
    if (!agent || typeof agent.ctx?.effect !== 'function') throw new Error('ChatGPT browser requires a live DSH Agent.');
    const registry = agent.ctx.get?.('agents');
    if (registry?.get && registry.get(agent.id) !== agent) throw new Error('This DSH Agent is no longer active.');
    if (this.owner && this.owner.agent !== agent) throw new Error('The ChatGPT browser is owned by another DSH Session. Close it in that Session first.');
  }

  // This setter is Host-only: its origin is never a model-facing tool argument.
  setBridgeOrigin(origin, agent) {
    const parsed = trustedOrigin(origin);
    if (agent) {
      this.assertOwner(agent);
      this.bridgeOrigins.set(agent, parsed);
    } else {
      if (this.owner) throw new Error('Changing the trusted bridge origin requires the owning Agent.');
      this.defaultBridgeOrigin = parsed;
    }
  }

  run(agent, request, signal) {
    try { this.assertOwner(agent); canceled(signal); } catch (error) { return Promise.reject(error); }
    const operation = this.tail.then(() => this.perform(agent, request, signal));
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  async dispose() {
    this.disposed = true;
    const owner = this.owner;
    if (owner) await this.closeOwner(owner);
    await this.tail;
    if (owner?.cleanup) await owner.cleanup();
  }

  allowedUrl(value, owner, allowBlank = false) {
    if (allowBlank && value === 'about:blank') return true;
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      if (PAGE_ORIGINS.has(url.origin)) return true;
      return url.origin === (this.bridgeOrigins.get(owner.agent) ?? this.defaultBridgeOrigin) && url.pathname === '/oauth/authorize';
    } catch { return false; }
  }

  async acquire(agent) {
    this.assertOwner(agent);
    if (this.owner) return this.owner;
    const owner = { agent, context: undefined, page: undefined, pageLoads: new WeakMap(), targets: new Map(), blocked: undefined, ready: undefined, closing: undefined, cleanup: undefined };
    this.owner = owner;
    try {
      owner.cleanup = agent.ctx.effect(() => () => this.closeOwner(owner), 'dsh-with-chatgpt.browser-owner');
      owner.ready = (async () => {
        const executablePath = discoverBrowserExecutable(this.executablePath);
        await mkdir(this.profileDir, { recursive: true, mode: 0o700 });
        owner.context = await chromium.launchPersistentContext(this.profileDir, {
          executablePath, headless: this.headless, viewport: { width: 1280, height: 900 },
          serviceWorkers: 'block', acceptDownloads: false, timeout: 30_000,
        });
        owner.context.setDefaultTimeout(10_000);
        owner.context.setDefaultNavigationTimeout(30_000);
        await owner.context.route('**/*', async route => {
          const request = route.request();
          if (topNavigation(request) && !this.allowedUrl(request.url(), owner)) {
            owner.blocked = request.url();
            await route.abort('blockedbyclient');
          } else await route.continue();
        });
        owner.context.on('page', page => this.watchPage(owner, page));
        for (const page of owner.context.pages()) this.watchPage(owner, page);
        if (!owner.page) this.watchPage(owner, await owner.context.newPage());
      })();
      await owner.ready;
      if (owner.closing) throw new Error('ChatGPT browser closed during startup.');
      return owner;
    } catch (error) {
      await this.closeOwner(owner);
      if (owner.cleanup) await owner.cleanup();
      throw error;
    }
  }

  watchPage(owner, page) {
    if (page.url() === '') {
      owner.page = page;
      const loaded = page.waitForURL(url => url.href !== 'about:blank' && this.allowedUrl(url.href, owner), { waitUntil: 'domcontentloaded' });
      void loaded.catch(() => {});
      owner.pageLoads.set(page, loaded);
    } else if (this.allowedUrl(page.url(), owner, true)) owner.page = page;
    else { owner.blocked = page.url(); void page.close().catch(() => {}); }
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      owner.targets.clear();
      if (this.allowedUrl(frame.url(), owner, true)) owner.page = page;
      else { owner.blocked = frame.url(); void page.close().catch(() => {}); }
    });
    page.on('close', () => {
      owner.targets.clear();
      if (owner.page === page) owner.page = owner.context.pages().filter(other => !other.isClosed() && this.allowedUrl(other.url(), owner, true)).at(-1);
    });
  }

  async closeOwner(owner) {
    if (!owner.closing) owner.closing = (async () => {
      await owner.ready?.catch(() => {});
      if (owner.context) await owner.context.close();
      owner.targets.clear();
      if (this.owner === owner) this.owner = undefined;
    })();
    await owner.closing;
  }

  async perform(agent, request, signal) {
    this.assertOwner(agent);
    canceled(signal);
    if (!['navigate', 'snapshot', 'read_reply', 'click', 'fill', 'press', 'close'].includes(request.action)) throw new Error('Unknown ChatGPT browser action.');
    if (request.action === 'close') {
      const owner = this.owner;
      if (!owner) return { closed: false };
      await this.closeOwner(owner);
      if (owner.cleanup) await owner.cleanup();
      return { closed: true };
    }
    if (request.action === 'navigate') {
      const owner = this.owner ?? { agent };
      if (!this.allowedUrl(request.url, owner)) throw new Error('Navigation is restricted to ChatGPT, official OpenAI login, and this workspace bridge authorization page.');
    }
    const owner = await this.acquire(agent);
    const abort = () => { void this.closeOwner(owner).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      canceled(signal);
      const page = owner.page;
      if (!page || page.isClosed()) throw new Error('The dedicated ChatGPT page is closed. Close the browser tool and reconnect.');
      if (request.action === 'navigate') {
        owner.blocked = undefined;
        owner.targets.clear();
        await page.goto(request.url, { waitUntil: 'domcontentloaded' });
      } else if (request.action === 'read_reply') {
        const reply = await this.readReply(owner, request);
        canceled(signal);
        return reply;
      } else if (request.action !== 'snapshot') {
        if (!this.allowedUrl(page.url(), owner)) throw new Error('This page is outside the permitted ChatGPT connection.');
        const target = this.target(owner, page, request.target);
        const locator = page.locator(`[${TARGET_ATTRIBUTE}="${target.id}"]`);
        if (target.userOnly || userLoginPage(page.url())) throw new Error('Login, passwords, CAPTCHA and 2FA are user-only. Complete them in the dedicated browser.');
        if (request.action === 'click') {
          if (target.href && !this.allowedUrl(target.href, owner)) throw new Error('That link leaves the permitted ChatGPT connection.');
          await locator.click();
        } else if (request.action === 'fill') {
          if (!target.editable) throw new Error('Choose an editable target from the latest snapshot.');
          if (typeof request.text !== 'string') throw new Error('fill requires text.');
          if (this.isBridgePage(page.url(), owner) && !(target.pairing && /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/i.test(request.text))) throw new Error('Only the short local pairing code can be entered on the bridge authorization page.');
          const maximum = target.composer ? 1024 : 16_384;
          if (Buffer.byteLength(request.text, 'utf8') > maximum) throw new Error(target.composer ? 'ChatGPT control messages must be at most 1 KiB; let ChatGPT read code and logs through MCP.' : 'This form value exceeds 16 KiB.');
          await locator.fill(request.text);
        } else if (request.action === 'press') {
          if (!KEYS.has(request.key)) throw new Error('Use a supported editing or navigation key, not clipboard or browser shortcuts.');
          if (this.isBridgePage(page.url(), owner) && (!target.pairing || !['Enter', 'Tab', 'Escape'].includes(request.key))) throw new Error('Only pairing-form submission or navigation is permitted here.');
          await locator.press(request.key);
        }
      }
      canceled(signal);
      return await this.snapshot(owner);
    } catch (error) {
      canceled(signal);
      if (owner.blocked) throw new Error(`Navigation outside the ChatGPT connection was blocked: ${displayUrl(owner.blocked)}`);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) {
        await this.closeOwner(owner);
        if (owner.cleanup) await owner.cleanup();
      }
    }
  }

  isBridgePage(value, owner) {
    const url = new URL(value);
    return url.origin === (this.bridgeOrigins.get(owner.agent) ?? this.defaultBridgeOrigin) && url.pathname === '/oauth/authorize';
  }

  target(owner, page, id) {
    if (typeof id !== 'string' || !TARGET_ID.test(id)) throw new Error('Use an exact target id returned by the latest snapshot, never a selector.');
    const target = owner.targets.get(id);
    if (!target || target.page !== page) throw new Error('That target is stale. Read a fresh snapshot.');
    return target;
  }

  async readReply(owner, request) {
    const offset = request.offset ?? 0;
    const length = request.length ?? 6000;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 12_000) throw new Error('read_reply requires a nonnegative integer offset and length between 1 and 12000 characters.');
    const page = owner.page;
    if (!page || page.isClosed() || !this.allowedUrl(page.url(), owner)) throw new Error('No approved ChatGPT reply page is open.');
    await owner.pageLoads.get(page);
    const result = await page.evaluate(({ offset, length }) => {
      const replies = document.querySelectorAll('[data-message-author-role="assistant"]');
      const latest = replies[replies.length - 1];
      if (!latest) return null;
      const text = latest.innerText ?? '';
      return { replyIndex: replies.length - 1, text: text.slice(offset, offset + length), totalLength: text.length };
    }, { offset, length });
    if (!result) throw new Error('No assistant reply is present on the current page.');
    if (offset > result.totalLength) throw new Error('The offset is past the latest reply. Read its current length again.');
    const end = offset + result.text.length;
    return { url: displayUrl(page.url()), title: await page.title(), role: 'assistant', ...result, offset, nextOffset: end < result.totalLength ? end : null };
  }

  async snapshot(owner) {
    const page = owner.page;
    if (!page || page.isClosed()) throw new Error('No approved ChatGPT page is open.');
    await owner.pageLoads.get(page);
    if (!this.allowedUrl(page.url(), owner, true)) throw new Error('The current page is outside the ChatGPT connection.');
    const nonce = randomBytes(4).toString('hex');
    const result = await page.evaluate(({ attribute, nonce, loginPage }) => {
      const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const visible = node => {
        const bounds = node.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.right <= 0 || bounds.top >= innerHeight || bounds.left >= innerWidth || getComputedStyle(node).visibility === 'hidden') return false;
        const x = Math.max(0, Math.min(innerWidth - 1, bounds.left + bounds.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, bounds.top + bounds.height / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (node.contains(hit) || hit.contains(node)));
      };
      const isComposer = node => node.id === 'prompt-textarea' || /^(prompt|message)$/i.test(node.getAttribute('name') ?? '') || /composer|prompt-textarea/i.test(node.getAttribute('data-testid') ?? '') || (node.isContentEditable && Boolean(node.closest('form')));
      const label = node => compact(node.getAttribute('aria-label') || node.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.innerText ?? '').join(' ') || [...(node.labels ?? [])].map(item => item.innerText).join(' ') || node.getAttribute('placeholder') || node.getAttribute('title') || node.innerText || node.textContent).slice(0, 160);
      document.querySelectorAll(`[${attribute}]`).forEach(node => node.removeAttribute(attribute));
      const candidates = [...document.querySelectorAll('button,a[href],input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="textbox"],[role="combobox"]')].filter(node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
      const priority = node => node.closest('[role="dialog"],dialog') ? 0 : isComposer(node) || node.closest('form')?.querySelector('#prompt-textarea,[data-testid*="composer"],[data-testid*="prompt-textarea"],textarea[name="prompt"],textarea[name="message"]') ? 1 : node.closest('main,[role="main"]') ? 2 : node.closest('nav,aside,[role="navigation"],[role="complementary"]') ? 4 : 3;
      candidates.sort((a, b) => priority(a) - priority(b));
      const targets = candidates.slice(0, 80).map((node, index) => {
        const id = `r${nonce}-${index}`;
        node.setAttribute(attribute, id);
        const type = (node.getAttribute('type') ?? '').toLowerCase();
        const name = node.getAttribute('name') ?? '';
        const title = label(node);
        const pairing = node.id === 'pairing_code' && name === 'pairing_code';
        const sensitive = !pairing && (['password', 'email'].includes(type) || /password|passcode|otp|one-time-code|verification|api.?key|access.?token|refresh.?token|client.?secret|captcha|verify.you.are.human/i.test(`${node.id} ${name} ${title} ${node.getAttribute('autocomplete') ?? ''}`));
        const editable = node.matches('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]),textarea,[contenteditable="true"],[role="textbox"]') && !node.readOnly;
        const composer = isComposer(node);
        const role = node.getAttribute('role') || (node.tagName === 'A' ? 'link' : node.tagName === 'BUTTON' || ['button', 'submit'].includes(type) ? 'button' : ['checkbox', 'radio'].includes(type) ? type : editable ? 'textbox' : node.tagName === 'SELECT' ? 'combobox' : 'control');
        const value = sensitive || pairing || loginPage ? undefined : typeof node.value === 'string' ? node.value.slice(0, 256) : undefined;
        return { id, role, label: title, type, editable, composer, pairing, userOnly: sensitive || loginPage, ...(value === undefined ? {} : { value }), ...(node.tagName === 'A' ? { href: node.href } : {}), ...(node.matches('[type="checkbox"],[type="radio"]') ? { checked: node.checked } : {}) };
      });
      const fullBody = document.body?.innerText ?? '';
      const recentMessages = [...document.querySelectorAll('[data-message-author-role]')].slice(-4).map(node => {
        const text = node.innerText ?? '';
        const truncated = text.length > 8000;
        return { role: node.getAttribute('data-message-author-role'), text: truncated ? `${text.slice(0, 2000)}\n\n[Reply excerpt truncated. Use read_reply offset/length to read every section.]\n\n${text.slice(-6000)}` : text, ...(truncated ? { truncated: true, totalLength: text.length } : {}) };
      });
      const recentText = recentMessages.map(message => `${message.role}:\n${message.text}`).join('\n\n').slice(-10_000);
      const body = fullBody.length <= 12_000 ? fullBody : `${fullBody.slice(0, 1500)}\n\n[Earlier page content omitted; latest conversation follows.]\n\n${recentText || fullBody.slice(-10_000)}`;
      return { title: document.title.slice(0, 300), body, recentMessages, targets };
    }, { attribute: TARGET_ATTRIBUTE, nonce, loginPage: page.url() !== 'about:blank' && userLoginPage(page.url()) });
    owner.targets = new Map(result.targets.map(target => [target.id, { ...target, page }]));
    const targets = result.targets.map(target => ({ ...target, ...(target.href ? { href: displayUrl(target.href) } : {}) }));
    return { url: displayUrl(page.url()), title: result.title, body: result.body, recentMessages: result.recentMessages, snapshot: `${result.title}\n${result.body}\n\nTargets:\n${targets.map(target => `[${target.id}] ${target.role} ${target.label}${target.value === undefined ? '' : ` = ${target.value}`}${target.userOnly ? ' (user-only)' : ''}`).join('\n')}`.slice(0, 20_000), targets, ...(owner.blocked ? { blockedNavigation: displayUrl(owner.blocked) } : {}) };
  }
}
