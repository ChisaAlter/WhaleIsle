export const NS = 'dsh-acp-agents';
export const SETTINGS_SECTION_ID = 'acp-agents';
export const ACP_PREFIX = 'acp:';

// Registry ids already covered by a first-class preset option in the
// "add instance" type picker — they must not be listed twice.
export const BUILTIN_REGISTRY_IDS = new Set(['claude-acp', 'codex-acp', 'antigravity-acp', 'devin']);

// ACP runtime "Add provider" card grid: first-class presets get the official ACP
// registry brand icons (same CDN the registry list uses).
const ACP_REGISTRY_ICON_BASE = 'https://cdn.agentclientprotocol.com/registry/v1/latest';
export const ADD_PROVIDER_CARDS = [
  { id: 'claude-code', label: 'Claude Code', icon: `${ACP_REGISTRY_ICON_BASE}/claude-acp.svg` },
  { id: 'codex', label: 'OpenAI Codex', icon: `${ACP_REGISTRY_ICON_BASE}/codex-acp.svg` },
  { id: 'antigravity', label: 'Google Antigravity', icon: `${ACP_REGISTRY_ICON_BASE}/antigravity-acp.svg` },
  { id: 'devin', label: 'Cognition Devin', icon: `${ACP_REGISTRY_ICON_BASE}/devin.svg` },
];

// Vendored ACP runtime auth flows report English terminal messages verbatim —
// remap the known ones through the dictionary so zh never leaks EN copy.
export const FLOW_MESSAGE_KEYS = {
  'Sign-in failed. Start again.': 'login.flowFailed',
  'Sign-in expired. Start again.': 'login.flowExpired',
};

export const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 };

export function rpcValue(response, fallbackMessage = 'RPC error') {
  if (response && typeof response === 'object' && 'ok' in response) {
    if (response.ok) return response.value;
    const msg = response.error?.message || response.error?.code || fallbackMessage;
    throw new Error(msg);
  }
  return response;
}

export function sanitizeAgentId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function deriveUniqueAgentId(raw, existingIds, fallbackPrefix = 'custom') {
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const cleanPrefix = sanitizeAgentId(fallbackPrefix) || 'custom';
  const base = sanitizeAgentId(raw) || `${cleanPrefix}-${Date.now()}`.slice(0, 48);
  if (!existing.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, Math.max(1, 48 - suffixText.length)).replace(/-+$/, '') || cleanPrefix}${suffixText}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export function safeHttpsIconUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  if (typeof URL === 'function') {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  }
  return /^https:\/\/[^\s"'<>\\]+$/i.test(value) ? value : null;
}

export async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (!value) throw new Error('Nothing to copy');
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to execCommand fallback for non-secure or restricted contexts.
    }
  }
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    throw new Error('Clipboard API is unavailable');
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  const previouslyFocused = document.activeElement;
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange?.(0, value.length);
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('Clipboard copy failed');
    return true;
  } finally {
    textarea.remove ? textarea.remove() : textarea.parentNode?.removeChild?.(textarea);
    if (typeof previouslyFocused?.focus === 'function') {
      previouslyFocused.focus();
    }
  }
}

export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

export function maskEmail(email) {
  const clean = String(email || '').trim();
  const at = clean.indexOf('@');
  if (at <= 1) return clean;
  const local = clean.slice(0, at);
  const domain = clean.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***${domain}`;
}

export function unwrapSwitchChecked(val, fallback) {
  if (typeof val === 'boolean') return val;
  if (typeof val?.target?.checked === 'boolean') return val.target.checked;
  return fallback;
}

// Shell-style args round-trip: split on whitespace but keep quoted
// segments whole (single/double quotes, backslash escape inside double
// quotes); join quotes back any arg containing whitespace or quotes so a
// saved list re-renders to the same values.
export function splitArgsText(text) {
  const out = [];
  let cur = '';
  let quote = null;
  let hasToken = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < src.length) {
        i += 1;
        cur += src[i];
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken || cur !== '') {
        out.push(cur);
        cur = '';
        hasToken = false;
      }
    } else {
      cur += ch;
    }
  }
  if (hasToken || cur !== '') out.push(cur);
  return out;
}

export function joinArgsText(args) {
  return (Array.isArray(args) ? args : [])
    .map((arg) => {
      const s = String(arg ?? '');
      if (s === '') return '""';
      return /[\s"'\\]/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
    })
    .join(' ');
}

export function acpModelReasoning(model, configuredModel = model) {
  if (model.reasoning !== undefined) return model.reasoning;
  // A preset's defaultEffort is not an advertised ACP capability. Models
  // such as Antigravity's High/Low variants encode effort in the model id.
  const efforts = model.efforts ?? configuredModel?.efforts;
  if (!efforts?.length) return undefined;
  const preferred = model.defaultEffort ?? configuredModel?.defaultEffort;
  return {
    defaultEffort: efforts.some((effort) => effort.id === preferred) ? preferred : efforts[0].id,
    efforts,
  };
}

export function railTabLabel(tab) {
  if (tab.id === 'builtin') return 'DSH';
  const ascii = String(tab.label || '').replace(/[^A-Za-z0-9]/g, '');
  if (ascii) return ascii.slice(0, 2).toUpperCase();
  return String(tab.label || 'AI').slice(0, 2).toUpperCase();
}

export function editableModelOptions(model) {
  return (model?.options || []).filter(
    (option) =>
      ['boolean', 'select'].includes(option.type)
      && option.id !== 'model'
      && option.category !== 'model'
      && option.role !== 'reasoning'
      && !['thought_level', 'reasoning_effort'].includes(option.category)
      && !/effort|thought|thinking|mode|permission|approval|sandbox/i.test(
        `${option.id} ${option.category || ''}`,
      ),
  );
}
