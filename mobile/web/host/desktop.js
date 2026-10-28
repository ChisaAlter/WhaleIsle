// Request builders and result views for the paired desktop services that the
// phone reaches through the host tunnel: session-scoped workspace files, the
// Git diff, MCP servers, skills and plugins. Mirrors Android
// NativeDesktopController / NativeDesktopData so both clients ask the same
// formal services and show the same honest states.

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const FILE_PAGE_LINES = 200;

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

/** `workspaceFiles.*` arguments scoped to the open session's workspace. */
function fileArgs(sessionId, path, extra = {}) {
  if (!sessionId) throw new Error('先打开有工作目录的会话');
  return { args: { workspaceFileScopeId: sessionId, path: path || '.', ...extra } };
}

function fileReadArgs(sessionId, path, offset = 1) {
  return fileArgs(sessionId, path, { range: { offset, limit: FILE_PAGE_LINES } });
}

function childPath(parent, name) {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('电脑返回了无效的文件名称');
  return parent ? `${parent}/${name}` : name;
}

function parentPath(path) {
  const index = String(path || '').lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function pathSegments(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return [{ label: '根目录', path: '' }, ...parts.map((label, index) => ({ label, path: parts.slice(0, index + 1).join('/') }))];
}

function isImagePath(path) {
  const dot = String(path || '').lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Directories first, then names; `other` entries stay visible but are not opened. */
function fileEntries(listing, parent = '') {
  const entries = Array.isArray(listing?.entries) ? listing.entries : [];
  return entries
    .filter((entry) => typeof entry?.name === 'string' && entry.name)
    .map((entry) => {
      const kind = entry.type === 'directory' ? 'directory' : entry.type === 'file' ? 'file' : 'other';
      let path = '';
      try { path = childPath(parent, entry.name); } catch { return null; }
      return { name: entry.name, path, kind, size: Number.isFinite(entry.size) ? entry.size : null };
    })
    .filter(Boolean)
    .sort((a, b) => (a.kind === 'directory') !== (b.kind === 'directory')
      ? (a.kind === 'directory' ? -1 : 1)
      : a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function filePage(result, path) {
  const value = objectValue(result);
  const offset = Number.isInteger(value.offset) ? value.offset : 1;
  const lines = Number.isInteger(value.lines) ? value.lines : 0;
  return {
    kind: 'text', path, text: text(value.text), offset, lines,
    bytes: Number.isFinite(value.bytes) ? value.bytes : null, eof: value.eof === true,
  };
}

function imagePreview(result, path) {
  const value = objectValue(result);
  if (!text(value.data) || !text(value.mediaType).startsWith('image/')) throw new Error('电脑返回的图片无效');
  return { kind: 'image', path, mediaType: value.mediaType, data: value.data, bytes: Number.isFinite(value.bytes) ? value.bytes : null };
}

/** `git-diff` files with line counts; a non-diff answer is a visible failure, not an empty list. */
function diffView(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.files)) {
    throw new Error('无法读取差异，请确认工作目录已登记为 Git 仓库，且对比引用有效。');
  }
  const files = value.files.map((file) => {
    const hunks = (Array.isArray(file?.hunks) ? file.hunks : []).map((hunk) => ({
      header: text(hunk?.header),
      lines: (Array.isArray(hunk?.lines) ? hunk.lines : []).map((line) => ({ kind: text(line?.kind) || 'context', text: text(line?.text) })),
    }));
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') additions += 1;
        else if (line.kind === 'del') deletions += 1;
      }
    }
    return { path: text(file?.path), oldPath: text(file?.oldPath), status: text(file?.status) || 'modified', hunks, additions, deletions };
  });
  return { files, truncated: value.truncated === true, baseRef: text(value.baseRef) };
}

const DIFF_STATUS = { added: '新增', deleted: '删除', renamed: '重命名', modified: '修改' };
function diffStatusLabel(status) {
  return DIFF_STATUS[status] || status || '修改';
}

function mcpRows(value) {
  const servers = Array.isArray(objectValue(value).servers) ? value.servers : [];
  return servers.filter((row) => text(row?.id)).map((row) => {
    const spec = objectValue(row.spec);
    const connection = objectValue(row.connection);
    return {
      id: row.id,
      name: text(spec.serverName) || row.id,
      transport: text(spec.transport),
      enabled: row.enabled === true,
      writable: row.writable === true,
      health: text(connection.health) || text(row.fiberPhase),
      lastError: text(connection.lastError),
      tools: (Array.isArray(connection.tools) ? connection.tools : []).map((tool) => (typeof tool === 'string' ? tool : text(tool?.name))).filter(Boolean),
    };
  });
}

function mcpRequest(method, id, enabled) {
  const request = enabled === undefined ? { id } : { id, enabled };
  return [`mcpServers.${method}`, { args: { request } }];
}

/** `mcpServers.test` resolves only on success (`McpServerTestResult`); failures arrive as RPC errors. */
function mcpTestMessage(result) {
  const value = objectValue(result);
  if (value.ok !== true) return '未能确认测试结果，请刷新核对';
  const parts = ['连接正常'];
  if (Number.isInteger(value.toolCount)) parts.push(`${value.toolCount} 个工具`);
  if (Number.isFinite(value.elapsedMs)) parts.push(`${Math.round(value.elapsedMs)} ms`);
  return parts.join(' · ');
}

function skillScope(cwd, sessionId) {
  return sessionId ? { cwd, sessionId } : { cwd };
}

function skillRows(value) {
  const skills = Array.isArray(objectValue(value).skills) ? value.skills : [];
  return skills.filter((row) => text(row?.name)).map((row) => ({
    name: row.name,
    description: text(row.description),
    source: text(row.source),
    groups: (Array.isArray(row.groups) ? row.groups : []).filter((group) => typeof group === 'string'),
    modelInvocable: row.modelInvocable === true,
    userInvocable: row.userInvocable === true,
  }));
}

function pluginView({ inventory, plugins, bundles }) {
  const inv = objectValue(inventory);
  const list = (value) => (Array.isArray(value) ? value : Array.isArray(objectValue(value).items) ? value.items : []);
  return {
    manageable: inv.managementAvailable === true,
    bundles: list(bundles).map((row) => ({
      name: text(row?.name),
      description: text(row?.description),
      version: text(row?.version),
      availability: text(row?.availability),
      enabled: row?.enabled === true,
      editable: !text(row?.readOnlyReason) && row?.availability !== 'missing',
      readOnlyReason: text(row?.readOnlyReason) || (row?.availability === 'missing' ? '插件包未安装' : ''),
      error: text(objectValue(row?.error).diagnostic) || text(objectValue(row?.error).code),
    })).filter((row) => row.name),
    plugins: list(plugins).map((row) => ({
      id: text(row?.entryId),
      name: text(row?.moduleName) || text(row?.entryId),
      phase: text(row?.fiberPhase),
      enabled: row?.enabled === true,
      editable: Boolean(text(row?.patchId)) && !text(row?.readOnlyReason),
      readOnlyReason: text(row?.readOnlyReason),
    })).filter((row) => row.id),
  };
}

function pluginResultMessage(result) {
  const value = objectValue(result);
  const failure = objectValue(value.error);
  const diagnostic = text(failure.diagnostic) || text(failure.code);
  switch (value.application) {
    case 'applied': return '修改已应用';
    case 'restart-required': return `修改已保存，电脑端重启后生效：${text(value.restartReason)}`;
    case 'overridden': return '修改已保存，但被更高优先级配置覆盖';
    case 'cancelled': return '已取消，配置已恢复';
    default: return diagnostic || text(objectValue(value.packageResult).output) || '未能确认插件操作结果，请刷新核对';
  }
}

export {
  FILE_PAGE_LINES,
  childPath,
  diffStatusLabel,
  diffView,
  fileArgs,
  fileEntries,
  filePage,
  fileReadArgs,
  fileSize,
  imagePreview,
  isImagePath,
  mcpRequest,
  mcpRows,
  mcpTestMessage,
  parentPath,
  pathSegments,
  pluginResultMessage,
  pluginView,
  skillRows,
  skillScope,
};
