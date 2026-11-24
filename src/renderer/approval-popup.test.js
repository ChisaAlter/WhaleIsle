'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('approval-popup.html narrows img-src and adds base-uri, form-action, and object-src none', () => {
  const html = fs.readFileSync(path.join(__dirname, 'approval-popup.html'), 'utf8');
  assert.match(html, /img-src 'self' data: http:\/\/127\.0\.0\.1:\*/);
  assert.doesNotMatch(html, /http:\/\/localhost:\*/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /object-src 'none'/);
});

test('approval-popup.js validates subject.icon against harnessOrigin/bitmap data URI and syncs colorScheme', () => {
  const src = fs.readFileSync(path.join(__dirname, 'approval-popup.js'), 'utf8');
  assert.match(src, /document\.documentElement\.style\.colorScheme = isDark \? 'dark' : 'light'/);
  assert.match(src, /function sanitizeSubjectIcon\(raw, harnessOrigin\)/);
  assert.match(src, /iconUrl\.origin === originUrl\.origin/);
});
