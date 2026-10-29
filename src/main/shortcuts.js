'use strict';

// Desktop shortcut ownership for the Harness view, mirroring the official
// apps/desktop keyboard bridge (vendor/deepseek-harness/apps/desktop/src/
// keybindings.ts + keyboard.ts) under the adopted local-first input policy.
//
// Bridge contract (upstream): the product main frame reads
// document.documentElement.dataset.platform for runtime detection and
// window.dshDesktop.{keyboard,shortcuts} for persistence + native input.
// We expose only that narrow pair — never the full official product API
// (browser/updates) — so other plugins cannot misdetect capabilities.
//
// Upstream-priority policy (user decision 2026-09-26): accepted bindings are
// intercepted by the main process before the page/guest sees them — bound
// keys inside a focused iframe and chord (second-code) bindings everywhere
// are preventDefault'd and dispatched natively. The vendored DOM dispatcher
// (packages/client/shortcuts/src/client/native.ts) still arbitrates
// region/modal after interception. This layer owns: the keybindings.json
// single writer, menu-accelerator suppression for bound chords, native
// interception + guest attach, explicit menu-click dispatch through the
// registry, recording suppression, overlay input blocking, and
// revision-checked closeWindow.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The vendored harness ships inside resources/vendor/deepseek-harness.tar in
// packaged builds, so the bridge binds a snapshot under src/main instead of
// importing the workspace lib (see shortcuts-protocol.mjs header).
const PROTOCOL_URL = pathToFileURL(path.join(__dirname, 'shortcuts-protocol.mjs')).href;

const CHANNELS = {
  input: 'shell:shortcuts-input',
  changed: 'shell:shortcuts-changed',
  get: 'shell:shortcuts-get',
  edit: 'shell:shortcuts-edit',
  recording: 'shell:shortcuts-recording',
  closeWindow: 'shell:shortcuts-close-window',
};

// presentBinding().aria segments → Electron accelerator tokens.
const ARIA_MODIFIERS = { Control: 'CmdOrCtrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' };
const ARIA_KEYS = {
  ',': ',', '.': '.', '/': '/', '\\': '\\', '`': '`', '-': '-', '=': '=',
  ';': ';', "'": "'", '[': '[', ']': ']',
  Enter: 'Enter', Space: 'Space', Tab: 'Tab', Escape: 'Esc',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};

function ariaToAccelerator(aria, platform) {
  if (typeof aria !== 'string' || aria === '') return undefined;
  const parts = aria.split('+');
  const key = parts.pop();
  const accelerator = parts.map((part) => {
    if (platform === 'macos' && part === 'Control') return 'Control';
    if (platform === 'macos' && part === 'Meta') return 'Command';
    return ARIA_MODIFIERS[part];
  });
  if (accelerator.some((part) => part === undefined)) return undefined;
  const suffix = key in ARIA_KEYS ? ARIA_KEYS[key]
    : /^(F\d{1,2}|[A-Z0-9])$/u.test(key) ? key : undefined;
  if (suffix === undefined) return undefined;
  return accelerator.length === 0 ? suffix : `${accelerator.join('+')}+${suffix}`;
}

function writeFileAtomic(file, raw) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, raw, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Install the desktop shortcut bridge.
 * @param {object} options
 * @param {object} options.ipcMain - Electron ipcMain (or a compatible mock).
 * @param {string} options.userData - device preference directory (keybindings.json lives here).
 * @param {string} options.platform - 'windows' | 'macos' | 'linux'.
 * @param {() => object|undefined} options.getView - Harness BrowserView whose webContents owns the bridge.
 * @param {() => object|undefined} options.getWindow - owning product window.
 * @param {() => string} options.getOrigin - trusted harness origin ('http://127.0.0.1:port').
 * @param {(window: object) => {revision:number, blocked:boolean}} [options.overlayInput] - shell overlay blocking state.
 * @param {() => void} [options.onMenuChanged] - rebuild the application menu when accelerators change.
 * @param {object} [options.protocol] - vendored shortcuts protocol module (tests inject; prod lazy-imports).
 */
function createShortcutService(options) {
  const {
    ipcMain, userData, platform, getView, getWindow, getOrigin,
    overlayInput = () => ({ revision: 0, blocked: false }),
    onMenuChanged = () => {},
    protocol: injectedProtocol,
  } = options;

  let protocol = injectedProtocol ?? null;
  let persistence = null;
  let definitions = [];
  let recording = false;
  let revision;
  let rows = [];
  let keys = new Set();
  const disposers = new Set();

  const keybindingsPath = path.join(userData, 'keybindings.json');
  const migrationReceiptPath = path.join(userData, 'keybindings-migration.json');

  const menuAccelerators = () => {
    const table = {};
    if (protocol === null) return table;
    for (const row of rows) {
      if (row.binding !== null && row.issue === null && row.conflicts.length === 0) {
        const accelerator = ariaToAccelerator(protocol.presentBinding(row.binding, platform).aria, platform);
        if (accelerator !== undefined) table[row.id] = accelerator;
      }
    }
    return table;
  };

  const publish = (snapshot) => {
    const wasEnabled = revision !== undefined;
    const previous = JSON.stringify(menuAccelerators());
    revision = definitions.length === 0 || snapshot.status === 'loading' ? undefined : snapshot.revision;
    rows = snapshot.status === 'loading' || definitions.length === 0
      ? []
      : protocol.effectiveShortcuts(definitions, snapshot.document, 'desktop', platform);
    keys = new Set(rows.flatMap((row) =>
      row.binding !== null && row.issue === null && row.conflicts.length === 0
        ? [protocol.bindingKey(row.binding)] : []));
    if (wasEnabled !== (revision !== undefined) || previous !== JSON.stringify(menuAccelerators())) {
      onMenuChanged();
    }
    const contents = view()?.webContents;
    if (contents !== undefined && contents.mainFrame.url.startsWith(getOrigin())) {
      contents.send(CHANNELS.changed, snapshot);
    }
  };

  const buildPersistence = () => new protocol.ShortcutPersistence({
    read: async () => {
      try {
        return await fs.promises.readFile(keybindingsPath, 'utf8');
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    write: async (raw) => writeFileAtomic(keybindingsPath, raw),
  }, 'desktop', platform, false, publish);

  const protocolPromise = injectedProtocol === undefined
    ? import(PROTOCOL_URL).then((module) => {
      protocol = module;
      persistence = buildPersistence();
      return module;
    })
    : Promise.resolve(protocol).then((module) => {
      persistence = buildPersistence();
      return module;
    });

  const view = () => {
    const target = getView();
    return target !== undefined && !target.webContents.isDestroyed() ? target : undefined;
  };

  const assertSender = (event) => {
    const target = view();
    if (target === undefined || event.sender !== target.webContents
      || event.senderFrame !== target.webContents.mainFrame
      || !event.senderFrame.url.startsWith(getOrigin())) {
      throw new Error('desktop shortcuts: rejected sender');
    }
    return target;
  };

  // First-boot migration: accept a web-origin document only from the trusted
  // main frame, only when no device file exists yet, and only when it parses
  // as a current schema. The source localStorage entry stays as the backup;
  // a receipt records the mapping.
  const migrateFromWeb = (raw) => {
    if (typeof raw !== 'string' || raw === '' || fs.existsSync(keybindingsPath)) return;
    if (typeof protocol.parseShortcutDocument(raw) === 'string') return;
    try {
      writeFileAtomic(keybindingsPath, raw);
      writeFileAtomic(migrationReceiptPath, `${JSON.stringify({
        migratedAt: new Date().toISOString(),
        source: 'web localStorage dsh.keybindings.v1',
        target: 'keybindings.json',
      }, null, 2)}\n`);
    } catch {
      // A failed migration leaves the device file absent; the next read serves defaults.
    }
  };

  ipcMain.handle(CHANNELS.get, async (event, input, webRaw) => {
    assertSender(event);
    const module = await protocolPromise;
    definitions = module.parseShortcutDefinitions(input);
    migrateFromWeb(webRaw);
    persistence.setDefinitions(definitions);
    return persistence.readCurrent();
  });
  ipcMain.handle(CHANNELS.edit, async (event, input, expectedRevision) => {
    assertSender(event);
    if (typeof expectedRevision !== 'string') throw new Error('desktop shortcuts: invalid revision');
    const module = await protocolPromise;
    return persistence.edit(module.parseShortcutEdit(input), expectedRevision);
  });
  ipcMain.handle(CHANNELS.recording, (event, active) => {
    const target = assertSender(event);
    if (typeof active !== 'boolean') throw new Error('desktop shortcuts: invalid recording state');
    recording = active;
    target.webContents.setIgnoreMenuShortcuts(active);
  });
  ipcMain.handle(CHANNELS.closeWindow, (event, expected) => {
    assertSender(event);
    const win = getWindow();
    if (expected !== revision || revision === undefined || recording || win === undefined
      || win.isDestroyed() || !win.isFocused() || !win.isEnabled() || overlayInput(win).blocked) return;
    win.close();
  });

  // Explicit menu click → registry dispatch carrying the accepted revision.
  // @returns whether the command was delivered to the registry dispatcher.
  const dispatchMenuCommand = (commandId) => {
    const win = getWindow();
    const contents = view()?.webContents;
    if (win === undefined || contents === undefined || win.isDestroyed() || !win.isFocused()
      || !win.isEnabled() || revision === undefined || recording || overlayInput(win).blocked) {
      return false;
    }
    contents.send(CHANNELS.input, { kind: 'menu', commandId, revision });
    return true;
  };

  const acceleratorFor = (commandId) => menuAccelerators()[commandId];

  // Upstream attachInput: native interception for accepted bindings with
  // chord tracking; guest webview contents attach through the same path with
  // a lease name instead of main-frame semantics.
  const scopedDesktop = platform === 'windows' || platform === 'macos';
  const guestInputs = new Map();
  let editingInput;

  function attachInput(window, contents, guestName) {
    let deadKey = false;
    const held = new Set();
    const consumed = new Map();
    let inputFrame = null;
    let inputRevision;
    let overlayRevision = overlayInput(window).revision;
    const resetInput = () => {
      deadKey = false;
      held.clear();
      consumed.clear();
      inputFrame = null;
      inputRevision = undefined;
      if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(false);
    };
    if (guestName !== undefined) guestInputs.set(contents, { window, reset: resetInput });
    const resetWindow = () => {
      resetInput();
      for (const guest of guestInputs.values()) if (guest.window === window) guest.reset();
    };
    const clear = () => {
      resetInput();
      if (guestName !== undefined) return;
      definitions = [];
      keys.clear();
      recording = false;
      rows = [];
      persistence?.setDefinitions(null);
    };
    const navigation = (event) => {
      if (event.isMainFrame && !event.isSameDocument) clear();
    };
    const beforeInput = (event, input) => {
      const overlay = overlayInput(window);
      if (overlay.revision !== overlayRevision) {
        resetInput();
        overlayRevision = overlay.revision;
      }
      if (overlay.blocked) {
        // The overlay owns every input path: page keys AND native menu
        // accelerators must not fire commands while it is up.
        contents.setIgnoreMenuShortcuts(true);
        event.preventDefault();
        return;
      }
      if (event.defaultPrevented) {
        resetInput();
        return;
      }
      if (editingInput === contents) {
        held.clear();
        consumed.clear();
        contents.setIgnoreMenuShortcuts(true);
        return;
      }
      if (window !== getWindow() || !window.isFocused() || !window.isEnabled()
        || revision === undefined || protocol === null
        || (guestName !== undefined && !contents.isFocused())) {
        contents.setIgnoreMenuShortcuts(false);
        held.clear();
        consumed.clear();
        return;
      }
      const modifiers = ['control', 'alt', 'shift', 'meta'].filter((modifier) => input[modifier]);
      const key = protocol.bindingKey({ code: input.code, modifiers });
      const match = keys.has(key);
      contents.setIgnoreMenuShortcuts(recording || match);
      const frame = contents.focusedFrame;
      const composing = input.isComposing || input.key === 'Dead' || deadKey
        || (typeof input.modifiers?.includes === 'function' && input.modifiers.includes('altgr'));
      if (input.type === 'keyDown') deadKey = input.key === 'Dead';
      if (recording || composing || frame === null) {
        held.clear();
        consumed.clear();
        return;
      }
      let binding = { code: input.code, modifiers };
      let priority = false;
      if (scopedDesktop) {
        if (frame !== inputFrame || inputRevision !== revision) {
          held.clear();
          inputFrame = frame;
          inputRevision = revision;
        }
        const modifierKey = /^(Control|Alt|Shift|Meta)(Left|Right)$/u.test(input.code);
        if (input.type === 'keyUp') {
          // A chord's first key reached the renderer, so its release must
          // reach the same input handlers.
          if (consumed.get(input.code) === 'press') event.preventDefault();
          consumed.delete(input.code);
          held.delete(input.code);
          if (modifierKey) held.clear();
          return;
        }
        if (!input.isAutoRepeat) consumed.delete(input.code);
        if (modifierKey) {
          held.clear();
          return;
        }
        if (input.isAutoRepeat && consumed.has(input.code) && !match) {
          event.preventDefault();
          return;
        }
        if (input.isAutoRepeat && !held.has(input.code) && !match) return;
        held.add(input.code);
        const codes = [input.code, ...[...held].filter((value) => value !== input.code)];
        codes.sort();
        const pair = { code: codes[0], ...(codes[1] === undefined ? {} : { secondCode: codes[1] }), modifiers };
        priority = keys.has(key);
        if (codes.length === 2 && keys.has(protocol.bindingKey(pair))) {
          binding = pair;
          priority = true;
        }
      }
      const main = guestName === undefined && frame === contents.mainFrame;
      if (!priority && (main || !match)) return;
      event.preventDefault();
      if (input.type !== 'keyDown') return;
      if (scopedDesktop) {
        if (!input.isAutoRepeat) {
          if (binding.secondCode !== undefined) {
            consumed.set(binding.code, 'repeat');
            consumed.set(binding.secondCode, 'repeat');
          }
          consumed.set(input.code, 'press');
        }
        // Electron can omit both keyups after interception; completed
        // presses cannot seed another chord.
        held.clear();
      }
      let embedding = frame;
      while (guestName === undefined && !main && embedding.parent !== null && embedding.parent !== contents.mainFrame) {
        embedding = embedding.parent;
      }
      // The product document (harness BrowserView) owns the registry
      // dispatcher — guest/iframe inputs route to it, not the chrome window.
      const dispatcher = view()?.webContents;
      if (dispatcher === undefined || dispatcher.isDestroyed()) return;
      dispatcher.send(CHANNELS.input, {
        kind: guestName === undefined ? (main ? 'keyboard' : 'iframe') : 'webview',
        revision,
        frameName: guestName ?? (main ? '' : embedding.name),
        code: binding.code,
        ...(binding.secondCode === undefined ? {} : { secondCode: binding.secondCode }),
        repeat: input.isAutoRepeat,
        control: input.control,
        alt: input.alt,
        shift: input.shift,
        meta: input.meta,
      });
    };
    const dispose = () => {
      contents.off('did-start-navigation', navigation);
      contents.off('before-input-event', beforeInput);
      contents.off('blur', resetInput);
      contents.off('destroyed', dispose);
      if (guestName === undefined && window !== undefined) {
        window.off('blur', resetWindow);
        window.off('closed', closed);
      }
      disposers.delete(dispose);
      guestInputs.delete(contents);
      if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(false);
    };
    const closed = () => {
      clear();
      dispose();
    };
    contents.on('did-start-navigation', navigation);
    contents.on('before-input-event', beforeInput);
    contents.on('blur', resetInput);
    contents.once('destroyed', dispose);
    if (guestName === undefined && window !== undefined) {
      window.on('closed', closed);
      window.on('blur', resetWindow);
    }
    disposers.add(dispose);
    return dispose;
  }

  function attach(targetView) {
    const contents = targetView.webContents ?? targetView;
    return attachInput(getWindow(), contents);
  }

  /**
   * Intercept an approved browser guest's keys until its lease ends.
   * @param {object} guest - approved browser guest webContents.
   * @param {string} name - main-issued lease used as the webview element name.
   */
  function attachGuest(guest, name) {
    return attachInput(getWindow(), guest, name);
  }

  /**
   * Send a native Edit action to the focused editor without matching user
   * shortcuts (upstream sendEditingKey: interception bypasses the synthetic
   * pair so menu roles still reach inputs).
   * @param {string} keyCode - edit key.
   * @param {string[]} modifiers - Electron edit modifiers.
   * @returns {boolean} whether the focused product window owns this action.
   */
  function sendEditingKey(keyCode, modifiers) {
    const window = getWindow();
    if (!window || window.isDestroyed() || !window.isFocused()) return false;
    if (overlayInput(window).blocked || recording || !window.isEnabled()) return true;
    const contents = [...guestInputs].find(([guest, owner]) => owner.window === window && !guest.isDestroyed() && guest.isFocused())?.[0]
      ?? view()?.webContents;
    if (contents === undefined || contents.isDestroyed()) return false;
    contents.focus();
    const previous = editingInput;
    editingInput = contents;
    try {
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    } finally {
      editingInput = previous;
      if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(recording);
    }
    return true;
  }

  return {
    attach,
    attachGuest,
    sendEditingKey,
    dispatchMenuCommand,
    acceleratorFor,
    currentRevision: () => revision,
    dispose() {
      for (const dispose of [...disposers]) dispose();
      persistence?.dispose();
      for (const channel of [CHANNELS.get, CHANNELS.edit, CHANNELS.recording, CHANNELS.closeWindow]) {
        ipcMain.removeHandler(channel);
      }
    },
    // Test seams.
    _persistence: () => persistence,
    _keybindingsPath: keybindingsPath,
    _migrationReceiptPath: migrationReceiptPath,
    _protocol: () => protocolPromise,
  };
}

let shortcutService = null;

function installShortcutService(options) {
  if (shortcutService) shortcutService.dispose();
  shortcutService = createShortcutService(options);
  return shortcutService;
}

function getShortcutService() {
  return shortcutService;
}

module.exports = {
  createShortcutService, installShortcutService, getShortcutService, ariaToAccelerator, CHANNELS,
};
