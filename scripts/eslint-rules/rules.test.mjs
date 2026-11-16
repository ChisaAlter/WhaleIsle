import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import plugin from './index.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const cjs = { ecmaVersion: 'latest', sourceType: 'commonjs' };
const page = { ecmaVersion: 'latest', sourceType: 'script' };

const ipcTester = new RuleTester({ languageOptions: cjs });
ipcTester.run('whaleisle/ipc-handler-reads-event', plugin.rules['ipc-handler-reads-event'], {
  valid: [
    "ipcMain.handle('ch', (event) => assertIpcSender(event));",
    "ipcMain.handle('ch', async (event, arg) => { assertIpcSender(event); return arg; });",
    "ipcMain.on('ch', (event, value) => { owned(event); sink(value); });",
    "ipcMain.once('ch', function (event) { return owned(event); });",
    "ipcMain.handleOnce('ch', ({ sender }) => check(sender));",
    "ipcMain.handle('ch', namedHandler);",
    "ipcMain.handle('ch', (event) => () => read(event));",
    "ipcMain.handle('ch');",
  ],
  invalid: [
    { code: "ipcMain.handle('ch', () => presentation);", errors: [{ messageId: 'missingEventCheck' }] },
    { code: "ipcMain.on('ch', function () { return 1; });", errors: [{ messageId: 'missingEventCheck' }] },
    { code: "ipcMain.handle('ch', (event, id) => id + 1);", errors: [{ messageId: 'missingEventCheck' }] },
    { code: "ipcMain.once('ch', (_event) => report());", errors: [{ messageId: 'missingEventCheck' }] },
  ],
});

const viaRegisterTester = new RuleTester({ languageOptions: cjs });
viaRegisterTester.run('whaleisle/ipc-via-register', plugin.rules['ipc-via-register'], {
  valid: [
    "register({ channel: 'ch', roles, validate: noArgs, handler });",
    "createRegisterIpc(ipcMain)({ channel: 'ch', authorize, validate, handler });",
    "ipcMain.removeHandler('ch');",
    "ipcRenderer.invoke('ch', payload);",
    "sender.on('did-navigate', reap);",
    "protocol.handle('pet', petHandler);",
  ],
  invalid: [
    { code: "ipcMain.handle('ch', (event) => work(event));", errors: [{ messageId: 'useRegisterIpc' }] },
    { code: "ipcMain.on('ch', (event) => work(event));", errors: [{ messageId: 'useRegisterIpc' }] },
    { code: "ipcMain.once('ch', (event) => work(event));", errors: [{ messageId: 'useRegisterIpc' }] },
    { code: "ipcMain.handleOnce('ch', (event) => work(event));", errors: [{ messageId: 'useRegisterIpc' }] },
    { code: "const ipcMain = require('electron').ipcMain; ipcMain.handle('ch', () => {});", errors: [{ messageId: 'useRegisterIpc' }] },
  ],
});

const externalTester = new RuleTester({ languageOptions: cjs });
externalTester.run('whaleisle/open-external-http', plugin.rules['open-external-http'], {
  valid: [
    "shell.openExternal('https://example.com/release');",
    "shell.openExternal('https://example.com/a', { activate: true });",
    "menu.click = () => shell.openExternal('https://docs.example/');",
    "openExternal(url);",
    "shell.open('https://example.com');",
  ],
  invalid: [
    { code: 'shell.openExternal(url);', errors: [{ messageId: 'requireHttpLiteral' }] },
    { code: "shell.openExternal('http://example.com');", errors: [{ messageId: 'requireHttpLiteral' }] },
    { code: "shell.openExternal('file:///etc/passwd');", errors: [{ messageId: 'requireHttpLiteral' }] },
    { code: 'shell.openExternal(`https://example.com/${id}`);', errors: [{ messageId: 'requireHttpLiteral' }] },
    { code: 'shell.openExternal();', errors: [{ messageId: 'requireHttpLiteral' }] },
  ],
});

const htmlTester = new RuleTester({ languageOptions: page });
htmlTester.run('whaleisle/no-raw-html', plugin.rules['no-raw-html'], {
  valid: [
    'el.textContent = label;',
    'el.replaceChildren(build());',
    'const markup = el.innerHTML;',
    'list.innerHTML; ',
    "insertAdjacentHTML('beforeend', html);",
  ],
  invalid: [
    { code: 'el.innerHTML = html;', errors: [{ messageId: 'noRawHtml' }] },
    { code: "el.outerHTML = '';", errors: [{ messageId: 'noRawHtml' }] },
    { code: "el['innerHTML'] = html;", errors: [{ messageId: 'noRawHtml' }] },
    { code: "node.insertAdjacentHTML('beforeend', html);", errors: [{ messageId: 'noRawHtml' }] },
  ],
});

const secretTester = new RuleTester({ languageOptions: cjs });
secretTester.run('whaleisle/no-secret-compare', plugin.rules['no-secret-compare'], {
  valid: [
    // 字面量 / null / undefined / typeof 结果的比较不受限。
    "if (token === '') close();",
    "if (marker.token !== null) keep();",
    'if (prevToken === undefined) forget();',
    "if (typeof value.token === 'string') accept();",
    'if (token === void 0) forget();',
    "if (merged.githubToken === '********') mask();",
    "if (element.type === 'password') mark();",
    "if (url.password !== '') sanitize();",
    "if (key === 'remoteRelayToken') apply();",
    "if (item === '--host-token') parse();",
    'if (exec?.token !== undefined) resume();',
    "if (token === typeof probe) check();",
    // 复数或只是包含凭据词的名字不是凭据：LLM 用量计数、掩码常量照常比较。
    'if (next.tokensSeen !== before) mark();',
    'if (dayTokens.day !== today) roll();',
    'if (outputTokens !== prevSeen) flush();',
    'if (stats.tokens !== saved.tokens) diff();',
    'if (value === ENV_SECRET_MASK) keep();',
    'if (kept !== MASKED_ENV_VALUE) drop();',
    // 没有凭据名操作数的比较不在规则范围。
    'if (kind === feed) dispatch();',
    'if (authHeader === expectedHeader) allow();',
    // 统一的等值比较写法本身。
    'if (constantTimeEqual(a, b)) allow();',
  ],
  invalid: [
    { code: 'if (this.token === token) same();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: 'if (muxCookie === cookie) reuse();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: "if (auth !== `Bearer ${token}`) deny();", errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: 'if (marker.token === ownershipToken) own();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: 'if (ctx[authMethod] === secret) accept();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: 'if (heldGuardToken === token) release();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: 'if (next?.token === this.account?.token) reuse();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: "if (req.headers.authorization === `Bearer ${token}`) allow();", errors: [{ messageId: 'useConstantTimeEqual' }] },
    // 以单数凭据词结尾的成员属性名同样命中。
    { code: 'if (sessionSecret === secret) accept();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: 'if (form.password === password) deny();', errors: [{ messageId: 'useConstantTimeEqual' }] },
    { code: "if (req.headers['x-dshd-git-token'] === token) deny();", errors: [{ messageId: 'useConstantTimeEqual' }] },
  ],
});

const bodyTester = new RuleTester({ languageOptions: cjs });
bodyTester.run('whaleisle/no-request-body-accumulate', plugin.rules['no-request-body-accumulate'], {
  valid: [
    "socket.on('data', (chunk) => forward(chunk));",
    "process.stdin.on('data', (chunk) => feed(chunk));",
    "response.on('data', (chunk) => count(chunk));",
    "res.on('data', (chunk) => chunks.push(chunk));",
    "req.on('end', () => done());",
    "req.on('error', (error) => fail(error));",
    "req.off('data', onData);",
    'readBodyLimited(req, 4096).then((raw) => parse(raw));',
  ],
  invalid: [
    { code: "req.on('data', (chunk) => chunks.push(chunk));", errors: [{ messageId: 'useReadBodyLimited' }] },
    { code: "req.once('data', (chunk) => first(chunk));", errors: [{ messageId: 'useReadBodyLimited' }] },
    { code: 'req.on("data", handler);', errors: [{ messageId: 'useReadBodyLimited' }] },
  ],
});
