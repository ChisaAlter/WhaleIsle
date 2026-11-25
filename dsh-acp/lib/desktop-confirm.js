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
import { internalSecret } from './internal-secret.mjs';

const CONFIRM_TIMEOUT_MS = 240_000;

export const DECLINED_TEXT = '用户拒绝了这次操作，不要重试，除非用户再次明确要求。';

export function controlConfig() {
  const rawUrl = String(process.env.DSH_DESKTOP_INSTALL_URL ?? '').trim();
  const token = internalSecret('DSH_DESKTOP_INSTALL_TOKEN').trim();
  if (!rawUrl || !token) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  if (
    parsed.protocol !== 'http:'
    || !isLoopback
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    return null;
  }
  const normalizedUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return { url: normalizedUrl, token };
}

async function post(control, pathname, body, { signal } = {}) {
  if (signal?.aborted) return { ok: false };
  const timeoutSignal = AbortSignal.timeout(CONFIRM_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
  let response;
  try {
    response = await fetch(`${control.url}${pathname}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${control.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      // The dialog waits on a human, so this matches the install timeout.
      signal: requestSignal,
    });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' ? parsed : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Ask the desktop to confirm a model-initiated action. `{ ok: true }` means
 * the user explicitly allowed it; anything else — declined, channel missing,
 * non-JSON, HTTP error — is a refusal.
 */
export async function confirmModelAction(request, { signal } = {}) {
  const control = controlConfig();
  if (!control) return { ok: false };
  return post(control, '/desktop/confirm', {
    tool: String(request?.tool ?? ''),
    action: String(request?.action ?? ''),
    effect: String(request?.effect ?? ''),
    summary: String(request?.summary ?? ''),
    details: String(request?.details ?? ''),
  }, { signal });
}

/**
 * Show a generated secret in a desktop dialog instead of returning it to the
 * model. `{ ok: true }` means it was displayed; otherwise the caller must not
 * put the secret into tool output.
 */
export async function showDesktopSecret(request, { signal } = {}) {
  const control = controlConfig();
  if (!control) return { ok: false };
  return post(control, '/desktop/show-secret', {
    title: String(request?.title ?? ''),
    label: String(request?.label ?? ''),
    secret: String(request?.secret ?? ''),
    hint: String(request?.hint ?? ''),
  }, { signal });
}
