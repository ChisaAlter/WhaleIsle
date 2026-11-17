/** Shared loopback / local-app URL checks for privileged BrowserViews. */

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']);

/**
 * True when `raw` is http(s) to an exact loopback hostname (any port/path).
 * Rejects prefix spoofs such as `http://127.0.0.1.evil` and userinfo
 * tricks such as `http://127.0.0.1@evil` or `http://evil@127.0.0.1`.
 * @param {unknown} raw
 * @returns {boolean}
 */
function isLoopbackHttpUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * True when both URLs are loopback http(s) and share an exact origin.
 * @param {unknown} raw
 * @param {unknown} expected
 * @returns {boolean}
 */
function isSameOriginLoopbackUrl(raw, expected) {
  if (!isLoopbackHttpUrl(raw) || !isLoopbackHttpUrl(expected)) return false;
  try {
    return new URL(String(raw)).origin === new URL(String(expected)).origin;
  } catch {
    return false;
  }
}

/**
 * Map `0.0.0.0` to `127.0.0.1` for actual loads (Vite/Next paste habit).
 * Other loopback hosts keep the original text. Returns null when not loopback.
 * @param {unknown} raw
 * @returns {string | null}
 */
function rewriteLoopbackLoadUrl(raw) {
  if (!isLoopbackHttpUrl(raw)) return null;
  const text = String(raw).trim();
  const parsed = new URL(text);
  if (parsed.hostname.toLowerCase() !== '0.0.0.0') return text;
  parsed.hostname = '127.0.0.1';
  return parsed.href;
}

/**
 * True when `raw` is http(s) (any host). Used before shell.openExternal so
 * denied navigations never hand file:/custom schemes to the OS opener.
 * @param {unknown} raw
 * @returns {boolean}
 */
function isHttpOrHttpsUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Absolute path under the packaged renderer tree.
 * @param {string} relativeFromRenderer
 * @param {() => string} [resolvePath]
 * @returns {string}
 */
function packagedRendererPath(relativeFromRenderer, resolvePath) {
  const resolve = resolvePath || (() => {
    const { rendererFile } = require('./paths');
    return rendererFile(relativeFromRenderer);
  });
  return path.resolve(resolve());
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function sameFilePath(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
  }
}

/**
 * True when `raw` is the packaged renderer file at `relativeFromRenderer`.
 * @param {unknown} raw
 * @param {string} relativeFromRenderer
 * @param {{ resolvePath?: () => string }} [options]
 * @returns {boolean}
 */
function isPackagedRendererFileUrl(raw, relativeFromRenderer, options = {}) {
  if (typeof raw !== 'string' || !raw.startsWith('file:')) return false;
  let candidate;
  try {
    candidate = fileURLToPath(raw);
  } catch {
    return false;
  }
  const expectedName = path.basename(relativeFromRenderer).toLowerCase();
  if (path.basename(candidate).toLowerCase() !== expectedName) return false;
  return sameFilePath(candidate, packagedRendererPath(relativeFromRenderer, options.resolvePath));
}

/**
 * Boot window stays on the packaged `boot.html` file URL. Harness content
 * lives in a separate BrowserView with its own exact-origin policy.
 * @param {unknown} raw
 * @param {{ resolveBootPath?: () => string }} [options]
 * @returns {boolean}
 */
function isLocalAppNavigationUrl(raw, options = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  return raw.startsWith('file:') && isPackagedRendererFileUrl(raw, 'boot.html', {
    resolvePath: options.resolveBootPath,
  });
}

/**
 * @param {unknown} raw
 * @param {{ resolveLauncherPath?: () => string }} [options]
 * @returns {boolean}
 */
function isLauncherNavigationUrl(raw, options = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  return raw.startsWith('file:') && isPackagedRendererFileUrl(raw, 'launcher.html', {
    resolvePath: options.resolveLauncherPath,
  });
}

/**
 * Pure policy for will-navigate: allow when the URL is permitted or equals
 * the current document (same-document reload / hash churn).
 * @param {{ nextUrl: unknown, currentUrl: unknown, allowUrl: (url: unknown) => boolean }} args
 * @returns {boolean}
 */
function shouldAllowPrivilegedNavigate({ nextUrl, currentUrl, allowUrl }) {
  if (allowUrl(nextUrl)) return true;
  return typeof nextUrl === 'string' && nextUrl === currentUrl;
}

/**
 * Pure policy for will-redirect: allow only when the target is permitted.
 * @param {{ nextUrl: unknown, allowUrl: (url: unknown) => boolean }} args
 * @returns {boolean}
 */
function shouldAllowPrivilegedRedirect({ nextUrl, allowUrl }) {
  return allowUrl(nextUrl);
}

module.exports = {
  LOOPBACK_HOSTS,
  isLoopbackHttpUrl,
  isSameOriginLoopbackUrl,
  isLocalAppNavigationUrl,
  isLauncherNavigationUrl,
  isPackagedRendererFileUrl,
  rewriteLoopbackLoadUrl,
  isHttpOrHttpsUrl,
  packagedRendererPath,
  packagedBootPath: /** @param {() => string} [resolveBootPath] */ (resolveBootPath) => packagedRendererPath('boot.html', resolveBootPath),
  packagedBootFileUrl: /** @param {() => string} [resolveBootPath] */ (resolveBootPath) => pathToFileURL(packagedRendererPath('boot.html', resolveBootPath)).href,
  packagedLauncherPath: /** @param {() => string} [resolveLauncherPath] */ (resolveLauncherPath) => packagedRendererPath('launcher.html', resolveLauncherPath),
  packagedLauncherFileUrl: /** @param {() => string} [resolveLauncherPath] */ (resolveLauncherPath) => pathToFileURL(packagedRendererPath('launcher.html', resolveLauncherPath)).href,
  shouldAllowPrivilegedNavigate,
  shouldAllowPrivilegedRedirect,
};
