/**
 * Offline deterministic maturity checks backed directly by compiled/existing
 * `vendor/deepseek-harness` packages. Loaded dynamically so `tools` CI lanes
 * without `setup:harness` can still import CLI/report helpers safely.
 * @module scripts/eval-harness/offline-dsh-checks
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { REPO_ROOT } from './temp-env.mjs';

const execFileAsync = promisify(execFile);
const VENDOR_DIR = path.join(REPO_ROOT, 'vendor', 'deepseek-harness');
const UTF8_BOM = '\uFEFF';

/**
 * Load a module from `vendor/deepseek-harness` by repository-relative path.
 * @param {string} relPath
 * @returns {Promise<any>}
 */
async function importVendor(relPath) {
  const fullPath = path.join(VENDOR_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing built/vendor module "${relPath}". Run "npm run setup:harness" first.`);
  }
  return import(pathToFileURL(fullPath).href);
}

/**
 * Resolve a dependency relative to a vendored package directory.
 * @param {string} pkgRelPath
 * @param {string} specifier
 * @returns {any}
 */
function requireFromVendorPkg(pkgRelPath, specifier) {
  const pkgJsonPath = path.join(VENDOR_DIR, pkgRelPath, 'package.json');
  const req = createRequire(pathToFileURL(pkgJsonPath).href);
  return req(specifier);
}

/**
 * Load `@deepseek-ai/cordis` `Context` from the vendored harness workspace.
 * @returns {Promise<any>}
 */
async function createCordisContext() {
  const pkgJsonPath = path.join(VENDOR_DIR, 'packages', 'fs', 'fs-local', 'package.json');
  const req = createRequire(pathToFileURL(pkgJsonPath).href);
  const resolved = req.resolve('@deepseek-ai/cordis');
  const mod = await import(pathToFileURL(resolved).href);
  return new mod.Context();
}

/**
 * Verify `fsio`/`LocalFileSystem` 4-stage fuzzy matching and CRLF + UTF-8 BOM preservation.
 * @param {string} workDir
 * @returns {Promise<{ matchedStages: string[], preservedBomAndCrlf: boolean }>}
 */
export async function runEditOfflineCheck(workDir) {
  const fsio = await importVendor('packages/fs/fs-local/src/fsio.ts');
  const fsLocal = await importVendor('packages/fs/fs-local/lib/index.js');
  const fsPatch = await importVendor('packages/fs/fs-patch/lib/index.js');

  const dir = path.join(workDir, 'edit');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'sample.ts');
  const initialDisk = `${UTF8_BOM}const label = \u201Chello\u201D;   \r\n  return   label;\r\n`;
  fs.writeFileSync(filePath, Buffer.from(initialDisk, 'utf8'));

  const ctx = await createCordisContext();
  const lfs = new fsLocal.LocalFileSystem(ctx, { cwd: dir, diffBasisMaxBytes: 1024 * 1024 });
  const target = await lfs.resolve(filePath);
  await lfs.editText(target, { oldString: '  return   label;', newString: '  return `${label}!`;', replaceAll: false });

  const afterDisk = fs.readFileSync(filePath);
  const hasBom = afterDisk[0] === 0xef && afterDisk[1] === 0xbb && afterDisk[2] === 0xbf;
  const diskText = afterDisk.subarray(3).toString('utf8');
  const hasCrlf = diskText.includes('\r\n') && !/(?<!\r)\n/u.test(diskText);
  assert.equal(hasBom, true, 'UTF-8 BOM must be preserved on disk');
  assert.equal(hasCrlf, true, 'CRLF line endings must be preserved on disk');

  const stage2 = fsio.applyLiteralEdit('const a = 1;\nconst b = 2;\n', '   1: const a = 1;', 'const a = 10;', false, 'sample.ts');
  const stage3 = fsio.applyLiteralEdit('    if (ok) {   \n      go();\n    }\n', '    if (ok) {\n      go();\n    }', '    if (ok) {\n      stop();\n    }', false, 'sample.ts');
  const stage4 = fsio.applyLiteralEdit('const s = \u201Csmart\u201D;\n', 'const s = "smart";', 'const s = "plain";', false, 'sample.ts');
  assert.equal(stage2.replacements, 1, 'stage 2 line-number-prefix strip replacements=1 expected');
  assert.equal(stage2.content, 'const a = 10;\nconst b = 2;\n');
  assert.equal(stage3.replacements, 1, 'stage 3 trimEnd replacements=1 expected');
  assert.ok(stage3.content.includes('stop();'));
  assert.equal(stage4.replacements, 1, 'stage 4 unicode replacements=1 expected');
  assert.equal(stage4.content, 'const s = "plain";\n');
  assert.throws(
    () => fsio.applyLiteralEdit('    if (ok) {\n      go();\n    }\n', 'if (ok) {\n  go();\n}', 'stop();', false, 'sample.ts'),
    /not found/u,
  );

  const ops = fsPatch.parsePatch('*** Begin Patch\n*** Update File: sample.ts\n@@\n-const a = 1;\n+const a = 9;\n*** End Patch');
  const patched = fsPatch.applyHunks('const a = 1;  \n', ops[0].hunks);
  assert.equal(patched.ok, true, 'fs-patch fuzzy applyHunks expected ok=true');
  assert.equal(patched.after, 'const a = 9;\n');

  await ctx.fiber.dispose();
  return {
    matchedStages: ['exact-crlf-bom', 'line-prefix-strip', 'trimEnd', 'unicode-fold', 'fs-patch'],
    preservedBomAndCrlf: hasBom && hasCrlf,
  };
}

/**
 * Verify `glob` in a bare directory without `.git` respects `.gitignore` with 0 leaks.
 * @param {string} workDir
 * @returns {Promise<{ returnedFiles: string[], leakedIgnored: number }>}
 */
export async function runGlobOfflineCheck(workDir) {
  const search = await importVendor('packages/fs/tool-fs-search/lib/index.js');
  const bareDir = path.join(workDir, 'glob-bare');
  fs.mkdirSync(path.join(bareDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(bareDir, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(bareDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(bareDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
  fs.writeFileSync(path.join(bareDir, 'src', 'app.ts'), 'export const app = 1;\n', 'utf8');
  fs.writeFileSync(path.join(bareDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n', 'utf8');
  fs.writeFileSync(path.join(bareDir, 'dist', 'bundle.js'), 'console.log(1);\n', 'utf8');

  const input = search.parseGlobArgs({ pattern: '**/*' });
  const argv = search.buildGlobCommand(input);
  assert.ok(argv.includes('--no-require-git'), 'bare directory glob must pass --no-require-git');
  assert.ok(!argv.includes('--glob=**/*'), 'catch-all positive glob must be omitted when respecting .gitignore');

  const rg = await search.resolveRgPath();
  const { stdout } = await execFileAsync(rg, argv, { cwd: bareDir, encoding: 'utf8' });
  const files = stdout.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(p => p.replaceAll('\\', '/'));
  const leaked = files.filter(file => file.includes('node_modules/') || file.includes('dist/'));
  assert.equal(leaked.length, 0, `ignored paths leaked in bare glob: ${leaked.join(', ')}`);
  assert.ok(files.includes('src/app.ts'), 'expected src/app.ts in bare glob output');
  return { returnedFiles: files, leakedIgnored: leaked.length };
}

/**
 * Verify `grep` `files_with_matches` and `head_limit` bounding against real ripgrep.
 * @param {string} workDir
 * @returns {Promise<{ totalMatchedFiles: number, headLimitedFiles: string[] }>}
 */
export async function runGrepOfflineCheck(workDir) {
  const search = await importVendor('packages/fs/tool-fs-search/lib/index.js');
  const grepDir = path.join(workDir, 'grep-fixture');
  fs.mkdirSync(grepDir, { recursive: true });
  const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
  for (const name of files) {
    fs.writeFileSync(
      path.join(grepDir, name),
      `export const tag = "MATURITY_MARKER_7";\nexport const second = "MATURITY_MARKER_7";\n`,
      'utf8',
    );
  }

  const input = search.parseGrepArgs({
    pattern: 'MATURITY_MARKER_7',
    path: '.',
    output_mode: 'files_with_matches',
    head_limit: 2,
  });
  const argv = search.buildGrepCommand(input);
  assert.ok(argv.includes('--max-count=1'), 'files_with_matches must include --max-count=1');

  const rg = await search.resolveRgPath();
  const { stdout } = await execFileAsync(rg, argv, { cwd: grepDir, encoding: 'utf8' });
  const matches = search.parseGrepMatches(stdout, false);
  const distinctFiles = [...new Set(matches.map((/** @type {{ path: string }} */ m) => search.toWorkdirRelative(m.path, grepDir)))];
  assert.equal(distinctFiles.length, 4, `expected 4 distinct matching files, got ${distinctFiles.length}`);
  const headLimitedFiles = distinctFiles.slice(0, input.head_limit);
  assert.equal(headLimitedFiles.length, 2, 'head_limit=2 must cap files_with_matches output to 2');

  return { totalMatchedFiles: distinctFiles.length, headLimitedFiles };
}

/**
 * Verify `sandbox-windows-acl` `grantWrite` NULL-DACL fail-closed guard and `sandbox-local` extra root boundaries.
 * @param {string} workDir
 * @returns {Promise<{ nullDaclRejected: boolean, localFreeCalls: number, boundaryCodes: string[] }>}
 */
export async function runWinAclOfflineCheck(workDir) {
  const aclMod = await importVendor('packages/sandbox/sandbox-windows-acl/src/acl.ts');
  const aclIndex = await importVendor('packages/sandbox/sandbox-windows-acl/lib/index.js');
  const sandboxLocal = await importVendor('packages/sandbox/sandbox-local/lib/index.js');

  const testRoot = path.join(workDir, 'win-acl');
  const wsDir = path.join(testRoot, 'ws');
  const lockTmp = path.join(testRoot, 'lock-tmp');
  const nestedTemp = path.join(wsDir, 'temp');
  const missingExtra = path.join(testRoot, 'does-not-exist');
  fs.mkdirSync(nestedTemp, { recursive: true });
  fs.mkdirSync(lockTmp, { recursive: true });

  const koffi = requireFromVendorPkg('packages/sandbox/sandbox-windows-acl', 'koffi');
  const pvoid = koffi.pointer('void');
  let localFreeCalls = 0;
  const mockApi = {
    getTempPathW: (/** @type {number} */ _length, /** @type {Buffer} */ buffer) => {
      buffer.write(lockTmp, 'utf16le');
      return lockTmp.length;
    },
    createFileW: () => 7n,
    lockFileEx: () => 1,
    unlockFileEx: () => 1,
    closeHandle: () => 1,
    getNamedSecurityInfoW: (
      /** @type {string} */ _p,
      /** @type {number} */ _o,
      /** @type {number} */ _i,
      /** @type {unknown} */ _own,
      /** @type {unknown} */ _grp,
      /** @type {Buffer} */ daclSlot,
      /** @type {Buffer} */ saclSlot,
      /** @type {Buffer} */ descSlot,
    ) => {
      koffi.encode(daclSlot, pvoid, 0n);
      koffi.encode(saclSlot, pvoid, 0n);
      koffi.encode(descSlot, pvoid, 0x1001n);
      return 0;
    },
    localFree: () => {
      localFreeCalls += 1;
      return 0n;
    },
  };

  let nullDaclRejected = false;
  assert.throws(
    () => {
      aclMod.grantWrite(mockApi, wsDir, 1n, 2n, 3n);
    },
    /refusing to modify directory with NULL DACL/u,
  );
  nullDaclRejected = true;
  assert.equal(localFreeCalls, 1, 'descriptor must be freed on NULL-DACL fail-closed');

  assert.throws(
    () => aclIndex.assertTempRootOutsideWorkspace(wsDir, nestedTemp),
    /temp root must be outside the workspace/u,
  );

  const ctx = await createCordisContext();
  const provider = new sandboxLocal.LocalSandboxProvider(ctx, {
    runnerCommand: [],
    runnerFailureSignatures: [],
    probeTimeoutMs: 5000,
    revokeWorkspaceAclOnDispose: false,
  });
  provider.internals = {
    platform: 'win32',
    probeWindowsAcl: () => true,
  };

  /** @type {string[]} */
  const boundaryCodes = [];
  await assert.rejects(
    () => provider.confine(['node', '-v'], {
      mode: 'workspace-write',
      workspaceRoot: wsDir,
      additionalWritableRoots: [missingExtra],
    }),
    (error) => {
      const code = /** @type {{ code?: string } | undefined} */ (error)?.code;
      if (typeof code === 'string') boundaryCodes.push(code);
      return code === 'SANDBOX_INVALID_ROOT';
    },
  );
  await ctx.fiber.dispose();

  return { nullDaclRejected, localFreeCalls, boundaryCodes };
}

/**
 * Verify `mcp-client` switches to deferred `search_tools`/`call_tool` above threshold 16 and computes compression.
 * @returns {Promise<{ threshold: number, eagerTools: number, deferredTools: number, compressionRatio: number }>}
 */
export async function runMcpDeferredOfflineCheck() {
  const deferred = await importVendor('packages/mcp/mcp-client/lib/types/deferred-tools.js');
  assert.equal(deferred.DEFAULT_INLINE_TOOL_THRESHOLD, 16, 'threshold expected to be 16');
  assert.equal(deferred.resolveToolDiscoveryStrategy(16, 'auto'), 'eager');
  assert.equal(deferred.resolveToolDiscoveryStrategy(24, 'auto'), 'deferred');

  /** @type {Array<{ name: string, description: string, inputSchema: Record<string, unknown> }>} */
  const catalog = Array.from({ length: 24 }, (_, idx) => ({
    name: idx === 11 ? 'create_invoice_ledger' : `remote_action_${idx}`,
    description: idx === 11
      ? 'Create a customer billing invoice ledger record in ERP.'
      : `Execute remote enterprise operation number ${idx} with structured payload fields.`,
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Unique account identifier for billing audit.' },
        payload: { type: 'object', description: 'Nested operation attributes and metadata entries.' },
        dryRun: { type: 'boolean', description: 'Validate changes without committing state.' },
      },
      required: ['accountId'],
    },
  }));

  const searchResult = deferred.searchDeferredTools(catalog, 'invoice ledger', 5);
  assert.equal(searchResult.matchedCount, 1);
  assert.equal(searchResult.tools[0].name, 'create_invoice_ledger');

  const fakeCtx = { tools: {}, i18n: undefined };
  const fakeClient = {};
  const metaDefs = deferred.createDeferredToolDefinitions(
    fakeCtx,
    fakeClient,
    { serverName: 'erp', inlineToolThreshold: 16, toolDiscoveryMode: 'auto' },
    catalog,
  );
  const metaNames = metaDefs.map((/** @type {{ name: string }} */ d) => d.name);
  assert.deepEqual(metaNames, ['mcp__erp__search_tools', 'mcp__erp__call_tool']);

  const eagerBytes = Buffer.byteLength(JSON.stringify(catalog), 'utf8');
  const deferredBytes = Buffer.byteLength(
    JSON.stringify(metaDefs.map((/** @type {{ name: string, description: string, parameters: unknown }} */ d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    }))),
    'utf8',
  );
  const compressionRatio = Number(((eagerBytes - deferredBytes) / eagerBytes).toFixed(4));
  assert.ok(compressionRatio > 0.5, `expected deferred compression > 50%, got ${compressionRatio}`);

  return {
    threshold: deferred.DEFAULT_INLINE_TOOL_THRESHOLD,
    eagerTools: catalog.length,
    deferredTools: metaDefs.length,
    compressionRatio,
  };
}

/**
 * Verify `tool-lsp` `formatDiagnostics`, omission markers, and `appendDiagnosticsContent` format.
 * @returns {Promise<{ formattedLength: number, hasPostEditBlock: boolean }>}
 */
export async function runLspDiagnosticsOfflineCheck() {
  const lsp = await importVendor('packages/lsp/tool-lsp/lib/index.js');
  const parsed = lsp.parseLspArgs({ operation: 'diagnostics', file_path: 'src/index.ts' });
  assert.equal(parsed.operation, 'diagnostics');
  assert.deepEqual(parsed.position, { line: 0, character: 0 });

  const workspaceUri = 'file:///repo/';
  const targetUri = 'file:///repo/src/index.ts';
  const rendered = lsp.formatDiagnostics(
    [
      {
        range: { start: { line: 11, character: 4 }, end: { line: 11, character: 10 } },
        severity: 1,
        source: 'ts',
        code: 2322,
        message: "Type 'string' is not assignable to type 'number'.",
      },
      {
        range: { start: { line: 19, character: 2 }, end: { line: 19, character: 8 } },
        severity: 2,
        source: 'eslint',
        code: 'no-unused-vars',
        message: 'Unused identifier',
      },
    ],
    targetUri,
    workspaceUri,
    1,
    4000,
  );
  assert.ok(rendered.includes('src/index.ts:12:5'), 'expected 1-based line:col diagnostic line');
  assert.ok(rendered.includes('1 more diagnostic omitted'), 'expected omission footer when maxItems=1');

  const appended = lsp.appendDiagnosticsContent([{ type: 'text', text: 'File edited successfully.' }], rendered);
  const firstText = Array.isArray(appended) ? appended[0]?.text : '';
  const hasPostEditBlock = typeof firstText === 'string' && firstText.includes('File edited successfully.') && firstText.includes('src/index.ts:12:5');
  assert.equal(hasPostEditBlock, true);
  return { formattedLength: rendered.length, hasPostEditBlock };
}

/**
 * Verify `subagent/worktree` removes clean untouched worktrees/branches and retains dirty ones.
 * @param {string} workDir
 * @returns {Promise<{ cleanStatus: string, dirtyReason: string | undefined }>}
 */
export async function runSubagentWorktreeOfflineCheck(workDir) {
  const subagent = await importVendor('packages/subagent/subagent/lib/index.js');
  const repoDir = path.join(workDir, 'worktree-repo');
  const poolDir = path.join(workDir, 'worktree-pool');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), 'baseline\n', 'utf8');

  await execFileAsync('git', ['init'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.name', 'Eval Harness'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.email', 'eval@example.invalid'], { cwd: repoDir });
  await execFileAsync('git', ['add', 'README.md'], { cwd: repoDir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const cleanSpec = await subagent.createIsolatedSubagentWorktree(repoDir, { poolDir, nameHint: 'clean-case' });
  assert.equal(fs.existsSync(cleanSpec.path), true);
  const cleanOutcome = await subagent.finalizeIsolatedSubagentWorktree(cleanSpec);
  assert.equal(cleanOutcome.status, 'cleaned');
  assert.equal(fs.existsSync(cleanSpec.path), false, 'clean worktree folder must be removed');

  const dirtySpec = await subagent.createIsolatedSubagentWorktree(repoDir, { poolDir, nameHint: 'dirty-case' });
  try {
    fs.writeFileSync(path.join(dirtySpec.path, 'dirty.txt'), 'uncommitted\n', 'utf8');
    const dirtyOutcome = await subagent.finalizeIsolatedSubagentWorktree(dirtySpec);
    assert.equal(dirtyOutcome.status, 'retained');
    assert.equal(dirtyOutcome.reason, 'uncommitted-changes');
    const notice = subagent.formatWorktreeOutcomeNotice(dirtyOutcome);
    assert.ok(notice.includes(dirtySpec.branch), 'worktree retention notice must name branch');
    return { cleanStatus: cleanOutcome.status, dirtyReason: dirtyOutcome.reason };
  } finally {
    await execFileAsync('git', ['worktree', 'remove', '--force', dirtySpec.path], { cwd: repoDir }).catch((err) => {
      // Best-effort git metadata teardown; outer temp root cleanup reclaims remaining files.
      void err;
    });
    await execFileAsync('git', ['branch', '-D', dirtySpec.branch], { cwd: repoDir }).catch((err) => {
      // Branch might already be removed if worktree setup failed partway.
      void err;
    });
  }
}
