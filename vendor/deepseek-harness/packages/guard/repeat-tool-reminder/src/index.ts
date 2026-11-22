/**
 * Advisory per-agent repeat-call detector. It enriches post-execute decisions
 * with logged model context without vetoing or rewriting calls. Configuration
 * and chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'repeat-tool-reminder': { kind: 'repeat-tool-reminder' } & ContextFormed
  }
}

import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'repeat-tool-reminder'

/** Default threshold at which repeated identical or ABAB-oscillating calls hard-stop the turn. */
export const DEFAULT_HARD_STOP_THRESHOLD = 10

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** High repeat or ABAB-oscillation count that blocks further execution and stops the turn (default `10`). */
  hardStopThreshold?: number
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
}

export const Config: z<Config> = z.object({
  thresholds: z.array(z.number()).default([3, 5, 8]),
  hardStopThreshold: z.number().default(DEFAULT_HARD_STOP_THRESHOLD),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  argumentsPreviewChars: z.number().default(500),
})

/**
 * The `{kind:'repeat-tool-reminder'}` producer source stamped on every reminder
 * this guard injects — the label is load-bearing (an unlabeled context would
 * render as a user prompt in derived history).
 */
const REMINDER_SOURCE: MessageSource = { kind: 'repeat-tool-reminder' }

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated tool call detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_calls: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'The repeated calls are not making progress. Do not call this tool with '
    + 'these exact arguments again. Inspect the latest result and choose a '
    + 'different action, different arguments, or finish the task if enough '
    + 'evidence has been gathered.'
}

const GENTLE_OSCILLATION_REMINDER =
  'You are alternating between the same two tool calls (ABAB oscillation) without making progress. '
  + 'Stop repeating this cycle, analyze the results gathered so far, and either try a new approach or finish.'

function detailedOscillationReminder(
  toolName: string,
  otherKey: string,
  count: number,
  canonicalArguments: string,
): string {
  const otherTool = parsedToolName(otherKey)
  return 'Alternating tool-call oscillation (ABAB) detected:\n'
    + `- pattern: ${otherTool} ⇄ ${toolName}\n`
    + `- oscillation_calls: ${count}\n`
    + `- latest_arguments: ${canonicalArguments}\n`
    + 'The alternating calls are not making progress. Break the oscillation by '
    + 'changing approach or concluding the task.'
}

function hardStopReason(toolName: string, count: number, mode: 'consecutive' | 'oscillation'): string {
  const kindLabel = mode === 'oscillation' ? 'alternating ABAB oscillation' : 'consecutive identical calls'
  return `Repeat tool guard hard stop: tool "${toolName}" reached ${count} ${kindLabel} without progress; blocking further execution to force convergence.`
}

function parsedToolName(chainKey: string): string {
  try {
    const parsed: unknown = JSON.parse(chainKey)
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0]
  } catch {
    // fallback if key cannot be parsed
  }
  return 'unknown'
}

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}

/**
 * Prepend the guard's reminder while preserving every downstream context's
 * source and metadata.
 */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/** One agent's repeat-call and ABAB 2-cycle oscillation state. */
interface Chain {
  consecutiveKey: string
  consecutiveCount: number
  lastKey: string
  cycle?: {
    readonly keys: readonly [string, string]
    nextExpectedIndex: 0 | 1
    length: number
  }
}

type Observation =
  | { readonly kind: 'none' }
  | { readonly kind: 'reminder'; readonly message: UserMessage }
  | { readonly kind: 'hard-stop'; readonly reason: string }

function advanceChain(previous: Chain | undefined, key: string): Chain {
  if (previous === undefined) {
    return { consecutiveKey: key, consecutiveCount: 1, lastKey: key }
  }
  const consecutiveCount = previous.consecutiveKey === key ? previous.consecutiveCount + 1 : 1
  if (key === previous.lastKey) {
    // Calling the same key twice in a row breaks any ABAB 2-cycle alternation.
    return { consecutiveKey: key, consecutiveCount, lastKey: key }
  }
  if (previous.cycle !== undefined && key === previous.cycle.keys[previous.cycle.nextExpectedIndex]) {
    return {
      consecutiveKey: key,
      consecutiveCount,
      lastKey: key,
      cycle: {
        keys: previous.cycle.keys,
        nextExpectedIndex: previous.cycle.nextExpectedIndex === 0 ? 1 : 0,
        length: previous.cycle.length + 1,
      },
    }
  }
  return {
    consecutiveKey: key,
    consecutiveCount,
    lastKey: key,
    cycle: { keys: [previous.lastKey, key], nextExpectedIndex: 0, length: 2 },
  }
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const thresholds = validateThresholds(config.thresholds as number[])
  const thresholdSet = new Set(thresholds)
  const hardStopThreshold = config.hardStopThreshold as number
  if (!Number.isInteger(hardStopThreshold) || hardStopThreshold < 2) {
    throw new Error(`repeat-tool-reminder: invalid hardStopThreshold ${hardStopThreshold} — must be an integer >= 2`)
  }
  const includePatterns = (config.include as string[]).map(wildcardToRegExp)
  const excludePatterns = (config.exclude as string[]).map(wildcardToRegExp)
  const argumentsPreviewChars = config.argumentsPreviewChars as number
  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`)
  }

  const chains = new WeakMap<Agent, Chain>()
  const observedExecs = new WeakMap<ToolExecution, Observation>()
  const hardStoppedAgents = new WeakSet<Agent>()

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName))) return false
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  /**
   * Advance the calling agent's chain for one attempt and determine whether it
   * emits a reminder or trips the hard stop.
   */
  function observe(exec: ToolExecution): Observation {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (!exec.agent) return { kind: 'none' }
    if (!tracked(exec.name)) return { kind: 'none' }
    const canonical = canonicalize(exec.arguments)
    const key = JSON.stringify([exec.name, canonical])
    const nextChain = advanceChain(chains.get(exec.agent), key)
    chains.set(exec.agent, nextChain)

    const consecutiveCount = nextChain.consecutiveCount
    const oscillationLength = nextChain.cycle !== undefined && nextChain.cycle.length >= 4
      ? nextChain.cycle.length
      : 0

    if (consecutiveCount >= hardStopThreshold || oscillationLength >= hardStopThreshold) {
      const mode = oscillationLength >= hardStopThreshold ? 'oscillation' : 'consecutive'
      const count = mode === 'oscillation' ? oscillationLength : consecutiveCount
      return { kind: 'hard-stop', reason: hardStopReason(exec.name, count, mode) }
    }

    if (thresholdSet.has(consecutiveCount)) {
      const text = consecutiveCount === thresholds[0]
        ? GENTLE_REMINDER
        : detailedReminder(exec.name, consecutiveCount, previewArguments(canonical, argumentsPreviewChars))
      return {
        kind: 'reminder',
        message: createUserMessage({
          content: [{ type: 'text', text }],
          source: { ...REMINDER_SOURCE, form: 'notice', summary: `${exec.name} × ${consecutiveCount}` },
        }),
      }
    }

    const cycle = nextChain.cycle
    if (cycle !== undefined && oscillationLength >= 4) {
      const firstThreshold = thresholds[0] ?? 3
      const firstOscillationTrigger = oscillationLength === 4 && firstThreshold < 4
      if (firstOscillationTrigger || thresholdSet.has(oscillationLength)) {
        const isGentle = firstOscillationTrigger || oscillationLength === firstThreshold
        const otherKey = cycle.keys.find(entry => entry !== key) ?? key
        const text = isGentle
          ? GENTLE_OSCILLATION_REMINDER
          : detailedOscillationReminder(
            exec.name,
            otherKey,
            oscillationLength,
            previewArguments(canonical, argumentsPreviewChars),
          )
        return {
          kind: 'reminder',
          message: createUserMessage({
            content: [{ type: 'text', text }],
            source: { ...REMINDER_SOURCE, form: 'notice', summary: `${exec.name} ⇄ ${oscillationLength}` },
          }),
        }
      }
    }

    return { kind: 'none' }
  }

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const observation = observe(exec)
    observedExecs.set(exec, observation)
    if (observation.kind === 'hard-stop' && exec.agent !== undefined) {
      hardStoppedAgents.add(exec.agent)
      return {
        kind: 'deny',
        reason: observation.reason,
        info: { name: 'RepeatToolHardStopError', code: 'REPEAT_TOOL_HARD_STOP' },
      }
    }
    return next()
  })

  // Enrich post-execute decisions (including calls denied by an earlier
  // pre-execute listener before ours ran) without overwriting downstream state.
  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const observation = observedExecs.get(exec) ?? observe(exec)
    const downstream = await next()
    if (observation.kind !== 'reminder') return downstream
    return { ...downstream, additionalContexts: prependContext(observation.message, downstream.additionalContexts) }
  })

  // A user interjection changes the context and resets the guard. When hard-stopped
  // without new user input, reject the next step to force loop convergence.
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) {
      chains.delete(agent)
      hardStoppedAgents.delete(agent)
      return next()
    }
    if (hardStoppedAgents.has(agent)) {
      hardStoppedAgents.delete(agent)
      chains.delete(agent)
      return Promise.resolve({ kind: 'reject' })
    }
    return next()
  })
}
