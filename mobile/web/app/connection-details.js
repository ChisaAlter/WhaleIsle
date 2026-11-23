// app/connection-details.js — extracted from app/settings.js to keep settings.js <= 800 lines.
import {
  formatCustomIceServersText,
  loadCustomIceServers,
  parseCustomIceServersText,
  saveCustomIceServers,
} from '../chisacode/session.js';
import { composerOffline, connectionLabel, operationError, setToast } from './chrome.js?v=20261117-app-split';
import { options, state } from './context.js?v=20261117-app-split';
import { descNode, ghostButton, groupNode, hairRow, primaryButton, sectionNode, valueNode } from './nodes.js?v=20261117-app-split';

/**
 * @param {{ onLogout: () => void, onRefresh?: () => void }} handlers
 */
export function renderConnectionDetailsPane({ onLogout, onRefresh }) {
  options.append(sectionNode(
    null,
    null,
    groupNode(
      hairRow('主机', '', valueNode(state.hostName)),
      hairRow('通道', '', valueNode(connectionLabel())),
      hairRow('状态', '', valueNode(composerOffline() ? (state.connLabel || '连接已断开') : '已连接')),
    ),
  ));

  if (state.transport === 'chisacode') {
    renderIceServersSection(onRefresh);
  }

  const danger = document.createElement('button');
  danger.type = 'button';
  danger.className = 'danger-btn';
  danger.textContent = '断开这台设备';
  danger.addEventListener('click', () => onLogout());
  options.append(sectionNode(null, '断开会清除这台手机保存的配对凭据和草稿；电脑上的会话不受影响。', danger));
}

/**
 * @param {(() => void) | undefined} onRefresh
 */
function renderIceServersSection(onRefresh) {
  const wrap = document.createElement('div');
  wrap.className = 'ice-servers-editor';
  wrap.style.cssText = 'padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;';

  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.placeholder = 'stun:stun.cloudflare.com:3478\nturn:example.com:3478?transport=tcp | 用户名 | 密码';
  textarea.value = formatCustomIceServersText(loadCustomIceServers());
  textarea.setAttribute('aria-label', '自定义 STUN/TURN 服务器');
  textarea.style.cssText = 'width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border, rgba(127,127,127,0.25)); background: transparent; color: inherit;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

  const resetBtn = ghostButton('恢复默认', () => {
    try {
      saveCustomIceServers([]);
      textarea.value = '';
      setToast('已恢复默认 STUN 服务器，下次连接生效', { tone: 'success' });
      onRefresh?.();
    } catch {
      operationError('无法清除 STUN/TURN 配置');
    }
  });

  const saveBtn = primaryButton('保存配置', () => {
    try {
      const parsed = parseCustomIceServersText(textarea.value);
      saveCustomIceServers(parsed);
      setToast(
        parsed.length ? `已保存 ${parsed.length} 条 ICE 服务器，下次连接生效` : '已恢复默认 STUN 服务器，下次连接生效',
        { tone: 'success' },
      );
      onRefresh?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      operationError(message || 'STUN/TURN 配置格式无效');
    }
  });

  actions.append(resetBtn, saveBtn);
  wrap.append(
    textarea,
    descNode('每行一条（可选）。TURN 格式：turn:host:port | 用户名 | 密码；留空使用默认公共 STUN。', 'row-desc'),
    actions,
  );
  options.append(sectionNode('P2P / ICE 服务器', '自定义 STUN/TURN 会与电脑端下发配置合并，用于 WebRTC 打洞升级。', groupNode(wrap)));
}
