const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('the browser helper and launcher consumer can load as separate classic scripts', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'release-notes.js'), 'utf8'), context);
  vm.runInContext('const { plainReleaseNotes } = window.releaseNotes; window.readingText = plainReleaseNotes("# Release\\n\\n**Full notes**");', context);
  assert.equal(context.window.readingText, 'Release\n\nFull notes');
});

test('update reading text preserves folded release content without rendering HTML tags or truncating notes', () => {
  const { plainReleaseNotes } = require('./release-notes');
  const chinese = '更新说明。'.repeat(350);
  const result = plainReleaseNotes(`# 新版本\n\n${chinese}\n<details>\n<summary>English</summary>\n\nEnglish copy\n</details>`);
  assert.equal(result, `新版本\n\n${chinese}\n\nEnglish\n\nEnglish copy`);
});
