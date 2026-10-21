import { createWhaleLibrary, promptOptions } from '../library.ts';
import { genuiComponents, genuiSchema } from './genui-adapter.tsx';

export const unifiedLibrary = createWhaleLibrary(genuiComponents);

/** Generated from the same component definitions consumed by the viewer. */
export function generateWhaleGuide(): string {
  const language = unifiedLibrary.prompt({
    ...promptOptions,
    preamble: 'The user can receive a complete interactive page as the answer in this conversation. Use the already registered components and supplied business data directly; no repository search, component-source inspection, app edits or server is needed. This also applies to editable schedules and analyses. Implement all requested local interactions in one complete Whale UI program, then call render_ui once (or use one whale-ui fence). Start with root = Col(...). Only @ToAssistant or a button without a local action asks the assistant again.',
    additionalRules: [
      ...promptOptions.additionalRules,
      'Use one statement per line and positional arguments. References may be defined after root. Defaults for mutable $variables are literals. String object keys may contain any language; quote keys for reliable interchange. The examples below are working patterns: replace their domain data and labels, keep the state/action structure.',
      'Action steps execute in order. Each step reads state at its execution time. @Set and @Reset stay local. Clipboard, links and conversation submission await the host result; failed steps stop the remaining sequence.',
      'The viewer has no model API, filesystem, shell, credentials or arbitrary business-tool provider. Obtain real data with the conversation tools before creating the interface. Existing permissions still apply.',
      'Incomplete or invalid final programs show diagnostics. Complete all references and components before ending the fence. Use the same field identity for the same user input and a different identity for different inputs.',
      'Compose a finished Whale Isle interface for the user task. Show one concise content title (Title md), a short explanation only when needed, then the working content. Do not add product names, demo captions, implementation notes, empty status bars or redundant readiness badges.',
      'Use the shared desktop typography and controls: body text md, secondary copy sm, section title sm, and md for the page title. Use 2xl or 3xl only for one meaningful numeric result, never for a sentence. Let default buttons keep their natural width; place one primary action and related outline/ghost actions together in a Row. Use block only when a deliberate full-width action is needed.',
      'All gap and padding arguments are counts of 4px, not pixels. For 8/12/16/20/24px use 2/3/4/5/6. Card(children,"soft",5,3) means 20px padding and 12px gap; Card(...,16,...) would create 64px padding and is excessive. Prefer default Card padding. Use 5 or 6 between sections, 3 within groups, 2 between label and value. Group related inputs in Grid with minChildWidth 240–280 so a narrow conversation stacks fields. Keep metrics in one plain Grid/Row with only the main result enlarged. Avoid wide fixed rows, a card per metric, oversized controls, centered prose and dense walls of badges.',
      'Use Card only for content that belongs together, not around the entire page or inside another card. Prefer plain sections, a restrained table or a chart with a small readable legend; do not stretch short cards to fill a tall neighbor. Use the existing semantic palette without custom CSS, decorative gradients or arbitrary font/colour overrides. Keep the initial conversation view short through focus and progressive disclosure, never by deleting requested content or shrinking text.',
    ],
    examples: [
      `A compact form puts its live result first and keeps detail available:
root = Col([Title("Estimate","md"), Row([Col([Caption("Total"),Title(@Format(total,"currency",2,"USD"),"2xl")],1),Spacer(),Button("Reset",@Reset($quantity,$price),"outline","primary","sm")],3), Grid([Input($quantity,"Quantity","number"),Input($price,"Unit price","number")],2,240,3), Details("Calculation",[Text(qty + " × " + price + " = " + total)])],5)
$quantity = 1
$price = 12
qty = @Clamp(@Default($quantity,0),0,1000)
price = @Clamp(@Default($price,0),0,10000)
total = qty * price`,
      `An editable collection keeps one array as its data, a focused editor and local add/delete/toggle actions:
root = Col([Title("Task list","md"),Text(@Count(@Filter($items,"done","==",false)) + " remaining"),Col(@Each($items,"t",Row([Button(t.done ? "Undo" : "Done",@Set($items,@Update($items,"id",t.id,"done",!t.done)),"ghost","primary","sm"),Text(t.name),Spacer(),Button("Edit",Action([@Set($selected,t.id),@Set($minutes,t.minutes)]),"outline","primary","sm"),Button("Delete",@Set($items,@Remove($items,"id",t.id)),"ghost","danger","sm")],2)),2),Details("Edit selected",[Text(selectedRow == null ? "Select a task to edit." : "Selected: " + selectedRow.name),selectedRow == null ? null : Input($minutes,"Minutes","number"),Button("Apply",@Set($items,@Update($items,"id",$selected,"minutes",@Clamp(@Default($minutes,0),0,10000))),"outline","primary","md",null,selectedRow == null)]),Row([Input($name,"New task"),Button("Add",Action([@Set($items,@Append($items,{id:$next,name:@Trim($name),minutes:15,done:false})),@Set($next,$next+1),@Reset($name)]),"solid","primary","md",null,@Trim($name)=="")],3)],4)
$items = [{id:1,name:"Preparation",minutes:30,done:false}]
$selected = 1
$minutes = 30
$next = 2
$name = ""
selectedRow = @Find($items,"id",$selected)`,
      `Numerical exploration can share a small diagram and live controls:
root = Col([Title("Circle area","md"),Slider($radius,1,4,0.1,"Radius"),Svg([Circle(120,75,$radius*12,"surface","ink",2),Line(120,75,120+$radius*12,75,"info",2),SvgText("r = " + @Round($radius,1),120,140,12,"muted","middle")],"0 0 240 160"),Text("Area " + @Round(3.14159265*$radius*$radius,2)),Details("How it changes",[Text("Area grows with the square of the radius.")])],4)
$radius = 2`,
      'root = Col([Plot({series: [{expr: "sin(x)"}], xMin: -6, xMax: 6})])',
    ],
  });
  const specialized = Object.entries(genuiSchema).map(([name, schema]) => {
    const fields = Object.entries(schema.fields).map(([field, type]) => `${field}${schema.required.includes(field) ? '' : '?'}:${schema.enums[field] ? schema.enums[field].join('|') : type}`).join(', ');
    return `${name}: {${fields}}`;
  }).join('\n');
  return [
    '## Interactive answers with Whale UI',
    'For a self-contained interactive answer, generate and display the page here. Treat supplied numbers, lists and rules as sufficient input; use tools only to obtain missing business facts. A request for an interactive page is not a request to inspect or modify the host GUI. Call render_ui with one complete program (or output one whale-ui fence). After success finish, without repeated summaries or another page.',
    'Initial layout: one short title, the answer/result row, then the controls and main content. Keep the initial page concise by placing full breakdowns, raw data, focused editing and long reasoning inside Details(label,[children]). All requested operations and information remain accessible. For 4/8/12/16/20/24px gap use 1/2/3/4/5/6. Use shared defaults; no custom skin. Before delivery check initial, empty, no-match and zero-weight states. For mechanisms include a labelled Svg with the controls, not only a chart.',
    language.replaceAll('openui-lang', 'whale-ui'),
    '## Specialized visual options',
    'Plot, Mermaid, Scene3D, EChart, Diagram, Blocks, Quiz, FileTree, Timeline, Steps, KeyValue, Diff, Json, Tabs and Accordion take an options object from the corresponding component below. Genui({items:[...]}) can combine these declarative components inside a normal Whale UI page. Local controls and field state use the same document owner. For quizzes and grouped forms, use stable ids/groups and submit to send their payload. Exported HTML keeps local controls; sending a message requires the conversation host.',
    specialized,
    'Use only the whale-ui fence for new generated interfaces. Existing openui, openui-lang and dsh-ui history remains readable through the same runtime.',
  ].join('\n\n');
}
