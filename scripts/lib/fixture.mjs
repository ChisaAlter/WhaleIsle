// Spec helper: materialize a {relpath: content} map into a temp dir and
// return its root. Gate collect() functions take the root explicitly.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createUniqueDir } from '../../src/shared/fs-safe.js'

export function makeFixture(t, files) {
  const root = createUniqueDir(tmpdir(), 'dshd-gate-')
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
