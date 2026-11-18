import {
  h,
  Button,
  Input,
  Switch,
  IconCheckOutlineRegular,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
} from './primitives.js';
import { SettingsSelect } from './primitives.js';
import { joinArgsText, unwrapSwitchChecked } from './utils.js';

export function renderOverviewHeaderCard({ selectedAgent, account, busyAction, onTestAndSync, onAddAccount, onOpenConfirmDelete, t }) {
  const joinedArgs = joinArgsText(selectedAgent.args);
  const cmdTitle = selectedAgent.binaryPath
    ? `${selectedAgent.binaryPath} ${joinedArgs}`
    : `$ ${selectedAgent.command} ${joinedArgs}`;
  const cmdDisplay = selectedAgent.binaryPath
    ? `$ ${selectedAgent.command} ${joinedArgs} \u00b7 ${selectedAgent.binaryPath}`
    : `$ ${selectedAgent.command} ${joinedArgs}`;
  let statusBadge = t('status.unauthenticated');
  if (!selectedAgent.binaryFound) statusBadge = t('status.missing');
  else if (account?.authenticated) statusBadge = t('status.authenticated');

  return h(
    'div',
    { className: 'dsh-acp-card' },
    h(
      'div',
      { className: 'dsh-acp-card-header' },
      h(
        'div',
        { className: 'dsh-acp-card-header-copy' },
        h(
          'div',
          { className: 'dsh-acp-card-title-row' },
          h('h4', { className: 'dsh-acp-card-title' }, selectedAgent.name),
          h('span', { className: 'dsh-acp-badge' }, selectedAgent.badge || 'ACP'),
          selectedAgent.version ? h('span', { className: 'dsh-acp-badge' }, `v${selectedAgent.version}`) : null,
          h(
            'span',
            {
              className: 'dsh-acp-badge',
              'data-tone': selectedAgent.binaryFound && account?.authenticated ? 'success' : 'warning',
            },
            statusBadge,
          ),
          // CLI credential probes and ACP `authenticate` are separate trust paths.
          !account?.authenticated && selectedAgent.acpAuthedAt
            ? h('span', { className: 'dsh-acp-badge', 'data-tone': 'success' }, t('status.acpAuthed'))
            : null,
        ),
        h('p', { className: 'dsh-acp-card-desc' }, selectedAgent.description || ''),
      ),
    ),
    h('div', { className: 'dsh-acp-cmd-bar', title: cmdTitle }, cmdDisplay),
    h(
      'div',
      { className: 'dsh-acp-card-actions-bar' },
      h(
        'div',
        { className: 'dsh-acp-card-actions' },
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            loading: busyAction === `test:${selectedAgent.id}`,
            onClick: () => void onTestAndSync(selectedAgent),
          },
          busyAction === `test:${selectedAgent.id}` ? t('action.testing') : t('action.test'),
        ),
        selectedAgent.baseAgentId && selectedAgent.baseAgentId !== 'custom'
          ? h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                icon: h(IconPlusOutline16, { size: 14 }),
                onClick: onAddAccount,
              },
              t('action.addAccount'),
            )
          : null,
      ),
      h(
        'div',
        { className: 'dsh-acp-card-actions' },
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            icon: h(IconTrashOutline16, { size: 14 }),
            onClick: onOpenConfirmDelete,
          },
          selectedAgent.builtin ? t('action.reset') : t('action.delete'),
        ),
      ),
    ),
  );
}

function renderModelRow({ model, onToggleFavorite, onToggleVisible, t }) {
  return h(
    'div',
    {
      key: model.id,
      className: 'dsh-acp-model-row',
      'data-hidden': model.hidden ? 'true' : 'false',
    },
    h(
      'div',
      { className: 'dsh-acp-model-left' },
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-acp-star-btn',
          'data-fav': model.favorite ? 'true' : 'false',
          title: t('models.favorite'),
          onClick: () => void onToggleFavorite(model.id),
        },
        model.favorite ? '★' : '☆',
      ),
      h('span', { className: 'dsh-acp-model-name' }, model.name || model.id),
      model.name && model.name !== model.id ? h('span', { className: 'dsh-acp-model-id' }, model.id) : null,
      model.discovered ? h('span', { className: 'dsh-acp-badge' }, t('models.discovered')) : null,
    ),
    h(
      'div',
      { className: 'dsh-acp-model-right' },
      h(Switch, {
        'aria-label': model.name || model.id,
        checked: !model.hidden,
        onChange: (val) => void onToggleVisible(model.id, unwrapSwitchChecked(val, Boolean(model.hidden))),
      }),
    ),
  );
}

export function renderModelsManagerCard({
  selectedAgent,
  allModels,
  filteredModels,
  enabledCount,
  modelQuery,
  setModelQuery,
  newModelInput,
  setNewModelInput,
  busyAction,
  onSetAllHidden,
  onTestAndSync,
  onAddCustomModel,
  onToggleFavorite,
  onToggleVisible,
  t,
}) {
  return h(
    'div',
    { className: 'dsh-acp-card' },
    h(
      'div',
      { className: 'dsh-acp-card-header' },
      h(
        'div',
        { className: 'dsh-acp-card-header-copy' },
        h(
          'div',
          { className: 'dsh-acp-card-title-row' },
          h('h4', { className: 'dsh-acp-card-title' }, t('section.models')),
          h('span', { className: 'dsh-acp-badge' }, t('models.count', { enabled: String(enabledCount), total: String(allModels.length) })),
        ),
        h('p', { className: 'dsh-acp-card-desc' }, t('section.modelsDesc')),
      ),
      h(
        'div',
        { className: 'dsh-acp-card-actions' },
        h(
          'span',
          {
            className: 'dsh-acp-actions-slot',
            style: { visibility: (selectedAgent.hiddenModels || []).length > 0 ? 'visible' : 'hidden' },
          },
          h(Button, { variant: 'outline', size: 'sm', onClick: () => void onSetAllHidden([]) }, t('models.showAll')),
        ),
        h(
          'span',
          { className: 'dsh-acp-actions-slot', style: { visibility: enabledCount > 0 ? 'visible' : 'hidden' } },
          h(Button, { variant: 'outline', size: 'sm', onClick: () => void onSetAllHidden(allModels.map((m) => m.id)) }, t('models.hideAll')),
        ),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            icon: h(IconRefreshOutline16, { size: 14 }),
            loading: busyAction === `test:${selectedAgent.id}`,
            onClick: () => void onTestAndSync(selectedAgent),
          },
          t('models.syncBtn'),
        ),
      ),
    ),
    h(
      'div',
      { className: 'dsh-acp-models-toolbar' },
      h(
        'div',
        { className: 'dsh-acp-models-toolbar-input' },
        h(Input, { variant: 'form', value: modelQuery, placeholder: t('models.searchPh'), onChange: (e) => setModelQuery(e.target.value) }),
      ),
      h(
        'div',
        { className: 'dsh-acp-models-toolbar-input' },
        h(Input, {
          variant: 'form',
          value: newModelInput,
          placeholder: t('models.addPh'),
          onChange: (e) => setNewModelInput(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onAddCustomModel();
            }
          },
        }),
      ),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          icon: h(IconPlusOutline16, { size: 14 }),
          disabled: !newModelInput.trim(),
          onClick: () => void onAddCustomModel(),
        },
        t('models.addBtn'),
      ),
    ),
    h(
      'div',
      { className: 'dsh-acp-models-list' },
      filteredModels.map((model) =>
        renderModelRow({ model, onToggleFavorite, onToggleVisible, t }),
      ),
    ),
  );
}

function renderEnvRowsEditor({ runtimeDraft, setRuntimeDraft, t }) {
  const updateRow = (idx, patch) => {
    const nextRows = [...runtimeDraft.envRows];
    nextRows[idx] = { ...nextRows[idx], ...patch };
    setRuntimeDraft({ ...runtimeDraft, envRows: nextRows });
  };
  return h(
    'div',
    { className: 'dsh-acp-field', style: { marginTop: '4px' } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h('label', { className: 'dsh-acp-field-label' }, t('section.env')),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          icon: h(IconPlusOutline16, { size: 14 }),
          onClick: () => setRuntimeDraft({ ...runtimeDraft, envRows: [...runtimeDraft.envRows, { key: '', value: '' }] }),
        },
        t('env.addRow'),
      ),
    ),
    h('p', { className: 'dsh-acp-meta-line' }, t('section.envDesc')),
    runtimeDraft.envRows.length === 0
      ? h('div', { className: 'dsh-acp-meta-line' }, t('env.empty'))
      : h(
          'div',
          { className: 'dsh-acp-env-list' },
          runtimeDraft.envRows.map((row, idx) =>
            h(
              'div',
              { key: idx, className: 'dsh-acp-env-row' },
              h(Input, { variant: 'form', value: row.key, placeholder: t('env.keyPh'), onChange: (e) => updateRow(idx, { key: e.target.value }) }),
              h(Input, {
                variant: 'form',
                type: /KEY|TOKEN|SECRET|PASSWORD/i.test(row.key) ? 'password' : 'text',
                value: row.value,
                placeholder: t('env.valPh'),
                onChange: (e) => updateRow(idx, { value: e.target.value }),
              }),
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'sm',
                  icon: h(IconTrashOutline16, { size: 14 }),
                  onClick: () => setRuntimeDraft({ ...runtimeDraft, envRows: runtimeDraft.envRows.filter((_, i) => i !== idx) }),
                },
                '',
              ),
            ),
          ),
        ),
  );
}

export function renderRuntimeEnvCard({
  selectedAgent,
  runtimeDraft,
  setRuntimeDraft,
  permissionOptions,
  savedFlash,
  busyAction,
  onSaveRuntimeAndEnv,
  t,
}) {
  return h(
    'div',
    { className: 'dsh-acp-card' },
    h(
      'div',
      { className: 'dsh-acp-card-header' },
      h(
        'div',
        { className: 'dsh-acp-card-header-copy' },
        h('h4', { className: 'dsh-acp-card-title' }, t('section.runtime')),
        h('p', { className: 'dsh-acp-card-desc' }, t('section.runtimeDesc')),
      ),
    ),
    h(
      'div',
      { className: 'dsh-acp-grid-2' },
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('label', { className: 'dsh-acp-field-label' }, t('field.name')),
        h(Input, { variant: 'form', value: runtimeDraft.name, onChange: (e) => setRuntimeDraft({ ...runtimeDraft, name: e.target.value }) }),
      ),
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('label', { className: 'dsh-acp-field-label' }, t('field.command')),
        h(Input, {
          variant: 'form',
          value: runtimeDraft.command ?? selectedAgent?.command ?? '',
          onChange: (e) => setRuntimeDraft({ ...runtimeDraft, command: e.target.value }),
        }),
      ),
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('label', { className: 'dsh-acp-field-label' }, t('field.badge')),
        h(Input, { variant: 'form', value: runtimeDraft.badge, onChange: (e) => setRuntimeDraft({ ...runtimeDraft, badge: e.target.value }) }),
      ),
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('label', { className: 'dsh-acp-field-label' }, t('field.args')),
        h(Input, { variant: 'form', value: runtimeDraft.argsText, onChange: (e) => setRuntimeDraft({ ...runtimeDraft, argsText: e.target.value }) }),
      ),
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('label', { className: 'dsh-acp-field-label' }, t('field.profileDir')),
        h(Input, {
          variant: 'form',
          value: runtimeDraft.profileDir,
          placeholder: t('field.profileDirPh'),
          onChange: (e) => setRuntimeDraft({ ...runtimeDraft, profileDir: e.target.value }),
        }),
      ),
    ),
    h(
      'div',
      { className: 'dsh-acp-field' },
      h('label', { className: 'dsh-acp-field-label' }, t('field.permission')),
      h(SettingsSelect, {
        variant: 'block',
        'aria-label': t('field.permission'),
        value: runtimeDraft.permissionPolicy,
        options: permissionOptions,
        onChange: (val) => setRuntimeDraft({ ...runtimeDraft, permissionPolicy: val }),
      }),
    ),
    renderEnvRowsEditor({ runtimeDraft, setRuntimeDraft, t }),
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '4px' } },
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          icon: savedFlash === 'save-runtime' ? h(IconCheckOutlineRegular, { size: 14 }) : undefined,
          loading: busyAction === 'save',
          onClick: () => void onSaveRuntimeAndEnv(),
        },
        savedFlash === 'save-runtime' ? t('action.savedDone') : t('action.saveRuntime'),
      ),
    ),
  );
}
