import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import baseline from '../structure-baseline.json' with { type: 'json' };

function functionIdentity(node, source) {
  const parts = [];
  for (let current = node; current; current = current.parent) {
    if (!/Function/.test(current.type)) continue;
    const parent = current.parent;
    if (current.id?.name) parts.push(current.id.name);
    else if (parent?.type === 'VariableDeclarator') parts.push(source.getText(parent.id));
    else if (parent?.type === 'Property' || parent?.type === 'MethodDefinition') parts.push(source.getText(parent.key));
    else {
      // Anonymous callbacks have no stable name: retain only their exact source
      // in the baseline, so a new callback cannot inherit another one's budget.
      parts.push(createHash('sha256').update(source.getText(current)).digest('hex').slice(0, 16));
    }
  }
  return parts.reverse().join('/');
}

function boundedRule(name) {
  const core = builtinRules.get(name);
  return {
    meta: { ...core.meta, schema: [], defaultOptions: [], messages: { ...core.meta.messages,
      budget: '存量 {{kind}} 上限 {{max}}，当前 {{actual}}；请按职责拆分。标识：{{identity}}',
    } },
    create(context) {
      const file = relative(process.cwd(), context.filename).replaceAll('\\', '/');
      const proxy = Object.create(context);
      Object.defineProperty(proxy, 'options', { value: [{ max: name === 'max-lines' ? 800 : 20 }] });
      Object.defineProperty(proxy, 'report', { value(descriptor) {
        const identity = name === 'max-lines' ? file : functionIdentity(descriptor.node, context.sourceCode);
        const actual = Number(descriptor.data[name === 'max-lines' ? 'actual' : 'complexity']);
        const limit = name === 'max-lines' ? 800 : 20;
        const prior = name === 'max-lines' ? baseline.maxLines[file] : baseline.complexity[file]?.[identity];
        if (prior !== undefined && actual <= prior) return;
        context.report({ ...descriptor, messageId: 'budget', data: {
          kind: name, max: prior ?? limit, actual, identity,
        } });
      } });
      return core.create(proxy);
    },
  };
}

export const maxLines = boundedRule('max-lines');
export const complexity = boundedRule('complexity');
