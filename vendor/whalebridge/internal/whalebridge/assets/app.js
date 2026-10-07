'use strict';
const theme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){document.documentElement.toggleAttribute('data-ds-dark-theme',theme.matches);}
applyTheme();theme.addEventListener('change',applyTheme);
const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
let state, tab = 'overview', period = 'today', editor, renderEpoch = 0;
let modelQuery = '', modelFilter = 'all', loginFlow, loginTimer;
let visibilityWrites = Promise.resolve();
const visibilityPending = new Map();
const foldedChannels = new Set();
let messageTimer;
let quotaRows=[],subscriptionSettings={},providerLiveTimer,healthTimer;
const pageNames = {overview:'接入概览',providers:'供应商与账号',models:'模型管理',routing:'路由组',usage:'用量统计',help:'使用说明'};
 const routes = {'':'智能','order':'按顺序','rotate':'轮换','usage':'最少用量','pace':'按剩余额度','weight':'权重','manual':'固定模型'};
async function api(path, body) {
 const response = await fetch(`/api/${path}`, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
 if (!response.ok) throw new Error(await response.text());
 return response.json();
}
function message(text, error = false) {
 $('#message-text').textContent = text; $('#message').hidden = !text;
 $('#message').dataset.error = String(error);
 clearTimeout(messageTimer);
 if(text&&!error)messageTimer=setTimeout(()=>message(''),3200);
}
async function load() {
 $('#refresh').disabled = true;
 try {
  state = await api('state');
  $('#version').textContent = `v${state.version}`;
  $('#connection').textContent = '模型服务运行中'; $('#connection').dataset.state = 'ready';
  $('#provider-count').textContent = state.providers.length || '';
  $('#model-count').textContent = state.models?.length || '';
  await render();
 } catch(e) {
  $('#connection').textContent = '连接异常'; $('#connection').dataset.state = 'error';
  $('#content').setAttribute('aria-busy','false');
  if(!state) $('#content').innerHTML = empty('暂时无法读取配置','请确认鲸桥正在运行，然后点击右上角刷新。','','info');
  message(e.message,true);
 } finally { $('#refresh').disabled = false; }
}
function heading(title, description, action = '') { return `<div class="top"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
const button = (label, action, id = '', cls = '') => `<button type="button" class="${cls}" data-action="${action}" data-id="${escape(id)}">${label}</button>`;
const iconButton = (label, action, id, glyph, cls = '') => `<button type="button" class="icon-button ${cls}" data-action="${action}" data-id="${escape(id)}" aria-label="${escape(label)}" title="${escape(label)}">${icon(glyph)}</button>`;
const empty = (title, text, action = '', glyph = 'models') => `<div class="panel empty"><span class="empty-symbol">${icon(glyph)}</span><h2>${title}</h2><p>${text}</p><div class="empty-actions">${action}</div></div>`;
const short = n => new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(n || 0);
function stat(label,value,note,glyph){return `<div class="stat"><div class="stat-label">${label}${icon(glyph)}</div><strong>${value}</strong><p class="caption">${note}</p></div>`;}
function overview() {
 const total = state.providers.length, active = state.providers.filter(p=>!p.off).length, models = state.models?.length || 0;
 return `<div class="hero"><div class="hero-copy"><span class="tag subtle">鲸屿官方组件</span><h1>你的模型，接入鲸屿。</h1><p>鲸桥是鲸屿的模型连接组件。集中管理 API 供应商和订阅账号，让不同来源的模型都能在桌面端使用。</p><div class="actions-bar">${button(`${icon('plus')}添加供应商`,'add-provider','','primary')}${button('接入订阅账号','subscription')}</div></div><div class="connection-map" aria-label="供应商和订阅账号通过鲸桥接入鲸屿桌面端"><div class="flow-node">${icon('account')}<div class="text"><h3>你的供应商与订阅账号</h3><p class="caption">API 密钥 · 订阅登录</p></div></div><div class="flow-link"></div><div class="flow-node bridge">${icon('routing')}<div class="text"><h3>鲸桥 · 统一模型入口</h3><p class="caption">模型管理 · 请求路由 · 用量记录</p></div></div><div class="flow-link"></div><div class="flow-node"><img src="/whale-head.png" alt="鲸屿"><div class="text"><h3>鲸屿桌面端</h3><p class="caption">选择「鲸桥」渠道开始对话</p></div><span class="tag business">已接入</span></div></div></div>
 <div class="stats">${stat('已配置供应商',total,`${active} 个已启用`,'providers')}${stat('可用模型',models,'已同步到鲸屿桌面端','models')}${stat('路由组',state.groups?.length || 0,'多个模型，共用一个入口','routing')}</div>
 <div class="section-head"><div><h2>从接入到对话，只需三步</h2><p>已有配置可以随时调整，保存后自动同步。</p></div>${button('查看说明','go-help','','text-button')}</div>
 <div class="steps"><article class="step"><div class="step-head"><span class="step-number">01 / 连接来源</span>${total?icon('check'):icon('providers')}</div><h3>添加供应商或登录订阅</h3><p>填写供应商的 API 密钥，或通过支持的供应商登录流程接入订阅账号。</p>${button(`${total?'管理供应商':'开始添加'} ${icon('arrow')}`,total?'go-providers':'add-provider')}</article><article class="step"><div class="step-head"><span class="step-number">02 / 选择模型</span>${models?icon('check'):icon('models')}</div><h3>整理桌面端的模型列表</h3><p>保留常用模型，隐藏暂时不用的模型。多个模型也可以组合为一个路由组。</p>${button(`管理模型 ${icon('arrow')}`,'go-models')}</article><article class="step"><div class="step-head"><span class="step-number">03 / 开始使用</span>${icon('overview')}</div><h3>在鲸屿中选择「鲸桥」</h3><p>回到鲸屿桌面端，打开对话的模型选择器，选择「鲸桥」渠道下的模型。</p>${button(`查看使用方法 ${icon('arrow')}`,'go-help')}</article></div>
 <div class="support-grid"><div><h3>一个地方，管理多种模型来源</h3><p>API 供应商和订阅账号可以同时接入。用路由组分配请求，在用量统计中查看调用次数和 Token 消耗。</p></div><div><h3>关闭窗口，模型服务仍继续</h3><p>鲸桥在后台为桌面端提供服务。在启动器首页可开启或关闭鲸桥，更新、回滚和卸载在「组件」页的管理菜单操作。</p></div></div>
 <details class="advanced"><summary>连接信息与同步</summary><div class="advanced-body"><dl><dt>桌面端渠道</dt><dd>鲸桥 · WhaleBridge</dd><dt>本地网关</dt><dd><code>${escape(state.gateway)}/v1</code></dd><dt>同步方式</dt><dd>配置保存后自动同步；不会替换已有供应商或当前默认模型。</dd></dl><div class="actions-bar">${button(`${icon('refresh')}重新同步模型`,'sync','','text-button')}</div></div></details>`;
}
function providerAvatar(p){const file=String(p.icon || '').startsWith('file:')?String(p.icon).slice(5):'';return file?`<img class="provider-avatar provider-image" src="/api/icons/${encodeURIComponent(file)}" alt="">`:`<span class="provider-avatar" aria-hidden="true">${escape(Array.from(p.name || p.id)[0].toUpperCase())}</span>`;}
function providers() {
 let html = heading('供应商与账号','连接模型的来源。API 密钥和订阅账号都在这里管理。',`<div class="actions">${button('导入供应商','import-provider')}${button(`${icon('account')}订阅账号`,'subscription')}${button(`${icon('plus')}添加供应商`,'add-provider','','primary')}</div>`);
 if(!state.providers.length) return html + empty('连接你的第一个模型来源','已有 API 密钥？添加供应商。已有支持的订阅？选择订阅账号，通过供应商登录后接入。',button('添加供应商','add-provider','','primary')+button('接入订阅账号','subscription')+button('管理供应商适配器','manage-adapters'),'providers');
 html += `<div class="provider-grid">${state.providers.map((p,i)=>`<article class="provider-card ${p.off?'disabled':''}"><div class="provider-head">${providerAvatar(p)}<div class="text"><h3 class="title">${escape(p.name)}</h3><p class="caption">${p.account?'订阅账号':'API 供应商'}</p></div>${iconButton(`编辑 ${p.name}`,'edit-provider',p.id,'edit')}</div><div class="provider-detail"><p class="subtitle" title="${escape(p.chat || p.responses || p.anthropic || '')}">${escape(p.chat || p.responses || p.anthropic || '通过供应商订阅登录接入')}</p><div class="provider-meta"><span class="tag ${p.off?'':'business'}">${p.off?'已停用':'已启用'}</span><span class="tag">${p.modelCount || 0} 个模型</span><span class="tag subtle">${escape(routes[p.routing] || '智能')}路由</span></div>${p.listError?`<p class="inline-error">模型目录：${escape(p.listError)}</p>`:''}${p.fetched?`<p class="caption">模型更新于 ${escape(dateText(p.fetched))}</p>`:''}<div class="provider-live" data-provider-live="${escape(p.id)}"></div></div><div class="provider-footer">${button(p.account?'管理账号':'管理密钥',p.account?'accounts':'keys',p.id)}<div class="provider-tools">${iconButton(`刷新 ${p.name} 的模型`,'fetch-provider',p.id,'refresh')}<details class="menu"><summary aria-label="${escape(p.name)} 的更多操作" title="更多操作">${icon('more')}</summary><div class="menu-content">${button(p.off?'启用供应商':'停用供应商','toggle-provider',p.id)}${i?button('向前移动','provider-up',p.id):''}${i<state.providers.length-1?button('向后移动','provider-down',p.id):''}${p.account?'':button('再添加一个同类供应商','another-provider',p.id)+button('复制供应商','copy-provider',p.id)+button('导出配置','export-provider',p.id)}${button(`${icon('trash')}删除供应商`,'delete-provider',p.id,'danger')}</div></details></div></div></article>`).join('')}</div><div class="actions-bar">${button('供应商运行状态','provider-health')}${button('管理订阅供应商适配器','manage-adapters')}</div><p class="usage-note">${icon('info')}配置保存后自动同步到鲸屿。账号和密钥管理页可以设置各自的模型范围、请求并发与使用顺序。</p>`;
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
  b.disabled=visibilityPending.has(m.id);b.setAttribute('aria-busy',String(b.disabled));
  b.closest('.model-row').classList.toggle('disabled',m.hidden);
 }
 for(const b of document.querySelectorAll('[data-action="model-scope"]')){
  const rows=scopeRows(b.dataset.scope,b.dataset.id),s=scopeState(rows);
  b.setAttribute('aria-checked',s.checked);b.title=s.checked==='true'?'全部隐藏':'全部显示';
  b.disabled=!rows.length||rows.some(m=>visibilityPending.has(m.id));b.setAttribute('aria-busy',String(b.disabled&&rows.length>0));
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
function routingPage() {
 let html=heading('路由组','把多个模型组合成一个入口，由鲸桥按所选策略分配请求。',button(`${icon('plus')}新建路由组`,'add-group','','primary'));
 html += `<div class="note">${icon('routing')}<div><h3>什么时候需要路由组？</h3><p>想轮换使用多个账号的模型，或让同一类请求按顺序使用不同模型？创建一个路由组，再到鲸屿中选择这个组。只使用单个模型时，无需配置。</p></div></div>`;
 return html+(state.groups?.length?`<div class="provider-grid">${state.groups.map(g=>`<article class="provider-card routing-card"><div class="provider-head"><span class="provider-avatar">${icon('routing')}</span><div class="text"><h3 class="title">${escape(g.name)}</h3><p class="caption"><code>${escape(g.id.startsWith('group/')?g.id:`group/${g.id}`)}</code></p></div>${iconButton(`编辑 ${g.name}`,'edit-group',g.id,'edit')}</div><div class="route-members"><span class="tag business">${escape(routes[g.routing] || '智能')}</span><span class="tag">${(g.members || []).length} 个模型</span>${g.auto?'<span class="tag subtle">自动匹配</span>':''}<span class="caption">成员模型</span>${(g.members || []).map(m=>`<code>${escape(m)}</code>`).join('') || '<span class="caption">按匹配规则自动发现模型</span>'}</div><div class="provider-footer">${button('编辑路由组','edit-group',g.id)}${iconButton(`删除 ${g.name}`,'delete-group',g.id,'trash','danger')}</div></article>`).join('')}</div>`:empty('为常用模型建立一个统一入口','例如将两个供应商的同类模型组成「日常助手」，按顺序或轮换分配请求。',button('新建路由组','add-group','','primary'),'routing'));
}
function helpPage() {
 return heading('认识鲸桥','模型接入、账号管理和日常使用，一次了解。')+`<p class="help-intro">鲸桥是鲸屿的可选模型连接组件。它把 API 供应商和支持的订阅账号集中到一个渠道，让你在鲸屿桌面端选择模型、发起对话；同时管理模型列表、请求路由和通过鲸桥产生的用量。</p><div class="help-grid"><article class="help-card"><h3>${icon('providers')}接入 API 供应商</h3><p>在「供应商与账号」点击「添加供应商」，选择预设或填写兼容接口地址，再输入 API 密钥。模型 ID 可手动填写，也可以在保存后刷新供应商模型。</p></article><article class="help-card"><h3>${icon('account')}接入订阅账号</h3><p>选择「订阅账号」并按供应商指引登录。不同订阅支持的模型和登录方式不同；部分供应商需要认证工具或适配器，界面会说明。登录结果用于鲸桥接入。</p></article><article class="help-card"><h3>${icon('models')}在鲸屿中使用</h3><p>回到鲸屿桌面端，打开对话的模型选择器，在「鲸桥」渠道下选择模型。新增或隐藏模型会自动同步；已有默认模型不会因安装鲸桥被替换。</p></article><article class="help-card"><h3>${icon('routing')}按需配置路由</h3><p>路由组把多个模型合为一个可选模型。你可以按顺序、轮换或用量等策略分配请求。它是可选功能，直接选择供应商模型也能正常对话。</p></article></div><div class="section-head"><h2>使用前后，你可能想知道</h2></div><div class="panel"><details class="faq" open><summary>鲸桥提供模型或免费额度吗？</summary><p>鲸桥负责连接和管理模型。你需要自己的 API 密钥或支持的订阅账号，模型可用范围和费用由对应供应商决定。用量页的费用是按模型目录价格估算，最终以供应商账单为准。</p></details><details class="faq"><summary>窗口关了，鲸屿还能继续对话吗？</summary><p>可以。关闭设置窗口后，鲸桥进程继续在后台服务。若在启动器中停止组件，通过鲸桥的模型会暂时不可用；重新启动组件后恢复。</p></details><details class="faq"><summary>添加后，在桌面端找不到模型怎么办？</summary><p>先确认供应商已启用、密钥或账号已配置，并刷新该供应商的模型。在「模型管理」确认模型的显示开关已打开。需要时，可在概览的「连接信息与同步」中重新同步模型。</p></details><details class="faq"><summary>配置和请求会发到哪里？</summary><p>鲸桥的配置和凭据保存在本机，管理界面和连接网关只监听本机地址。对话请求会按你选择的模型发送给对应供应商；订阅登录按供应商的流程完成。</p></details><details class="faq"><summary>如何更新或卸载？会影响对话记录吗？</summary><p>在鲸屿启动器的「组件」页操作。卸载会移除「鲸桥」渠道，并可选择保留或删除鲸桥的配置与用量；不会删除鲸屿的聊天记录。如果默认模型来自鲸桥，卸载后需要重新选择模型。</p></details></div><div class="actions-bar">${button('管理供应商','go-providers','','primary')}${button('查看模型','go-models')}</div>`;
}
async function render() {
 if (!state) return;
 const epoch=++renderEpoch;clearTimeout(providerLiveTimer);
 document.querySelectorAll('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.setAttribute('aria-selected',String(selected));if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#page-label').textContent=pageNames[tab];
 $('#content').setAttribute('aria-busy','true');
 let html='';
 if(tab==='overview')html=overview();
 else if(tab==='providers')html=providers();
 else if(tab==='models') {
  html=heading('模型管理','选择哪些模型显示在鲸屿桌面端的「鲸桥」渠道中。',button(`${icon('refresh')}更新模型目录`,'refresh-catalog'));
  html+=modelRows().length?`<div class="list-toolbar"><div class="search">${icon('search')}<input id="model-search" type="search" placeholder="搜索模型、渠道或供应商" aria-label="搜索模型" value="${escape(modelQuery)}"></div><div class="segments" aria-label="模型显示范围">${Object.entries({all:'全部',shown:'已显示',hidden:'已隐藏'}).map(([v,l])=>`<button type="button" data-filter="${v}" aria-pressed="${v===modelFilter}">${l}</button>`).join('')}</div><div class="model-all"><span>全选</span><span class="caption" data-count="all" data-id=""></span>${scopeSwitch('all','','显示当前结果中的全部模型')}</div></div><div id="model-list"></div><p class="usage-note">${icon('info')}开关只影响鲸屿桌面端的模型列表；全选只作用于当前搜索和筛选结果，隐藏模型不删除供应商配置。</p>`:empty('模型列表还是空的','添加并启用供应商，配置模型后，就可以在这里整理桌面端列表。',button('添加供应商','add-provider','','primary'),'models');
 } else if(tab==='routing')html=routingPage();
 else if(tab==='help')html=helpPage();
 else if(tab==='usage') {
  html=heading('用量统计','只统计通过鲸桥网关产生的调用，按所选时间范围汇总。',`<select class="usage-select" id="period" aria-label="用量周期">${Object.entries({today:'今天','7d':'近 7 天','30d':'近 30 天',all:'全部'}).map(([v,l])=>`<option value="${v}" ${v===period?'selected':''}>${l}</option>`).join('')}</select>`);
  $('#content').innerHTML=html+'<div class="loading"><p>正在读取用量…</p></div>';
  const u=await api(`usage?period=${period}`);
  html+=`<div class="stats">${stat('调用请求',short(u.calls),'经鲸桥网关发出','usage')}${stat('Token 总量',short((u.input || 0)+(u.output || 0)),`输入 ${short(u.input)} / 输出 ${short(u.output)}`,'models')}${stat('估算费用',`$${Number(u.cost || 0).toFixed(3)}`,'按已知模型价格估算','info')}</div><div class="section-head"><h2>按模型汇总</h2><span class="caption">${u.models?.length || 0} 个模型</span></div>`;
  html+=u.models?.length?`<div class="panel table-wrap"><table><thead><tr><th>模型</th><th>请求</th><th>输入 Token</th><th>输出 Token</th><th>估算费用</th></tr></thead><tbody>${u.models.map(m=>`<tr><td>${escape(m.model || m.id)}</td><td>${short(m.calls)}</td><td>${short(m.input)}</td><td>${short(m.output)}</td><td>$${Number(m.cost || 0).toFixed(3)}</td></tr>`).join('')}</tbody></table></div>`:empty('这个时间范围还没有调用记录','在鲸屿中选择「鲸桥」渠道的模型发起对话后，这里会记录请求和 Token 用量。','','usage');
  html+=`<p class="usage-note">${icon('info')}费用以供应商实际账单为准。${u.unpriced?`有 ${u.unpriced} 次请求缺少模型价格，费用未计入估算。`:'订阅账号的用量不等同于实际订阅账单。'}</p>`;
  html+=`<div class="section-head"><div><h2>供应商余额与订阅额度</h2><p>由供应商报告，包含鲸桥之外产生的用量。每个账号可单独刷新。</p></div>${button('刷新供应商额度','refresh-quotas')}</div><div id="quota-section" aria-live="polite"><div class="loading"><p>正在读取供应商额度…</p></div></div><div class="actions-bar">${button('订阅维护设置','subscription-settings')}${button('额度变化记录','quota-history')}</div>`;
 }
 if(epoch!==renderEpoch)return;
 $('#content').innerHTML=html;$('#content').setAttribute('aria-busy','false');
 if($('#model-list')) {
  modelList();$('#model-search').addEventListener('input',e=>{modelQuery=e.target.value;modelList();});
 }
 $('#period')?.addEventListener('change',e=>{period=e.target.value;render().catch(e=>message(e.message,true));});
 if($('#quota-section'))await loadQuotas(epoch);if(tab==='providers')startProviderLive(epoch);
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
 const p=editor.data;
 const regions=pr?.regions || [], chosen=apply?regions[0]:providerRegion(p,pr);
 $('#provider-region').innerHTML=regions.length?`<label for="f-region">${escape(pr.regionLabel==='Plan'?'套餐 / 区域':pr.regionLabel || '区域')}</label><select id="f-region" name="region"><option value="">自定义接口地址</option>${regions.map(r=>`<option value="${escape(r.id)}" ${r.id===chosen?.id?'selected':''}>${escape(r.name)}</option>`).join('')}</select>`:'';
 const fill=r=>{
  for(const k of ['chat','responses','anthropic','decide'])$(`#f-${k}`).value=r[k] || (k==='decide'?pr?.decide:'') || '';
  for(const k of ['catalog','website','keysUrl','modelsURL'])$(`#f-${k}`).value=r[k] || pr?.[k] || '';
  $('#f-models').value=(r.models || pr?.models || []).join('\n');
  editor.available=(r.models || pr?.models || []).map(id=>({id,name:id}));drawProviderModels();
  updateWorkspace(pr,r);
 };
 if(apply){$('#f-name').value=pr?.name || '';fill(chosen || pr || {});}
 else updateWorkspace(pr,chosen);
 $('#f-region')?.addEventListener('change',e=>{const r=regions.find(r=>r.id===e.target.value);if(r)fill(r);else updateWorkspace(pr);});
 $('#f-decide').oninput=()=>{const r=regions.find(r=>r.id===$('#f-region')?.value);updateWorkspace(pr,r);};
}
function updateWorkspace(pr,region){
 const template=region?.decide || pr?.decide || '', row=$('#workspace-field'), input=$('#f-workspace');
 row.hidden=!template.includes('{WorkspaceId}');input.required=!row.hidden;
 if(row.hidden)return;
 const value=workspaceOf(template,$('#f-decide').value);
 if(value!==null&&!value.includes('{WorkspaceId}'))input.value=value;
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
function openProvider(id,mode='edit') {
 const source=state.providers.find(p=>p.id===id),p=source?{...source,models:[...(source.models || [])]}:{id:'',name:'',models:[],routing:''};
 if(mode==='another'){for(const k of Object.keys(p))delete p[k];Object.assign(p,{id:'',preset:source.preset,models:[],name:''});}
 if(mode==='copy'){p.id='';p.name=`${p.name} 副本`;}
 editor={type:'provider',data:p,removedHeaders:[],available:availableModels(p),modelPrefs:{},copyOf:mode==='copy'?source.id:'',from:mode==='edit'?p.id:''};
 const pr=state.presets.find(x=>x.id===p.preset),account=!!p.account;
 $('#editor-title').textContent=p.id?'编辑供应商':mode==='copy'?'复制供应商':'添加供应商';
 $('#fields').innerHTML=`<p class="form-hint">${account?'账号认证由供应商登录流程处理，保存后只用于鲸桥请求。':'选择预设或填写兼容接口，使用自己的 API 密钥。已有凭据留空保留。'}</p>`+(!p.id?selectField('preset','供应商预设',[['','自定义兼容接口'],...state.presets.map(x=>[x.id,x.name])],p.preset):'')+`<div class="form-grid"><div>${field('name','显示名称',p.name,'text','例如：我的 DeepSeek')}</div><div>${field('id','供应商 ID',p.id,'text','留空自动生成')}</div></div>`+(account?'':field('key','API 密钥（支持粘贴多个）','','password',p.keySet?`${p.keyMasked || '已保存'} · 留空保留原密钥`:editor.copyOf?'留空沿用原供应商的密钥':'每行、空格或逗号分隔'))+'<div id="provider-region"></div>'+`<div class="form-grid"><div>${selectField('baseAPI','首选接口',[['chat','Chat Completions'],['responses','Responses'],['anthropic','Anthropic Messages'],['decide','路由决策']],p.baseAPI || (p.responses&&!p.chat?'responses':'chat'))}</div><div>${field('family','模型分类标识',p.family,'text','可选，方便按模型来源整理')}</div></div>`+field('chat','Chat Completions 地址',p.chat,'text','https://api.example.com/v1')+field('responses','Responses 地址',p.responses,'text')+field('anthropic','Anthropic Messages 地址',p.anthropic,'text')+field('decide','路由决策地址',p.decide,'text')+`<div id="workspace-field" hidden>${field('workspace','Workspace ID','','text','API 密钥所属工作空间，如 ws-…')}<p class="form-hint">Bailian 决策接口按该工作空间接入，Token Plan 不需要。</p></div><div class="actions-bar">${button('检查连接','test-provider',source?.id || '')}${button('检测可用协议','detect-provider',source?.id || '')}</div><div class="inline-result" id="provider-test-result" role="status"></div>`+
 `<div class="form-section"><h3>模型选择与能力</h3><div class="actions-bar compact-actions">${button('全选','models-all')}${button('全不选','models-none')}${button('只选免费','models-free')}${button('刷新模型','fetch-edit-models',source?.id || '')}${source?button('清除缓存目录','unfetch-edit-models',source.id):''}</div><div class="search provider-model-search">${icon('search')}<input id="provider-model-search" type="search" aria-label="筛选供应商模型" placeholder="搜索模型名称或 ID"></div><div id="provider-model-chips" class="model-chips"></div>${text('models','自定义或选中的模型 ID（每行一个）',(p.models || []).join('\n'),'可以直接填写供应商的模型 ID')}<p class="form-hint">留空使用供应商默认模型；全不选用于恢复默认选择。下方可覆盖单个模型的名称、能力和价格。</p>${checkField('unlisted','仅通过路由组使用，不直接出现在桌面端列表',p.unlisted)}<div id="model-settings"></div></div>`+
 `<div class="form-section"><h3>请求分配与等待</h3>${routing(p.routing)}${selectField('affinity','对话与账号的保持方式',[['','自动 · 按缓存有效期'],['session','整个会话'],['turn','同一轮对话'],['off','每次重新分配']],p.affinity)}${checkField('sink','仍有额度的账号被限流后，排到队尾',p.sink)}<div class="form-grid"><div>${integerField('maxConcurrency','每个密钥 / 账号最大并发',p.maxConcurrency,0,null,'留空跟随供应商默认；0 为不限')}</div><div>${integerField('queueLimit','排队上限',p.queueLimit || '',0,null,'0 或留空为不限')}</div><div>${integerField('queueWait','最长排队等待（秒）',p.queueWait || '',0,null,'0 或留空为一直等待')}</div><div>${field('priceRate','官方价格倍率',p.priceRate || '','number','1 为官方价格，例如 0.8 或 1.5').replace('<input ','<input min="0.001" step="0.001" ')}</div></div><p class="form-hint">并发、排队均按每个密钥或账号分别计算；超出排队上限或等待时间会拒绝请求。单个模型自定义价格优先于倍率。</p><div id="pin-upstream">${checkField('pinUpstream','DeepSeek 模型只走 DeepSeek 官方上游',p.pinUpstream,'Cline 默认可能从不同上游服务模型；启用后只发给 DeepSeek，保留其缓存，官方不可用时请求会失败。')}</div>${text('fallback','故障转移模型（按顺序，每行一个）',(p.fallback || []).join('\n'),'供应商ID/模型ID')}</div>`+
 `<details class="advanced" id="provider-advanced"><summary>连接与模型的更多设置</summary><div class="advanced-body">${proxyFields(p.proxy)}${text('contexts','上下文长度',mapText(p.contexts),'所有模型：128k；单个模型：model-id=1m')}${text('outputs','最大输出 Token',mapText(p.outputs),'所有模型：32k；单个模型：model-id=64k')}${text('compacts','对话压缩阈值',mapText(p.compacts),'留空跟随默认；如 model-id=128k')}${field('catalog','模型目录来源',p.catalog,'text','models.dev 供应商标识，可选')}${field('modelsURL','自定义模型列表地址',p.modelsURL,'text','可选，模型目录与请求地址不同时填写')}${field('website','供应商网站',p.website,'url')}${field('keysUrl','密钥管理页面',p.keysUrl,'url')}${account?'':checkField('searches','该服务自行处理网页搜索工具',p.searches,'适用于支持原生搜索工具的 Responses / Anthropic 服务。')+checkField('unredacted','向此服务发送未经脱敏的请求',p.unredacted,'仅在确认模型在本机或可信局域网内运行时启用。')}<div class="form-section"><h3>账户余额与团队套餐</h3>${field('balanceURL','余额查询地址',p.balanceURL,'text')}${field('balancePath','余额字段或表达式',p.balancePath,'text','如 $data.balance 或 (1 - credits.used / 70) %')}<p class="form-hint">支持 + − × ÷、括号；美元金额加 $ 前缀，百分比加 % 后缀。多个字段用分号分隔并可加名称。</p>${field('balanceToken','账户余额访问令牌','','password',p.balanceTokenSet?'已保存 · 留空保留':'可选，仅用于余额查询')}${p.balanceTokenSet?checkField('clearBalanceToken','删除已保存的余额访问令牌'):''}<div class="actions-bar">${button('查询余额','check-balance',source?.id || '')}</div><p id="balance-result" class="form-hint" role="status"></p><div class="form-grid"><div>${field('teamOrg','团队组织 ID',p.zhipuTeam?.org,'text')}</div><div>${field('teamProject','团队项目 ID',p.zhipuTeam?.project,'text')}</div></div><p class="form-hint">智谱 / Z.ai 团队套餐同时填写组织和项目 ID，查询团队使用窗口；个人套餐留空。</p></div>${account?'':'<div class="form-section"><h3>附加 HTTP Headers</h3><p class="form-hint">请求发送前应用，可用于自定义认证。已有值不回显；留空保留，移除后保存删除。</p><div id="header-list"></div><div class="actions-bar">'+button('添加 Header','add-header')+'</div></div>'}</div></details>`+(source&&!account?`<div class="actions-bar editor-provider-actions">${button('再添加一个同类供应商','another-provider',source.id)}${button('复制此供应商','copy-provider',source.id)}</div>`:'');
 $('#f-name').required=true;
 $('#f-proxyMode').onchange=e=>{$('#proxy-address').hidden=e.target.value!=='custom';$('#f-proxy').required=e.target.value==='custom';};$('#f-proxy').required=$('#f-proxyMode').value==='custom';
 for(const name of p.headerNames || [])$('#header-list')?.append(headerRow(name,true));
 const hints=pr=>{for(const name of pr?.headerHints || [])if(![...document.querySelectorAll('.header-name')].some(i=>i.value.toLowerCase()===name.toLowerCase())){const row=headerRow(name,false,true);row.dataset.hint='true';$('#header-list')?.append(row);}};
 hints(pr);configurePreset(pr,mode==='another');
 const pin=pr=>$('#pin-upstream').hidden=!(pr?.id==='clinepass'||p.cline||/cline/i.test(p.preset || '')||/cline\./i.test(p.chat || ''));
 pin(pr);$('#f-preset')?.addEventListener('change',e=>{const chosen=state.presets.find(x=>x.id===e.target.value);configurePreset(chosen,true);hints(chosen);pin(chosen);});
 if(!account){
  $('#f-key').insertAdjacentHTML('afterend',`<div class="credential-tools">${button('显示密钥','show-provider-key',source?.id || '')}${p.keysUrl?externalLink(p.keysUrl,'打开密钥管理页面'):''}</div>`);
  $('#f-key').addEventListener('paste',e=>{const value=e.clipboardData?.getData('text');if(value&&/[\r\n]/.test(value)){e.preventDefault();e.target.value=value.trim().replace(/[\r\n]+/g,',');}});
  $('#f-family').insertAdjacentHTML('afterend',field('providerIcon','供应商图标',p.icon || '','text','上传图片，或留空使用供应商默认')+`<div class="actions-bar"><label class="file-button">上传图标<input id="provider-icon-file" type="file" accept="image/*,.ico,.svg"></label>${button('从网站获取图标','provider-favicon')}</div>`);
  $('#provider-icon-file').addEventListener('change',uploadProviderIcon);
 }else{
  for(const key of ['id','name','chat','responses','anthropic','decide'])$(`#f-${key}`).readOnly=true;
  $('#f-baseAPI').disabled=true;$('#fields [data-action="detect-provider"]').hidden=true;
  $('#f-id').insertAdjacentHTML('afterend','<p class="form-hint">订阅身份与认证接口由登录流程维护。</p>');
  for(const key of ['catalog','modelsURL','website','keysUrl']){const input=$(`#f-${key}`);input.hidden=true;input.previousElementSibling.hidden=true;}
  $('#balance-result').closest('.form-section').hidden=true;
 }
 if(p.stepPlan)$('#balance-result').insertAdjacentHTML('afterend',stepPlanFields(p.stepPlan));
 $('#model-settings').insertAdjacentHTML('afterend',`<div class="actions-bar compact-actions">${button('测试已选模型','test-selected-models')}${button('检测已选模型协议','detect-selected-models')}</div><p class="form-hint">连接测试会发送少量请求。协议检测一次最多检查前 30 个模型。</p><div id="selected-model-results" class="inline-result" role="status"></div>`);
 $('#f-models').addEventListener('input',drawProviderModels);$('#provider-model-search').addEventListener('input',drawProviderModels);drawProviderModels();showEditor();
}
function drawProviderModels(){
 if(editor?.type!=='provider'||!$('#provider-model-chips'))return;
 const opened=new Set([...$('#model-settings').querySelectorAll('details[open]')].map(d=>d.dataset.model || '_list'));
 const picked=new Set(lines($('#f-models').value)),query=$('#provider-model-search').value.toLowerCase();
 const all=[...editor.available],known=new Set(all.map(m=>m.id));for(const id of picked)if(!known.has(id))all.push({id,name:id});
 $('#provider-model-chips').innerHTML=all.filter(m=>`${m.id} ${m.name}`.toLowerCase().includes(query)).map(m=>`<button type="button" class="model-chip" aria-pressed="${picked.has(m.id)}" data-action="pick-provider-model" data-id="${escape(m.id)}">${picked.has(m.id)?'✓ ':''}${escape(m.name || m.id)}${m.context?`<span>${short(m.context)}</span>`:''}${m.free||m.price&&m.price.input===0&&m.price.output===0?'<span>免费</span>':''}</button>`).join('') || '<p class="form-hint">没有匹配模型，可以在模型 ID 字段手动添加。</p>';
 const shown=all.filter(m=>picked.has(m.id));$('#model-settings').innerHTML=shown.length?`<details class="advanced"><summary>单个模型设置（${shown.length} 个）</summary><div class="advanced-body">${shown.map(m=>modelSettings(m)).join('')}</div></details>`:'';
 for(const d of $('#model-settings').querySelectorAll('details'))d.open=opened.has(d.dataset.model || '_list');
 wireModelSettings();
}
function modelSettings(m){
 const pref={...(editor.data.modelPrefs?.[m.id] || {}),...(editor.modelPrefs[m.id] || {})},name=pref.name ?? editor.data.modelNames?.[m.id] ?? '',efforts=pref.efforts ?? editor.data.modelEfforts?.[m.id] ?? [],api=pref.api ?? m.api ?? '',same=pref.same ?? m.same ?? '',images=pref.ownImages?'':pref.images===undefined?(m.imagesOverride===undefined?'':String(m.imagesOverride)):String(pref.images);
 const price=pref.ownPrice?null:pref.price || editor.data.modelPrices?.[m.id] || (m.ownPrice?m.price:null),custom=!!price,basis=price || m.price || {};
 return `<details class="model-setting" data-model="${escape(m.id)}"><summary><strong>${escape(m.name || m.id)}</strong><code>${escape(m.id)}</code></summary><div class="model-setting-body"><label>显示名称<input data-pref="name" value="${escape(name)}" placeholder="留空恢复供应商名称"></label><label>思考等级<input data-pref="efforts" value="${escape(efforts.join(', '))}" placeholder="逗号分隔；留空恢复全部等级"></label><div class="form-grid"><label>调用协议<select data-pref="api">${[['','自动'],['chat','Chat Completions'],['responses','Responses'],['anthropic','Anthropic Messages']].map(([v,l])=>`<option value="${v}" ${v===api?'selected':''}>${l}</option>`).join('')}</select></label><label>图像输入<select data-pref="images">${[['','跟随供应商'],['true','支持'],['false','不支持']].map(([v,l])=>`<option value="${v}" ${v===images?'selected':''}>${l}</option>`).join('')}</select></label></div><label>等同模型 ID<input data-pref="same" value="${escape(same)}" placeholder="可选，按同一模型归入自动路由组"></label><label class="check-field"><input type="checkbox" data-pref="customPrice" ${custom?'checked':''}><span>为此模型设置价格（美元 / 百万 Token）</span></label><div class="model-price-editor" ${custom?'':'hidden'}><div class="form-grid model-prices">${modelPriceFields(basis)}</div><p class="form-hint">长上下文档位按输入 Token 总数计算，超过阈值后整次请求采用该档价格。缓存写入包括一小时 TTL。</p><div class="price-tiers">${(basis.tiers || []).map(t=>priceTierFields(t)).join('')}</div><div class="actions-bar">${button('添加长上下文价格档位','add-price-tier')}</div></div><div class="actions-bar">${button('测试此模型','test-one-model',m.id)}${button('复制模型 ID','copy-model-id',m.id)}${button('恢复名称与能力默认','reset-model-pref',m.id)}</div><p class="form-hint model-test-result" role="status"></p></div></details>`;
}
function modelPriceFields(price){return [['input','输入'],['output','输出'],['cache_read','缓存读取'],['cache_write','缓存写入'],['cache_write_1h','一小时缓存写入']].map(([k,l])=>`<label>${l}<input type="number" min="0" step="any" data-price="${k}" value="${price?.[k] ?? 0}"></label>`).join('');}
function priceTierFields(tier={}){return `<div class="price-tier"><div class="price-tier-head"><label>输入 Token 超过<input type="number" min="1" step="1" data-tier-above value="${tier.above || 272000}"></label>${button('移除档位','remove-price-tier')}</div><div class="form-grid">${modelPriceFields(tier).replaceAll('data-price=','data-tier-price=')}</div></div>`;}
function priceOfRow(row){const price=Object.fromEntries([...row.querySelectorAll('[data-price]')].map(x=>[x.dataset.price,Number(x.value)]));price.tiers=[...row.querySelectorAll('.price-tier')].map(t=>({above:Number(t.querySelector('[data-tier-above]').value),...Object.fromEntries([...t.querySelectorAll('[data-tier-price]')].map(x=>[x.dataset.tierPrice,Number(x.value)]))})).sort((a,b)=>a.above-b.above);return price;}
function keepRowPrice(row){const pref=editor.modelPrefs[row.dataset.model] ||= {};pref.price=priceOfRow(row);delete pref.ownPrice;}
function wireModelSettings(){for(const row of document.querySelectorAll('.model-setting'))row.addEventListener('input',e=>{const id=row.dataset.model,pref=editor.modelPrefs[id] ||= {},input=e.target;if(input.dataset.pref==='customPrice'){row.querySelector('.model-price-editor').hidden=!input.checked;if(!input.checked){delete pref.price;pref.ownPrice=true;}else keepRowPrice(row);return;}if(input.dataset.price||input.dataset.tierPrice||input.hasAttribute('data-tier-above')){keepRowPrice(row);return;}const k=input.dataset.pref;if(!k)return;if(k==='images'){if(input.value===''){delete pref.images;pref.ownImages=true;}else{pref.images=input.value==='true';delete pref.ownImages;}}else pref[k]=k==='efforts'?input.value.split(/[,\s]+/).filter(Boolean):input.value;});}
function providerInput(data){const p=editor.data,input={...data,id:data.id || '',from:editor.from,new:!editor.from,copyOf:editor.copyOf || undefined,models:lines(data.models),fallback:lines(data.fallback),proxy:data.proxyMode==='direct'?'direct':data.proxyMode==='custom'?data.proxy:'',headers:headerChanges(),contexts:tokenMap(data.contexts),outputs:tokenMap(data.outputs),compacts:tokenMap(data.compacts),modelPrefs:editor.modelPrefs};
 for(const k of ['off','unlisted','searches','unredacted','pinUpstream','sink','clearBalanceToken'])input[k]=k==='off'?!!p.off:!!$(`#f-${k}`)?.checked;
 input.maxConcurrency=data.maxConcurrency===''?null:Number(data.maxConcurrency);for(const k of ['queueLimit','queueWait','priceRate'])input[k]=Number(data[k] || 0);
 if(p.account||!data.key)delete input.key;if(!data.balanceToken)delete input.balanceToken;
 input.icon=data.providerIcon===undefined?p.icon || '':data.providerIcon;delete input.providerIcon;
 if(!!data.teamOrg!==!!data.teamProject)throw new Error('团队套餐请同时填写组织 ID 和项目 ID');input.zhipuTeam=data.teamOrg?{org:data.teamOrg.trim(),project:data.teamProject.trim()}:{};
 for(const k of ['proxyMode','region','workspace','teamOrg','teamProject'])if(k.startsWith('team'))delete input[k];return input;}
function openGroup(id) {
 const g=state.groups?.find(g=>g.id===id)||{id:'',name:'',members:[],routing:''};editor={type:'group',data:g};
 $('#editor-title').textContent=id?'编辑路由组':'新建路由组';
 $('#fields').innerHTML=`<p class="form-hint">路由组会作为一个模型出现在鲸屿的「鲸桥」渠道中。选择组之后，请求由鲸桥按策略分配。</p><div class="form-grid"><div>${field('name','显示名称',g.name,'text','例如：日常助手')}</div><div>${field('id','路由 ID',g.id.replace(/^group\//,''),'text','如 everyday')}</div></div>${routing(g.routing,true)}${text('members','成员模型（每行一个）',(g.members || []).join('\n'),'供应商ID/模型ID')}<p class="form-hint">点击下方已有模型，可加入或移出成员列表。</p><div class="checks">${(state.models || []).filter(m=>!m.group).map(m=>button(escape(m.name || m.id),'pick-member',m.id)).join('')}</div><details class="advanced"><summary>高级设置 · 超时与自动匹配</summary><div class="advanced-body">${field('firstToken','等待首个 Token 的超时（秒）',g.firstToken || 0,'number')}${text('match','自动匹配规则（每行一个，可选）',(g.match || []).join('\n'),'如 openrouter/*:free')}<p class="form-hint">超时为 0 时持续等待。自动匹配会按规则发现模型并加入路由。</p></div></details>`;
 $('#f-name').required=true;$('#f-id').required=true;$('#f-firstToken').min='0';
 $('#f-members').addEventListener('input',syncMemberSelection);syncMemberSelection();showEditor();
}
function syncMemberSelection(){const members=new Set(lines($('#f-members').value));for(const b of document.querySelectorAll('[data-action=pick-member]'))b.setAttribute('aria-pressed',String(members.has(b.dataset.id)));}
function showEditor(){
 $('#form-error').hidden=true;$('#save').hidden=false;$('#save').textContent='保存';$('#save').disabled=false;
 $('#cancel-editor').textContent=['accounts','keys'].includes(editor.type)?'关闭':'取消';
 if(!$('#editor').open)$('#editor').showModal();
 $('#fields input:not([type=password]),#fields select')?.focus();
}
async function showConnectionSuccess(title,detail,source){
 clearTimeout(loginTimer);loginFlow=null;editor.type='connection-success';
 $('#editor-title').textContent=title;
 $('#fields').innerHTML=`<div class="connection-success" role="status"><div class="connection-result"><div class="connection-result-head"><span class="provider-avatar" aria-hidden="true">${escape(Array.from(source.name)[0].toUpperCase())}</span><div class="connection-identity"><strong>${escape(source.name)}</strong><div class="caption">${escape(source.kind)}${source.user?` · ${escape(source.user)}`:''}</div></div><span class="connection-success-status">${icon('check')}${source.updated?'授权已更新':'已接入'}</span></div><p>${escape(detail)}</p></div><div class="connection-next"><img src="/whale-head.png" alt=""><div><h3>下一步 · 开始使用模型</h3><p class="muted">回到鲸屿桌面端，在模型选择器中选择「鲸桥」渠道下的模型即可使用。</p></div></div></div>`;
 $('#form-error').hidden=true;$('#cancel-editor').textContent='完成';
 $('#save').hidden=false;$('#save').disabled=false;$('#save').textContent='查看供应商';$('#save').focus();
 await load();
}
const lines=value=>value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
$('#edit-form').addEventListener('invalid',e=>{const details=e.target.closest('details');if(details)details.open=true;},true);
$('#edit-form').addEventListener('submit',async e=>{
 e.preventDefault();const current=editor;
 if(current.type==='connection-success'){$('#editor').close();await go('providers');return;}
 if(['accounts','adapters','health','quota-history','export','import-result'].includes(current.type))return;
 $('#save').disabled=true;$('#form-error').hidden=true;const data=Object.fromEntries(new FormData(e.target));
 try {
  if(current.type==='subscription'){await beginSubscription(data);return;}
  if(current.type==='subscription-settings'){const payload={};for(const key of ['codexWarmup','claudeWarmup','codexWarmAt','claudeWarmAt'])payload[key]=data[key];payload.quotaLeft=$('#f-quotaLeft').checked;payload.proxy=data.proxyMode==='direct'?'direct':data.proxyMode==='custom'?data.proxy:'';for(const key of ['workbuddyCheckin','traeCheckin','minimaxCheckin','qoderCheckin'])payload[key]=!!$(`#f-${key}`).checked;payload.pluginCheckins={...subscriptionSettings.pluginCheckins,...Object.fromEntries([...$('#fields').querySelectorAll('[data-plugin-checkin]')].map(c=>[c.dataset.pluginCheckin,c.checked]))};await api('subscription/settings',payload);$('#editor').close();message('订阅维护设置已保存');if(tab==='usage')await loadQuotas(renderEpoch);return;}
  if(current.type==='quota-account'){await api('accounts/settings',{id:current.data.provider,user:current.data.user,codexAutoReset:$('#f-codexAutoReset').checked,codexCredits:$('#f-codexCredits').checked,codexWarmAt:data.warmMode==='custom'?data.codexWarmAt:data.warmMode==='off'?'off':''});$('#editor').close();message('账号维护设置已保存');await loadQuotas(renderEpoch);return;}
  if(current.type==='keys'){await api('keys',{id:current.data.id,action:'add',name:data.name,key:data.key,protocol:data.protocol});if(current!==editor||current.closed)return;await openKeys(current.data.id);message('密钥已添加');await load();return;}
  if(['key-edit','account-edit','key-import','auth-import','adapter-options'].includes(current.type)){await saveAccountEditor(data,current);return;}
  if(current.type==='provider-import'){
   if(!current.preview){const r=await api('provider/import',{text:data.source,preview:true});if(current!==editor||current.closed)return;const missing=r.providers.filter(p=>!p.keyOptional&&!p.keySet);current.source=data.source;current.preview=r.providers;$('#fields').innerHTML=`<p class="form-hint">将新增 ${r.providers.length} 个供应商。已有供应商和密钥保持原样；请核对来源和接口地址后导入。</p><div class="panel">${r.providers.map(p=>`<div class="row"><div class="text"><strong>${escape(p.name || p.id)}</strong><p class="caption">${escape(p.chat || p.responses || p.anthropic || '')}</p><p class="caption">${p.models?.length || 0} 个已选模型 · ${p.keySet?'包含密钥':p.keyOptional?'无需 API 密钥':'需要补充密钥'}</p></div></div>`).join('')}</div>`;if(missing.length&&r.providers.length===1){$('#fields').insertAdjacentHTML('beforeend',field('importKey','此供应商的 API 密钥','','password','导入前需要提供凭据'));$('#f-importKey').required=true;}else if(missing.length){current.preview=null;$('#fields').insertAdjacentHTML('beforeend',`<p class="inline-error">${escape(missing.map(p=>p.name || p.id).join('、'))} 需要密钥。请分别在各供应商 JSON 中填写 key，再重新预览。</p>`+text('source','补充凭据后的来源',data.source));$('#f-source').required=true;}$('#save').textContent=current.preview?'导入这些供应商':'重新预览';return;}
   const r=await api('provider/import',{text:current.source,...(data.importKey?{key:data.importKey}:{})});if(current!==editor||current.closed)return;$('#editor').close();message(`已新增 ${r.added?.length || current.preview.length} 个供应商，模型已同步`);await load();return;
  }
  if(current.type==='project'){await api('accounts/project',{id:current.data.id,user:current.data.user,project:data.project});if(current!==editor||current.closed)return;await openAccounts(current.data.id);message('Cloud project 已保存');await load();return;}
  if(current.type==='provider'){
   await api('provider',providerInput(data));
  }else{const g=current.data;await api('group',{...g,...data,from:g.id,id:data.id,members:lines(data.members),match:lines(data.match),firstToken:Number(data.firstToken)});}
  if(current!==editor||current.closed)return;
  if(current.type==='provider'&&!current.data.id){await showConnectionSuccess('供应商添加成功',`${data.name} 已添加，模型已同步到鲸屿。`,{name:data.name,kind:'API 供应商'});return;}
  $('#editor').close();message('已保存，模型已同步到鲸屿');await load();
 }catch(e){if(current===editor&&!current.closed){$('#form-error').textContent=e.message;$('#form-error').hidden=false;}}finally{if(current===editor&&!current.closed)$('#save').disabled=false;}
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
 const b=e.target.closest('[data-action]');if(!b)return;const{action,id}=b.dataset;
 const menu=b.closest('details.menu');if(menu)menu.open=false;
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
  if(action==='delete-provider'){if(!await ask('删除供应商？','对应的模型会从鲸屿的「鲸桥」渠道中移除。其他供应商和对话记录不受影响。','删除供应商'))return;await api('provider/delete',{id});}
  if(action==='delete-group'){if(!await ask('删除路由组？','这个组会从鲸屿的模型列表中移除，成员模型和供应商配置仍保留。','删除路由组'))return;await api('group/delete',{id});}
  if(action==='toggle-provider'){const p=state.providers.find(p=>p.id===id);await api('provider',{...p,off:!p.off});}
  message(action==='sync'?'模型已重新同步到鲸屿':'已更新，模型已同步到鲸屿');await load();
 }catch(e){message(e.message,true);}finally{if(!['hide-model','model-scope','fold-channel'].includes(action))b.disabled=false;}
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
async function uploadProviderIcon(e){const file=e.target.files[0];if(!file)return;const current=editor;
 try{if(file.size>1048576)throw new Error('图标最大为 1 MiB');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const r=await api('icons',{data:btoa(binary)});if(current===editor&&!current.closed)$('#f-providerIcon').value=r.icon;}catch(error){formError(error);}
}
function providerDraft(){const input=providerInput(Object.fromEntries(new FormData($('#edit-form'))));input.id=editor.from || editor.copyOf || '';input.typed=true;return input;}
function probeResults(results){return (results || []).map(r=>`<div class="probe-row ${r.ok?'probe-ok':'probe-error'}"><strong>${escape([r.model || r.protocol || '连接',r.account].filter(Boolean).join(' · '))}</strong><span>${escape(protocolName(r.protocol))} · ${r.ok?'可用':'未通过'}${r.status?` · HTTP ${r.status}`:''}${r.ms!==undefined?` · ${r.ms} ms`:''}</span>${r.error?`<p>${escape(r.error)}</p>`:''}${r.base?`<code>${escape(r.base)}</code>`:''}</div>`).join('') || '<p class="form-hint">供应商未返回检测结果。</p>';}
$('#fields').addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b||editor?.type!=='provider')return;const{action,id}=b.dataset;
 if(!['pick-provider-model','models-all','models-none','models-free','fetch-edit-models','unfetch-edit-models','test-provider','detect-provider','test-one-model','test-selected-models','detect-selected-models','reset-model-pref','copy-model-id','check-balance','another-provider','copy-provider','show-provider-key','provider-favicon','stepfun-copy','stepfun-session','stepfun-signout','add-price-tier','remove-price-tier'].includes(action))return;
 const current=editor;b.disabled=true;$('#form-error').hidden=true;
 try{
  if(action==='another-provider'||action==='copy-provider'){openProvider(id,action==='copy-provider'?'copy':'another');return;}
  if(action==='copy-model-id'){await copyText(id);return;}
  if(action==='add-price-tier'||action==='remove-price-tier'){const row=b.closest('.model-setting');if(action==='remove-price-tier')b.closest('.price-tier').remove();else{const price=priceOfRow(row),last=price.tiers.at(-1);row.querySelector('.price-tiers').insertAdjacentHTML('beforeend',priceTierFields({...price,above:last?last.above+100000:272000}));}keepRowPrice(row);return;}
  if(action==='show-provider-key'){const input=$('#f-key');if(input.type==='text'){input.type='password';b.textContent='显示密钥';if(current.revealedKey&&!current.typedKey){input.value='';current.revealedKey=false;}return;}if(!input.value&&id){input.value=(await api(`provider/${encodeURIComponent(id)}/key`)).key;current.revealedKey=true;}if(current!==editor||current.closed)return;input.type='text';b.textContent='隐藏密钥';return;}
  if(action==='provider-favicon'){const data=providerDraft(),r=await api('provider/icon',{url:data.chat || data.responses || data.anthropic || data.website,name:data.name});if(current===editor&&!current.closed)$('#f-providerIcon').value=r.icon;return;}
  if(action.startsWith('stepfun-')){const sp=current.data.stepPlan;if(action==='stepfun-copy'){await copyText(sp.bookmarklet);return;}await api(`stepfun/${encodeURIComponent(sp.site)}/${action==='stepfun-signout'?'signout':'session'}`,action==='stepfun-signout'?{}:{text:$('#f-stepSession').value});if(current!==editor||current.closed)return;const fresh=await api('state'),p=fresh.providers.find(p=>p.id===current.data.id);current.data.stepPlan=p.stepPlan;$('#step-plan').outerHTML=stepPlanFields(p.stepPlan);message(action==='stepfun-signout'?'已退出 StepFun 额度查询':'Step Plan 额度查询已连接');return;}
  if(action==='pick-provider-model'){const picked=new Set(lines($('#f-models').value));if(picked.has(id))picked.delete(id);else picked.add(id);$('#f-models').value=[...picked].join('\n');drawProviderModels();return;}
  if(['models-all','models-none','models-free'].includes(action)){$('#f-models').value=(action==='models-none'?[]:current.available.filter(m=>action==='models-all'||m.free||m.price?.input===0&&m.price?.output===0)).map(m=>m.id).join('\n');drawProviderModels();return;}
  if(action==='reset-model-pref'){current.modelPrefs[id]={name:'',efforts:[],ownImages:true,api:'',same:'',ownPrice:true};drawProviderModels();return;}
  const data=providerDraft();
  if(action==='test-selected-models'||action==='detect-selected-models'){const ids=lines($('#f-models').value);if(!ids.length)throw new Error('请先选择要检查的模型');const r=await api(action==='test-selected-models'?'provider/test':'provider/detect',{...data,...(action==='test-selected-models'?{test:ids}:{detectModels:ids}),base:data[data.baseAPI] || data.chat || data.responses || data.anthropic});if(current!==editor||current.closed)return;$('#selected-model-results').innerHTML=r.models?r.models.map(m=>`<details class="advanced"><summary>${escape(m.model)}</summary>${probeResults(m.results)}</details>`).join('')+(r.models.length<ids.length?`<p class="form-hint">本次检查 ${r.models.length} / ${ids.length} 个模型。</p>`:''):probeResults(r.results);return;}
  if(action==='fetch-edit-models'||action==='unfetch-edit-models'){
   let r;if(action==='unfetch-edit-models'){await api('provider/unfetch',{id});const fresh=await api('state');r={provider:fresh.providers.find(p=>p.id===id)};}else r=await api(current.from?'provider/models':'provider/list',data);
   if(current!==editor||current.closed)return;current.available=r.provider?availableModels(r.provider):(r.models || []).map(normalizeModel);const dropped=new Set(r.dropped || []);$('#f-models').value=lines($('#f-models').value).filter(m=>!dropped.has(m)).join('\n');drawProviderModels();$('#provider-test-result').textContent=`模型目录已更新：${current.available.length} 个${dropped.size?`，${dropped.size} 个已下架模型已从选择中移除`:''}`;return;
  }
  if(action==='check-balance'){const r=await api('provider/balance',data);if(current!==editor||current.closed)return;$('#balance-result').textContent=r.error?`查询失败：${r.error}`:r.ok?`当前余额：${r.amount}`:'该供应商没有余额查询接口';return;}
  const result=await api(action==='detect-provider'?'provider/detect':'provider/test',{...data,...(action==='test-one-model'?{test:[id]}:{}),base:data[data.baseAPI] || data.chat || data.responses || data.anthropic || data.decide,model:action==='test-one-model'?id:lines($('#f-models').value)[0] || ''});
  if(current!==editor||current.closed)return;const target=action==='test-one-model'?b.closest('.model-setting').querySelector('.model-test-result'):$('#provider-test-result');target.innerHTML=probeResults(result.results);
  if(action==='detect-provider'){current.detected=result.results;target.insertAdjacentHTML('beforeend',button('采用可用的协议地址','apply-detected-protocols'));}
 }catch(error){if(current===editor&&!current.closed)formError(error);}finally{b.disabled=false;}
});
$('#fields').addEventListener('click',e=>{if(e.target.closest('[data-action="apply-detected-protocols"]')){for(const r of editor.detected || [])if(r.ok&&$(`#f-${r.protocol}`))$(`#f-${r.protocol}`).value=r.base;const chosen=(editor.detected || []).find(r=>r.ok);if(chosen)$('#f-baseAPI').value=chosen.protocol;message('协议地址已填入，保存后生效');}});
$('#fields').addEventListener('input',e=>{if(e.target.id==='f-key'&&editor?.type==='provider'){editor.typedKey=true;editor.revealedKey=false;}});
function stepPlanFields(sp){return `<div class="form-section" id="step-plan"><h3>Step Plan 套餐额度</h3>${sp.signedIn?`<p class="form-hint">已连接。可在「用量统计」查看 5 小时、每周与积分窗口。</p>${button('退出额度查询','stepfun-signout')}`:`<p class="form-hint">API 密钥只能查询余额。先登录 StepFun 平台，将书签工具复制到浏览器书签中，再从登录页面复制会话并粘贴到此处。会话只用于套餐额度查询。</p>${externalLink(sp.url,'登录 StepFun 平台')}<div class="actions-bar">${button('复制书签工具','stepfun-copy')}</div>${field('stepSession','StepFun 查询会话','','password','粘贴书签工具复制的内容')}<div class="actions-bar">${button('保存查询会话','stepfun-session')}</div>`}</div>`;}
async function exportProvider(id){const r=await api('provider/export',{id});editor={type:'export',data:{id}};$('#editor-title').textContent='导出供应商配置';$('#fields').innerHTML=text('export','供应商配置',r.text || JSON.stringify(r.provider || r,null,2))+'<p class="form-hint">导出内容不包含 API 密钥和认证 Header 值。复制后可在另一处导入，导入前补充凭据。</p><div class="actions-bar">'+button('复制配置','copy-export')+'</div>';showEditor();$('#f-export').readOnly=true;$('#save').hidden=true;}
function quotaIdentity(q){return JSON.stringify({provider:q.provider,user:q.user || ''});}
function quotaWindows(windows){return (windows || []).map(w=>{const used=Number(w.used),value=Number.isFinite(used)?Math.max(0,Math.min(100,used)):null,left=subscriptionSettings.quotaLeft,share=left?100-used:used;return `<div class="quota-window"><div><span>${escape(w.name)}</span><strong>${w.unlimited?'不限':w.display?escape(w.display):value===null?'未报告':`${share.toFixed(1)}% ${left?'剩余':'已使用'}`}</strong></div>${w.unlimited||value===null?'':`<progress max="100" value="${left?100-value:value}" aria-label="${escape(w.name)} ${left?'剩余':'已使用'} ${share.toFixed(1)}%"></progress>`}${w.limit?`<p class="caption">${short(left?w.limit-w.amount:w.amount)} / ${short(w.limit)} ${escape(w.unit || '')}</p>`:''}<p class="caption">${w.resetsAt?`重置于 ${escape(dateText(w.resetsAt))}`:w.resetSecs?`约 ${Math.ceil(w.resetSecs/60)} 分钟后重置`:''}${w.capped?` · 按账号额度上限使用${w.capsSome?'（此窗口所属模型）':''}`:''}</p></div>`;}).join('');}
function dailyCredits(daily){return daily?.days?.length?`<details class="advanced daily-credits"><summary>每日 credits 用量 · 自 ${escape(daily.since)} 起</summary><div class="table-wrap"><table><thead><tr><th>日期</th><th>已使用 credits</th></tr></thead><tbody>${[...daily.days].reverse().map(d=>`<tr><td>${escape(d.day)}</td><td>${short(d.used)}</td></tr>`).join('')}</tbody></table></div></details>`:'';}
function quotaResetDetails(resets){return resets?.each?.length?`<details class="advanced"><summary>每次额度重置的有效期（${resets.each.length} 次）</summary><div class="table-wrap"><table><thead><tr><th>适用窗口</th><th>有效期</th></tr></thead><tbody>${resets.each.map(r=>`<tr><td>${escape(({fiveHour:'5 小时窗口',weekly:'每周窗口'})[r.window] || '账户额度窗口')}</td><td>${r.until?escape(dateText(r.until)):'永不过期'}</td></tr>`).join('')}</tbody></table></div></details>`:'';}
function quotaHeldInfo(q){if(q.held)return '<p class="inline-error">额度已耗尽，供应商已暂停这个账号的请求。</p>';const codex=q.provider==='codex'||q.provider?.endsWith('/codex'),creditsOn=q.from||!(subscriptionSettings.codexNoCredits || []).includes((q.user || '').toLowerCase());return codex&&creditsOn&&q.balance&&(q.windows || []).some(w=>!w.unlimited&&Number(w.used)>=100)?'<p class="caption">套餐窗口额度已耗尽，继续使用付费 credits。</p>':'';}
function balanceTrendView(trend){const points=(trend?.points || []).map(p=>({...p,time:Date.parse(p.at)})).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.amount));if(points.length<2)return '';const first=points[0],last=points.at(-1),from=first.time,to=Math.max(last.time,trend.fitFrom?Date.now():last.time),minimum=Math.min(...points.map(p=>p.amount),trend.fitFrom?trend.fitNow:last.amount),maximum=Math.max(...points.map(p=>p.amount),trend.fitFrom?trend.fitStart:first.amount),spread=maximum-minimum || Math.max(maximum*.1,1),low=minimum-spread*.1,high=maximum+spread*.1,x=t=>24+(t-from)/(to-from || 1)*296,y=v=>92-(v-low)/(high-low)*72,polyline=points.map(p=>`${x(p.time).toFixed(1)},${y(p.amount).toFixed(1)}`).join(' ');return `<div class="balance-trend"><p class="caption">最近 14 天余额走势</p><svg viewBox="0 0 344 112" role="img" aria-label="余额从 ${escape(first.amount)} 变化到 ${escape(last.amount)}"><line class="trend-axis" x1="24" y1="92" x2="320" y2="92"/><polyline class="trend-line" points="${polyline}"/>${trend.fitFrom?`<line class="trend-fit" x1="${x(Date.parse(trend.fitFrom)).toFixed(1)}" y1="${y(trend.fitStart).toFixed(1)}" x2="${x(to).toFixed(1)}" y2="${y(trend.fitNow).toFixed(1)}"/>`:''}<circle class="trend-dot" cx="${x(last.time).toFixed(1)}" cy="${y(last.amount).toFixed(1)}" r="3"/><text x="24" y="108">${escape(new Date(first.time).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</text><text x="320" y="108" text-anchor="end">${escape(new Date(last.time).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}))}</text><text x="24" y="12">${maximum.toFixed(2)}</text></svg>${trend.fitFrom?`<p class="caption">近期平均消耗 ${Number(trend.perDay).toFixed(2)} / 天${trend.runsOut?` · 预计 ${escape(dateText(trend.runsOut))} 耗尽`:''}</p><p class="form-hint">按近期余额变化估计，充值或用量变化会影响预测。</p>`:''}<details class="advanced"><summary>查看余额读取记录</summary><div class="table-wrap"><table><thead><tr><th>读取时间</th><th>余额</th></tr></thead><tbody>${[...points].reverse().map(p=>`<tr><td>${escape(dateText(p.at))}</td><td>${p.amount.toFixed(2)}</td></tr>`).join('')}</tbody></table></div></details></div>`;}
function quotaCards(rows){return rows.length?`<div class="quota-grid">${rows.map(q=>`<article class="panel quota-card"><div class="quota-head"><div><h3>${escape(q.name || q.provider)}</h3><p class="caption">${escape([q.from?`远端 ${q.from}`:'',q.user,q.plan].filter(Boolean).join(' · ') || 'API 余额')}</p></div>${iconButton('刷新这个账号的额度','quota-refresh',quotaIdentity(q),'refresh')}</div>${q.balance?`<strong class="quota-balance">${escape(q.balance)}</strong>`:''}${q.balanceParts?.length?`<dl class="quota-parts">${q.balanceParts.map(p=>`<dt>${escape(p.name || p.label || '余额')}</dt><dd>${escape(p.text || p.display || '')}</dd>`).join('')}</dl>`:''}${balanceTrendView(q.balanceTrend)}${quotaWindows(q.windows)}${q.until?`<p class="caption">套餐${q.renew==='auto'?'续费':'到期'}：${escape(dateText(q.until))}</p>`:''}${q.resets?`<p class="caption">${q.resets.byWindow?`5 小时重置 ${q.resets.fiveHour || 0} 次 · 每周重置 ${q.resets.weekly || 0} 次`:`剩余重置 ${q.resets.count} 次`}${q.resets.until?` · 最早到期 ${escape(dateText(q.resets.until))}`:''}</p>`:''}${quotaResetDetails(q.resets)}${quotaHeldInfo(q)}${q.checkin?`<p class="caption">签到：${escape(({claimed:'已领取',done:'今日已签到',ineligible:'无法参与',inactive:'活动未开始或已结束',failed:'签到失败',captcha:'需在供应商页面完成验证'})[q.checkin.outcome] || q.checkin.outcome)}${q.checkin.credit?` · 获得 ${short(q.checkin.credit)} credits`:''}${q.checkin.streak?` · 连续 ${q.checkin.streak} 天`:''}${q.checkin.msg?` · ${escape(q.checkin.msg)}`:''}</p>`:''}${dailyCredits(q.daily)}${q.error?`<p class="inline-error">${escape(q.error)}</p>`:''}${q.asOf?`<p class="inline-error">显示上次成功读取的额度：${escape(dateText(q.asOf))}</p>`:q.readAt?`<p class="caption">读取于 ${escape(dateText(q.readAt))}</p>`:''}${!(q.windows || []).length&&!q.balance&&!q.error?'<p class="form-hint">供应商未报告额度或余额。</p>':''}<div class="actions-bar compact-actions">${!q.from&&q.checkins?button('现在签到','quota-checkin',JSON.stringify({provider:q.checkinBy || q.provider})):''}${!q.from&&q.provider==='codex'&&q.resets?.count?button('使用一次重置','quota-reset',quotaIdentity(q)):''}${!q.from&&q.provider==='codex'&&q.user?button('账号维护','quota-settings',quotaIdentity(q)):''}${button('额度记录','quota-card-history',quotaIdentity(q))}</div></article>`).join('')}</div>`:empty('供应商暂无额度报告','部分供应商只报告余额，部分订阅需要连接套餐查询会话。配置入口在供应商设置中。','','usage');}
async function loadQuotas(epoch){const target=$('#quota-section');if(!target)return;target.setAttribute('aria-busy','true');
 try{const [rows,settings]=await Promise.all([api('quotas'),api('subscription/settings')]);if(epoch!==renderEpoch||!$('#quota-section'))return;quotaRows=rows || [];subscriptionSettings=settings;$('#quota-section').innerHTML=quotaCards(quotaRows);}
 catch(error){if(epoch===renderEpoch&&$('#quota-section'))$('#quota-section').innerHTML=`<div class="panel empty"><h3>额度读取失败</h3><p>${escape(error.message)}</p>${button('重新读取','refresh-quotas')}</div>`;}
 finally{if(epoch===renderEpoch&&$('#quota-section'))$('#quota-section').setAttribute('aria-busy','false');}
}
async function quotaAction(action,id,b){const data=JSON.parse(id);b.disabled=true;try{
 if(action==='quota-card-history'){await openQuotaHistory(data);return;}
 if(action==='quota-settings'){openQuotaAccount(data);return;}
 if(action==='quota-reset'){if(!await ask('使用一次 Codex 重置？','会消耗这个账号的一次重置，重启供应商的额度窗口。当前窗口剩余额度会被重置。','使用一次重置'))return;const r=await api('quotas/codex-reset',{user:data.user});message(r.code?`重置结果：${r.code}`:'重置已提交');}
 else if(action==='quota-checkin'){const r=await api('quotas/checkin',data);const failed=(r.results || r || []).filter(a=>a.outcome==='failed'||a.outcome==='captcha');message(failed.length?`签到完成，${failed.length} 个账号需要处理`:'签到完成',failed.length>0);}
 else if(action==='quota-refresh')await api('quotas/refresh',data);
 await loadQuotas(renderEpoch);
 }finally{b.disabled=false;}}
function openQuotaAccount(data){const key=data.user.toLowerCase(),warm=subscriptionSettings.codexWarmAtOf?.[key] || '';editor={type:'quota-account',data};$('#editor-title').textContent='Codex 账号维护';$('#fields').innerHTML=`<p class="form-hint">${escape(data.user)}</p>`+checkField('codexAutoReset','按上游规则自动使用账号重置',(subscriptionSettings.codexAutoReset || []).includes(key),'每周窗口耗尽且其他账号不可用时，或已有重置即将到期时，允许自动消耗重置。')+checkField('codexCredits','额度用尽后继续使用付费 credits',!(subscriptionSettings.codexNoCredits || []).includes(key),'关闭后账号额度用尽时停止使用，转到其他账号或回退模型。')+selectField('warmMode','每日窗口预热',[['','跟随全局设置'],['off','关闭此账号的每日预热'],['custom','使用独立时间']],warm==='off'?'off':warm?'custom':'')+`<div id="own-warm-time" ${warm&&warm!=='off'?'':'hidden'}>${field('codexWarmAt','预热时间',warm==='off'?'':warm,'time')}</div>`;showEditor();$('#f-warmMode').onchange=e=>{$('#own-warm-time').hidden=e.target.value!=='custom';$('#f-codexWarmAt').required=e.target.value==='custom';};}
async function openSubscriptionSettings(){const [s,subs]=await Promise.all([api('subscription/settings'),api('subscriptions')]);subscriptionSettings=s;editor={type:'subscription-settings'};$('#editor-title').textContent='订阅维护设置';const choices=[['','关闭'],['week','每周窗口重置后预热'],['all','每个窗口重置后预热']];$('#fields').innerHTML=`<p class="form-hint">窗口预热会发送一个很小的请求，使额度窗口从选定时间开始计算。只对鲸桥已启用的账号执行。</p><div class="form-grid"><div>${selectField('codexWarmup','Codex 窗口预热',choices,s.codexWarmup || '')}${field('codexWarmAt','Codex 每日预热时间',s.codexWarmAt || '','time')}</div><div>${selectField('claudeWarmup','Claude 窗口预热',choices,s.claudeWarmup || '')}${field('claudeWarmAt','Claude 每日预热时间',s.claudeWarmAt || '','time')}</div></div><p class="form-hint">每日时间留空则关闭；账号可设置独立的预热时间。</p>${checkField('quotaLeft','按剩余额度显示窗口',s.quotaLeft)}<div class="form-section"><h3>自动领取每日额度</h3>${[['workbuddyCheckin','WorkBuddy 中国版'],['traeCheckin','Trae 中国版'],['minimaxCheckin','MiniMax Code 中国版'],['qoderCheckin','Qoder / Qoder 中国版']].map(([k,n])=>checkField(k,n,s[k])).join('')}${subs.filter(p=>p.plugin&&p.checkin).map(p=>`<label class="check-field"><input type="checkbox" data-plugin-checkin="${escape(p.pid || p.id)}" ${s.pluginCheckinsEffective?.[p.pid || p.id]?'checked':''}><span>${escape(p.name)} 供应商适配器签到</span></label>`).join('')}<p class="form-hint">供应商要求验证码时，需在供应商自己的页面完成；签到结果显示在额度卡片。</p></div><div class="form-section"><h3>全局供应商代理</h3>${proxyFields(s.proxy || '')}<p class="form-hint">供应商或账号的独立代理设置优先。</p></div>`;showEditor();$('#f-proxyMode').onchange=e=>{$('#proxy-address').hidden=e.target.value!=='custom';$('#f-proxy').required=e.target.value==='custom';};}
async function openQuotaHistory(filter={}){const query=new URLSearchParams({days:'7',...(filter.provider?{provider:filter.provider}:{}),...(filter.user?{user:filter.user}:{})}),rows=await api(`quotas/history?${query}`);editor={type:'quota-history',data:filter};$('#editor-title').textContent='最近 7 天额度变化';$('#fields').innerHTML=(rows || []).length?rows.map(q=>`<div class="form-section"><h3>${escape(q.provider)}${q.user?` · ${escape(q.user)}`:''}</h3>${(q.lines || []).map(l=>`<details class="advanced"><summary>${escape(l.name)} · ${(l.points || []).length} 次读取</summary><div class="table-wrap"><table><thead><tr><th>读取时间</th><th>剩余额度</th><th>重置时间</th></tr></thead><tbody>${(l.points || []).map(p=>`<tr><td>${escape(dateText(p.at))}</td><td>${Number(p.left).toFixed(1)}%</td><td>${p.resetsAt?escape(dateText(p.resetsAt)):'—'}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}</div>`).join(''):'<p class="form-hint">还没有保存的额度变化。使用和读取供应商额度后，会逐步形成记录。</p>';showEditor();$('#save').hidden=true;}
const healthLevels={ok:'正常',degraded:'性能下降',partial:'部分中断',major:'服务中断',maintenance:'维护中'};
function upstreamVendors(upstream){return Array.isArray(upstream.vendors)?upstream.vendors:Object.values(upstream.vendors || {});}
function liveLaneRows(lanes){return Object.entries(lanes || {}).map(([id,l])=>`<tr><td>${escape(id)}</td><td>${l.busy}</td><td>${l.waiting}</td><td>${l.limit || '不限'}</td></tr>`).join('') || '<tr><td colspan="4">当前没有受并发限制的请求。</td></tr>';}
async function startProviderLive(epoch){try{const [upstream,lanes]=await Promise.all([api('upstream'),api('lanes')]);if(epoch!==renderEpoch||tab!=='providers')return;const vendors=upstreamVendors(upstream);for(const target of document.querySelectorAll('[data-provider-live]')){const id=target.dataset.providerLive,status=vendors.find(v=>v.vendor===upstream.providers?.[id]),active=Object.entries(lanes).filter(([key])=>key===id||key.startsWith(`${id}#`)||key.startsWith(`${id}@`));target.innerHTML=`${status&&status.level!=='ok'?`<p class="${status.level?'inline-error':'caption'}">${escape(status.name)} API：${escape(healthLevels[status.level] || '公开状态未知')}${status.error?` · ${escape(status.error)}`:''} ${externalLink(status.page,'供应商状态页')}</p>`:''}${active.length?`<p class="caption">处理中 ${active.reduce((n,[,l])=>n+l.busy,0)} · 排队 ${active.reduce((n,[,l])=>n+l.waiting,0)}</p>`:''}`;}}catch(error){if(epoch===renderEpoch&&tab==='providers')for(const target of document.querySelectorAll('[data-provider-live]'))target.innerHTML=`<p class="caption">运行状态未能读取：${escape(error.message)}</p>`;}finally{if(epoch===renderEpoch&&tab==='providers')providerLiveTimer=setTimeout(()=>startProviderLive(epoch),5000);}}
function healthView(upstream,lanes){const vendors=upstreamVendors(upstream);return `<div class="panel">${vendors.map(v=>`<div class="row"><div class="text"><h3>${escape(v.name || v.vendor)}</h3><p class="caption">${escape(healthLevels[v.level] || '公开状态未知')}${v.read?` · ${escape(dateText(v.read))}`:''}</p>${v.error?`<p class="inline-error">${escape(v.error)}</p>`:''}${(v.parts || []).map(p=>`<p class="caption">${escape(p.name)} · ${escape(p.status)}</p>`).join('')}${(v.incidents || []).map(i=>`<p>${externalLink(i.url,i.name)}</p>`).join('')}${externalLink(v.page,'打开供应商状态页')}</div></div>`).join('') || '<p class="empty-inline">已配置供应商没有可读取的公开状态页。</p>'}</div><div class="form-section"><h3>当前请求与排队</h3><div class="table-wrap"><table><thead><tr><th>密钥 / 账号</th><th>处理中</th><th>排队</th><th>并发限制</th></tr></thead><tbody>${liveLaneRows(lanes)}</tbody></table></div></div>`;}
async function refreshHealth(current){try{const [upstream,lanes]=await Promise.all([api('upstream'),api('lanes')]);if(current!==editor||current.closed)return;$('#health-status').innerHTML=healthView(upstream,lanes);$('#health-error').hidden=true;}catch(error){if(current===editor&&!current.closed){$('#health-error').textContent=`运行状态未能读取：${error.message}`;$('#health-error').hidden=false;}}finally{if(current===editor&&!current.closed)healthTimer=setTimeout(()=>refreshHealth(current),3000);}}
async function openProviderHealth(){clearTimeout(healthTimer);editor={type:'health'};const current=editor;$('#editor-title').textContent='供应商运行状态';$('#fields').innerHTML='<p class="form-hint">供应商自己的 API 服务状态；鲸桥请求与排队实时更新。</p><p id="health-error" class="inline-error" hidden></p><div id="health-status"><p class="form-hint">正在读取…</p></div>';showEditor();$('#save').hidden=true;await refreshHealth(current);}
$('#editor').addEventListener('close',()=>clearTimeout(healthTimer));
async function openAdapters(){const r=await api('subscription/adapters');editor={type:'adapters'};$('#editor-title').textContent='订阅供应商适配器';const ref=p=>JSON.stringify({id:p.id,package:p.package});$('#fields').innerHTML=`<p class="form-hint">适配器提供供应商登录、模型目录与请求认证。在这里管理接入订阅所需的适配器。</p><div class="form-section"><h3>已安装</h3><div class="panel">${(r.installed || []).map(p=>`<div class="row account-row"><div class="text"><strong>${escape(p.name || p.package)}</strong><p class="caption">${escape(p.package)}${p.version?` · v${escape(p.version)}`:''} · ${p.enabled?'已启用':'已停用'}</p><p class="caption">${escape((p.providers || []).map(v=>typeof v==='string'?v:v.name || v.id).join('、'))}</p></div><div class="actions">${button('配置','adapter-options',ref(p))}${button('更新','adapter-update',ref(p))}${button(p.enabled?'停用':'启用',p.enabled?'adapter-off':'adapter-on',ref(p))}${button('移除','adapter-remove',ref(p),'danger')}</div></div>`).join('') || '<p class="empty-inline">尚未安装订阅供应商适配器。</p>'}</div></div><div class="form-section"><h3>可安装的供应商适配器</h3><div class="panel">${(r.available || []).filter(p=>!(r.installed || []).some(i=>i.package===p.package)).map(p=>`<div class="row account-row"><div class="text"><strong>${escape(p.name || p.package)}</strong><p class="caption">${escape(typeof p.summary==='object'?(p.summary?.zh || p.summary?.en || ''):p.summary || p.package)}</p></div>${button('安装','adapter-install',ref(p))}</div>`).join('') || '<p class="empty-inline">可用的推荐适配器已经安装。</p>'}</div></div>${(r.moves || []).length?`<div class="form-section"><h3>已有订阅迁移</h3><div class="panel">${r.moves.map(m=>`<div class="row account-row"><div class="text"><strong>${escape(subscriptionNames[m.id] || m.id)}</strong><p class="caption">${escape(m.package)} · ${m.moved?'已由适配器提供':'使用内置订阅接入'}</p>${m.error?`<p class="inline-error">${escape(m.error)}</p>`:''}</div>${button(m.moved?'恢复内置接入':m.signedIn?'迁移到供应商适配器':'使用供应商适配器接入',m.moved?'adapter-moveback':m.signedIn?'adapter-move':'adapter-adopt',JSON.stringify(m))}</div>`).join('')}</div></div>`:''}<details class="advanced"><summary>安装其他供应商适配器</summary><div class="advanced-body">${field('package','适配器包名','','text','例如 npm 包名或供应商提供的 package spec')}<p class="form-hint">安装后只列出提供供应商认证的适配器。</p>${button('安装此适配器','adapter-install-custom')}</div></details>`;showEditor();$('#save').hidden=true;}
$('#fields').addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||!b.dataset.action.startsWith('adapter-'))return;const current=editor,action=b.dataset.action.replace('adapter-',''),data=action==='install-custom'?{package:$('#f-package').value.trim()}:JSON.parse(b.dataset.id);b.disabled=true;$('#form-error').hidden=true;
 try{if(action==='options'){const r=await api(`subscription/adapter/${encodeURIComponent(data.id)}/options`);if(current!==editor||current.closed)return;editor={type:'adapter-options',data};$('#editor-title').textContent='供应商适配器配置';$('#fields').innerHTML=text('options','适配器选项（JSON）',JSON.stringify(r.options,null,2))+'<p class="form-hint">按供应商适配器说明编辑配置；保存后由该适配器使用。</p>';showEditor();return;}if(action==='install-custom'&&!data.package)throw new Error('请填写适配器包名');if(['remove','move','moveback'].includes(action)&&!await ask(action==='remove'?'移除供应商适配器？':action==='move'?'迁移已有订阅？':'恢复内置订阅接入？',action==='remove'?'该适配器提供的供应商将无法继续使用，已保存的鲸桥配置仍保留。':action==='move'?'将已有账号和供应商设置交给适配器。凭据不会写入其他客户端。':'将账号交还给鲸桥的内置接入。原客户端登录数据不受影响。','继续'))return;await api('subscription/adapter',{...data,action:action==='install-custom'?'install':action});if(current!==editor||current.closed)return;await load();await openAdapters();message('供应商适配器已更新');}catch(error){if(current===editor&&!current.closed)formError(error);}finally{b.disabled=false;}
});
$('#fields').addEventListener('click',e=>{if(e.target.closest('[data-action="copy-export"]'))copyText($('#f-export').value).catch(formError);});
document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('details.menu[open]'))if(!menu.contains(e.target))menu.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const menu of document.querySelectorAll('details.menu[open]'))menu.open=false;});
load();
