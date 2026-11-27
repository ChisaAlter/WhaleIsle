const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// Reuse the generated application tile, including its white rounded background.
// Run npm run icon before regenerating installer artwork.
const brandHeadDataUri = `data:image/png;base64,${fs.readFileSync(path.join(root, 'assets', 'icon.png')).toString('base64')}`;

// NSIS/MUI2 bitmap geometry is fixed: the welcome/finish sidebar is 164x314
// and the page header strip is 150x57 (classic 96dpi dialog units).
const SIDEBAR_WIDTH = 164;
const SIDEBAR_HEIGHT = 314;
const HEADER_WIDTH = 150;
const HEADER_HEIGHT = 57;
// Render at 2x then downscale for crisp antialiasing in the final bitmap.
const SCALE = 2;

// Build-time bitmaps cannot consume runtime CSS tokens; these literals MIRROR
// the official light table in src/shared/dsh-webui-tokens.css (the same table
// the launcher uses — installer chrome follows the launcher, not boot.html):
//   SIDEBAR_FILL  --dsw-specific-sidebar-fill   rgb(249, 250, 251)
//   CANVAS        --dsw-alias-bg-base           rgb(255, 255, 255)
//   LABEL_1       --dsw-alias-label-primary     rgb(15, 17, 21)
//   LABEL_2       --dsw-alias-label-secondary   rgb(97, 102, 107)
//   LABEL_3       --dsw-alias-label-tertiary    rgb(129, 133, 140)
//   BLUE          --dsw-static-deepseek-500     rgb(65, 118, 230)  (accent only)
//   HAIRLINE      --dsw-alias-border-l2 style   rgba(0, 0, 0, 0.10)
// Keep this table in sync with dsh-webui-tokens.css when the light theme moves.
const SIDEBAR_FILL = 'rgb(249, 250, 251)';
const CANVAS = 'rgb(255, 255, 255)';
const LABEL_1 = 'rgb(15, 17, 21)';
const LABEL_2 = 'rgb(97, 102, 107)';
const LABEL_3 = 'rgb(129, 133, 140)';
const BLUE = 'rgb(65, 118, 230)';
const HAIRLINE = 'rgba(0, 0, 0, 0.10)';

const FONT_STACK = "-apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif";

function brandMark(size, { muted = false } = {}) {
  // `muted` renders the uninstaller variant: same mark pulled toward the
  // grayscale palette the removal context uses. The shared icon already
  // contains the white rounded tile and inset head; preserve its proportions.
  const filter = muted ? 'filter:grayscale(0.85) opacity(0.75);' : '';
  return `<div style="width:${size}px;height:${size}px;${filter}"><img src="${brandHeadDataUri}" style="width:100%;height:100%;object-fit:contain" alt=""></div>`;
}

/**
 * Welcome/finish sidebar: official light sidebar fill (same as the launcher
 * rail), the whale-girl head mark, the product name
 * `WhaleIsle` in the 164px column, and a thin
 * DeepSeek-blue accent rule. A right hairline separates it from the white
 * dialog canvas. Chinese copy stays in the localized MUI strings, not baked
 * into bitmaps.
 */
function sidebarHtml(k, { muted, titleColor, accentColor }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${SIDEBAR_WIDTH * k}px;height:${SIDEBAR_HEIGHT * k}px;overflow:hidden}
    body{background:${SIDEBAR_FILL};font-family:${FONT_STACK};position:relative}
    .stack{position:absolute;top:${72 * k}px;left:0;right:${1 * k}px;display:flex;flex-direction:column;align-items:center}
    .word{margin-top:${20 * k}px;padding:0 ${14 * k}px;font-size:${14 * k}px;line-height:${22 * k}px;font-weight:600;color:${titleColor};text-align:center;overflow-wrap:break-word;max-width:100%;box-sizing:border-box}
    .rule{margin-top:${16 * k}px;width:${24 * k}px;height:${2 * k}px;background:${accentColor}}
    .hairline{position:absolute;top:0;right:0;width:${1 * k}px;height:100%;background:${HAIRLINE}}
  </style></head><body>
    <div class="stack">
      ${brandMark(72 * k, { muted })}
      <div class="word">WhaleIsle</div>
      <div class="rule"></div>
    </div>
    <div class="hairline"></div>
  </body></html>`;
}

/**
 * Page header strip (shown at the right of the white MUI header): the
 * whale-girl head mark on the bg-base white so it reads as part of the
 * light header chrome, not a sticker.
 */
function headerHtml(k) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${HEADER_WIDTH * k}px;height:${HEADER_HEIGHT * k}px;overflow:hidden}
    body{background:${CANVAS};position:relative}
    .mark{position:absolute;top:${((HEADER_HEIGHT - 28) / 2) * k}px;right:${16 * k}px}
  </style></head><body>
    <div class="mark">${brandMark(28 * k)}</div>
  </body></html>`;
}

/** Encode an opaque nativeImage as a classic 24-bit BITMAPINFOHEADER BMP. */
function bmp24FromImage(image) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  if (bgra.length !== width * height * 4) {
    throw new Error(`unexpected bitmap buffer ${bgra.length} for ${width}x${height}`);
  }
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const out = Buffer.alloc(14 + 40 + pixelBytes);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(0, 30);
  out.writeUInt32LE(pixelBytes, 34);
  out.writeInt32LE(2835, 38);
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y += 1) {
    const srcRow = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const src = srcRow + x * 4;
      out[dst] = bgra[src];
      out[dst + 1] = bgra[src + 1];
      out[dst + 2] = bgra[src + 2];
      dst += 3;
    }
  }
  return out;
}

// One shared window for every render: some environments fail any page load
// after an offscreen BrowserWindow has been destroyed. The window is sized to
// the largest target once; each render captures its own page rect so no
// mid-run resize has to settle.
async function renderBmp(win, html, width, height, dest) {
  // Long data: URLs flake with ERR_FAILED; load from a temp file instead.
  const htmlFile = path.join(require('os').tmpdir(), `installer-asset-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(htmlFile, html);
  try {
    await win.loadFile(htmlFile);
  } finally {
    fs.rmSync(htmlFile, { force: true });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const capture = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: width * SCALE,
    height: height * SCALE,
  });
  const image = nativeImage
    .createFromBuffer(capture.toPNG())
    .resize({ width, height, quality: 'best' });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bmp24FromImage(image));
  process.stdout.write(`wrote ${dest}\n`);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const buildDir = path.join(root, 'build');
  const win = new BrowserWindow({
    width: Math.max(SIDEBAR_WIDTH, HEADER_WIDTH) * SCALE,
    height: Math.max(SIDEBAR_HEIGHT, HEADER_HEIGHT) * SCALE,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await renderBmp(
    win,
    sidebarHtml(SCALE, { muted: false, titleColor: LABEL_1, accentColor: BLUE }),
    SIDEBAR_WIDTH,
    SIDEBAR_HEIGHT,
    path.join(buildDir, 'installerSidebar.bmp'),
  );
  // Uninstaller variant: same light composition, muted grayscale labels and
  // no brand accent (removal context) — never a dark marketing panel.
  await renderBmp(
    win,
    sidebarHtml(SCALE, { muted: true, titleColor: LABEL_2, accentColor: LABEL_3 }),
    SIDEBAR_WIDTH,
    SIDEBAR_HEIGHT,
    path.join(buildDir, 'uninstallerSidebar.bmp'),
  );
  await renderBmp(win, headerHtml(SCALE), HEADER_WIDTH, HEADER_HEIGHT, path.join(buildDir, 'installerHeader.bmp'));
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
