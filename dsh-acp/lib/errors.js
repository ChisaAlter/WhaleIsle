/** Preserve protocol diagnostics in model-facing failures without exposing credentials. */
export function acpErrorMessage(error) {
  const message = error?.message || String(error);
  const details = typeof error?.data?.details === 'string' ? error.data.details : '';
  const text = details && !message.includes(details) ? `${message}: ${details}` : message;
  return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(Bearer\s+)[\w.+/=-]+/gi, '$1[redacted]')
    .replace(/((?:access_token|refresh_token|api_key|password|client_secret)["']?\s*[:=]\s*["']?)[^\s"'&,)]+/gi, '$1[redacted]');
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
