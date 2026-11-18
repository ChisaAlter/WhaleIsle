/* dsh-acp-agents client: ACP account settings and Agent-first model selection. */
import { h, useEffect, useSyncExternalStore } from './primitives.js';
import { NS, SETTINGS_SECTION_ID, rpcValue } from './utils.js';
import { zh, en } from './locale.js';
import { injectCss } from './styles.js';
import { AgentsSettingsSection } from './settings-section.js';
import { AgentModelSelect } from './picker.js';
import { AgentSessionOptions } from './session-options.js';
import { delegationDefinition, DelegationRow } from './delegation.js';

function SettingsNavigationBridge({ actions, bind }) {
  useEffect(() => bind(actions), [actions, bind]);
  return null;
}

export const name = NS;
export const inject = ['slots', 'locale', 'connection'];

export function apply(ctx) {
  injectCss();
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-acp-agents: dictionaries');
  const t = ctx.locale.bind(NS);
  const connection = ctx.connection ?? ctx.get?.('connection');

  const rpc = async (endpoint, input = {}) =>
    rpcValue(await connection.rpc.call('/dsh-acp-agents', endpoint, input));

  let settingsActions;
  const bindSettingsActions = (actions) => {
    settingsActions = actions;
    return () => {
      if (settingsActions === actions) settingsActions = undefined;
    };
  };
  const openAgentSettings = () => {
    try {
      const nav = ctx.get('settingsNavigation');
      if (typeof nav?.open === 'function') {
        nav.open(SETTINGS_SECTION_ID);
        return true;
      }
      if (typeof settingsActions?.openSection === 'function') {
        settingsActions.openSection(SETTINGS_SECTION_ID);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Standard 0.2.2 owns navigation in the sidebar.settings root store.
  // Share its declared handle through a root slot so the renderer supplies
  // the live actions. Never create a second shell instance or claim its children.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.inject('shell.overlay', () => {
      let shell;
      let disposeBridge;
      const sync = () => {
        const next = ctx.slots.entriesOfSlot('sidebar.settings')[0];
        if (shell === next) return;
        disposeBridge?.();
        disposeBridge = undefined;
        settingsActions = undefined;
        shell = next;
        if (typeof shell?.store?.spec.actions.openSection !== 'function') return;
        disposeBridge = ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'dsh-acp-settings-navigation',
            store: shell.store,
            inject: () => ({ bind: bindSettingsActions }),
          },
          SettingsNavigationBridge,
        );
      };
      const unsubscribe = ctx.slots.subscribe('sidebar.settings', sync);
      sync();
      return () => {
        unsubscribe();
        disposeBridge?.();
        settingsActions = undefined;
      };
    }),
  );

  ctx.inject(['uiConversation', 'uiWorkspace'], (scope) => {
    scope.uiConversation.events.register(delegationDefinition);
    scope.slots.inject('conversation.chat.node', () =>
      scope.slots.register(
        {
          name: 'conversation.chat.node',
          key: 'acp-delegation',
          locale: NS,
          inject: (parentSessionId) => ({
            openChild: (childSessionId) =>
              scope.uiWorkspace.openSession({ parentSessionId, childSessionId, mode: 'continuable' }),
            readStatus: (data) =>
              rpc('delegation-status', { parentSessionId, runId: data.runId, childId: data.childId }),
          }),
        },
        DelegationRow,
      ),
    );
  });

  // 1. Register Settings -> Agent row (`settings.section` with id 'acp-agents').
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: SETTINGS_SECTION_ID,
        order: 12,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ rpc, t }),
      },
      AgentsSettingsSection,
    ),
  );

  // Extend the host-owned menu. Re-declaring its children in a replacement
  // picker violates the standard slot's single-owner lifetime contract.
  ctx.inject(['slots', 'modelDirectories'], (scope) => {
    const models = scope.modelDirectories;
    scope.slots.inject('conversation.input.model.options', () =>
      scope.slots.register(
        {
          name: 'conversation.input.model.options',
          id: 'dsh-acp-options',
          order: 20,
          locale: NS,
          inject: (sessionId) => ({
            sessionId,
            directory: models.directoryFor(sessionId).store,
            rpc,
            openAgentSettings,
            t,
          }),
        },
        AgentSessionOptions,
      ),
    );
  });

  // Restore the Agent-first picker over the SAME host directory. Do not
  // redeclare the native picker's child slots: they retain their owner.
  ctx.inject(['slots', 'modelDirectories', 'sessions'], (scope) => {
    const optionSlot = 'conversation.input.model.options';
    function PickerWithTeam(props) {
      useSyncExternalStore(
        (fn) => scope.slots.subscribe(optionSlot, fn),
        () => scope.slots.getVersion(optionSlot),
      );
      const entries = scope.slots.entriesOfSlot(optionSlot);
      return h(AgentModelSelect, {
        ...props,
        renderHostOptions: (owner) =>
          entries
            .filter((entry) => entry.options.id === 'agent-team')
            .map((entry) =>
              h(entry.component, {
                ...props,
                ...entry.inject?.(props.sessionId),
                ...owner,
                key: entry.options.id,
                t: ctx.locale.bind(entry.locale),
              }),
            ),
      });
    }
    scope.slots.inject('conversation.input.model', () =>
      scope.slots.register(
        {
          name: 'conversation.input.model',
          priority: -10,
          locale: NS,
          inject: (sessionId) => {
            const directory = scope.modelDirectories.directoryFor(sessionId);
            const available = scope.sessions.subagentAddress(sessionId) === undefined;
            return {
              sessionId,
              available,
              directory: directory.store,
              load: () => {
                if (available) {
                  directory.load().catch((error) => {
                    console.warn('[dsh-acp/client/client.js] background operation failed', error);
                  });
                }
              },
              select: (selection) => (available ? directory.select(selection) : Promise.resolve(undefined)),
              rpc,
              openAgentSettings,
              t,
            };
          },
        },
        PickerWithTeam,
      ),
    );
  });
}
