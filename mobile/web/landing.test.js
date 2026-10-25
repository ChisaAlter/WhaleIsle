import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// 一码两入口（mobile-remote 卡）：App 内扫码＝链接设备，相机/浏览器扫码＝web 端。
// 落地页必须把这个分流讲给用户。
test('landing page explains the one-QR entry split (App = link device, browser = web client)', () => {
  assert.match(indexHtml, /id="entry-split-hint"/);
  assert.match(indexHtml, /Web 端/);
  assert.match(indexHtml, /Android App 内扫同一张码会链接设备/);
});

test('connection and sidebar use the canonical transparent avatar and desktop wordmark', () => {
  assert.match(indexHtml, /src="\.\/assets\/whale-head\.png"/);
  assert.equal((indexHtml.match(/BASED ON DEEPSEEK HARNESS/g) || []).length, 3);
  assert.doesNotMatch(indexHtml, /class="whale-mark"/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'assets', 'whale-head.png')), fs.readFileSync(path.join(root, '..', '..', 'assets', 'whale-head.png')));
});

test('landing exposes one primary scan action and a themed Web scanner', () => {
  assert.match(indexHtml, /id="scan-open"/);
  assert.match(indexHtml, /id="screen-scan"[^>]*connect-canvas|connect-canvas[^>]*id="screen-scan"/);
  assert.match(indexHtml, /id="scan-video"/);
});

// Android 系统相机 / 链接点按分流：manifest 必须认领 http://*:3180 的 VIEW，
// 让系统弹「用 App 打开＝链接设备 / 用浏览器打开＝web 端」。fragment 无法进
// intent filter、LAN IP 动态，宽 host 匹配是唯一解——安全闸门在 App 内
// （PairingIntent 重新校验完整 offer v2 语法）。禁止 autoVerify：LAN IP 过不了
// App Links 验证，而系统选择器本身就是想要的 UX。
test('Android manifest claims http://*:3180 VIEW links for the entry-split chooser', () => {
  const manifest = fs.readFileSync(
    path.join(root, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8',
  );
  assert.match(manifest, /android\.intent\.action\.VIEW/);
  assert.match(manifest, /android\.intent\.category\.BROWSABLE/);
  assert.match(manifest, /android:scheme="http"/);
  assert.match(manifest, /android:host="\*"/);
  assert.match(manifest, /android:port="3180"/);
  assert.doesNotMatch(manifest, /android:autoVerify/);
  // 重扫时复用实例（onNewIntent），不堆叠第二个 Activity。
  assert.match(manifest, /android:launchMode="singleTask"/);
});

// 浏览器扫码打开本页必须自动连入 web 端；谁要是把这条路径改成「仅设备配对」
// 或要求二次确认，就破坏了「浏览器等其他设备扫码出 web 端」的产品行为。
test('browser scan keeps auto-connecting into the web client on #offer= boot', () => {
  assert.match(
    appJs,
    /hasOfferFragment\(window\.location\.hash\)/,
    '启动块必须检测 #offer= 并自动 connect()（浏览器 = web 端）',
  );
  assert.match(appJs, /connect\(window\.location\.href\)/);
});

test('expanded paste panel warns that WeChat/QQ strip #offer= and paste must be complete', () => {
  assert.match(indexHtml, /id="paste-toggle"/);
  assert.match(indexHtml, /id="paste-panel" class="paste-panel hidden"|class="paste-panel hidden" id="paste-panel"/);
  assert.match(indexHtml, /#offer=/);
  assert.match(indexHtml, /微信/);
  assert.match(indexHtml, /丢.*密钥|丢掉密钥/);
});
