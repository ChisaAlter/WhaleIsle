import { h, Fragment, Button, Input, StateDot, IconCheckOutlineRegular } from './primitives.js';
import { FLOW_MESSAGE_KEYS, maskEmail } from './utils.js';

function renderAccountIdentitySummary({ account, revealEmail, setRevealEmail, t }) {
  const identityLabel = account?.authenticated
    ? account.name || account.authLabel || t('status.authenticated')
    : t('account.notLoggedIn');
  return h(
    'div',
    { className: 'dsh-acp-account-user' },
    h(StateDot, { state: account?.authenticated ? 'done' : 'warning', size: 12 }),
    account?.email
      ? h(
          'span',
          {
            className: 'dsh-acp-account-email',
            title: t('account.reveal'),
            onClick: () => setRevealEmail((v) => !v),
          },
          revealEmail ? account.email : maskEmail(account.email),
        )
      : h('span', { style: { fontWeight: 600, fontSize: '13px' } }, identityLabel),
    account?.plan ? h('span', { className: 'dsh-acp-badge', 'data-tone': 'plan' }, account.plan) : null,
    account?.authLabel ? h('span', { className: 'dsh-acp-badge' }, account.authLabel) : null,
  );
}

function renderAccountActionButtons({ selectedAgent, account, busyAction, onStartLogin, onReauth, onLogout, t }) {
  return h(
    'div',
    { className: 'dsh-acp-card-actions' },
    h(
      Button,
      {
        variant: 'primary',
        size: 'sm',
        loading: busyAction === 'login',
        disabled: !selectedAgent.binaryFound,
        onClick: () => void onStartLogin(Boolean(account?.authenticated)),
      },
      account?.authenticated ? t('action.relogin') : t('action.login'),
    ),
    account?.authenticated
      ? h(Button, { variant: 'outline', size: 'sm', loading: busyAction === 'reauth', onClick: () => void onReauth() }, t('action.reauth'))
      : null,
    account?.authenticated
      ? h(Button, { variant: 'outline', size: 'sm', loading: busyAction === 'logout', onClick: () => void onLogout() }, t('action.logout'))
      : null,
  );
}

function renderAccountStatusBox(props) {
  const { selectedAgent, account, t } = props;
  const profileDir = selectedAgent.profileDir || account?.profileDir;
  return h(
    'div',
    { className: 'dsh-acp-account-box' },
    h('div', { className: 'dsh-acp-account-row' }, renderAccountIdentitySummary(props), renderAccountActionButtons(props)),
    account?.message ? h('div', { className: 'dsh-acp-account-msg' }, account.message) : null,
    profileDir ? h('div', { className: 'dsh-acp-meta-line' }, `${t('account.profileDir')}: ${profileDir}`) : null,
  );
}

function renderTerminalAuthForm({ flowInteraction, terminalDraft, setTerminalDraft, onRespondFlow, t }) {
  if (flowInteraction?.type !== 'terminal') return null;
  return h(
    Fragment,
    null,
    flowInteraction.output ? h('pre', { className: 'dsh-acp-flow-terminal' }, flowInteraction.output) : null,
    h(
      'form',
      {
        className: 'dsh-acp-flow-callback',
        onSubmit: (event) => {
          event.preventDefault();
          const data = terminalDraft;
          if (!data) return;
          setTerminalDraft('');
          void onRespondFlow({ type: 'terminal', data: `${data}\n` });
        },
      },
      h('input', {
        className: 'dsh-acp-raw-input',
        type: 'text',
        value: terminalDraft,
        autoComplete: 'off',
        placeholder: t('login.terminalPh'),
        onInput: (e) => setTerminalDraft(e.target.value),
      }),
      h(Button, { type: 'submit', variant: 'outline', size: 'sm', disabled: !terminalDraft }, t('action.continue')),
    ),
  );
}

function renderCredentialsAuthForm({ flowInteraction, flowCredDraft, setFlowCredDraft, onRespondFlow, t }) {
  if (flowInteraction?.type !== 'credentials') return null;
  return h(
    'form',
    {
      className: 'dsh-acp-grid-2',
      onSubmit: (event) => {
        event.preventDefault();
        void onRespondFlow({ type: 'credentials', values: flowCredDraft }).then((sent) => {
          if (sent) setFlowCredDraft({});
        });
      },
    },
    (flowInteraction.fields || []).map((field) =>
      h(
        'label',
        { key: field.name, className: 'dsh-acp-field' },
        h('span', null, field.label || field.name),
        h('input', {
          className: 'dsh-acp-raw-input',
          type: field.secret ? 'password' : 'text',
          value: flowCredDraft[field.name] ?? '',
          autoComplete: 'off',
          onInput: (e) => setFlowCredDraft((cur) => ({ ...cur, [field.name]: e.target.value })),
        }),
      ),
    ),
    h(Button, { type: 'submit', variant: 'outline', size: 'sm' }, t('action.connect')),
  );
}

function renderAuthFlowPanel({
  activeFlow,
  flowPhase,
  flowActive,
  flowInteraction,
  flowUrl,
  copiedUrl,
  terminalDraft,
  setTerminalDraft,
  flowCredDraft,
  setFlowCredDraft,
  callbackDraft,
  setCallbackDraft,
  onCancelFlow,
  onOpenLoginUrl,
  onCopyLoginUrl,
  onRespondFlow,
  onCompleteFlow,
  t,
}) {
  if (!activeFlow || !flowPhase || flowPhase === 'idle') return null;
  let dotState = 'ongoing';
  if (flowPhase === 'succeeded') dotState = 'done';
  else if (flowPhase === 'failed' || flowPhase === 'cancelled') dotState = 'warning';

  let flowText = t('login.waitingBrowser');
  if (activeFlow.message) {
    flowText = FLOW_MESSAGE_KEYS[activeFlow.message] ? t(FLOW_MESSAGE_KEYS[activeFlow.message]) : activeFlow.message;
  }

  return h(
    'div',
    { className: 'dsh-acp-flow-box' },
    h(
      'div',
      { className: 'dsh-acp-flow-top' },
      h('div', { className: 'dsh-acp-flow-status' }, h(StateDot, { state: dotState, size: 14 }), h('span', null, flowText)),
      activeFlow.interaction?.userCode ? h('span', { className: 'dsh-acp-flow-code' }, activeFlow.interaction.userCode) : null,
      flowActive
        ? h(Button, { variant: 'outline', size: 'sm', onClick: () => void onCancelFlow() }, t('action.cancelLogin'))
        : null,
    ),
    flowUrl
      ? h(
          'div',
          { className: 'dsh-acp-flow-url-row' },
          h('div', { className: 'dsh-acp-flow-url', title: flowUrl }, flowUrl),
          h(Button, { variant: 'primary', size: 'sm', onClick: () => void onOpenLoginUrl() }, t('action.openBrowser')),
          h(
            Button,
            { variant: 'outline', size: 'sm', onClick: () => void onCopyLoginUrl() },
            copiedUrl ? t('action.copied') : t('action.copyUrl'),
          ),
        )
      : null,
    renderTerminalAuthForm({ flowInteraction, terminalDraft, setTerminalDraft, onRespondFlow, t }),
    renderCredentialsAuthForm({ flowInteraction, flowCredDraft, setFlowCredDraft, onRespondFlow, t }),
    flowUrl && flowInteraction?.type === 'browser' && flowInteraction.acceptsCallback
      ? h(
          'form',
          {
            className: 'dsh-acp-flow-callback',
            onSubmit: (event) => {
              event.preventDefault();
              void onCompleteFlow(callbackDraft.trim());
            },
          },
          h(
            'label',
            { className: 'dsh-acp-field' },
            h('span', null, t('login.callbackHint')),
            h('input', {
              className: 'dsh-acp-raw-input',
              type: 'url',
              value: callbackDraft,
              autoComplete: 'off',
              onInput: (e) => setCallbackDraft(e.target.value),
            }),
          ),
          h(Button, { type: 'submit', variant: 'outline', size: 'sm', disabled: !callbackDraft.trim() }, t('action.continue')),
        )
      : null,
  );
}

function renderCredentialFieldsBox({ fields, credDraft, setCredDraft, savedFlash, busyAction, onSaveCredentials, t }) {
  if (!fields || fields.length === 0) return null;
  return h(
    'div',
    { className: 'dsh-acp-account-box' },
    h(
      'div',
      { className: 'dsh-acp-grid-2' },
      fields.map((field) =>
        h(
          'div',
          { key: field.key, className: 'dsh-acp-field' },
          h('label', { className: 'dsh-acp-field-label' }, field.label),
          h(Input, {
            variant: 'form',
            type: field.secret ? 'password' : 'text',
            value: credDraft[field.key] ?? '',
            placeholder: field.placeholder || '',
            onChange: (e) => setCredDraft({ ...credDraft, [field.key]: e.target.value }),
          }),
        ),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'flex-end' } },
      h(
        Button,
        {
          variant: 'primary',
          size: 'sm',
          icon: savedFlash === 'save-creds' ? h(IconCheckOutlineRegular, { size: 14 }) : undefined,
          loading: busyAction === 'save-creds',
          onClick: () => void onSaveCredentials(),
        },
        savedFlash === 'save-creds' ? t('action.savedDone') : t('action.saveCredentials'),
      ),
    ),
  );
}

export function renderAccountAuthCard(props) {
  const { availableMethods, activeAuthMethod, setActiveAuthMethod, currentMethodDef, t } = props;
  return h(
    'div',
    { className: 'dsh-acp-card' },
    h(
      'div',
      { className: 'dsh-acp-card-header' },
      h(
        'div',
        { className: 'dsh-acp-card-header-copy' },
        h('h4', { className: 'dsh-acp-card-title' }, t('section.account')),
        h('p', { className: 'dsh-acp-card-desc' }, t('section.accountDesc')),
      ),
    ),
    renderAccountStatusBox(props),
    availableMethods.length > 1
      ? h(
          'div',
          { className: 'dsh-acp-auth-methods' },
          availableMethods.map((m) =>
            h(
              'button',
              {
                key: m.id,
                type: 'button',
                className: 'dsh-acp-auth-method-card',
                'data-active': m.id === activeAuthMethod ? 'true' : 'false',
                onClick: () => setActiveAuthMethod(m.id),
              },
              h('span', { className: 'dsh-acp-auth-method-title' }, m.label),
              h('span', { className: 'dsh-acp-auth-method-desc' }, m.description),
            ),
          ),
        )
      : null,
    renderAuthFlowPanel(props),
    renderCredentialFieldsBox({ ...props, fields: currentMethodDef?.fields }),
  );
}
