import test from 'node:test'
import assert from 'node:assert/strict'
import { loadGenui } from './genui-helpers.mjs'
const api = await loadGenui(`
 export * from './genui/shared/fence-resolve.ts'
 export * from './genui/client/guard.ts'
 export * from './genui/client/walk-spec.ts'
 export * from './genui/client/safe-math.ts'
 export * from './genui/client/mermaid-safe.ts'
 export * from './genui/client/artifact/create.ts'
 export * from './genui/client/artifact/portability.ts'
 export * from './genui/client/artifact/html.ts'
 export * from './genui/client/artifact/parse.ts'
 export * from './genui/client/artifact/download.ts'
 export * from './genui/client/source-fence.ts'
 export * from './genui/client/asset-loader.ts'
 export * from './genui/client/genui-runtime/support.ts'
`)

test('G6 completed whole-body repair retains the recoverable tail', () => {
  const raw = '{"items":[{"type":"text","content":"first"},{"type":"text","content":"second",}]}'
  const result = api.resolveFence(raw, { settled: true })
  assert.equal(result.status, 'complete')
  assert.equal(result.repaired, true)
  assert.deepEqual(result.spec.items.map(node => node.content), ['first', 'second'])
  const truncated = api.resolveFence('{"items":[{"type":"text","content":"first"},{"type":"text","content":"second', { settled: true })
  assert.equal(truncated.spec.items.length, 2)
  assert.equal(truncated.complete, true)
})
test('G6 displayed partial validation failures remain errors', () => {
  const result = api.resolveFence('{"items":[{"type":"text","content":"first"},{"type":"stat","label":"bad"}]}', { settled: true })
  assert.equal(result.status, 'partial')
  assert.equal(result.complete, false)
  assert.equal(result.spec.items.length, 1)
  assert(result.errors.some(error => error.includes('value')))
  assert(result.errors.some(error => error.includes('dropped')))
})
test('policy-truncated tabs and accordion retain previews but never report complete success', () => {
  for (const [type, cap] of [['tabs',12],['accordion',24]]) {
    const sections = Array.from({length:cap + 1}, (_, index) => ({label:`Tab ${index}`,title:`Section ${index}`,items:[{type:'text',content:`child ${index}`}]}))
    const spec = {items:[type === 'tabs' ? {type,tabs:sections} : {type,items:sections}]}
    const processed = api.processGenuiSpec(spec)
    assert(processed.errors.some(error => error.includes('component nodes were truncated by policy limits')))
    assert.equal(api.isRenderableProcess(processed),false)
    assert(processed.warnings.some(warning => warning.kind === 'truncated'))
    for (const settled of [true,false]) {
      const result = api.resolveFence(JSON.stringify(spec),{settled})
      assert.equal(result.complete,false)
      assert.equal(result.status,settled ? 'partial' : 'streaming-partial')
      assert(result.errors.some(error => error.includes('component nodes were truncated by policy limits')))
      assert.equal(result.spec.items[0][type === 'tabs' ? 'tabs' : 'items'].length,cap)
      assert.equal(api.countGenuiNodes(result.spec),cap + 1)
    }
  }
})
test('depth clipping is an explicit error even when the bounded node ledger cannot count the lost leaf', () => {
  let node = {type:'text',content:'too deep'}
  for (let depth = 0; depth < 9; depth++) node = {type:'col',items:[node]}
  const result = api.resolveFence(JSON.stringify({items:[node]}),{settled:true})
  assert.equal(result.complete,false)
  assert(result.errors.some(error => error.includes('exceeds max depth 8')))
  assert.equal(result.status,'partial')
})
test('unknown optional-field warnings do not invalidate complete renderable content', () => {
  const result = api.resolveFence('{"items":[{"type":"text","content":"visible","unused":"warning only"}]}',{settled:true})
  assert.equal(result.complete,true)
  assert.equal(result.status,'complete')
  assert.deepEqual(result.errors,[])
  assert(result.processed.warnings.some(warning => warning.kind === 'unknown-field'))
})

test('streaming incomplete input is never complete', () => {
  const result = api.resolveFence('{"items":[{"type":"text","content":"first"},{"type":"text","content":"sec', { settled: false })
  assert.equal(result.status, 'streaming-partial')
  assert.equal(result.complete, false)
  assert.equal(result.spec.items.length, 1)
})
test('G9 typed traversal preserves opaque records and export data', () => {
  const opaque = { type: 'image', src: 'data:image/png;base64,AA==', items: [{ type: 'input', inputType: 'password', value: 'keep data' }] }
  const spec = { items: [
    { type: 'file-tree', items: [{ type: 'dir', name: 'src', children: [{ type: 'file', name: 'main.ts' }] }] },
    { type: 'json', value: opaque },
    { type: 'accordion', items: [{ title: 'Secrets', items: [{ type: 'input', id: 'secret', inputType: 'password', value: 'strip' }] }] },
  ] }
  const paths = []
  api.walkGenuiNodes(spec, (node, path) => paths.push([node.type, path]))
  assert.deepEqual(paths.map(entry => entry[0]), ['file-tree', 'json', 'accordion', 'input'])
  assert.equal(api.countGenuiNodes(spec), 4)
  const artifact = api.createGenuiArtifact(spec, { fields: { secret: 'nope', safe: 'ok' }, componentState: { tab: 1 } }, { locale: 'en', theme: 'light' })
  assert.deepEqual(artifact.spec.items[1].value, opaque)
  assert.equal(artifact.spec.items[2].items[0].items[0].value, undefined)
  assert.deepEqual(artifact.state.fields, { safe: 'ok' })
  assert.deepEqual(api.analyzeGenuiPortability(artifact.spec).customTypes, [])
  const html = api.createStandaloneHtmlDocument(artifact, new Map([['standalone-runtime.js', new TextEncoder().encode('// runtime')]]), 'https://whale.invalid/')
  const encoded = /id="genui-artifact">([^<]+)/.exec(html)[1]
  const restored = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  assert.deepEqual(restored.spec.items[1].value, opaque)
  assert.deepEqual(api.parseGenuiArtifact(artifact).state.componentState, { tab: 1 })
})
test('typed child repair and validation count list children against the shared node budget', () => {
  const nested = { items: [{ type: 'list', items: Array.from({length: 50}, (_, index) => ({type:'col',items:Array.from({length:5}, () => ({type:'text',content:`item ${index}`}))})) }] }
  const result = api.processGenuiSpec(nested)
  assert.equal(result.renderedTotalCount, 200)
  assert(result.errors.some(error => error.includes('exceeds 200')))
  assert.equal(api.countGenuiNodes(result.spec), 200)
  const raw = {items:[{type:'tabs',tabs:[{label:'Tab',items:[{type:'accordion',items:[{title:'Section',items:[{type:'text',text:'alias'}]}]}]}]}]}
  assert.deepEqual(api.processGenuiSpec(raw).errors, [])
  assert.equal(raw.items[0].tabs[0].items[0].items[0].items[0].content, undefined)
})

test('unsupported components never complete successfully, while valid siblings can render with errors', async () => {
  const spec = {items:[{type:'text',content:'valid sibling'},{type:'imaginary',payload:{type:'also-opaque',items:[{type:'text',content:'opaque'}]}}]}
  const processed = api.processGenuiSpec(spec)
  assert.equal(processed.unsupportedComponents.length,1)
  assert.equal(processed.unsupportedComponents[0].path,'items[1]')
  assert(processed.errors.some(error => error.includes("unsupported component type 'imaginary'")))
  assert.equal(api.isRenderableProcess(processed),false)
  const resolved = api.resolveFence(JSON.stringify(spec), {settled:true})
  assert.equal(resolved.complete,false)
  assert.equal(resolved.status,'partial')
  assert.deepEqual(resolved.spec.items.map(node=>node.type),['text'])
  assert(resolved.errors.some(error => error.includes('imaginary')))
  const only = api.resolveFence('{"items":[{"type":"imaginary"}]}',{settled:true})
  assert.equal(only.spec,null)
  assert.equal(only.status,'failed')
  const bare = api.processGenuiSpec({type:'imaginary'})
  assert.equal(bare.unsupportedComponents[0].path,'items[0]')
  for (const type of ['constructor','toString','__proto__']) {
    const result = api.processGenuiSpec({items:[{type}]})
    assert.equal(result.unsupportedComponents[0].type,type)
    assert(result.errors.some(error => error.includes('unsupported component type')))
  }
  const registered = new Set(['text','imaginary'])
  assert.deepEqual(api.diagnoseUnsupportedGenuiTypes(spec,registered),[])
  const opaque = {items:[{type:'json',value:{type:'imaginary'}},{type:'file-tree',items:[{type:'file',name:'imaginary'}]}]}
  assert.deepEqual(api.diagnoseUnsupportedGenuiTypes(opaque),[])
  const artifact = api.createGenuiArtifact(spec,undefined,{locale:'en',theme:'light'})
  assert.deepEqual(api.parseGenuiArtifact(artifact).spec.items[1],spec.items[1])
  await assert.rejects(api.buildStandaloneHtml(artifact), /custom components: imaginary/)
})

test('SafeMath own function lookup and signed right-associative exponents', () => {
  for (const expr of ['constructor(1)', 'toString(1)', '__defineGetter__(1)']) assert.equal(api.compileMathExpr(expr), null)
  assert.equal(api.compileMathExpr('2^-2')(0), .25)
  assert.equal(api.compileMathExpr('2^-2^2')(0), 1 / 16)
  assert.equal(api.compileMathExpr('2^3^2')(0), 512)
  assert.equal(api.compileMathExpr('-2^2')(0), -4)
  assert.equal(api.compileMathExpr('pow(2,-3)')(0), .125)
})
test('G8 host code-block mapping skips directly rendered math and nested fence examples', () => {
  const markdown = '```math\nx^2\n```\n```dsh-ui\n{"items":[]}\n```\n````markdown\n```dsh-ui\nexample\n```\n````'
  assert.equal(api.sourceFencesOf(markdown).length, 3)
  assert.equal(api.sourceCodeBlocksOf(markdown).length, 2)
  assert.equal(api.sourceLanguageAt(markdown, 0), 'dsh-ui')
  assert.equal(api.sourceLanguageAt(markdown, 1), 'markdown')
})
test('opaque-viewer artifact bridge awaits download failures and uses host bundle bytes', async () => {
  const artifact = api.createGenuiArtifact({items:[{type:'text',content:'export me'}]}, undefined, {locale:'en',theme:'light'})
  const calls = []
  api.setGenuiDownloadHandler(async (blob, filename) => { calls.push({text:await blob.text(), filename, type:blob.type}) })
  await api.downloadGenuiArtifactJson(artifact)
  assert.equal(calls.length,1)
  assert.equal(JSON.parse(calls[0].text).format, 'dsh-genui')
  api.setGenuiBundleLoader(async name => { assert.equal(name,'standalone-runtime.js'); return new TextEncoder().encode('// trusted runtime bytes') })
  globalThis.document = {baseURI:'https://whale.invalid/'}
  try {
    await api.downloadGenuiArtifactHtml(artifact)
    assert.equal(calls.length,2)
    assert(calls[1].text.includes('data-genui-bundle="runtime"'))
  } finally { delete globalThis.document }
  api.setGenuiDownloadHandler(async () => { throw new Error('Host download refused') })
  await assert.rejects(api.downloadGenuiArtifactJson(artifact), /Host download refused/)
})

test('Mermaid comments do not hide explicit kinds or acquire a flowchart header', () => {
  const code = '%% leading comment\nsequenceDiagram\nAlice->>Bob: Hi'
  assert.equal(api.ensureFlowchartKind(code), code)
  const flow = '%% leading comment\nflowchart TD\nA[中文 标签] --> B'
  assert.match(api.repairMermaidSource(flow), /A\["中文 标签"\]/)
  assert.equal(api.ensureFlowchartKind(flow), flow)
})
