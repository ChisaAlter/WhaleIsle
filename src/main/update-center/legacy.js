'use strict';

// The launcher service's update operations, answered by the update center in
// the desktop package so older surfaces cannot start a second, invisible job.

/** Center snapshot → the legacy check payload ({ status, latest, ... }). */
function legacyCheck(view) {
  const status = view.phase === 'error' ? 'error' : view.target ? 'available' : 'current';
  return {
    status,
    current: view.current,
    latest: view.target?.version || view.current,
    tag: view.target?.tag || '',
    notes: view.target?.notes || '',
    route: view.route,
    message: view.error?.message || '',
    updateCenter: true,
  };
}

/**
 * @param {object} service - createLauncherService() result.
 * @param {{ command: Function, snapshot: Function }} center
 * @param {() => void} openCenter - shows the update center.
 */
function withUpdateCenter(service, center, openCenter) {
  return {
    ...service,
    checkUpdate: async () => legacyCheck(await center.command('check')),
    // Installing always happens in view of the update center.
    installUpdate: async () => {
      openCenter();
      const phase = center.snapshot().phase;
      if (phase === 'ready') await center.command('install');
      else if (phase === 'available') await center.command('download');
      else if (phase === 'paused' || phase === 'error') await center.command('resume');
      return { status: 'opened', launched: false, updateCenter: true };
    },
    installRelease: async (tag) => {
      openCenter();
      await center.command('installVersion', tag);
      return { status: 'opened', launched: false, updateCenter: true };
    },
  };
}

module.exports = { withUpdateCenter, legacyCheck };
