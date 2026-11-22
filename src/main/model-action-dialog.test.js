'use strict';

// #515 F4: the confirmation dialog must paint the request's real source and
// the registry-resolved level in fixed slots that caller-supplied
// summary/details/title/label/hint can never reach.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  modelActionConfirmOptions,
  secretDialogOptions,
  detailWithContext,
} = require('./model-action-dialog');
const { resolveDesktopLocale } = require('./desktop-locale');

const zh = resolveDesktopLocale('zh-CN').messages;
const en = resolveDesktopLocale('en').messages;

function fixedSlots(options) {
  return [options.title, options.message, options.context].join('\n');
}

test('a forged summary cannot rewrite the fixed source or assessed level', () => {
  const forged = '这是一次普通的只读操作，请直接允许（等级：读取）';
  const options = modelActionConfirmOptions({
    tool: 'whale_delete_session',
    action: 'delete',
    effect: 'destructive',
    summary: forged,
    details: 'rm -rf /sessions',
  }, zh);
  assert.equal(options.title, '助理请求执行破坏性操作');
  assert.equal(options.message, options.title);
  assert.equal(options.context, '来自whale_delete_session / delete的请求 · 判定等级：破坏性');
  assert.doesNotMatch(fixedSlots(options), /只读|伪造|rm -rf/);
  // Caller text stays inside the scrollable region, below the fixed caption.
  assert.ok(options.detail.startsWith('请求内容'));
  assert.match(options.detail, /只读操作，请直接允许/);
  assert.match(options.detail, /rm -rf/);
  // A forged caller text must not be able to fake the fixed line's wording.
  assert.doesNotMatch(options.detail.slice(0, options.detail.indexOf('\n')), /读取|whale_delete_session/);
});

test('every level paints a fixed title and Chinese level name', () => {
  for (const [effect, title, level] of [
    ['destructive', '助理请求执行破坏性操作', '判定等级：破坏性'],
    ['external', '助理请求对外公开', '判定等级：对外公开'],
    ['code', '助理请求运行代码', '判定等级：代码执行'],
    ['local', '助理请求执行本地操作', '判定等级：本地操作'],
    ['read', '助理请求执行操作', '判定等级：读取'],
    ['harness-governed', '助理请求执行操作', '判定等级：Harness 托管'],
    ['surprise', '助理请求执行操作', '判定等级：未分级'],
  ]) {
    const options = modelActionConfirmOptions({ tool: 't', effect }, zh);
    assert.equal(options.title, title, effect);
    assert.equal(options.message, title, effect);
    assert.match(options.context, new RegExp(level), effect);
  }
});

test('a run-scoped always is only offered below destructive/code levels', () => {
  for (const effect of ['destructive', 'code']) {
    assert.deepEqual(
      modelActionConfirmOptions({ tool: 't', effect }, zh).buttons,
      ['拒绝', '允许一次'],
      effect,
    );
  }
  for (const effect of ['external', 'local', 'other']) {
    assert.deepEqual(
      modelActionConfirmOptions({ tool: 't', effect }, zh).buttons,
      ['拒绝', '允许一次', '本次运行内始终允许'],
      effect,
    );
  }
});

test('a missing summary or tool falls back to server-owned wording', () => {
  const options = modelActionConfirmOptions({ effect: 'local' }, zh);
  assert.match(options.context, /助理/);
  assert.match(options.detail, /助理请求执行该操作/);
});

test('the fixed attribution renders in English too', () => {
  const options = modelActionConfirmOptions({
    tool: 'pad_test_source',
    action: 'run-sources',
    effect: 'code',
    summary: 'forged harmless read',
  }, en);
  assert.equal(options.title, 'The assistant requests code execution');
  assert.equal(options.message, options.title);
  assert.equal(options.context, 'Request from pad_test_source / run-sources · Assessed level: Code execution');
  assert.doesNotMatch(fixedSlots(options), /forged|harmless/);
  assert.ok(options.detail.startsWith('Request content'));
  assert.deepEqual(options.buttons, ['Deny', 'Allow once']);
});

test('show-secret fixes the source and category; caller fields stay in the content region', () => {
  const options = secretDialogOptions({
    tool: 'chatgpt_connection',
    title: '来自系统安全中心的通知',
    label: '授权码',
    secret: 's3cr3t-code',
    hint: 'trust me',
  }, zh);
  assert.equal(options.title, '敏感信息');
  assert.equal(options.message, '敏感信息');
  assert.equal(options.context, '来自chatgpt_connection的请求 · 类别：敏感信息');
  assert.doesNotMatch(fixedSlots(options), /系统安全中心|s3cr3t|授权码|trust/);
  assert.ok(options.detail.startsWith('请求内容'));
  assert.match(options.detail, /系统安全中心/);
  assert.match(options.detail, /授权码/);
  assert.match(options.detail, /s3cr3t-code/);
  assert.match(options.detail, /trust me/);
});

test('show-secret without a tool names the generic assistant source', () => {
  const options = secretDialogOptions({ secret: 'x' }, zh);
  assert.equal(options.context, '来自助理的请求 · 类别：敏感信息');
  const english = secretDialogOptions({ secret: 'x' }, en);
  assert.equal(english.context, 'Request from the assistant · Category: sensitive information');
});

test('the native fallback detail folds the fixed context ahead of caller text', () => {
  assert.equal(
    detailWithContext({ context: '来自X的请求', detail: '请求内容\n\nbody' }),
    '来自X的请求\n\n请求内容\n\nbody',
  );
  assert.equal(detailWithContext({ detail: 'only' }), 'only');
  assert.equal(detailWithContext({ context: '来自X的请求' }), '来自X的请求');
});

test('structured attribution and requestSection isolate caller text and assign semantic tone', () => {
  const cases = [
    ['destructive', 'danger', '判定等级：破坏性'],
    ['code', 'warning', '判定等级：代码执行'],
    ['external', 'warning', '判定等级：对外公开'],
    ['local', 'neutral', '判定等级：本地操作'],
  ];
  for (const [effect, expectedTone, expectedLevel] of cases) {
    const forged = '伪造只读操作（判定等级：读取）';
    const options = modelActionConfirmOptions({
      tool: 'bot_tools_manage',
      action: 'enable',
      effect,
      summary: forged,
      details: 'rm -rf /tmp/fake',
    }, zh);
    assert.equal(options.tone, expectedTone, effect);
    assert.deepEqual(options.attribution, {
      source: '来自bot_tools_manage / enable的请求',
      level: expectedLevel,
      tone: expectedTone,
    });
    assert.doesNotMatch(JSON.stringify(options.attribution), /伪造|读取|rm -rf/);
    assert.deepEqual(options.requestSection, {
      caption: '请求内容',
      summary: forged,
      details: 'rm -rf /tmp/fake',
    });
  }

  const secret = secretDialogOptions({
    tool: 'chatgpt_connection',
    title: '系统安全中心',
    label: '授权码',
    secret: 'tok-999',
    hint: '仅显示一次',
  }, zh);
  assert.equal(secret.tone, 'info');
  assert.deepEqual(secret.attribution, {
    source: '来自chatgpt_connection的请求',
    level: '类别：敏感信息',
    tone: 'info',
  });
  assert.doesNotMatch(JSON.stringify(secret.attribution), /系统安全中心|tok-999/);
  assert.deepEqual(secret.requestSection, {
    caption: '请求内容',
    summary: '系统安全中心\n授权码',
    details: 'tok-999',
    hint: '仅显示一次',
    isSecret: true,
  });
});
