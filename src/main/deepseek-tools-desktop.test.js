'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDesktopDeepSeekTools } = require('./deepseek-tools-desktop');

test('desktop links one shipped API plugin without changing user configuration or copying a runtime', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-deepseek-mount-'));
  const profileDir = path.join(scratch, 'profile');
  const sourceDir = path.resolve(__dirname, '../../vendor/dsh-deepseek-tools');
  const link = path.join(profileDir, 'node_modules/dsh-deepseek-tools');
  t.after(() => {
    assert.ok(path.resolve(scratch).startsWith(path.join(os.tmpdir(), 'whale-deepseek-mount-')));
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  fs.mkdirSync(profileDir, { recursive: true });
  const user = '- id: llm-deepseek\n  config:\n    models: []\n';
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), user);
  for (let count = 0; count < 2; count++) {
    assert.equal(ensureDesktopDeepSeekTools({ sourceDir, profileDir }).ok, true);
    assert.equal(fs.realpathSync(link), fs.realpathSync(sourceDir));
  }
  assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), user);
  assert.deepEqual(fs.readdirSync(path.join(profileDir, 'node_modules')), ['dsh-deepseek-tools']);
  assert.equal(fs.existsSync(path.join(profileDir, 'desktop-plugins')), false);
  assert.equal(ensureDesktopDeepSeekTools({ sourceDir: path.join(scratch, 'missing'), profileDir }).ok, false);
  fs.unlinkSync(link); fs.mkdirSync(link);
  fs.writeFileSync(path.join(link, 'user-data.txt'), 'preserve');
  assert.throws(() => ensureDesktopDeepSeekTools({ sourceDir, profileDir }), /refusing to replace unknown content/);
  assert.equal(fs.readFileSync(path.join(link, 'user-data.txt'), 'utf8'), 'preserve');
});
