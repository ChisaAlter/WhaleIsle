'use strict';

function sourcePickerActive(current){
 return current===editor&&!current.closed&&current.type==='source-picker'&&$('#editor').open&&!!$('#source-picker');
}
function sourcePickerMatches(row,query,type){
 const groups={vendor:'模型厂商 官方 API',relay:'聚合中转 API',local:'本机服务 本地 API'};
 const terms=type==='api'
  ?[row.name,row.id,row.short,row.note,row.catalog,row.chat,row.responses,row.anthropic,row.decide,row.website,groups[row.kind] || groups.vendor,...(row.regions || []).map(r=>r.name)]
  :[row.name,row.id,row.pid,row.package,subscriptionNames[row.id],row.plugin?'已安装插件 订阅':'内置订阅',...(row.methods || []).map(m=>m.label)];
 const text=terms.filter(Boolean).join(' ').toLowerCase();
 return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(term=>text.includes(term));
}
function sourcePickerRow(row,type){
 const name=row.name || row.id,detail=type==='api'?(row.note || row.id):row.id;
 const action=type==='api'?'source-preset':'source-subscription',label=type==='api'?'配置':'登录';
 return `<li><button type="button" class="row source-option" data-action="${action}" data-id="${escape(row.id)}" aria-label="${escape(type==='api'?`配置 ${name} API 接口`:`连接 ${name} 订阅账号`)}"><span class="provider-avatar source-avatar" aria-hidden="true">${escape(Array.from(name)[0]?.toUpperCase() || '')}</span><span class="text"><strong class="title">${escape(name)}</strong><span class="caption source-description">${escape(detail)}</span></span><span class="source-select-caption">${label}${icon('arrow')}</span></button></li>`;
}
function sourcePickerGroup(id,title,hint,rows,type){
 if(!rows.length)return '';
 return `<section class="source-group" aria-labelledby="source-group-${id}"><div class="source-group-head"><h3 id="source-group-${id}">${title}</h3><span class="caption">${rows.length} 项</span></div><p class="caption source-group-hint">${hint}</p><ul class="panel source-list">${rows.map(row=>sourcePickerRow(row,type)).join('')}</ul></section>`;
}
function renderSourceLoadState(current){
 if(!sourcePickerActive(current)||current.opening)return;
 const host=$('#source-load-state');
 if(current.loadError){
  host.innerHTML=`<div class="source-load-error" role="alert"><div class="text"><strong>订阅列表未能加载</strong><p>${escape(current.loadError)}</p><p>${current.rows.length?'先前读取的订阅仍显示在列表中，可稍后重试。':'API 预设和其他接入方式仍可使用，请重试读取订阅。'}</p></div>${button('重试读取','source-reload','','text-button')}</div>`;
 }else host.innerHTML=current.loading?'<p class="caption source-load-note">正在读取内置订阅和已安装插件；API 预设可直接选择。</p>':'';
}
function renderSourcePickerResults(current){
 if(!sourcePickerActive(current)||current.opening)return;
 const presets=current.kind==='subscription'?[]:(state.presets || []).filter(row=>sourcePickerMatches(row,current.query,'api'));
 const plans=current.kind==='api'?[]:current.rows.filter(row=>sourcePickerMatches(row,current.query,'subscription'));
 const count=presets.length+plans.length,noun=current.kind==='api'?'API 预设':current.kind==='subscription'?'订阅来源':'模型来源';
 $('#source-status').textContent=`${current.query.trim()?'匹配':'可选'} ${count} 个${noun}${current.kind!=='api'&&current.loading?' · 订阅列表正在读取':current.kind!=='api'&&current.loadError?' · 订阅列表未能刷新':''}`;
 for(const b of $('#source-picker').querySelectorAll('[data-action="source-kind"]'))b.setAttribute('aria-pressed',String(b.dataset.id===current.kind));
 $('#source-clear').hidden=!current.query;
 let html=sourcePickerGroup('vendor','模型厂商','直接连接厂商的官方 API。',presets.filter(p=>!['relay','local'].includes(p.kind)),'api')+
  sourcePickerGroup('relay','聚合与中转','通过一个 API 接口使用多个厂商的模型。',presets.filter(p=>p.kind==='relay'),'api')+
  sourcePickerGroup('local','本机服务','连接本机或局域网运行的模型服务。',presets.filter(p=>p.kind==='local'),'api')+
  sourcePickerGroup('builtin','内置订阅','使用供应商支持的登录流程连接已有账号。',plans.filter(s=>!s.plugin),'subscription')+
  sourcePickerGroup('plugin','已安装插件','使用本机已安装插件提供的认证流程。',plans.filter(s=>s.plugin),'subscription');
 if(!count){
  const unknown=current.kind==='subscription'&&(current.loading||current.loadError);
  const title=unknown?(current.loading?'正在读取订阅来源':'暂时无法查找订阅来源'):`没有匹配的${noun}`;
  const hint=unknown?(current.loading?'订阅列表读取完成后会显示在这里。':'订阅列表读取失败，请重试或使用下面的其他接入方式。'):(current.query.trim()?`未找到与“${current.query.trim()}”匹配的来源。可以调整关键词，或选择下面的其他接入方式。`:'可以配置自定义兼容接口，或查找社区提供的订阅插件。');
  html=`<div class="source-empty"><h3>${escape(title)}</h3><p>${escape(hint)}</p></div>`;
 }
 $('#source-results').innerHTML=html;
}
async function loadSourceSubscriptions(current){
 if(!sourcePickerActive(current)||current.loading)return;
 current.loading=true;current.loadError='';renderSourceLoadState(current);renderSourcePickerResults(current);
 try{
  const rows=await api('subscriptions');
  if(!sourcePickerActive(current))return;
  current.rows=rows.map(s=>({...s,name:s.plugin?s.name:(subscriptionNames[s.id] || s.name)}));
  subscriptions=current.rows;
 }catch(error){
  if(sourcePickerActive(current))current.loadError=error.message || String(error);
 }finally{
  if(sourcePickerActive(current)){current.loading=false;renderSourceLoadState(current);renderSourcePickerResults(current);}
 }
}
async function openSourcePicker(kind='api',query='',expected){
 if(expected&&(expected!==editor||expected.closed))return;
 editor={type:'source-picker',kind:['api','subscription','all'].includes(kind)?kind:'api',query:String(query || ''),rows:[...subscriptions],loading:false,loadError:''};
 const current=editor;
 $('#editor-title').textContent='连接模型来源';
 $('#fields').innerHTML=`<div id="source-picker"><p class="form-hint" id="source-picker-note">选择 API 供应商或订阅账号；列表没有的来源，可以继续查找社区插件。</p><div class="source-picker-tools"><div class="segments" role="group" aria-label="来源类型">${button('API 供应商','source-kind','api')}${button('订阅账号','source-kind','subscription')}${button('全部','source-kind','all')}</div><span id="source-status" class="caption" role="status" aria-atomic="true"></span></div><label for="source-search">搜索模型来源</label><div class="search source-search">${icon('search')}<input id="source-search" type="search" value="${escape(current.query)}" placeholder="供应商名称、ID 或关键词" aria-describedby="source-search-note"><button type="button" id="source-clear" class="icon-button" data-action="source-clear" aria-label="清空搜索" ${current.query?'':'hidden'}>${icon('close')}</button></div><p class="caption source-search-note" id="source-search-note">可搜索预设名称、接口地址和订阅登录方式。</p><div id="source-load-state"></div><div id="source-results" class="source-picker-results" role="region" aria-label="可选模型来源"></div><div class="source-alternatives"><div><h3>没有你需要的来源？</h3><p class="caption">使用自定义接口，或查找社区提供的订阅接入插件。</p></div><div class="actions">${button('自定义供应商','source-custom')}${button('查找社区插件','source-community')}</div></div></div>`;
 showEditor();$('#save').hidden=true;$('#cancel-editor').textContent='关闭';
 renderSourcePickerResults(current);
 void loadSourceSubscriptions(current);
 return current;
}
$('#fields').addEventListener('input',e=>{
 if(e.target.id!=='source-search'||!sourcePickerActive(editor)||editor.opening)return;
 editor.query=e.target.value;renderSourcePickerResults(editor);
});
$('#fields').addEventListener('keydown',e=>{
 if(e.key==='Enter'&&e.target.id==='source-search'&&sourcePickerActive(editor))e.preventDefault();
});
$('#edit-form').addEventListener('submit',e=>{
 if(editor?.type==='source-picker'){e.preventDefault();e.stopImmediatePropagation();}
},true);
$('#fields').addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]'),current=editor;
 if(current?.type==='subscription'&&['source-back','source-discover'].includes(b?.dataset.action)&&!b.disabled&&!current.adapterPending){
  const busy=startButtonBusy(b,'打开中');
  try{if(b.dataset.action==='source-back')await openSourcePicker('subscription','',current);else await openAdapters('discover',current);}
  catch(error){if(current===editor&&!current.closed)formError(error);}
  finally{busy.finish();}
  return;
 }
 if(!b?.dataset.action.startsWith('source-')||b.disabled||b.getAttribute('aria-disabled')==='true'||!sourcePickerActive(current)||current.opening)return;
 e.preventDefault();
 const action=b.dataset.action;
 if(action==='source-kind'){
  if(!['api','subscription','all'].includes(b.dataset.id))return;
  current.kind=b.dataset.id;renderSourcePickerResults(current);return;
 }
 if(action==='source-clear'){
  current.query='';$('#source-search').value='';renderSourcePickerResults(current);$('#source-search').focus();return;
 }
 if(action==='source-reload'){await loadSourceSubscriptions(current);return;}
 let open;
 if(action==='source-preset'){
  const preset=(state.presets || []).find(p=>p.id===b.dataset.id);if(!preset)return;
  open=()=>openProvider(undefined,'edit',preset.id);
 }else if(action==='source-subscription'){
  const subscription=current.rows.find(s=>s.id===b.dataset.id);if(!subscription)return;
  open=()=>openSubscription(subscription.id,false,current);
 }else if(action==='source-custom')open=()=>openProvider();
 else if(action==='source-community')open=()=>openAdapters('discover',current,current.query);
 else return;
 current.opening=true;
 const controls=[...$('#source-picker').querySelectorAll('button,input')].map(control=>[control,control.disabled]);
 const busy=startButtonBusy(b,'打开中');controls.forEach(([control])=>control.disabled=true);
 try{await open();}
 catch(error){if(sourcePickerActive(current))formError(error);}
 finally{
  busy.finish();current.opening=false;
  if(sourcePickerActive(current)){
   controls.forEach(([control,disabled])=>{if(control.isConnected)control.disabled=disabled;});
   renderSourceLoadState(current);renderSourcePickerResults(current);
  }
 }
});
