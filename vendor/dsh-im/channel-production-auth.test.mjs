import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const channel of ['weixin', 'feishu', 'dingtalk', 'wecom', 'qq', 'slack', 'telegram', 'discord', 'whatsapp', 'office']) {
  test(`${channel} production assembly supplies an authenticated Host transport`, async () => {
    const { createProductionController } = await import(`./plugin-src/host/channels/${channel}/production.mjs`);
    const captured = new Error('captured Harness');
    class Store {
      async load() { return this; }
      list() { return []; }
    }
    const peer = { id: 'owner-peer', principal: { kind: 'owner' }, signal: new AbortController().signal };
    const ctx = {
      credentials: {},
      webServer: { port: 3080 },
      connection: {
        createPeer: () => peer,
        createSharedFetchHandler: () => ({ fetch: async () => new Response('{}') }),
      },
      typertGateway: {
        invoke: async () => ({}),
        wireStream: {
          open: async () => [],
          failure: (err) => ({ code: 'gateway/internal', message: err.message, details: {} }),
        },
      },
    };
    let options;
    await assert.rejects(createProductionController(ctx, {}, {
      ConfigStore: Store,
      workspaces: { reconcile() {} },
      HarnessClient: class { constructor(value) { options = value; throw captured; } },
      Controller: class {
        constructor(value) { this.options = value; }
        async initialize() { this.options.createRuntime({}); }
      },
      Runtime: class { constructor(value) { value.createHarness({ workspace: process.cwd() }); } },
    }), (error) => error === captured);
    assert.equal(typeof options.fetchImpl, 'function');
    assert.equal(typeof options.createWebSocket, 'function');
  });
}
