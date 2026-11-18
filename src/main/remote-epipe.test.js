'use strict';

/**
 * Regression: enabling 远程 must never crash the main process with an
 * uncaught `EPIPE: broken pipe, write`.
 *
 * Root cause (fixed in the vendored fork): `resolveDshVendorDir` ran
 * `execSync("npm root -g")` WITHOUT explicit stdio. Node only then forwards
 * the child's captured stderr via `process.stderr.write()` after execSync
 * returns — outside the function's try/catch. In a GUI process whose stderr
 * pipe is already broken (installer/launcher parent gone) that write escalates
 * to an uncaughtException and kills Electron. The crash landed right after
 * `saveConfig({remoteEnabled:true})`, so the relaunched app looked like remote
 * was "on by default".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { VENDOR_ROOT } = require('./dshd-remote');
const { prerequisiteSkip, requirePrerequisite } = require('../../scripts/lib/test-prerequisites.cjs');

const DSH_AGENT_SRC = path.join(
  VENDOR_ROOT, 'packages', 'server', 'src', 'server', 'agent', 'providers', 'dsh-agent.ts',
);
const DSH_AGENT_DIST = path.join(
  VENDOR_ROOT, 'packages', 'server', 'dist', 'server', 'server', 'agent', 'providers', 'dsh-agent.js',
);
const DIST_RUNNABLE = fs.existsSync(DSH_AGENT_DIST)
  && fs.existsSync(path.join(VENDOR_ROOT, 'packages', 'server', 'node_modules'));
const DIST_HINT = 'vendored server dist/依赖缺失（prepare-dshd-remote.mjs 会构建）';
const DIST = { ok: DIST_RUNNABLE, reason: DIST_HINT };

test('vendored resolveDshVendorDir keeps explicit stdio on execSync (EPIPE tripwire)', () => {
  const src = fs.readFileSync(DSH_AGENT_SRC, 'utf8');
  assert.match(
    src,
    /execSync\("npm root -g",\s*\{[\s\S]*?stdio:\s*\["ignore",\s*"pipe",\s*"pipe"\][\s\S]*?\}\)/,
    'execSync("npm root -g") 必须携带显式 stdio，否则 Node 会把子进程 stderr 转写进主进程 stderr（断管即崩溃）',
  );
});

test(
  'resolveDshVendorDir survives a broken stderr pipe (real child process)',
  { skip: prerequisiteSkip(DIST), timeout: 30_000 },
  async (t) => {
    requirePrerequisite(t, DIST);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-epipe-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    if (process.platform === 'win32') {
      fs.writeFileSync(
        path.join(binDir, 'npm.cmd'),
        '@echo off\r\necho npm warn exec noise 1>&2\r\necho C:\\nonexistent-global-root\r\n',
      );
    } else {
      fs.writeFileSync(
        path.join(binDir, 'npm'),
        '#!/bin/sh\necho "npm warn exec noise" >&2\necho "/nonexistent-global-root"\n',
        { mode: 0o755 },
      );
    }

    const childScript = path.join(dir, 'child.mjs');
    fs.writeFileSync(childScript, `
      import { pathToFileURL } from 'node:url';
      // Give the parent time to destroy our stderr pipe first.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const mod = await import(pathToFileURL(process.argv[2]).href);
      mod.resolveDshVendorDir();
      // Leave a beat for any (now removed) async stderr forwarding to surface.
      setTimeout(() => process.exit(0), 200);
    `);

    const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` };
    delete env.CHISACODE_DSH_VENDOR_DIR;

    const child = spawn(process.execPath, [childScript, DSH_AGENT_DIST], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Break the child's stderr: further writes there raise EPIPE inside the child.
    child.stderr.destroy();

    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => resolve(code));
    });
    assert.equal(exitCode, 0, 'broken stderr pipe 不得再打爆调用进程');
  },
);
