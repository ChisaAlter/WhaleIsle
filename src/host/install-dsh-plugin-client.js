'use strict';

/**
 * HTTP client and result helpers for install_dsh_plugin.
 * Kept free of Cordis and dsh-tools so node:test can load it.
 */

// 议题 #427：进程内密钥访问器。本文件与 install-dsh-plugin.mjs 一起被复制进
// $DSH_HOME profile 的 desktop-plugins 目录，相对路径够不到
// src/shared/secret.js，故按同一 globalThis 契约就地实现
// （canonical：src/shared/secret.js 的 internalSecret；不回退 process.env）。
function internalSecret(name) {
  const store = globalThis[Symbol.for('whaleisle.internalSecrets')];
  const value = store instanceof Map ? store.get(name) : undefined;
  return typeof value === 'string' ? value : '';
}

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const GITHUB_REF_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,254})$/;
const PACKAGE_ALLOW_BUILD_PATTERN = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GITHUB_ALLOW_BUILD_PATTERN = /^github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const GIT_ALLOW_BUILD_PATTERN = /^[A-Za-z0-9@/_.-]+@git\+https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.git$/;
const MAX_ALLOW_BUILDS = 32;

/**
 * The control channel installs marketplace plugins only: a bare github:
 * owner/repo spec with an optional #ref. Anything else (registry names,
 * tarballs, local paths, git URLs) must never reach `pnpm add`.
 * @param spec - candidate install spec.
 * @returns whether the spec is a github: owner/repo reference.
 */
function isValidGithubSpec(spec) {
  const value = String(spec || '').trim();
  const match = /^github:([^/#]+)\/([^/#]+)(?:#([^#]+))?$/.exec(value);
  if (!match) {
    return false;
  }
  const [, owner, repo, ref = ''] = match;
  if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_REPO_PATTERN.test(repo)) {
    return false;
  }
  if (owner.endsWith('-') || repo === '.' || repo === '..' || repo.endsWith('.')) {
    return false;
  }
  if (!ref) {
    return true;
  }
  return GITHUB_REF_PATTERN.test(ref)
    && !ref.includes('..')
    && !ref.includes('@{')
    && !ref.endsWith('.')
    && !ref.endsWith('/');
}

function isValidAllowBuild(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const key = value.trim();
  if (!key || key.length > 214 || key === '.' || key === '..' || key.includes('..')) {
    return false;
  }
  return isValidPackageName(key) || GITHUB_ALLOW_BUILD_PATTERN.test(key) || GIT_ALLOW_BUILD_PATTERN.test(key);
}

function isValidPackageName(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const name = value.trim();
  return Boolean(name)
    && name.length <= 214
    && name !== '.'
    && name !== '..'
    && !name.includes('..')
    && PACKAGE_ALLOW_BUILD_PATTERN.test(name);
}

/**
 * Validate pnpm allowBuilds keys: package names, `github.com/owner/repo`,
 * and `name@git+https://github.com/owner/repo.git`. Rejects bare `https://`
 * URLs, YAML, paths, and arbitrary objects from a renderer/tool call.
 * @param value - candidate allowBuilds array.
 * @returns a unique normalized array, or null when any item is invalid.
 */
function normalizeAllowBuilds(value) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_ALLOW_BUILDS) {
    return null;
  }
  const keys = [];
  const seen = new Set();
  for (const item of value) {
    if (!isValidAllowBuild(item)) {
      return null;
    }
    const key = item.trim();
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function emptyInstallResult(error, spec = '') {
  return {
    ok: false,
    declined: false,
    needsAllowBuilds: false,
    allowBuilds: [],
    spec,
    error,
    log: '',
    restarting: false,
  };
}

function normalizeInstallResult(result, spec) {
  const needsAllowBuilds = Boolean(result?.needsAllowBuilds);
  const ok = Boolean(result?.ok);
  return {
    ok,
    declined: Boolean(result?.declined),
    needsAllowBuilds,
    allowBuilds: Array.isArray(result?.allowBuilds) ? result.allowBuilds.map(String) : [],
    spec: String(result?.spec || spec || ''),
    error: String(result?.error || ''),
    log: String(result?.log || ''),
    restarting: ok && !needsAllowBuilds,
  };
}

function renderInstall(value) {
  if (value.declined) {
    return '用户拒绝了这次插件变更，不要重试，除非用户再次明确要求。';
  }
  if (value.needsAllowBuilds) {
    const keys = value.allowBuilds.length > 0 ? value.allowBuilds.join(', ') : '(unparsed)';
    return `pnpm blocked prepare scripts for ${value.spec}. Ask the user, then retry install_dsh_plugin with allowBuilds: ${keys}.`;
  }
  if (value.ok) {
    return `Installed ${value.spec} into the web profile. The desktop app will restart to load it.`;
  }
  return `Install failed for ${value.spec || '(missing spec)'}: ${value.error || 'unknown error'}`;
}

/**
 * POST one install request to the desktop control endpoint.
 * @param url - loopback base URL from DSH_DESKTOP_INSTALL_URL.
 * @param token - bearer token from DSH_DESKTOP_INSTALL_TOKEN.
 * @param spec - github:owner/repo[#sha] spec.
 * @param allowBuilds - optional pnpm allowBuilds keys.
 * @returns the desktop install result JSON.
 */
async function requestDesktopInstall(url, token, spec, allowBuilds = []) {
  const endpoint = new URL('/install', url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ spec, allowBuilds }),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`desktop install control returned non-JSON (${response.status})`);
  }
  if (body && typeof body === 'object') {
    return body;
  }
  throw new Error(`desktop install control failed (${response.status})`);
}

/**
 * Validate the spec, call the control endpoint, and normalize the result.
 * @param control - loopback URL and token.
 * @param spec - github: spec from the model.
 * @param allowBuilds - optional pnpm allowBuilds keys.
 * @param request - injectable HTTP client.
 */
async function executeInstallDshPlugin(control, spec, allowBuilds = [], request = requestDesktopInstall) {
  const trimmed = String(spec || '').trim();
  if (!trimmed) {
    return emptyInstallResult('missing install spec');
  }
  if (!isValidGithubSpec(trimmed)) {
    return emptyInstallResult('install spec must be github:owner/repo[#ref]', trimmed);
  }
  const normalizedAllowBuilds = normalizeAllowBuilds(allowBuilds);
  if (!normalizedAllowBuilds) {
    return emptyInstallResult('allowBuilds contains an invalid package key', trimmed);
  }
  const result = await request(control.url, control.token, trimmed, normalizedAllowBuilds);
  return normalizeInstallResult(result, trimmed);
}

module.exports = {
  internalSecret,
  emptyInstallResult,
  isValidGithubSpec,
  isValidAllowBuild,
  isValidPackageName,
  normalizeAllowBuilds,
  normalizeInstallResult,
  renderInstall,
  requestDesktopInstall,
  executeInstallDshPlugin,
};
