/**
 * `bot_reply` (desktop confirm, Tool WAL, `dsh-im` / outbound bridge, pet ack)
 * and `bot_send` cross-bot delivery helpers for `bot-tools-registry.js`.
 */
import crypto from 'node:crypto';

const okOut = (/** @type {string} */ detail) => ({ ok: true, detail });
const errOut = (/** @type {string} */ detail) => ({ ok: false, detail });

const IM_SENDER_METHODS = ['sendReply', 'deliverReply', 'sendMessage', 'send', 'reply'];

/** @param {any} svc */
function extractImSender(svc) {
  if (!svc) return null;
  if (typeof svc === 'function') return { send: svc, service: svc };
  for (const method of IM_SENDER_METHODS) {
    if (typeof svc[method] === 'function') {
      return { send: (/** @type {any} */ payload) => svc[method](payload), service: svc };
    }
  }
  return null;
}

/** @param {any} runtime */
export function resolveDshImSender(runtime) {
  const ctxGet = typeof runtime?.ctx?.get === 'function' ? (/** @type {string} */ k) => runtime.ctx.get(k) : () => null;
  const candidates = [
    runtime?.imSender, runtime?.imService, runtime?.dshIm,
    ctxGet('dsh-im'), ctxGet('dshIm'), ctxGet('imDelivery'), ctxGet('imService'), ctxGet('im'),
  ];
  for (const svc of candidates) {
    const found = extractImSender(svc);
    if (found) return found;
  }
  return null;
}

/** @param {any} runtime @param {any} options */
export const resolveImOutboundBridge = (runtime, options) => (
  options?.imOutboundBridge ?? runtime?.imOutboundBridge ?? runtime?.ctx?.get?.('dshImOutboundBridge') ?? null
);

/** @param {any} payload */
export function formatReplyConfirmDetails(payload) {
  return [
    payload.text,
    payload.choices.length ? `[choices: ${payload.choices.join(' | ')}]` : '',
    payload.files.length ? `[files: ${payload.files.join(', ')}]` : '',
    payload.react ? `[react: ${payload.react}]` : '',
  ].filter(Boolean).join(' ').slice(0, 400);
}

/** @param {string} transport @param {string} channel @param {any} payload @param {any} [receipt] @param {string | null} [walId] */
function formatReplyAck(transport, channel, payload, receipt, walId = null) {
  return okOut(JSON.stringify({
    ok: true,
    delivered: true,
    transport,
    channel,
    chars: payload.text.length,
    choicesCount: payload.choices.length,
    filesCount: payload.files.length,
    ...(payload.react ? { react: payload.react } : {}),
    ...(receipt !== undefined ? { receipt } : {}),
    ...(walId ? { walId } : {}),
  }));
}

/** @param {any} entry */
function formatDeduplicatedReply(entry) {
  if (entry.status === 'committed') {
    return okOut(JSON.stringify({
      ok: true, deduplicated: true, delivered: true, walId: entry.walId, resultSummary: entry.resultSummary,
    }));
  }
  const status = entry.status === 'failed' ? 'FAILED' : 'UNKNOWN';
  return errOut(JSON.stringify({
    ok: false, deduplicated: true, delivered: false, status, walId: entry.walId,
    reason: status === 'UNKNOWN' ? 'previous_execution_unknown_no_replay' : 'previous_execution_failed',
  }));
}

/** @param {any} imSender @param {any} caller @param {any} payload @param {string | null} targetChannel @param {any} wal @param {string | null} walId */
async function deliverViaImSender(imSender, caller, payload, targetChannel, wal, walId) {
  const channel = targetChannel ?? 'im';
  try {
    const receipt = await imSender.send({
      botId: caller.bot.id,
      botName: caller.bot.name,
      sessionId: caller.sessionId,
      channel,
      externalId: caller.chat?.externalId ?? null,
      text: payload.text,
      choices: payload.choices,
      files: payload.files,
      react: payload.react,
    });
    wal?.commit(walId, { transport: 'dsh-im', channel, receipt: receipt ?? null });
    return formatReplyAck('dsh-im', channel, payload, receipt ?? null, walId);
  } catch (error) {
    const errMsg = String(/** @type {any} */ (error)?.message ?? error);
    wal?.fail(walId, errMsg);
    return errOut(`dsh-im delivery failed on channel "${channel}": ${errMsg}`);
  }
}

/** @param {any} sendFn @param {any} ctx */
async function deliverReplyViaBridge(sendFn, { caller, args, text, channel, wal, walId }) {
  const delivery = await sendFn({
    botId: caller.bot.id, sessionId: caller.sessionId, channel,
    accountId: args.accountId ?? null, chatId: args.chatId ?? null,
    replyToMessageId: args.replyToMessageId ?? null, text,
  });
  const delivered = Boolean(delivery?.ok || delivery?.delivered);
  if (delivered) {
    wal?.commit(walId, { transport: 'im', channel: delivery.channel ?? channel, messageId: delivery.messageId ?? null });
    return okOut(JSON.stringify({
      ok: true, delivered: true, transport: 'im', channel: delivery.channel ?? channel ?? 'im',
      messageId: delivery.messageId ?? null, chars: text.length, walId,
    }));
  }
  const reason = String(delivery?.error ?? delivery?.reason ?? 'im_delivery_failed');
  wal?.fail(walId, reason);
  return okOut(JSON.stringify({ ok: true, delivered: false, transport: 'im', channel: channel ?? 'external', reason, chars: text.length, walId }));
}

/** @param {any} runtime @param {any} caller @param {any} text @param {string | null} channel @param {any} wal @param {string | null} walId */
function handleMissingImBridge(runtime, caller, text, channel, wal, walId) {
  const petFallback = caller.bot.replyFallback === 'pet';
  if (petFallback) runtime.legacyCompat?.notifyPet?.('say', text.slice(0, 240));
  wal?.fail(walId, 'im_bridge_unavailable');
  return okOut(JSON.stringify({
    ok: true, delivered: false, reason: 'im_bridge_unavailable',
    petNotified: petFallback, channel: channel ?? 'external', chars: text.length, walId,
  }));
}

/** @param {any} runtime @param {any} payload @param {string} channel @param {any} wal @param {string | null} walId */
function deliverLocalPetFallback(runtime, payload, channel, wal, walId) {
  const petText = payload.text || payload.react || (payload.files.length ? `Sent ${payload.files.length} file(s)` : '');
  runtime.legacyCompat?.notifyPet?.('say', petText.slice(0, 240));
  wal?.commit(walId, { transport: 'pet', chars: payload.text.length });
  return formatReplyAck('pet', channel, payload, undefined, walId);
}

/** @param {any} runtime @param {any} caller @param {any} args @param {any} payload @param {string | null} targetChannel @param {any} options @param {any} wal @param {string | null} walId */
async function routeBotReplyDelivery(runtime, caller, args, payload, targetChannel, options, wal, walId) {
  if (targetChannel === 'pet' || targetChannel === 'desktop-pet') {
    return deliverLocalPetFallback(runtime, payload, targetChannel ?? 'pet', wal, walId);
  }
  const bridge = resolveImOutboundBridge(runtime, options);
  const sendFn = bridge?.sendText ?? bridge?.deliver;
  if (typeof sendFn === 'function') {
    return await deliverReplyViaBridge(sendFn, { caller, args, text: payload.text, channel: targetChannel, wal, walId });
  }
  const imSender = resolveDshImSender(runtime);
  if (imSender) {
    return await deliverViaImSender(imSender, caller, payload, targetChannel, wal, walId);
  }
  if (!targetChannel && !caller.chat?.externalSource) {
    return deliverLocalPetFallback(runtime, payload, 'pet', wal, walId);
  }
  if (!runtime?.hadImService) {
    return handleMissingImBridge(runtime, caller, payload.text, targetChannel, wal, walId);
  }
  wal?.fail(walId, 'dsh_im_unavailable');
  return errOut(
    `dsh-im delivery service is unavailable for external channel "${targetChannel}". Ensure the dsh-im connector plugin is running and connected, then retry.`,
  );
}

/** @param {any} runtime @param {any} caller @param {any} args @param {any} payload @param {string | null} targetChannel @param {any} options @param {(r: any, o: any) => any} resolveWal */
export async function executeBotReply(runtime, caller, args, payload, targetChannel, options, resolveWal) {
  const wal = resolveWal(runtime, options);
  let walId = null;
  if (wal) {
    const intent = wal.beginIntent({
      botId: caller.bot.id, sessionId: caller.sessionId, toolName: 'bot_reply', action: 'reply', effect: 'external',
      idempotencyKey: args.idempotencyKey ? String(args.idempotencyKey).trim() : null,
      args: { text: payload.text, channel: targetChannel, accountId: args.accountId ?? null, chatId: args.chatId ?? null },
    });
    if (intent.deduplicated) return formatDeduplicatedReply(intent.entry);
    walId = intent.entry.walId;
  }
  try {
    return await routeBotReplyDelivery(runtime, caller, args, payload, targetChannel, options, wal, walId);
  } catch (error) {
    const msg = String(/** @type {any} */ (error)?.message ?? error);
    wal?.fail(walId, msg);
    return errOut(`bot_reply delivery error: ${msg}`);
  }
}

/** @param {any} runtime @param {any} caller @param {any} args @param {(c: any) => boolean} isWorkerCtx */
function resolveBotSendTarget(runtime, caller, args, isWorkerCtx) {
  const purpose = String(args.purpose ?? '').trim();
  if (isWorkerCtx(caller) && purpose === 'handoff') {
    return { error: errOut('Coding worker sessions cannot initiate a handoff to another bot directly. Report status back to your owning bot or owner instead (purpose="status").') };
  }
  const activePeers = runtime.botsStore.listBots().filter((/** @type {any} */ b) => b.id !== caller.bot.id && !b.paused).map((/** @type {any} */ b) => b.name);
  const peerHint = activePeers.length > 0
    ? `Available active bots: ${activePeers.join(', ')}.`
    : 'No other active bots are currently available on this machine.';
  const rawTarget = String(args.toBotId ?? '').trim();
  const target = runtime.botsStore.getBot(rawTarget) ?? runtime.botsStore.getBotByName(rawTarget);
  if (!target) return { error: errOut(`Target bot not found: "${rawTarget}". ${peerHint}`) };
  if (target.id === caller.bot.id || (target.chatSessionId && target.chatSessionId === caller.sessionId)) {
    return { error: errOut(`Cannot send a bot_send message to yourself ("${caller.bot.name}") in the same chat. Handle the step directly or choose another bot. ${peerHint}`) };
  }
  if (target.paused === true) {
    return { error: errOut(`Bot "${target.name}" is currently paused and cannot accept messages. Ask the owner to resume "${target.name}" or pick another teammate. ${peerHint}`) };
  }
  const text = String(args.text ?? '').trim();
  if (!text) return { error: errOut('text is required.') };
  return { error: null, target, purpose, text };
}

/** @param {any} runtime @param {any} caller @param {any} args @param {(c: any) => boolean} isWorkerCtx @param {(rt: any, name: string, err: unknown, meta?: any) => void} reportErr */
export async function executeBotSend(runtime, caller, args, isWorkerCtx, reportErr) {
  const resolved = resolveBotSendTarget(runtime, caller, args, isWorkerCtx);
  if (resolved.error) return resolved.error;
  const { target, purpose, text } = resolved;

  const reqRes = runtime.workStore.createRequest({
    rootKey: args.rootKey || `root-${caller.sessionId}`, fromBotId: caller.bot.id, toBotId: target.id,
    purpose, depth: Number.isInteger(args.depth) ? args.depth : 1,
    sendKey: args.sendKey ?? null, record: { text, fromName: caller.bot.name },
  });
  if (reqRes.deduplicated) return okOut(JSON.stringify(reqRes));

  const home = await runtime.sessionRuntime.openHomeChat(target.id);
  const msgText = `[From bot ${caller.bot.name} (${purpose})]\n${text}`;
  runtime.workStore.setRequestOutcome(reqRes.request.messageId, 'posted');
  const deliver = Promise.resolve()
    .then(() => runtime.sessionRuntime.runSingleTurn(home.sessionId, msgText))
    .then((turn) => {
      const ok = turn?.ok !== false;
      runtime.workStore.setRequestOutcome(reqRes.request.messageId, ok ? 'delivered' : 'failed');
      if (!ok) reportErr(runtime, 'bot_send', turn?.error || 'turn-failed', { messageId: reqRes.request.messageId, toBotId: target.id });
      return { ok, reply: turn?.reply ?? '', error: ok ? null : (turn?.error || 'turn-failed') };
    }, (err) => {
      runtime.workStore.setRequestOutcome(reqRes.request.messageId, 'failed');
      reportErr(runtime, 'bot_send', err, { messageId: reqRes.request.messageId, toBotId: target.id });
      return { ok: false, reply: '', error: String(err?.message ?? err) };
    });
  if (args.awaitReply === true) return okOut(JSON.stringify({ ...reqRes, delivery: await deliver }));
  return okOut(JSON.stringify(reqRes));
}
