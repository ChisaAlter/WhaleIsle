import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Agents from '@deepseek-ai/dsh-agent';
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { ChatGPTBrowser, discoverBrowserExecutable } from '../lib/browser.js';

const require = createRequire(import.meta.url);
const { createScope } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-scope', { paths: [require.resolve('@deepseek-ai/dsh-agent')] })).href);

test('real Cordis Agent scope and plugin unload await browser cleanup without root-fiber restart', { timeout: 15_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-chatgpt-lifecycle-'));
  const host = new Context();
  const agentsFiber = await host.plugin(Agents);
  let browser;
  const runtime = await host.plugin({ inject: ['agents'], apply(c) {
    browser = new ChatGPTBrowser({ profileDir: path.join(root, 'profile'), executablePath: discoverBrowserExecutable(), headless: true });
    c.effect(() => () => browser.dispose(), 'test-browser-plugin');
  } });
  t.after(async () => { await runtime.dispose(); await agentsFiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const makeAgent = id => {
    const sessionId = SessionId(id);
    const agent = { id: sessionId, session: Session.create(sessionId, [], { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, cwd: root, isSeeded: false }) };
    const scope = createScope(runtime.ctx, agent);
    agent.ctx = scope.ctx;
    const detach = runtime.ctx.agents.enter(agent, undefined);
    return { agent, scope, detach };
  };

  const first = makeAgent('lifecycle-first');
  await browser.run(first.agent, { action: 'snapshot' }, new AbortController().signal);
  const firstContext = browser.owner.context;
  assert.notEqual(first.agent.ctx.fiber, runtime.ctx.fiber);
  await first.scope.dispose();
  first.detach();
  assert.equal(browser.owner, undefined);
  assert.equal(firstContext.pages().length, 0);

  const second = makeAgent('lifecycle-second');
  await browser.run(second.agent, { action: 'snapshot' }, new AbortController().signal);
  const secondContext = browser.owner.context;
  await runtime.dispose();
  assert.equal(browser.owner, undefined);
  assert.equal(browser.disposed, true);
  assert.equal(secondContext.pages().length, 0);
  await second.scope.dispose();
  second.detach();
});
