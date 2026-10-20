import { createParser, createStore, evaluateRoot, type OpenUIError, type EvaluationContext } from '../language/index.ts';
import { unifiedLibrary } from './guide.ts';
import { compileGenuiDocument, validateSpecializedNodes } from './validate-genui.ts';
import type { SourceLanguage } from '../viewer/protocol.ts';

const schema = unifiedLibrary.toJSONSchema();
const parser = createParser(schema, 'Col');
const functions = Object.fromEntries(Object.entries(schema.functions ?? {}).map(([name, declaration]) => [name, { ...declaration, fn: unifiedLibrary.functions[name]!.fn }]));

/** Parse and evaluate complete programs against the same registry and budgets as the viewer. */
export function validateWhaleDocument(program: string, language: SourceLanguage) {
  const compiled = compileGenuiDocument(program, language);
  const parsed = parser.parse(compiled.program);
  const errors = [...compiled.errors, ...parsed.meta.errors.filter(error => error.severity !== 'warning').map(error => error.message)];
  if (parsed.meta.incomplete) errors.push('The program is incomplete.');
  if (parsed.meta.unresolved.length) errors.push(`Undefined references: ${parsed.meta.unresolved.join(', ')}.`);
  if (!parsed.root && !parsed.rootExpression) errors.push('The program has no renderable root.');
  if (parsed.queryStatements.length || parsed.mutationStatements.length) errors.push('This interface has no business-tool provider. Obtain data using the conversation tools first.');
  if (!errors.length) {
    const store = createStore();
    try {
      store.initialize(parsed.stateDeclarations, {});
      const runtime: OpenUIError[] = [];
      const context: EvaluationContext = { getState: store.get, resolveRef: () => null, functions, actions: schema.actions };
      const evaluated = evaluateRoot(parsed, { ctx: context, library: unifiedLibrary, store, errors: runtime });
      errors.push(...runtime.filter(error => error.severity !== 'warning').map(error => error.message));
      if (!evaluated) errors.push('The program has no renderable root.');
      else errors.push(...validateSpecializedNodes(evaluated));
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    finally { store.dispose(); }
  }
  return { complete: errors.length === 0, errors };
}
