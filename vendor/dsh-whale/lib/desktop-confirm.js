/**
 * Desktop confirmation client for model tools whose side effects must pass a
 * main-process dialog. It rides the same loopback control channel the desktop
 * management tools use (DSH_DESKTOP_INSTALL_URL + Bearer token). A declined,
 * unreachable, aborted, unattended-pulse, or broken confirmation channel fails
 * closed: callers return DECLINED_TEXT / UNATTENDED_REFUSAL_TEXT / ABORTED_TEXT
 * and do not execute the side effect.
 *
 * The Bearer token arrives over the host's stdin secret channel (#427) and
 * lives only in the in-process store — never env, so tool-spawned children
 * cannot inherit it.
 */
import { internalSecret } from '../../dsh-shared/lib/internal-secret.mjs';
import {
  ABORTED_TEXT,
  NON_OWNER_IM_REFUSAL_TEXT,
  UNATTENDED_REFUSAL_TEXT,
  isNonOwnerImTurn,
  isUnattendedPulseTurn,
} from './call-origin.js';

export const CONFIRM_TIMEOUT_MS = 240_000;
export const CONFIRM_TOOL_TIMEOUT_MS = 250_000;

export const DECLINED_TEXT = '用户拒绝了这次操作，不要重试，除非用户再次明确要求。';
export { ABORTED_TEXT, NON_OWNER_IM_REFUSAL_TEXT, UNATTENDED_REFUSAL_TEXT };

export function controlConfig() {
  const url = String(process.env.DSH_DESKTOP_INSTALL_URL ?? '').trim();
  const token = internalSecret('DSH_DESKTOP_INSTALL_TOKEN').trim();
  return url && token ? { url, token } : null;
}

/** @param {AbortSignal | null | undefined} signal */
function buildSignal(signal) {
  const timeout = AbortSignal.timeout(CONFIRM_TIMEOUT_MS);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, signal]) : signal;
}

/**
 * @param {{ url: string, token: string }} control
 * @param {string} pathname
 * @param {any} body
 * @param {AbortSignal | null | undefined} signal
 */
async function post(control, pathname, body, signal) {
  if (signal?.aborted) return { ok: false, aborted: true };
  let response;
  try {
    response = await fetch(`${control.url}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${control.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      // The dialog waits on a human, so this matches the install timeout,
      // while aborting immediately when the caller's tool execution cancels.
      signal: buildSignal(signal),
    });
  } catch {
    return signal?.aborted ? { ok: false, aborted: true } : { ok: false };
  }
  if (signal?.aborted) return { ok: false, aborted: true };
  try {
    const json = await response.json();
    if (signal?.aborted) return { ok: false, aborted: true };
    return json;
  } catch {
    return { ok: false };
  }
}

/**
 * Ask the desktop to confirm a model-initiated action. `{ ok: true }` means
 * the user explicitly allowed it; anything else — declined, channel missing,
 * aborted, unattended pulse turn, non-JSON, HTTP error — is a refusal.
 * @param {any} request
 * @param {AbortSignal | null | undefined} [signal]
 * @param {any} [exec]
 */
export async function confirmModelAction(request, signal, exec) {
  const effectiveSignal = signal ?? exec?.signal;
  if (effectiveSignal?.aborted) return { ok: false, aborted: true };
  if (isUnattendedPulseTurn(exec)) {
    return { ok: false, unattended: true, error: UNATTENDED_REFUSAL_TEXT };
  }
  if (isNonOwnerImTurn(exec)) {
    return { ok: false, nonOwnerIm: true, error: NON_OWNER_IM_REFUSAL_TEXT };
  }
  const control = controlConfig();
  if (!control) return { ok: false };
  return post(control, '/desktop/confirm', {
    tool: String(request?.tool ?? ''),
    action: String(request?.action ?? ''),
    effect: String(request?.effect ?? ''),
    // Optional scope narrows a run-scoped "always" grant to the exact same
    // target set (e.g. the sorted sensitive keys a config patch writes).
    scope: String(request?.scope ?? ''),
    summary: String(request?.summary ?? ''),
    details: String(request?.details ?? ''),
  }, effectiveSignal);
}

/**
 * @param {any} confirmation
 * @param {AbortSignal | null | undefined} [signal]
 */
export function refusalTextFor(confirmation, signal) {
  if (confirmation?.unattended) return UNATTENDED_REFUSAL_TEXT;
  if (confirmation?.nonOwnerIm) return NON_OWNER_IM_REFUSAL_TEXT;
  if (confirmation?.aborted || signal?.aborted) return ABORTED_TEXT;
  return DECLINED_TEXT;
}

/**
 * Show a generated secret in a desktop dialog instead of returning it to the
 * model. `{ ok: true }` means it was displayed; otherwise the caller must not
 * put the secret into tool output.
 * @param {any} request
 * @param {AbortSignal | null | undefined} [signal]
 */
export async function showDesktopSecret(request, signal) {
  const control = controlConfig();
  if (!control) return { ok: false };
  return post(control, '/desktop/show-secret', {
    title: String(request?.title ?? ''),
    label: String(request?.label ?? ''),
    secret: String(request?.secret ?? ''),
    hint: String(request?.hint ?? ''),
  }, signal);
}
