#!/usr/bin/env node
// checkJs 基线闸门（#437/#438）：依次对 tsconfig.check.json（Node 侧：
// src/shared、src/preload、src/main、src/main-launcher、src/host、
// src/launcher、scripts、自有 vendor 插件 lib/tests）与
// tsconfig.check.dom.json（浏览器侧：src/renderer、mobile/web、插件
// client/）运行 tsc（allowJs + checkJs + strict，无构建产物），把诊断折叠成
// 「文件 + 错误码 + 首行消息」的计数合并后与 scripts/typecheck-baseline.json
// 比较。同一诊断被两个程序重复命中（共享文件经 import 拉入）时按
// 文件+行列+错误码+消息 去重，只计一次。
//
// 基线只减不增：
// - 出现基线外的新诊断或同一诊断计数增加 → 失败；
// - 某项计数比基线少或从基线消失 → 也失败，提示运行
//   `npm run typecheck -- --update-baseline` 收紧基线；
// - 无文件归属的配置级错误（error TS…: …）不参与基线，直接失败。
// 仅完全一致时通过。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync } from '../src/shared/fs-safe.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const TSC = resolve(ROOT, 'node_modules/typescript/bin/tsc');
// 默认依次运行 Node 侧与 DOM 侧两个项目，诊断合并进同一基线。
const DEFAULT_PROJECTS = [
  resolve(ROOT, 'tsconfig.check.json'),
  resolve(ROOT, 'tsconfig.check.dom.json'),
];
const DEFAULT_BASELINE = resolve(SCRIPT_DIR, 'typecheck-baseline.json');
const DIFF_PREVIEW = 30;

/** @typedef {Map<string, Map<string, Map<string, number>>>} DiagCounts */

function usage() {
  console.error('用法：node scripts/typecheck.mjs [--update-baseline] [--project <tsconfig>] [--baseline <json>]');
  process.exit(2);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = { update: false, projects: /** @type {string[] | null} */ (null), baseline: DEFAULT_BASELINE };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--update-baseline') opts.update = true;
    else if (arg === '--project') (opts.projects ||= []).push(resolve(argv[++i]));
    else if (arg === '--baseline') opts.baseline = resolve(argv[++i]);
    else usage();
  }
  if (!opts.projects) opts.projects = DEFAULT_PROJECTS;
  return opts;
}

// 诊断首行：`file(line,col): error TSnnnn: message`。文件路径按项目目录
// 相对化（tsc 在 cwd 下输出相对路径），反斜杠统一为正斜杠。
const DIAGNOSTIC = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL_ERROR = /^error (TS\d+): (.*)$/;

/** @param {string} file */
function normalizeFile(file) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * @param {DiagCounts} counts
 * @param {string} file
 * @param {string} code
 * @param {string} message
 */
function addDiagnostic(counts, file, code, message) {
  let byCode = counts.get(file);
  if (!byCode) counts.set(file, (byCode = new Map()));
  let byMessage = byCode.get(code);
  if (!byMessage) byCode.set(code, (byMessage = new Map()));
  byMessage.set(message, (byMessage.get(message) || 0) + 1);
}

// 消息里可能带绝对路径（如 `typeof import("/abs/repo/src/x")`），换成
// `<root>` 才能让基线在不同机器、CI 上一致。
/**
 * @param {string} message
 * @param {string} root
 */
function normalizeMessage(message, root) {
  // tsc 截断长类型时写 `... 45 more ...`；数目随无关改动（如 package.json
  // 增一条 script）变化，归一成 `<n>` 才不会把同一诊断当成新诊断。
  message = message.replace(/\.\.\. \d+ more \.\.\./g, '... <n> more ...');
  if (!root) return message;
  const posix = root.replace(/\\/g, '/');
  return message.split(root).join('<root>').split(posix).join('<root>');
}

// seen：可选的跨项目去重集合，键为「文件(行,列) 错误码 消息」。同一文件被
// 多个 tsconfig 的 include/import 同时拉入时，两个程序会报出同一条诊断；
// 提供 seen 后只计第一次。
/**
 * @param {string} text
 * @param {string} root
 * @param {Set<string>} [seen]
 */
export function parseDiagnostics(text, root, seen) {
  /** @type {DiagCounts} */
  const counts = new Map();
  /** @type {string[]} */
  const globals = [];
  for (const line of text.split(/\r?\n/)) {
    const hit = DIAGNOSTIC.exec(line);
    if (hit) {
      const file = normalizeFile(hit[1]);
      const message = normalizeMessage(hit[5], root);
      if (seen) {
        const key = `${file}(${hit[2]},${hit[3]}) ${hit[4]} ${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      addDiagnostic(counts, file, hit[4], message);
      continue;
    }
    const globalHit = GLOBAL_ERROR.exec(line);
    if (globalHit) globals.push(globalHit[1] + ': ' + globalHit[2]);
  }
  return { counts, globals };
}

// 与基线同构的纯对象，键排序保证基线文件 diff 稳定。
/** @param {DiagCounts} counts */
export function countsToObject(counts) {
  /** @type {Record<string, Record<string, Record<string, number>>>} */
  const errors = {};
  for (const file of [...counts.keys()].sort()) {
    const byCode = counts.get(file);
    if (!byCode) continue;
    errors[file] = {};
    for (const code of [...byCode.keys()].sort()) {
      const byMessage = byCode.get(code);
      if (!byMessage) continue;
      errors[file][code] = {};
      for (const message of [...byMessage.keys()].sort()) {
        errors[file][code][message] = byMessage.get(message) ?? 0;
      }
    }
  }
  return { version: 1, errors };
}

/** @param {any} object */
export function objectToCounts(object) {
  /** @type {DiagCounts} */
  const counts = new Map();
  for (const [file, byCode] of Object.entries(object.errors || {})) {
    for (const [code, byMessage] of Object.entries(byCode)) {
      for (const [message, count] of Object.entries(byMessage)) {
        addDiagnostic(counts, file, code, message);
        counts.get(file)?.get(code)?.set(message, count);
      }
    }
  }
  return counts;
}

/** @param {DiagCounts} counts */
function countEntries(counts) {
  let total = 0;
  /** @type {Map<string, number>} */
  const byDir = new Map();
  for (const [file, byCode] of counts) {
    const dir = file.split('/').slice(0, 2).join('/');
    for (const byMessage of byCode.values()) {
      for (const count of byMessage.values()) {
        total += count;
        byDir.set(dir, (byDir.get(dir) || 0) + count);
      }
    }
  }
  return { total, byDir };
}

// 返回 {newer, fewer}：newer 为当前多于基线（含基线没有）的条目，
// fewer 为基线多于当前（含当前已消失）的条目。
/**
 * @param {DiagCounts} current
 * @param {DiagCounts} baseline
 */
export function diffCounts(current, baseline) {
  /** @type {string[]} */
  const newer = [];
  /** @type {string[]} */
  const fewer = [];
  for (const [file, byCode] of current) {
    for (const [code, byMessage] of byCode) {
      for (const [message, count] of byMessage) {
        const base = baseline.get(file)?.get(code)?.get(message) || 0;
        if (count > base) newer.push(`${file} ${code} x${base}->${count} ${message}`);
      }
    }
  }
  for (const [file, byCode] of baseline) {
    for (const [code, byMessage] of byCode) {
      for (const [message, base] of byMessage) {
        const count = current.get(file)?.get(code)?.get(message) || 0;
        if (count < base) fewer.push(`${file} ${code} x${base}->${count} ${message}`);
      }
    }
  }
  return { newer, fewer };
}

/**
 * @param {string} title
 * @param {string[]} entries
 */
function printList(title, entries) {
  console.error(title + '（' + entries.length + ' 项）');
  for (const entry of entries.slice(0, DIFF_PREVIEW)) console.error('  ' + entry);
  if (entries.length > DIFF_PREVIEW) console.error('  … 其余 ' + (entries.length - DIFF_PREVIEW) + ' 项省略');
}

/** @param {string} project */
function runTsc(project) {
  if (!existsSync(TSC)) {
    console.error('找不到 ' + TSC + '；先按锁文件安装根依赖（npm ci --ignore-scripts）。');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit', '--pretty', 'false'], {
    cwd: dirname(project),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    console.error('无法运行 tsc：' + result.error.message);
    process.exit(1);
  }
  const text = (result.stdout || '') + (result.stderr || '');
  return { text, status: result.status };
}

// 把 src 的诊断计数并入 dst（各项目 include 不重叠，但共享文件可能经
// import 被多个程序重复命中，已由 seen 去重）。
/**
 * @param {DiagCounts} dst
 * @param {DiagCounts} src
 */
function mergeCounts(dst, src) {
  for (const [file, byCode] of src) {
    for (const [code, byMessage] of byCode) {
      for (const [message, count] of byMessage) {
        for (let i = 0; i < count; i += 1) addDiagnostic(dst, file, code, message);
      }
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const projects = opts.projects ?? DEFAULT_PROJECTS;
  /** @type {DiagCounts} */
  const counts = new Map();
  /** @type {string[]} */
  const globals = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const project of projects) {
    const { text, status } = runTsc(project);
    const parsed = parseDiagnostics(text, ROOT, seen);
    mergeCounts(counts, parsed.counts);
    globals.push(...parsed.globals);
    if (status !== 0 && parsed.counts.size === 0 && parsed.globals.length === 0) {
      console.error('tsc -p ' + project + ' 退出码 ' + status + ' 但未产生诊断输出。');
      process.exit(1);
    }
  }
  const { total, byDir } = countEntries(counts);

  console.log('checkJs 诊断共 ' + total + ' 条：');
  for (const [dir, count] of [...byDir.entries()].sort()) {
    console.log('  ' + dir + ': ' + count);
  }

  if (globals.length > 0) {
    printList('配置级错误不参与基线，需要先修复', globals);
    process.exit(1);
  }

  if (opts.update) {
    atomicWriteFileSync(opts.baseline, JSON.stringify(countsToObject(counts), null, 2) + '\n');
    console.log('已更新基线 ' + opts.baseline + '（' + total + ' 条诊断）。');
    return;
  }

  const baseline = existsSync(opts.baseline)
    ? objectToCounts(JSON.parse(readFileSync(opts.baseline, 'utf8')))
    : new Map();
  const { newer, fewer } = diffCounts(counts, baseline);
  if (newer.length === 0 && fewer.length === 0) {
    console.log('与基线一致。');
    return;
  }
  if (newer.length > 0) {
    printList('基线外的新诊断', newer);
  }
  if (fewer.length > 0) {
    printList('诊断数低于基线，运行 npm run typecheck -- --update-baseline 收紧基线', fewer);
  }
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
