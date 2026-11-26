'use strict';

const pet = document.querySelector('.pet');
const spriteCanvas = document.querySelector('.pet__sprite');
const whaleImage = document.querySelector('.pet__image');
const halo = document.querySelector('.pet__halo');
const spark = document.querySelector('.pet__spark');
const spriteCtx = spriteCanvas.getContext('2d');

const FRAME_MS = 120;
const SLEEP_MS = 90_000;
const DRAG_THRESHOLD = 4;
// Codex atlas rows shared by v1 (8x9) and v2 (8x11); v2 appends two
// look-direction rows: row 9 holds 000–157.5°, row 10 holds 180–337.5°
// (000 = up, angles grow clockwise in 22.5° steps).
const ROW = {
  idle: 0,
  runRight: 1,
  runLeft: 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
  lookLow: 9,
  lookHigh: 10,
};

let dragStart = null;
let lastDragMoved = false;
let sleepTimer = null;

const sprite = {
  spec: null,
  image: null,
  row: ROW.idle,
  frame: 0,
  onceDone: null,
  timer: null,
  asleep: false,
};

function applyTheme(theme) {
  const dark = theme?.scheme === 'dark';
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.body?.toggleAttribute('data-ds-dark-theme', dark);
  if (typeof theme?.minimalMode === 'boolean') {
    document.documentElement.toggleAttribute('data-dsh-minimal', theme.minimalMode);
    if (theme.minimalMode && hasSprite()) {
      stopLoop();
      sprite.row = ROW.idle;
      sprite.frame = 0;
      sprite.onceDone = null;
      drawCell(0, ROW.idle);
    }
  }
}

function hasSprite() {
  return Boolean(sprite.spec && sprite.image);
}

function hasGaze() {
  return hasSprite() && sprite.spec.rows > ROW.lookHigh;
}

function displaySize() {
  const ratio = sprite.spec.cellHeight / sprite.spec.cellWidth;
  const width = 80;
  return { width, height: Math.round(width * ratio) };
}

function sizeCanvas() {
  const { width, height } = displaySize();
  const dpr = window.devicePixelRatio || 1;
  spriteCanvas.style.width = `${width}px`;
  spriteCanvas.style.height = `${height}px`;
  spriteCanvas.width = Math.round(width * dpr);
  spriteCanvas.height = Math.round(height * dpr);
  spriteCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawCell(col, row) {
  if (!hasSprite()) {
    return;
  }
  const { width, height } = displaySize();
  const { cellWidth, cellHeight } = sprite.spec;
  spriteCtx.clearRect(0, 0, width, height);
  spriteCtx.drawImage(
    sprite.image,
    col * cellWidth,
    row * cellHeight,
    cellWidth,
    cellHeight,
    0,
    0,
    width,
    height,
  );
}

function stopLoop() {
  if (sprite.timer) {
    window.clearInterval(sprite.timer);
    sprite.timer = null;
  }
}

function startLoop() {
  if (!sprite.timer && hasSprite() && !sprite.asleep) {
    sprite.timer = window.setInterval(tick, FRAME_MS);
  }
}

function tick() {
  if (!hasSprite()) {
    stopLoop();
    return;
  }
  const cols = sprite.spec.cols;
  sprite.frame += 1;
  if (sprite.frame >= cols) {
    if (sprite.onceDone) {
      const done = sprite.onceDone;
      sprite.onceDone = null;
      done();
      return;
    }
    sprite.frame = 0;
  }
  drawCell(sprite.frame, sprite.row);
}

function reducedMotionOn() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    || document.documentElement.hasAttribute('data-dsh-minimal');
}

function playLoop(row) {
  if (!hasSprite()) {
    return;
  }
  if (reducedMotionOn()) {
    sprite.row = ROW.idle;
    sprite.frame = 0;
    sprite.onceDone = null;
    drawCell(0, ROW.idle);
    return;
  }
  if (sprite.row === row && !sprite.onceDone && sprite.timer) {
    return;
  }
  sprite.row = row;
  sprite.frame = 0;
  sprite.onceDone = null;
  drawCell(0, row);
  startLoop();
}

function playOnce(row, done) {
  if (!hasSprite() || reducedMotionOn()) {
    playLoop(ROW.idle);
    if (typeof done === 'function') done();
    return;
  }
  sprite.row = row;
  sprite.frame = 0;
  sprite.onceDone = () => {
    playLoop(ROW.idle);
    if (typeof done === 'function') done();
  };
  drawCell(0, row);
  startLoop();
}

// v2 look rows: pick one of 16 clockwise directions; 000 is up.
function gazeAt(clientX, clientY) {
  if (!hasGaze() || dragStart || sprite.onceDone || sprite.asleep) {
    return;
  }
  const rect = pet.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const index = Math.round(((degrees + 360) % 360) / 22.5) % 16;
  const row = index < 8 ? ROW.lookLow : ROW.lookHigh;
  stopLoop();
  drawCell(index % 8, row);
}

function scheduleSleep() {
  window.clearTimeout(sleepTimer);
  sleepTimer = window.setTimeout(() => {
    if (!hasSprite() || dragStart) {
      return;
    }
    sprite.asleep = true;
    stopLoop();
    pet.classList.add('is-sleepy');
  }, SLEEP_MS);
}

function wake() {
  if (!sprite.asleep) {
    scheduleSleep();
    return;
  }
  sprite.asleep = false;
  pet.classList.remove('is-sleepy');
  playLoop(ROW.idle);
  scheduleSleep();
}

function setSpriteMode(enabled) {
  pet.classList.toggle('is-sprite', enabled);
  spriteCanvas.hidden = !enabled;
  whaleImage.hidden = enabled;
  halo.hidden = enabled;
  spark.hidden = enabled;
}

function clearSprite() {
  stopLoop();
  sprite.spec = null;
  sprite.image = null;
  sprite.onceDone = null;
  sprite.asleep = false;
  pet.classList.remove('is-sleepy');
  setSpriteMode(false);
}

function loadSprite(spec) {
  clearSprite();
  if (!spec || typeof spec.sheetUrl !== 'string' || !spec.sheetUrl) {
    return;
  }
  const image = new Image();
  image.onload = () => {
    sprite.spec = spec;
    sprite.image = image;
    setSpriteMode(true);
    sizeCanvas();
    playOnce(ROW.waving);
    scheduleSleep();
  };
  image.onerror = () => clearSprite();
  image.src = spec.sheetUrl;
}

function clearHappy() {
  pet.classList.remove('is-happy');
}

function showHappy() {
  pet.classList.add('is-happy');
  window.setTimeout(clearHappy, 420);
}

pet.addEventListener('click', () => {
  wake();
  if (lastDragMoved) {
    lastDragMoved = false;
    return;
  }
  if (hasSprite()) {
    playOnce(ROW.waving);
  } else {
    showHappy();
  }
});

pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  wake();
  window.shell.openMenu().catch((/** @type {unknown} */ error) => { console.warn('[src/renderer/pet.js] background operation failed', error); });
});

pet.addEventListener('pointerdown', (event) => {
  wake();
  lastDragMoved = false;
  dragStart = {
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
  };
  pet.classList.add('is-dragging');
  pet.setPointerCapture?.(event.pointerId);
});

pet.addEventListener('pointermove', (event) => {
  if (!dragStart) {
    gazeAt(event.clientX, event.clientY);
    return;
  }
  dragStart.lastX = event.clientX;
  dragStart.lastY = event.clientY;
  const dx = event.clientX - dragStart.startX;
  const dy = event.clientY - dragStart.startY;
  pet.style.transform = `translate(${dx}px, ${dy}px)`;
  if (hasSprite() && (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD)) {
    playLoop(dx < 0 ? ROW.runLeft : ROW.runRight);
  }
});

pet.addEventListener('pointerleave', () => {
  if (!dragStart && hasSprite() && !sprite.onceDone) {
    playLoop(ROW.idle);
  }
});

pet.addEventListener('pointerenter', wake);

async function finishDrag(event) {
  if (!dragStart) return;
  const dx = event.clientX - dragStart.startX;
  const dy = event.clientY - dragStart.startY;
  const moved = Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD;
  pet.classList.remove('is-dragging');
  pet.style.transform = '';
  dragStart = null;
  lastDragMoved = moved;
  if (moved) {
    if (hasSprite()) {
      playOnce(ROW.jumping);
    }
    await window.shell.commitDrag({ deltaX: dx, deltaY: dy });
  } else if (hasSprite() && !sprite.onceDone) {
    playLoop(ROW.idle);
  }
}

pet.addEventListener('pointerup', finishDrag);
pet.addEventListener('pointercancel', finishDrag);

window.addEventListener('resize', () => {
  if (hasSprite()) {
    sizeCanvas();
    drawCell(sprite.frame, sprite.row);
  }
});

window.shell.onTheme(applyTheme);
window.shell.onState((payload) => loadSprite(payload?.pet));
window.shell.getState().then((payload) => {
  applyTheme(payload?.theme);
  loadSprite(payload?.pet);
}).catch((/** @type {unknown} */ error) => { console.warn('[src/renderer/pet.js] background operation failed', error); });
