// dsh-remote — pure path / shell helpers (no fs, no ssh).
// Split out of lib/index.js so they are unit-testable without loading the
// plugin. Both POSIX (`/a/b`) and Windows (`D:\Code`, `\\server\share`) forms
// are supported everywhere.

/** Single-quote one shell argument verbatim. */
export function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

/**
 * Normalize a remote path into a clean absolute path, supporting BOTH POSIX
 * (`/home/user`) and Windows (`D:\Code`, `C:/Users/x`, `\\server\share`) forms.
 *
 * - POSIX paths keep `/` separators and a leading `/`.
 * - Windows drive paths keep their `X:` prefix and are returned with `\`
 *   separators (the native form on a Windows remote); a leading `/` is NOT
 *   added, so `D:\Code` stays `D:\Code` instead of becoming `/D:\Code`.
 * - UNC paths (`\\server\share\…`) keep the `\\server\share` prefix.
 * - `.` / `..` segments are collapsed in both separator styles.
 */
export function normalizeRemotePath(p) {
  const s = String(p)
  // Windows UNC: \\server\share\…
  const unc = s.match(/^(\\\\[^\\]+(?:\\[^\\]+)?)(?:\\|$)(.*)$/s)
  if (unc) {
    const [prefix, rest] = [unc[1], unc[2]]
    const parts = []
    for (const seg of rest.split(/[\\/]+/)) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') { parts.pop(); continue }
      parts.push(seg)
    }
    return parts.length ? prefix + '\\' + parts.join('\\') : prefix
  }
  // Windows drive: X:\… or X:/…
  const drive = s.match(/^([a-zA-Z]:)(?:[\\/]|$)(.*)$/s)
  if (drive) {
    const [prefix, rest] = [drive[1], drive[2]]
    const parts = []
    for (const seg of rest.split(/[\\/]+/)) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') { parts.pop(); continue }
      parts.push(seg)
    }
    return prefix + '\\' + parts.join('\\')
  }
  // POSIX: /a/b/c
  const parts = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return '/' + parts.join('/')
}

/** Join a remote dir + entry name, honoring the dir's own separator style. */
export function joinRemotePath(dir, name) {
  const d = String(dir)
  if (!d) return String(name)
  if (d.endsWith('/') || d.endsWith('\\')) return d + String(name)
  return d + (d.includes('\\') ? '\\' : '/') + String(name)
}

/** Parent dir of a remote absolute path (string-level; POSIX or Windows). */
export function remoteDirname(p) {
  const norm = normalizeRemotePath(p)
  // Windows drive/UNC root: D:\ or \\server\share
  if (norm === '/' || /^[a-zA-Z]:\\?$/.test(norm) || /^\\\\[^\\]+\\[^\\]+$/.test(norm)) {
    // Ensure a drive root ends with a backslash: D: → D:\
    const m = norm.match(/^([a-zA-Z]:)$/)
    return m ? m[1] + '\\' : norm
  }
  const sep = norm.includes('\\') ? '\\' : '/'
  const idx = norm.lastIndexOf(sep)
  if (idx <= 0) {
    // Windows drive with a child (D:\Code) → D:\
    const m = norm.match(/^([a-zA-Z]:)\\/)
    return m ? m[1] + '\\' : sep === '/' && norm.startsWith('/') ? '/' : norm
  }
  // A parent that is a Windows drive root also needs the trailing backslash.
  const parent = norm.slice(0, idx)
  if (sep === '\\' && /^[a-zA-Z]:$/.test(parent)) return parent + '\\'
  return parent
}

/** Create every level of a remote dir via SFTP (true mkdir -p: parents AND the
 * target itself), working for both POSIX (`/a/b`) and Windows (`D:\a\b`)
 * paths. Best effort: an existing or permission-denied level is skipped.
 * FILE-oriented callers must pass the parent dir (remoteDirname(filePath)). */
export async function mkdirRemoteDirs(sftp, dir) {
  const target = normalizeRemotePath(dir)
  const isWin = target.includes('\\')
  // Split off a Windows drive prefix (D:) so it is not treated as a segment.
  const drive = isWin ? (target.match(/^([a-zA-Z]:)[\\/]?(.*)$/s) || null) : null
  const segs = drive ? drive[2].split(/[\\/]/).filter(Boolean) : target.split(/[\\/]/).filter(Boolean)
  let cur = isWin ? (drive ? drive[1] + '\\' : '') : ''
  // Drive root (D:\) itself, best effort (usually exists).
  if (isWin && cur) { try { await sftp.mkdir(cur) } catch { /* exists */ } }
  for (const s of segs) {
    if (cur) {
      if (!cur.endsWith('\\') && !cur.endsWith('/')) cur += isWin ? '\\' : '/'
      cur += s
    } else {
      cur = (isWin ? s + ':' : '/' + s)
    }
    try { await sftp.mkdir(cur) } catch { /* exists or no perms */ }
  }
}

/**
 * Convert an internal remote path (POSIX `/a/b` or Windows `D:\Code`) into the
 * path format the SFTP server understands.
 *
 * Windows OpenSSH's sftp-server accepts POSIX-style paths: a drive letter is
 * written `/D:/…` (equivalent to `D:\…`). POSIX paths pass through unchanged.
 * UNC paths are kept as-is (the server resolves `\\server\share` itself).
 */
export function toSftpPath(p) {
  const norm = normalizeRemotePath(p)
  const m = norm.match(/^([a-zA-Z]):\\(.*)$/s)
  if (m) return '/' + m[1] + ':/' + m[2].replace(/\\/g, '/')
  return norm
}

/**
 * Convert a remote path to the form used in SHELL commands on the remote.
 *
 * On Windows remotes running Git Bash, native `D:\Code` (or `D:/Code`,
 * `/D:/Code`, `/d/Code`) becomes the Git-Bash mount form `/d/Code`; a path
 * already in Git-Bash form passes through unchanged. UNC (`\\server\share`)
 * maps to `//server/share`. POSIX paths are normalized as-is. The conversion
 * is syntactic, so it is safe on POSIX remotes too (only unambiguous Windows
 * forms are rewritten).
 */
export function toShellPath(p) {
  let t = String(p || '').replace(/\\/g, '/')
  const unc = t.match(/^\/\/([^/]+)(?:\/(.*))?$/)
  if (unc) return '//' + unc[1] + (unc[2] ? '/' + unc[2] : '')
  const drive = t.match(/^([a-zA-Z]):(\/|$)/) || t.match(/^\/([a-zA-Z]):(\/|$)/)
  if (drive) {
    t = '/' + drive[1].toLowerCase() + (drive[2] ? '/' : '') + t.slice(drive[0].length)
  }
  const parts = []
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { parts.pop(); continue }
    parts.push(seg)
  }
  return '/' + parts.join('/')
}

/**
 * Display form of a path for a Windows remote: a Git-Bash mount `/d/Code` (or
 * `/D:/Code`, `D:/Code`) renders as `D:\Code`; anything else (POSIX paths,
 * native Windows paths) is returned normalized. POSIX remotes always pass
 * through unchanged.
 */
export function toDisplayPath(p, platform) {
  if (platform !== 'windows') return normalizeRemotePath(p)
  const t = String(p || '').replace(/\\/g, '/')
  // /X:/rest (Win32-OpenSSH SFTP form)
  const gs = t.match(/^\/([a-zA-Z]):\/(.*)$/)
  if (gs) return gs[1].toUpperCase() + ':\\' + gs[2].replace(/\//g, '\\')
  // /x/rest (Git-Bash mount form) and bare /x
  const git = t.match(/^\/([a-zA-Z])(?:\/(.*))?$/)
  if (git) return git[1].toUpperCase() + ':\\' + (git[2] || '').replace(/\//g, '\\')
  // native X:/rest
  const drive = t.match(/^([a-zA-Z]):(?:\/(.*))?$/)
  if (drive) return drive[1].toUpperCase() + ':\\' + (drive[2] || '').replace(/\//g, '\\')
  return t
}

/** Basename of a remote absolute path (POSIX or Windows). */
export function remotePathBase(p) {
  const norm = normalizeRemotePath(p).replace(/[\\/]+$/, '')
  const base = norm.split(/[\\/]/).pop()
  // Windows drive root (D:\) has no meaningful basename
  if (!base || /^[a-zA-Z]:$/.test(base)) return 'workspace'
  return base
}

/** Relative path of `p` under `root` (POSIX form, no leading slash), or null
 * when `p` is not inside `root`. Both POSIX and Windows drive paths work
 * (Windows is compared in its `/D:/…` POSIX-equivalent form). */
export function relPathUnder(root, p) {
  const posix = (x) => {
    let n = normalizeRemotePath(x).replace(/[\\/]+$/, '')
    const m = n.match(/^([a-zA-Z]):(.*)$/s)
    if (m) return '/' + m[1].toLowerCase() + ':/' + (m[2] ? m[2].replace(/\\/g, '/').replace(/^\/+/, '') : '')
    return n.replace(/\\/g, '/')
  }
  const r = posix(root)
  const n = posix(p)
  if (n === r) return ''
  const prefix = r === '/' ? '/' : r + '/'
  if (n.startsWith(prefix)) return n.slice(prefix.length)
  return null
}

export function truncate(s, max) {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n…[truncated: ${s.length - max} more chars]`
}

/** 32-bit string hash rendered in base36 (short, collision-safe enough). */
export function shortHash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** Resolve a remote file path safely under a local mirror root (or null if escaping). */
export function resolveMirrorDownloadPath(pathMod, mirrorBase, ws, remotePath) {
  const base = pathMod.resolve(mirrorBase)
  const under = relPathUnder(ws, remotePath)
  const rel = (under != null ? under : remotePath.replace(/^[a-zA-Z]:[\\/]?/, '').replace(/^\/+/, '')).replace(/\\/g, '/')
  const local = pathMod.resolve(base, rel)
  const relCheck = pathMod.relative(base, local)
  if (!relCheck || relCheck === '..' || relCheck.startsWith(`..${pathMod.sep}`) || pathMod.isAbsolute(relCheck)) {
    return null
  }
  return local
}
