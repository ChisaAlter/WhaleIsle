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
