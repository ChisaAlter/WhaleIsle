const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');

test('Windows window icons use the multi-size ICO instead of the full-resolution PNG', () => {
  const source = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  const snippet = source.slice(source.indexOf('function iconImage()'), source.indexOf('function createMainWindow'));
  const loaded = [];
  const iconImage = vm.runInNewContext(`${snippet}\niconImage`, {
    process: { platform: 'win32' }, assetFile: name => name,
    nativeImage: { createFromPath(name) { loaded.push(name); return { isEmpty: () => false }; } },
  });
  iconImage();
  assert.deepEqual(loaded, ['icon.ico']);
});

test('missing Windows ICO falls back to a bounded PNG while other platforms retain PNG', () => {
  const source = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  const snippet = source.slice(source.indexOf('function iconImage()'), source.indexOf('function createMainWindow'));
  for (const platform of ['win32', 'linux', 'darwin']) {
    const loaded = [], resized = [];
    const iconImage = vm.runInNewContext(`${snippet}\niconImage`, {
      process: { platform }, assetFile: name => name,
      nativeImage: { createFromPath(name) {
        loaded.push(name);
        return { isEmpty: () => name === 'icon.ico', resize(size) { resized.push([size.width, size.height]); return this; } };
      } },
    });
    iconImage();
    assert.deepEqual(loaded, platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']);
    assert.deepEqual(resized, platform === 'win32' ? [[48, 48]] : []);
  }
});

test('boot caption disables drag while the harness BrowserView covers it', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  assert.match(css, /body\[data-harness-covered\] \.caption/);
  assert.match(css, /body\[data-harness-covered\] \.caption[\s\S]*?-webkit-app-region:\s*no-drag/);
});

test('covered boot document blanks out so minimize/restore gaps show the window background', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  assert.match(css, /html:has\(body\[data-harness-covered\]\)[\s\S]*?background:\s*transparent/);
  assert.match(css, /body\[data-harness-covered\][\s\S]*?visibility:\s*hidden/);
});

test('boot stays opaque underneath the token-driven desktop reveal', () => {
  const src = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  assert.match(src, /HARNESS_FADE_CSS/);
  assert.match(src, /insertCSS\(HARNESS_FADE_CSS\)/);
  assert.match(src, /data-dshd-harness-fade/);
  const revealCss = fs.readFileSync(path.join(__dirname, '../renderer/boot-reveal.css'), 'utf8');
  assert.match(revealCss, /calc\(var\(--ds-transition-duration, 0\.2s\) \* 3\)/);
  assert.match(src, /animation\.finished/);
  assert.doesNotMatch(src, /setTimeout\(finish, HARNESS_FADE_MS\)/);
  assert.doesNotMatch(css, /body\[data-harness-fade\] \.scene/);
  assert.match(revealCss, /prefers-reduced-motion: reduce/);
});

test('curtain waits for native animation completion instead of a wall-clock cutoff', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  const snippet = source.slice(source.indexOf('const HARNESS_FADE_'), source.indexOf('async function revealHarnessView'));
  const { script, prepare } = vm.runInNewContext(`${snippet}\n({ script: HARNESS_FADE_SCRIPT, prepare: HARNESS_CURTAIN_PREPARE_SCRIPT })`);
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot-reveal.css'), 'utf8');
  assert.doesNotMatch(css, /clip-path|transition: opacity/);
  assert.match(css, /will-change: transform/);
  let sea, curtains, completed = false, removed = false, finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const states = [];
  const root = { setAttribute(_name, state) { states.push(state); }, toggleAttribute() {} };
  class Image { decode() { return Promise.resolve(); } cloneNode() { return new Image(); } }
  const document = {
    documentElement: root, body: { append() {} },
    getElementById: () => curtains, querySelector: () => sea,
    createElement() {
      const element = { setAttribute() {}, append() {}, remove() { removed = true; }, getAnimations: () => [{ finished }] };
      Object.defineProperty(element, 'id', { set() { curtains = element; } });
      Object.defineProperty(element, 'className', { set(value) { if (value.includes('-sea')) sea = element; } });
      return element;
    },
  };
  const context = { document, Image, getComputedStyle: () => ({ transform: 'none' }),
    requestAnimationFrame: callback => setImmediate(callback), setTimeout, clearTimeout };
  await vm.runInNewContext(prepare('data:image/png;base64,snapshot', false), context);
  assert.deepEqual(states, ['ready']);
  // A pending first frame must not be treated as a completed transition.
  context.setTimeout = () => { throw new Error('Animation must not use a wall-clock deadline'); };
  const promise = vm.runInNewContext(script, context).then(() => { completed = true; });
  await new Promise(setImmediate);
  assert.equal(completed, false);
  assert.equal(removed, false);
  finish();
  await promise;
  assert.equal(completed, true);
  assert.equal(removed, true);
  assert.deepEqual(states, ['ready', 'in']);
});

function revealFixture({ rejectCss = false, chrome = Promise.resolve(), animation = Promise.resolve(), reduced = false } = {}) {
  const events = [];
  const view = { webContents: {
    isDestroyed: () => false,
    insertCSS() { events.push('hold-css'); return rejectCss ? Promise.reject(new Error('injection')) : Promise.resolve('css-key'); },
    removeInsertedCSS() { events.push('remove-css'); return Promise.resolve(); },
    executeJavaScript(script) {
      if (script.includes('matchMedia')) return Promise.resolve(reduced);
      events.push(script.includes('removeAttribute') ? 'clear-hold' : 'hold');
      return Promise.resolve();
    },
  } };
  const win = {
    isDestroyed: () => false,
    getBrowserViews: () => [],
    addBrowserView() { events.push('attach'); },
    setTopBrowserView() {}, isMaximized: () => false, getContentBounds: () => ({width: 1440, height: 920}),
    removeBrowserView() { events.push('remove-curtain'); },
    webContents: { executeJavaScript: () => Promise.resolve(), capturePage: () => Promise.resolve({ toDataURL: () => 'data:image/png;base64,snapshot' }) },
  };
  const source = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  const snippet = source.slice(source.indexOf('const HARNESS_FADE_'), source.indexOf('function watchPluginBoot'));
  const context = {
    harnessView: view, harnessRevealed: false,
    rendererFile: name => name,
    BrowserWindow: class {
      constructor() {
        events.push('create-curtain');
        this.webContents = {
          isDestroyed: () => false, loadFile: () => Promise.resolve(), capturePage() { events.push('paint-curtain'); return Promise.resolve(); }, close() { events.push('close-curtain'); },
          executeJavaScript(script) {
            if (script.includes('sea.getAnimations()')) { events.push('animate'); return animation; }
            events.push('prepare-curtain'); return Promise.resolve();
          },
        };
      }
      setBounds() {} setIgnoreMouseEvents() {} showInactive() {}
      loadFile() { return Promise.resolve(); }
      isDestroyed() { return false; }
      destroy() { events.push('close-curtain'); }
    },
    setBootHarnessCovered(_win, covered) { events.push(covered ? 'covered' : 'uncovered'); },
    layoutHarnessView() { events.push('layout'); },
    desktopPet: () => null,
    prepareHarnessChrome() {},
    syncHarnessChrome() { events.push('chrome'); return chrome; },
    consumePendingMarketplaceJump() {},
    setTimeout() { events.push('main-timer'); },
  };
  const api = vm.runInNewContext(`${snippet}\n({ reveal: revealHarnessView, cancel() { harnessView = null; harnessRevealed = false; } })`, context);
  return { ...api, win, events };
}

test('reveal waits for chrome before layout and renderer completion before covering boot', async () => {
  let chromeReady, fadeDone;
  const fixture = revealFixture({
    chrome: new Promise(resolve => { chromeReady = resolve; }),
    animation: new Promise(resolve => { fadeDone = resolve; }),
  });
  const outcome = fixture.reveal(fixture.win);
  await new Promise(setImmediate);
  assert.ok(fixture.events.includes('chrome'));
  assert.ok(!fixture.events.includes('layout'));
  chromeReady();
  await new Promise(setImmediate);
  assert.ok(fixture.events.includes('animate'));
  assert.ok(fixture.events.indexOf('paint-curtain') < fixture.events.indexOf('animate'));
  assert.ok(!fixture.events.includes('covered'));
  fadeDone();
  await outcome;
  assert.ok(fixture.events.indexOf('covered') > fixture.events.indexOf('animate'));
  assert.ok(fixture.events.includes('remove-css'));
});

test('reduced motion never captures or creates a curtain renderer', async () => {
  const fixture = revealFixture({ reduced: true });
  await fixture.reveal(fixture.win);
  assert.ok(!fixture.events.includes('create-curtain'));
  assert.ok(!fixture.events.includes('animate'));
  assert.ok(fixture.events.includes('covered'));
});

test('failed fade injection still mounts a visible full-size desktop', async () => {
  const fixture = revealFixture({ rejectCss: true });
  await fixture.reveal(fixture.win);
  await new Promise(setImmediate);
  assert.ok(fixture.events.includes('attach'));
  assert.ok(fixture.events.includes('layout'));
  assert.ok(fixture.events.includes('clear-hold'));
  assert.ok(fixture.events.includes('covered'));
});

test('cancelled reveal never hides the next boot page', async () => {
  let chromeReady;
  const fixture = revealFixture({ chrome: new Promise(resolve => { chromeReady = resolve; }) });
  const outcome = fixture.reveal(fixture.win);
  await new Promise(setImmediate);
  fixture.cancel();
  chromeReady();
  await outcome;
  assert.ok(!fixture.events.includes('covered'));
});

test('cancellation during the fade does not cover the next boot page', async () => {
  let fadeDone;
  const fixture = revealFixture({ animation: new Promise(resolve => { fadeDone = resolve; }) });
  const outcome = fixture.reveal(fixture.win);
  await new Promise(setImmediate);
  assert.ok(fixture.events.includes('animate'));
  fixture.cancel();
  fadeDone();
  await outcome;
  assert.ok(!fixture.events.includes('covered'));
  assert.ok(fixture.events.includes('remove-css'));
});

test('failed renderer animation releases the hold before covering boot', async () => {
  let failFade;
  const fixture = revealFixture({ animation: new Promise((resolve, reject) => { failFade = reject; }) });
  const outcome = fixture.reveal(fixture.win);
  await new Promise(setImmediate);
  failFade(new Error('renderer animation failed'));
  await outcome;
  assert.ok(fixture.events.indexOf('clear-hold') < fixture.events.indexOf('covered'));
  assert.ok(fixture.events.includes('remove-css'));
});

test('harness view keeps painting while the window is hidden so restore does not flash a blank surface', () => {
  const src = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  assert.match(src, /backgroundThrottling:\s*false/);
});

test('boot failure actions include a download-log ghost button', () => {
  const html = fs.readFileSync(path.join(__dirname, '../renderer/boot.html'), 'utf8');
  const boot = fs.readFileSync(path.join(__dirname, '../renderer/boot.js'), 'utf8');
  assert.match(html, /id="save-log"/);
  assert.match(html, /<button type="button" class="ghost" id="save-log">/);
  assert.match(boot, /invoke\('saveBootLog'\)/);
  assert.doesNotMatch(boot, /saveLogEl\.disabled/);
});

test('boot keeps the sea-horizon scene with a bottom ticker and a log drawer', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../renderer/boot.html'), 'utf8');
  const tokens = fs.readFileSync(path.join(__dirname, '../renderer/boot-tokens.css'), 'utf8');
  // Sea-horizon canvas: scene layer, clean 62% waterline, underwater tint.
  assert.match(html, /<main class="scene">/);
  assert.match(css, /\.scene\s*\{[\s\S]*?background:\s*var\(--boot-scene\)/);
  assert.match(css, /\.horizon\s*\{[\s\S]*?top:\s*62%/);
  assert.match(css, /\.underwater\s*\{[\s\S]*?top:\s*62%/);
  assert.match(tokens, /--boot-scene:\s*linear-gradient/);
  // Logs ride a one-line bottom ticker; the full buffer sits in a drawer.
  assert.match(html, /<div class="ticker"/);
  assert.match(html, /id="ticker-line"/);
  assert.match(html, /id="logdrawer"/);
  assert.match(css, /\.ticker\s*\{[\s\S]*?bottom:\s*0/);
  assert.match(css, /\.logdrawer\s*\{[\s\S]*?align-items:\s*flex-end/);
  // The instrument-canvas furniture is gone.
  assert.doesNotMatch(html, /log-dock|page-details|detail-handle|class="rail|class="scan"|class="meta"/);
});

test('boot page chrome stays minimal: caption drag strip and covered-blanking only', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/boot.css'), 'utf8');
  assert.match(css, /\.caption\s*\{[\s\S]*?-webkit-app-region:\s*drag/);
  assert.doesNotMatch(css, /\.rail|\.scan\s*\{|\.meta\s*\{|--boot-rail|--boot-log-inset/);
});

test('window-control buttons are a no-drag hit target and ignore SVG pointer events', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/window-controls.css'), 'utf8');
  assert.match(css, /\.window-controls[\s\S]*?-webkit-app-region:\s*no-drag/);
  assert.match(css, /\.window-controls button svg[\s\S]*?pointer-events:\s*none/);
});

test('shared boot and launcher window controls match the square main-window geometry', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/window-controls.css'), 'utf8');
  const plate = css.match(/\.window-controls\s*\{([^}]+)\}/)?.[1] || '';
  const button = css.match(/\.window-controls button\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(plate, /box-sizing:\s*border-box;/);
  assert.match(plate, /height:\s*var\(--caption-h, 48px\);/);
  assert.match(plate, /gap:\s*0;/);
  assert.match(plate, /padding:\s*8px;/);
  assert.match(button, /width:\s*32px;/);
  assert.match(button, /height:\s*32px;/);
  assert.match(button, /border-radius:\s*8px;/);
});

test('harness view relayouts on maximize and unmaximize', () => {
  const src = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  assert.match(src, /win\.on\('maximize', relayout\)/);
  assert.match(src, /win\.on\('unmaximize', relayout\)/);
});

test('harness view relayouts after cross-monitor moves and metric changes', () => {
  const src = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  assert.match(src, /win\.on\('moved', relayout\)/);
  assert.match(src, /win\.on\('restore', relayout\)/);
  assert.match(src, /screen\.on\('display-metrics-changed', relayoutOnMetricsChange\)/);
  assert.match(src, /win\.once\('closed', \(\) => \{\s*screen\.removeListener\('display-metrics-changed', relayoutOnMetricsChange\)/);
});

test('injected chrome re-applies on navigation commit and re-asserts on window return', () => {
  const src = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8');
  assert.match(src, /webContents\.on\('did-navigate', applyChrome\)/);
  assert.match(src, /win\.on\('focus', reassertChrome\)/);
  assert.match(src, /win\.on\('show', reassertChrome\)/);
});

test('chrome inject retries transient eval rejections and maximize state reads geometry', () => {
  const src = fs.readFileSync(path.join(__dirname, 'chrome.js'), 'utf8');
  assert.match(src, /CHROME_INJECT_RETRY_MS/);
  assert.match(src, /isEffectivelyMaximized/);
  assert.match(src, /win\.on\('resize', syncMaximizedState\)/);
});

test('setBootHarnessCovered toggles the boot flag only on boot.html', () => {
  const electronPath = require.resolve('electron');
  const previous = require.cache[electronPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      BrowserView: class {},
      BrowserWindow: class {},
      shell: { openExternal() {} },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      app: { isPackaged: false },
    },
  };
  try {
    delete require.cache[require.resolve('./window.js')];
    delete require.cache[require.resolve('./chrome.js')];
    delete require.cache[require.resolve('./paths.js')];
    const { rendererFile } = require('./paths.js');
    const { setBootHarnessCovered } = require('./window.js');
    const scripts = [];
    const bootWin = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        getURL: () => pathToFileURL(rendererFile('boot.html')).href,
        executeJavaScript(code) {
          scripts.push(code);
          return Promise.resolve();
        },
      },
    };
    setBootHarnessCovered(bootWin, true);
    setBootHarnessCovered(bootWin, false);
    assert.match(scripts[0], /toggleAttribute\('data-harness-covered', true\)/);
    assert.match(scripts[1], /toggleAttribute\('data-harness-covered', false\)/);

    const otherWin = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        getURL: () => 'http://127.0.0.1:3080/',
        executeJavaScript() {
          throw new Error('must not run on the harness view');
        },
      },
    };
    setBootHarnessCovered(otherWin, true);
  } finally {
    if (previous) {
      require.cache[electronPath] = previous;
    } else {
      delete require.cache[electronPath];
    }
    delete require.cache[require.resolve('./window.js')];
    delete require.cache[require.resolve('./chrome.js')];
    delete require.cache[require.resolve('./paths.js')];
  }
});

test('showBoot cancels a plugin boot watch before its first probe', { timeout: 1_000 }, async () => {
  const electronPath = require.resolve('electron');
  const chromePath = require.resolve('./chrome.js');
  const pathsPath = require.resolve('./paths.js');
  const cached = new Map([
    [electronPath, require.cache[electronPath]],
    [chromePath, require.cache[chromePath]],
    [pathsPath, require.cache[pathsPath]],
  ]);

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.url = '';
      this.probes = 0;
    }

    isDestroyed() { return this.destroyed; }
    getURL() { return this.url; }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    send() {}
    insertCSS() { return Promise.resolve('fade-css-key'); }
    close() { this.destroyed = true; }

    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }

    executeJavaScript(script) {
      if (script.includes('data-dshd-boot-status')) {
        this.probes += 1;
      }
      return Promise.resolve({
        pending: true,
        ready: 0,
        total: 0,
        failed: false,
        hasApp: false,
        error: '',
      });
    }
  }

  class FakeBrowserView {
    constructor(options) {
      this.webContents = new FakeWebContents();
      this.webContents.ownerOptions = options;
    }

    setBounds() {}
    setAutoResize() {}
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.webContents = new FakeWebContents();
      this.webContents.ownerOptions = options;
      this.views = [];
    }

    isDestroyed() { return false; }
    setBackgroundColor() {}
    getContentBounds() { return { width: 1_440, height: 920 }; }
    getBrowserViews() { return this.views; }
    setTopBrowserView() {}
    show() {}
    setAppDetails(details) { this.appDetails = details; }

    addBrowserView(view) {
      if (!this.views.includes(view)) this.views.push(view);
    }

    removeBrowserView(view) {
      this.views = this.views.filter((candidate) => candidate !== view);
    }

    loadFile(file) {
      this.webContents.url = `file:///${file.replaceAll('\\\\', '/')}`;
      return Promise.resolve();
    }
  }

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { isPackaged: false, getAppPath: () => 'C:/app' },
      BrowserView: FakeBrowserView,
      BrowserWindow: FakeBrowserWindow,
      shell: { openExternal() {} },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    },
  };
  require.cache[chromePath] = {
    id: chromePath,
    filename: chromePath,
    loaded: true,
    exports: {
      shellWindowChrome: (options) => options,
      attachIntegratedChrome() {},
      hideNativeMenu() {},
      prepareHarnessChrome() {},
      syncHarnessChrome() {},
      currentTheme: () => ({ bg: '#ffffff' }),
      markWindowTransparent() {},
      paintBackground() {},
    },
  };
  require.cache[pathsPath] = {
    id: pathsPath,
    filename: pathsPath,
    loaded: true,
    exports: {
      rendererFile: (name) => `C:/app/${name}`,
      assetFile: (name) => `C:/app/${name}`,
      preloadFile: () => 'C:/app/preload.js',
    },
  };

  try {
    delete require.cache[require.resolve('./window.js')];
    const { getHarnessWebContents, getMainWindow, showBoot, showHarness } = require('./window.js');
    const outcome = showHarness('http://127.0.0.1:3080/').then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const harnessContents = getHarnessWebContents();
    assert.ok(harnessContents);
    assert.equal(harnessContents.probes, 0);
    assert.deepEqual(
      getMainWindow().webContents.ownerOptions.webPreferences.additionalArguments,
      ['--dshd-shell-role=boot'],
    );
    const { REMOTE_FEATURE_ENABLED } = require('./config');
    assert.deepEqual(
      harnessContents.ownerOptions.webPreferences.additionalArguments,
      [
        '--dshd-shell-role=harness',
        `--dshd-remote-feature=${REMOTE_FEATURE_ENABLED ? '1' : '0'}`,
      ],
    );

    const sameOrigin = { prevented: false, preventDefault() { this.prevented = true; } };
    harnessContents.emit('will-navigate', sameOrigin, 'http://127.0.0.1:3080/chat');
    assert.equal(sameOrigin.prevented, false);

    const differentOrigin = { prevented: false, preventDefault() { this.prevented = true; } };
    harnessContents.emit('will-navigate', differentOrigin, 'http://127.0.0.1:5173/');
    assert.equal(differentOrigin.prevented, true);

    await showBoot();
    let timeout;
    const result = await Promise.race([
      outcome,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), 250);
      }),
    ]);
    clearTimeout(timeout);
    assert.equal(result.timedOut, undefined, 'cancelled plugin watch must settle');
    assert.equal(result.error?.code, 'HARNESS_OPERATION_CANCELLED');
    assert.equal(harnessContents.probes, 0);
    assert.equal(harnessContents.isDestroyed(), true);
  } finally {
    for (const [modulePath, entry] of cached) {
      if (entry) require.cache[modulePath] = entry;
      else delete require.cache[modulePath];
    }
    delete require.cache[require.resolve('./window.js')];
  }
});
