// Promise catch callbacks are not covered by ESLint's no-empty rule.
/** @type {import('eslint').Rule.RuleModule} */
export const noEmptyPromiseCatch = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { unexplained: '不要静默吞掉 Promise 错误：向调用方返回失败、使用现有日志，或在空 catch 内说明允许忽略的具体原因。' },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.computed) {
          if (callee.property.type !== 'Literal' || callee.property.value !== 'catch') return;
        } else if (callee.property.type !== 'Identifier' || callee.property.name !== 'catch') return;
        const handler = node.arguments[0];
        if (!handler || (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression')) return;
        const body = handler.body;
        if (body.type !== 'BlockStatement' || body.body.length) return;
        if (context.sourceCode.getCommentsInside(body).some(comment => comment.value.trim().length >= 12)) return;
        context.report({ node: handler, messageId: 'unexplained' });
      },
    };
  },
};
