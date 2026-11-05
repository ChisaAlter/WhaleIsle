function textFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return '';
    if (typeof block.text === 'string') return block.text;
    return '';
  }).join('');
}

// 镜像 Android NativeHistory images：user/message 里的 image block 折叠成气泡图片。
// 历史记录里的图片可能只带 attachment 引用，由界面按需读取 `session.attachment`。
function imagesFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  const images = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || block.type !== 'image') continue;
    const attachment = block.attachment && typeof block.attachment === 'object' ? block.attachment : null;
    const attachmentId = typeof attachment?.attachmentId === 'string' ? attachment.attachmentId : '';
    const mediaType = typeof attachment?.mediaType === 'string' && attachment.mediaType ? attachment.mediaType : block.mediaType;
    const data = typeof block.data === 'string' ? block.data : '';
    if (typeof mediaType !== 'string' || (!data && !attachmentId)) continue;
    images.push(attachmentId ? { mediaType, data, attachmentId } : { mediaType, data });
  }
  return images;
}

/**
 * Classify one `assistant/chunk` payload. The dsh wire streams per-block
 * deltas (`block-start` / `text-delta` / `reasoning-delta` / tool-call deltas);
 * older fixtures send `{ chunk: { type: 'text', text } }` or a bare string.
 * @returns {{ kind: 'text' | 'reasoning' | 'start' | 'other', index: number, text: string, blockType?: string }}
 */
function classifyChunk(data) {
  const chunk = data?.chunk;
  if (typeof chunk === 'string') return { kind: 'text', index: 0, text: chunk };
  if (!chunk || typeof chunk !== 'object') {
    return typeof data?.text === 'string'
      ? { kind: 'text', index: 0, text: data.text }
      : { kind: 'other', index: 0, text: '' };
  }
  const index = Number.isInteger(chunk.index) ? chunk.index : 0;
  if (chunk.type === 'block-start') {
    return { kind: 'start', index, text: '', blockType: String(chunk.blockType || 'text') };
  }
  if (chunk.type === 'reasoning-delta' || chunk.type === 'reasoning') {
    return { kind: 'reasoning', index, text: typeof chunk.text === 'string' ? chunk.text : '' };
  }
  if (chunk.type === 'text-delta' || chunk.type === 'text' || (chunk.type === undefined && typeof chunk.text === 'string')) {
    return { kind: 'text', index, text: typeof chunk.text === 'string' ? chunk.text : '' };
  }
  return { kind: 'other', index, text: '' };
}

const TOOL_STATUS_LABELS = {
  running: '运行中',
  completed: '完成',
  failed: '失败',
  canceled: '已取消',
};

// 每类 tool detail 折出一行摘要 + 可展开正文；未知形状保底显示类型名。
function toolDetailView(detail) {
  if (!detail || typeof detail !== 'object') return null;
  if (detail.type === 'shell') {
    return {
      summary: detail.command || '',
      body: typeof detail.output === 'string' ? detail.output : '',
      bodyKind: 'code',
    };
  }
  if (detail.type === 'read' || detail.type === 'write') {
    return {
      summary: detail.filePath || '',
      body: typeof detail.content === 'string' ? detail.content : '',
      bodyKind: 'code',
    };
  }
  if (detail.type === 'edit') {
    return {
      summary: detail.filePath || '',
      body: typeof detail.unifiedDiff === 'string' ? detail.unifiedDiff : '',
      bodyKind: 'code',
    };
  }
  if (detail.type === 'search') {
    const counts = [];
    if (Number.isInteger(detail.numMatches)) counts.push(`${detail.numMatches} 处匹配`);
    if (Number.isInteger(detail.numFiles)) counts.push(`${detail.numFiles} 个文件`);
    return {
      summary: [detail.query, counts.join(' · ')].filter(Boolean).join(' — '),
      body: typeof detail.content === 'string'
        ? detail.content
        : (detail.filePaths || []).join('\n'),
      bodyKind: 'code',
    };
  }
  if (detail.type === 'fetch') {
    return {
      summary: detail.url || '',
      body: typeof detail.result === 'string' ? detail.result : '',
      bodyKind: 'text',
    };
  }
  if (detail.type === 'sub_agent') {
    return {
      summary: detail.description || detail.subAgentType || '子智能体任务',
      body: typeof detail.log === 'string' ? detail.log : '',
      bodyKind: 'text',
      childSessionId: typeof detail.childSessionId === 'string' ? detail.childSessionId : '',
    };
  }
  if (detail.type === 'plan') {
    return { summary: '', body: detail.text || '', bodyKind: 'markdown' };
  }
  if (detail.type === 'plain_text') {
    return { summary: detail.label || '', body: detail.text || '', bodyKind: 'text' };
  }
  if (detail.type === 'worktree_setup') {
    return {
      summary: [detail.branchName, detail.worktreePath].filter(Boolean).join(' · ') || '工作树准备',
      body: typeof detail.log === 'string' ? detail.log : '',
      bodyKind: 'code',
    };
  }
  // unknown detail: keep whatever is stringable visible.
  const body = detail.output ?? detail.input ?? null;
  return {
    summary: typeof detail.type === 'string' ? detail.type : '',
    body: typeof body === 'string' ? body : (body == null ? '' : JSON.stringify(body, null, 2)),
    bodyKind: 'code',
  };
}

const WHALE_UI_LANGUAGES = new Set(['whale-ui', 'openui', 'openui-lang', 'dsh-ui']);
const WHALE_UI_TITLE_RE = /Title\(\s*"([^"]+)"/;

function normalizeWhaleUiLanguage(lang, isSpec = false) {
  if (typeof lang === 'string') {
    const cleaned = lang.trim().toLowerCase().replace(/[>`"'.,;:)\]\u3011\u300d\u300f]+$/, '');
    if (WHALE_UI_LANGUAGES.has(cleaned)) return cleaned;
  }
  return isSpec ? 'dsh-ui' : 'whale-ui';
}

function deriveWhaleUiTitle(program) {
  if (typeof program !== 'string' || !program) return '';
  const match = WHALE_UI_TITLE_RE.exec(program);
  return match ? match[1].trim() : '';
}

/**
 * Decode a complete or truncated JSON string field from a raw/streaming JSON object string.
 * @param {string} raw
 * @param {string} key
 * @returns {string|null}
 */
function extractPartialJsonString(raw, key) {
  if (typeof raw !== 'string' || !raw) return null;
  const pattern = new RegExp(`"${key}"\\s*:\\s*"`);
  const match = pattern.exec(raw);
  if (!match) return null;
  let out = '';
  let index = match.index + match[0].length;
  while (index < raw.length) {
    const ch = raw[index];
    if (ch === '"') return out;
    if (ch === '\\') {
      if (index + 1 >= raw.length) break;
      const esc = raw[index + 1];
      if (esc === '"' || esc === '\\' || esc === '/') {
        out += esc;
        index += 2;
      } else if (esc === 'b') {
        out += '\b';
        index += 2;
      } else if (esc === 'f') {
        out += '\f';
        index += 2;
      } else if (esc === 'n') {
        out += '\n';
        index += 2;
      } else if (esc === 'r') {
        out += '\r';
        index += 2;
      } else if (esc === 't') {
        out += '\t';
        index += 2;
      } else if (esc === 'u') {
        const hex = raw.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          index += 6;
        } else {
          break;
        }
      } else {
        out += esc;
        index += 2;
      }
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

function extractPartialJsonObject(raw, key) {
  if (typeof raw !== 'string' || !raw) return null;
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\{`);
  const match = pattern.exec(raw);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw.slice(start);
}

/**
 * Extract Whale UI descriptor `{ language, program, title, streaming }` from
 * a `render_ui` tool call and/or its settled `tool/result` metadata.
 */
function extractWhaleUi(call, result = call?.result, streaming = false) {
  const metaUi = result?.meta?.whaleUi;
  if (metaUi && typeof metaUi === 'object' && !Array.isArray(metaUi)) {
    const hasSpec = Boolean(metaUi.spec && typeof metaUi.spec === 'object' && !Array.isArray(metaUi.spec));
    const program = typeof metaUi.program === 'string'
      ? metaUi.program
      : (hasSpec ? JSON.stringify(metaUi.spec) : '');
    if (program) {
      return {
        language: normalizeWhaleUiLanguage(metaUi.language, hasSpec && typeof metaUi.program !== 'string'),
        program,
        title: (typeof metaUi.title === 'string' && metaUi.title.trim()) || deriveWhaleUiTitle(program),
        streaming: false,
      };
    }
  }
  if (!call || (call.name !== 'render_ui' && !metaUi)) return null;
  const argsRaw = typeof call.argsRaw === 'string' ? call.argsRaw : '';
  if (argsRaw) {
    try {
      const parsed = JSON.parse(argsRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const hasSpec = Boolean(parsed.spec && typeof parsed.spec === 'object' && !Array.isArray(parsed.spec));
        const program = typeof parsed.program === 'string'
          ? parsed.program
          : (hasSpec ? JSON.stringify(parsed.spec) : '');
        const language = normalizeWhaleUiLanguage(parsed.language, hasSpec && typeof parsed.program !== 'string');
        const title = (typeof parsed.title === 'string' && parsed.title.trim()) || deriveWhaleUiTitle(program);
        return { language, program, title, streaming: Boolean(streaming) };
      }
    } catch {
      const partialProgram = extractPartialJsonString(argsRaw, 'program');
      const partialSpec = partialProgram === null ? extractPartialJsonObject(argsRaw, 'spec') : null;
      const partialLang = extractPartialJsonString(argsRaw, 'language');
      const partialTitle = extractPartialJsonString(argsRaw, 'title');
      const program = partialProgram ?? partialSpec ?? '';
      return {
        language: normalizeWhaleUiLanguage(partialLang, partialSpec !== null && partialProgram === null),
        program,
        title: (partialTitle && partialTitle.trim()) || deriveWhaleUiTitle(program),
        streaming: Boolean(streaming),
      };
    }
  }
  return {
    language: 'whale-ui',
    program: '',
    title: '',
    streaming: Boolean(streaming),
  };
}

function foldTimelineItem(item, entry, fallbackId) {
  if (item.type === 'user_message') {
    return {
      id: String(item.messageId || entry.seqStart || fallbackId),
      role: 'user',
      text: String(item.text || ''),
      images: [],
    };
  }
  if (item.type === 'assistant_message') {
    return {
      id: String(item.messageId || entry.seqStart || fallbackId),
      role: 'assistant',
      text: String(item.text || ''),
    };
  }
  if (item.type === 'reasoning') {
    return {
      id: String(entry.seqStart || fallbackId),
      role: 'reasoning',
      text: String(item.text || ''),
    };
  }
  if (item.type === 'tool_call') {
    const name = String(item.name || '');
    const status = item.status || '';
    const row = {
      id: String(item.callId || entry.seqStart || fallbackId),
      role: 'tool',
      text: name,
      card: TOOL_STATUS_LABELS[status] || status || 'tool',
      status,
      detail: toolDetailView(item.detail),
    };
    if (name === 'render_ui' || item.whaleUi || item.meta?.whaleUi) {
      const rawInput = item.arguments ?? item.input ?? item.detail?.input ?? item.detail?.output ?? '';
      const argsRaw = typeof rawInput === 'string' ? rawInput : (rawInput ? JSON.stringify(rawInput) : '');
      const metaUi = item.whaleUi || item.meta?.whaleUi;
      row.whaleUi = extractWhaleUi(
        { name: 'render_ui', argsRaw },
        metaUi ? { meta: { whaleUi: metaUi } } : null,
        status === 'running',
      );
    }
    return row;
  }
  if (item.type === 'error') {
    return {
      id: String(entry.seqStart || fallbackId),
      role: 'error',
      text: String(item.message || ''),
    };
  }
  if (item.type === 'todo') {
    return {
      id: String(entry.seqStart || fallbackId),
      role: 'todo',
      items: (Array.isArray(item.items) ? item.items : []).map((todo) => ({
        text: String(todo?.text || ''),
        completed: todo?.completed === true,
      })),
    };
  }
  if (item.type === 'compaction') {
    const status = item.status === 'completed'
      ? '上下文已压缩'
      : item.status === 'failed'
        ? `上下文压缩失败${item.error ? `：${item.error}` : ''}`
        : '正在压缩上下文…';
    return { id: String(entry.seqStart || fallbackId), role: 'meta', text: status };
  }
  if (item.type === 'turn_changes') {
    return {
      id: String(entry.seqStart || fallbackId),
      role: 'changes',
      text: String(item.changeSummary || ''),
      files: (Array.isArray(item.changedFiles) ? item.changedFiles : []).map((file) => ({
        path: String(file?.path || ''),
        additions: Number.isInteger(file?.additions) ? file.additions : null,
        deletions: Number.isInteger(file?.deletions) ? file.deletions : null,
      })),
    };
  }
  if (item.type === 'generative_ui') {
    const hasSpec = Boolean(item.spec && typeof item.spec === 'object' && !Array.isArray(item.spec));
    const program = typeof item.program === 'string'
      ? item.program
      : (hasSpec ? JSON.stringify(item.spec) : '');
    if (program) {
      return {
        id: String(item.instanceId || entry.seqStart || fallbackId),
        role: 'tool',
        text: 'render_ui',
        card: item.title || 'Whale UI',
        status: item.streaming === true ? 'running' : 'completed',
        detail: null,
        whaleUi: {
          language: normalizeWhaleUiLanguage(item.language, hasSpec && typeof item.program !== 'string'),
          program,
          title: String(item.title || deriveWhaleUiTitle(program) || ''),
          streaming: item.streaming === true,
        },
      };
    }
    return {
      id: String(entry.seqStart || fallbackId),
      role: 'meta',
      text: `交互组件「${item.title || item.componentId || 'generative UI'}」需要在电脑端查看`,
    };
  }
  // Unknown wire item types stay visible instead of silently vanishing.
  return {
    id: String(entry.seqStart || fallbackId),
    role: 'meta',
    text: `暂不支持的消息类型：${typeof item.type === 'string' ? item.type : '未知'}`,
  };
}

/** Text of the `tool-result` block a `tool/result` event carries. */
function toolResultOf(data) {
  const block = Array.isArray(data?.message?.content) ? data.message.content[0] : null;
  const content = Array.isArray(block?.content) ? block.content : [];
  const result = { content, isError: block?.isError === true };
  if (data?.error && typeof data.error === 'object') result.error = data.error;
  const meta = (data?.meta && typeof data.meta === 'object' && data.meta)
    || (block?.meta && typeof block.meta === 'object' && block.meta)
    || (data?.result?.meta && typeof data.result.meta === 'object' && data.result.meta)
    || null;
  if (meta) result.meta = meta;
  return result;
}

/**
 * Fold the raw dsh event log (plus ChisaCode projected `item` entries) into
 * flat timeline rows. Row roles: `user`, `assistant`, `reasoning`, `tool`,
 * `error`, `todo`, `changes`, `meta`. Every row carries `turn` (the dsh turn
 * number it belongs to, or null) so {@link groupTurns} can fold a finished
 * turn's process into one disclosure; the last streaming block is marked
 * `running` while its turn is still open.
 */
function foldEvents(entries) {
  const rows = [];
  // Streaming assistant blocks of the current step keyed by block index.
  let partial = new Map();
  let partialSeq = null;
  let turn = null;
  let turnOpen = false;
  const toolRows = new Map();

  const flushPartial = () => {
    if (!partial.size) return;
    const blocks = [...partial.entries()].sort((a, b) => a[0] - b[0]).map(([, block]) => block);
    let text = '';
    let textId = null;
    const pushText = () => {
      if (text === '' || textId === null) return;
      rows.push({ id: textId, role: 'assistant', text, turn, running: false });
      text = '';
      textId = null;
    };
    for (const block of blocks) {
      if (block.kind === 'reasoning') {
        pushText();
        if (block.text !== '') {
          rows.push({ id: `reasoning-${partialSeq}-${block.index}`, role: 'reasoning', text: block.text, turn, running: false });
        }
      } else if (block.kind === 'text') {
        if (textId === null) textId = `assistant-${partialSeq}`;
        text += block.text;
      }
    }
    pushText();
    partial = new Map();
    partialSeq = null;
  };

  const blockAt = (index, kind) => {
    let block = partial.get(index);
    if (!block) {
      block = { index, kind, text: '' };
      partial.set(index, block);
    } else if (block.kind !== kind && block.text === '') {
      block.kind = kind;
    }
    return block;
  };

  for (const entry of entries || []) {
    const item = entry?.item;
    if (item && typeof item === 'object' && typeof item.type === 'string') {
      flushPartial();
      rows.push({ ...foldTimelineItem(item, entry, rows.length), turn: null });
      continue;
    }
    const event = entry?.event || entry;
    if (!event || typeof event.type !== 'string') continue;
    const data = event.data || {};
    // A paged history window can begin in the middle of a turn, before its
    // `turn/start` record. Every turn-scoped event repeats `data.turn`, so
    // use it as the location fallback for grouping and status rendering.
    if (Number.isInteger(data.turn)) turn = data.turn;
    if (event.type === 'turn/start' || event.type === 'turn/started') {
      flushPartial();
      turn = Number.isInteger(data.turn) ? data.turn : (turn === null ? 0 : turn + 1);
      turnOpen = true;
      continue;
    }
    if (event.type === 'turn/end' || event.type === 'turn/completed') {
      flushPartial();
      turnOpen = false;
      for (const row of toolRows.values()) {
        if ((row.turn === turn || row.turn === null) && row.call.result === null) row.call.interrupted = true;
      }
      // A turn that closed in failure paints the desktop's 「本轮运行失败」
      // row; without it the phone shows a bare user bubble and nothing else.
      const reason = data.reason && typeof data.reason === 'object' ? data.reason : null;
      if (reason?.kind === 'error' || reason?.kind === 'aborted') {
        const failure = reason.error && typeof reason.error === 'object' ? reason.error : {};
        rows.push({
          id: `turn-error-${event.seq}`,
          role: 'error',
          text: String(failure.message || reason.message || '运行失败'),
          code: typeof failure.code === 'string' ? failure.code : '',
          title: reason.kind === 'aborted' ? '本轮已中止' : '本轮运行失败',
          turn,
        });
      } else if (reason?.kind === 'max-tokens') {
        rows.push({ id: `turn-max-${event.seq}`, role: 'meta', text: '输出达到长度上限', turn });
      }
      continue;
    }
    if (event.type === 'turn/interrupt') {
      flushPartial();
      rows.push({ id: `interrupt-${event.seq}`, role: 'meta', text: '已停止', turn });
      continue;
    }
    if (event.type === 'step/start' || event.type === 'step/end') {
      flushPartial();
      continue;
    }
    if (event.type === 'user/message') {
      if (data?.source?.kind !== 'user') continue;
      flushPartial();
      rows.push({
        id: String(data.id || event.seq),
        role: 'user',
        text: textFromBlocks(data.content),
        images: imagesFromBlocks(data.content),
        turn: null,
      });
      continue;
    }
    if (event.type === 'assistant/chunk') {
      const chunk = classifyChunk(data);
      if (partialSeq === null) partialSeq = event.seq;
      if (chunk.kind === 'start') {
        blockAt(chunk.index, chunk.blockType === 'reasoning' ? 'reasoning' : chunk.blockType === 'text' ? 'text' : 'other');
      } else if (chunk.kind === 'text' || chunk.kind === 'reasoning') {
        blockAt(chunk.index, chunk.kind).text += chunk.text;
      }
      continue;
    }
    if (event.type === 'assistant/message') {
      partial = new Map();
      partialSeq = event.seq;
      const blocks = Array.isArray(data.message?.content) ? data.message.content : [];
      blocks.forEach((block, index) => {
        if (!block || typeof block !== 'object') return;
        if (block.type === 'reasoning') blockAt(index, 'reasoning').text = String(block.text || '');
        else if (block.type === 'text' || (block.type === undefined && typeof block.text === 'string')) blockAt(index, 'text').text = String(block.text || '');
      });
      flushPartial();
      continue;
    }
    if (event.type === 'tool/call') {
      flushPartial();
      const callId = String(data.callId || event.seq);
      const nextArgsRaw = typeof data.arguments === 'string'
        ? data.arguments
        : (data.arguments == null ? '' : JSON.stringify(data.arguments));
      const existing = toolRows.get(callId);
      if (existing) {
        if (typeof data.argumentsDelta === 'string') existing.call.argsRaw += data.argumentsDelta;
        else if (nextArgsRaw) existing.call.argsRaw = nextArgsRaw;
        if (data.name) {
          existing.call.name = String(data.name);
          existing.text = existing.call.name;
        }
        continue;
      }
      const call = {
        callId,
        name: String(data.name || ''),
        argsRaw: typeof data.argumentsDelta === 'string' ? data.argumentsDelta : nextArgsRaw,
        result: null,
        interrupted: false,
        time: event.time,
      };
      const row = {
        id: callId,
        role: 'tool',
        text: call.name,
        card: entry.view?.view?.card || call.name || 'tool',
        detail: null,
        call,
        turn,
      };
      toolRows.set(callId, row);
      rows.push(row);
      continue;
    }
    if (event.type === 'tool/result') {
      flushPartial();
      const callId = String(data.message?.source?.callId || data.callId || '');
      const row = toolRows.get(callId);
      const result = toolResultOf(data);
      if (row) {
        row.call.result = result;
        row.call.resultTime = event.time;
        if (!row.call.name && data.message?.source?.name) {
          row.call.name = String(data.message.source.name);
          row.text = row.call.name;
        }
      } else if (callId) {
        // Result whose call scrolled out of the loaded window: still a row.
        const name = String(data.message?.source?.name || (result.meta?.whaleUi ? 'render_ui' : ''));
        const call = { callId, name, argsRaw: '', result, interrupted: false };
        const orphan = { id: callId, role: 'tool', text: call.name, card: call.name || 'tool', detail: null, call, turn };
        toolRows.set(callId, orphan);
        rows.push(orphan);
      }
      continue;
    }
    if (event.type === 'compaction/start') {
      flushPartial();
      rows.push({ id: `compaction-${event.seq}`, role: 'meta', text: '正在压缩上下文…', turn });
      continue;
    }
    if (event.type === 'compaction/end' || event.type === 'compaction/summary') {
      flushPartial();
      const last = rows[rows.length - 1];
      if (last?.role === 'meta' && last.text === '正在压缩上下文…') last.text = '上下文已压缩';
      else if (event.type === 'compaction/end') rows.push({ id: `compaction-${event.seq}`, role: 'meta', text: '上下文已压缩', turn });
      continue;
    }
  }
  flushPartial();
  // The streaming tail: only the newest block of an open turn is "running".
  if (turnOpen && rows.length) {
    const last = rows[rows.length - 1];
    if (last.role === 'assistant' || last.role === 'reasoning') last.running = true;
  }
  for (const row of rows) {
    if (row.role === 'tool' && row.call) {
      const unsettled = row.call.result === null && !row.call.interrupted;
      row.running = unsettled && turnOpen;
      if (row.call.name === 'render_ui' || row.call.result?.meta?.whaleUi) {
        row.whaleUi = extractWhaleUi(row.call, row.call.result, unsettled);
      }
    }
  }
  return rows;
}

/** Row kinds that make up a turn's process (everything but its final answer). */
const PROCESS_ROLES = new Set(['reasoning', 'tool', 'assistant', 'meta']);

function isWhaleUiProcessRow(row) {
  return Boolean(row?.whaleUi) || (row?.role === 'tool' && row?.text === 'render_ui');
}

/**
 * Group flat rows into what the desktop chat paints: each turn's process
 * (reasoning, tool calls, intermediate replies) folds into one disclosure
 * once the turn has settled with a final answer; while the turn is still
 * running, or when the process is only reasoning, the rows stay inline.
 * Interactive `render_ui` / Whale UI cards are never hidden inside a collapsed
 * `turn-process` disclosure.
 *
 * Output entries are either the original rows or
 * `{ role: 'turn-process', id, rows, toolCalls, messages, subagents, running }`.
 */
function groupTurns(rows, { running = null } = {}) {
  const out = [];
  let index = 0;
  // A live `running` flag describes the session's newest turn only; earlier
  // turns are settled regardless and fold like any other history.
  const lastTurn = (() => {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].turn != null) return rows[i].turn;
    }
    return null;
  })();
  while (index < rows.length) {
    const row = rows[index];
    if (row.role === 'user' || row.turn == null || !PROCESS_ROLES.has(row.role)) {
      out.push(row);
      index += 1;
      continue;
    }
    // Collect this turn's contiguous process + answer rows.
    const turn = row.turn;
    const group = [];
    while (index < rows.length && rows[index].turn === turn && PROCESS_ROLES.has(rows[index].role)) {
      group.push(rows[index]);
      index += 1;
    }
    const last = group[group.length - 1];
    const turnRunning = turn === lastTurn
      ? (running === true || (running === null && group.some((r) => r.running)))
      : false;
    const answer = !turnRunning && last.role === 'assistant' ? last : null;
    const process = answer ? group.slice(0, -1) : group;

    const flushProcessSlice = (slice) => {
      if (!slice.length) return;
      const toolCalls = slice.filter((r) => r.role === 'tool').length;
      const subagents = slice.filter((r) => r.role === 'tool' && /^subagent(_|$)/.test(r.text || '')).length;
      const messages = slice.filter((r) => r.role === 'assistant').length;
      const reasoningOnly = slice.every((r) => r.role === 'reasoning' || r.role === 'meta');
      if (turnRunning || reasoningOnly) {
        out.push(...slice);
      } else {
        out.push({
          id: `turn-process-${turn}-${slice[0].id}`,
          role: 'turn-process',
          turn,
          rows: slice,
          toolCalls: toolCalls - subagents,
          subagents,
          messages,
          running: false,
        });
      }
    };

    let currentSlice = [];
    for (const item of process) {
      if (isWhaleUiProcessRow(item)) {
        flushProcessSlice(currentSlice);
        currentSlice = [];
        out.push(item);
      } else {
        currentSlice.push(item);
      }
    }
    flushProcessSlice(currentSlice);
    if (answer) out.push(answer);
  }
  return out;
}

const foldHistoryToItems = foldEvents;

export { classifyChunk, extractWhaleUi, foldEvents, foldHistoryToItems, groupTurns, toolDetailView, toolResultOf };
