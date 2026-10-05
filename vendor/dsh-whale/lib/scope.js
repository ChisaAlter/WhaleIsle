/** Persistent, revision-checked settings for the desktop-managed whale plugin.
 * Harness SettingsForms cannot edit a plugin inserted by the desktop's
 * --patch overlay. Keep editable values in the whale data directory.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';

const defaults = {
  name: '鲸鱼娘', personality: 'natural', userTitle: '', personaText: '',
  modelProvider: '', modelModel: '', modelReasoningEffort: '',
  imDefault: true, sessionId: '',
};

function values(source) {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof source?.[key] === typeof defaults[key]) result[key] = source[key];
  }
  return result;
}

/** Apply the profile's model to the resident session before saving the choice. */
export async function updateWhaleSettings(scope, patch, controller) {
  const before = scope.get();
  const next = { ...before, ...patch };
  const changesModel = ['modelProvider', 'modelModel', 'modelReasoningEffort']
    .some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  if (changesModel && next.sessionId) {
    if (typeof controller?.selectModel !== 'function') throw new Error('session-controller-unavailable');
    const route = next.modelProvider && next.modelModel
      ? { provider: next.modelProvider, model: next.modelModel,
        ...(next.modelReasoningEffort ? { reasoningEffort: next.modelReasoningEffort } : {}) }
      : (await controller.modelCatalog?.())?.default;
    if (!route?.provider || !route?.model) throw new Error('default-model-unavailable');
    await controller.selectModel({ sessionId: next.sessionId, ...route,
      ...(next.modelReasoningEffort ? { reasoningEffort: next.modelReasoningEffort } : {}), saveAsDefault: false });
  }
  await scope.set(next, before);
  return scope.get();
}

export function createWhaleScope(home) {
  if (!home) {
    // Missing DSH_HOME must never become a relative-path write: reads
    // report defaults, writes refuse loudly instead of landing under the
    // Harness process cwd.
    return {
      get() { return values(); },
      async set() { throw new Error('Whale settings home is unavailable'); },
    };
  }
  const file = path.join(home, 'data', 'whale', 'settings.json');
  const legacy = path.join(home, 'settings.yaml.imported');
  const snapshots = new WeakMap();

  function read() {
    // A corrupt settings file must degrade to defaults — throwing here
    // would break every prompt assembly, not just this one read.
    try {
      if (fs.existsSync(file)) return values(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!fs.existsSync(legacy)) return values();
      const old = parse(fs.readFileSync(legacy, 'utf8'))?.['dsh-whale'];
      // Old sessions may use a replay format the current Harness cannot open.
      // Preserve the legacy file, but start a new reusable session.
      return values({ ...old, sessionId: '' });
    } catch {
      return values();
    }
  }

  return {
    get() {
      const snapshot = structuredClone(read());
      snapshots.set(snapshot, structuredClone(snapshot));
      return snapshot;
    },
    async set(next, previous) {
      const baseline = snapshots.get(previous);
      if (!baseline) throw new Error('Whale settings writes require their original snapshot');
      if (!isDeepStrictEqual(read(), baseline)) throw new Error('Whale settings changed during update');
      const result = values(next);
      if (isDeepStrictEqual(result, baseline)) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    },
  };
}
