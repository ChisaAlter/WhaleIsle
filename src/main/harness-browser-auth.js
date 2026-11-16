'use strict';

/**
 * Main-process harness browser-session auth.
 * Electron HttpOnly cookies are invisible to Node fetch; the process must
 * redeem `?token=` itself and attach the Cookie header. The launch token is
 * one-shot, so BrowserView must load the origin after the cookie is applied
 * rather than consuming the token a second time.
 */

function cookiePairFromSetCookie(header) {
  const first = Array.isArray(header) ? header[0] : header;
  if (typeof first !== 'string' || !first.includes('=')) {
    return '';
  }
  return first.split(';')[0].trim();
}

function cookieFromResponse(response) {
  if (!response || !response.headers) {
    return '';
  }
  if (typeof response.headers.getSetCookie === 'function') {
    const listed = response.headers.getSetCookie();
    const pair = cookiePairFromSetCookie(listed);
    if (pair) {
      return pair;
    }
  }
  return cookiePairFromSetCookie(response.headers.get('set-cookie'));
}

function launchTokenFromUrl(raw) {
  try {
    const parsed = new URL(String(raw || ''));
    return parsed.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

function originFromUrl(raw) {
  const parsed = new URL(String(raw));
  return parsed.origin;
}

function loadUrlAfterRedeem(raw) {
  const parsed = new URL(String(raw));
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname || '/';
  return parsed.toString();
}

function parseCookieNameValue(pair) {
  const text = String(pair || '');
  const eq = text.indexOf('=');
  if (eq <= 0) {
    return null;
  }
  return { name: text.slice(0, eq), value: text.slice(eq + 1) };
}

/**
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 */
async function redeemBrowserSession(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const token = launchTokenFromUrl(url);
  if (!token) {
    return { cookie: '', origin: originFromUrl(url) };
  }
  const response = await fetchImpl(url, { redirect: 'manual', signal: options.signal });
  const cookie = cookieFromResponse(response);
  return { cookie, origin: originFromUrl(url), status: response.status };
}

/**
 * Feature-detect readiness: open 200 stays the rc.1 path; 401/303 + token
 * redeems a Cookie and retries the origin.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, signal?: AbortSignal }} [options]
 */
async function probeHarnessReady(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 1500;
  const callerSignal = options.signal;
  if (callerSignal?.aborted) {
    throw callerSignal.reason;
  }

  const timeoutController = new AbortController();
  const timeoutError = new Error(`harness readiness timed out after ${timeoutMs}ms`);
  timeoutError.name = 'TimeoutError';
  const timer = setTimeout(() => timeoutController.abort(timeoutError), timeoutMs);
  const onCallerAbort = () => timeoutController.abort(callerSignal.reason);
  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    if (callerSignal.aborted) {
      callerSignal.removeEventListener('abort', onCallerAbort);
      clearTimeout(timer);
      throw callerSignal.reason;
    }
  }
  const signal = timeoutController.signal;
  const throwIfCallerAborted = () => {
    if (callerSignal?.aborted) {
      throw callerSignal.reason;
    }
  };

  try {
    const first = await fetchImpl(url, { redirect: 'manual', signal });
    throwIfCallerAborted();
    if (first.ok) {
      return { ok: true, cookie: cookieFromResponse(first) };
    }
    const needsAuth = first.status === 401 || first.status === 303 || first.status === 302;
    if (!needsAuth) {
      return { ok: false, cookie: '' };
    }
    let cookie = cookieFromResponse(first);
    if (!cookie && launchTokenFromUrl(url)) {
      // Share the readiness AbortSignal: a stalled redemption must not outlive
      // the caller's readiness budget (or keep a cancelled startup alive).
      const redeemed = await redeemBrowserSession(url, { fetchImpl, signal });
      throwIfCallerAborted();
      cookie = redeemed.cookie;
    }
    if (!cookie) {
      return { ok: false, cookie: '' };
    }
    const originUrl = `${originFromUrl(url)}/`;
    const second = await fetchImpl(originUrl, {
      redirect: 'manual',
      signal,
      headers: { Cookie: cookie },
    });
    throwIfCallerAborted();
    return { ok: second.ok, cookie };
  } catch (error) {
    if (callerSignal?.aborted) {
      throw callerSignal.reason;
    }
    return { ok: false, cookie: '' };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

function isUnpublishedHarnessNpm(npm) {
  const version = String(npm || '');
  return /-(alpha|dev)(\.|$)/i.test(version);
}

/**
 * @param {{ cookies?: { set: Function } }} ses
 * @param {string} origin
 * @param {string} cookie
 */
async function applyHarnessCookieToSession(ses, origin, cookie) {
  const parsed = parseCookieNameValue(cookie);
  if (!ses || !parsed || !origin) {
    return { ok: false };
  }
  await ses.cookies.set({
    url: origin.endsWith('/') ? origin : `${origin}/`,
    name: parsed.name,
    value: parsed.value,
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/',
  });
  return { ok: true, name: parsed.name };
}

module.exports = {
  launchTokenFromUrl,
  loadUrlAfterRedeem,
  redeemBrowserSession,
  probeHarnessReady,
  isUnpublishedHarnessNpm,
  applyHarnessCookieToSession,
};
