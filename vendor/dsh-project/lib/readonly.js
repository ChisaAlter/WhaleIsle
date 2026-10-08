/** File investigation and declared document writes have no shell capability. */
import fs from 'node:fs/promises';
import { resolve, relative, join, dirname, isAbsolute } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { checkedRoot, within, atomicText } from './files.js';
export const name = 'project-file-scope';
export const inject = ['tools'];
const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const context = (ctx, exec) => { const service = ctx.get('projects'); if (!service?.available) throw new Error('Project Host is unavailable.'); const actor = service.actor(exec.agent); if (actor.role !== 'worker') throw new Error('Only the assigned worker can inspect its directory.'); return { service, actor, worker: service.worker(exec.agent.id) }; };
async function pathFor(worker, input) {
  if (typeof input !== 'string' || isAbsolute(input) || input.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')) throw new Error('Use a path relative to the assigned directory.');
  const root = await checkedRoot(worker.cwd), path = await fs.realpath(resolve(root, input));
  if (!within(root, path) || relative(root, path).split(/[\\/]/).some(part => part.toLowerCase() === '.git')) throw new Error('Path is outside the assigned directory.'); return path;
}
export function apply(ctx) {
  ctx.tools.register(defineTool({ name: 'project_read', description: 'Read one file or list one directory inside your fixed worker cwd; no repository writes or shell.', timeoutMs: 10000,
    parameters: { path: { type: 'string', required: true }, startLine: { type: 'integer' }, maxLines: { type: 'integer' } }, output,
    async execute(args, exec) { const { worker } = context(ctx, exec), path = await pathFor(worker, args.path), stat = await fs.stat(path);
      if (stat.isDirectory()) return { path, entries: (await fs.readdir(path, { withFileTypes: true })).slice(0, 500).map(item => ({ name: item.name, directory: item.isDirectory() })) };
      if (stat.size > 512000) throw new Error('File exceeds the read limit.'); const lines = (await fs.readFile(path, 'utf8')).split(/\r?\n/), start = Math.max(1, args.startLine ?? 1), count = Math.min(1000, Math.max(1, args.maxLines ?? 200)); return { path, startLine: start, totalLines: lines.length, text: lines.slice(start - 1, start - 1 + count).join('\n') };
    } }));
  ctx.tools.register(defineTool({ name: 'project_search', description: 'Search literal text in files under your assigned directory. No shell or file modifications.', timeoutMs: 10000,
    parameters: { path: { type: 'string', required: true }, query: { type: 'string', required: true } }, output,
    async execute(args, exec) { const { worker } = context(ctx, exec), root = await pathFor(worker, args.path), matches = []; let visited = 0;
      if (!args.query || args.query.length > 1000) throw new Error('Use a nonempty search string.');
      const visit = async path => { exec.signal.throwIfAborted(); if (++visited > 3000 || matches.length >= 100) return; const stat = await fs.lstat(path); if (stat.isSymbolicLink()) return;
        if (stat.isDirectory()) { for (const entry of await fs.readdir(path, { withFileTypes: true })) if (!['.git', 'node_modules'].includes(entry.name)) await visit(join(path, entry.name)); }
        else if (stat.isFile() && stat.size <= 256000) { const lines = (await fs.readFile(path, 'utf8')).split(/\r?\n/); for (let index = 0; index < lines.length && matches.length < 100; index++) if (lines[index].includes(args.query)) matches.push({ path: relative(worker.cwd, path), line: index + 1, text: lines[index].slice(0, 2000) }); }
      }; await visit(root); return { matches, truncated: visited > 3000 || matches.length >= 100 };
    } }));
  ctx.tools.register(defineTool({ name: 'project_write_document', description: 'Write exactly one repository-relative document path declared in the current consumed documentation assignment. No other repository file or shell is permitted.', timeoutMs: 10000,
    parameters: { path: { type: 'string', required: true }, text: { type: 'string', required: true } }, output,
    async execute(args, exec) { const { worker } = context(ctx, exec); if (worker.role !== 'docs' || !worker.writePaths.includes(args.path)) throw new Error('This document path is not authorized by the current assignment.');
      if (typeof args.text !== 'string' || args.text.length > 512000) throw new Error('Document exceeds the write limit.');
      const root = await checkedRoot(worker.cwd), target = resolve(root, args.path);
      if (!within(root, target)) throw new Error('Document path is outside the assigned directory.');
      let ancestor = dirname(target);
      for (;;) { try { const actual = await fs.realpath(ancestor); if (!within(root, actual) || actual !== ancestor) throw new Error('Document directory was replaced with a link.'); break; } catch (error) { if (error.code !== 'ENOENT' || ancestor === root) throw error; ancestor = dirname(ancestor); } }
      await fs.mkdir(dirname(target), { recursive: true });
      try { const actual = await fs.realpath(target); if (actual !== target || !within(root, actual)) throw new Error('Document was replaced with a link.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      exec.signal.throwIfAborted(); await atomicText(target, args.text); return { path: target };
    } }));
}
