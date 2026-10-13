'use strict';
const adapterTrust='社区插件会在本机运行第三方代码，并可访问登录凭据与请求。只安装你信任的来源；npm 搜索和 GitHub 仓库未经鲸桥审核。';
function adapterIsPath(spec){return /^(file:\/\/|\.|[\\/]|[a-z]:[\\/])/i.test(spec);}
function adapterLabel(p){return p.name&&p.name!==p.package?p.name:adapterIsPath(p.package)?p.package.replace(/[\\/]+$/,'').split(/[\\/]/).pop() || p.package:p.package;}
function adapterInstalled(current,spec){return (current.adapters.installed || []).find(p=>p.package===spec || p.id===spec);}
function adapterSignins(current,p){return (current.signins || []).filter(s=>s.plugin&&(p.providers || []).includes(s.pid || s.id));}
function adapterSummaryText(value){
 return String(value ?? '')
  .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g,'$1')
  .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g,'$1')
  .replace(/\s*\[?!\[[\s\S]*$/,'');
}
function adapterItem(current,spec){
 const p=[...(current.adapters.installed || []),...(current.items || []),...(current.adapters.available || [])].find(p=>p.package===spec || p.id===spec) || {package:spec};
 return {...current.metadata?.[p.id || p.package],...p};
}
function adapterRows(items,current,installed=false){
 return `<div class="adapter-list">${items.map(raw=>{
  const p={...current.metadata?.[raw.id || raw.package],...raw},here=installed?raw:adapterInstalled(current,raw.package),ref=JSON.stringify({id:here?.id,package:here?.package || raw.package});
  const summary=adapterSummaryText(typeof p.summary==='object'?(p.summary?.zh || p.summary?.en || ''):p.summary || p.description || '');
  const signins=here?.enabled?adapterSignins(current,here):[];
  return `<article class="adapter-item"><div class="adapter-identity"><strong>${escape(adapterLabel(p))}</strong><code>${escape(raw.package)}</code>${summary?`<p class="caption adapter-summary">${escape(summary)}</p>`:''}<p class="caption">${escape(p.source==='github'?'GitHub · 未经审核':p.community?'社区推荐':installed?'已安装到鲸桥':'npm · 未经审核')}${p.publisher?' · '+escape(p.publisher):''}${p.version?' · '+escape(p.version):''}${p.weekly?' · 每周下载 '+short(p.weekly):''}${p.license?' · '+escape(p.license):''}</p>${here?`<span class="status-badge">${here.enabled?'已安装 · 已启用':'已安装 · 已停用'}</span>`:''}${here?.latest&&here.latest!==here.version?`<span class="caption">可更新 ${escape(here.latest)}</span>`:''}${here?.autoUpdated?'<span class="caption">已自动更新</span>':''}${here?.error?`<p class="inline-error">${escape(here.error)}</p>`:''}</div><div class="adapter-actions">${button('详情与说明','adapter-page',ref,'text-button')}${signins.map(s=>button('登录 '+s.name,'adapter-signin',s.id,'primary')).join('')}${here?`${installed?button('配置','adapter-options',ref)+(adapterIsPath(here.package)?'':button('更新','adapter-update',ref))+button(here.enabled?'停用':'启用',here.enabled?'adapter-off':'adapter-on',ref)+button('移除','adapter-remove',ref,'text-button danger'):!here.enabled?button('启用','adapter-on',ref):''}`:button('安装','adapter-install',ref,'primary')}</div></article>`;
 }).join('')}</div>`;
}
function renderAdapterResults(current){
 if(current!==editor || current.closed)return;
 const items=current.items || [],source=current.discoverySource || 'suggested';
 $('#adapter-result-label').textContent=({suggested:'社区推荐',npm:'npm 搜索结果 · 未经审核',github:'GitHub 社区仓库 · 未经审核'})[source]+' · '+items.length+' 项';
 $('#adapter-search-results').innerHTML=items.length?adapterRows(items,current):`<p class="form-hint">${source==='github'?'未获取到 GitHub 仓库。服务可能不可用或受到限流，也可以直接填写可信仓库地址。':source==='npm'?'没有匹配的 npm 插件。试试英文供应商名称或完整包名，也可以填写可信插件的安装地址。':'没有匹配的社区推荐。试试 npm 搜索或 GitHub 仓库；兼容 API 也可以直接添加自定义供应商。'}</p>`;
}
function renderAdapters(current){
 const r=current.adapters,checked=r.updates?.checked;
 const lastCheck=checked&&!checked.startsWith('0001-')?dateText(checked):'';
 const installed=`<div class="actions-bar adapter-controls">${button('检查更新','adapter-check')}${button('更新全部','adapter-update-all')}<label class="check-field"><input id="adapter-mirror" type="checkbox" ${r.mirror?'checked':''}><span>使用国内镜像</span></label></div><p class="form-hint">${r.bun?`运行环境 ${escape(r.bunVer || 'Bun')} 已就绪。`:'首次安装时会下载所需的 Bun 运行环境。'}${lastCheck?` 最近检查：${escape(lastCheck)}`:''}</p>${r.error?`<p class="inline-error">${escape(r.error)}</p>`:''}${current.signinError?`<p class="inline-error">登录方式未能读取：${escape(current.signinError)}</p>`:''}${(r.installed || []).length?adapterRows(r.installed,current,true):'<p class="form-hint">还没有安装社区插件。到「查找与安装」选择可信的供应商插件。</p>'+button('查找社区插件','adapter-discover')}`;
 const discovery=`<p class="form-hint adapter-trust">${escape(adapterTrust)}</p><div class="adapter-search search">${icon('search')}<input id="adapter-search-query" type="search" value="${escape(current.query || '')}" placeholder="供应商名称、关键词或 npm 包名" aria-label="搜索社区供应商插件">${button('搜索','adapter-search')}</div><div class="actions-bar adapter-discovery-actions">${button('社区推荐','adapter-suggested','','text-button')}${button('GitHub 社区仓库','adapter-github','','text-button')}${button('添加自定义 API','adapter-custom-provider','','text-button')}</div><p id="adapter-result-label" class="form-hint" role="status"></p><div id="adapter-search-results" aria-busy="false"></div><details class="advanced"><summary>通过包名、仓库或本地路径安装</summary><div class="advanced-body">${field('package','可信插件的安装地址','','text','包名、包@版本、github:作者/仓库 或本地路径')}<p class="form-hint">安装不会自动完成订阅登录；插件提供登录方式后，还需授权自己的账号。</p>${button('安装指定插件','adapter-install-custom')}</div></details>`;
 const moves=(r.moves || []).map(m=>`<div class="row"><div class="text"><strong>${escape(subscriptionNames[m.id] || m.id)}</strong><p class="caption">${escape(m.package)} · ${m.moved?'适配器接入':'内置订阅接入'}</p>${m.error?`<p class="inline-error">${escape(m.error)}</p>`:''}</div>${button(m.moved?'恢复内置接入':m.signedIn?'迁移已有账号':'使用适配器接入',m.moved?'adapter-moveback':m.signedIn?'adapter-move':'adapter-adopt',JSON.stringify(m))}</div>`).join('') || '<p class="form-hint">当前没有可迁移的内置订阅。</p>';
 $('#fields').innerHTML=editorSection('discover','查找与安装','找不到内置供应商或订阅？从社区插件继续接入。',discovery)+editorSection('installed','已安装','安装后登录插件提供的订阅；也可以管理版本与运行状态。',installed)+editorSection('moves','订阅迁移','在内置接入与供应商适配器间管理已有授权。',moves);
 showEditor();$('#save').hidden=true;renderAdapterResults(current);
 $('#adapter-search-query').addEventListener('input',e=>{
  clearTimeout(current.searchTimer);current.query=e.target.value.trim();current.resultsRequest=(current.resultsRequest || 0)+1;
  if(current.query.length<2){showSuggestedAdapters(current);return;}
  current.searchTimer=setTimeout(()=>searchAdapters(current,current.query).catch(error=>{if(current===editor&&!current.closed)formError(error);}),350);
 });
 $('#adapter-search-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(current.searchTimer);if(!$('#fields [data-action="adapter-search"]').disabled)searchAdapters(current,e.target.value.trim()).catch(error=>{if(current===editor&&!current.closed)formError(error);});}});
 $('#adapter-mirror').onchange=async e=>{const input=e.target,busy=startButtonBusy(input.nextElementSibling,'保存中');input.disabled=true;try{await api('subscription/adapter',{action:'mirror',enabled:input.checked});message('插件镜像设置已保存');}catch(error){if(current===editor&&!current.closed){input.checked=!input.checked;formError(error);}}finally{busy.finish();input.disabled=false;}};
}
async function openAdapters(section='installed',expected,query=''){
 if(expected&&(expected!==editor || expected.closed))return;
 clearTimeout(editor?.searchTimer);
 const current={type:'adapters',section,query,metadata:{},items:[],adapters:{},resultsRequest:0};editor=current;
 $('#editor-title').textContent='社区供应商插件';$('#fields').innerHTML='<p class="form-hint" role="status">正在读取插件与登录方式…</p>';showEditor();$('#save').hidden=true;
 const [plugins,signins]=await Promise.allSettled([api('subscription/adapters'),api('subscriptions')]);
 if(current!==editor || current.closed)return;
 if(plugins.status==='rejected'){
  $('#fields').innerHTML='<p class="form-hint">社区插件列表未能读取。可以重试，或关闭后重新选择模型来源。</p>'+button('重试读取插件','adapter-retry');
  formError(plugins.reason);return current;
 }
 current.adapters=plugins.value;
 if(signins.status==='fulfilled')current.signins=signins.value;else current.signinError=signins.reason.message;
 showSuggestedAdapters(current,false);renderAdapters(current);
 void loadAdapterMetadata(current);
 if(query.length>=2)await searchAdapters(current,query);
 return current;
}
function showSuggestedAdapters(current,render=true){
 current.discoverySource='suggested';current.resultsRequest++;
 current.items=(current.adapters.available || []).filter(p=>!['agent','middleware'].includes(p.kind)&&[p.name,p.package,...(p.providers || [])].join(' ').toLowerCase().includes((current.query || '').toLowerCase()));
 if(render){$('#adapter-search-results').setAttribute('aria-busy','false');renderAdapterResults(current);}
}
async function loadAdapterMetadata(current){
 const names=[...(current.adapters.available || []).map(p=>p.package),...(current.adapters.installed || []).map(p=>p.id)].filter(n=>/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(n));
 if(!names.length)return;
 try{const r=await api('subscription/adapters/npm?names='+encodeURIComponent([...new Set(names)].slice(0,100).join(',')));if(current!==editor || current.closed)return;current.metadata=r.npm || {};renderAdapterResults(current);}
 catch(error){if(current===editor&&!current.closed)$('#adapter-result-label').textContent+=' · npm 版本信息未能读取';}
}
async function searchAdapters(current,q){
 if(current!==editor || current.closed)return;
 current.query=q;
 if(q.length<2){showSuggestedAdapters(current);if(q)$('#adapter-result-label').textContent+=' · 输入至少两个字符可搜索 npm';return;}
 const request=++current.resultsRequest,busy=startButtonBusy($('#fields [data-action="adapter-search"]'),'搜索中');
 $('#adapter-search-results').setAttribute('aria-busy','true');$('#adapter-result-label').textContent='正在搜索 npm 社区插件…';
 try{const r=await api('subscription/adapters/search?q='+encodeURIComponent(q));if(current!==editor || current.closed || request!==current.resultsRequest)return;current.discoverySource='npm';current.items=r.hits || [];renderAdapterResults(current);}
 catch(error){if(current===editor&&!current.closed&&request===current.resultsRequest){$('#adapter-result-label').textContent='npm 搜索失败；请检查网络或使用已知的可信安装地址。';formError(error);}}
 finally{busy.finish();if(current===editor&&!current.closed&&request===current.resultsRequest)$('#adapter-search-results').setAttribute('aria-busy','false');}
}
async function openAdapterPage(data,current){
 const p=adapterItem(current,data.package),here=adapterInstalled(current,data.package),signins=here?.enabled?adapterSignins(current,here):[];
 const details={type:'adapter-readme',data,back:current};editor=details;
 $('#editor-title').textContent=adapterLabel(p);
 $('#fields').innerHTML=`<div class="actions-bar">${button('返回插件列表','adapter-back','','text-button')}</div><code class="adapter-package">${escape(p.package)}</code><p class="form-hint adapter-trust">${escape(adapterTrust)}</p><p class="caption">${p.publisher?'发布者：'+escape(p.publisher)+' · ':''}${p.version?'版本：'+escape(p.version)+' · ':''}${p.weekly?'每周下载：'+short(p.weekly)+' · ':''}${escape(p.license || '许可证未报告')}</p><div class="external-links">${externalLink(p.repository,'源码仓库')}${externalLink(p.homepage,'插件主页')}</div><div class="actions-bar">${here?signins.map(s=>button('登录 '+s.name,'adapter-signin',s.id,'primary')).join('')+(!here.enabled?button('启用插件','adapter-on',JSON.stringify(data)):''):button('安装此插件','adapter-install',JSON.stringify(data),'primary')}</div><p id="adapter-readme-status" class="form-hint" role="status">正在读取第三方插件说明…</p><pre id="adapter-readme" class="adapter-readme"></pre>`;
 showEditor();$('#save').hidden=true;
 const spec=here?.package || data.package,name=spec.match(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(?=@|$)/i)?.[0] || spec;
 try{const r=await api('subscription/adapters/page?name='+encodeURIComponent(name));if(details!==editor || details.closed)return;$('#adapter-readme').textContent=r.readme || '此插件未提供说明。';$('#adapter-readme-status').textContent=r.updated?'说明更新于 '+dateText(r.updated):'';}
 catch(error){if(details===editor&&!details.closed)$('#adapter-readme-status').textContent='插件说明未能读取：'+error.message;}
}
async function handleAdapterAction(e){
 const b=e.target.closest('[data-action]');if(!b || b.disabled || editor?.adapterPending)return;
 if(b.dataset.action==='manage-adapters'){const busy=startButtonBusy(b,'加载中');try{await openAdapters(b.dataset.id || 'installed',editor);}catch(error){formError(error);}finally{busy.finish();}return;}
 if(!b.dataset.action.startsWith('adapter-'))return;
 const current=editor,base=current.type==='adapter-readme'?current.back:current,action=b.dataset.action.slice(8);
 const data=action==='install-custom'?{package:$('#f-package').value.trim()}:action==='signin'?{}:JSON.parse(b.dataset.id || '{}');
 let progress,busy,changed=false;$('#form-error').hidden=true;
 try{
 if(action==='back'){await openAdapters(base.section,current,base.query);return;}
 if(action==='retry'){await openAdapters(current.section,current,current.query);return;}
  if(action==='discover'){activateEditorSection('discover');return;}
  if(action==='custom-provider'){openProvider();return;}
  if(action==='suggested'){clearTimeout(current.searchTimer);current.query='';$('#adapter-search-query').value='';showSuggestedAdapters(current);return;}
  if(action==='search'){clearTimeout(current.searchTimer);await searchAdapters(current,$('#adapter-search-query').value.trim());return;}
  if(action==='signin'){busy=startButtonBusy(b,'加载中');await openSubscription(b.dataset.id,false,current);return;}
  if(action==='page'){await openAdapterPage(data,current);return;}
  if(action==='github'){
   clearTimeout(current.searchTimer);const request=++current.resultsRequest;busy=startButtonBusy(b,'读取中');$('#adapter-search-results').setAttribute('aria-busy','true');
   const r=await api('subscription/adapters/github');if(current!==editor || current.closed || request!==current.resultsRequest)return;
   current.discoverySource='github';current.items=(r.repos || []).filter(p=>!['agent','middleware'].includes(p.kind)).map(p=>({...p,package:p.spec,name:p.repo,publisher:p.owner,repository:p.url,source:'github'}));renderAdapterResults(current);$('#adapter-search-results').setAttribute('aria-busy','false');return;
  }
  if(action==='options'){
   busy=startButtonBusy(b,'加载中');const r=await api(`subscription/adapter/${encodeURIComponent(data.id)}/options`);if(current!==editor || current.closed)return;
   editor={type:'adapter-options',data};$('#editor-title').textContent='供应商插件配置';const example=!Object.keys(r.options || {}).length&&r.example;
   $('#fields').innerHTML=text('options','认证配置（JSON）',JSON.stringify(example || r.options || {},null,2))+`<p class="form-hint">${example?'以下是插件提供的示例，修改后保存才会使用。':'按插件说明编辑；保存后由该插件使用。'}</p>`;showEditor();return;
  }
  if(action==='check'){
   busy=startButtonBusy(b,'检查中');const r=await api('subscription/adapters/check',{});if(current!==editor || current.closed)return;
   const next=await openAdapters('installed',current);if(!next || next!==editor || next.closed)return;
   const unknown=(r.plugins || []).filter(p=>p.status==='unknown');if(unknown.length){formError(new Error(`部分插件未能检查更新：${unknown.map(p=>`${p.package || p.spec}（${p.error || p.why || '未获取版本'}）`).join('；')}`));return;}
   message(`检查完成：${(r.plugins || []).filter(p=>p.status==='update').length} 个插件有更新`);return;
  }
  if(action==='install-custom'&&!data.package)throw new Error('请填写插件包名、仓库或本地路径。');
  if((action.startsWith('install')||action==='adopt')&&!await ask(action==='adopt'?'使用第三方插件接入订阅？':'安装第三方供应商插件？',data.package+'\n\n'+adapterTrust,'信任并安装'))return;
  if(['remove','move','moveback'].includes(action)&&!await ask(action==='remove'?'移除供应商插件？':action==='move'?'迁移已有订阅？':'恢复内置接入？',action==='remove'?'此插件提供的供应商将暂时不可用；鲸桥配置保留，已迁移的内置账号先恢复内置接入。':action==='move'?data.package+'\n\n已有账号由插件接入，凭据只写入鲸桥。\n\n'+adapterTrust:'账号交回鲸桥内置接入；原客户端登录数据保留。','继续'))return;
  if(current!==editor || current.closed)return;
  if(['install','install-custom','update','update-all','move','moveback','adopt'].includes(action))progress=startAdapterBusy(b,action.startsWith('install')?'downloading':action==='adopt'?'adopting':action.startsWith('move')?'migrating':'updating');
  else busy=startButtonBusy(b,action==='remove'?'移除中':action.startsWith('move')?'迁移中':'保存中');
  changed=true;
  if(action.startsWith('install'))await installAdapter(data,progress);else await api('subscription/adapter',{...data,action});
  if(current!==editor || current.closed)return;
  await load();const next=await openAdapters('installed',current);if(!next || next!==editor || next.closed)return;
  message(({install:'插件已安装；请在列表中登录它提供的订阅。','install-custom':'插件已安装；提供订阅登录方式的插件可在列表中继续登录。',update:'插件已更新','update-all':'插件更新完成',remove:'插件已移除',on:'插件已启用',off:'插件已停用',move:'已有订阅已迁移到插件',moveback:'订阅已恢复内置接入',adopt:'订阅已使用插件接入'})[action]);
 }catch(error){
  if(current!==editor || current.closed)return;
  // An install can persist before handover/sync fails; show the actual installed state.
  if(changed){
   progress?.finish();progress=null;
   try{await load();const refreshed=await openAdapters('installed',current);if(!refreshed||refreshed!==editor||refreshed.closed)return;formError(error);}
   catch(refreshError){if(editor===current&&!current.closed)formError(error.message+'；状态刷新失败：'+refreshError.message);}
  }else if(current===editor&&!current.closed)formError(error);
 }finally{progress?.finish();busy?.finish();if(b.getAttribute('aria-busy')!=='true')b.disabled=false;if(current===editor&&!current.closed&&$('#adapter-search-results'))$('#adapter-search-results').setAttribute('aria-busy','false');}
}
$('#fields').addEventListener('click',handleAdapterAction);
