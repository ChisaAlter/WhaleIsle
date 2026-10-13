import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BridgeClient } from './bridge-client.js';
import { ChatGPTBrowser } from './browser.js';
import { CheckpointStore, stateDirectory, workspaceOf, PROTOCOL_STATES, WAITING_FOR } from './state.js';
import { Workspace } from '../bridge/dist/workspace/manager.js';

export const name = 'dsh-with-chatgpt';
export const inject = ['tools', 'skills', 'agents'];
export const Config = z.object({
  stateDir: z.string().min(1),
  node: z.string().min(1),
  browserExecutable: z.string().min(1),
  headless: z.boolean().default(false),
});

const SKILL_DIRECTORY = fileURLToPath(new URL('../skills/dsh-with-chatgpt/', import.meta.url));
const DESCRIPTION = 'Connect ChatGPT to the current DSH workspace for planning and independent review, while DSH edits and runs checks. Use for DSH with ChatGPT, connecting or disconnecting ChatGPT, and resuming that collaboration.';
const output = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      data: { type: 'object', additionalProperties: true, required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.data, null, 2) }],
};

function maxIterations(root) {
  let config;
  try { config = JSON.parse(fs.readFileSync(path.join(root, '.d2c.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return 12; throw error; }
  const limit = config?.maxIterations ?? 12;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('.d2c.json maxIterations must be a positive integer.');
  return limit;
}

function nominatedOutput(root, value) {
  const { abs: file } = new Workspace(root).resolve(value);
  if (!fs.statSync(file).isFile()) throw new Error('Execution output must be a file.');
  return file;
}

export function apply(ctx, config = {}) {
  const stateDir = stateDirectory(config.stateDir);
  const bridge = new BridgeClient({ stateDir, node: config.node });
  const store = new CheckpointStore(stateDir);
  const browser = new ChatGPTBrowser({ profileDir: path.join(stateDir, 'browser-profile'), executablePath: config.browserExecutable, headless: config.headless ?? false });
  const connectionOrigins = new Map();

  const caller = (exec) => {
    const agent = exec.agent;
    if (!agent || ctx.agents.get(agent.id) !== agent) throw new Error('ChatGPT tools require the current live DSH Session.');
    exec.signal.throwIfAborted();
    return { agent, root: workspaceOf(agent) };
  };
  const rememberEndpoint = (root, result) => {
    if (typeof result.mcpUrl === 'string') connectionOrigins.set(root, new URL(result.mcpUrl).origin);
    if (typeof result.publicUrl === 'string') connectionOrigins.set(root, new URL(result.publicUrl).origin);
    const repairUrl = result.chatgptRepair?.mcpUrl;
    if (typeof repairUrl === 'string') connectionOrigins.set(root, new URL(repairUrl).origin);
  };
  const register = (definition) => ctx.tools.register(defineTool({
    timeoutMs: 120_000, output,
    presentCall: () => ({ card: 'generic', title: 'DSH with ChatGPT', kind: 'other', content: [] }),
    ...definition,
  }));

  ctx.effect(() => () => browser.dispose(), 'dsh-with-chatgpt.browser');
  const skillFile = path.join(SKILL_DIRECTORY, 'SKILL.md');
  const raw = fs.readFileSync(skillFile, 'utf8');
  const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  ctx.skills.register({ name, description: DESCRIPTION, source: 'bundled', provider: name, path: skillFile, resourceBase: { kind: 'directory', path: SKILL_DIRECTORY }, content });

  register({
    name: 'chatgpt_connection',
    description: 'Read or configure this workspace\'s dedicated DSH with ChatGPT connection. Setup creates a read-only bridge and pairing code; it does not authorize ChatGPT by itself. Never alters Codex connections or configuration. Only setup, doctor and tunnel_choose may start or change the public connection.',
    parameters: {
      action: { type: 'string', enum: ['status', 'prefs', 'prefs_set', 'setup', 'doctor', 'pair', 'unpair', 'tunnel_status', 'tunnel_choose'], required: true },
      setupMode: { type: 'string', enum: ['auto', 'manual'] },
      developerModeEnabled: { type: 'boolean' },
      localOnly: { type: 'boolean', description: 'Local bridge development only, not a ChatGPT-accessible connection.' },
      diagnoseOnly: { type: 'boolean' },
      mode: { type: 'string', enum: ['quick', 'named'] },
      zone: { type: 'string' }, hostname: { type: 'string' },
    },
    async execute(args, exec) {
      const { root } = caller(exec);
      let command;
      switch (args.action) {
        case 'status': command = ['status']; break;
        case 'prefs': command = ['prefs']; break;
        case 'prefs_set':
          command = ['prefs', 'set'];
          if (args.setupMode !== undefined) command.push('--setup-mode', args.setupMode);
          if (args.developerModeEnabled === true) command.push('--developer-mode');
          break;
        case 'setup': command = ['setup', ...(args.localOnly ? ['--no-tunnel'] : [])]; break;
        case 'doctor': command = ['doctor', ...(args.diagnoseOnly ? ['--no-fix'] : [])]; break;
        case 'pair': command = ['pair']; break;
        case 'unpair': command = ['unpair']; break;
        case 'tunnel_status': command = ['tunnel', 'status']; break;
        case 'tunnel_choose':
          if (!args.mode) throw new Error('Choose quick or named explicitly.');
          command = ['tunnel', 'choose', '--mode', args.mode];
          if (args.zone) command.push('--zone', args.zone);
          if (args.hostname) command.push('--hostname', args.hostname);
          break;
        default: throw new Error('Unknown connection action.');
      }
      const data = await bridge.run(command, root, exec.signal);
      rememberEndpoint(root, data);
      return { ok: data.ok !== false, data };
    },
  });

  register({
    name: 'chatgpt_browser',
    description: 'Operate only the plugin-owned persistent ChatGPT browser, never the user\'s main browser. Use snapshot-generated target ids for click/fill/press; no selectors or arbitrary JavaScript. Login, CAPTCHA and 2FA are user-only. Close releases this live Session\'s ownership but keeps login data. Read rendered replies through snapshot; wait between checks instead of resending messages.',
    parameters: {
      action: { type: 'string', enum: ['navigate', 'snapshot', 'read_reply', 'click', 'fill', 'press', 'close'], required: true },
      url: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' }, key: { type: 'string' },
      offset: { type: 'number' }, length: { type: 'number' },
    },
    async execute(args, exec) {
      const { agent, root } = caller(exec);
      const origin = connectionOrigins.get(root);
      // The bridge origin comes from trusted local discovery, never a model argument.
      if (origin) browser.setBridgeOrigin(origin, agent);
      const data = await browser.run(agent, args, exec.signal);
      return { ok: true, data };
    },
  });

  register({
    name: 'chatgpt_checkpoint',
    description: 'Read or save ChatGPT chat URL and collaboration checkpoint for the current DSH Session and workspace. Different DSH Sessions never reuse one another\'s chat or task. Save URLs only after ChatGPT verifies the expected workspace; waiting states only after the sent message is visible.',
    parameters: {
      action: { type: 'string', enum: ['get', 'set', 'start'], required: true },
      chatUrl: { type: 'string' }, projectUrl: { type: 'string' }, taskId: { type: 'string' },
      iteration: { type: 'number' }, state: { type: 'string', enum: PROTOCOL_STATES },
      waitingFor: { type: 'string', enum: WAITING_FOR },
      goal: { type: 'string' }, completed: { type: 'string' }, issues: { type: 'string' }, nextStep: { type: 'string' },
      clear: { type: 'boolean' },
    },
    async execute(args, exec) {
      const { agent, root } = caller(exec);
      const limit = maxIterations(root);
      if (args.iteration > limit) throw new Error(`This task reached its ${limit}-iteration limit. Ask the user before increasing maxIterations.`);
      const session = args.action === 'get' ? store.get(agent) : args.action === 'start' ? store.start(agent, args) : store.update(agent, args);
      return { ok: true, data: { session, maxIterations: limit } };
    },
  });

  register({
    name: 'chatgpt_record',
    description: 'Record the current iteration for ChatGPT to read through its read-only workspace connection. Does not run the supplied command. Command output is nominated as a workspace file, sanitized locally, and may be withheld. Never paste logs or code into ChatGPT messages.',
    parameters: {
      iteration: { type: 'number', required: true },
      changedFiles: { type: 'array', items: { type: 'string' }, required: true },
      tests: { type: 'string', required: true }, exitStatus: { type: 'string', required: true },
      command: { type: 'string' }, outputFile: { type: 'string' }, exitCode: { type: 'number' }, notes: { type: 'string' },
    },
    async execute(args, exec) {
      const { agent, root } = caller(exec);
      const session = store.get(agent);
      if (!session) throw new Error('Create this Session\'s checkpoint before recording an iteration.');
      if (!Number.isSafeInteger(args.iteration) || args.iteration < 0 || args.iteration > maxIterations(root)) throw new Error('Iteration is outside the task limit.');
      if (Boolean(args.command) !== Boolean(args.outputFile)) throw new Error('Nominate both command and outputFile, or neither.');
      const command = ['record', '--task', session.taskId, '--iteration', String(args.iteration), '--changed-files', args.changedFiles.join(','), '--tests', args.tests, '--exit-status', args.exitStatus, '--executor', 'dsh'];
      if (args.command) command.push('--command', args.command, '--output-file', nominatedOutput(root, args.outputFile));
      if (args.exitCode !== undefined) command.push('--exit-code', String(args.exitCode));
      if (args.notes) command.push('--notes', args.notes);
      const data = await bridge.run(command, root, exec.signal);
      return { ok: data.ok !== false, data };
    },
  });
}
