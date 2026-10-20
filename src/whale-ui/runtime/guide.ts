import { createWhaleLibrary, promptOptions } from '../library.ts';
import { genuiComponents, genuiSchema } from './genui-adapter.tsx';

export const unifiedLibrary = createWhaleLibrary(genuiComponents);

/** Generated from the same component definitions consumed by the viewer. */
export function generateWhaleGuide(): string {
  const language = unifiedLibrary.prompt({
    ...promptOptions,
    preamble: 'Use Whale UI for a useful interactive answer. Put its program in a whale-ui Markdown fence and start with root = Col(...). Every fence owns its local state. Only @ToAssistant or a button without a local action sends a new request to this same conversation.',
    additionalRules: [
      ...promptOptions.additionalRules,
      'Use one statement per line and positional arguments. References may be defined after root. Defaults for mutable $variables are literals. String object keys may contain any language; quote keys for reliable interchange.',
      'Action steps execute in order. Each step reads state at its execution time. @Set and @Reset stay local. Clipboard, links and conversation submission await the host result; failed steps stop the remaining sequence.',
      'The viewer has no model API, filesystem, shell, credentials or arbitrary business-tool provider. Obtain real data with the conversation tools before creating the interface. Existing permissions still apply.',
      'Incomplete or invalid final programs show diagnostics. Complete all references and components before ending the fence. Use the same field identity for the same user input and a different identity for different inputs.',
    ],
    examples: [
      'root = Col([Title("Quantity"), Input($quantity, "Quantity", "number"), Text("Total: " + @Format(@Default($quantity, 1) * 12, "currency", 2, "USD")), Button("Add one", @Set($quantity, @Default($quantity, 1) + 1))])\n$quantity = 1',
      'root = Col([Plot({series: [{expr: "sin(x)"}], xMin: -6, xMax: 6})])',
    ],
  });
  const specialized = Object.entries(genuiSchema).map(([name, schema]) => {
    const fields = Object.entries(schema.fields).map(([field, type]) => `${field}${schema.required.includes(field) ? '' : '?'}:${schema.enums[field] ? schema.enums[field].join('|') : type}`).join(', ');
    return `${name}: {${fields}}`;
  }).join('\n');
  return [
    '## Interactive answers with Whale UI',
    'Use a whale-ui fence for a working page when interaction helps, or render_ui for a self-contained tool card. Pass program as language text or spec as a declarative object, never both. Ordinary prose and tool calls remain available outside the fence. Local operations do not require another model message.',
    language.replaceAll('openui-lang', 'whale-ui'),
    '## Specialized visual options',
    'Plot, Mermaid, Scene3D, EChart, Diagram, Blocks, Quiz, FileTree, Timeline, Steps, KeyValue, Diff, Json, Tabs and Accordion take an options object from the corresponding component below. Genui({items:[...]}) can combine these declarative components inside a normal Whale UI page. Local controls and field state use the same document owner. For quizzes and grouped forms, use stable ids/groups and submit to send their payload. Exported HTML keeps local controls; sending a message requires the conversation host.',
    specialized,
    'Use only the whale-ui fence for new generated interfaces. Existing openui, openui-lang and dsh-ui history remains readable through the same runtime.',
  ].join('\n\n');
}
