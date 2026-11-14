'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

test('a fatal launcher failure leaves a crash report and exits without an error box', () => {
  assert.doesNotMatch(source, /showErrorBox/u);
  assert.match(source, /createMainFailureReporter\(/u);
  // Both fatal paths (uncaught exception, failed start-up chain) share the exit.
  const uses = source.match(/\bexitAfterReport\(error\)/gu) || [];
  assert.equal(uses.length, 2);
});

test('the exit does not wait for the report forever', () => {
  assert.match(source, /setTimeout\(\(\) => app\.exit\(1\), 3000\)/u);
});
