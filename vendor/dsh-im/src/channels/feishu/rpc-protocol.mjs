/** Pure endpoint names shared by the Feishu Host and browser client. */
export const FEISHU_RPC_CHANNEL = '/feishu';

export const FEISHU_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  beginProvisioning: 'provision.begin',
  beginCallbackRepair: 'bot.callback-repair.begin',
  beginGroupMessagePermission: 'bot.group-message-permission.begin',
  pollProvisioning: 'provision.poll',
  cancelProvisioning: 'provision.cancel',
  bindCredentials: 'bot.bind-credentials',
  reconnectBot: 'bot.reconnect',
  disconnectBot: 'bot.disconnect',
  deleteBot: 'bot.delete',
  setWorkspace: 'bot.workspace.set',
  setAgentPreset: 'bot.preset.set',
  setGroupResponseMode: 'bot.group-response-mode.set',
  // Kept for rolling upgrades. The multi-bot UI never calls these endpoints.
  testConnection: 'connection.test',
  disconnect: 'connection.disconnect',
});
