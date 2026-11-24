'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const {
  detectLegacyWhaleBridge,
  readMigrationState,
  rewriteAccountHomePath,
  mergeProvidersJson,
  mergeLoginsJson,
  mergeUsageJsonl,
  migrateWhaleBridgeToMagpie,
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
