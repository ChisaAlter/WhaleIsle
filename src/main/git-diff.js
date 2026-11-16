const fs = require('node:fs');
const path = require('node:path');
const { runGit, asCwd, safeRefName } = require('./git-exec');

const MAX_UNTRACKED_BYTES = 256 * 1024;

function unquoteGitPath(spec) {
  const trimmed = String(spec || '').split('\t')[0].trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return trimmed;
}

function stripAbPrefix(spec) {
  if (spec.startsWith('a/') || spec.startsWith('b/')) return spec.slice(2);
  return spec;
}

function parseDiffGitArgs(rest) {
  const tokens = [];
  let i = 0;
  while (i < rest.length) {
    while (rest[i] === ' ') i += 1;
    if (i >= rest.length) break;
    if (rest[i] === '"') {
      let j = i + 1;
      let out = '';
      while (j < rest.length) {
        if (rest[j] === '\\' && j + 1 < rest.length) {
          out += rest[j + 1];
          j += 2;
          continue;
        }
        if (rest[j] === '"') {
          j += 1;
          break;
        }
        out += rest[j];
        j += 1;
      }
      tokens.push(out);
      i = j;
      continue;
    }
    const space = rest.indexOf(' ', i);
    if (space < 0) {
      tokens.push(rest.slice(i));
      break;
    }
    tokens.push(rest.slice(i, space));
    i = space;
  }
  return tokens;
}

function pathFromDiffGit(line) {
  const tokens = parseDiffGitArgs(line.slice('diff --git '.length));
  const dst = tokens[1] || tokens[0] || '';
  return stripAbPrefix(dst);
}

function pathFromPlusMinus(spec) {
  const cleaned = unquoteGitPath(spec);
  if (cleaned === '' || cleaned === '/dev/null') return null;
  return stripAbPrefix(cleaned);
}

function parseUnifiedDiff(text) {
  const files = [];
  let current = null;
  let hunk = null;
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      current = { path: pathFromDiffGit(line), status: 'modified', hunks: [] };
      hunk = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldPath = line.slice('rename from '.length);
      continue;
    }
    if (hunk === null && line.startsWith('+++ ')) {
      const next = pathFromPlusMinus(line.slice(4));
      if (next !== null) current.path = next;
      continue;
    }
    if (hunk === null && line.startsWith('--- ')) {
      const next = pathFromPlusMinus(line.slice(4));
      if (next !== null && !current.path) current.path = next;
      continue;
    }
    if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) hunk.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) hunk.lines.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) hunk.lines.push({ kind: 'eof', text: line.slice(1).trim() });
    else if (line.startsWith(' ')) hunk.lines.push({ kind: 'context', text: line.slice(1) });
  }
  if (current) files.push(current);
  return files;
}

function untrackedAsDiff(root, rel) {
  const target = path.join(root, rel);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return { path: rel, status: 'added', hunks: [] };
  }
  const buf = fs.readFileSync(target);
  if (buf.includes(0)) {
    return { path: rel, status: 'added', hunks: [] };
  }
  const body = buf.toString('utf8').replace(/\r\n/g, '\n');
  const rows = body.split('\n');
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return {
    path: rel,
    status: 'added',
    hunks: [{
      header: `@@ -0,0 +1,${rows.length} @@`,
      lines: rows.map((text) => ({ kind: 'add', text })),
    }],
  };
}

async function gitDiff(cwd, options) {
  const root = asCwd(cwd);
  if (!root) return null;
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.missing || inside.code !== 0 || inside.stdout.trim() !== 'true') return null;

  const requested = typeof options?.baseRef === 'string' ? safeRefName(options.baseRef) : null;
  if (typeof options?.baseRef === 'string' && options.baseRef.trim() !== '' && !requested) {
    return null;
  }

  const files = [];
  let truncated = false;
  if (requested) {
    const diff = await runGit(root, ['diff', `${requested}...HEAD`, '--no-color', '--no-ext-diff', '--find-renames']);
    if (diff.missing || diff.code !== 0) return null;
    truncated = Boolean(diff.truncated);
    files.push(...parseUnifiedDiff(diff.stdout));
    return truncated ? { files, truncated: true, baseRef: requested } : { files, baseRef: requested };
  }
  const head = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head.code === 0) {
    const diff = await runGit(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--find-renames']);
    if (diff.missing || diff.code !== 0) return null;
    truncated = Boolean(diff.truncated);
    files.push(...parseUnifiedDiff(diff.stdout));
  } else {
    const staged = await runGit(root, ['diff', '--cached', '--no-color', '--no-ext-diff']);
    const unstaged = await runGit(root, ['diff', '--no-color', '--no-ext-diff']);
    if (staged.missing || unstaged.missing || (staged.code !== 0 && unstaged.code !== 0)) return null;
    truncated = Boolean(staged.truncated || unstaged.truncated);
    files.push(...parseUnifiedDiff(staged.stdout), ...parseUnifiedDiff(unstaged.stdout));
  }

  const untracked = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (untracked.code === 0 && untracked.stdout) {
    for (const rel of untracked.stdout.split('\0').filter(Boolean)) {
      if (files.some((file) => file.path === rel)) continue;
      const added = untrackedAsDiff(root, rel);
      if (added) files.push(added);
    }
  }
  return truncated ? { files, truncated: true } : { files };
}

module.exports = {
  parseUnifiedDiff,
  gitDiff,
};
