/**
 * Per-stage build credentials for the official build.
 *
 * `build:official` used to be all-or-nothing: the root prestart gate compared
 * the build record's commit hash with the checkout's HEAD and, on any
 * difference, re-ran native, host, client and web from scratch. A commit that
 * touched only `src/main/**` or docs therefore paid a complete client rebuild.
 *
 * This module gives each stage its own credential. A stage is reused only when
 * all four of its recorded facts still hold:
 *
 * - **inputs** — every file the stage reads, recorded as a cheap size/mtime/
 *   ctime manifest *and* as a content digest. A same-size/same-mtime edit moves
 *   ctime (which no ordinary writer can suppress), so the manifest moves, the
 *   content digest is recomputed and the change is caught. New untracked files,
 *   deletions and renames change the path list, which the manifest covers. No
 *   step consults Git, so a dirty or untracked working tree is handled by the
 *   same rule as a committed one;
 * - **outputs** — every artifact the stage writes, recorded the same way, so a
 *   tampered, truncated or partially deleted tree fails verification instead of
 *   being reused, while a rebuild that produces identical bytes still verifies;
 * - **environment** — the public values the stage's artifacts actually embed,
 *   so a commit/version bump rebuilds the browser bundles without redoing the
 *   native or host work, and never by faking the recorded value;
 * - **formatVersion** — an unrecognized schema is ignored and the stage re-runs
 *   rather than being trusted.
 *
 * Every failure mode reports "must rebuild": a missing, unreadable or
 * unparsable credential, a missing stage entry, an input mismatch, an output
 * mismatch and an environment mismatch. A credential can only ever skip work;
 * it can never make a stage succeed that would otherwise fail.
 *
 * Cost: the steady-state check walks the stage roots and stats each file, which
 * is ~1 s for the reference checkout's 18k files. One walk/stat cache is shared
 * by all four stage checks in a run (they overlap heavily) and is never
 * persisted. Content digests (about 160 MB across the four stages) are only
 * recomputed for a stage whose manifest moved, read with bounded parallelism.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

/** Schema version of a persisted stage credential. Bump on any shape change. */
export const STAGE_CREDENTIAL_FORMAT = 2

/** Repository-relative path of the persisted stage credentials. */
export const STAGE_CREDENTIAL_PATH = '.dsh-build/build-stage-credentials.json'

/**
 * A build stage in dependency order. `build.ts` runs them in this order and
 * each one consumes the previous stage's artifacts, so a stage is only
 * reusable when it and every stage before it verify.
 *
 * `host` and `client` are the two faces `pnpm run build:lib` runs
 * (`build:lib:host`, then `build:lib:client`). Naming them separately is what
 * lets a commit/version bump rebuild the browser bundles without redoing the
 * Node pass.
 */
export const BUILD_STAGES = ['native-system', 'host', 'client', 'web']

/**
 * Directory names a walk never enters: installed packages, VCS metadata and
 * scratch state. They are never a build input and never a stage artifact, and
 * skipping them is what keeps a whole-tree walk out of `node_modules`.
 */
const NEVER_ENTERED_DIRS = new Set([
  'node_modules',
  '.git',
  '.dsh-build',
  '.release',
  'coverage',
  '.artifacts',
  '.tmp',
  '.pnpm-store',
])

/**
 * Whether a repository-relative path is a generated artifact.
 *
 * Only the exact output roots count, never "any directory called `lib`": a
 * source file such as `packages/foo/src/lib/util.ts` is a real input, and
 * treating it as generated would let a stale artifact pass verification. The
 * shapes below mirror what the build scripts actually write.
 *
 * @param path - repository-relative POSIX path.
 * @returns whether the path lives in a stage output tree.
 */
function isGeneratedArtifact(path) {
  return /^packages\/[^/]+\/[^/]+\/lib\//u.test(path)
    || /^vendor\/[^/]+\/lib\//u.test(path)
    || /^apps\/[^/]+\/lib\//u.test(path)
    || /^apps\/[^/]+\/dist\//u.test(path)
    || /^native\/system\/packages\/[^/]+\/(?:bin|lib)\//u.test(path)
}

/**
 * Dynamic client bundle entries as pinned by `packages/client/tsdown.client.ts`
 * (`entryFileNames: 'client.js'`, `chunkFileNames: 'client.[name].js'`, each
 * with a source map). These are the artifacts whose bytes embed the
 * `DSH_CLIENT_*` values, so they are the ones the `client` stage owns.
 */
const CLIENT_BUNDLE_ARTIFACT = /(^|\/)client(?:\.[^/]+)?\.js(?:\.map)?$/u

/** Browser bundles and the Ghostty payload copied by the Client build gate. */
const isClientArtifact = path => CLIENT_BUNDLE_ARTIFACT.test(path)
  || path.startsWith('packages/client/ui-user-terminal/lib/assets/')

/** Every artifact under a package's generated `lib` tree belongs to a lib face. */
const anyLibArtifact = path => /(^|\/)lib\//u.test(path)

/**
 * Inputs and outputs per stage.
 *
 * The input sets are deliberately over-inclusive within a stage's own sources:
 * including a file the stage does not read only costs an unnecessary rebuild,
 * while excluding a real input would let a stale artifact be reused. They stay
 * scoped per stage, because that scoping is the point: nothing under `apps/web`
 * can change a host artifact, and no root `src/**`, docs or installer change can
 * touch any of them.
 */
const STAGE_LAYOUTS = {
  'native-system': {
    inputs: [
      'native/system',
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
    ],
    outputs: [`native/system/packages/${platform()}-${arch()}/bin`],
    ownsOutput: path => /^native\/system\/packages\/[^/]+\/bin\//u.test(path),
    // Host binaries are built on Linux and macOS only, so a zero-output
    // credential is legitimate on Windows and a red flag everywhere else.
    requiresOutputs: platform() === 'linux' || platform() === 'darwin',
  },
  host: {
    inputs: [
      'packages',
      'vendor',
      'scripts',
      'native/system',
      'package.json',
      'pnpm-workspace.yaml',
      'apps/cli',
      'apps/desktop',
      'apps/desktop-host',
      'tsdown.config.ts',
      'tsconfig.json',
      'tsconfig.base.json',
      'tsconfig.host.json',
      'pnpm-lock.yaml',
    ],
    outputs: ['packages', 'vendor', 'native/system/packages', 'apps/cli', 'apps/desktop', 'apps/desktop-host'],
    // The Node pass owns every `lib` artifact except the browser bundles.
    ownsOutput: path => anyLibArtifact(path) && !isClientArtifact(path),
    requiresOutputs: true,
  },
  client: {
    inputs: [
      'packages',
      'vendor',
      'scripts',
      'package.json',
      'pnpm-workspace.yaml',
      'apps/cli',
      'apps/desktop',
      'apps/desktop-host',
      'tsdown.config.ts',
      'tsconfig.base.json',
      'tsconfig.client.json',
      'pnpm-lock.yaml',
    ],
    outputs: ['packages', 'vendor', 'apps/cli', 'apps/desktop', 'apps/desktop-host'],
    // The browser pass owns the dynamic bundles the module loader fetches.
    ownsOutput: path => anyLibArtifact(path) && isClientArtifact(path),
    requiresOutputs: true,
  },
  web: {
    inputs: ['apps/web', 'packages', 'vendor', 'scripts', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'],
    outputs: ['apps/web/dist'],
    ownsOutput: () => true,
    requiresOutputs: true,
  },
}

/**
 * Every root the four stages read or write. The shared tree index walks this
 * union once, so it never enumerates the parts of the repository (docs, site,
 * benchmarks) that no build stage can touch.
 */
const INDEX_ROOTS = [...new Set(
  BUILD_STAGES.flatMap(stage => [...STAGE_LAYOUTS[stage].inputs, ...STAGE_LAYOUTS[stage].outputs]),
)]

/** Sort a record's keys so two equivalent environments hash identically. */
function sortRecord(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Values that affect a stage's bytes but are not file contents: the platform and
 * architecture the artifacts are compiled for, and the toolchain.
 * @param environment - public client build environment.
 * @returns deterministic environment digest input.
 */
function environmentKey(environment) {
  return JSON.stringify(sortRecord({
    ...environment,
    platform: platform(),
    arch: arch(),
    node: process.versions.node,
  }))
}

/**
 * The environment values a stage's artifacts actually embed.
 *
 * Only the browser faces inline `DSH_CLIENT_*`: `apps/web/vite.config.ts` and
 * `packages/client/tsdown.client.ts` substitute them into the web bundle and
 * the dynamic client entries. The native and host passes read none of them, so
 * a commit/version bump rebuilds `client` and `web` without redoing native or
 * host work — while still embedding the real value.
 *
 * @param stage - stage whose embedded values are needed.
 * @param environment - complete public client build environment.
 * @returns the subset that must match before the stage may be reused.
 */
function stageEnvironment(stage, environment) {
  if (stage === 'client' || stage === 'web') return environment
  return {}
}

/**
 * A per-run index over the working tree.
 *
 * The four stages overlap heavily (three of them read `packages/**`), so both
 * the directory walk and the per-file stat are shared. The index is created by
 * the caller for one run and never persisted: a persisted stat cache would
 * reintroduce exactly the staleness this module exists to prevent.
 *
 * @param root - repository root the paths are resolved against.
 * @returns cached walking, statting and hashing helpers.
 */
export function createTreeIndex(root) {
  let listing
  const selections = new Map()
  const manifests = new Map()
  const contents = new Map()

  /**
 * Walk the whole tree once, recording whether each file is a generated
 * artifact. The stages overlap heavily (`packages/**` is read by three of
 * them), so walking per stage would repeat the same directory reads.
   * @returns sorted relative POSIX paths plus the generated-tree flag.
   */
  async function list() {
    if (listing !== undefined) return listing
    const files = []
    const pending = INDEX_ROOTS.map(entry => resolve(root, entry))
    const seen = new Set(pending)
    while (pending.length > 0) {
      const current = pending.pop()
      const stats = await stat(current).catch(() => undefined)
      if (stats === undefined) continue
      if (!stats.isDirectory()) {
        const path = relative(root, current).replaceAll(sep, '/')
        files.push({ path, generated: isGeneratedArtifact(path) })
        continue
      }
      const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
      for (const dirent of entries) {
        if (NEVER_ENTERED_DIRS.has(dirent.name)) continue
        const child = join(dirent.parentPath, dirent.name)
        if (dirent.isDirectory()) {
          if (seen.has(child)) continue
          seen.add(child)
          pending.push(child)
          continue
        }
        if (!dirent.isFile()) continue
        const path = relative(root, child).replaceAll(sep, '/')
        files.push({ path, generated: isGeneratedArtifact(path) })
      }
    }
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    listing = files
    return listing
  }

  /**
   * Select the files under one stage's roots.
   * @param roots - repository-relative files or directories.
   * @param generated - whether to keep files inside `lib`/`dist` trees; the
   *   input walk prunes them, the output walk keeps them.
   * @returns sorted repository-relative POSIX paths.
   */
  async function select(roots, generated) {
    const key = `${generated ? 'generated' : 'inputs'}\0${roots.join('\0')}`
    const cached = selections.get(key)
    if (cached !== undefined) return cached
    const matches = []
    for (const file of await list()) {
      if (file.generated !== generated) continue
      for (const entry of roots) {
        if (file.path === entry || file.path.startsWith(`${entry}/`)) {
          matches.push(file.path)
          break
        }
      }
    }
    selections.set(key, matches)
    return matches
  }

  /** Stat one path once per run, returning its identity string. */
  async function manifestOf(path) {
    const cached = manifests.get(path)
    if (cached !== undefined) return cached
    const stats = await stat(resolve(root, path))
    // ctime is what makes a same-size/same-mtime rewrite visible: no ordinary
    // writer (editor, compiler, checkout, install) can preserve it.
    const value = `${String(stats.size)}:${String(Math.trunc(stats.mtimeMs))}:${String(Math.trunc(stats.ctimeMs))}`
    manifests.set(path, value)
    return value
  }

  /** Read and digest one path once per run. */
  async function contentOf(path) {
    const cached = contents.get(path)
    if (cached !== undefined) return cached
    const value = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')
    contents.set(path, value)
    return value
  }

  return { select, manifestOf, contentOf }
}

/**
 * Map over a path list with bounded parallelism, preserving input order.
 *
 * Reading thousands of small files sequentially costs seconds; the same reads
 * with a few dozen in flight cost a fraction of that. Results are placed by
 * index, so parallelism never changes a digest.
 *
 * @param paths - repository-relative POSIX paths, already sorted.
 * @param visit - work to perform for one path and index.
 * @param concurrency - maximum operations in flight.
 * @returns results in input order.
 */
async function mapParallel(paths, visit, concurrency = 32) {
  const results = new Array(paths.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= paths.length) return
      results[index] = await visit(paths[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Digest one record of per-path entries, binding each entry to its path. */
function digestEntries(paths, entries) {
  const digest = createHash('sha256')
  for (const [index, path] of paths.entries()) {
    // The path participates, so a rename is a change even when the bytes are
    // identical, and a length prefix keeps concatenation unambiguous.
    digest.update(`${Buffer.byteLength(path)}:`)
    digest.update(path)
    digest.update(entries[index])
  }
  return digest.digest('hex')
}

/**
 * Digest a path list's size, mtime and ctime without reading any content.
 * @param root - repository root the paths are resolved against.
 * @param paths - repository-relative POSIX paths, already sorted.
 * @param index - per-run tree index supplying stat identities.
 * @returns lowercase SHA-256 digest of the manifest.
 */
async function digestManifest(paths, index) {
  const entries = await mapParallel(paths, path => index.manifestOf(path))
  return digestEntries(paths, entries)
}

/**
 * Digest a path list's contents.
 * @param paths - repository-relative POSIX paths, already sorted.
 * @param index - per-run tree index supplying content digests.
 * @returns lowercase SHA-256 digest of the paths and their contents.
 */
async function digestContents(paths, index) {
  const entries = await mapParallel(paths, path => index.contentOf(path))
  return digestEntries(paths, entries)
}

/** Resolve one stage's current inputs, outputs and embedded environment. */
async function inspect(stage, environment, index) {
  const layout = STAGE_LAYOUTS[stage]
  const inputs = await index.select(layout.inputs, false)
  const outputs = (await index.select(layout.outputs, true))
    .filter(path => layout.ownsOutput(path))
  return {
    layout,
    inputs,
    outputs,
    environment: createHash('sha256')
      .update(environmentKey(stageEnvironment(stage, environment)))
      .digest('hex'),
  }
}

/**
 * Capture one stage's credential from the post-build working tree.
 * @param root - repository root.
 * @param stage - stage to capture.
 * @param environment - public client build environment.
 * @param index - per-run tree index; one is created when omitted.
 * @returns the stage's credential.
 */
export async function captureStageCredential(root, stage, environment, index = createTreeIndex(root)) {
  const current = await inspect(stage, environment, index)
  return {
    inputs: await digestContents(current.inputs, index),
    inputManifest: await digestManifest(current.inputs, index),
    outputs: await digestContents(current.outputs, index),
    outputManifest: await digestManifest(current.outputs, index),
    environment: current.environment,
    inputCount: current.inputs.length,
    outputCount: current.outputs.length,
  }
}

/**
 * Verify a persisted credential against the current working tree.
 *
 * Returns false for every failure mode rather than throwing: a stage whose
 * credential cannot be proven must rebuild, and callers report the stage as
 * "reusing" only on `true`.
 *
 * @param root - repository root.
 * @param stage - stage being verified.
 * @param persisted - the parsed credential file, or undefined when unreadable.
 * @param environment - public client build environment.
 * @param options - `content` re-reads every file even when the manifest matches.
 * @param index - per-run tree index; one is created when omitted.
 * @returns whether the stage may be reused.
 */
export async function verifyStageCredential(
  root,
  stage,
  persisted,
  environment,
  options = {},
  index = createTreeIndex(root),
) {
  if (persisted === undefined) return false
  if (persisted.formatVersion !== STAGE_CREDENTIAL_FORMAT) return false
  const recorded = persisted.stages[stage]
  if (recorded === undefined) return false

  const current = await inspect(stage, environment, index)
  // A stage this host must run cannot be reused with no artifacts at all.
  if (current.layout.requiresOutputs && current.outputs.length === 0) return false
  if (current.environment !== recorded.environment) return false
  // The path list is part of the manifest digest too, so a count check only
  // makes the failure cheap to explain.
  if (recorded.inputCount !== current.inputs.length) return false
  if (recorded.outputCount !== current.outputs.length) return false

  const manifestMatches = options.content !== true
    && await digestManifest(current.inputs, index) === recorded.inputManifest
    && await digestManifest(current.outputs, index) === recorded.outputManifest
  if (manifestMatches) return true

  return await digestContents(current.inputs, index) === recorded.inputs
    && await digestContents(current.outputs, index) === recorded.outputs
}

/**
 * Which stages a complete build must run, given the credentials already on
 * disk. A stage is skipped only when it and every earlier stage verify, so a
 * change confined to `web` inputs cannot reuse a stale `lib` tree and a change
 * confined to the browser bundles cannot reuse a stale host tree.
 *
 * @param root - repository root.
 * @param environment - public client build environment.
 * @param persisted - parsed credentials, or undefined.
 * @param options - verification options, e.g. `{ content: true }`.
 * @param index - per-run tree index; one is created when omitted.
 * @returns the stages to run, in dependency order.
 */
export async function stagesToRun(
  root,
  environment,
  persisted,
  options = {},
  index = createTreeIndex(root),
) {
  const run = []
  let reusable = true
  for (const stage of BUILD_STAGES) {
    reusable = reusable
      && await verifyStageCredential(root, stage, persisted, environment, options, index)
    if (!reusable) run.push(stage)
  }
  return run
}

/** Parse a credential file, rejecting anything whose shape is not recognized. */
function parseStageCredentials(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(parsed)) return undefined
  if (parsed.formatVersion !== STAGE_CREDENTIAL_FORMAT) return undefined
  if (!isObject(parsed.environment) || !isObject(parsed.stages)) return undefined

  const environment = {}
  for (const [name, value] of Object.entries(parsed.environment)) {
    if (typeof value !== 'string') return undefined
    environment[name] = value
  }
  const stages = {}
  for (const stage of BUILD_STAGES) {
    const entry = parsed.stages[stage]
    if (entry === undefined) continue
    if (!isObject(entry)) return undefined
    for (const field of ['inputs', 'inputManifest', 'outputs', 'outputManifest', 'environment']) {
      if (typeof entry[field] !== 'string') return undefined
    }
    if (!Number.isSafeInteger(entry.inputCount) || !Number.isSafeInteger(entry.outputCount)) return undefined
    stages[stage] = {
      inputs: entry.inputs,
      inputManifest: entry.inputManifest,
      outputs: entry.outputs,
      outputManifest: entry.outputManifest,
      environment: entry.environment,
      inputCount: entry.inputCount,
      outputCount: entry.outputCount,
    }
  }
  return { formatVersion: STAGE_CREDENTIAL_FORMAT, environment, stages }
}

/**
 * Read and validate the persisted credential file.
 * @param root - repository root.
 * @returns the parsed file, or undefined when absent, unreadable or malformed.
 */
export function readStageCredentials(root) {
  const path = resolve(root, STAGE_CREDENTIAL_PATH)
  if (!existsSync(path)) return undefined
  try {
    return parseStageCredentials(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Build the credential file for the stages that just ran, preserving the
 * verified credentials of stages that were skipped.
 * @param root - repository root.
 * @param environment - public client build environment.
 * @param ran - stages executed by this build.
 * @param persisted - previously persisted credentials, for skipped stages.
 * @param index - per-run tree index; one is created when omitted.
 * @returns the file to write.
 */
export async function buildStageCredentials(
  root,
  environment,
  ran,
  persisted,
  index = createTreeIndex(root),
) {
  const stages = {}
  for (const stage of BUILD_STAGES) {
    if (ran.includes(stage)) {
      stages[stage] = await captureStageCredential(root, stage, environment, index)
      continue
    }
    // A skipped stage is only carried over while it still verifies; recording a
    // stale one would let the next run trust artifacts this build never proved.
    if (await verifyStageCredential(root, stage, persisted, environment, {}, index)) {
      stages[stage] = persisted.stages[stage]
    }
  }
  return {
    formatVersion: STAGE_CREDENTIAL_FORMAT,
    environment: sortRecord(environment),
    stages,
  }
}

/**
 * Persist a credential file.
 * @param root - repository root.
 * @param credentials - file to write.
 */
export async function writeStageCredentials(root, credentials) {
  const directory = resolve(root, '.dsh-build')
  await mkdir(directory, { recursive: true })
  await writeFile(
    resolve(root, STAGE_CREDENTIAL_PATH),
    `${JSON.stringify(credentials, null, 2)}\n`,
  )
}

/** Narrow an unknown JSON value to a non-array object. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
