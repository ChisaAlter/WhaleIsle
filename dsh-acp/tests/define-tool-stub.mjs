/** Lightweight offline stand-in for `@deepseek-ai/dsh-tools`'s `defineTool`. */
function compilePropertyMap(map = {}) {
  const properties = {};
  const required = [];
  for (const [key, raw] of Object.entries(map)) {
    const { required: isRequired, ...rest } = raw || {};
    if (isRequired) required.push(key);
    properties[key] = compileNode(rest);
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function compileNode(node) {
  if (!node || typeof node !== 'object') return node;
  const copy = { ...node };
  if (copy.type === 'object' && copy.properties) {
    const nested = compilePropertyMap(copy.properties);
    return { ...copy, ...nested };
  }
  if (copy.type === 'array' && copy.items) {
    copy.items = compileNode(copy.items);
  } else if (Array.isArray(copy.oneOf)) {
    copy.oneOf = copy.oneOf.map(compileNode);
  }
  return copy;
}

export function defineToolStub(spec) {
  return {
    ...spec,
    parameters: compilePropertyMap(spec.parameters),
    execute: async (...args) => spec.execute(...args),
  };
}
