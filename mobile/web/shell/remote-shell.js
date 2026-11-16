// 镜像 mobile/android :protocol shell/RemoteShell.kt。
// 差异（有意）：Android 用 Bearer 设备令牌，Web 走同 origin Cookie `dsh_remote`（credentials: 'include'）。

const REMOTE_SHELL_NAMES = [
  'gitStatus',
  'gitFetchForStatus',
  'gitDiff',
  'gitCommit',
  'gitPush',
  'gitPull',
  'gitBranchList',
  'gitSwitchBranch',
  'gitCreateBranch',
  'gitCreateChangeRequest',
  'listDir',
  'openSettings',
  'openGallery',
  'getConfig',
  'saveConfig',
];

const NAME_SET = new Set(REMOTE_SHELL_NAMES);

class UnauthorizedError extends Error {
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.unauthorized = true;
  }
}

function apiUrl(origin, path) {
  return `${String(origin || '').replace(/\/$/, '')}${path}`;
}

async function callShell({ fetchImpl, origin, name, payload = {} }) {
  if (!NAME_SET.has(String(name || ''))) {
    throw new Error('not found');
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  const response = await fetchFn(apiUrl(origin, `/__remote__/shell/${name}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
    credentials: 'include',
  });
  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedError();
  }
  if (response.status === 404) {
    throw new Error('not found');
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`请求失败（HTTP ${response.status}）`);
  }
  if (parsed?.ok !== true) {
    throw new Error(typeof parsed?.error === 'string' && parsed.error ? parsed.error : '请求失败');
  }
  return parsed.result ?? { ok: true };
}

export { UnauthorizedError, callShell };
