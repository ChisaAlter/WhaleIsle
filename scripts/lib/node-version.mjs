/**
 * Node engine check for `npm run setup`. Kept dependency-free so it runs
 * before `npm ci` has installed anything.
 *
 * @param {string} current - running Node version, e.g. process.versions.node
 * @param {string|undefined} requirement - package.json engines.node
 * @returns {string} the raw engines requirement when satisfied
 * @throws {Error} Chinese, actionable message when the version is too old or
 *   the requirement cannot be parsed
 */
export function assertNodeVersion(current, requirement) {
  const range = String(requirement ?? '').trim();
  const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (match === null) {
    throw new Error(
      `无法解析 package.json 中 engines.node 的要求「${range || '(空)'}」。`
      + '目前只支持形如 >=X.Y.Z 的写法；请修正 engines 字段或更新本检查。',
    );
  }
  const required = match.slice(1).map(Number);
  const actual = String(current).replace(/^v/, '').split('.')
    .map(part => Number.parseInt(part, 10));
  const satisfies = actual[0] > required[0]
    || (actual[0] === required[0] && actual[1] > required[1])
    || (actual[0] === required[0] && actual[1] === required[1] && actual[2] >= required[2]);
  if (!satisfies) {
    throw new Error(
      `当前 Node 版本 v${current} 不满足 engines 要求（${range}）。`
      + `请切换到 ${range} 的 Node 再重跑 npm run setup，`
      + '例如用 nvm / fnm 安装对应版本，或把已安装的 Node 24+ 放到 PATH 前面。',
    );
  }
  return range;
}
