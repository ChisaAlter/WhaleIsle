function encodedCommandImages(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  return images.map((image) => ({
    mediaType: image.mediaType,
    data: image.data,
  }));
}

function commandListPayload(sessionId) {
  return { args: { agentId: sessionId } };
}

function commandExecutePayload(sessionId, line, images = []) {
  return {
    args: {
      agentId: sessionId,
      line,
      images: encodedCommandImages(images),
    },
  };
}

function mapHostSlashList(value) {
  return (Array.isArray(value) ? value : []).map((command) => ({
    name: command.name,
    argumentHint: command.input?.hint || '',
    description: command.description || '',
  }));
}

function isSlashSubmitLine(text) {
  return typeof text === 'string' && text.trim().startsWith('/');
}

function admitCommandResult(value, line) {
  if (!value || typeof value !== 'object' || typeof value.commandId !== 'string' || !value.commandId) {
    throw new Error(`未知命令：${line}`);
  }
  if (value.result && value.result.kind === 'error') {
    throw new Error(value.result.text || '命令失败');
  }
  return value;
}

export {
  admitCommandResult,
  commandExecutePayload,
  commandListPayload,
  isSlashSubmitLine,
  mapHostSlashList,
};
