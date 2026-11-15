// Spec helper: materialize a {relpath: content} map into a temp dir and
// return its root. Gate collect() functions take the root explicitly.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

export function makeFixture(t, files) {
  // eslint-disable-next-line no-restricted-syntax -- 测试夹具由 t.after 回收
  const root = mkdtempSync(join(tmpdir(), 'dshd-gate-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
