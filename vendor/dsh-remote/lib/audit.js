// Bounded SSH audit log with 2 MiB single-backup rotation and tail-window reads.
import { appendFileSync, closeSync, openSync, readFileSync, readSync, renameSync, statSync } from 'node:fs'

const AUDIT_MAX_BYTES = 2 * 1024 * 1024
const AUDIT_TAIL_READ_BYTES = 256 * 1024

export function createAuditLog({ auditFile, config, logger }) {
  const audit = (op, cmd, code, target) => {
    if (!config.auditLog) return
    const host = (target && target.host) || config.host
    const user = (target && target.username) || config.username
    const port = (target && target.port) || config.port
    try {
      const file = auditFile()
      try {
        if (statSync(file).size >= AUDIT_MAX_BYTES) renameSync(file, `${file}.1`)
      } catch { /* absent or cannot rotate; proceed to append */ }
      const line = [
        new Date().toISOString(),
        `${user || '?'}@${host || '?'}:${port}`,
        op,
        code == null ? '-' : String(code),
        String(cmd || '').replace(/\s+/g, ' ').slice(0, 400),
      ].join(' | ') + '\n'
      appendFileSync(file, line, 'utf8')
    } catch (error) {
      logger.warn('写入 SSH 审计日志失败；请检查应用数据目录的写入权限。', error)
    }
  }

  const readAudit = (limit) => {
    try {
      const file = auditFile()
      const st = statSync(file)
      let text
      if (st.size <= AUDIT_TAIL_READ_BYTES) {
        text = readFileSync(file, 'utf8')
      } else {
        const fd = openSync(file, 'r')
        try {
          const buf = Buffer.alloc(AUDIT_TAIL_READ_BYTES)
          const bytesRead = readSync(fd, buf, 0, AUDIT_TAIL_READ_BYTES, st.size - AUDIT_TAIL_READ_BYTES)
          const raw = buf.subarray(0, bytesRead).toString('utf8')
          const firstNl = raw.indexOf('\n')
          text = firstNl >= 0 ? raw.slice(firstNl + 1) : raw
        } finally {
          closeSync(fd)
        }
      }
      const lines = text.split('\n').filter(Boolean)
      return lines.slice(-Math.max(1, Math.min(Number(limit) || 50, 500)))
    } catch {
      return []
    }
  }

  return { audit, readAudit }
}
