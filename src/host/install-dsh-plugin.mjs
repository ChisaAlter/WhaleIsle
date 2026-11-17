import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { executeInstallDshPlugin, renderInstall, internalSecret } = createRequire(import.meta.url)('./install-dsh-plugin-client.js')

export const name = 'dshd-desktop-plugin-install'
export const inject = ['tools']

const DESCRIPTION = 'Install a DeepSeek Harness plugin into the desktop web profile from a github:owner/repo[#sha] spec. Prepare scripts run on this machine, outside the sandbox. Call only for the spec the user named. If needsAllowBuilds is true, ask the user, then retry with those allowBuilds keys. A successful install restarts the desktop app to load the plugin.'

// The URL still rides env; the Bearer token is a credential and arrives over
// the host's stdin secret channel into the in-process store (#427) — never
// process.env, so tool-spawned children cannot inherit it.
function controlConfig() {
  const url = process.env.DSH_DESKTOP_INSTALL_URL
  const token = internalSecret('DSH_DESKTOP_INSTALL_TOKEN')
  if (!url || !token) return null
  return { url, token }
}

function requireAnchors() {
  const anchors = []
  const harnessRoot = process.env.DSH_HARNESS_ROOT
  if (harnessRoot) {
    anchors.push(path.join(harnessRoot, 'package.json'))
    anchors.push(path.join(harnessRoot, 'apps', 'cli', 'package.json'))
  }
  anchors.push(fileURLToPath(import.meta.url))
  return anchors
}

/**
 * Resolve defineTool from the running Harness install, not from this profile
 * copy. The plugin file lives under $DSH_HOME; a static
 * `import '@deepseek-ai/dsh-tools'` from that path aborts the whole Host when
 * the profile fallback cannot see the package.
 * @returns defineTool from @deepseek-ai/dsh-tools.
 */
async function loadDefineTool() {
  let lastError
  for (const anchor of requireAnchors()) {
    if (!existsSync(anchor)) continue
    try {
      const resolved = createRequire(anchor).resolve('@deepseek-ai/dsh-tools')
      const mod = await import(pathToFileURL(resolved).href)
      if (typeof mod.defineTool === 'function') return mod.defineTool
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Cannot resolve @deepseek-ai/dsh-tools')
}

/**
 * Register install_dsh_plugin when the desktop control endpoint is in the environment.
 * @param {{ tools: { register(tool: unknown): void } }} ctx - Host context with the tools registry.
 */
export async function apply(ctx) {
  const control = controlConfig()
  if (control === null) return
  let defineTool
  try {
    defineTool = await loadDefineTool()
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    console.error(`[dshd-desktop-plugin-install] skipped install_dsh_plugin: ${message}`)
    return
  }
  ctx.tools.register(defineTool({
    name: 'install_dsh_plugin',
    description: DESCRIPTION,
    parameters: {
      spec: {
        type: 'string',
        required: true,
        description: 'github:owner/repo or github:owner/repo#sha from the user request.',
      },
      allowBuilds: {
        type: 'array',
        items: { type: 'string' },
        description: 'pnpm allowBuilds keys after the user approved prepare scripts.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          declined: { type: 'boolean', required: true },
          needsAllowBuilds: { type: 'boolean', required: true },
          allowBuilds: { type: 'array', required: true, items: { type: 'string' } },
          spec: { type: 'string', required: true },
          error: { type: 'string', required: true },
          log: { type: 'string', required: true },
          restarting: { type: 'boolean', required: true },
        },
      },
      /**
       * @param {Record<string, unknown>} _args
       * @param {{declined: boolean, needsAllowBuilds: boolean, allowBuilds: string[], spec: string, ok: boolean, error: string}} value
       */
      render: (_args, value) => [{ type: 'text', text: renderInstall(value) }],
    },
    /** @param {{spec?: unknown, allowBuilds?: unknown}} args */
    async execute(args) {
      return executeInstallDshPlugin(control, args.spec, args.allowBuilds ?? [])
    },
    /** @param {{spec?: unknown}} args */
    presentCall: args => ({ card: 'generic', title: '安装插件', kind: 'other', rawInput: args.spec }),
  }))
}
