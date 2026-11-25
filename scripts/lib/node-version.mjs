/**
 * Compare two numeric [major, minor, patch] tuples.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
function compareTriples(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/**
 * Parse a single comparator (`>=X.Y.Z` or `^X.Y.Z`).
 * @param {string} clause
 * @returns {{ op: '>=' | '^', version: number[] } | null}
 */
function parseComparator(clause) {
  const match = /^(>=|\^)\s*(\d+)\.(\d+)\.(\d+)$/.exec(clause.trim());
  if (match === null) return null;
  return {
    op: /** @type {'>=' | '^'} */ (match[1]),
    version: match.slice(2).map(Number),
  };
}

/**
 * Evaluate whether `actual` satisfies one parsed comparator.
 * @param {number[]} actual
 * @param {{ op: '>=' | '^', version: number[] }} comparator
 * @returns {boolean}
 */
function satisfiesComparator(actual, comparator) {
  const req = comparator.version;
  if (compareTriples(actual, req) < 0) return false;
  if (comparator.op === '>=') return true;
  if (req[0] > 0) return actual[0] === req[0];
  if (req[1] > 0) return actual[0] === 0 && actual[1] === req[1];
  return actual[0] === 0 && actual[1] === 0 && actual[2] === req[2];
}

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
  const rawClauses = range ? range.split('||') : [];
  const comparators = rawClauses.map(parseComparator);
  if (comparators.length === 0 || comparators.some(item => item === null)) {
    throw new Error(
      `无法解析 package.json 中 engines.node 的要求「${range || '(空)'}」。`
      + '目前只支持由 || 组合的 >=X.Y.Z 或 ^X.Y.Z 写法；请修正 engines 字段或更新本检查。',
    );
  }
  const actualMatch = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(current).trim());
  if (actualMatch === null) {
    throw new Error(`无法解析当前 Node 版本「${String(current)}」。`);
  }
  const actual = actualMatch.slice(1).map(Number);
  const satisfies = comparators.some(
    comparator => satisfiesComparator(actual, /** @type {{ op: '>=' | '^', version: number[] }} */ (comparator)),
  );
  if (!satisfies) {
    throw new Error(
      `当前 Node 版本 v${current} 不满足 engines 要求（${range}）。`
      + `请切换到 ${range} 的 Node 再重跑 npm run setup，`
      + '例如用 nvm / fnm 安装对应版本，或把已安装的 Node 24+ 放到 PATH 前面。',
    );
  }
  return range;
}
