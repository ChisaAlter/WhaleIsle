'use strict';

// The HTML preview iframe is a read-only surface: it keeps scripting (pages
// commonly need it to render) but must not gain form submission, modals,
// top-navigation or popup capabilities from a stray sandbox token.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('html preview iframe sandbox grants only allow-scripts', () => {
  const source = fs.readFileSync(path.join(__dirname, 'file-preview.js'), 'utf8');
  const match = source.match(/setAttribute\('sandbox', '([^']+)'\)/);
  assert.ok(match, 'html preview must sandbox its iframe');
  assert.equal(match[1], 'allow-scripts');
});

test('pdf preview iframe is sandboxed and theme syncs documentElement.style.colorScheme', () => {
  const source = fs.readFileSync(path.join(__dirname, 'file-preview.js'), 'utf8');
  assert.match(source, /else frame\.setAttribute\('sandbox', ''\)/);
  assert.match(source, /document\.documentElement\.style\.colorScheme = dark \? 'dark' : 'light'/);
});
