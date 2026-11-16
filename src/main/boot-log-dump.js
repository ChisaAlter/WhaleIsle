'use strict';

const path = require('path');

function dash(value) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return String(value);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function bootLogFilename(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    '-',
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('');
  return `dshd-boot-${stamp}.log`;
}

function formatBootLogDump({ version, savedAt, snapshot = {}, logs = [] } = {}) {
  const failure = snapshot.failure || {};
  const lines = [
    `Whale Isle ${dash(version).replace(/^-$/, '')}`.trimEnd(),
    `savedAt: ${dash(savedAt)}`,
    `state: ${dash(snapshot.state)}`,
    `error: ${dash(snapshot.error)}`,
    `failure.phase: ${dash(failure.phase)}`,
    `failure.message: ${dash(failure.message)}`,
    `failure.code: ${dash(failure.code)}`,
    `failure.signal: ${dash(failure.signal)}`,
    `failure.occurredAt: ${dash(failure.occurredAt)}`,
  ];
  const recovery = snapshot.recovery;
  if (recovery && typeof recovery === 'object') {
    if (recovery.status !== undefined) {
      lines.push(`recovery.status: ${dash(recovery.status)}`);
    }
    if (recovery.attempt !== undefined) {
      lines.push(`recovery.attempt: ${dash(recovery.attempt)}`);
    }
    if (recovery.maxAttempts !== undefined) {
      lines.push(`recovery.maxAttempts: ${dash(recovery.maxAttempts)}`);
    }
  }
  const pluginRecovery = snapshot.pluginRecovery;
  if (pluginRecovery && typeof pluginRecovery === 'object' && pluginRecovery.skipUserPlugins !== undefined) {
    lines.push(`pluginRecovery.skipUserPlugins: ${dash(pluginRecovery.skipUserPlugins)}`);
  }
  lines.push('', '--- logs ---');
  const logLines = Array.isArray(logs) ? logs.map((line) => String(line ?? '')) : [];
  return `${[...lines, ...logLines].join('\n')}\n`;
}

async function saveBootLog({
  dialog,
  browserWindow,
  dump,
  writeFile,
  defaultDirectory,
  now,
} = {}) {
  const defaultPath = path.join(String(defaultDirectory || ''), bootLogFilename(now));
  const result = await dialog.showSaveDialog(browserWindow || undefined, {
    title: '保存错误日志',
    defaultPath,
    filters: [
      { name: 'Log', extensions: ['log', 'txt'] },
    ],
  });
  if (result?.canceled || !result?.filePath) {
    return { ok: true, canceled: true };
  }
  try {
    await writeFile(result.filePath, dump, 'utf8');
    return { ok: true, canceled: false, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

module.exports = {
  formatBootLogDump,
  saveBootLog,
};
