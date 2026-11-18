import {
  h,
  useSyncExternalStore,
  useState,
  useEffect,
  useRef,
  Button,
  IconSettingsOutline16,
} from './primitives.js';
import { ACP_PREFIX, editableModelOptions } from './utils.js';

function renderSessionOptionField({ option, value, disabled, onChange, t }) {
  return h(
    'label',
    { key: option.id, className: 'dsh-acp-session-option', title: option.description || '' },
    h('span', null, option.name || option.label || option.id),
    option.type === 'boolean'
      ? h('input', {
          type: 'checkbox',
          checked: value === true,
          disabled,
          onChange: (event) => void onChange(option, event.target.checked),
        })
      : h(
          'select',
          {
            className: 'dsh-acp-settings-select',
            value: value ?? '',
            disabled,
            onChange: (event) => void onChange(option, event.target.value),
          },
          value === undefined ? h('option', { value: '', disabled: true }, t('effort.providerDefault')) : null,
          (option.options || []).map((choice) =>
            h('option', { key: choice.id, value: choice.id }, choice.name || choice.label || choice.id),
          ),
        ),
  );
}

export function AgentSessionOptions({ sessionId, directory, rpc, openAgentSettings, t, locked, dismiss, reportFailure }) {
  const state = useSyncExternalStore(
    (fn) => directory.subscribe(fn),
    () => directory.getSnapshot(),
  );
  const provider = state.current?.provider || '';
  const modelId = state.current?.model;
  const agentId = provider.startsWith(ACP_PREFIX) ? provider.slice(ACP_PREFIX.length) : null;
  const key = `${provider}/${modelId}`;
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const failureRef = useRef(reportFailure);
  failureRef.current = reportFailure;

  useEffect(() => {
    let active = true;
    setConfig(null);
    if (agentId && modelId) {
      Promise.all([rpc('catalog'), rpc('session/options', { sessionId, agentId, model: modelId })])
        .then(([catalog, result]) => {
          if (!active) return;
          const agent = catalog.agents.find((item) => item.id === agentId);
          const model = (agent?.allModels || agent?.models || []).find((item) => item.id === modelId);
          setConfig({ key, options: editableModelOptions(model), selections: result.selections || [] });
        })
        .catch((error) => {
          if (active) failureRef.current(error.message);
        });
    }
    return () => {
      active = false;
    };
  }, [sessionId, agentId, modelId, state.groups, rpc]);

  const changeOption = async (option, value) => {
    setSaving(true);
    try {
      const result = await rpc('session/options', { sessionId, agentId, model: modelId, option: { id: option.id, value } });
      setConfig((current) => (current?.key === key ? { ...current, selections: result.selections || [] } : current));
    } catch (error) {
      reportFailure(error.message);
    } finally {
      setSaving(false);
    }
  };

  return h(
    'div',
    {
      className: 'dsh-acp-session-options',
      onKeyDown: (event) => {
        if (event.key !== 'Escape') event.stopPropagation();
      },
      // Disabling the focused control during a save emits a null-target
      // blur. It is an internal transition, not leaving the host's menu.
      onBlur: (event) => {
        if (saving && event.relatedTarget === null) event.stopPropagation();
      },
    },
    config?.key === key
      ? config.options.map((option) =>
          renderSessionOptionField({
            option,
            value: config.selections.find((selection) => selection.id === option.id)?.value ?? option.currentValue,
            disabled: Boolean(locked || saving || state.pending),
            onChange: changeOption,
            t,
          }),
        )
      : null,
    h(
      Button,
      {
        size: 'sm',
        disabled: locked,
        icon: h(IconSettingsOutline16, { size: 14 }),
        onClick: () => {
          dismiss();
          if (!openAgentSettings()) reportFailure(t('error.settingsNav'));
        },
      },
      t('menu.manageAgents'),
    ),
  );
}
