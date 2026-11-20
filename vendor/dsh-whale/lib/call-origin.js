/**
 * Independent call-origin classifier and irreversible guest/group taint detector
 * for dsh-whale tools and prompt assembly. Decouples task-card authorization,
 * paired single-owner IM readonly-brief control, and unattended pulse fail-closed
 * guards from WhaleTasks so safety holds even when WhaleTasks is unavailable.
 */

const PULSE_RPC_RE = /^whale-pulse-/u;
const IM_OWNER_PRIVATE_RPC_RE = /^[a-z0-9_]+-owner-private-[a-f0-9-]+$/iu;
const IM_NON_OWNER_RPC_RE = /^[a-z0-9_]+-(guest|none)-(private|group)-[a-f0-9-]+$/iu;
const IM_GROUP_RPC_RE = /^[a-z0-9_]+-[a-z0-9_]+-group-[a-f0-9-]+$/iu;
const IM_RPC_RE = /^(im|feishu|weixin|wecom|qq|slack|telegram|discord|whatsapp|dingtalk|office)-/u;

export const UNATTENDED_REFUSAL_TEXT = '当前是定时/观察唤醒的无人值守回合，禁止自动执行外部、代码或破坏性操作；请改用提醒告知用户由用户亲自确认。';
export const NON_OWNER_IM_REFUSAL_TEXT = '当前消息来自非主人 IM 来源，禁止授权或执行敏感操作。';
export const TAINTED_SESSION_REFUSAL_TEXT = '当前会话曾接触过访客或群聊消息，已永久隔离：禁止读取主人记忆或跨会话检索。';
export const ABORTED_TEXT = '操作已取消，未执行。';

/**
 * @param {any[]} list
 * @param {(item: any) => boolean} predicate
 */
function findLastMatching(list, predicate) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i])) return list[i];
  }
  return null;
}

/** @param {any} event */
export function isTaintingEvent(event) {
  if (!event || event.type !== 'user/message') return false;
  const source = event.data?.source ?? {};
  const rpcId = String(source.rpcId ?? '');
  if (IM_NON_OWNER_RPC_RE.test(rpcId) || IM_GROUP_RPC_RE.test(rpcId)) return true;
  const speaker = source.speaker;
  if (speaker && typeof speaker === 'object') {
    if (speaker.role === 'guest' || speaker.role === 'none') return true;
    if (speaker.chat === 'group') return true;
  }
  return false;
}

/**
 * Irreversible taint check: once any event in a session's history carries a
 * `guest`/`none` speaker or `group` chat marker, the session is permanently
 * tainted — owner memory injection and cross-session reads/search are forbidden.
 * @param {any} sessionOrAgent
 */
export function isSessionTainted(sessionOrAgent) {
  const session = sessionOrAgent?.session ?? sessionOrAgent;
  if (!session) return false;
  const events = typeof session.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : Array.isArray(session) ? session : null;
  if (!Array.isArray(events)) return false;
  return events.some((ev) => isTaintingEvent(ev));
}

/** @param {any[]} events */
function activeTurnMessage(events) {
  const start = findLastMatching(events, (/** @type {any} */ event) => event?.type === 'turn/start');
  if (!start) return null;
  const message = findLastMatching(events, (/** @type {any} */ event) => event?.type === 'user/message'
    && event.seq > start.seq
    && (event.data?.source?.kind === 'user'
      || event.data?.source?.kind === 'dsh-im:inbound'
      || event.data?.source?.plugin === 'dsh-whale'));
  if (!message) return null;
  if (events.some((/** @type {any} */ event) => event?.type === 'turn/end' && event.seq > message.seq)) return null;
  return message;
}

/** @param {any} message */
function classifyActiveMessage(message) {
  const source = message.data?.source ?? {};
  const rpcId = String(source.rpcId ?? '');
  if (source.kind === 'plugin' && source.plugin === 'dsh-whale' && (source.form === 'pulse' || PULSE_RPC_RE.test(rpcId))) {
    return { kind: 'pulse', message, reason: '' };
  }
  if (IM_NON_OWNER_RPC_RE.test(rpcId) || IM_GROUP_RPC_RE.test(rpcId) || isTaintingEvent(message)) {
    return { kind: 'im-non-owner', message, reason: NON_OWNER_IM_REFUSAL_TEXT };
  }
  if (IM_OWNER_PRIVATE_RPC_RE.test(rpcId)) return { kind: 'im-owner', message, reason: '' };
  if (source.kind === 'dsh-im:inbound') return { kind: 'im', message, reason: '' };
  if (PULSE_RPC_RE.test(rpcId)) return { kind: 'pulse', message, reason: '' };
  if (IM_RPC_RE.test(rpcId)) return { kind: 'im-unverified', message, reason: '这个 IM 入口没有后台任务身份。' };
  return { kind: 'desktop', message, reason: '' };
}

/** @param {any} exec */
export function classifyCallOrigin(exec, { selfSessionId = '' } = {}) {
  const agent = exec?.agent;
  if (selfSessionId && agent?.id && agent.id !== selfSessionId) {
    return { kind: 'foreign', message: null, reason: '只有鲸鱼娘常驻会话可管理任务。' };
  }
  const snapshotEvents = agent?.session?.snapshotEvents;
  if (typeof snapshotEvents !== 'function') {
    return { kind: 'unknown', message: null, reason: '' };
  }
  const events = snapshotEvents.call(agent.session);
  const message = Array.isArray(events) ? activeTurnMessage(events) : null;
  if (!message) {
    return { kind: 'system', message: null, reason: '程序事件或已结束回合不能授权个人任务。' };
  }
  return classifyActiveMessage(message);
}

/**
 * True when `exec` belongs to an unattended whale-pulse-* turn.
 * @param {any} exec
 */
export function isUnattendedPulseTurn(exec) {
  return classifyCallOrigin(exec).kind === 'pulse';
}

/**
 * True when `exec` originates from a non-owner IM speaker taint.
 * @param {any} exec
 */
export function isNonOwnerImTurn(exec) {
  return classifyCallOrigin(exec).kind === 'im-non-owner';
}

/**
 * Throw when the tool execution signal has already been aborted (e.g. user clicked Stop).
 * @param {AbortSignal | null | undefined} signal
 */
export function assertNotAborted(signal) {
  if (signal?.aborted) {
    throw new Error(ABORTED_TEXT);
  }
}
