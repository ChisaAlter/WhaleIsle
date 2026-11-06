import { withSessionBindingLock } from './session-binding-lock.mjs';
import { whaleSessionResolution } from './whale-session.mjs';
import { selectConversationSession } from './session-binding.mjs';

export const WORKSPACE_SESSION_STALE = 'workspace-session-stale';

function workspaceSession(harness, sessionId) {
  if (typeof harness.workspaceSession === 'function') {
    return harness.workspaceSession(sessionId);
  }
  return Object.freeze({
    sessionId,
    sessionExists: (...args) => harness.sessionExists(sessionId, ...args),
    models: (...args) => harness.getSessionModels(sessionId, ...args),
    selectModel: (...args) => harness.selectSessionModel(sessionId, ...args),
    isRunning: (...args) => harness.isSessionRunning(sessionId, ...args),
    hasActiveTurn: (...args) => harness.hasActiveTurn(sessionId, ...args),
    stopActiveTurn: (...args) => harness.stopActiveTurn(sessionId, ...args),
    steerActiveTurn: (...args) => harness.steerActiveTurn(sessionId, ...args),
    ask: (...args) => harness.ask(sessionId, ...args),
  });
}

async function sessionExists(session, options) {
  return options === undefined
    ? session.sessionExists()
    : session.sessionExists(options);
}

async function createSession(harness, options) {
  return options === undefined
    ? harness.createSession()
    : harness.createSession(options);
}

/**
 * Resolve, persist, and ask through a session that belongs to the bot's
 * current workspace. A concurrent workspace switch invalidates the scoped
 * session and retries before any prompt is sent to the stale session.
 */
export async function askInWorkspaceSession({
  harness,
  state,
  key,
  text,
  content,
  createOptions,
  existsOptions,
  askOptions,
}) {
  while (true) {
    try {
      const binding = await withSessionBindingLock(state, key, async () => {
        const resolution = await whaleSessionResolution(harness, { state, key });
        const selected = await selectConversationSession(harness, state, key, resolution);
        const whaleSessionId = selected.shared ? selected.sessionId : null;
        let sessionId = selected.sessionId;
        let session = sessionId ? workspaceSession(harness, sessionId) : null;
        if (!session || !(await sessionExists(session, existsOptions))) {
          if (whaleSessionId) {
            const error = new Error('The resident whale conversation is not available yet.');
            error.code = 'whale-session-unavailable';
            throw error;
          }
          sessionId = await createSession(harness, createOptions);
          if (await state.setSession(key, sessionId, { kind: 'auto', preset: resolution.preset }) === false) return null;
          session = workspaceSession(harness, sessionId);
        } else if (whaleSessionId && (state.sessionFor(key) !== whaleSessionId || !state.bindingFor?.(key))) {
          if (await state.setSession(key, whaleSessionId, selected.origin) === false) return null;
        }
        return { sessionId, session };
      });
      if (!binding) continue;
      const artifacts = [];
      const originalOnArtifact = typeof askOptions === 'object'
        && typeof askOptions?.onArtifact === 'function'
        ? askOptions.onArtifact
        : null;
      const artifactOptions = typeof askOptions === 'number'
        ? { timeoutMs: askOptions }
        : { ...askOptions };
      artifactOptions.onArtifact = async (artifact) => {
        artifacts.push(artifact);
        await originalOnArtifact?.(artifact);
      };
      const answer = await binding.session.ask(content ?? text, artifactOptions);
      return {
        sessionId: binding.sessionId,
        answer,
        ...(artifacts.length > 0 ? { artifacts } : {}),
      };
    } catch (error) {
      if (error?.code !== WORKSPACE_SESSION_STALE) throw error;
    }
  }
}
