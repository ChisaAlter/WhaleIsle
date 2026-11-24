'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  VOICE_STATES,
  BARGE_IN_BUDGET_MS,
  reconcileSpokenText,
  createPetVoiceSession,
  createLive2dVoiceBridge,
} = require('./pet-voice-session');
const { createLive2dPetManager, PET_WIDTH, PET_HEIGHT } = require('./desktop-live2d');

function makeAdapters(overrides = {}) {
  const calls = {
    asrStarts: 0,
    asrStops: 0,
    ttsStops: 0,
    llmAborted: false,
    ttsAborted: false,
  };
  let asrCallbacks = null;
  let resolveLlm = null;
  let resolveTts = null;
  let ttsProgress = null;

  const asr = {
    isAvailable: () => true,
    startListening(opts) {
      calls.asrStarts += 1;
      asrCallbacks = opts;
    },
    stopListening() {
      calls.asrStops += 1;
    },
    ...(overrides.asr || {}),
  };

  const llm = {
    generate(transcript, { signal }) {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          calls.llmAborted = true;
          reject(new Error('aborted'));
        }, { once: true });
        resolveLlm = (value) => resolve(value);
        if (overrides.autoLlmReply !== undefined) {
          queueMicrotask(() => resolve(overrides.autoLlmReply));
        }
      });
    },
    ...(overrides.llm || {}),
  };

  const tts = {
    isAvailable: () => true,
    speak(text, { signal, onProgress }) {
      ttsProgress = onProgress;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          calls.ttsAborted = true;
          reject(new Error('tts_aborted'));
        }, { once: true });
        resolveTts = () => resolve();
        if (overrides.autoTtsFinish) {
          queueMicrotask(() => {
            onProgress?.(text);
            resolve();
          });
        }
      });
    },
    stop() {
      calls.ttsStops += 1;
    },
    ...(overrides.tts || {}),
  };

  return {
    calls,
    asr,
    llm,
    tts,
    getAsrCallbacks: () => asrCallbacks,
    resolveLlm: (val) => resolveLlm?.(val),
    resolveTts: () => resolveTts?.(),
    emitTtsProgress: (progress) => ttsProgress?.(progress),
  };
}

describe('pet voice session state machine', () => {
  test('returns voice_unavailable cleanly when microphone or adapters are unavailable', async () => {
    const empty = createPetVoiceSession();
    assert.equal(empty.isAvailable(), false);
    assert.equal(empty.getState().reason, 'voice_unavailable');
    assert.deepEqual(empty.toggle(true), {
      ok: false,
      reason: 'voice_unavailable',
      enabled: false,
      state: VOICE_STATES.IDLE,
    });
    assert.equal(empty.startListening().reason, 'voice_unavailable');
    assert.equal((await empty.submitTranscript('hello')).reason, 'voice_unavailable');

    const adapters = makeAdapters();
    const noMic = createPetVoiceSession({
      asr: adapters.asr,
      tts: adapters.tts,
      hasMicrophone: () => false,
    });
    assert.equal(noMic.isAvailable(), false);
    assert.equal(noMic.toggle(true).reason, 'voice_unavailable');

    const noEndpoint = createPetVoiceSession({
      asr: adapters.asr,
      tts: adapters.tts,
      endpointAvailable: false,
    });
    assert.equal(noEndpoint.isAvailable(), false);
    assert.equal(noEndpoint.startListening().reason, 'voice_unavailable');
  });

  test('transitions cleanly through idle -> listening -> thinking -> speaking -> idle', async () => {
    const adapters = makeAdapters({
      autoLlmReply: '你好，我已经帮你整理好今日战报。',
      autoTtsFinish: true,
    });
    const seenStates = [];
    const session = createPetVoiceSession({
      asr: adapters.asr,
      llm: adapters.llm,
      tts: adapters.tts,
      onStateChange: (snap) => seenStates.push(snap.state),
    });

    assert.equal(session.getState().state, VOICE_STATES.IDLE);
    assert.equal(session.toggle(true).ok, true);
    assert.equal(session.startListening().state, VOICE_STATES.LISTENING);

    const turnResult = await session.submitTranscript('汇报一下今天进展');
    assert.equal(turnResult.ok, true);
    assert.equal(turnResult.replyText, '你好，我已经帮你整理好今日战报。');
    assert.equal(session.getState().state, VOICE_STATES.IDLE);
    assert.deepEqual(
      seenStates.filter((s, idx) => idx === 0 || s !== seenStates[idx - 1]),
      [
        VOICE_STATES.IDLE,
        VOICE_STATES.LISTENING,
        VOICE_STATES.THINKING,
        VOICE_STATES.SPEAKING,
        VOICE_STATES.IDLE,
      ],
    );
  });

  test('interrupt() during thinking aborts in-flight LLM via AbortController in <50ms', async () => {
    const adapters = makeAdapters();
    const session = createPetVoiceSession({
      asr: adapters.asr,
      llm: adapters.llm,
      tts: adapters.tts,
    });

    const pending = session.submitTranscript('分析下最近的错误日志');
    await Promise.resolve();
    assert.equal(session.getState().state, VOICE_STATES.THINKING);

    const cut = session.interrupt({ resumeListening: true });
    assert.equal(cut.ok, true);
    assert.equal(cut.interrupted, true);
    assert.equal(cut.previousState, VOICE_STATES.THINKING);
    assert.equal(cut.state, VOICE_STATES.LISTENING);
    assert.ok(cut.latencyMs < BARGE_IN_BUDGET_MS, `barge-in took ${cut.latencyMs}ms`);
    assert.equal(cut.withinBudget, true);
    assert.equal(adapters.calls.llmAborted, true);

    const outcome = await pending;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.interrupted, true);
    session.dispose();
  });

  test('interrupt() during speaking stops TTS immediately in <50ms and reconciles spoken vs. unspoken text', async () => {
    const adapters = makeAdapters();
    const session = createPetVoiceSession({
      asr: adapters.asr,
      llm: adapters.llm,
      tts: adapters.tts,
    });

    const fullReply = '第一段已经播报完成。第二段还未播报的内容需要保留对账。';
    const pending = session.submitTranscript('读出完整方案');
    await Promise.resolve();
    adapters.resolveLlm(fullReply);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(session.getState().state, VOICE_STATES.SPEAKING);

    // Simulate TTS playback progress before barge-in
    adapters.emitTtsProgress({ spokenText: '第一段已经播报完成。' });

    const cut = session.interrupt({ resumeListening: true });
    assert.equal(cut.ok, true);
    assert.equal(cut.interrupted, true);
    assert.equal(cut.previousState, VOICE_STATES.SPEAKING);
    assert.equal(cut.state, VOICE_STATES.LISTENING);
    assert.ok(cut.latencyMs < BARGE_IN_BUDGET_MS, `barge-in took ${cut.latencyMs}ms`);
    assert.equal(adapters.calls.ttsStops >= 1, true);
    assert.equal(adapters.calls.ttsAborted, true);
    assert.ok(cut.reconciliation);
    assert.equal(cut.reconciliation.fullText, fullReply);
    assert.equal(cut.reconciliation.spokenText, '第一段已经播报完成。');
    assert.equal(cut.reconciliation.unspokenText, '第二段还未播报的内容需要保留对账。');

    const outcome = await pending;
    assert.equal(outcome.interrupted, true);
    assert.equal(session.getState().lastReconciliation?.unspokenText, '第二段还未播报的内容需要保留对账。');
    session.dispose();
  });

  test('reconcileSpokenText handles char offsets and substring matches cleanly', () => {
    assert.deepEqual(
      reconcileSpokenText('abcdef', { spokenChars: 2 }),
      { fullText: 'abcdef', spokenText: 'ab', unspokenText: 'cdef' },
    );
    assert.deepEqual(
      reconcileSpokenText('hello world', { spokenText: 'hello ' }),
      { fullText: 'hello world', spokenText: 'hello ', unspokenText: 'world' },
    );
  });

  test('bridges voice state transitions to desktop-live2d over shell:live2d-dsh without disrupting overlay', async () => {
    const sent = [];
    const adapters = makeAdapters({ autoLlmReply: '收到', autoTtsFinish: true });
    const bridge = createLive2dVoiceBridge({
      voiceOptions: { asr: adapters.asr, llm: adapters.llm, tts: adapters.tts },
      sendDshEvent: (ev) => sent.push(ev),
    });
    bridge.pushCurrentState();
    assert.equal(sent.at(-1)?.type, 'voiceState');
    assert.equal(sent.at(-1)?.voice?.state, VOICE_STATES.IDLE);
    bridge.toggle(true);
    assert.equal(sent.at(-1)?.voice?.enabled, true);
    bridge.dispose();

    // Lightweight wiring inside createLive2dPetManager
    const winSends = [];
    const handlers = new Map();
    const win = {
      webContents: {
        setWindowOpenHandler: () => {},
        on: () => {},
        once: () => {},
        send: (ch, payload) => winSends.push([ch, payload]),
      },
      setAlwaysOnTop: () => {},
      setVisibleOnAllWorkspaces: () => {},
      setIgnoreMouseEvents: () => {},
      setBounds: () => {},
      getBounds: () => ({ x: 0, y: 0, width: PET_WIDTH, height: PET_HEIGHT }),
      isDestroyed: () => false,
      isVisible: () => true,
      showInactive: () => {},
      close: () => {},
      once: () => {},
      on: () => {},
      loadURL: () => Promise.resolve(),
    };
    const manager = createLive2dPetManager({
      electron: {
        BrowserWindow: class {},
        screen: {
          getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
          getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
        },
        ipcMain: {
          handle: (ch, fn) => handlers.set(ch, fn),
          removeHandler: (ch) => handlers.delete(ch),
        },
      },
      BrowserWindow: function () { return win; },
      rendererFile: (name) => `C:/app/src/renderer/${name}`,
      preloadFile: () => 'C:/app/src/preload/index.js',
      loadConfig: () => ({ live2dPet: { enabled: true } }),
      saveConfig: () => {},
      voiceSession: { asr: adapters.asr, llm: adapters.llm, tts: adapters.tts },
    });

    try {
      manager.show();
      assert.equal(manager.getVoiceState().available, true);
      assert.equal(manager.toggleVoice(true).ok, true);
      assert.ok(winSends.some(([ch, payload]) => ch === 'shell:live2d-dsh' && payload?.type === 'voiceState' && payload?.voice?.enabled === true));
      assert.equal(manager.interruptVoice().ok, true);
    } finally {
      await manager.dispose();
    }
  });

  test('submitTranscript during speaking interrupts active TTS and supersedes cleanly', async () => {
    const events = [];
    let speakCount = 0;
    let resolveFirstSpeak = null;
    const adapters = makeAdapters({
      llm: {
        async generate(transcript) {
          return `回复：${transcript}`;
        },
      },
      tts: {
        speak(text, { signal, onProgress }) {
          speakCount += 1;
          const idx = speakCount;
          events.push(['speak-start', idx, text]);
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              events.push(['speak-abort', idx, signal.reason?.message || 'aborted']);
              reject(new Error('tts_aborted'));
            }, { once: true });
            if (idx === 1) {
              onProgress?.('回复：第一句');
              resolveFirstSpeak = () => resolve();
            } else {
              queueMicrotask(() => {
                onProgress?.(text);
                events.push(['speak-done', idx]);
                resolve();
              });
            }
          });
        },
        stop() {
          events.push(['tts-stop']);
        },
      },
    });
    const session = createPetVoiceSession({
      asr: adapters.asr,
      llm: adapters.llm,
      tts: adapters.tts,
    });

    const firstTurn = session.submitTranscript('第一句话，播报很长的内容');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(session.getState().state, VOICE_STATES.SPEAKING);

    const secondTurn = await session.submitTranscript('第二句话');
    assert.equal(secondTurn.ok, true);
    assert.equal(secondTurn.replyText, '回复：第二句话');
    assert.ok(events.some(([kind, idx, reason]) => kind === 'speak-abort' && idx === 1 && reason === 'superseded'));
    assert.ok(events.some(([kind]) => kind === 'tts-stop'));
    resolveFirstSpeak?.();
    const firstResult = await firstTurn;
    assert.equal(firstResult.ok, false);
    assert.equal(firstResult.interrupted, true);
    assert.equal(session.getState().state, VOICE_STATES.IDLE);
    session.dispose();
  });

  test('keeps a bounded history window across many consecutive voice turns', async () => {
    const seenHistories = [];
    const adapters = makeAdapters({
      llm: {
        async generate(transcript, { history }) {
          seenHistories.push(history.map((item) => ({ ...item })));
          return `ack:${transcript}`;
        },
      },
      autoTtsFinish: true,
    });
    const session = createPetVoiceSession({
      asr: adapters.asr,
      llm: adapters.llm,
      tts: adapters.tts,
    });
    for (let i = 0; i < 30; i += 1) {
      const res = await session.submitTranscript(`turn-${i}`);
      assert.equal(res.ok, true);
    }
    assert.equal(seenHistories.length, 30);
    assert.ok(seenHistories.every((h) => h.length <= 12));
    assert.equal(seenHistories.at(-1).at(-1).text, 'turn-29');
    session.dispose();
  });
});
