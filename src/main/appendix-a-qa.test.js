'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPENDIX_TURNS,
  APPENDIX_EXTRA_STEPS,
  assertAppendixAQaResult,
  extractCode,
  pinAgentDefaultModel,
  stripVisionFallback,
} = require('./appendix-a-qa');

test('appendix A turns match the production five-prompt script', () => {
  const ids = APPENDIX_TURNS.map((turn) => turn.id);
  assert.deepEqual(ids, [
    'appendix.turn1.connect',
    'appendix.turn2.recall',
    'appendix.turn3.readReadme',
    'appendix.turn4.shell',
    'appendix.turn5.summary',
  ]);
  assert.ok(APPENDIX_TURNS[2].expectTool);
  assert.ok(APPENDIX_TURNS[3].expectTool);
  assert.match(APPENDIX_TURNS[0].prompt, /三位数验证码/);
  assert.equal(
    APPENDIX_TURNS[2].expect('工作区根目录中不存在 README 或 README.md 文件。'),
    false,
  );
  assert.equal(
    APPENDIX_TURNS[2].expect('ChisaTerminal 是现代化 Electron 终端模拟器，内嵌 xterm.js。'),
    true,
  );
  assert.deepEqual(APPENDIX_EXTRA_STEPS, [
    'appendix.editUser',
    'appendix.reject',
    'appendix.vision',
  ]);
});

test('extractCode keeps the first three-digit token', () => {
  assert.equal(extractCode('已连通，验证码 742。'), '742');
  assert.equal(extractCode('no code here'), '');
});

test('pinAgentDefaultModel rewrites the default onto grok-4.6', () => {
  const next = pinAgentDefaultModel(
    'locale: zh-CN\nagent-default-model:\n  provider: opencodezen\n  model: x-preview-f-free\n  reasoningEffort: max\nui-theme:\n  preference: dark\n',
  );
  assert.match(next, /provider: deepseek-official/);
  assert.match(next, /model: grok-4\.6/);
  assert.doesNotMatch(next, /opencodezen/);
});

test('stripVisionFallback drops a copied vision-fallback route', () => {
  const next = stripVisionFallback(
    'locale: zh-CN\nvision-fallback:\n  provider: blocked-host\n  model: vision-x\nui-theme:\n  preference: dark\n',
  );
  assert.doesNotMatch(next, /vision-fallback/);
  assert.doesNotMatch(next, /blocked-host/);
  assert.match(next, /ui-theme:/);
});

test('appendix send looks up the official 发送消息 control', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'appendix-a-qa.js'), 'utf8');
  const walkSrc = fs.readFileSync(path.join(__dirname, 'release-ui-page-helpers.js'), 'utf8');
  assert.match(src, /dshComposerSend/);
  assert.match(src, /waitForIdle/);
  assert.match(src, /Deep diving/);
  assert.match(src, /stop generating\|停止生成/);
  assert.match(src, /Input\.dispatchKeyEvent/);
  assert.match(src, /新建会话\|new session in/);
  assert.match(src, /\^拒绝\$/);
  assert.match(src, /仅可查看\|read only/);
  assert.match(src, /dshd-reject-probe\.txt/);
  assert.match(src, /bash 或 pwsh/);
  assert.match(src, /sandbox_permissions=workspace-write/);
  assert.match(src, /requires a justification/);
  assert.match(src, /missingJustification/);
  assert.match(src, /waitForApprovalPanel/);
  assert.match(src, /idleWithoutApproval/);
  assert.match(src, /waitForIdle\(wc, 20_000, false\)/);
  assert.doesNotMatch(src, /await clickSend\(wc\);\s*await waitForIdle\(wc, 300_000, true\)/);
  assert.match(src, /setWorkspaceWriteAccess/);
  assert.match(src, /VISION_PASS_RE\.test\(visionText\)/);
  assert.doesNotMatch(src, /assistantCount > beforeVision\.assistantCount && VISION_PASS_RE/);
  assert.match(walkSrc, /VISION_PASS_RE/);
  assert.match(src, /openFreshSession/);
  assert.doesNotMatch(src, /申请写入工作区权限/);
  assert.match(src, /stripVisionFallback/);
  assert.match(src, /不支持图片\|does not support images/);
  assert.match(src, /Deep diving\|深潜/);
  assert.doesNotMatch(src, /\^send\$\|\^发送\$/);
  assert.match(src, /跳过本题\|skip this question/);
  assert.match(src, /getAttribute\('aria-label'\)/);
  assert.match(src, /当前\[:：\]\\s\*仅可查看/);
  assert.doesNotMatch(src, /echo dshd-reject-probe/);
  assert.match(src, /typeIntoComposer/);
  assert.match(src, /dshComposerInput/);
  assert.match(src, /openFreshSession\(wc\)/);
  assert.match(src, /setWorkspaceWriteAccess\(wc\)/);
  assert.match(src, /snap\.question/);
  assert.match(src, /dshFind\('模型'/);
});

test('assertAppendixAQaResult requires every turn', () => {
  const steps = [
    { name: 'appendix.workspace', ok: true, detail: '' },
    { name: 'appendix.composer', ok: true, detail: '' },
    ...APPENDIX_TURNS.map((turn) => ({ name: turn.id, ok: true, detail: '' })),
    ...APPENDIX_EXTRA_STEPS.map((name) => ({ name, ok: true, detail: '' })),
  ];
  assert.doesNotThrow(() => assertAppendixAQaResult({ ok: true, failed: [], steps }));
  assert.throws(
    () => assertAppendixAQaResult({
      ok: true,
      failed: [],
      steps: steps.filter((step) => step.name !== 'appendix.turn4.shell'),
    }),
    /turn4/,
  );
});

test('main process runs in-app appendix A when DSH_QA_APPENDIX is set', () => {
  const smoke = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'smoke', 'index.js'),
    'utf8',
  );
  assert.match(smoke, /runAppendixAQa/);
  assert.match(smoke, /DSH_QA_APPENDIX/);
});
