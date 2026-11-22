/**
 * Shared zero-dependency runtime primitives for managed task engines (`dsh-whale`
 * and `dsh-project`): serial queues, desktop admission permits, job/agent subtree
 * inspection & draining, delegated approval routing, and runtime error classification.
 */

const AUTH_PATTERNS = [
  /\b401\b/, /\b403\b/, /\bauth\b/i, /unauthorized/i, /forbidden/i,
  /missing[_\s-]?credential/i, /credential/i, /(?:invalid|missing)[_\s-]?api[_\s-]?key/i,
  /api[_\s-]?key[_\s-]?(?:missing|invalid|required)/i, /authentication/i,
  /token[\s_-]*expired/i, /invalid[\s_-]*token/i, /permission[_\s-]?denied/i,
];
const QUOTA_PATTERNS = [
  /\b402\b/, /\bquota\b/i, /insufficient[_\s-]?quota/i,
  /quota[_\s-]?exceeded/i, /billing/i, /payment[_\s-]?required/i, /credit/i,
];
const CONFIG_PATTERNS = [
  /\b400\b/, /\b404\b/, /invalid[_\s-]?config/i, /invalid[_\s-]?argument/i,
  /invalid[_\s-]?model/i, /model[_\s-]?not[_\s-]?found/i, /unsupported[_\s-]?model/i,
  /missing[_\s-]?provider/i, /bad[_\s-]?request/i, /invalid[_\s-]?request/i, /schema/i,
];
const ENV_PATTERNS = [
  /\benoent\b/i, /\beacces\b/i, /\beperm\b/i, /\benospc\b/i,
  /not[_\s-]?a[_\s-]?git[_\s-]?repo/i, /worktree/i, /workspace/i, /permission denied/i,
];
const TRANSIENT_PATTERNS = [
  /\b429\b/, /\b50[0234]\b/, /rate[_\s-]?limit/i, /timeout/i, /timed[_\s-]?out/i,
  /econnreset/i, /econnrefused/i, /etimedout/i, /ehostunreach/i, /network/i,
  /overloaded/i, /service[_\s-]?unavailable/i, /temporarily/i, /server/i, /transport/i, /stream/i,
];

/**
 * Strongly classify execution failures into transient vs non-retryable
 * config/auth/quota/environment errors.
 * @param {any} error
 * @returns {{ category: 'auth' | 'quota' | 'config' | 'environment' | 'transient' | 'unknown', retryable: boolean, retryRequired: boolean }}
 */
export function classifyRuntimeError(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? error ?? '');
  const combined = `${code} ${message}`;
  if (AUTH_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { category: 'auth', retryable: false, retryRequired: true };
  }
  if (QUOTA_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { category: 'quota', retryable: false, retryRequired: true };
  }
  if (CONFIG_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { category: 'config', retryable: false, retryRequired: true };
  }
  if (ENV_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { category: 'environment', retryable: false, retryRequired: true };
  }
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { category: 'transient', retryable: true, retryRequired: false };
  }
  return { category: 'unknown', retryable: true, retryRequired: false };
}

/**
 * Create an isolated promise serialization queue where individual task errors
 * propagate to the caller without stalling subsequent operations.
 */
export function createSerialQueue() {
  let tail = Promise.resolve();
  return {
    get tail() {
      return tail;
    },
    run(work) {
      const next = tail.then(work);
      tail = next.catch(() => {
        /* Caller observes rejection; queue continues for subsequent work. */
      });
      return next;
    },
  };
}

/**
 * Acquire a desktop task admission permit when `desktopTaskAdmission` is active.
 * @param {any} ctx
 * @param {string} label
 * @param {{ requireService?: boolean, unavailableMessage?: string, lockedMessage?: string }} [opts]
 */
export function beginDesktopAdmission(ctx, label, opts = {}) {
  const admission = ctx?.get?.('desktopTaskAdmission');
  if (!admission) {
    if (opts.requireService) {
      throw new Error(opts.unavailableMessage || '桌面任务准入服务不可用。');
    }
    return {
      admission: null,
      permit: null,
      isOpen: () => true,
      release: () => {},
    };
  }
  if (typeof admission.check === 'function' && !admission.check()) {
    const err = new Error(opts.lockedMessage || '桌面任务准入已锁定。');
    err.code = 'ADMISSION_LOCKED';
    throw err;
  }
  const permit = typeof admission.begin === 'function' ? admission.begin(label) : null;
  return {
    admission,
    permit,
    isOpen: () => (typeof admission.check === 'function' ? admission.check() : true),
    release: () => {
      try {
        if (typeof permit === 'function') permit();
        else if (typeof permit?.done === 'function') permit.done();
        else permit?.release?.();
      } catch {
        /* Best-effort permit release. */
      }
    },
  };
}

function ownedActiveJobs(ctx, sessionId) {
  const jobsSvc = ctx?.get?.('jobs') ?? ctx?.jobs;
  if (typeof jobsSvc?.list !== 'function' || !sessionId) return { jobsSvc: null, jobs: [] };
  let rows = [];
  try {
    rows = jobsSvc.list(sessionId) ?? [];
  } catch {
    rows = [];
  }
  const jobs = rows.filter(
    (job) => job && (!job.owner || job.owner === sessionId) && ['running', 'stopping'].includes(job.status),
  );
  return { jobsSvc, jobs };
}

/**
 * Report whether `sessionId` has a running live agent, active owned Harness
 * jobs, or an optional caller-supplied busy predicate.
 * @param {any} ctx
 * @param {string} sessionId
 * @param {() => boolean} [extraCheck]
 * @returns {boolean}
 */
export function hasSubtreeWork(ctx, sessionId, extraCheck) {
  if (!sessionId) return false;
  const agentsSvc = ctx?.get?.('agents') ?? ctx?.agents;
  if (agentsSvc?.get?.(sessionId)?.status === 'running') return true;
  if (ownedActiveJobs(ctx, sessionId).jobs.length > 0) return true;
  return typeof extraCheck === 'function' ? Boolean(extraCheck()) : false;
}

async function killOwnedJobs(jobsSvc, jobs, sessionId, killReason, waitMs, swallowWaitErrors) {
  let killed = 0;
  const waits = [];
  for (const job of jobs) {
    const jobId = job.id ?? job.spec?.id;
    if (!jobId || !jobsSvc) continue;
    try {
      if (typeof jobsSvc.kill === 'function') {
        await jobsSvc.kill(jobId, sessionId, killReason);
        killed += 1;
      }
      if (typeof jobsSvc.wait === 'function') {
        const waitPromise = jobsSvc.wait(jobId, waitMs, sessionId);
        waits.push(swallowWaitErrors ? waitPromise.catch(() => null) : waitPromise);
      }
    } catch {
      /* Continue draining remaining jobs for this session. */
    }
  }
  return { killed, waits };
}

async function drainAgentSession(ctx, sessionId, parent, cancelReason) {
  const agentsSvc = ctx?.get?.('agents') ?? ctx?.agents;
  const agent = agentsSvc?.get?.(sessionId);
  try { agent?.cancel?.(cancelReason); } catch { /* Best-effort cancel before awaiting drain. */ }
  const subagentsSvc = ctx?.get?.('subagents') ?? ctx?.subagents;
  if (parent && typeof subagentsSvc?.drainChildren === 'function') {
    await subagentsSvc.drainChildren(parent, [sessionId]);
  }
  if (agent && typeof agent.whenIdle === 'function') {
    await agent.whenIdle();
  }
}

/**
 * Cancel a session's active run, kill all owned Harness jobs, wait for them
 * to settle, and drain child subagents under `parent` if provided.
 * @param {any} ctx
 * @param {string} sessionId
 * @param {{
 *   killReason?: string,
 *   waitMs?: number,
 *   parent?: any,
 *   cancelReason?: any,
 *   swallowWaitErrors?: boolean,
 * }} [options]
 */
export async function drainAgentAndJobs(ctx, sessionId, options = {}) {
  const {
    killReason = 'stopped',
    waitMs = 30_000,
    parent = null,
    cancelReason = { kind: 'user' },
    swallowWaitErrors = true,
  } = options;
  if (!sessionId) return { killed: 0, waitResults: [] };
  const { jobsSvc, jobs } = ownedActiveJobs(ctx, sessionId);
  const { killed, waits } = await killOwnedJobs(jobsSvc, jobs, sessionId, killReason, waitMs, swallowWaitErrors);
  await drainAgentSession(ctx, sessionId, parent, cancelReason);
  const waitResults = await Promise.all(waits);
  return { killed, waitResults };
}

/**
 * Bind native Harness delegated approval for an isolated session to its owner
 * conversation (after verifying direct parent lineage).
 * @param {{ ctx: any, agent: any, owner: any, label?: string, validate?: (req: any) => any }} opts
 */
export function createDelegatedApprovalRouter({ ctx, agent, owner, label = '受管任务', validate }) {
  const approval = (typeof ctx?.get === 'function' ? ctx.get('approval') : null) || ctx?.approval || null;
  if (!approval || !agent || !owner || typeof approval.bindDelegatedRequester !== 'function') {
    return null;
  }
  if (typeof approval.policyRecord === 'function') {
    if (approval.policyRecord(agent.session)?.source !== 'delegation') {
      agent.session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
    }
  }
  if (typeof approval.enableDelegatedRequests === 'function') {
    approval.enableDelegatedRequests(agent, owner);
  }
  return approval.bindDelegatedRequester(agent, {
    owner,
    label: String(label).slice(0, 120),
    validate,
  });
}
