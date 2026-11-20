'use strict';

/**
 * Mutable shell state shared across the startup phases (#439 P3-4). index.js
 * owns the object and passes it to every phase factory; anything previously
 * held in entry-level `let` that crosses a phase boundary lives here so no
 * module reaches into another module's internals.
 *
 * @typedef {object} ShellState
 * @property {boolean} quitting — a quit has been requested (windows veto closes)
 * @property {boolean} stoppingForQuit — the quit commit started resource teardown
 * @property {boolean} quitInProgress — one quit attempt stays latched until exit
 * @property {boolean} nativeQuitReady — cleanup authorized the final native close
 * @property {boolean} closingOverlayActive — closing overlay owns window input
 * @property {any} desktopResources — registerIpc() return (pty/preview/launcher)
 * @property {boolean} qaQuitIntercepted — DSH_QA_SHELL intercepted a quit request
 * @property {boolean} backgroundStartup — --background: only the initial
 *   presentation is inactive; reset after the startup gate settles
 * @property {any} launcherWindowHandle — launcher window a parked update ask
 *   belongs to; a stale ask must never keep going on a hidden window
 * @property {any} updateCenter — desktop update-center service (full package)
 * @property {any} platformView — embedded Platform documents view
 * @property {Function|undefined} platformSessionRefresh — session refetch hook
 * @property {any} approvalMonitor — minimized approval popup & app badge coordinator
 */

/**
 * @returns {ShellState}
 */
function createShellState() {
  return {
    quitting: false,
    stoppingForQuit: false,
    quitInProgress: false,
    nativeQuitReady: false,
    // Shell-owned input block for the shortcut bridge: while the closing
    // overlay owns the window, bound chords and menu dispatch must not run
    // commands.
    closingOverlayActive: false,
    desktopResources: null,
    qaQuitIntercepted: false,
    // Only the initial presentation is inactive; later user entries keep
    // focus.
    backgroundStartup: process.argv.includes('--background'),
    // The launcher window a parked update ask belongs to. A stale ask (window
    // closed/recreated, app quitting, install already started) must never keep
    // going on a window the user can no longer see.
    launcherWindowHandle: null,
    updateCenter: null,
    platformView: undefined,
    platformSessionRefresh: undefined,
    approvalMonitor: null,
  };
}

module.exports = { createShellState };
