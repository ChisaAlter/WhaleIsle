import { h, Button, Input, Modal, IconCheckOutlineRegular, IconChevronDownOutlineRegular } from './primitives.js';
import { ADD_PROVIDER_CARDS } from './utils.js';

function renderProviderTypeCard({ card, selected, onSelect }) {
  return h(
    'button',
    {
      key: card.id,
      type: 'button',
      className: 'dsh-acp-provider-card',
      'data-selected': selected ? 'true' : undefined,
      onClick: () => onSelect(card.id),
    },
    h(
      'span',
      { className: 'dsh-acp-provider-icon' },
      h('span', { className: 'dsh-acp-provider-icon-letter' }, card.mono || String(card.label || '?').slice(0, 1).toUpperCase()),
      card.icon
        ? h('img', {
            src: card.icon,
            alt: '',
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

export function renderAddAgentModal({ addModal, setAddModal, registryAgents, registryCards, busyAction, onCreate, t }) {
  if (!addModal) return null;
  const selectType = (id) => setAddModal((cur) => ({ ...cur, baseAgentId: id }));

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
      h(
        'div',
        { className: 'dsh-acp-field' },
        h('label', { className: 'dsh-acp-field-label' }, t('modal.addType')),
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
        h('label', { className: 'dsh-acp-field-label' }, t('modal.addName')),
        h(Input, {
          variant: 'form',
          value: addModal.name,
          placeholder: t('modal.addNamePh'),
          onChange: (e) => setAddModal({ ...addModal, name: e.target.value }),
        }),
      ),
      addModal.baseAgentId === 'custom'
        ? h(
            'div',
            { className: 'dsh-acp-field' },
            h('label', { className: 'dsh-acp-field-label' }, t('field.command')),
            h(Input, {
              variant: 'form',
              value: addModal.command,
              placeholder: 'e.g. my-agent-binary',
              onChange: (e) => setAddModal({ ...addModal, command: e.target.value }),
            }),
          )
        : null,
    ),
  );
}
