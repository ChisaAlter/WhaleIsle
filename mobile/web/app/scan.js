// app/scan.js — split from app.js (#442).
import { detectScanSupport, scanUnavailableHint, classifyScan } from '../pair/scan.js';
import { buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { runScanAction } from '../pair/native-scan.js';
import { operationError, showError } from './chrome.js?v=20261117-app-split';
import { connect } from './connect.js?v=20261117-app-split';
import { el, nativeAndroidApp, origin, scanOpen, scanTip, scanTorch, scanUnavailable, scanVideo, state } from './context.js?v=20261117-app-split';
import { renderScreen } from './screens.js?v=20261117-app-split';

let scanStream = null;

let scanLoopId = 0;

let lastInvalidScan = '';

let torchOn = false;

// —— 扫码（M2）—— //

export async function initScanButton() {
  if (nativeAndroidApp) {
    state.scanSupport = { supported: true, native: true };
    scanOpen.classList.remove('hidden');
    scanUnavailable.classList.add('hidden');
    scanUnavailable.textContent = '';
    return;
  }
  state.scanSupport = await detectScanSupport({
    isSecureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices,
    BarcodeDetector: window.BarcodeDetector,
  });
  scanOpen.classList.toggle('hidden', !state.scanSupport.supported);
  const hint = scanUnavailableHint(state.scanSupport.reason);
  scanUnavailable.textContent = hint;
  scanUnavailable.classList.toggle('hidden', !hint);
}

function stopScan() {
  scanLoopId += 1;
  for (const track of scanStream?.getTracks?.() || []) {
    track.stop();
  }
  scanStream = null;
  scanVideo.srcObject = null;
  torchOn = false;
  scanTorch.classList.remove('is-on');
}

export function closeScan() {
  stopScan();
  state.route = 'connect';
  renderScreen();
}

function handleScanHit(raw) {
  const outcome = classifyScan(raw, origin);
  if (outcome.kind === 'invalid') {
    if (raw !== lastInvalidScan) {
      lastInvalidScan = raw;
      operationError('二维码里没有配对密钥，请扫桌面远程弹窗里的二维码');
    }
    return false;
  }
  stopScan();
  if (outcome.kind === 'navigate') {
    window.location.replace(outcome.url);
    return true;
  }
  state.route = 'connect';
  renderScreen();
  connect(outcome.offerUrl).catch((error) => {
    showError(error.message || '连接失败');
  });
  return true;
}

async function startScan() {
  if (!state.scanSupport.supported) return;
  state.route = 'scan';
  lastInvalidScan = '';
  scanTip.textContent = '将二维码完整放入取景框';
  scanTorch.classList.add('hidden');
  renderScreen();
  let detector;
  try {
    detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (error) {
    stopScan();
    if (error?.name === 'NotAllowedError') {
      state.route = 'permission';
    } else {
      state.route = 'connect';
      showError(error?.message || '无法打开相机');
    }
    renderScreen();
    return;
  }
  scanVideo.srcObject = scanStream;
  try {
    await scanVideo.play();
  } catch { /* autoplay policy — video attr covers it */ }
  const track = scanStream.getVideoTracks()[0];
  if (track?.getCapabilities?.().torch) {
    scanTorch.classList.remove('hidden');
    scanTorch.textContent = '手电筒';
  }
  const loop = scanLoopId += 1;
  let lastDetect = 0;
  const step = async (now) => {
    if (loop !== scanLoopId) return;
    if (now - lastDetect >= 200 && scanVideo.readyState >= 2) {
      lastDetect = now;
      try {
        const codes = await detector.detect(scanVideo);
        if (loop !== scanLoopId) return;
        const raw = codes.find((code) => code.rawValue)?.rawValue;
        if (raw && handleScanHit(raw)) return;
      } catch { /* 单帧解码失败继续扫 */ }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function toggleTorch() {
  const track = scanStream?.getVideoTracks?.()[0];
  if (!track) return;
  if (scanTorch.disabled) return;
  scanTorch.disabled = true;
  buttonBusy(scanTorch, true, { label: '切换中…' });
  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    scanTorch.classList.toggle('is-on', torchOn);
  } catch {
    torchOn = false;
    scanTorch.classList.remove('is-on');
    scanTorch.classList.add('hidden');
  } finally {
    scanTorch.disabled = false;
    buttonBusy(scanTorch, false);
    scanTorch.textContent = torchOn ? '关闭手电' : '手电筒';
  }
}

// —— 事件接线 —— //

scanOpen.addEventListener('click', () => {
  runScanAction({
    userAgent: navigator.userAgent,
    navigate: (url) => window.location.assign(url),
    startBrowserScan: startScan,
  });
});

el('scan-cancel').addEventListener('click', () => closeScan());

scanTorch.addEventListener('click', () => toggleTorch());
