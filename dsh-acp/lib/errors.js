/** Preserve protocol diagnostics in model-facing failures without exposing credentials. */
export function acpErrorMessage(error) {
  const message = error?.message || String(error);
  const details = typeof error?.data?.details === 'string' ? error.data.details : '';
  const text = details && !message.includes(details) ? `${message}: ${details}` : message;
  return redactSecrets(text);
}

/** Remove URL credentials, bearer/basic tokens, header secrets and common secret assignments from diagnostic text. */
export function redactSecrets(text) {
  return String(text)
    .replace(/((?:https?|socks[45]h?|rediss?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|amqps?):\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b((?:Bearer|Basic)\s+)[\w.+/=-]+/gi, '$1[redacted]')
    .replace(/(\b(?:x-api-key|set-cookie|cookie)["']?\s*[:=]\s*["']?)[^\r\n"';,)]+/gi, '$1[redacted]')
    .replace(/((?:access_token|refresh_token|id_token|auth_token|api_?key|api-key|password|passwd|client_secret|private_key|credential|secret|token)["']?\s*[:=]\s*["']?)[^\s"'&,)]+/gi, '$1[redacted]')
    .replace(/\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-proj-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[redacted]');
}

export function preparationError(error, stage, agent, availableModels) {
  if (error?.name === 'AbortError') return error;
  const detail = acpErrorMessage(error);
  const failure = new Error(`Agent "${agent.name}" preparation failed (${stage}): ${detail}${availableModels?.length ? ` Available model ids: ${availableModels.join(', ')}.` : ''} No subagent task was dispatched. Do not weaken runtime_mode to retry a model, authentication or network failure.`, { cause: error });
  failure.code = 'ACP_PREPARATION_FAILED';
  failure.stage = stage;
  if (availableModels) failure.availableModels = availableModels;
  return failure;
}
