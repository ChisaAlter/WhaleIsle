'use strict';

/**
 * Low-latency desktop pet voice session state machine with <50ms Barge-in.
 *
 * State machine:
 *   idle -> listening -> thinking -> speaking -> idle
 *   (interrupt / barge-in from thinking or speaking -> listening | idle in <50ms)
 *
 * Pluggable adapters (`asr`, `tts`, `llm`) allow real microphone/endpoint wiring
 * in desktop runtime and deterministic full-chain testing in plain Node.
 * When no microphone or endpoints are available, every start/toggle degrades
 * cleanly to `{ ok: false, reason: 'voice_unavailable' }`.
 */

const VOICE_STATES = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
});

const BARGE_IN_BUDGET_MS = 50;
const MAX_HISTORY_ENTRIES = 24;

/**
 * High-resolution monotonic timestamp in milliseconds.
 * @returns {number}
 */
function hrNowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Split full response text into spoken and unspoken segments for barge-in reconciliation.
 * @param {string} fullText
 * @param {{ spokenText?: string, spokenChars?: number }} progress
 * @returns {{ fullText: string, spokenText: string, unspokenText: string }}
 */
function reconcileSpokenText(fullText, progress) {
  const full = String(fullText || '');
  if (!full) {
    return { fullText: '', spokenText: '', unspokenText: '' };
  }
  if (typeof progress.spokenText === 'string' && progress.spokenText.length > 0) {
    const prefix = progress.spokenText;
    if (full.startsWith(prefix)) {
      return {
        fullText: full,
        spokenText: prefix,
        unspokenText: full.slice(prefix.length),
      };
    }
    const idx = full.indexOf(prefix);
    if (idx >= 0) {
      const cut = idx + prefix.length;
      return {
        fullText: full,
        spokenText: full.slice(0, cut),
        unspokenText: full.slice(cut),
      };
    }
    return {
      fullText: full,
      spokenText: prefix.slice(0, full.length),
      unspokenText: full.slice(Math.min(prefix.length, full.length)),
    };
  }
  const count = Number.isFinite(progress.spokenChars)
    ? Math.max(0, Math.min(full.length, Math.floor(/** @type {number} */ (progress.spokenChars))))
    : 0;
  return {
    fullText: full,
    spokenText: full.slice(0, count),
    unspokenText: full.slice(count),
  };
}

/**
 * Evaluate whether voice hardware and adapters are available.
 * @param {{
 *   asr?: any,
 *   tts?: any,
 *   hasMicrophone?: boolean | (() => boolean),
 *   endpointAvailable?: boolean | (() => boolean),
 * }} options
 * @returns {boolean}
 */
function checkVoiceAvailability(options) {
  if (options.hasMicrophone === false) return false;
  if (typeof options.hasMicrophone === 'function') {
    try {
      if (!options.hasMicrophone()) return false;
    } catch {
      return false;
    }
  }
  if (options.endpointAvailable === false) return false;
  if (typeof options.endpointAvailable === 'function') {
    try {
      if (!options.endpointAvailable()) return false;
    } catch {
      return false;
    }
  }
  const hasAsr = Boolean(options.asr && typeof options.asr.startListening === 'function');
  const hasTts = Boolean(options.tts && typeof options.tts.speak === 'function');
  if (!hasAsr || !hasTts) return false;
  if (typeof options.asr.isAvailable === 'function' && !options.asr.isAvailable()) return false;
  if (typeof options.tts.isAvailable === 'function' && !options.tts.isAvailable()) return false;
  return true;
}

/**
 * Create a 3-stage pet voice session (`idle -> listening -> thinking -> speaking`)
 * with synchronous <50ms `interrupt()` barge-in.
 * @param {{
 *   asr?: {
 *     isAvailable?: () => boolean,
 *     startListening: (opts: { signal: AbortSignal, onPartial?: (text: string) => void, onFinal?: (text: string) => void }) => Promise<void> | void,
 *     stopListening?: () => void,
 *   },
 *   tts?: {
 *     isAvailable?: () => boolean,
 *     speak: (text: string, opts: { signal: AbortSignal, onProgress?: (progress: string | number | { spokenText?: string, spokenChars?: number }) => void }) => Promise<void> | void,
 *     stop?: () => void,
 *   },
 *   llm?: {
 *     generate: (transcript: string, opts: { signal: AbortSignal, turnId: number, history: Array<{ role: string, text: string }> }) => Promise<string | { text?: string }>,
 *   },
 *   hasMicrophone?: boolean | (() => boolean),
 *   endpointAvailable?: boolean | (() => boolean),
 *   onStateChange?: (snapshot: ReturnType<ReturnType<typeof createPetVoiceSession>['getState']>) => void,
 *   now?: () => number,
 * }} [options]
 */
function createPetVoiceSession(options = {}) {
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
  /** @type {Set<(snapshot: any) => void>} */
  const listeners = new Set();
  if (typeof options.onStateChange === 'function') {
    listeners.add(options.onStateChange);
  }

  /** @type {'idle' | 'listening' | 'thinking' | 'speaking'} */
  let state = VOICE_STATES.IDLE;
  let enabled = false;
  let turnSeq = 0;
  let activeTurnId = 0;
  let currentTranscript = '';
  let currentResponseText = '';
  let currentSpokenText = '';
  let currentSpokenChars = 0;
  let updatedAt = nowFn();
  /** @type {{ turnId: number, fullText: string, spokenText: string, unspokenText: string, interruptedAt: number, latencyMs: number } | null} */
  let lastReconciliation = null;
  /** @type {Array<{ role: string, text: string }>} */
  const history = [];

  /**
   * Append one turn entry while keeping history within a fixed sliding window.
   * @param {string} role
   * @param {string} text
   */
  function appendHistory(role, text) {
    history.push({ role, text });
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.splice(0, history.length - MAX_HISTORY_ENTRIES);
    }
  }

  /** @type {AbortController | null} */
  let listenAbort = null;
  /** @type {AbortController | null} */
  let turnAbort = null;
  /** @type {AbortController | null} */
  let speakAbort = null;

  function isAvailable() {
    return checkVoiceAvailability(options);
  }

  function getState() {
    const available = isAvailable();
    return {
      state,
      enabled,
      available,
      reason: available ? '' : 'voice_unavailable',
      turnId: activeTurnId,
      transcript: currentTranscript,
      lastReconciliation: lastReconciliation ? { ...lastReconciliation } : null,
      updatedAt,
    };
  }

  function emitState() {
    updatedAt = nowFn();
    const snapshot = getState();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate subscriber failures from the real-time voice state machine.
      }
    }
    return snapshot;
  }

  /**
   * @param {'idle' | 'listening' | 'thinking' | 'speaking'} nextState
   */
  function setState(nextState) {
    state = nextState;
    return emitState();
  }

  /**
   * @param {AbortController | null} controller
   * @param {string} reason
   */
  function abortController(controller, reason) {
    if (controller && !controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  }

  /** @param {boolean} resumeListening */
  function stopAdaptersForBargeIn(resumeListening) {
    try {
      options.tts?.stop?.();
    } catch {
      // Stop must never throw during barge-in.
    }
    if (resumeListening) return;
    try {
      options.asr?.stopListening?.();
    } catch {
      // Ignore stopListening failures.
    }
  }

  /**
   * Synchronously cancel active TTS playback and in-flight LLM generation (<50ms).
   * Reconciles spoken vs. unspoken text and transitions to `listening` or `idle`.
   * @param {{ resumeListening?: boolean, reason?: string }} [interruptOpts]
   */
  function interrupt(interruptOpts = {}) {
    const startMs = hrNowMs();
    const previousState = state;
    const reason = interruptOpts.reason || 'barge_in';
    const wasActive = previousState !== VOICE_STATES.IDLE || Boolean(turnAbort || speakAbort || listenAbort);

    const activeTurn = turnAbort;
    const activeSpeak = speakAbort;
    const activeListen = listenAbort;
    turnAbort = null;
    speakAbort = null;
    listenAbort = null;

    abortController(activeTurn, reason);
    abortController(activeSpeak, reason);
    abortController(activeListen, reason);
    stopAdaptersForBargeIn(Boolean(interruptOpts.resumeListening));

    const latencyMs = Math.max(0, Number((hrNowMs() - startMs).toFixed(3)));
    let reconciliation = null;
    if (previousState === VOICE_STATES.SPEAKING || currentResponseText) {
      const split = reconcileSpokenText(currentResponseText, {
        spokenText: currentSpokenText,
        spokenChars: currentSpokenChars,
      });
      reconciliation = { turnId: activeTurnId, ...split, interruptedAt: nowFn(), latencyMs };
      lastReconciliation = reconciliation;
      if (split.spokenText) appendHistory('assistant', split.spokenText);
    }

    currentResponseText = '';
    currentSpokenText = '';
    currentSpokenChars = 0;

    const nextState = interruptOpts.resumeListening && isAvailable()
      ? VOICE_STATES.LISTENING
      : VOICE_STATES.IDLE;
    setState(nextState);
    if (nextState === VOICE_STATES.LISTENING) beginAsrCapture();

    return {
      ok: true,
      interrupted: wasActive,
      previousState,
      state,
      latencyMs,
      withinBudget: latencyMs < BARGE_IN_BUDGET_MS,
      reconciliation,
    };
  }

  function beginAsrCapture() {
    if (!options.asr || typeof options.asr.startListening !== 'function') return;
    const controller = new AbortController();
    listenAbort = controller;
    Promise.resolve()
      .then(() => options.asr?.startListening({
        signal: controller.signal,
        onPartial: (partial) => {
          if (controller.signal.aborted) return;
          currentTranscript = String(partial || '');
          emitState();
        },
        onFinal: (finalText) => {
          if (controller.signal.aborted) return;
          void submitTranscript(finalText);
        },
      }))
      .catch(() => {
        if (listenAbort === controller) {
          listenAbort = null;
          if (state === VOICE_STATES.LISTENING) setState(VOICE_STATES.IDLE);
        }
      });
  }

  /**
   * Transition into `listening` state (with barge-in if currently thinking/speaking).
   * @returns {{ ok: boolean, reason?: string, state: string }}
   */
  function startListening() {
    if (!isAvailable()) {
      return { ok: false, reason: 'voice_unavailable', state };
    }
    enabled = true;
    if (state === VOICE_STATES.THINKING || state === VOICE_STATES.SPEAKING) {
      const res = interrupt({ resumeListening: true, reason: 'barge_in' });
      return { ok: true, state: res.state };
    }
    if (listenAbort && !listenAbort.signal.aborted) {
      listenAbort.abort(new Error('restart_listening'));
    }
    listenAbort = null;
    currentTranscript = '';
    setState(VOICE_STATES.LISTENING);
    beginAsrCapture();
    return { ok: true, state };
  }

  /**
   * Update spoken progress tracking from TTS adapter callback.
   * @param {string} replyText
   * @param {string | number | { spokenText?: string, spokenChars?: number }} progress
   */
  function applyTtsProgress(replyText, progress) {
    if (typeof progress === 'string') {
      currentSpokenText = progress;
      currentSpokenChars = progress.length;
      return;
    }
    if (typeof progress === 'number') {
      currentSpokenChars = progress;
      currentSpokenText = replyText.slice(0, Math.max(0, Math.floor(progress)));
      return;
    }
    if (!progress || typeof progress !== 'object') return;
    if (typeof progress.spokenText === 'string') {
      currentSpokenText = progress.spokenText;
      currentSpokenChars = progress.spokenText.length;
    } else if (typeof progress.spokenChars === 'number') {
      currentSpokenChars = progress.spokenChars;
      currentSpokenText = replyText.slice(0, Math.max(0, Math.floor(progress.spokenChars)));
    }
  }

  /**
   * Run LLM generation stage (`thinking`) with AbortController support.
   * @param {string} text
   * @param {number} myTurnId
   */
  async function runThinkingStage(text, myTurnId) {
    const controller = new AbortController();
    turnAbort = controller;
    setState(VOICE_STATES.THINKING);
    try {
      const llmResult = typeof options.llm?.generate === 'function'
        ? await options.llm.generate(text, { signal: controller.signal, turnId: myTurnId, history: history.slice(-12) })
        : text;
      if (controller.signal.aborted || activeTurnId !== myTurnId) {
        return { ok: false, interrupted: true, replyText: '' };
      }
      const replyText = typeof llmResult === 'string' ? llmResult : String(llmResult?.text || '');
      return { ok: true, interrupted: false, replyText };
    } catch {
      if (controller.signal.aborted || activeTurnId !== myTurnId) {
        return { ok: false, interrupted: true, replyText: '' };
      }
      setState(VOICE_STATES.IDLE);
      return { ok: false, interrupted: false, reason: 'llm_failed', replyText: '' };
    } finally {
      if (turnAbort === controller) turnAbort = null;
    }
  }

  /**
   * Run TTS playback stage (`speaking`) with progress tracking and barge-in cancellation.
   * @param {string} replyText
   * @param {number} myTurnId
   */
  async function runSpeakingStage(replyText, myTurnId) {
    currentResponseText = replyText;
    const controller = new AbortController();
    speakAbort = controller;
    setState(VOICE_STATES.SPEAKING);
    try {
      await options.tts?.speak(replyText, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted && activeTurnId === myTurnId) {
            applyTtsProgress(replyText, progress);
          }
        },
      });
      if (controller.signal.aborted || activeTurnId !== myTurnId) {
        return { ok: false, interrupted: true, state, reconciliation: lastReconciliation };
      }
      appendHistory('assistant', replyText);
      currentResponseText = '';
      currentSpokenText = '';
      currentSpokenChars = 0;
      setState(VOICE_STATES.IDLE);
      return { ok: true, turnId: myTurnId, replyText, state };
    } catch {
      if (controller.signal.aborted || activeTurnId !== myTurnId) {
        return { ok: false, interrupted: true, state, reconciliation: lastReconciliation };
      }
      currentResponseText = '';
      setState(VOICE_STATES.IDLE);
      return { ok: false, reason: 'tts_failed', state };
    } finally {
      if (speakAbort === controller) speakAbort = null;
    }
  }

  /**
   * Process a finalized transcript: `thinking` (LLM) -> `speaking` (TTS) -> `idle`.
   * @param {string} rawText
   */
  async function submitTranscript(rawText) {
    if (!isAvailable()) {
      return { ok: false, reason: 'voice_unavailable', state };
    }
    const text = String(rawText || '').trim();
    if (!text) {
      return { ok: false, reason: 'empty_transcript', state };
    }
    abortController(listenAbort, 'transcript_finalized');
    listenAbort = null;
    if (
      state === VOICE_STATES.THINKING
      || state === VOICE_STATES.SPEAKING
      || (turnAbort && !turnAbort.signal.aborted)
      || (speakAbort && !speakAbort.signal.aborted)
    ) {
      interrupt({ resumeListening: false, reason: 'superseded' });
    }

    turnSeq += 1;
    const myTurnId = turnSeq;
    activeTurnId = myTurnId;
    currentTranscript = text;
    currentResponseText = '';
    currentSpokenText = '';
    currentSpokenChars = 0;
    appendHistory('user', text);

    const thought = await runThinkingStage(text, myTurnId);
    if (!thought.ok) {
      return thought.interrupted
        ? { ok: false, interrupted: true, state }
        : { ok: false, reason: thought.reason || 'llm_failed', state };
    }
    return runSpeakingStage(thought.replyText, myTurnId);
  }

  /**
   * Enable or disable voice mode; degrades to `voice_unavailable` when hardware/endpoints are missing.
   * @param {boolean} [nextEnabled]
   */
  function toggle(nextEnabled) {
    const wantOn = typeof nextEnabled === 'boolean' ? nextEnabled : !enabled;
    if (!wantOn) {
      enabled = false;
      interrupt({ resumeListening: false, reason: 'disabled' });
      return { ok: true, enabled: false, state };
    }
    if (!isAvailable()) {
      enabled = false;
      return { ok: false, reason: 'voice_unavailable', enabled: false, state };
    }
    enabled = true;
    emitState();
    return { ok: true, enabled: true, state };
  }

  /**
   * Subscribe to state snapshots.
   * @param {(snapshot: ReturnType<typeof getState>) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose() {
    enabled = false;
    interrupt({ resumeListening: false, reason: 'disposed' });
    listeners.clear();
  }

  return {
    getState,
    isAvailable,
    toggle,
    startListening,
    submitTranscript,
    interrupt,
    subscribe,
    dispose,
  };
}

/**
 * Lightweight bridge for `desktop-live2d.js` that relays voice state snapshots
 * over the existing `shell:live2d-dsh` renderer event channel without adding
 * new IPC channels or touching Live2D click-through/bubble logic.
 * @param {{
 *   voiceOptions?: Parameters<typeof createPetVoiceSession>[0],
 *   sendDshEvent?: (payload: Record<string, unknown>) => void,
 * }} [bridgeOptions]
 */
function createLive2dVoiceBridge(bridgeOptions = {}) {
  const send = typeof bridgeOptions.sendDshEvent === 'function'
    ? bridgeOptions.sendDshEvent
    : () => {};
  const session = createPetVoiceSession({
    ...(bridgeOptions.voiceOptions || {}),
    onStateChange: (snapshot) => {
      try {
        bridgeOptions.voiceOptions?.onStateChange?.(snapshot);
      } catch {
        // Isolate user callback errors.
      }
      send({ type: 'voiceState', voice: snapshot });
    },
  });

  function pushCurrentState() {
    send({ type: 'voiceState', voice: session.getState() });
  }

  return {
    session,
    getState: session.getState,
    toggle: session.toggle,
    startListening: session.startListening,
    submitTranscript: session.submitTranscript,
    interrupt: session.interrupt,
    pushCurrentState,
    dispose: session.dispose,
  };
}

module.exports = {
  VOICE_STATES,
  BARGE_IN_BUDGET_MS,
  reconcileSpokenText,
  createPetVoiceSession,
  createLive2dVoiceBridge,
};
