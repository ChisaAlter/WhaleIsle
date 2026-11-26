'use strict';

// 启动器绑定层：设置保存、事件绑定与 DOMContentLoaded 引导。
// 启动器按功能拆分的经典脚本：与页面其余脚本共享同一全局作用域，跨文件函数与状态在调用时解析。

async function saveSettings(control) {
  const api = pageShell();
  if (!api) {
    return;
  }
  const nextChecked = control.checked;
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  try {
    const patch = {
      quitAfterStart: $('opt-quit').checked,
      autoStartDesktop: $('opt-auto').checked,
      askOnUpdate: $('opt-ask').checked,
    };
    if ($('row-opt-tray') && !$('row-opt-tray').hidden) {
      patch.closeToTray = $('opt-tray').checked;
    }
    const result = await api.saveLauncherConfig(patch);
    if (result?.ok === false) throw new Error(result.message || result.error || '设置保存被拒绝');
  } catch (error) {
    control.checked = !nextChecked;
    setHint(errText(error, '设置保存失败'));
  } finally {
    control.disabled = false;
    control.removeAttribute('aria-busy');
  }
}

function bind() {
  const api = pageShell();
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
  const mainNav = document.querySelector('nav.tabs[role="tablist"]');
  if (mainNav) {
    bindTablist(mainNav, {
      orientation: 'vertical',
      activate: (tab) => activateTab(tab.dataset.tab),
    });
  }
  const importCats = document.querySelector('.import-cats[role="tablist"]');
  if (importCats) {
    bindTablist(importCats, {
      orientation: 'horizontal',
      activate: (tab) => showImportCat(tab.dataset.importCat),
    });
  }
  document.querySelectorAll('[data-goto]').forEach((link) => {
    link.addEventListener('click', () => activateTab(link.dataset.goto));
  });
  $('btn-start').addEventListener('click', () => void runDesktopAction('startDesktop'));
  if ($('btn-stop')) {
    $('btn-stop').addEventListener('click', () => void runDesktopAction('stopDesktop', 'stopping'));
  }
  if ($('btn-check-update')) {
    $('btn-check-update').addEventListener('click', () => checkUpdateNow());
  }
  if ($('btn-home-update')) {
    $('btn-home-update').addEventListener('click', () => {
      if (updateCenterApi()) {
        const next = { available: 'download', paused: 'resume', ready: 'install' }[centerView?.phase];
        void openUpdateCenter(next);
        return;
      }
      const latest = lastUpdateCheck?.latest || lastUpdateCheck?.stableVersion || '';
      const tag = latest ? (String(latest).startsWith('v') ? String(latest) : `v${latest}`) : '';
      if (tag) {
        void installTag(tag, 'update');
      }
    });
  }
  if ($('btn-check-update-versions')) {
    $('btn-check-update-versions').addEventListener('click', () => checkUpdateNow());
  }
  for (const [chipId, popId] of [
    ['versions-route-btn', 'versions-route-pop'],
    ['rail-route-btn', 'rail-route-pop'],
  ]) {
    const chip = $(chipId);
    if (!chip) {
      continue;
    }
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      const pop = $(popId);
      const opening = pop ? pop.hidden : false;
      closeRoutePops();
      setRoutePop(chip, pop, opening);
    });
  }
  document.addEventListener('click', (event) => {
    const wrap = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('.route-pop-wrap')
      : null;
    closeRoutePops(wrap || undefined);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const wrap = document.activeElement?.closest('.route-pop-wrap');
      const chip = wrap?.querySelector('[aria-haspopup="listbox"]');
      const wasOpen = wrap?.querySelector('.route-pop')?.hidden === false;
      closeRoutePops();
      if (wasOpen) { event.preventDefault(); chip?.focus(); }
    }
  });
  $('btn-skip').addEventListener('click', () => void runDesktopAction('skipUserPlugins'));
  $('btn-retry-full').addEventListener('click', () => void runDesktopAction('retryFullPlugins'));
  for (const id of ['btn-disable-suspects', 'btn-recover-plugins']) {
    $(id).addEventListener('click', () => void askPluginRecovery(window.launcherRecovery.startupRecoveryGuidance(lastStatus)));
  }
  $('btn-pick-source').addEventListener('click', async () => {
    const picked = await api?.pickImportSource();
    if (picked) {
      importSourceHome = picked;
      attachmentsTouched = false;
      await refreshImport();
    }
  });
  $('btn-pick-skill').addEventListener('click', async () => {
    const picked = await api?.pickSkillDir();
    if (picked && !extraSkillDirs.includes(picked)) {
      extraSkillDirs.push(picked);
      await refreshImport();
    }
  });
  $('btn-scan').addEventListener('click', () => refreshImport());
  $('btn-uninstall-app').addEventListener('click', async () => {
    // The Windows uninstaller asks for its own confirmation.
    const usesSettings = $('btn-uninstall-app').textContent === '打开应用设置';
    const restore = launcherButtonBusy($('btn-uninstall-app'), usesSettings ? '正在打开应用设置…' : '正在启动卸载程序…');
    try {
      const result = await api?.uninstallApp();
      if (result && result.ok === false) {
        setHint(uninstallErrorHint(result));
        return;
      }
      setHint(result?.message || (result?.openedSettings
        ? '已打开「设置 → 应用」，请在列表中卸载 Whale Isle。'
        : ''), { fade: true });
    } catch (error) {
      setHint(errText(error, '无法启动卸载程序'));
    } finally {
      restore();
    }
  });
  $('app-confirm-ok').addEventListener('click', () => settleConfirm(true));
  $('app-confirm-cancel').addEventListener('click', () => settleConfirm(false));
  $('app-confirm').addEventListener('click', (event) => {
    if (event.target === $('app-confirm')) {
      settleConfirm(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!confirmResolve) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      settleConfirm(false);
    } else if (event.key === 'Tab') {
      const feedbackActions = [...document.querySelectorAll('.shell-feedback-stack .shell-feedback-close, .shell-feedback-stack .shell-feedback-task-summary, .shell-feedback-stack .shell-feedback-action, .shell-feedback-stack #btn-install-cancel, .shell-feedback-stack #btn-import-cancel')];
      const focusables = [$('app-confirm-cancel'), $('app-confirm-ok'), ...feedbackActions]
        .filter((button) => !button.disabled && button.checkVisibility());
      if (!focusables.length) focusables.push($('app-confirm').querySelector('.modal-card'));
      const idx = focusables.indexOf(document.activeElement);
      const next = event.shiftKey
        ? (idx <= 0 ? focusables.length - 1 : idx - 1)
        : (idx < 0 || idx === focusables.length - 1 ? 0 : idx + 1);
      event.preventDefault();
      focusables[next].focus();
    }
  });
  document.querySelectorAll('[data-import-cat]').forEach((button) => {
    button.addEventListener('click', () => showImportCat(button.dataset.importCat));
  });
  $('import-board-body').addEventListener('click', (event) => {
    const fold = event.target.closest('[data-import-fold]');
    if (!fold || !$('import-sessions').contains(fold)) {
      return;
    }
    event.preventDefault();
    const key = fold.dataset.importFold;
    const expanded = fold.getAttribute('aria-expanded') !== 'false';
    setSessionGroupExpanded(key, !expanded);
  });
  $('import-board-body').addEventListener('change', (event) => {
    const cluster = event.target.closest('[data-import-cluster]');
    if (cluster && event.target === cluster) {
      const key = cluster.dataset.importCluster;
      $('import-sessions').querySelectorAll('input[name="session-rel"]').forEach((node) => {
        if (!node.disabled && sessionGroupKey(node.value) === key) {
          node.checked = cluster.checked;
        }
      });
    }
    syncSessionClusters();
    syncImportSummary();
  });
  $('import-overwrite').addEventListener('change', syncImportSummary);
  $('import-attachments').addEventListener('change', () => {
    attachmentsTouched = true;
    syncImportSummary();
  });
  $('btn-import-select-all').addEventListener('click', () => {
    setGroupChecked(IMPORT_CATS[importCat].name, true);
    syncSessionClusters();
    syncImportSummary();
  });
  $('btn-import-select-none').addEventListener('click', () => {
    setGroupChecked(IMPORT_CATS[importCat].name, false);
    syncSessionClusters();
    syncImportSummary();
  });
  const importRunBtn = $('btn-import');
  const importCancelBtn = $('btn-import-cancel');
  let importOpSeq = 0;
  let activeImportOpId = '';
  let restoreImportCancel = null;
  const clearImportCancelFeedback = () => {
    if (!restoreImportCancel) return;
    restoreImportCancel();
    restoreImportCancel = null;
  };
  importRunBtn.addEventListener('click', async () => {
    const opSeq = ++importOpSeq;
    const myOpId = `ui-import-${Date.now().toString(36)}-${opSeq}`;
    activeImportOpId = myOpId;
    const restoreImport = launcherButtonBusy(importRunBtn, '正在导入…');
    importProgressPanel.show({ reset: true });
    importCancelBtn.hidden = false;
    importCancelBtn.disabled = false;
    $('import-result').textContent = '正在导入…';
    try {
      if (!api || typeof api.runImport !== 'function') {
        $('import-result').textContent = '导入不可用：桌面桥接未连接。';
        hintUnlessShown('import-result', $('import-result').textContent);
        return;
      }
      const result = await api?.runImport({
        ...scanOptions(),
        opId: myOpId,
        overwrite: $('import-overwrite').checked,
        importAttachments: $('import-attachments').checked,
        selectedRels: checkedValues('session-rel'),
        selectedSkillIds: checkedValues('skill-id'),
        selectedPluginNames: checkedValues('plugin-name'),
        selectedMcpIds: checkedValues('mcp-id'),
        selectedSettingIds: checkedValues('setting-id'),
        selectedPresetIds: checkedValues('preset-id'),
      });
      if (opSeq === importOpSeq) {
        $('import-result').textContent = summarizeImport(result);
        if (result?.ok === false && !result.cancelled) {
          if (!$('import-result').checkVisibility()) void appNotice({ title: '导入未完成', body: $('import-result').textContent, tone: 'error' });
        }
      }
    } catch (error) {
      if (opSeq === importOpSeq) {
        $('import-result').textContent = `导入失败：${errText(error, '调用被拒绝')}`;
        hintUnlessShown('import-result', $('import-result').textContent);
      }
    } finally {
      if (opSeq === importOpSeq) {
        restoreImport();
        clearImportCancelFeedback();
        importCancelBtn.hidden = true;
        activeImportOpId = '';
        importProgressPanel.show({ active: false });
      }
    }
  });
  importCancelBtn.addEventListener('click', async () => {
    restoreImportCancel = launcherButtonBusy(importCancelBtn, '正在请求取消…', '取消中…');
    // Capture the op we're cancelling BEFORE awaiting. `activeImportOpId`
    // is shared mutable state the run handler clears on completion — reading
    // it after an await could name a different (or no) operation.
    const cancellingOpId = activeImportOpId;
    // A cancellation outcome may only reach the UI while the op that
    // requested it still owns the import state. If A's cancel resolves after
    // A finished (or B started), writing it would overwrite a terminal
    // summary or a different operation's live progress.
    const stillOwns = () => cancellingOpId !== '' && activeImportOpId === cancellingOpId && importRunBtn.disabled === true;
    try {
      // Name the op we're cancelling so the service can refuse to abort a
      // different operation it owns (e.g. a slim plugin retry holding the
      // same slot).
      const reply = await api?.cancelImport?.({ opId: cancellingOpId });
      // A resolved refusal ({ok:false}) is still a refusal — the service
      // declined to abort (wrong owner, already done, or non-import work).
      // Surface it instead of silently showing a cancel that did nothing.
      if (reply && reply.ok === false && stillOwns()) {
        $('import-result').textContent = `取消被拒绝：${errText(reply.error, '无法取消')}`;
        hintUnlessShown('import-result', $('import-result').textContent);
        clearImportCancelFeedback();
      }
    } catch (error) {
      // A rejected cancellation is itself a terminal diagnostic — surface it
      // instead of leaving an unhandled rejection and a stuck-looking state.
      if (stillOwns()) {
        $('import-result').textContent = `取消请求被拒绝：${errText(error, '无法取消')}`;
        hintUnlessShown('import-result', $('import-result').textContent);
        clearImportCancelFeedback();
      }
    }
  });
  if (typeof api?.onImportProgress === 'function') {
    api.onImportProgress((payload) => {
      // Late events from an earlier operation must not overwrite a terminal
      // summary; only accept progress while the run is still in flight, and
      // only when the event carries THIS operation's identity. An event with
      // no `op` is unowned and can never be attributed to the active run —
      // reject it too rather than let an unrelated emitter overwrite state.
      if (importRunBtn.disabled === false) {
        return;
      }
      if (typeof payload?.op !== 'string' || !payload.op || payload.op !== activeImportOpId) {
        return;
      }
      const text = importProgressText(payload);
      if (text) {
        $('import-result').textContent = text;
      }
    });
  }
  $('btn-refresh-releases').addEventListener('click', () => refreshReleases());
  $('btn-refresh-plugins').addEventListener('click', () => refreshPlugins());
  ['opt-quit', 'opt-auto', 'opt-ask', 'opt-tray'].forEach((id) => {
    $(id).addEventListener('change', (event) => saveSettings(event.currentTarget));
  });
  if (api?.onShowTab) {
    api.onShowTab((payload) => {
      if (payload?.tab) {
        activateTab(payload.tab);
      }
    });
  }
  if (api?.onDesktopFailed) {
    api.onDesktopFailed((payload) => {
      desktopActionError = payload?.error || '桌面端启动失败。';
      activateTab('home');
      setHint('');
      void refreshStatus();
      void refreshPlugins();
    });
  }
  if (api?.onDesktopReady) {
    api.onDesktopReady(() => {
      desktopActionError = '';
      setHint('');
      void refreshStatus();
    });
  }
  if (api?.onLauncherHint) {
    api.onLauncherHint((payload) => {
      if (payload?.importResume) {
        setHint('上次导入中断，未完成的临时文件已清理。可重新导入；已存在的内容将按规则跳过。');
      } else {
        // Cold-start gate outcome (failed/incomplete update flow): hints are
        // shown verbatim, everything else falls back to the shared rendering.
        renderUpdateCheck(payload?.check);
        showUpdateFailure('');
        if (payload?.check?.hint || payload?.check?.status === 'error') reportUpdateNotice(updateCheckNotice(payload.check));
      }
      void refreshStatus();
    });
  }
  // Main-process confirmations (unverified installer, update asks) render on
  // this same app-confirm card instead of a native messagebox.
  if (api?.onAppConfirm) {
    api.onAppConfirm((payload) => {
      const id = payload && payload.id;
      void appConfirm({
        title: payload?.title,
        body: payload?.body,
        confirmText: payload?.confirmText || undefined,
        cancelText: payload?.cancelText || undefined,
        danger: payload?.danger === true,
      }).then((ok) => {
        void api.respondAppConfirm?.({ id, ok });
      });
    });
  }
  if (api?.updateCenter) {
    api.updateCenter.onState((view) => adoptUpdateCenter(view));
    void api.updateCenter.state().then(adoptUpdateCenter).catch((error) => { console.warn('[src/renderer/launcher.js] background operation failed', error); });
  }
  if (api?.onUpdateProgress) {
    api.onUpdateProgress((payload) => {
      const text = installPhaseText(payload);
      const prefix = installBusy ? 'install-progress' : 'update-progress';
      paintProgress(prefix, payload);
      const line = $(prefix);
      if (line && text) {
        line.textContent = text;
      }
      if (payload?.phase === 'error' && !installBusy && !updateBusy) setHint(text);
    });
  }
  if ($('btn-install-runtime')) {
    $('btn-install-runtime').addEventListener('click', () => installRuntime());
  }
  if ($('btn-install-cancel')) {
    $('btn-install-cancel').addEventListener('click', async () => {
      const apiNow = pageShell();
      const restore = launcherButtonBusy($('btn-install-cancel'), '正在请求取消…', '取消中…');
      try {
        const result = await apiNow?.cancelRuntimeInstall();
        if (result?.ok === false) {
          setHint(errText(result, '取消安装被拒绝'));
          return;
        }
        const progress = $('install-progress');
        if (progress) progress.textContent = '正在取消…';
      } catch (error) {
        setHint(errText(error, '取消安装失败'));
      } finally {
        restore();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const host = document.querySelector('.window-controls');
  if (typeof window.mountWindowControls === 'function') {
    window.mountWindowControls(host);
  }
  if (typeof window.watchShellTheme === 'function') {
    window.watchShellTheme();
  }
  bind();
  mountFeedbackSurfaces();
  window.__launcherComponents?.mountHome($('home-components'), pageShell());
  mountComponents();
  void refreshStatus();
});
