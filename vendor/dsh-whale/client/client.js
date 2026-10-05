/* dsh-whale client: settings.pet.item block + sidebar panellist row + main page for the whale assistant. */
window.__ModuleLoader__.load({
  id: "dsh-whale",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { createElement: h, useState, useEffect, useMemo, useCallback, useRef, Fragment } = react;
    const { Button, Input, Modal, SettingsSelect, Switch, Tooltip, IconSettingsOutline16 } = primitives;

    const NS = "dsh-whale";
    const PANEL_ID = "whale";

    const zh = {
      "tab": "鲸鱼娘",
      "page.title": "鲸鱼娘助理",
      "page.subtitle": "常驻个人助理——她可以统筹会话、记住事情，还能让桌宠开口说话。",
      "page.open": "打开会话",
      "page.preparing": "正在准备她的会话…",
      "page.openFailed": "打开失败：{message}",
      "page.gotoSettings": "去设置",
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
      "skills.title": "技能",
      "skills.manage": "管理",
      "skills.count": "已启用 {enabled} / {total}",
      "skills.empty": "还没有技能——把 SKILL.md 目录放进 {dir} 即可被她发现。",
      "memory.title": "长期记忆",
      "memory.hint": "MEMORY.md 的内容会随她的会话一起注入。可以直接编辑，或让她用 whale_remember 自己记。",
      "memory.save": "保存记忆",
      "memory.clear": "清空记忆",
      "memory.clearConfirm": "确定清空她的长期记忆？此操作不可撤销。",
      "dialog.cancel": "取消",
      "dialog.close": "关闭",
      "save": "保存",
      "saved": "已保存",
      "saveFailed": "保存失败：{message}",
      "loadFailed": "读取失败：{message}",
    };
    const en = {
      "tab": "Whale",
      "page.title": "Whale Assistant",
      "page.subtitle": "Your resident assistant — she orchestrates sessions, remembers things, and speaks through the desktop pet.",
      "page.open": "Open session",
      "page.preparing": "Preparing her session…",
      "page.openFailed": "Open failed: {message}",
      "page.gotoSettings": "Open settings",
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
      "skills.title": "Skills",
      "skills.manage": "Manage",
      "skills.count": "{enabled} of {total} enabled",
      "skills.empty": "No skills yet — drop a SKILL.md folder under {dir} for her to discover.",
      "memory.title": "Long-term memory",
      "memory.hint": "MEMORY.md is injected with her session. Edit it here, or let her write via whale_remember.",
      "memory.save": "Save memory",
      "memory.clear": "Clear memory",
      "memory.clearConfirm": "Clear her long-term memory? This cannot be undone.",
      "dialog.cancel": "Cancel",
      "dialog.close": "Close",
      "save": "Save",
      "saved": "Saved",
      "saveFailed": "Save failed: {message}",
      "loadFailed": "Load failed: {message}",
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
.dsh-whale-skills { max-height: 46vh; overflow: auto; }
.dsh-whale-modal-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsh-whale-skill-name { font-size: 13px; font-family: var(--ds-font-family-code, monospace); }
.dsh-whale-status { font-size: 12px; opacity: 0.7; padding: 6px 0 0; }
.dsh-whale-error { font-size: 12px; color: var(--dsw-alias-text-error, #e5534b); }
.dsh-whale-gear { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-tertiary, currentColor); cursor: pointer; }
.dsh-whale-gear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); color: var(--dsw-alias-label-primary, currentColor); }
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

    const WHALE_HEAD_URL = "/whale-isle-head.png";

    // Project mark rendered inside the ship-owned slots. The host's public
    // asset is byte-identical to assets/whale-head.png.
    function WhalePanelGlyph({ size }) {
      const px = size ?? 18;
      return h("img", {
        className: "dsh-whale-head",
        src: WHALE_HEAD_URL,
        width: px,
        height: px,
        alt: "",
        "aria-hidden": "true",
        draggable: false,
      });
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
      const { rpc, openSession, t, wide } = props;
      const [busy, setBusy] = useState(false);
      const open = useCallback(async () => {
        setBusy(true);
        try {
          const ensured = await rpc("assistant/ensure");
          const sessionId = ensured?.sessionId;
          if (sessionId) await openSession(sessionId);
        } catch {
          // Surface nothing in the rail; the page path reports errors.
        } finally {
          setBusy(false);
        }
      }, [rpc, openSession]);
      return h("button", {
        type: "button",
        "aria-label": t("tab"),
        disabled: busy,
        onClick: open,
        style: {
          border: "none", background: "transparent", cursor: "pointer",
          font: "inherit", fontSize: "14px", padding: wide ? "4px 8px" : "4px",
          display: "inline-flex", alignItems: "center", gap: "6px",
        },
      }, h(WhalePanelGlyph, { size: 18 }), wide ? h("span", null, t("tab")) : null);
    }

    // The 助理 panel row opens her persistent session directly: this `main`
    // entry exists only to satisfy selectPanel(id) — it immediately hands off
    // to the conversation panel with the whale session selected.
    function WhaleRedirect(props) {
      const { rpc, openSession, layout, settingsNavigation, t } = props;
      const [error, setError] = useState("");
      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
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
      }, [rpc, openSession, layout]);
      const openSettings = useCallback(() => {
        try { settingsNavigation?.open?.("pet"); } catch { /* not mounted */ }
      }, [settingsNavigation]);
      return h("div", { className: "dsh-whale-page" },
        h("div", { className: "dsh-whale-hero" },
          h("span", { className: "dsh-whale-badge", "aria-hidden": "true" },
            h(WhalePanelGlyph, { size: 36 })),
          h("div", { className: "dsh-whale-title" }, panelName),
          h("div", { className: "dsh-whale-sub" }, error
            ? t("page.openFailed", { message: error })
            : t("page.preparing")),
        ),
        error ? h("div", { className: "dsh-whale-links" },
          h(Button, { variant: "outline", onClick: openSettings }, t("page.gotoSettings")),
        ) : null,
      );
    }

    // Title-adjacent gear on her session header — only for the whale-owned
    // session; every other conversation keeps its stock action row.
    function WhaleHeaderGear(props) {
      const { sessionId, useSessions, settingsNavigation, t } = props;
      const isWhale = useSessions?.((state) =>
        state?.byId?.[sessionId]?.presentation?.owner === "dsh-whale:assistant") ?? false;
      const openSettings = useCallback(() => {
        try { settingsNavigation?.open?.("pet"); } catch { /* not mounted */ }
      }, [settingsNavigation]);
      if (!isWhale) return null;
      return h(Tooltip, { label: t("gear.tooltip"), side: "bottom" },
        h("button", {
          type: "button",
          className: "dsh-whale-gear",
          "aria-label": t("gear.tooltip"),
          onClick: openSettings,
        }, h(IconSettingsOutline16, { size: 16, "aria-hidden": "true" })),
      );
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

    function WhaleSettings(props) {
      const { rpc, t } = props;
      const [catalog, setCatalog] = useState(null);
      const [form, setForm] = useState(null);
      const [memory, setMemory] = useState("");
      const [busy, setBusy] = useState(false);
      const [status, setStatus] = useState("");
      const [error, setError] = useState("");
      const [modelGroups, setModelGroups] = useState(null);
      const committed = useRef({});
      const [dialog, setDialog] = useState(null);
      const [personaDraft, setPersonaDraft] = useState("");

      const reload = useCallback(async () => {
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
          setError("");
        } catch (err) {
          setError(t("loadFailed", { message: err?.message || String(err) }));
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
        }).catch(() => {});
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
        return h("div", { className: "dsh-whale-form" },
          error ? h("div", { className: "dsh-whale-error" }, error)
            : h("div", { className: "dsh-whale-status" }, "…"));
      }

      // Every control writes through immediately — the endpoint sanitizes and
      // merges per field, so each commit sends only its own key.
      const commit = async (patch) => {
        setBusy(true);
        setError("");
        setStatus("");
        try {
          await rpc("settings/update", patch);
          if (typeof patch.name === "string") refreshPanelLabel(patch.name);
          await reload();
          setStatus(t("saved"));
          return true;
        } catch (err) {
          setError(t("saveFailed", { message: err?.message || String(err) }));
          await reload().catch(() => {});
          return false;
        } finally {
          setBusy(false);
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
      const commitModel = (nextModel, nextEffort) => {
        const value = String(nextModel || "");
        const slash = value.indexOf("/");
        const provider = slash < 0 ? "" : value.slice(0, slash);
        const model = slash < 0 ? "" : value.slice(slash + 1);
        void commit({ model: { provider, model, reasoningEffort: nextEffort } });
      };

      const toggleSkill = async (skillName, enabled) => {
        try {
          await rpc("skills/toggle", { name: skillName, enabled });
          await reload();
        } catch (err) {
          setError(err?.message || String(err));
        }
      };

      const saveMemory = async () => {
        setBusy(true);
        try {
          await rpc("memory/replace", { text: memory });
          setStatus(t("saved"));
          setDialog(null);
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          setBusy(false);
        }
      };

      const clearMemory = async () => {
        if (!window.confirm(t("memory.clearConfirm"))) return;
        setBusy(true);
        try {
          await rpc("memory/clear");
          setMemory("");
          setStatus(t("saved"));
          setDialog(null);
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          setBusy(false);
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

      return h("div", { className: "dsh-whale-form" },
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
              onChange: (value) => {
                setForm({ ...form, model: value });
                commitModel(value, form.effort);
              },
            }),
            h(SettingsSelect, {
              variant: "inline",
              align: "end",
              "aria-label": t("field.effort"),
              value: form.effort,
              options: effortOptions,
              disabled: busy,
              onChange: (value) => {
                setForm({ ...form, effort: value });
                commitModel(form.model, value);
              },
            }))),

        item(t("field.imDefault"), t("field.imDefaultHint"),
          h(Switch, {
            checked: form.imDefault === true,
            disabled: busy,
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
            onClick: () => setDialog("memory"),
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

        status ? h("div", { className: "dsh-whale-status" }, status) : null,
        error ? h("div", { className: "dsh-whale-error" }, error) : null,

        h(Modal, {
          open: dialog === "persona",
          onClose: () => setDialog(null),
          title: t("field.personaText"),
          closeLabel: t("dialog.close"),
          footer: h(Fragment, null,
            h(Button, { variant: "outline", disabled: busy, onClick: () => setDialog(null) }, t("dialog.cancel")),
            h(Button, {
              variant: "primary",
              disabled: busy,
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
          onClose: () => setDialog(null),
          title: t("memory.title"),
          description: t("memory.hint"),
          closeLabel: t("dialog.close"),
          footer: h(Fragment, null,
            h(Button, { variant: "outline", disabled: busy, onClick: () => { void clearMemory(); } }, t("memory.clear")),
            h(Button, { variant: "primary", disabled: busy, onClick: () => { void saveMemory(); } }, t("memory.save"))),
        },
          h("textarea", {
            className: "dsh-whale-textarea dsh-whale-dialog-textarea",
            value: memory,
            disabled: busy,
            onChange: (event) => setMemory(event.target.value),
          })),

        h(Modal, {
          open: dialog === "skills",
          onClose: () => setDialog(null),
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
                  "aria-label": skill.name,
                  onChange: (event) => toggleSkill(skill.name, event.target.checked),
                }),
              )))),
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
          uiWorkspace.openSession(id);
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
      const injectFace = () => ({ rpc, sessions, uiWorkspace, openSession, remote, layout, settingsNavigation, t });

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
          ctx.slots.inject("main", () => ctx.slots.register({
            name: "main", key: PANEL_ID, locale: NS, inject: injectFace,
          }, WhaleRedirect));
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
          const ensured = await rpc("assistant/ensure");
          const sessionId = ensured?.sessionId;
          if (sessionId) {
            await openSession(sessionId);
            layout?.selectPanel?.(null);
          }
          return sessionId || null;
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
        installSidebar();
        installHeaderGear();
        installHeaderMark();
        return () => {
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
