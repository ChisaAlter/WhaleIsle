'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyGpu, detectGpuTier } = require('./gpu-tier');

const active = (vendorId, deviceString) => ({ gpuDevice: [{ active: true, vendorId, deviceString }] });

test('integrated and software renderers are low power; discrete ones are not', () => {
  const cases = [
    [0x8086, 'Intel(R) UHD Graphics 620', true],
    [0x8086, 'Intel(R) Iris(R) Xe Graphics', true],
    [0x8086, 'Intel(R) Arc(TM) Graphics', true],
    [0x8086, 'Intel(R) Arc(TM) 140V GPU (16GB)', true],
    [0x8086, 'Intel(R) Arc(TM) A770 Graphics', false],
    [0x8086, 'Intel(R) Arc(TM) B580 Graphics', false],
    [0x1002, 'AMD Radeon(TM) Graphics', true],
    [0x1002, 'AMD Radeon 780M Graphics', true],
    [0x1002, 'AMD Radeon(TM) Vega 8 Graphics', true],
    [0x1002, 'AMD Radeon RX 6600', false],
    [0x1002, 'AMD Radeon Pro W6800', false],
    [0x10de, 'NVIDIA GeForce RTX 3060 Laptop GPU', false],
    [0x106b, 'Apple M2', false],
    [0x1414, 'Microsoft Basic Render Driver', true],
    [0x5143, 'Qualcomm(R) Adreno(TM) X1-85 GPU', true],
  ];
  for (const [vendorId, name, lowPower] of cases) {
    assert.equal(classifyGpu(active(vendorId, name)).lowPower, lowPower, name);
  }
});

test('the active device decides on a hybrid machine', () => {
  const hybrid = { gpuDevice: [
    { active: false, vendorId: 0x10de, deviceString: 'NVIDIA GeForce RTX 4060 Laptop GPU' },
    { active: true, vendorId: 0x8086, deviceString: 'Intel(R) UHD Graphics' },
  ] };
  assert.deepEqual(classifyGpu(hybrid), { lowPower: true, reason: 'integrated', device: 'Intel(R) UHD Graphics' });
});

test('software compositing is low power whatever the device says', () => {
  const result = classifyGpu(active(0x10de, 'NVIDIA GeForce RTX 4090'), { gpu_compositing: 'disabled_software' });
  assert.equal(result.lowPower, true);
  assert.equal(result.reason, 'software-compositing');
});

test('unknown hardware keeps the full effects', () => {
  assert.equal(classifyGpu({}).lowPower, false);
  assert.equal(classifyGpu(active(0x1002, '')).lowPower, false);
});

test('detection never rejects', async () => {
  const failing = { getGPUInfo: async () => { throw new Error('gpu process gone'); } };
  assert.equal((await detectGpuTier(failing)).lowPower, false);
  const intel = { getGPUInfo: async () => active(0x8086, 'Intel(R) UHD Graphics 630'), getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled' }) };
  assert.equal((await detectGpuTier(intel)).lowPower, true);
});
