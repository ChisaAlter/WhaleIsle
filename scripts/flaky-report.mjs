#!/usr/bin/env node
// flaky.yml 的运行器与报告器。
//
// 收集：node scripts/flaky-report.mjs --collect <输出.xml>
// 从 package.json 的 scripts.test 派生测试 glob，跑一轮 `node --test`，
// spec 报告进 stdout（作业日志可读），junit 报告写进输出文件供跨轮分析；
// 以测试进程的退出码退出，调用方决定是否继续下一轮。
//
// 报告：node scripts/flaky-report.mjs <轮次日志> [...]
// 每个参数是一轮 junit 输出文件；轮次号按文件名中最后一串数字排序
// （round-1.xml < round-2.xml < round-10.xml）。找出跨轮次结果不一致
// （有时过有时不过）的用例，把清单写进 $GITHUB_STEP_SUMMARY 并以非零码
// 退出让作业可见。处理原则：不稳定用例修根因，不靠重试或跳过掩盖。
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {'pass' | 'fail' | 'skip'} TestStatus */
/** @typedef {{file: string, classname: string, name: string, status: TestStatus, message: string}} TestResult */
/** @typedef {{file: string, classname: string, name: string, statuses: (TestStatus | 'absent')[], messages: string[]}} RoundEntry */

// junit reporter 对属性值做 escapeContent（&→&amp;、<→&lt;）加 escapeAttribute
// （换行→&#10;、"→&quot;），诊断注释里 - 还会变成 &#45;。统一还原所有实体，
// &amp; 必须最后解码，&amp;lt; 才会停留在 &lt;。
/** @param {string} text */
export function decodeXmlEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const ATTR_RE = /([\w-]+)="([^"]*)"/g;

/** @param {string} tagText */
function parseAttrs(tagText) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const match of tagText.matchAll(ATTR_RE)) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }
  return attrs;
}

// 属性值里可以出现原始 >（escapeContent 不转义它），定位标签结尾必须跳过引号内文本。
/** @param {string} xml @param {number} from */
function tagEnd(xml, from) {
  let quote = null;
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

// 一轮 junit 输出 → Map。键是 file/classname/name 以 NUL 连接；值记录状态与
// 失败消息首行。status 为 pass/fail/skip 之一。同一文件里出现同名同 suite 的
// 用例时按失败 > 通过 > 跳过合并。
/** @param {string} text */
export function parseJunitResults(text) {
  /** @type {Map<string, TestResult>} */
  const results = new Map();
  // 诊断输出原样进 <!-- --> 注释，先剥掉，注释里的文本不会被误当标签
  const xml = text.replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;
  while (i < xml.length) {
    const start = xml.indexOf('<testcase', i);
    if (start === -1) break;
    if (!/[\s/>]/.test(xml[start + '<testcase'.length] || '')) {
      i = start + '<testcase'.length;
      continue;
    }
    const end = tagEnd(xml, start);
    if (end === -1) break;
    const tagText = xml.slice(start, end + 1);
    const attrs = parseAttrs(tagText);
    /** @type {TestStatus} */
    let status = 'pass';
    let message = '';
    if (!tagText.endsWith('/>')) {
      const close = xml.indexOf('</testcase>', end + 1);
      const body = close === -1 ? xml.slice(end + 1) : xml.slice(end + 1, close);
      const failAt = body.search(/<failure[\s/>]/);
      if (failAt !== -1) {
        status = 'fail';
        const hit = /message="([^"]*)"/.exec(body.slice(failAt));
        message = hit ? decodeXmlEntities(hit[1]).split('\n')[0].trim() : '';
      } else if (/<skipped[\s/>]/.test(body)) {
        status = 'skip';
      }
      i = close === -1 ? xml.length : close + '</testcase>'.length;
    } else {
      i = end + 1;
    }
    const file = attrs.file || '';
    const classname = attrs.classname || 'test';
    const name = attrs.name || '';
    const key = file + '\0' + classname + '\0' + name;
    const rank = { fail: 2, pass: 1, skip: 0 };
    const prev = results.get(key);
    if (!prev || rank[status] > rank[prev.status]) {
      results.set(key, { file, classname, name, status, message });
    }
  }
  return results;
}

// 跨轮汇总。flaky：出现过通过也出现过失败；failed：从未通过但至少一轮失败。
// absent（该轮没有这个用例）与 skip 不计入通过/失败。
/** @param {Map<string, TestResult>[]} rounds */
export function analyzeRounds(rounds) {
  const totalRounds = rounds.length;
  /** @type {Map<string, RoundEntry>} */
  const byKey = new Map();
  rounds.forEach((results, index) => {
    for (const [key, row] of results) {
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          file: row.file,
          classname: row.classname,
          name: row.name,
          statuses: new Array(totalRounds).fill('absent'),
          messages: new Array(totalRounds).fill(''),
        };
        byKey.set(key, entry);
      }
      entry.statuses[index] = row.status;
      if (row.status === 'fail') entry.messages[index] = row.message;
    }
  });
  const flaky = [];
  const failed = [];
  for (const entry of byKey.values()) {
    const failedRounds = entry.statuses.flatMap((s, idx) => (s === 'fail' ? [idx + 1] : []));
    const passed = entry.statuses.includes('pass');
    if (failedRounds.length === 0) continue;
    const row = { ...entry, failedRounds };
    if (passed) flaky.push(row);
    else failed.push(row);
  }
  return { totalRounds, flaky, failed };
}

/** @param {string} file @param {string} cwd */
function displayFile(file, cwd) {
  const norm = file.replace(/\\/g, '/');
  const base = (cwd || '').replace(/\\/g, '/');
  return base && norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm;
}

/** @param {{classname: string, name: string}} entry */
function displayName(entry) {
  const suite = entry.classname && entry.classname !== 'test' ? entry.classname + ' › ' : '';
  return suite + entry.name;
}

/** @param {string} text */
function cell(text) {
  return '`' + String(text).replace(/\|/g, '\\|') + '`';
}

/** @param {(RoundEntry & {failedRounds: number[]})[]} entries @param {string} cwd */
function resultTable(entries, cwd) {
  const lines = ['| 文件 | 用例 | 失败轮次 |', '| --- | --- | --- |'];
  for (const entry of entries) {
    lines.push(
      '| ' + cell(displayFile(entry.file, cwd)) +
      ' | ' + cell(displayName(entry)) +
      ' | ' + entry.failedRounds.join(', ') + ' / ' + entry.statuses.length + ' |',
    );
  }
  return lines;
}

/** @param {ReturnType<typeof analyzeRounds>} analysis @param {{notes?: string[], cwd?: string}} [options] */
export function renderMarkdown(analysis, { notes = [], cwd = '' } = {}) {
  const lines = ['## 不稳定测试报告（' + analysis.totalRounds + ' 轮）', ''];
  if (analysis.flaky.length === 0 && analysis.failed.length === 0 && notes.length === 0) {
    lines.push('各轮结果一致，未发现不稳定用例。', '');
    return lines.join('\n');
  }
  if (analysis.flaky.length > 0) {
    lines.push(
      '间歇失败（有时过、有时不过）：' + analysis.flaky.length + ' 个用例',
      '',
      ...resultTable(analysis.flaky, cwd),
      '',
    );
  }
  if (analysis.failed.length > 0) {
    lines.push(
      '持续失败（出现过的轮次全部失败）：' + analysis.failed.length + ' 个用例',
      '',
      ...resultTable(analysis.failed, cwd),
      '',
    );
  }
  if (notes.length > 0) {
    lines.push('轮次异常：', '');
    for (const note of notes) lines.push('- ' + note);
    lines.push('');
  }
  lines.push('处理原则：修根因，不用重试掩盖。');
  lines.push('');
  return lines.join('\n');
}

/** @param {string} path */
function roundNumber(path) {
  const digits = /(\d+)(?!.*\d)/.exec(basename(path));
  return digits ? Number(digits[1]) : Number.MAX_SAFE_INTEGER;
}

/** @param {string[]} paths */
export function sortRoundLogs(paths) {
  return [...paths].sort((a, b) => roundNumber(a) - roundNumber(b) || a.localeCompare(b));
}

// scripts.test 形如 `node --test "glob" "glob" ...`；--collect 复用同一组
// glob，避免工作流复制一份随脚本漂移。脚本的其余形态变化直接报错让人改这里。
/** @param {{scripts?: {test?: string}}} [packageJson] */
export function testGlobs(packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))) {
  const script = packageJson.scripts?.test ?? '';
  if (!/^node\s+--test\b/.test(script)) {
    throw new Error('scripts.test 不是 `node --test "glob" ...` 形式，--collect 无法派生运行命令：' + script);
  }
  const globs = [...script.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  if (globs.length === 0) throw new Error('未能从 scripts.test 解析出测试 glob：' + script);
  return globs;
}

// 跑一轮 npm test 等价的 node --test：spec → stdout 供人读，junit → outPath
// 供 analyzeRounds 跨轮比较。stdio 继承，日志直接进作业输出。
/** @param {string} outPath @param {string[]} [globs] */
export function collectRound(outPath, globs = testGlobs()) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  const result = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', '--test-reporter-destination=' + resolve(outPath),
    ...globs,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** @param {string[]} argv */
function main(argv) {
  const args = argv.slice(2);
  const repeatAt = args.indexOf('--repeat');
  let files = args;
  /** @type {string[]} */
  const notes = [];
  if (repeatAt !== -1) {
    const count = Number(args[repeatAt + 1]);
    const outputDir = args[repeatAt + 2];
    if (!Number.isInteger(count) || count < 2 || !outputDir) {
      console.error('用法：node scripts/flaky-report.mjs --repeat <轮数≥2> <输出目录>');
      process.exitCode = 2;
      return;
    }
    files = [];
    for (let round = 1; round <= count; round += 1) {
      const file = resolve(outputDir, 'round-' + round + '.xml');
      console.log('\n=== 检测轮次 ' + round + ' / ' + count + ' ===');
      const status = collectRound(file);
      if (status !== 0) notes.push('第 ' + round + ' 轮测试进程退出码：' + status);
      files.push(file);
    }
  }
  const collectAt = args.indexOf('--collect');
  if (collectAt !== -1) {
    const outPath = args[collectAt + 1];
    if (!outPath || outPath.startsWith('-')) {
      console.error('用法：node scripts/flaky-report.mjs --collect <输出.xml>');
      process.exit(2);
    }
    process.exitCode = collectRound(outPath);
    return;
  }
  if (files.length === 0) {
    console.error('用法：node scripts/flaky-report.mjs <轮次日志> [...]');
    process.exit(2);
  }
  const rounds = [];
  for (const file of sortRoundLogs(files)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      notes.push('无法读取 ' + file + '：' + (err instanceof Error ? err.message : String(err)));
      rounds.push(new Map());
      continue;
    }
    const parsed = parseJunitResults(text);
    if (parsed.size === 0) {
      notes.push(basename(file) + ' 未解析到任何用例结果（该轮可能没有跑出测试事件）');
    }
    rounds.push(parsed);
  }
  const analysis = analyzeRounds(rounds);
  const markdown = renderMarkdown(analysis, { notes, cwd: process.cwd() });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  process.stdout.write(markdown);
  const problems = analysis.flaky.length + analysis.failed.length + notes.length;
  if (problems > 0) {
    console.error(
      '发现 ' + analysis.flaky.length + ' 个不稳定用例、' +
      analysis.failed.length + ' 个持续失败用例' +
      (notes.length > 0 ? '、' + notes.length + ' 条轮次异常' : '') + '。',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv);
}
