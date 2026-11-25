import { h, Button, Input, Modal, IconCheckOutlineRegular, IconChevronDownOutlineRegular } from './primitives.js';
import { ADD_PROVIDER_CARDS, safeHttpsIconUrl } from './utils.js';

function renderProviderTypeCard({ card, selected, onSelect }) {
  const iconUrl = safeHttpsIconUrl(card.icon);
  return h(
    'button',
    {
      key: card.id,
      type: 'button',
      className: 'dsh-acp-provider-card',
      'data-selected': selected ? 'true' : undefined,
      'aria-pressed': selected,
      onClick: () => onSelect(card.id),
    },
    h(
      'span',
      { className: 'dsh-acp-provider-icon', 'aria-hidden': true },
      h('span', { className: 'dsh-acp-provider-icon-letter' }, card.mono || String(card.label || '?').slice(0, 1).toUpperCase()),
      iconUrl
        ? h('img', {
            src: iconUrl,
            alt: '',
            decoding: 'async',
            referrerPolicy: 'no-referrer',
            onError: (e) => {
              e.currentTarget.style.display = 'none';
            },
          })
        : null,
    ),
    h('span', { className: 'dsh-acp-provider-name' }, card.label),
    selected ? h(IconCheckOutlineRegular, { className: 'dsh-acp-provider-check', size: 14 }) : null,
  );
}

export function renderDeleteResetModal({ confirmDelete, selectedAgent, busyAction, onClose, onConfirm, t }) {
  if (!confirmDelete || !selectedAgent) return null;
  return h(
    Modal,
    {
      open: true,
      onClose,
      title: selectedAgent.builtin ? t('modal.resetTitle') : t('modal.deleteTitle'),
      closeLabel: t('modal.close'),
      footer: h(
        'div',
        { className: 'dsh-acp-modal-footer' },
        h(Button, { variant: 'outline', size: 'sm', onClick: onClose }, t('modal.cancel')),
        h(
          Button,
          { variant: 'primary', size: 'sm', loading: busyAction === 'delete', onClick: () => void onConfirm() },
          selectedAgent.builtin ? t('action.reset') : t('action.delete'),
        ),
      ),
    },
    h(
      'p',
      { style: { margin: 0 } },
      selectedAgent.builtin ? t('modal.resetBody', { name: selectedAgent.name }) : t('modal.deleteBody', { name: selectedAgent.name }),
    ),
  );
}

export function renderAddAgentModal({ addModal, setAddModal, registryAgents, registryCards, busyAction, idPrefix, onCreate, t }) {
  if (!addModal) return null;
  const selectType = (id) => setAddModal((cur) => ({ ...cur, baseAgentId: id, error: null }));
  const nameId = `${idPrefix}-add-name`;
  const commandId = `${idPrefix}-add-command`;

  return h(
    Modal,
    {
      open: true,
      onClose: () => setAddModal(null),
      title: t('modal.addTitle'),
      closeLabel: t('modal.close'),
      footer: h(
        'div',
        { className: 'dsh-acp-modal-footer' },
        h(Button, { variant: 'outline', size: 'sm', onClick: () => setAddModal(null) }, t('modal.cancel')),
        h(Button, { variant: 'primary', size: 'sm', loading: busyAction === 'create-instance', onClick: () => void onCreate() }, t('modal.create')),
      ),
    },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      addModal.error ? h('p', { className: 'dsh-acp-modal-error', role: 'alert' }, addModal.error) : null,
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('span', { className: 'dsh-acp-field-label' }, t('modal.addType')),
        h(
          'div',
          { className: 'dsh-acp-provider-grid' },
          ADD_PROVIDER_CARDS.map((card) =>
            renderProviderTypeCard({ card, selected: addModal.baseAgentId === card.id, onSelect: selectType }),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-acp-showmore',
            'data-open': addModal.showMore ? 'true' : undefined,
            'aria-expanded': Boolean(addModal.showMore),
            onClick: () => setAddModal((cur) => ({ ...cur, showMore: !cur.showMore })),
          },
          addModal.showMore ? t('modal.showLess') : t('modal.showMore'),
          h(IconChevronDownOutlineRegular, { size: 12 }),
        ),
        addModal.showMore
          ? h(
              'div',
              { className: 'dsh-acp-registry' },
              h(Input, {
                variant: 'form',
                value: addModal.registryQuery || '',
                placeholder: t('modal.registrySearchPh'),
                'aria-label': t('modal.registrySearchPh'),
                onChange: (e) => setAddModal((cur) => ({ ...cur, registryQuery: e.target.value })),
              }),
              registryAgents === null
                ? h('div', { className: 'dsh-acp-registry-hint' }, t('modal.registryLoading'))
                : h(
                    'div',
                    { className: 'dsh-acp-provider-grid dsh-acp-registry-grid' },
                    registryCards.map((card) =>
                      renderProviderTypeCard({ card, selected: addModal.baseAgentId === card.id, onSelect: selectType }),
                    ),
                    renderProviderTypeCard({
                      card: { id: 'custom', label: t('modal.customCard'), mono: '>_' },
                      selected: addModal.baseAgentId === 'custom',
                      onSelect: selectType,
                    }),
                    registryCards.length === 0 ? h('div', { className: 'dsh-acp-registry-hint' }, t('modal.registryEmpty')) : null,
                  ),
            )
          : null,
      ),
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('label', { className: 'dsh-acp-field-label', htmlFor: nameId }, t('modal.addName')),
        h(Input, {
          id: nameId,
          variant: 'form',
          value: addModal.name,
          placeholder: t('modal.addNamePh'),
          onChange: (e) => setAddModal({ ...addModal, name: e.target.value, error: null }),
        }),
      ),
      addModal.baseAgentId === 'custom'
        ? h(
            'div',
            { className: 'dsh-acp-field' },
            h('label', { className: 'dsh-acp-field-label', htmlFor: commandId }, t('field.command')),
            h(Input, {
              id: commandId,
              variant: 'form',
              value: addModal.command,
              placeholder: t('modal.commandPh'),
              onChange: (e) => setAddModal({ ...addModal, command: e.target.value, error: null }),
            }),
          )
        : null,
    ),
  );
}
