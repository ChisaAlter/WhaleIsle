import { resolveFence } from '../genui/shared/fence-resolve.ts';
import type { SourceLanguage } from '../viewer/protocol.ts';
import { isElementNode } from '../language/index.ts';
import { processGenuiSpec } from '../genui/client/guard.ts';
import { specialized } from './genui-definitions.ts';

/** Validate specialized options while leaving opaque user data untouched. */
export function validateSpecializedNodes(root: unknown): string[] {
  const types = new Map(specialized.map(([name, type]) => [name, type]));
  const errors: string[] = [];
  const pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { pending.push(...value); continue; }
    if (!isElementNode(value)) continue;
    const type = types.get(value.typeName);
    if (type || value.typeName === 'Genui') {
      const result = processGenuiSpec(type ? { items: [{ ...(value.props.options as Record<string, unknown>), type }] } : value.props.spec);
      errors.push(...result.errors);
      if (!result.spec && !result.errors.length) errors.push(`${value.typeName} contains no renderable content.`);
    } else pending.push(...Object.values(value.props));
  }
  return errors;
}

/** Historical JSON normalization stays independent of the React renderers. */
export function compileGenuiDocument(program: string, language: SourceLanguage) {
  if (language !== 'dsh-ui' && !(language === 'whale-ui' && program.trimStart().startsWith('{'))) return { program, errors: [] as string[] };
  const result = resolveFence(program, { settled: true });
  const errors = [...result.errors];
  if (!result.complete || !result.spec) { if (!errors.length) errors.push('The declarative interface is incomplete.'); }
  return { program: result.spec ? `root = Col([Genui(${JSON.stringify(result.spec)})])` : 'root = Col([])', errors };
}
