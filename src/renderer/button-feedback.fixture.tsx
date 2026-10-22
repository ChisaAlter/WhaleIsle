import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button } from '../../vendor/deepseek-harness/packages/client/ui-primitives/src/Button';
import { ActionButton } from '../../vendor/dsh-im/plugin-src/client/feedback';
import { installImStyles } from '../../vendor/dsh-im/plugin-src/client/styles';
import { installFeishuStyles } from '../../vendor/dsh-im/plugin-src/client/channels/feishu/styles';
import { installDingtalkStyles } from '../../vendor/dsh-im/plugin-src/client/channels/dingtalk/styles';
import { installWeixinStyles } from '../../vendor/dsh-im/plugin-src/client/channels/weixin/styles';
import { installTelegramStyles } from '../../vendor/dsh-im/plugin-src/client/channels/telegram/styles';
import '../../vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css';

installFeishuStyles();
installWeixinStyles();
installTelegramStyles();
installImStyles();
installDingtalkStyles();

function ImReferencePair({ id, loading, feedback, children, ...props }: {
  id: string; loading: boolean; feedback?: string; children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'id'>) {
  return <>
    <button type="button" {...props} id={`im-ref-${id}-native`} data-im-native={id} disabled={loading}>
      {children}
    </button>
    <ActionButton {...props} id={`im-ref-${id}-shared`} data-im-shared={id} loading={loading}
      feedback={feedback ?? (loading ? '正在处理完整设置…' : undefined)}>
      {children}
    </ActionButton>
  </>;
}

function ImReferences({ loading, feedback }: { loading: boolean; feedback?: string }) {
  const state = { loading, feedback };
  return <>
    <section className="dim-page dim-panel" style={{ padding: 20, width: 900 }}>
      <div className="bxf-page">
        <div className="bxf-actions">
          <ImReferencePair {...state} id="feishu-regular" className="bxf-button" data-kind="secondary"><span>检查连接</span></ImReferencePair>
        </div>
        <div className="bxf-responseModePermissionAction">
          <ImReferencePair {...state} id="feishu-small" className="bxf-button bxf-responseModePermissionButton" data-kind="secondary" data-size="small"><span>去授权</span></ImReferencePair>
        </div>
      </div>
      <div className="ddt-page">
        <div className="ddt-actions">
          <ImReferencePair {...state} id="dingtalk-regular" className="ddt-button" data-kind="secondary">重新生成二维码</ImReferencePair>
        </div>
        <div className="dim-cardActions">
          <ImReferencePair {...state} id="card-action" className="ddt-button dim-cardAction" data-kind="secondary">检查连接</ImReferencePair>
        </div>
        <div className="ddt-actions dim-viewActions dim-credentialActions">
          <ImReferencePair {...state} id="credential-submit" className="ddt-button" type="submit" data-kind="primary">绑定并连接</ImReferencePair>
        </div>
        <div className="dtg-accessActions">
          <ImReferencePair {...state} id="telegram-submit" className="ddt-button" type="submit" data-kind="secondary">保存访问设置</ImReferencePair>
        </div>
      </div>
      <div className="dxw-page"><div className="dxw-actions">
        <ImReferencePair {...state} id="weixin-regular" className="dxw-button" data-kind="secondary">继续连接</ImReferencePair>
      </div></div>
    </section>
    <section className="dim-confirmDialog ddt-confirm dim-confirm">
      <div className="ddt-actions dim-viewActions">
        <ImReferencePair {...state} id="confirm" className="ddt-button" data-kind="danger">确认移除接入</ImReferencePair>
      </div>
    </section>
  </>;
}

const root = createRoot(document.getElementById('root')!);
function render(mode: string) {
  const loading = mode.startsWith('busy');
  const feedback = mode === 'busy-progress' ? '正在下载组件 42%' : mode === 'result' ? 'Configuration saved' : undefined;
  flushSync(() => root.render(<><main style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 30 }}>
    <Button id="short" size="sm" loading={loading} feedback={feedback ?? (loading ? '保存中…' : undefined)}>保存</Button>
    <Button id="english" style={{ width: 56 }} loading={loading} feedback={feedback ?? (loading ? 'Saving configuration' : undefined)}>Save</Button>
    <Button id="wide" style={{ width: 220 }} loading={loading} feedback={loading ? 'Saving' : undefined}>Save</Button>
    <Button id="compound" loading={loading} aria-label={loading ? 'Opening settings' : undefined}><svg width="16" height="16" /><span>打开设置</span></Button>
    <Button id="icon" style={{ width: 28, padding: 0 }} loading={loading} aria-label="Refresh"><svg width="16" height="16" /></Button>
    <section className="dim-page dim-panel" style={{ width: 'auto', padding: 0 }}><div className="bxf-headingTools">
      <ActionButton id="im" className="bxf-button dim-scanButton" loading={loading} feedback={feedback ?? (loading ? '正在接入飞书机器人…' : undefined)}><svg width="16" height="16" /><span>扫码接入</span></ActionButton>
    </div></section>
    <Button id="compact" size="sm" style={{ height: 26 }} loading={loading} feedback={loading ? '正在提交价格设置…' : undefined}>提交</Button>
  </main><ImReferences loading={loading} feedback={feedback} /></>));
}
(window as any).feedbackBench = { render };
render('idle');
