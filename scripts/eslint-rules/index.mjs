import { maxLines, complexity } from './structure.mjs';
// Local guardrail rules for the desktop shell. Every message carries the
// reason and the replacement so a single review correction keeps protecting
// the codebase; see docs/maintenance/README.md.

import { createRequire } from 'node:module';

const localRequire = createRequire(import.meta.url);

const IPC_METHODS = new Set(['handle', 'handleOnce', 'on', 'once']);

function isIpcMainCall(node) {
  const callee = node.callee;
  return callee.type === 'MemberExpression'
    && callee.computed === false
    && callee.object.type === 'Identifier'
    && callee.object.name === 'ipcMain'
    && callee.property.type === 'Identifier'
    && IPC_METHODS.has(callee.property.name);
}

function memberPropertyName(member) {
  if (member.computed) {
    return member.property.type === 'Literal' ? member.property.value : null;
  }
  return member.property.type === 'Identifier' ? member.property.name : null;
}

const ipcHandlerReadsEvent = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require inline ipcMain handlers to read the event argument',
    },
    schema: [],
    messages: {
      missingEventCheck:
        '主进程 IPC 处理函数必须读取 event 校验调用方（assertIpcSender 或归属帧比对）；'
        + '不看调用方的处理函数会对任何能发 IPC 的页面开放。来源：2026-11-15 审查 updates-state.js。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isIpcMainCall(node)) return;
        const handler = node.arguments[1];
        if (!handler
          || (handler.type !== 'FunctionExpression' && handler.type !== 'ArrowFunctionExpression')) {
          return;
        }
        const first = handler.params[0];
        if (first === undefined) {
          context.report({ node: handler, messageId: 'missingEventCheck' });
          return;
        }
        // A destructured or rest first parameter already reads the event.
        if (first.type !== 'Identifier') return;
        const scope = context.sourceCode.getScope(handler);
        const variable = scope.set.get(first.name);
        if (variable === undefined || variable.references.length === 0) {
          context.report({ node: handler, messageId: 'missingEventCheck' });
        }
      },
    };
  },
};

const ipcViaRegister = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require main-process IPC channels to register through src/main/ipc-register.js',
    },
    schema: [],
    messages: {
      useRegisterIpc:
        'IPC 注册必须走 src/main/ipc-register.js 的 registerIpc/createRegisterIpc'
        + '（统一强制调用方授权与参数校验）；不要直接调用 ipcMain.handle/on/once/handleOnce。'
        + '来源：issue #434 P2-3 registerIpc。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isIpcMainCall(node)) {
          context.report({ node: node.callee, messageId: 'useRegisterIpc' });
        }
      },
    };
  },
};

let declaredChannels;
function ipcContractChannels() {
  if (!declaredChannels) {
    const { IPC_CONTRACT } = localRequire('../../src/shared/ipc-contract.js');
    declaredChannels = new Set(IPC_CONTRACT.map((row) => row.channel));
  }
  return declaredChannels;
}

// 'shell:x' / 'dsh-platform:y' — a namespaced channel name, not a URL or a
// map key.
function isChannelLiteral(node) {
  return node !== undefined
    && node.type === 'Literal'
    && typeof node.value === 'string'
    && /^[a-z][a-z0-9-]*:[a-z0-9-]+$/u.test(node.value);
}

const ipcChannelContract = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require main-process channel literals to be declared in src/shared/ipc-contract.js',
    },
    schema: [],
    messages: {
      undeclaredChannel:
        'IPC 通道「{{channel}}」未登记在 src/shared/ipc-contract.js；先加契约条目（channel/kind/roles/validate）再注册。'
        + '来源：issue #436 P3-1 契约集中登记。',
    },
  },
  create(context) {
    const check = (node, channel) => {
      if (!ipcContractChannels().has(channel)) {
        context.report({ node, messageId: 'undeclaredChannel', data: { channel } });
      }
    };
    return {
      // register({ channel: 'ch', handler }) / registerIpc({ channel }) —
      // any object literal passed to a call.
      Property(node) {
        const key = node.key;
        if ((key.type === 'Identifier' && key.name !== 'channel')
          || (key.type === 'Literal' && key.value !== 'channel')
          || (key.type !== 'Identifier' && key.type !== 'Literal')) {
          return;
        }
        if (!isChannelLiteral(node.value)) return;
        const object = node.parent;
        if (object?.type !== 'ObjectExpression' || object.parent?.type !== 'CallExpression') return;
        check(node.value, node.value.value);
      },
      // Lane modules register through a bound handle('ch', listener) seam.
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'Identifier' || callee.name !== 'handle') return;
        const first = node.arguments[0];
        if (isChannelLiteral(first)) check(first, first.value);
      },
    };
  },
};

const openExternalHttp = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require shell.openExternal arguments to be https:// literals',
    },
    schema: [],
    messages: {
      requireHttpLiteral:
        '外部链接必须经 src/main/open-external.js 的 openExternalHttp 打开（只放行 http/https）；'
        + '直接把可变 URL 交给系统会打开 file:// 或自定义协议。来源：2026-11-15 审查 update.js。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || memberPropertyName(callee) !== 'openExternal') return;
        const first = node.arguments[0];
        if (first !== undefined
          && first.type === 'Literal'
          && typeof first.value === 'string'
          && first.value.startsWith('https://')) {
          return;
        }
        context.report({ node, messageId: 'requireHttpLiteral' });
      },
    };
  },
};

const RAW_HTML_PROPERTIES = new Set(['innerHTML', 'outerHTML']);

const noRawHtml = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow innerHTML/outerHTML assignment and insertAdjacentHTML',
    },
    schema: [],
    messages: {
      noRawHtml:
        '用 textContent / replaceChildren / createElement 构建 DOM；拼接 HTML 很容易漏转义'
        + '（2026-11-15 审查 launcher.js badge()）。确需 HTML 模板时用 eslint-disable-next-line 并在 -- 后写明数据已转义。',
    },
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type === 'MemberExpression' && RAW_HTML_PROPERTIES.has(memberPropertyName(left))) {
          context.report({ node: left, messageId: 'noRawHtml' });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'MemberExpression' && memberPropertyName(callee) === 'insertAdjacentHTML') {
          context.report({ node: callee, messageId: 'noRawHtml' });
        }
      },
    };
  },
};

// 凭据名只认"以单数 token/secret/password/cookie 结尾"的标识符或成员属性名
// （token、heldGuardToken、this.token、sessionSecret、muxCookie）。
// 复数或更长的词不算凭据：tokens、tokensSeen、dayTokens、outputTokens 是
// LLM 用量计数，ENV_SECRET_MASK 是掩码常量，比较它们用 === 没有问题。
const SECRET_OPERAND = /(?:token|secret|password|cookie)$/i;

function isSecretNamedLeaf(node) {
  if (node.type === 'Identifier' && SECRET_OPERAND.test(node.name)) {
    return true;
  }
  if (node.type === 'MemberExpression') {
    const name = memberPropertyName(node);
    return typeof name === 'string' && SECRET_OPERAND.test(name);
  }
  return false;
}

// The compared value of `typeof x` / `void x` is the operator result, never
// `x` itself — a secret-looking name inside them is not being compared.
function operandHasSecretName(node) {
  if (!node || typeof node.type !== 'string') {
    return false;
  }
  if (isSecretNamedLeaf(node)) {
    return true;
  }
  if (node.type === 'UnaryExpression' && (node.operator === 'typeof' || node.operator === 'void')) {
    return false;
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (operandHasSecretName(child)) {
          return true;
        }
      }
    } else if (operandHasSecretName(value)) {
      return true;
    }
  }
  return false;
}

// 与凭据名操作数做 ===/!== 比较时另一侧允许的"字面量"形态：
// 任意字面量、undefined、typeof/void 结果、无插值模板串。
function isLiteralOperand(node) {
  if (node.type === 'Literal') {
    return true;
  }
  if (node.type === 'Identifier' && node.name === 'undefined') {
    return true;
  }
  if (node.type === 'UnaryExpression') {
    return node.operator === 'typeof' || node.operator === 'void';
  }
  if (node.type === 'TemplateLiteral') {
    return node.expressions.length === 0;
  }
  return false;
}

const noSecretCompare = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require constantTimeEqual for credential equality checks',
    },
    schema: [],
    messages: {
      useConstantTimeEqual:
        '令牌/密钥/口令/Cookie 的等值比较改用 constantTimeEqual（src/shared/secret.js；'
        + 'vendor 侧 import \'../../dsh-shared/lib/secret.mjs\'）：===/!== 会按匹配前缀短路，'
        + '把差异位置泄露给计时观测。与字面量（\'\'、null、undefined、typeof 结果）比较不受影响。',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== '===' && node.operator !== '!==') {
          return;
        }
        const leftNamed = operandHasSecretName(node.left);
        const rightNamed = operandHasSecretName(node.right);
        if (!leftNamed && !rightNamed) {
          return;
        }
        if (!rightNamed && isLiteralOperand(node.right)) {
          return;
        }
        if (!leftNamed && isLiteralOperand(node.left)) {
          return;
        }
        context.report({ node, messageId: 'useConstantTimeEqual' });
      },
    };
  },
};

const noRequestBodyAccumulate = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require readBodyLimited instead of manual req data listeners',
    },
    schema: [],
    messages: {
      useReadBodyLimited:
        'HTTP 请求体读取改用 readBodyLimited(req, maxBytes)（src/shared/secret.js；'
        + 'vendor 侧 import \'../../dsh-shared/lib/secret.mjs\'）：统一超限 BODY_TOO_LARGE'
        + '与连接中断的拒绝语义；要回 4xx 的服务端处理器传 { res }，让 Node 发完'
        + '响应再关连接。禁止再手写 req.on(\'data\') 累积。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') {
          return;
        }
        const method = memberPropertyName(callee);
        if (method !== 'on' && method !== 'once') {
          return;
        }
        if (callee.object.type !== 'Identifier' || callee.object.name !== 'req') {
          return;
        }
        const first = node.arguments[0];
        if (first && first.type === 'Literal' && first.value === 'data') {
          context.report({ node, messageId: 'useReadBodyLimited' });
        }
      },
    };
  },
};

// Marker governance (#459): a comment annotating a stopgap must carry the
// tracking issue on the same line so the note cannot outlive review. Marker
// words are `HACK`/`FIXME`/`TODO`/`XXX`/`workaround`（大小写不限）plus
// `临时`/`暂时`. Backtick- and double-quoted spans are stripped before the
// scan — a quoted "暂时" UI string or a `todo` role token is a reference,
// not a marker (single quotes stay, they double as apostrophes).
const QUOTED_SPAN = /`[^`\r\n]*`|"[^"\r\n]*"/gu;
const TEMP_MARKER = /\b(?:hack|fixme|todo|xxx|workaround)\b|临时|暂时/iu;
const ISSUE_REF = /#\d+(?!\w)|https?:\/\/\S+?\/issues\/\d+/u;

const tempMarkerIssue = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require an issue reference on the same line as temporary-marker comments',
    },
    schema: [],
    messages: {
      missingIssueRef:
        '带 {{marker}} 标记的注释必须在同一行注明议题编号（#123 或议题 URL），让临时措施可追踪；'
        + '若非临时措施请改写措辞去掉标记词。来源：issue #459 P6-2。',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const lines = comment.value.split('\n');
          for (const [index, raw] of lines.entries()) {
            const marker = raw.replace(QUOTED_SPAN, '').match(TEMP_MARKER);
            if (marker === null || ISSUE_REF.test(raw)) continue;
            const line = comment.loc.start.line + index;
            const column = index === 0 ? comment.loc.start.column : 0;
            context.report({
              loc: {
                start: { line, column },
                end: { line, column: column + raw.length },
              },
              messageId: 'missingIssueRef',
              data: { marker: marker[0] },
            });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    'max-lines': maxLines,
    complexity,
    'ipc-handler-reads-event': ipcHandlerReadsEvent,
    'ipc-via-register': ipcViaRegister,
    'ipc-channel-contract': ipcChannelContract,
    'open-external-http': openExternalHttp,
    'no-raw-html': noRawHtml,
    'no-secret-compare': noSecretCompare,
    'no-request-body-accumulate': noRequestBodyAccumulate,
    'temp-marker-issue': tempMarkerIssue,
  },
};
