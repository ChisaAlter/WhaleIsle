import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInitialState, assessScenario, cleanupState, measureUnlockResume, parseCliArgs } from './measure-whale-cdp.mjs';

test('assessScenario rejects sleep regression to 50ms while proving old 110/50 formula was >2x too loose', () => {
  const seconds = 60;
  const oldFormulaLimit = Math.ceil((seconds * 1000) / 110) + 5;
  const newSleepLimit = Math.ceil((seconds * 1000) / 250) + 5;
  assert.ok(oldFormulaLimit >= newSleepLimit * 2, 'legacy 110ms formula gave >2x slack over 250ms sleep budget');

  // Regression sample: sleeping=true yet inferGapMs reverted to 50ms
  const regressed = assessScenario({
    scenario: 'sleep',
    seconds,
    liveEngine: true,
    states: [
      { sleeping: true, inferGapMs: 50, painted: true, bodyVisible: true, inferenceCount: 0 },
      { sleeping: true, inferGapMs: 50, painted: true, bodyVisible: true, inferenceCount: 900 },
    ],
    effective: { inferGapMs: 50 },
    timings: { frameProduction: { count: 220 }, inferenceBusy: { count: 0 } },
    counts: { inferenceError: 0 },
  });
  assert.equal(regressed.scenarioStable, false);
  assert.equal(regressed.validScenario, false);
  assert.equal(regressed.expectedInferGapMs, 250);

  // Over-attempt sleep even when gap reports 250
  const tooManyAttempts = assessScenario({
    scenario: 'sleep',
    seconds,
    liveEngine: true,
    states: [
      { sleeping: true, inferGapMs: 250, painted: true, bodyVisible: true, inferenceCount: 0 },
      { sleeping: true, inferGapMs: 250, painted: true, bodyVisible: true, inferenceCount: 250 },
    ],
    effective: { inferGapMs: 250 },
    timings: { frameProduction: { count: 240 }, inferenceBusy: { count: 20 } },
    counts: { inferenceError: 0 },
  });
  assert.equal(tooManyAttempts.validScenario, false);

  // Healthy sleep within [2.5, 4.5] fps and <=245 attempts
  const validSleep = assessScenario({
    scenario: 'sleep',
    seconds,
    liveEngine: true,
    states: [
      { sleeping: true, inferGapMs: 250, painted: true, bodyVisible: true, inferenceCount: 0 },
      { sleeping: true, inferGapMs: 250, painted: true, bodyVisible: true, inferenceCount: 228 },
    ],
    effective: { inferGapMs: 250 },
    timings: { frameProduction: { count: 228 }, inferenceBusy: { count: 2 } },
    counts: { inferenceError: 0 },
    idleCursorSends: 60,
  });
  assert.equal(validSleep.scenarioStable, true);
  assert.equal(validSleep.validScenario, true);
});

test('assessScenario validates power-paused, power-save and normal Work-Done Oracles', () => {
  const pausedZero = assessScenario({
    scenario: 'power-paused',
    seconds: 30,
    liveEngine: true,
    states: [{ sleeping: false, inferGapMs: 50, painted: true, bodyVisible: true, inferenceCount: 0 }],
    timings: { frameProduction: { count: 0 }, inferenceBusy: { count: 0 }, displayRefresh: { count: 0 } },
    counts: { inferenceError: 0 },
    cursorSends: 0,
    resumeMs: 120,
  });
  assert.equal(pausedZero.validScenario, true);
  assert.equal(pausedZero.oracle.status, 'pass');

  assert.equal(assessScenario({
    scenario: 'power-paused',
    seconds: 30,
    liveEngine: true,
    states: [{ sleeping: false, inferGapMs: 50, painted: true, bodyVisible: true }],
    timings: { frameProduction: { count: 3 }, inferenceBusy: { count: 0 }, displayRefresh: { count: 0 } },
    counts: { inferenceError: 0 },
    cursorSends: 0,
    resumeMs: 120,
  }).validScenario, false);

  assert.equal(assessScenario({
    scenario: 'power-paused',
    seconds: 30,
    liveEngine: true,
    states: [{ sleeping: false, inferGapMs: 50, painted: true, bodyVisible: true }],
    timings: { frameProduction: { count: 0 }, inferenceBusy: { count: 0 }, displayRefresh: { count: 0 } },
    counts: { inferenceError: 0 },
    cursorSends: 1,
    resumeMs: 120,
  }).validScenario, false);

  assert.equal(assessScenario({
    scenario: 'power-paused',
    seconds: 30,
    liveEngine: true,
    states: [{ sleeping: false, inferGapMs: 50, painted: true, bodyVisible: true }],
    timings: { frameProduction: { count: 0 }, inferenceBusy: { count: 0 }, displayRefresh: { count: 0 } },
    counts: { inferenceError: 0 },
    cursorSends: 0,
    resumeMs: 3500,
  }).validScenario, false);

  const slowNormal = assessScenario({
    scenario: 'normal',
    seconds: 10,
    liveEngine: true,
    states: [
      { sleeping: false, inferGapMs: 50, painted: true, bodyVisible: true, inferenceCount: 0 },
      { sleeping: false, inferGapMs: 50, painted: true, bodyVisible: true, inferenceCount: 80 },
    ],
    effective: { inferGapMs: 50 },
    timings: { frameProduction: { count: 80 }, inferenceBusy: { count: 0 } },
    counts: { inferenceError: 0 },
  });
  assert.equal(slowNormal.validScenario, false);
  assert.equal(slowNormal.oracle.invalidReason, 'INVALID: machine-too-slow');

  const powerSave = assessScenario({
    scenario: 'power-save',
    seconds: 10,
    liveEngine: true,
    states: [
      { sleeping: false, inferGapMs: 110, painted: true, bodyVisible: true, inferenceCount: 0 },
      { sleeping: false, inferGapMs: 110, painted: true, bodyVisible: true, inferenceCount: 80 },
    ],
    effective: { inferGapMs: 110 },
    timings: { frameProduction: { count: 80 }, inferenceBusy: { count: 5 } },
    counts: { inferenceError: 0 },
  });
  assert.equal(powerSave.validScenario, true);
  assert.equal(parseCliArgs(['9223', '30', '', 'power-paused', '--main-inspect', '9229']).mainInspectPort, 9229);
});

test('power-save state restores prior lastInteract/powerSave and cleanup emits unlock-screen when measureUnlockResume fails early', async () => {
  const petCalls = [];
  const fakePet = {
    socket: { close() { petCalls.push('pet-closed'); } },
    async evaluate(expr) {
      petCalls.push(expr);
      if (expr === 'sleeping' || expr === 'Boolean(panel)') return false;
      if (expr.includes('lastInteract: idle.lastInteract')) return { lastInteract: 4321, powerSave: false };
      if (expr === 'window.__dshdPetPerf.start()') throw new Error('start boom');
      return null;
    },
  };
  const initial = await applyInitialState(fakePet, parseCliArgs(['9223', '5', '', 'power-save']));
  assert.deepEqual(initial.prevPowerSave, { lastInteract: 4321, powerSave: false });
  await cleanupState(fakePet, null, {
    scenario: 'power-save',
    wasSleeping: false,
    wasPanelOpen: false,
    overridesApplied: false,
    perfStarted: false,
    powerPausedActive: false,
    prevPowerSave: initial.prevPowerSave,
  });
  assert.ok(petCalls.includes('idle.lastInteract = 4321; settings.powerSave = false;'));

  const mainCalls = [];
  const fakeMain = {
    socket: { close() { mainCalls.push('main-closed'); } },
    async evaluate(expr) { mainCalls.push(expr); return null; },
  };
  const pausedState = {
    scenario: 'power-paused',
    wasSleeping: false,
    wasPanelOpen: false,
    overridesApplied: false,
    perfStarted: false,
    powerPausedActive: true,
    prevPowerSave: null,
  };
  await assert.rejects(
    () => measureUnlockResume(fakePet, fakeMain, () => { pausedState.powerPausedActive = false; }),
    /start boom/,
  );
  assert.equal(pausedState.powerPausedActive, true);
  await cleanupState(fakePet, fakeMain, pausedState);
  assert.ok(mainCalls.some((c) => c.includes("emit('unlock-screen')")));
});
