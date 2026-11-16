// Verbatim desktop wording (vendor ui-conversation locales `access.preset.*`)
// so the phone chip and the desktop PermissionSelect compare string-equal.
const PRESET_LABELS = {
  'read-only': '仅可查看',
  'workspace-write': '可写入工作区',
  'danger-full-access': '完全权限',
  plan: '计划',
};

const DEFAULT_PRESETS = [
  { id: 'read-only', label: PRESET_LABELS['read-only'] },
  { id: 'workspace-write', label: PRESET_LABELS['workspace-write'] },
  { id: 'danger-full-access', label: PRESET_LABELS['danger-full-access'] },
];

function permissionLabel(id) {
  if (typeof id !== 'string' || !id) return '';
  return PRESET_LABELS[id] || id;
}

function permissionFromEvents(events) {
  let current = '';
  let planOn = false;
  for (const entry of events || []) {
    const event = entry?.event || entry;
    if (event?.type === 'permission/preset' && typeof event.data?.preset === 'string') {
      current = event.data.preset;
      if (current === 'plan') planOn = true;
    }
    if (event?.type === 'plan/mode' && event.data) {
      planOn = event.data.enabled === true || event.data.mode === 'on' || event.data.active === true;
    }
  }
  return { current, planOn: planOn || current === 'plan' };
}

function planOnFromView(plan) {
  if (!plan || typeof plan !== 'object') return false;
  const active = plan.active === true;
  const pending = plan.pending === true;
  return pending ? !active : active;
}

function permissionFromProjections(projections) {
  const values = projections?.values && typeof projections.values === 'object'
    ? projections.values
    : {};
  const current = typeof values.permissions?.currentValue === 'string'
    ? values.permissions.currentValue
    : '';
  return { current, planOn: planOnFromView(values.plan) };
}

function applyPermissionSnapshot({ projections, events, previous }) {
  const values = projections?.values && typeof projections.values === 'object'
    ? projections.values
    : {};
  const fromProj = permissionFromProjections(projections);
  const fromEvents = permissionFromEvents(events);
  const current = fromProj.current || fromEvents.current || previous?.current || '';
  let planOn;
  if (values.plan && typeof values.plan === 'object') {
    planOn = fromProj.planOn;
  } else if (fromEvents.planOn) {
    planOn = true;
  } else {
    planOn = previous?.planOn === true;
  }
  return { current, planOn };
}

function applyPermissionProjectionFrame(permission, payload) {
  if (!payload || payload.type !== 'session/projection') return permission;
  if (payload.key === 'permissions' && typeof payload.value?.currentValue === 'string') {
    return { ...permission, current: payload.value.currentValue };
  }
  if (payload.key === 'plan') {
    return { ...permission, planOn: planOnFromView(payload.value) };
  }
  return permission;
}

function permissionCommand(id) {
  return `/permission ${id}`;
}

export {
  DEFAULT_PRESETS,
  applyPermissionProjectionFrame,
  applyPermissionSnapshot,
  permissionCommand,
  permissionFromEvents,
  permissionFromProjections,
  permissionLabel,
};
