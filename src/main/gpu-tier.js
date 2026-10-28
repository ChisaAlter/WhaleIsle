'use strict';

// Rendering effects are tuned on discrete GPUs. On integrated or software
// rendering, the animated full-window backdrop alone could saturate the GPU and
// make every window on the desktop drag in steps, so such machines start with
// those effects off. Only defaults change; a user's own choice always wins.

const VENDOR = {
  intel: 0x8086,
  amd: 0x1002,
  microsoft: 0x1414,
  qualcomm: 0x5143,
};

/** Discrete Intel Arc cards carry an A/B model number; integrated Arc does not. */
const INTEL_DISCRETE = /\bArc\b.*\b[AB]\d{3}\b/i;
/** AMD discrete product lines; APU graphics read "Radeon(TM) Graphics", "Radeon 780M Graphics", "Vega 8". */
const AMD_DISCRETE = /\bRX\b|Radeon\s+Pro|FirePro|Instinct|\bW\d{4}\b/i;

/**
 * Classify the GPU Chromium actually renders with (hybrid laptops usually
 * keep the integrated one active for Electron).
 * @param {{ gpuDevice?: Array<object> }} info - `app.getGPUInfo('complete')`.
 * @param {Record<string, string>} [featureStatus] - `app.getGPUFeatureStatus()`.
 * @returns {{ lowPower: boolean, reason: string, device: string }}
 */
function classifyGpu(info, featureStatus = {}) {
  const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
  const device = devices.find((entry) => entry?.active) || devices[0];
  const name = String(device?.deviceString || '');
  const result = (lowPower, reason) => ({ lowPower, reason, device: name });
  if (/^(disabled|unavailable)/.test(String(featureStatus.gpu_compositing || ''))) {
    return result(true, 'software-compositing');
  }
  if (!device) return result(false, 'unknown');
  switch (device.vendorId) {
    case VENDOR.microsoft:
      return result(true, 'software-renderer');
    case VENDOR.qualcomm:
      return result(true, 'integrated');
    case VENDOR.intel:
      return INTEL_DISCRETE.test(name) ? result(false, 'discrete') : result(true, 'integrated');
    case VENDOR.amd:
      if (!name) return result(false, 'unknown');
      return AMD_DISCRETE.test(name) ? result(false, 'discrete') : result(true, 'integrated');
    default:
      return result(false, 'discrete');
  }
}

/** Resolve after `ready`; never rejects (unknown hardware keeps full effects). */
async function detectGpuTier(app) {
  try {
    const info = await app.getGPUInfo('complete');
    return classifyGpu(info, app.getGPUFeatureStatus?.() || {});
  } catch (error) {
    return { lowPower: false, reason: `error: ${error?.message || error}`, device: '' };
  }
}

module.exports = { classifyGpu, detectGpuTier };
