import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const PROTOCOL_STATES = ['INIT', 'PLAN_RECEIVED', 'EXECUTING', 'EXECUTED_LOCAL', 'EXECUTED_SENT', 'DONE', 'BLOCKED'];
export const WAITING_FOR = ['none', 'GPT_PLAN', 'GPT_REVIEW', 'USER'];

export function stateDirectory(configured) {
  const override = configured ?? process.env.D2C_STATE_DIR;
  if (override?.trim()) return path.resolve(override);
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'dsh-with-chatgpt');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'dsh-with-chatgpt');
  return path.join(process.env.XDG_STATE_HOME ?? path.join(home, '.local', 'state'), 'dsh-with-chatgpt');
}

export function workspaceOf(agent) {
  const cwd = agent?.session?.header?.cwd;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('ChatGPT requires a live DSH Session with an absolute workspace.');
  const root = fs.realpathSync.native(cwd);
  if (!fs.statSync(root).isDirectory()) throw new Error('The DSH Session workspace is not a directory.');
  return root;
}

function identity(root, sessionId) {
  const canonical = process.platform === 'win32' || process.platform === 'darwin' ? root.toLowerCase() : root;
  return createHash('sha256').update(JSON.stringify([canonical, sessionId])).digest('hex');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function chatUrl(value) {
  if (typeof value !== 'string') throw new Error('Chat URL must be a string.');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'chatgpt.com' || parsed.username || parsed.password || parsed.port) throw new Error('Chat URL must be an HTTPS chatgpt.com conversation.');
  if (!/^\/(?:g\/[^/]+\/)?c\/[a-zA-Z0-9-]+\/?$/.test(parsed.pathname)) throw new Error('Save a conversation URL, not the ChatGPT home or settings page.');
  parsed.search = ''; parsed.hash = '';
  return parsed.href;
}

export class CheckpointStore {
  constructor(stateDir) { this.directory = path.join(stateDir, 'dsh-sessions'); }

  file(agent) {
    if (typeof agent?.id !== 'string' || !agent.id) throw new Error('Missing DSH Session identity.');
    return path.join(this.directory, `${identity(workspaceOf(agent), agent.id)}.json`);
  }

  get(agent) { return readJson(this.file(agent)); }

  start(agent, patch) {
    const previous = this.get(agent);
    if (previous?.checkpoint && !['DONE', 'BLOCKED'].includes(previous.checkpoint.state)) throw new Error('Finish or explicitly resolve this Session\'s pending task before starting another.');
    return this.update(agent, { ...patch, taskId: `d2c_${randomUUID().slice(0, 8)}`, iteration: 0, clear: true });
  }

  update(agent, patch) {
    const file = this.file(agent);
    const previous = readJson(file) ?? { sessionId: agent.id, taskId: `d2c_${randomUUID().slice(0, 8)}`, iteration: 0 };
    const next = { ...previous, updatedAt: new Date().toISOString() };
    if (patch.clear === true) { delete next.checkpoint; }
    if (patch.chatUrl !== undefined) next.chatUrl = chatUrl(patch.chatUrl);
    if (patch.projectUrl !== undefined) {
      const url = new URL(patch.projectUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.username || url.password || url.port || !/^\/g\/g-p-[a-zA-Z0-9]+\/project\/?$/.test(url.pathname)) throw new Error('Project URL must be a ChatGPT Project collection.');
      next.projectUrl = `${url.origin}${url.pathname}`;
    }
    if (patch.taskId !== undefined) {
      if (!/^d2c_[a-zA-Z0-9-]{1,64}$/.test(patch.taskId)) throw new Error('Invalid D2C task id.');
      next.taskId = patch.taskId;
    }
    if (patch.iteration !== undefined) {
      if (!Number.isSafeInteger(patch.iteration) || patch.iteration < 0) throw new Error('Iteration must be a non-negative integer.');
      next.iteration = patch.iteration;
    }
    if (patch.state !== undefined) {
      if (!PROTOCOL_STATES.includes(patch.state)) throw new Error('Invalid local checkpoint state.');
      if (!WAITING_FOR.includes(patch.waitingFor ?? 'none')) throw new Error('Invalid waiting state.');
      next.checkpoint = { state: patch.state, waitingFor: patch.waitingFor ?? 'none' };
      for (const [key, limit] of [['goal', 500], ['completed', 800], ['issues', 800], ['nextStep', 400]]) {
        const value = patch[key] ?? previous.checkpoint?.[key];
        if (value !== undefined) {
          if (typeof value !== 'string') throw new Error(`${key} must be a short text summary.`);
          next.checkpoint[key] = value.slice(0, limit);
        }
      }
    }
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return next;
  }
}
