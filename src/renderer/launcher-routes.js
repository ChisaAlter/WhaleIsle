'use strict';

// 下载线路：路由标签、选择器、弹出层与持久化。
// 启动器按功能拆分的经典脚本：与页面其余脚本共享同一全局作用域，跨文件函数与状态在调用时解析。

function routeLabel(routes, routeId) {
  const row = (Array.isArray(routes) ? routes : []).find((route) => route && route.id === routeId);
  return (row && row.label) || routeId || '';
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = size;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n >= 10 || unit === 0 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
}

function selectedRoute() {
  const picked = document.querySelector('#route-picker .line-card.is-sel');
  return picked ? picked.dataset.routePick : '';
}

// Route picks serialize: each new keypress is the latest intent and must be
// saved, even if a previous save is still in flight. A naive `value===prev`
// check drops the second pick when Right then Left fire before the status
// refresh re-renders the selection, so dedup compares only against the last
// value actually issued — never against the rendered selection.
let routeSaveGen = 0;
const lastIssuedRoute = { value: '' };

async function issueRouteSave(api, value, refreshStatus, setHint, errText) {
  const gen = ++routeSaveGen;
  lastIssuedRoute.value = value;
  try {
    const reply = await api.saveLauncherConfig({ downloadRoute: value });
    // A resolved refusal ({ok:false}) is as much a failure as a rejection:
    // the service declined the write (e.g. maintenance-in-progress). Treat
    // it identically — reset the marker and surface the error — instead of
    // returning success on a route that was never persisted.
    if (reply && reply.ok === false) {
      throw Object.assign(new Error(reply.error || 'save-refused'), { refused: true });
    }
    if (gen === routeSaveGen) {
      void refreshStatus();
    }
    return true;
  } catch (error) {
    // The save did not commit, so the issued marker must not keep pointing
    // at a route that never persisted — re-seed it to the value that is
    // actually selected. Otherwise a retry of the same route is deduped
    // away (`value === lastIssuedRoute`) and the user can never re-pick it.
    if (lastIssuedRoute.value === value) {
      lastIssuedRoute.value = selectedRoute();
    }
    if (gen === routeSaveGen) {
      setHint(errText(error, '设置保存失败'));
    }
    return false;
  }
}

/**
 * Radio-group arrow-key index step, extracted for direct testing: wraps
 * Left/Up and Right/Down through the enabled subset only. Returns -1 for a
 * key the radio group does not own, so the caller ignores it.
 */
function radioNextIndex(enabledList, currentIndex, key) {
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return currentIndex <= 0 ? enabledList.length - 1 : currentIndex - 1;
  }
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return currentIndex < 0 || currentIndex >= enabledList.length - 1 ? 0 : currentIndex + 1;
  }
  return -1;
}

// Both the home card and the settings row render from the same status payload
// (status.routes / status.downloadRoute); unverified routes are visible but
// not selectable per plan ("标注未完成" before real-file verification).
function renderRouteControls(status) {
  const routes = Array.isArray(status?.routes) ? status.routes : [];
  const current = status?.downloadRoute || '';
  const componentRoute = document.querySelector('[data-comp-route]');
  if (componentRoute) {
    const selected = routes.find(route => route.id === current);
    componentRoute.querySelector('.cur-line').textContent = selected?.label || selected?.id || '';
    componentRoute.hidden = !selected;
  }
  // Remember which route had focus so a re-render (triggered by a
  // status refresh) can restore focus to the same logical option by id.
  const focusedPickerRoute = document.activeElement?.dataset?.routePick;
  const focusedSegRoute = document.activeElement?.dataset?.route;
  // Seed the issued marker with the freshly rendered selection so a re-pick
  // of the already-selected route is a no-op, while any different pick is
  // always issued even if the render is mid-burst stale.
  if (!lastIssuedRoute.value) {
    lastIssuedRoute.value = current;
  }
  const pickRoute = async (value, prev) => {
    // `prev` is what the render happened to show — stale as soon as a newer
    // pick was issued. The only true duplicate is re-issuing the value we
    // already issued most recently.
    if (!value || value === lastIssuedRoute.value) return;
    await issueRouteSave(pageShell(), value, refreshStatus, setHint, errText);
  };
  // Keyboard: arrows move AND select (radio-group semantics), skipping
  // disabled routes; focus and checked state stay in sync via the same pick.
  const radioKeyNav = (list, pick) => (event) => {
    const enabled = list.filter((b) => !b.disabled);
    const next = radioNextIndex(enabled, enabled.indexOf(document.activeElement), event.key);
    if (next >= 0 && next < enabled.length) {
      event.preventDefault();
      const target = enabled[next];
      target.focus();
      pick(target);
    }
  };
  const railRoute = $('rail-route');
  if (railRoute) {
    railRoute.textContent = routeLabel(routes, current) || '未选择';
  }
  const railPop = $('rail-route-pop');
  if (railPop) {
    renderRouteOptions(railPop, routes, current, async (picked) => {
      closeRoutePops();
      await pickDownloadRoute(picked, current);
    });
  }
  const picker = $('route-picker');
  if (picker) {
    mount(picker, ...routes.map((route) => h('button', {
      type: 'button',
      role: 'radio',
      class: `line-card${route.id === current ? ' is-sel' : ''}${route.verified ? '' : ' is-disabled'}`,
      dataset: { routePick: route.id },
      'aria-checked': route.id === current ? 'true' : 'false',
      tabindex: route.id === current ? '0' : '-1',
      disabled: route.verified ? undefined : true,
    },
      h('span', { class: 'lc-title' },
        h('span', { class: 'lc-radio', 'aria-hidden': 'true' }),
        route.label,
        route.verified ? null : [' ', h('span', { class: 'badge warn' }, '未启用')]),
      h('span', { class: 'lc-desc' }, route.detail || ''))));
    picker.querySelectorAll('[data-route-pick]').forEach((button) => {
      button.addEventListener('click', () => pickRoute(button.dataset.routePick, current));
    });
    // Bind the container handler exactly once: re-rendering only replaces
    // the children, so a handler re-added each render would stack and replay a
    // single keypress many times.
    if (!picker.dataset.navBound) {
      picker.dataset.navBound = '1';
      picker.addEventListener('keydown', (event) => {
        const buttons = [...picker.querySelectorAll('[data-route-pick]')];
        radioKeyNav(buttons, (b) => pickRoute(b.dataset.routePick, selectedRoute()))(event);
      });
      // Roving tabindex: whichever radio holds focus is the group's single
      // tab stop; arrows that move focus move the stop with them.
      picker.addEventListener('focusin', (event) => {
        if (!event.target?.dataset?.routePick) return;
        picker.querySelectorAll('[data-route-pick]').forEach((b) => {
          b.tabIndex = b === event.target ? 0 : -1;
        });
      });
    }
    // Restore focus to the same logical route after the re-render.
    if (focusedPickerRoute) {
      const again = picker.querySelector(`[data-route-pick="${CSS.escape(focusedPickerRoute)}"]`);
      if (again && !again.disabled) again.focus();
    }
  }
  const seg = $('route-seg');
  const segNote = $('route-seg-note');
  if (seg) {
    mount(seg, ...routes.map((route) => h('button', {
      type: 'button',
      role: 'radio',
      class: `seg${route.id === current ? ' is-active' : ''}`,
      dataset: { route: route.id },
      disabled: route.verified ? undefined : true,
      'aria-checked': route.id === current ? 'true' : 'false',
      tabindex: route.id === current ? '0' : '-1',
      title: `${route.detail || ''}${route.verified ? '' : '（待验证）'}`,
    }, route.label)));
    if (segNote) {
      const disabled = routes.filter((route) => !route.verified);
      segNote.hidden = disabled.length === 0;
      segNote.textContent = disabled.length
        ? disabled.map((route) => `${route.label}：待验证，暂不可用`).join('；')
        : '';
    }
    seg.querySelectorAll('[data-route]').forEach((button) => {
      button.addEventListener('click', () => pickRoute(button.dataset.route, current));
    });
    if (!seg.dataset.navBound) {
      seg.dataset.navBound = '1';
      seg.addEventListener('keydown', (event) => {
        const buttons = [...seg.querySelectorAll('[data-route]')];
        radioKeyNav(buttons, (b) => pickRoute(b.dataset.route, selectedRoute()))(event);
      });
      seg.addEventListener('focusin', (event) => {
        if (!event.target?.dataset?.route) return;
        seg.querySelectorAll('[data-route]').forEach((b) => {
          b.tabIndex = b === event.target ? 0 : -1;
        });
      });
    }
    if (focusedSegRoute) {
      const again = seg.querySelector(`[data-route="${CSS.escape(focusedSegRoute)}"]`);
      if (again && !again.disabled) again.focus();
    }
  }
}

function setRoutePop(chip, pop, open) {
  if (!chip || !pop) {
    return;
  }
  if (!open && pop.contains(document.activeElement)) chip.focus();
  pop.hidden = !open;
  if (chip.setAttribute) {
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (open) {
    const option = pop.querySelector('[aria-selected="true"]:not(:disabled)')
      || pop.querySelector('[role="option"]:not(:disabled)');
    pop.querySelectorAll('[role="option"]').forEach(node => { node.tabIndex = node === option ? 0 : -1; });
    option?.focus();
  }
}

// Both route popovers (Versions header + rail footer) close together: an
// outside click or Escape sweeps every open one.
function closeRoutePops(exceptWrap) {
  document.querySelectorAll('.route-pop-wrap').forEach((wrap) => {
    if (wrap === exceptWrap) {
      return;
    }
    setRoutePop(wrap.querySelector('[aria-haspopup="listbox"]'), wrap.querySelector('.route-pop'), false);
  });
}

// Shared option list for every route popover: checked current, unverified
// rows disabled, one click delegates to the caller's save flow.
function renderRouteOptions(pop, routes, routeId, onPick) {
  const focusedId = pop.contains(document.activeElement) ? document.activeElement.dataset.routeOpt : null;
  const selectedId = routes.find(route => route.verified && route.id === routeId)?.id
    || routes.find(route => route.verified)?.id;
  const focusId = routes.some(route => route.verified && route.id === focusedId) ? focusedId : selectedId;
  mount(pop, ...routes.map((route) => h('button', {
    type: 'button',
    role: 'option',
    class: 'route-opt',
    dataset: { routeOpt: route.id },
    'aria-selected': route.id === routeId ? 'true' : 'false',
    tabindex: route.id === focusId ? '0' : '-1',
    disabled: route.verified ? undefined : true,
  },
    h('span', { class: 'route-opt-check', 'aria-hidden': 'true' }, route.id === routeId ? '✓' : ''),
    h('span', { class: 'route-opt-body' },
      h('span', { class: 'route-opt-title' },
        route.label || route.id,
        route.verified ? null : [' ', h('span', { class: 'badge warn' }, '未启用')]),
      h('span', { class: 'route-opt-desc' }, `${route.detail || ''}${route.verified ? '' : '（待验证，暂不可用）'}`)))));
  pop.querySelectorAll('[data-route-opt]').forEach((button) => {
    button.addEventListener('click', () => { void onPick(button.dataset.routeOpt); });
  });
  if (focusedId && !pop.hidden) {
    const option = [...pop.querySelectorAll('[role="option"]:not(:disabled)')]
      .find(node => node.dataset.routeOpt === focusedId)
      || pop.querySelector('[tabindex="0"]:not(:disabled)');
    option?.focus();
  }
  pop.onkeydown = event => {
    const options = [...pop.querySelectorAll('[role="option"]:not(:disabled)')];
    const index = options.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = options[(index + 1) % options.length];
    if (event.key === 'ArrowUp') next = options[(index - 1 + options.length) % options.length];
    if (event.key === 'Home') next = options[0];
    if (event.key === 'End') next = options.at(-1);
    if (next) {
      event.preventDefault();
      options.forEach(node => { node.tabIndex = node === next ? 0 : -1; });
      next.focus();
    }
  };
  pop.onfocusout = event => {
    if (event.relatedTarget && !pop.closest('.route-pop-wrap').contains(event.relatedTarget)) {
      const chip = pop.closest('.route-pop-wrap').querySelector('[aria-haspopup="listbox"]');
      setRoutePop(chip, pop, false);
    }
  };
}

async function pickDownloadRoute(routeId, current, afterSave) {
  // Route the popup save through the same issued-marker/generation the
  // radio picker uses. Two different controls issuing saves without a
  // shared marker can interleave (`A` popup, `B` radio, `A` resolves last)
  // and leave the rendered selection out of sync with what persisted.
  // Do NOT early-return on `routeId === current`: `current` is the stale
  // rendered selection, which during an outstanding save can still show the
  // previous route — returning to it would silently discard the user's
  // latest intent. The only true duplicate is re-issuing the value we
  // already issued most recently.
  if (!routeId || routeId === lastIssuedRoute.value) {
    return;
  }
  const saved = await issueRouteSave(pageShell(), routeId, refreshStatus, setHint, errText);
  if (saved && typeof afterSave === 'function') {
    afterSave();
  }
}
