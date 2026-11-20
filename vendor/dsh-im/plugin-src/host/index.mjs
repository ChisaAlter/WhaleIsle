import { apply as applyDingtalk } from './channels/dingtalk/index.mjs';
import { apply as applyDiscord } from './channels/discord/index.mjs';
import { apply as applyOffice } from './channels/office/index.mjs';
import { apply as applyFeishu } from './channels/feishu/index.mjs';
import { apply as applyQq } from './channels/qq/index.mjs';
import { apply as applySlack } from './channels/slack/index.mjs';
import { apply as applyTelegram } from './channels/telegram/index.mjs';
import { apply as applyWecom } from './channels/wecom/index.mjs';
import { apply as applyWeixin } from './channels/weixin/index.mjs';
import { apply as applyWhatsapp } from './channels/whatsapp/index.mjs';
import { installOutboundArtifactTool } from '../../src/channels/shared/semantic/artifact.mjs';
import { setImHostLanguage } from '../../src/channels/shared/i18n.mjs';
import {
  isSingleOwnerChannel,
  sharedSingleOwnerGate,
} from '../../src/channels/shared/single-owner-gate.mjs';
import { installSingleOwnerRpc } from './channels/shared/single-owner-rpc.mjs';

export const name = 'dsh-im-host';
export const inject = [
  'connection',
  'credentials',
  'webServer',
  'typertGateway',
];

function channelConfig(config, name, singleOwnerGate) {
  const channel = config[name] ?? {};
  const base = config.rpcAuthority === undefined
    ? channel
    : { ...channel, rpcAuthority: config.rpcAuthority };
  // AI Office Connector stays independent and is excluded from SingleOwnerAccessGate.
  if (!singleOwnerGate || !isSingleOwnerChannel(name) || base.singleOwnerGate !== undefined) {
    return base;
  }
  return { ...base, singleOwnerGate };
}

function channelContext(ctx) {
  // rc.1 makes client-connection's webServer dependency optional so the
  // service can also run in headless profiles. dsh-im's channel RPC helpers
  // still use the scoped owner property when registering routes; expose the
  // active service on the channel scope when the loader supplied it through
  // the unscoped service lookup.
  const webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined;
  if (webServer === undefined || typeof ctx?.extend !== 'function') {
    return ctx;
  }
  return ctx.extend({ webServer });
}

export function createImHostPlugin(internals = {}) {
  const startFeishu = internals.applyFeishu ?? applyFeishu;
  const startWeixin = internals.applyWeixin ?? applyWeixin;
  const startDingtalk = internals.applyDingtalk ?? applyDingtalk;
  const startWecom = internals.applyWecom ?? applyWecom;
  const startQq = internals.applyQq ?? applyQq;
  const startSlack = internals.applySlack ?? applySlack;
  const startTelegram = internals.applyTelegram ?? applyTelegram;
  const startDiscord = internals.applyDiscord ?? applyDiscord;
  const startOffice = internals.applyOffice ?? applyOffice;
  const startWhatsapp = internals.applyWhatsapp ?? applyWhatsapp;
  const channels = [
    ['feishu', startFeishu],
    ['weixin', startWeixin],
    ['dingtalk', startDingtalk],
    ['wecom', startWecom],
    ['qq', startQq],
    ['slack', startSlack],
    ['telegram', startTelegram],
    ['discord', startDiscord],
    ['whatsapp', startWhatsapp],
    ['office', startOffice],
  ];
  return Object.freeze({
    name,
    inject,
    async apply(ctx, config = {}) {
      setImHostLanguage(config.language ?? process.env.DSH_IM_LANGUAGE);
      const scopedCtx = channelContext(ctx);
      if (typeof ctx?.inject === 'function') {
        scopedCtx.inject(['tools', 'systemPrompt'], (artifactCtx) => {
          installOutboundArtifactTool(artifactCtx);
        });
      } else {
        installOutboundArtifactTool(scopedCtx);
      }
      const singleOwnerGate = internals.singleOwnerGate
        ?? config.singleOwnerGate
        ?? await sharedSingleOwnerGate(config.dshHome);
      if (typeof ctx?.effect === 'function') {
        ctx.effect(() => installSingleOwnerRpc(scopedCtx, singleOwnerGate, config.rpcAuthority),
          'dsh-im: single-owner access rpc');
      } else {
        installSingleOwnerRpc(scopedCtx, singleOwnerGate, config.rpcAuthority);
      }
      const logger = typeof ctx?.logger === 'function'
        ? ctx.logger(name)
        : (ctx?.logger ?? console);
      const failures = [];
      for (const [channel, start] of channels) {
        try {
          await start(scopedCtx, channelConfig(config, channel, singleOwnerGate));
        } catch (error) {
          failures.push(error);
          logger.error?.(`[dsh-im] failed to activate ${channel}; continuing with the remaining channels`, error);
        }
      }
      if (failures.length === channels.length) {
        throw new AggregateError(failures, 'dsh-im failed to activate every channel');
      }
    },
  });
}

export async function apply(ctx, config = {}) {
  return createImHostPlugin().apply(ctx, config);
}
