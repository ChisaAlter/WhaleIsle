function hostErrorText(error) {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return '';
}

function unwrapHost(result) {
  if (result && result.ok === true) return result.value;
  const message = hostErrorText(result?.error) || '电脑没有响应';
  throw new Error(message);
}

async function hostCall(client, method, payload = {}) {
  if (!client || typeof client.hostRpc !== 'function') {
    throw new Error('桌面端未启动');
  }
  return unwrapHost(await client.hostRpc(method, payload));
}

function unwrapGitValue(value) {
  if (value && typeof value === 'object' && value.ok === false) {
    throw new Error(hostErrorText(value.message || value.error) || 'Git 失败');
  }
  return value;
}

async function gitCall(client, action, cwd, payload = {}) {
  if (!client || typeof client.gitRpc !== 'function') {
    throw new Error('桌面端未启动');
  }
  const result = await client.gitRpc(action, cwd, payload);
  if (result && result.ok === false) {
    throw new Error(hostErrorText(result.error) || 'Git 失败');
  }
  return unwrapGitValue(result?.value !== undefined ? result.value : result);
}

export { gitCall, hostCall, unwrapHost };
