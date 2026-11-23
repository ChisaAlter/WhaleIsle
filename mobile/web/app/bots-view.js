// app/bots-view.js — compact mobile "大肥鱼" overview, Needs You quick-reply,
// Access approval and Group chat surface riding E2EE `dshBots.rpc`.
import { hostCall } from '../host/backend.js';
import { h } from '../ui/dom.js';

export const MOBILE_BOTS_RPC_ALLOWLIST = Object.freeze([
  'bots.list',
  'bots.items.list',
  'bots.items.detail',
  'bots.items.ownerComment',
  'bots.items.ownerStatus',
  'bots.items.ownerSnooze',
  'bots.access.list',
  'bots.access.decide',
  'bots.groups.list',
  'bots.groups.messages',
  'bots.groups.send',
  'bots.groups.approvePlan',
  'bots.budget.get',
  'bots.budget.usage',
  'bots.decisions.read',
]);

const ALLOW_SET = new Set(MOBILE_BOTS_RPC_ALLOWLIST);
const BOTS_TABS = [
  ['digest', '战报'],
  ['needs_you', '拍板'],
  ['access', '审批'],
  ['groups', '群聊'],
];

/**
 * Normalize access decisions to the canonical protocol (`granted` | `declined`).
 * @param {unknown} decision
 * @returns {'granted' | 'declined'}
 */
export function normalizeMobileAccessDecision(decision) {
  const raw = String(decision || '').trim().toLowerCase();
  if (raw === 'granted' || raw === 'approve' || raw === 'approved') return 'granted';
  return 'declined';
}

/**
 * Invoke a whitelisted `bots.*` method over E2EE `dshBots.rpc`.
 * @param {any} client
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 */
export async function callBotsRpc(client, method, params = {}) {
  const name = String(method || '').trim();
  if (!ALLOW_SET.has(name)) {
    throw new Error(`不允许的移动端大肥鱼方法：${name || '(empty)'}`);
  }
  return hostCall(client, 'dshBots.rpc', { method: name, params });
}

/**
 * Pick the first non-empty string field from a record.
 * @param {any} record
 * @param {string[]} keys
 * @param {string} [fallback]
 * @returns {string}
 */
function pickStr(record, keys, fallback = '') {
  if (!record || typeof record !== 'object') return fallback;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

/**
 * Normalize bots list payload returned by `bots.list`.
 * @param {any} raw
 * @returns {Array<{ id: string, name: string, status: string, needsYou: number, role: string }>}
 */
export function normalizeBotsList(raw) {
  /** @type {any[]} */
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.bots) ? raw.bots : []);
  return list.map((bot) => {
    const id = pickStr(bot, ['id', 'botId']);
    const rawCount = bot?.needsYouCount ?? bot?.needsYou;
    const status = pickStr(bot, ['status']) || pickStr(bot?.kickoff, ['status'], 'ready');
    return {
      id,
      name: pickStr(bot, ['name', 'displayName', 'id'], '未命名队友'),
      status,
      needsYou: Number.isFinite(Number(rawCount)) ? Number(rawCount) : 0,
      role: pickStr(bot, ['role', 'tagline']),
    };
  }).filter((bot) => Boolean(bot.id));
}

/**
 * Extract normalized work items array from `bots.items.list`.
 * @param {any} raw
 */
export function normalizeBotItems(raw) {
  /** @type {any[]} */
  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
  return rows.map((item) => ({
    uid: pickStr(item, ['uid', 'id']),
    botId: pickStr(item, ['ownerBotId', 'botId']),
    title: pickStr(item, ['title', 'summary'], '未命名事项'),
    status: pickStr(item, ['status'], 'open'),
    summary: pickStr(item, ['summary', 'note']),
    updatedAt: Number(item?.updatedAt ?? item?.createdAt ?? 0),
  })).filter((item) => Boolean(item.uid));
}

/**
 * Extract normalized access requests from `bots.access.list`.
 * @param {any} raw
 */
export function normalizeAccessRequests(raw) {
  /** @type {any[]} */
  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.requests) ? raw.requests : (Array.isArray(raw?.items) ? raw.items : []));
  return rows.map((req) => ({
    id: pickStr(req, ['id', 'requestId']),
    botId: pickStr(req, ['botId']),
    channel: pickStr(req, ['channel'], 'im'),
    sender: pickStr(req, ['senderName', 'senderId'], '外部访客'),
    note: pickStr(req, ['note', 'reason']),
    status: pickStr(req, ['status'], 'pending'),
  })).filter((req) => Boolean(req.id));
}

/**
 * Extract normalized multi-bot groups from `bots.groups.list`.
 * @param {any} raw
 */
export function normalizeBotGroups(raw) {
  /** @type {any[]} */
  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.groups) ? raw.groups : []);
  return rows.map((group) => {
    const plan = group?.pendingPlan;
    const members = Array.isArray(group?.memberBotIds) ? group.memberBotIds.length : Number(group?.memberCount ?? 0);
    return {
      id: pickStr(group, ['id', 'groupId']),
      name: pickStr(group, ['name', 'title'], '未命名群聊'),
      memberCount: Number.isFinite(members) ? members : 0,
      awaitingApproval: Boolean(group?.awaitingApproval || plan),
      pendingPlanId: pickStr(plan, ['id']) || pickStr(group, ['pendingPlanId']),
      pendingPlanSummary: pickStr(plan, ['summary']) || pickStr(group, ['pendingPlanSummary']),
    };
  }).filter((group) => Boolean(group.id));
}

/**
 * Build the 3-section mobile Digest report model:
 * 1) `needsYou` (items needing decision + pending access approvals)
 * 2) `progress` (running/open + recently completed items + teammate status)
 * 3) `fleet` (groups & pending coordinator plans + budget usage summary)
 * @param {{
 *   bots?: ReturnType<typeof normalizeBotsList>,
 *   items?: ReturnType<typeof normalizeBotItems>,
 *   access?: ReturnType<typeof normalizeAccessRequests>,
 *   groups?: ReturnType<typeof normalizeBotGroups>,
 *   budget?: any,
 * }} snapshot
 */
export function buildBotsDigest(snapshot = {}) {
  const bots = Array.isArray(snapshot.bots) ? snapshot.bots : [];
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const access = Array.isArray(snapshot.access) ? snapshot.access : [];
  const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
  const needsYouItems = items.filter((item) => item.status === 'needs_you');
  const pendingAccess = access.filter((req) => req.status === 'pending');
  const activeItems = items.filter((item) => item.status === 'in_progress' || item.status === 'open');
  const doneItems = items.filter((item) => item.status === 'done');
  const pendingPlans = groups.filter((group) => group.awaitingApproval);
  const usage = snapshot.budget && typeof snapshot.budget === 'object' ? snapshot.budget : null;
  const costUsd = Number(usage?.costUsd ?? usage?.totalCostUsd ?? 0);
  const limitUsd = Number(usage?.dailyLimitUsd ?? usage?.limitUsd ?? 0);

  return {
    needsYou: {
      count: needsYouItems.length + pendingAccess.length,
      items: needsYouItems,
      pendingAccess,
    },
    progress: {
      readyBots: bots.filter((bot) => bot.status !== 'error').length,
      totalBots: bots.length,
      activeCount: activeItems.length,
      doneCount: doneItems.length,
      recentDone: doneItems.slice(0, 3),
    },
    fleet: {
      groupCount: groups.length,
      pendingPlanCount: pendingPlans.length,
      costUsd: Number.isFinite(costUsd) ? Number(costUsd.toFixed(4)) : 0,
      dailyLimitUsd: Number.isFinite(limitUsd) && limitUsd > 0 ? limitUsd : null,
      offPeak: usage?.isOffPeak === true,
    },
  };
}

/**
 * Create a high-level mobile Bots RPC bridge over a paired daemon client.
 * @param {any} client
 */
export function createBotsBridge(client) {
  /** @param {string} method @param {Record<string, unknown>} [params] */
  const safeRead = async (method, params = {}) => {
    try {
      return await callBotsRpc(client, method, params);
    } catch {
      return null;
    }
  };

  return {
    async loadOverview() {
      const [botsRaw, itemsRaw, accessRaw, groupsRaw, budgetRaw] = await Promise.all([
        callBotsRpc(client, 'bots.list', {}),
        safeRead('bots.items.list', { includeClosed: true }),
        safeRead('bots.access.list', {}),
        safeRead('bots.groups.list', {}),
        safeRead('bots.budget.usage', {}),
      ]);
      const bots = normalizeBotsList(botsRaw);
      const items = normalizeBotItems(itemsRaw);
      const access = normalizeAccessRequests(accessRaw);
      const groups = normalizeBotGroups(groupsRaw);
      const budget = budgetRaw && typeof budgetRaw === 'object' ? budgetRaw : null;
      return {
        bots,
        items,
        access,
        groups,
        budget,
        digest: buildBotsDigest({ bots, items, access, groups, budget }),
      };
    },
    /** @param {string} uid */
    async loadItemDetail(uid) {
      const [detail, decisions] = await Promise.all([
        callBotsRpc(client, 'bots.items.detail', { uid }),
        safeRead('bots.decisions.read', { itemUid: uid }),
      ]);
      return {
        detail,
        decisions: Array.isArray(decisions?.rows) ? decisions.rows : [],
      };
    },
    /** @param {string} uid @param {string} text */
    replyItem(uid, text) {
      return callBotsRpc(client, 'bots.items.ownerComment', { uid, text: String(text || '').trim() });
    },
    /** @param {string} uid @param {string} status @param {string} [note] */
    updateItemStatus(uid, status, note = '') {
      return callBotsRpc(client, 'bots.items.ownerStatus', { uid, status, ...(note ? { note } : {}) });
    },
    /** @param {string} uid @param {number | null} until */
    snoozeItem(uid, until) {
      return callBotsRpc(client, 'bots.items.ownerSnooze', { items: [uid], until });
    },
    /** @param {string} requestId @param {unknown} decision */
    decideAccess(requestId, decision) {
      return callBotsRpc(client, 'bots.access.decide', {
        id: requestId,
        requestId,
        decision: normalizeMobileAccessDecision(decision),
      });
    },
    /** @param {string} groupId */
    loadGroupMessages(groupId) {
      return callBotsRpc(client, 'bots.groups.messages', { groupId });
    },
    /** @param {string} groupId @param {string} text */
    sendGroupMessage(groupId, text) {
      return callBotsRpc(client, 'bots.groups.send', { groupId, text: String(text || '').trim() });
    },
    /** @param {string} groupId @param {string} planId @param {boolean} [approved] */
    approveGroupPlan(groupId, planId, approved = true) {
      return callBotsRpc(client, 'bots.groups.approvePlan', { groupId, planId, approved });
    },
    /** @param {string} botId */
    getBudget(botId) {
      return callBotsRpc(client, 'bots.budget.get', { botId });
    },
  };
}

/**
 * Ensure `state.botsView` holds consistent UI state.
 * @param {any} state
 */
export function ensureBotsState(state) {
  if (!state.botsView || typeof state.botsView !== 'object') {
    state.botsView = {
      tab: 'digest',
      loading: false,
      busy: false,
      error: '',
      bots: [],
      items: [],
      access: [],
      groups: [],
      budget: null,
      digest: buildBotsDigest(),
      selectedItemUid: '',
      itemDetail: null,
      itemDecisions: [],
      selectedGroupId: '',
      groupMessages: [],
      replyDrafts: {},
      groupDraft: '',
    };
  }
  return state.botsView;
}

/** @param {any} state */
export function hasBotsSubView(state) {
  const view = state?.botsView;
  return Boolean(view && (view.selectedItemUid || view.selectedGroupId));
}

/** @param {any} state */
export function stepBackBotsView(state) {
  const view = ensureBotsState(state);
  if (view.selectedItemUid) {
    view.selectedItemUid = '';
    view.itemDetail = null;
    view.itemDecisions = [];
    return true;
  }
  if (view.selectedGroupId) {
    view.selectedGroupId = '';
    view.groupMessages = [];
    return true;
  }
  state.botsOpen = false;
  return false;
}

/** @param {HTMLElement | null} phone */
export function getBotsOverlayElement(phone) {
  if (!phone) return null;
  return phone.querySelector('[data-bots-overlay="true"]');
}

/**
 * Build a compact section card matching mobile settings visual grammar.
 * @param {string} title
 * @param {string} desc
 * @param {...(Node | null | undefined | false)} children
 */
function cardSection(title, desc, ...children) {
  const head = h('div', { class: 'set-section-head' },
    title ? h('h3', { class: 'set-section-title' }, title) : null,
    desc ? h('p', { class: 'set-section-desc' }, desc) : null,
  );
  return h('section', { class: 'set-section' }, head, ...children);
}

/**
 * @param {string} title
 * @param {string} desc
 * @param {Node | null} [trailing]
 */
function infoRow(title, desc, trailing = null) {
  return h('div', { class: 'hair' },
    h('div', { class: 'grow' },
      h('div', { class: 'hair-title' }, title),
      desc ? h('p', { class: 'row-desc' }, desc) : null,
    ),
    trailing,
  );
}

/** @param {string} text */
function badgeValue(text) {
  return h('span', { class: 'hair-value' }, text);
}

/**
 * @param {string} label
 * @param {string} cls
 * @param {() => void} onClick
 * @param {boolean} [disabled]
 */
function actionButton(label, cls, onClick, disabled = false) {
  const btn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: cls }, label));
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Render the 3-section Digest & teammate status tab.
 * @param {any} view
 * @param {(nextTab: string) => void} switchTab
 */
function renderDigestTab(view, switchTab) {
  const digest = view.digest || buildBotsDigest(view);
  const budgetText = digest.fleet.dailyLimitUsd
    ? `$${digest.fleet.costUsd} / $${digest.fleet.dailyLimitUsd}`
    : `$${digest.fleet.costUsd}`;
  const digestGroup = h('div', { class: 'group' },
    infoRow(
      '1. 需你拍板',
      `${digest.needsYou.items.length} 条事项待回复 · ${digest.needsYou.pendingAccess.length} 条访问审批`,
      actionButton('去处理', 'ghost-btn', () => switchTab(digest.needsYou.items.length ? 'needs_you' : 'access')),
    ),
    infoRow(
      '2. 舰队进展',
      `${digest.progress.readyBots}/${digest.progress.totalBots} 队友就绪 · ${digest.progress.activeCount} 进行中 · ${digest.progress.doneCount} 已完成`,
      badgeValue(`${digest.progress.doneCount} 完成`),
    ),
    infoRow(
      '3. 群聊与费用',
      `${digest.fleet.groupCount} 个群聊${digest.fleet.pendingPlanCount ? `（${digest.fleet.pendingPlanCount} 个计划待批）` : ''} · 今日 ${budgetText}`,
      actionButton('看群聊', 'ghost-btn', () => switchTab('groups')),
    ),
  );
  const botRows = view.bots.length
    ? view.bots.map((/** @type {any} */ bot) => infoRow(
      bot.name,
      bot.role || bot.status,
      badgeValue(bot.needsYou > 0 ? `${bot.needsYou} 待拍板` : bot.status),
    ))
    : [h('p', { class: 'row-desc' }, '暂未创建大肥鱼队友，可在电脑端开启或创建。')];
  return [
    cardSection('三段式战报 Digest', '概览需拍板事项、当前进展与预算群聊。', digestGroup),
    cardSection('队友状态', '', h('div', { class: 'group' }, ...botRows)),
  ];
}

/**
 * Render the `Needs You` quick-reply and decision trail tab.
 * @param {any} view
 * @param {{ onOpenDetail: (uid: string) => void, onReply: (uid: string, text: string) => void, onDone: (uid: string) => void, onSnooze: (uid: string) => void }} actions
 */
function renderNeedsYouTab(view, actions) {
  const needs = (view.items || []).filter((/** @type {any} */ item) => item.status === 'needs_you');
  if (view.selectedItemUid) {
    const item = (view.items || []).find((/** @type {any} */ row) => row.uid === view.selectedItemUid);
    const trailRows = (view.itemDecisions || []).length
      ? view.itemDecisions.map((/** @type {any} */ row) => infoRow(
        `${row.phase || 'decision'} · ${row.decision || ''}`,
        [row.actor, row.notes || row.evidence].filter(Boolean).join(' · '),
        badgeValue(String(row.ts || '').slice(11, 16)),
      ))
      : [h('p', { class: 'row-desc' }, '暂无决策轨记录。')];
    return [
      cardSection(item?.title || view.selectedItemUid, item?.summary || '事项详情',
        h('div', { class: 'group' }, ...trailRows)),
    ];
  }
  if (!needs.length) {
    return [h('p', { class: 'notice' }, '当前没有需要你拍板的事项。')];
  }
  return needs.map((/** @type {any} */ item) => {
    const input = /** @type {HTMLInputElement} */ (h('input', {
      class: 'paste',
      type: 'text',
      placeholder: '输入拍板意见并回复…',
      value: view.replyDrafts[item.uid] || '',
    }));
    input.addEventListener('input', () => { view.replyDrafts[item.uid] = input.value; });
    const rowActions = h('div', { class: 'action-row' },
      actionButton('回复', 'primary-btn', () => actions.onReply(item.uid, input.value), view.busy),
      actionButton('完成', 'ghost-btn', () => actions.onDone(item.uid), view.busy),
      actionButton('延后1h', 'ghost-btn', () => actions.onSnooze(item.uid), view.busy),
      actionButton('决策轨', 'ghost-btn', () => actions.onOpenDetail(item.uid), view.busy),
    );
    return cardSection(item.title, item.summary || '等待主人拍板', h('div', { class: 'group' }, input, rowActions));
  });
}

/**
 * Render pending Access requests with approve/decline controls.
 * @param {any} view
 * @param {(id: string, decision: 'granted' | 'declined') => void} onDecide
 */
function renderAccessTab(view, onDecide) {
  const pending = (view.access || []).filter((/** @type {any} */ req) => req.status === 'pending');
  if (!pending.length) {
    return [h('p', { class: 'notice' }, '当前没有待处理的访问审批。')];
  }
  return pending.map((/** @type {any} */ req) => cardSection(
    `${req.sender} · ${req.channel}`,
    req.note || '请求接入大肥鱼对话',
    h('div', { class: 'group' },
      h('div', { class: 'action-row' },
        actionButton('批准', 'primary-btn', () => onDecide(req.id, 'granted'), view.busy),
        actionButton('拒绝', 'danger-btn', () => onDecide(req.id, 'declined'), view.busy),
      )),
  ));
}

/**
 * Render multi-bot groups list, message stream, plan approval and quick send.
 * @param {any} view
 * @param {{ onOpenGroup: (id: string) => void, onSend: (id: string, text: string) => void, onApprovePlan: (id: string, planId: string) => void }} actions
 */
function renderGroupsTab(view, actions) {
  if (view.selectedGroupId) {
    const group = (view.groups || []).find((/** @type {any} */ g) => g.id === view.selectedGroupId);
    const msgs = Array.isArray(view.groupMessages) ? view.groupMessages : [];
    const msgNodes = msgs.length
      ? msgs.slice(-20).map((/** @type {any} */ m) => infoRow(
        String(m?.senderName || m?.author || m?.role || '成员'),
        String(m?.text || m?.content || ''),
      ))
      : [h('p', { class: 'row-desc' }, '暂无群聊消息。')];
    const input = /** @type {HTMLInputElement} */ (h('input', {
      class: 'paste',
      type: 'text',
      placeholder: '发消息到群聊…',
      value: view.groupDraft || '',
    }));
    input.addEventListener('input', () => { view.groupDraft = input.value; });
    const nodes = [];
    if (group?.awaitingApproval) {
      nodes.push(cardSection(
        '待批准协调计划',
        group.pendingPlanSummary || '协调者已产出执行计划，批准后开始并行执行。',
        actionButton('批准计划', 'primary-btn', () => actions.onApprovePlan(group.id, group.pendingPlanId), view.busy),
      ));
    }
    nodes.push(cardSection(group?.name || '群聊消息', '', h('div', { class: 'group' }, ...msgNodes)));
    nodes.push(h('div', { class: 'group' },
      input,
      actionButton('发送', 'primary-btn', () => actions.onSend(view.selectedGroupId, input.value), view.busy)));
    return nodes;
  }
  if (!view.groups.length) {
    return [h('p', { class: 'notice' }, '还没有多 Bot 群聊。')];
  }
  const rows = view.groups.map((/** @type {any} */ group) => infoRow(
    group.name,
    `${group.memberCount} 位成员${group.awaitingApproval ? ' · 待批准计划' : ''}`,
    actionButton('进入', 'ghost-btn', () => actions.onOpenGroup(group.id)),
  ));
  return [cardSection('多 Bot 群聊', '查看群消息、发指令或批准协调计划。', h('div', { class: 'group' }, ...rows))];
}

/**
 * Mount/update the drawer navigation button for opening the compact Bots view.
 * @param {{ drawer: HTMLElement | null, state: any, onOpen: () => void }} ctx
 */
export function syncBotsDrawerEntry({ drawer, state, onOpen }) {
  if (!drawer) return;
  const nav = drawer.querySelector('.drawer-nav');
  if (!nav) return;
  let btn = /** @type {HTMLButtonElement | null} */ (nav.querySelector('[data-nav-bots="true"]'));
  if (!btn) {
    btn = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button',
      class: 'drawer-nav-row',
      dataset: { navBots: 'true' },
    },
    h('span', { class: 'nav-label' }, '大肥鱼'),
    h('span', { class: 'nav-count', dataset: { navBotsCount: 'true' } }, '')));
    btn.addEventListener('click', onOpen);
    nav.append(btn);
  }
  const countEl = btn.querySelector('[data-nav-bots-count="true"]');
  const pendingCount = ensureBotsState(state).digest?.needsYou?.count || 0;
  if (countEl) countEl.textContent = pendingCount > 0 ? String(pendingCount) : '';
}

/**
 * Build the active tab's DOM nodes for the mobile Bots overlay.
 * @param {any} view
 * @param {() => void} rerender
 * @param {(fn: (bridge: ReturnType<typeof createBotsBridge>) => Promise<void>) => Promise<void>} runAction
 */
function buildBotsTabBody(view, rerender, runAction) {
  if (view.tab === 'digest') {
    return renderDigestTab(view, (nextTab) => {
      view.tab = nextTab;
      rerender();
    });
  }
  if (view.tab === 'needs_you') {
    return renderNeedsYouTab(view, {
      onOpenDetail: (uid) => {
        view.selectedItemUid = uid;
        void runAction(async (bridge) => {
          const detail = await bridge.loadItemDetail(uid);
          view.itemDetail = detail.detail;
          view.itemDecisions = detail.decisions;
        });
      },
      onReply: (uid, text) => {
        if (!String(text || '').trim()) return;
        void runAction(async (bridge) => {
          await bridge.replyItem(uid, text);
          view.replyDrafts[uid] = '';
        });
      },
      onDone: (uid) => { void runAction((bridge) => bridge.updateItemStatus(uid, 'done')); },
      onSnooze: (uid) => { void runAction((bridge) => bridge.snoozeItem(uid, Date.now() + 3600_000)); },
    });
  }
  if (view.tab === 'access') {
    return renderAccessTab(view, (id, decision) => {
      void runAction((bridge) => bridge.decideAccess(id, decision));
    });
  }
  return renderGroupsTab(view, {
    onOpenGroup: (groupId) => {
      view.selectedGroupId = groupId;
      void runAction(async (bridge) => {
        const res = await bridge.loadGroupMessages(groupId);
        view.groupMessages = Array.isArray(res?.messages) ? res.messages : (Array.isArray(res) ? res : []);
      });
    },
    onSend: (groupId, text) => {
      if (!String(text || '').trim()) return;
      void runAction(async (bridge) => {
        await bridge.sendGroupMessage(groupId, text);
        view.groupDraft = '';
        const res = await bridge.loadGroupMessages(groupId);
        view.groupMessages = Array.isArray(res?.messages) ? res.messages : (Array.isArray(res) ? res : []);
      });
    },
    onApprovePlan: (groupId, planId) => {
      void runAction((bridge) => bridge.approveGroupPlan(groupId, planId, true));
    },
  });
}

/**
 * Refresh the overview snapshot from the paired host.
 * @param {{ phone: HTMLElement | null, state: any, onBack: () => void }} ctx
 */
export async function refreshBotsOverview({ phone, state, onBack }) {
  const view = ensureBotsState(state);
  const bridge = state.chisacode?.client ? createBotsBridge(state.chisacode.client) : null;
  if (!bridge) {
    view.error = '请先通过端到端加密连接到电脑端。';
    renderBotsOverlay({ phone, state, visible: state.botsOpen === true, onBack });
    return;
  }
  view.loading = true;
  view.error = '';
  renderBotsOverlay({ phone, state, visible: state.botsOpen === true, onBack });
  try {
    const data = await bridge.loadOverview();
    Object.assign(view, data, { loading: false, error: '' });
  } catch (error) {
    view.loading = false;
    view.error = error instanceof Error ? error.message : '加载大肥鱼数据失败';
  }
  renderBotsOverlay({ phone, state, visible: state.botsOpen === true, onBack });
}

/**
 * Render and wire the compact mobile "大肥鱼" overlay inside `phone`.
 * @param {{
 *   phone: HTMLElement | null,
 *   state: any,
 *   visible: boolean,
 *   onBack: () => void,
 * }} ctx
 */
export function renderBotsOverlay({ phone, state, visible, onBack }) {
  if (!phone) return;
  let overlay = /** @type {HTMLElement | null} */ (getBotsOverlayElement(phone));
  if (!visible) {
    if (overlay) overlay.classList.add('hidden');
    return;
  }
  const view = ensureBotsState(state);
  if (!overlay) {
    overlay = /** @type {HTMLElement} */ (h('section', {
      class: 'sessions-page',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '大肥鱼',
      dataset: { botsOverlay: 'true' },
    }));
    phone.append(overlay);
  }
  overlay.classList.remove('hidden');

  const rerender = () => renderBotsOverlay({ phone, state, visible: state.botsOpen === true, onBack });
  /** @param {(bridge: ReturnType<typeof createBotsBridge>) => Promise<void>} fn */
  const runAction = async (fn) => {
    const bridge = state.chisacode?.client ? createBotsBridge(state.chisacode.client) : null;
    if (!bridge || view.busy) return;
    view.busy = true;
    view.error = '';
    rerender();
    try {
      await fn(bridge);
      await refreshBotsOverview({ phone, state, onBack });
    } catch (error) {
      view.error = error instanceof Error ? error.message : '操作失败';
    } finally {
      view.busy = false;
      rerender();
    }
  };

  const backBtn = actionButton('‹', 'icon-btn', onBack);
  backBtn.setAttribute('aria-label', '返回');
  const refreshBtn = actionButton(view.loading ? '…' : '刷新', 'ghost-btn', () => {
    void refreshBotsOverview({ phone, state, onBack });
  }, view.loading);
  const head = h('div', { class: 'set-head' }, backBtn, h('h2', null, '大肥鱼'), refreshBtn);

  const tabBar = h('div', { class: 'tiles', role: 'tablist', 'aria-label': '大肥鱼视图' },
    ...BOTS_TABS.map(([id, label]) => {
      const tabBtn = actionButton(label, 'tile', () => {
        view.tab = id;
        view.selectedItemUid = '';
        view.selectedGroupId = '';
        rerender();
      });
      tabBtn.setAttribute('aria-pressed', String(view.tab === id));
      return tabBtn;
    }));

  const bodyNodes = [
    ...(view.error ? [h('p', { class: 'error' }, view.error)] : []),
    ...buildBotsTabBody(view, rerender, runAction),
  ];
  const content = h('div', { class: 'options surface-content' }, tabBar, ...bodyNodes);
  overlay.replaceChildren(head, content);
}
