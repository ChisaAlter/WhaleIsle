'use strict';

/**
 * Skip compose contract plumbing (scripts/check-skip-compose-contract.js).
 * These tests cover the pure verdict + the spawn plumbing with an injected
 * runner; the REAL-CLI execution lives in after-pack (dist path) and the
 * standalone script — a mocked spawn here proves wiring, never CLI semantics.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANARY_ID,
  TASK_CONTROL_ID,
  INSTALL_ID,
  IM_ID,
  USAGE_ID,
  MARKET_ID,
  WHALE_ID,
  REMOTE_ID,
  PAD_ID,
  WORKSPACE_DEPS_ID,
  SKILL_OFFICE_ID,
  SESSION_SEARCH_ID,
  composeContractProblems,
  composeContractRounds,
  runSkipComposeContract,
} = require('../../scripts/check-skip-compose-contract');

const PAD_ROW = `- id: ${PAD_ID}\n  config:\n    updateCheck: false\n`;
const DESKTOP_ROWS = `- id: ${TASK_CONTROL_ID}\n- id: ${INSTALL_ID}\n- id: ${WORKSPACE_DEPS_ID}\n- id: ${SKILL_OFFICE_ID}\n- id: ${USAGE_ID}\n- id: ${IM_ID}\n- id: ${MARKET_ID}\n- id: ${WHALE_ID}\n- id: ${REMOTE_ID}\n${PAD_ROW}`;
const FULL_PAD_ROW = `- id: ${PAD_ID}\n  disabled: true\n  config:\n    dataFile: home-panels.json\n    agentRefresh: false\n    updateCheck: false\n`;
const FULL_DESKTOP_ROWS = DESKTOP_ROWS.replace(PAD_ROW, FULL_PAD_ROW);
const FULL_ONLY_ROWS = `- id: ${SESSION_SEARCH_ID}\n  config:\n    openAt: first-search\n`;

test('composeContractProblems demands positive evidence before canary absence', () => {
  // Healthy skip dump: desktop rows present, canary gone.
  assert.deepEqual(composeContractProblems('skip', DESKTOP_ROWS), []);
  // Healthy full dump: all present.
  assert.deepEqual(
    composeContractProblems('full', `- id: ${CANARY_ID}\n${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}`),
    [],
  );
  // Empty/truncated dump must fail on the missing desktop rows, not pass
  // because the canary vanished with everything else.
  const empty = composeContractProblems('skip', '');
  assert.equal(empty.length, 10);
  assert.match(empty[0], new RegExp(TASK_CONTROL_ID));
  assert.match(empty[1], new RegExp(INSTALL_ID));
  assert.match(empty[2], new RegExp(USAGE_ID));
  assert.match(empty[3], new RegExp(IM_ID));
  assert.match(empty[4], new RegExp(MARKET_ID));
  assert.match(empty[5], new RegExp(WHALE_ID));
  assert.match(empty[6], new RegExp(REMOTE_ID));
  // Skip round that still composes the user layer is the core violation.
  const resurrect = composeContractProblems('skip', `${DESKTOP_ROWS}- id: ${CANARY_ID}\n`);
  assert.equal(resurrect.length, 1);
  assert.match(resurrect[0], /--skip-user-plugins 未生效/);
  // Full round without the canary means the canary probe itself is broken.
  const brokenProbe = composeContractProblems('full', `${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}`);
  assert.equal(brokenProbe.length, 1);
  assert.match(brokenProbe[0], /canary/);
  // A second desktop row means a stale managed block composed next to the
  // overlay — the CLI's insert does not dedupe by id.
  const doubledInstall = composeContractProblems('full', `- id: ${CANARY_ID}\n${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}- id: ${INSTALL_ID}\n`);
  assert.equal(doubledInstall.length, 1);
  assert.match(doubledInstall[0], /双挂载/);
  const doubledIm = composeContractProblems('full', `- id: ${CANARY_ID}\n${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}- id: ${IM_ID}\n`);
  assert.equal(doubledIm.length, 1);
  assert.match(doubledIm[0], /dsh-im/);
  assert.match(doubledIm[0], /双挂载/);
  // Missing task-control alone is a violation (it rides every start).
  const missingTaskControl = composeContractProblems('skip', `- id: ${INSTALL_ID}\n- id: ${WORKSPACE_DEPS_ID}\n- id: ${SKILL_OFFICE_ID}\n- id: ${USAGE_ID}\n- id: ${IM_ID}\n- id: ${MARKET_ID}\n- id: ${WHALE_ID}\n- id: ${REMOTE_ID}\n${PAD_ROW}`);
  assert.equal(missingTaskControl.length, 1);
  assert.match(missingTaskControl[0], new RegExp(TASK_CONTROL_ID));
  // Missing dsh-im alone is a violation too (built-in must ride every start).
  const missingIm = composeContractProblems('skip', `- id: ${TASK_CONTROL_ID}\n- id: ${INSTALL_ID}\n- id: ${WORKSPACE_DEPS_ID}\n- id: ${SKILL_OFFICE_ID}\n- id: ${USAGE_ID}\n- id: ${MARKET_ID}\n- id: ${WHALE_ID}\n- id: ${REMOTE_ID}\n${PAD_ROW}`);
  assert.equal(missingIm.length, 1);
  assert.match(missingIm[0], new RegExp(IM_ID));
  // Missing dsh-whale alone is a violation too (the contract run always
  // mounts its overlay with enabled:true — production gates it on config).
  const missingWhale = composeContractProblems('skip', `- id: ${TASK_CONTROL_ID}\n- id: ${INSTALL_ID}\n- id: ${WORKSPACE_DEPS_ID}\n- id: ${SKILL_OFFICE_ID}\n- id: ${USAGE_ID}\n- id: ${IM_ID}\n- id: ${MARKET_ID}\n- id: ${REMOTE_ID}\n${PAD_ROW}`);
  assert.equal(missingWhale.length, 1);
  assert.match(missingWhale[0], new RegExp(WHALE_ID));
  // Missing dsh-remote alone is a violation too (the contract run always
  // mounts its overlay — production gates it on remoteWorkspaceEnabled,
  // default ON).
  const missingRemote = composeContractProblems('skip', `- id: ${TASK_CONTROL_ID}\n- id: ${INSTALL_ID}\n- id: ${WORKSPACE_DEPS_ID}\n- id: ${SKILL_OFFICE_ID}\n- id: ${USAGE_ID}\n- id: ${IM_ID}\n- id: ${MARKET_ID}\n- id: ${WHALE_ID}\n${PAD_ROW}`);
  assert.equal(missingRemote.length, 1);
  assert.match(missingRemote[0], new RegExp(REMOTE_ID));
  const doubledWhale = composeContractProblems('full', `- id: ${CANARY_ID}\n${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}- id: ${WHALE_ID}\n`);
  assert.equal(doubledWhale.length, 1);
  assert.match(doubledWhale[0], /dsh-whale/);
  assert.match(doubledWhale[0], /双挂载/);
  const searchOnSkip = composeContractProblems('skip', `${DESKTOP_ROWS}${FULL_ONLY_ROWS}`);
  assert.equal(searchOnSkip.length, 1);
  assert.match(searchOnSkip[0], /session-search/);
  assert.deepEqual(composeContractProblems('full', `${CANARY_ID}\n${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}`), []);
});

test('compose contract rejects missing or duplicate default pad mounts', () => {
  assert.match(composeContractProblems('skip', DESKTOP_ROWS.replace(PAD_ROW, '')).join('\n'), /缺少.*dsh-pad/);
  assert.match(composeContractProblems('skip', DESKTOP_ROWS + PAD_ROW).join('\n'), /dsh-pad.*双挂载/);
});

test('compose contract preserves pad disablement and home configuration on full starts', () => {
  const full = healthyStdout([]);
  const cases = [
    ['missing disablement', FULL_PAD_ROW.replace('  disabled: true\n', '')],
    ['overridden disablement', FULL_PAD_ROW.replace('  disabled: true\n', '  disabled: false\n')],
    ['missing data file', FULL_PAD_ROW.replace('    dataFile: home-panels.json\n', '')],
    ['profile overrides home', FULL_PAD_ROW.replace('home-panels.json', 'profile-panels.json')],
    ['default overrides home', FULL_PAD_ROW.replace('home-panels.json', 'panels.json')],
    ['missing refresh setting', FULL_PAD_ROW.replace('    agentRefresh: false\n', '')],
    ['overridden refresh setting', FULL_PAD_ROW.replace('    agentRefresh: false\n', '    agentRefresh: true\n')],
  ];
  for (const [label, row] of cases) {
    assert.deepEqual(composeContractProblems('full', full.replace(FULL_PAD_ROW, row)), [
      'full: dsh-pad 默认行未保留用户禁用或 profile/home 配置优先级',
    ], label);
  }
});

test('compose contract rejects pad user disablement and configuration leaking into recovery', () => {
  const cases = [
    ['profile disablement', PAD_ROW.replace(`- id: ${PAD_ID}\n`, `- id: ${PAD_ID}\n  disabled: true\n`)],
    ['profile data file', PAD_ROW.replace('  config:\n', '  config:\n    dataFile: profile-panels.json\n')],
    ['home data file', PAD_ROW.replace('  config:\n', '  config:\n    dataFile: home-panels.json\n')],
    ['full user configuration', FULL_PAD_ROW],
  ];
  for (const [label, row] of cases) {
    assert.deepEqual(composeContractProblems('skip', DESKTOP_ROWS.replace(PAD_ROW, row)), [
      'skip: dsh-pad 恢复启动不应读取用户禁用和配置补丁',
    ], label);
  }
});

test('compose contract requires disabled pad update checks on both rounds', () => {
  for (const round of ['skip', 'full']) {
    const stdout = healthyStdout(round === 'skip' ? ['--skip-user-plugins'] : []);
    for (const updateCheck of ['', '    updateCheck: true\n']) {
      assert.deepEqual(composeContractProblems(round, stdout.replace('    updateCheck: false\n', updateCheck)), [
        `${round}: dsh-pad 默认更新检查应关闭`,
      ], `${round}: ${updateCheck || 'missing updateCheck'}`);
    }
  }
});

test('compose contract rejects a disabled Settings market on full and recovery starts', () => {
  for (const round of ['skip', 'full']) {
    const stdout = healthyStdout(round === 'skip' ? ['--skip-user-plugins'] : []);
    const disabled = stdout.replace(`- id: ${MARKET_ID}\n`, `- id: ${MARKET_ID}\n  disabled: true\n`);
    assert.deepEqual(composeContractProblems(round, disabled), [
      `${round}: 桌面设置市场行 ${MARKET_ID} 必须启用`,
    ]);
  }
});

test('composeContractRounds mirrors production overlay order on skip and full starts', () => {
  const rounds = composeContractRounds('/h/apps/cli/lib/bin.js', [
    '/p/desktop-task-control.patch.yml',
    '/p/desktop-install.patch.yml',
    '/p/desktop-usage.patch.yml',
    '/p/desktop-dsh-im.patch.yml',
    '/p/desktop-market.patch.yml',
    '/p/desktop-dsh-whale.patch.yml',
    '/p/desktop-dsh-remote.patch.yml',
  ], [
    '/p/desktop-task-control.patch.yml',
    '/p/desktop-install.patch.yml',
    '/p/desktop-usage.patch.yml',
    '/p/session-search.patch.yml',
    '/p/desktop-dsh-im.patch.yml',
    '/p/desktop-market.patch.yml',
    '/p/desktop-dsh-whale.patch.yml',
    '/p/desktop-dsh-remote.patch.yml',
  ]);
  assert.deepEqual(rounds.map((row) => row.round), ['skip', 'full']);
  assert.deepEqual(rounds[0].args, [
    '/h/apps/cli/lib/bin.js', 'web', '--skip-user-plugins',
    '--patch', '/p/desktop-task-control.patch.yml',
    '--patch', '/p/desktop-install.patch.yml',
    '--patch', '/p/desktop-usage.patch.yml',
    '--patch', '/p/desktop-dsh-im.patch.yml',
    '--patch', '/p/desktop-market.patch.yml',
    '--patch', '/p/desktop-dsh-whale.patch.yml',
    '--patch', '/p/desktop-dsh-remote.patch.yml',
    '--dump-config',
  ]);
  assert.deepEqual(rounds[1].args, [
    '/h/apps/cli/lib/bin.js', 'web',
    '--patch', '/p/desktop-task-control.patch.yml',
    '--patch', '/p/desktop-install.patch.yml',
    '--patch', '/p/desktop-usage.patch.yml',
    '--patch', '/p/session-search.patch.yml',
    '--patch', '/p/desktop-dsh-im.patch.yml',
    '--patch', '/p/desktop-market.patch.yml',
    '--patch', '/p/desktop-dsh-whale.patch.yml',
    '--patch', '/p/desktop-dsh-remote.patch.yml',
    '--dump-config',
  ]);
});

function fakeHarnessRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), '// stub, never executed\n');
  return root;
}

function healthyStdout(args) {
  const skip = args.includes('--skip-user-plugins');
  return skip ? DESKTOP_ROWS : `- id: ${CANARY_ID}\n${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}`;
}

test('runSkipComposeContract replays the managed-block migration and passes overlays on both rounds', async (t) => {
  const root = fakeHarnessRoot(t);
  const calls = [];
  const result = await runSkipComposeContract(root, {
    spawnSync: (nodeBin, args, options) => {
      calls.push({
        nodeBin,
        args,
        options,
        profilePatch: fs.readFileSync(path.join(options.env.DSH_HOME, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'),
        homePatch: fs.readFileSync(path.join(options.env.DSH_HOME, 'cordis.patch.yml'), 'utf8'),
        padDefaultPatch: fs.readFileSync(options.env.DSHD_PROFILE_DEFAULT_PATCH, 'utf8'),
        botsResidue: ['fixtures/dshbot', 'profiles/web/desktop-plugins/dshbot', 'profiles/web/node_modules/dshbot']
          .filter((rel) => fs.existsSync(path.join(options.env.DSH_HOME, rel))),
      });
      return { status: 0, stdout: healthyStdout(args) };
    },
  });
  assert.deepEqual(result, { ok: true, rounds: 2 });
  assert.equal(calls.length, 2);
  const [skipCall, fullCall] = calls;
  assert.equal(skipCall.args[0], path.join(root, 'apps', 'cli', 'lib', 'bin.js'));
  assert.equal(skipCall.args[1], 'web');
  assert.equal(skipCall.args[2], '--skip-user-plugins');
  assert.equal(skipCall.args[3], '--patch');
  // The overlays are generated by the REAL ensures inside the temp home —
  // including the migration that strips the seeded managed blocks while
  // keeping the canary user row (asserted inside the run).
  const home = skipCall.options.env.DSH_HOME;
  assert.ok(home && home.startsWith(os.tmpdir()));
  const taskControlOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-task-control', 'desktop-task-control.patch.yml');
  const installOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'install-dsh-plugin', 'desktop-install.patch.yml');
  const officeOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'office', 'desktop-office.patch.yml');
  const usageOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-usage-panel', 'desktop-usage-panel.patch.yml');
  const imOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-im', 'desktop-dsh-im.patch.yml');
  const marketOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-market', 'desktop-dsh-market.patch.yml');
  const whaleOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-whale', 'desktop-dsh-whale.patch.yml');
  const remoteOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-remote', 'desktop-dsh-remote.patch.yml');
  const searchOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'session-search', 'desktop-session-search.patch.yml');
  const padOverlay = path.join(home, 'profiles', 'web', 'desktop-plugins', 'dsh-pad', 'desktop-dsh-pad.patch.yml');
  assert.equal(skipCall.options.env.DSHD_PROFILE_DEFAULT_PATCH, padOverlay);
  assert.equal(fullCall.options.env.DSHD_PROFILE_DEFAULT_PATCH, padOverlay);
  for (const call of calls) {
    assert.equal(call.options.env.DSH_HOME, home);
    assert.equal(call.args.includes(padOverlay), false);
    assert.equal(call.args.some((arg) => /dshbot/.test(arg)), false);
    assert.deepEqual(call.botsResidue, []);
    assert.doesNotMatch(call.profilePatch, /dshd-gui-dshbot|name: "dshbot"/);
    assert.match(call.profilePatch, /\n- id: dsh-pad\n  disabled: true\n  config:\n    dataFile: profile-panels\.json\n    agentRefresh: false\n    updateCheck: false\n/);
    assert.equal(call.homePatch, '- id: dsh-pad\n  config:\n    dataFile: home-panels.json\n    agentRefresh: false\n    updateCheck: false\n');
    assert.match(call.padDefaultPatch, /- insert:\n    - id: dsh-pad\n/);
    assert.match(call.padDefaultPatch, /\n      config:\n        updateCheck: false\n/);
  }
  assert.equal(skipCall.args[4], taskControlOverlay);
  assert.equal(skipCall.args[5], '--patch');
  assert.equal(skipCall.args[6], installOverlay);
  assert.equal(skipCall.args[7], '--patch');
  assert.equal(skipCall.args[8], officeOverlay);
  assert.equal(skipCall.args[9], '--patch');
  assert.equal(skipCall.args[10], usageOverlay);
  assert.equal(skipCall.args[11], '--patch');
  assert.equal(skipCall.args[12], imOverlay);
  assert.equal(skipCall.args[13], '--patch');
  assert.equal(skipCall.args[14], marketOverlay);
  assert.equal(skipCall.args[15], '--patch');
  assert.equal(skipCall.args[16], whaleOverlay);
  assert.equal(skipCall.args[17], '--patch');
  assert.equal(skipCall.args[18], remoteOverlay);
  assert.equal(skipCall.args[19], '--dump-config');
  assert.equal(skipCall.args.length, 20);
  // dsh-home rule: the child composes only against the throwaway home.
  assert.equal(skipCall.options.env.DSHD_HOME, undefined);
  assert.equal(skipCall.options.env.DSH_HARNESS_ROOT, undefined);
  // Full starts add session-search between usage and dsh-im; the remaining
  // desktop overlays follow in production order.
  assert.deepEqual(fullCall.args.slice(1), [
    'web', '--patch', taskControlOverlay,
    '--patch', installOverlay,
    '--patch', officeOverlay,
    '--patch', usageOverlay,
    '--patch', searchOverlay,
    '--patch', imOverlay,
    '--patch', marketOverlay,
    '--patch', whaleOverlay,
    '--patch', remoteOverlay,
    '--dump-config',
  ]);
  // The throwaway home is removed after the run.
  assert.equal(fs.existsSync(home), false);
});

test('runSkipComposeContract fails when the full round composes the install row twice', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: (nodeBin, args) => {
        const skip = args.includes('--skip-user-plugins');
        return {
          status: 0,
          stdout: skip
            ? DESKTOP_ROWS
            : `- id: ${CANARY_ID}\n${FULL_DESKTOP_ROWS}${FULL_ONLY_ROWS}- id: ${INSTALL_ID}\n`,
        };
      },
    }),
    /双挂载/,
  );
});

test('runSkipComposeContract fails when the skip round drops the dsh-im row', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: (nodeBin, args) => {
        const skip = args.includes('--skip-user-plugins');
        return {
          status: 0,
          stdout: skip ? `- id: ${INSTALL_ID}\n` : healthyStdout(args),
        };
      },
    }),
    new RegExp(IM_ID),
  );
});

test('runSkipComposeContract fails on user-layer resurrection under skip', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: (nodeBin, args) => ({
        status: 0,
        stdout: args.includes('--skip-user-plugins')
          ? `${DESKTOP_ROWS}- id: ${CANARY_ID}\n`
          : healthyStdout(args),
      }),
    }),
    /--skip-user-plugins 未生效/,
  );
});

test('runSkipComposeContract surfaces a nonzero dump-config exit with stderr', async (t) => {
  const root = fakeHarnessRoot(t);
  await assert.rejects(
    () => runSkipComposeContract(root, {
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'dsh: cannot resolve profile bundle "@deepseek-ai/dsh-web-app"' }),
    }),
    (error) => {
      assert.match(String(error.message), /退出码 1/);
      assert.match(String(error.message), /cannot resolve profile bundle/);
      return true;
    },
  );
});

test('runSkipComposeContract refuses a runtime without the built CLI', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(() => runSkipComposeContract(root), /缺少已构建的 CLI/);
});
