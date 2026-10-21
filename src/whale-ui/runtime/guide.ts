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
      'Compose a finished Whale Isle interface for the user task. Show one concise content title (Title md), a short explanation only when needed, then the working content. Do not add product names, demo captions, implementation notes, empty status bars or redundant readiness badges.',
      'Use the shared desktop typography and controls: body text md, secondary copy sm, section title sm, and md for the page title. Use 2xl or 3xl only for one meaningful numeric result, never for a sentence. Let default buttons keep their natural width; place one primary action and related outline/ghost actions together in a Row. Use block only when a deliberate full-width action is needed.',
      'All gap and padding arguments are counts of 4px, not pixels. For 8/12/16/20/24px use 2/3/4/5/6. Card(children,"soft",5,3) means 20px padding and 12px gap; Card(...,16,...) would create 64px padding and is excessive. Prefer default Card padding. Use 5 or 6 between sections, 3 within groups, 2 between label and value. Group related inputs in Grid with minChildWidth 240–280 so a narrow conversation stacks fields. Keep metrics in one plain Grid/Row with only the main result enlarged. Avoid wide fixed rows, a card per metric, oversized controls, centered prose and dense walls of badges.',
      'Use Card only for content that belongs together, not around the entire page or inside another card. Prefer plain sections, a restrained table or a chart with a small readable legend; do not stretch short cards to fill a tall neighbor. Use the existing semantic palette without custom CSS, decorative gradients or arbitrary font/colour overrides.',
    ],
    examples: [
      'root = Col([Title("Order estimate","md"), Text("Adjust the quantity to update your total.","sm","muted"), Grid([Input($quantity,"Quantity","number"),Input($price,"Unit price","number")],2,240,4), Row([Col([Caption("Estimated total"),Title(@Format(@Clamp(@Default($quantity,1),1,100)*@Clamp(@Default($price,12),0,10000),"currency",2,"USD"),"2xl")],1),Spacer(),Button("Reset",@Reset($quantity,$price),"outline")],3)],5)\n$quantity = 1\n$price = 12',
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
