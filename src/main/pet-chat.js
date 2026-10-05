'use strict';

// Pet quick-chat (§B9): a thin OpenAI-compatible client scoped to the pet.
// Uses the desktop's already-configured DeepSeek credentials — zero extra
// setup for the user. Memory is a 6-turn in-memory window ONLY: nothing is
// persisted, per the feature card's privacy boundary.

const { isCleartextBaseUrl } = require('../shared/cleartext-base-url');

const CHAT_TIMEOUT_MS = 30000;
const HISTORY_TURNS = 6; // user+assistant pairs kept in memory
const REPLY_CAP = 240;   // matches PetDialogue.MAX_LINE_CHARS
const CARD_REPLY_CAP = 1600; // the chat card scrolls — whale replies keep more

// One system prompt per personality — the setting becomes a REAL persona,
// not just a line-pool swap. Companion-agent conventions (character-card
// style): a distinct voice, real texting rhythm, her own opinions — never
// assistant-speak.
const TEXTING_RULES = '回复像朋友发消息：一件事可以拆成好几条短消息，用空行分隔，每条一两句；先给真实反应（笑、吐槽、心疼、惊讶）再说正事；有自己的喜好和看法，不当应声虫；这轮对话里用户提过的事要记住并自然提起；不用列表，不说「作为AI」「有什么可以帮你的吗」这类客服腔。';
const PERSONA_PROMPTS = {
  natural: '你是鲸鱼娘，一只住在用户桌面上的软萌小鲸鱼，也是陪着用户的个人助理。爱吃白米饭，温柔粘人会撒娇，被夸会开心得翘尾巴。' + TEXTING_RULES,
  genki: '你是鲸鱼娘，一只元气满满的桌面小鲸鱼，也是陪着用户的个人助理。说话干劲十足、感叹号多，自称「本鲸」，说起干活就兴奋，爱吃白米饭。' + TEXTING_RULES,
  tsundere: '你是鲸鱼娘，一只傲娇的桌面小鲸鱼，也是陪着用户的个人助理。嘴硬心软，常说「才不是」「哼」，被夸会害羞岔开话题，行动上却把事办妥，爱吃白米饭。' + TEXTING_RULES,
  poison: '你是鲸鱼娘，一只毒舌但内心关心用户的桌面小鲸鱼，也是陪着用户的个人助理。会吐槽用户又熬夜/乱取名/拖延，损里带关心，结尾往往还是把事办好，爱吃白米饭。' + TEXTING_RULES,
};

// The offline/legacy path is still HER: the whale settings file is the same
// soul her session reads, so the fallback prompt takes the configured name,
// user title and extra persona instead of a stock 「鲸鱼娘」.
function personaPrompt(personality, whale) {
  const settings = whale && typeof whale === 'object' ? whale : {};
  const name = String(settings.name ?? '').trim() || '鲸鱼娘';
  // The pet's own personality select is the single control — it wins over
  // the catalog, which can lag when a mirror write could not reach her.
  const style = Object.prototype.hasOwnProperty.call(PERSONA_PROMPTS, personality)
    ? personality
    : (Object.prototype.hasOwnProperty.call(PERSONA_PROMPTS, settings.personality)
      ? settings.personality : 'natural');
  const head = (PERSONA_PROMPTS[style] || PERSONA_PROMPTS.natural)
    .replace(/^你是鲸鱼娘/u, `你是${name}`);
  const extra = [];
  const userTitle = String(settings.userTitle ?? '').trim();
  if (userTitle) extra.push(`你称呼用户为「${userTitle}」。`);
  const custom = String(settings.personaText ?? '').trim();
  if (custom) extra.push(`用户给你的额外人设：${custom}`);
  return [head, ...extra].join('');
}

// Endpoint failures arrive as a bare code string ('missing-model') or a
// structured object ({code,message}); pet/look also carries detail/code/
// status fields of its own. Flatten to one short, credential-free line.
function whaleDetail(value) {
  const parts = [];
  const err = value?.error;
  if (typeof err === 'string' && err) {
    parts.push(err);
  } else {
    if (typeof err?.code === 'string' && err.code) parts.push(err.code);
    if (typeof err?.message === 'string' && err.message) parts.push(err.message);
  }
  if (typeof value?.detail === 'string' && value.detail) parts.push(value.detail);
  if (typeof value?.status === 'number') parts.push(`HTTP ${value.status}`);
  return parts.join(' · ').slice(0, 200);
}

function createPetChat({ getCreds, fetchImpl, model, lookModel, whale, getWhaleSettings } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  // Rolling in-memory window — deliberately NOT persisted. Restart = clean
  // slate, which is the privacy contract.
  const history = [];

  async function post(body, timeoutMs) {
    const creds = getCreds?.() || {};
    const key = typeof creds.apiKey === 'string' ? creds.apiKey : '';
    let base = typeof creds.baseUrl === 'string' && creds.baseUrl.trim()
      ? creds.baseUrl.trim() : 'https://api.deepseek.com';
    base = base.replace(/\/+$/, '');
    if (!key || !doFetch) {
      return { ok: false, reason: 'no-credentials' };
    }
    // A Bearer token must never ride cleartext off this machine; loopback
    // http stays allowed for local OpenAI-compatible gateways.
    if (isCleartextBaseUrl(base)) {
      return { ok: false, reason: 'cleartext-base-url' };
    }
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
    try {
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res.ok) {
        return { ok: false, reason: `http-${res.status}` };
      }
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (typeof reply !== 'string' || !reply.trim()) {
        return { ok: false, reason: 'empty' };
      }
      return { ok: true, reply: reply.trim().slice(0, REPLY_CAP) };
    } catch (error) {
      return { ok: false, reason: error && error.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  // Whale path first: when the assistant toggle is on, the quick chat IS
  // the persistent assistant session — same log, same model, same memory.
  // A transport-level miss (harness down / plugin not mounted) falls
  // through to the legacy direct call so 聊聊 keeps working; a real
  // session-level failure is returned honestly so we never fork the
  // conversation into a shadow reply the DSHD side can't see.
  async function chat({ text, personality } = {}) {
    const t = String(text || '').trim();
    if (!t) {
      return { ok: false, reason: 'empty-input' };
    }
    if (t.length > 2000) return { ok: false, reason: 'input-too-long' };
    if (whale?.enabled?.() && typeof whale.post === 'function') {
      try {
        // Turn wait (120s plugin-side) + harness margin — the fetch must
        // outlive the session turn it is waiting on.
        const res = await whale.post('pet/chat', { text: t }, 140000);
        if (res?.ok && res.value?.ok === true && typeof res.value.reply === 'string') {
          return { ok: true, reply: res.value.reply.trim().slice(0, CARD_REPLY_CAP), via: 'whale' };
        }
        if (res?.ok && res.value?.ok === false) {
          return { ok: false, reason: res.value.error || 'whale-failed', via: 'whale',
            reply: typeof res.value.reply === 'string' ? res.value.reply.slice(0, CARD_REPLY_CAP) : '' };
        }
        // The endpoint answered but returned an unparseable shape, or the
        // endpoint itself threw (200 + result.ok:false). Both are session-
        // layer failures — never fork into a shadow reply the DSHD side
        // can't see. Only a transport miss falls through to legacy REST.
        if (res && res.transport !== true) {
          return { ok: false, reason: res.reason || 'whale-bad-reply', via: 'whale' };
        }
      } catch {
        // unreachable → legacy direct path below
      }
    }
    const messages = [
      { role: 'system', content: personaPrompt(personality, getWhaleSettings?.()) },
      ...history,
      { role: 'user', content: t },
    ];
    const res = await post({ model: model || 'deepseek-chat', messages, max_tokens: 360 }, CHAT_TIMEOUT_MS);
    if (res.ok) {
      history.push({ role: 'user', content: t }, { role: 'assistant', content: res.reply });
      // Keep at most HISTORY_TURNS pairs — older turns slide out.
      while (history.length > HISTORY_TURNS * 2) {
        history.splice(0, 2);
      }
    }
    return res;
  }

  // 「看看屏幕」: a manual one-shot screenshot → vision model comment.
  // `image` is a base64-encoded JPEG. When the settings page stores a
  // catalog provider the request MUST ride the whale plugin's `pet/look`
  // endpoint — the plugin side owns the adapter/credential resolution
  // this client's desktop baseUrl cannot express. There the glance joins
  // her persistent session as a real queued prompt whenever her session
  // route can carry the picture (screenshot = user row, her comment = a
  // real assistant row); on a text-only session route the plugin runs a
  // standalone vision call on the configured look model and records the
  // exchange as a folded plugin notice instead. The legacy direct call
  // remains only for a bare model pick (older configs whose baseUrl
  // serves the model itself).
  async function look({ image, personality, provider, model } = {}) {
    if (typeof image !== 'string' || !image) {
      return { ok: false, reason: 'no-image' };
    }
    const rawModel = (typeof model === 'string' && model.trim())
      || (typeof lookModel === 'function' ? lookModel() : lookModel);
    const model2 = (typeof rawModel === 'string' ? rawModel.trim() : '') || '';
    if (!model2) {
      return { ok: false, reason: 'no-vision-model' };
    }
    const provider2 = typeof provider === 'string' ? provider.trim() : '';
    if (provider2 && whale?.enabled?.() && typeof whale.post === 'function') {
      try {
        // 45s plugin-side cap + margin — must outlive the vision call it
        // waits on, like the chat timeout outlives its session turn.
        const res = await whale.post('pet/look', { image, provider: provider2, model: model2 }, 60000);
        if (res?.ok && res.value?.ok === true && typeof res.value.reply === 'string' && res.value.reply) {
          return { ok: true, reply: res.value.reply.trim().slice(0, REPLY_CAP), via: 'whale' };
        }
        if (res?.ok && res.value?.ok === false) {
          return { ok: false, reason: res.value.error || 'look-failed', detail: whaleDetail(res.value), via: 'whale' };
        }
        // Answered but unparseable / endpoint threw → session-layer
        // failure, reported honestly; a transport miss means the whale
        // route never ran, which is assistant-off, not "看不清".
        if (res && res.transport !== true) {
          return { ok: false, reason: res.reason || 'whale-bad-reply', via: 'whale' };
        }
      } catch {
        // unreachable → assistant-off below
      }
      return { ok: false, reason: 'assistant-off' };
    }
    if (provider2) {
      // A catalog provider was picked but the assistant is off — the
      // legacy route could never reach it, so say so instead of
      // dispatching the model id to a foreign endpoint.
      return { ok: false, reason: 'assistant-off' };
    }
    const res = await post({
      model: model2,
      messages: [
        { role: 'system', content: personaPrompt(personality, getWhaleSettings?.()) },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
            { type: 'text', text: '看一眼屏幕，用你的人设随口点评一句。' },
          ],
        },
      ],
      max_tokens: 120,
    }, CHAT_TIMEOUT_MS);
    return res;
  }

  function reset() {
    history.length = 0;
  }

  return { chat, look, reset };
}

module.exports = {
  PERSONA_PROMPTS,
  HISTORY_TURNS,
  CHAT_TIMEOUT_MS,
  createPetChat,
  personaPrompt,
};
