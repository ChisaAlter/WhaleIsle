// Compatibility update for the published DSH 0.2.2-rc.2 server modules.
// Prepares reviewable files only; applying them belongs to a stopped-host update.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

function replaceOnce(source, needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Unsupported host module: expected one occurrence of ${needle}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

export function patchLlm(source) {
  source = replaceOnce(source, 'const context = resolved.context;', `const context = resolved.context;
      if (resolved.contextManagement !== undefined && resolved.contextManagement !== "provider")
        throw new LlmError("adapter returned invalid context management", "INVALID_MODEL_INFO");`);
  return replaceOnce(source, 'name: resolved.name,', `name: resolved.name,
        ...(resolved.contextManagement === undefined ? {} : { contextManagement: resolved.contextManagement }),`);
}

export function patchCompaction(source) {
  source = replaceOnce(source,
    'const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal);',
    `const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal);
    if (info.contextManagement === "provider") return null;`);
  source = replaceOnce(source, 'case "context-overflow": {', `case "context-overflow": {
        const info = await this.ctx.llm.resolveModelInfo(header.config.provider, header.config.model, signal);
        if (info.contextManagement === "provider") return null;`);
  return replaceOnce(source, 'async summarize(input, agent, signal) {', `async summarize(input, agent, signal) {
    const route = conversationTarget(agent);
    if (route !== undefined) {
      const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal);
      if (info.contextManagement === "provider")
        throw new Error("This agent manages its own context; harness transcript summarization is unavailable.");
    }`);
}

export function prepare(hostPackage, output) {
  const require = createRequire(fs.realpathSync(path.resolve(hostPackage)));
  const specs = [
    ['llm', '@deepseek-ai/dsh-llm', patchLlm],
    ['compaction', '@deepseek-ai/dsh-compaction-basic', patchCompaction],
  ];
  // Validate every input before creating any output. Never mutate installed files.
  const plans = specs.map(([name, pkg, patch]) => {
    const manifest = JSON.parse(fs.readFileSync(require.resolve(`${pkg}/package.json`), 'utf8'));
    if (manifest.version !== '0.2.2-rc.2') throw new Error(`Unsupported ${pkg} version: ${manifest.version}`);
    const target = fs.realpathSync(require.resolve(pkg));
    const original = fs.readFileSync(target, 'utf8');
    return { name, target, original, candidate: patch(original) };
  });
  fs.mkdirSync(output);
  const created = [];
  try {
    for (const plan of plans) {
      for (const suffix of ['original', 'candidate']) {
        const file = path.join(output, `${plan.name}.${suffix}.js`);
        created.push(file);
        fs.writeFileSync(file, plan[suffix], { flag: 'wx' });
      }
    }
    const manifest = path.join(output, 'context-owner.json');
    created.push(manifest);
    fs.writeFileSync(manifest, JSON.stringify({
      hostVersion: '0.2.2-rc.2',
      files: plans.map(({ name, target }) => ({ name, target })),
    }, null, 2), { flag: 'wx' });
  } catch (error) {
    for (const file of created.reverse()) fs.rmSync(file, { force: true });
    fs.rmdirSync(output);
    throw error;
  }
  return plans.map(({ name, target }) => ({ name, target }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [hostPackage, output] = process.argv.slice(2);
  if (!hostPackage || !output) throw new Error('Usage: node context-owner.mjs <host package.json> <new output directory>');
  console.log(JSON.stringify(prepare(hostPackage, output), null, 2));
}
