import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';


const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const mapFixture = `
const probe=globalThis.__whaleMapProbe;
export function setWorkerUrl(url){probe.events.push(['worker',url]);}
export class Map {
 constructor(options){this.options=options;this.handlers={};this.sources={};this.layers={};this.loaded=false;probe.events.push(['map']);probe.maps.push(this);}
 addControl(){} on(type,fn){this.handlers[type]=fn;return this;} getZoom(){return 3;} flyTo(options){this.flight=options;} fitBounds(bounds){this.bounds=bounds;}
 isStyleLoaded(){return this.loaded;} getSource(id){return this.sources[id];} addSource(id,source){this.sources[id]={...source,setData(data){this.data=data}};}
 getLayer(id){return this.layers[id];} addLayer(layer){this.layers[layer.id]=layer;} removeLayer(id){delete this.layers[id];} removeSource(id){delete this.sources[id];}
 resize(){} remove(){this.removed=true;probe.events.push(['remove']);}
}
export class NavigationControl {constructor(options){this.options=options;}}
export class LngLatBounds {constructor(){this.points=[];}extend(point){this.points.push(point);return this;}}
export class Marker {constructor(options){this.options=options;probe.markers.push(this);}setLngLat(point){this.point=point;return this;}addTo(map){map.options.container.append(this.options.element);return this;}remove(){this.removed=true;this.options.element.remove();}}
`;
const mapPlugin = {name:'map-contract-fixture',setup(builder){builder.onResolve({filter:/^maplibre-gl$/},()=>({path:'mock-map',namespace:'map-fixture'}));builder.onLoad({filter:/.*/,namespace:'map-fixture'},()=>({contents:mapFixture,loader:'js'}));}};
const bundle = await build({ plugins:[mapPlugin], stdin: { contents: `export * from './library'; export * from './react'; export {chartColumns, chartDomain} from './components/chart'; export {htmlDocument} from './components/drawing'; export {routeCoordinates,markerData} from './components/map'; export {youtubeId} from './components/media';`, sourcefile:'component-tests.ts', resolveDir:base, loader:'ts' }, write:false, bundle:true, platform:'node', format:'cjs', jsx:'automatic', packages:'external', tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}}, alias:{'@whale-ui/react':path.join(base,'react/index.ts')}, logLevel:'silent' });
const loaded = {exports:{}};
new Function('require','module','exports', bundle.outputFiles[0].text)(require,loaded,loaded.exports);
const ui = loaded.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'https://whale.test/',pretendToBeVisual:true});
for (const name of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','MutationObserver']) Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true,writable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
let clipboard=[];
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>clipboard.push(text)},configurable:true});
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
async function mounted(source, options={}) {
  const element=document.createElement('div'); document.body.append(element); const root=createRoot(element); const states=[],errors=[],actions=[];
  const props={response:source,library:ui.library,onStateUpdate:s=>states.push(structuredClone(s)),onError:e=>errors.push(e),onAction:e=>{actions.push(e);return options.onAction?.(e)},...options};
  await act(async()=>root.render(React.createElement(ui.Renderer,props)));
  return {element,root,states,errors,actions,props,async change(next){await act(async()=>root.render(React.createElement(ui.Renderer,{...props,...next})))},async close(){await act(async()=>root.unmount());element.remove();}};
}
const button=(element,text)=>[...element.querySelectorAll('button')].find(button=>button.textContent.trim()===text);
const click=async target=>{assert.ok(target,'target must exist');await act(async()=>target.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
async function typeInput(input,value) {
  const prototype=input.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  await act(async()=>{Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
}

test('registry retains 55 components, 59 data functions, ordered argument schemas and extensibility',()=>{
  assert.equal(ui.componentDefinitions.length,55);assert.equal(ui.functionDefinitions.length,59);
  const names=ui.componentDefinitions.map(c=>c.name); assert.equal(new Set(names).size,55);
  for(const name of ['Table','Chart','Svg','Map','MapMarker','SearchImage','HtmlView','YouTube','Math','Timer','Flashcard'])assert.ok(names.includes(name));
  assert.deepEqual(Object.keys(ui.library.components.Input.props.shape),['value','label','type','placeholder']);
  assert.deepEqual(Object.keys(ui.library.components.Chart.props.shape),['type','data','x','series','format','currency','stacked','height']);
  const extra=ui.defineComponent({name:'Extra',props:ui.library.components.Label.props,description:'test',component:()=>null});
  assert.equal(Object.keys(ui.createWhaleLibrary([extra]).components).length,56);assert.equal(Object.keys(ui.library.components).length,55);
  const guide=ui.generateWhaleGuide();assert.match(guide,/Whale UI/);assert.match(guide,/HtmlView/);assert.match(guide,/@Allocate/);
});

test('real renderer mounts layout, Markdown, table cells, SVG and KaTeX',async()=>{
 const app=await mounted('root = Col([Title("Overview"), Text("**Bold** and *italic*"), Card([Row([Badge("Ready", "success", "check"), Spacer(), Caption("Details")])]), Box([Grid([Label("A"), Label("B")])]), List(["one", ListItem("two", "description", "2")]), Quote("quoted", "source"), Markdown("# Heading\\n\\n| Name | Count |\\n| --- | ---: |\\n| A | 2 |\\n\\n- item"), Code("x = 1", "js"), Math("x^2"), Table(["Name", "Count", "Action"], [["A", 2, Button("Cell", @Set($n, 4))]]), Svg([G([Rect(0, 0, 10, 20, "info"), Circle(20, 20, 5, "success"), Ellipse(30, 20, 4, 2), Line(0, 0, 5, 5), Path("M0 0L1 1"), Polyline("0,0 1,1"), Polygon("0,0 1,1 1,0"), SvgText("SVG", 10, 10)])], "0 0 100 100")])\n$n = 1');
 try{assert.match(app.element.textContent,/Overview/);assert.equal(app.element.querySelector('strong')?.textContent,'Bold');assert.equal(app.element.querySelectorAll('.whale-table').length,2);assert.equal(app.element.querySelector('td:nth-child(2)')?.style.textAlign,'right');assert.ok(app.element.querySelector('.katex'));assert.equal(app.element.querySelector('svg.whale-svg rect')?.getAttribute('fill'),'var(--whale-accent)');assert.equal(app.element.querySelectorAll('svg.whale-svg g>*').length,8);assert.ok(!app.errors.flat().some(error=>error.severity==='error'));}finally{await app.close();}
});

test('documented and current Lucide names render their intended glyph instead of a help placeholder',async()=>{
 const app=await mounted('root = Col([Icon("check-circle"),Icon("circle-check"),Icon("alert-circle"),Icon("loader-2"),Icon("icon")])');
 try{const glyphs=[...app.element.querySelectorAll('svg')];assert.equal(glyphs.length,5);assert.ok(glyphs[0].classList.contains('lucide-circle-check-big'));assert.ok(glyphs[1].classList.contains('lucide-circle-check'));assert.ok(!glyphs.slice(0,4).some(e=>e.classList.contains('lucide-circle-help')));assert.ok(glyphs[4].classList.contains('lucide-circle-question-mark'));}finally{await app.close();}
});

test('numeric input follows shared Reset values and clears to null rather than zero',async()=>{
 const app=await mounted('root = Col([Input($n, "Count", "number"), Text($n + ""), Button("Change", @Set($n, 9)), Button("Reset", @Reset($n))])\n$n = 3');
 try{const input=app.element.querySelector('input');assert.equal(input.value,'3');await click(button(app.element,'Change'));assert.equal(input.value,'9');await click(button(app.element,'Reset'));assert.equal(input.value,'3');await typeInput(input,'');assert.equal(input.value,'');assert.equal(app.states.at(-1)?.$n,null);assert.ok(!app.errors.at(-1)?.length,JSON.stringify(app.errors.at(-1)));}finally{await app.close();}
});

test('ordinary numeric fields retain explicit null after clearing and hydration',async()=>{
 const source='root = Col([Form([Input(3, "Count", "number"), Button("Send")])])';let app=await mounted(source);
 try{await typeInput(app.element.querySelector('input'),'');assert.equal(app.element.querySelector('input').value,'');await click(button(app.element,'Send'));assert.ok(JSON.stringify(app.actions[0].formState).includes('"Count":null'));const snapshot=app.states.at(-1);await app.close();app=await mounted(source,{initialState:snapshot});assert.equal(app.element.querySelector('input').value,'');}finally{await app.close();}
});

test('mixed form retains bound and ordinary fields, preserving values with object.value',async()=>{
 const app=await mounted('root = Col([Form([Input($qty, "Quantity", "number"), Input("draft", "Note"), Checkbox($ok, "Confirmed"), Button("Send")]), Text($item.unit)])\n$qty = 7\n$ok = true\n$item = {value: 10, unit: "kg"}');
 try{const inputs=app.element.querySelectorAll('input');await typeInput(inputs[1],'edited note');await click(button(app.element,'Send'));assert.equal(app.actions.length,1);const state=app.actions[0].formData??app.actions[0].data??app.actions[0].formState;assert.ok(JSON.stringify(app.actions[0]).includes('edited note'));assert.ok(JSON.stringify(app.actions[0]).includes('7'));assert.match(app.element.textContent,/kg/);}finally{await app.close();}
});

test('button surfaces failed host acknowledgement and ordered actions read fresh state',async()=>{
 const seen=[];const app=await mounted('root = Col([Text($n + ""), Button("Go", Action([@Set($n, $n + 1), @CopyToClipboard($n + "")]))])\n$n = 1',{onAction:async event=>{seen.push(event);if(event.type==='CopyToClipboard')throw new Error('Clipboard unavailable')}});
 try{await click(button(app.element,'Go'));assert.ok(seen.some(e=>e.type==='CopyToClipboard'&&e.params.text==='2'));assert.match(app.element.textContent,/Clipboard unavailable/);assert.equal(button(app.element,'Go').disabled,false);}finally{await app.close();}
});

test('Timer running deadline, baseline and Flashcard face survive unmount hydration',async()=>{
 let now=1_700_000_000_000;const originalNow=Date.now;Date.now=()=>now;
 const source='root = Col([Timer($left, "Countdown"), Flashcard("Question", "Answer"), Button("Zero", @Set($left, 0))])\n$left = 10';
 let app;
 try{
  app=await mounted(source);await click(button(app.element,'Start'));await click(app.element.querySelector('.whale-flashcard'));assert.match(app.element.querySelector('.whale-flashcard').textContent,/Answer/);
  const snapshot=app.states.at(-1);assert.ok(snapshot?.__whale_component_state__);await app.close();app=null;now+=4000;
  app=await mounted(source,{initialState:snapshot});assert.equal(app.element.querySelector('[role=timer]').textContent,'0:06');assert.match(app.element.querySelector('.whale-flashcard').textContent,/Answer/);await click(button(app.element,'Pause'));await click(button(app.element,'Reset'));assert.equal(app.element.querySelector('[role=timer]').textContent,'0:10');
  await click(button(app.element,'Zero'));assert.equal(app.element.querySelector('[role=timer]').textContent,'0:00');assert.equal(button(app.element,'Start').disabled,true);
 }finally{if(app)await app.close();Date.now=originalNow;}
});

test('all chart types preserve labels and numeric series; stacked negative domain is correct',async()=>{
 assert.deepEqual(ui.chartColumns([{label:'A',count:2,cost:3}],undefined,undefined),{x:'label',series:['count','cost']});
 const domain=ui.chartDomain([{a:3,b:-7},{a:4,b:5}],['a','b'],true);assert.ok(domain.min<-7&&domain.max>9);
 for(const type of ['bar','line','area','pie','donut','scatter']){
  const app=await mounted(`root = Col([Chart("${type}", [{label:"Jan",x:1,a:2,b:3},{label:"Feb",x:2,a:4,b:5}], "${type==='scatter'?'x':'label'}", ["a","b"])])`);
  try{assert.ok(app.element.querySelector('svg[role=img]'));assert.ok(app.element.querySelectorAll('title').length>=3);if(!['pie','donut'].includes(type)){assert.match(app.element.textContent,type==='scatter'?/1/:/Jan/);await click(app.element.querySelector('.whale-chart-key'));assert.equal(app.element.querySelector('.whale-chart-key').getAttribute('aria-pressed'),'false');}}finally{await app.close();}
 }
});

test('chart resizes labels to the conversation width and disconnects its observer',async()=>{
 const originalObserver=globalThis.ResizeObserver;let observe,disconnected=0;
 globalThis.ResizeObserver=class{constructor(callback){observe=callback;}observe(){}disconnect(){disconnected++;}};
 const app=await mounted('root = Col([Chart("bar",[{month:"Jan",amount:2},{month:"Feb",amount:3},{month:"Mar",amount:4},{month:"Apr",amount:5},{month:"May",amount:6},{month:"Jun",amount:7}],"month",["amount"])])');
 try{
  await act(async()=>observe([{contentRect:{width:300}}]));
  const svg=app.element.querySelector('svg');assert.equal(svg.getAttribute('viewBox'),'0 0 300 240');
  assert.ok([...svg.querySelectorAll('text')].every(e=>Number(e.getAttribute('font-size'))>=12));
  assert.ok([...svg.querySelectorAll('text')].filter(e=>/Jan|Feb|Mar|Apr|May|Jun/.test(e.textContent)).length<=3);
  await click(app.element.querySelector('.whale-chart-key'));assert.equal(app.element.querySelector('.whale-chart-key').getAttribute('aria-pressed'),'false');
 }finally{await app.close();globalThis.ResizeObserver=originalObserver;}
 assert.equal(disconnected,1);
});

test('HtmlView theme updates keep identical frame/document and send an authenticated child message',async()=>{
 const app=await mounted('root = Col([HtmlView("<input value=retained><script>window.counter=1</script>", 160, "Stateful child")])');
 try{const frame=app.element.querySelector('iframe'),content=frame.contentWindow;assert.equal(frame.getAttribute('sandbox'),'allow-scripts');assert.match(frame.srcdoc,/connect-src 'none'/);const source=frame.srcdoc,messages=[];content.postMessage=message=>messages.push(message);document.documentElement.style.setProperty('--whale-accent','#336699');await act(async()=>{document.documentElement.dataset.theme='dark';await new Promise(resolve=>queueMicrotask(resolve));});assert.equal(app.element.querySelector('iframe'),frame);assert.equal(frame.contentWindow,content);assert.equal(frame.srcdoc,source);assert.equal(messages.at(-1)?.type,'theme');assert.equal(messages.at(-1)?.dark,true);assert.equal(messages.at(-1)?.tokens['--whale-accent'],'#336699');assert.ok(source.includes('<script>window.counter=1</script>'));}finally{document.documentElement.removeAttribute('data-theme');await app.close();}
});

test('SearchImage aborts obsolete requests and Image recovers through the same resource API',async()=>{
 const originalFetch=globalThis.fetch;const requests=[];globalThis.fetch=async(url,init)=>{requests.push({url,signal:init.signal});return {ok:true,json:async()=>({images:['https://images.test/photo.jpg']})}};
 let app;
 try{app=await mounted('root = Col([SearchImage("Kyoto temple"), Image("https://bad.test/image.png", "Tokyo tower")])');assert.equal(app.element.querySelector('img').src,'https://images.test/photo.jpg');await act(async()=>app.element.querySelectorAll('img')[1].dispatchEvent(new Event('error')));assert.ok(requests.some(r=>r.url.includes('Tokyo%20tower')));await app.change({response:'root = Col([SearchImage("Osaka castle")])'});assert.ok(requests[0].signal.aborted);assert.ok(requests.some(r=>r.url.includes('Osaka%20castle')));}finally{if(app)await app.close();globalThis.fetch=originalFetch;}
});

test('map route pair contract and video host parsing retain bounded, explicit behavior',()=>{
 assert.deepEqual(ui.routeCoordinates([[35,139],[36,140]]),[[139,35],[140,36]]);assert.equal(ui.markerData({props:{label:'A',lat:100,lng:0}}),null);assert.equal(ui.markerData({props:{label:'A',lat:35,lng:139}}).label,'A');
 assert.equal(ui.youtubeId('https://youtu.be/dQw4w9WgXcQ'),'dQw4w9WgXcQ');assert.equal(ui.youtubeId('https://evil.test/watch?v=dQw4w9WgXcQ'),undefined);
});

test('Map configures worker, draws early route after delayed load, selects and releases obsolete engine',async()=>{
 const originalFetch=globalThis.fetch, probe={events:[],maps:[],markers:[]}, requests=[];globalThis.__whaleMapProbe=probe;globalThis.__WHALE_MAP_WORKER_URL__='blob:owned-worker';
 globalThis.fetch=async(url,init)=>{requests.push({url,signal:init.signal});return {ok:true,json:async()=>({points:[[35,139],[36,140]]})}};
 let app;
 try{
  app=await mounted('root = Col([Map([MapMarker("First", 35, 139, "Start"), MapMarker("Second", 36, 140, "End")], true, $selected), Text($selected)])\n$selected = "First"');
  assert.deepEqual(probe.events.slice(0,2),[['worker','blob:owned-worker'],['map']]);assert.equal(probe.maps.length,1);assert.ok(requests[0].url.includes('139%2C35%3B140%2C36'));
  const map=probe.maps[0];await act(async()=>{map.loaded=true;map.handlers.load();});
  assert.deepEqual(map.sources['whale-street-route'].data.geometry.coordinates,[[139,35],[140,36]]);assert.equal(probe.markers[0].options.element.dataset.selected,'true');assert.deepEqual(map.bounds.points,[[139,35],[140,36]]);
  await click(probe.markers[1].options.element);assert.equal(app.states.at(-1).$selected,'Second');assert.deepEqual(map.flight.center,[140,36]);
  await app.change({response:'root = Col([Map([MapMarker("Third", 37, 141)], false)])'});assert.equal(map.removed,true);assert.ok(probe.markers.every(m=>m.removed));assert.equal(requests[0].signal.aborted,true);
  await app.close();app=null;assert.ok(probe.maps.every(map=>map.removed));
 }finally{if(app)await app.close();globalThis.fetch=originalFetch;delete globalThis.__whaleMapProbe;delete globalThis.__WHALE_MAP_WORKER_URL__;}
});

test('Chinese host locale localizes component chrome without changing model content',async()=>{
 document.documentElement.lang='zh-CN';const app=await mounted('root = Col([Timer($n), Flashcard("题目", "答案"), Code("const x=1"), Button("用户按钮"), Map([])])\n$n = 2');
 try{assert.match(app.element.textContent,/开始/);assert.match(app.element.textContent,/重置/);assert.match(app.element.textContent,/复制/);assert.match(app.element.textContent,/点击显示答案/);assert.match(app.element.textContent,/没有有效的地图位置/);assert.match(app.element.textContent,/用户按钮/);}finally{await app.close();document.documentElement.lang='';}
});

test('charts with entirely numeric data keep the first numeric key as a series',()=>{
 assert.deepEqual(ui.chartColumns([{value:2},{value:4}]),{x:undefined,series:['value']});
});

test('remaining input controls and Popover expose local interactions accessibly',async()=>{
 const app=await mounted('root = Col([TextArea($note, "Notes"), Select($choice, ["A", "B"], "Select"), SegmentedControl($choice, ["A", "B"]), Slider($n, 0, 10, 1, "Amount", "%", [{value:0,label:"Low"},{value:10,label:"High"}]), Checkbox($checked, "Done", true), RadioGroup($choice, [{value:"A",label:"Alpha",description:"first"},{value:"B",label:"Beta"}], "Pick", "cards"), DatePicker($date, "When"), Popover("Details", "More"), Pressable([Label("Tile")], @Set($n, 5), $n == 5), IconButton("plus", @Set($n, $n + 1), "Add"), Divider(), Carousel([Label("One"),Label("Two")]), Image("https://images.test/ok.png", "Photo"), YouTube("dQw4w9WgXcQ", "Video"), Celebration(false)])\n$note = "text"\n$choice = "A"\n$n = 2\n$checked = false\n$date = "2026-10-20"');
 try{assert.equal(app.element.querySelector('textarea').value,'text');assert.equal(app.element.querySelector('select').value,'A');await click([...app.element.querySelectorAll('[role=radio]')].find(b=>b.textContent==='B'));assert.equal(app.element.querySelector('select').value,'B');await click(button(app.element,'Details'));assert.equal(app.element.querySelector('[role=dialog]').textContent,'More');await click(app.element.querySelector('.whale-pressable'));assert.equal(app.element.querySelector('.whale-pressable').getAttribute('aria-pressed'),'true');await click(app.element.querySelector('button[aria-label=Add]'));assert.equal(app.element.querySelector('.whale-range').value,'6');assert.ok(app.element.querySelector('.whale-youtube').src.startsWith('https://www.youtube-nocookie.com/embed/'));assert.equal(app.element.querySelector('input[type=date]').value,'2026-10-20');}finally{await app.close();}
});
