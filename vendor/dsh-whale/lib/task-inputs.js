/** Read only explicit regular text files; snapshots retain exact authorized bytes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, taskLimits } from './task-store.js';

const allowed = new Set(['.txt', '.md', '.mdx', '.csv', '.json', '.log', '.rst']);
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export async function captureInputs(paths, { allowedFiles, forbiddenRoot } = {}) {
  let total = 0;
  const values = [];
  for (const [index, supplied] of paths.entries()) {
    if (!path.isAbsolute(supplied)) throw new Error('资料必须是明确指定的绝对文件路径。');
    const requested = path.resolve(supplied);
    let component = path.parse(requested).root;
    for (const segment of requested.slice(component.length).split(path.sep).filter(Boolean)) {
      component = path.join(component, segment);
      if ((await fs.lstat(component)).isSymbolicLink()) throw new Error('资料路径经过链接或目录重定向。');
    }
    const sensitive = /(^|[\\/])(?:\.credentials(?:\.[^\\/]*)?|\.env(?:\.[^\\/]*)?|\.ssh|MEMORY\.md|settings\.json|config\.json)(?:[\\/]|$)/iu;
    if (sensitive.test(requested)) throw new Error('凭据、配置和完整个人记忆不属于首期资料输入。');
    if (allowedFiles && !allowedFiles.some(file => same(path.resolve(file), requested))) throw new Error('IM 后台任务只能读取本条消息已接收的附件。');
    if (!allowed.has(path.extname(requested).toLowerCase())) throw new Error('首期只支持文本资料。');
    const real = await fs.realpath(requested);
    if (!same(real, requested)) throw new Error('资料路径经过链接或目录重定向，请明确提供真实文件。');
    if (forbiddenRoot) {
      const root = await fs.realpath(forbiddenRoot).catch(error => { if (error.code === 'ENOENT') return path.resolve(forbiddenRoot); throw error; });
      const relative = path.relative(root, real);
      const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
      if (!outside) throw new Error('不能将鲸鱼娘私密资料或应用凭据作为后台输入。');
    }
    const handle = await fs.open(real, 'r');
    let bytes;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > taskLimits.maxInputBytes) throw new Error('资料不是普通文件或超过单文件 100KB 限制。');
      bytes = Buffer.alloc(taskLimits.maxInputBytes + 1);
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const chunk = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
        if (!chunk.bytesRead) break;
        bytesRead += chunk.bytesRead;
      }
      bytes = bytes.subarray(0, bytesRead);
      const after = await handle.stat();
      const named = await fs.stat(requested);
      if (named.nlink > 1) throw new Error('资料有多个硬链接，请提供独立资料副本。');
      if (named.ino !== after.ino || named.dev !== after.dev) throw new Error('资料文件在读取期间被替换。');
      if (bytesRead > taskLimits.maxInputBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('资料在读取期间变化，请重新提交。');
    } finally { await handle.close(); }
    const current = await fs.realpath(requested);
    if (!same(current, real)) throw new Error('资料路径身份发生变化。');
    total += bytes.length;
    if (total > taskLimits.maxTotalInputBytes) throw new Error('本次资料超过总量 300KB 限制。');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('资料不是 UTF-8 文本。');
    values.push({ id: `input-${index + 1}`, path: real, name: path.basename(real), hash: digest(bytes), bytes: bytes.length, text });
  }
  return values;
}
