import { runtimeBundle } from './agent-runtime.js';

const FORBIDDEN_OPTION_KEY_RE = /mode|permission|approval|sandbox|trust|yolo|auto[-_]?approve|bypass|danger/i;

/**
 * Raw session configOptions → normalized [{id, name}] model list. The model
 * select is identified by `category: 'model'` or `id: 'model'`; options may be
 * flat {value,name} entries or grouped {options:[…]} categories.
 */
export function isReasoningOption(option) {
  return option?.type === 'select' && (option.role === 'reasoning'
    || ['thought_level', 'reasoning_effort'].includes(option.category)
    || /effort|thought|thinking/i.test(option.id));
}

export function optionChoiceId(value) {
  return value === '' ? runtimeBundle().providers.AcpSessionConfig.ACP_EMPTY_OPTION_VALUE : value;
}

export function configOptionDescriptors(configOptions) {
  const rawOptions = (configOptions || []).filter((option) => option.id !== 'model' && option.category !== 'model')
    .map((option) => option.type === 'select' && option.currentValue === undefined ? { ...option, currentValue: '' } : option);
  return runtimeBundle().modelOptionDescriptors({ configOptions: rawOptions, modeState: undefined })
    .map((option) => {
      const raw = rawOptions.find((entry) => entry.id === option.id);
      return { ...option, name: option.label, category: raw?.category,
        ...(isReasoningOption({ ...option, category: raw?.category }) ? { role: 'reasoning' } : {}),
        ...(option.type === 'select' ? { options: option.options.map((choice) => ({ ...choice, name: choice.label })) } : {}) };
    });
}

export function modelsFromConfigOptions(configOptions, modelState) {
  const found = [];
  const descriptors = configOptionDescriptors(configOptions);
  for (const opt of configOptions || []) {
    if (opt?.type === 'select' && (opt.category === 'model' || opt.id === 'model')) {
      for (const item of opt.options || []) {
        if (Array.isArray(item?.options)) {
          for (const sub of item.options) {
            if (sub?.value) found.push({ id: String(sub.value), name: String(sub.name || sub.value) });
          }
        } else if (item?.value) {
          found.push({ id: String(item.value), name: String(item.name || item.value) });
        }
      }
    }
  }
  if (found.length === 0 && modelState?.availableModels) {
    for (const model of modelState.availableModels) found.push({ id: model.modelId, name: model.name || model.modelId });
  }
  return found.map((model) => ({ ...model, ...modelOptionMetadata(descriptors) }));
}

export function modelOptionMetadata(descriptors = []) {
  const options = descriptors.map((option) => ({ ...option, name: option.name || option.label || option.id,
    ...(option.type === 'select' ? { options: (option.options || []).map((choice) => ({ ...choice, name: choice.name || choice.label || choice.id })) } : {}) }));
  const effort = options.find(isReasoningOption);
  return { options, efforts: effort?.options || [], ...(effort?.currentValue !== undefined ? { defaultEffort: effort.currentValue } : {}) };
}

export async function syncConnectionModelAndEffort(conn, modelId, reasoningEffort, signal, explicitEffort = false) {
  await conn.ensureReady(signal);
  // The connected account's current settings, not a saved/configured union,
  // determine whether a requested model can be selected.
  const currentOptions = await conn.api.getConfigOptions();
  if (Array.isArray(currentOptions)) {
    conn._setConfigOptions(currentOptions);
    conn._publishDiscoveredModels();
  }
  let options = Array.isArray(conn.configOptions) ? conn.configOptions : [];
  // 'default' is the synthetic composer entry for "agent's own default" —
  // it is never a valid ACP-side id, so it must not reach session/set_model.
  if (modelId && modelId !== 'default' && modelId !== conn.currentModel) {
    if (conn.wiring?.isAntigravity && conn.handle?.service) {
      // ACP runtime AntigravityAdapterV2.applyModelSelection: never replaces a saved
      // selection with the default returned by a cold resume; rejects
      // models the account does not offer. Failures propagate (AC-007).
      const { providers, effect } = runtimeBundle();
      const applied = await effect.runCatch(
        providers.AntigravityAcpSupport.applyAntigravityAcpModelSelection({
          runtime: conn.handle.service,
          model: modelId === 'antigravity-default' ? undefined : modelId,
          defaultModel: undefined,
          mapError: (cause) => cause,
        }),
      );
      conn.currentModel = applied || modelId;
      conn._refreshSeq += 1;
    } else {
      const modelOpt = options.find(
        (opt) => opt?.type === 'select' && (opt.category === 'model' || opt.id === 'model'),
      );
      if (modelOpt?.id) {
        // Reject ids the agent never advertised (the runtime's own
        // allowed-values check would too, but only when customModels was
        // passed — validate here so the error names the model).
        const known = new Set(modelsFromConfigOptions(options).map((m) => m.id));
        for (const id of conn._customModels || []) known.add(id);
        if (known.size > 0 && !known.has(modelId)) {
          throw new Error(`ACP agent "${conn.agentConfig?.name}" has no model "${modelId}".`);
        }
        await conn.api.setConfigOption(modelOpt.id, modelId);
      } else {
        await conn.api.setSessionModel(modelId).catch((error) => {
          if (error.code !== -32601) throw error;
          return conn.api.setModel(modelId);
        });
      }
      conn.currentModel = modelId;
      conn._refreshSeq += 1;
    }
    // Model changes can replace the effort/option catalog. Validate the
    // selected model's settings, not the previous model's advertised values.
    conn.currentEffort = undefined;
    const selectedOptions = await conn.api.getConfigOptions();
    if (Array.isArray(selectedOptions)) {
      conn._setConfigOptions(selectedOptions);
      options = selectedOptions;
      conn._publishDiscoveredModels();
    }
  }

  if (reasoningEffort && reasoningEffort !== conn.currentEffort) {
    const effortOpt = configOptionDescriptors(options).find(isReasoningOption);
    if (effortOpt?.id) {
      const values = effortOpt.options.map((item) => item.id);
      if (!values.includes(reasoningEffort)) throw new Error(`Unsupported reasoning effort "${reasoningEffort}". Available: ${values.join(', ')}.`);
      await conn.syncOption(effortOpt.id, reasoningEffort);
    } else if (reasoningEffort !== 'medium' || explicitEffort) {
      // Medium was the legacy composer's implicit default. Preserve that
      // caller contract; new explicit settings are checked before spawning.
      throw new Error(`ACP agent "${conn.agentConfig.name}" does not advertise reasoning effort settings.`);
    }
  }
}

export async function syncConnectionRuntimeMode(conn, interactionMode, signal) {
  signal?.throwIfAborted();
  const policy = conn.getRuntimePolicy?.(conn);
  let mode;
  if (interactionMode === 'plan') mode = conn.availableModes.find((entry) => /^(plan|read[-_ ]?only)$/i.test(entry.id))?.id;
  else if (conn.wiring?.isAntigravity && policy) mode = runtimeBundle().providers.AntigravityAcpSupport.antigravityPermissionMode(policy.runtimeMode);
  else mode = conn.availableModes.find((entry) => /^(default|code)$/i.test(entry.id))?.id;
  if (mode && mode !== conn.currentModeId) { await conn.api.setMode(mode); conn.currentModeId = mode; conn._refreshSeq += 1; }
}

export async function syncConnectionOption(conn, id, value) {
  const currentOptions = await conn.api.getConfigOptions();
  if (Array.isArray(currentOptions)) conn._setConfigOptions(currentOptions);
  const option = conn.configOptions.find((entry) => entry.id === id);
  if (id === 'model' || option?.category === 'model') throw new Error('Select models with model, not options.');
  if (FORBIDDEN_OPTION_KEY_RE.test(`${id} ${option?.category || ''}`)) throw new Error('Permission and interaction settings must use runtime_mode and interaction_mode; model options cannot raise permissions.');
  const wireValue = value === runtimeBundle().providers.AcpSessionConfig.ACP_EMPTY_OPTION_VALUE ? '' : value;
  const choices = (option?.options || []).flatMap((entry) => entry.options || [entry]);
  const valid = option?.type === 'boolean' ? typeof wireValue === 'boolean' : option?.type === 'select' && choices.some((entry) => entry.value === wireValue);
  if (!valid) throw new Error(`ACP option ${id}=${value} is not available in this session.`);
  await conn.api.setConfigOption(id, wireValue); conn._refreshSeq += 1;
  const updated = await conn.api.getConfigOptions();
  if (Array.isArray(updated)) { conn._setConfigOptions(updated); conn._publishDiscoveredModels(); }
}
