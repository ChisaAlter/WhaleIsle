// Local guardrail rules for the desktop shell. Every message carries the
// reason and the replacement so a single review correction keeps protecting
// the codebase; see docs/maintenance/README.md.

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

export default {
  rules: {
    'ipc-handler-reads-event': ipcHandlerReadsEvent,
    'open-external-http': openExternalHttp,
    'no-raw-html': noRawHtml,
  },
};
