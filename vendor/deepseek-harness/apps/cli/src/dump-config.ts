/**
 * Config-dump entry for `dsh --profile <name> --dump-config`: compose the
 * profile's patch layers through the include plugin's patch algorithm without
 * booting or evaluating `!!js`, with one source layer per bundle, the
 * profile's own patch file, and each `--patch` overlay.
 * @module @deepseek-ai/dsh/dump-config
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  loadOptionalPatches,
  loadOverlayPatches,
  readProfileDefaultPatches,
  renderConfigDump,
  type ConfigDumpLayer,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { homePatchPath, prepareProfile, PROFILE_ROOT_FILENAME } from './profile-boot.ts'

const NAME = 'dsh'

export interface DumpConfigOptions {
  defaultOnly: boolean
  patches: readonly string[]
  skipUserPlugins?: boolean
  /** Shipped template used once to initialize a missing profile. */
  fromDefaultProfile?: string | undefined
}

/** Build the same labeled layers that runDumpConfig prints, without I/O to stdout. */
export function dumpConfigLayers(profile: string, options: DumpConfigOptions): {
  root: string
  layers: ConfigDumpLayer[]
} {
  const skipUserPlugins = options.skipUserPlugins === true
  const loaded = prepareProfile(profile, {
    userLayer: !options.defaultOnly && !skipUserPlugins,
    bundles: skipUserPlugins ? 'template' : 'manifest',
    fromDefaultProfile: options.fromDefaultProfile,
  })
  const layers: ConfigDumpLayer[] = loaded.layers.map(layer => ({
    label: layer.packageName,
    patches: layer.patches,
  }))
  const defaults = readProfileDefaultPatches(NAME, loaded, skipUserPlugins)
  if (defaults.length) layers.push({ label: 'desktop defaults', patches: defaults })
  if (!options.defaultOnly) {
    if (!skipUserPlugins && existsSync(loaded.patchPath)) {
      layers.push({ label: loaded.patchPath, patches: loaded.patches })
    }
    if (!skipUserPlugins) {
      const homePatchFile = homePatchPath()
      const homePatches = loadOptionalPatches(NAME, homePatchFile)
      if (homePatches !== undefined) {
        layers.push({ label: homePatchFile, patches: homePatches })
      }
    }
    for (const file of options.patches) {
      const absolute = resolve(file)
      layers.push({ label: absolute, patches: loadOverlayPatches(NAME, absolute) })
    }
  }
  return { root: join(loaded.dir, PROFILE_ROOT_FILENAME), layers }
}

/* v8 ignore start -- built-bin acceptance drives this boot-free dispatch */
/**
 * Print a profile composition with comments naming each source file and patch layer.
 * @param profile - the profile name.
 * @param defaultOnly - omit the profile's user layer and `--patch` overlays
 * (the recovery diagnostic for a broken `cordis.patch.yml`, which is then
 * never parsed).
 * @param patches - `--patch` overlay paths, in argv order.
 * @param skipUserPlugins - list template bundles and `--patch` files only, never user layers.
 * @param fromDefaultProfile - shipped template that replaces the custom profile.
 */
export function runDumpConfig(
  profile: string,
  defaultOnly: boolean,
  patches: readonly string[],
  skipUserPlugins = false,
  fromDefaultProfile?: string,
): void {
  const { root, layers } = dumpConfigLayers(profile, { defaultOnly, patches, skipUserPlugins, fromDefaultProfile })
  // The dump anchors on the same empty root file the boot includes.
  process.stdout.write(renderConfigDump(NAME, root, layers))
}

/**
 * Read dump layers in bundle, profile, home, then argv order without composing them.
 * @param loaded - prepared profile and parsed bundle and profile patches.
 * @param defaultOnly - omit profile, home, and argv layers without reading their files.
 * @param patches - overlay paths relative to the invoking directory, in argv order.
 * @returns the labeled layers shared by YAML and schema dumps.
 */
export function collectConfigDumpLayers(
  loaded: Profile,
  defaultOnly: boolean,
  patches: readonly string[],
): ConfigDumpLayer[] {
  const layers: ConfigDumpLayer[] = loaded.layers.map(layer => ({
    label: layer.packageName,
    patches: layer.patches,
  }))
  const defaults = readProfileDefaultPatches(NAME, loaded)
  if (defaults.length) layers.push({ label: 'desktop defaults', patches: defaults })
  if (!defaultOnly) {
    if (existsSync(loaded.patchPath)) {
      layers.push({ label: loaded.patchPath, patches: loaded.patches })
    }
    const homePatchFile = homePatchPath()
    const homePatches = loadOptionalPatches(NAME, homePatchFile)
    if (homePatches !== undefined) {
      layers.push({ label: homePatchFile, patches: homePatches })
    }
    for (const file of patches) {
      const absolute = resolve(file)
      layers.push({ label: absolute, patches: loadOverlayPatches(NAME, absolute) })
    }
  }
  return layers
}
/* v8 ignore stop */
