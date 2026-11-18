/* dsh-whale client: assistant settings, Inbox/Outbox projections, and session affordances. */
window.__ModuleLoader__.load({
  id: "dsh-whale",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { createElement: h, useState, useEffect, useMemo, useCallback, useRef, Fragment } = react;
    const { Button, Input, Modal, Menu, SettingsSelect, StateDot, Switch, Toast, Tooltip, IconSettingsOutline16,
      IconDownloadOutlineRegular, IconEllipsisOutline16, IconPlusOutline16, IconPanelRightOutline16, IconPinOutlineRegular } = primitives;

    const NS = "dsh-whale";
    const PANEL_ID = "whale";
    const INBOX_PANEL_ID = "whale-inbox";
    const OUTBOX_PANEL_ID = "whale-outbox";

    const zh = {
      "tab": "鲸鱼娘",
      "page.title": "鲸鱼娘助理",
      "page.subtitle": "常驻个人助理——她可以统筹会话、记住事情，还能让桌宠开口说话。",
      "page.open": "打开会话",
      "page.preparing": "正在准备她的会话…",
      "page.openFailed": "打开失败：{message}",
      "page.gotoSettings": "去设置",
      "page.settingsUnavailable": "设置导航不可用",
      "gear.tooltip": "助理设置",
      "field.identity": "名字与称呼",
      "field.identityHint": "她的显示名 · 她平时怎么叫你（留空就叫「你」）。",
      "field.name": "名字",
      "field.namePh": "鲸鱼娘",
      "field.userTitle": "对你的称呼",
      "field.userTitlePh": "主人",
      "field.personaText": "额外人设",
      "field.personaTextHint": "追加到人格末尾的自由文本，留空即不用。",
      "field.memoryRow": "长期记忆",
      "field.memoryEdit": "查看与编辑",
      "edit": "编辑",
      "field.model": "默认模型",
      "field.modelHint": "她自己会话的默认路由，留空跟随会话默认。",
      "field.modelDefault": "跟随会话默认",
      "field.effort": "推理强度",
      "field.effortDefault": "默认",
      "field.imDefault": "IM 接入同一对话",
      "field.imDefaultHint": "未指定其他预设的 IM 机器人进入她的常驻会话，消息和桌面共用一份记录。",
      "tasks.title": "后台资料任务",
      "tasks.hint": "只读指定文本；完成与投递分别记录，重启后等你继续。",
      "tasks.refresh": "刷新任务",
      "tasks.empty": "还没有后台任务。可在聊天发送 /task JSON，或在这里开始。",
      "tasks.goal": "整理目标",
      "tasks.files": "资料绝对路径（每行一个）",
      "tasks.start": "开始只读整理",
      "tasks.stop": "停止",
      "tasks.resume": "继续",
      "tasks.owner": "飞书后台权限",
      "tasks.bot": "飞书 botId",
      "tasks.actor": "个人 open_id",
      "tasks.grant": "授权此人提交附件整理",
      "tasks.revoke": "撤销此机器人任务授权",
      "skills.title": "技能",
      "skills.manage": "管理",
      "skills.count": "已启用 {enabled} / {total}",
      "skills.empty": "还没有技能——把 SKILL.md 目录放进 {dir} 即可被她发现。",
      "memory.title": "长期记忆",
      "memory.hint": "MEMORY.md 的内容会随她的会话一起注入。可以直接编辑，或让她用 whale_remember 自己记。",
      "memory.save": "保存记忆",
      "memory.clear": "清空记忆",
      "memory.clearTitle": "清空长期记忆",
      "memory.clearConfirm": "确定清空她的长期记忆？此操作不可撤销。",
      "memory.clearAction": "确认清空",
      "memory.cleared": "长期记忆已清空",
      "dialog.cancel": "取消",
      "dialog.close": "关闭",
      "save": "保存",
      "saved": "已保存",
      "saving": "正在保存…",
      "loading": "正在读取…",
      "retry": "重试",
      "saveFailed": "保存失败：{message}",
      "loadFailed": "读取失败：{message}",
      "ops.inbox": "收件箱",
      "ops.outbox": "待审批",
      "ops.inboxSubtitle": "查看发现、机会与待分拣事项。",
      "ops.outboxSubtitle": "审批队列：核对动作、目标、风险与策略状态。",
      "ops.empty": "这里还没有事项。",
      "ops.loading": "正在读取收件箱…",
      "ops.unavailable": "桌面策略桥不可用。",
      "ops.loadFailed": "读取失败：{message}",
      "ops.retry": "重试",
      "ops.refresh": "刷新",
      "ops.title": "标题",
      "ops.level": "级别",
      "ops.status": "状态",
      "ops.source": "来源",
      "ops.target": "目标",
      "ops.action": "动作",
      "ops.approve": "批准",
      "ops.reject": "拒绝",
      "ops.pendingPolicy": "等待运行时策略确认",
      "ops.waitingApproval": "等待审批",
      "ops.noDecision": "当前状态不可裁决",
    };
    const en = {
      "tab": "Whale",
      "page.title": "Whale Assistant",
      "page.subtitle": "Your resident assistant — she orchestrates sessions, remembers things, and speaks through the desktop pet.",
      "page.open": "Open session",
      "page.preparing": "Preparing her session…",
      "page.openFailed": "Open failed: {message}",
      "page.gotoSettings": "Open settings",
      "page.settingsUnavailable": "Settings navigation is unavailable",
      "gear.tooltip": "Assistant settings",
      "field.identity": "Name & title",
      "field.identityHint": "Her display name · how she addresses you (blank means \"you\").",
      "field.name": "Name",
      "field.namePh": "Whale",
      "field.userTitle": "How she calls you",
      "field.userTitlePh": "boss",
      "field.personaText": "Extra persona",
      "field.personaTextHint": "Free text appended to her persona; leave empty to skip.",
      "field.memoryRow": "Long-term memory",
      "field.memoryEdit": "View & edit",
      "edit": "Edit",
      "field.model": "Default model",
      "field.modelHint": "The default route for her own session; blank follows the session default.",
      "field.modelDefault": "Follow session default",
      "field.effort": "Reasoning effort",
      "field.effortDefault": "Default",
      "field.imDefault": "Share the conversation with IM",
      "field.imDefaultHint": "IM bots without another selected preset enter her resident session and share its desktop history.",
      "tasks.title": "Background document tasks",
      "tasks.hint": "Read selected text only. Completion and delivery are separate; restart waits for you.",
      "tasks.refresh": "Refresh tasks",
      "tasks.empty": "No tasks yet. Send /task JSON in chat, or start here.",
      "tasks.goal": "Summary goal",
      "tasks.files": "Absolute input paths (one per line)",
      "tasks.start": "Start read-only summary",
      "tasks.stop": "Stop",
      "tasks.resume": "Continue",
      "tasks.owner": "Feishu task permission",
      "tasks.bot": "Feishu botId",
      "tasks.actor": "Personal open_id",
      "tasks.grant": "Allow this person to summarize attachments",
      "tasks.revoke": "Revoke this bot's task permission",
      "skills.title": "Skills",
      "skills.manage": "Manage",
      "skills.count": "{enabled} of {total} enabled",
      "skills.empty": "No skills yet — drop a SKILL.md folder under {dir} for her to discover.",
      "memory.title": "Long-term memory",
      "memory.hint": "MEMORY.md is injected with her session. Edit it here, or let her write via whale_remember.",
      "memory.save": "Save memory",
      "memory.clear": "Clear memory",
      "memory.clearTitle": "Clear long-term memory",
      "memory.clearConfirm": "Clear her long-term memory? This cannot be undone.",
      "memory.clearAction": "Confirm clear",
      "memory.cleared": "Long-term memory cleared",
      "dialog.cancel": "Cancel",
      "dialog.close": "Close",
      "save": "Save",
      "saved": "Saved",
      "saving": "Saving…",
      "loading": "Loading…",
      "retry": "Retry",
      "saveFailed": "Save failed: {message}",
      "loadFailed": "Load failed: {message}",
      "ops.inbox": "Inbox",
      "ops.outbox": "Approvals",
      "ops.inboxSubtitle": "Review discovered items, opportunities, and decisions.",
      "ops.outboxSubtitle": "Approval queue: verify action, target, risk, and policy state.",
      "ops.empty": "Nothing here yet.",
      "ops.loading": "Loading Inbox…",
      "ops.unavailable": "The desktop policy bridge is unavailable.",
      "ops.loadFailed": "Load failed: {message}",
      "ops.retry": "Retry",
      "ops.refresh": "Refresh",
      "ops.title": "Title",
      "ops.level": "Level",
      "ops.status": "Status",
      "ops.source": "Source",
      "ops.target": "Target",
      "ops.action": "Action",
      "ops.approve": "Approve",
      "ops.reject": "Reject",
      "ops.pendingPolicy": "Waiting for runtime policy confirmation",
      "ops.waitingApproval": "Waiting for approval",
      "ops.noDecision": "This item is no longer actionable",
    };

    function injectCss() {
      if (document.getElementById("dsh-whale-css")) return;
      const style = document.createElement("style");
      style.id = "dsh-whale-css";
      style.textContent = `
.dsh-whale-page { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 64px 32px 32px; height: 100%; box-sizing: border-box; overflow: auto; }
.dsh-whale-hero { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.dsh-whale-badge { width: 56px; height: 56px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); }
.dsh-whale-title { font-size: 20px; font-weight: 600; line-height: 28px; }
.dsh-whale-sub { font-size: 13px; opacity: 0.6; line-height: 1.7; max-width: 420px; }
.dsh-whale-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; max-width: 480px; padding: 16px 18px; border: 1px solid var(--dsw-alias-border-primary, rgba(128,128,128,.25)); border-radius: 12px; background: var(--dsw-alias-bg-secondary, transparent); }
.dsh-whale-card-name { font-size: 14px; font-weight: 600; }
.dsh-whale-card-sub { font-size: 11px; opacity: 0.5; margin-top: 3px; font-family: var(--ds-font-family-code, monospace); word-break: break-all; }
.dsh-whale-card button { flex: none; white-space: nowrap; }
.dsh-whale-links { display: flex; gap: 12px; }
/* Settings rows follow the platform Setting-Cell pattern: flat rows with a
   bottom hairline, title/desc text block on the left, control on the right. */
.dsh-whale-form { display: flex; flex-direction: column; width: 100%; max-width: 880px; }
.dsh-whale-item { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 14px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); }
.dsh-whale-item-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 32px; }
.dsh-whale-item-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsh-whale-item-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-whale-task-dialog { max-height: 100%; }
.dsh-whale-task-content { min-height: 0; overflow: hidden; }
.dsh-whale-task-content > [data-dsh-modal-header] { flex: none; }
.dsh-whale-task-content > :last-child { min-height: 0; overflow-y: auto; scrollbar-gutter: stable; }
.dsh-whale-task-fields { gap: 16px; }
.dsh-whale-task-actions { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 8px; }
.dsh-whale-task-fields label { display: flex; flex-direction: column; gap: 8px; }
.dsh-whale-task-fields details { padding: 8px 0; overflow-wrap: anywhere; }
.dsh-whale-task-fields summary { cursor: pointer; }
.dsh-whale-group { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); padding: 16px 0 0; }
.dsh-whale-hint { font-size: 11px; opacity: 0.55; line-height: 1.5; }
.dsh-whale-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.dsh-whale-cell-input { width: 180px; flex: none; }
.dsh-whale-controls .dsh-whale-cell-input { width: 150px; }
.dsh-whale-cell-input input { text-align: right; }
.dsh-whale-form .dsh-whale-cell-input:focus-within { border-color: var(--dsw-alias-border-l4, rgba(128,128,128,.4)); }
.dsh-whale-edit { border: 0; background: transparent; color: var(--dsw-alias-state-business-primary, inherit); font: inherit; font-size: 12px; cursor: pointer; padding: 2px 4px; opacity: 0.85; }
.dsh-whale-edit:hover { opacity: 1; }
.dsh-whale-textarea { width: 100%; min-height: 96px; resize: vertical; box-sizing: border-box; padding: 8px 10px; font: inherit; font-size: 13px; line-height: 20px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-primary, transparent); color: var(--dsw-alias-label-primary, inherit); }
.dsh-whale-textarea:focus { outline: none; border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.3)); }
.dsh-whale-dialog-textarea { min-height: 220px; }
.dsh-whale-danger-button { --dsw-alias-button-primary-fill: var(--dsw-alias-state-error-primary); --dsw-alias-button-primary-hover: var(--dsw-alias-state-error-primary); }
.dsh-whale-skills { max-height: 46vh; overflow: auto; }
.dsh-whale-modal-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsh-whale-skill-name { font-size: 13px; font-family: var(--ds-font-family-code, monospace); }
.dsh-whale-gear { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-tertiary, currentColor); cursor: pointer; }
.dsh-whale-gear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); color: var(--dsw-alias-label-primary, currentColor); }
.dsh-whale-ops-page { display: flex; flex-direction: column; gap: 18px; width: 100%; max-width: 880px; padding: 32px; box-sizing: border-box; overflow: auto; }
.dsh-whale-ops-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dsh-whale-ops-heading { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsh-whale-ops-title { font-size: 20px; line-height: 28px; font-weight: 600; }
.dsh-whale-ops-subtitle { font-size: 13px; line-height: 19px; color: var(--dsw-alias-label-tertiary, currentColor); }
.dsh-whale-ops-list { display: flex; flex-direction: column; gap: 10px; }
.dsh-whale-ops-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-primary, rgba(128,128,128,.25)); border-radius: 12px; background: var(--dsw-alias-bg-secondary, transparent); }
.dsh-whale-ops-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dsh-whale-ops-card-title { min-width: 0; font-size: 14px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
.dsh-whale-ops-card-level { flex: none; padding: 2px 7px; border-radius: 999px; font: 11px/16px var(--ds-font-family-code, monospace); color: var(--dsw-alias-label-secondary, currentColor); background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); }
.dsh-whale-ops-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.dsh-whale-ops-field { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dsh-whale-ops-label { font-size: 10px; line-height: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--dsw-alias-label-tertiary, currentColor); }
.dsh-whale-ops-value { min-width: 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-whale-ops-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.dsh-whale-ops-empty { padding: 28px 16px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-tertiary, currentColor); border: 1px dashed var(--dsw-alias-border-primary, rgba(128,128,128,.25)); border-radius: 12px; }
.dsh-whale-ops-error { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #c0392b); }
@media (max-width: 620px) {
  .dsh-whale-ops-page { padding: 20px 16px; }
  .dsh-whale-ops-header { flex-direction: column; }
  .dsh-whale-ops-grid { grid-template-columns: minmax(0, 1fr); }
}
`;
      document.head.appendChild(style);
    }

    function rpcValue(response) {
      const result = response?.result ?? response;
      if (result && result.ok === false) {
        const error = new Error(result.error?.message || String(result.error || "rpc failed"));
        error.rpcError = result.error;
        throw error;
      }
      return result?.value ?? result;
    }

    function Feedback({ text, t, success, loading, actions }) {
      const [visible, setVisible] = useState(true);
      useEffect(() => { setVisible(true); }, [text]);
      if (!visible || !text) return null;
      return h(Toast, {
        key: text,
        text,
        tone: success ? "success" : undefined,
        holdMs: success ? undefined : null,
        dismissLabel: loading || actions ? undefined : t("dialog.close"),
        icon: loading ? h(StateDot, { state: "ongoing", size: 14 }) : undefined,
        actions,
        onDone: () => setVisible(false),
      });
    }

    const WHALE_HEAD_URL = "/whale-isle-head.png";

    // Project mark rendered inside the ship-owned slots. The host's public
    // asset is byte-identical to assets/whale-head.png.
    function WhalePanelGlyph({ size }) {
      const px = size ?? 18;
      const imageProps = {
        className: "dsh-whale-head",
        width: px,
        height: px,
        alt: "",
        "aria-hidden": "true",
        draggable: false,
      };
      return h(Fragment, null,
        h("img", { ...imageProps, src: WHALE_HEAD_URL, "data-dsh-mascot": "default" }),
        h("img", { ...imageProps, src: "claude-isle-head.png", "data-dsh-mascot": "claude" }),
      );
    }

    // No document-check glyph ships in ui-primitives. Match its regular
    // 16px, current-color artwork without adding a separate icon library.
    function ApprovalPanelGlyph({ size = 18 }) {
      return h("svg", {
        width: size, height: size, viewBox: "0 0 16 16",
        fill: "none", stroke: "currentColor", strokeWidth: 1,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
      },
        h("path", { d: "M9.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.5L9.5 1.5Z" }),
        h("path", { d: "M9.5 1.5v4h4M5.5 9l1.75 1.75 3.25-3.25" }),
      );
    }

    // The panel row label follows the configured assistant name:
    // re-registering bumps the slot ledger, which re-syncs the label.
    let panelName = "鲸鱼娘";
    let panelDispose = null;
    let panelSlots = null;
    const refreshPanelLabel = (name) => {
      const next = String(name ?? "").trim();
      if (!next || next === panelName) return;
      panelName = next;
      if (panelSlots) {
        panelDispose?.();
        panelDispose = panelSlots.register({
          name: "sidebar.panellist", id: PANEL_ID, order: 20, label: () => panelName, locale: NS,
        }, WhalePanelGlyph);
      }
    };

    // Footer fallback for hosts without sidebar region tabs: a single
    // button that opens the assistant session directly.
    function WhaleFooterEntry(props) {
      const { rpc, openSession, mode, t, wide } = props;
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [attempt, setAttempt] = useState(0);
      const open = useCallback(async () => {
        if (busy) return;
        setAttempt((current) => current + 1);
        setBusy(true);
        setError("");
        try {
          if (mode) { await mode.openAssistant(); return; }
          const ensured = await rpc("assistant/ensure");
          const sessionId = ensured?.sessionId;
          if (!sessionId) throw new Error("no-session");
          await openSession(sessionId);
        } catch (err) {
          setError(t("page.openFailed", { message: err?.message || String(err) }));
        } finally {
          setBusy(false);
        }
      }, [rpc, openSession, mode, t, busy]);
      return h(Fragment, null, h(Button, {
        type: "button",
        variant: "ghost",
        size: "sm",
        "aria-label": t("tab"),
        disabled: busy,
        loading: busy,
        onClick: open,
        style: {
          border: "none", background: "transparent", cursor: "pointer",
          font: "inherit", fontSize: "14px", padding: wide ? "4px 8px" : "4px",
          height: "auto",
          display: "inline-flex", alignItems: "center", gap: "6px",
        },
      }, h("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
        h(WhalePanelGlyph, { size: 18 }), wide ? h("span", null, t("tab")) : null)),
      error ? h(Feedback, { key: attempt, text: error, t }) : null);
    }

    // The 助理 panel row opens her persistent session directly: this `main`
    // entry exists only to satisfy selectPanel(id) — it immediately hands off
    // to the conversation panel with the whale session selected.
    function WhaleRedirect(props) {
      const { rpc, openSession, mode, layout, settingsNavigation, t } = props;
      const [error, setError] = useState("");
      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            if (mode) { await mode.openAssistant(); return; }
            const ensured = await rpc("assistant/ensure");
            const sessionId = ensured?.sessionId;
            if (!sessionId) throw new Error("no-session");
            await openSession(sessionId);
            if (!cancelled) layout?.selectPanel?.(null);
          } catch (err) {
            if (!cancelled) setError(err?.message || String(err));
          }
        })();
        return () => { cancelled = true; };
      }, [rpc, openSession, mode, layout]);
      const openSettings = useCallback(async () => {
        try {
          if (typeof settingsNavigation?.open !== "function") throw new Error(t("page.settingsUnavailable"));
          await settingsNavigation.open("pet");
        } catch (err) {
          setError(err?.message || String(err));
        }
      }, [settingsNavigation, t]);
      return h("div", { className: "dsh-whale-page" },
        h("div", { className: "dsh-whale-hero" },
          h("span", { className: "dsh-whale-badge", "aria-hidden": "true" },
            h(WhalePanelGlyph, { size: 36 })),
          h("div", { className: "dsh-whale-title" }, panelName),
          h("div", { className: "dsh-whale-sub" }, t("page.subtitle")),
        ),
        h(Feedback, {
          text: error ? t("page.openFailed", { message: error }) : t("page.preparing"),
          t,
          loading: !error,
          actions: error ? [{ label: t("page.gotoSettings"), onClick: openSettings }] : undefined,
        }),
      );
    }

    // Title-adjacent gear on her session header — only for the whale-owned
    // session; every other conversation keeps its stock action row.
    function WhaleHeaderGear(props) {
      const { sessionId, useSessions, settingsNavigation, mode, t } = props;
      const [error, setError] = useState("");
      const [busy, setBusy] = useState(false);
      const [attempt, setAttempt] = useState(0);
      const isWhale = useSessions?.((state) =>
        state?.byId?.[sessionId]?.presentation?.owner === "dsh-whale:assistant") ?? false;
      const openSettings = useCallback(async () => {
        if (busy) return;
        setAttempt((current) => current + 1);
        setBusy(true);
        setError("");
        try {
          if (typeof settingsNavigation?.open !== "function") throw new Error(t("page.settingsUnavailable"));
          await settingsNavigation.open("pet");
        } catch (err) {
          setError(t("page.openFailed", { message: err?.message || String(err) }));
        } finally {
          setBusy(false);
        }
      }, [settingsNavigation, t, busy]);
      if (!isWhale) return null;
      return h(Fragment, null, mode ? h(Button, { variant: "ghost", size: "sm", disabled: mode.get().busy, onClick: () => void mode.choose(true) }, mode.tr("大肥鱼模式", "Big Fish mode")) : null, h(Tooltip, { label: t("gear.tooltip"), side: "bottom" },
        h(Button, {
          type: "button",
          variant: "ghost",
          className: "dsh-whale-gear",
          "aria-label": t("gear.tooltip"),
          disabled: busy,
          loading: busy,
          onClick: openSettings,
        }, h(IconSettingsOutline16, { size: 16, "aria-hidden": "true" })),
      ), error ? h(Feedback, { key: attempt, text: error, t }) : null);
    }

    // The host renders presentation titles as text, so the project head is
    // supplied as the leading identity mark in the header instead.
    function WhaleHeaderMark(props) {
      const { sessionId, useSessions } = props;
      const isWhale = useSessions?.((state) =>
        state?.byId?.[sessionId]?.presentation?.owner === "dsh-whale:assistant") ?? false;
      if (!isWhale) return null;
      return h(WhalePanelGlyph, { size: 16 });
    }

    function WhaleTaskSettings({ rpc, t }) {
      const [open, setOpen] = useState(false);
      const [items, setItems] = useState([]);
      const [goal, setGoal] = useState("");
      const [files, setFiles] = useState("");
      const [bot, setBot] = useState("");
      const [actor, setActor] = useState("");
      const [error, setError] = useState("");
      const [pending, setPending] = useState(false);
      const load = async () => { const value = await rpc("tasks/list"); if (!value.available) throw new Error(value.error || t("loadFailed", { message: "unavailable" })); setItems(value.tasks); };
      const act = async (method, input) => {
        setPending(true); setError("");
        try { await rpc(method, input); await load(); } catch (err) { setError(err.message); } finally { setPending(false); }
      };
      return h(Fragment, null,
        h("div", { className: "dsh-whale-item" },
          h("div", { className: "dsh-whale-item-text" }, h("div", { className: "dsh-whale-item-title" }, t("tasks.title")), h("div", { className: "dsh-whale-item-desc" }, t("tasks.hint"))),
          h(Button, { variant: "outline", onClick: () => { setOpen(true); void act("tasks/list"); } }, t("tasks.title"))),
        h(Modal, { open, title: t("tasks.title"), closeLabel: t("dialog.close"), className: "dsh-whale-task-dialog", contentClassName: "dsh-whale-task-content", onClose: () => setOpen(false) },
          h("div", { className: "dsh-whale-form dsh-whale-task-fields" },
            h("label", null, t("tasks.goal"), h(Input, { value: goal, onChange: event => setGoal(event.target.value) })),
            h("label", null, t("tasks.files"), h("textarea", { className: "dsh-whale-textarea", value: files, onChange: event => setFiles(event.target.value) })),
            h("div", { className: "dsh-whale-controls" }, h(Button, { disabled: pending || !goal.trim() || !files.trim(), onClick: () => act("tasks/start", { goal, files: files.split(/\r?\n/u).map(value => value.trim()).filter(Boolean) }) }, t("tasks.start")),
              h(Button, { variant: "outline", disabled: pending, onClick: () => act("tasks/list") }, t("tasks.refresh"))),
            items.length ? items.map(task => h("details", { key: task.id },
              h("summary", null, `${task.goal} · ${task.state}`),
              h("div", { className: "dsh-whale-task-actions" },
                ["queued", "running", "stopping", "needs_user"].includes(task.state) ? h(Button, { variant: "outline", disabled: pending, onClick: () => act("tasks/stop", { taskId: task.id }) }, t("tasks.stop")) : null,
                ["interrupted", "failed", "cancelled", "needs_user"].includes(task.state) ? h(Button, { variant: "outline", disabled: pending, onClick: () => act("tasks/resume", { taskId: task.id }) }, t("tasks.resume")) : null),
              h("p", null, task.id), h("p", null, task.error),
              task.result ? h("p", { style: { whiteSpace: "pre-wrap" } }, task.result.summary + (task.result.unmet.length ? "\n" + task.result.unmet.join("\n") : "")) : null,
              h("p", null, task.effects.map(effect => `${effect.target}: ${effect.state}`).join(" · ")))) : h("p", null, t("tasks.empty")),
            h("details", null, h("summary", null, t("tasks.owner")),
              h("label", null, t("tasks.bot"), h(Input, { value: bot, onChange: event => setBot(event.target.value) })),
              h("label", null, t("tasks.actor"), h(Input, { value: actor, onChange: event => setActor(event.target.value) })),
              h(Button, { variant: "outline", disabled: pending || !bot || !actor, onClick: () => act("tasks/owner", { channel: "feishu", botId: bot, actor }) }, t("tasks.grant")),
              h(Button, { variant: "outline", disabled: pending || !bot, onClick: () => act("tasks/revoke-owner", { botId: bot }) }, t("tasks.revoke"))),
            error ? h(Feedback, { text: error, t }) : null)));
    }

    function formatAutonomy(value) {
      const level = Number(value);
      return Number.isInteger(level) && level >= 1 && level <= 5 ? `L${level}` : "L?";
    }

    // Approval controls are deliberately disabled unless the durable runtime
    // still reports a pending approval and the exact task is waiting_approval.
    // This prevents stale cards from bypassing runtime policy after a reload.
    function canDecideApproval(item, task) {
      const level = Number(item?.autonomy ?? task?.autonomy);
      return item?.status === "pending"
        && task?.state === "waiting_approval"
        && Number.isInteger(level) && level >= 1 && level <= 5;
    }

    function WhaleOpsCard({ item, task, outbox, busy, onDecision, t }) {
      const title = item?.title || task?.title || item?.action || "Untitled task";
      const source = item?.source || task?.source || item?.target || "manual";
      const status = outbox ? (item?.status || task?.state || "unknown") : (item?.state || "unknown");
      const level = item?.autonomy ?? task?.autonomy;
      const actionable = outbox && canDecideApproval(item, task);
      const actionBusy = busy === item?.id;
      const fields = outbox
        ? [
          [t("ops.action"), item?.action || "—"],
          [t("ops.target"), item?.target || "—"],
          [t("ops.status"), status],
          [t("ops.source"), source],
        ]
        : [
          [t("ops.status"), status],
          [t("ops.source"), source],
        ];
      return h("article", {
        className: "dsh-whale-ops-card",
        "data-proactive-id": item?.id || "",
        "data-proactive-kind": outbox ? "outbox" : "inbox",
      },
        h("div", { className: "dsh-whale-ops-card-head" },
          h("div", { className: "dsh-whale-ops-card-title" }, title),
          h("span", { className: "dsh-whale-ops-card-level", "aria-label": t("ops.level") }, formatAutonomy(level))),
        h("div", { className: "dsh-whale-ops-grid" },
          fields.map(([label, value]) => h("div", { key: label, className: "dsh-whale-ops-field" },
            h("span", { className: "dsh-whale-ops-label" }, label),
            h("span", { className: "dsh-whale-ops-value", title: String(value) }, String(value)))),
          outbox ? h("div", { className: "dsh-whale-ops-field" },
            h("span", { className: "dsh-whale-ops-label" }, t("ops.level")),
            h("span", { className: "dsh-whale-ops-value" }, formatAutonomy(level))) : null),
        outbox && !actionable
          ? h("div", { className: "dsh-whale-ops-error", role: "status" },
            item?.status === "pending" ? t("ops.pendingPolicy") : t("ops.noDecision"))
          : null,
        outbox ? h("div", { className: "dsh-whale-ops-actions" },
          h(Button, {
            type: "button",
            variant: "outline",
            size: "sm",
            disabled: !actionable || actionBusy,
            loading: actionBusy,
            onClick: () => onDecision(item, "approved"),
            "aria-label": `${t("ops.approve")}: ${title}`,
          }, t("ops.approve")),
          h(Button, {
            type: "button",
            variant: "outline",
            size: "sm",
            disabled: !actionable || actionBusy,
            onClick: () => onDecision(item, "rejected"),
            "aria-label": `${t("ops.reject")}: ${title}`,
          }, t("ops.reject")),
        ) : null);
    }

    function WhaleOperations(props) {
      const { mode, proactiveDispatch, t } = props;
      const [items, setItems] = useState([]);
      const [tasks, setTasks] = useState({});
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState("");
      const [busy, setBusy] = useState("");
      const [attempt, setAttempt] = useState(0);
      const outbox = mode === "outbox";

      const load = useCallback(async () => {
        if (typeof proactiveDispatch !== "function") {
          setError(t("ops.unavailable"));
          setLoading(false);
          return;
        }
        setLoading(true);
        setError("");
        try {
          const value = await proactiveDispatch(outbox ? "outbox/list" : "inbox/list");
          const nextItems = Array.isArray(value) ? value : [];
          const nextTasks = {};
          if (outbox) {
            await Promise.all(nextItems.map(async (item) => {
              if (!item?.taskId) return;
              try {
                nextTasks[item.taskId] = await proactiveDispatch("task/get", { taskId: item.taskId });
              } catch {
                // Keep the card visible and fail closed until the task is readable.
              }
            }));
          }
          setItems(nextItems);
          setTasks(nextTasks);
        } catch (err) {
          setError(t("ops.loadFailed", { message: err?.message || String(err) }));
        } finally {
          setLoading(false);
        }
      }, [proactiveDispatch, outbox, t]);

      useEffect(() => { void load(); }, [load]);

      const decide = useCallback(async (item, decision) => {
        const task = tasks[item?.taskId];
        if (!canDecideApproval(item, task) || busy) {
          setError(t("ops.pendingPolicy"));
          return;
        }
        setBusy(item.id);
        setError("");
        try {
          await proactiveDispatch("approval/decide", {
            approvalId: item.id,
            decision,
            actor: "user",
          });
          await load();
        } catch (err) {
          setError(t("ops.loadFailed", { message: err?.message || String(err) }));
        } finally {
          setBusy("");
        }
      }, [busy, load, proactiveDispatch, t]);

      const retry = () => {
        setAttempt((value) => value + 1);
        void load();
      };
      const title = outbox ? t("ops.outbox") : t("ops.inbox");
      const subtitle = outbox ? t("ops.outboxSubtitle") : t("ops.inboxSubtitle");
      return h("div", {
        className: "dsh-whale-ops-page",
        "data-dsh-whale-inbox": mode === "inbox" ? "true" : undefined,
        "data-dsh-whale-outbox": mode === "outbox" ? "true" : undefined,
        "aria-busy": loading,
      },
        h("div", { className: "dsh-whale-ops-header" },
          h("div", { className: "dsh-whale-ops-heading" },
            h("div", { className: "dsh-whale-ops-title" }, title),
            h("div", { className: "dsh-whale-ops-subtitle" }, subtitle)),
          h(Button, { type: "button", variant: "outline", size: "sm", disabled: loading, onClick: retry }, t("ops.refresh"))),
        error ? h("div", { className: "dsh-whale-ops-error", role: "alert", key: `${attempt}:error` }, error) : null,
        loading ? h(Feedback, { text: outbox ? t("ops.outbox") + "…" : t("ops.loading"), t, loading: true }) : null,
        !loading && items.length === 0 ? h("div", { className: "dsh-whale-ops-empty" }, t("ops.empty")) : null,
        !loading && items.length > 0 ? h("div", { className: "dsh-whale-ops-list" },
          items.map((item) => h(WhaleOpsCard, {
            key: item?.id,
            item,
            task: tasks[item?.taskId],
            outbox,
            busy,
            onDecision: decide,
            t,
          }))) : null,
      );
    }

    function WhaleSettings(props) {
      const { rpc, t } = props;
      const [catalog, setCatalog] = useState(null);
      const [form, setForm] = useState(null);
      const [memory, setMemory] = useState("");
      const [busy, setBusy] = useState(false);
      const [status, setStatus] = useState("");
      const [error, setError] = useState("");
      const [pending, setPending] = useState("");
      const pendingRef = useRef("");
      const [attempt, setAttempt] = useState(0);
      const [modelGroups, setModelGroups] = useState(null);
      const committed = useRef({});
      const [dialog, setDialog] = useState(null);
      const [memoryConfirm, setMemoryConfirm] = useState(false);
      const [personaDraft, setPersonaDraft] = useState("");

      const reload = useCallback(async ({ reportError = true, completed = "" } = {}) => {
        try {
          const value = await rpc("catalog");
          setCatalog(value);
          // Preserve a dirty text field across the reload — a mid-edit value
          // (differs from the last server truth) is the user's, not stale.
          const serverName = value?.name ?? "";
          const serverTitle = value?.userTitle ?? "";
          const lastCommitted = committed.current;
          committed.current = { name: serverName, userTitle: serverTitle };
          setForm((prev) => ({
            name: prev && prev.name !== lastCommitted.name ? prev.name : serverName,
            userTitle: prev && prev.userTitle !== lastCommitted.userTitle ? prev.userTitle : serverTitle,
            personaText: value?.personaText ?? "",
            model: value?.modelProvider && value?.modelModel
              ? `${value.modelProvider}/${value.modelModel}` : "",
            effort: value?.modelReasoningEffort ?? "",
            imDefault: value?.imDefault === true,
          }));
          setMemory(value?.memory ?? "");
          return true;
        } catch (err) {
          if (reportError) {
            setStatus("");
            const message = t("loadFailed", { message: err?.message || String(err) });
            setError(completed ? `${completed} · ${message}` : message);
          }
          return false;
        }
      }, [rpc, t]);

      useEffect(() => { void reload(); }, [reload]);

      useEffect(() => {
        let cancelled = false;
        const remote = props.remote ?? null;
        const loader = remote?.session?.modelCatalog;
        if (typeof loader !== "function") return undefined;
        loader.call(remote.session).then((response) => {
          if (cancelled) return;
          const value = rpcValue(response);
          if (value && Array.isArray(value.groups)) setModelGroups(value.groups);
        }).catch((err) => {
          if (!cancelled) setError(t("loadFailed", { message: err?.message || String(err) }));
        });
        return () => { cancelled = true; };
      }, [props.remote]);

      const modelOptions = useMemo(() => {
        const options = [{ id: "", label: t("field.modelDefault") }];
        for (const group of modelGroups ?? []) {
          for (const model of group?.models ?? []) {
            const provider = group.provider ?? group.id ?? "";
            const id = model.id ?? model.model ?? "";
            if (provider && id) options.push({ id: `${provider}/${id}`, label: `${provider}/${id}` });
          }
        }
        return options;
      }, [modelGroups, t]);

      const effortOptions = useMemo(() => [
        { id: "", label: t("field.effortDefault") },
        { id: "low", label: "low" },
        { id: "medium", label: "medium" },
        { id: "high", label: "high" },
      ], [t]);

      if (!catalog || !form) {
        return h("div", { className: "dsh-whale-form", "aria-busy": !error },
          h(Feedback, {
            key: attempt,
            text: error || t("loading"), t, loading: !error,
            actions: error ? [{ label: t("retry"), onClick: () => { setAttempt((current) => current + 1); setError(""); void reload(); } }] : undefined,
          }));
      }

      const beginOperation = (key) => {
        if (pendingRef.current) return false;
        pendingRef.current = key;
        setAttempt((current) => current + 1);
        setPending(key);
        setBusy(true);
        setError("");
        setStatus("");
        return true;
      };
      const finishOperation = () => {
        pendingRef.current = "";
        setPending("");
        setBusy(false);
      };

      // Every control writes through immediately — the endpoint sanitizes and
      // merges per field, so each commit sends only its own key.
      const commit = async (patch, source = Object.keys(patch)[0]) => {
        if (!beginOperation(source)) return false;
        try {
          const saved = await rpc("settings/update", patch);
          if (typeof patch.name === "string" && typeof saved?.name === "string") refreshPanelLabel(saved.name);
          if (await reload({ completed: t("saved") })) setStatus(t("saved"));
          return true;
        } catch (err) {
          setError(t("saveFailed", { message: err?.message || String(err) }));
          await reload({ reportError: false });
          return false;
        } finally {
          finishOperation();
        }
      };

      // Text fields commit on blur (Enter blurs first); unchanged text is a
      // no-op against the last server-truth snapshot.
      const blurCommit = (key) => () => {
        const value = String(form[key] ?? "");
        if (value === String(committed.current[key] ?? "")) return;
        void commit({ [key]: value });
      };
      const enterToCommit = (event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      };

      // Provider + model + effort are one catalog field — whichever select
      // moved commits all three together.
      const commitModel = (nextModel, nextEffort, source) => {
        const value = String(nextModel || "");
        const slash = value.indexOf("/");
        const provider = slash < 0 ? "" : value.slice(0, slash);
        const model = slash < 0 ? "" : value.slice(slash + 1);
        void commit({ model: { provider, model, reasoningEffort: nextEffort } }, source);
      };

      const toggleSkill = async (skillName, enabled) => {
        if (!beginOperation(`skill:${skillName}`)) return;
        try {
          await rpc("skills/toggle", { name: skillName, enabled });
          await reload();
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          finishOperation();
        }
      };

      const saveMemory = async () => {
        if (!beginOperation("memory-save")) return;
        try {
          await rpc("memory/replace", { text: memory });
          setStatus(t("saved"));
          setDialog(null);
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          finishOperation();
        }
      };

      const clearMemory = async () => {
        if (!beginOperation("memory-clear")) return;
        try {
          await rpc("memory/clear");
          setMemory("");
          if (await reload({ completed: t("memory.cleared") })) setStatus(t("memory.cleared"));
          setDialog(null);
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          finishOperation();
        }
      };

      // Flat Setting-Cell rows: title (+ optional desc) on the left, control
      // on the right, hairline separators — same pattern as ui-settings-general.
      const rowText = (title, desc) => h("div", { className: "dsh-whale-item-text" },
        title ? h("div", { className: "dsh-whale-item-title" }, title) : null,
        desc ? h("div", { className: "dsh-whale-item-desc", title: desc }, desc) : null);

      const item = (title, desc, control) => h("div", { className: "dsh-whale-item" },
        rowText(title, desc), control);

      const skills = catalog.skills ?? [];
      const enabledSkills = skills.filter((skill) => skill.enabled === true).length;

      return h("div", { className: "dsh-whale-form", "aria-busy": busy },
        h(WhaleTaskSettings, { rpc, t }),
        item(t("field.identity"), t("field.identityHint"),
          h("div", { className: "dsh-whale-controls" },
            h(Input, {
              className: "dsh-whale-cell-input",
              value: form.name,
              placeholder: t("field.namePh"),
              "aria-label": t("field.name"),
              disabled: busy,
              onChange: (event) => setForm({ ...form, name: event.target.value }),
              onBlur: blurCommit("name"),
              onKeyDown: enterToCommit,
            }),
            h(Input, {
              className: "dsh-whale-cell-input",
              value: form.userTitle,
              placeholder: t("field.userTitlePh"),
              "aria-label": t("field.userTitle"),
              disabled: busy,
              onChange: (event) => setForm({ ...form, userTitle: event.target.value }),
              onBlur: blurCommit("userTitle"),
              onKeyDown: enterToCommit,
            }))),

        item(t("field.model"), t("field.modelHint"),
          h("div", { className: "dsh-whale-controls" },
            h(SettingsSelect, {
              variant: "inline",
              align: "end",
              "aria-label": t("field.model"),
              value: form.model,
              options: modelOptions,
              disabled: busy || modelOptions.length <= 1,
              loading: pending === "model",
              onChange: (value) => {
                setForm({ ...form, model: value });
                commitModel(value, form.effort, "model");
              },
            }),
            h(SettingsSelect, {
              variant: "inline",
              align: "end",
              "aria-label": t("field.effort"),
              value: form.effort,
              options: effortOptions,
              disabled: busy,
              loading: pending === "effort",
              onChange: (value) => {
                setForm({ ...form, effort: value });
                commitModel(form.model, value, "effort");
              },
            }))),

        item(t("field.imDefault"), t("field.imDefaultHint"),
          h(Switch, {
            checked: form.imDefault === true,
            disabled: busy,
            loading: pending === "imDefault",
            "aria-label": t("field.imDefault"),
            onChange: (event) => {
              const next = event.target.checked;
              setForm({ ...form, imDefault: next });
              void commit({ imDefault: next });
            },
          })),

        item(t("field.personaText"), form.personaText || t("field.personaTextHint"),
          h("button", {
            type: "button",
            className: "dsh-whale-edit",
            disabled: busy,
            onClick: () => { setPersonaDraft(form.personaText); setDialog("persona"); },
          }, t("edit"))),

        item(t("field.memoryRow"), t("memory.hint"),
          h("button", {
            type: "button",
            className: "dsh-whale-edit",
            disabled: busy,
            onClick: () => { setMemoryConfirm(false); setDialog("memory"); },
          }, t("field.memoryEdit"))),

        item(t("skills.title"), skills.length === 0
            ? t("skills.empty", { dir: catalog.homeDir || "…" })
            : t("skills.count", { enabled: String(enabledSkills), total: String(skills.length) }),
          h("button", {
            type: "button",
            className: "dsh-whale-edit",
            disabled: busy,
            onClick: () => setDialog("skills"),
          }, t("skills.manage"))),

        (pending === "name" || pending === "userTitle")
          ? h(Feedback, { text: t("saving"), t, loading: true }) : null,
        status ? h(Feedback, { key: `${attempt}:success`, text: status, t, success: true }) : null,
        error ? h(Feedback, { key: `${attempt}:error`, text: error, t }) : null,

        h(Modal, {
          open: dialog === "persona",
          onClose: () => { if (!busy) setDialog(null); },
          title: t("field.personaText"),
          closeLabel: t("dialog.close"),
          footer: h(Fragment, null,
            h(Button, { variant: "outline", disabled: busy, onClick: () => setDialog(null) }, t("dialog.cancel")),
            h(Button, {
              variant: "primary",
              disabled: busy,
              loading: pending === "personaText",
              onClick: () => {
                void commit({ personaText: personaDraft }).then((ok) => {
                  if (ok) setDialog(null);
                });
              },
            }, t("save"))),
        },
          h("textarea", {
            className: "dsh-whale-textarea dsh-whale-dialog-textarea",
            value: personaDraft,
            disabled: busy,
            onChange: (event) => setPersonaDraft(event.target.value),
          })),

        h(Modal, {
          open: dialog === "memory",
          onClose: () => { if (!busy) { if (memoryConfirm) setMemoryConfirm(false); else setDialog(null); } },
          title: t(memoryConfirm ? "memory.clearTitle" : "memory.title"),
          description: t(memoryConfirm ? "memory.clearConfirm" : "memory.hint"),
          closeLabel: t("dialog.close"),
          footer: memoryConfirm
            ? h(Fragment, null,
              h(Button, { variant: "outline", disabled: busy, onClick: () => setMemoryConfirm(false) }, t("dialog.cancel")),
              h(Button, { variant: "primary", className: "dsh-whale-danger-button", disabled: busy, loading: pending === "memory-clear", onClick: () => { void clearMemory(); } }, t("memory.clearAction")))
            : h(Fragment, null,
              h(Button, { variant: "outline", disabled: busy, onClick: () => setMemoryConfirm(true) }, t("memory.clear")),
              h(Button, { variant: "primary", disabled: busy, loading: pending === "memory-save", onClick: () => { void saveMemory(); } }, t("memory.save"))),
        },
          memoryConfirm ? undefined : h("textarea", {
            className: "dsh-whale-textarea dsh-whale-dialog-textarea",
            value: memory,
            disabled: busy,
            onChange: (event) => setMemory(event.target.value),
          })),

        h(Modal, {
          open: dialog === "skills",
          onClose: () => { if (!busy) setDialog(null); },
          title: t("skills.title"),
          closeLabel: t("dialog.close"),
        },
          h("div", { className: "dsh-whale-skills" },
            skills.length === 0
              ? h("div", { className: "dsh-whale-modal-hint" },
                t("skills.empty", { dir: catalog.homeDir || "…" }))
              : skills.map((skill) => h("div", { key: skill.name, className: "dsh-whale-item" },
                h("div", { className: "dsh-whale-item-text" },
                  h("div", { className: "dsh-whale-skill-name" }, skill.name)),
                h(Switch, {
                  checked: skill.enabled === true,
                  disabled: busy,
                  loading: pending === `skill:${skill.name}`,
                  "aria-label": skill.name,
                  onChange: (event) => toggleSkill(skill.name, event.target.checked),
                }),
              )))),
      );
    }

    // One client-owned presentation. No writes to the ordinary layout store:
    // hiding its tracks retains the exact widths, surfaces, terminals and drafts.
    function createBigFish({ rpc, openSession, settingsNavigation, layout, t }) {
      let state = { active: false, prompted: false, enabled: false, prompt: false, tab: "panel", sideOpen: true, width: 360, error: "", busy: false, sessionId: "", homeDir: "" };
      const listeners = new Set();
      const set = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
      const tr = (cn, en) => t("dialog.cancel") === "取消" ? cn : en;
      const fail = error => set({ error: error?.message || String(error), busy: false });
      const persist = input => rpc("settings/update", input);
      const mode = {
        get: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, set, tr,
        async openAssistant() {
          const catalog = await rpc("catalog");
          const ensured = await rpc("assistant/ensure");
          if (!ensured.sessionId) throw new Error("no-session");
          await openSession(ensured.sessionId);
          layout?.selectPanel?.(null);
          set({ sessionId: ensured.sessionId, homeDir: catalog.homeDir, prompted: catalog.bigFishPrompted === true,
            enabled: catalog.bigFishEnabled === true, tab: catalog.bigFishTab === "task" ? "task" : "panel",
            ...(!catalog.bigFishPrompted ? { prompt: true } : catalog.bigFishEnabled ? { active: true } : {}) });
          return ensured.sessionId;
        },
        async choose(enabled) {
          set({ busy: true, error: "" });
          try { await persist({ bigFishPrompted: true, bigFishEnabled: enabled }); set({ active: enabled, prompt: false, prompted: true, enabled, busy: false }); }
          catch (error) { fail(error); }
        },
        async exit() {
          // Always allow leaving the presentation, even when the Host is offline.
          set({ active: false, enabled: false });
          try { await persist({ bigFishEnabled: false }); } catch (error) { fail(error); }
        },
        async tab(next) {
          set({ tab: next });
          try { await persist({ bigFishTab: next }); } catch (error) { fail(error); }
        },
        settings() { Promise.resolve(settingsNavigation.open("pet")).catch(fail); },
        dispose() { listeners.clear(); document.documentElement.removeAttribute("data-dsh-whale-mode"); document.documentElement.style.removeProperty("--dsh-whale-track"); },
      };
      return mode;
    }

    function useBigFish(mode) {
      const [value, setValue] = useState(mode.get);
      useEffect(() => { const dispose = mode.subscribe(setValue); setValue(mode.get()); return dispose; }, [mode]);
      return value;
    }

    function injectBigFishCss() {
      const style = document.createElement("style");
      style.id = "dsh-whale-big-fish-css";
      style.textContent = `
html[data-dsh-whale-mode] [data-dsh-frame]{grid-template-columns:0px minmax(0,1fr) var(--dsh-whale-track,360px) 0px!important;grid-template-rows:52px minmax(0,1fr) 0px 0px!important;--dshd-titlebar-conversation-reserve:0px!important}
html[data-dsh-whale-mode] [data-dsh-frame-region="sidebar"],html[data-dsh-whale-mode] [data-dsh-frame-region="rightbar"],html[data-dsh-whale-mode] [data-dsh-frame-region="terminal"],html[data-dsh-whale-mode] [data-shell-bottom],html[data-dsh-whale-mode] [data-titlebar-trailing],html[data-dsh-whale-mode] [data-shell-leading-band],html[data-dsh-whale-mode] [data-dsh-header],html[data-dsh-whale-mode] [data-dsh-frame]>[data-side],html[data-dsh-whale-mode] [data-dsh-frame][data-phone]>button{display:none!important}
html[data-dsh-whale-mode] .dshpad-root:not(.dshpad-whale-panels){display:none!important}
.dsh-whale-mode-head{position:absolute;top:var(--dsh-frame-chrome-top,0px);left:20px;right:max(calc(var(--dsh-whale-track,360px) + 16px),var(--dshd-wco-controls,16px));height:52px;display:flex;align-items:center;gap:8px;-webkit-app-region:drag!important;pointer-events:none!important}
.dsh-whale-mode-head>*{-webkit-app-region:no-drag;pointer-events:auto}.dsh-whale-mode-name{display:flex;align-items:center;gap:8px;min-width:0;margin-right:auto;font-size:14px;line-height:22px;font-weight:500}.dsh-whale-mode-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-whale-mode-exit{white-space:nowrap}
html[data-platform="darwin"] .dsh-whale-mode-head{left:88px}
.dsh-whale-mode-side{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0 auto;width:var(--dsh-whale-width,360px);max-width:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-specific-sidebar-fill);border-left:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);pointer-events:auto}
.dsh-whale-mode-tabs{height:52px;min-height:52px;display:flex;align-items:center;gap:8px;padding:8px var(--dshd-wco-controls,12px) 8px 12px}.dsh-whale-mode-tablist{display:flex;gap:2px;border-radius:20px;padding:3px;background:var(--dsw-alias-interactive-bg-hover);margin-right:auto}.dsh-whale-mode-tablist button{background:transparent;border:0;border-radius:16px;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary);padding:3px 14px;white-space:nowrap}.dsh-whale-mode-tablist button[aria-selected="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-panel-solid,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-shadow-lv2);font-weight:500}
.dsh-whale-mode-scroll{overflow:auto;min-height:0;flex:1;padding:12px 16px 20px;scrollbar-gutter:stable}.dsh-whale-mode-scroll>[hidden]{display:none}.dsh-whale-mode-resize{position:absolute;top:0;bottom:0;left:-4px;width:8px;cursor:col-resize;touch-action:none}.dsh-whale-mode-resize:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-whale-mode-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;border:0;background:var(--dsw-alias-bg-mask-1);pointer-events:auto}
.dsh-whale-todo-group{margin:0 0 20px}.dsh-whale-todo-group>summary{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);list-style:none;cursor:pointer;padding:4px 0}.dsh-whale-todo-group>summary::before{content:'⌄';margin-right:2px}.dsh-whale-todo-group>summary>span:first-of-type{margin-right:auto}.dsh-whale-todo-card{padding:12px;background:var(--dsw-alias-bg-panel-solid,var(--dsw-alias-bg-layer-1));border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;margin-top:8px;overflow-wrap:anywhere}.dsh-whale-todo-row{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}.dsh-whale-todo-title{min-width:0;flex:1;background:transparent;border:0;text-align:left;color:inherit;font:inherit;font-size:14px;line-height:22px;font-weight:500;padding:0;cursor:pointer}.dsh-whale-todo-title:hover{text-decoration:underline;text-underline-offset:3px}.dsh-whale-todo-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:8px;display:flex;gap:6px;align-items:center}.dsh-whale-todo-meta svg{flex:none}.dsh-whale-todo-error{color:var(--dsw-alias-state-error-primary)}.dsh-whale-todo-result{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;margin:8px 0 0;overflow-wrap:anywhere}.dsh-whale-todo-result h4{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);margin:12px 0 4px}.dsh-whale-todo-result p{margin:0}.dsh-whale-todo-footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:8px}.dsh-whale-todo-empty{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);padding:10px 0}.dsh-whale-todo-fields{display:flex;flex-direction:column;gap:16px;max-height:60vh;overflow:auto}.dsh-whale-todo-fields label{display:flex;flex-direction:column;gap:8px;font-size:14px}.dsh-whale-todo-fields p,.dsh-whale-mode-intro p{font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary);margin:0 0 12px}.dsh-whale-mode-intro{max-width:420px}.dsh-whale-todo-confirm{font-size:14px;line-height:22px;max-width:420px;white-space:pre-wrap}
.dshpad-root.dshpad-whale-panels{position:relative;inset:auto;width:100%;height:auto;z-index:auto;display:flex;flex-direction:column;gap:12px}.dshpad-whale-panels .dshpad-card-grip{display:none}.dshpad-whale-panels .dshpad-card{width:100%;flex:none}.dshpad-whale-empty{padding:16px 0;display:flex;flex-direction:column;align-items:flex-start;gap:12px;font-size:14px}.dshpad-whale-notice{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0}.dshpad-whale-add{display:flex;flex-direction:column;gap:16px}.dshpad-whale-add label{display:flex;flex-direction:column;gap:8px}.dshpad-whale-add p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-whale-mode-side[hidden]{display:none}
@media(max-width:900px){html[data-dsh-whale-mode] [data-dsh-frame]{grid-template-columns:0px minmax(0,1fr) 0px 0px!important}.dsh-whale-mode-head{right:var(--dshd-wco-controls,12px)}.dsh-whale-mode-side{z-index:2;width:min(var(--dsh-whale-width,360px),100%);background:var(--dsw-alias-bg-panel-solid,var(--dsw-alias-bg-layer-1))}.dsh-whale-mode-resize{display:none}}
@media(max-width:500px){.dsh-whale-mode-head{left:12px;gap:4px}.dsh-whale-mode-name span{max-width:84px}.dsh-whale-mode-exit{font-size:12px}}
@media(prefers-reduced-motion:reduce){html[data-dsh-whale-mode] [data-dsh-frame]{transition:none}}
`;
      document.head.appendChild(style);
      return () => style.remove();
    }

    const todoBusy = card => ["starting", "running", "stopping"].includes(card.state);
    const todoGroup = card => todoBusy(card) ? "running" : card.state === "pending" ? "pending" : "executed";

    function WhaleTodoCard({ card, tr, pending, onAction, onEdit, onConfirm, onOpen, onExpand, expanded }) {
      const [menu, setMenu] = useState(false);
      const labels = { pending: tr("尚未开始", "Not started"), starting: tr("正在启动", "Starting"), running: tr("正在执行", "Running"), stopping: tr("正在停止", "Stopping"), review: tr("执行结束 · 待确认", "Run ended · Review needed"), completed: tr("已完成", "Completed"), cancelled: tr("已取消", "Cancelled"), failed: tr("执行失败", "Failed"), interrupted: tr("执行中断 · 需检查", "Interrupted · Check session") };
      const entries = [{ id: "pin", label: card.pinned ? tr("取消置顶", "Unpin") : tr("置顶", "Pin") }, { id: "detail", label: tr("查看详情", "View details") }];
      if (card.state === "pending") entries.push({ id: "edit", label: tr("编辑任务", "Edit task") }, { id: "start", label: tr("交给鲸鱼娘执行…", "Run with Whale…") });
      if (todoBusy(card)) entries.push({ id: "cancel", label: tr("停止执行…", "Stop run…"), disabled: card.state === "stopping" && !card.error });
      else {
        if (card.state !== "completed") entries.push({ id: "complete", label: tr("标记完成", "Mark complete") });
        if (card.state === "pending") entries.push({ id: "cancel", label: tr("取消任务", "Cancel task") });
        else entries.push({ id: "reopen", label: tr("重新打开", "Reopen") }, { id: "archive", label: card.archived ? tr("移出归档", "Unarchive") : tr("归档", "Archive") });
        entries.push({ type: "separator", id: "destructive" }, { id: "delete", label: tr("删除任务卡…", "Delete task card…"), danger: true });
      }
      const choose = id => {
        setMenu(false);
        if (id === "detail") onExpand(!expanded);
        else if (id === "edit") onEdit(card);
        else if (id === "start" || id === "delete" || id === "cancel" && todoBusy(card)) onConfirm(card, id);
        else onAction(card, id);
      };
      return h("article", { className: "dsh-whale-todo-card", "data-whale-todo": card.id },
        h("div", { className: "dsh-whale-todo-row" }, h("button", { type: "button", className: "dsh-whale-todo-title", "aria-expanded": expanded, onClick: () => onExpand(!expanded) }, card.title),
          h(Menu, { open: menu, portal: true, align: "end", items: entries.map(item => ({ ...item, disabled: item.disabled || pending })), onSelect: choose, onClose: () => setMenu(false), anchor: h(Button, { variant: "ghost", size: "sm", iconOnly: true, "aria-label": tr("任务操作：", "Task actions: ") + card.title, "aria-expanded": menu, onClick: () => setMenu(!menu) }, h(IconEllipsisOutline16)) })),
        h("div", { className: "dsh-whale-todo-meta", role: pending ? "status" : undefined }, todoBusy(card) ? h(StateDot, { state: "ongoing", size: 12 }) : null, labels[card.state], card.pinned ? h("span", { role: "img", "aria-label": tr("已置顶", "Pinned") }, h(IconPinOutlineRegular, { size: 12 })) : null),
        card.error ? h("p", { className: "dsh-whale-todo-result dsh-whale-todo-error" }, card.error) : null,
        expanded ? h("div", { className: "dsh-whale-todo-result" },
          card.description ? h(Fragment, null, h("h4", null, tr("任务说明", "Description")), h("p", null, card.description)) : null,
          card.criteria ? h(Fragment, null, h("h4", null, tr("完成条件", "Acceptance criteria")), h("p", null, card.criteria)) : null,
          h("h4", null, tr("工作目录", "Working directory")), h("p", null, card.cwd),
          card.summary ? h(Fragment, null, h("h4", null, tr("执行结果", "Run result")), h("p", null, card.summary)) : null,
          card.sessionId ? h(Button, { variant: "ghost", size: "sm", onClick: () => onOpen(card.sessionId) }, tr("打开关联对话", "Open linked conversation")) : null,
        ) : null,
        card.state === "pending" ? h("div", { className: "dsh-whale-todo-footer" }, h(Button, { variant: "outline", size: "sm", disabled: pending, onClick: () => onConfirm(card, "start") }, tr("开始执行", "Start"))) : null,
        card.state === "review" ? h("div", { className: "dsh-whale-todo-footer" }, h(Button, { variant: "ghost", size: "sm", onClick: () => onExpand(true) }, tr("查看成果", "Review result")), h(Button, { variant: "outline", size: "sm", disabled: pending, onClick: () => onAction(card, "complete") }, tr("确认完成", "Confirm complete"))) : null,
      );
    }

    function WhaleTodosView({ rpc, mode, requestAdd, openSession, t, visible }) {
      const tr = mode.tr;
      const [cards, setCards] = useState([]), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
      const [editor, setEditor] = useState(null), [confirm, setConfirm] = useState(null), [pending, setPending] = useState("");
      const [expanded, setExpanded] = useState(null), [archive, setArchive] = useState(false);
      const heldGroup = useRef(null), alive = useRef(true), lastConfirm = useRef(null);
      if (confirm) lastConfirm.current = confirm;
      const confirmView = confirm ?? lastConfirm.current;
      const load = useCallback(async () => { const value = await rpc("todos/list"); if (alive.current) { setCards(value.cards); setLoaded(true); setError(""); } }, [rpc]);
      useEffect(() => {
        alive.current = true;
        if (!visible) return;
        const refresh = () => { void load().catch(err => { if (alive.current) setError(err.message); }); };
        refresh(); const timer = setInterval(refresh, 3000);
        return () => { alive.current = false; clearInterval(timer); };
      }, [load, visible]);
      const add = () => setEditor({ title: "", description: "", criteria: "", cwd: mode.get().homeDir || "" });
      useEffect(() => { if (requestAdd) add(); }, [requestAdd]);
      const action = async (card, id) => {
        setPending(card.id); setError("");
        try {
          if (id === "pin" || id === "archive") await rpc("todos/update", { id: card.id, patch: id === "pin" ? { pinned: !card.pinned } : { archived: !card.archived } });
          else await rpc("todos/action", { id: card.id, action: id });
          setConfirm(null); await load();
        } catch (err) { setError(err.message); }
        finally { setPending(""); }
      };
      const save = async () => {
        setPending("editor"); setError("");
        try {
          const { id, title, description, criteria, cwd } = editor;
          if (id) await rpc("todos/update", { id, patch: { title, description, criteria, cwd } });
          else await rpc("todos/create", { title, description, criteria, cwd });
          setEditor(null); await load();
        } catch (err) { setError(err.message); } finally { setPending(""); }
      };
      const groupOf = card => heldGroup.current?.id === card.id ? heldGroup.current.group : todoGroup(card);
      const renderCard = card => h(WhaleTodoCard, { key: card.id, card, tr, pending: pending === card.id,
        onAction: action, onEdit: setEditor, onConfirm: (value, id) => setConfirm({ card: value, action: id }),
        onOpen: id => { Promise.resolve(openSession(id)).catch(err => setError(err.message)); }, expanded: expanded === card.id,
        onExpand: value => { heldGroup.current = value ? { id: card.id, group: groupOf(card) } : null; setExpanded(value ? card.id : null); },
      });
      const fields = [["title", tr("任务名称", "Task name")], ["description", tr("任务说明", "Description")], ["criteria", tr("完成条件", "Acceptance criteria")], ["cwd", tr("工作目录", "Working directory")]];
      const messages = {
        start: tr("在独立任务会话中执行，使用鲸鱼娘当前模型和宿主标准权限。不会占用或替换主对话。", "Run in an isolated task session with Whale's current model and standard Host permissions. The resident conversation stays intact."),
        cancel: tr("只停止这项任务的执行；保留已产生的结果。", "Stop only this task's run; keep existing results."),
        delete: tr("只删除任务卡，不删除关联对话或已经生成的文件。", "Delete the card only, not linked conversations or generated files."),
      };
      return h(Fragment, null,
        error ? h(Feedback, { text: error, t, actions: [{ label: t("retry"), onClick: () => void load().catch(err => setError(err.message)) }] }) : null,
        !loaded ? h("p", { className: "dsh-whale-todo-empty", role: "status" }, t("loading")) : null,
        [["running", tr("进行中", "In progress")], ["pending", tr("未执行", "Not started")], ["executed", tr("已执行", "Executed")]].map(([group, label]) => {
          const items = cards.filter(card => !card.archived && groupOf(card) === group).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
          return h("details", { key: group, className: "dsh-whale-todo-group", open: true }, h("summary", null, h("span", null, label), h("span", null, items.length)),
            items.length ? items.map(renderCard) : h("p", { className: "dsh-whale-todo-empty" }, group === "running" ? tr("没有正在执行的任务", "No active runs") : group === "pending" ? tr("添加任务，或让鲸鱼娘记下待办。", "Add a task, or ask Whale to note one.") : tr("执行结束的任务会留在这里。", "Finished runs stay here.")));
        }),
        h("details", { className: "dsh-whale-todo-group", open: archive, onToggle: e => setArchive(e.currentTarget.open) }, h("summary", null, h("span", null, tr("归档", "Archive")), h("span", null, cards.filter(card => card.archived).length)), cards.filter(card => card.archived).map(renderCard)),
        h(Modal, { open: Boolean(editor), title: editor?.id ? tr("编辑任务", "Edit task") : tr("新增任务", "New task"), closeLabel: t("dialog.close"), onClose: () => { if (!pending) setEditor(null); }, footer: h(Fragment, null, h(Button, { variant: "outline", disabled: Boolean(pending), onClick: () => setEditor(null) }, t("dialog.cancel")), h(Button, { loading: pending === "editor", disabled: Boolean(pending) || !editor?.title.trim(), onClick: save }, t("save"))) },
          editor ? h("div", { className: "dsh-whale-todo-fields" }, fields.map(([key, label]) => h("label", { key }, label,
            key === "description" || key === "criteria" ? h("textarea", { className: "dsh-whale-textarea", value: editor[key], maxLength: 6000, onChange: e => setEditor({ ...editor, [key]: e.target.value }) }) : h(Input, { value: editor[key], maxLength: key === "title" ? 200 : 2000, "data-modal-autofocus": key === "title" ? "" : undefined, onChange: e => setEditor({ ...editor, [key]: e.target.value }) }))),
            h("p", null, tr("保存到未执行列表，不会自动开始。", "Save to Not started. Nothing runs automatically."))) : null),
        h(Modal, { open: Boolean(confirm), title: confirmView?.card.title || "", closeLabel: t("dialog.close"), onClose: () => { if (!pending) setConfirm(null); }, footer: h(Fragment, null, h(Button, { variant: "outline", disabled: Boolean(pending), onClick: () => setConfirm(null) }, t("dialog.cancel")), h(Button, { loading: Boolean(pending), disabled: Boolean(pending), onClick: () => action(confirmView.card, confirmView.action) }, confirmView?.action === "start" ? tr("开始执行", "Start run") : confirmView?.action === "delete" ? tr("删除任务卡", "Delete card") : tr("停止执行", "Stop run"))) }, h("p", { className: "dsh-whale-todo-confirm" }, messages[confirmView?.action])),
      );
    }

    function WhaleWorkbench({ mode, rpc, openSession, renderSlot, t }) {
      const state = useBigFish(mode), tr = mode.tr;
      const [add, setAdd] = useState({ task: 0, panel: 0 });
      const [narrow, setNarrow] = useState(() => window.innerWidth <= 900);
      const drag = useRef(null), side = useRef(null), reopen = useRef(null);
      useEffect(() => { if (!state.active) setAdd({ task: 0, panel: 0 }); }, [state.active]);
      useEffect(() => { const resize = () => setNarrow(window.innerWidth <= 900); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
      useEffect(() => {
        const html = document.documentElement;
        if (state.active) {
          html.setAttribute("data-dsh-whale-mode", "");
          html.style.setProperty("--dsh-whale-track", state.sideOpen && !narrow ? `${state.width}px` : "0px");
        } else { html.removeAttribute("data-dsh-whale-mode"); html.style.removeProperty("--dsh-whale-track"); }
        return () => { html.removeAttribute("data-dsh-whale-mode"); html.style.removeProperty("--dsh-whale-track"); };
      }, [state.active, state.sideOpen, state.width, narrow]);
      useEffect(() => {
        if (!state.active || !state.sideOpen || !narrow) return;
        const center = document.querySelector('[data-dsh-frame-region="center"]');
        const wasInert = center?.inert;
        if (center) center.inert = true;
        side.current?.querySelector('[aria-selected="true"]')?.focus();
        return () => { if (center) center.inert = wasInert; reopen.current?.focus(); };
      }, [state.active, state.sideOpen, narrow]);
      const sideKey = e => {
        if (!narrow || e.defaultPrevented) return;
        if (e.key === "Escape") { e.preventDefault(); mode.set({ sideOpen: false }); return; }
        if (e.key !== "Tab") return;
        const targets = [...side.current.querySelectorAll('button:not(:disabled),[href],input,textarea,select,[tabindex="0"]')].filter(node => node.getClientRects().length && node.tabIndex >= 0);
        const first = targets[0], last = targets.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      };
      const tabKey = e => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault(); const next = e.key === "Home" ? "panel" : e.key === "End" ? "task" : state.tab === "panel" ? "task" : "panel";
        void mode.tab(next); document.getElementById(`dsh-whale-mode-${next}`)?.focus();
      };
      return h(Fragment, null,
        state.error ? h(Feedback, { text: state.error, t }) : null,
        h(Modal, { open: state.prompt, title: tr("进入大肥鱼模式？", "Enter Big Fish mode?"), closeLabel: t("dialog.close"), onClose: () => { if (!state.busy) void mode.choose(false); }, footer: h(Fragment, null,
          h(Button, { variant: "outline", disabled: state.busy, onClick: () => void mode.choose(false) }, tr("暂不进入", "Not now")), h(Button, { disabled: state.busy, loading: state.busy, onClick: () => void mode.choose(true) }, tr("进入大肥鱼模式", "Enter Big Fish mode"))) },
          h("div", { className: "dsh-whale-mode-intro" }, h("p", null, tr("把界面留给你和鲸鱼娘。", "Make room for you and Whale.")), h("p", null, tr("隐藏原来的左右侧栏、Git 和终端工具，只保留对话，以及「面板 / 任务」右边栏。", "Hide the original sidebars, Git and terminal tools. Keep the conversation and a Panels / Tasks sidebar.")), h("p", null, tr("随时退出，恢复原来的工作布局。正在进行的任务不会中断。", "Leave anytime to restore your layout. Running tasks continue.")))),
        state.active ? h(Fragment, null,
          h("div", { className: "dsh-whale-mode-head" },
            h("button", { type: "button", className: "dsh-whale-todo-title dsh-whale-mode-name", onClick: () => { void mode.openAssistant().catch(err => mode.set({ error: err.message })); }, "aria-label": tr("返回鲸鱼娘", "Return to Whale") }, h(WhalePanelGlyph, { size: 18 }), h("span", null, panelName)),
            h(Button, { variant: "ghost", size: "sm", iconOnly: true, "aria-label": tr("鲸鱼娘设置", "Whale settings"), onClick: () => mode.settings() }, h(IconSettingsOutline16)),
            h(Button, { variant: "ghost", size: "sm", className: "dsh-whale-mode-exit", onClick: () => void mode.exit() }, tr("退出模式", "Exit mode")),
            !state.sideOpen ? h(Button, { ref: reopen, variant: "ghost", size: "sm", iconOnly: true, "aria-label": tr("展开右边栏", "Open sidebar"), onClick: () => mode.set({ sideOpen: true }) }, h(IconPanelRightOutline16)) : null),
          narrow && state.sideOpen ? h("button", { type: "button", tabIndex: -1, className: "dsh-whale-mode-mask", "aria-label": tr("收起右边栏", "Close sidebar"), onClick: () => mode.set({ sideOpen: false }) }) : null,
          h("aside", { ref: side, className: "dsh-whale-mode-side", hidden: !state.sideOpen, role: narrow ? "dialog" : undefined, "aria-modal": narrow ? true : undefined, "aria-label": tr("鲸鱼娘右边栏", "Whale sidebar"), onKeyDown: sideKey, style: { "--dsh-whale-width": `${state.width}px` } },
            h("div", { className: "dsh-whale-mode-resize", role: "separator", "aria-label": tr("调整右边栏宽度", "Resize sidebar"), "aria-orientation": "vertical", "aria-valuemin": 300, "aria-valuemax": 520, "aria-valuenow": state.width, tabIndex: 0,
              onKeyDown: e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); mode.set({ width: Math.max(300, Math.min(520, state.width + (e.key === "ArrowLeft" ? 16 : -16))) }); } },
              onPointerDown: e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, width: state.width }; },
              onPointerMove: e => { if (drag.current) mode.set({ width: Math.max(300, Math.min(520, drag.current.width + drag.current.x - e.clientX)) }); },
              onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; },
            }),
            h("div", { className: "dsh-whale-mode-tabs" }, h("div", { className: "dsh-whale-mode-tablist", role: "tablist", "aria-label": tr("右边栏内容", "Sidebar content"), onKeyDown: tabKey },
              [ ["panel", tr("面板", "Panels")], ["task", tr("任务", "Tasks")] ].map(([id, label]) => h("button", { key: id, type: "button", role: "tab", id: `dsh-whale-mode-${id}`, "aria-selected": state.tab === id, "aria-controls": `dsh-whale-mode-${id}-content`, tabIndex: state.tab === id ? 0 : -1, onClick: () => void mode.tab(id) }, label))),
              h(Button, { variant: "ghost", size: "sm", iconOnly: true, "aria-label": state.tab === "task" ? tr("新增任务", "New task") : tr("添加面板", "Add panel"), onClick: () => setAdd(value => ({ ...value, [state.tab]: value[state.tab] + 1 })) }, h(IconPlusOutline16)),
              h(Button, { variant: "ghost", size: "sm", iconOnly: true, "aria-label": tr("收起右边栏", "Close sidebar"), onClick: () => mode.set({ sideOpen: false }) }, h(IconPanelRightOutline16))),
            h("div", { className: "dsh-whale-mode-scroll" },
              h("div", { id: "dsh-whale-mode-panel-content", role: "tabpanel", "aria-labelledby": "dsh-whale-mode-panel", hidden: state.tab !== "panel" }, renderSlot("whale.panels", { requestAdd: add.panel, active: state.sideOpen && state.tab === "panel" }, { fallback: h("p", { className: "dsh-whale-todo-empty" }, tr("面板嵌入不可用。请在设置中启用内置 dsh-pad；若使用独立安装版，请更新到支持鲸鱼娘侧栏的版本。", "Panel embedding is unavailable. Enable bundled dsh-pad in settings, or update your independently installed copy to a version supporting the Whale sidebar.")) })),
              h("div", { id: "dsh-whale-mode-task-content", role: "tabpanel", "aria-labelledby": "dsh-whale-mode-task", hidden: state.tab !== "task" }, h(WhaleTodosView, { rpc, mode, requestAdd: add.task, openSession, t, visible: state.sideOpen && state.tab === "task" })),
            )),
        ) : null,
      );
    }

    function apply(ctx) {
      injectCss();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-whale: dictionaries");
      const t = ctx.locale.bind(NS);
      const connection = ctx.connection ?? ctx.get?.("connection");
      const sessions = ctx.sessions ?? ctx.get?.("sessions");
      // View selection left the Session Controller: since the 0.1.6 client the
      // `sessions` service carries catalog/retention only — no `open()`. The
      // main view is replaced through the workspace navigation service, which
      // also clears the selected panel. `sessions.open` stays as the
      // pre-0.1.6 fallback so an older host keeps working.
      let uiWorkspace = ctx.uiWorkspace;
      if (!uiWorkspace) {
        try { uiWorkspace = ctx.get?.("uiWorkspace"); } catch { uiWorkspace = undefined; }
      }
      const openSession = async (sessionId) => {
        const id = String(sessionId ?? "").trim();
        if (!id) throw new Error("no-session");
        if (uiWorkspace && typeof uiWorkspace.openSession === "function") {
          await uiWorkspace.openSession(id);
          return;
        }
        if (typeof sessions?.open === "function") {
          await sessions.open(id);
          return;
        }
        throw new Error("sessions service unavailable");
      };
      const remote = ctx.remote ?? ctx.get?.("remote");
      const settingsNavigation = ctx.settingsNavigation;
      const layout = ctx.layout;
      const rpc = async (endpoint, input = {}) =>
        rpcValue(await connection.rpc.call("/dsh-whale", endpoint, input));
      const proactiveDispatch = async (action, payload = {}) => {
        const dispatch = window.shell?.proactive?.dispatch;
        if (typeof dispatch !== "function") throw new Error("proactive bridge unavailable");
        return rpcValue(await dispatch(action, payload));
      };
      const mode = createBigFish({ rpc, openSession, settingsNavigation, layout, t });
      ctx.effect(() => { const remove = injectBigFishCss(); return () => { mode.dispose(); remove(); }; });
      const injectFace = () => ({ rpc, proactiveDispatch, sessions, uiWorkspace, openSession, mode, remote, layout, settingsNavigation, t });
      let workbenchInstalled = false;
      const installWorkbench = () => {
        if (workbenchInstalled || !ctx.slots?.spec?.("shell.overlay")) return;
        workbenchInstalled = true;
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay", id: "dsh-whale.workbench", order: 60, locale: NS, inject: injectFace,
          children: { "whale.panels": { kind: "single", scope: "root" } },
        }, WhaleWorkbench));
      };

      // Her fields mount inside the desktop Pet section's 助理 group
      // (`settings.pet.item`) — the assistant and the pet share one page.
      ctx.slots.inject("settings.pet.item", () => ctx.slots.register({
        name: "settings.pet.item",
        id: "whale",
        order: 0,
        locale: NS,
        inject: injectFace,
      }, WhaleSettings));

      // The assistant lives as a global panel row under 新会话
      // (`sidebar.panellist`); selecting it swaps the main area to the
      // `main` keyed entry — the page gets the whole content surface.
      // Fall back to a footer action on hosts without the panel seat.
      // Slot declarations can land after this plugin activates during
      // parallel boot, so gate on spec() under a subscription.
      const declaresPanel = () => {
        try {
          return Boolean(ctx.slots?.spec?.("sidebar.panellist") && ctx.slots?.spec?.("main"));
        } catch {
          return false;
        }
      };
      const declaresFooterAction = () => {
        try {
          return Boolean(ctx.slots?.spec?.("sidebar.footer.action"));
        } catch {
          return false;
        }
      };
      const declaresHeaderActions = () => {
        try {
          return Boolean(ctx.slots?.spec?.("conversation.session.header.actions"));
        } catch {
          return false;
        }
      };
      const declaresHeaderLeading = () => {
        try {
          return Boolean(ctx.slots?.spec?.("conversation.session.header.leading"));
        } catch {
          return false;
        }
      };
      let headerMarkInstalled = false;
      const installHeaderMark = () => {
        if (headerMarkInstalled || !declaresHeaderLeading()) return;
        headerMarkInstalled = true;
        ctx.slots.inject("conversation.session.header.leading", () => ctx.slots.register({
          name: "conversation.session.header.leading",
          locale: NS,
          inject: injectFace,
        }, WhaleHeaderMark));
      };
      let headerGearInstalled = false;
      const installHeaderGear = () => {
        if (headerGearInstalled || !declaresHeaderActions()) return;
        headerGearInstalled = true;
        ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
          name: "conversation.session.header.actions",
          id: "dsh-whale",
          order: 30,
          locale: NS,
          inject: injectFace,
        }, WhaleHeaderGear));
      };
      let sidebarInstalled = false;
      const installSidebar = () => {
        if (sidebarInstalled) return;
        if (declaresPanel()) {
          sidebarInstalled = true;
          panelSlots = ctx.slots;
          ctx.slots.inject("sidebar.panellist", () => {
            panelDispose = ctx.slots.register({
              name: "sidebar.panellist", id: PANEL_ID, order: 20, label: () => panelName, locale: NS,
            }, WhalePanelGlyph);
          });
          ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
            name: "sidebar.panellist", id: INBOX_PANEL_ID, order: 21, label: () => t("ops.inbox"), locale: NS,
          }, IconDownloadOutlineRegular));
          ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
            name: "sidebar.panellist", id: OUTBOX_PANEL_ID, order: 22, label: () => t("ops.outbox"), locale: NS,
          }, ApprovalPanelGlyph));
          ctx.slots.inject("main", () => ctx.slots.register({
            name: "main", key: PANEL_ID, locale: NS, inject: injectFace,
          }, WhaleRedirect));
          ctx.slots.inject("main", () => ctx.slots.register({
            name: "main", key: INBOX_PANEL_ID, locale: NS, inject: injectFace,
          }, (props) => h(WhaleOperations, { ...props, mode: "inbox" })));
          ctx.slots.inject("main", () => ctx.slots.register({
            name: "main", key: OUTBOX_PANEL_ID, locale: NS, inject: injectFace,
          }, (props) => h(WhaleOperations, { ...props, mode: "outbox" })));
          // Seed the configured name into the row label once the host is up.
          rpc("catalog").then((value) => refreshPanelLabel(value?.name)).catch(() => {});
        } else if (declaresFooterAction()) {
          sidebarInstalled = true;
          ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
            name: "sidebar.footer.action", id: "dsh-whale", order: 20, locale: NS, inject: injectFace,
          }, WhaleFooterEntry));
        }
      };
      // The pet card's jump button reaches in through the harness view's
      // executeJavaScript — same ensure→open→hand-off as the sidebar row.
      ctx.effect(() => {
        window.__dshWhaleOpen = async () => {
          return mode.openAssistant();
        };
        return () => { try { delete window.__dshWhaleOpen; } catch { window.__dshWhaleOpen = undefined; } };
      });
      ctx.effect(() => {
        const subscriptions = ["sidebar.panellist", "main", "sidebar.footer.action"]
          .map((key) => ctx.slots.subscribe?.(key, installSidebar));
        const headerSubscriptions = ["conversation.session.header.actions"]
          .map((key) => ctx.slots.subscribe?.(key, installHeaderGear));
        const lineageSubscriptions = ["conversation.session.header.leading"]
          .map((key) => ctx.slots.subscribe?.(key, installHeaderMark));
        const workbenchSubscription = ctx.slots.subscribe?.("shell.overlay", installWorkbench);
        installSidebar();
        installHeaderGear();
        installHeaderMark();
        installWorkbench();
        return () => {
          workbenchSubscription?.();
          for (const unsubscribe of [...subscriptions, ...headerSubscriptions, ...lineageSubscriptions]) unsubscribe?.();
        };
      });
    }

    exports.name = "dsh-whale";
    exports.inject = ["slots", "locale", "sessions", "uiWorkspace", "connection", "remote", "remote.session", "settingsNavigation", "layout"];
    exports.apply = apply;
    return module.exports;
  },
});
