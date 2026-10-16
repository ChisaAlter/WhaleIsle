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

test('published bilingual release notes become two complete language tabs', () => {
  const { releaseNotesTabs, plainReleaseNotes } = require('./release-notes');
  const chinese = fs.readFileSync(path.join(__dirname, '../../.github/release-notes.md'), 'utf8');
  const english = fs.readFileSync(path.join(__dirname, '../../.github/release-notes.en.md'), 'utf8');
  const body = `${chinese}\n\n<details>\n<summary>English</summary>\n\n${english}\n\n</details>\n`;
  assert.deepEqual(releaseNotesTabs(body), [
    { id: 'zh-CN', label: '中文', text: plainReleaseNotes(chinese) },
    { id: 'en', label: 'English', text: plainReleaseNotes(english) },
  ]);
});

test('language splitting preserves full text and does not invent a translation for single-language notes', () => {
  const { releaseNotesTabs } = require('./release-notes');
  const chinese = '较长的更新内容。'.repeat(350);
  const english = 'Complete release notes. '.repeat(350).trim();
  const tabs = releaseNotesTabs(`${chinese}\n<details><summary>English</summary>\n${english}\n</details>\n\n末尾说明`);
  assert.equal(tabs[0].text, `${chinese}\n\n末尾说明`);
  assert.equal(tabs[1].text, english);
  for (const body of ['', '# 仅中文\n\n完整说明', '# English only\n\nFull notes', '<details><summary>English</summary>Only English</details>']) {
    assert.deepEqual(releaseNotesTabs(body), []);
  }
});
