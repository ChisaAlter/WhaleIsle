'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createGrowthTracker, normalizeGrowthState } = require('./pet-growth');
const { createDshWatch } = require('./pet-dsh-watch');
const { createPetChat } = require('./pet-chat');
const petStats = require('./pet-stats');
const petSettings = require('./pet-settings');

// The pet renderer needs a secure, standard scheme so that WebGPU and ES
// module workers (onnxruntime-web's JSEP backend) work — file:// blocks both.
// Privileged schemes must be declared before `app` is ready; this module is
// required during main-process bootstrap, which satisfies that.
try {
  require('electron').protocol.registerSchemesAsPrivileged([
    {
      scheme: 'pet',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
} catch {
  // `electron.protocol` is unavailable in unit-test stubs; the scheme check
  // below keeps everything working when no real session exists.
}

// Desktop pet window: a transparent, frameless, always-on-top BrowserWindow
// that covers the whole virtual screen. The OS window itself NEVER moves —
// setPosition on a layered transparent window blanks its surface on Windows
// (that was the drag flicker/vanish); instead the renderer draws the
// character at the persisted screen position inside the overlay, and a drag
// just repaints at new coordinates. The renderer hit-tests the pet sprite
// and toggles click-through per cursor position, so the pet is interactive
// only while the pointer is on it.
const PET_WIDTH = 240;
const PET_HEIGHT = 260;
const EDGE_GAP = 24;
const RENDERER_PAGE = 'pet-live2d.html';
const PET_ORIGIN = 'pet://pet';
const PET_PAGE_URL = `${PET_ORIGIN}/${RENDERER_PAGE}`;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

// Keep the feature available, but only create the window after opt-in.
const LIVE2D_PET_FEATURE = true;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeLive2dPetState(value, now = Date.now()) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === true,
    x: Number.isFinite(source.x) ? Math.round(source.x) : null,
    y: Number.isFinite(source.y) ? Math.round(source.y) : null,
    growth: normalizeGrowthState(source.growth),
    stats: petStats.normalizeStats(source.stats, now),
    settings: petSettings.normalizeSettings(source.settings),
    dsh: petSettings.normalizeDshState(source.dsh),
    fileEaten: petSettings.normalizeFileEaten(source.fileEaten),
    assistantSessionId: typeof source.assistantSessionId === 'string'
      ? source.assistantSessionId : '',
  };
}

function defaultPosition(workArea) {
  const area = workArea && typeof workArea === 'object' ? workArea : {};
  const width = Math.max(0, finite(area.width));
  const height = Math.max(0, finite(area.height));
  const baseX = finite(area.x);
  const baseY = finite(area.y);
  return {
    x: Math.round(baseX + Math.max(0, width - PET_WIDTH - EDGE_GAP)),
    y: Math.round(baseY + Math.max(0, height - PET_HEIGHT - EDGE_GAP)),
  };
}

function isPetFrameUrl(url, petUrl = PET_PAGE_URL) {
  try {
    return new URL(url).href === new URL(petUrl).href;
  } catch {
    return false;
  }
}

// Serve src/renderer/** over pet://pet/**. Path traversal outside the
// renderer root is rejected.
function createPetProtocolHandler(rendererFile) {
  const root = path.dirname(rendererFile(RENDERER_PAGE));
  return (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const sharedTokens = rel === 'dsh-webui-tokens.css';
      const projectHead = rel === 'pet-head.png';
      const file = sharedTokens
        ? path.resolve(root, '../shared/dsh-webui-tokens.css')
        : projectHead
          ? path.resolve(root, '../../assets/whale-head.png')
          : path.normalize(path.join(root, rel));
      if ((!sharedTokens && !projectHead && !file.startsWith(root + path.sep))
        || !fs.statSync(file).isFile()) {
        return new Response('not found', { status: 404 });
      }
      return new Response(fs.readFileSync(file), {
        headers: {
          'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
}

function createLive2dPetManager(options = {}) {
  const electron = options.electron || require('electron');
  const BrowserWindow = options.BrowserWindow || electron.BrowserWindow;
  const screen = options.screen || electron.screen;
  const ipcMain = options.ipcMain || electron.ipcMain;
  const protocol = options.protocol || electron.protocol;
  const rendererFile = options.rendererFile || require('./paths').rendererFile;
  const preloadFile = options.preloadFile || require('./paths').preloadFile;
  const loadConfig = options.loadConfig || require('./config').loadConfig;
  const saveConfig = options.saveConfig || require('./config').saveConfig;
  const getMainWindow = options.getMainWindow || (() => null);
  const petUrl = PET_PAGE_URL;

  let state = normalizeLive2dPetState(loadConfig()?.live2dPet);
  let win = null;
  let petRendererReady = false;
  let dshActivityState = 'idle';
  let interactive = false;
  let chatFocusWanted = false;
  let surfaceRegionKey = '';
  let handlersRegistered = false;

  function persist() {
    state = normalizeLive2dPetState(state);
    saveConfig({ live2dPet: state });
  }

  // Token feeding: cumulative usage is re-scanned from the session logs and
  // fed amount is persisted — feeding is idempotent across restarts.
  const growth = createGrowthTracker({
    sessionsDir: options.sessionsDir || '',
    getGrowth: () => state.growth,
    saveGrowth: (next) => {
      const previous = state.growth;
      state.growth = next;
      try {
        persist();
      } catch (error) {
        state.growth = previous;
        throw error;
      }
    },
    scanTokens: options.scanTokens,
  });
  let growthTimer = 0;

  // DSH link (§B6): the watcher tails session logs and emits already-gated
  // speech events — work starting, a turn landing, an error, token
  // milestones, the 45-minute rest nudge, and the 久别 greeting. Events push
  // to the renderer over shell:live2d-dsh; the alert arbitration there
  // decides when she may actually speak.
  const dshWatch = createDshWatch({
    sessionsDir: options.sessionsDir || '',
    outboxFile: options.sessionsDir
      ? path.join(path.dirname(options.sessionsDir), 'data', 'whale', 'pet-outbox.jsonl')
      : '',
    usageFile: options.sessionsDir
      ? path.join(path.dirname(options.sessionsDir), 'data', 'whale', 'usage-today.json')
      : '',
    getDsh: () => state.dsh,
    saveDsh: (next) => {
      const previous = state.dsh;
      state.dsh = petSettings.normalizeDshState(next);
      try {
        persist();
      } catch (error) {
        // The watcher compares against this in-memory projection on the next
        // poll. Keep the last committed value so a failed disk write retries.
        state.dsh = previous;
        throw error;
      }
    },
    onEvent: (ev) => {
      if (!win || win.isDestroyed?.()) {
        return;
      }
      try {
        win.webContents.send('shell:live2d-dsh', { ...ev, category: ev.type });
      } catch {}
    },
    onState: (s) => {
      dshActivityState = s;
      if (!win || win.isDestroyed?.()) {
        return;
      }
      try {
        win.webContents.send('shell:live2d-dsh', { state: s });
      } catch {}
    },
    isPetVisible: () => Boolean(petRendererReady && win && !win.isDestroyed?.() && win.isVisible()),
  });
  let stopDshWatch = null;

  // Quick chat (§B9): credentials are re-read per call so a key update in
  // settings lands without a restart; memory lives inside pet-chat only.
  const LOOK_COOLDOWN_MS = 4000;
  let lastLookAt = 0;
  // Bridge to the persistent whale-assistant session over the loopback
  // web server: same client-request envelope the renderer RPC uses.
  // Absent origin/cookie (harness not ready) → callers fall back.
  // `transport:true` marks failures where the plugin never answered (harness
  // down / route absent / fetch died) — the only class callers may fall back
  // from. A 200 with `result.ok:false` means the endpoint RAN and rejected:
  // reporting that honestly beats forking a shadow REST reply.
  const whalePost = async (endpoint, payload, timeoutMs = 15000) => {
    const origin = typeof options.getHarnessOrigin === 'function'
      ? options.getHarnessOrigin() : '';
    const cookie = typeof options.getSessionCookie === 'function'
      ? options.getSessionCookie() : '';
    if (!origin || !cookie) {
      return { ok: false, transport: true, reason: 'harness-unavailable' };
    }
    let res;
    try {
      res = await fetch(`${origin}/dsh-whale/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          method: endpoint,
          payload,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, transport: true, reason: 'network' };
    }
    if (!res.ok) {
      return { ok: false, transport: true, reason: `http-${res.status}` };
    }
    let data;
    try { data = await res.json(); } catch { return { ok: false, transport: true, reason: 'bad-json' }; }
    if (data?.result?.ok === true) {
      return { ok: true, value: data.result.value };
    }
    return { ok: false, reason: data?.result?.error?.message || 'rpc-failed' };
  };
  const whaleEnabled = () => {
    try {
      return loadConfig()?.whaleAssistantEnabled === true;
    } catch {
      return false;
    }
  };
  // Personality mirror: the pet's 性格 select is the single control for
  // BOTH personas — the assistant catalog's personality follows it. Writes
  // ride the same loopback bridge as pet/chat; while the harness is down
  // the latest value waits in `pendingPersonality` and a slow retry keeps
  // trying. An answered rejection is usually a real verdict, but a
  // snapshot-conflict write retries cleanly, so rejections get a bounded
  // number of extra attempts before the value is dropped.
  const MIRROR_RETRY_MS = 30000;
  const MIRROR_MAX_REJECT_RETRIES = 3;
  const mirrorRetryMs = typeof options.mirrorRetryMs === 'number' && options.mirrorRetryMs > 0
    ? options.mirrorRetryMs : MIRROR_RETRY_MS;
  let pendingPersonality = null;
  let mirrorTimer = 0;
  let mirrorInFlight = false;
  let mirrorRejectRetries = 0;
  function scheduleMirrorRetry() {
    if (mirrorTimer) return;
    mirrorTimer = setTimeout(() => {
      mirrorTimer = 0;
      void flushPersonalityMirror();
    }, mirrorRetryMs);
    mirrorTimer?.unref?.();
  }
  async function flushPersonalityMirror() {
    if (pendingPersonality === null || mirrorInFlight) {
      return;
    }
    mirrorInFlight = true;
    const personality = pendingPersonality;
    try {
      // Assistant off → her route is unmounted; park the value and let a
      // later retry deliver it instead of posting a guaranteed 404.
      const res = whaleEnabled() === false
        ? { ok: false, transport: true, reason: 'assistant-disabled' }
        : await whalePost('settings/update', { personality });
      if (res.ok) {
        if (pendingPersonality === personality) pendingPersonality = null;
        mirrorRejectRetries = 0;
      } else if (res.transport === true) {
        scheduleMirrorRetry();
      } else {
        dbg(`personality mirror rejected: ${res.reason || 'unknown'}`);
        if (mirrorRejectRetries < MIRROR_MAX_REJECT_RETRIES) {
          mirrorRejectRetries += 1;
          scheduleMirrorRetry();
        } else {
          pendingPersonality = null;
          mirrorRejectRetries = 0;
        }
      }
    } finally {
      mirrorInFlight = false;
      if (pendingPersonality !== null && pendingPersonality !== personality) {
        void flushPersonalityMirror();
      }
    }
  }
  function queuePersonalityMirror(value) {
    if (typeof value !== 'string' || !value) {
      return;
    }
    pendingPersonality = value;
    mirrorRejectRetries = 0;
    void flushPersonalityMirror();
  }
  // Vision route for 「看看屏幕」: the settings-page fields
  // (live2dPet.settings.lookProvider + lookModel) are the user-facing
  // knobs; the options.* pair stays as a wiring-time fallback. An empty
  // model means the look path is unavailable — the handler refuses BEFORE
  // any screen capture so a dead button never grabs a frame. The provider
  // is what makes the pick real: petChat dispatches it through the whale
  // plugin's ctx.llm route, never the desktop's generic baseUrl.
  const optionsLookModel = typeof options.lookModel === 'string' ? options.lookModel.trim() : '';
  const optionsLookProvider = typeof options.lookProvider === 'string' ? options.lookProvider.trim() : '';
  const lookRouteOf = () => {
    const s = petSettings.normalizeSettings(state.settings);
    return {
      provider: s.lookProvider || optionsLookProvider,
      model: s.lookModel || optionsLookModel,
    };
  };
  const lookModelOf = () => lookRouteOf().model;
  // The fallback persona is the same file her session reads: a quick-chat
  // reply while the harness is down still answers with the user's settings.
  const whaleSettingsFile = options.sessionsDir
    ? path.join(path.dirname(options.sessionsDir), 'data', 'whale', 'settings.json')
    : '';
  const getWhaleSettings = () => {
    if (!whaleSettingsFile) return undefined;
    try {
      const raw = JSON.parse(fs.readFileSync(whaleSettingsFile, 'utf8'));
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : undefined;
    } catch {
      return undefined;
    }
  };
  const petChat = createPetChat({
    getCreds: () => {
      try {
        const cfg = loadConfig() || {};
        return { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl };
      } catch {
        return {};
      }
    },
    lookModel: lookModelOf,
    model: options.chatModel || 'deepseek-chat',
    whale: { enabled: whaleEnabled, post: whalePost },
    getWhaleSettings,
  });

  // Cursor pump: forwarded mousemoves through a click-through layered window
  // do not reliably reach the renderer, so the main process polls the global
  // cursor itself and pushes window-local positions. The renderer keeps
  // deciding when to toggle interactivity — its sprite bounds are accurate.
  const CURSOR_POLL_MS = 33;
  // A parked cursor still gets the same key re-sent roughly once a second —
  // a push emitted before the renderer subscribed would otherwise be lost
  // forever, leaving her unresponsive until the mouse happens to move.
  const CURSOR_HEARTBEAT = 30;
  // Hold-zone pad beyond the renderer-reported BODY bounds (already the
  // tight alpha box + hover pad). While interactive the whole fullscreen
  // overlay eats clicks, so every px here is a dead ring around her —
  // 8 covers small frame-to-frame sway without swallowing clicks meant
  // for neighboring windows.
  const CURSOR_PET_PAD = 8;
  let cursorTimer = 0;
  let lastCursorKey = '';
  let cursorTicks = 0;
  let cursorInPetFrame = false;
  let rendererInteractive = false;
  // The renderer reports where her BODY is visually drawn (screen coords,
  // tight alpha bounds + hover pad — not the whole pet frame) while roaming
  // or resized — this is the interactive hold zone. Without it a wander
  // leaves a dead hover at the old spot and a phantom interactive hole at
  // the new one. Never persisted: `state.x/y` stays the user's chosen
  // anchor.
  let roamRect = null;
  // Logical interactive islands in screen coords — her body plus the status
  // card / chat card / picker / pinned bubble, as reported by the renderer.
  // The cursor hold checks these too, so moving from her body onto the status
  // card (or back) keeps the window interactive without waiting for the
  // renderer's exit/enter round trip.
  let hitRects = [];
  function setHitRegions(regions) {
    if (!Array.isArray(regions)) {
      hitRects = [];
      return;
    }
    hitRects = regions.slice(0, 24).flatMap((r) => {
      if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)
        || r.width <= 0 || r.height <= 0) { return []; }
      return [{ x: r.x, y: r.y, w: r.width, h: r.height }];
    });
  }
  function pollCursor() {
    if (!win || win.isDestroyed?.()) {
      return;
    }
    const point = screen?.getCursorScreenPoint?.();
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }
    let bounds;
    try {
      bounds = win.getBounds();
    } catch {
      return;
    }
    const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width
      && point.y >= bounds.y && point.y < bounds.y + bounds.height;
    // Sticky hold, not just a fast enter: while the cursor sits inside the
    // padded body bounds the overlay keeps accepting input even if the
    // renderer just asked to drop it. The renderer's tighter alpha bounds
    // can dip out mid-gesture (she sways or runs under a parked cursor),
    // and honoring that exit punches a click-through hole under a click
    // that is already on its way. Leaving the zone releases the hold.
    const pos = petPosition();
    const scale = Number.isFinite(state.settings?.scale) ? state.settings.scale : 1;
    const zone = roamRect
      || { x: pos.x, y: pos.y, w: PET_WIDTH * scale, h: PET_HEIGHT * scale };
    const inZone = inside
      && point.x >= zone.x - CURSOR_PET_PAD && point.x <= zone.x + zone.w + CURSOR_PET_PAD
      && point.y >= zone.y - CURSOR_PET_PAD && point.y <= zone.y + zone.h + CURSOR_PET_PAD;
    const inHit = inside && hitRects.some((r) =>
      point.x >= r.x - CURSOR_PET_PAD && point.x <= r.x + r.w + CURSOR_PET_PAD
      && point.y >= r.y - CURSOR_PET_PAD && point.y <= r.y + r.h + CURSOR_PET_PAD);
    const inPet = inZone || inHit;
    if (inPet !== cursorInPetFrame) {
      cursorInPetFrame = inPet;
      applyInteractive();
    }
    const x = Math.round(point.x - bounds.x);
    const y = Math.round(point.y - bounds.y);
    const key = inside ? `${x},${y}` : 'out';
    cursorTicks += 1;
    if (key === lastCursorKey && cursorTicks % CURSOR_HEARTBEAT !== 0) {
      return;
    }
    lastCursorKey = key;
    try {
      win.webContents.send('shell:live2d-cursor',
        inside ? { inside: true, x, y } : { inside: false });
    } catch {}
  }
  function startCursorPump() {
    if (cursorTimer) {
      return;
    }
    cursorTimer = setInterval(pollCursor, CURSOR_POLL_MS);
    cursorTimer.unref?.();
  }
  function stopCursorPump() {
    clearInterval(cursorTimer);
    cursorTimer = 0;
    lastCursorKey = '';
    cursorTicks = 0;
    cursorInPetFrame = false;
    // A stale `true` would pin the next window interactive forever —
    // the fresh page re-requests what it needs.
    rendererInteractive = false;
    hitRects = [];
  }

  // Care stats (饱食/心情/亲密) live next to growth in live2dPet.stats.
  // Decay is lazy — reads fold elapsed hours in; writes persist on care
  // actions and on the rescan tick so a crash replays at most a minute.
  function readStats() {
    return petStats.decayStats(state.stats, Date.now());
  }
  function writeStats(next) {
    state.stats = petStats.normalizeStats(next);
    persist();
  }
  function care(kind) {
    if (!petStats.CARE[kind]) {
      return;
    }
    writeStats(petStats.applyCare(readStats(), kind, Date.now()).state);
    pushGrowth(growth.snapshot());
  }

  function pushGrowth(snap) {
    const payload = snap && typeof snap === 'object'
      ? { ...snap, stats: petStats.statsSnapshot(readStats()) }
      : snap;
    win?.webContents?.send?.('shell:live2d-growth', payload);
  }

  // One shape for every settings surface: normalized settings plus the
  // derived capability flag — the 「看看」cell appears/disappears live as
  // the user edits the look-model field.
  function settingsPayload() {
    return {
      ...petSettings.normalizeSettings(state.settings),
      lookAvailable: Boolean(lookModelOf()),
    };
  }

  function pushSettings() {
    win?.webContents?.send?.('shell:live2d-settings', settingsPayload());
  }

  // Single writer for live2dPet.settings: normalize the patch (or restore
  // defaults on reset), persist, then push the same normalized object to the
  // pet window. The settings UI lives in the main window now — writes land
  // here through shell:live2d-pet-settings so the live pet converges without
  // a restart.
  function applySettings(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : body;
    const personalityBefore = state.settings?.personality;
    state.settings = body.reset === true
      ? petSettings.defaultSettings()
      : petSettings.normalizePatch(state.settings, patch);
    persist();
    pushSettings();
    if (state.settings.personality !== personalityBefore) {
      queuePersonalityMirror(state.settings.personality);
    }
    return settingsPayload();
  }

  // Dragging files onto her "feeds" them — metadata only, the files are
  // never deleted/moved/modified. A small satiety trickle is capped at 5
  // files per local day so it can't be farmed.
  function fileEat(names) {
    const clean = (Array.isArray(names) ? names : [])
      .filter((n) => typeof n === 'string' && n.trim())
      .map((n) => n.trim().slice(0, 200))
      .slice(0, 20);
    if (!clean.length) {
      return { ate: false };
    }
    const now = Date.now();
    const day = new Date(now).toLocaleDateString('sv-SE');
    const eaten = petSettings.normalizeFileEaten(state.fileEaten);
    const todayCount = eaten.history.filter((e) => e.day === day).length;
    const satietyGranted = todayCount < 5;
    eaten.total += clean.length;
    eaten.history = eaten.history.concat(clean.map((name) => ({ name, at: now, day }))).slice(-50);
    state.fileEaten = eaten;
    if (satietyGranted) {
      writeStats(petStats.applyCare(readStats(), 'fileEat', now).state);
    }
    persist();
    pushGrowth(growth.snapshot());
    return { ate: true, count: clean.length, satietyGranted, total: eaten.total };
  }
  // The scan itself runs off the main thread inside the growth tracker —
  // a failed scan keeps the last snapshot and retries next tick.
  async function rescanGrowth() {
    const before = state.growth?.tokensSeen ?? 0;
    let next;
    try {
      next = await growth.refresh();
    } catch {
      return;
    }
    const s = readStats();
    const statsMoved = state.stats
      && (s.satiety !== state.stats.satiety || s.mood !== state.stats.mood);
    if (statsMoved) {
      writeStats(s);
    }
    if (next.tokensSeen !== before || statsMoved) {
      pushGrowth(growth.snapshot(next));
    }
  }
  // Feed `amount` tokens (default: all feedable) and tell the renderer to
  // play the token-eat sequence; a level-up rides the same push.
  async function feedTokens(amount) {
    try {
      await growth.refresh();
    } catch {}
    const res = growth.feed(amount);
    if (res.fed > 0) {
      writeStats(petStats.applyCare(readStats(), 'feedToken', Date.now()).state);
    }
    pushGrowth(res);
    return res;
  }

  function isAuthorized(event) {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    return Boolean(win && !win.isDestroyed?.() && sender === win.webContents && frame === sender.mainFrame && isPetFrameUrl(frame.url, petUrl));
  }

  function assertAuthorized(event) {
    if (!isAuthorized(event)) {
      const error = new Error('Unauthorized live2d pet IPC sender');
      error.code = 'ERR_DSH_LIVE2D_IPC_SENDER';
      throw error;
    }
  }

  // Effective interactivity = renderer request OR cursor-in-frame hold.
  // Two writers share one switch; merging here keeps them from punching
  // holes in each other's decisions.
  function applyInteractive() {
    setInteractive(rendererInteractive || cursorInPetFrame);
  }

  // A transparent desktop-sized HWND must never become a desktop-sized input
  // shield while the renderer is busy. Native regions also bound its visible
  // footprint; keep disjoint surfaces disjoint instead of enclosing their gaps.
  function setSurfaceRegions(regions) {
    if (!win || win.isDestroyed?.() || typeof win.setShape !== 'function'
      || process.platform === 'darwin' || !Array.isArray(regions)) { return; }
    const bounds = win.getBounds();
    const clipped = regions.slice(0, 16).flatMap((r) => {
      if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)
        || r.width <= 0 || r.height <= 0) { return []; }
      const x = Math.max(0, Math.floor(r.x));
      const y = Math.max(0, Math.floor(r.y));
      const right = Math.min(bounds.width, Math.ceil(r.x + r.width));
      const bottom = Math.min(bounds.height, Math.ceil(r.y + r.height));
      return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
    });
    // Electron's [] removes the region and restores the entire window.
    const shape = clipped.length ? clipped : [{ x: 0, y: 0, width: 0, height: 0 }];
    const key = JSON.stringify(shape);
    if (key === surfaceRegionKey) { return; }
    win.setShape(shape);
    surfaceRegionKey = key;
  }

  function setInteractive(next) {
    interactive = next === true;
    if (!win || win.isDestroyed?.()) {
      return;
    }
    // Click-through is the default. Cursor tracking does not rely on
    // `forward` — see the cursor pump — it is kept only as a harmless
    // extra on platforms where forwarded moves do work.
    if (interactive) {
      win.setIgnoreMouseEvents(false);
    } else {
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  function displayForPoint(x, y) {
    const displays = screen?.getAllDisplays?.() || [];
    return displays.find((display) => {
      const b = display?.bounds;
      return b && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    }) || null;
  }

  // The overlay covers exactly ONE display — the one the character is on.
  // A window spanning the union of a mixed-DPI setup gets silently
  // relocated by the OS when its top-left lands in the dead zone between
  // monitors, which both shifts every coordinate and leaves an uncovered
  // strip of screen (the drag "vanished" there).
  function overlayBounds() {
    const pet = petPosition();
    const display = displayForPoint(pet.x + PET_WIDTH / 2, pet.y + PET_HEIGHT / 2)
      || displayForPoint(pet.x, pet.y)
      || screen?.getPrimaryDisplay?.();
    const b = display?.bounds;
    return b
      ? { x: finite(b.x), y: finite(b.y), width: finite(b.width), height: finite(b.height) }
      : { x: 0, y: 0, width: 1280, height: 720 };
  }

  // The character's own screen position (validated persisted value, else
  // work-area bottom-right) — sent to the renderer as its draw origin.
  function petPosition() {
    const fallback = defaultPosition(screen?.getPrimaryDisplay?.()?.workArea);
    // A persisted position must land inside a real display — dead-zone
    // coordinates (mixed-DPI gaps between monitors) would paint off-canvas.
    const kept = state.x !== null && state.y !== null && displayForPoint(state.x, state.y);
    return {
      x: kept ? state.x : fallback.x,
      y: kept ? state.y : fallback.y,
    };
  }

  function sendPetPosition() {
    if (win && !win.isDestroyed?.()) {
      win.webContents.send('shell:live2d-move', petPosition());
    }
  }

  // The renderer works in window coordinates; send the overlay's ACTUAL
  // bounds (the OS may relocate oversized windows) as origin plus each
  // display's bounds converted to window space, so it can clamp the
  // character inside the screen the cursor is on — including the dead
  // zones a mixed-DPI virtual screen creates between monitors.
  function sendLayout() {
    if (!win || win.isDestroyed?.()) {
      return;
    }
    let origin;
    try {
      origin = win.getBounds();
    } catch {
      origin = overlayBounds();
    }
    const displays = (screen?.getAllDisplays?.() || [])
      .map((display) => display?.bounds)
      .filter(Boolean)
      .map((b) => ({
        x: finite(b.x) - origin.x,
        y: finite(b.y) - origin.y,
        width: finite(b.width),
        height: finite(b.height),
      }));
    const home = (screen?.getAllDisplays?.() || []).findIndex((display) => {
      const b = display?.bounds;
      return b && origin.x >= b.x && origin.x < b.x + b.width
        && origin.y >= b.y && origin.y < b.y + b.height;
    });
    // The overlay may have hopped displays — a roam rect measured against
    // the old origin is stale; the renderer re-reports on its next move.
    roamRect = null;
    hitRects = [];
    dbg(`pet: layout origin=${JSON.stringify(origin)} displays=${JSON.stringify(displays)} home=${home} pet=${JSON.stringify(petPosition())}`);
    win.webContents.send('shell:live2d-layout', {
      origin: { x: origin.x, y: origin.y },
      displays,
      home: home >= 0 ? home : 0,
    });
  }

  // Overlay diagnostics behind DSHD_DEBUG_PET=1 — off in normal runs so the
  // log can never grow unbounded or capture renderer console output.
  const petDebug = process.env.DSHD_DEBUG_PET === '1';
  function dbg(msg) {
    if (!petDebug) {
      return;
    }
    try {
      fs.appendFileSync(
        path.join(require('electron').app?.getPath?.('userData') || '', 'pet-debug.log'),
        `${new Date().toISOString()} ${msg}\n`,
      );
    } catch {}
  }

  function createWindow() {
    petRendererReady = false;
    const bounds = overlayBounds();
    dbg(`pet: createWindow bounds ${JSON.stringify(bounds)} enabled=${state.enabled}`);
    win = new BrowserWindow({
      ...overlayBounds(),
      transparent: true,
      frame: false,
      // Fullscreen overlay: its content must reach the display corners; the
      // OS corner mask would clip the pet edge-on.
      roundedCorners: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadFile(),
        additionalArguments: ['--dshd-shell-role=pet-live2d'],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    // Global theme updates repaint every BrowserWindow. Preserve the overlay's
    // alpha backing on every creation, including renderer/GPU recovery.
    require('./chrome').markWindowTransparent(win);
    // Creation clamps the window to the primary display's size; re-apply the
    // union bounds so the overlay really covers every monitor.
    try { win.setBounds(overlayBounds()); } catch {}
    try { dbg(`pet: actual bounds ${JSON.stringify(win.getBounds())}`); } catch {}
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    surfaceRegionKey = '';
    setSurfaceRegions([]);
    setInteractive(false);
    win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    win.webContents.on?.('will-navigate', (event, url) => {
      if (!isPetFrameUrl(url, petUrl)) {
        event.preventDefault();
      }
    });
    win.once('ready-to-show', () => { dbg('pet: ready-to-show'); win?.showInactive(); });
    win.webContents.once?.('did-finish-load', () => {
      petRendererReady = true;
      dbg('pet: did-finish-load');
      sendLayout();
      sendPetPosition();
      pushSettings();
      // First growth snapshot after the page is up — she learns her level.
      rescanGrowth();
      pushGrowth(growth.snapshot());
      win.webContents.send('shell:live2d-dsh', { state: dshActivityState });
    });
    win.webContents.on?.('render-process-gone', (_e, details) => {
      dbg(`pet: render-process-gone ${JSON.stringify(details)}`);
      // The overlay is a fullscreen transparent always-on-top window; when its
      // renderer (or the GPU compositor it rides) dies, Windows can keep the
      // surface opaque-black over the whole display. Rebuild from scratch.
      recreateWindow();
    });
    win.webContents.on?.('console-message', (_e, level, message) => dbg(`console[${level}] ${message}`));
    win.webContents.on?.('did-fail-load', (_e, code, desc) => dbg(`pet: did-fail-load ${code} ${desc}`));
    win.on('closed', () => {
      dbg('pet: closed');
      win = null;
      interactive = false;
      roamRect = null; // fresh page re-reports; a stale zone would wedge hover
      hitRects = [];
    });
    void win.loadURL(petUrl).catch(() => {});
    return win;
  }

  /** Rebuild the overlay window after a renderer/GPU/compositor failure. */
  let recreating = false;
  function recreateWindow() {
    if (!state.enabled || recreating) {
      return;
    }
    recreating = true;
    try {
      const old = win;
      win = null;
      interactive = false;
      roamRect = null;
      hitRects = [];
      if (old && !old.isDestroyed?.()) {
        old.destroy();
      }
      createWindow();
    } catch (error) {
      dbg(`pet: recreate failed ${String(error)}`);
    } finally {
      recreating = false;
    }
  }

  // Layered-window alpha on Windows can silently die without any renderer
  // event — a display reconfiguration or session resume is enough to flip
  // the overlay opaque-black over the whole screen (the sprite still draws).
  // No event reports that loss, so the risky transitions re-create the
  // surface outright; a recreate when the surface is healthy just flickers.
  const surfaceWatch = [];
  function onSurfaceRisk(target, eventName) {
    if (!target || typeof target.on !== 'function') {
      return;
    }
    const handler = () => {
      if (state.enabled && win && !win.isDestroyed?.()) {
        dbg(`pet: surface-risk ${eventName} → recreate`);
        recreateWindow();
      }
    };
    target.on(eventName, handler);
    surfaceWatch.push(() => target.removeListener?.(eventName, handler));
  }
  for (const eventName of ['display-metrics-changed', 'display-added', 'display-removed']) {
    onSurfaceRisk(screen, eventName);
  }
  const powerMonitor = options.powerMonitor || electron.powerMonitor;
  for (const eventName of ['resume', 'unlock-screen']) {
    onSurfaceRisk(powerMonitor, eventName);
  }

  function show() {
    if (!state.enabled) {
      return null;
    }
    if (!growthTimer) {
      // Usage rescan cadence: the scan itself runs on a worker thread (a
      // growing session log can be tens of MB), so a minute tick keeps
      //「可喂」fresh without stalling the main process.
      growthTimer = setInterval(rescanGrowth, 60000);
      growthTimer.unref?.();
    }
    startCursorPump();
    if (!win || win.isDestroyed?.()) {
      return createWindow();
    }
    if (!win.isVisible()) {
      win.showInactive();
    }
    return win;
  }

  function hide() {
    petRendererReady = false;
    clearInterval(growthTimer);
    growthTimer = 0;
    stopCursorPump();
    if (win && !win.isDestroyed?.()) {
      win.close();
    }
    win = null;
    interactive = false;
  }

  function setEnabled(enabled) {
    state = { ...state, enabled: enabled === true };
    persist();
    if (state.enabled) {
      show();
    } else {
      hide();
    }
    // Every enabled flip — pet panel 隐藏, settings page, tray — reaches this
    // funnel; the shell rebuilds its tray checkbox snapshot off the callback.
    try { options.onEnabledChange?.(state.enabled); } catch {}
    return { ...state };
  }

  function moveTo(x, y) {
    if (!win || win.isDestroyed?.()) {
      return null;
    }
    // Reject malformed drag payloads instead of teleporting the pet to (0,0).
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
      const current = petPosition();
      return [current.x, current.y];
    }
    // The overlay never moves: relay the target to the renderer, which
    // repaints the character at the new screen position.
    const px = Math.round(Number(x));
    const py = Math.round(Number(y));
    win.webContents.send('shell:live2d-move', { x: px, y: py });
    return [px, py];
  }

  function commitPosition(x, y) {
    let px = x;
    let py = y;
    // A committed point that sits off every display is a lost pet — clamp
    // the frame back inside the overlay's home display before persisting.
    if (Number.isFinite(Number(px)) && Number.isFinite(Number(py)) && !displayForPoint(px, py)) {
      let home;
      try { home = win && !win.isDestroyed?.() ? win.getBounds() : null; } catch { home = null; }
      home = home || overlayBounds();
      px = Math.min(Math.max(Number(px), home.x), home.x + home.width - PET_WIDTH);
      py = Math.min(Math.max(Number(py), home.y), home.y + home.height - PET_HEIGHT);
    }
    const position = moveTo(px, py) || [finite(px), finite(py)];
    state = { ...state, x: Math.round(position[0]), y: Math.round(position[1]) };
    persist();
    return { ...state };
  }

  // A fresh growth snapshot for the renderer's status panel — feeding and
  // level state live on the canvas now, no native menu.
  async function growthSnapshot() {
    try {
      await growth.refresh();
    } catch {}
    return { ...growth.snapshot(), stats: petStats.statsSnapshot(readStats()) };
  }

  function registerHandlers() {
    if (handlersRegistered || !ipcMain?.handle) {
      return;
    }
    try {
      protocol?.handle?.('pet', createPetProtocolHandler(rendererFile));
    } catch {}
    ipcMain.handle('shell:live2d-interactive', (event, payload) => {
      assertAuthorized(event);
      setSurfaceRegions(payload?.regions);
      setHitRegions(payload?.hitRegions);
      if (typeof payload?.interactive === 'boolean') {
        rendererInteractive = payload.interactive;
        applyInteractive();
      }
      return null;
    });
    ipcMain.handle('shell:live2d-care', (event, payload) => {
      assertAuthorized(event);
      care(payload?.kind);
      return null;
    });
    ipcMain.handle('shell:live2d-drag-start', (event) => {
      assertAuthorized(event);
      return petPosition();
    });
    ipcMain.handle('shell:live2d-drag-move', (event, payload) => {
      assertAuthorized(event);
      return moveTo(payload?.x, payload?.y);
    });
    ipcMain.handle('shell:live2d-drag-commit', (event, payload) => {
      assertAuthorized(event);
      return commitPosition(payload?.x, payload?.y);
    });
    // The overlay covers one display, so renderer pointer events die at its
    // edge. The renderer polls this during a drag; when the real cursor has
    // landed on another display, hop the overlay there and re-send layout.
    // The hop is debounced: the cursor must HOLD on the other display across
    // consecutive polls. A throw-flick only grazes the edge for a blink —
    // without the hold she lands on a monitor the user may not even have
    // visible (phantom/headless displays count as real ones to Windows).
    let relocateStreak = 0;
    let lastRelocateAt = 0;
    ipcMain.handle('shell:live2d-relocate', (event) => {
      assertAuthorized(event);
      if (!win || win.isDestroyed?.()) {
        return null;
      }
      // Polls only run during a drag (150ms cadence). A gap means the last
      // drag ended — reset the streak so a graze from a previous flick can't
      // combine with this drag's first away-poll into a single-poll hop.
      const now = Date.now();
      if (now - lastRelocateAt > 400) {
        relocateStreak = 0;
      }
      lastRelocateAt = now;
      const point = screen?.getCursorScreenPoint?.();
      const display = point && displayForPoint(point.x, point.y);
      const home = win.getBounds();
      const away = Boolean(display)
        && (display.bounds.x !== home.x || display.bounds.y !== home.y);
      relocateStreak = away ? relocateStreak + 1 : 0;
      if (away && relocateStreak >= 2) {
        relocateStreak = 0;
        const b = display.bounds;
        win.setBounds({ x: finite(b.x), y: finite(b.y), width: finite(b.width), height: finite(b.height) });
        sendLayout();
      }
      return null;
    });
    // Hide comes from the status panel's「隐藏桌面宠物」row.
    ipcMain.handle('shell:live2d-hide', (event) => {
      assertAuthorized(event);
      setEnabled(false);
      return null;
    });
    // Growth: aggregate token totals only — no message content crosses IPC.
    // The snapshot rescans so the panel's feedable count is fresh.
    ipcMain.handle('shell:live2d-growth', (event) => {
      assertAuthorized(event);
      return growthSnapshot();
    });
    ipcMain.handle('shell:live2d-feed', (event, payload) => {
      assertAuthorized(event);
      const amount = payload && Number.isFinite(payload.amount) ? payload.amount : undefined;
      return feedTokens(amount);
    });
    // Settings read for the pet renderer: normalized settings plus the
    // derived capability flag. Writes are owned by the main window's
    // settings page (shell:live2d-pet-settings → applySettings); the pet
    // surface itself is read-only.
    ipcMain.handle('shell:live2d-settings-get', (event) => {
      assertAuthorized(event);
      return settingsPayload();
    });
    // Roam rect: where her body is visually RIGHT NOW (screen coords, the
    // renderer's tight alpha bounds + hover pad). Transient only — never
    // folded into state.x/y.
    ipcMain.handle('shell:live2d-roam', (event, payload) => {
      assertAuthorized(event);
      const { x, y, w, h } = payload || {};
      if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
        roamRect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      }
      return null;
    });
    ipcMain.handle('shell:live2d-file-eat', (event, payload) => {
      assertAuthorized(event);
      return fileEat(payload?.names);
    });
    // The 「⚙ 设置」cell: the settings page lives in the main window's
    // Settings shell (section `pet`), so this channel only navigates — the
    // pet surface stays read-only for settings.
    ipcMain.handle('shell:live2d-open-settings', async (event) => {
      assertAuthorized(event);
      if (typeof options.openPetSettings !== 'function') {
        return { ok: false, reason: 'unavailable' };
      }
      try {
        return (await options.openPetSettings()) || { ok: true };
      } catch (error) {
        return { ok: false, reason: String(error?.message || error) };
      }
    });
    // Quick chat (§B9): the renderer sends {text}; the reply is generated
    // with the configured DeepSeek credentials and the current persona.
    // Gated by settings.chatEnabled — a disabled toggle short-circuits to
    // the fallback line without touching the network.
    ipcMain.handle('shell:live2d-chat', async (event, payload) => {
      assertAuthorized(event);
      if (!petSettings.normalizeSettings(state.settings).chatEnabled) {
        return { ok: false, reason: 'disabled' };
      }
      return petChat.chat({
        text: payload?.text,
        personality: petSettings.normalizeSettings(state.settings).personality,
      });
    });
    // Shared-session surface for the quick-chat card: model catalog +
    // current session selection + the shared history tail. Assistant off
    // → enabled:false and the card hides the model/jump chrome.
    ipcMain.handle('shell:live2d-chat-state', async (event, request) => {
      assertAuthorized(event);
      if (!whaleEnabled()) {
        return { ok: true, enabled: false, models: [], selected: null, history: [] };
      }
      const res = await whalePost('pet/state', {
        includeCatalog: request?.includeCatalog !== false,
      });
      if (!res.ok) {
        return { ok: false, enabled: true, reason: res.reason };
      }
      const v = res.value || {};
      if (v.ok === false) {
        return { ok: false, enabled: true, reason: v.error || 'whale-failed' };
      }
      return {
        ok: true,
        enabled: true,
        sessionId: String(v.sessionId || ''),
        name: String(v.name || ''),
        groups: Array.isArray(v.groups) ? v.groups : null,
        selected: v.model && typeof v.model === 'object' ? v.model : null,
        history: Array.isArray(v.history) ? v.history : [],
      };
    });
    // The card's model picker writes the shared session's own selection.
    ipcMain.handle('shell:live2d-chat-select-model', async (event, payload) => {
      assertAuthorized(event);
      if (!whaleEnabled()) {
        return { ok: false, reason: 'disabled' };
      }
      const provider = String(payload?.provider ?? '').trim();
      const model = String(payload?.model ?? '').trim();
      if (!provider || !model) {
        return { ok: false, reason: 'invalid-model' };
      }
      const res = await whalePost('pet/select-model', {
        provider,
        model,
        reasoningEffort: String(payload?.reasoningEffort ?? '').trim(),
      });
      if (!res.ok) return { ok: false, reason: res.reason };
      if (res.value?.ok === false) {
        return { ok: false, reason: res.value.error || 'whale-failed' };
      }
      return { ok: true, selected: res.value?.selected ?? null };
    });
    // Jump button on the card → raise the main window on the assistant
    // conversation (the same session the card is talking to).
    ipcMain.handle('shell:live2d-open-whale', async (event) => {
      assertAuthorized(event);
      if (typeof options.openWhaleAssistant !== 'function') {
        return { ok: false, reason: 'unavailable' };
      }
      try {
        return (await options.openWhaleAssistant()) || { ok: true };
      } catch (error) {
        return { ok: false, reason: String(error?.message || error) };
      }
    });
    // The overlay is created focusable:false so it can never steal keyboard
    // focus; the chat dialog needs real input (IME included), so the renderer
    // flips this on while the card is open and back off on close.
    ipcMain.handle('shell:live2d-chat-focus', (event, payload) => {
      assertAuthorized(event);
      if (!win || win.isDestroyed?.()) {
        return null;
      }
      const on = payload?.focus === true;
      chatFocusWanted = on;
      try {
        win.setFocusable?.(on);
        if (on) {
          win.focus();
        } else {
          win.blur?.();
          // blur() is a no-op on Windows when nothing claims the focus next;
          // a still-focused noactivate pet silently eats keystrokes. If it
          // stuck, hand focus to the main window so typing lands somewhere
          // real instead of a hidden-card window.
          setTimeout(() => {
            try {
              if (chatFocusWanted || !win || win.isDestroyed?.() || !win.isFocused?.()) { return; }
              const main = getMainWindow();
              if (main && !main.isDestroyed?.() && main.isVisible?.()) {
                main.focus();
              }
            } catch { /* focus handoff is best-effort */ }
          }, 120);
        }
      } catch { /* platform without setFocusable — input just stays read-only */ }
      return null;
    });
    // 「看看屏幕」: manual one-shot — capture the pet's display, JPEG-70 at
    // ≤768px, feed the configured vision model. Cooldown + size cap keep it
    // cheap. On the whale route the glance rides her persistent session as
    // a real prompt when her session model can see (screenshot = user row,
    // comment = assistant row); a text-only session route falls back to a
    // standalone vision call plus a folded plugin notice. The legacy
    // direct path stays memory-only.
    ipcMain.handle('shell:live2d-look', async (event) => {
      assertAuthorized(event);
      // No vision model → refuse before the cooldown stamp AND before
      // desktopCapturer: a look that cannot succeed must not take a
      // screenshot at all.
      if (!lookModelOf()) {
        return { ok: false, reason: 'no-vision-model' };
      }
      const now = Date.now();
      if (now - lastLookAt < LOOK_COOLDOWN_MS) {
        return { ok: false, reason: 'cooldown' };
      }
      lastLookAt = now;
      const capturer = electron.desktopCapturer;
      if (!capturer?.getSources) {
        return { ok: false, reason: 'no-capturer' };
      }
      try {
        const pet = petPosition();
        const display = displayForPoint(pet.x + PET_WIDTH / 2, pet.y + PET_HEIGHT / 2)
          || screen?.getPrimaryDisplay?.();
        const sources = await capturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 768, height: 480 },
        });
        const source = (display && sources.find((s) => s.display_id === String(display.id)))
          || sources[0];
        const jpeg = source?.thumbnail?.toJPEG?.(70);
        if (!jpeg || !jpeg.length) {
          return { ok: false, reason: 'no-frame' };
        }
        const route = lookRouteOf();
        return petChat.look({
          image: jpeg.toString('base64'),
          provider: route.provider,
          model: route.model,
          personality: petSettings.normalizeSettings(state.settings).personality,
        });
      } catch {
        return { ok: false, reason: 'capture-failed' };
      }
    });
    handlersRegistered = true;
  }

  function dispose() {
    clearInterval(growthTimer);
    growthTimer = 0;
    Promise.resolve(growth.close?.()).catch(() => {});
    clearTimeout(mirrorTimer);
    mirrorTimer = 0;
    stopCursorPump();
    hide();
    if (stopDshWatch) {
      stopDshWatch();
      stopDshWatch = null;
    }
    if (handlersRegistered) {
      ipcMain.removeHandler?.('shell:live2d-interactive');
      ipcMain.removeHandler?.('shell:live2d-drag-start');
      ipcMain.removeHandler?.('shell:live2d-drag-move');
      ipcMain.removeHandler?.('shell:live2d-drag-commit');
      ipcMain.removeHandler?.('shell:live2d-relocate');
      ipcMain.removeHandler?.('shell:live2d-hide');
      ipcMain.removeHandler?.('shell:live2d-growth');
      ipcMain.removeHandler?.('shell:live2d-feed');
      ipcMain.removeHandler?.('shell:live2d-care');
      ipcMain.removeHandler?.('shell:live2d-settings-get');
      ipcMain.removeHandler?.('shell:live2d-open-settings');
      ipcMain.removeHandler?.('shell:live2d-roam');
      ipcMain.removeHandler?.('shell:live2d-file-eat');
      ipcMain.removeHandler?.('shell:live2d-chat');
      ipcMain.removeHandler?.('shell:live2d-chat-focus');
      ipcMain.removeHandler?.('shell:live2d-chat-state');
      ipcMain.removeHandler?.('shell:live2d-chat-select-model');
      ipcMain.removeHandler?.('shell:live2d-open-whale');
      ipcMain.removeHandler?.('shell:live2d-look');
      handlersRegistered = false;
    }
    while (surfaceWatch.length) {
      try { surfaceWatch.pop()(); } catch {}
    }
  }

  registerHandlers();
  // Usage belongs to the assistant even while its visual pet is hidden.
  if (options.sessionsDir) stopDshWatch = dshWatch.start(2000) || null;
  // One-shot heal on startup: an assistant catalog written before the
  // unified control (or while the pet was off) may hold a divergent
  // personality — re-asserting the pet value closes the gap. Harness not
  // up yet → the retry loop delivers it later.
  queuePersonalityMirror(state.settings?.personality);
  return {
    show,
    hide,
    setEnabled,
    applySettings,
    getSettings: settingsPayload,
    setInteractive,
    moveTo,
    commitPosition,
    pollCursor,
    dispose,
    getState: () => ({ ...state }),
    isEnabled: () => state.enabled,
    getWindow: () => win,
    recreateWindow,
    isInteractive: () => interactive,
  };
}

let activeManager = null;

function configureLive2dPet(options) {
  if (!LIVE2D_PET_FEATURE) {
    return null;
  }
  activeManager?.dispose();
  activeManager = createLive2dPetManager(options);
  return activeManager;
}

function getLive2dPet() {
  return LIVE2D_PET_FEATURE ? activeManager : null;
}

module.exports = {
  LIVE2D_PET_FEATURE,
  PET_WIDTH,
  PET_HEIGHT,
  EDGE_GAP,
  PET_PAGE_URL,
  normalizeLive2dPetState,
  defaultPosition,
  isPetFrameUrl,
  createPetProtocolHandler,
  createLive2dPetManager,
  configureLive2dPet,
  getLive2dPet,
};
