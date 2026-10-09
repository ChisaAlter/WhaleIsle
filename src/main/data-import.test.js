'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');

function makeTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-import-')));
  const source = path.join(root, 'official');
  const dest = path.join(root, 'desktop');
  const userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(source, 'sessions', 'proj', 'sess-a'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'proj', 'sess-a', 'session.jsonl'), '{"id":"a"}\n');
  fs.mkdirSync(path.join(source, 'sessions', 'proj', 'sess-b'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'proj', 'sess-b', 'session.jsonl'), '{"id":"b"}\n');
  fs.mkdirSync(path.join(source, 'sessions', 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'legacy', 'chat.db'), 'sqlite');
  fs.mkdirSync(path.join(source, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(source, 'attachments', 'file.bin'), 'blob');
  fs.mkdirSync(path.join(source, 'profiles', 'web'), { recursive: true });
  fs.writeFileSync(path.join(source, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: {
      '@deepseek-ai/dsh-base': '1.0.0',
      'good-plugin': 'github:acme/good',
      'file-plugin': 'file:../local',
      'registry-plugin': '1.2.3',
      'caret-plugin': '^2.0.0',
      'tarball-plugin': 'https://example.test/x.tgz',
      'tag-plugin': 'latest',
    },
  }));
  fs.mkdirSync(userData, { recursive: true });
  setDesktopDshHome(dest);
  return { root, source, dest, userData };
}

function writeSkill(root, name, body = `# ${name}\n`) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
  return dir;
}

const MCP_FIXTURE = `servers:
  - id: wiki
    enabled: true
    transport: streamable-http
    serverName: wiki
    url: https://example.test/mcp
  - id: secret-mcp
    enabled: true
    transport: streamable-http
    serverName: secret
    url: https://example.test/secure
    headers:
      Authorization: Bearer test-token-not-real
`;

test.afterEach(() => {
  clearDesktopDshHome();
});

test('scanImport lists sessions, skips sqlite, and flags dest conflicts', () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), '{"id":"old"}\n');
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  assert.equal(scan.sourceHasData, true);
  assert.equal(scan.destEmpty, false);
  const byRel = Object.fromEntries(scan.sessions.map((row) => [row.rel, row]));
  assert.equal(byRel['proj/sess-a'].conflict, true);
  assert.equal(byRel['proj/sess-b'].conflict, false);
  assert.equal(byRel.legacy.unsupported, true);
  const plugins = Object.fromEntries(scan.plugins.map((row) => [row.name, row]));
  assert.equal(plugins['@deepseek-ai/dsh-base'].skipped, true);
  assert.equal(plugins['file-plugin'].reason, 'local-spec');
  assert.equal(plugins['good-plugin'].skipped, false);
  assert.equal(plugins['registry-plugin'].skipped, false);
  assert.equal(plugins['caret-plugin'].skipped, false);
  assert.equal(plugins['tarball-plugin'].reason, 'unsupported');
  assert.equal(plugins['tag-plugin'].reason, 'unsupported');
  assert.equal(typeof scan.homeDir, 'string');
  assert.ok(scan.homeDir.length > 0);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('asynchronous import scan preserves full synchronous results and source files', async () => {
  const tree = makeTree();
  const zlib = require('node:zlib');
  const compressedDir = path.join(tree.source, 'sessions', 'proj', 'compressed');
  fs.mkdirSync(compressedDir, { recursive: true });
  const text = JSON.stringify({ type: 'session/header', data: { id: 'compressed', cwd: 'C:/work', createdAt: 123 } }) + '\n';
  fs.writeFileSync(path.join(compressedDir, 'session.v3.jsonl.zstd'), zlib.zstdCompressSync(text));
  const conflict = path.join(tree.dest, 'sessions', 'proj', 'sess-a');
  fs.mkdirSync(conflict, { recursive: true });
  fs.writeFileSync(path.join(conflict, 'session.jsonl'), '{"id":"old"}\n');
  const malformed = path.join(tree.source, 'sessions', 'proj', 'sess-b', 'session.jsonl');
  fs.writeFileSync(malformed, 'not valid json\n');
  const { scanImport, scanImportAsync } = require('./data-import');
  const options = { sourceHome: tree.source, destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-extra-skills') };
  try {
    assert.deepEqual(await scanImportAsync(options), scanImport(options));
    assert.equal(fs.readFileSync(malformed, 'utf8'), 'not valid json\n');
    assert.equal(fs.readFileSync(path.join(conflict, 'session.jsonl'), 'utf8'), '{"id":"old"}\n');
  } finally {
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

test('scanImport enriches session display meta from jsonl header and title, fail-soft on bad logs', () => {
  const tree = makeTree();
  const withMeta = path.join(tree.source, 'sessions', '_no-cwd', 'chat-1');
  fs.mkdirSync(withMeta, { recursive: true });
  fs.writeFileSync(path.join(withMeta, 'session.jsonl'), [
    JSON.stringify({
      type: 'session',
      version: 0,
      id: 'chat-1',
      createdAt: 1_700_000_000_000,
      cwd: 'C:\\Users\\demo\\project',
      delegationDepth: 0,
    }),
    JSON.stringify({ type: 'session/title', seq: 1, data: { title: 'First title' } }),
    JSON.stringify({ type: 'user/message', seq: 2, data: {} }),
    JSON.stringify({ type: 'session/title', seq: 3, data: { title: 'Latest title' } }),
    '',
  ].join('\n'));
  const withCwdOnly = path.join(tree.source, 'sessions', '--C-Users-demo-other--', 'uuid-9');
  fs.mkdirSync(withCwdOnly, { recursive: true });
  fs.writeFileSync(path.join(withCwdOnly, 'session.jsonl'), `${JSON.stringify({
    type: 'session',
    version: 0,
    id: 'uuid-9',
    createdAt: 1_700_000_000_100,
    cwd: 'C:\\Users\\demo\\other',
    delegationDepth: 0,
  })}\n`);
  const zstdOnly = path.join(tree.source, 'sessions', '_no-cwd', 'zstd-only');
  fs.mkdirSync(zstdOnly, { recursive: true });
  fs.writeFileSync(path.join(zstdOnly, 'session.jsonl.zstd'), Buffer.from([0x00, 0x01, 0x02]));
  const badPlain = path.join(tree.source, 'sessions', '_no-cwd', 'bad-plain');
  fs.mkdirSync(badPlain, { recursive: true });
  fs.writeFileSync(path.join(badPlain, 'session.jsonl'), 'not-json\n{bad\n');

  writeSkill(path.join(tree.source, 'skills'), 'named', '---\nname: Friendly Skill\n---\n# body\n');

  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const byRel = Object.fromEntries(scan.sessions.map((row) => [row.rel, row]));
  assert.equal(byRel['_no-cwd/chat-1'].id, 'chat-1');
  assert.equal(byRel['_no-cwd/chat-1'].cwd, 'C:\\Users\\demo\\project');
  assert.equal(byRel['_no-cwd/chat-1'].title, 'Latest title');
  assert.equal(byRel['_no-cwd/chat-1'].createdAt, '1700000000000');
  assert.equal(byRel['_no-cwd/chat-1'].compressedLog, false);
  assert.equal(byRel['--C-Users-demo-other--/uuid-9'].cwd, 'C:\\Users\\demo\\other');
  assert.equal(byRel['--C-Users-demo-other--/uuid-9'].title, '');
  assert.equal(byRel['_no-cwd/zstd-only'].id, 'zstd-only');
  assert.equal(byRel['_no-cwd/zstd-only'].compressedLog, true);
  assert.equal(byRel['_no-cwd/bad-plain'].id, 'bad-plain');
  assert.equal(byRel['_no-cwd/bad-plain'].title, '');
  const named = scan.skills.find((row) => row.id === 'home:named');
  assert.ok(named);
  assert.equal(named.displayName, 'Friendly Skill');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport reads display meta from session.jsonl.zstd via Node zlib', () => {
  const zlib = require('node:zlib');
  if (typeof zlib.zstdCompressSync !== 'function') {
    return;
  }
  const tree = makeTree();
  const dir = path.join(tree.source, 'sessions', '_no-cwd', 'zstd-ok');
  fs.mkdirSync(dir, { recursive: true });
  const plaintext = [
    JSON.stringify({
      type: 'session',
      version: 0,
      id: 'zstd-ok',
      createdAt: 1_700_000_000_200,
      cwd: 'D:\\work\\app',
      delegationDepth: 0,
    }),
    JSON.stringify({ type: 'session/title', seq: 1, data: { title: 'From zstd' } }),
    '',
  ].join('\n');
  const options = zlib.constants && zlib.constants.ZSTD_c_checksumFlag != null
    ? { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
    : undefined;
  fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(plaintext), options));
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const row = scan.sessions.find((item) => item.rel === '_no-cwd/zstd-ok');
  assert.ok(row);
  assert.equal(row.id, 'zstd-ok');
  assert.equal(row.cwd, 'D:\\work\\app');
  assert.equal(row.title, 'From zstd');
  assert.equal(row.compressedLog, false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport omits harness preset fixture sessions under _no-cwd/preset-*', () => {
  const tree = makeTree();
  const preset = path.join(tree.source, 'sessions', '_no-cwd', 'preset-authored');
  const chat = path.join(tree.source, 'sessions', '_no-cwd', 'chat-1');
  fs.mkdirSync(preset, { recursive: true });
  fs.mkdirSync(chat, { recursive: true });
  fs.writeFileSync(path.join(preset, 'session.jsonl'), `${JSON.stringify({
    type: 'session',
    version: 0,
    id: 'preset-authored',
    createdAt: 1,
    delegationDepth: 0,
  })}\n`);
  fs.writeFileSync(path.join(chat, 'session.jsonl'), `${JSON.stringify({
    type: 'session',
    version: 0,
    id: 'chat-1',
    createdAt: 2,
    cwd: 'C:\\Users\\demo\\project',
    delegationDepth: 0,
  })}\n`);
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const rels = scan.sessions.map((row) => row.rel);
  assert.ok(rels.includes('_no-cwd/chat-1'));
  assert.ok(!rels.includes('_no-cwd/preset-authored'));
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('pluginReinstallSpec maps github and registry semver specs and rejects everything else', () => {
  const { pluginReinstallSpec } = require('./data-import');
  assert.equal(pluginReinstallSpec('x', 'github:acme/good'), 'github:acme/good');
  assert.equal(pluginReinstallSpec('x', 'github:acme/good#abc1234'), 'github:acme/good#abc1234');
  assert.equal(pluginReinstallSpec('registry-plugin', '1.2.3'), 'registry-plugin@1.2.3');
  assert.equal(pluginReinstallSpec('@scope/name', '^2.0.0'), '@scope/name@^2.0.0');
  assert.equal(pluginReinstallSpec('tilde', '~0.4.1-rc.1'), 'tilde@~0.4.1-rc.1');
  assert.equal(pluginReinstallSpec('x', 'https://example.test/x.tgz'), null);
  assert.equal(pluginReinstallSpec('x', 'latest'), null);
  assert.equal(pluginReinstallSpec('x', 'npm:alias@1.2.3'), null);
  assert.equal(pluginReinstallSpec('x', 'git+https://github.com/a/b.git'), null);
  assert.equal(pluginReinstallSpec('../escape', '1.2.3'), null);
  assert.equal(pluginReinstallSpec('x', ''), null);
});

test('shouldHoldForImport is true only when dest sessions are empty and source has data', () => {
  const { shouldHoldForImport } = require('./data-import');
  assert.equal(shouldHoldForImport({ destEmpty: true, sourceHasData: true }), true);
  assert.equal(shouldHoldForImport({ destEmpty: false, sourceHasData: true }), false);
  assert.equal(shouldHoldForImport({ destEmpty: true, sourceHasData: false }), false);
});

test('importSessions skips conflicts by default, overwrites when asked, and never writes the source', async () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'OLD\n');
  const { importSessions } = require('./data-import');
  const skipped = await importSessions({
    sourceHome: tree.source,
    destHome: tree.dest,
    userDataDir: tree.userData,
  });
  assert.equal(skipped.sessions.find((row) => row.rel === 'proj/sess-a').status, 'skipped');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'utf8'), 'OLD\n');
  assert.equal(skipped.sessions.find((row) => row.rel === 'proj/sess-b').status, 'copied');
  assert.equal(skipped.sessions.find((row) => row.rel === 'legacy').status, 'unsupported');
  assert.equal(fs.existsSync(path.join(tree.userData, 'import-journal.json')), true);
  assert.equal(fs.readFileSync(path.join(tree.source, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'utf8'), '{"id":"a"}\n');

  const overwritten = await importSessions({
    sourceHome: tree.source,
    destHome: tree.dest,
    overwrite: true,
    selectedRels: ['proj/sess-a'],
    userDataDir: tree.userData,
  });
  assert.equal(overwritten.sessions[0].status, 'copied');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'utf8'), '{"id":"a"}\n');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importSessions rejects relative escape paths', async () => {
  const tree = makeTree();
  const { importSessions } = require('./data-import');
  const result = await importSessions({
    sourceHome: tree.source,
    destHome: tree.dest,
    selectedRels: ['../escape'],
    userDataDir: tree.userData,
  });
  assert.equal(result.sessions[0].status, 'rejected');
  assert.equal(fs.existsSync(path.join(tree.dest, 'escape')), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('recoverInterruptedImport consumes a copying journal and clears .import-tmp staging dirs', () => {
  const tree = makeTree();
  const { recoverInterruptedImport, readImportJournal, journalPath } = require('./data-import');
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a.import-tmp'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a.import-tmp', 'session.jsonl'), 'partial');
  fs.mkdirSync(path.join(tree.dest, 'skills', 'alpha.import-tmp'), { recursive: true });
  fs.mkdirSync(path.join(tree.dest, 'attachments.import-tmp'), { recursive: true });
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'sess-keep'), { recursive: true });
  fs.writeFileSync(journalPath(tree.userData), `${JSON.stringify({
    phase: 'copying',
    sourceHome: tree.source,
    destHome: tree.dest,
    items: [],
  })}\n`);
  const result = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(result.recovered, true);
  // Unjournaled staging dirs are preserved, not deleted: they may be the
  // only surviving copy after a crash in the old non-transactional swap.
  assert.equal(result.blocked, true);
  assert.equal(result.pendingTxns.length, 3);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a.import-tmp')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'alpha.import-tmp')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'attachments.import-tmp')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-keep')), true);
  assert.equal(readImportJournal(tree.userData).phase, 'blocked');
  const again = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(again.recovered, false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('recoverInterruptedImport ignores done journals and foreign destHome journals', () => {
  const tree = makeTree();
  const { recoverInterruptedImport, journalPath } = require('./data-import');
  fs.mkdirSync(path.join(tree.dest, 'sessions', 'stale.import-tmp'), { recursive: true });
  fs.writeFileSync(journalPath(tree.userData), `${JSON.stringify({
    phase: 'done',
    sourceHome: tree.source,
    destHome: tree.dest,
  })}\n`);
  assert.equal(
    recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest }).recovered,
    false,
  );
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'stale.import-tmp')), true);

  fs.writeFileSync(journalPath(tree.userData), `${JSON.stringify({
    phase: 'copying',
    sourceHome: tree.source,
    destHome: path.join(tree.root, 'somewhere-else'),
  })}\n`);
  assert.equal(
    recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest }).recovered,
    false,
  );
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'stale.import-tmp')), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importPlugins skips templates and local specs, and reinstalls selected names', async () => {
  const tree = makeTree();
  const calls = [];
  const { importPlugins } = require('./data-import');
  const result = await importPlugins({
    sourceHome: tree.source,
    destHome: tree.dest,
    installPlugin: async (spec) => {
      calls.push(spec);
      return { ok: true };
    },
  });
  assert.deepEqual(calls.sort(), ['caret-plugin@^2.0.0', 'github:acme/good', 'registry-plugin@1.2.3']);
  assert.equal(result.plugins.find((row) => row.name === 'good-plugin').status, 'installed');
  assert.equal(result.plugins.find((row) => row.name === 'registry-plugin').status, 'installed');
  assert.equal(result.plugins.find((row) => row.name === 'tarball-plugin'), undefined);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importPlugins never sends an unsupported spec to the installer, even when selected', async () => {
  const tree = makeTree();
  const calls = [];
  const { importPlugins } = require('./data-import');
  const result = await importPlugins({
    sourceHome: tree.source,
    destHome: tree.dest,
    selectedNames: ['tarball-plugin', 'tag-plugin', 'registry-plugin'],
    installPlugin: async (spec) => {
      calls.push(spec);
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ['registry-plugin@1.2.3']);
  assert.equal(result.plugins.find((row) => row.name === 'tarball-plugin').status, 'skipped');
  assert.equal(result.plugins.find((row) => row.name === 'tarball-plugin').reason, 'unsupported');
  assert.equal(result.plugins.find((row) => row.name === 'tag-plugin').reason, 'unsupported');
  assert.equal(result.ok, true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport lists skills and MCP without exposing secrets, and holds on skills-only homes', () => {
  const tree = makeTree();
  writeSkill(path.join(tree.source, 'skills'), 'alpha');
  fs.mkdirSync(path.join(tree.source, 'skills', '.system'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, 'skills', '.system', 'SKILL.md'), '# hidden\n');
  fs.writeFileSync(path.join(tree.source, 'mcp-servers.yaml'), MCP_FIXTURE);
  const agentsRoot = path.join(tree.root, 'agents-skills');
  writeSkill(agentsRoot, 'beta');
  const extraRoot = path.join(tree.root, 'extra-skills');
  writeSkill(extraRoot, 'gamma');
  const { scanImport, shouldHoldForImport } = require('./data-import');
  const scan = scanImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: agentsRoot,
    extraSkillDirs: [extraRoot],
  });
  const skillIds = scan.skills.map((row) => row.id).sort();
  assert.deepEqual(skillIds, ['agents:beta', 'extra:gamma', 'home:alpha']);
  assert.equal(scan.skills.some((row) => row.name === '.system' || row.id.includes('.system')), false);
  assert.equal(scan.mcp.length, 2);
  assert.equal(scan.mcp.find((row) => row.id === 'wiki').endpoint, 'https://example.test/mcp');
  const secret = JSON.stringify(scan.mcp);
  assert.equal(secret.includes('test-token-not-real'), false);
  assert.equal(secret.includes('Authorization'), false);
  assert.equal(scan.sourceHasData, true);

  const emptyDest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-empty-dest-')));
  const skillsOnly = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skills-only-')));
  writeSkill(path.join(skillsOnly, 'skills'), 'solo');
  const skillsScan = scanImport({
    sourceHome: skillsOnly,
    destHome: emptyDest,
    agentsSkillsRoot: path.join(tree.root, 'missing-agents'),
  });
  assert.equal(skillsScan.sessions.length, 0);
  assert.equal(skillsScan.skills.length, 1);
  assert.equal(skillsScan.sourceHasData, true);
  assert.equal(skillsScan.destEmpty, true);
  assert.equal(shouldHoldForImport(skillsScan), true);
  fs.rmSync(emptyDest, { recursive: true, force: true });
  fs.rmSync(skillsOnly, { recursive: true, force: true });
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport copies only selected rows and never writes the source', async () => {
  const tree = makeTree();
  writeSkill(path.join(tree.source, 'skills'), 'alpha');
  writeSkill(path.join(tree.source, 'skills'), 'omega');
  fs.writeFileSync(path.join(tree.source, 'mcp-servers.yaml'), MCP_FIXTURE);
  fs.writeFileSync(path.join(tree.source, 'settings.yaml'), SETTINGS_FIXTURE);
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'research'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, '.agent-presets', 'research', 'agent.cordis.yml'), '- name: research\n');
  const extraRoot = path.join(tree.root, 'extra-skills');
  writeSkill(extraRoot, 'gamma');
  const sourceSkill = fs.readFileSync(path.join(tree.source, 'skills', 'alpha', 'SKILL.md'));
  const sourceMcp = fs.readFileSync(path.join(tree.source, 'mcp-servers.yaml'));
  const sourceSess = fs.readFileSync(path.join(tree.source, 'sessions', 'proj', 'sess-b', 'session.jsonl'));
  const { readImportJournal, runImport } = require('./data-import');
  const empty = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    extraSkillDirs: [extraRoot],
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    importAttachments: false,
    installPlugin: async () => ({ ok: true }),
  });
  assert.equal(empty.empty, true);
  assert.equal(fs.existsSync(path.join(tree.userData, 'import-journal.json')), false,
    'an empty selection must not create an import journal');
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'mcp-servers.yaml')), false);

  const calls = [];
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    extraSkillDirs: [extraRoot],
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a'],
    selectedSkillIds: ['home:alpha', 'extra:gamma'],
    selectedPluginNames: ['good-plugin'],
    selectedMcpIds: ['secret-mcp'],
    selectedSettingIds: ['ui-theme'],
    selectedPresetIds: ['research'],
    importAttachments: true,
    overwrite: false,
    installPlugin: async (spec) => {
      calls.push(spec);
      return { ok: true };
    },
  });
  assert.equal(result.empty, false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-b', 'session.jsonl')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'attachments', 'file.bin')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'omega', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'gamma', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, '.agent-presets', 'research', 'agent.cordis.yml')), true);
  assert.equal(result.settings.find((row) => row.id === 'ui-theme').status, 'copied');
  assert.equal(result.presets.find((row) => row.id === 'research').status, 'copied');
  assert.deepEqual(calls, ['github:acme/good']);
  assert.equal(result.ok, true);
  assert.equal(readImportJournal(tree.userData).phase, 'done', 'all committed stages must finish before done');
  const destMcp = fs.readFileSync(path.join(tree.dest, 'mcp-servers.yaml'), 'utf8');
  assert.match(destMcp, /id: secret-mcp/);
  assert.match(destMcp, /Bearer test-token-not-real/);
  assert.equal(destMcp.includes('id: wiki'), false);
  assert.deepEqual(sourceSkill, fs.readFileSync(path.join(tree.source, 'skills', 'alpha', 'SKILL.md')));
  assert.deepEqual(sourceMcp, fs.readFileSync(path.join(tree.source, 'mcp-servers.yaml')));
  assert.deepEqual(sourceSess, fs.readFileSync(path.join(tree.source, 'sessions', 'proj', 'sess-b', 'session.jsonl')));
  fs.rmSync(tree.root, { recursive: true, force: true });
});

const SETTINGS_FIXTURE = `# global note
llm-deepseek:
  baseURL: https://gw.example.test/v1
  models:
    - id: deepseek-v4-pro
      name: Pro
ui-theme:
  preference: dark
  activeDarkThemeId: midnight
llm-pi-ai:
  providers:
    openai:
      apiKeyEnv: OPENAI_API_KEY
    acme:
      apiKeyEnv: "ACME_GATEWAY_KEY"
shell:
  historyLimit: 100
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
`;

const CREDENTIALS_FIXTURE = `version: 1
refs:
  DEEPSEEK_API_KEY: sk-source-secret
  OPENAI_API_KEY: "sk-openai-secret"
  UNRELATED_KEY: sk-unrelated
records:
  deepseek-official/session:
    kind: api-key
    apiKey: sk-oauth-ish
`;

test('scanImport lists whitelisted settings sections, presets, and home AGENTS.md — never secrets', () => {
  const tree = makeTree();
  fs.writeFileSync(path.join(tree.source, 'settings.yaml'), SETTINGS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, '.credentials.yaml'), CREDENTIALS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, 'AGENTS.md'), '# global instructions\n');
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'research'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, '.agent-presets', 'research', 'agent.cordis.yml'), '- name: dsh-agent\n');
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'broken-one'), { recursive: true });
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'Bad Name'), { recursive: true });
  const { scanImport } = require('./data-import');
  const scan = scanImport({ sourceHome: tree.source, destHome: tree.dest });
  const settingIds = scan.settings.map((row) => row.id);
  assert.deepEqual(settingIds, ['llm-deepseek', 'llm-pi-ai', 'agent-default-model', 'ui-theme', 'agents-md']);
  assert.equal(settingIds.includes('shell'), false, 'non-whitelist sections never listed');
  const deepseek = scan.settings.find((row) => row.id === 'llm-deepseek');
  assert.deepEqual(deepseek.credentialRefs, ['DEEPSEEK_API_KEY'], 'implicit default ref');
  const piAi = scan.settings.find((row) => row.id === 'llm-pi-ai');
  assert.deepEqual(piAi.credentialRefs.sort(), ['ACME_GATEWAY_KEY', 'OPENAI_API_KEY']);
  const serialized = JSON.stringify(scan);
  assert.equal(serialized.includes('sk-source-secret'), false);
  assert.equal(serialized.includes('sk-openai-secret'), false);
  const presetIds = scan.presets.map((row) => row.id);
  assert.deepEqual(presetIds, ['broken-one', 'research']);
  assert.equal(scan.presets.find((row) => row.id === 'broken-one').broken, true);
  assert.equal(scan.presets.find((row) => row.id === 'research').broken, false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport moves selected settings sections verbatim, syncs referenced refs only, and never writes the source', async () => {
  const tree = makeTree();
  fs.writeFileSync(path.join(tree.source, 'settings.yaml'), SETTINGS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, '.credentials.yaml'), CREDENTIALS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, 'AGENTS.md'), '# global instructions\n');
  fs.mkdirSync(tree.dest, { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'settings.yaml'), 'ui-titlebar:\n  action: copy\n');
  const sourceSettings = fs.readFileSync(path.join(tree.source, 'settings.yaml'), 'utf8');
  const sourceCreds = fs.readFileSync(path.join(tree.source, '.credentials.yaml'), 'utf8');
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: ['llm-deepseek', 'ui-theme', 'agents-md', 'shell'],
    selectedPresetIds: [],
    importAttachments: false,
  });
  assert.equal(result.settings.find((row) => row.id === 'llm-deepseek').status, 'copied');
  assert.equal(result.settings.find((row) => row.id === 'ui-theme').status, 'copied');
  assert.equal(result.settings.find((row) => row.id === 'agents-md').status, 'copied');
  assert.equal(result.settings.find((row) => row.id === 'shell').status, 'rejected');
  const destSettings = fs.readFileSync(path.join(tree.dest, 'settings.yaml'), 'utf8');
  assert.match(destSettings, /ui-titlebar:\n {2}action: copy/, 'existing desktop sections preserved');
  assert.match(destSettings, /llm-deepseek:\n {2}baseURL: https:\/\/gw\.example\.test\/v1\n {2}models:\n {4}- id: deepseek-v4-pro\n {6}name: Pro/, 'nested block moved verbatim');
  assert.match(destSettings, /ui-theme:\n {2}preference: dark/);
  assert.equal(destSettings.includes('historyLimit'), false, 'non-whitelist section never written');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'AGENTS.md'), 'utf8'), '# global instructions\n');
  assert.deepEqual(result.credentials, [{ ref: 'DEEPSEEK_API_KEY', status: 'copied' }]);
  const destCreds = fs.readFileSync(path.join(tree.dest, '.credentials.yaml'), 'utf8');
  assert.match(destCreds, /^version: 1$/m);
  assert.match(destCreds, /^ {2}DEEPSEEK_API_KEY: sk-source-secret$/m);
  assert.equal(destCreds.includes('UNRELATED_KEY'), false, 'unreferenced refs stay behind');
  assert.equal(destCreds.includes('records:'), false, 'OAuth records never migrate');
  const journal = fs.readFileSync(result.journal, 'utf8');
  assert.equal(journal.includes('sk-source-secret'), false, 'journal carries ref names only');
  assert.deepEqual(sourceSettings, fs.readFileSync(path.join(tree.source, 'settings.yaml'), 'utf8'));
  assert.deepEqual(sourceCreds, fs.readFileSync(path.join(tree.source, '.credentials.yaml'), 'utf8'));
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('settings and credential imports conflict-skip by default and replace on overwrite', async () => {
  const tree = makeTree();
  fs.writeFileSync(path.join(tree.source, 'settings.yaml'), SETTINGS_FIXTURE);
  fs.writeFileSync(path.join(tree.source, '.credentials.yaml'), CREDENTIALS_FIXTURE);
  fs.mkdirSync(tree.dest, { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'settings.yaml'), 'ui-theme:\n  preference: light\n');
  fs.writeFileSync(path.join(tree.dest, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-dest-existing\n');
  const { runImport } = require('./data-import');
  const skipped = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: ['ui-theme', 'llm-deepseek'],
    selectedPresetIds: [],
    importAttachments: false,
  });
  assert.equal(skipped.settings.find((row) => row.id === 'ui-theme').status, 'skipped');
  assert.equal(skipped.settings.find((row) => row.id === 'llm-deepseek').status, 'copied');
  assert.deepEqual(skipped.credentials, [{ ref: 'DEEPSEEK_API_KEY', status: 'skipped' }]);
  assert.match(fs.readFileSync(path.join(tree.dest, 'settings.yaml'), 'utf8'), /preference: light/);
  assert.match(fs.readFileSync(path.join(tree.dest, '.credentials.yaml'), 'utf8'), /sk-dest-existing/);

  const overwritten = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    overwrite: true,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: ['ui-theme', 'llm-deepseek'],
    selectedPresetIds: [],
    importAttachments: false,
  });
  assert.equal(overwritten.settings.find((row) => row.id === 'ui-theme').status, 'copied');
  assert.deepEqual(overwritten.credentials, [{ ref: 'DEEPSEEK_API_KEY', status: 'copied' }]);
  const destSettings = fs.readFileSync(path.join(tree.dest, 'settings.yaml'), 'utf8');
  assert.match(destSettings, /preference: dark/);
  assert.equal(destSettings.includes('preference: light'), false);
  const destCreds = fs.readFileSync(path.join(tree.dest, '.credentials.yaml'), 'utf8');
  assert.match(destCreds, /sk-source-secret/);
  assert.equal(destCreds.includes('sk-dest-existing'), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport copies selected presets by directory and rejects unsafe or broken ids', async () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'research'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, '.agent-presets', 'research', 'agent.cordis.yml'), '- name: dsh-agent\n');
  fs.mkdirSync(path.join(tree.source, '.agent-presets', 'broken-one'), { recursive: true });
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: ['research', 'broken-one', '../escape', 'Bad Name'],
    importAttachments: false,
  });
  assert.equal(result.presets.find((row) => row.id === 'research').status, 'copied');
  assert.equal(result.presets.find((row) => row.id === 'broken-one').status, 'unsupported');
  assert.equal(result.presets.find((row) => row.id === '../escape').status, 'rejected');
  assert.equal(result.presets.find((row) => row.id === 'Bad Name').status, 'rejected');
  assert.equal(
    fs.readFileSync(path.join(tree.dest, '.agent-presets', 'research', 'agent.cordis.yml'), 'utf8'),
    '- name: dsh-agent\n',
  );
  assert.equal(fs.existsSync(path.join(tree.dest, 'escape')), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('probeImportHold matches shouldHoldForImport(scanImport()) without reading session meta', () => {
  const tree = makeTree();
  const { probeImportHold, scanImport, shouldHoldForImport } = require('./data-import');
  const probe = probeImportHold({ sourceHome: tree.source, destHome: tree.dest, agentsSkillsRoot: path.join(tree.root, 'no-agents') });
  assert.equal(probe.hold, true);
  assert.equal(probe.hold, shouldHoldForImport(scanImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
  })));

  fs.mkdirSync(path.join(tree.dest, 'sessions', 'proj', 'existing'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'sessions', 'proj', 'existing', 'session.jsonl'), '{"id":"x"}\n');
  const nonEmpty = probeImportHold({ sourceHome: tree.source, destHome: tree.dest, agentsSkillsRoot: path.join(tree.root, 'no-agents') });
  assert.equal(nonEmpty.destEmpty, false);
  assert.equal(nonEmpty.hold, false);
  fs.rmSync(tree.root, { recursive: true, force: true });

  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-bare-')));
  const emptySource = path.join(bare, 'official');
  const emptyDest = path.join(bare, 'desktop');
  fs.mkdirSync(emptySource, { recursive: true });
  setDesktopDshHome(emptyDest);
  const idle = probeImportHold({ sourceHome: emptySource, destHome: emptyDest, agentsSkillsRoot: path.join(bare, 'no-agents') });
  assert.equal(idle.destEmpty, true);
  assert.equal(idle.sourceHasData, false);
  assert.equal(idle.hold, false);

  fs.writeFileSync(path.join(emptySource, 'settings.yaml'), 'ui-theme:\n  preference: dark\n');
  const settingsOnly = probeImportHold({ sourceHome: emptySource, destHome: emptyDest, agentsSkillsRoot: path.join(bare, 'no-agents') });
  assert.equal(settingsOnly.hold, true, 'whitelisted settings alone hold the gate');
  fs.rmSync(bare, { recursive: true, force: true });
});

test('probeImportHold ignores preset fixture sessions and legacy-db-only sources', () => {
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-preset-')));
  const source = path.join(bare, 'official');
  const dest = path.join(bare, 'desktop');
  fs.mkdirSync(path.join(source, 'sessions', '_no-cwd', 'preset-demo'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', '_no-cwd', 'preset-demo', 'session.jsonl'), '{"id":"p"}\n');
  fs.mkdirSync(path.join(source, 'sessions', 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'legacy', 'chat.db'), 'sqlite');
  setDesktopDshHome(dest);
  const { probeImportHold } = require('./data-import');
  const probe = probeImportHold({ sourceHome: source, destHome: dest, agentsSkillsRoot: path.join(bare, 'no-agents') });
  assert.equal(probe.sourceHasData, false);
  assert.equal(probe.hold, false);
  fs.rmSync(bare, { recursive: true, force: true });
});

test('runImport skips MCP/skill conflicts unless overwrite, and rejects paths outside roots', async () => {
  const tree = makeTree();
  writeSkill(path.join(tree.source, 'skills'), 'alpha');
  fs.writeFileSync(path.join(tree.source, 'mcp-servers.yaml'), MCP_FIXTURE);
  fs.mkdirSync(path.join(tree.dest, 'skills', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md'), '# dest\n');
  fs.writeFileSync(path.join(tree.dest, 'mcp-servers.yaml'), `servers:
  - id: secret-mcp
    enabled: false
    url: https://dest.test
`);
  const { runImport } = require('./data-import');
  const skipped = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: [],
    selectedSkillIds: ['home:alpha'],
    selectedPluginNames: [],
    selectedMcpIds: ['secret-mcp'],
    importAttachments: false,
  });
  assert.equal(skipped.skills.find((row) => row.id === 'home:alpha').status, 'skipped');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md'), 'utf8'), '# dest\n');
  assert.match(fs.readFileSync(path.join(tree.dest, 'mcp-servers.yaml'), 'utf8'), /https:\/\/dest\.test/);

  const overwritten = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    overwrite: true,
    selectedRels: [],
    selectedSkillIds: ['home:alpha'],
    selectedPluginNames: [],
    selectedMcpIds: ['secret-mcp'],
    importAttachments: false,
  });
  assert.equal(overwritten.skills[0].status, 'copied');
  assert.match(fs.readFileSync(path.join(tree.dest, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /# alpha/);
  assert.match(fs.readFileSync(path.join(tree.dest, 'mcp-servers.yaml'), 'utf8'), /example\.test\/secure/);

  const escaped = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    extraSkillDirs: [path.join(tree.source, 'skills')],
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['../escape'],
    selectedSkillIds: ['extra:..'],
    selectedPluginNames: [],
    selectedMcpIds: [],
    importAttachments: false,
  });
  assert.equal(escaped.sessions[0].status, 'rejected');
  assert.equal(escaped.skills[0].status, 'rejected');
  assert.equal(fs.existsSync(path.join(tree.dest, 'escape')), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport reports per-phase progress through onProgress', async () => {
  const tree = makeTree();
  const events = [];
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a', 'proj/sess-b'],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: [],
    importAttachments: true,
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  const phases = events.map((event) => event.phase);
  assert.ok(phases.includes('sessions'), 'expected a sessions phase event');
  const sessionEvents = events.filter((event) => event.phase === 'sessions' && event.total === 2);
  assert.ok(sessionEvents.length >= 2, 'expected per-item session progress');
  const doneEvents = sessionEvents.map((event) => event.done).sort();
  assert.deepEqual([...new Set(doneEvents)], [1, 2]);
  assert.equal(events.at(-1).phase, 'done');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport honours AbortSignal between session copies and stays resumable', async () => {
  const tree = makeTree();
  const controller = new AbortController();
  let copies = 0;
  const { runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a', 'proj/sess-b'],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: [],
    importAttachments: true,
    signal: controller.signal,
    onProgress: (event) => {
      if (event.phase === 'sessions' && event.done === 1) {
        copies += 1;
        controller.abort();
      }
    },
  });
  assert.equal(copies, 1);
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-b')), false);
  const { readImportJournal } = require('./data-import');
  const journal = readImportJournal(tree.userData);
  assert.equal(journal.phase, 'copying', 'a cancelled import must stay recoverable like an interrupted one');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('a desktop home with v3 compressed sessions is not held for first-run import', () => {
  const tree = makeTree();
  const sessionDir = path.join(tree.dest, 'sessions', 'proj', 'existing');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'session.v3.jsonl.zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  const { probeImportHold, scanImport } = require('./data-import');
  const probe = probeImportHold({ sourceHome: tree.source, destHome: tree.dest });
  assert.deepEqual(probe, { destEmpty: false, sourceHasData: false, hold: false });
  assert.equal(scanImport({ sourceHome: tree.source, destHome: tree.dest }).destEmpty, false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('scanImport includes v3 sessions from a selected source', () => {
  const tree = makeTree();
  const source = path.join(tree.root, 'v3-only');
  const sessionDir = path.join(source, 'sessions', 'proj', 'new-format');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'session.v3.jsonl'), [
    JSON.stringify({ type: 'session', version: 3, id: 'v3-id', cwd: 'C:\\work', createdAt: 1_700_000_000_000 }),
    JSON.stringify({ type: 'session/title', data: { title: 'V3 title' } }),
    '',
  ].join('\n'));
  const { probeImportHold, scanImport } = require('./data-import');
  assert.equal(probeImportHold({ sourceHome: source, destHome: tree.dest, agentsSkillsRoot: path.join(tree.root, 'no-skills') }).hold, true);
  const scan = scanImport({ sourceHome: source, destHome: tree.dest, agentsSkillsRoot: path.join(tree.root, 'no-skills') });
  assert.equal(scan.sessions.length, 1);
  assert.equal(scan.sessions[0].id, 'v3-id');
  assert.equal(scan.sessions[0].title, 'V3 title');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport keeps the journal recoverable when cancelled after the final session copy', async () => {
  const tree = makeTree();
  const controller = new AbortController();
  const { readImportJournal, runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a'],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: [],
    importAttachments: true,
    signal: controller.signal,
    onProgress: (event) => {
      if (event.phase === 'sessions' && event.done === 1) {
        controller.abort();
      }
    },
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  assert.equal(readImportJournal(tree.userData).phase, 'copying');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport keeps the journal copying when cancelled in a later plugin stage', async () => {
  const tree = makeTree();
  const controller = new AbortController();
  const { readImportJournal, recoverInterruptedImport, runImport } = require('./data-import');
  let journalDuringPlugin = null;
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a'],
    selectedSkillIds: [],
    selectedPluginNames: ['good-plugin'],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: [],
    importAttachments: true,
    signal: controller.signal,
    installPlugin: async () => {
      // Sessions and attachments have fully committed; only later stages remain.
      journalDuringPlugin = readImportJournal(tree.userData);
      controller.abort();
      return { ok: true };
    },
  });
  assert.ok(journalDuringPlugin, 'the plugin stage must run after sessions complete');
  assert.equal(
    journalDuringPlugin.phase,
    'copying',
    'session completion must not commit done before later stages finish',
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  assert.equal(readImportJournal(tree.userData).phase, 'copying');

  const completedSession = path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl');
  assert.equal(fs.existsSync(completedSession), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'attachments', 'file.bin')), true);

  const staged = path.join(tree.dest, 'sessions', 'proj', 'sess-b.import-tmp');
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, 'session.jsonl'), 'partial');
  const recovery = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.blocked, true);
  assert.equal(readImportJournal(tree.userData).phase, 'blocked');
  assert.equal(fs.existsSync(staged), true);
  assert.equal(fs.existsSync(completedSession), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('a cancelled import leaves only completed sessions and a recoverable staging marker', async () => {
  const tree = makeTree();
  const controller = new AbortController();
  const { readImportJournal, recoverInterruptedImport, runImport } = require('./data-import');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    agentsSkillsRoot: path.join(tree.root, 'no-agents'),
    userDataDir: tree.userData,
    selectedRels: ['proj/sess-a', 'proj/sess-b'],
    selectedSkillIds: [],
    selectedPluginNames: [],
    selectedMcpIds: [],
    selectedSettingIds: [],
    selectedPresetIds: [],
    importAttachments: true,
    signal: controller.signal,
    onProgress: (event) => {
      if (event.phase === 'sessions' && event.done === 1) {
        controller.abort();
      }
    },
  });
  assert.equal(result.cancelled, true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-b')), false);
  assert.equal(readImportJournal(tree.userData).phase, 'copying');

  const staged = path.join(tree.dest, 'sessions', 'proj', 'sess-b.import-tmp');
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, 'session.jsonl'), 'partial');
  const recovery = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(recovery.recovered, true);
  // A bare unjournaled `.import-tmp` is preserved, not deleted: it may hold
  // the only surviving copy of user data after a crash in the old swap.
  assert.equal(recovery.blocked, true);
  assert.equal(readImportJournal(tree.userData).phase, 'blocked');
  assert.equal(fs.existsSync(staged), true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('recovery reconciles a journaled interrupted session copy', async () => {
  const tree = makeTree();
  const { readImportJournal, recoverInterruptedImport } = require('./data-import');
  const { writeFileSync, mkdirSync, writeFileSync: wf } = fs;
  mkdirSync(path.join(tree.dest, 'sessions'), { recursive: true });
  const dest = path.join(tree.dest, 'sessions', 'proj', 'sess-x');
  const opId = 'test-op-1';
  const tmp = `${dest}.import-tmp-${opId}`;
  const bak = `${dest}.import-bak-${opId}`;
  const txn = `${dest}.import-txn-${opId}`;
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(tmp, 'session.jsonl'), 'staged');
  writeFileSync(txn, JSON.stringify({ version: 1, opId, dest, tmp, bak, state: 'staged' }));
  // Journal must be in 'copying' for recoverInterruptedImport to act, and
  // the opId must be registered in the importer-owned inventory (bound to
  // its destination) for the discovered sidecar to be executed — an
  // unregistered/legacy journal preserves the record instead.
  writeFileSync(path.join(tree.userData, 'import-journal.json'), JSON.stringify({
    phase: 'copying', sourceHome: tree.source, destHome: tree.dest,
    txnIds: [opId], txnDests: { [opId]: dest },
  }));
  const outcome = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(outcome.recovered, true);
  assert.equal(outcome.blocked, false);
  assert.equal(fs.existsSync(tmp), false);
  assert.equal(fs.existsSync(txn), false);
  assert.equal(readImportJournal(tree.userData).phase, 'recovered');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('importSessions reuses a provided scan instead of rescanning the source', async () => {
  const tree = makeTree();
  const { importSessions } = require('./data-import');
  const fakeScan = {
    sourceHome: tree.source,
    destHome: tree.dest,
    sessions: [
      {
        rel: 'proj/sess-a',
        abs: path.join(tree.source, 'sessions', 'proj', 'sess-a'),
        unsupported: false,
        conflict: false,
      },
    ],
  };
  const result = await importSessions({
    scan: fakeScan,
    sourceHome: path.join(tree.root, 'does-not-exist'),
    destHome: tree.dest,
    selectedRels: ['proj/sess-a'],
    userDataDir: tree.userData,
    importAttachments: false,
  });
  assert.equal(result.sessions[0].status, 'copied');
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a', 'session.jsonl')), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport refuses ambiguous skills in preflight with zero writes across all categories', async () => {
  const tree = makeTree();
  const { runImport } = require('./data-import');
  const agents = path.join(tree.root, 'agents-skills');
  writeSkill(path.join(tree.source, 'skills'), 'dup');
  writeSkill(agents, 'dup');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    userDataDir: tree.userData,
    agentsSkillsRoot: agents,
    selectedRels: ['proj/sess-a'],
    selectedSkillIds: ['home:dup', 'agents:dup'],
    importAttachments: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ambiguous-destination');
  // Zero writes anywhere — sessions and attachments must not have landed even
  // though they were selected and would individually have succeeded.
  assert.equal(fs.existsSync(path.join(tree.dest, 'sessions', 'proj', 'sess-a')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'attachments', 'file.bin')), false);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'dup')), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('runImport dedupes a repeated skill id before ambiguity grouping', async () => {
  const tree = makeTree();
  const { runImport } = require('./data-import');
  writeSkill(path.join(tree.source, 'skills'), 'solo');
  const result = await runImport({
    sourceHome: tree.source,
    destHome: tree.dest,
    userDataDir: tree.userData,
    selectedSkillIds: ['home:solo', 'home:solo', 'home:solo'],
  });
  // The same source id repeated must not be treated as an ambiguous collision.
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(tree.dest, 'skills', 'solo')), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('journal validation refuses missing destHome / unsupported phase / malformed inventory', () => {
  const tree = makeTree();
  const { readImportJournal, journalIsBlocked, recoverInterruptedImport } = require('./data-import');
  const journalFile = path.join(tree.userData, 'import-journal.json');
  const cases = [
    { name: 'missing destHome', body: { phase: 'copying' } },
    { name: 'unsupported phase', body: { phase: 'migrating', destHome: tree.dest } },
    { name: 'malformed inventory (non-array)', body: { phase: 'copying', destHome: tree.dest, txnIds: 'op-1' } },
    { name: 'malformed inventory (non-string id)', body: { phase: 'copying', destHome: tree.dest, txnIds: [42] } },
  ];
  for (const { name, body } of cases) {
    fs.writeFileSync(journalFile, JSON.stringify(body));
    const journal = readImportJournal(tree.userData);
    // Manual admission (journalIsBlocked) and cold recovery
    // (recoverInterruptedImport -> blocked) must agree on the SAME verdict
    // for every invalid shape — a present-but-unusable record holds the app.
    assert.equal(journal.unreadable, true, `${name} should read as unreadable`);
    assert.equal(journalIsBlocked(journal), true, `${name} should block manual admission`);
    const outcome = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
    assert.equal(outcome.blocked, true, `${name} should hold cold recovery`);
    assert.equal(outcome.recovered, false, `${name} must not report recovered`);
  }
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('a valid journal and a missing file remain authorized controls', () => {
  const tree = makeTree();
  const { readImportJournal, journalIsBlocked, recoverInterruptedImport } = require('./data-import');
  // Missing file: absence, not blocked.
  assert.equal(readImportJournal(tree.userData), null);
  const missing = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(missing.blocked, undefined);
  // A valid journal is read and does not block.
  fs.writeFileSync(path.join(tree.userData, 'import-journal.json'), JSON.stringify({
    phase: 'done', sourceHome: tree.source, destHome: tree.dest,
  }));
  const journal = readImportJournal(tree.userData);
  assert.equal(journal.unreadable, undefined);
  assert.equal(journalIsBlocked(journal), false);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('field-less legacy journal preserves discovered sidecars without executing them', () => {
  const tree = makeTree();
  const { recoverInterruptedImport } = require('./data-import');
  fs.mkdirSync(path.join(tree.dest, 'sessions'), { recursive: true });
  const dest = path.join(tree.dest, 'sessions', 'proj', 'sess-x');
  const opId = 'payload-op';
  const tmp = `${dest}.import-tmp-${opId}`;
  const bak = `${dest}.import-bak-${opId}`;
  const txn = `${dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'session.jsonl'), 'payload');
  // A payload-dropped, correctly named sidecar with internally consistent
  // paths — but the legacy journal has NO txnIds inventory field.
  fs.writeFileSync(txn, JSON.stringify({ version: 1, opId, dest, tmp, bak, state: 'staged' }));
  fs.writeFileSync(path.join(tree.userData, 'import-journal.json'), JSON.stringify({
    phase: 'copying', sourceHome: tree.source, destHome: tree.dest,
  }));
  const outcome = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  // Unowned records must never mutate data: the staged copy, the journal
  // file, and the blocked verdict all persist intact.
  assert.equal(outcome.blocked, true);
  assert.equal(fs.existsSync(tmp), true, 'unowned staged copy must remain intact');
  assert.equal(fs.existsSync(txn), true, 'unowned sidecar must not be consumed');
  assert.equal(fs.existsSync(path.join(tmp, 'session.jsonl')), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('a registered opId presented for the wrong destination is refused', () => {
  const tree = makeTree();
  const { recoverInterruptedImport } = require('./data-import');
  fs.mkdirSync(path.join(tree.dest, 'sessions'), { recursive: true });
  const dest = path.join(tree.dest, 'sessions', 'proj', 'sess-x');
  const opId = 'bound-op';
  const tmp = `${dest}.import-tmp-${opId}`;
  const bak = `${dest}.import-bak-${opId}`;
  const txn = `${dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'session.jsonl'), 'staged');
  fs.writeFileSync(txn, JSON.stringify({ version: 1, opId, dest, tmp, bak, state: 'staged' }));
  // The opId IS registered — but bound to a DIFFERENT destination. The same
  // ID presented for this tree must not authorize the sidecar.
  fs.writeFileSync(path.join(tree.userData, 'import-journal.json'), JSON.stringify({
    phase: 'copying', sourceHome: tree.source, destHome: tree.dest,
    txnIds: [opId], txnDests: { [opId]: path.join(tree.dest, 'other-target') },
  }));
  const outcome = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(outcome.blocked, true);
  assert.equal(fs.existsSync(tmp), true, 'unbound-destination sidecar preserved');
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('a registered opId with no destination binding is preserved, not executed', () => {
  const tree = makeTree();
  const { recoverInterruptedImport } = require('./data-import');
  fs.mkdirSync(path.join(tree.dest, 'sessions'), { recursive: true });
  const dest = path.join(tree.dest, 'sessions', 'proj', 'sess-x');
  const opId = 'id-only-op';
  const tmp = `${dest}.import-tmp-${opId}`;
  const bak = `${dest}.import-bak-${opId}`;
  const txn = `${dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'session.jsonl'), 'staged');
  fs.writeFileSync(txn, JSON.stringify({ version: 1, opId, dest, tmp, bak, state: 'staged' }));
  // ID-only legacy inventory: txnIds registers the op but txnDests is absent
  // — an ID alone must not silently gain destination authority.
  fs.writeFileSync(path.join(tree.userData, 'import-journal.json'), JSON.stringify({
    phase: 'copying', sourceHome: tree.source, destHome: tree.dest, txnIds: [opId],
  }));
  const outcome = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
  assert.equal(outcome.blocked, true);
  assert.equal(fs.existsSync(tmp), true, 'ID-only sidecar must remain intact');
  assert.equal(fs.existsSync(txn), true);
  fs.rmSync(tree.root, { recursive: true, force: true });
});

test('registered opId with empty map / missing key / non-string binding is preserved', () => {
  const variants = [
    { name: 'empty map', txnDests: {} },
    { name: 'missing key', txnDests: { 'other-op': '/x' } },
    { name: 'non-string value', txnDests: { 'bound-op': 42 } },
  ];
  for (const { name, txnDests } of variants) {
    const tree = makeTree();
    const { recoverInterruptedImport } = require('./data-import');
    fs.mkdirSync(path.join(tree.dest, 'sessions'), { recursive: true });
    const dest = path.join(tree.dest, 'sessions', 'proj', 'sess-x');
    const opId = 'bound-op';
    const tmp = `${dest}.import-tmp-${opId}`;
    const bak = `${dest}.import-bak-${opId}`;
    const txn = `${dest}.import-txn-${opId}`;
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'session.jsonl'), 'staged');
    fs.writeFileSync(txn, JSON.stringify({ version: 1, opId, dest, tmp, bak, state: 'staged' }));
    fs.writeFileSync(path.join(tree.userData, 'import-journal.json'), JSON.stringify({
      phase: 'copying', sourceHome: tree.source, destHome: tree.dest,
      txnIds: [opId], txnDests,
    }));
    const outcome = recoverInterruptedImport({ userDataDir: tree.userData, destHome: tree.dest });
    assert.equal(outcome.blocked, true, `${name}: should hold`);
    assert.equal(fs.existsSync(tmp), true, `${name}: staging preserved`);
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

test('attachment merge aborts on staged-dir inspection failure without publishing', async () => {
  const tree = makeTree();
  const { importSessions } = require('./data-import');
  // Destination attachments hold a destination-only file; source has a
  // conflicting file. Staging unites them, then an inspection error on the
  // staged directory must abort the merge — never rm the staged dir and
  // never publish a tree missing the destination-only bytes.
  fs.mkdirSync(path.join(tree.dest, 'attachments', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(tree.dest, 'attachments', 'sub', 'dest-only.txt'), 'must-survive');
  fs.writeFileSync(path.join(tree.dest, 'attachments', 'sub', 'conflict.txt'), 'dest-version');
  fs.mkdirSync(path.join(tree.source, 'attachments', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(tree.source, 'attachments', 'sub', 'conflict.txt'), 'src-version');
  const original = fs.lstatSync;
  let injected = 0;
  fs.lstatSync = (p) => {
    // Narrow the injection to the staged conflicting directory only — a
    // catch-all '.import-tmp-' filter could let an unrelated early throw
    // satisfy the failure assertion without exercising the overlay path.
    if (String(p).includes('attachments.import-tmp-') && String(p).endsWith('sub')) {
      injected += 1;
      const err = new Error('EACCES simulated inspection failure');
      err.code = 'EACCES';
      throw err;
    }
    return original(p);
  };
  let result;
  let threw = null;
  try {
    result = await importSessions({
      sourceHome: tree.source, destHome: tree.dest,
      selectedRels: [], userDataDir: tree.userData,
      importAttachments: true, overwrite: true,
    });
  } catch (error) {
    threw = error;
  } finally {
    fs.lstatSync = original;
  }
  // The expected attachment failure surfaces as `failed:<reason>` on the
  // attachments channel (importSessions records stage failures there rather
  // than always rejecting). Either a rejected import OR a result whose
  // attachments carry the inspection failure counts as the aborted merge —
  // but NOT a generic unrelated exception, which is why we assert the
  // specific reason and that the injection actually fired.
  const attachmentFailed = (threw && /overlay-inspection-failed|EACCES/.test(String(threw.message)))
    || (result && typeof result.attachments === 'string' && /failed:.*(overlay-inspection-failed|EACCES)/.test(result.attachments));
  assert.equal(attachmentFailed, true, 'expected the staged-dir inspection failure reason');
  assert.equal(injected > 0, true, 'the injection actually fired on the staged dir');
  // The merge aborted — it did not publish an incomplete tree.
  assert.equal((result && result.ok) === true, false, 'inspection failure must not report a successful merge');
  // The live destination is untouched: destination-only bytes and the
  // original conflict bytes both survive exactly.
  assert.equal(fs.readFileSync(path.join(tree.dest, 'attachments', 'sub', 'dest-only.txt'), 'utf8'), 'must-survive');
  assert.equal(fs.readFileSync(path.join(tree.dest, 'attachments', 'sub', 'conflict.txt'), 'utf8'), 'dest-version');
  // The source bytes are equally untouched — the abort did not mutate the
  // source side either.
  assert.equal(fs.readFileSync(path.join(tree.source, 'attachments', 'sub', 'conflict.txt'), 'utf8'), 'src-version');
  // No published tree may exist under a tmp name: staging was aborted, not
  // renamed over the destination.
  assert.equal(fs.readdirSync(tree.dest).some((n) => n.includes('.import-tmp-') && n.includes('attachments')), false, 'no staged tree may be published');
  fs.rmSync(tree.root, { recursive: true, force: true });
});
