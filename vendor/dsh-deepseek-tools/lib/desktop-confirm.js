/**
 * Desktop confirmation client for model tools whose side effects must pass a
 * main-process dialog. It rides the same loopback control channel the desktop
 * management tools use (DSH_DESKTOP_INSTALL_URL + Bearer token). A declined,
 * unreachable or broken confirmation channel fails closed: callers return
 * DECLINED_TEXT and do not execute the side effect.
 *
 * The Bearer token arrives over the host's stdin secret channel (#427) and
 * lives only in the in-process store — never env, so tool-spawned children
 * cannot inherit it.
 */
import { internalSecret } from '../../dsh-shared/lib/internal-secret.mjs';

const CONFIRM_TIMEOUT_MS = 240_000;

export const DECLINED_TEXT = '用户拒绝了这次操作，不要重试，除非用户再次明确要求。';
export const CHANNEL_UNAVAILABLE_TEXT = '桌面确认通道不可用（未配置桌面控制通道地址或凭据），未执行这次操作。';
export const CHANNEL_ERROR_TEXT = '桌面确认通道请求失败，未执行这次操作';

export function controlConfig() {
  const url = String(process.env.DSH_DESKTOP_INSTALL_URL ?? '').trim();
  const token = internalSecret('DSH_DESKTOP_INSTALL_TOKEN').trim();
  return url && token ? { url, token } : null;
}

/**
 * @param {number} status
 * @param {any} data
 * @returns {string}
 */
function httpErrorMessage(status, data) {
  const detail = data !== null && typeof data === 'object' && typeof data.error === 'string' ? data.error : '';
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

/**
 * @param {Response} response
 * @param {any} data
 */
function classifyConfirmPayload(response, data) {
  if (!response.ok) {
    return {
      ok: false,
      reason: 'channel-error',
      status: response.status,
      error: httpErrorMessage(response.status, data),
    };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'channel-error', status: response.status, error: '桌面确认通道返回了非对象响应' };
  }
  if (data.ok === true) {
    return { ...data, ok: true };
  }
  const error = typeof data.error === 'string' ? data.error : '';
  if (data.declined === true) {
    return { ...data, ok: false, declined: true, reason: 'declined', error: error || DECLINED_TEXT };
  }
  return { ...data, ok: false, reason: 'channel-error', error: error || '桌面确认通道未返回明确允许状态' };
}

async function post(control, pathname, body) {
  let response;
  try {
    response = await fetch(`${control.url}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${control.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      // The dialog waits on a human, so this matches the install timeout.
      signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
    });
  } catch (error) {
    // Transport errors, connection failures, and abort timeouts never grant confirmation.
    const message = error instanceof Error ? error.message : String(error || 'network failure');
    return { ok: false, reason: 'channel-error', error: message };
  }
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // Malformed or empty JSON from the control channel fails closed as a channel error.
    if (!response.ok) {
      return { ok: false, reason: 'channel-error', status: response.status, error: `HTTP ${response.status}` };
    }
    const message = error instanceof Error ? error.message : String(error || 'invalid json');
    return { ok: false, reason: 'channel-error', status: response.status, error: `无效 JSON 响应：${message}` };
  }
  return classifyConfirmPayload(response, data);
}

/**
 * Format a concise diagnostic message for failed confirmations while preserving
 * strict refusal wording when the user explicitly declined.
 * @param {{ ok?: boolean, declined?: boolean, reason?: string, error?: string, status?: number } | null | undefined} confirmation
 * @returns {string}
 */
export function confirmFailureMessage(confirmation) {
  if (confirmation?.reason === 'declined' || confirmation?.declined === true) {
    return DECLINED_TEXT;
  }
  if (confirmation?.reason === 'channel-unavailable') {
    return confirmation.error || CHANNEL_UNAVAILABLE_TEXT;
  }
  const detail = typeof confirmation?.error === 'string' && confirmation.error ? `：${confirmation.error}` : '';
  return `${CHANNEL_ERROR_TEXT}${detail}`;
}

/**
 * Ask the desktop to confirm a model-initiated action. `{ ok: true }` means
 * the user explicitly allowed it; anything else — declined, channel missing,
 * non-JSON, HTTP error — stays fail-closed with a structured `reason`.
 */
export async function confirmModelAction(request) {
  const control = controlConfig();
  if (!control) return { ok: false, reason: 'channel-unavailable', error: CHANNEL_UNAVAILABLE_TEXT };
  return post(control, '/desktop/confirm', {
    tool: String(request?.tool ?? ''),
    action: String(request?.action ?? ''),
    effect: String(request?.effect ?? ''),
    summary: String(request?.summary ?? ''),
    details: String(request?.details ?? ''),
  });
}

/**
 * Show a generated secret in a desktop dialog instead of returning it to the
 * model. `{ ok: true }` means it was displayed; otherwise the caller must not
 * put the secret into tool output.
 */
export async function showDesktopSecret(request) {
  const control = controlConfig();
  if (!control) return { ok: false, reason: 'channel-unavailable', error: CHANNEL_UNAVAILABLE_TEXT };
  return post(control, '/desktop/show-secret', {
    title: String(request?.title ?? ''),
    label: String(request?.label ?? ''),
    secret: String(request?.secret ?? ''),
    hint: String(request?.hint ?? ''),
  });
}
