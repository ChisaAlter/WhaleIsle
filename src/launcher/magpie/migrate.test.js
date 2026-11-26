'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const {
  detectLegacyWhaleBridge,
  fingerprintLegacyData,
  readMigrationState,
  rewriteAccountHomePath,
  mergeProvidersJson,
  mergeLoginsJson,
  mergePluginsJson,
  mergeMigrationsJson,
  mergeUsageJsonl,
  migrateWhaleBridgeToMagpie,
  reconcileLegacyWhaleBridgeDir,
} = require('./migrate');

test('rewriteAccountHomePath only rewrites grok/devin/kiro paths anchored in legacy data dir', () => {
  const legacyDir = path.resolve(path.sep, 'old-state', 'components', 'whalebridge', 'data');
  const targetDir = path.resolve(path.sep, 'home', 'tester', '.config', 'magpie');
  assert.equal(
    rewriteAccountHomePath(path.join(legacyDir, 'grok-homes', 'acc-1'), legacyDir, targetDir),
    path.join(targetDir, 'grok-homes', 'acc-1'),
  );
  const unrelated = path.resolve(path.sep, 'other', 'place', 'acc-2');
  assert.equal(rewriteAccountHomePath(unrelated, legacyDir, targetDir), unrelated);
});

test('mergeProvidersJson, mergeLoginsJson, and mergeUsageJsonl merge without data loss', () => {
  const providers = mergeProvidersJson(
    { providers: { deepseek: { name: 'Existing' } }, order: ['deepseek'], pluginLeft: [{ package: 'p1', id: 'a' }] },
    {
      providers: {
        deepseek: { name: 'Legacy Conflict' },
        openai: { name: 'OpenAI' },
      },
      order: ['deepseek', 'openai'],
      pluginLeft: [{ package: 'p1', id: 'a' }, { package: 'p2', id: 'b' }],
    },
  );
  assert.deepEqual(providers.providers.deepseek, { name: 'Existing' });
  assert.deepEqual(providers.providers['deepseek-whalebridge'], { name: 'Legacy Conflict' });
  assert.deepEqual(providers.providers.openai, { name: 'OpenAI' });
  assert.equal(providers.pluginLeft.length, 2);

  const legacyDir = path.resolve(path.sep, 'wb', 'data');
  const targetDir = path.resolve(path.sep, 'magpie');
  const logins = mergeLoginsJson(
    [
      { agent: 'kiro', user: 'u1', token: 'newer', renewed: 2000, home: path.join(targetDir, 'kiro', 'u1') },
      { agent: 'devin', user: 'u2', token: 'older', seen: 1000, home: path.join(targetDir, 'devin', 'u2') },
    ],
    [
      { agent: 'kiro', user: 'u1', token: 'stale', renewed: 1000, home: path.join(legacyDir, 'kiro', 'u1') },
      { agent: 'devin', user: 'u2', token: 'fresh', seen: 3000, home: path.join(legacyDir, 'devin', 'u2') },
      { agent: 'grok', user: 'u3', token: 'only-legacy', seen: 500, home: path.join(legacyDir, 'grok', 'u3') },
    ],
    legacyDir,
    targetDir,
  );
  assert.equal(logins.find((x) => x.user === 'u1').token, 'newer');
  assert.equal(logins.find((x) => x.user === 'u2').token, 'fresh');
  assert.equal(logins.find((x) => x.user === 'u2').home, path.join(targetDir, 'devin', 'u2'));
  assert.equal(logins.find((x) => x.user === 'u3').home, path.join(targetDir, 'grok', 'u3'));

  const usage = mergeUsageJsonl(
    `${JSON.stringify({ id: 'e1', ts: 1, model: 'm1', cost: 1 })}\n`,
    `${JSON.stringify({ id: 'e1', ts: 1, model: 'm1', cost: 1 })}\n${JSON.stringify({ id: 'e2', ts: 2, model: 'm2', cost: 2 })}\n`,
  );
  const rows = usage.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ['e1', 'e2']);
});

test('migrateWhaleBridgeToMagpie executes cold copy, excludes runtime artifacts, runs disconnect, and is idempotent', async () => {
  await withOwnedTempDir('magpie-migrate-cold-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'config-magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    fs.mkdirSync(path.join(wbData, 'grok-homes', 'u1'), { recursive: true });
    fs.writeFileSync(path.join(wbData, 'grok-homes', 'u1', 'cookie.txt'), 'secret');
    fs.writeFileSync(path.join(wbData, 'providers.json'), JSON.stringify({ providers: { p1: { name: 'P1' } }, order: ['p1'] }));
    fs.writeFileSync(path.join(wbData, 'logins.json'), JSON.stringify([
      { agent: 'grok', user: 'u1', home: path.join(wbData, 'grok-homes', 'u1'), seen: 100 },
    ]));
    fs.writeFileSync(path.join(wbData, 'gateway.key'), 'must-not-copy');
    fs.writeFileSync(path.join(wbData, 'agents.json'), JSON.stringify(['claude-code']));
    fs.writeFileSync(path.join(wbRoot, 'installed.json'), JSON.stringify({
      version: '1.2.0',
      entry: 'WhaleBridge-win32-x64.exe',
    }));
    const legacyBin = path.join(wbRoot, 'versions', '1.2.0', 'WhaleBridge-win32-x64.exe');
    fs.mkdirSync(path.dirname(legacyBin), { recursive: true });
    fs.writeFileSync(legacyBin, 'wb');

    const patchFile = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
    fs.writeFileSync(patchFile, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      whalebridge:',
      '        api: openai-completions',
      '        baseUrl: http://127.0.0.1:19450/v1',
      '        apiKeyEnv: WHALEBRIDGE_GATEWAY_KEY',
    ].join('\n'));

    const toolCalls = [];
    let stopCalled = 0;
    const res = await migrateWhaleBridgeToMagpie({
      desktopStateDir,
      dshHome,
      targetConfigDir,
      stopLegacyBridge: async () => { stopCalled += 1; },
      runTool: async (file, args) => { toolCalls.push([file, args]); },
    });

    assert.equal(res.migrated, true);
    assert.equal(res.dataMode, 'cold');
    assert.equal(stopCalled, 1);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0][0], legacyBin);
    assert.deepEqual(toolCalls[0][1], ['whalebridge-disconnect']);
    assert.ok(fs.existsSync(path.join(targetConfigDir, 'providers.json')));
    assert.ok(fs.existsSync(path.join(targetConfigDir, 'grok-homes', 'u1', 'cookie.txt')));
    assert.ok(!fs.existsSync(path.join(targetConfigDir, 'gateway.key')));
    const migratedLogins = JSON.parse(fs.readFileSync(path.join(targetConfigDir, 'logins.json'), 'utf8'));
    assert.equal(migratedLogins[0].home, path.join(targetConfigDir, 'grok-homes', 'u1'));
    assert.doesNotMatch(fs.readFileSync(patchFile, 'utf8'), /whalebridge:/);
    assert.equal(readMigrationState(wbRoot).stage, 'completed');
    assert.equal(detectLegacyWhaleBridge(desktopStateDir).needsMigration, false);

    // Re-running migration stays a safe no-op
    const second = await migrateWhaleBridgeToMagpie({ desktopStateDir, dshHome, targetConfigDir });
    assert.equal(second.migrated, false);
    assert.equal(second.reason, 'nothing-to-migrate');
  });
});

test('migrateWhaleBridgeToMagpie rolls back target config and DSH channel on mid-migration failure', async () => {
  await withOwnedTempDir('magpie-migrate-rollback-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'config-magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    fs.mkdirSync(wbData, { recursive: true });
    fs.writeFileSync(path.join(wbData, 'providers.json'), JSON.stringify({ providers: { legacyOnly: { name: 'Legacy' } }, order: ['legacyOnly'] }));
    fs.writeFileSync(path.join(wbRoot, 'installed.json'), JSON.stringify({ version: '1.2.0', entry: 'WhaleBridge-win32-x64.exe' }));
    const legacyBin = path.join(wbRoot, 'versions', '1.2.0', 'WhaleBridge-win32-x64.exe');
    fs.mkdirSync(path.dirname(legacyBin), { recursive: true });
    fs.writeFileSync(legacyBin, 'wb');

    fs.mkdirSync(targetConfigDir, { recursive: true });
    fs.writeFileSync(path.join(targetConfigDir, 'providers.json'), JSON.stringify({ providers: { existing: { name: 'Keep' } }, order: ['existing'] }));

    await assert.rejects(
      () => migrateWhaleBridgeToMagpie({
        desktopStateDir,
        dshHome,
        targetConfigDir,
        runTool: async () => { throw new Error('disconnect crashed'); },
      }),
      /disconnect crashed/,
    );

    const restoredProviders = JSON.parse(fs.readFileSync(path.join(targetConfigDir, 'providers.json'), 'utf8'));
    assert.deepEqual(Object.keys(restoredProviders.providers), ['existing']);
    assert.equal(readMigrationState(wbRoot).stage, 'rolled_back');
  });
});

test('merge mode throws and rolls back on corrupt target config and rewrites migrations.json home fields', async () => {
  await withOwnedTempDir('magpie-migrate-corrupt-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'config-magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    fs.mkdirSync(wbData, { recursive: true });
    fs.writeFileSync(path.join(wbData, 'providers.json'), JSON.stringify({ providers: { legacy: { name: 'Legacy' } }, order: ['legacy'] }));
    fs.writeFileSync(path.join(wbData, 'migrations.json'), JSON.stringify([
      { id: 'm1', home: path.join(wbData, 'grok', 'u1') },
    ]));
    fs.writeFileSync(path.join(wbRoot, 'installed.json'), JSON.stringify({ version: '1.2.0', entry: 'WhaleBridge-win32-x64.exe' }));

    fs.mkdirSync(targetConfigDir, { recursive: true });
    const corruptBytes = '{corrupt json';
    fs.writeFileSync(path.join(targetConfigDir, 'providers.json'), corruptBytes);

    await assert.rejects(
      () => migrateWhaleBridgeToMagpie({ desktopStateDir, dshHome, targetConfigDir }),
      SyntaxError,
    );
    assert.equal(fs.readFileSync(path.join(targetConfigDir, 'providers.json'), 'utf8'), corruptBytes);
    assert.equal(readMigrationState(wbRoot).stage, 'rolled_back');

    // Fix providers.json and simulate a crash at data_migrated with prior backupDir.
    fs.writeFileSync(path.join(targetConfigDir, 'providers.json'), JSON.stringify({ providers: { clean: { name: 'Clean' } }, order: ['clean'] }));
    const priorBackup = path.join(wbRoot, 'prior-backup');
    fs.mkdirSync(path.join(priorBackup, 'magpie'), { recursive: true });
    fs.copyFileSync(path.join(targetConfigDir, 'providers.json'), path.join(priorBackup, 'magpie', 'providers.json'));
    fs.writeFileSync(path.join(priorBackup, 'manifest.json'), JSON.stringify([
      { src: path.join(targetConfigDir, 'providers.json'), dst: path.join(priorBackup, 'magpie', 'providers.json'), existed: true },
    ]));
    // Pollute target providers.json as if crashed mid-migration.
    fs.writeFileSync(path.join(targetConfigDir, 'providers.json'), JSON.stringify({ providers: { dirty: { name: 'Dirty' } } }));
    fs.writeFileSync(path.join(wbRoot, 'migration-state.json'), JSON.stringify({
      stage: 'data_migrated',
      backupDir: priorBackup,
    }));

    const res = await migrateWhaleBridgeToMagpie({ desktopStateDir, dshHome, targetConfigDir });
    assert.equal(res.migrated, true);
    const mergedProviders = JSON.parse(fs.readFileSync(path.join(targetConfigDir, 'providers.json'), 'utf8'));
    assert.ok(mergedProviders.providers.clean);
    assert.ok(mergedProviders.providers.legacy);
    assert.equal(mergedProviders.providers.dirty, undefined);
    const mergedMigrations = JSON.parse(fs.readFileSync(path.join(targetConfigDir, 'migrations.json'), 'utf8'));
    assert.equal(mergedMigrations[0].home, path.join(targetConfigDir, 'grok', 'u1'));
  });
});

test('Scenario B defers data merge while external Magpie runs and completes once external exits', async () => {
  await withOwnedTempDir('magpie-scenario-b-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'config-magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    fs.mkdirSync(wbData, { recursive: true });
    fs.writeFileSync(path.join(wbData, 'providers.json'), JSON.stringify({ providers: { legacyOnly: { name: 'Legacy' } }, order: ['legacyOnly'] }));
    fs.writeFileSync(path.join(wbRoot, 'installed.json'), JSON.stringify({ version: '1.2.0', entry: 'WhaleBridge-win32-x64.exe' }));
    const legacyBin = path.join(wbRoot, 'versions', '1.2.0', 'WhaleBridge-win32-x64.exe');
    fs.mkdirSync(path.dirname(legacyBin), { recursive: true });
    fs.writeFileSync(legacyBin, 'wb');

    fs.mkdirSync(targetConfigDir, { recursive: true });
    fs.writeFileSync(path.join(targetConfigDir, 'providers.json'), JSON.stringify({ providers: { ext: { name: 'Ext' } }, order: ['ext'] }));

    let disconnectCalls = 0;
    const first = await migrateWhaleBridgeToMagpie({
      desktopStateDir,
      dshHome,
      targetConfigDir,
      externalRunning: true,
      runTool: async () => { disconnectCalls += 1; },
    });
    assert.equal(first.migrated, true);
    assert.equal(first.dataMode, 'skipped-external-running');
    assert.equal(first.dataMergeSkipped, 'external-running');
    assert.equal(disconnectCalls, 1);

    // Must be deferred_data_merge, NOT completed, and installed.json must NOT have migratedToMagpieAt
    const state1 = readMigrationState(wbRoot);
    assert.equal(state1.stage, 'deferred_data_merge');
    assert.equal(state1.agentsDisconnected, true);
    const inst1 = JSON.parse(fs.readFileSync(path.join(wbRoot, 'installed.json'), 'utf8'));
    assert.equal(inst1.migratedToMagpieAt, undefined);
    const det1 = detectLegacyWhaleBridge(desktopStateDir);
    assert.equal(det1.needsMigration, true);
    assert.equal(det1.needsDataMerge, true);

    // Re-running while externalRunning is still true must be a safe no-op without backups or re-disconnect
    const second = await migrateWhaleBridgeToMagpie({
      desktopStateDir,
      dshHome,
      targetConfigDir,
      externalRunning: true,
      runTool: async () => { disconnectCalls += 1; },
    });
    assert.equal(second.migrated, false);
    assert.equal(second.reason, 'deferred-external-running');
    assert.equal(disconnectCalls, 1);
    assert.equal(fs.readdirSync(wbRoot).filter((n) => n.startsWith('migration-backup-')).length, 0);

    // Once external Magpie stops (externalRunning: false), deferred data merge completes without re-disconnecting
    const third = await migrateWhaleBridgeToMagpie({
      desktopStateDir,
      dshHome,
      targetConfigDir,
      externalRunning: false,
      runTool: async () => { disconnectCalls += 1; },
    });
    assert.equal(third.migrated, true);
    assert.equal(third.dataMode, 'merged');
    assert.equal(third.dataMergeSkipped, '');
    assert.equal(disconnectCalls, 1);
    assert.equal(readMigrationState(wbRoot).stage, 'completed');
    const inst2 = JSON.parse(fs.readFileSync(path.join(wbRoot, 'installed.json'), 'utf8'));
    assert.ok(inst2.migratedToMagpieAt);
    assert.equal(detectLegacyWhaleBridge(desktopStateDir).needsMigration, false);
    const mergedProviders = JSON.parse(fs.readFileSync(path.join(targetConfigDir, 'providers.json'), 'utf8'));
    assert.ok(mergedProviders.providers.ext);
    assert.ok(mergedProviders.providers.legacyOnly);
  });
});

test('an interrupted deferred merge recovers its snapshot before merging again', async () => {
  await withOwnedTempDir('magpie-deferred-restart-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    const installed = path.join(wbRoot, 'installed.json');
    const providers = path.join(targetConfigDir, 'providers.json');
    const dshPatch = path.join(dshHome, 'cordis.patch.yml');
    for (const dir of [wbData, targetConfigDir, dshHome]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(wbData, 'providers.json'), '{"providers":{"shared":{"name":"WhaleBridge"}}}');
    fs.writeFileSync(providers, '{"providers":{"shared":{"name":"Magpie"}}}');
    fs.writeFileSync(installed, '{"version":"1.2.0"}');
    fs.writeFileSync(dshPatch, '[]\n');
    const options = { desktopStateDir, dshHome, targetConfigDir };
    const crashAfterRename = (target) => {
      const child = spawnSync(process.execPath, ['-e', `
        const fs = require('node:fs');
        const [modulePath, rawOptions, target, markerPath] = process.argv.slice(1);
        const { migrateWhaleBridgeToMagpie } = require(modulePath);
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => {
          rename(from, to);
          if (to === target && (to !== markerPath || JSON.parse(fs.readFileSync(to, 'utf8')).migratedToMagpieAt)) {
            process.exit(87);
          }
        };
        migrateWhaleBridgeToMagpie(JSON.parse(rawOptions)).catch((error) => {
          console.error(error);
          process.exitCode = 1;
        });
      `, require.resolve('./migrate'), JSON.stringify(options), target, installed], { encoding: 'utf8', timeout: 10_000 });
      assert.equal(child.status, 87, child.stderr || String(child.error || child.signal));
    };
    const merged = {
      shared: { name: 'Magpie' },
      'shared-whalebridge': { name: 'WhaleBridge' },
    };
    const readProviders = () => JSON.parse(fs.readFileSync(providers, 'utf8')).providers;

    assert.equal((await migrateWhaleBridgeToMagpie({ ...options, externalRunning: true })).deferred, true);
    crashAfterRename(providers);
    assert.deepEqual(readProviders(), merged);
    const journal = readMigrationState(wbRoot);
    assert.equal(journal.stage, 'deferred_data_merging');
    assert.ok(fs.existsSync(path.join(journal.backupDir, 'manifest.json')));
    assert.equal((await migrateWhaleBridgeToMagpie({ ...options, externalRunning: true })).migrated, false);
    assert.deepEqual(readProviders(), merged);
    assert.deepEqual(readMigrationState(wbRoot), journal);
    const otherConfigDir = path.join(sandbox, 'other-magpie');
    await assert.rejects(migrateWhaleBridgeToMagpie({ ...options, targetConfigDir: otherConfigDir }), /配置目录已变更/);
    assert.equal(fs.existsSync(otherConfigDir), false);
    assert.deepEqual(readProviders(), merged);
    fs.writeFileSync(dshPatch, '# Updated independently\n[]\n');

    crashAfterRename(installed);
    assert.deepEqual(readProviders(), merged);
    assert.ok(JSON.parse(fs.readFileSync(installed, 'utf8')).migratedToMagpieAt);
    assert.equal(detectLegacyWhaleBridge(desktopStateDir).needsMigration, true);

    const legacyLogins = path.join(wbData, 'logins.json');
    fs.writeFileSync(legacyLogins, '{');
    await assert.rejects(migrateWhaleBridgeToMagpie(options), SyntaxError);
    assert.deepEqual(readProviders(), { shared: { name: 'Magpie' } });
    assert.equal(JSON.parse(fs.readFileSync(installed, 'utf8')).migratedToMagpieAt, undefined);
    assert.equal(readMigrationState(wbRoot).stage, 'deferred_data_merge');
    fs.unlinkSync(legacyLogins);

    assert.equal((await migrateWhaleBridgeToMagpie(options)).migrated, true);
    assert.deepEqual(readProviders(), merged);
    assert.equal(fs.readFileSync(dshPatch, 'utf8'), '# Updated independently\n[]\n');
    assert.equal(readMigrationState(wbRoot).stage, 'completed');
    assert.equal((await migrateWhaleBridgeToMagpie(options)).migrated, false);
    assert.equal(fs.readdirSync(wbRoot).some((name) => name.startsWith('migration-backup-')), false);
  });
});

test('crash recovery skips targetConfigDir restore for skipped-external-running and tolerates missing backup dst', async () => {
  await withOwnedTempDir('magpie-crash-recovery-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'config-magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    fs.mkdirSync(wbData, { recursive: true });
    fs.writeFileSync(path.join(wbData, 'providers.json'), JSON.stringify({ providers: { legacy: { name: 'L' } }, order: ['legacy'] }));
    fs.writeFileSync(path.join(wbRoot, 'installed.json'), JSON.stringify({ version: '1.2.0' }));

    fs.mkdirSync(targetConfigDir, { recursive: true });
    fs.writeFileSync(path.join(targetConfigDir, 'providers.json'), JSON.stringify({ providers: { freshExt: { name: 'Fresh' } }, order: ['freshExt'] }));

    const staleBackup = path.join(wbRoot, 'stale-backup');
    fs.mkdirSync(path.join(staleBackup, 'magpie'), { recursive: true });
    fs.writeFileSync(path.join(staleBackup, 'magpie', 'providers.json'), JSON.stringify({ providers: { oldExt: { name: 'Old' } } }));
    fs.writeFileSync(path.join(staleBackup, 'manifest.json'), JSON.stringify({
      recorded: [
        { src: path.join(targetConfigDir, 'providers.json'), dst: path.join(staleBackup, 'magpie', 'providers.json'), existed: true, kind: 'magpie' },
      ],
      createdPaths: [],
    }));
    fs.writeFileSync(path.join(wbRoot, 'migration-state.json'), JSON.stringify({
      stage: 'agents_disconnected',
      dataMode: 'skipped-external-running',
      dataMergeSkipped: 'external-running',
      backupDir: staleBackup,
    }));

    const res = await migrateWhaleBridgeToMagpie({
      desktopStateDir,
      dshHome,
      targetConfigDir,
      externalRunning: false,
    });
    assert.equal(res.migrated, true);
    const providers = JSON.parse(fs.readFileSync(path.join(targetConfigDir, 'providers.json'), 'utf8'));
    assert.ok(providers.providers.freshExt, 'must not overwrite targetConfigDir with old backup');
    assert.ok(providers.providers.legacy);

    // Missing item.dst in manifest.json must warn and not throw ENOENT
    const wbRoot2 = path.join(sandbox, 'state2', 'components', 'whalebridge');
    const wbData2 = path.join(wbRoot2, 'data');
    const target2 = path.join(sandbox, 'config-magpie-2');
    fs.mkdirSync(wbData2, { recursive: true });
    fs.mkdirSync(target2, { recursive: true });
    fs.writeFileSync(path.join(wbData2, 'providers.json'), JSON.stringify({ providers: { a: { name: 'A' } } }));
    const brokenBackup = path.join(wbRoot2, 'broken-backup');
    fs.mkdirSync(brokenBackup, { recursive: true });
    fs.writeFileSync(path.join(brokenBackup, 'manifest.json'), JSON.stringify({
      recorded: [
        { src: path.join(target2, 'providers.json'), dst: path.join(brokenBackup, 'missing-file.json'), existed: true, kind: 'magpie' },
      ],
      createdPaths: [],
    }));
    fs.writeFileSync(path.join(wbRoot2, 'migration-state.json'), JSON.stringify({
      stage: 'backed_up',
      backupDir: brokenBackup,
    }));
    const res2 = await migrateWhaleBridgeToMagpie({
      desktopStateDir: path.join(sandbox, 'state2'),
      dshHome,
      targetConfigDir: target2,
    });
    assert.equal(res2.migrated, true);
  });
});

test('cold copy rollback cleans created subdirs/files, preserves empty targetConfigDir, and handles read-only files', async () => {
  await withOwnedTempDir('magpie-cold-rollback-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'config-magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    fs.mkdirSync(path.join(wbData, 'grok', 'u1'), { recursive: true });
    fs.mkdirSync(path.join(wbData, 'claude-accounts'), { recursive: true });
    fs.writeFileSync(path.join(wbData, 'grok', 'u1', 'token.json'), '{"t":1}');
    fs.writeFileSync(path.join(wbData, 'claude-accounts', 'c1.json'), '{"c":1}');
    fs.writeFileSync(path.join(wbData, 'qoder.json'), '{"q":1}');
    fs.writeFileSync(path.join(wbData, 'providers.json'), JSON.stringify({ providers: { p: { name: 'P' } } }));
    fs.writeFileSync(path.join(wbRoot, 'installed.json'), JSON.stringify({ version: '1.2.0', entry: 'WhaleBridge-win32-x64.exe' }));
    const legacyBin = path.join(wbRoot, 'versions', '1.2.0', 'WhaleBridge-win32-x64.exe');
    fs.mkdirSync(path.dirname(legacyBin), { recursive: true });
    fs.writeFileSync(legacyBin, 'wb');

    // Pre-create empty targetConfigDir (Scenario A existing empty dir)
    fs.mkdirSync(targetConfigDir, { recursive: true });

    await assert.rejects(
      () => migrateWhaleBridgeToMagpie({
        desktopStateDir,
        dshHome,
        targetConfigDir,
        runTool: async () => { throw new Error('boom'); },
      }),
      /boom/,
    );
    assert.equal(fs.existsSync(targetConfigDir), true, 'empty targetConfigDir must be preserved');
    assert.deepEqual(fs.readdirSync(targetConfigDir), [], 'created subdirs/files must be cleaned on rollback');

    // Read-only existing file rollback must not throw EPERM
    const roFile = path.join(targetConfigDir, 'settings.json');
    fs.writeFileSync(roFile, JSON.stringify({ port: 3425 }));
    fs.chmodSync(roFile, 0o444);
    try {
      await assert.rejects(
        () => migrateWhaleBridgeToMagpie({
          desktopStateDir,
          dshHome,
          targetConfigDir,
          runTool: async () => { throw new Error('boom2'); },
        }),
        /boom2/,
      );
      const restored = JSON.parse(fs.readFileSync(roFile, 'utf8'));
      assert.equal(restored.port, 3425);
    } finally {
      try { fs.chmodSync(roFile, 0o644); } catch { /* ignore */ }
    }
  });
});

test('mergePluginsJson, mergeMigrationsJson, Scenario C completeness, externalAgentsNeedCheck, and backup cleanup', async () => {
  // Real plugins.json { plugins, config, prefer } merge
  const mergedPlugins = mergePluginsJson(
    {
      plugins: [{ spec: 'opencode-grok', options: { region: 'us' } }],
      config: { provider: { grok: { options: { keep: true } } } },
      prefer: { grok: 'opencode-grok' },
    },
    {
      plugins: [{ spec: 'opencode-grok', off: true }, { spec: 'opencode-kiro' }],
      config: { provider: { grok: { options: { keep: false, extra: 1 } }, kiro: { enabled: true } } },
      prefer: { grok: 'other-plugin', kiro: 'opencode-kiro' },
    },
  );
  assert.equal(mergedPlugins.plugins.length, 2);
  assert.equal(mergedPlugins.plugins[0].off, undefined);
  assert.equal(mergedPlugins.config.provider.grok.options.keep, true);
  assert.equal(mergedPlugins.config.provider.grok.options.extra, 1);
  assert.equal(mergedPlugins.config.provider.kiro.enabled, true);
  assert.equal(mergedPlugins.prefer.grok, 'opencode-grok');
  assert.equal(mergedPlugins.prefer.kiro, 'opencode-kiro');

  const mergedMig = mergeMigrationsJson(
    { kiro: { state: 'plugin', package: 'p-target' } },
    { kiro: { state: 'moving', package: 'p-legacy' }, grok: { state: 'plugin', package: 'p-grok' } },
  );
  assert.equal(mergedMig.kiro.package, 'p-target');
  assert.equal(mergedMig.grok.package, 'p-grok');

  // plugin-auth.json & usage.jsonl RFC3339 offset sorting + extra fingerprint fields
  const mergedAuth = mergeLoginsJson(
    { openai: { type: 'oauth', accountId: 'a1', expires: 1700000000 } },
    { openai: { type: 'oauth', accountId: 'a1', expires: 1800000000 }, anthropic: { type: 'api', key: 'k' } },
    '/wb/data',
    '/magpie',
  );
  assert.equal(mergedAuth.openai.expires, 1800000000);
  assert.equal(mergedAuth.anthropic.type, 'api');

  const usageOut = mergeUsageJsonl(
    `${JSON.stringify({ t: '2026-01-01T01:00:00+02:00', operation: 'chat', agent: 'dsh', model: 'm', provider: 'p', providerAccount: 'acc1', cache_read: 10, cache_write: 5 })}\n`,
    `${JSON.stringify({ t: '2026-01-01T00:00:00Z', operation: 'title', agent: 'dsh', model: 'm', provider: 'p', providerAccount: 'acc2', cache_read: 0, cache_write: 0 })}\n`,
  );
  const usageRows = usageOut.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(usageRows.length, 2);
  assert.equal(usageRows[0].providerAccount, 'acc1'); // 23:00Z < 00:00Z

  // Full Scenario C + missing binary externalAgentsNeedCheck + backup reclamation
  await withOwnedTempDir('magpie-scenario-c-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const dshHome = path.join(sandbox, 'dsh');
    const targetConfigDir = path.join(sandbox, 'config-magpie');
    const wbRoot = path.join(desktopStateDir, 'components', 'whalebridge');
    const wbData = path.join(wbRoot, 'data');
    fs.mkdirSync(path.join(wbData, 'grok', 'acc1'), { recursive: true });
    fs.mkdirSync(path.join(wbData, 'grok-homes', 'h1'), { recursive: true });
    fs.writeFileSync(path.join(wbData, 'grok', 'acc1', 'cred.json'), '{"tok":1}');
    fs.writeFileSync(path.join(wbData, 'grok-homes', 'h1', 'state.json'), '{"h":1}');
    fs.writeFileSync(path.join(wbData, 'settings.json'), JSON.stringify({ port: 3425 }));
    fs.writeFileSync(path.join(wbData, 'redact.key'), 'redact-secret');
    fs.writeFileSync(path.join(wbData, 'plugin-auth.json'), JSON.stringify({ kiro: { type: 'oauth', expires: 1700000100 } }));
    fs.writeFileSync(path.join(wbData, 'plugins.json'), JSON.stringify({ plugins: [{ spec: 'p-legacy' }] }));
    fs.writeFileSync(path.join(wbData, 'agents.json'), JSON.stringify(['claude-code']));
    fs.writeFileSync(path.join(wbRoot, 'installed.json'), JSON.stringify({ version: '1.2.0' })); // No binary on disk

    // Target has existing empty grok/ and providers.json, NO settings.json/redact.key
    fs.mkdirSync(path.join(targetConfigDir, 'grok'), { recursive: true });
    fs.writeFileSync(path.join(targetConfigDir, 'providers.json'), JSON.stringify({ providers: { p: { name: 'P' } } }));

    const fpBefore = fingerprintLegacyData(wbData, path.join(wbRoot, 'installed.json'));
    fs.writeFileSync(path.join(wbData, 'plugins.json'), JSON.stringify({ plugins: [{ spec: 'p-legacy' }, { spec: 'p2' }] }));
    const fpAfter = fingerprintLegacyData(wbData, path.join(wbRoot, 'installed.json'));
    assert.notEqual(fpBefore, fpAfter);

    const res = await migrateWhaleBridgeToMagpie({ desktopStateDir, dshHome, targetConfigDir });
    assert.equal(res.migrated, true);
    assert.equal(res.externalAgentsNeedCheck, true);
    assert.match(res.notice, /外部/);
    assert.ok(fs.existsSync(path.join(targetConfigDir, 'grok', 'acc1', 'cred.json')));
    assert.ok(fs.existsSync(path.join(targetConfigDir, 'grok-homes', 'h1', 'state.json')));
    assert.ok(fs.existsSync(path.join(targetConfigDir, 'settings.json')));
    assert.ok(fs.existsSync(path.join(targetConfigDir, 'redact.key')));
    assert.equal(fs.readdirSync(wbRoot).filter((n) => n.startsWith('migration-backup-')).length, 0);
  });
});

test('reconcileLegacyWhaleBridgeDir cleans cache-only dirs, archives completed un-drifted migrations, and preserves blocked/drifted dirs', async () => {
  await withOwnedTempDir('magpie-reconcile-', async (sandbox) => {
    // 1. Cache-only dir (catalog.json + logs/) -> cleaned
    const s1 = path.join(sandbox, 's1');
    const wb1 = path.join(s1, 'components', 'whalebridge');
    fs.mkdirSync(path.join(wb1, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(wb1, 'catalog.json'), '{}');
    fs.writeFileSync(path.join(wb1, 'logs', 'wb.log'), 'hi');
    const r1 = await reconcileLegacyWhaleBridgeDir({ legacyRoot: wb1, desktopStateDir: s1 });
    assert.equal(r1.action, 'cleaned-cache');
    assert.equal(fs.existsSync(wb1), false);

    // 2. Blocked stage (deferred_data_merge) -> kept untouched
    const s2 = path.join(sandbox, 's2');
    const wb2 = path.join(s2, 'components', 'whalebridge');
    fs.mkdirSync(path.join(wb2, 'data'), { recursive: true });
    fs.writeFileSync(path.join(wb2, 'data', 'providers.json'), '{}');
    fs.writeFileSync(path.join(wb2, 'migration-state.json'), JSON.stringify({ stage: 'deferred_data_merge' }));
    const r2 = await reconcileLegacyWhaleBridgeDir({ legacyRoot: wb2, desktopStateDir: s2 });
    assert.equal(r2.action, 'kept');
    assert.match(r2.reason, /deferred_data_merge/);

    // 3. Completed migration with matching fingerprint -> deletes versions/catalog/logs & archives data/installed/migration-state
    const s3 = path.join(sandbox, 's3');
    const dsh3 = path.join(sandbox, 'dsh3');
    const cfg3 = path.join(sandbox, 'cfg3');
    const wb3 = path.join(s3, 'components', 'whalebridge');
    fs.mkdirSync(path.join(wb3, 'data'), { recursive: true });
    fs.mkdirSync(path.join(wb3, 'versions', '1.2.0'), { recursive: true });
    fs.mkdirSync(path.join(wb3, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(wb3, 'catalog.json'), '{}');
    fs.writeFileSync(path.join(wb3, 'data', 'providers.json'), JSON.stringify({ providers: { p1: { name: 'P1' } } }));
    fs.writeFileSync(path.join(wb3, 'installed.json'), JSON.stringify({ version: '1.2.0' }));
    await migrateWhaleBridgeToMagpie({ desktopStateDir: s3, dshHome: dsh3, targetConfigDir: cfg3 });

    const r3 = await reconcileLegacyWhaleBridgeDir({ legacyRoot: wb3, desktopStateDir: s3 });
    assert.equal(r3.action, 'archived');
    assert.ok(r3.archiveDir);
    assert.ok(fs.existsSync(path.join(r3.archiveDir, 'data', 'providers.json')));
    assert.ok(fs.existsSync(path.join(r3.archiveDir, 'installed.json')));
    assert.ok(fs.existsSync(path.join(r3.archiveDir, 'migration-state.json')));
    assert.equal(fs.existsSync(wb3), false);

    // 4. Drifted fingerprint after completed -> kept untouched
    const s4 = path.join(sandbox, 's4');
    const wb4 = path.join(s4, 'components', 'whalebridge');
    fs.mkdirSync(path.join(wb4, 'data'), { recursive: true });
    fs.writeFileSync(path.join(wb4, 'data', 'providers.json'), JSON.stringify({ providers: { p1: { name: 'P1' } } }));
    fs.writeFileSync(path.join(wb4, 'installed.json'), JSON.stringify({ version: '1.2.0' }));
    await migrateWhaleBridgeToMagpie({ desktopStateDir: s4, dshHome: path.join(sandbox, 'dsh4'), targetConfigDir: path.join(sandbox, 'cfg4') });
    fs.writeFileSync(path.join(wb4, 'data', 'providers.json'), JSON.stringify({ providers: { p1: { name: 'Drifted' } } }));
    const r4 = await reconcileLegacyWhaleBridgeDir({ legacyRoot: wb4, desktopStateDir: s4 });
    assert.equal(r4.action, 'kept');
    assert.equal(r4.reason, 'fingerprint-drifted');

    // 5. Realpath outside desktopStateDir -> kept without error
    const outside = path.join(sandbox, 'outside-dir');
    fs.mkdirSync(outside, { recursive: true });
    const r5 = await reconcileLegacyWhaleBridgeDir({ legacyRoot: outside, desktopStateDir: s1 });
    assert.equal(r5.action, 'kept');
    assert.equal(r5.reason, 'realpath-outside-state-dir');
  });
});
