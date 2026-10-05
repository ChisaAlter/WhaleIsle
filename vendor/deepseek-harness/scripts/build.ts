/** Run the complete repository build and bind its client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  CLIENT_BUILD_PROFILE_SELECTOR,
  clientBuildProcessEnvironment,
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import {
  BUILD_STAGES,
  buildStageCredentials,
  createTreeIndex,
  readStageCredentials,
  stagesToRun,
  writeStageCredentials,
  type BuildStage,
} from './build-stage-credentials.mjs'
import { pnpmInvocation } from './pnpm-invocation.ts'

/**
 * The package script that runs one stage.
 *
 * `build:lib` is deliberately not used: it would always run both faces, while
 * the credential decides per face. `build:lib:host` and `build:lib:client` are
 * exactly the two halves that script expands to, in the same order.
 */
const STAGE_SCRIPTS: Readonly<Record<BuildStage, string>> = {
  'native-system': 'build:native-system',
  host: 'build:lib:host',
  client: 'build:lib:client',
  web: 'build:web',
}

/** Run one package script through the package manager that invoked this build. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const invocation = pnpmInvocation(['run', script], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

/**
 * Run the stages the credentials cannot prove reusable.
 *
 * A stage is skipped only when its own inputs, outputs and embedded environment
 * still verify, *and* every earlier stage does too, so the dependency order is
 * never violated. `--force` ignores the credentials and re-runs everything.
 */
async function main(): Promise<void> {
  if (!process.features.typescript) {
    throw new Error('build: Node.js TypeScript type stripping is unavailable')
  }
  const { values } = parseArgs({
    options: { profile: { type: 'string' }, force: { type: 'boolean' } },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  const repositoryEnvironment = repositoryClientBuildEnvironment(root, process.env)
  const profile = values.profile ?? process.env[CLIENT_BUILD_PROFILE_SELECTOR]
  const clientEnvironment = resolveClientBuildEnvironment(repositoryEnvironment, profile)
  const buildEnvironment = clientBuildProcessEnvironment(process.env, clientEnvironment)

  // The record is what built-artifact consumers read, so it must not survive a
  // build that is about to rewrite the artifacts it describes.
  const persisted = values.force === true ? undefined : readStageCredentials(root)
  const index = createTreeIndex(root)
  const ran = values.force === true
    ? [...BUILD_STAGES]
    : await stagesToRun(root, clientEnvironment, persisted, {}, index)
  // A missing or unverifiable record means the artifacts are not consumable yet,
  // so a build that would otherwise skip every stage still has to produce one.
  const needsRecord = !clientBuildRecordIsValid(root, clientEnvironment)
  const stages = needsRecord && ran.length === 0 ? [...BUILD_STAGES] : ran

  if (stages.length === 0) {
    console.log('build: all stages are up to date; reusing verified artifacts')
  } else {
    console.log(`build: running ${stages.join(', ')}`)
    rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
    for (const stage of stages) runScript(STAGE_SCRIPTS[stage], buildEnvironment)
  }
  await writeStageCredentials(root, await buildStageCredentials(
    root,
    clientEnvironment,
    stages,
    persisted,
    createTreeIndex(root),
  ))
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

/** Whether a consumable client build record already describes the artifacts. */
function clientBuildRecordIsValid(root: string, environment: Readonly<Record<string, string>>): boolean {
  try {
    readClientBuildRecord(root, environment)
    return true
  } catch {
    return false
  }
}

if (import.meta.main) await main()
