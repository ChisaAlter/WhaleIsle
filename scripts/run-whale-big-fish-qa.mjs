/** Isolated named-profile UI QA; reuse a built Harness with --runtime-root. No model network calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ensureDesktopDshWhale } = createRequire(import.meta.url)(path.join(root, 'src/main/dsh-whale-desktop.js'));
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const runtime = path.resolve(arg('--runtime-root') ?? path.join(root, 'vendor/deepseek-harness'));
const output = path.resolve(arg('--output') ?? path.join(root, 'work/whale-big-fish-qa'));
const cli = createRequire(path.join(runtime, 'apps/cli/package.json'));
const load = name => import(pathToFileURL(cli.resolve(name)).href);
await withOwnedTempDir('whale-big-fish-qa-', async (home) => {
const priorHome = process.env.DSH_HOME, priorTelemetry = process.env.DSH_TELEMETRY_DISABLED;
process.env.DSH_HOME = home; process.env.DSH_TELEMETRY_DISABLED = '1';
let app, browser, page;
const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
await fs.mkdir(output, { recursive: true });
try {
  const { initProfile, loadLayeredEnv } = await load('@deepseek-ai/dsh-app-boot');
  const profile = path.join(home, 'profiles/big-fish-qa');
  initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-whale', 'dsh-pad']);
  const whaleMount = ensureDesktopDshWhale({
    sourceDir: path.join(root, 'vendor/dsh-whale'),
    profileDir: profile,
    harnessRoot: runtime,
    enabled: true,
  });
  assert.equal(whaleMount.ok, true, whaleMount.error || 'ensureDesktopDshWhale failed');
  await fs.mkdir(path.join(profile, 'node_modules'), { recursive: true });
  await fs.symlink(path.join(root, 'vendor', 'dsh-pad'), path.join(profile, 'node_modules', 'dsh-pad'), 'junction');
  const manifestPath = path.join(profile, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath));
  manifest.dependencies = { 'dsh-whale': `file:${whaleMount.runtimeDir}`, 'dsh-pad': `file:${path.join(root, 'vendor/dsh-pad')}` };
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
    await page.goto(url);
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await page.waitForFunction(() => typeof window.__dshWhaleOpen === 'function');
    await page.getByText('你的大肥鱼队友', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新建队友', exact: true }).waitFor();
    assert.equal(await page.locator('html[data-dsh-whale-mode]').count(), 0, 'legacy fullscreen overlay must not exist');
    const newBotDialog = page.getByRole('dialog', { name: '新建大肥鱼队友' });
    await page.waitForLoadState('networkidle').catch((/** @type {unknown} */ err) => {
      console.debug?.('big-fish-qa networkidle skipped:', err instanceof Error ? err.message : err);
    });
    await page.evaluate(() => /** @type {any} */ (window).__dshWhaleOpen());
    try {
      await newBotDialog.waitFor({ timeout: 5000 });
    } catch {
      await page.evaluate(() => /** @type {any} */ (window).__dshWhaleOpen());
      await newBotDialog.waitFor();
    }
    await newBotDialog.getByPlaceholder('给你的大肥鱼起个名字').fill('鲸鱼娘');
    await newBotDialog.getByRole('button', { name: '创建', exact: true }).click();
    await newBotDialog.waitFor({ state: 'detached' });
    await page.locator('[data-dsh-bots-conv-action="home"]').click();
    await page.locator('[data-dsh-bots-right-panel]').waitFor();
    await page.locator('[data-dsh-bots-right-panel]').getByText('鲸鱼娘', { exact: true }).first().waitFor();
    for (const tabLabel of ['连接器', '对话', '文件', '概览']) {
      await page.locator('[data-dsh-bots-right-panel]').getByRole('tab', { name: tabLabel, exact: true }).click();
    }
    assert.equal(await page.locator('html[data-dsh-whale-mode]').count(), 0);
    await page.screenshot({ path: path.join(output, 'bots-desktop.png') });

    await page.locator('#dshpad-ball').click();
    await page.getByText('今日工作台', { exact: true }).waitFor();
    await page.getByText('这张面板要在本机运行以下数据源：', { exact: true }).waitFor();
    await page.getByRole('button', { name: '允许运行', exact: true }).click();
    await page.locator('.dshpad-root iframe').waitFor();
    const frame = page.frameLocator('.dshpad-root iframe');
    await frame.getByText('已授权读数：42', { exact: true }).waitFor();
    await frame.getByRole('button', { name: '检查交互' }).click();
    await frame.getByRole('button', { name: '已点击' }).waitFor();
    await page.screenshot({ path: path.join(output, 'panels-desktop.png') });

    await page.setViewportSize({ width: 760, height: 820 });
    await page.screenshot({ path: path.join(output, 'bots-narrow.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: path.join(output, 'bots-dark.png') });

    await page.reload();
    await page.waitForFunction(() => typeof window.__dshWhaleOpen === 'function');
    await page.getByText('鲸鱼娘', { exact: true }).first().waitFor();
    await page.evaluate(() => window.__dshWhaleOpen());
    await page.locator('[data-dsh-bots-conv-action="home"]').waitFor();
    await page.locator('[data-dsh-bots-conv-action="home"]').click();
    await page.locator('[data-dsh-bots-right-panel]').waitFor();
    await page.locator('[data-dsh-bots-right-panel]').getByText('鲸鱼娘', { exact: true }).first().waitFor();
    assert.equal(await page.locator('html[data-dsh-whale-mode]').count(), 0);
    await fs.writeFile(path.join(output, 'browser-errors.json'), JSON.stringify(errors, null, 2));
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['orca empty state and new bot modal via __dshWhaleOpen', 'bot creation and home chat open', 'right panel 4 tabs without fullscreen overlay', 'dsh-pad dock iframe authorization and interaction', 'narrow/dark', 'reload persistence'], model: 'local scripted adapter; no external model calls' }, null, 2));
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
}
});
