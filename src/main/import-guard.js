/**
 * Shared maintenance/import admission boundary — one module-level owner for
 * every path that starts, restarts, installs, or mutates the desktop
 * runtime and its profile/config. The launcher service holds it for the
 * whole stop->import interval; boot retry, config writes, profile ops, and
 * installer/start entry points must acquire (or refuse) the same slot so a
 * competing mutation cannot slip between the checks.
 *
 * Two orthogonal conditions gate a mutating operation:
 *  1. `maintenanceHeld` — another operation currently owns the slot.
 *  2. `recoveryBlocked` — a persistent `blocked` import journal (or an
 *     unreadable one) means the destination trees are unresolved; no start
 *     or write may proceed until recovery reconciles them.
 */

let maintenanceHeld = null;

function isMaintenanceHeld() {
  return maintenanceHeld !== null;
}

function maintenanceOwner() {
  return maintenanceHeld;
}

/**
 * Owner-aware delegation: is `owner` the operation that currently owns the
 * slot? A nested internal call that carries the live owner token may proceed
 * (it is the same authorized operation reaching a deeper boundary), while an
 * unrelated caller — or no token at all — must acquire or refuse. Callers
 * must pass the actual token object they received from `acquireMaintenance`,
 * never a kind string or a guessed reference.
 */
function holdsMaintenance(owner) {
  return owner !== null && owner !== undefined && maintenanceHeld === owner;
}

/**
 * Take the maintenance slot for `kind` ('import' | 'retry' | 'install' |
 * 'start' | 'config'). Returns the owner token on success, or null when the
 * slot is already held. The token must be passed to `releaseMaintenance`.
 */
function acquireMaintenance(kind, meta = {}) {
  if (maintenanceHeld !== null) {
    return null;
  }
  const owner = { kind, meta, acquiredAt: Date.now() };
  maintenanceHeld = owner;
  return owner;
}

/**
 * Release only if `owner` is the current owner — a stale handle can never
 * drop a newer operation's ownership.
 */
function releaseMaintenance(owner) {
  if (owner && maintenanceHeld === owner) {
    maintenanceHeld = null;
    return true;
  }
  return false;
}

/**
 * Assert the slot is free for a mutating op. Throws an Error tagged
 * `code = 'maintenance-in-progress'` when held.
 */
function assertMaintenanceFree(kind) {
  if (maintenanceHeld !== null) {
    const error = new Error(`maintenance-in-progress:${maintenanceHeld.kind || 'other'}`);
    error.code = 'maintenance-in-progress';
    error.owner = maintenanceHeld.kind;
    throw error;
  }
}

module.exports = {
  isMaintenanceHeld,
  maintenanceOwner,
  holdsMaintenance,
  acquireMaintenance,
  releaseMaintenance,
  assertMaintenanceFree,
};
