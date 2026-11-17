'use strict';

// ── ONNX runtime ──
async function createSession() {
  ort.env.wasm.wasmPaths = 'pet://pet/pet-live2d/ort/';
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'warning';
  for (const ep of ['webnn', 'webgpu']) {
    // The 1024² HD export renders all-white under the WebGPU EP — stick to the
    // proven 512² model until that graph is fixed.
    for (const [url, frame] of [[MODEL_URL, 512]]) {
      // The HD graph has ops that don't partition to JSEP under capture —
      // retry it without capture (slightly slower launches, still WebGPU).
      for (const capture of ep === 'webgpu' ? [true, false] : [false]) {
        try {
          const s = await ort.InferenceSession.create(url, {
            executionProviders: [ep],
            enableGraphCapture: capture,
            preferredOutputLocation: ep === 'webgpu' ? 'gpu-buffer' : undefined,
          });
          const k = frame / 512;
          FRAME = frame;
          CROP = { x: 60 * k, y: 20 * k, w: 390 * k, h: 492 * k };
          sessionOnGpu = ep === 'webgpu' && !!ort.env.webgpu?.device;
          console.log(`pet: session on ${ep} @${frame}² capture=${capture}`);
          return s;
        } catch (error) {
          console.warn(`pet: ${ep} session failed @${frame} capture=${capture}`, error);
        }
      }
    }
  }
  // WASM: SD only — a 1024² SIREN frame is ~2s on CPU, not a usable fallback.
  const s = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
  console.log('pet: session on wasm @512²');
  return s;
}

async function loadImageTensor() {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = CHARACTER_URL;
  });
  const off = document.createElement('canvas');
  off.width = off.height = FRAME;
  const offCtx = off.getContext('2d', { willReadFrequently: true });
  offCtx.drawImage(img, 0, 0);
  const { data } = offCtx.getImageData(0, 0, FRAME, FRAME);
  const tensor = new Float32Array(4 * FRAME * FRAME);
  for (let i = 0; i < FRAME * FRAME; i += 1) {
    const a = data[i * 4 + 3] / 255;
    tensor[i] = (data[i * 4] / 255) * a * 2 - 1;
    tensor[FRAME * FRAME + i] = (data[i * 4 + 1] / 255) * a * 2 - 1;
    tensor[FRAME * FRAME * 2 + i] = (data[i * 4 + 2] / 255) * a * 2 - 1;
    tensor[FRAME * FRAME * 3 + i] = a * 2 - 1;
  }
  if (sessionOnGpu) {
    // Graph capture replays the recorded command list, so every input must be
    // an external GPU buffer. The image is constant; only `pose` is rewritten
    // per frame via `queue.writeBuffer`.
    const device = ort.env.webgpu.device;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const imageBuffer = device.createBuffer({ size: tensor.byteLength, usage });
    device.queue.writeBuffer(imageBuffer, 0, tensor);
    poseGpuBuffer = device.createBuffer({ size: 45 * 4, usage });
    poseTensor = ort.Tensor.fromGpuBuffer(poseGpuBuffer, { dataType: 'float32', dims: [1, 45] });
    return ort.Tensor.fromGpuBuffer(imageBuffer, { dataType: 'float32', dims: [1, 4, FRAME, FRAME] });
  }
  return new ort.Tensor('float32', tensor, [1, 4, FRAME, FRAME]);
}

// Output buffers are sized by FRAME, which is only known once the session
// picks HD (1024²) or SD (512²) — allocate lazily after createSession().
let outCanvas = null;
let outCtx = null;
let outImage = null;
let gpuPixels = null;
function allocOutput() {
  outCanvas = document.createElement('canvas');
  outCanvas.width = outCanvas.height = FRAME;
  outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  outImage = outCtx.createImageData(FRAME, FRAME);
}

// Keep the existing Uint8ClampedArray conversion (including ties-to-even)
// while downloading one packed RGBA byte per channel instead of four floats.
// Inference and Anime4K still use the same model and display pipeline.
async function initGpuPixels() {
  if (!sessionOnGpu) { return; }
  const device = ort.env.webgpu.device;
  const n = FRAME * FRAME;
  const shader = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read> rgba: array<f32>;
    @group(0) @binding(1) var<storage, read_write> pixels: array<u32>;
    fn clampedByte(v: f32) -> u32 {
      if (!(v > 0.0)) { return 0u; }
      if (v >= 255.0) { return 255u; }
      let lower = floor(v);
      let value = u32(lower);
      let fraction = v - lower;
      return value + select(0u, 1u,
        fraction > 0.5 || (fraction == 0.5 && (value & 1u) == 1u));
    }
    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let i = id.x;
      if (i >= ${n}u) { return; }
      pixels[i] = clampedByte(rgba[i])
        | (clampedByte(rgba[${n}u + i]) << 8u)
        | (clampedByte(rgba[${n * 2}u + i]) << 16u)
        | (clampedByte(rgba[${n * 3}u + i]) << 24u);
    }` });
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto',
    compute: { module: shader, entryPoint: 'main' } });
  const packed = device.createBuffer({ size: n * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: n * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  gpuPixels = { device, pipeline, packed, staging, size: n * 4, n };
}

async function copyOutputPixels(out) {
  if (gpuPixels) {
    const { device, pipeline, packed, staging, size, n } = gpuPixels;
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: out.gpuBuffer } },
      { binding: 1, resource: { buffer: packed } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
    encoder.copyBufferToBuffer(packed, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    try {
      outImage.data.set(new Uint8Array(staging.getMappedRange()));
    } finally {
      staging.unmap();
    }
    return;
  }
  const raw = sessionOnGpu ? await out.getData() : out.data;
  const px = outImage.data;
  const n = FRAME * FRAME;
  for (let i = 0; i < n; i += 1) {
    px[i * 4] = raw[i];
    px[i * 4 + 1] = raw[n + i];
    px[i * 4 + 2] = raw[n * 2 + i];
    px[i * 4 + 3] = raw[n * 3 + i];
  }
}

// ── live SR stage (Anime4K CNN, WebGL) ──
// THA4 renders painterly-soft at 512²; Anime4K restores the line art at 2×
// per frame — real-time GLSL, no per-frame readback. The net only sees RGB:
// transparent-black surroundings would smear a dark halo inward, so the
// crop's RGB is bleed-filled (destination-over with a blurred copy) before
// upscale, and alpha comes from a plain bilinear upscale composited
// destination-in afterwards — edges stay soft because alpha is smooth.
let srUp = null;        // Anime4KJS.ImageUpscaler
let srCrop = null;      // 2d canvas CROP.w × CROP.h — RGB-bleeded net input
let srBlur = null;      // scratch for the bleed pass
let srGL = null;        // WebGL canvas the upscaler renders into
let srOut = null;       // 2d canvas: SR rgb + alpha composited → drawn frame
let srReady = false;
// Whether the CURRENT `outCanvas` contents reached the display through SR.
// Cleared whenever a raw inference frame is produced, set by `srFrame()`.
let frameIsSr = false;

function initSr() {
  if (typeof Anime4KJS === 'undefined' || !Anime4KJS.ImageUpscaler?.isSupported()) {
    return;
  }
  try {
    srCrop = document.createElement('canvas');
    srCrop.width = CROP.w; srCrop.height = CROP.h;
    srBlur = document.createElement('canvas');
    srBlur.width = CROP.w; srBlur.height = CROP.h;
    srGL = document.createElement('canvas');
    srUp = new Anime4KJS.ImageUpscaler(Anime4KJS.ANIME4KJS_SIMPLE_M_2X);
    srUp.attachSource(srCrop, srGL);
    srOut = document.createElement('canvas');
    srOut.width = srGL.width; srOut.height = srGL.height;
    srReady = true;
    console.log('pet: anime4k SR ready', srGL.width, 'x', srGL.height);
  } catch (e) {
    console.warn('pet: anime4k init failed', e);
    srUp = null;
    srReady = false;
  }
}

// One inference frame → SR'd display frame. Runs inside renderFrame after
// putImageData; all steps are GPU-side draws (no readback).
function srFrame() {
  // A diagnostic override may suspend SR for one measurement window. It must
  // fall back to the raw frame rather than leaving the last enhanced image on
  // screen, so the comparison measures the same content at two qualities.
  if (!srReady || srEnabledOverride === false) {
    frameIsSr = false;
    return;
  }
  const perfStart = petPerf.enabled ? performance.now() : 0;
  const c = srCrop.getContext('2d');
  c.clearRect(0, 0, CROP.w, CROP.h);
  c.drawImage(outCanvas, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);
  // Two blur-bleed passes flood RGB ~20px past the silhouette.
  const b = srBlur.getContext('2d');
  for (let i = 0; i < 2; i += 1) {
    b.clearRect(0, 0, CROP.w, CROP.h);
    b.filter = 'blur(10px)';
    b.drawImage(srCrop, 0, 0);
    b.filter = 'none';
    c.globalCompositeOperation = 'destination-over';
    c.drawImage(srBlur, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }
  srUp.upscale(); // re-uploads srCrop, runs the CNN chain into srGL
  const o = srOut.getContext('2d');
  o.clearRect(0, 0, srOut.width, srOut.height);
  o.drawImage(srGL, 0, 0);
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(outCanvas, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, srOut.width, srOut.height);
  o.globalCompositeOperation = 'source-over';
  frameIsSr = true;
  if (petPerf.enabled) { petPerf.record('superResolution', performance.now() - perfStart); }
}

// Bounding box of the character in PET-LOCAL coordinates (0..PET_W/PET_H),
// measured from the alpha channel of the rendered frame once — petBounds()
// adds drawPos to get the window-space hit area, so clicks pass through
// everywhere except on the character itself.
function measureCharRect() {
  const data = outImage.data;
  const n = FRAME * FRAME;
  let minX = FRAME; let minY = FRAME; let maxX = -1; let maxY = -1;
  for (let y = 0; y < FRAME; y += 2) {
    for (let x = 0; x < FRAME; x += 2) {
      if (data[(y * FRAME + x) * 4 + 3] > 16) {
        if (x < minX) { minX = x; }
        if (x > maxX) { maxX = x; }
        if (y < minY) { minY = y; }
        if (y > maxY) { maxY = y; }
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  const sx = petW() / CROP.w;
  const sy = petH() / CROP.h;
  return {
    x: (minX - CROP.x) * sx,
    y: (minY - CROP.y) * sy,
    right: (maxX - CROP.x) * sx,
    bottom: (maxY - CROP.y) * sy,
  };
}

let poseCpuTensor = null; // reused pose input on the non-graph-capture path —
                          // a fresh ort.Tensor per frame leaked WASM memory.

async function renderFrame() {
  if (inferBusy || !session) {
    if (inferBusy) { petPerf.record('inferenceBusy', 0); }
    return;
  }
  inferBusy = true;
  petPerf.bump('inferenceStart');
  const perfStart = petPerf.enabled ? performance.now() : 0;
  // Hoisted so `finally` can release the output tensors on EVERY exit path —
  // including a rejected run() or a readback that throws. Disposing only after
  // a successful readback leaked a full frame of wasm/webgpu memory each time
  // the backend hiccuped.
  let results = null;
  try {
    if (sessionOnGpu) {
      ort.env.webgpu.device.queue.writeBuffer(poseGpuBuffer, 0, pose);
      results = await session.run({ image: imageTensor, pose: poseTensor });
    } else {
      if (!poseCpuTensor) {
        poseCpuTensor = new ort.Tensor('float32', new Float32Array(45), [1, 45]);
      }
      poseCpuTensor.data.set(pose);
      results = await session.run({ image: imageTensor, pose: poseCpuTensor });
    }
    const runMs = performance.now() - perfStart;
    petPerf.bump('frameProduced');
    if (petPerf.enabled) { petPerf.record('sessionRun', runMs); }
    const out = results.rgba_f || results.rgba;
    const readStart = petPerf.enabled ? performance.now() : 0;
    await copyOutputPixels(out);
    if (petPerf.enabled) { petPerf.record('readbackConvert', performance.now() - readStart); }
    const px = outImage.data;
    let alphaMax = 0;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > alphaMax) alphaMax = px[i];
    }
    // Skip a fully-transparent frame (a bad readback would blank her out for
    // a frame, which reads as flicker); keep the previous frame instead.
    if (alphaMax < 4) {
      petPerf.bump('frameRejected');
      return;
    }
    // Re-measure the silhouette box every ~4s of rendered frames: the
    // hit area must track where she actually IS, not where the warmup
    // frame put her — a stale box leaves dead spots on her body.
    charRectFrames = (charRectFrames || 0) + 1;
    if (!charRect || charRectFrames % 240 === 0) {
      charRect = measureCharRect() || charRect;
    }
    outCtx.putImageData(outImage, 0, 0);
    srFrame();
    painted = true;
    // The rAF loop composites; a second paint here would double the frame.
    requestFrame();
  } catch (error) {
    console.warn('pet: inference failed', error);
    // Opt-in only: lets the CDP measurement tell a working live pet from one
    // that is merely ticking without producing frames.
    petPerf.bump('inferenceError');
  } finally {
    if (results) {
      // An output can be referenced under multiple names. Release each
      // tensor exactly once, including failures before conversion completes.
      for (const output of new Set(Object.values(results))) {
        try { output?.dispose?.(); }
        catch (error) { console.warn('pet: output release failed', error); }
      }
    }
    inferBusy = false;
    // End-to-end frame production: run + readback + conversion + SR. Renamed
    // from the misleading `inference`, which also wrapped a presentation.
    if (petPerf.enabled) { petPerf.record('frameProduction', performance.now() - perfStart); }
  }
}

let canvasDensityQuery = null;
let stopCanvasDensity = null;
function resizeCanvas() {
  // Backing pixels follow display density; all geometry stays in CSS pixels.
  // Re-arm the query because a DPI-only display move need not resize the page.
  const density = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * density);
  canvas.height = Math.round(window.innerHeight * density);
  ctx2d.setTransform(density, 0, 0, density, 0, 0);
  stopCanvasDensity?.();
  canvasDensityQuery = window.matchMedia(`(resolution: ${density}dppx)`);
  stopCanvasDensity = petLifetime.listen(canvasDensityQuery, 'change', resizeCanvas);
  lastPaintRect = null;
  lastFeedRect = null;
  lastParticleRect = null;
  lastBubbleRect = null;
  lastPanelRect = null;
  ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
  requestFrame();
}

