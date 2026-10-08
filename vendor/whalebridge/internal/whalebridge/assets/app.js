'use strict';
const theme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){document.documentElement.toggleAttribute('data-ds-dark-theme',theme.matches);}
applyTheme();theme.addEventListener('change',applyTheme);
const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
let state, tab = 'overview', period = 'today', editor, renderEpoch = 0;
let modelQuery = '', modelFilter = 'all', loginFlow, loginTimer;
let providerQuery='',providerFilter='all',groupQuery='',selectedGroups=new Set();
let visibilityWrites = Promise.resolve();
const visibilityPending = new Map();
const foldedChannels = new Set();
let messageTimer;
let quotaRows=[],subscriptionSettings={},providerLiveTimer,healthTimer,quotaReadSequence=0;
const pageNames = {overview:'接入概览',providers:'供应商与账号',models:'模型管理',routing:'路由组',usage:'用量统计',help:'使用说明',settings:'全局设置'};
 const routes = {'':'智能','order':'按顺序','rotate':'轮换','usage':'最少用量','pace':'按剩余额度','weight':'权重','manual':'固定模型'};
async function api(path, body, headersCallback) {
 const response = await fetch(`/api/${path}`, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
 headersCallback?.(response.headers);
 if (!response.ok) throw new Error(await response.text());
 return response.json();
}
function message(text, error = false) {
 $('#message-text').textContent = text; $('#message').hidden = !text;
 $('#message').dataset.error = String(error);
 clearTimeout(messageTimer);
 if(text&&!error)messageTimer=setTimeout(()=>message(''),3200);
}
// Keep native select behavior, but use the shared icon and theme for its arrow.
function decorateSelects(){
 for(const select of document.querySelectorAll('select:not([multiple])')){
  if(select.size>1 || select.parentElement.classList.contains('select-control'))continue;
  const wrapper=document.createElement('span');wrapper.className='select-control';
  select.before(wrapper);wrapper.append(select);wrapper.insertAdjacentHTML('beforeend',icon('chevron'));
 }
}
new MutationObserver(decorateSelects).observe(document.body,{childList:true,subtree:true});
decorateSelects();
const buttonBusy = new WeakMap();
function startButtonBusy(button,label){
 const previous=buttonBusy.get(button),saved=previous?.saved || {html:button.innerHTML,disabled:button.disabled,minWidth:button.style.minWidth,ariaLabel:button.getAttribute('aria-label')};
 const owner={saved};buttonBusy.set(button,owner);
 const compact=button.classList.contains('icon-button')||button.tagName==='SUMMARY'||button.classList.contains('switch');
 const update=text=>{if(buttonBusy.get(button)!==owner)return;button.innerHTML=(compact?'':'<span role="status">'+escape(text)+'</span>')+'<span class="button-spinner" aria-hidden="true"></span>';button.setAttribute('aria-label',text);};
 button.style.minWidth=button.getBoundingClientRect().width+'px';button.disabled=true;button.setAttribute('aria-busy','true');update(label);
 return {update,finish(){if(buttonBusy.get(button)!==owner)return;buttonBusy.delete(button);button.removeAttribute('aria-busy');button.style.minWidth=saved.minWidth;if(saved.ariaLabel===null)button.removeAttribute('aria-label');else button.setAttribute('aria-label',saved.ariaLabel);if(button.querySelector('.button-spinner'))button.innerHTML=saved.html;button.disabled=saved.disabled;}};
}
function startAdapterBusy(button,phase='downloading'){
 const current=editor,host=$('#adapter-progress'),busy=startButtonBusy(button,'下载中');
 const controls=[...$('#edit-form').querySelectorAll('#fields button,#fields input,#fields select,#fields textarea,#save')].map(control=>[control,control.disabled]);
 controls.forEach(([control])=>control.disabled=true);
 current.adapterPending=true;host.hidden=true;
 const update=phase=>{if(current===editor&&!current.closed){busy.update({downloading:'下载中',installing:'安装中',updating:'更新中'}[phase]);}};
 update(phase);
 return {
  update,
  finish(){
   current.adapterPending=false;
   busy.finish();
   controls.forEach(([control,disabled])=>{if(current===editor&&control.isConnected)control.disabled=disabled;});
  }
 };
}
async function installAdapter(data,busy){
 const response=await fetch('/api/subscription/adapter',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({...data,action:'install'})});
 if(!response.ok)throw new Error(await response.text());
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
 const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.error)throw new Error(event.error);if(event.phase)busy.update(event.phase);if(event.ok)done=true;};
 try{
  while(true){const part=await reader.read();buffer+=decoder.decode(part.value,{stream:!part.done});let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(part.done)break;}
  consume(buffer);if(!done)throw new Error('未收到适配器安装结果');
 }finally{reader.releaseLock();}
}
async function load() {
 const busy=startButtonBusy($('#refresh'),'刷新中');
 try {
  state = await api('state');
  $('#version').textContent = `v${state.version}`;
  $('#connection').textContent = state.syncError?'模型同步异常':'模型服务运行中'; $('#connection').dataset.state = state.syncError?'error':'ready';
  $('#connection').title=state.syncError || '';
  $('#provider-count').textContent = state.providers.length || '';
  $('#model-count').textContent = state.models?.length || '';
  await render();
 } catch(e) {
  $('#connection').textContent = '连接异常'; $('#connection').dataset.state = 'error';
  $('#content').setAttribute('aria-busy','false');
  if(!state) $('#content').innerHTML = empty('暂时无法读取配置','请确认鲸桥正在运行，然后点击右上角刷新。','','info');
  message(e.message,true);
 } finally { busy.finish(); }
}
function heading(title, description, action = '') { return `<div class="top"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
const button = (label, action, id = '', cls = '') => `<button type="button" class="${cls}" data-action="${action}" data-id="${escape(id)}">${label}</button>`;
const iconButton = (label, action, id, glyph, cls = '') => `<button type="button" class="icon-button ${cls}" data-action="${action}" data-id="${escape(id)}" aria-label="${escape(label)}" title="${escape(label)}">${icon(glyph)}</button>`;
const empty = (title, text, action = '', glyph = 'models') => `<div class="panel empty"><span class="empty-symbol">${icon(glyph)}</span><h2>${title}</h2><p>${text}</p><div class="empty-actions">${action}</div></div>`;
const short = n => new Intl.NumberFormat(state?.chineseUnits===false?'en-US':'zh-CN',{notation:'compact',maximumFractionDigits:1}).format(n || 0);
function stat(label,value,note,glyph){return `<div class="stat"><div class="stat-label">${label}${icon(glyph)}</div><strong>${value}</strong><p class="caption">${note}</p></div>`;}
function overview() {
 const total = state.providers.length, active = state.providers.filter(p=>!p.off).length, models = state.models?.length || 0;
 return `${state.syncError?`<div class="sync-error" role="alert"><strong>模型未能同步到鲸屿</strong><p>${escape(state.syncError)}</p>${button('重新同步模型','sync')}</div>`:''}<div class="hero"><div class="hero-copy"><span class="tag subtle">鲸屿官方组件</span><h1>你的模型，接入鲸屿。</h1><p>鲸桥是鲸屿的模型连接组件。集中管理 API 供应商和订阅账号，让不同来源的模型都能在桌面端使用。</p><div class="actions-bar">${button(`${icon('plus')}添加供应商`,'add-provider','','primary')}${button('接入订阅账号','subscription')}</div></div><div class="connection-map" aria-label="供应商和订阅账号通过鲸桥接入鲸屿桌面端"><div class="flow-node">${icon('account')}<div class="text"><h3>你的供应商与订阅账号</h3><p class="caption">API 密钥 · 订阅登录</p></div></div><div class="flow-link"></div><div class="flow-node bridge">${icon('routing')}<div class="text"><h3>鲸桥 · 统一模型入口</h3><p class="caption">模型管理 · 请求路由 · 用量记录</p></div></div><div class="flow-link"></div><div class="flow-node"><img src="/whale-head.png" alt="鲸屿"><div class="text"><h3>鲸屿桌面端</h3><p class="caption">选择「鲸桥」渠道开始对话</p></div><span class="tag business">已接入</span></div></div></div>
 <div class="stats">${stat('已配置供应商',total,`${active} 个已启用`,'providers')}${stat('可用模型',models,state.syncError?'等待同步到鲸屿桌面端':'已同步到鲸屿桌面端','models')}${stat('路由组',state.groups?.length || 0,'多个模型，共用一个入口','routing')}</div>
 <div class="section-head"><div><h2>从接入到对话，只需三步</h2><p>已有配置可以随时调整，保存后自动同步。</p></div>${button('查看说明','go-help','','text-button')}</div>
 <div class="steps"><article class="step"><div class="step-head"><span class="step-number">01 / 连接来源</span>${total?icon('check'):icon('providers')}</div><h3>添加供应商或登录订阅</h3><p>填写供应商的 API 密钥，或通过支持的供应商登录流程接入订阅账号。</p>${button(`${total?'管理供应商':'开始添加'} ${icon('arrow')}`,total?'go-providers':'add-provider')}</article><article class="step"><div class="step-head"><span class="step-number">02 / 选择模型</span>${models?icon('check'):icon('models')}</div><h3>整理桌面端的模型列表</h3><p>保留常用模型，隐藏暂时不用的模型。多个模型也可以组合为一个路由组。</p>${button(`管理模型 ${icon('arrow')}`,'go-models')}</article><article class="step"><div class="step-head"><span class="step-number">03 / 开始使用</span>${icon('overview')}</div><h3>在鲸屿中选择「鲸桥」</h3><p>回到鲸屿桌面端，打开对话的模型选择器，选择「鲸桥」渠道下的模型。</p>${button(`查看使用方法 ${icon('arrow')}`,'go-help')}</article></div>
 <div class="support-grid"><div><h3>一个地方，管理多种模型来源</h3><p>API 供应商和订阅账号可以同时接入。用路由组分配请求，在用量统计中查看调用次数和 Token 消耗。</p></div><div><h3>关闭窗口，模型服务仍继续</h3><p>鲸桥在后台为桌面端提供服务。在启动器首页可开启或关闭鲸桥，更新、回滚和卸载在「组件」页的管理菜单操作。</p></div></div>
 <details class="advanced"><summary>连接信息与同步</summary><div class="advanced-body"><dl><dt>桌面端渠道</dt><dd>鲸桥 · WhaleBridge</dd><dt>本地网关</dt><dd><code>${escape(state.gateway)}/v1</code></dd><dt>同步方式</dt><dd>配置保存后自动同步；不会替换已有供应商或当前默认模型。</dd></dl><div class="actions-bar">${button(`${icon('refresh')}重新同步模型`,'sync','','text-button')}</div></div></details>`;
}
function providerAvatar(p){const file=String(p.icon || '').startsWith('file:')?String(p.icon).slice(5):'';return file?`<img class="provider-avatar provider-image" src="/api/icons/${encodeURIComponent(file)}" alt="">`:`<span class="provider-avatar" aria-hidden="true">${escape(Array.from(p.name || p.id)[0].toUpperCase())}</span>`;}
function providers(){
 const all=state.providers,visible=all.filter(p=>`${p.name} ${p.id} ${p.preset || ''}`.toLowerCase().includes(providerQuery.toLowerCase())).filter(p=>providerFilter==='all'||providerFilter==='enabled'&&!p.off||providerFilter==='disabled'&&p.off||providerFilter==='api'&&!p.account||providerFilter==='subscription'&&p.account);
 let html=heading('供应商与账号','管理模型来源、接口凭据与订阅身份。',`<div class="actions">${button('导入配置','import-provider')}${button('订阅账号','subscription')}${button(`${icon('plus')}添加供应商`,'add-provider','','primary')}</div>`);
 html+=`<div class="provider-summary"><span><strong>${all.length}</strong> 个来源</span><span><strong>${all.filter(p=>!p.off).length}</strong> 已启用</span><span><strong>${all.filter(p=>p.account).length}</strong> 订阅来源</span><div class="actions">${button('运行状态','provider-health','','text-button')}${button('供应商适配器','manage-adapters','','text-button')}</div></div>`;
 if(!all.length)return html+empty('连接第一个模型来源','使用 API 密钥或供应商订阅接入鲸屿。',button('添加供应商','add-provider','','primary'),'providers');
 html+=`<div class="list-toolbar"><div class="search">${icon('search')}<input id="provider-search" type="search" value="${escape(providerQuery)}" placeholder="搜索供应商名称 / ID" aria-label="搜索供应商"></div><select id="provider-filter" aria-label="来源筛选">${[['all','全部来源'],['enabled','已启用'],['disabled','已停用'],['api','API 供应商'],['subscription','订阅账号']].map(([v,l])=>`<option value="${v}" ${v===providerFilter?'selected':''}>${l}</option>`).join('')}</select><span class="caption">${visible.length} / ${all.length} 个来源</span></div><div class="management-table-wrap"><table class="management-table provider-table"><thead><tr><th>供应商</th><th>接入与状态</th><th>模型 / 路由</th><th>管理</th></tr></thead><tbody>${visible.map(p=>{
  const i=all.findIndex(x=>x.id===p.id);
  return `<tr class="${p.off?'inactive-row':''}"><td><div class="source-identity">${providerAvatar(p)}<div><strong class="table-primary">${escape(p.name)}</strong><code class="table-meta">${escape(p.id)}</code></div></div></td><td><span class="status-badge ${p.off?'muted':''}">${p.off?'已停用':'已启用'}</span><span class="table-meta">${p.account?'订阅身份':p.preset || '自定义接口'}</span><span class="table-meta endpoint">${escape(p.chat || p.responses || p.anthropic || p.decide || '供应商认证接口')}</span>${p.listError?`<p class="inline-error">${escape(p.listError)}</p>`:''}<div data-provider-live="${escape(p.id)}"></div></td><td><strong>${p.modelCount || 0} 个模型</strong><span class="table-meta">${escape(routes[p.routing] || '智能')}分配</span>${p.fetched?`<span class="table-meta">更新于 ${escape(dateText(p.fetched))}</span>`:''}</td><td><div class="actions">${button('配置','edit-provider',p.id)}${button(p.account?'账号':'密钥',p.account?'accounts':'keys',p.id)}<details class="menu"><summary aria-label="${escape(p.name)} 更多操作">${icon('more')}</summary><div class="menu-content">${button('刷新模型','fetch-provider',p.id)}${button(p.off?'启用':'停用','toggle-provider',p.id)}${i?button('上移来源','provider-up',p.id):''}${i<all.length-1?button('下移来源','provider-down',p.id):''}${p.account?'':button('添加同类来源','another-provider',p.id)+button('复制配置','copy-provider',p.id)+button('导出配置','export-provider',p.id)}${button('删除来源','delete-provider',p.id,'danger')}</div></details></div></td></tr>`;
 }).join('') || '<tr><td colspan="4" class="empty-inline">没有匹配来源。</td></tr>'}</tbody></table></div><p class="usage-note">配置保存后同步到鲸屿。每个密钥与账号的模型范围、并发和使用顺序在各自管理页调整。</p>`;
 return html;
}
function modelRows() { return [...(state.models || []).map(m=>({...m,hidden:false})),...(state.hidden || []).map(m=>({...m,hidden:true}))].map(m=>visibilityPending.has(m.id)?{...m,hidden:visibilityPending.get(m.id)}:m); }
function filteredModels() {
 const query=modelQuery.trim().toLowerCase();
 return modelRows().filter(m=>(modelFilter==='all'||(modelFilter==='hidden')===m.hidden)&&`${m.name || ''} ${m.id} ${m.channelName || ''} ${m.supplierName || ''}`.toLowerCase().includes(query));
}
const modelGroup = m => JSON.stringify([m.channelId,m.supplierId]);
// Scope switches act on the rows currently listed: all results, a channel or a supplier.
function scopeRows(scope,id) {
 const rows=filteredModels();
 return scope==='channel'?rows.filter(m=>m.channelId===id):scope==='supplier'?rows.filter(m=>modelGroup(m)===id):rows;
}
function scopeState(rows) {
 const shown=rows.filter(m=>!m.hidden).length;
 return {shown,total:rows.length,checked:!rows.length||!shown?'false':shown===rows.length?'true':'mixed'};
}
function syncModelControls() {
 for(const b of document.querySelectorAll('[data-action="hide-model"]')){
  const m=modelRows().find(m=>m.id===b.dataset.id);if(!m)continue;
  b.setAttribute('aria-checked',String(!m.hidden));b.title=m.hidden?'显示模型':'隐藏模型';
  b.disabled=visibilityPending.has(m.id);b.setAttribute('aria-busy',String(b.disabled));b.innerHTML=b.disabled?'<span class="button-spinner" aria-hidden="true"></span>':'';
  b.closest('.model-row').classList.toggle('disabled',m.hidden);
 }
 for(const b of document.querySelectorAll('[data-action="model-scope"]')){
  const rows=scopeRows(b.dataset.scope,b.dataset.id),s=scopeState(rows);
  b.setAttribute('aria-checked',s.checked);b.title=s.checked==='true'?'全部隐藏':'全部显示';
  b.disabled=!rows.length||rows.some(m=>visibilityPending.has(m.id));b.setAttribute('aria-busy',String(b.disabled&&rows.length>0));b.innerHTML=b.disabled&&rows.length?'<span class="button-spinner" aria-hidden="true"></span>':'';
 }
 for(const c of document.querySelectorAll('[data-count]')){
  const s=scopeState(scopeRows(c.dataset.count,c.dataset.id));c.textContent=`已显示 ${s.shown} / ${s.total}`;
 }
}
const scopeSwitch=(scope,id,label)=>`<button type="button" class="switch" role="switch" data-action="model-scope" data-scope="${scope}" data-id="${escape(id)}" aria-label="${escape(label)}"></button>`;
function modelList() {
 const rows=filteredModels().sort((a,b)=>a.id.localeCompare(b.id,'en')),channels=new Map();
 const top=$('#main').scrollTop,focused=document.activeElement;
 const focusID=focused?.dataset.id,focusAction=focused?.dataset.action;
 for(const m of rows){
  if(!channels.has(m.channelId))channels.set(m.channelId,{id:m.channelId,name:m.channelName,groups:new Map()});
  const channel=channels.get(m.channelId),key=modelGroup(m);
  if(!channel.groups.has(key))channel.groups.set(key,{name:m.supplierName,rows:[]});
  channel.groups.get(key).rows.push(m);
 }
 const row=m=>`<div class="model-row ${m.hidden?'disabled':''}"><div class="model-main"><div class="model-name">${escape(m.name || m.id)}${m.group?'<span class="tag">路由组</span>':''}${m.images?'<span class="tag subtle">图像</span>':''}</div><div class="model-meta"><code>${escape(m.id)}</code>${m.efforts?.length?`<span class="caption">思考：${escape(m.efforts.join(' / '))}</span>`:''}</div></div><span class="caption model-context">${m.context?short(m.context):'—'}</span><button type="button" class="switch" role="switch" aria-checked="${!m.hidden}" aria-label="在桌面端显示 ${escape(m.name || m.id)}" data-action="hide-model" data-id="${escape(m.id)}"></button></div>`;
 const open=c=>!!modelQuery.trim()||!foldedChannels.has(c.id);
 $('#model-list').innerHTML=rows.length?[...channels.values()].map(c=>`<section class="panel model-channel"><div class="model-channel-head"><button type="button" class="model-fold" data-action="fold-channel" data-id="${escape(c.id)}" aria-expanded="${open(c)}">${icon('arrow')}<span class="model-channel-name">${escape(c.name)}</span><span class="caption" data-count="channel" data-id="${escape(c.id)}"></span></button>${scopeSwitch('channel',c.id,`显示 ${c.name} 的全部模型`)}</div><div class="model-channel-body" ${open(c)?'':'hidden'}>${[...c.groups.entries()].map(([key,g])=>`<div class="model-supplier"><span>${escape(g.name)}</span><span class="caption" data-count="supplier" data-id="${escape(key)}"></span>${scopeSwitch('supplier',key,`显示 ${c.name} / ${g.name} 的全部模型`)}</div>`+g.rows.map(row).join('')).join('')}</div></section>`).join(''):empty('没有匹配的模型','试试其他模型名称或标识，或切换显示范围。','','search');
 document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===modelFilter)));
 syncModelControls();
 if(focusAction&&focusID)Array.from(document.querySelectorAll('[data-action]')).find(b=>b.dataset.action===focusAction&&b.dataset.id===focusID)?.focus({preventScroll:true});
 $('#main').scrollTop=top;
}
async function setModelVisibility(ids,hidden) {
 ids=ids.filter(id=>!visibilityPending.has(id)&&modelRows().some(m=>m.id===id&&m.hidden!==hidden));
 if(!ids.length)return;
 for(const id of ids)visibilityPending.set(id,hidden);
 syncModelControls();
 const write=visibilityWrites.then(async()=>{
  try{
   await api('models/hidden',{ids,hidden});
   // Update confirmed rows without remounting the page or moving other models.
   const rows=[...(state.models || []),...(state.hidden || [])],changed=new Set(ids),wasHidden=new Set((state.hidden || []).map(m=>m.id));
   state.models=rows.filter(m=>!(changed.has(m.id)?hidden:wasHidden.has(m.id)));
   state.hidden=rows.filter(m=>changed.has(m.id)?hidden:wasHidden.has(m.id));
   $('#model-count').textContent=state.models.length || '';
   if(ids.length>1)message(`已${hidden?'隐藏':'显示'} ${ids.length} 个模型，已同步到鲸屿`);
  }finally{
   for(const id of ids)visibilityPending.delete(id);
   if($('#model-list')){if(modelFilter==='all')syncModelControls();else modelList();}
  }
 });
 visibilityWrites=write.catch(()=>{});await write;
}
function routingPage(){
 const all=state.groups || [],shown=all.filter(g=>`${g.name} ${g.id} ${(g.members || []).join(' ')}`.toLowerCase().includes(groupQuery.toLowerCase()));
 return heading('路由组','组合模型，并按请求条件、任务难度与用量选择来源。',button(`${icon('plus')}新建路由组`,'add-group','','primary'))+
  `<div class="list-toolbar"><div class="search">${icon('search')}<input id="group-search" type="search" value="${escape(groupQuery)}" placeholder="搜索组或成员模型" aria-label="搜索路由组"></div><span class="caption">${shown.length} 个路由组</span>${button('删除已选组','remove-selected-groups','','danger')}</div>`+
  (all.length?`<div class="management-table-wrap"><table class="management-table"><thead><tr><th><input type="checkbox" id="groups-select-all" aria-label="选择当前结果全部路由组"></th><th>路由组</th><th>成员与规则</th><th>策略</th><th>管理</th></tr></thead><tbody>${shown.map(g=>{
   const i=all.findIndex(x=>x.id===g.id);
   return `<tr><td><input type="checkbox" data-group-select="${escape(g.id)}" ${selectedGroups.has(g.id)?'checked':''} aria-label="选择 ${escape(g.name)}"></td><td><strong class="table-primary">${escape(g.name)}</strong><code class="table-meta">group/${escape(g.id.replace(/^group\//,''))}</code>${g.auto?'<span class="status-badge">自动归组</span>':''}${g.disabled?'<span class="status-badge muted">已停用</span>':'<span class="status-badge success">已启用</span>'}</td><td><strong>${(g.members || []).length} 个成员</strong><span class="table-meta">${(g.rules || []).length} 条条件规则${g.match?.length?` · ${g.match.length} 条匹配规则`:''}</span><span class="table-meta member-preview">${escape((g.members || []).slice(0,3).join(' · '))}${g.members?.length>3?' …':''}</span></td><td><span class="status-badge">${escape(routes[g.routing] || '智能')}</span><span class="table-meta">${g.effort==='auto'?'按任务难度思考':'跟随请求等级'}${g.context<0?' · 最小窗口':g.context>0?` · ${short(g.context)} Token`:''}</span></td><td><div class="actions">${button('编辑','edit-group',g.id)}${button(g.disabled?'启用':'停用','group-switch',g.id)}${i?button('上移','group-up',g.id,'text-button'):''}${i<all.length-1?button('下移','group-down',g.id,'text-button'):''}${iconButton('删除组','delete-group',g.id,'trash','danger')}</div></td></tr>`;
  }).join('') || '<tr><td colspan="5">没有匹配路由组。</td></tr>'}</tbody></table></div>`:empty('建立常用模型组合','可按顺序、轮换、条件与意图分配请求。',button('新建路由组','add-group','','primary'),'routing'));
}
function bindProviderAndGroupPages(){
 $('#provider-search')?.addEventListener('input',e=>{const start=e.target.selectionStart;providerQuery=e.target.value;render().then(()=>{$('#provider-search')?.focus();$('#provider-search')?.setSelectionRange(start,start);});});
 $('#provider-filter')?.addEventListener('change',e=>{providerFilter=e.target.value;render();});
 $('#group-search')?.addEventListener('input',e=>{const start=e.target.selectionStart;groupQuery=e.target.value;render().then(()=>{$('#group-search')?.focus();$('#group-search')?.setSelectionRange(start,start);});});
 $('#groups-select-all')?.addEventListener('change',e=>{for(const c of $('#content').querySelectorAll('[data-group-select]')){c.checked=e.target.checked;c.checked?selectedGroups.add(c.dataset.groupSelect):selectedGroups.delete(c.dataset.groupSelect);}});
}
function groupEditorAction(action,id){
 editor.rules=readGroupRules();
 if(action==='group-rule-add'){editor.rules.push({use:lines($('#f-members').value)[0] || '',agents:[]});editor.openRule=editor.rules.length-1;drawGroupRules();return;}
 if(action.startsWith('group-rule-')){
  const at=Number(id),to=at+(action.endsWith('up')?-1:1);
  if(action==='group-rule-remove')editor.rules.splice(at,1);else if(to>=0&&to<editor.rules.length)[editor.rules[at],editor.rules[to]]=[editor.rules[to],editor.rules[at]];
  editor.openRule=Math.min(at,editor.rules.length-1);drawGroupRules();return;
 }
 const members=lines($('#f-members').value),at=members.indexOf(id);
 if(action==='group-add-member'){const pick=$('#f-newMember').value;if(pick&&!members.includes(pick))members.push(pick);}
 if(action==='group-member-remove'&&at>=0)members.splice(at,1);
 if(action==='group-member-up'||action==='group-member-down'){const to=at+(action.endsWith('up')?-1:1);if(at>=0&&to>=0&&to<members.length)[members[at],members[to]]=[members[to],members[at]];}
 $('#f-members').value=members.join('\n');drawGroupMembers();
}
async function previewGroupMatch(button){
 const current=editor,busy=startButtonBusy(button,'匹配中');
 try{
  const r=await api('group/match',{match:lines($('#f-match').value)});if(current!==editor||current.closed)return;
  current.rules=readGroupRules();
  const own=lines($('#f-members').value).filter(id=>!(current.data.matched || []).includes(id)),matched=(r.matched || []).filter(id=>!own.some(m=>splitGroupMember(m)[0]===id));
  current.data={...current.data,matched};
  $('#f-members').value=[...own,...matched].join('\n');
  $('#group-match-results').textContent=(r.hits || []).map(h=>`${h.pattern}：${h.models} 个模型`).join('；') || '没有自动匹配规则。';
  drawGroupMembers();
 }catch(error){if(current===editor&&!current.closed)formError(error);}finally{busy.finish();}
}
function handleGroupMemberChange(e){
 if(editor?.type!=='group')return;
 const control=e.target,row=control.closest('[data-member]');if(!row||!control.dataset.memberAction)return;
 const id=row.dataset.member,options=editor.groupOptions;
 if(control.dataset.memberAction==='enabled')options.off=control.checked?options.off.filter(v=>v!==id):[...options.off,id];
 if(control.dataset.memberAction==='fast')options.fast=control.checked?[...options.fast,id]:options.fast.filter(v=>v!==id);
 if(control.dataset.memberAction==='effort'){
  editor.rules=readGroupRules();const [base]=splitGroupMember(id),next=control.value?`${base}:${control.value}`:base,members=lines($('#f-members').value);
  if(next!==id&&members.includes(next)){formError('此模型在该等级下已经加入组。');drawGroupMembers();return;}
  $('#f-members').value=members.map(v=>v===id?next:v).join('\n');
  if((editor.data.matched || []).includes(id))editor.data={...editor.data,matched:editor.data.matched.filter(v=>v!==id)};
  for(const k of ['off','fast'])options[k]=options[k].map(v=>v===id?next:v);
  for(const r of editor.rules)if(r.use===id)r.use=next;
  if($('#f-pick').value===id){editor.data={...editor.data,pick:next};$('#f-pick').value='';}
  drawGroupMembers();
 }
}
function helpPage() {
 return heading('认识鲸桥','模型接入、账号管理和日常使用，一次了解。')+`<p class="help-intro">鲸桥是鲸屿的可选模型连接组件。它把 API 供应商和支持的订阅账号集中到一个渠道，让你在鲸屿桌面端选择模型、发起对话；同时管理模型列表、请求路由和通过鲸桥产生的用量。</p><div class="help-grid"><article class="help-card"><h3>${icon('providers')}接入 API 供应商</h3><p>在「供应商与账号」点击「添加供应商」，选择预设或填写兼容接口地址，再输入 API 密钥。模型 ID 可手动填写，也可以在保存后刷新供应商模型。</p></article><article class="help-card"><h3>${icon('account')}接入订阅账号</h3><p>选择「订阅账号」并按供应商指引登录。不同订阅支持的模型和登录方式不同；部分供应商需要认证工具或适配器，界面会说明。登录结果用于鲸桥接入。</p></article><article class="help-card"><h3>${icon('models')}在鲸屿中使用</h3><p>回到鲸屿桌面端，打开对话的模型选择器，在「鲸桥」渠道下选择模型。新增或隐藏模型会自动同步；已有默认模型不会因安装鲸桥被替换。</p></article><article class="help-card"><h3>${icon('routing')}按需配置路由</h3><p>路由组把多个模型合为一个可选模型。你可以按顺序、轮换或用量等策略分配请求。它是可选功能，直接选择供应商模型也能正常对话。</p></article></div><div class="section-head"><h2>使用前后，你可能想知道</h2></div><div class="panel"><details class="faq" open><summary>鲸桥提供模型或免费额度吗？</summary><p>鲸桥负责连接和管理模型。你需要自己的 API 密钥或支持的订阅账号，模型可用范围和费用由对应供应商决定。用量页的费用是按模型目录价格估算，最终以供应商账单为准。</p></details><details class="faq"><summary>窗口关了，鲸屿还能继续对话吗？</summary><p>可以。关闭设置窗口后，鲸桥进程继续在后台服务。若在启动器中停止组件，通过鲸桥的模型会暂时不可用；重新启动组件后恢复。</p></details><details class="faq"><summary>添加后，在桌面端找不到模型怎么办？</summary><p>先确认供应商已启用、密钥或账号已配置，并刷新该供应商的模型。在「模型管理」确认模型的显示开关已打开。需要时，可在概览的「连接信息与同步」中重新同步模型。</p></details><details class="faq"><summary>配置和请求会发到哪里？</summary><p>鲸桥的配置和凭据保存在本机，管理界面和连接网关只监听本机地址。对话请求会按你选择的模型发送给对应供应商；订阅登录按供应商的流程完成。</p></details><details class="faq"><summary>如何更新或卸载？会影响对话记录吗？</summary><p>在鲸屿启动器的「组件」页操作。卸载会移除「鲸桥」渠道，并可选择保留或删除鲸桥的配置与用量；不会删除鲸屿的聊天记录。如果默认模型来自鲸桥，卸载后需要重新选择模型。</p></details></div><div class="actions-bar">${button('管理供应商','go-providers','','primary')}${button('查看模型','go-models')}</div>`;
}
function renderModelsPage(){
 let html=heading('模型管理','整理鲸屿可选模型；参数与价格在供应商工作台中编辑。',button(`${icon('refresh')}更新模型目录`,'refresh-catalog'));
 html+=modelRows().length?`<div class="list-toolbar"><div class="search">${icon('search')}<input id="model-search" type="search" placeholder="搜索模型、渠道或供应商" aria-label="搜索模型" value="${escape(modelQuery)}"></div><div class="segments" aria-label="模型显示范围">${Object.entries({all:'全部',shown:'已显示',hidden:'已隐藏'}).map(([v,l])=>`<button type="button" data-filter="${v}" aria-pressed="${v===modelFilter}">${l}</button>`).join('')}</div><div class="model-all"><span>全选</span><span class="caption" data-count="all" data-id=""></span>${scopeSwitch('all','','显示当前结果中的全部模型')}</div></div><div id="model-list"></div><p class="usage-note">开关只作用于当前搜索和筛选结果。隐藏不删除供应商配置。</p>`:empty('模型列表还是空的','添加并启用供应商后整理桌面端列表。',button('添加供应商','add-provider','','primary'),'models');
 return html;
}
async function render(){
 if(!state)return;
 const epoch=++renderEpoch;clearTimeout(providerLiveTimer);
 document.querySelectorAll('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.setAttribute('aria-selected',String(selected));if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#page-label').textContent=pageNames[tab];$('#content').setAttribute('aria-busy','true');
 let html='';
 if(tab==='overview')html=overview();
 else if(tab==='providers')html=providers();
 else if(tab==='models')html=renderModelsPage();
 else if(tab==='routing')html=routingPage();
 else if(tab==='help')html=helpPage();
 else if(tab==='usage'||tab==='settings')html=await window.renderBridgeGlobalPage(tab,epoch);
 if(epoch!==renderEpoch)return;
 $('#content').innerHTML=html;$('#content').setAttribute('aria-busy','false');
 if($('#model-list')){modelList();$('#model-search').addEventListener('input',e=>{modelQuery=e.target.value;modelList();});}
 bindProviderAndGroupPages();
 if(tab==='usage'||tab==='settings')await window.bindBridgeGlobalPage(tab,epoch);
 if(tab==='providers')startProviderLive(epoch);
}
async function go(next){tab=next;message('');await render();$('#main').scrollTo({top:0});}
function field(name,label,value='',type='text',hint='') { return `<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${escape(value)}" autocomplete="${type==='password'?'new-password':'off'}" ${hint?`placeholder="${escape(hint)}"`:''}>`; }
function text(name,label,value='',hint='') { return `<label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" placeholder="${escape(hint)}">${escape(value)}</textarea>`; }
function routing(value,group=false){return `<label for="f-routing">请求分配策略</label><select id="f-routing" name="routing">${Object.entries(routes).filter(([v])=>group?v!=='weight':v!=='manual').map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select><p class="form-hint">按顺序优先使用列表靠前的模型；轮换会在模型间依次分配请求。</p>`;}
function proxyFields(value=''){
 const mode=value==='direct'?'direct':value?'custom':'';
 return `<label for="f-proxyMode">代理策略</label><select id="f-proxyMode" name="proxyMode"><option value="" ${!mode?'selected':''}>跟随全局代理</option><option value="direct" ${mode==='direct'?'selected':''}>直连，不使用代理</option><option value="custom" ${mode==='custom'?'selected':''}>自定义代理</option></select><div id="proxy-address" ${mode==='custom'?'':'hidden'}>${field('proxy','代理地址',mode==='custom'?value:'','text','http://127.0.0.1:7890 或 socks5://127.0.0.1:1080')}</div>`;
}
function workspaceOf(template,value){
 const [before,after]=template.split('{WorkspaceId}');
 return after!==undefined&&value.startsWith(before)&&value.endsWith(after)?value.slice(before.length,value.length-after.length):null;
}
function providerRegion(p,pr){
 return pr?.regions?.find(r=>r.decide&&(r.decide===p.decide||workspaceOf(r.decide,p.decide || '')!==null)) || pr?.regions?.find(r=>['chat','responses','anthropic'].some(k=>r[k]&&r[k]===p[k]));
}
function configurePreset(pr,apply=false){
 const p=editor.data,regions=pr?.regions || [],chosen=apply?regions[0]:providerRegion(p,pr);
 editor.preset=pr;
 $('#provider-region').innerHTML=regions.length?selectField('region',pr.regionLabel==='Plan'?'套餐 / 区域':pr.regionLabel || '区域',[['','自定义接口地址'],...regions.map(r=>[r.id,r.name])],chosen?.id || ''):'';
 const fill=r=>{
  for(const k of ['chat','responses','anthropic','decide'])$(`#f-${k}`).value=r[k] || (k==='decide'?pr?.decide:'') || '';
  for(const k of ['catalog','website','keysUrl','modelsURL'])$(`#f-${k}`).value=r[k] || pr?.[k] || '';
  $('#f-models').value=(r.models || pr?.models || []).join('\n');
  editor.available=(r.models || pr?.models || []).map(id=>({id,name:id}));drawProviderModels();
  updateWorkspace(pr,r);updatePresetLinks();
 };
 if(apply){$('#f-name').value=pr?.name || '';fill(chosen || pr || {});}else updateWorkspace(pr,chosen);
 const endpoint=$('#preset-endpoint');
 endpoint.hidden=!pr?.endpoint;
 endpoint.innerHTML=pr?.endpoint?field('endpoint',pr.id==='azure'?'Azure 资源 Endpoint':'远程网关地址',$('#f-chat').value || $('#f-responses').value,'url',pr.endpoint)+`<p class="form-hint">${pr.id==='azure'?'复制 Azure 门户中的资源地址；两个 OpenAI 接口同步更新，模型 ID 使用部署名称。':'填写远程网关提供的地址；支持其模型及路由组，并保留三个请求协议。'}</p>`:'';
 if($('#f-endpoint')){
  $('#f-endpoint').required=true;
  $('#f-endpoint').oninput=e=>{const value=e.target.value.trim();for(const k of pr.id==='azure'?['chat','responses']:['chat','responses','anthropic'])$(`#f-${k}`).value=value;};
 }
 $('#preset-note').innerHTML=pr?`<div class="preset-summary"><strong>${escape(pr.name)}</strong><p>${escape(pr.note || '使用此供应商的 API 密钥接入。')}</p>${pr.noKey?`<p class="caption">${pr.keyHint?'仅使用免费模型可留空密钥；调用付费模型请配置密钥。':'本地服务可留空 API 密钥；启用认证的服务仍需提供凭据。'}</p>`:''}</div>`:'';
 $('#f-key')?.setAttribute('placeholder',p.keySet?`${p.keyMasked || '已保存'} · 留空保留`:pr?.noKey?'可选：无需认证或仅用免费模型时留空':'每行、空格或逗号分隔');
 $('#f-region')?.addEventListener('change',e=>{const r=regions.find(r=>r.id===e.target.value);if(r)fill(r);else updateWorkspace(pr);});
 $('#f-decide').oninput=()=>updateWorkspace(pr,regions.find(r=>r.id===$('#f-region')?.value));
 $('#f-workspace').oninput=()=>{const r=regions.find(r=>r.id===$('#f-region')?.value),template=r?.decide || pr?.decide || '';if(template.includes('{WorkspaceId}'))$('#f-decide').value=template.replace('{WorkspaceId}',$('#f-workspace').value.trim());};
 updatePresetLinks();
}
function updatePresetLinks(){
 const target=$('#provider-links');if(!target)return;
 target.innerHTML=[['keysUrl','获取 / 管理密钥'],['website','供应商网站']].map(([k,label])=>$('#f-'+k)?.value?externalLink($('#f-'+k).value,label):'').join('');
}
function updateWorkspace(pr,region){
 const template=region?.decide || pr?.decide || '',row=$('#workspace-field'),input=$('#f-workspace');
 row.hidden=!template.includes('{WorkspaceId}');input.required=!row.hidden;
 if(row.hidden)return;
 const value=workspaceOf(template,$('#f-decide').value);
 if(value!==null&&!value.includes('{WorkspaceId}'))input.value=value;
 if(input.value.trim())$('#f-decide').value=template.replace('{WorkspaceId}',input.value.trim());
}
function headerRow(name='',saved=false,hint=false){
 const row=document.createElement('div');row.className='header-row';row.dataset.saved=saved?name:'';
 row.innerHTML=`<input class="header-name" aria-label="Header 名称" placeholder="Header 名称" value="${escape(name)}" ${saved?'readonly':''}><input class="header-value" type="password" autocomplete="new-password" aria-label="${escape(name || 'Header')} 值" placeholder="${saved?'已保存 · 留空保留':hint?'可选，填写后保存':'Header 值'}"><button type="button" class="icon-button danger" data-action="remove-header" aria-label="移除 ${escape(name || 'Header')}">${icon('trash')}</button>`;
 return row;
}
function headerChanges(){
 const changes=Object.fromEntries((editor.removedHeaders || []).map(name=>[name,null])), names=new Set();
 for(const row of document.querySelectorAll('.header-row')){
  const name=row.querySelector('.header-name').value.trim(), value=row.querySelector('.header-value').value;
  if(!name&&!value)continue;
  if(!name)throw new Error('请填写 HTTP Header 名称');
  const lower=name.toLowerCase();if(names.has(lower))throw new Error(`HTTP Header ${name} 重复`);names.add(lower);
  if(value)changes[name]=value;
  else if(!row.dataset.saved&&!row.dataset.hint)throw new Error(`请填写 HTTP Header ${name} 的值`);
 }
 return changes;
}
function selectField(name,label,options,value='') {return `<label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v,l])=>`<option value="${escape(v)}" ${String(v)===String(value)?'selected':''}>${escape(l)}</option>`).join('')}</select>`;}
function checkField(name,label,on=false,hint=''){return `<label class="check-field"><input type="checkbox" name="${name}" id="f-${name}" ${on?'checked':''}><span>${label}</span></label>${hint?`<p class="form-hint">${hint}</p>`:''}`;}
function integerField(name,label,value,min,max,hint=''){return field(name,label,value??'','number',hint).replace('<input ',`<input min="${min}" ${max==null?'':`max="${max}" `}step="1" `);}
const mapText=map=>Object.entries(map || {}).map(([id,n])=>`${id}=${n}`).join('\n');
function tokenMap(value){const map={};for(const row of value.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean)){const pair=row.includes('=')?row.split('='):['*',row];if(pair.length!==2)throw new Error(`长度格式无效：${row}`);const v=pair[1].trim().match(/^(\d+(?:\.\d+)?)\s*([km]?)$/i);if(!v)throw new Error(`请填写 Token 数或 128k、1m：${row}`);const n=Number(v[1])*({k:1000,m:1000000}[v[2].toLowerCase()] || 1);if(!Number.isSafeInteger(n)||n<1)throw new Error(`长度必须是正整数：${row}`);map[pair[0].trim() || '*']=n;}return map;}
function normalizeModel(m){return Object.fromEntries(Object.entries(m).map(([k,v])=>[k[0].toLowerCase()+k.slice(1),v]));}
function availableModels(p){const list=(p.available || []).map(normalizeModel),ids=new Set(list.map(m=>m.id));for(const id of p.models || [])if(!ids.has(id))list.push({id,name:id});return list;}
function capacityPicks(kind,p){
 const usual=kind==='contexts'?['128k','200k','256k','1m']:['8k','16k','32k','64k','128k'];
 const maximum=kind==='contexts'?(p.available || []).map(normalizeModel).filter(m=>m.max>Number(m.listed || m.context || 0)): [];
 return `<div class="capacity-picks">${usual.map(v=>button(v,'capacity-pick',JSON.stringify({kind,value:v}),'text-button')).join('')}${maximum.length?button('每个模型支持的最高值','capacity-pick',JSON.stringify({kind,value:maximum.map(m=>`${m.id}=${m.max}`).join('\n')}),'text-button'):''}</div>`;
}
function openProvider(id,mode='edit'){
 const source=state.providers.find(p=>p.id===id),p=source?{...source,models:[...(source.models || [])]}:{id:'',name:'',models:[],routing:''};
 if(mode==='another'){for(const k of Object.keys(p))delete p[k];Object.assign(p,{id:'',preset:source.preset,models:[],name:''});}
 if(mode==='copy'){p.id='';p.name=`${p.name} 副本`;}
 editor={type:'provider',data:p,removedHeaders:[],available:availableModels(p),modelPrefs:{},copyOf:mode==='copy'?source.id:'',from:mode==='edit'?p.id:'',section:'connection'};
 const pr=state.presets.find(x=>x.id===p.preset),account=!!p.account;
 $('#editor-title').textContent=p.id?`${p.name} · 供应商设置`:mode==='copy'?'复制供应商':'添加供应商';
 const connection=(!p.id?selectField('preset','供应商预设',[['','自定义兼容接口'],...state.presets.map(x=>[x.id,x.name])],p.preset):'')+
  '<div id="preset-note"></div>'+`<div class="form-grid"><div>${field('name','显示名称',p.name,'text','例如：我的 DeepSeek')}</div><div>${field('id','供应商 ID',p.id,'text','留空自动生成')}</div></div>`+
  (account?'<p class="form-hint">此供应商的身份与认证接口由订阅登录维护。</p>':field('key','API 密钥（支持粘贴多个）','','password',p.keySet?'留空保留':'每行、空格或逗号分隔')+`<div class="credential-tools">${button('显示密钥','show-provider-key',source?.id || '')}<div id="provider-links" class="external-links"></div></div>`)+
  '<div id="provider-region"></div><div id="preset-endpoint" hidden></div>'+
  `<div id="workspace-field" hidden>${field('workspace','Workspace ID','','text','API 密钥所属工作空间，如 ws-…')}<p class="form-hint">工作空间与所选地区一起生成决策接口地址。</p></div>`+
  selectField('baseAPI','探测首选接口',[['chat','Chat Completions'],['responses','Responses'],['anthropic','Anthropic Messages'],['decide','路由决策']],p.baseAPI || (p.responses&&!p.chat?'responses':'chat'))+
  `<div class="form-grid endpoint-grid"><div>${field('chat','Chat Completions 地址',p.chat,'url','https://api.example.com/v1')}</div><div>${field('responses','Responses 地址',p.responses,'url')}</div><div>${field('anthropic','Anthropic Messages 地址',p.anthropic,'url')}</div><div>${field('decide','路由决策地址',p.decide,'url')}</div></div>`+
  `<div class="actions-bar">${button('检查连接','test-provider',source?.id || '')}${button('检测协议','detect-provider',source?.id || '')}</div><div class="inline-result" id="provider-test-result" role="status"></div>`;
 const models=`<div class="actions-bar compact-actions">${button('全选','models-all')}${button('恢复默认选择','models-none')}${button('只选免费','models-free')}${button('刷新模型','fetch-edit-models',source?.id || '')}${source?button('清除目录缓存','unfetch-edit-models',source.id):''}</div><div class="search provider-model-search">${icon('search')}<input id="provider-model-search" type="search" aria-label="筛选供应商模型" placeholder="搜索名称或 ID"></div><p id="model-selection-summary" class="form-hint"></p><div id="provider-model-chips" class="model-chips"></div>${text('models','自定义 / 明确选择的模型 ID',(p.models || []).join('\n'),'每行一个；留空跟随供应商默认选择')}<p class="form-hint">默认选择会跟随目录变化；单模型参数可独立修改，不需要改成明确选择。</p>${checkField('unlisted','仅通过路由组使用',p.unlisted,'隐藏直接入口，路由组仍可使用这些模型。')}<div id="model-settings"></div><div class="actions-bar">${button('测试当前模型','test-selected-models')}${button('检测当前模型协议','detect-selected-models')}</div><div id="selected-model-results" class="inline-result" role="status"></div>`;
 const allocation=routing(p.routing)+selectField('affinity','缓存与会话保持',[['','自动 · 按缓存有效期'],['session','整个会话'],['turn','同一轮对话'],['off','每次重新分配']],p.affinity)+checkField('sink','仍有额度的身份被限流后排到队尾',p.sink)+
  `<div id="pin-upstream">${checkField('pinUpstream','DeepSeek 仅走官方上游',p.pinUpstream,'仅适用于 ClinePass；官方不可用时此请求失败，保留官方缓存。')}</div>`+text('fallback','故障转移模型（按顺序）',(p.fallback || []).join('\n'),'供应商ID/模型ID，每行一个');
 const limits=`<div class="form-grid"><div>${integerField('maxConcurrency','每个密钥 / 账号最大并发',p.maxConcurrency,0,null,'留空使用默认；0 不限')}</div><div>${integerField('queueLimit','排队上限',p.queueLimit || '',0,null,'0 或留空不限')}</div><div>${integerField('queueWait','最长等位时间（秒）',p.queueWait || '',0,null,'0 或留空一直等待')}</div><div>${field('priceRate','官方价格倍率',p.priceRate || '','number','例如 0.8 或 1.5').replace('<input ','<input min="0.001" step="0.001" ')}</div></div><p class="form-hint">并发与队列按每个身份计算；单模型自定义价格优先于倍率。</p>`+
  text('contexts','上下文窗口',mapText(p.contexts),'128k，或 model-id=1m')+capacityPicks('contexts',p)+
  text('outputs','最大输出 Token',mapText(p.outputs),'32k，或 model-id=64k')+capacityPicks('outputs',p)+
  text('compacts','鲸屿对话压缩阈值',mapText(p.compacts),'留空使用全局策略；model-id=128k')+`<p class="form-hint">按模型同步到鲸屿对话的压缩策略。可填写一个默认值或逐个模型覆盖。</p>`;
 const network=proxyFields(p.proxy)+(account?'':checkField('searches','此服务自行处理网页搜索工具',p.searches)+checkField('unredacted','可信本机 / 局域网服务接收原始请求',p.unredacted,'仅可信本地服务可跳过脱敏。'))+
  `<div class="form-grid"><div>${field('catalog','模型目录来源',p.catalog,'text','models.dev 供应商标识')}</div><div>${field('modelsURL','自定义模型列表地址',p.modelsURL,'url')}</div><div>${field('website','供应商网站',p.website,'url')}</div><div>${field('keysUrl','密钥管理页',p.keysUrl,'url')}</div></div>`;
 const balance=field('balanceURL','余额查询地址',p.balanceURL,'url')+text('balancePath','字段 / 表达式',p.balancePath,'$data.balance，或 (1 - credits.used / 70) %')+`<p class="form-hint">支持四则运算、括号、美元 $、百分比 %；多个值用分号分隔并可命名。</p>`+
  field('balanceToken','专用余额访问令牌','','password',p.balanceTokenSet?'已保存 · 留空保留':'可选，仅查询余额')+(p.balanceTokenSet?checkField('clearBalanceToken','删除已保存的余额令牌'):'')+
  `<div class="actions-bar">${button('查询余额','check-balance',source?.id || '')}</div><p id="balance-result" class="form-hint" role="status"></p>`+
  `<div class="form-grid"><div>${field('teamOrg','智谱 / Z.ai 团队组织 ID',p.zhipuTeam?.org)}</div><div>${field('teamProject','团队项目 ID',p.zhipuTeam?.project)}</div></div>`+(p.stepPlan?stepPlanFields(p.stepPlan):'');
 const identity=field('family','模型分类标识',p.family,'text','可选')+(account?'':field('providerIcon','供应商图标',p.icon || '')+`<div class="actions-bar"><label class="file-button"><span>上传图标</span><input id="provider-icon-file" type="file" accept="image/*,.ico,.svg"></label>${button('从网站获取','provider-favicon')}</div>`)+
  (source&&!account?`<div class="form-section"><h3>复用配置</h3><div class="actions-bar">${button('再添加一个同类来源','another-provider',source.id)}${button('复制此供应商','copy-provider',source.id)}</div></div>`:'');
 $('#fields').innerHTML=editorSection('connection','连接与凭据','配置来源及接口，保存前可检查连接。',connection)+
  editorSection('models','模型与价格','选择模型并调整名称、能力、协议和价格。',models)+
  editorSection('allocation','请求分配','供应商内部密钥与账号的请求分配。',allocation)+
  editorSection('limits','容量与限制','控制并发、等待、模型窗口与输出容量。',limits)+
  editorSection('network','代理与目录','设置连接策略与模型目录来源。',network)+
  (account?'':editorSection('balance','余额与套餐','独立查询凭据与团队套餐参数。',balance)+editorSection('headers','附加 Headers','已有值保密；留空保留，移除后保存删除。','<div id="header-list"></div><div class="actions-bar">'+button('添加 Header','add-header')+'</div>'))+
  editorSection('identity','外观与复用','识别来源并复用已有配置。',identity);
 $('#f-name').required=true;
 $('#f-proxyMode').onchange=e=>{$('#proxy-address').hidden=e.target.value!=='custom';$('#f-proxy').required=e.target.value==='custom';};$('#f-proxy').required=$('#f-proxyMode').value==='custom';
 for(const name of p.headerNames || [])$('#header-list')?.append(headerRow(name,true));
 const hints=pr=>{for(const name of pr?.headerHints || [])if(![...document.querySelectorAll('.header-name')].some(i=>i.value.toLowerCase()===name.toLowerCase()))$('#header-list')?.append(headerRow(name,false,true));};
 hints(pr);configurePreset(pr,mode==='another');
 const pin=pr=>$('#pin-upstream').hidden=!(pr?.id==='clinepass'||p.cline||/cline/i.test(p.preset || '')||/cline\./i.test(p.chat || ''));
 pin(pr);$('#f-preset')?.addEventListener('change',e=>{const chosen=state.presets.find(x=>x.id===e.target.value);configurePreset(chosen,true);hints(chosen);pin(chosen);});
 if(!account){
  $('#f-key').addEventListener('paste',e=>{const value=e.clipboardData?.getData('text');if(value&&/[\r\n]/.test(value)){e.preventDefault();e.target.value=value.trim().replace(/[\r\n]+/g,',');}});
  $('#provider-icon-file').addEventListener('change',uploadProviderIcon);
 }else{
  for(const key of ['id','name','chat','responses','anthropic','decide'])$(`#f-${key}`).readOnly=true;
  $('#f-baseAPI').disabled=true;$('#fields [data-action="detect-provider"]').hidden=true;
 }
 for(const key of ['website','keysUrl'])$(`#f-${key}`).addEventListener('input',updatePresetLinks);
 $('#f-models').addEventListener('input',drawProviderModels);$('#provider-model-search').addEventListener('input',drawProviderModels);
 drawProviderModels();showEditor();
}
function configuredProviderModelIds(){
 const explicit=lines($('#f-models').value);if(explicit.length)return explicit;
 const p=editor.data;
 if(Array.isArray(p.defaultModels))return p.defaultModels;
 const on=editor.available.filter(m=>m.on).map(m=>m.id);return on.length?on:editor.available.map(m=>m.id);
}
function drawProviderModels(){
 if(editor?.type!=='provider'||!$('#provider-model-chips'))return;
 const explicit=lines($('#f-models').value),picked=new Set(configuredProviderModelIds()),query=$('#provider-model-search').value.toLowerCase();
 const all=[...editor.available],known=new Set(all.map(m=>m.id));for(const id of explicit)if(!known.has(id))all.push({id,name:id});
 $('#model-selection-summary').textContent=explicit.length?`明确选择 ${explicit.length} 个模型`:`跟随供应商默认选择 · ${picked.size} 个模型`;
 $('#provider-model-chips').innerHTML=all.filter(m=>`${m.id} ${m.name}`.toLowerCase().includes(query)).map(m=>`<button type="button" class="model-chip" aria-pressed="${picked.has(m.id)}" data-action="pick-provider-model" data-id="${escape(m.id)}"><span>${picked.has(m.id)?'✓ ':''}${escape(m.name || m.id)}</span>${m.context?`<span>${short(m.context)}</span>`:''}${m.free||m.price&&m.price.input===0&&m.price.output===0?'<span>免费</span>':''}${m.rate?`<span class="model-rate">${escape(m.rate)}×${m.rateWas&&m.rateWas!==m.rate?` <s>${escape(m.rateWas)}×</s>`:''}</span>`:''}</button>`).join('') || '<p class="form-hint">没有匹配模型；可以手动添加供应商模型 ID。</p>';
 const shown=all.filter(m=>picked.has(m.id)),active=shown.find(m=>m.id===editor.modelSettingsId) || shown[0];
 editor.modelSettingsId=active?.id;
 $('#model-settings').innerHTML=active?`<div class="model-workspace"><aside><label for="provider-config-model">单模型参数</label><select id="provider-config-model" size="${Math.min(Math.max(shown.length,2),10)}">${shown.map(m=>`<option value="${escape(m.id)}" ${m.id===active.id?'selected':''}>${escape(m.name || m.id)}</option>`).join('')}</select><p class="caption">修改参数不会改变默认选择。</p></aside><div id="provider-model-configuration">${modelSettings(active)}</div></div>`:'<p class="form-hint">刷新模型目录或填写 ID 后可以调整模型参数。</p>';
 $('#provider-config-model')?.addEventListener('change',e=>{editor.modelSettingsId=e.target.value;$('#provider-model-configuration').innerHTML=modelSettings(all.find(m=>m.id===e.target.value));wireModelSettings();});
 wireModelSettings();
}
function modelSettings(m){
 const pref={...(editor.data.modelPrefs?.[m.id] || {}),...(editor.modelPrefs[m.id] || {})},name=pref.name ?? editor.data.modelNames?.[m.id] ?? '',efforts=pref.efforts ?? editor.data.modelEfforts?.[m.id] ?? [],api=pref.api ?? m.api ?? '',same=pref.same ?? m.same ?? '',images=pref.ownImages?'':pref.images===undefined?(m.imagesOverride===undefined?'':String(m.imagesOverride)):String(pref.images);
 const price=pref.ownPrice?null:pref.price || editor.data.modelPrices?.[m.id] || (m.ownPrice?m.price:null),list=m.list || (!m.ownPrice?m.price:null) || {},typed=editor.priceDrafts?.[m.id],custom=typed?typed.enabled:!!price;
 const tiers=typed?.tiers || (price?.tiers || list.tiers || []);
 return `<div class="model-setting" data-model="${escape(m.id)}"><div class="model-setting-heading"><div><h3>${escape(m.name || m.id)}</h3><code>${escape(m.id)}</code></div>${button('复制 ID','copy-model-id',m.id,'text-button')}</div><div class="model-setting-body"><div class="form-grid"><label>显示名称<input data-pref="name" value="${escape(name)}" placeholder="留空恢复供应商名称"></label><label>可用思考等级<input data-pref="efforts" value="${escape(efforts.join(', '))}" placeholder="留空恢复全部等级"></label></div>${m.efforts?.length?`<p class="caption">供应商报告：${escape(m.efforts.join('、'))}</p>`:''}<div class="form-grid"><label>调用协议<select data-pref="api">${[['','自动'],['chat','Chat Completions'],['responses','Responses'],['anthropic','Anthropic Messages']].map(([v,l])=>`<option value="${v}" ${v===api?'selected':''}>${l}</option>`).join('')}</select></label><label>图像输入<select data-pref="images">${[['','跟随供应商'],['true','支持'],['false','不支持']].map(([v,l])=>`<option value="${v}" ${v===images?'selected':''}>${l}</option>`).join('')}</select></label></div><label>等同模型 ID<input data-pref="same" value="${escape(same)}" placeholder="用于跨供应商自动归组"></label><div class="form-section"><h3>模型价格</h3><label class="check-field"><input type="checkbox" data-pref="customPrice" ${custom?'checked':''}><span>覆盖此模型价格（美元 / 百万 Token）</span></label><div class="model-price-editor" ${custom?'':'hidden'}><p class="form-hint">留空继承官方分项。没有官方报价的模型需要同时填写输入与输出价；0 表示免费。</p><div class="form-grid model-prices">${modelPriceFields(price || {},list,'price',typed?.base)}</div><p class="price-validation form-hint" role="status">${escape(editor.priceErrors?.[m.id] || '')}</p><h3 class="tier-heading">长上下文档位</h3><p class="form-hint">超过输入 Token 阈值后整次请求采用该档位；分项留空继承对应官方档位或当前基础价格。</p><div class="price-tiers">${tiers.map(t=>priceTierFields(t,{...list,...(price || {})},typed? t:undefined)).join('')}</div><div class="actions-bar">${button('添加价格档位','add-price-tier')}</div></div></div><div class="actions-bar">${button('测试此模型','test-one-model',m.id)}${button('恢复默认参数','reset-model-pref',m.id)}</div><p class="form-hint model-test-result" role="status"></p></div></div>`;
}
function modelPriceFields(price={},fallback={},prefix='price',typed){
 return [['input','输入'],['output','输出'],['cache_read','缓存读取'],['cache_write','缓存写入'],['cache_write_1h','一小时缓存写入']].map(([k,l])=>{
  const inherit=fallback[k] ?? (k.startsWith('cache')?0:''),value=typed?typed[k]:price[k] ?? '';
  return `<label>${l}<input type="number" min="0" step="any" data-${prefix}="${k}" data-inherit="${escape(inherit)}" value="${escape(value)}" placeholder="${inherit===''?'无官方报价，需填写':`继承 ${inherit}`}"></label>`;
 }).join('');
}
function priceTierFields(tier={},basis={},typed){
 const list=(basis.tiers || []).find(t=>Number(t.above)===Number(tier.above)),fallback=list || basis;
 return `<div class="price-tier" data-inherit-base="${!list}"><div class="price-tier-head"><label>输入 Token 超过<input type="number" min="1" step="1" data-tier-above value="${escape(tier.above || 272000)}"></label>${button('移除档位','remove-price-tier')}</div><div class="form-grid">${modelPriceFields(tier,fallback,'tier-price',typed)}</div></div>`;
}
function priceOfRow(row){
 const read=x=>{const value=x.value.trim()===''?x.dataset.inherit:x.value,n=Number(value);if(value===''||!Number.isFinite(n)||n<0)throw new Error('没有官方报价时，请同时填写输入与输出价格。');return n;};
 const price=Object.fromEntries([...row.querySelectorAll('[data-price]')].map(x=>[x.dataset.price,read(x)]));
 price.tiers=[...row.querySelectorAll('.price-tier')].map(t=>{
  const above=Number(t.querySelector('[data-tier-above]').value);if(!Number.isSafeInteger(above)||above<1)throw new Error('价格档位阈值必须是正整数 Token 数。');
  const parts=Object.fromEntries([...t.querySelectorAll('[data-tier-price]')].map(x=>[x.dataset.tierPrice,x.value.trim()===''?(t.dataset.inheritBase==='true'?price[x.dataset.tierPrice]:Number(x.dataset.inherit)):read(x)]));
  return {above,...parts};
 }).sort((a,b)=>a.above-b.above);
 if(new Set(price.tiers.map(t=>t.above)).size!==price.tiers.length)throw new Error('价格档位阈值不能重复。');
 return price;
}
function keepRowPrice(row){
 const id=row.dataset.model,pref=editor.modelPrefs[id] ||= {};
 editor.priceDrafts ||= {};editor.priceErrors ||= {};
 editor.priceDrafts[id]={enabled:true,base:Object.fromEntries([...row.querySelectorAll('[data-price]')].map(x=>[x.dataset.price,x.value])),tiers:[...row.querySelectorAll('.price-tier')].map(t=>({above:t.querySelector('[data-tier-above]').value,...Object.fromEntries([...t.querySelectorAll('[data-tier-price]')].map(x=>[x.dataset.tierPrice,x.value]))}))};
 try{pref.price=priceOfRow(row);delete pref.ownPrice;delete editor.priceErrors[id];}catch(error){editor.priceErrors[id]=error.message;}
 row.querySelector('.price-validation').textContent=editor.priceErrors[id] || '';
}
function wireModelSettings(){
 for(const row of document.querySelectorAll('.model-setting'))row.addEventListener('input',e=>{
  const id=row.dataset.model,pref=editor.modelPrefs[id] ||= {},input=e.target;
  if(input.dataset.pref==='customPrice'){
   row.querySelector('.model-price-editor').hidden=!input.checked;
   for(const field of row.querySelectorAll('.model-price-editor input'))field.disabled=!input.checked;
   if(!input.checked){delete pref.price;pref.ownPrice=true;delete editor.priceDrafts?.[id];delete editor.priceErrors?.[id];}else keepRowPrice(row);return;
  }
  if(input.dataset.price||input.dataset.tierPrice||input.hasAttribute('data-tier-above')){keepRowPrice(row);return;}
  const k=input.dataset.pref;if(!k)return;
  if(k==='images'){if(input.value===''){delete pref.images;pref.ownImages=true;}else{pref.images=input.value==='true';delete pref.ownImages;}}
  else pref[k]=k==='efforts'?input.value.split(/[,\s]+/).filter(Boolean):input.value;
 });
}
function providerInput(data){
 const p=editor.data,input={...data,id:data.id || '',from:editor.from,new:!editor.from,copyOf:editor.copyOf || undefined,models:lines(data.models),fallback:lines(data.fallback),proxy:data.proxyMode==='direct'?'direct':data.proxyMode==='custom'?data.proxy:'',headers:headerChanges(),contexts:tokenMap(data.contexts),outputs:tokenMap(data.outputs),compacts:tokenMap(data.compacts),modelPrefs:editor.modelPrefs};
 const priceError=Object.values(editor.priceErrors || {})[0];if(priceError)throw new Error(priceError);
 if(!$('#workspace-field').hidden){
  const workspace=data.workspace?.trim();if(!workspace)throw new Error('请填写此 API 密钥所属的 Workspace ID。');
  const r=editor.preset?.regions?.find(r=>r.id===data.region),template=r?.decide || editor.preset?.decide;
  if(template?.includes('{WorkspaceId}'))input.decide=template.replace('{WorkspaceId}',workspace);
 }
 if(input.decide?.includes('{WorkspaceId}'))throw new Error('决策接口尚未填写 Workspace ID。');
 for(const k of ['off','unlisted','searches','unredacted','pinUpstream','sink','clearBalanceToken'])input[k]=k==='off'?!!p.off:!!$(`#f-${k}`)?.checked;
 input.maxConcurrency=data.maxConcurrency===''?null:Number(data.maxConcurrency);for(const k of ['queueLimit','queueWait','priceRate'])input[k]=Number(data[k] || 0);
 if(p.account||!data.key)delete input.key;if(!data.balanceToken)delete input.balanceToken;
 input.icon=data.providerIcon===undefined?p.icon || '':data.providerIcon;delete input.providerIcon;
 if(!!data.teamOrg!==!!data.teamProject)throw new Error('团队套餐请同时填写组织 ID 和项目 ID。');
 input.zhipuTeam=data.teamOrg?{org:data.teamOrg.trim(),project:data.teamProject.trim()}:{};
 for(const k of ['proxyMode','region','workspace','endpoint','teamOrg','teamProject'])delete input[k];
 return input;
}
function groupModelChoices(){
 const all=new Map([...(state.models || []),...(state.hidden || [])].map(m=>[m.id,m]));
 for(const p of state.providers || [])for(const m of availableModels(p)){const id=`${p.id}/${m.id}`;const previous=all.get(id);all.set(id,{...m,...previous,id,canFast:m.canFast ?? previous?.canFast,name:previous?.name || m.name || m.id});}
 for(const g of state.groups || [])all.set(`group/${g.id.replace(/^group\//,'')}`,{id:`group/${g.id.replace(/^group\//,'')}`,name:g.name,group:true});
 return [...all.values()];
}
function splitGroupMember(id){const match=id.match(/:(none|minimal|low|medium|high|xhigh|max|ultra)$/);return match?[id.slice(0,-match[0].length),match[1]]:[id,''];}
function drawGroupMembers(){
 const members=lines($('#f-members').value),choices=groupModelChoices(),options=editor.groupOptions;
 $('#group-member-table').innerHTML=members.length?`<div class="management-table-wrap"><table class="management-table"><thead><tr><th>使用</th><th>成员模型</th><th>思考等级</th><th>速度</th><th>顺序</th><th></th></tr></thead><tbody>${members.map((id,i)=>{
  const automatic=(editor.data.matched || []).includes(id),[base,fixed]=splitGroupMember(id),m=choices.find(m=>m.id===base),levels=m?.efforts?.length?m.efforts:['none','minimal','low','medium','high','xhigh','max'];
  return `<tr data-member="${escape(id)}"><td><input type="checkbox" data-member-action="enabled" aria-label="使用 ${escape(m?.name || id)}" ${options.off.includes(id)?'':'checked'}></td><td><strong class="table-primary">${escape(m?.name || id)}</strong><code class="table-meta">${escape(id)}</code><span class="table-meta">${automatic?'自动匹配 · ':''}${m?.group?`嵌套路由组 ${button('编辑内组','group-edit-inner',base,'text-button')}`:`${m?.context?`${short(m.context)} Token · `:''}${m?.images?'可看图片':'图像能力未确认'}`}</span></td><td>${m?.group?'<span class="caption">跟随内层组</span>':`<select data-member-action="effort" aria-label="固定思考等级"><option value="">跟随组</option>${levels.map(v=>`<option value="${escape(v)}" ${v===fixed?'selected':''}>固定 ${escape(v)}</option>`).join('')}</select>`}</td><td>${m?.canFast?`<label class="check-field"><input type="checkbox" data-member-action="fast" ${options.fast.includes(id)?'checked':''}><span>Fast</span></label><span class="table-meta">供应商加速，费用更高</span>`:'<span class="caption">标准</span>'}</td><td><div class="actions">${!automatic?button('上移','group-member-up',id,'text-button')+button('下移','group-member-down',id,'text-button'):'<span class="caption">跟随匹配</span>'}</div></td><td>${!automatic?button('移除','group-member-remove',id,'text-button danger'):'<span class="caption">取消使用可暂时停用</span>'}</td></tr>`;
 }).join('')}</tbody></table></div>`:'<p class="form-hint">添加模型或设置自动匹配规则后，组才可以保存。</p>';
 const pick=$('#f-pick'),old=pick.value || editor.data.pick || '';
 pick.innerHTML=[['','第一个可用成员'],...members.map(m=>[m,m])].map(([v,l])=>`<option value="${escape(v)}" ${v===old?'selected':''}>${escape(l)}</option>`).join('');
 drawGroupRules();
}
function groupRuleRow(rule,index){
 const members=lines($('#f-members').value),options=members.includes(rule.use)?members:[...(rule.use?[rule.use]:[]),...members];
 const days=rule.time?.days || [];
 return `<details class="routing-rule" data-rule-index="${index}" ${index===editor.openRule?'open':''}><summary><span>规则 ${index+1}</span><strong>${escape(rule.use || '请选择目标成员')}</strong><span class="caption">多个条件需同时满足</span></summary><div class="routing-rule-body"><label>首先使用的成员<select data-rule="use"><option value="">选择成员</option>${options.map(id=>`<option value="${escape(id)}" ${id===rule.use?'selected':''}>${escape(id)}</option>`).join('')}</select></label><div class="form-grid"><label>输入 Token 至少<input type="number" min="1" step="1" data-rule="tokens" value="${rule.tokens || ''}" placeholder="不限"></label><label>请求思考等级<select data-rule="effort">${[['','不限'],['on','启用任意思考'],...['low','medium','high','xhigh','max'].map(v=>[v,`至少 ${v}`])].map(([v,l])=>`<option value="${v}" ${v===rule.effort?'selected':''}>${l}</option>`).join('')}</select></label></div><div class="checks"><label class="check-field"><input type="checkbox" data-rule="images" ${rule.images?'checked':''}><span>请求包含图片</span></label><label class="check-field"><input type="checkbox" data-rule="compact" ${rule.compact?'checked':''}><span>对话压缩请求</span></label></div><div class="form-grid"><label>消息意图<input data-rule="intent" value="${escape(rule.intent || '')}" placeholder="例如：代码调试"><span class="table-meta">需要配置下方分类模型</span></label><label>请求来源 ID<input data-rule="agents" value="${escape((rule.agents || []).join(', '))}" placeholder="留空不限；多个以逗号分隔"></label></div><div class="form-grid"><label>开始时间<input type="time" data-rule="from" value="${escape(rule.time?.from || '')}"></label><label>结束时间<input type="time" data-rule="to" value="${escape(rule.time?.to || '')}"></label></div><div class="rule-days">${['日','一','二','三','四','五','六'].map((d,i)=>`<label class="check-field"><input type="checkbox" data-rule-day="${i}" ${days.includes(i)?'checked':''}><span>周${d}</span></label>`).join('')}</div><p class="caption">按本机时间。只选星期表示全天；开始晚于结束表示跨午夜。</p><div class="actions-bar">${button('规则上移','group-rule-up',String(index),'text-button')}${button('规则下移','group-rule-down',String(index),'text-button')}${button('删除规则','group-rule-remove',String(index),'text-button danger')}</div></div></details>`;
}
function drawGroupRules(){if($('#group-rules'))$('#group-rules').innerHTML=editor.rules.map(groupRuleRow).join('') || '<p class="form-hint">没有条件规则。请求按组的分配策略使用成员。</p>';}
function readGroupRules(){
 return [...$('#group-rules').querySelectorAll('[data-rule-index]')].map(row=>{
  const value=k=>row.querySelector(`[data-rule="${k}"]`).value,flag=k=>row.querySelector(`[data-rule="${k}"]`).checked;
  const days=[...row.querySelectorAll('[data-rule-day]:checked')].map(c=>Number(c.dataset.ruleDay)),from=value('from'),to=value('to');
  return {use:value('use'),tokens:Number(value('tokens') || 0),effort:value('effort'),images:flag('images'),compact:flag('compact'),intent:value('intent').trim(),agents:value('agents').split(/[,\s]+/).filter(Boolean),time:from||to||days.length?{from:from || '00:00',to:to || '00:00',days}:null};
 });
}
function openGroup(id){
 const g=state.groups?.find(g=>g.id===id)||{id:'',name:'',members:[],routing:''};
 editor={type:'group',data:g,section:'members',groupOptions:{off:[...(g.off || [])],fast:[...(g.fast || [])]},rules:structuredClone(g.rules || []),openRule:0};
 $('#editor-title').textContent=id?`${g.name} · 路由组`:'新建路由组';
 const choices=groupModelChoices().filter(m=>!state.providers.some(p=>p.decide&&!p.chat&&!p.responses&&!p.anthropic&&m.id.startsWith(p.id+'/')));
 const members=`<div class="form-grid"><div>${field('name','组名称',g.name,'text','例如：日常助手')}</div><div>${field('id','路由 ID',g.id.replace(/^group\//,''),'text','everyday')}</div></div><p class="form-hint">在鲸屿模型选择器中以 group/路由ID 使用此组。</p><div class="group-add-member">${selectField('newMember','添加成员模型或嵌套组',[['','选择模型 / 路由组'],...choices.filter(m=>m.id!==`group/${g.id}`).map(m=>[m.id,`${m.name} · ${m.id}`])])}${button('加入组','group-add-member')}</div><div id="group-member-table"></div><details class="advanced"><summary>直接编辑成员 ID</summary><div class="advanced-body">${text('members','成员与顺序',(g.members || []).join('\n'),'供应商/模型，或 group/内层组；固定等级可用 :high')}</div></details>${text('match','自动匹配规则',(g.match || []).join('\n'),'openrouter/*:free 或 re:正则表达式')}<div class="actions-bar">${button('预览匹配成员','group-preview-match')}</div><p id="group-match-results" class="form-hint" role="status"></p><p class="form-hint">匹配规则跟随目录变化；明确成员的顺序在表格中调整。</p>`;
 const routingContent=routing(g.routing,true)+selectField('pick','固定使用成员',[['','第一个可用成员'],...(g.members || []).map(id=>[id,id])],g.pick || '')+
  `<p class="form-hint">“固定模型”策略使用此选择；其他策略仍保留该设置。</p>`+
  selectField('affinity','缓存与会话保持',[['','自动 · 按缓存有效期'],['session','整个会话'],['turn','同一轮对话'],['off','每次重新分配']],g.affinity || '')+
  checkField('sink','仍有额度的成员被限流后排到队尾',g.sink,'轮换与固定模型策略不使用后移。')+
  integerField('firstToken','首 Token 最长等待（秒）',g.firstToken || 0,0,null,'0 持续等待；最后一个可用候选仍会等完');
 const contextMode=g.context>0?'custom':g.context<0?'smallest':'largest';
 const levelsContent=selectField('contextMode','组上下文窗口',[['largest','成员最大窗口'],['smallest','成员最小窗口'],['custom','自定义窗口']],contextMode)+
  `<div id="group-context-custom" ${contextMode==='custom'?'':'hidden'}>${field('contextValue','自定义 Token 数',g.context>0?String(g.context):'','text','例如 128k')}</div>`+
  selectField('levelsMode','向鲸屿提供的思考等级',[['shared','成员共同支持的等级'],['own','指定等级']],g.levels?.length?'own':'shared')+
  `<div id="group-levels" class="checks" ${g.levels?.length?'':'hidden'}>${['none','minimal','low','medium','high','xhigh','max','ultra'].map(v=>`<label class="check-field"><input type="checkbox" data-group-level="${v}" ${(g.levels || []).includes(v)?'checked':''}><span>${v}</span></label>`).join('')}</div><p class="form-hint">指定等级时，成员不支持的等级会映射到该模型最近的可用等级。</p>`;
 const classifiers=groupModelChoices().filter(m=>m.id!==`group/${g.id}`);
 const conditions=`<p class="form-hint">从上到下匹配，第一条命中的规则先使用指定成员。条件与自动发现模型的 match 规则相互独立。</p><div id="group-rules"></div><div class="actions-bar">${button('添加条件规则','group-rule-add')}</div><div class="form-section"><h3>意图与任务难度</h3>${field('classifier','分类模型 / 决策供应商',g.classifier || '','text','供应商/模型，或 group/分类组').replace('<input ','<input list="classifier-options" ')}<datalist id="classifier-options">${classifiers.map(m=>`<option value="${escape(m.id)}">${escape(m.name)}</option>`).join('')}</datalist><p class="form-hint">意图规则与自动思考需要分类模型；可选普通模型、路由组或专用决策模型。</p>${selectField('effort','组思考策略',[['','跟随请求等级'],['auto','按每轮任务难度自动选择']],g.effort || '')}<p class="form-hint">自动模式只调整有思考等级的请求；标题等无思考辅助请求保持原状。</p></div>`;
 $('#fields').innerHTML=editorSection('members','成员与顺序','组织模型、固定等级和供应商加速模式。',members)+editorSection('routing','分配与保持','配置请求如何选成员及等位策略。',routingContent)+editorSection('conditions','条件与决策','按长度、图片、等级、意图和时段选择成员。',conditions)+editorSection('levels','上下文与等级','控制鲸屿看到的组能力与窗口。',levelsContent);
 $('#f-name').required=true;$('#f-id').required=true;
 $('#f-members').addEventListener('input',()=>{editor.rules=readGroupRules();drawGroupMembers();});
 $('#f-contextMode').onchange=e=>{$('#group-context-custom').hidden=e.target.value!=='custom';$('#f-contextValue').required=e.target.value==='custom';};$('#f-contextValue').required=contextMode==='custom';
 $('#f-levelsMode').onchange=e=>{$('#group-levels').hidden=e.target.value!=='own';};
 $('#group-rules').addEventListener('input',()=>{editor.rules=readGroupRules();});
 drawGroupMembers();showEditor();
}
function groupInput(data){
 for(const row of $('#group-rules').querySelectorAll('[data-rule-index]')){const from=row.querySelector('[data-rule="from"]').value,to=row.querySelector('[data-rule="to"]').value;if(!!from!==!!to)throw new Error('路由时段需要同时填写开始与结束时间。');}
 const g=editor.data,rules=readGroupRules(),members=lines(data.members),levels=data.levelsMode==='own'?[...$('#group-levels').querySelectorAll(':checked')].map(c=>c.dataset.groupLevel):[];
 if(data.levelsMode==='own'&&!levels.length)throw new Error('请至少选择一个思考等级，或使用成员共有等级。');
 if(rules.some(r=>!r.use))throw new Error('请为每条规则选择目标成员。');
 if(rules.some(r=>!r.tokens&&!r.images&&!r.effort&&!r.agents.length&&!r.intent&&!r.compact&&!r.time))throw new Error('每条路由规则至少需要一个条件。');
 if((rules.some(r=>r.intent)||data.effort==='auto')&&!data.classifier.trim())throw new Error('意图规则与自动思考需要分类模型。');
 const context=data.contextMode==='smallest'?-1:data.contextMode==='custom'?tokenMap(data.contextValue)['*']:0;
 if(data.contextMode==='custom'&&!context)throw new Error('组窗口请输入一个默认 Token 数，例如 128k。');
 return {...g,from:g.id,id:data.id,name:data.name,members,match:lines(data.match),routing:data.routing,pick:$('#f-pick').value,firstToken:Number(data.firstToken),affinity:data.affinity,sink:$('#f-sink').checked&&!['manual','rotate'].includes(data.routing),rules,classifier:data.classifier.trim(),effort:data.effort,context,levels,off:editor.groupOptions.off.filter(id=>members.includes(id)),fast:editor.groupOptions.fast.filter(id=>members.includes(id))};
}
function editorSection(id,title,description,content){return `<section class="editor-section" data-section="${escape(id)}" data-title="${escape(title)}"><header class="editor-section-head"><h3>${escape(title)}</h3>${description?`<p>${description}</p>`:''}</header>${content}</section>`;}
function activateEditorSection(id){
 for(const s of $('#fields').querySelectorAll('.editor-section'))s.hidden=s.dataset.section!==id;
 for(const b of $('#editor-nav').querySelectorAll('[data-section-target]'))b.setAttribute('aria-selected',String(b.dataset.sectionTarget===id));
 editor.section=id;$('.editor-content').scrollTo({top:0});
}
function configureEditorSections(){
 const sections=[...$('#fields').querySelectorAll(':scope > .editor-section')], nav=$('#editor-nav');
 nav.hidden=sections.length<2;nav.innerHTML=sections.length<2?'':sections.map(s=>`<button type="button" data-section-target="${escape(s.dataset.section)}" aria-selected="false">${escape(s.dataset.title)}</button>`).join('');
 $('#editor').classList.toggle('workbench',sections.length>1||['accounts','keys','adapters','health','quota-history'].includes(editor.type));
 if(sections.length>1)activateEditorSection(sections.some(s=>s.dataset.section===editor.section)?editor.section:sections[0].dataset.section);
}
function checkEditorValidity(){
 const invalid=[...$('#edit-form').elements].find(e=>e.willValidate&&!e.checkValidity());
 if(!invalid)return true;
 const section=invalid.closest('.editor-section');if(section)activateEditorSection(section.dataset.section);
 for(const details of invalid.closest('details')?[invalid.closest('details')]:[])details.open=true;
 invalid.reportValidity();return false;
}
function showEditor(){
 $('#form-error').hidden=true;$('#adapter-progress').hidden=true;$('#save').hidden=false;buttonBusy.delete($('#save'));$('#save').removeAttribute('aria-label');$('#save').removeAttribute('aria-busy');$('#save').style.minWidth='';$('#save').textContent='保存';$('#save').disabled=false;
 $('#cancel-editor').textContent=['accounts','keys','adapters','health'].includes(editor.type)?'关闭':'取消';
 configureEditorSections();
 decorateSelects();
 if(!$('#editor').open)$('#editor').showModal();
 ($('#fields .editor-section:not([hidden]) input:not([type=password]),#fields .editor-section:not([hidden]) select') || $('#fields input:not([type=password]),#fields select'))?.focus();
}
async function showConnectionSuccess(title,detail,source){
 clearTimeout(loginTimer);loginFlow=null;editor.type='connection-success';
 $('#editor-title').textContent=title;
 $('#fields').innerHTML=`<div class="connection-success" role="status"><div class="connection-result"><div class="connection-result-head"><span class="provider-avatar" aria-hidden="true">${escape(Array.from(source.name)[0].toUpperCase())}</span><div class="connection-identity"><strong>${escape(source.name)}</strong><div class="caption">${escape(source.kind)}${source.user?` · ${escape(source.user)}`:''}</div></div><span class="connection-success-status">${icon('check')}${source.updated?'授权已更新':'已接入'}</span></div><p>${escape(detail)}</p></div><div class="connection-next"><img src="/whale-head.png" alt=""><div><h3>下一步 · 开始使用模型</h3><p class="muted">回到鲸屿桌面端，在模型选择器中选择「鲸桥」渠道下的模型即可使用。</p></div></div></div>`;
  configureEditorSections();$('#form-error').hidden=true;$('#cancel-editor').textContent='完成';
 $('#save').hidden=false;$('#save').disabled=false;$('#save').textContent='查看供应商';$('#save').focus();
 await load();
}
const lines=value=>value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
$('#edit-form').addEventListener('invalid',e=>{const details=e.target.closest('details');if(details)details.open=true;},true);
$('#edit-form').addEventListener('submit',async e=>{
  e.preventDefault();const current=editor;if(!checkEditorValidity())return;
 if(current.type==='connection-success'){$('#editor').close();await go('providers');return;}
 if(['accounts','adapters','health','quota-history','export','import-result'].includes(current.type))return;
 const busy=startButtonBusy($('#save'),current.type==='subscription'?'登录中':current.type==='provider-import'?(current.preview?'导入中':'预览中'):'保存中');$('#form-error').hidden=true;const data=Object.fromEntries(new FormData(e.target));
 try {
  if(current.type==='subscription'){await beginSubscription(data);return;}
  if(current.type==='subscription-settings'){const payload={};for(const key of ['codexWarmup','claudeWarmup','codexWarmAt','claudeWarmAt'])payload[key]=data[key];payload.quotaLeft=$('#f-quotaLeft').checked;payload.chinaMirror=$('#f-chinaMirror').checked;for(const key of ['usageAlert','balanceAlert','resetReminder'])payload[key]=Number(data[key] || 0);payload.proxy=data.proxyMode==='direct'?'direct':data.proxyMode==='custom'?data.proxy:'';for(const key of ['workbuddyCheckin','traeCheckin','minimaxCheckin','qoderCheckin'])payload[key]=!!$(`#f-${key}`).checked;payload.pluginCheckins={...subscriptionSettings.pluginCheckins,...Object.fromEntries([...$('#fields').querySelectorAll('[data-plugin-checkin]')].map(c=>[c.dataset.pluginCheckin,c.checked]))};await api('subscription/settings',payload);if(current!==editor||current.closed)return;$('#editor').close();message('订阅维护设置已保存');state.quotaLeft=payload.quotaLeft;if(tab==='usage')await loadQuotas(renderEpoch);return;}
  if(current.type==='quota-account'){await api('accounts/settings',{id:current.data.provider,user:current.data.user,codexAutoReset:$('#f-codexAutoReset').checked,codexCredits:$('#f-codexCredits').checked,codexWarmAt:data.warmMode==='custom'?data.codexWarmAt:data.warmMode==='off'?'off':''});if(current!==editor||current.closed)return;$('#editor').close();message('账号维护设置已保存');await loadQuotas(renderEpoch);return;}
  if(current.type==='keys'){await api('keys',{id:current.data.id,action:'add',name:data.name,key:data.key,protocol:data.protocol});if(current!==editor||current.closed)return;await openKeys(current.data.id);message('密钥已添加');await load();return;}
  if(['key-edit','account-edit','key-import','auth-import','adapter-options'].includes(current.type)){await saveAccountEditor(data,current);return;}
  if(current.type==='provider-import'){
   if(!current.preview){const r=await api('provider/import',{text:data.source,preview:true});if(current!==editor||current.closed)return;const missing=r.providers.filter(p=>!p.keyOptional&&!p.keySet);current.source=data.source;current.preview=r.providers;$('#fields').innerHTML=`<p class="form-hint">将新增 ${r.providers.length} 个供应商。已有供应商和密钥保持原样；请核对来源和接口地址后导入。</p><div class="panel">${r.providers.map(p=>`<div class="row"><div class="text"><strong>${escape(p.name || p.id)}</strong><p class="caption">${escape(p.chat || p.responses || p.anthropic || '')}</p><p class="caption">${p.models?.length || 0} 个已选模型 · ${p.keySet?'包含密钥':p.keyOptional?'无需 API 密钥':'需要补充密钥'}</p></div></div>`).join('')}</div>`;if(missing.length&&r.providers.length===1){$('#fields').insertAdjacentHTML('beforeend',field('importKey','此供应商的 API 密钥','','password','导入前需要提供凭据'));$('#f-importKey').required=true;}else if(missing.length){current.preview=null;$('#fields').insertAdjacentHTML('beforeend',`<p class="inline-error">${escape(missing.map(p=>p.name || p.id).join('、'))} 需要密钥。请分别在各供应商 JSON 中填写 key，再重新预览。</p>`+text('source','补充凭据后的来源',data.source));$('#f-source').required=true;}$('#save').textContent=current.preview?'导入这些供应商':'重新预览';return;}
   const r=await api('provider/import',{text:current.source,...(data.importKey?{key:data.importKey}:{})});if(current!==editor||current.closed)return;$('#editor').close();message(`已新增 ${r.added?.length || current.preview.length} 个供应商，模型已同步`);await load();return;
  }
  if(current.type==='project'){await api('accounts/project',{id:current.data.id,user:current.data.user,project:data.project});if(current!==editor||current.closed)return;await openAccounts(current.data.id);message('Cloud project 已保存');await load();return;}
  if(current.type==='provider'){
   await api('provider',providerInput(data));
   }else{await api('group',groupInput(data));}
  if(current!==editor||current.closed)return;
  if(current.type==='provider'&&!current.data.id){await showConnectionSuccess('供应商添加成功',`${data.name} 已添加，模型已同步到鲸屿。`,{name:data.name,kind:'API 供应商'});return;}
  $('#editor').close();message('已保存，模型已同步到鲸屿');await load();
 }catch(e){if(current===editor&&!current.closed){$('#form-error').textContent=e.message;$('#form-error').hidden=false;}}finally{if(current===editor&&!current.closed)busy.finish();}
});
$('#close-editor').onclick=$('#cancel-editor').onclick=()=>$('#editor').close();
function ask(title,body,accept='确认',number){
 const d=$('#confirmation');$('#confirm-title').textContent=title;$('#confirm-body').textContent=body;$('#accept-confirm').textContent=accept;
 $('#confirm-input').innerHTML=number===undefined?'':field('weight','权重',number,'number');
 if(number!==undefined){$('#f-weight').required=true;$('#f-weight').min='1';$('#f-weight').step='1';}
 d.returnValue='';d.showModal();
 return new Promise(resolve=>d.addEventListener('close',()=>resolve(d.returnValue==='accept'?(number===undefined?true:Number($('#f-weight').value)):false),{once:true}));
}
$('#confirm-form').onsubmit=e=>{e.preventDefault();$('#confirmation').close('accept');};
$('#close-confirm').onclick=$('#cancel-confirm').onclick=()=>$('#confirmation').close();
$('#dismiss-message').onclick=()=>message('');
$('#refresh').addEventListener('click',load);
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>go(b.dataset.tab).catch(e=>message(e.message,true)));
// All navigational actions share one delegated handler, including footer help.
$('.workspace').addEventListener('click',async e=>{
 const filter=e.target.closest('[data-filter]');if(filter){modelFilter=filter.dataset.filter;modelList();return;}
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const{action,id}=b.dataset;
 const menu=b.closest('details.menu');if(menu)closeMenu(menu);
 let busy;const begin=label=>busy=startButtonBusy(menu?.querySelector('summary') || b,label);
 const waiting={subscription:'加载中',accounts:'加载中',keys:'加载中','export-provider':'导出中','manage-adapters':'加载中','provider-health':'读取中','subscription-settings':'加载中','quota-history':'加载中','refresh-quotas':'刷新中',sync:'同步中','refresh-catalog':'刷新中','fetch-provider':'刷新中','provider-up':'保存中','provider-down':'保存中','toggle-provider':'保存中'};
 if(waiting[action])begin(waiting[action]);
 try{
  if(action.startsWith('go-')){await go(action.slice(3));return;}
  if(action==='subscription'){await openSubscription();return;}
  if(action==='accounts'){await openAccounts(id);return;}
  if(action==='keys'){await openKeys(id);return;}
  if(action==='add-provider'||action==='edit-provider'){openProvider(id);return;}
  if(action==='copy-provider'||action==='another-provider'){openProvider(id,action==='copy-provider'?'copy':'another');return;}
  if(action==='import-provider'){editor={type:'provider-import'};$('#editor-title').textContent='导入供应商';$('#fields').innerHTML=text('source','供应商配置或分享链接','','粘贴供应商导出 JSON 或支持的导入链接')+'<p class="form-hint">导入会添加供应商，保留现有配置。</p>';$('#f-source').required=true;showEditor();$('#save').textContent='导入';return;}
  if(action==='export-provider'){await exportProvider(id);return;}
  if(action==='manage-adapters'){await openAdapters();return;}
  if(action==='provider-health'){await openProviderHealth();return;}
  if(action==='subscription-settings'){await openSubscriptionSettings();return;}
  if(action==='quota-history'){await openQuotaHistory();return;}
  if(action==='refresh-quotas'){await api('quotas/refresh',{provider:'',user:''});await loadQuotas(renderEpoch);message('供应商额度已刷新');return;}
  if(action.startsWith('quota-')){await quotaAction(action,id,b);return;}
  if(action==='add-group'||action==='edit-group'){openGroup(id);return;}
  if(action==='hide-model'){const m=modelRows().find(m=>m.id===id);if(m)await setModelVisibility([id],!m.hidden);return;}
  if(action==='model-scope'){await setModelVisibility(scopeRows(b.dataset.scope,id).map(m=>m.id),b.getAttribute('aria-checked')==='true');return;}
  if(action==='fold-channel'){const open=b.getAttribute('aria-expanded')!=='true';if(open)foldedChannels.delete(id);else foldedChannels.add(id);b.setAttribute('aria-expanded',String(open));b.closest('.model-channel').querySelector('.model-channel-body').hidden=!open;return;}
  b.disabled=true;
  if(action==='sync')await api('dsh/sync',{});
  if(action==='refresh-catalog')await api('catalog/refresh',{});
  if(action==='fetch-provider')await api('provider/fetch',{id});
  if(action==='provider-up'||action==='provider-down'){const ids=state.providers.map(p=>p.id),i=ids.indexOf(id),to=i+(action==='provider-up'?-1:1);if(to<0||to>=ids.length)return;[ids[i],ids[to]]=[ids[to],ids[i]];await api('provider/order',{ids});}
  if(action==='delete-provider'){if(!await ask('删除供应商？','对应的模型会从鲸屿的「鲸桥」渠道中移除。其他供应商和对话记录不受影响。','删除供应商'))return;begin('删除中');await api('provider/delete',{id});}
  if(action==='delete-group'){if(!await ask('删除路由组？','这个组会从鲸屿的模型列表中移除，成员模型和供应商配置仍保留。','删除路由组'))return;begin('删除中');await api('group/delete',{id});}
  if(action==='toggle-provider'){const p=state.providers.find(p=>p.id===id);await api('provider',{...p,off:!p.off});}
  message(action==='sync'?'模型已重新同步到鲸屿':'已更新，模型已同步到鲸屿');await load();
 }catch(e){message(e.message,true);}finally{busy?.finish();if(!['hide-model','model-scope','fold-channel'].includes(action))b.disabled=false;}
});
$('#fields').addEventListener('click',e=>{
 const header=e.target.closest('[data-action=add-header],[data-action=remove-header]');
 if(header){if(header.dataset.action==='add-header'){$('#header-list').append(headerRow());$('#header-list .header-row:last-child .header-name').focus();}else{const row=header.closest('.header-row');if(row.dataset.saved)editor.removedHeaders.push(row.dataset.saved);row.remove();}return;}
 const b=e.target.closest('[data-action=pick-member]');if(!b)return;
 const members=new Set(lines($('#f-members').value));if(members.has(b.dataset.id))members.delete(b.dataset.id);else members.add(b.dataset.id);
 $('#f-members').value=[...members].join('\n');
 syncMemberSelection();
});
function formError(error){if($('#editor').open){$('#form-error').textContent=error.message || String(error);$('#form-error').hidden=false;}else message(error.message || String(error),true);}
function dateText(value){const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString('zh-CN',{hour12:false});}
function externalLink(url,label){return /^https?:\/\//i.test(url || '')?`<a class="link" href="${escape(url)}" target="_blank" rel="noreferrer">${escape(label)} ↗</a>`:'';}
async function copyText(value){await navigator.clipboard.writeText(String(value));message('已复制');}
async function uploadProviderIcon(e){const file=e.target.files[0];if(!file)return;const current=editor,input=e.target,busy=startButtonBusy(input.parentElement.querySelector('span'),'上传中');input.disabled=true;
 try{if(file.size>1048576)throw new Error('图标最大为 1 MiB');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const r=await api('icons',{data:btoa(binary)});if(current===editor&&!current.closed)$('#f-providerIcon').value=r.icon;}catch(error){formError(error);}finally{busy.finish();input.disabled=false;}
}
function providerDraft(){const input=providerInput(Object.fromEntries(new FormData($('#edit-form'))));input.id=editor.from || editor.copyOf || '';input.typed=true;return input;}
function probeResults(results){return (results || []).map(r=>`<div class="probe-row ${r.ok?'probe-ok':'probe-error'}"><strong>${escape([r.model || r.protocol || '连接',r.account].filter(Boolean).join(' · '))}</strong><span>${escape(protocolName(r.protocol))} · ${r.ok?'可用':'未通过'}${r.status?` · HTTP ${r.status}`:''}${r.ms!==undefined?` · ${r.ms} ms`:''}</span>${r.error?`<p>${escape(r.error)}</p>`:''}${r.base?`<code>${escape(r.base)}</code>`:''}</div>`).join('') || '<p class="form-hint">供应商未返回检测结果。</p>';}
$('#fields').addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b||editor?.type!=='provider')return;const{action,id}=b.dataset;
 if(!['pick-provider-model','models-all','models-none','models-free','fetch-edit-models','unfetch-edit-models','test-provider','detect-provider','test-one-model','test-selected-models','detect-selected-models','reset-model-pref','copy-model-id','check-balance','another-provider','copy-provider','show-provider-key','provider-favicon','stepfun-copy','stepfun-session','stepfun-signout','add-price-tier','remove-price-tier'].includes(action))return;
 const current=editor;let busy;const waiting={'fetch-edit-models':'刷新中','unfetch-edit-models':'恢复中','test-provider':'测试中','detect-provider':'检测中','test-one-model':'测试中','test-selected-models':'测试中','detect-selected-models':'检测中','check-balance':'查询中','provider-favicon':'获取中','stepfun-session':'连接中','stepfun-signout':'退出中'};if(waiting[action])busy=startButtonBusy(b,waiting[action]);b.disabled=true;$('#form-error').hidden=true;
 try{
  if(action==='another-provider'||action==='copy-provider'){openProvider(id,action==='copy-provider'?'copy':'another');return;}
  if(action==='copy-model-id'){await copyText(id);return;}
  if(action==='add-price-tier'||action==='remove-price-tier'){const row=b.closest('.model-setting');if(action==='remove-price-tier')b.closest('.price-tier').remove();else{const price=priceOfRow(row),last=price.tiers.at(-1);row.querySelector('.price-tiers').insertAdjacentHTML('beforeend',priceTierFields({...price,above:last?last.above+100000:272000}));}keepRowPrice(row);return;}
  if(action==='show-provider-key'){const input=$('#f-key');if(input.type==='text'){input.type='password';b.textContent='显示密钥';if(current.revealedKey&&!current.typedKey){input.value='';current.revealedKey=false;}return;}if(!input.value&&id){busy=startButtonBusy(b,'读取中');input.value=(await api(`provider/${encodeURIComponent(id)}/key`)).key;current.revealedKey=true;}if(current!==editor||current.closed)return;input.type='text';b.textContent='隐藏密钥';return;}
  if(action==='provider-favicon'){const data=providerDraft(),r=await api('provider/icon',{url:data.chat || data.responses || data.anthropic || data.website,name:data.name});if(current===editor&&!current.closed)$('#f-providerIcon').value=r.icon;return;}
  if(action.startsWith('stepfun-')){const sp=current.data.stepPlan;if(action==='stepfun-copy'){await copyText(sp.bookmarklet);return;}await api(`stepfun/${encodeURIComponent(sp.site)}/${action==='stepfun-signout'?'signout':'session'}`,action==='stepfun-signout'?{}:{text:$('#f-stepSession').value});if(current!==editor||current.closed)return;const fresh=await api('state'),p=fresh.providers.find(p=>p.id===current.data.id);current.data.stepPlan=p.stepPlan;$('#step-plan').outerHTML=stepPlanFields(p.stepPlan);message(action==='stepfun-signout'?'已退出 StepFun 额度查询':'Step Plan 额度查询已连接');return;}
  if(action==='pick-provider-model'){const picked=new Set(configuredProviderModelIds());if(picked.has(id))picked.delete(id);else picked.add(id);$('#f-models').value=[...picked].join('\n');drawProviderModels();return;}
  if(['models-all','models-none','models-free'].includes(action)){$('#f-models').value=(action==='models-none'?[]:current.available.filter(m=>action==='models-all'||m.free||m.price?.input===0&&m.price?.output===0)).map(m=>m.id).join('\n');drawProviderModels();return;}
  if(action==='reset-model-pref'){current.modelPrefs[id]={name:'',efforts:[],ownImages:true,api:'',same:'',ownPrice:true};delete current.priceDrafts?.[id];delete current.priceErrors?.[id];drawProviderModels();return;}
  const data=providerDraft();
  if(action==='test-selected-models'||action==='detect-selected-models'){const ids=configuredProviderModelIds();if(!ids.length)throw new Error('请先选择要检查的模型');const r=await api(action==='test-selected-models'?'provider/test':'provider/detect',{...data,...(action==='test-selected-models'?{test:ids}:{detectModels:ids}),base:data[data.baseAPI] || data.chat || data.responses || data.anthropic});if(current!==editor||current.closed)return;$('#selected-model-results').innerHTML=r.models?r.models.map(m=>`<details class="advanced"><summary>${escape(m.model)}</summary>${probeResults(m.results)}</details>`).join('')+(r.models.length<ids.length?`<p class="form-hint">本次检查 ${r.models.length} / ${ids.length} 个模型。</p>`:''):probeResults(r.results);return;}
  if(action==='fetch-edit-models'||action==='unfetch-edit-models'){
   let r;if(action==='unfetch-edit-models'){await api('provider/unfetch',{id});const fresh=await api('state');r={provider:fresh.providers.find(p=>p.id===id)};}else r=await api(current.from?'provider/models':'provider/list',data);
   if(current!==editor||current.closed)return;current.available=r.provider?availableModels(r.provider):(r.models || []).map(normalizeModel);const dropped=new Set(r.dropped || []);$('#f-models').value=lines($('#f-models').value).filter(m=>!dropped.has(m)).join('\n');drawProviderModels();$('#provider-test-result').textContent=`模型目录已更新：${current.available.length} 个${dropped.size?`，${dropped.size} 个已下架模型已从选择中移除`:''}`;return;
  }
  if(action==='check-balance'){const r=await api('provider/balance',data);if(current!==editor||current.closed)return;$('#balance-result').textContent=r.error?`查询失败：${r.error}`:r.ok?`当前余额：${r.amount}`:'该供应商没有余额查询接口';return;}
  const result=await api(action==='detect-provider'?'provider/detect':'provider/test',{...data,...(action==='test-one-model'?{test:[id]}:{}),base:data[data.baseAPI] || data.chat || data.responses || data.anthropic || data.decide,model:action==='test-one-model'?id:lines($('#f-models').value)[0] || ''});
  if(current!==editor||current.closed)return;const target=action==='test-one-model'?b.closest('.model-setting').querySelector('.model-test-result'):$('#provider-test-result');target.innerHTML=probeResults(result.results);
  if(action==='detect-provider'){current.detected=result.results;target.insertAdjacentHTML('beforeend',button('采用可用的协议地址','apply-detected-protocols'));}
 }catch(error){if(current===editor&&!current.closed)formError(error);}finally{busy?.finish();if(b.getAttribute('aria-busy')!=='true')b.disabled=false;}
});
$('#fields').addEventListener('click',e=>{if(e.target.closest('[data-action="apply-detected-protocols"]')){for(const r of editor.detected || []){const input=$(`#f-${r.protocol}`);if(!input)continue;if(r.ok)input.value=r.base;else if([404,405].includes(r.status)&&input.value.replace(/\/$/,'')===String(r.base).replace(/\/$/,''))input.value='';}const chosen=(editor.detected || []).find(r=>r.ok);if(chosen)$('#f-baseAPI').value=chosen.protocol;message('协议地址已填入，保存后生效');}});
$('#fields').addEventListener('input',e=>{if(e.target.id==='f-key'&&editor?.type==='provider'){editor.typedKey=true;editor.revealedKey=false;}});
function stepPlanFields(sp){return `<div class="form-section" id="step-plan"><h3>Step Plan 套餐额度</h3>${sp.signedIn?`<p class="form-hint">已连接。可在「用量统计」查看 5 小时、每周与积分窗口。</p>${button('退出额度查询','stepfun-signout')}`:`<p class="form-hint">API 密钥只能查询余额。先登录 StepFun 平台，将书签工具复制到浏览器书签中，再从登录页面复制会话并粘贴到此处。会话只用于套餐额度查询。</p>${externalLink(sp.url,'登录 StepFun 平台')}<div class="actions-bar">${button('复制书签工具','stepfun-copy')}</div>${field('stepSession','StepFun 查询会话','','password','粘贴书签工具复制的内容')}<div class="actions-bar">${button('保存查询会话','stepfun-session')}</div>`}</div>`;}
async function exportProvider(id){const r=await api('provider/export',{id});editor={type:'export',data:{id}};$('#editor-title').textContent='导出供应商配置';$('#fields').innerHTML=text('export','供应商配置',r.text || JSON.stringify(r.provider || r,null,2))+'<p class="form-hint">导出内容不包含 API 密钥和认证 Header 值。复制后可在另一处导入，导入前补充凭据。</p><div class="actions-bar">'+button('复制配置','copy-export')+'</div>';showEditor();$('#f-export').readOnly=true;$('#save').hidden=true;}
function quotaIdentity(q){return JSON.stringify({provider:q.provider,user:q.user || ''});}
function quotaWindows(windows){return (windows || []).map(w=>{const used=Number(w.used),value=Number.isFinite(used)?Math.max(0,Math.min(100,used)):null,left=state?.quotaLeft ?? subscriptionSettings.quotaLeft,share=left?100-used:used;return `<div class="quota-window"><div><span>${escape(w.name)}</span><strong>${w.unlimited?'不限':w.display?escape(w.display):value===null?'未报告':`${share.toFixed(1)}% ${left?'剩余':'已使用'}`}</strong></div>${w.unlimited||value===null?'':`<progress max="100" value="${left?100-value:value}" aria-label="${escape(w.name)} ${left?'剩余':'已使用'} ${share.toFixed(1)}%"></progress>`}${w.limit?`<p class="caption">${short(left?w.limit-w.amount:w.amount)} / ${short(w.limit)} ${escape(w.unit || '')}</p>`:''}<p class="caption">${w.resetsAt?`重置于 ${escape(dateText(w.resetsAt))}`:w.resetSecs?`约 ${Math.ceil(w.resetSecs/60)} 分钟后重置`:''}${w.capped?` · 按账号额度上限使用${w.capsSome?'（此窗口所属模型）':''}`:''}</p></div>`;}).join('');}
function dailyCredits(daily){return daily?.days?.length?`<details class="advanced daily-credits"><summary>每日 credits 用量 · 自 ${escape(daily.since)} 起</summary><div class="table-wrap"><table><thead><tr><th>日期</th><th>已使用 credits</th></tr></thead><tbody>${[...daily.days].reverse().map(d=>`<tr><td>${escape(d.day)}</td><td>${short(d.used)}</td></tr>`).join('')}</tbody></table></div></details>`:'';}
function quotaResetDetails(resets){return resets?.each?.length?`<details class="advanced"><summary>每次额度重置的有效期（${resets.each.length} 次）</summary><div class="table-wrap"><table><thead><tr><th>适用窗口</th><th>有效期</th></tr></thead><tbody>${resets.each.map(r=>`<tr><td>${escape(({fiveHour:'5 小时窗口',weekly:'每周窗口'})[r.window] || '账户额度窗口')}</td><td>${r.until?escape(dateText(r.until)):'永不过期'}</td></tr>`).join('')}</tbody></table></div></details>`:'';}
function quotaHeldInfo(q){if(q.held)return '<p class="inline-error">额度已耗尽，供应商已暂停这个账号的请求。</p>';const codex=q.provider==='codex'||q.provider?.endsWith('/codex'),creditsOn=q.from||!(subscriptionSettings.codexNoCredits || []).includes((q.user || '').toLowerCase());return codex&&creditsOn&&q.balance&&(q.windows || []).some(w=>!w.unlimited&&Number(w.used)>=100)?'<p class="caption">套餐窗口额度已耗尽，继续使用付费 credits。</p>':'';}
function balanceTrendView(trend){const points=(trend?.points || []).map(p=>({...p,time:Date.parse(p.at)})).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.amount));if(points.length<2)return '';const first=points[0],last=points.at(-1),from=first.time,to=Math.max(last.time,trend.fitFrom?Date.now():last.time),minimum=Math.min(...points.map(p=>p.amount),trend.fitFrom?trend.fitNow:last.amount),maximum=Math.max(...points.map(p=>p.amount),trend.fitFrom?trend.fitStart:first.amount),spread=maximum-minimum || Math.max(maximum*.1,1),low=minimum-spread*.1,high=maximum+spread*.1,x=t=>24+(t-from)/(to-from || 1)*296,y=v=>92-(v-low)/(high-low)*72,polyline=points.map(p=>`${x(p.time).toFixed(1)},${y(p.amount).toFixed(1)}`).join(' ');return `<div class="balance-trend"><p class="caption">最近 14 天余额走势</p><svg viewBox="0 0 344 112" role="img" aria-label="余额从 ${escape(first.amount)} 变化到 ${escape(last.amount)}"><line class="trend-axis" x1="24" y1="92" x2="320" y2="92"/><polyline class="trend-line" points="${polyline}"/>${trend.fitFrom?`<line class="trend-fit" x1="${x(Date.parse(trend.fitFrom)).toFixed(1)}" y1="${y(trend.fitStart).toFixed(1)}" x2="${x(to).toFixed(1)}" y2="${y(trend.fitNow).toFixed(1)}"/>`:''}<circle class="trend-dot" cx="${x(last.time).toFixed(1)}" cy="${y(last.amount).toFixed(1)}" r="3"/><text x="24" y="108">${escape(new Date(first.time).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</text><text x="320" y="108" text-anchor="end">${escape(new Date(last.time).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</text><text x="24" y="12">${maximum.toFixed(2)}</text></svg>${trend.fitFrom?`<p class="caption">近期平均消耗 ${Number(trend.perDay).toFixed(2)} / 天${trend.runsOut?` · 预计 ${escape(dateText(trend.runsOut))} 耗尽`:''}</p><p class="form-hint">按近期余额变化估计，充值或用量变化会影响预测。</p>`:''}<details class="advanced"><summary>查看余额读取记录</summary><div class="table-wrap"><table><thead><tr><th>读取时间</th><th>余额</th></tr></thead><tbody>${[...points].reverse().map(p=>`<tr><td>${escape(dateText(p.at))}</td><td>${p.amount.toFixed(2)}</td></tr>`).join('')}</tbody></table></div></details></div>`;}
function quotaCards(rows){return rows.length?`<div class="quota-grid">${rows.map(q=>`<article class="panel quota-card"><div class="quota-head"><div><h3>${escape(q.name || q.provider)}</h3><p class="caption">${escape([q.from?`远端 ${q.from}`:'',q.user,q.plan].filter(Boolean).join(' · ') || 'API 余额')}</p></div>${iconButton('刷新这个账号的额度','quota-refresh',quotaIdentity(q),'refresh')}</div>${q.balance?`<strong class="quota-balance">${escape(q.balance)}</strong>`:''}${q.balanceParts?.length?`<dl class="quota-parts">${q.balanceParts.map(p=>`<dt>${escape(p.name || p.label || '余额')}</dt><dd>${escape(p.text || p.display || '')}</dd>`).join('')}</dl>`:''}${balanceTrendView(q.balanceTrend)}${quotaWindows(q.windows)}${q.until?`<p class="caption">套餐${q.renew==='auto'?'续费':'到期'}：${escape(dateText(q.until))}</p>`:''}${q.resets?`<p class="caption">${q.resets.byWindow?`5 小时重置 ${q.resets.fiveHour || 0} 次 · 每周重置 ${q.resets.weekly || 0} 次`:`剩余重置 ${q.resets.count} 次`}${q.resets.until?` · 最早到期 ${escape(dateText(q.resets.until))}`:''}</p>`:''}${quotaResetDetails(q.resets)}${quotaHeldInfo(q)}${q.checkin?`<p class="caption">签到：${escape(({claimed:'已领取',done:'今日已签到',ineligible:'无法参与',inactive:'活动未开始或已结束',failed:'签到失败',captcha:'需在供应商页面完成验证'})[q.checkin.outcome] || q.checkin.outcome)}${q.checkin.credit?` · 获得 ${short(q.checkin.credit)} credits`:''}${q.checkin.streak?` · 连续 ${q.checkin.streak} 天`:''}${q.checkin.msg?` · ${escape(q.checkin.msg)}`:''}</p>`:''}${dailyCredits(q.daily)}${q.error?`<p class="inline-error">${escape(q.error)}</p>`:''}${q.asOf?`<p class="inline-error">显示上次成功读取的额度：${escape(dateText(q.asOf))}</p>`:q.readAt?`<p class="caption">读取于 ${escape(dateText(q.readAt))}</p>`:''}${!(q.windows || []).length&&!q.balance&&!q.error?'<p class="form-hint">供应商未报告额度或余额。</p>':''}<div class="actions-bar compact-actions">${!q.from&&q.checkins?button('现在签到','quota-checkin',JSON.stringify({provider:q.checkinBy || q.provider})):''}${!q.from&&q.provider==='codex'&&q.resets?.count?button('使用一次重置','quota-reset',quotaIdentity(q)):''}${!q.from&&q.provider==='codex'&&q.user?button('账号维护','quota-settings',quotaIdentity(q)):''}${button('额度记录','quota-card-history',quotaIdentity(q))}</div></article>`).join('')}</div>`:empty('供应商暂无额度报告','部分供应商只报告余额，部分订阅需要连接套餐查询会话。配置入口在供应商设置中。','','usage');}
async function loadQuotas(epoch){
 const target=$('#quota-section');if(!target)return;const sequence=++quotaReadSequence,refresh=document.querySelector('[data-action="refresh-quotas"]'),busy=refresh?startButtonBusy(refresh,'刷新中'):null;target.setAttribute('aria-busy','true');
 try{
  let reading=false;
  const [rows,settings]=await Promise.all([api('quotas?asked=1',undefined,h=>{reading=h.get('X-Magpie-Reading')==='1';}),api('subscription/settings')]);
  if(epoch!==renderEpoch||sequence!==quotaReadSequence||target!==$('#quota-section'))return;
  subscriptionSettings=settings;quotaRows=rows || [];
  const draw=()=>{target.innerHTML=quotaCards(quotaRows);};draw();
  for(let poll=0;reading&&poll<20;poll++){
   await new Promise(resolve=>setTimeout(resolve,1500));
   if(epoch!==renderEpoch||sequence!==quotaReadSequence||target!==$('#quota-section'))return;
   const more=await api('quotas',undefined,h=>{reading=h.get('X-Magpie-Reading')==='1';});
   if(epoch!==renderEpoch||sequence!==quotaReadSequence||target!==$('#quota-section'))return;
   quotaRows=more || [];draw();
  }
  if(reading)target.insertAdjacentHTML('afterbegin','<p class="form-hint">供应商仍在读取，稍后点击刷新额度查看最新结果。</p>');
 }catch(error){if(epoch===renderEpoch&&sequence===quotaReadSequence&&target===$('#quota-section'))target.innerHTML=`<div class="panel empty"><h3>额度读取失败</h3><p>${escape(error.message)}</p>${button('重新读取','refresh-quotas')}</div>`;}
 finally{busy?.finish();if(epoch===renderEpoch&&sequence===quotaReadSequence&&target===$('#quota-section'))target.setAttribute('aria-busy','false');}
}
async function quotaAction(action,id,b){const data=JSON.parse(id);let busy;if(action!=='quota-reset'&&action!=='quota-settings')busy=startButtonBusy(b,action==='quota-checkin'?'签到中':action==='quota-refresh'?'刷新中':'加载中');b.disabled=true;try{
 if(action==='quota-card-history'){await openQuotaHistory(data);return;}
 if(action==='quota-settings'){openQuotaAccount(data);return;}
 if(action==='quota-reset'){if(!await ask('使用一次 Codex 重置？','会消耗这个账号的一次重置，重启供应商的额度窗口。当前窗口剩余额度会被重置。','使用一次重置'))return;busy=startButtonBusy(b,'重置中');const r=await api('quotas/codex-reset',{user:data.user});message(r.code?`重置结果：${r.code}`:'重置已提交');}
 else if(action==='quota-checkin'){const r=await api('quotas/checkin',data);const failed=(r.results || r || []).filter(a=>a.outcome==='failed'||a.outcome==='captcha');message(failed.length?`签到完成，${failed.length} 个账号需要处理`:'签到完成',failed.length>0);}
 else if(action==='quota-refresh')await api('quotas/refresh',data);
 await loadQuotas(renderEpoch);
 }finally{busy?.finish();if(b.getAttribute('aria-busy')!=='true')b.disabled=false;}}
function openQuotaAccount(data){const key=data.user.toLowerCase(),warm=subscriptionSettings.codexWarmAtOf?.[key] || '';editor={type:'quota-account',data};$('#editor-title').textContent='Codex 账号维护';$('#fields').innerHTML=`<p class="form-hint">${escape(data.user)}</p>`+checkField('codexAutoReset','按上游规则自动使用账号重置',(subscriptionSettings.codexAutoReset || []).includes(key),'每周窗口耗尽且其他账号不可用时，或已有重置即将到期时，允许自动消耗重置。')+checkField('codexCredits','额度用尽后继续使用付费 credits',!(subscriptionSettings.codexNoCredits || []).includes(key),'关闭后账号额度用尽时停止使用，转到其他账号或回退模型。')+selectField('warmMode','每日窗口预热',[['','跟随全局设置'],['off','关闭此账号的每日预热'],['custom','使用独立时间']],warm==='off'?'off':warm?'custom':'')+`<div id="own-warm-time" ${warm&&warm!=='off'?'':'hidden'}>${field('codexWarmAt','预热时间',warm==='off'?'':warm,'time')}</div>`;showEditor();$('#f-warmMode').onchange=e=>{$('#own-warm-time').hidden=e.target.value!=='custom';$('#f-codexWarmAt').required=e.target.value==='custom';};}
async function openSubscriptionSettings(){
 const [s,subs]=await Promise.all([api('subscription/settings'),api('subscriptions')]);subscriptionSettings=s;editor={type:'subscription-settings'};
 $('#editor-title').textContent='订阅维护设置';const choices=[['','关闭'],['week','每周窗口重置后预热'],['all','每个窗口重置后预热']];
 const warm=`<p class="form-hint">预热会发送一个很小的请求，使额度窗口从选定时间开始计算。只对鲸桥已启用的账号执行。</p><div class="form-grid"><div>${selectField('codexWarmup','Codex 窗口预热',choices,s.codexWarmup || '')}${field('codexWarmAt','Codex 每日预热时间',s.codexWarmAt || '','time')}<p class="caption">最近预热：${s.codexWarmed?escape(dateText(s.codexWarmed)):'尚无记录'}</p></div><div>${selectField('claudeWarmup','Claude 窗口预热',choices,s.claudeWarmup || '')}${field('claudeWarmAt','Claude 每日预热时间',s.claudeWarmAt || '','time')}<p class="caption">最近预热：${s.claudeWarmed?escape(dateText(s.claudeWarmed)):'尚无记录'}</p></div></div><p class="form-hint">每日时间留空则关闭；账号可设置独立的预热时间。</p>`;
 const claims=[['workbuddyCheckin','WorkBuddy 中国版'],['traeCheckin','Trae 中国版'],['minimaxCheckin','MiniMax Code 中国版'],['qoderCheckin','Qoder / Qoder 中国版']].map(([k,n])=>checkField(k,n,s[k])).join('')+subs.filter(p=>p.plugin&&p.checkin).map(p=>`<label class="check-field"><input type="checkbox" data-plugin-checkin="${escape(p.pid || p.id)}" ${s.pluginCheckinsEffective?.[p.pid || p.id]?'checked':''}><span>${escape(p.name)} 适配器签到</span></label>`).join('')+'<p class="form-hint">需要验证码时，在供应商页面完成；结果显示在额度卡片。</p>';
 const alerts=integerField('usageAlert','窗口使用达到此百分比提醒',s.usageAlert || '',0,100,'0 或留空关闭；每个窗口只提醒一次')+field('balanceAlert','余额低于此值提醒',s.balanceAlert || '','number','0 或留空关闭').replace('<input ','<input min="0" step="any" ')+integerField('resetReminder','重置 / credits 到期前提醒（小时）',s.resetReminder || '',0,168,'0 或留空关闭；最多 168 小时')+checkField('quotaLeft','按剩余额度显示窗口',s.quotaLeft);
 $('#fields').innerHTML=editorSection('warmup','窗口预热','选择触发策略和每日时间，查看上次实际预热。',warm)+editorSection('checkins','每日额度','自动执行供应商支持的每日签到。',claims)+editorSection('alerts','额度提醒','提醒通过鲸桥窗口显示。余额单位跟随供应商。',alerts)+editorSection('connection','认证与代理','认证工具下载及供应商连接的共同配置。',checkField('chinaMirror','认证工具和适配器使用国内镜像',s.chinaMirror)+proxyFields(s.proxy || '')+'<p class="form-hint">供应商与账号的独立代理设置优先。</p>');
 showEditor();$('#f-proxyMode').onchange=e=>{$('#proxy-address').hidden=e.target.value!=='custom';$('#f-proxy').required=e.target.value==='custom';};
}
async function openQuotaHistory(filter={}){
 editor={type:'quota-history',data:filter,days:35,historyRequest:0};const current=editor;$('#editor-title').textContent='供应商额度走势';
 $('#fields').innerHTML=`<div class="history-toolbar">${selectField('historyDays','日期范围',[['35','最近 35 天'],['7','最近 7 天'],['30','最近 30 天'],['custom','自选日期范围']],'35')}<div id="history-custom" class="form-grid" hidden>${field('historyFrom','开始日期','','date')}${field('historyTo','结束日期',new Date().toLocaleDateString('en-CA'),'date')}</div>${button('更新曲线','history-refresh')}</div><div id="quota-history-chart" aria-live="polite"></div>`;
 showEditor();$('#save').hidden=true;
 $('#f-historyDays').onchange=e=>{$('#history-custom').hidden=e.target.value!=='custom';if(e.target.value!=='custom')void refreshHistory();};
 $('#fields [data-action="history-refresh"]').onclick=()=>refreshHistory();
 async function refreshHistory(){
  const request=++current.historyRequest,target=$('#quota-history-chart');let from=0,to=Infinity,days=Number($('#f-historyDays').value);
  if($('#f-historyDays').value==='custom'){
   from=Date.parse($('#f-historyFrom').value+'T00:00:00');to=Date.parse($('#f-historyTo').value+'T23:59:59.999');
   if(!Number.isFinite(from)||!Number.isFinite(to)||from>to){formError('请选择有效的开始与结束日期。');return;}
   days=Math.max(1,Math.ceil((Date.now()-from)/86400000)+1);
  }
  const busy=startButtonBusy($('#fields [data-action="history-refresh"]'),'更新中');target.setAttribute('aria-busy','true');
  try{
   const query=new URLSearchParams({days:String(days),...(filter.provider?{provider:filter.provider}:{}),...(filter.user?{user:filter.user}:{})}),rows=await api(`quotas/history?${query}`);
   if(current!==editor||current.closed||request!==current.historyRequest)return;
   target.innerHTML=quotaHistoryView(rows || [],from,to);
   target.querySelectorAll('[data-history-point]').forEach(point=>{const read=()=>{point.closest('.quota-history-line').querySelector('[data-history-readout]').textContent=point.dataset.historyPoint;};point.onpointerenter=read;point.onfocus=read;});
  }catch(error){if(current===editor&&!current.closed&&request===current.historyRequest)formError(error);}
  finally{busy.finish();if(current===editor&&!current.closed&&request===current.historyRequest)target.setAttribute('aria-busy','false');}
 }
 await refreshHistory();
}
function quotaHistoryView(rows,from=0,to=Infinity){
 let shown=0;
 const html=rows.map(q=>{
  const lines=(q.lines || []).map(l=>{
   const points=(l.points || []).map(p=>({...p,time:Date.parse(p.at)})).filter(p=>Number.isFinite(p.time)&&Number.isFinite(Number(p.left))&&p.time>=from&&p.time<=to).sort((a,b)=>a.time-b.time);if(!points.length)return '';shown++;
   const start=points[0].time,end=points.at(-1).time,x=p=>48+(p.time-start)/(end-start || 1)*544,y=p=>132-Math.max(0,Math.min(100,Number(p.left)))*1.12,label=p=>`${dateText(p.at)} · 剩余 ${Number(p.left).toFixed(1)}%${p.resetsAt?' · 重置 '+dateText(p.resetsAt):''}`;
   return `<section class="quota-history-line"><h3>${escape(l.name)}</h3><p class="caption">剩余额度 · ${points.length} 次读取 · 鼠标悬停或键盘聚焦数据点查看详情</p><svg viewBox="0 0 620 160" role="img" aria-label="${escape(l.name)} 额度历史折线">${[0,50,100].map(v=>`<line class="trend-axis" x1="48" x2="592" y1="${132-v*1.12}" y2="${132-v*1.12}"/><text x="40" y="${136-v*1.12}" text-anchor="end">${v}%</text>`).join('')}<polyline class="trend-line" points="${points.map(p=>`${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ')}"/>${points.map(p=>`<circle class="trend-dot" cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="3" tabindex="0" data-history-point="${escape(label(p))}"><title>${escape(label(p))}</title></circle>`).join('')}<text x="48" y="154">${escape(new Date(start).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</text><text x="592" y="154" text-anchor="end">${escape(new Date(end).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</text></svg><p data-history-readout class="form-hint" role="status">${escape(label(points.at(-1)))}</p><details class="advanced"><summary>查看全部读取记录</summary><div class="table-wrap"><table><thead><tr><th>读取时间</th><th>剩余额度</th><th>重置时间</th></tr></thead><tbody>${[...points].reverse().map(p=>`<tr><td>${escape(dateText(p.at))}</td><td>${Number(p.left).toFixed(1)}%</td><td>${p.resetsAt?escape(dateText(p.resetsAt)):'—'}</td></tr>`).join('')}</tbody></table></div></details></section>`;
  }).join('');
  return lines?`<div class="form-section"><h3>${escape(q.provider)}${q.user?` · ${escape(q.user)}`:''}</h3>${lines}</div>`:'';
 }).join('');
 return shown?html:'<p class="form-hint">这个日期范围还没有额度记录。读取供应商额度后会逐步形成走势。</p>';
}
const healthLevels={ok:'正常',degraded:'性能下降',partial:'部分中断',major:'服务中断',maintenance:'维护中'};
function upstreamVendors(upstream){return Array.isArray(upstream.vendors)?upstream.vendors:Object.values(upstream.vendors || {});}
function liveLaneRows(lanes){return Object.entries(lanes || {}).map(([id,l])=>`<tr><td>${escape(id)}</td><td>${l.busy}</td><td>${l.waiting}</td><td>${l.limit || '不限'}</td></tr>`).join('') || '<tr><td colspan="4">当前没有受并发限制的请求。</td></tr>';}
async function startProviderLive(epoch){try{const [upstream,lanes]=await Promise.all([api('upstream'),api('lanes')]);if(epoch!==renderEpoch||tab!=='providers')return;const vendors=upstreamVendors(upstream);for(const target of document.querySelectorAll('[data-provider-live]')){const id=target.dataset.providerLive,status=vendors.find(v=>v.vendor===upstream.providers?.[id]),active=Object.entries(lanes).filter(([key])=>key===id||key.startsWith(`${id}#`)||key.startsWith(`${id}@`));target.innerHTML=`${status&&status.level!=='ok'?`<p class="${status.level?'inline-error':'caption'}">${escape(status.name)} API：${escape(healthLevels[status.level] || '公开状态未知')}${status.error?` · ${escape(status.error)}`:''} ${externalLink(status.page,'供应商状态页')}</p>`:''}${active.length?`<p class="caption">处理中 ${active.reduce((n,[,l])=>n+l.busy,0)} · 排队 ${active.reduce((n,[,l])=>n+l.waiting,0)}</p>`:''}`;}}catch(error){if(epoch===renderEpoch&&tab==='providers')for(const target of document.querySelectorAll('[data-provider-live]'))target.innerHTML=`<p class="caption">运行状态未能读取：${escape(error.message)}</p>`;}finally{if(epoch===renderEpoch&&tab==='providers')providerLiveTimer=setTimeout(()=>startProviderLive(epoch),5000);}}
function healthView(upstream,lanes){const vendors=upstreamVendors(upstream);return `<div class="panel">${vendors.map(v=>`<div class="row"><div class="text"><h3>${escape(v.name || v.vendor)}</h3><p class="caption">${escape(healthLevels[v.level] || '公开状态未知')}${v.read?` · ${escape(dateText(v.read))}`:''}</p>${v.error?`<p class="inline-error">${escape(v.error)}</p>`:''}${(v.parts || []).map(p=>`<p class="caption">${escape(p.name)} · ${escape(p.status)}</p>`).join('')}${(v.incidents || []).map(i=>`<p>${externalLink(i.url,i.name)}</p>`).join('')}${externalLink(v.page,'打开供应商状态页')}</div></div>`).join('') || '<p class="empty-inline">已配置供应商没有可读取的公开状态页。</p>'}</div><div class="form-section"><h3>当前请求与排队</h3><div class="table-wrap"><table><thead><tr><th>密钥 / 账号</th><th>处理中</th><th>排队</th><th>并发限制</th></tr></thead><tbody>${liveLaneRows(lanes)}</tbody></table></div></div>`;}
async function refreshHealth(current){try{const [upstream,lanes]=await Promise.all([api('upstream'),api('lanes')]);if(current!==editor||current.closed)return;$('#health-status').innerHTML=healthView(upstream,lanes);$('#health-error').hidden=true;}catch(error){if(current===editor&&!current.closed){$('#health-error').textContent=`运行状态未能读取：${error.message}`;$('#health-error').hidden=false;}}finally{if(current===editor&&!current.closed)healthTimer=setTimeout(()=>refreshHealth(current),3000);}}
async function openProviderHealth(){const [upstream,lanes]=await Promise.all([api('upstream'),api('lanes')]);clearTimeout(healthTimer);editor={type:'health'};const current=editor;$('#editor-title').textContent='供应商运行状态';$('#fields').innerHTML='<p class="form-hint">供应商自己的 API 服务状态；鲸桥请求与排队实时更新。</p><p id="health-error" class="inline-error" hidden></p><div id="health-status">'+healthView(upstream,lanes)+'</div>';showEditor();$('#save').hidden=true;healthTimer=setTimeout(()=>refreshHealth(current),3000);}
$('#editor').addEventListener('close',()=>clearTimeout(healthTimer));
function adapterRows(items,installed=false){
 return `<div class="management-table-wrap"><table class="management-table"><thead><tr><th>供应商适配器</th><th>${installed?'版本与状态':'来源'}</th><th>管理</th></tr></thead><tbody>${items.map(p=>{
  const ref=JSON.stringify({id:p.id,package:p.package}),summary=typeof p.summary==='object'?(p.summary?.zh || p.summary?.en || ''):p.summary || p.description || '';
  return `<tr><td><strong class="table-primary">${escape(p.name || p.package)}</strong><code class="table-meta">${escape(p.package)}</code><span class="table-meta">${escape(summary)}</span>${installed?`<span class="table-meta">${escape((p.providers || []).join('、'))}</span>`:''}${p.error?`<p class="inline-error">${escape(p.error)}</p>`:''}</td><td>${p.version?`<strong>${escape(p.version)}</strong>`:''}${installed?`<span class="status-badge">${p.enabled?'已启用':'已停用'}</span>${p.latest&&p.latest!==p.version?`<span class="table-meta">可更新 ${escape(p.latest)}</span>`:''}${p.autoUpdated?'<span class="table-meta">已自动更新</span>':''}`:`<span class="table-meta">${escape(p.publisher || '供应商提供')}</span>${p.weekly?`<span class="table-meta">每周下载 ${short(p.weekly)}</span>`:''}`}</td><td><div class="actions">${button('说明','adapter-page',ref,'text-button')}${installed?button('配置','adapter-options',ref)+button('更新','adapter-update',ref)+button(p.enabled?'停用':'启用',p.enabled?'adapter-off':'adapter-on',ref)+button('移除','adapter-remove',ref,'text-button danger'):button('安装','adapter-install',ref)}</div></td></tr>`;
 }).join('') || '<tr><td colspan="3" class="empty-inline">没有适配器。</td></tr>'}</tbody></table></div>`;
}
async function openAdapters(section='installed',expected){
 const r=await api('subscription/adapters');if(expected&&(expected!==editor||expected.closed))return;editor={type:'adapters',section};$('#editor-title').textContent='供应商适配器';
 const installed=`<div class="toolbar actions-bar">${button('检查更新','adapter-check',JSON.stringify({}))}${button('更新全部','adapter-update-all',JSON.stringify({}))}<label class="check-field"><input id="adapter-mirror" type="checkbox" ${r.mirror?'checked':''}><span>使用国内镜像</span></label></div><p class="form-hint">${r.bun?`运行环境 ${escape(r.bunVer || 'Bun')} 已就绪。`:'安装适配器需要 Bun，操作时由管理服务说明所需环境。'}${r.updates?.checked?` 最近检查：${escape(dateText(r.updates.checked))}`:''}</p>${r.error?`<p class="inline-error">${escape(r.error)}</p>`:''}${adapterRows(r.installed || [],true)}`;
 const available=(r.available || []).filter(p=>!(r.installed || []).some(i=>i.package===p.package));
 const discovery=`<div class="search"><input id="adapter-search-query" type="search" placeholder="搜索 npm 供应商适配器" aria-label="搜索供应商适配器">${button('搜索','adapter-search',JSON.stringify({}))}</div><div id="adapter-search-results">${adapterRows(available)}</div><div class="form-section"><h3>安装指定包</h3>${field('package','供应商提供的 npm 包名 / spec','','text','包名、包@版本或 npm spec')}<p class="form-hint">仅接入提供供应商认证的适配器。安装动作会保存到本机环境。</p>${button('安装此适配器','adapter-install-custom')}</div>`;
 const moves=(r.moves || []).map(m=>`<div class="row"><div class="text"><strong>${escape(subscriptionNames[m.id] || m.id)}</strong><p class="caption">${escape(m.package)} · ${m.moved?'适配器接入':'内置订阅接入'}</p>${m.error?`<p class="inline-error">${escape(m.error)}</p>`:''}</div>${button(m.moved?'恢复内置接入':m.signedIn?'迁移已有账号':'使用适配器接入',m.moved?'adapter-moveback':m.signedIn?'adapter-move':'adapter-adopt',JSON.stringify(m))}</div>`).join('') || '<p class="form-hint">当前没有可迁移的内置订阅。</p>';
 $('#fields').innerHTML=editorSection('installed','已安装','检查版本、配置认证适配器与连接环境。',installed)+editorSection('discover','查找与安装','选择推荐项或搜索供应商提供的 npm 包。',discovery)+editorSection('moves','订阅迁移','在内置接入与供应商适配器间管理已有授权。',`<div class="panel">${moves}</div>`);
 showEditor();$('#save').hidden=true;
 $('#adapter-mirror').onchange=async e=>{const current=editor,input=e.target,busy=startButtonBusy(input.nextElementSibling,'保存中');input.disabled=true;try{await api('subscription/adapter',{action:'mirror',enabled:e.target.checked});message('适配器镜像设置已保存');}catch(error){if(current===editor){e.target.checked=!e.target.checked;formError(error);}}finally{busy.finish();input.disabled=false;}};
 return editor;
}
async function handleAdapterAction(e){
 const b=e.target.closest('[data-action]');if(!b||b.disabled||editor?.adapterPending)return;
 if(b.dataset.action==='manage-adapters'){const busy=startButtonBusy(b,'加载中');try{await openAdapters('installed',editor);}catch(error){formError(error);}finally{busy.finish();}return;}
 if(!b.dataset.action.startsWith('adapter-'))return;
 const current=editor,action=b.dataset.action.replace('adapter-',''),data=action==='install-custom'?{package:$('#f-package').value.trim()}:JSON.parse(b.dataset.id || '{}');
 let progress,busy;const waiting={options:'加载中',page:'加载中',search:'搜索中',check:'检查中'};if(waiting[action])busy=startButtonBusy(b,waiting[action]);b.disabled=true;$('#form-error').hidden=true;
 try{
  if(action==='options'){
   const r=await api(`subscription/adapter/${encodeURIComponent(data.id)}/options`);if(current!==editor||current.closed)return;
   editor={type:'adapter-options',data};$('#editor-title').textContent='供应商适配器配置';
   const example=!Object.keys(r.options || {}).length&&r.example;
   $('#fields').innerHTML=text('options','认证配置（JSON）',JSON.stringify(example || r.options || {},null,2))+`<p class="form-hint">${example?'以下是适配器提供的示例，修改后保存才会使用。':'按供应商适配器说明编辑；保存后由该适配器使用。'}</p>`;showEditor();return;
  }
  if(action==='page'){
   const r=await api(`subscription/adapters/page?name=${encodeURIComponent(data.package)}`);if(current!==editor||current.closed)return;
   editor={type:'adapter-readme',data};$('#editor-title').textContent=`${data.package} · 使用说明`;
   $('#fields').innerHTML=`${r.updated?`<p class="caption">更新于 ${escape(dateText(r.updated))}</p>`:''}<pre class="adapter-readme">${escape(r.readme || '此适配器未提供说明。')}</pre><div class="actions-bar">${button('返回适配器','manage-adapters')}</div>`;showEditor();$('#save').hidden=true;return;
  }
  if(action==='search'){
   const q=$('#adapter-search-query').value.trim();if(!q)throw new Error('请填写包名或关键词。');
   const r=await api(`subscription/adapters/search?q=${encodeURIComponent(q)}`);if(current===editor&&!current.closed)$('#adapter-search-results').innerHTML=adapterRows(r.hits || []);return;
  }
  if(action==='check'){
   const r=await api('subscription/adapters/check',{});if(current!==editor||current.closed)return;
   const checkedEditor=await openAdapters('installed',current);if(!checkedEditor||checkedEditor!==editor||checkedEditor.closed)return;
   const unknown=(r.plugins || []).filter(p=>p.status==='unknown');
   if(unknown.length){formError(new Error(`部分适配器未能检查更新：${unknown.map(p=>`${p.package || p.spec}（${p.error || p.why || '未获取版本'}）`).join('；')}`));return;}
   const result=`检查完成：${(r.plugins || []).filter(p=>p.status==='update').length} 个适配器有更新`;
   $('#adapter-progress').hidden=false;$('#adapter-progress').innerHTML=`<p role="status">${escape(result)}</p>`;message(result);return;
  }
  if(action==='install-custom'&&!data.package)throw new Error('请填写适配器包名。');
  if(['remove','move','moveback'].includes(action)&&!await ask(action==='remove'?'移除供应商适配器？':action==='move'?'迁移已有订阅？':'恢复内置接入？',action==='remove'?'此适配器的供应商将暂时不可用；已保存的鲸桥配置保留。':action==='move'?'已有账号由适配器接入，凭据只写入鲸桥。':'账号交回鲸桥内置接入；原客户端登录数据保留。','继续'))return;
  if(['install','install-custom','update','update-all'].includes(action))progress=startAdapterBusy(b,action.startsWith('install')?'downloading':'updating');
  if(!progress)busy=startButtonBusy(b,action==='remove'?'移除中':action.startsWith('move')?'迁移中':'保存中');
  if(action.startsWith('install'))await installAdapter(data,progress);
  else await api('subscription/adapter',{...data,action});
  if(current!==editor||current.closed)return;
  progress?.update(action.startsWith('install')?'installing':'updating');
  await load();const installedEditor=await openAdapters('installed',current);if(!installedEditor||installedEditor!==editor||installedEditor.closed)return;
  const result=({install:'供应商适配器已安装','install-custom':'供应商适配器已安装',update:'供应商适配器已更新','update-all':'适配器更新完成',remove:'供应商适配器已移除',on:'供应商适配器已启用',off:'供应商适配器已停用',move:'已有订阅已迁移到适配器',moveback:'订阅已恢复内置接入',adopt:'订阅已使用适配器接入'})[action];
  $('#adapter-progress').hidden=false;$('#adapter-progress').setAttribute('aria-busy','false');$('#adapter-progress').innerHTML=`<p role="status">${escape(result)}</p>`;message(result);
 }catch(error){if(current===editor&&!current.closed)formError(error);}finally{progress?.finish();busy?.finish();if(b.getAttribute('aria-busy')!=='true')b.disabled=false;}
}
$('#fields').addEventListener('click',handleAdapterAction);
$('#fields').addEventListener('click',e=>{if(e.target.closest('[data-action="copy-export"]'))copyText($('#f-export').value).catch(formError);});
function closeMenu(menu,focus=false){
 const content=menu.querySelector('.menu-content');
 if(content.matches(':popover-open'))content.hidePopover();
 menu.open=false;menu.querySelector('summary').setAttribute('aria-expanded','false');
 if(focus)menu.querySelector('summary').focus();
}
document.addEventListener('click',e=>{
 const summary=e.target.closest('details.menu > summary');
 for(const menu of document.querySelectorAll('details.menu[open]'))if(!menu.contains(e.target))closeMenu(menu);
 if(!summary)return;
 e.preventDefault();if(summary.getAttribute('aria-busy')==='true')return;const menu=summary.parentElement,content=menu.querySelector('.menu-content');
 if(menu.open){closeMenu(menu);return;}
 content.setAttribute('popover','auto');content.setAttribute('role','menu');
 for(const button of content.querySelectorAll('button'))button.setAttribute('role','menuitem');
 summary.setAttribute('aria-haspopup','menu');summary.setAttribute('aria-expanded','true');
 menu.open=true;content.showPopover();
 const anchor=summary.getBoundingClientRect(),box=content.getBoundingClientRect();
 content.style.left=`${Math.max(8,Math.min(anchor.right-box.width,innerWidth-box.width-8))}px`;
 const top=anchor.bottom+box.height+4<=innerHeight-8?anchor.bottom+4:anchor.top-box.height-4;
 content.style.top=`${Math.max(8,Math.min(top,innerHeight-box.height-8))}px`;
 content.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
},true);
document.addEventListener('keydown',e=>{
 const menu=e.target.closest('details.menu[open]');if(!menu)return;
 if(e.key==='Escape'){e.preventDefault();closeMenu(menu,true);return;}
 if(!['ArrowDown','ArrowUp','Home','End','Tab'].includes(e.key))return;
 if(e.key==='Tab'){closeMenu(menu);return;}
 const items=[...menu.querySelectorAll('.menu-content button:not(:disabled)')],at=items.indexOf(document.activeElement);
 e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
});
for(const event of ['scroll','resize'])window.addEventListener(event,e=>{if(e.type==='scroll'&&e.target.closest?.('.menu-content'))return;for(const menu of document.querySelectorAll('details.menu[open]'))closeMenu(menu);},true);
$('#editor-nav').addEventListener('click',e=>{const b=e.target.closest('[data-section-target]');if(b)activateEditorSection(b.dataset.sectionTarget);});
window.configureEditorSections=configureEditorSections;
$('#fields').addEventListener('change',handleGroupMemberChange);
$('#fields').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;if(editor?.type==='group'&&b.dataset.action==='group-preview-match'){void previewGroupMatch(b);return;}if(editor?.type==='group'&&b.dataset.action==='group-edit-inner'){void (async()=>{if(await ask('编辑内层路由组？','当前组尚未保存的修改会丢弃。请先保存，或继续进入内层组。','继续编辑内组')){const id=b.dataset.id.replace(/^group\//,'');await new Promise(resolve=>{$('#editor').addEventListener('close',resolve,{once:true});$('#editor').close();});openGroup(id);}})();return;}if(editor?.type==='group'&&b.dataset.action.startsWith('group-')){try{groupEditorAction(b.dataset.action,b.dataset.id);}catch(error){formError(error);}}if(b.dataset.action==='capacity-pick'){const data=JSON.parse(b.dataset.id);$('#f-'+data.kind).value=data.value;}});
$('#content').addEventListener('change',e=>{if(e.target.dataset.groupSelect)e.target.checked?selectedGroups.add(e.target.dataset.groupSelect):selectedGroups.delete(e.target.dataset.groupSelect);});
$('#content').addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,id=b.dataset.id;if(!['group-up','group-down','group-switch','remove-selected-groups'].includes(action))return;e.stopPropagation();if(b.disabled)return;let busy;if(action!=='remove-selected-groups')busy=startButtonBusy(b,'保存中');b.disabled=true;try{if(action==='group-switch'){const g=state.groups.find(g=>g.id===id);await api('group/switch',{id,off:!g.disabled});}else if(action==='remove-selected-groups'){const ids=[...selectedGroups].filter(id=>state.groups.some(g=>g.id===id));if(!ids.length)throw new Error('请先选择路由组。');if(!await ask('删除已选路由组？',`将删除 ${ids.length} 个组；鲸屿模型列表随后同步。`,'删除组'))return;busy=startButtonBusy(b,'删除中');await api('group/delete',{ids});selectedGroups.clear();}else{const order=state.groups.map(g=>g.id),at=order.indexOf(id),to=at+(action==='group-up'?-1:1);if(at<0||to<0||to>=order.length)return;[order[at],order[to]]=[order[to],order[at]];await api('group/order',{order});}await load();}catch(error){message(error.message,true);}finally{busy?.finish();if(b.getAttribute('aria-busy')!=='true')b.disabled=false;}});
window.addEventListener('DOMContentLoaded',load,{once:true});
