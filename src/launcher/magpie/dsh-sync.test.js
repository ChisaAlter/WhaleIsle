'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const {
  detachWhaleBridgeDshChannel,
  detachMagpieDshChannels,
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
