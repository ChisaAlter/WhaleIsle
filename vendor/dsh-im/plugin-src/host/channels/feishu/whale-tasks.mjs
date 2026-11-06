/** Same-process Feishu capabilities: no credentials or arbitrary targets reach the model. */
import crypto from 'node:crypto';
import path from 'node:path';
import { sharedWhaleSessionId, currentWhaleSessionResolution } from '../../../../src/channels/shared/whale-session.mjs';
import { stageInboundFiles } from '../../../../src/channels/shared/inbound-file.mjs';
import { extractInboundMessage } from '../../../../src/channels/feishu/message-utils.mjs';

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createFeishuTaskBinding(ctx, { botId, botConfig, workspaces, configStore }) {
  const incarnation = hash([botId, botConfig.appId, botConfig.createdAt, botConfig.connectedAt]);
  return {
    attach({ client, signal, allowedSenderOpenIds }) {
      let service;
      let dispose;
      const currentRouteStatus = route => {
        const current = configStore.list().find(row => row.id === botId);
        if (route.channel !== 'feishu' || route.botId !== botId || route.incarnation !== incarnation || !current
          || hash([botId, current.appId, current.createdAt, current.connectedAt]) !== route.incarnation
          || !workspaces.has(botId) || current.deletionPending) return 'revoked';
        const owners = current.ownerOpenIds ?? [];
        if (!owners.includes(route.actor) && !owners.includes('*')) return 'revoked';
        if (signal.aborted) return 'offline';
        const preset = workspaces.agentPresetFor(botId);
        if (preset && preset !== 'whale-girl') return 'revoked';
        try {
          service.assertImRoute(route);
          if (!currentWhaleSessionResolution(preset).sessionId) return 'revoked';
        } catch { return 'revoked'; }
        return 'ready';
      };
      const routeStatus = async route => {
        if (currentRouteStatus(route) !== 'ready') return currentRouteStatus(route);
        if (!await sharedWhaleSessionId({ agentPresetSettings: async () => ({ agentPreset: workspaces.agentPresetFor(botId) }) })) return 'revoked';
        return currentRouteStatus(route);
      };
      const channel = {
        status: routeStatus,
        async send(route, effectId, text, admit) {
          if (typeof admit !== 'function' || await routeStatus(route) !== 'ready') throw Object.assign(new Error('原飞书渠道不可用。'), { knownUnsent: true });
          // No await between final authorization and the provider dispatch.
          service.assertImRoute(route);
          if (currentRouteStatus(route) !== 'ready') throw Object.assign(new Error('原飞书渠道不可用。'), { knownUnsent: true });
          admit();
          // uuid gives the provider a stable deduplication key for this effect.
          try {
            const response = await client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: {
              receive_id: route.chatId, msg_type: 'text', content: JSON.stringify({ text }), uuid: hash(effectId).slice(0, 48),
            } });
            if (response?.code !== 0) {
              const error = new Error(`飞书拒绝投递 (${response?.code ?? 'invalid-response'})`);
              error.knownUnsent = Number.isInteger(response?.code);
              error.retryable = response?.code === 99991400;
              throw error;
            }
            const messageId = response?.data?.message_id;
            if (!messageId) return { outcome: 'unknown', providerMessageIds: [] };
            return { outcome: 'sent', providerMessageIds: [messageId] };
          } catch (error) {
            // A transport failure after dispatch is uncertain; never blindly resend it.
            throw error;
          }
        },
      };
      const connect = () => {
        const current = ctx.get('whaleTasks');
        if (current?.available && current !== service) {
          dispose?.(); service = current;
          dispose = current.registerChannel(`feishu:${botId}`, channel);
        }
      };
      connect();
      const off = ctx.on('internal/service', name => { if (name === 'whaleTasks') connect(); });
      const readyOff = ctx.on('whale-tasks/ready', connect);
      const close = () => { dispose?.(); off?.(); readyOff?.(); };
      signal.addEventListener('abort', close, { once: true });
      return {
        async handle(event, message, harness) {
          connect();
          const text = String(message.content ?? '').trim();
          if (!/^\/task(?:\s|$)/u.test(text)) return null;
          if (!service?.available) return '后台任务服务不可用，未接纳。';
          const actor = event.sender?.sender_id?.open_id;
          if (!actor || (!allowedSenderOpenIds.has(actor) && !allowedSenderOpenIds.has('*'))) return '当前用户不能提交后台任务。';
          if (!await sharedWhaleSessionId(harness)) return '当前机器人未进入鲸鱼娘共享对话，未接纳后台任务。';
          const route = { channel: 'feishu', botId, incarnation, actor, chatId: event.message.chat_id, messageId: event.message.message_id };
          if (await routeStatus(route) !== 'ready') return '原渠道已失效，未接纳任务。';
          const owner = service.store.owners.get(`feishu:${botId}`);
          if (!owner || owner.actor !== actor) return '请先在桌面鲸鱼娘设置的后台任务中，授权此飞书 botId 和个人 open_id。';
          let staged;
          try {
            const command = JSON.parse(text.slice('/task'.length).trim());
            const eventId = `feishu-${hash([botId, incarnation, event.message.message_id])}`;
            const prior = service.store.tasks.get(`task-${crypto.createHash('sha256').update(JSON.stringify([eventId])).digest('hex').slice(0, 32)}`);
            if (prior) return `此消息已接纳 ${prior.id}，状态：${prior.state}；未重复执行。`;
            const home = process.env.DSH_HOME;
            let inputMessage = message;
            if (!message.files?.length && event.message.parent_id) {
              const referenced = await client.im.message.get({ path: { message_id: event.message.parent_id } });
              const item = referenced?.data?.items?.[0];
              const referencedSender = item?.sender?.id;
              if (referenced?.code !== 0 || !item || item.chat_id !== route.chatId || referencedSender !== actor || item.msg_type !== 'file') throw new Error('引用资料必须是此用户在原会话发送的文件。');
              inputMessage = extractInboundMessage({ message: { message_id: item.message_id, message_type: item.msg_type, content: item.body?.content } }, client);
            }
            inputMessage = { ...inputMessage, files: (inputMessage.files ?? []).map(file => ({ ...file,
              load: async ({ signal: fileSignal } = {}) => {
                const value = await file.load({ signal: fileSignal, maxBytes: 100000 });
                if ((value?.length ?? 0) > 100000) throw new Error('附件超过单文件 100KB 限制。');
                return value;
              } })) };
            staged = await stageInboundFiles(inputMessage, { workspace: path.join(home, 'data', 'whale-task-inbound'), signal });
            if (!staged?.files?.length) return '请回复自己在此会话发送的文本文件，写 /task JSON；或用含文件块的富文本提交，不能读取任意本地路径。';
            const selected = command.files;
            if (!Array.isArray(selected) || !selected.length) return 'files 必须写本条消息附件的文件名。';
            const files = selected.map(name => {
              const file = staged.files.find(file => file.name === name);
              if (!file) throw new Error('files 包含本条消息未附带的文件。');
              return path.join(home, 'data', 'whale-task-inbound', file.path);
            });
            const origin = { eventId, kind: 'im', rpcId: eventId, messageId: `im-${hash(eventId)}`,
              sessionId: service.scope.get().sessionId, actor, route, files,
              text: `/task ${JSON.stringify({ ...command, files })}` };
            await service.recordInbound(origin, text);
            const task = await service.accept(origin);
            service.schedule(task.id);
            return `已接纳 ${task.id}，正在后台整理；完成后回到本飞书会话。\n这是接纳回执，尚未完成。可发 /task {"action":"status","taskId":"${task.id}"} 查询。`;
          } catch (error) { return `未接纳后台任务：${error.message}`; }
          finally { await staged?.cleanup(); }
        },
        async command(event, message) {
          connect();
          const text = String(message.content ?? '').trim();
          if (!/^\/task\s+\{/u.test(text)) return null;
          let command; try { command = JSON.parse(text.slice(5)); } catch { return null; }
          if (!command.action) return null;
          if (!['status', 'stop', 'resume'].includes(command.action) || Object.keys(command).some(key => !['action', 'taskId'].includes(key))) return 'action 仅支持 status、stop、resume，不接受模型或资料修改。';
          const actor = event.sender?.sender_id?.open_id;
          if (!service?.available || !actor) return '后台任务服务不可用。';
          let sendingStatus = false;
          try {
            const task = service.store.get(command.taskId); const route = task.origin.route;
            const validate = () => {
              if (task.origin.actor !== actor || route?.botId !== botId || route?.chatId !== event.message.chat_id || route?.incarnation !== incarnation
                || (!allowedSenderOpenIds.has(actor) && !allowedSenderOpenIds.has('*')) || currentRouteStatus(route) !== 'ready') throw new Error('任务授权或原会话已失效。');
            };
            validate();
            if (await routeStatus(route) !== 'ready') throw new Error('任务路线不可用。');
            validate();
            const eventId = `feishu-control-${hash([botId, incarnation, event.message.message_id])}`;
            const control = service.grantControl(task.id, command.action, { actor, eventId, messageId: event.message.message_id }, validate);
            if (command.action === 'stop') { await service.stop(task.id, 'user', control); return `已停止 ${task.id}，历史保留。`; }
            if (command.action === 'resume') { await service.resume(task.id, control); return `已明确继续 ${task.id}。`; }
            // Task data never enters the ordinary bridge sender: it uses the same guarded SDK boundary.
            sendingStatus = true;
            const receipt = await channel.send(route, eventId, JSON.stringify(service.view(task)), () => service.assertControl(task.id, 'status', control));
            return { taskReplySent: receipt.outcome === 'sent' };
          } catch (error) {
            if (sendingStatus && error.knownUnsent !== true) return '任务查询发送结果未确认，请先检查原会话或在桌面查看。';
            return '后台任务授权或原会话不可用，请在桌面查看；未返回任务内容。';
          }
        },
        close,
      };
    },
  };
}
