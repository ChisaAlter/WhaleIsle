import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadGenui, installDom, changeInput, React } from './genui-helpers.mjs'
const env = installDom()
const requireLocal = createRequire(new URL('../package.json', import.meta.url))
const { createRoot } = requireLocal('react-dom/client')
const { act } = React
const api = await loadGenui(`
 export { GenuiBlock } from './genui/client/GenuiBlock.tsx'
 export { EChartNode, presetOption } from './genui/client/EChartNode.tsx'
 export { Scene3DNode } from './genui/client/blocks/advanced.tsx'
 export { setGenuiAssetLoader } from './genui/client/asset-loader.ts'
 export { setLocale } from './genui/client/i18n/runtime.ts'
 export { processGenuiSpec } from './genui/client/guard.ts'
`)
api.setLocale('en')
let root
const h = React.createElement
async function render(element) { if (!root) root = createRoot(env.container); await act(async () => root.render(element)) }
async function click(element) { await act(async () => element.click()) }
async function unmount() { if (root) { await act(async () => root.unmount()); root = undefined } }
test.afterEach(unmount)
test.after(() => env.restore())

test('G3 tabs isolate same-position controls and restore edited values', async () => {
  let snapshot
  const spec = { items: [{ type: 'tabs', tabs: [
    { label: 'A', items: [{ type: 'input', id: 'a', label: 'Field A', value: 'Alpha' }] },
    { label: 'B', items: [{ type: 'input', id: 'b', label: 'Field B', value: 'Beta' }] },
  ] }] }
  await render(h(api.GenuiBlock, { spec, stateKey: 'doc:tabs', onStateChange: state => { snapshot = state } }))
  assert.equal(env.container.querySelector('input').value, 'Alpha')
  await act(async () => changeInput(env.container.querySelector('input'), 'Edited Alpha'))
  assert.equal(env.container.querySelector('input').value, 'Edited Alpha')
  await click(env.container.querySelectorAll('[role=tab]')[1])
  assert.equal(env.container.querySelector('input').value, 'Beta')
  assert.equal(snapshot.fields.a, 'Edited Alpha')
  assert.equal(snapshot.fields.b, 'Beta')
  await act(async () => changeInput(env.container.querySelector('input'), 'Edited Beta'))
  await click(env.container.querySelectorAll('[role=tab]')[0])
  assert.equal(env.container.querySelector('input').value, 'Edited Alpha')
  await unmount()
  await render(h(api.GenuiBlock, { spec, stateKey: 'doc:tabs', initialState: snapshot }))
  assert.equal(env.container.querySelector('input').value, 'Edited Alpha')
  await click(env.container.querySelectorAll('[role=tab]')[1])
  assert.equal(env.container.querySelector('input').value, 'Edited Beta')
})
test('direct rendering exposes unsupported components instead of a silent null', async () => {
  const spec = {items:[{type:'text',content:'Visible text'},{type:'imaginary'}]}
  await render(h(api.GenuiBlock,{spec}))
  assert(env.container.textContent.includes('Visible text'))
  const alert = env.container.querySelector('[data-genui-unsupported]')
  assert.equal(alert.getAttribute('role'),'alert')
  assert(alert.textContent.includes('imaginary'))
  assert(alert.textContent.includes('items[1]'))
})

test('G7 direct onAction waits for host success and surfaces failure', async () => {
  let resolveAck
  const calls = []
  const handler = (action, payload) => { calls.push({action, payload}); return new Promise(resolve => { resolveAck = resolve }) }
  const spec = { items: [{ type: 'button', label: 'Go', action: 'go' }] }
  await render(h(api.GenuiBlock, { spec, onAction: handler }))
  assert.equal(env.container.querySelector('button').disabled, false)
  await click(env.container.querySelector('button'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'go')
  assert(!env.container.textContent.includes('Queued'))
  assert(env.container.textContent.includes('Sending'))
  await act(async () => resolveAck({ status: 'failed', message: 'Queue unavailable' }))
  assert(env.container.textContent.includes('Queue unavailable'))
  assert(!env.container.textContent.includes('Queued'))
  await render(h(api.GenuiBlock, { spec, onAction: async () => ({status:'queued'}) }))
  await click(env.container.querySelector('button'))
  assert(env.container.textContent.includes('Queued'))
})
test('G8 allowed nested tabs render at the same depth as validation', async () => {
  let node = { type: 'text', content: 'deep leaf' }
  for (let index = 0; index < 5; index++) node = { type: 'tabs', tabs: [{label: `T${index}`, items: [node]}] }
  const processed = api.processGenuiSpec({items:[node]})
  assert.deepEqual(processed.errors, [])
  await render(h(api.GenuiBlock, { spec: processed.spec }))
  assert(env.container.textContent.includes('deep leaf'))
})
test('G8 latest radio state is published before immediate unmount, without browser storage', async () => {
  let snapshot
  Object.defineProperty(env.dom.window, 'localStorage', { configurable: true, get() { throw new Error('runtime storage forbidden') } })
  const spec = {items:[{type:'radio', group:'q', options:['One','Two']}]}
  await render(h(api.GenuiBlock, {spec, onStateChange: value => {snapshot = value}}))
  await act(async () => { env.container.querySelectorAll('input')[1].click(); root.unmount(); root = undefined })
  assert.equal(snapshot.answers.q, 'Two')
  await render(h(api.GenuiBlock, {spec, initialState:snapshot}))
  assert.equal(env.container.querySelectorAll('input')[1].checked, true)
})
test('controlled external snapshots replace values without remounting', async () => {
  const spec = {items:[{type:'input',id:'f',value:'default'}]}
  await render(h(api.GenuiBlock, {spec, initialState:{fields:{f:'first'}}}))
  const input = env.container.querySelector('input')
  await render(h(api.GenuiBlock, {spec, initialState:{fields:{f:'second'}}}))
  assert.equal(env.container.querySelector('input'), input)
  assert.equal(input.value, 'second')
})
test('secret values never appear in an initial snapshot or emitted state', async () => {
  const states = []
  const spec = {items:[{type:'input',id:'secret',inputType:'password',value:'model secret'},{type:'input',id:'public',value:'safe'}]}
  await render(h(api.GenuiBlock, {spec,initialState:{fields:{secret:'restored secret'}},onStateSnapshot:value=>states.push(value)}))
  assert.equal(env.container.querySelectorAll('input')[0].value,'')
  await act(async () => changeInput(env.container.querySelectorAll('input')[0], 'typed secret'))
  assert(states.every(state => state.fields?.secret === undefined))
  assert(states.every(state => !JSON.stringify(state.componentState ?? {}).includes('typed secret')))
})
test('presentation state for ungrouped controls survives owner snapshot round-trip', async () => {
  let snapshot
  const spec = {items:[{type:'checkbox',label:'Remember'},{type:'switch',label:'Power'}]}
  await render(h(api.GenuiBlock,{spec,onStateChange:value=>{snapshot=value}}))
  await click(env.container.querySelector('input'))
  await click(env.container.querySelector('[role=switch]'))
  await unmount()
  await render(h(api.GenuiBlock,{spec,initialState:snapshot}))
  assert.equal(env.container.querySelector('input').checked,true)
  assert.equal(env.container.querySelector('[role=switch]').getAttribute('aria-checked'),'true')
})

test('table details keep original row identity after filtering and restore expanded state', async () => {
  let snapshot
  const spec = {items:[{type:'input',id:'filter',value:'Beta'},{type:'table',columns:['Name'],rows:[['Alpha'],['Beta']],filter:'filter',details:[[{type:'input',id:'a',value:'Detail Alpha'}],[{type:'input',id:'b',value:'Detail Beta'}]]}]}
  await render(h(api.GenuiBlock,{spec,onStateChange:value=>{snapshot=value}}))
  assert(!env.container.textContent.includes('Alpha'))
  const expand = env.container.querySelector('button[aria-expanded]')
  await click(expand)
  assert.equal(env.container.querySelectorAll('input')[1].value,'Detail Beta')
  await act(async () => changeInput(env.container.querySelectorAll('input')[1],'Edited Detail Beta'))
  await unmount()
  await render(h(api.GenuiBlock,{spec,initialState:snapshot}))
  assert.equal(env.container.querySelectorAll('input')[1].value,'Edited Detail Beta')
})
test('local grading survives remount and retry clears answers and unlocks controls', async () => {
  let snapshot
  const spec = {items:[{type:'radio',group:'q',options:['One','Two'],answer:1},{type:'submit',label:'Grade',groups:['q']}]}
  await render(h(api.GenuiBlock,{spec,onStateChange:value=>{snapshot=value}}))
  await click(env.container.querySelectorAll('input')[1])
  await click(env.container.querySelector('button'))
  assert.equal(env.container.querySelector('input').disabled,true)
  await unmount()
  await render(h(api.GenuiBlock,{spec,initialState:snapshot}))
  assert(env.container.querySelector('[data-genui-grade]'))
  await click(env.container.querySelector('button'))
  assert.equal(env.container.querySelector('input').disabled,false)
  assert.equal(env.container.querySelectorAll('input')[1].checked,false)
})

test('G10 series-only preset categories survive all axis-based shorthand presets', () => {
  for (const preset of ['bar','line','area','bigline']) {
    const option = api.presetOption({type:'echart',preset,series:[{label:'Sales',data:[{label:'Jan',value:10},{label:'Feb',value:20}]}]})
    assert.deepEqual(option.xAxis.data, ['Jan','Feb'])
    assert.deepEqual(option.series[0].data, [10,20])
  }
})
test('G10 changing a core chart to radar reinitializes the engine and disposes both instances', async () => {
  const created = [], disposed = []
  api.setGenuiAssetLoader(async name => ({createChart: async (_el, option) => {
    created.push(name)
    return {setOption() {},resize() {},dispose() {disposed.push(name)}}
  }}))
  const data = [{label:'A',value:10}]
  await render(h(api.EChartNode, {node:{type:'echart',preset:'bar',data}}))
  await render(h(api.EChartNode, {node:{type:'echart',preset:'radar',data}}))
  assert.deepEqual(created, ['echarts-core','echarts-full'])
  assert.deepEqual(disposed, ['echarts-core'])
  await unmount()
  assert.deepEqual(disposed, ['echarts-core','echarts-full'])
})
async function freshDiagnosticsApi() {
  return loadGenui(`
    export { GenuiBlock } from './genui/client/GenuiBlock.tsx'
    export { setGenuiAssetLoader } from './genui/client/asset-loader.ts'
    export { setLocale } from './genui/client/i18n/runtime.ts'
  `)
}
async function settleUntil(predicate) {
  for (let attempt = 0; attempt < 40 && !predicate(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  assert(predicate(), 'async render result was not observed')
}
test('rejected EChart bundle signals source/path failure once and source removal clears it', async () => {
  const local = await freshDiagnosticsApi(), snapshots = []
  local.setLocale('en')
  let loads = 0
  local.setGenuiAssetLoader(async () => { loads++; throw new Error('Host bundle refused') })
  const spec = {items:[{type:'input',id:'n',value:'7'},{type:'echart',preset:'bar',data:[{label:'A',value:1}]}]}
  const callback = snapshot => snapshots.push(snapshot)
  await render(h(local.GenuiBlock,{spec,diagnosticSourceId:'source-a',onRenderDiagnostics:callback}))
  const failure = snapshots.at(-1)
  assert.equal(failure.sourceId,'source-a')
  assert.deepEqual(failure.diagnostics,[{code:'engine-error',component:'echart',path:'items[1]',message:'Host bundle refused'}])
  assert(env.container.querySelector('[role=alert]').textContent.includes('Host bundle refused'))
  const count = snapshots.length
  await render(h(local.GenuiBlock,{spec,diagnosticSourceId:'source-a',onRenderDiagnostics:value=>snapshots.push(value)}))
  assert.equal(loads,1)
  assert.equal(snapshots.length,count)
  const input = env.container.querySelector('input')
  await render(h(local.GenuiBlock,{spec:{items:[spec.items[0]]},diagnosticSourceId:'source-b',onRenderDiagnostics:callback}))
  assert.equal(env.container.querySelector('input'),input)
  assert.equal(input.value,'7')
  assert(snapshots.some(snapshot => snapshot.sourceId === 'source-a' && snapshot.diagnostics.length === 0))
  assert.deepEqual(snapshots.at(-1),{sourceId:'source-b',diagnostics:[]})
  await unmount()
  assert.deepEqual(snapshots.at(-1),{sourceId:'source-b',diagnostics:[]})
})
test('EChart option failures signal once and changed option recovers without remount', async () => {
  const local = await freshDiagnosticsApi(), snapshots = [], updates = []
  local.setLocale('en')
  local.setGenuiAssetLoader(async () => ({createChart:() => ({setOption(option) { updates.push(option); if (option.fail) throw new Error('Option rejected') },resize(){},dispose(){}})}))
  const bad = {items:[{type:'echart',option:{fail:true}}]}
  const callback = value=>snapshots.push(value)
  await render(h(local.GenuiBlock,{spec:bad,diagnosticSourceId:'same',onRenderDiagnostics:callback}))
  assert.equal(updates.length,1)
  assert.equal(snapshots.at(-1).diagnostics[0].message,'Option rejected')
  const canvas = env.container.querySelector('[role=img]')
  await render(h(local.GenuiBlock,{spec:{items:[{type:'echart',option:{series:[]}}]},diagnosticSourceId:'same',onRenderDiagnostics:callback}))
  assert.equal(env.container.querySelector('[role=img]'),canvas)
  assert.equal(updates.length,2)
  assert.deepEqual(snapshots.at(-1).diagnostics,[])
  assert.equal(env.container.querySelector('[role=alert]'),null)
})
test('Mermaid and Three caught failures aggregate and clear after source recovery', async () => {
  const local = await freshDiagnosticsApi(), snapshots = []
  local.setLocale('en')
  Object.defineProperty(document,'hidden',{configurable:true,value:false})
  let failMermaid = true, failThree = true
  local.setGenuiAssetLoader(async name => name === 'mermaid' ? {renderMermaid:async () => {if(failMermaid) throw new Error('Mermaid layout failed');return '<svg></svg>'}} : {mountScene:async () => {if(failThree) throw new Error('WebGL unavailable');return ()=>{}}})
  const callback = value => snapshots.push(value)
  const spec = {items:[{type:'mermaid',code:'flowchart TD\nA-->B'},{type:'scene3d',meshes:[{shape:'box'}]}]}
  await render(h(local.GenuiBlock,{spec,diagnosticSourceId:'engines',onRenderDiagnostics:callback}))
  await settleUntil(()=>snapshots.at(-1)?.diagnostics.length === 2)
  assert.deepEqual(snapshots.at(-1).diagnostics.map(d=>d.component).sort(),['mermaid','scene3d'])
  assert.equal(env.container.querySelectorAll('[role=alert]').length,2)
  failMermaid = false; failThree = false
  await render(h(local.GenuiBlock,{spec:{items:[{type:'mermaid',code:'flowchart TD\nB-->C'},{type:'scene3d',meshes:[{shape:'sphere'}]}]},diagnosticSourceId:'engines',onRenderDiagnostics:callback}))
  await settleUntil(()=>env.container.querySelector('[data-genui-mermaid]') !== null)
  assert.deepEqual(snapshots.at(-1).diagnostics,[])
})
test('stale Three rejection after source change or unmount never repopulates diagnostics', async () => {
  const local = await freshDiagnosticsApi(), snapshots = [], pending = []
  local.setGenuiAssetLoader(async () => ({mountScene:() => new Promise((resolve,reject)=>pending.push({resolve,reject}))}))
  const callback = value=>snapshots.push(value)
  const spec = {items:[{type:'scene3d',meshes:[{shape:'box'}]}]}
  await render(h(local.GenuiBlock,{spec,diagnosticSourceId:'old',onRenderDiagnostics:callback}))
  await render(h(local.GenuiBlock,{spec:{items:[{type:'text',content:'new'}]},diagnosticSourceId:'new',onRenderDiagnostics:callback}))
  await act(async()=>pending[0].reject(new Error('late stale rejection')))
  assert.deepEqual(snapshots.at(-1),{sourceId:'new',diagnostics:[]})
  await render(h(local.GenuiBlock,{spec,diagnosticSourceId:'third',onRenderDiagnostics:callback}))
  await unmount()
  const count = snapshots.length
  await act(async()=>pending[1].reject(new Error('late unmounted rejection')))
  assert.equal(snapshots.length,count)
})
test('Plot partial sampling failures signal, localize chrome and clear after valid source', async () => {
  const local = await freshDiagnosticsApi(), snapshots = []
  local.setLocale('en')
  const callback = value=>snapshots.push(value)
  await render(h(local.GenuiBlock,{spec:{items:[{type:'plot',series:[{expr:'x'},{expr:'invalid(x)'}]}]},diagnosticSourceId:'plot',onRenderDiagnostics:callback}))
  assert.equal(snapshots.at(-1).diagnostics[0].code,'plot-error')
  assert(env.container.querySelector('[role=alert]').textContent.includes('invalid(x)'))
  assert(env.container.querySelector('svg'))
  assert(env.container.textContent.includes('wheel to zoom'))
  await render(h(local.GenuiBlock,{spec:{items:[{type:'plot',series:[{expr:'a*x',params:[{name:'a',value:1,animateTo:2}]}]}]},diagnosticSourceId:'plot',onRenderDiagnostics:callback}))
  assert.deepEqual(snapshots.at(-1).diagnostics,[])
  assert(env.container.textContent.includes('Parameters'))
  assert(env.container.textContent.includes('Play animation'))
  assert(!/[\p{Script=Han}]/u.test(env.container.textContent))
})
test('debounced slider dispatch is cancelled when the source revision changes', async () => {
  const calls = []
  const first = {items:[{type:'slider',id:'s',min:0,max:10,value:1,action:'slide'}]}
  const onAction = async (...args)=>{calls.push(args);return {status:'queued'}}
  await render(h(api.GenuiBlock,{spec:first,diagnosticSourceId:'first',onAction}))
  await act(async()=>changeInput(env.container.querySelector('input'),'7'))
  await render(h(api.GenuiBlock,{spec:{items:[{type:'slider',id:'s',min:0,max:10,value:1,action:'slide'}]},diagnosticSourceId:'second',onAction}))
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,330))})
  assert.deepEqual(calls,[])
})

test('G10 late 3D mount results are disposed after update and unmount', async () => {
  const mounts = []
  api.setGenuiAssetLoader(async () => ({mountScene: (element, scene) => new Promise(resolve => mounts.push({element,scene,resolve}))}))
  const node = shape => ({type:'scene3d',meshes:[{shape}]})
  await render(h(api.Scene3DNode, {node:node('box')}))
  await render(h(api.Scene3DNode, {node:node('sphere')}))
  assert.equal(mounts.length,2)
  const active = new Set()
  const finish = index => {active.add(index);mounts[index].resolve(() => active.delete(index))}
  await act(async () => finish(0))
  assert.equal(active.size,0)
  await act(async () => finish(1))
  assert.deepEqual([...active],[1])
  await unmount()
  assert.equal(active.size,0)
})
