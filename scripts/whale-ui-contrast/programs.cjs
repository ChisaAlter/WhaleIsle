'use strict'
/** Pages the contrast audit renders; between them they exercise every control, named colour and surface the viewer ships. */

const controls = [
  'root = Col([Title("Controls","md"),Text("Body text with **bold**, `code` and a [link](https://example.com).","md"),Caption("Caption text"),Label("Field label"),'
    + 'Grid([Select($chip,[{value:"esp",label:"ESP32-S3 — 8 MB Flash / 512 KB SRAM"},{value:"nrf",label:"nRF52840 — 1 MB Flash / 256 KB SRAM"}],"Target chip"),Select($pick,["One","Two"],"Placeholder select","Choose one")],2,240,3),'
    + 'Grid([Input($name,"Name","text","Placeholder text"),Input($amount,"Amount","number"),TextArea($notes,"Notes","Notes placeholder",3),DatePicker($day,"Date")],2,240,3),'
    + 'SegmentedControl($seg,["Alpha","Beta","Gamma"]),Slider($vol,0,100,1,"Volume","%",[{value:0,label:"0"},{value:100,label:"100"}]),Checkbox($ok,"Checkbox label"),'
    + 'RadioGroup($rg,[{value:"a",label:"Option A",description:"Option A description"},{value:"b",label:"Option B"}],"Radio cards","cards"),RadioGroup($pill,["One","Two"],"Radio pills","pills"),'
    + 'Row([Button("Solid",@Set($n,1)),Button("Outline",@Set($n,1),"outline"),Button("Soft",@Set($n,1),"soft"),Button("Ghost",@Set($n,1),"ghost"),Button("Danger",@Set($n,1),"solid","danger"),Button("Success",@Set($n,1),"outline","success")],2,"center","start",true),'
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

module.exports = [
  { name: 'controls', language: 'whale-ui', program: controls },
  { name: 'display', language: 'whale-ui', program: display },
  { name: 'html-view', language: 'whale-ui', program: html },
  { name: 'declarative', language: 'dsh-ui', program: JSON.stringify(genui) },
]
