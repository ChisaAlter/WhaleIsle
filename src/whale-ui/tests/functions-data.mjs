import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../functions/data.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {dataFunctions:f}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const cases = [
  ['Append', {list:[1,2],item:3}, [1,2,3]], ['Prepend',{list:[2,3],item:1},[1,2,3]], ['Concat',{list:[1],more:[2]},[1,2]],
  ['Remove',{list:[{id:'a'},{id:'b'}],field:'id',value:'a'},[{id:'b'}]], ['RemoveAt',{list:[1,2,3],index:-1},[1,2]],
  ['Update',{list:[{id:'a',n:1},{id:'b',n:2}],field:'id',value:'a',setField:'n',setValue:9},[{id:'a',n:9},{id:'b',n:2}]],
  ['Toggle',{list:['a','b'],item:'a'},['b']], ['Includes',{list:'whale isle',item:'isle'},true], ['Find',{list:[{id:2}],field:'id',value:3},null], ['IndexOf',{list:['a','b'],item:'b'},1],
  ['Take',{list:[1,2,3],n:-2},[2,3]], ['Slice',{list:'abcdef',start:-3,end:-1},'de'], ['Unique',{list:[1,2,1]},[1,2]], ['Reverse',{list:[1,2]},[2,1]], ['Range',{start:3,end:-1,step:-1},[3,2,1,0]],
  ['Pick',{list:[]},null], ['Shuffle',{list:[]},[]], ['Flatten',{list:[[1,2],[3]]},[1,2,3]], ['Chunk',{list:[1,2,3,4,5],size:2},[[1,2],[3,4],[5]]],
  ['Pow',{base:2,exponent:4},16], ['Sqrt',{number:-1},null], ['Random',{min:2,max:2,integer:true},2], ['Clamp',{number:20,min:1,max:10},10], ['Percent',{part:3,total:4},75], ['Lerp',{a:10,b:20,t:.25},12.5],
  ['Allocate',{total:100,weights:[1,1,1]},[33.34,33.33,33.33]], ['Payment',{principal:1200,rate:0,periods:12},100], ['Convert',{value:1,from:'ft',to:'in'},12.000000000000002],
  ['Format',{value:45,kind:'percent',decimals:0},new Intl.NumberFormat(undefined,{style:'percent',maximumFractionDigits:0,minimumFractionDigits:0}).format(.45)],
  ['Join',{list:[{name:'a'},{name:null},{name:'b'}],field:'name',sep:' / '},'a / b'], ['Plural',{n:2,word:'person',plural:'people'},'2 people'], ['Pad',{value:7,length:3},'007'],
  ['Upper',{text:'whale'},'WHALE'], ['Lower',{text:'Whale'},'whale'], ['Trim',{text:'  whale  '},'whale'], ['Capitalize',{text:'new york'},'New York'], ['Split',{text:'a, b,,c'},['a','b','c']], ['Replace',{text:'a.b.a',find:'a',replacement:'z'},'z.b.z'],
  ['Duration',{seconds:4805},'1h 20m'], ['Default',{value:0,fallback:9},0], ['MixColor',{from:'#fff',to:'#000',t:.5},'#808080'],
  ['FormatDate',{date:'2024-02-29',style:'iso'},'2024-02-29'], ['AddDays',{date:'2024-02-28',days:2},'2024-03-01'], ['AddMonths',{date:'2024-01-31',months:1},'2024-02-29'], ['DaysBetween',{from:'2024-03-09',to:'2024-03-11'},2], ['MonthsBetween',{from:'2024-01-31',to:'2024-02-29'},1], ['StartOf',{date:'2026-10-25',unit:'week'},'2026-10-19'],
  ['GroupBy',{rows:[{k:'b',n:2},{k:'a',n:3},{k:'b',n:4}],key:'k',field:'n',agg:'sum'},[{key:'b',value:6},{key:'a',value:3}]],
  ['Pivot',{rows:[{m:'Jan',k:'A',n:2},{m:'Feb',k:'B',n:3}],rowKey:'m',colKey:'k',field:'n'},[{m:'Jan',A:2,B:0},{m:'Feb',A:0,B:3}]],
  ['Top',{rows:[{n:2},{n:3},{n:1}],field:'n',n:2},[{n:3},{n:2}]], ['Between',{rows:[{d:'2024-01-01'},{d:'2024-01-02'},{d:'2024-01-03'}],field:'d',min:'2024-01-02',max:'2024-01-02'},[{d:'2024-01-02'}]],
  ['Bucket',{rows:[{d:'2024-01-01',n:1},{d:'2024-01-03',n:3}],dateField:'d',unit:'day',field:'n'},[{key:'2024-01-01',value:1},{key:'2024-01-02',value:0},{key:'2024-01-03',value:3}]],
  ['Cumulative',{rows:[1,2,3],field:''},[1,3,6]], ['MovingAvg',{rows:[1,3,5,7],field:'',window:2},[1,2,4,6]], ['Change',{current:120,previous:100},20],
  ['Histogram',{values:[0,.5,1],bins:2,min:0,max:1},[{key:'0–0.5',value:1,start:0,end:.5},{key:'0.5–1',value:2,start:.5,end:1}]],
  ['Stats',{values:[1,2,3]}, {count:3,min:1,max:3,mean:2,median:2,stdev:Math.sqrt(2/3)}],
];
for (const [name, args, expected] of cases) test(`${name} honors published data behavior without mutating arguments`, () => {
  const before = structuredClone(args); assert.deepEqual(f[name](args), expected); assert.deepEqual(args, before);
});
test('Now and Today reflect the clock and local calendar', () => {
  assert.ok(Math.abs(Date.parse(f.Now()) - Date.now()) < 1000);
  const d = new Date(); assert.equal(f.Today(), `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
});
test('all 59 public function implementations have explicit behavior coverage', () => {
  assert.equal(Object.keys(f).length, 59);
  assert.deepEqual(Object.keys(f).sort(), [...cases.map(c=>c[0]), 'Now','Today'].sort());
});
test('allocation conserves rounded total for fractional and negative amounts', () => {
  for (const total of [1, -1, 123.45]) { const shares = f.Allocate({total,weights:[.01,2,7.9,0],decimals:2}); assert.equal(Math.round(shares.reduce((a,b)=>a+b,0)*100), Math.round(total*100)); }
});
test('budget and empty-data boundaries terminate predictably', () => {
  assert.throws(()=>f.Range({start:0,end:100_000}), /exceeds/); assert.throws(()=>f.Allocate({total:1,weights:Array(10001).fill(1)}), /exceeds/); assert.throws(()=>f.Concat({list:Array(6000).fill(1),more:Array(6000).fill(2)}), /exceeds/); assert.throws(()=>f.Flatten({list:[Array(6000).fill(1),Array(6000).fill(2)]}), /exceeds/); assert.throws(()=>f.Histogram({values:[1],bins:10001}), /exceeds/); assert.throws(()=>f.Range({start:0,end:1,step:0}), /nonzero/); assert.throws(()=>f.Chunk({list:[1],size:0}), /positive/);
  assert.equal(f.Percent({part:1,total:0}),0); assert.equal(f.Change({current:1,previous:0}),null); assert.equal(f.Default({value:NaN,fallback:5}),5); assert.equal(f.Default({value:false,fallback:true}),false);
  assert.deepEqual(f.Stats({values:[]}), {count:0,min:0,max:0,mean:0,median:0,stdev:0});
});
test('calendar functions remain correct under reverse and month-end operations', () => {
  assert.equal(f.MonthsBetween({from:'2024-03-31',to:'2024-02-29'}),-1); assert.equal(f.AddMonths({date:'2024-03-31',months:-1}),'2024-02-29');
  assert.deepEqual(f.Bucket({rows:[{d:'2023-12-31'},{d:'2024-01-09'}],dateField:'d',unit:'week'}),[{key:'2023-12-25',value:1},{key:'2024-01-01',value:0},{key:'2024-01-08',value:1}]);
});
test('unit conversion rejects dimension mismatches and handles temperatures', () => {
  assert.equal(f.Convert({value:1,from:'kg',to:'m'}),null); assert.ok(Math.abs(f.Convert({value:32,from:'f',to:'c'}))<1e-10); assert.equal(f.Convert({value:100,from:'c',to:'k'}),373.15);
});
