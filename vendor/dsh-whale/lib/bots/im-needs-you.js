/**
 * IM Outbound Bridge resolution and Needs You card callback handling for `BotsRuntime`.
 */
import { botItemSnoozePresets } from '../../src/shared/bot-items.js';

const IM_OUTBOUND_BRIDGE_SYMBOL = Symbol.for('whaleisle.dsh-im.bot-outbound-bridge');
const IM_OUTBOUND_BRIDGE_LISTENERS_SYMBOL = Symbol.for('whaleisle.dsh-im.bot-outbound-bridge.listeners');

/** @param {any} ctx @param {string} key */
function readCtxService(ctx, key) {
  if (!ctx || typeof ctx !== 'object') return null;
  try {
    return typeof ctx.get === 'function' ? (ctx.get(key) ?? null) : (ctx[key] ?? null);
  } catch {
    return null;
  }
}

/** @param {{ explicitBridge?: any, ctx?: any }} [params] */
export function resolveRawImOutboundBridge({ explicitBridge = null, ctx = null } = {}) {
  return (
    explicitBridge
    ?? readCtxService(ctx, 'botOutboundBridge')
    ?? readCtxService(ctx, 'dshImOutboundBridge')
    ?? /** @type {Record<symbol, any>} */ (globalThis)[IM_OUTBOUND_BRIDGE_SYMBOL]
    ?? null
  );
}

/** @param {any} event */
function parseNeedsYouKind(event) {
  if (event?.kind === 'approve' || event?.action === 'needs_you_approve') return 'approve';
  if (event?.kind === 'snooze' || event?.action === 'needs_you_snooze') return 'snooze';
  return null;
}

/** @param {any} rt @param {any} item @param {{ kind: 'owner', device: string }} actor */
function snoozeNeedsYouItem(rt, item, actor) {
  const now = Date.now();
  const presetAt = botItemSnoozePresets(now)?.[0]?.at;
  const until = Number.isInteger(presetAt) && presetAt > now ? presetAt : now + 3 * 60 * 60 * 1000;
  rt.itemsStore.ownerSnooze({ items: [{ uid: item.uid }], until }, actor, now);
  rt.eventBus?.emit({ botIds: [item.ownerBotId], kinds: ['items'] });
  return {
    ok: true,
    handled: true,
    action: 'needs_you_snooze',
    kind: 'snooze',
    itemUid: item.uid,
    status: item.status,
    snoozedUntil: until,
  };
}

/** @param {any} rt */
function triggerApproveOwedMail(rt) {
  const fn = rt.hasCustomWakeBot
    ? rt.mailReconciler?.reconcileOwedMail
    : rt.sessionRuntime?.sendOwedMail;
  if (typeof fn !== 'function') return;
  void Promise.resolve()
    .then(() => (rt.isClosed?.() ? null : fn()))
    .catch((error) => { rt.onError?.(error, { phase: 'im_needs_you_approve' }); });
}

/** @param {any} rt @param {any} item @param {{ kind: 'owner', device: string }} actor @param {any} event */
function approveNeedsYouItem(rt, item, actor, event) {
  const reqId = event?.messageId ? `im-approve:${String(event.messageId)}` : undefined;
  if (item.status === 'needs_you') {
    if (item.questionEvent) {
      rt.itemsStore.ownerComment(
        item.uid,
        { text: 'Owner approved via IM card.', ...(reqId ? { requestId: reqId } : {}) },
        actor,
      );
    }
    const current = rt.itemsStore.get(item.uid);
    if (current?.status === 'needs_you') {
      rt.itemsStore.ownerStatus([item.uid], { status: 'working', note: 'Owner approved via IM card.' }, actor);
    }
  } else if (item.status === 'planned') {
    rt.itemsStore.ownerStatus([item.uid], { status: 'working', note: 'Owner approved via IM card.' }, actor);
  }
  const updated = rt.itemsStore.get(item.uid);
  rt.eventBus?.emit({ botIds: [item.ownerBotId], kinds: ['items'] });
  triggerApproveOwedMail(rt);
  return {
    ok: true,
    handled: true,
    action: 'needs_you_approve',
    kind: 'approve',
    itemUid: item.uid,
    status: updated?.status ?? 'working',
  };
}

/**
 * Execute an IM `needs_you_approve` / `needs_you_snooze` callback against `BotsRuntime`.
 * @param {any} rt
 * @param {any} event
 */
export function handleImNeedsYouAction(rt, event) {
  if (!rt || rt.isClosed?.()) return { handled: false };
  const kind = parseNeedsYouKind(event);
  const itemUid = String(event?.itemUid ?? '').trim();
  if (!kind || !itemUid) {
    return { ok: false, handled: false, code: 'invalid_argument', error: 'itemUid and valid action are required.' };
  }
  const item = rt.itemsStore?.get?.(itemUid);
  if (!item) {
    return { ok: false, handled: true, code: 'not_found', error: '未找到对应的工作事项，可能已被移除。' };
  }
  if (item.status === 'done' || item.status === 'canceled') {
    return { ok: false, handled: true, code: 'item_closed', error: `该事项当前已处于 ${item.status} 状态，无需重复操作。` };
  }
  /** @type {{ kind: 'owner', device: string }} */
  const actor = { kind: 'owner', device: event?.channel ? `im:${String(event.channel)}` : 'im' };
  return kind === 'snooze'
    ? snoozeNeedsYouItem(rt, item, actor)
    : approveNeedsYouItem(rt, item, actor, event);
}

/** @returns {Set<(bridge: any) => void>} */
function ensureBridgeListeners() {
  const store = /** @type {Record<symbol, any>} */ (globalThis);
  let listeners = store[IM_OUTBOUND_BRIDGE_LISTENERS_SYMBOL];
  if (!(listeners instanceof Set)) {
    listeners = new Set();
    store[IM_OUTBOUND_BRIDGE_LISTENERS_SYMBOL] = listeners;
  }
  return listeners;
}

/**
 * Register a Needs You callback handler on the active `dsh-im` outbound bridge
 * (and track late bridge activation in host mode) with symmetric cleanup.
 * @param {{ ctx?: any, explicitBridge?: any, getRuntime: () => any }} params
 */
export function bindImNeedsYouActionHandler({ ctx = null, explicitBridge = null, getRuntime }) {
  /** @type {any} */
  let boundBridge = null;
  /** @type {(() => void) | null} */
  let disposeCurrent = null;
  let disposed = false;
  const handler = async (/** @type {any} */ event) => handleImNeedsYouAction(getRuntime(), event);

  /** @param {any} bridge */
  const attachTo = (bridge) => {
    if (disposed || bridge === boundBridge) return;
    try { disposeCurrent?.(); } catch { /* Best-effort cleanup. */ }
    disposeCurrent = null;
    boundBridge = bridge ?? null;
    if (typeof boundBridge?.registerActionHandler === 'function') {
      disposeCurrent = boundBridge.registerActionHandler(handler);
    }
  };

  attachTo(resolveRawImOutboundBridge({ explicitBridge, ctx }));

  /** @type {((bridge: any) => void) | null} */
  let listener = null;
  if (!explicitBridge) {
    listener = (nextBridge) => {
      attachTo(nextBridge ?? resolveRawImOutboundBridge({ explicitBridge: null, ctx }));
    };
    ensureBridgeListeners().add(listener);
  }

  return () => {
    disposed = true;
    if (listener) {
      ensureBridgeListeners().delete(listener);
      listener = null;
    }
    try { disposeCurrent?.(); } catch { /* Best-effort cleanup. */ }
    disposeCurrent = null;
    boundBridge = null;
  };
}
