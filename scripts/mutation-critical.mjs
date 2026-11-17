#!/usr/bin/env node
// #450: run the existing tests against one deliberate fault at a time. Source
// files remain untouched; a child-only CommonJS loader compiles the candidate.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';
import { modules } from './mutation/critical-boundaries.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function mutate(source, [id, before, after, occurrence]) {
  const parts = source.split(before);
  if (occurrence === undefined && parts.length !== 2) {
    throw new Error(`${id}: expected one edit location, found ${parts.length - 1}`);
  }
  if (occurrence !== undefined) {
    if (parts.length <= occurrence + 1) throw new Error(`${id}: edit location missing`);
    return parts.slice(0, occurrence + 1).join(before) + after + parts.slice(occurrence + 1).join(before);
  }
  return parts[0] + after + parts[1];
}

export async function runCampaign(plan, { root = ROOT, output, timeoutMs = 20000 } = {}) {
  return withOwnedTempDir('whale-mutation-', (owned) => {
    const results = [];
    const run = (test, preload) => spawnSync(process.execPath,
      [...(preload ? ['--require', preload] : []), '--test', '--test-isolation=none', '--test-reporter=tap', test], {
        cwd: root, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, TMPDIR: owned, TMP: owned, TEMP: owned },
      });
    for (const item of plan) {
      const baseline = run(item.test);
      if (baseline.error || baseline.status !== 0 || !/^# tests [1-9]\d*$/m.test(baseline.stdout)) {
        throw new Error(`Baseline failed for ${item.test}: ${baseline.error || baseline.stdout + baseline.stderr}`);
      }
      const source = readFileSync(join(root, item.file), 'utf8');
      for (const mutation of item.mutations) {
        const [id] = mutation;
        const candidate = join(owned, 'candidate.cjs');
        writeFileSync(candidate, mutate(source, mutation));
        const syntax = spawnSync(process.execPath, ['--check', candidate], { encoding: 'utf8' });
        if (syntax.status !== 0) throw new Error(`${item.file}/${id}: invalid mutation: ${syntax.stderr}`);
        const loader = join(owned, 'loader.cjs');
        writeFileSync(loader, `const Module = require('node:module');\nconst fs = require('node:fs');\nconst original = Module._extensions['.js'];\nModule._extensions['.js'] = (module, file) => {\n  if (file === ${JSON.stringify(resolve(root, item.file))}) module._compile(fs.readFileSync(${JSON.stringify(candidate)}, 'utf8'), file);\n  else original(module, file);\n};\n`);
        const result = run(item.test, loader);
        const text = result.stdout + result.stderr;
        const failures = Number(/^# fail (\d+)$/m.exec(text)?.[1] ?? 0);
        // Timeouts, crashes, and missing TAP summaries are harness errors,
        // never credited as detected mutations.
        if (result.error || !/^# tests \d+$/m.test(text) || (result.status !== 0 && failures === 0)) {
          throw new Error(`${item.file}/${id}: test infrastructure failure: ${result.error || text}`);
        }
        const record = { file: item.file, id, outcome: result.status === 0 ? 'survived' : 'detected', failures,
          failingTests: [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]) };
        results.push(record);
        process.stdout.write(`${record.outcome}: ${item.file} / ${id}\n`);
      }
    }
    if (output) {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(output, JSON.stringify({ modules: plan.map(item => item.file), results }, null, 2) + '\n');
    }
    return results;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) {
    throw new Error('Usage: node scripts/mutation-critical.mjs [--output <report.json>]');
  }
  const results = await runCampaign(modules, { output: args[1] });
  console.log(`${results.length} mutations: ${results.filter(item => item.outcome === 'detected').length} detected; ${results.filter(item => item.outcome === 'survived').length} survived (review each survivor; no score threshold).`);
}
