/** Isolated named-profile UI QA; reuse a built Harness with --runtime-root. No model network calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const runtime = path.resolve(arg('--runtime-root') ?? path.join(root, 'vendor/deepseek-harness'));
const output = path.resolve(arg('--output') ?? path.join(root, 'work/whale-big-fish-qa'));
const cli = createRequire(path.join(runtime, 'apps/cli/package.json'));
const load = name => import(pathToFileURL(cli.resolve(name)).href);
const parent = await fs.realpath(os.tmpdir());
const home = await fs.mkdtemp(path.join(parent, 'whale-big-fish-qa-'));
const priorHome = process.env.DSH_HOME, priorTelemetry = process.env.DSH_TELEMETRY_DISABLED;
process.env.DSH_HOME = home; process.env.DSH_TELEMETRY_DISABLED = '1';
let app, browser, page;
const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
await fs.mkdir(output, { recursive: true });
try {
  const { initProfile, loadLayeredEnv } = await load('@deepseek-ai/dsh-app-boot');
  const profile = path.join(home, 'profiles/big-fish-qa');
  initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-whale', 'dsh-pad']);
  await fs.mkdir(path.join(profile, 'node_modules'), { recursive: true });
  for (const name of ['dsh-whale', 'dsh-pad']) await fs.symlink(path.join(root, 'vendor', name), path.join(profile, 'node_modules', name), 'junction');
  const manifestPath = path.join(profile, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath));
  manifest.dependencies = { 'dsh-whale': `file:${path.join(root, 'vendor/dsh-whale')}`, 'dsh-pad': `file:${path.join(root, 'vendor/dsh-pad')}` };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const disabled = ['hmr', 'client-hmr', 'session-telemetry-otel', 'open-in-app'];
  const patch = [...disabled.map(id => ({ id, disabled: true })),
    { id: 'agent-default-model', config: { provider: 'scripted', model: 'qa' } },
    { id: 'mcp-servers-file', config: { path: path.join(home, 'mcp.yaml'), watch: false } },
    { id: 'dsh-pad', config: { updateCheck: false } }];
  const patchFile = path.join(home, 'qa.patch.json'); await fs.writeFile(patchFile, JSON.stringify(patch));
  await fs.mkdir(path.join(home, 'dsh-pad'), { recursive: true });
  await fs.writeFile(path.join(home, 'dsh-pad/panels.json'), JSON.stringify({ version: 1, panels: [{ id: 'p_qa', version: 1, position: 0, collapsed: false, span: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    definition: { title: '今日工作台', html: '<main style="padding:16px;font:14px system-ui"><strong>先完成重要的事</strong><p>面板与原有 dsh-pad 共用一份数据。</p><p id="readout">尚未读取</p><button onclick="this.textContent=\'已点击\'">检查交互</button></main>', css: '', script: 'dsh.onData(data => { document.querySelector("#readout").textContent = data.sources.check?.ok ? "已授权读数：" + data.sources.check.value.trim() : "尚未读取"; });', height: 'auto', sources: [{ id: 'check', kind: 'command', command: 'echo 42', parse: 'text', intervalSec: 60, timeoutMs: 5000 }] } }] }));
  const { runProfile, disposeProfileApplication } = await import(pathToFileURL(path.join(runtime, 'apps/cli/lib/profile-boot.js')).href);
  app = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'big-fish-qa', patchFiles: [patchFile], args: ['--no-open', '--host', '127.0.0.1', '--port', String(port)] });
  // This runner owns shutdown so its finally can reclaim the synthetic profile.
  for (const [signal, previous] of signals) for (const listener of process.listeners(signal)) if (!previous.has(listener)) process.removeListener(signal, listener);
  app.dispose = () => disposeProfileApplication(app.ctx);
  const { LlmAdapter } = await load('@deepseek-ai/dsh-llm');
  class Scripted extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'qa', name: '本地验收模型' }]; }
    async resolveModel(provider, id) { return { provider, id, name: '本地验收模型' }; }
    async *stream(options) {
      const request = JSON.stringify(options.messages);
      if (request.includes('等待停止')) {
        await new Promise(resolve => { if (options.signal?.aborted) resolve(); else options.signal?.addEventListener('abort', resolve, { once: true }); });
        return;
      }
      const text = '已整理今日清单：检查布局、验证任务、确认面板。请人工确认成果。';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  app.ctx.llm.registerAdapter(['scripted'], new Scripted());
  const url = app.ctx.connection.authenticatedUrl(`http://127.0.0.1:${port}/`);
  console.log(`QA_URL=${url}\nQA_HOME=${home}`);
  // --serve is useful for inspecting the same candidate, with cleanup on Ctrl+C.
  if (process.argv.includes('--serve')) await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  else {
    const playwright = createRequire(path.join(runtime, 'apps/web/package.json'))(arg('--playwright') ?? 'playwright');
    browser = await playwright.chromium.launch({ ...(arg('--browser-executable') ? { executablePath: arg('--browser-executable') } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    const wait = condition => page.waitForFunction(condition, undefined, { timeout: 10000 });
    const card = title => page.locator('[data-whale-todo]').filter({ has: page.getByRole('button', { name: title, exact: true }) });
    const menu = async (title, action) => { await card(title).getByRole('button', { name: `任务操作：${title}` }).click(); await page.getByRole('menuitem', { name: action, exact: true }).click(); };
    const add = async title => { await page.getByRole('button', { name: '新增任务', exact: true }).click(); await page.getByLabel('任务名称', { exact: true }).fill(title); await page.getByLabel('任务说明', { exact: true }).fill('保持独立会话，给出可核对的结果。'); await page.getByRole('button', { name: '保存', exact: true }).click(); await card(title).waitFor(); };
    const start = async title => { await card(title).getByRole('button', { name: '开始执行', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '开始执行', exact: true }).click(); };
    await page.goto(url);
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await page.waitForFunction(() => typeof window.__dshWhaleOpen === 'function');
    await page.getByText('鲸鱼娘', { exact: true }).first().click();
    await page.getByRole('button', { name: '暂不进入', exact: true }).click();
    await page.evaluate(() => window.__dshWhaleOpen());
    assert.equal(await page.getByRole('dialog').count(), 0, 'decline is remembered');
    const geometry = await page.locator('[data-dsh-frame]').getAttribute('style');
    await page.getByRole('button', { name: '大肥鱼模式', exact: true }).click();
    await page.locator('html[data-dsh-whale-mode]').waitFor();
    assert.equal(await page.locator('[data-dsh-frame-region="sidebar"]').isVisible(), false);
    assert.equal(await page.locator('[data-titlebar-trailing]').isVisible(), false);
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['面板', '任务']);
    await page.getByText('这张面板要在本机运行以下数据源：', { exact: true }).waitFor();
    await page.getByRole('button', { name: '允许运行', exact: true }).click();
    await page.locator('.dshpad-whale-panels iframe').waitFor();
    const frame = page.frameLocator('.dshpad-whale-panels iframe');
    await frame.getByText('已授权读数：42', { exact: true }).waitFor();
    await frame.getByRole('button', { name: '检查交互' }).click();
    await frame.getByRole('button', { name: '已点击' }).waitFor();
    await page.screenshot({ path: path.join(output, 'panels-desktop.png') });
    const composer = page.locator('[data-composer-input]');
    await composer.fill('保留的草稿');
    await page.getByRole('button', { name: '添加面板', exact: true }).click();
    await page.getByLabel('想创建什么面板？', { exact: true }).fill('展示今日三件事');
    await page.getByRole('button', { name: '放入对话', exact: true }).click();
    assert.match(await composer.innerText(), /^保留的草稿[\s\S]*展示今日三件事$/);
    const draft = await composer.innerText();
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByText('从侧栏移除', { exact: true }).click();
    assert.equal(await page.locator('.dshpad-whale-panels iframe').count(), 0);
    const savedPanels = JSON.parse(await fs.readFile(path.join(home, 'dsh-pad/panels.json')));
    assert.equal(savedPanels.panels.length, 1, 'sidebar removal must not delete the panel');
    await page.getByRole('button', { name: '添加面板', exact: true }).first().click();
    await page.getByRole('button', { name: '添加已有：今日工作台', exact: true }).click();
    await page.getByRole('tab', { name: '任务', exact: true }).click();
    await add('整理今日清单');
    assert.equal(app.ctx.get('whaleTodos').list()[0].sessionId, '', 'creation does not execute');
    await menu('整理今日清单', '置顶');
    await card('整理今日清单').locator('[aria-label="已置顶"]').waitFor({ state: 'attached' });
    assert.equal(app.ctx.get('whaleTodos').list()[0].pinned, true);
    await start('整理今日清单');
    await card('整理今日清单').getByText('执行结束 · 待确认', { exact: true }).waitFor();
    await card('整理今日清单').getByRole('button', { name: '查看成果', exact: true }).click();
    assert.match(await card('整理今日清单').innerText(), /请人工确认成果/);
    await card('整理今日清单').getByRole('button', { name: '打开关联对话', exact: true }).click();
    await page.locator('[data-dsh-frame-region="center"]').getByText('已整理今日清单：检查布局、验证任务、确认面板。请人工确认成果。', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: '返回鲸鱼娘', exact: true }).click();
    await wait(() => document.querySelector('[data-composer-input]')?.innerText.startsWith('保留的草稿'));
    assert.equal(await composer.innerText(), draft);
    await card('整理今日清单').getByRole('button', { name: '确认完成', exact: true }).click();
    await menu('整理今日清单', '归档');
    await page.locator('summary').filter({ hasText: '归档' }).click();
    await card('整理今日清单').getByText('已完成', { exact: true }).waitFor();
    await menu('整理今日清单', '移出归档');
    await add('等待停止'); await start('等待停止');
    await card('等待停止').getByText('正在执行', { exact: true }).waitFor();
    await page.getByRole('button', { name: '退出模式', exact: true }).click();
    assert.equal(await page.locator('[data-dsh-frame]').getAttribute('style'), geometry);
    assert.equal(await composer.innerText(), draft);
    assert.equal(app.ctx.get('whaleTodos').list().find(value => value.title === '等待停止').state, 'running', 'exit does not cancel work');
    await page.getByRole('button', { name: '大肥鱼模式', exact: true }).click();
    await menu('等待停止', '停止执行…');
    await page.getByRole('dialog').getByRole('button', { name: '停止执行', exact: true }).click();
    await card('等待停止').getByText('已取消', { exact: true }).waitFor();
    await menu('等待停止', '删除任务卡…');
    await page.getByRole('dialog').getByRole('button', { name: '删除任务卡', exact: true }).click();
    await wait(() => document.querySelectorAll('[data-whale-todo]').length === 1);
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(output, 'tasks-desktop.png') });
    await page.getByRole('separator', { name: '调整右边栏宽度' }).focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getByRole('separator', { name: '调整右边栏宽度' }).getAttribute('aria-valuenow'), '376');
    await page.getByRole('button', { name: '收起右边栏', exact: true }).click();
    assert.equal(await page.getByRole('complementary', { name: '鲸鱼娘右边栏' }).isVisible(), false);
    await page.getByRole('button', { name: '展开右边栏', exact: true }).click();
    await page.setViewportSize({ width: 760, height: 820 });
    await wait(() => document.querySelector('[data-dsh-frame-region="center"]')?.inert === true);
    await page.screenshot({ path: path.join(output, 'tasks-narrow.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: '鲸鱼娘右边栏' }).isVisible(), false);
    await page.getByRole('button', { name: '展开右边栏', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: path.join(output, 'tasks-dark.png') });
    await page.reload();
    await page.waitForFunction(() => typeof window.__dshWhaleOpen === 'function');
    await page.evaluate(() => window.__dshWhaleOpen());
    await page.locator('html[data-dsh-whale-mode]').waitFor();
    await card('整理今日清单').getByText('已完成', { exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '任务', exact: true }).getAttribute('aria-selected'), 'true');
    await fs.writeFile(path.join(output, 'browser-errors.json'), JSON.stringify(errors, null, 2));
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['first-entry decline and manual entry', 'native conversation retained', 'iframe interaction', 'draft append', 'sidebar-only panel removal and restore', 'no autorun', 'pin', 'native Agent completion requires review', 'linked conversation', 'confirm/archive/unarchive', 'scoped stop/delete', 'exit preserves geometry/draft and running task', 'keyboard resize/collapse', 'narrow/dark', 'reload persistence'], model: 'local scripted adapter; no external model calls' }, null, 2));
    console.log(`Big Fish UI QA passed; evidence: ${output}`);
  }
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser?.close();
  await app?.dispose?.();
  if (priorHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = priorHome;
  if (priorTelemetry === undefined) delete process.env.DSH_TELEMETRY_DISABLED; else process.env.DSH_TELEMETRY_DISABLED = priorTelemetry;
  assert.equal(path.dirname(home), parent); assert.ok(path.basename(home).startsWith('whale-big-fish-qa-'));
  await fs.rm(home, { recursive: true, force: true });
}
