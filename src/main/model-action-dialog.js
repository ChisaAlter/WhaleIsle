'use strict';

/**
 * Confirmation-dialog composition for model-initiated requests (#515 F4).
 *
 * The dialog carries a fixed server-attribution block — the requesting tool
 * identifier the control endpoint consumed plus the level the effects
 * registry resolved — painted into the fixed title/context slots, so
 * caller-supplied summary/details can never restyle themselves as the trust
 * verdict. Caller text lives only in the scrollable request-content region
 * below the fixed "request content" caption.
 */

const { NEVER_ALWAYS_LEVELS } = require('../shared/model-tool-effects');

/** Registry level -> the dialog headline copy key. */
/** @type {Record<string, string>} */
const EFFECT_TITLE_KEY = {
  destructive: 'confirmTitleDestructive',
  external: 'confirmTitleExternal',
  code: 'confirmTitleCode',
  local: 'confirmTitleLocal',
};

/** Registry level -> the level-name copy key shown in the attribution line. */
/** @type {Record<string, string>} */
const EFFECT_LEVEL_KEY = {
  read: 'confirmLevelRead',
  local: 'confirmLevelLocal',
  destructive: 'confirmLevelDestructive',
  external: 'confirmLevelExternal',
  code: 'confirmLevelCode',
  'harness-governed': 'confirmLevelHarnessGoverned',
};

/** @param {unknown} template @param {string} name @param {string} value */
function fill(template, name, value) {
  return String(template || '').split(`{${name}}`).join(value);
}

/** @param {Record<string, string>} messages @param {string} effect */
function effectTitle(messages, effect) {
  return messages[EFFECT_TITLE_KEY[effect]] || messages.confirmTitleUnknown;
}

/** @param {Record<string, string>} messages @param {string} effect */
function effectLevelName(messages, effect) {
  return messages[EFFECT_LEVEL_KEY[effect]] || messages.confirmLevelUnknown;
}

/** @param {string} effect @returns {'danger' | 'warning' | 'neutral'} */
function effectTone(effect) {
  if (effect === 'destructive') return 'danger';
  if (effect === 'code' || effect === 'external') return 'warning';
  return 'neutral';
}

/**
 * The fixed attribution line: `Request from {source}` plus a server-owned
 * second fragment (assessed level for confirms, category for secrets).
 * Caller text never enters this line — both fragments are built from the
 * structured request envelope and the localized dictionary only.
 * @param {Record<string, string>} messages @param {string} source @param {string} assessed
 */
function attributionContext(messages, source, assessed) {
  const from = fill(messages.confirmRequestFrom, 'source', source);
  return assessed ? `${from} · ${assessed}` : from;
}

/**
 * Options for the model-action confirmation (`POST /desktop/confirm`).
 * @param {{ tool?: unknown, action?: unknown, effect?: unknown, summary?: unknown, details?: unknown }} request
 * @param {Record<string, string>} messages - desktop-locale dictionary
 * @param {string} [locale] - resolved dictionary id for the renderer's lang
 */
function modelActionConfirmOptions(request, messages, locale) {
  const tool = String(request?.tool || '').slice(0, 200);
  const action = String(request?.action || '').slice(0, 200);
  const summary = String(request?.summary || '').slice(0, 500);
  const details = String(request?.details || '').slice(0, 6000);
  const effect = String(request?.effect || '');
  const offerAlways = !NEVER_ALWAYS_LEVELS.has(effect);
  const title = effectTitle(messages, effect);
  const level = fill(messages.confirmAssessedLevel, 'level', effectLevelName(messages, effect));
  const sourceLabel = fill(
    messages.confirmRequestFrom,
    'source',
    action ? `${tool} / ${action}` : (tool || messages.confirmSourceAssistant),
  );
  const tone = effectTone(effect);
  const resolvedSummary = summary || messages.confirmFallbackSummary;
  return {
    type: 'warning',
    tone,
    buttons: offerAlways
      ? [messages.confirmDeny, messages.confirmAllowOnce, messages.confirmAllowAlways]
      : [messages.confirmDeny, messages.confirmAllowOnce],
    defaultId: 0,
    cancelId: 0,
    dangerIds: offerAlways ? [1, 2] : [1],
    title,
    message: title,
    locale,
    context: attributionContext(messages, action ? `${tool} / ${action}` : (tool || messages.confirmSourceAssistant), level),
    attribution: { source: sourceLabel, level, tone },
    requestSection: {
      caption: messages.confirmRequestContent,
      summary: resolvedSummary,
      details,
    },
    detail: [
      messages.confirmRequestContent,
      resolvedSummary,
      details || null,
    ].filter(Boolean).join('\n\n'),
    noLink: true,
  };
}

/**
 * Options for the secret display (`POST /desktop/show-secret`). The endpoint
 * passes whatever tool identifier the caller declared; absent one the source
 * falls back to the generic assistant label — the token-gated loopback
 * channel only accepts host-resident callers either way.
 * @param {{ tool?: unknown, title?: unknown, label?: unknown, secret?: unknown, hint?: unknown }} request
 * @param {Record<string, string>} messages - desktop-locale dictionary
 * @param {string} [locale]
 */
function secretDialogOptions(request, messages, locale) {
  const secret = String(request?.secret || '');
  const tool = String(request?.tool || '').slice(0, 200);
  const callerText = [
    String(request?.title || '').slice(0, 80),
    String(request?.label || '').slice(0, 200) || messages.confirmSecretDefaultLabel,
  ].filter(Boolean).join('\n');
  const hint = String(request?.hint || '').slice(0, 500);
  const sourceLabel = fill(messages.confirmRequestFrom, 'source', tool || messages.confirmSourceAssistant);
  return {
    type: 'info',
    tone: 'info',
    buttons: [messages.confirmSecretCopy, messages.confirmSecretClose],
    defaultId: 1,
    cancelId: 1,
    title: messages.confirmSecretTitle,
    message: messages.confirmSecretTitle,
    locale,
    context: attributionContext(messages, tool || messages.confirmSourceAssistant, messages.confirmSecretCategory),
    attribution: { source: sourceLabel, level: messages.confirmSecretCategory, tone: 'info' },
    requestSection: {
      caption: messages.confirmRequestContent,
      summary: callerText,
      details: secret,
      hint,
      isSecret: true,
    },
    detail: [
      messages.confirmRequestContent,
      callerText || null,
      secret,
      hint || null,
    ].filter(Boolean).join('\n\n'),
    noLink: true,
  };
}

/**
 * The native messagebox has no context slot: fold the fixed attribution line
 * ahead of the detail text so the fallback never drops the server-owned
 * provenance (or the update dialog's version context).
 * @param {{ context?: unknown, detail?: unknown }} options
 * @returns {string}
 */
function detailWithContext(options) {
  return [options?.context, options?.detail].filter(Boolean).join('\n\n');
}

module.exports = {
  modelActionConfirmOptions,
  secretDialogOptions,
  detailWithContext,
};
