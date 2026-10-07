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
 if(text) $('#main').scrollTo({top:0});
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
function providers() {
 let html = heading('供应商与账号','连接模型的来源。API 密钥和订阅账号都在这里管理。',`<div class="actions">${button(`${icon('account')}订阅账号`,'subscription')}${button(`${icon('plus')}添加供应商`,'add-provider','','primary')}</div>`);
 if(!state.providers.length) return html + empty('连接你的第一个模型来源','已有 API 密钥？添加供应商。已有支持的订阅？选择订阅账号，通过供应商登录后接入。',button('添加供应商','add-provider','','primary')+button('接入订阅账号','subscription'),'providers');
 html += `<div class="provider-grid">${state.providers.map(p=>`<article class="provider-card ${p.off?'disabled':''}"><div class="provider-head"><span class="provider-avatar" aria-hidden="true">${escape(Array.from(p.name || p.id)[0].toUpperCase())}</span><div class="text"><h3 class="title">${escape(p.name)}</h3><p class="caption">${p.account?'订阅账号':'API 供应商'}</p></div>${iconButton(`编辑 ${p.name}`,'edit-provider',p.id,'edit')}</div><div class="provider-detail"><p class="subtitle" title="${escape(p.chat || p.responses || p.anthropic || '')}">${escape(p.chat || p.responses || p.anthropic || '通过供应商订阅登录接入')}</p><div class="provider-meta"><span class="tag ${p.off?'':'business'}">${p.off?'已停用':'已启用'}</span><span class="tag">${p.modelCount || 0} 个模型</span><span class="tag subtle">${escape(routes[p.routing] || '智能')}路由</span></div></div><div class="provider-footer">${button(p.account?'管理账号':'管理密钥',p.account?'accounts':'keys',p.id)}<div class="provider-tools">${iconButton(`刷新 ${p.name} 的模型`,'fetch-provider',p.id,'refresh')}<details class="menu"><summary aria-label="${escape(p.name)} 的更多操作" title="更多操作">${icon('more')}</summary><div class="menu-content">${button(p.off?'启用供应商':'停用供应商','toggle-provider',p.id)}${button(`${icon('trash')}删除供应商`,'delete-provider',p.id,'danger')}</div></details></div></div></article>`).join('')}</div><p class="usage-note">${icon('info')}配置保存后自动同步到鲸屿。供应商密钥保存在本机，管理界面仅显示脱敏信息。</p>`;
 return html;
}
function modelRows() { return [...(state.models || []).map(m=>({...m,hidden:false})),...(state.hidden || []).map(m=>({...m,hidden:true}))].map(m=>visibilityPending.has(m.id)?{...m,hidden:visibilityPending.get(m.id)}:m); }
function modelList() {
 const query=modelQuery.trim().toLowerCase();
 const rows=modelRows().filter(m=>(modelFilter==='all'||(modelFilter==='hidden')===m.hidden)&&`${m.name || ''} ${m.id}`.toLowerCase().includes(query));
 $('#model-list').innerHTML=rows.length?`<div class="panel"><div class="model-head"><span>模型 / 标识</span><span class="model-context">上下文</span><span>桌面端显示</span></div>${rows.map(m=>`<div class="model-row ${m.hidden?'disabled':''}"><div><div class="model-name">${escape(m.name || m.id)}${m.group?'<span class="tag">路由组</span>':''}${m.images?'<span class="tag subtle">图像</span>':''}</div><div class="model-meta"><code>${escape(m.id)}</code>${m.efforts?.length?`<span class="caption">思考：${escape(m.efforts.join(' / '))}</span>`:''}</div></div><span class="caption model-context">${m.context?short(m.context):'—'}</span><div class="model-visibility"><button type="button" class="switch" role="switch" aria-checked="${!m.hidden}" aria-label="在桌面端显示 ${escape(m.name || m.id)}" title="${m.hidden?'显示模型':'隐藏模型'}" data-action="hide-model" data-id="${escape(m.id)}" ${visibilityPending.has(m.id)?'disabled aria-busy="true"':''}></button></div></div>`).join('')}</div>`:empty('没有匹配的模型','试试其他模型名称或标识，或切换显示范围。','','search');
 document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===modelFilter)));
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
 const epoch=++renderEpoch;
 document.querySelectorAll('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.setAttribute('aria-selected',String(selected));if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#page-label').textContent=pageNames[tab];
 $('#content').setAttribute('aria-busy','true');
 let html='';
 if(tab==='overview')html=overview();
 else if(tab==='providers')html=providers();
 else if(tab==='models') {
  html=heading('模型管理','选择哪些模型显示在鲸屿桌面端的「鲸桥」渠道中。',button(`${icon('refresh')}更新模型目录`,'refresh-catalog'));
  html+=modelRows().length?`<div class="list-toolbar"><div class="search">${icon('search')}<input id="model-search" type="search" placeholder="搜索模型名称或 ID" aria-label="搜索模型" value="${escape(modelQuery)}"></div><div class="segments" aria-label="模型显示范围">${Object.entries({all:'全部',shown:'已显示',hidden:'已隐藏'}).map(([v,l])=>`<button type="button" data-filter="${v}" aria-pressed="${v===modelFilter}">${l}</button>`).join('')}</div></div><div id="model-list"></div><p class="usage-note">${icon('info')}关闭显示开关会将模型从鲸屿的列表中隐藏，供应商配置仍保留。</p>`:empty('模型列表还是空的','添加并启用供应商，配置模型后，就可以在这里整理桌面端列表。',button('添加供应商','add-provider','','primary'),'models');
 } else if(tab==='routing')html=routingPage();
 else if(tab==='help')html=helpPage();
 else if(tab==='usage') {
  html=heading('用量统计','只统计通过鲸桥网关产生的调用，按所选时间范围汇总。',`<select class="usage-select" id="period" aria-label="用量周期">${Object.entries({today:'今天','7d':'近 7 天','30d':'近 30 天',all:'全部'}).map(([v,l])=>`<option value="${v}" ${v===period?'selected':''}>${l}</option>`).join('')}</select>`);
  $('#content').innerHTML=html+'<div class="loading"><p>正在读取用量…</p></div>';
  const u=await api(`usage?period=${period}`);
  html+=`<div class="stats">${stat('调用请求',short(u.calls),'经鲸桥网关发出','usage')}${stat('Token 总量',short((u.input || 0)+(u.output || 0)),`输入 ${short(u.input)} / 输出 ${short(u.output)}`,'models')}${stat('估算费用',`$${Number(u.cost || 0).toFixed(3)}`,'按已知模型价格估算','info')}</div><div class="section-head"><h2>按模型汇总</h2><span class="caption">${u.models?.length || 0} 个模型</span></div>`;
  html+=u.models?.length?`<div class="panel table-wrap"><table><thead><tr><th>模型</th><th>请求</th><th>输入 Token</th><th>输出 Token</th><th>估算费用</th></tr></thead><tbody>${u.models.map(m=>`<tr><td>${escape(m.model || m.id)}</td><td>${short(m.calls)}</td><td>${short(m.input)}</td><td>${short(m.output)}</td><td>$${Number(m.cost || 0).toFixed(3)}</td></tr>`).join('')}</tbody></table></div>`:empty('这个时间范围还没有调用记录','在鲸屿中选择「鲸桥」渠道的模型发起对话后，这里会记录请求和 Token 用量。','','usage');
  html+=`<p class="usage-note">${icon('info')}费用以供应商实际账单为准。${u.unpriced?`有 ${u.unpriced} 次请求缺少模型价格，费用未计入估算。`:'订阅账号的用量不等同于实际订阅账单。'}</p>`;
 }
 if(epoch!==renderEpoch)return;
 $('#content').innerHTML=html;$('#content').setAttribute('aria-busy','false');
 if($('#model-list')) {
  modelList();$('#model-search').addEventListener('input',e=>{modelQuery=e.target.value;modelList();});
 }
 $('#period')?.addEventListener('change',e=>{period=e.target.value;render().catch(e=>message(e.message,true));});
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
  $('#f-models').value=(r.models || pr?.models || []).join('\n');
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
function openProvider(id) {
 const p=state.providers.find(p=>p.id===id)||{id:'',name:'',models:[],routing:''};editor={type:'provider',data:p,removedHeaders:[]};
 $('#editor-title').textContent=id?'编辑供应商':'添加供应商';
 $('#fields').innerHTML=`<p class="form-hint">${p.account?'此供应商使用订阅账号认证，账号在「管理账号」中维护。':'连接已有的模型服务。选择预设可以自动填入接口地址，再填写你自己的 API 密钥。'}</p>`+(!id?`<label for="f-preset">供应商预设</label><select name="preset" id="f-preset"><option value="">自定义兼容接口</option>${state.presets.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}</select>`:'')+field('name','显示名称',p.name,'text','例如：我的 DeepSeek')+(p.account?'':field('key','API 密钥','','password',p.keySet?'已保存 · 留空保留原密钥':'填写供应商提供的密钥'))+'<div id="provider-region"></div>'+field('chat','Chat Completions 接口地址',p.chat,'url','https://api.example.com/v1')+`<div id="workspace-field" hidden>${field('workspace','Workspace ID','','text','API 密钥所属工作空间，如 ws-…')}<p class="form-hint">Bailian 决策模型按此工作空间接入；Token Plan 无需填写。</p></div><div class="form-section"><h3>提供给鲸屿的模型</h3>${text('models','模型 ID（每行一个）',(p.models || []).join('\n'),'例如 deepseek-chat')}<p class="form-hint">留空使用供应商默认模型。保存后可在供应商卡片刷新模型，在「模型管理」调整显示范围。</p></div><details class="advanced" id="provider-advanced"><summary>高级设置 · 协议、代理与路由</summary><div class="advanced-body">${field('responses','Responses 接口地址',p.responses,'url')}${field('anthropic','Anthropic 接口地址',p.anthropic,'url')}${field('decide','决策接口地址（可选）',p.decide,'text','https://api.typesafe.ai/v1')}<p class="form-hint">仅用于路由决策；Bailian 地址中的 {WorkspaceId} 由工作空间字段填入。</p>${routing(p.routing)}${proxyFields(p.proxy)}${text('fallback','故障转移模型（每行一个）',(p.fallback || []).join('\n'),'供应商ID/模型ID')}${p.account?'':'<div class="form-section"><h3>附加 HTTP Headers</h3><p class="form-hint">可用于供应商的自定义认证。已保存的值不回显；留空保留，点击移除后在保存时删除。</p><div id="header-list"></div><div class="actions-bar">'+button('添加 Header','add-header')+'</div></div>'}</div></details>`;
 $('#f-name').required=true;
 $('#f-proxyMode').onchange=e=>{$('#proxy-address').hidden=e.target.value!=='custom';$('#f-proxy').required=e.target.value==='custom';};$('#f-proxy').required=$('#f-proxyMode').value==='custom';
 const pr=state.presets.find(x=>x.id===p.preset);
 for(const name of p.headerNames || [])$('#header-list')?.append(headerRow(name,true));
 const hints=pr=>{for(const name of pr?.headerHints || [])if(![...document.querySelectorAll('.header-name')].some(i=>i.value.toLowerCase()===name.toLowerCase())){const row=headerRow(name,false,true);row.dataset.hint='true';$('#header-list')?.append(row);}};
 hints(pr);configurePreset(pr);
 $('#f-preset')?.addEventListener('change',e=>{const pr=state.presets.find(p=>p.id===e.target.value);configurePreset(pr,true);hints(pr);if(pr?.decide)$('#provider-advanced').open=true;});
 showEditor();
}
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
 $('#save').disabled=true;$('#form-error').hidden=true;const data=Object.fromEntries(new FormData(e.target));
 try {
  if(current.type==='subscription'){await beginSubscription(data);return;}
  if(current.type==='keys'){await api('keys',{id:current.data.id,action:'add',name:data.name,key:data.key,protocol:data.protocol});if(current!==editor||current.closed)return;await openKeys(current.data.id);message('密钥已添加');await load();return;}
  if(current.type==='project'){await api('accounts/project',{id:current.data.id,user:current.data.user,project:data.project});if(current!==editor||current.closed)return;await openAccounts(current.data.id);message('Cloud project 已保存');await load();return;}
  if(current.type==='provider'){
   const p=current.data;const input={...data,id:p.id,off:p.off || false,models:lines(data.models),fallback:lines(data.fallback),proxy:data.proxyMode==='direct'?'direct':data.proxyMode==='custom'?data.proxy:'',headers:headerChanges()};
   if(p.account||p.id&&!data.key)delete input.key;
   await api('provider',input);
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
  if(action==='add-group'||action==='edit-group'){openGroup(id);return;}
  b.disabled=true;
  if(action==='sync')await api('dsh/sync',{});
  if(action==='refresh-catalog')await api('catalog/refresh',{});
  if(action==='fetch-provider')await api('provider/fetch',{id});
  if(action==='delete-provider'){if(!await ask('删除供应商？','对应的模型会从鲸屿的「鲸桥」渠道中移除。其他供应商和对话记录不受影响。','删除供应商'))return;await api('provider/delete',{id});}
  if(action==='delete-group'){if(!await ask('删除路由组？','这个组会从鲸屿的模型列表中移除，成员模型和供应商配置仍保留。','删除路由组'))return;await api('group/delete',{id});}
  if(action==='toggle-provider'){const p=state.providers.find(p=>p.id===id);await api('provider',{...p,off:!p.off});}
  if(action==='hide-model'){
   if(visibilityPending.has(id))return;
   const hidden=!modelRows().find(m=>m.id===id)?.hidden;
   visibilityPending.set(id,hidden);modelList();
   const write=visibilityWrites.then(async()=>{
    try{await api('models/hidden',{id,hidden});await load();message('模型显示已更新，已同步到鲸屿');}
    finally{visibilityPending.delete(id);if($('#model-list'))modelList();}
   });
   // The API changes one ID under the configuration lock; the queue keeps the
   // user's click order without reusing an old full-list snapshot.
   visibilityWrites=write.catch(()=>{});await write;return;
  }
  message(action==='sync'?'模型已重新同步到鲸屿':'已更新，模型已同步到鲸屿');await load();
 }catch(e){message(e.message,true);}finally{b.disabled=false;}
});
$('#fields').addEventListener('click',e=>{
 const header=e.target.closest('[data-action=add-header],[data-action=remove-header]');
 if(header){if(header.dataset.action==='add-header'){$('#header-list').append(headerRow());$('#header-list .header-row:last-child .header-name').focus();}else{const row=header.closest('.header-row');if(row.dataset.saved)editor.removedHeaders.push(row.dataset.saved);row.remove();}return;}
 const b=e.target.closest('[data-action=pick-member]');if(!b)return;
 const members=new Set(lines($('#f-members').value));if(members.has(b.dataset.id))members.delete(b.dataset.id);else members.add(b.dataset.id);
 $('#f-members').value=[...members].join('\n');
 syncMemberSelection();
});
document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('details.menu[open]'))if(!menu.contains(e.target))menu.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const menu of document.querySelectorAll('details.menu[open]'))menu.open=false;});
load();
