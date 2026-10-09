// Provider authentication remains Magpie's; this UI never switches another
// client's active account or edits that client's model configuration.
let subscriptions=[];
const subscriptionNames={claude:'Claude',codex:'Codex','chatgpt-api':'ChatGPT API',copilot:'GitHub Copilot',cursor:'Cursor',grok:'Grok',devin:'Devin',kiro:'Kiro',zcode:'ZCode',workbuddy:'WorkBuddy','workbuddy-ai':'WorkBuddy AI','commandcode-plan':'Command Code',qoder:'Qoder','qoder-cn':'Qoder 中国版',zed:'Zed',factory:'Factory','mimo-app':'小米 MiMo',gemini:'Google Gemini',antigravity:'Google Antigravity'};
async function openSubscription(adapterId='', preferAdapter=false){
 subscriptions=(await api('subscriptions')).map(s=>({...s,name:s.plugin?s.name:(subscriptionNames[s.id] || s.name)}));editor={type:'subscription'};
 $('#editor-title').textContent='添加订阅账号';
 $('#fields').innerHTML=`<p class="form-hint">将已有订阅连接到鲸屿。请选择你的供应商，再按对应的登录流程完成授权。</p><label for="f-agent">订阅供应商</label><select name="agent" id="f-agent">${subscriptions.map(s=>`<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('')}</select><div id="signin-options"></div><p class="muted">部分订阅需要供应商的认证工具或适配器，登录时会显示准备进度。模型范围和使用额度由供应商决定。</p>${removedSubscriptions()}`;
 if(adapterId)$('#f-agent').value=preferAdapter?(subscriptions.find(s=>s.plugin&&s.pid===adapterId)?.id || adapterId):adapterId;
 $('#f-agent').onchange=subscriptionOptions;subscriptionOptions();showEditor();$('#save').textContent='开始登录';
}
function removedSubscriptions(){const removed=state.removed || [],row=p=>`<div class="row account-row"><div class="text"><strong>${escape(p.name || p.id)}</strong><p class="caption">已从鲸桥移除 · 凭据保留${p.quiet?' · 已关闭恢复提醒':''}${p.tucked?' · 已从添加列表隐藏':''}</p></div><div class="actions">${button('恢复接入','removed-show',p.id)}${p.tucked?button('在添加列表显示','removed-untuck',p.id):button('从添加列表隐藏','removed-tuck',p.id)}${p.quiet?'':button('关闭恢复提醒','removed-quiet',p.id)}${button('彻底移除鲸桥凭据','removed-forget',p.id,'danger')}</div></div>`;return removed.length?`<details class="advanced"><summary>已移除的订阅（${removed.length}）</summary><div class="advanced-body"><p class="form-hint">恢复后保留先前模型和账号设置，无需重新授权。</p><div class="panel">${removed.filter(p=>!p.tucked).map(row).join('') || '<p class="empty-inline">所有已移除订阅均已隐藏。</p>'}</div>${removed.some(p=>p.tucked)?`<details class="advanced"><summary>查看隐藏的订阅</summary><div class="panel">${removed.filter(p=>p.tucked).map(row).join('')}</div></details>`:''}</div></details>`:'';}
function subscriptionOptions(){
 const s=subscriptions.find(s=>s.id===$('#f-agent').value);if(!s)return;
 $('#signin-options').innerHTML=(s.plugin?`<label for="f-method">登录方式</label><select name="method" id="f-method">${(s.methods || []).map((m,i)=>`<option value="${i}">${escape(m.label)}</option>`).join('')}</select><div id="subscription-key"></div>`:s.id==='zcode'?'<label for="f-site">登录站点</label><select name="site" id="f-site"><option value="">供应商默认</option><option value="zai">Z.ai 全球站</option><option value="bigmodel">智谱中国站</option></select>':s.id==='copilot'?field('site','GitHub Enterprise Cloud 登录域名','','text','可选，例如 company.ghe.com；留空使用 github.com')+'<p class="form-hint">仅具有数据驻留要求的 GHE.com 企业账号需要填写。</p>':'<p class="form-hint">点击「开始登录」后，按供应商页面或认证工具的指引完成授权。</p>')+(s.package?`<p class="muted">此订阅支持社区供应商适配器。</p><div class="subscription-adapter-actions">${button('安装供应商适配器','install-adapter',s.id)}</div>`:'')+(['codex','claude','gemini','antigravity','factory'].includes(s.id)?`<div class="actions-bar">${button('导入已有账号凭据','auth-import',s.id)}</div>`:'');
 if(s.riskNote)$('#signin-options').innerHTML+= '<p class="form-hint">'+escape(s.riskNote)+'</p>';
 if(s.plugin){$('#f-method').onchange=subscriptionKey;subscriptionKey();}
}
function subscriptionKey(){
 const s=subscriptions.find(s=>s.id===$('#f-agent').value),method=s.methods?.[Number($('#f-method').value)];
 $('#subscription-key').innerHTML=method?.type==='api'?field('key','API 登录密钥','','password',method.placeholder || '填写供应商密钥'):'';
 if($('#f-key'))$('#f-key').required=true;
}
async function beginSubscription(data){
 const current=editor;
 current.request ||= data;
 const request=current.request, s=subscriptions.find(s=>s.id===request.agent);
 current.inputs ||= {};
 if(s.plugin){
  const result=await api('subscription/prompt',{id:s.pid || s.id,method:Number(request.method || 0),inputs:current.inputs,...(current.prompt?{key:current.prompt.key,value:data.answer}:{})});
  if(current!==editor || current.closed)return;
  if(result.error)throw new Error(result.error);
  current.inputs=result.inputs;
  const question=result.prompt;current.prompt=question;
  if(question){$('#fields').innerHTML=`<p class="muted">${escape(s.name)}</p>`+(question.type==='select'?`<label for="f-answer">${escape(question.message)}</label><select id="f-answer" name="answer">${(question.options || []).map(o=>`<option value="${escape(o.value)}">${escape(o.label)}</option>`).join('')}</select>`:field('answer',escape(question.message),'','text',question.placeholder || ''));$('#save').textContent='继续';return;}
 }
 const st=await api('signin',{agent:s.pid || request.agent,site:request.site,plugin:s.plugin,method:Number(request.method || 0),key:request.key,inputs:current.inputs});
 if(current!==editor || current.closed){if(st.id)await api(`signin/${encodeURIComponent(st.id)}/cancel`,{});return;}
 if(st.state==='done'){await completeSubscription(st);return;}
 loginFlow=st.id;showLogin(st);pollLogin();
}
async function completeSubscription(st){
 const s=subscriptions.find(s=>s.id===editor.request.agent);
 await showConnectionSuccess(st.again?'订阅账号授权已更新':'订阅账号接入成功',`${s.name} ${st.again?'登录授权已更新':'订阅账号已添加'}，模型已同步到鲸屿。`,{name:s.name,user:st.user,kind:'订阅账号',updated:st.again});
}
function showLogin(st){
 $('#save').hidden=true;$('#fields').innerHTML=`<div class="login-progress"><p>${escape(st.state==='installing'?`正在准备认证工具 ${st.installing || ''}`:'等待供应商登录完成')}</p>${st.instructions?`<p class="muted">${escape(st.instructions)}</p>`:''}${st.url&&/^https?:\/\//.test(st.url)?`<p><a href="${escape(st.url)}" target="_blank" rel="noreferrer">打开供应商登录页面 ↗</a></p>`:''}${st.code?`<p>验证码：<code>${escape(st.code)}</code></p>`:''}</div>${st.pasteCallback||st.pasteCode||st.pasteKey?field('callback','完成登录后粘贴回调地址、验证码或密钥')+`<div class="actions-bar">${button('提交','signin-callback')}</div>`:''}<p class="muted">关闭对话框会取消尚未完成的登录。</p>`;
}
function pollLogin(){
 clearTimeout(loginTimer);const id=loginFlow;if(!id)return;
 loginTimer=setTimeout(async()=>{
  try{const st=await api(`signin/${encodeURIComponent(id)}`);if(loginFlow!==id)return;
   if(st.state==='done'){await completeSubscription(st);return;}
   if(st.state==='failed'||st.state==='canceled'){loginFlow=null;$('#form-error').textContent=st.error || '登录已取消';$('#form-error').hidden=false;return;}
   // Do not replace an input while the user is pasting a callback.
   if(!$('#f-callback') || st.url!==$('#fields a')?.getAttribute('href'))showLogin(st);
   pollLogin();
  }catch(e){loginFlow=null;$('#form-error').textContent=e.message;$('#form-error').hidden=false;}
 },1500);
}
$('#editor').addEventListener('close',()=>{if(editor)editor.closed=true;clearTimeout(loginTimer);if(loginFlow){const id=loginFlow;loginFlow=null;api(`signin/${encodeURIComponent(id)}/cancel`,{}).catch(e=>message(e.message));}});

async function openAccounts(id){
 const rows=await api('accounts/'+encodeURIComponent(id)),p=state.providers.find(p=>p.id===id);
 editor={type:'accounts',data:{id},rows};const current=editor;
 $('#editor-title').textContent=(p?.name || '订阅')+' · 账号管理';
 const actions=button(icon('plus')+' 添加账号','add-account',id)+(['codex','claude','gemini','antigravity','factory'].includes(id)?button('导入账号','auth-import',id):'')+button('查看完整额度','accounts-quota',id);
 $('#fields').innerHTML='<section class="editor-section" data-section="accounts" data-title="账号"><div class="toolbar">'+actions+'</div><p class="form-hint">共 '+rows.length+' 个账号。优先顺序仅影响鲸桥；移除借用账号会停止在鲸桥使用，原客户端保持登录。</p><div class="management-table-wrap"><table class="management-table"><thead><tr><th>账号与套餐</th><th>状态与额度</th><th>路由设置</th><th>操作</th></tr></thead><tbody>'+rows.map((a,i)=>{
 const ref=JSON.stringify({id,user:a.user}),on=!a.paused&&(a.active||a.on),single=id==='cursor';
 return '<tr><td><div class="table-primary">'+escape(a.user)+'</div><div class="table-meta">'+escape(a.plan || '套餐未报告')+(a.own?' · 借用客户端登录':' · 鲸桥保存授权')+'</div></td><td><span class="status-badge">'+(on?'已启用':'已停用')+'</span>'+(i===0?'<span class="status-badge">优先使用</span>':'')+(a.lapsed?'<p class="inline-error">'+escape(a.lapsed)+'</p>':'')+'<p class="table-meta" data-account-quota="'+escape(a.user)+'">正在读取额度</p></td><td>'+accountSummary(p,a.user)+'</td><td><div class="actions">'+button('设置','account-edit',ref)+button(on?'停用':'启用','account-on',JSON.stringify({id,user:a.user,on:!on}))+(i&&!single?button('优先使用','account-first',ref):'')+button('重新登录','account-relogin',id)+button('移除','account-remove',ref,'danger')+'</div><div class="actions">'+(i&&!single?button('向前','account-up',ref,'text-button'):'')+(i<rows.length-1&&!single?button('向后','account-down',ref,'text-button'):'')+'</div></td></tr>';
 }).join('')+'</tbody></table></div>'+(!rows.length?'<p class="empty-inline">尚未保存账号。添加或导入已有订阅授权后即可使用。</p>':'')+'</section>';
 showEditor();$('#save').hidden=true;
 api('accounts/'+encodeURIComponent(id)+'/usage').then(qs=>{
  if(current!==editor||current.closed)return;
  for(const node of $('#fields').querySelectorAll('[data-account-quota]')){
   const q=Object.values(qs || {}).find(q=>String(q.user).toLowerCase()===node.dataset.accountQuota.toLowerCase());
   node.textContent=q?quotaAccountText(q):'供应商未报告此账号额度';
  }
 }).catch(e=>{if(current===editor&&!current.closed)for(const node of $('#fields').querySelectorAll('[data-account-quota]'))node.textContent='额度读取失败：'+e.message;});
}
function quotaAccountText(q){
 if(q.error)return q.error;
 return [q.balance,...(q.windows || []).map(w=>w.name+'：'+(w.unlimited?'不限':w.display || (100-Number(w.used)).toFixed(1)+'% 剩余')),q.asOf?'显示上次成功读取':'' ].filter(Boolean).join(' · ') || '供应商未报告额度';
}
async function openKeys(id){
 const rows=await api('keys/'+encodeURIComponent(id)),p=state.providers.find(p=>p.id===id);
 editor={type:'keys',data:{id},rows,expanded:localStorage.getItem('whalebridge.keys.expanded.'+id)==='1'};$('#editor-title').textContent=(p?.name || '供应商')+' · 密钥管理';
 $('#fields').innerHTML='<section class="editor-section" data-section="keys" data-title="现有密钥"><div class="toolbar">'+button('批量导入密钥','key-import',id)+(rows.length?button('移除已选密钥','key-remove-selected',id,'danger'):'')+'</div><div class="toolbar">'+field('keySearch','查找密钥','','search','名称、脱敏密钥或协议')+selectField('keyStatus','密钥状态',[['all','全部状态'],['usable','可请求'],['rest','请求暂停'],['off','已停用']],'all')+button('展开全部密钥','key-fold',id,'text-button')+'</div><p id="key-filter-count" class="form-hint" aria-live="polite"></p><div class="management-table-wrap"><table class="management-table"><thead><tr><th>选择</th><th>名称与密钥</th><th>状态与协议</th><th>路由设置</th><th>操作</th></tr></thead><tbody>'+rows.map((k,i)=>{
 const ref=JSON.stringify({id,ref:k.id});
 return '<tr data-key-row="'+i+'"><td><input type="checkbox" data-key-pick="'+escape(k.id)+'" aria-label="选择 '+escape(k.name || k.masked)+'"></td><td><div class="table-primary">'+escape(k.name || '未命名密钥')+'</div><div class="table-meta">'+escape(k.masked)+'</div></td><td><span class="status-badge">'+(k.active?'主密钥':k.on?'已启用':'已停用')+'</span><div class="table-meta">'+escape(protocolName(k.protocol))+'</div>'+(k.rest?'<p class="inline-error">'+escape(k.rest.why)+(k.rest.status?' · HTTP '+k.rest.status:'')+' · 暂停到 '+escape(dateText(k.rest.until))+'</p>'+(k.rest.key?button('恢复请求','gateway-unrest',JSON.stringify({id,key:k.rest.key})):'' ):'')+'</td><td><div class="table-meta">权重 '+(k.weight || 1)+'</div>'+accountSummary(p,k.id)+'</td><td><div class="actions">'+button('设置','key-edit',ref)+(k.active?'':button('设为主密钥','key-use',ref)+button(k.on?'停用':'启用','key-on',JSON.stringify({id,ref:k.id,on:!k.on})))+button('移除','key-remove',ref,'danger')+'</div><div class="actions">'+(i?button('向前','key-up',ref,'text-button'):'')+(i<rows.length-1?button('向后','key-down',ref,'text-button'):'')+'</div></td></tr>';
 }).join('')+'</tbody></table></div><p id="key-filter-empty" class="empty-inline" hidden>没有符合条件的密钥。</p>'+(!rows.length?'<p class="empty-inline">尚未添加 API 密钥。</p>':'')+'</section><section class="editor-section" data-section="new-key" data-title="添加密钥"><h3>添加 API 密钥</h3>'+field('name','名称')+field('key','API 密钥','','password')+selectField('protocol','协议',protocolOptions,'')+'</section>';
 showEditor();$('#save').textContent='添加密钥';$('#f-key').required=true;syncKeyList();
}
function syncKeyList(){
 if(editor?.type!=='keys')return;
 const query=$('#f-keySearch').value.trim().toLowerCase(),status=$('#f-keyStatus').value;
 const matches=editor.rows.map((k,i)=>({k,i})).filter(({k})=>[k.name,k.masked,k.protocol,protocolName(k.protocol)].filter(Boolean).join(' ').toLowerCase().includes(query)&&(status==='all'||status==='usable'&&k.on&&!k.rest||status==='rest'&&!!k.rest||status==='off'&&!k.on));
 const visible=new Set((editor.expanded?matches:matches.slice(0,5)).map(({i})=>i));
 for(const row of $('#fields').querySelectorAll('[data-key-row]')){row.hidden=!visible.has(Number(row.dataset.keyRow));if(row.hidden)row.querySelector('[data-key-pick]').checked=false;}
 const fold=$('#fields').querySelector('[data-action="key-fold"]');fold.hidden=matches.length<=5;fold.textContent=editor.expanded?'折叠密钥':`展开全部 ${matches.length} 个密钥`;fold.setAttribute('aria-expanded',String(editor.expanded));
 $('#key-filter-count').textContent=`显示 ${visible.size} / ${matches.length} 个匹配密钥，共 ${editor.rows.length} 个`;
 $('#key-filter-empty').hidden=matches.length>0||editor.rows.length===0;
}
const protocolOptions=[['','全部协议'],['chat','Chat Completions'],['responses','Responses'],['anthropic','Anthropic Messages']];
const protocolName=id=>protocolOptions.find(([v])=>v===id)?.[1] || id || '全部协议';
const accountMap=(p,key,ref)=>p?.[key]?.[String(ref).toLowerCase()];
function accountSummary(p,ref){const allow=accountMap(p,'accountModels',ref),cap=accountMap(p,'accountCaps',ref),limit=accountMap(p,'accountConcurrency',ref);return escape(`${allow?.length?`${allow.length} 个指定模型`:'全部供应商模型'}${cap?` · 额度上限 ${cap}%`:''}${limit===undefined?'':` · 并发 ${limit || '不限'}`}${accountMap(p,'accountProxies',ref)?' · 独立代理':''}`);}
function accountModelFields(p,ref){return text('allow','此账号 / 密钥允许的模型',(accountMap(p,'accountModels',ref) || []).join('\n'),'留空使用供应商的全部模型；每行一个 ID')+`<details class="advanced"><summary>从供应商模型中选择</summary><div class="checks">${availableModels(p).map(m=>button(escape(m.name || m.id),'pick-account-model',m.id)).join('')}</div></details>`+integerField('limit','此账号 / 密钥最大并发',accountMap(p,'accountConcurrency',ref) ?? '',0,null,'留空跟随供应商；0 为不限');}
function openKeyEdit(id,ref){const p=state.providers.find(p=>p.id===id),k=editor.rows.find(k=>k.id===ref);editor={type:'key-edit',data:{id,ref},key:k};$('#editor-title').textContent='密钥设置';$('#fields').innerHTML='<section class="editor-section" data-section="key-basic" data-title="基本设置">'+field('name','名称',k.name || '')+selectField('protocol','密钥协议',protocolOptions,k.protocol || '')+integerField('weight','路由权重',k.weight || 1,1,null)+'</section><section class="editor-section" data-section="key-routing" data-title="模型与并发">'+accountModelFields(p,ref)+'</section>';showEditor();syncAccountModelChoices();}
function openAccountEdit(id,user){const p=state.providers.find(p=>p.id===id);editor={type:'account-edit',data:{id,user}};const current=editor;$('#editor-title').textContent='订阅账号设置';$('#fields').innerHTML='<p class="form-hint">'+escape(p.name)+' · '+escape(user)+'</p><section class="editor-section" data-section="account-models" data-title="模型与额度">'+accountModelFields(p,user)+integerField('cap','额度使用上限（%）',accountMap(p,'accountCaps',user) || '',1,99,'留空为不限；如 90 表示使用到每个窗口的 90% 后切换')+'</section><section class="editor-section" data-section="account-proxy" data-title="代理与项目">'+proxyFields(accountMap(p,'accountProxies',user) || '').replace('跟随全局代理','跟随供应商代理')+(['gemini','antigravity'].includes(id)?field('project','Google Cloud project ID','','text','留空保持当前 Cloud project'):'')+'</section>';$('#f-proxyMode').onchange=e=>{$('#proxy-address').hidden=e.target.value!=='custom';$('#f-proxy').required=e.target.value==='custom';};showEditor();syncAccountModelChoices();if($('#f-project'))api(`accounts/${encodeURIComponent(id)}/project?user=${encodeURIComponent(user)}`).then(r=>{if(current===editor&&!current.closed)$('#f-project').value=r.project || '';}).catch(e=>{if(current===editor&&!current.closed)formError(e);});}
function syncAccountModelChoices(){const allow=new Set(lines($('#f-allow')?.value || ''));for(const b of $('#fields').querySelectorAll('[data-action="pick-account-model"]'))b.setAttribute('aria-pressed',String(allow.has(b.dataset.id)));}
function openKeyImport(id){editor={type:'key-import',data:{id}};$('#editor-title').textContent='批量导入密钥';$('#fields').innerHTML=text('key','API 密钥','','每行一个，也可使用逗号或空格分隔')+selectField('protocol','密钥协议',protocolOptions,'')+'<p class="form-hint">已有密钥保持原设置；重复项会跳过。</p>';showEditor();$('#f-key').required=true;$('#save').textContent='导入密钥';}
function openAuthImport(id){editor={type:'auth-import',data:{id},files:[]};$('#editor-title').textContent='导入订阅账号';$('#fields').innerHTML=`<p class="form-hint">${escape(subscriptionNames[id] || id)} · 导入你导出的账号凭据，先由供应商验证，再保存在鲸桥。</p>${['codex','claude'].includes(id)?'<p class="inline-error">导入时会向供应商刷新登录授权，消耗来源文件的 refresh token。来源工具需要重新登录后才能继续使用该账号。</p>':''}<label class="file-button">选择凭据文件<input id="auth-files" type="file" accept=".json,.txt" multiple></label><p id="auth-file-names" class="form-hint"></p>`+text('source','或粘贴一个凭据文件的内容','','auth.json、账号导出 JSON；Factory 可以直接粘贴 fk- API 密钥');showEditor();$('#save').textContent='验证并导入';$('#auth-files').onchange=async e=>{const current=editor,files=Array.from(e.target.files);current.files=await Promise.all(files.map(f=>f.text()));if(current===editor)$('#auth-file-names').textContent=files.map(f=>f.name).join('、');};}
async function saveAccountEditor(data,current){const{id,ref,user}=current.data;
 if(current.type==='adapter-options'){let options;try{options=JSON.parse(data.options);}catch{throw new Error('适配器选项必须是有效的 JSON');}if(!options||Array.isArray(options)||typeof options!=='object')throw new Error('适配器选项必须是 JSON 对象');await api('subscription/adapter',{...current.data,action:'options',options});if(current!==editor||current.closed)return;await load();await openAdapters();message('供应商适配器配置已保存');return;}
 if(current.type==='key-import'){const r=await api('keys',{id,action:'import',key:data.key,protocol:data.protocol});if(current!==editor||current.closed)return;await load();await openKeys(id);message(`密钥导入完成${r.added!==undefined?`：新增 ${r.added}，已有 ${r.had || 0}`:''}`);return;}
 if(current.type==='auth-import'){const files=[...current.files,...(data.source.trim()?[data.source]:[])];if(!files.length)throw new Error('请先选择凭据文件或粘贴内容');const r=await api('accounts/import',{id,agent:id,files});if(current!==editor||current.closed)return;await load();editor={type:'import-result',data:{id}};$('#editor-title').textContent='账号导入结果';$('#fields').innerHTML=`<div class="panel">${(r.results || []).map(a=>`<div class="row"><div class="text"><strong>${escape(a.user || a.name || '账号')}</strong><p class="${a.error?'inline-error':'caption'}">${escape(a.error || ({added:'已添加',updated:'已更新授权',exists:'已存在',failed:'验证失败'})[a.status] || a.status || '已验证')}</p></div></div>`).join('')}</div><div class="actions-bar">${button('继续添加账号','add-account',id)}</div>`;showEditor();$('#save').hidden=true;return;}
 const applied=[];try{
  if(current.type==='key-edit'){for(const [action,values,label] of [['rename',{name:data.name},'名称'],['protocol',{protocol:data.protocol},'协议'],['weight',{weight:Number(data.weight)},'权重'],['models',{allow:lines(data.allow)},'模型范围'],['concurrency',{limit:data.limit===''?null:Number(data.limit)},'并发']]){await api('keys',{id,ref,action,...values});applied.push(label);}}
  if(current.type==='account-edit'){for(const [action,values,label] of [['models',{allow:lines(data.allow)},'模型范围'],['cap',{cap:Number(data.cap || 0)},'额度上限'],['concurrency',{limit:data.limit===''?null:Number(data.limit)},'并发'],['proxy',{proxy:data.proxyMode==='direct'?'direct':data.proxyMode==='custom'?data.proxy:''},'代理']]){await api(`accounts/${action}`,{id,user,...values});applied.push(label);}if(data.project!==undefined){await api('accounts/project',{id,user,project:data.project});applied.push('Cloud project');}}
 }catch(error){throw new Error(`${applied.length?`已保存${applied.join('、')}；其余设置未完成。`:''}${error.message}`);}
 if(current!==editor||current.closed)return;await load();if(current.type==='key-edit')await openKeys(id);else await openAccounts(id);message('设置已保存，已同步到鲸屿');
}
$('#fields').addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;const{action,id}=b.dataset;
 if(!['signin-callback','install-adapter','add-account','account-on','account-remove','account-edit','account-first','account-up','account-down','account-relogin','accounts-quota','auth-import','key-on','key-remove','key-weight','key-edit','key-import','key-use','key-up','key-down','key-remove-selected','key-fold','pick-account-model','gateway-unrest','removed-show','removed-quiet','removed-tuck','removed-untuck','removed-forget'].includes(action))return;
 b.disabled=true;
 try{
  if(action==='key-fold'){editor.expanded=!editor.expanded;localStorage.setItem('whalebridge.keys.expanded.'+id,editor.expanded?'1':'0');syncKeyList();return;}
  if(action==='signin-callback'){await api(`signin/${encodeURIComponent(loginFlow)}/callback`,{url:$('#f-callback').value});return;}
  if(action==='install-adapter'){await api('subscription/adapter',{id});await openSubscription(id,true);message('供应商适配器已安装');return;}
  if(action==='add-account'||action==='account-relogin'){await openSubscription(id);return;}
  if(action==='accounts-quota'){$('#editor').close();await go('usage');return;}
  if(action==='auth-import'){openAuthImport(id);return;}
  if(action==='key-import'){openKeyImport(id);return;}
  if(action==='pick-account-model'){const allow=new Set(lines($('#f-allow').value));if(allow.has(id))allow.delete(id);else allow.add(id);$('#f-allow').value=[...allow].join('\n');syncAccountModelChoices();return;}
  if(action.startsWith('removed-')){if(action==='removed-forget'&&!await ask('彻底移除鲸桥保存的订阅凭据？','鲸桥保存的授权将被删除，重新接入时需要登录。借用其他客户端的登录仍在原客户端保留。','彻底移除'))return;await api(`provider/${action.slice(8)}`,{id});await load();await openSubscription();message(action==='removed-show'?'订阅已恢复，模型已同步':'已移除订阅的设置已更新');return;}
  if(action==='gateway-unrest'){const data=JSON.parse(id),r=await api('gateway/unrest',{key:data.key});message(r.lifted?'已恢复此密钥的请求':'此密钥已不在暂停状态');await load();await openKeys(data.id);return;}
  if(action==='key-remove-selected'){const refs=[...$('#fields').querySelectorAll('[data-key-pick]:checked')].map(c=>c.dataset.keyPick);if(!refs.length)throw new Error('请先选择要移除的密钥');if(!await ask('移除已选密钥？',`将从鲸桥移除 ${refs.length} 个密钥。供应商控制台中的密钥不受影响。`,'移除密钥'))return;await api('keys',{id,action:'remove-many',refs});await load();await openKeys(id);return;}
  const data=JSON.parse(id);
  if(action==='key-edit'){openKeyEdit(data.id,data.ref);return;}
  if(action==='account-edit'){openAccountEdit(data.id,data.user);return;}
  if(action==='account-on')await api('accounts/on',data);
  if(action==='account-remove'){if(!await ask('移除订阅账号？','移除这个保存在鲸桥中的账号，不会删除供应商的订阅。','移除账号'))return;await api('accounts/remove',data);}
  if(['account-first','account-up','account-down'].includes(action)){const order=editor.rows.map(a=>a.user),at=order.indexOf(data.user),to=action==='account-first'?0:at+(action==='account-up'?-1:1);if(at<0||to<0||to>=order.length)return;order.splice(at,1);order.splice(to,0,data.user);await api('accounts/order',{id:data.id,order});}
  if(action==='key-on')await api('keys',{...data,action:'on'});
  if(action==='key-use')await api('keys',{...data,action:'use'});
  if(action==='key-up'||action==='key-down'){const order=editor.rows.map(k=>k.id),at=order.indexOf(data.ref),to=at+(action==='key-up'?-1:1);if(at<0||to<0||to>=order.length)return;[order[at],order[to]]=[order[to],order[at]];await api('keys',{id:data.id,action:'arrange',order});}
  if(action==='key-remove'){if(!await ask('移除密钥？','此密钥将不再用于鲸桥请求。如需撤销密钥，请到供应商控制台操作。','移除密钥'))return;await api('keys',{...data,action:'remove'});}
  if(action==='key-weight'){const value=await ask('设置密钥权重','权重越高，在权重路由中分配到的请求越多。请输入正整数。','保存权重',data.weight);if(value===false)return;await api('keys',{...data,action:'weight',weight:value});}
  await load();
  if(action.startsWith('account-'))await openAccounts(data.id);else await openKeys(data.id);
 }catch(e){formError(e);}finally{b.disabled=false;}
});
$('#fields').addEventListener('input',e=>{if(e.target.id==='f-allow')syncAccountModelChoices();if(e.target.id==='f-keySearch')syncKeyList();});
$('#fields').addEventListener('change',e=>{if(e.target.id==='f-keyStatus')syncKeyList();});
