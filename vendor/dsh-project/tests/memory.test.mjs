import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService } from './harness-runtime.mjs';
import { memoryIndex } from '../lib/memory.js';

function makeTempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-proj-mem-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('per-topic shared memory: write, concurrent append locks, index generation, search, stale filtering, and read-only MEMORY.md', async (t) => {
  const home = makeTempHome(t);
  const service = new ProjectService({ get: () => undefined }, { home });
  t.after(() => service.dispose());

  const project = await service.createProject({ name: 'MemProj' });

  // Concurrent appends to the same topic file must all survive
  await Promise.all(
    Array.from({ length: 8 }, (_, idx) =>
      service.memory.appendMemoryFile(project.id, {
        name: 'architecture',
        description: 'System architecture notes',
        text: `Finding #${idx + 1}`,
      }),
    ),
  );

  // Concurrent writes to different topics must all land in MEMORY.md
  await Promise.all([
    service.memory.writeMemoryFile(project.id, {
      name: 'api-contract',
      description: 'REST & SSE contract',
      text: 'SSE pushes event: update on every mutation.',
    }),
    service.memory.writeMemoryFile(project.id, {
      name: 'old-decision-superseded',
      description: '[superseded] Legacy RPC notes',
      text: 'Do not use /dsh-project.',
    }),
  ]);

  const files = await service.memory.readMemoryFiles(project.id);
  assert.equal(files.length, 3);
  const arch = files.find((f) => f.name === 'architecture');
  for (let i = 1; i <= 8; i += 1) {
    assert.ok(arch.body.includes(`Finding #${i}`), `missing Finding #${i}`);
  }

  // Generated MEMORY.md exists and lists live topics
  const idxFile = await service.memory.readMemoryIndexFile(project.id);
  assert.ok(idxFile);
  assert.equal(idxFile.readOnly, true);
  assert.match(idxFile.text, /architecture/);
  assert.match(idxFile.text, /api-contract/);

  // MEMORY.md is strictly read-only
  await assert.rejects(
    () => service.memory.writeMemoryFile(project.id, { name: 'MEMORY.md', text: 'hack' }),
    /read-only/i,
  );
  await assert.rejects(
    () => service.memory.deleteMemoryFile(project.id, 'MEMORY.md'),
    /read-only/i,
  );

  // Stale files are hidden from worker index & search, but still readable by name
  const workerIdx = memoryIndex(files, 4000);
  assert.ok(!workerIdx.includes('old-decision-superseded'));
  const foundStale = await service.memory.readMemoryFile(project.id, 'old-decision-superseded');
  assert.ok(foundStale);
  assert.match(foundStale.file.body, /Do not use/);

  // Delete topic file updates MEMORY.md
  await service.memory.deleteMemoryFile(project.id, 'api-contract');
  const afterDelete = await service.memory.readMemoryFiles(project.id);
  assert.equal(afterDelete.length, 2);
});

test('4-level deterministic index degradation keeps prompt strictly within cap', () => {
  const files = Array.from({ length: 60 }, (_, idx) => ({
    name: `topic-module-documentation-file-${String(idx + 1).padStart(2, '0')}`,
    description: 'Detailed explanation of design constraints and integration verification steps for this component',
    modified: '2026-11-21T00:00:00.000Z',
    chars: 1200,
    stale: false,
  }));

  const full = memoryIndex(files, 100_000);
  assert.ok(full.includes('Detailed explanation'));

  const noDesc = memoryIndex(files, 4_500);
  assert.ok(noDesc.length <= 4_500);
  assert.match(noDesc, /Descriptions omitted/);

  const titlesOnly = memoryIndex(files, 2_700);
  assert.ok(titlesOnly.length <= 2_700);
  assert.match(titlesOnly, /Titles only/);

  const truncated = memoryIndex(files, 900);
  assert.ok(truncated.length <= 900);
  assert.match(truncated, /truncated to fit/);
  assert.match(truncated, /more file\(s\) not listed/);
});

test('auto-compaction archives oldest whole files down to 60% budget and preserves readability', async (t) => {
  const home = makeTempHome(t);
  const service = new ProjectService({ get: () => undefined }, { home });
  t.after(() => service.dispose());

  const project = await service.createProject({
    name: 'CompactProj',
    memoryBudget: 4_000,
    autoCompact: true,
  });

  // Write 4 topic files of 1,200 chars each (total 4,800 > 4,000 budget, target 2,400)
  for (let i = 1; i <= 3; i += 1) {
    await service.memory.writeMemoryFile(project.id, {
      name: `topic-${i}`,
      text: `Topic ${i}: ${'x'.repeat(1_180)}`,
    });
  }
  const written4 = await service.memory.writeMemoryFile(project.id, {
    name: 'topic-4',
    text: `Topic 4: ${'y'.repeat(1_180)}`,
  });
  const note = await service.memory.afterMemoryWrite(project, written4);
  assert.match(note, /Auto-compacted/);

  const live = await service.memory.readMemoryFiles(project.id);
  const archived = await service.memory.listArchiveFiles(project.id);
  assert.ok(live.length >= 1 && live.length <= 2);
  assert.ok(archived.length >= 2);
  assert.ok(live.some((f) => f.name === 'topic-4'), 'newest file always stays live');

  // Archived oldest topic is still readable via readMemoryFile
  const readArchived = await service.memory.readMemoryFile(project.id, 'topic-1');
  assert.ok(readArchived);
  assert.equal(readArchived.archived, true);
  assert.match(readArchived.file.body, /Topic 1:/);

  // Project recorded lastCompaction
  const updated = await service.readProject(project.id);
  assert.ok(updated.lastCompaction);
  assert.ok(updated.lastCompaction.archived >= 2);
});

test('legacy memory.md migrates idempotently to topic files and preserves memory.bak.md', async (t) => {
  const home = makeTempHome(t);
  const service = new ProjectService({ get: () => undefined }, { home });
  t.after(() => service.dispose());

  const project = await service.createProject({ name: 'LegacyMem' });
  const projDir = service.store.projectDir(project.id);
  fs.writeFileSync(
    path.join(projDir, 'memory.md'),
    'Intro note\n\n## 2026-10-01 Database\nUse SQLite WAL.\n\n## 2026-10-02 Deployment\nUse atomic swap.\n',
    'utf8',
  );

  const files = await service.memory.readMemoryFiles(project.id);
  assert.equal(files.length, 3);
  assert.ok(fs.existsSync(path.join(projDir, 'memory.bak.md')));
  assert.ok(!fs.existsSync(path.join(projDir, 'memory.md')));
  assert.ok(files.some((f) => f.body.includes('Use SQLite WAL.')));
  assert.ok(files.some((f) => f.body.includes('Use atomic swap.')));
});
