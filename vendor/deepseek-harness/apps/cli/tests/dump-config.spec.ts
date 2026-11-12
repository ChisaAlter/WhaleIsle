/**
 * Skip-user-plugins dump lists template bundle layers plus `--patch` files,
 * never the profile or home user patch files.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initProfile,
  PROFILE_PATCH_FILENAME,
  PROFILES_DIR,
} from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import { dumpConfigLayers } from '../src/dump-config.ts'

const tmpDirs: string[] = []
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-dump-config-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('dumpConfigLayers', () => {
  it('skip-user-plugins lists template bundles and --patch, not user YAML', () => {
    const home = tmp()
    vi.stubEnv('DSH_HOME', home)
    const dir = join(home, PROFILES_DIR, 'web')
    const web = PROFILE_TEMPLATES.web
    if (web === undefined) throw new Error('expected shipped web profile template')
    initProfile(dir, [...web.bundles, 'ghost-bundle'])
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), 'not: a list\n')
    writeFileSync(join(home, PROFILE_PATCH_FILENAME), '- id: missing\n  config: {}\n')
    const overlay = join(home, 'extra.yml')
    writeFileSync(overlay, '- id: session-telemetry-otel\n  disabled: true\n')
    const { layers } = dumpConfigLayers('web', {
      defaultOnly: false,
      skipUserPlugins: true,
      patches: [overlay],
    })
    expect(layers.map(layer => layer.label)).toEqual([
      ...web.bundles,
      overlay,
    ])
  })
})
