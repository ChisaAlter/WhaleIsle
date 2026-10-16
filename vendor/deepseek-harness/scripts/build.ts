/**
 * Build repository artifacts, type-check the aggregate test and script programs, or both.
 *
 * `--scope artifacts` emits every artifact and binds the client outputs to their public environment;
 * `--scope check` type-checks only the Host and Client aggregate programs against the package
 * declarations already on disk; the default runs both step sets as one dependency graph, so the
 * aggregate checks overlap the remaining artifact steps. `--scope typecheck` (`pnpm run typecheck`)
 * type-checks every package project and both aggregate programs; beside Host compilation it writes
 * the Typert declarations that Client compilation imports, without bundling.
 */

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
  BUILD_STAGES, buildStageCredentials, createTreeIndex, readStageCredentials, stagesToRun, writeStageCredentials,
  type BuildStage,
} from './build-stage-credentials.mjs'
import { aggregateBuildArgs, aggregateCheckArgs, contractSteps, libraryBuildSteps } from './compile-referenced-projects.ts'
import type { LibraryStep } from './compile-referenced-projects.ts'
import { pnpmCommand } from './release/process.ts'
import { defaultParallelism, describeDefaultParallelism } from './parallelism.ts'
import { runAggregate } from './run-gates.ts'
import type { Gate } from './run-gates.ts'

/**
 * Steps one build invocation runs: every artifact and check, only artifacts, only aggregate checks,
 * or every type check with the generated Typert declarations it needs.
 */
export type BuildScope = 'complete' | 'artifacts' | 'check' | 'typecheck'

/** Parsed command-line selection of one build invocation. */
export interface BuildArguments {
  readonly scope: BuildScope
  /** Client build profile requested by `--profile`; `complete` and `artifacts` scopes only. */
  readonly profile: string | undefined
  /** Rebuild every artifact stage, ignoring saved stage credentials. */
  readonly force?: true
}

/**
 * Parse the build command line.
 * @param args - Arguments after the script path.
 * @returns The selected scope and requested client build profile.
 * @throws If an option is unknown, the scope is not `artifacts`, `check`, or `typecheck`,
 *   or `--profile` accompanies `--scope check` or `--scope typecheck`.
 */
export function parseBuildArguments(args: readonly string[]): BuildArguments {
  const { values } = parseArgs({
    args: [...args],
    options: {
      profile: { type: 'string' },
      scope: { type: 'string' },
      force: { type: 'boolean' },
    },
    allowPositionals: false,
  })
  if (values.scope !== undefined && values.scope !== 'artifacts' && values.scope !== 'check' && values.scope !== 'typecheck') {
    throw new Error(`build: --scope must be artifacts, check, or typecheck, got ${JSON.stringify(values.scope)}; omit it for the complete build`)
  }
  const scope: BuildScope = values.scope ?? 'complete'
  if ((scope === 'check' || scope === 'typecheck') && values.profile !== undefined) {
    throw new Error(`build: --profile selects artifact values and does not apply to --scope ${scope}`)
  }
  return { scope, profile: values.profile, ...values.force === true ? { force: true as const } : {} }
}

/**
 * Construct the build steps of one scope as a gate dependency graph.
 * Artifact steps keep the serial order native, Host compilation, Host bundle (Typert),
 * Desktop bundle, Client compilation, Client bundle, then Web. The typecheck scope runs Host
 * compilation beside the bundle-free Typert pass, which reads only source, and then Client
 * compilation, which needs both outputs; it writes no bundle. In the complete and typecheck
 * scopes each aggregate check waits only for its own face's package compilation; alone, the
 * checks have no predecessors and read whatever declarations already exist. The typecheck scope
 * checks aggregates in build mode, which skips a program whose tsbuildinfo is current; the other
 * scopes use project mode, which compiles no reference.
 * @param root - Repository root containing the compiler and bundle configurations.
 * @param scope - Steps to include.
 * @param environment - Environment overlay applied to every step; the parent value of a key mapped to `undefined` is removed.
 * @returns The gate graph in report order.
 * @throws If an aggregate configuration is invalid.
 */
export function buildGates(
  root: string,
  scope: BuildScope,
  environment: Readonly<Record<string, string | undefined>> = {},
): Gate[] {
  const env = { ...environment }
  const gates: Gate[] = []
  if (scope === 'complete' || scope === 'artifacts') {
    gates.push(pnpmGate('native', 'native addon', ['run', 'build:native-system'], [], env))
    for (const step of libraryBuildSteps(root, 'all')) {
      gates.push(libraryGate(step, step.id === 'host-src' ? ['native'] : step.needs, env))
    }
    gates.push({
      id: 'terminal-assets',
      label: 'Terminal assets',
      displayCommand: 'node packages/client/ui-user-terminal/scripts/copy-ghostty-assets.mjs',
      command: process.execPath,
      args: ['packages/client/ui-user-terminal/scripts/copy-ghostty-assets.mjs'],
      needs: ['client-bundle'],
      env,
    })
    gates.push(pnpmGate('web', 'Web build', ['run', 'build:web'], ['terminal-assets'], env))
  }
  if (scope === 'typecheck') {
    for (const step of contractSteps(root, 'all')) gates.push(libraryGate(step, step.needs, env))
  }
  if (scope !== 'artifacts') {
    for (const face of ['host', 'client'] as const) {
      gates.push({
        id: `${face}-check`,
        label: `${face} aggregate check`,
        displayCommand: `tsc ${scope === 'typecheck' ? '-b' : '-p'} tsconfig.${face}.json`,
        command: process.execPath,
        args: scope === 'typecheck' ? aggregateBuildArgs(face) : aggregateCheckArgs(face),
        // No Host aggregate file imports a generated `/typert` or `/remote` subpath, so
        // host-check never reads what a concurrent host-typert step writes.
        needs: scope === 'check' ? [] : [`${face}-src`],
        env,
      })
    }
  }
  return gates
}

function libraryGate(step: LibraryStep, needs: readonly string[], env: Record<string, string | undefined>): Gate {
  return {
    id: step.id,
    label: step.label,
    displayCommand: step.displayCommand,
    command: step.command,
    args: [...step.args],
    needs: [...needs],
    env,
  }
}

function pnpmGate(
  id: string,
  label: string,
  args: readonly string[],
  needs: readonly string[],
  env: Record<string, string | undefined>,
): Gate {
  const [command, ...prefix] = pnpmCommand()
  return { id, label, displayCommand: `pnpm ${args.join(' ')}`, command, args: [...prefix, ...args], needs: [...needs], env }
}

/**
 * Express a complete child environment as an overlay on the parent environment.
 * @param parent - Environment the gate executor merges the overlay into.
 * @param child - Complete environment every step must observe.
 * @returns `child` plus an `undefined` entry for each parent key it omits.
 */
function environmentOverlay(parent: NodeJS.ProcessEnv, child: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return { ...Object.fromEntries(Object.keys(parent).map(name => [name, undefined])), ...child }
}

async function main(): Promise<number> {
  // tsdown.config.ts loads only through Node type stripping (`--config-loader native`); this names the cause before tsdown fails.
  if (!process.features.typescript) {
    throw new Error('build: Node.js TypeScript type stripping is unavailable in this Node.js process; remove --no-experimental-strip-types from NODE_OPTIONS or use a Node.js build with TypeScript support')
  }
  const { scope, profile, force } = parseBuildArguments(process.argv.slice(2))
  const root = resolve(import.meta.dirname, '..')
  const name = scope === 'complete' ? 'build' : scope === 'typecheck' ? 'typecheck' : `build:${scope}`
  const budget = defaultParallelism()
  const workers = (gates: readonly Gate[]) => ({
    workers: Math.min(gates.length, budget),
    source: describeDefaultParallelism(),
  })
  if (scope === 'check' || scope === 'typecheck') {
    const gates = buildGates(root, scope)
    return runAggregate(name, gates, workers(gates))
  }

  const repositoryEnvironment = repositoryClientBuildEnvironment(root, process.env)
  const clientEnvironment = resolveClientBuildEnvironment(repositoryEnvironment, profile ?? process.env[CLIENT_BUILD_PROFILE_SELECTOR])
  const environment = environmentOverlay(process.env, clientBuildProcessEnvironment(process.env, clientEnvironment))
  const persisted = force === true ? undefined : readStageCredentials(root)
  const stale = force === true ? [...BUILD_STAGES] : await stagesToRun(root, clientEnvironment, persisted, {}, createTreeIndex(root))
  const stages = stale.length === 0 && !clientBuildRecordIsValid(root, clientEnvironment) ? [...BUILD_STAGES] : stale
  const gates = reusableBuildGates(buildGates(root, scope, environment), stages)
  if (stages.length > 0) rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  else console.log('build: all artifact stages are up to date; reusing verified artifacts')
  const exitCode = gates.length === 0 ? 0 : await runAggregate(name, gates, workers(gates))
  if (exitCode !== 0) return exitCode
  await writeStageCredentials(root, await buildStageCredentials(root, clientEnvironment, stages, persisted, createTreeIndex(root)))
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
  return 0
}

/** Keep aggregate checks, skipping only artifact stages whose inputs and outputs still match. */
export function reusableBuildGates(gates: readonly Gate[], stages: readonly BuildStage[]): Gate[] {
  const stageByGate: Readonly<Record<string, BuildStage>> = {
    native: 'native-system', 'host-src': 'host', 'host-bundle': 'host', 'desktop-bundle': 'host',
    'client-src': 'client', 'client-bundle': 'client', 'terminal-assets': 'client', web: 'web',
  }
  const selected = gates.filter(gate => stageByGate[gate.id] === undefined || stages.includes(stageByGate[gate.id]!))
  const ids = new Set(selected.map(gate => gate.id))
  return selected.map(gate => ({ ...gate, needs: (gate.needs ?? []).filter(id => ids.has(id)) }))
}

function clientBuildRecordIsValid(root: string, environment: Readonly<Record<string, string>>): boolean {
  try {
    readClientBuildRecord(root, environment)
    return true
  } catch {
    return false
  }
}

if (import.meta.main) process.exitCode = await main()
