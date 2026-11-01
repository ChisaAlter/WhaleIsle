'use strict'
/** Pages the contrast audit renders; between them they exercise every control, named colour and surface the viewer ships. */

const controls = [
  'root = Col([Title("Controls","md"),Text("Body text with **bold**, `code` and a [link](https://example.com).","md"),Caption("Caption text"),Label("Field label"),'
    + 'Grid([Select($chip,[{value:"esp",label:"ESP32-S3 — 8 MB Flash / 512 KB SRAM"},{value:"nrf",label:"nRF52840 — 1 MB Flash / 256 KB SRAM"}],"Target chip"),Select($pick,["One","Two"],"Placeholder select","Choose one")],2,240,3),'
    + 'Grid([Input($name,"Name","text","Placeholder text"),Input($amount,"Amount","number"),TextArea($notes,"Notes","Notes placeholder",3),DatePicker($day,"Date")],2,240,3),'
    + 'SegmentedControl($seg,["Alpha","Beta","Gamma"]),Slider($vol,0,100,1,"Volume","%",[{value:0,label:"0"},{value:100,label:"100"}]),Checkbox($ok,"Checkbox label"),'
    + 'RadioGroup($rg,[{value:"a",label:"Option A",description:"Option A description"},{value:"b",label:"Option B"}],"Radio cards","cards"),RadioGroup($pill,["One","Two"],"Radio pills","pills"),'
    + 'Row([Button("Solid",@Set($n,1)),Button("Outline",@Set($n,1),"outline"),Button("Soft",@Set($n,1),"soft"),Button("Ghost",@Set($n,1),"ghost"),Button("Danger",@Set($n,1),"solid","danger"),Button("Success",@Set($n,1),"solid","success"),Button("Outline success",@Set($n,1),"outline","success")],2,"center","start",true),'
    + 'Pressable([Text("Pressable content")],@Set($n,1),true,3)],4)',
  '$chip = "esp"',
  '$pick = ""',
  '$name = ""',
  '$amount = 3',
  '$notes = ""',
  '$day = ""',
  '$seg = "Beta"',
  '$vol = 40',
  '$ok = true',
  '$rg = "a"',
  '$pill = "One"',
  '$n = 0',
].join('\n')

const display = [
  'root = Col([Title("Display","md"),'
    + 'Row([Badge("Neutral","neutral"),Badge("Info","info","info"),Badge("Success","success"),Badge("Warning","warning"),Badge("Danger","danger"),Badge("Purple","purple"),Badge("Pink","pink")],2,"center","start",true),'
    + 'Row([Text("Info","md","info"),Text("Success","md","success"),Text("Warning","md","warning"),Text("Danger","md","danger"),Text("Purple","md","purple"),Text("Pink","md","pink"),Text("Muted","md","muted"),Text("Faint","md","faint")],3,"center","start",true),'
    + 'Grid([Box([Text("Info tint")],"col",2,3,"info","md"),Box([Text("Success tint")],"col",2,3,"success","md"),Box([Text("Warning tint")],"col",2,3,"warning","md"),Box([Text("Danger tint")],"col",2,3,"danger","md")],4,160,3),'
    + 'Card([Text("Soft card"),Caption("Soft card caption")],"soft"),Card([Text("Outline card"),Caption("Outline card caption")],"outline"),'
    + 'Progress(40,100,"Progress","info"),Progress(70,100,"Success","success"),'
    + 'Table(["Name","Value"],[["Alpha",1],["Beta",2]]),'
    + 'Chart("bar",[{k:"A",v:3},{k:"B",v:5}],"k",["v"]),Chart("donut",[{k:"A",v:3},{k:"B",v:5}],"k",["v"]),'
    + 'List(["First item","Second item"]),Quote("Quoted text","Source"),Code("const answer = 42","js"),Link("Link text","https://example.com"),'
    + 'Details("Details label",[Text("Inside details")],true),Popover("Popover trigger","Popover content"),'
    + 'Svg([SvgText("Svg text",10,20,14,"ink"),SvgText("Muted svg text",10,40,14,"muted"),Rect(0,50,100,20,"surface","ink")],"0 0 200 80"),'
    + 'Markdown("# Heading\\n\\nParagraph with **bold**.\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |"),Icon("check","md","success"),Flashcard("Front text","Back text")],4)',
].join('\n')

const rich = [
  'root = Col([Title("Rich","md"),Timer($secs,"Timer"),'
    + 'Carousel([Card([Text("Slide one"),Caption("Caption")],"soft"),Card([Text("Slide two")],"outline")],240,3),'
    + 'List([ListItem("Timeline item","Description",null,[Caption("Child content")]),ListItem("Second item","More text")],"none",true),List(["Bullet one","Bullet two"],"bullet"),List(["Number one","Number two"],"number"),'
    + 'Quote("Quoted text","Source"),Code("function add(a, b) { return a + b }","js"),Math("E = mc^2"),'
    + 'Markdown("Paragraph with [a link](https://example.com), `inline code` and *emphasis*.\\n\\n> Block quote\\n\\n- item one\\n- item two\\n\\n```js\\nconst x = 1\\n```"),'
    + 'Flashcard("Front text","Back text","Hint text"),'
    + 'Chart("line",[{m:"Jan",a:3,b:2},{m:"Feb",a:5,b:4}],"m",["a","b"]),Chart("area",[{m:"Jan",a:3},{m:"Feb",a:5}],"m",["a"]),Chart("pie",[{k:"A",v:3},{k:"B",v:5},{k:"C",v:2}],"k",["v"]),Chart("scatter",[{x:1,y:2},{x:2,y:3},{x:3,y:5}],"x",["y"]),'
    + 'Table(["Status","Name"],[[Badge("OK","success"),"Alpha"],[Badge("Late","warning"),"Beta"],[Badge("Down","danger"),"Gamma"]]),'
    + 'Progress(30,100,"Info","info"),Progress(60,100,"Warning","warning"),Progress(80,100,"Danger","danger"),Progress(50,100,"Neutral","neutral"),'
    + 'Row([Icon("check","md","success"),Icon("triangle-alert","md","warning"),Icon("x","md","danger"),Icon("info","md","info"),Icon("star","md","purple"),Icon("heart","md","pink"),Icon("circle","md","muted")],3),'
    + 'Row([IconButton("plus",@Set($n,1),"Add","outline"),IconButton("minus",@Set($n,1),"Remove","ghost"),IconButton("check",@Set($n,1),"Done","solid")],2),'
    + 'Row([Button("Small",@Set($n,1),"solid","primary","sm"),Button("Large",@Set($n,1),"outline","primary","lg"),Button("Soft danger",@Set($n,1),"soft","danger"),Button("Ghost success",@Set($n,1),"ghost","success")],2,"center","start",true),'
    + 'Text("Done item","md","muted","normal",false,true),Text("Secondary small","sm","muted"),Caption("Danger caption","danger"),Caption("Success caption","success"),'
    + 'Svg([SvgText("Success label",10,20,14,"success"),SvgText("Warning label",10,40,14,"warning"),SvgText("Danger label",10,60,14,"danger"),SvgText("Info label",10,80,14,"info")],"0 0 240 100")],4)',
  '$secs = 90',
  '$n = 0',
].join('\n')

/** A model-written HtmlView: the select is transparent and uses theme ink, which is what produced white-on-white options. */
const html = [
  'root = Col([Title("HtmlView","md"),HtmlView("<label>Target chip<br><select style=\'background:transparent;color:var(--whale-fg);border:1px solid var(--whale-border);padding:6px 10px;border-radius:8px\'><option>ESP32-S3 — 8 MB Flash</option><option>nRF52840 — 1 MB Flash</option></select></label><p>Plain paragraph</p>",140)],4)',
].join('\n')

/** The declarative (dsh-ui / genui) component family shares the viewer but not the Whale UI stylesheet. */
const genui = {
  items: [
    { type: 'text', size: 'h2', content: 'Declarative page' },
    { type: 'text', content: 'Body text', tone: 'info' },
    { type: 'text', content: 'Danger text', tone: 'danger' },
    { type: 'text', content: 'Success text', tone: 'success' },
    { type: 'text', content: 'Warning text', tone: 'warning' },
    { type: 'text', content: 'Muted text', tone: 'muted' },
    { type: 'select', label: 'Target chip', options: ['ESP32-S3 — 8 MB Flash / 512 KB SRAM', 'nRF52840 — 1 MB Flash / 256 KB SRAM'], id: 'chip' },
    { type: 'input', label: 'Name', placeholder: 'Placeholder text', id: 'name' },
    { type: 'checkbox', label: 'Checkbox label' },
    { type: 'button', label: 'Primary', tone: 'primary' },
    { type: 'button', label: 'Danger', tone: 'danger' },
    { type: 'button', label: 'Ghost', tone: 'ghost' },
    { type: 'badge', label: 'Accent badge', tone: 'accent' },
    { type: 'badge', label: 'Success badge', tone: 'success' },
    { type: 'badge', label: 'Warn badge', tone: 'warn' },
    { type: 'badge', label: 'Danger badge', tone: 'danger' },
    { type: 'callout', tone: 'info', title: 'Info callout', content: 'Callout body' },
    { type: 'callout', tone: 'success', title: 'Success callout', content: 'Callout body' },
    { type: 'callout', tone: 'warning', title: 'Warning callout', content: 'Callout body' },
    { type: 'callout', tone: 'error', title: 'Error callout', content: 'Callout body' },
    { type: 'stat', label: 'Stat up', value: '42', delta: '+12%' },
    { type: 'stat', label: 'Stat down', value: '17', delta: '-3%' },
    { type: 'steps', current: 1, steps: [{ title: 'Done step', desc: 'Finished' }, { title: 'Current step', desc: 'In progress' }, { title: 'Next step', desc: 'Pending' }] },
    { type: 'progress', value: 60, label: 'Progress' },
    { type: 'table', columns: ['Name', 'Value'], rows: [['Alpha', '1'], ['Beta', '2']] },
  ],
}

const genuiMore = {
  items: [
    { type: 'hero', title: 'Hero title', subtitle: 'Hero subtitle', label: 'Eyebrow', value: '99.9%', delta: '+0.4%', tone: 'success' },
    { type: 'hero', title: 'Warning hero', subtitle: 'Hero subtitle', label: 'Eyebrow', value: '71%', delta: '-2.1%', tone: 'warning' },
    { type: 'hero', title: 'Danger hero', subtitle: 'Hero subtitle', label: 'Eyebrow', value: '12%', delta: '-8.0%', tone: 'danger' },
    { type: 'hero', title: 'Accent hero', subtitle: 'Hero subtitle', label: 'Eyebrow', value: '3.2x', delta: '+0.3x', tone: 'accent' },
    { type: 'card', title: 'Info card', eyebrow: 'Eyebrow', tone: 'info', items: [{ type: 'text', content: 'Card body' }] },
    { type: 'card', title: 'Success card', tone: 'success', items: [{ type: 'text', content: 'Card body' }] },
    { type: 'card', title: 'Warning card', tone: 'warning', items: [{ type: 'text', content: 'Card body' }] },
    { type: 'card', title: 'Danger card', tone: 'danger', items: [{ type: 'text', content: 'Card body' }] },
    { type: 'grid', cols: 2, items: [{ type: 'stat', label: 'Left stat', value: '12', delta: '+2%' }, { type: 'stat', label: 'Right stat', value: '8', delta: '-1%' }] },
    { type: 'progress', value: 70, label: 'Ring progress', variant: 'ring' },
    { type: 'switch', label: 'Switch label', checked: true },
    { type: 'slider', label: 'Slider label', min: 0, max: 10, value: 4 },
    { type: 'textarea', label: 'Notes', placeholder: 'Notes placeholder', rows: 3, id: 'notes' },
    { type: 'radio', label: 'Radio label', options: ['Option A', 'Option B'], selected: 0 },
    { type: 'link', label: 'Link label', href: 'https://example.com' },
    { type: 'avatar', name: 'Ada Lovelace' },
    { type: 'icon', name: 'check', label: 'Success icon', tone: 'success' },
    { type: 'icon', name: 'triangle-alert', label: 'Warning icon', tone: 'warning' },
    { type: 'icon', name: 'x', label: 'Danger icon', tone: 'danger' },
    { type: 'icon', name: 'info', label: 'Info icon', tone: 'info' },
    { type: 'icon', name: 'circle', label: 'Muted icon', tone: 'muted' },
    { type: 'breadcrumb', items: ['Home', 'Section', 'Page'] },
    { type: 'keyvalue', pairs: [{ key: 'Key one', value: 'Value one' }, { key: 'Key two', value: 'Value two' }] },
    { type: 'copy', label: 'Copy label', text: 'copied text' },
    { type: 'code', lang: 'js', code: 'const answer = 42\nfunction add(a, b) { return a + b }' },
    { type: 'json', value: { name: 'value', count: 3, ok: true, nested: { list: [1, 2] } } },
    { type: 'diff', diffs: [{ path: 'a.txt', oldText: 'old line', newText: 'new line' }] },
    { type: 'list', items: ['First item', { title: 'Second item', desc: 'Item description' }] },
    { type: 'timeline', items: [{ title: 'Event one', desc: 'Event description', time: '09:00' }, { title: 'Event two', time: '10:00' }] },
    { type: 'file-tree', items: [{ name: 'src', type: 'dir', children: [{ name: 'index.ts', type: 'file' }] }, { name: 'README.md', type: 'file' }] },
    { type: 'accordion', items: [{ title: 'Accordion title', items: [{ type: 'text', content: 'Accordion body' }] }] },
    { type: 'tabs', tabs: [{ label: 'First tab', items: [{ type: 'text', content: 'First body' }] }, { label: 'Second tab', items: [{ type: 'text', content: 'Second body' }] }] },
    { type: 'blocks', title: 'Blocks title', caption: 'Blocks caption', rows: [{ label: 'Row label', cells: ['One', 'Two', 'Three'] }, { label: 'Outline', variant: 'outline', cells: ['A', 'B'] }] },
    { type: 'chart', kind: 'bars', data: [{ label: 'Alpha', value: 3 }, { label: 'Beta', value: 5 }] },
    { type: 'chart', kind: 'donut', data: [{ label: 'Alpha', value: 3 }, { label: 'Beta', value: 5 }] },
    { type: 'divider' },
  ],
}

module.exports = [
  { name: 'controls', language: 'whale-ui', program: controls },
  { name: 'display', language: 'whale-ui', program: display },
  { name: 'rich', language: 'whale-ui', program: rich },
  { name: 'html-view', language: 'whale-ui', program: html },
  { name: 'declarative', language: 'dsh-ui', program: JSON.stringify(genui) },
  { name: 'declarative-more', language: 'dsh-ui', program: JSON.stringify(genuiMore) },
]
