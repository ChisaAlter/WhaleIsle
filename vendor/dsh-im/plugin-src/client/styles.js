export const IM_STYLE_ID = 'xmanrui-dsh-im-settings';

/** Shared shell: rail + panel chrome aligned to dsh web tokens / capsule buttons. */
const CSS = String.raw`
.dim-page {
  --dim-blue: var(--dsw-alias-state-business-primary);
  --dim-blue-soft: color-mix(in srgb, var(--dim-blue) 9%, transparent);
  width: 100%;
  max-width: 1080px;
  padding: 2px 0 30px;
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
  font-family: var(--dsw-font-family);
}
.dim-page *, .dim-page *::before, .dim-page *::after { box-sizing: border-box; }
.dim-layout { display: grid; grid-template-columns: 174px 1px minmax(0, 1fr); gap: 24px; align-items: start; }
.dim-rail { max-height: 520px; display: grid; align-content: start; gap: 8px; overflow-y: auto; padding: 1px 4px 1px 1px; }
.dim-channel {
  width: 100%;
  min-height: 48px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  box-shadow: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, color .16s ease;
}
.dim-channel:hover {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-channel[aria-selected="true"] {
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-active));
}
.dim-channel:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dim-logo { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; box-shadow: none; }
.dim-logo svg { display: block; width: 20px; height: 20px; }
.dim-logoWeixin { color: white; background: #07c160; }
.dim-logoWeixin svg { width: 19px; height: 19px; }
.dim-logoFeishu { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); }
.dim-logoFeishu svg { width: 28px; height: 28px; }
.dim-logoDingtalk { color: white; background: #1677ff; }
.dim-logoDingtalk svg { width: 24px; height: 24px; }
.dim-logoQq { color: white; background: #1677ff; }
.dim-logoQq svg { width: 21px; height: 21px; }
.dim-logoWecom { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); }
.dim-logoWecom svg { width: 22px; height: 22px; }
.dim-logoTelegram { color: white; background: #229ed9; }
.dim-logoTelegram svg { width: 21px; height: 21px; }
.dim-logoOffice { color: white; background: var(--dsw-alias-state-business-primary); }
.dim-logoOffice svg { width: 23px; height: 23px; }
.dim-logoDiscord { color: white; background: #5865f2; }
.dim-logoDiscord svg { width: 21px; height: 21px; }
.dim-logoSlack { color: white; background: #4a154b; }
.dim-logoSlack svg { width: 21px; height: 21px; }
.dim-logoWhatsapp { color: white; background: #25d366; }
.dim-logoWhatsapp svg { width: 21px; height: 21px; }
.dim-channelCopy { min-width: 0; display: grid; }
.dim-channelCopy strong { overflow: hidden; color: inherit; font-size: 14px; line-height: 20px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.dim-channelNote { overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.dim-divider { width: 1px; min-height: 520px; background: var(--dsw-alias-border-l1); }
.dim-panel { min-width: 0; container-type: inline-size; }
.dim-loopbackRecovery {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 14px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, var(--dsw-alias-border-l2));
  border-radius: 12px;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1));
}
.dim-loopbackRecoveryCopy { min-width: 0; }
.dim-loopbackRecoveryCopy strong { display: block; font-size: 14px; line-height: 20px; font-weight: 600; }
.dim-loopbackRecoveryCopy p { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dim-loopbackRecoveryCopy code { display: block; overflow: hidden; margin-top: 5px; color: var(--dsw-alias-label-secondary); font: 11px/16px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); text-overflow: ellipsis; white-space: nowrap; }
.dim-loopbackRecoveryAction {
  flex: none;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-loopbackRecoveryAction:hover { background: var(--dsw-alias-button-primary-hover); }
.dim-loopbackRecoveryAction:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.dim-panel .bxf-page, .dim-panel .dxw-page, .dim-panel .ddt-page, .dim-panel .dqq-page, .dim-panel .dwecom-page, .dim-panel .dsl-page, .dim-panel .dwa-page { width: 100%; max-width: none; padding: 0 0 24px; }
.dim-panel .bxf-heading, .dim-panel .dxw-heading, .dim-panel .ddt-heading { justify-content: flex-end; }
.dim-panel .bxf-headingTools, .dim-panel .dxw-tools, .dim-panel .ddt-tools { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) max-content; align-items: center; justify-content: stretch; gap: 8px; }
.dim-panel .dim-bindActions { min-width: 0; display: flex; align-items: center; flex-wrap: nowrap; gap: 8px; }
.dim-panel .dim-bindActions > button { min-width: 0; }
/*
 * Header actions (扫码接入 / 手动接入) share one sizing contract across every channel.
 * Each channel renders these through its own base button class (.bxf-button / .dxw-button /
 * .ddt-button) which carries its own height, min-height, gap and font-size; the selectors below
 * are deliberately more specific than any of those (including .bxf-button[data-size="small"])
 * and set every box-affecting property so the base class cannot leak through.
 */
.dim-panel .bxf-headingTools .dim-scanButton,
.dim-panel .dxw-tools .dim-scanButton,
.dim-panel .ddt-tools .dim-scanButton,
.dim-panel .bxf-headingTools .dim-credentialButton,
.dim-panel .dxw-tools .dim-credentialButton,
.dim-panel .ddt-tools .dim-credentialButton {
  flex: none;
  height: 36px;
  min-height: 36px;
  max-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  gap: 6px;
  margin: 0;
  padding: 0 14px;
  border-radius: 18px;
  box-shadow: none;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transform: none;
}
.dim-panel .bxf-headingTools .dim-scanButton,
.dim-panel .dxw-tools .dim-scanButton,
.dim-panel .ddt-tools .dim-scanButton {
  border: none;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-panel .bxf-headingTools .dim-scanButton:hover:not(:disabled),
.dim-panel .dxw-tools .dim-scanButton:hover:not(:disabled),
.dim-panel .ddt-tools .dim-scanButton:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dim-panel .bxf-headingTools .dim-credentialButton,
.dim-panel .dxw-tools .dim-credentialButton,
.dim-panel .ddt-tools .dim-credentialButton {
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  background: transparent;
}
.dim-panel .bxf-headingTools .dim-credentialButton:hover:not(:disabled),
.dim-panel .dxw-tools .dim-credentialButton:hover:not(:disabled),
.dim-panel .ddt-tools .dim-credentialButton:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .bxf-headingTools .dim-credentialButton[aria-pressed="true"],
.dim-panel .dxw-tools .dim-credentialButton[aria-pressed="true"],
.dim-panel .ddt-tools .dim-credentialButton[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-bg-active);
}
.dim-panel .bxf-headingTools .dim-scanButton:disabled,
.dim-panel .dxw-tools .dim-scanButton:disabled,
.dim-panel .ddt-tools .dim-scanButton:disabled,
.dim-panel .bxf-headingTools .dim-credentialButton:disabled,
.dim-panel .dxw-tools .dim-credentialButton:disabled,
.dim-panel .ddt-tools .dim-credentialButton:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.dim-panel .dim-actionIcon { width: 16px; height: 16px; flex: 0 0 16px; }
.dim-panel .bxf-headingTools .dim-onlineBadge,
.dim-panel .dxw-tools .dim-onlineBadge,
.dim-panel .ddt-tools .dim-onlineBadge {
  height: 28px;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  justify-self: end;
  gap: 0;
  padding: 0 10px;
  border: 0;
  border-radius: 14px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  white-space: nowrap;
}
.dim-panel .dim-channelPage { min-width: 0; width: 100%; max-width: none; display: flex; flex-direction: column; gap: 12px; padding: 0 0 24px; color: var(--dsw-alias-label-primary); box-sizing: border-box; }
.dim-panel .dim-surfaceCard {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: none;
}
.dim-panel .dim-surfaceCard::before { display: none; }
.dim-panel .dim-surfaceBody { padding: 20px; }
.dim-panel .dim-credentialPanel { display: grid; gap: 16px; padding: 20px; }
.dim-panel .dim-credentialTitle { margin: 0; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-credentialForm { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; }
.dim-panel .dim-credentialFormSingle { grid-template-columns: minmax(0, 1fr); }
.dim-panel .dim-credentialField { min-width: 0; display: grid; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.dim-panel .dim-credentialField input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-module-platform);
  font: 13px/20px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  transition: border-color .16s ease;
}
.dim-panel .dim-credentialField input:focus {
  border-color: var(--dsw-alias-state-business-primary);
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dim-panel .dim-credentialField input::placeholder { color: var(--dsw-alias-label-tertiary); font-family: inherit; }
.dim-panel .dim-credentialError, .dim-panel .dim-credentialActions { grid-column: 1 / -1; }
.dim-panel .dim-credentialError { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dim-panel .dim-credentialActions { margin-top: 0; }
.dim-panel .dim-listSection { min-width: 0; width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 0; }
.dim-panel .dim-listHeading { min-height: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 6px; padding: 0; }
.dim-panel .dim-listHeading h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-weight: 600; }
.dim-panel .dim-listTitle { min-width: 0; display: inline-flex; align-items: center; gap: 6px; }
.dim-panel .dim-channelHelp { position: relative; display: inline-flex; flex: none; }
.dim-panel .dim-channelHelpButton {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  cursor: help;
  transition: border-color .15s ease, color .15s ease, background .15s ease;
}
.dim-panel .dim-channelHelpButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .dim-channelHelpButton:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dim-panel .dim-channelTooltip {
  position: absolute;
  top: calc(100% + 7px);
  left: 0;
  z-index: 30;
  width: max-content;
  max-width: min(280px, calc(100vw - 48px));
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-alias-shadow-lv2, 0 4px 16px rgb(0 0 0 / 8%));
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-3px);
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease, visibility .15s ease;
}
.dim-panel .dim-channelTooltip strong { color: var(--dsw-alias-label-primary); font-weight: 600; white-space: nowrap; }
.dim-panel .dim-channelHelp:hover .dim-channelTooltip, .dim-panel .dim-channelHelp:focus-within .dim-channelTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dim-panel .dim-botList { min-width: 0; width: 100%; max-width: 100%; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin: 0; padding: 0; list-style: none; }
.dim-panel .dim-botList > li { min-width: 0; max-width: 100%; }
.dim-panel .dim-loadingView { padding: 32px; color: var(--dsw-alias-label-secondary); text-align: center; }
.dim-panel .dim-loadingView h3 { margin: 0 0 8px; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-loadingView p { margin: 0; font-size: 14px; line-height: 22px; }
.dim-panel .dim-spinner {
  width: 24px;
  height: 24px;
  margin: 0 auto 12px;
  border: 3px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  animation: dim-spin .8s linear infinite;
}
@keyframes dim-spin { to { transform: rotate(360deg); } }
.dim-panel .dim-emptyView { min-height: 200px; display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 16px; }
.dim-panel .dim-emptyCopy { min-width: 0; }
.dim-panel .dim-emptyCopy h3 { margin: 8px 0; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-emptyCopy > p { max-width: 560px; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dim-panel .dim-emptyBrand { display: none; }
.dim-panel .dim-stateLabel { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.dim-panel .dim-stateDot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); box-shadow: none; }
.dim-panel .dim-stateDot[data-tone="success"] { background: var(--dsw-alias-state-success-primary); }
.dim-panel .dim-stateDot[data-tone="warning"] { background: var(--dsw-alias-state-warn-primary); }
.dim-panel .dim-stateDot[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
.dim-panel .dim-viewActions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.dim-panel .dim-viewActions .bxf-button,
.dim-panel .dim-viewActions .dxw-button,
.dim-panel .dim-viewActions .ddt-button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 18px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  box-shadow: none;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-panel .dim-viewActions .bxf-button:hover:not(:disabled),
.dim-panel .dim-viewActions .dxw-button:hover:not(:disabled),
.dim-panel .dim-viewActions .ddt-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .dim-viewActions .bxf-button[data-kind="primary"],
.dim-panel .dim-viewActions .dxw-button[data-kind="primary"],
.dim-panel .dim-viewActions .ddt-button[data-kind="primary"] {
  border: none;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-panel .dim-viewActions .bxf-button[data-kind="primary"]:hover:not(:disabled),
.dim-panel .dim-viewActions .dxw-button[data-kind="primary"]:hover:not(:disabled),
.dim-panel .dim-viewActions .ddt-button[data-kind="primary"]:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dim-panel .dim-viewActions .bxf-button[data-kind="danger"],
.dim-panel .dim-viewActions .dxw-button[data-kind="danger"],
.dim-panel .dim-viewActions .ddt-button[data-kind="danger"] {
  color: var(--dsw-alias-state-error-primary);
}
.dim-panel .dim-qrLayout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; align-items: start; }
.dim-panel .dim-qrColumn { width: 100%; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.dim-panel .dim-qrFrame {
  position: relative;
  width: min(270px, 100%);
  height: auto;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dim-panel .dim-qrFrame::before { display: none; }
.dim-panel .dim-qrFrame::after { display: none; }
.dim-panel .dim-qrFrame img { position: relative; z-index: 1; width: 100%; height: 100%; display: block; object-fit: contain; }
.dim-panel .dim-qrFallback { position: relative; z-index: 1; display: grid; place-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; text-align: center; }
.dim-panel .dim-qrExpired {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 20px;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  text-align: center;
  white-space: pre-line;
  backdrop-filter: blur(2px);
}
.dim-panel .dim-countdown { width: min(270px, 100%); margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dim-panel .dim-countdownTop { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.dim-panel .dim-countdownTop strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dim-panel .dim-progress { height: 4px; overflow: hidden; margin: 0; border-radius: 99px; background: var(--dsw-alias-bg-module-platform); }
.dim-panel .dim-progress span {
  display: block;
  width: var(--bxf-progress, var(--dxw-progress, var(--ddt-progress, 0%)));
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-state-business-primary);
  transition: width .25s linear;
}
.dim-panel .dim-qrCopy { min-width: 0; overflow-wrap: anywhere; }
.dim-panel .dim-qrCopy h3 { margin: 8px 0; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-qrCopy > p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dim-panel .dim-steps { margin: 16px 0; padding: 0; list-style: none; counter-reset: dim-step; }
.dim-panel .dim-steps li {
  position: relative;
  min-height: 28px;
  display: flex;
  align-items: center;
  padding: 4px 0 4px 36px;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 22px;
  counter-increment: dim-step;
}
.dim-panel .dim-steps li::before {
  content: counter(dim-step);
  position: absolute;
  left: 0;
  top: 4px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 12px;
  font-weight: 600;
}
.dim-panel .dim-specialView { padding: 32px; text-align: center; }
.dim-panel .dim-statusNotice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, var(--dsw-alias-border-l2));
  border-radius: 12px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-1));
  font-size: 13px;
  line-height: 20px;
}
.dim-panel .dim-inlineError {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-1));
}
.dim-panel .dim-inlineError > div { min-width: 0; }
.dim-panel .dim-inlineError h3 { margin: 0; color: inherit; font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-inlineError p { margin: 8px 0 0; color: inherit; font-size: 14px; line-height: 22px; }
.dim-panel .dim-confirm { padding: 16px 20px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-interactive-bg-hover); }
.dim-panel .dim-confirm strong, .dim-panel .dim-confirm h4 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-weight: 600; }
.dim-panel .dim-confirm p { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dim-panel .dim-cardFooter { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dim-panel .dim-workspace {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
}
.dim-panel .dim-workspaceHeader { display: contents; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dim-panel .dim-workspaceHeader > span { grid-column: 1; grid-row: 1; white-space: nowrap; }
.dim-panel .dim-workspaceEdit {
  grid-column: 2;
  grid-row: 1;
  padding: 0;
  border: 0;
  color: var(--dsw-alias-state-business-primary);
  background: transparent;
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-panel .dim-workspaceEdit:disabled { cursor: not-allowed; opacity: .4; }
.dim-panel .dim-workspacePath {
  min-width: 0;
  max-width: 100%;
  grid-column: 1 / -1;
  grid-row: 2;
  display: block;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font: 12px/18px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow-wrap: anywhere;
  white-space: normal;
}
.dim-panel .dim-preset {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
}
.dim-panel .dim-presetHeader {
  position: relative;
  min-width: 0;
  grid-column: 1 / -1;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dim-panel .dim-presetTitle { min-width: 0; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.dim-panel .dim-presetHelp { display: inline-flex; align-items: center; flex: none; }
.dim-panel .dim-presetHelpButton {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  cursor: help;
}
.dim-panel .dim-presetHelpButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .dim-presetHelpButton:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dim-panel .dim-presetTooltip {
  position: absolute;
  top: calc(100% + 7px);
  left: 0;
  z-index: 30;
  width: min(320px, 100%);
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-alias-shadow-lv2, 0 4px 16px rgb(0 0 0 / 8%));
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  overflow-wrap: anywhere;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-3px);
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease, visibility .15s ease;
}
.dim-panel .dim-presetHelp:hover .dim-presetTooltip, .dim-panel .dim-presetHelp:focus-within .dim-presetTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dim-panel .dim-presetStatus { grid-column: 2; grid-row: 1; color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
.dim-panel .dim-presetSelect {
  min-width: 0;
  max-width: 100%;
  grid-column: 1 / -1;
  grid-row: 2;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
  font-size: 12px;
}
.dim-panel .dim-presetSelect:disabled { cursor: not-allowed; opacity: .4; }
.dim-panel .dim-presetError { grid-column: 1 / -1; grid-row: 3; margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dim-directoryPickerBackdrop {
  --dim-blue: var(--dsw-alias-state-business-primary);
  --dim-blue-soft: color-mix(in srgb, var(--dim-blue) 9%, transparent);
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: blur(2px);
}
.dim-directoryPickerBackdrop, .dim-directoryPickerBackdrop *, .dim-directoryPickerBackdrop *::before, .dim-directoryPickerBackdrop *::after { box-sizing: border-box; }
.dim-directoryPicker {
  width: min(720px, 100%);
  height: min(620px, calc(100vh - 48px));
  min-height: 420px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 24px;
  outline: none;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-alias-shadow-lv3, 0 12px 40px rgb(0 0 0 / 12%));
}
.dim-directoryPickerHeader { min-width: 0; padding: 20px 24px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dim-directoryPickerHeader h3 { margin: 0 0 12px; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-directoryPickerHeader > p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dim-directoryCrumbs { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--dsw-alias-label-tertiary); }
.dim-directoryCrumbs button {
  max-width: 210px;
  overflow: hidden;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.dim-directoryCrumbs button:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dim-directoryCrumbs button[aria-current="page"] { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dim-directoryCrumbs button:focus-visible,
.dim-directoryList button:focus-visible,
.dim-directoryPickerActions button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dim-directoryCrumbSeparator { flex: none; font-size: 12px; }
.dim-directoryPickerBody { min-height: 0; overflow-y: auto; padding: 14px 16px; }
.dim-directoryList { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.dim-directoryList button {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dim-directoryList button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dim-directoryList button:disabled, .dim-directoryCrumbs button:disabled { cursor: wait; opacity: .4; }
.dim-directoryFolder { width: 24px; height: 24px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary); }
.dim-directoryFolder svg { width: 22px; height: 22px; }
.dim-directoryName { min-width: 0; overflow: hidden; font-size: 14px; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.dim-directoryChevron { width: 18px; height: 18px; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); }
.dim-directoryChevron svg { width: 17px; height: 17px; }
.dim-directoryPickerState { min-height: 210px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--dsw-alias-label-secondary); text-align: center; }
.dim-directoryPickerState p { margin: 0; font-size: 13px; line-height: 20px; }
.dim-directoryPickerSpinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  animation: dim-spin .8s linear infinite;
}
.dim-directoryPickerError {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, var(--dsw-alias-border-l2));
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-layer-1));
  font-size: 12px;
  line-height: 18px;
}
.dim-directoryPickerError button {
  flex: none;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.dim-directoryPickerTruncated { margin: 10px 4px 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dim-directoryPickerFooter {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dim-directoryHidden {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  border: 0;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.dim-directoryHidden:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.dim-directoryHidden:disabled { cursor: not-allowed; opacity: .4; }
.dim-directoryHiddenBox {
  position: relative;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
}
.dim-directoryHidden[aria-pressed="true"] .dim-directoryHiddenBox {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-directoryHidden[aria-pressed="true"] .dim-directoryHiddenBox::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid var(--dsw-alias-label-primary-foreground);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.dim-directoryPickerNotice { min-width: 0; margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; text-align: right; }
.dim-directoryPickerActions { display: flex; gap: 8px; }
.dim-directoryPickerActions button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 18px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-directoryPickerActions .dim-directoryPickerPrimary {
  border: none;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-directoryPickerActions .dim-directoryPickerPrimary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dim-directoryPickerActions button:hover:not(:disabled):not(.dim-directoryPickerPrimary) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-directoryPickerActions button:disabled { cursor: not-allowed; opacity: .4; }
.dim-panel .dim-cardSummary { min-width: 0; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; font-weight: 400; line-height: 18px; overflow-wrap: anywhere; white-space: normal; }
.dim-panel .dim-cardFooterLayout { min-width: 0; width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.dim-panel .dim-cardFooterLayout > .dim-cardActions { align-self: stretch; }
.dim-panel .dim-cardFeedback {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.dim-panel .dim-cardActions { flex: none; width: 100%; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin: 0; }
.dim-panel .dim-cardActions .dim-cardAction {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-panel .dim-cardActions .dim-cardAction:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dim-panel .dim-cardActions .dim-cardAction[data-kind="danger"] { color: var(--dsw-alias-state-error-primary); }
.dim-panel .dim-botCard {
  position: relative;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: none;
}
.dim-panel .dim-botCard::before { display: none; }
.dim-panel .dim-botCardBody { position: relative; min-width: 0; width: 100%; max-width: 100%; padding: 12px; }
.dim-panel .dim-botCardTop { min-width: 0; max-width: 100%; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dim-panel .dim-botIdentity { min-width: 0; flex: 1 1 0; display: flex; align-items: center; gap: 10px; }
.dim-panel .dim-botAvatar { flex: none; width: 36px; height: 36px; display: grid; place-items: center; overflow: hidden; border-radius: 8px; box-shadow: none; }
.dim-panel .dim-botAvatar svg { width: 24px; height: 24px; }
.dim-panel .dim-botName { min-width: 0; }
.dim-panel .dim-botName h3 { overflow: hidden; margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.dim-panel .dim-botName p { overflow: hidden; margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font: 12px/18px var(--ds-font-family-code, ui-monospace, SFMono-Regular, monospace); text-overflow: ellipsis; white-space: nowrap; }
.dim-panel .dim-botHealthGroup { min-width: 0; max-width: 100%; flex: none; display: grid; justify-items: end; gap: 4px; }
.dim-panel .dim-botCard .dim-botHealth {
  flex: none;
  min-height: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  white-space: nowrap;
}
.dim-panel .dim-lastChecked { display: inline-flex; align-items: baseline; gap: 4px; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; font-weight: 400; line-height: 16px; white-space: nowrap; }
.dim-panel .dim-botCard .dim-healthDot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); box-shadow: none; }
.dim-panel .dim-botCard .dim-healthDot[data-tone="success"] { background: var(--dsw-alias-state-success-primary); }
.dim-panel .dim-botCard .dim-healthDot[data-tone="warning"] { background: var(--dsw-alias-state-warn-primary); }
.dim-panel .dim-botCard .dim-healthDot[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
.dim-panel .dim-botCard .dim-cardFooter { margin-top: 0; }
.dim-panel .ddt-headingCopy { display: none; }
.dim-panel .ddt-qrFrame, .dim-panel .ddt-countdown { width: min(270px, 100%); }
@container (max-width: 680px) {
  .dim-panel .bxf-headingTools, .dim-panel .dxw-tools, .dim-panel .ddt-tools { gap: 6px; }
  .dim-panel .dim-botCardTop { flex-direction: column; align-items: stretch; }
  .dim-panel .dim-botHealthGroup { justify-items: start; }
  .dim-panel .dim-bindActions { gap: 6px; }
  .dim-panel .bxf-headingTools .dim-scanButton,
  .dim-panel .dxw-tools .dim-scanButton,
  .dim-panel .ddt-tools .dim-scanButton,
  .dim-panel .bxf-headingTools .dim-credentialButton,
  .dim-panel .dxw-tools .dim-credentialButton,
  .dim-panel .ddt-tools .dim-credentialButton {
    height: 28px;
    min-height: 28px;
    max-height: 28px;
    gap: 4px;
    padding: 0 10px;
    border-radius: 14px;
    font-size: 12px;
    line-height: 18px;
  }
  .dim-panel .dim-actionIcon { width: 14px; height: 14px; flex-basis: 14px; }
  .dim-panel .bxf-headingTools .dim-onlineBadge,
  .dim-panel .dxw-tools .dim-onlineBadge,
  .dim-panel .ddt-tools .dim-onlineBadge { padding-inline: 8px; font-size: 11px; }
  .dim-panel .dim-credentialForm { grid-template-columns: minmax(0, 1fr); }
  .dim-panel .dim-credentialError, .dim-panel .dim-credentialActions { grid-column: auto; }
  .dim-panel .dim-emptyView { min-height: 0; }
  .dim-panel .dim-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; gap: 24px; }
  .dim-panel .dim-qrColumn { width: 100%; min-width: 0; }
  .dim-panel .dim-qrCopy { width: 100%; min-width: 0; overflow-wrap: anywhere; }
  .dim-panel .ddt-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; gap: 24px; }
  .dim-panel .ddt-qrColumn { width: 100%; min-width: 0; }
  .dim-panel .ddt-qrCopy { width: 100%; min-width: 0; overflow-wrap: anywhere; }
}
@media (max-width: 840px) {
  .dim-layout { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .dim-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dim-divider { display: none; }
  .dim-rail { max-height: none; overflow: visible; padding-right: 1px; }
  .dim-channel { min-height: 48px; }
}
@media (max-width: 720px) {
  .dim-panel .dim-botCardTop { flex-direction: column; align-items: stretch; }
  .dim-panel .dim-botHealthGroup { justify-items: start; }
}
@media (max-width: 560px) {
  .dim-rail { grid-template-columns: minmax(0, 1fr); }
  .dim-loopbackRecovery { align-items: stretch; flex-direction: column; gap: 12px; }
  .dim-loopbackRecoveryAction { width: 100%; }
  .dim-directoryPickerBackdrop { padding: 10px; }
  .dim-directoryPicker { height: calc(100vh - 20px); min-height: 0; border-radius: 16px; }
  .dim-directoryPickerHeader { padding: 16px; }
  .dim-directoryPickerHeader h3 { font-size: 16px; }
  .dim-directoryPickerBody { padding: 10px; }
  .dim-directoryPickerFooter { grid-template-columns: minmax(0, 1fr) max-content; gap: 10px; padding: 12px 14px; }
  .dim-directoryPickerNotice { grid-column: 1 / -1; grid-row: 1; text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  .dim-page * { transition-duration: .01ms !important; }
  .dim-directoryPickerSpinner { animation-duration: 1.8s; }
}
.dim-busyButton { position: relative; }
.dim-buttonContent { display: contents; }
.dim-busyButton[data-loading="true"] .dim-buttonContent { visibility: hidden; }
.dim-buttonSpinner, .dim-controlSpinner { width: 14px; height: 14px; box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dim-feedback-spin .8s linear infinite; }
.dim-buttonSpinner { position: absolute; top: 50%; left: 50%; margin: -7px 0 0 -7px; }
.dim-controlSpinner { position: absolute; right: 28px; top: 50%; margin-top: -7px; pointer-events: none; color: var(--dsw-alias-label-secondary); }
.dim-controlBusy { position: relative; display: block; min-width: 0; }
.dim-preset > .dim-controlBusy, .dim-responseMode > .dim-controlBusy { grid-column: 1 / -1; grid-row: 2; }
.dim-controlBusy > select { display: block; width: 100%; }
.dim-confirmBackdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 24px; background: var(--dsw-alias-mask-bg, rgba(0,0,0,.35)); }
.dim-confirmDialog { width: min(480px, 100%); max-height: calc(100vh - 48px); overflow: auto; box-sizing: border-box; padding: 20px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv3); font-size: 14px; line-height: 22px; }
.dim-confirmDialog strong, .dim-confirmDialog h4 { margin: 0; font: inherit; font-weight: 600; }
.dim-confirmDialog p { margin: 8px 0 16px; color: var(--dsw-alias-label-secondary); }
.dim-confirmDialog .dim-viewActions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.dim-confirmDialog button { position: relative; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.dim-confirmDialog button[data-kind="danger"] { color: var(--dsw-alias-state-error-primary); }
.dim-confirmDialog button:disabled { opacity: .5; cursor: not-allowed; }
@keyframes dim-feedback-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dim-buttonSpinner, .dim-controlSpinner { animation: none; } }
`;

export function installImStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${IM_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = IM_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
