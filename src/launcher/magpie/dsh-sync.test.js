'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('yaml');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const {
  detachWhaleBridgeDshChannel,
  detachMagpieDshChannels,
  ensureMagpieCredentialRef,
  readDshDefaultModel,
  remapDshDefaultModel,
  syncDshToMagpieGateway,
} = require('./dsh-sync');

test('syncDshToMagpieGateway upserts magpie channels while preserving user providers and foreign refs', async () => {
  await withOwnedTempDir('magpie-dsh-sync-', async (dshHome) => {
    const patchFile = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
    fs.writeFileSync(patchFile, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      custom-openai:',
      '        api: openai-completions',
      '        baseUrl: https://api.example.com/v1',
    ].join('\n'));

    const res = await syncDshToMagpieGateway({
      dshHome,
      gatewayAddr: '127.0.0.1:3425',
      fetchJson: async () => ({
        data: [
          { id: 'gpt-5', api: 'openai-responses', context_window: 128000, max_tokens: 8192 },
          { id: 'claude-sonnet', api: 'anthropic-messages', context_window: 200000, max_tokens: 8192 },
          { id: 'deepseek-chat', api: 'openai-completions', compaction_threshold: 0.75 },
        ],
      }),
    });
    assert.equal(res.synced, true);
    assert.equal(res.modelCount, 3);

    const yaml = fs.readFileSync(patchFile, 'utf8');
    assert.match(yaml, /custom-openai:/);
    assert.match(yaml, /magpie:/);
    assert.match(yaml, /magpie-responses:/);
    assert.match(yaml, /magpie-anthropic:/);
    assert.match(yaml, /apiKeyEnv: MAGPIE_GATEWAY_KEY/);
    const creds = fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8');
    assert.match(creds, /^version:\s*1$/m);
    assert.match(creds, /^refs:$/m);
    assert.match(creds, /MAGPIE_GATEWAY_KEY:\s*"?magpie"?/);

    // Detaching removes only owned Magpie channels, keeping custom-openai intact
    detachMagpieDshChannels(dshHome);
    const detached = fs.readFileSync(patchFile, 'utf8');
    assert.match(detached, /custom-openai:/);
    assert.doesNotMatch(detached, /MAGPIE_GATEWAY_KEY/);
  });
});

test('detachWhaleBridgeDshChannel and remapDshDefaultModel preserve non-whalebridge defaults', async () => {
  await withOwnedTempDir('magpie-dsh-remap-', async (dshHome) => {
    const patchFile = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
    const credsFile = path.join(dshHome, '.credentials.yaml');
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
    fs.writeFileSync(patchFile, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      whalebridge:',
      '        api: openai-completions',
      '        baseUrl: http://127.0.0.1:19450/v1',
      '        apiKeyEnv: WHALEBRIDGE_GATEWAY_KEY',
      '      other:',
      '        api: openai-completions',
      '- id: agent-default-model',
      '  config:',
      '    provider: whalebridge',
      '    model: claude-3-7',
    ].join('\n'));
    fs.writeFileSync(credsFile, 'WHALEBRIDGE_GATEWAY_KEY: "old"\nOTHER_KEY: "keep"\n');

    assert.deepEqual(readDshDefaultModel(dshHome), { provider: 'whalebridge', model: 'claude-3-7', reasoningEffort: '' });
    detachWhaleBridgeDshChannel(dshHome);
    assert.doesNotMatch(fs.readFileSync(patchFile, 'utf8'), /whalebridge:\r?\n/);
    assert.match(fs.readFileSync(patchFile, 'utf8'), /other:/);
    assert.doesNotMatch(fs.readFileSync(credsFile, 'utf8'), /WHALEBRIDGE_GATEWAY_KEY/);
    assert.match(fs.readFileSync(credsFile, 'utf8'), /OTHER_KEY/);

    assert.equal(remapDshDefaultModel(dshHome, 'whalebridge', 'magpie'), true);
    assert.deepEqual(readDshDefaultModel(dshHome), { provider: 'magpie', model: 'claude-3-7', reasoningEffort: '' });
  });
});

test('syncDshToMagpieGateway throws on non-ok /v1/models and preserves existing cordis.patch.yml models', async () => {
  await withOwnedTempDir('magpie-dsh-fail-', async (dshHome) => {
    const patchFile = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
    const initial = [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      magpie:',
      '        api: openai-completions',
      '        baseUrl: http://127.0.0.1:3425/v1',
      '        apiKeyEnv: MAGPIE_GATEWAY_KEY',
      '        models:',
      '        - id: "keep-me"',
      '',
    ].join('\n');
    fs.writeFileSync(patchFile, initial);

    await assert.rejects(
      () => syncDshToMagpieGateway({
        dshHome,
        gatewayAddr: '127.0.0.1:3425',
        fetchImpl: async () => new Response('unauthorized', { status: 401 }),
      }),
      /HTTP 401/,
    );
    assert.equal(fs.readFileSync(patchFile, 'utf8'), initial);

    await assert.rejects(
      () => syncDshToMagpieGateway({
        dshHome,
        gatewayAddr: 'evil.example:3425',
        fetchImpl: async () => { throw new Error('must not fetch'); },
      }),
      /非回环/,
    );
  });
});

test('ensureMagpieCredentialRef writes version: 1 and losslessly migrates legacy unversioned credentials files', async () => {
  // 1. Fresh file includes version: 1 and refs.MAGPIE_GATEWAY_KEY
  await withOwnedTempDir('magpie-creds-new-', async (dshHome) => {
    assert.equal(ensureMagpieCredentialRef(dshHome), true);
    const text = fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8');
    assert.equal(text, 'version: 1\nrefs:\n  MAGPIE_GATEWAY_KEY: magpie\n');
  });

  // 2. Unversioned refs-only file (from older dsh-sync) gets version: 1 prepended without losing values
  await withOwnedTempDir('magpie-creds-unversioned-refs-', async (dshHome) => {
    const file = path.join(dshHome, '.credentials.yaml');
    fs.writeFileSync(file, 'refs:\n  MAGPIE_GATEWAY_KEY: magpie\n  USER_KEY: "keep-secret"\n');
    assert.equal(ensureMagpieCredentialRef(dshHome), true);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, 'version: 1\nrefs:\n  MAGPIE_GATEWAY_KEY: magpie\n  USER_KEY: "keep-secret"\n');
  });

  // 3. Pre-release flat layout is nested under version: 1 + refs: while preserving all existing entries
  await withOwnedTempDir('magpie-creds-flat-', async (dshHome) => {
    const file = path.join(dshHome, '.credentials.yaml');
    fs.writeFileSync(file, '# user comment\nOPENAI_API_KEY: "sk-test-1"\nDEEPSEEK_API_KEY: sk-test-2\n');
    assert.equal(ensureMagpieCredentialRef(dshHome), true);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^version: 1\nrefs:\n/);
    assert.match(text, /  MAGPIE_GATEWAY_KEY: magpie\n/);
    assert.match(text, /  # user comment\n/);
    assert.match(text, /  OPENAI_API_KEY: "sk-test-1"\n/);
    assert.match(text, /  DEEPSEEK_API_KEY: sk-test-2\n/);
  });

  // 4. Flat layout with custom MAGPIE_GATEWAY_KEY migrates to version: 1 without clobbering user value
  await withOwnedTempDir('magpie-creds-custom-', async (dshHome) => {
    const file = path.join(dshHome, '.credentials.yaml');
    fs.writeFileSync(file, 'MAGPIE_GATEWAY_KEY: "custom-val"\nOTHER_KEY: keep\n');
    assert.equal(ensureMagpieCredentialRef(dshHome), false);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, 'version: 1\nrefs:\n  MAGPIE_GATEWAY_KEY: "custom-val"\n  OTHER_KEY: keep\n');
  });

  // 5. Flow mapping refs: { OTHER: "x" } + comment containing version: + --- directive
  await withOwnedTempDir('magpie-creds-flow-', async (dshHome) => {
    const file = path.join(dshHome, '.credentials.yaml');
    fs.writeFileSync(file, '---\n# version: 99\nrefs: { OTHER: "x" } # keep comment\n');
    assert.equal(ensureMagpieCredentialRef(dshHome), true);
    const text = fs.readFileSync(file, 'utf8');
    const parsed = parseDocument(text, { uniqueKeys: true });
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.get('version'), 1);
    assert.equal(parsed.getIn(['refs', 'MAGPIE_GATEWAY_KEY']), 'magpie');
    assert.equal(parsed.getIn(['refs', 'OTHER']), 'x');
  });

  // 6. Flat layout with --- and comment containing version:
  await withOwnedTempDir('magpie-creds-directive-flat-', async (dshHome) => {
    const file = path.join(dshHome, '.credentials.yaml');
    fs.writeFileSync(file, '---\n# version: 1\nOPENAI_API_KEY: "sk-flat"\n');
    assert.equal(ensureMagpieCredentialRef(dshHome), true);
    const text = fs.readFileSync(file, 'utf8');
    const parsed = parseDocument(text, { uniqueKeys: true });
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.get('version'), 1);
    assert.equal(parsed.getIn(['refs', 'MAGPIE_GATEWAY_KEY']), 'magpie');
    assert.equal(parsed.getIn(['refs', 'OPENAI_API_KEY']), 'sk-flat');
  });
});

test('syncDshToMagpieGateway handles config: {}, 4-space indent, custom gateway key, home patch cleanup, and lock contention', async () => {
  await withOwnedTempDir('magpie-dsh-ast-', async (dshHome) => {
    const profilePatch = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
    const homePatch = path.join(dshHome, 'cordis.patch.yml');
    const credsFile = path.join(dshHome, '.credentials.yaml');
    fs.mkdirSync(path.dirname(profilePatch), { recursive: true });
    // config: {} flow mapping + foreign custom-provider
    fs.writeFileSync(profilePatch, '- name: "LLM"\n  id: \'llm-pi-ai\' # tail comment\n  config: {}\n');
    // Stale home-level magpie block overriding port
    fs.writeFileSync(homePatch, [
      '- id: llm-pi-ai',
      '  config:',
      '      providers:',
      '          \'magpie\': # stale',
      '              api: openai-completions',
      '              baseUrl: http://127.0.0.1:19999/v1',
      '              apiKeyEnv: MAGPIE_GATEWAY_KEY',
      '          keep-me:',
      '              api: openai-completions',
    ].join('\n'));
    fs.writeFileSync(credsFile, 'version: 1\nrefs:\n  MAGPIE_GATEWAY_KEY: "rotated-secret"\n');

    const authHeaders = [];
    let fetchFinishedBeforeLock = false;
    const lockPath = path.join(dshHome, 'profiles', 'web', 'package.json.lock');

    const res = await syncDshToMagpieGateway({
      dshHome,
      gatewayAddr: '127.0.0.1:4555',
      fetchJson: async (_url, init) => {
        authHeaders.push(init?.headers?.Authorization);
        // Must NOT hold profile lock during network fetch
        fetchFinishedBeforeLock = !fs.existsSync(lockPath);
        return { data: [{ id: 'gpt-5', api: 'openai-completions' }] };
      },
    });
    assert.equal(res.synced, true);
    assert.equal(fetchFinishedBeforeLock, true);
    assert.deepEqual(authHeaders, ['Bearer rotated-secret']);

    const profileDoc = parseDocument(fs.readFileSync(profilePatch, 'utf8'), { uniqueKeys: true });
    assert.equal(profileDoc.errors.length, 0);
    assert.equal(profileDoc.getIn([0, 'config', 'providers', 'magpie', 'baseUrl']), 'http://127.0.0.1:4555/v1');

    const homeDoc = parseDocument(fs.readFileSync(homePatch, 'utf8'), { uniqueKeys: true });
    assert.equal(homeDoc.errors.length, 0);
    assert.equal(homeDoc.getIn([0, 'config', 'providers', 'magpie']), undefined);
    assert.ok(homeDoc.getIn([0, 'config', 'providers', 'keep-me']));
    assert.equal(fs.existsSync(lockPath), false);
  });

  // detachChannels cleans .credentials.yaml even when cordis.patch.yml is already clean,
  // and handles single quotes / comments / name-before-id blocks
  await withOwnedTempDir('magpie-dsh-detach-indep-', async (dshHome) => {
    const profilePatch = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
    const credsFile = path.join(dshHome, '.credentials.yaml');
    fs.mkdirSync(path.dirname(profilePatch), { recursive: true });
    fs.writeFileSync(profilePatch, '[]\n');
    fs.writeFileSync(credsFile, 'version: 1\nrefs:\n  WHALEBRIDGE_GATEWAY_KEY: old-key\n  KEEP_KEY: ok\n');

    const res1 = detachWhaleBridgeDshChannel(dshHome);
    assert.equal(res1.changed, true);
    const credsDoc = parseDocument(fs.readFileSync(credsFile, 'utf8'), { uniqueKeys: true });
    assert.equal(credsDoc.errors.length, 0);
    assert.equal(credsDoc.getIn(['refs', 'WHALEBRIDGE_GATEWAY_KEY']), undefined);
    assert.equal(credsDoc.getIn(['refs', 'KEEP_KEY']), 'ok');

    // Single quotes, comments, name before id, and list items aligned at same indent under models:
    fs.writeFileSync(profilePatch, [
      "- name: 'LLM'",
      "  id: 'llm-pi-ai' # comment",
      '  config:',
      '    providers:',
      "      'whalebridge': # tail",
      '        apiKeyEnv: WHALEBRIDGE_GATEWAY_KEY # key',
      '        models:',
      '        - id: m1',
      '      other:',
      '        api: openai-completions',
    ].join('\n'));
    const res2 = detachWhaleBridgeDshChannel(dshHome);
    assert.equal(res2.changed, true);
    const patchDoc = parseDocument(fs.readFileSync(profilePatch, 'utf8'), { uniqueKeys: true });
    assert.equal(patchDoc.errors.length, 0);
    assert.equal(patchDoc.getIn([0, 'config', 'providers', 'whalebridge']), undefined);
    assert.ok(patchDoc.getIn([0, 'config', 'providers', 'other']));
  });

  // Dead-PID takeover + active-PID contention on .credentials.yaml.lock
  await withOwnedTempDir('magpie-dsh-lock-', async (dshHome) => {
    const credsFile = path.join(dshHome, '.credentials.yaml');
    const lockFile = `${credsFile}.lock`;
    // 1. Dead PID (99999999) lock is taken over automatically
    fs.writeFileSync(lockFile, '99999999\n');
    assert.equal(ensureMagpieCredentialRef(dshHome), true);
    assert.equal(fs.existsSync(lockFile), false);

    // 2. Live PID (process.pid) contention causes timeout
    const { withFileLockSync } = require('./dsh-sync');
    fs.writeFileSync(lockFile, `${process.pid}\n`);
    assert.throws(
      () => withFileLockSync(credsFile, () => {}, { waitMs: 60 }),
      /FILE_LOCK_TIMEOUT|timed out/,
    );
    fs.rmSync(lockFile, { force: true });
  });
});
