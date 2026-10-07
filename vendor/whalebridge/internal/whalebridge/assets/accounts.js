// Provider authentication remains Magpie's; this UI never switches another
// client's active account or edits that client's model configuration.
let subscriptions=[];
const subscriptionNames={claude:'Claude',codex:'Codex',copilot:'GitHub Copilot',cursor:'Cursor',grok:'Grok',devin:'Devin',kiro:'Kiro',zcode:'ZCode',workbuddy:'WorkBuddy','workbuddy-ai':'WorkBuddy AI','commandcode-plan':'Command Code',qoder:'Qoder','qoder-cn':'Qoder 中国版',zed:'Zed',factory:'Factory','mimo-app':'小米 MiMo',gemini:'Google Gemini',antigravity:'Google Antigravity'};
async function openSubscription(adapterId=''){
 subscriptions=(await api('subscriptions')).map(s=>({...s,name:s.plugin?s.name:(subscriptionNames[s.id] || s.name)}));editor={type:'subscription'};
 $('#editor-title').textContent='添加订阅账号';
 $('#fields').innerHTML=`<p class="form-hint">将已有订阅连接到鲸屿。请选择你的供应商，再按对应的登录流程完成授权。</p><label for="f-agent">订阅供应商</label><select name="agent" id="f-agent">${subscriptions.map(s=>`<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('')}</select><div id="signin-options"></div><p class="muted">部分订阅需要供应商的认证工具或适配器，登录时会显示准备进度。模型范围和使用额度由供应商决定。</p>`;
 if(adapterId)$('#f-agent').value=subscriptions.find(s=>s.plugin&&s.pid===adapterId)?.id || adapterId;
 $('#f-agent').onchange=subscriptionOptions;subscriptionOptions();showEditor();$('#save').textContent='开始登录';
}
function subscriptionOptions(){
 const s=subscriptions.find(s=>s.id===$('#f-agent').value);if(!s)return;
 $('#signin-options').innerHTML=(s.plugin?`<label for="f-method">登录方式</label><select name="method" id="f-method">${(s.methods || []).map((m,i)=>`<option value="${i}">${escape(m.label)}</option>`).join('')}</select><div id="subscription-key"></div>`:s.id==='zcode'?'<label for="f-site">登录站点</label><select name="site" id="f-site"><option value="">供应商默认</option><option value="zai">Z.ai 全球站</option><option value="bigmodel">智谱中国站</option></select>':'<p class="form-hint">点击「开始登录」后，按供应商页面或认证工具的指引完成授权。</p>')+(s.package?`<p class="muted">此订阅支持社区供应商适配器。</p><div class="subscription-adapter-actions">${button('安装供应商适配器','install-adapter',s.id)}</div>`:'');
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
 const rows=await api(`accounts/${encodeURIComponent(id)}`);editor={type:'accounts',data:{id}};
 $('#editor-title').textContent='订阅账号';
 $('#fields').innerHTML=rows?.length?`<div class="panel">${rows.map(a=>`<div class="row"><div class="text"><div class="title">${escape(a.user)}</div><div class="subtitle">${escape(a.plan)}${a.lapsed?` · ${escape(a.lapsed)}`:''}${a.own?' · 官方客户端账号':''}</div></div><div class="actions">${a.active||a.own?'<span class="tag">已接入</span>':button(a.on?'停用':'启用','account-on',JSON.stringify({id,user:a.user,on:!a.on}))+button('移除','account-remove',JSON.stringify({id,user:a.user}),'danger')}</div></div>`).join('')}</div>`:'<p class="muted">没有已保存的账号。</p>';
 $('#fields').innerHTML+=`<div class="actions-bar">${button(`${icon('plus')}添加账号`,'add-account',id)}</div>`;showEditor();$('#save').hidden=true;
}
async function openKeys(id){
 const rows=await api(`keys/${encodeURIComponent(id)}`);editor={type:'keys',data:{id}};$('#editor-title').textContent='供应商密钥';
 $('#fields').innerHTML=`<div class="panel">${rows.map(k=>`<div class="row"><div class="text"><div class="title">${escape(k.name || k.masked)}</div><div class="subtitle">${escape(k.masked)} · 权重 ${k.weight || 1}</div></div><div class="actions">${k.active?'<span class="tag">主密钥</span>':button(k.on?'停用':'启用','key-on',JSON.stringify({id,ref:k.id,on:!k.on}))+button('移除','key-remove',JSON.stringify({id,ref:k.id}),'danger')}${button('权重','key-weight',JSON.stringify({id,ref:k.id,weight:k.weight || 1}))}</div></div>`).join('')}</div>`+field('name','新密钥名称')+field('key','新 API 密钥','','password')+`<label for="f-protocol">密钥协议</label><select name="protocol" id="f-protocol"><option value="">全部</option><option value="chat">Chat Completions</option><option value="responses">Responses</option><option value="anthropic">Anthropic</option></select>`;showEditor();$('#save').textContent='添加密钥';
}
$('#fields').addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;const{action,id}=b.dataset;
 if(!['signin-callback','install-adapter','add-account','account-on','account-remove','key-on','key-remove','key-weight'].includes(action))return;
 b.disabled=true;
 try{
  if(action==='signin-callback'){await api(`signin/${encodeURIComponent(loginFlow)}/callback`,{url:$('#f-callback').value});return;}
  if(action==='install-adapter'){await api('subscription/adapter',{id});await openSubscription(id);message('供应商适配器已安装');return;}
  if(action==='add-account'){await openSubscription();$('#f-agent').value=id;subscriptionOptions();return;}
  const data=JSON.parse(id);
  if(action==='account-on')await api('accounts/on',data);
  if(action==='account-remove'){if(!await ask('移除订阅账号？','移除这个保存在鲸桥中的账号，不会删除供应商的订阅。','移除账号'))return;await api('accounts/remove',data);}
  if(action==='key-on')await api('keys',{...data,action:'on'});
  if(action==='key-remove'){if(!await ask('移除密钥？','此密钥将不再用于鲸桥请求。如需撤销密钥，请到供应商控制台操作。','移除密钥'))return;await api('keys',{...data,action:'remove'});}
  if(action==='key-weight'){const value=await ask('设置密钥权重','权重越高，在权重路由中分配到的请求越多。请输入正整数。','保存权重',data.weight);if(value===false)return;await api('keys',{...data,action:'weight',weight:value});}
  if(action.startsWith('account-'))await openAccounts(data.id);else await openKeys(data.id);
  await load();
 }catch(e){$('#form-error').textContent=e.message;$('#form-error').hidden=false;}finally{b.disabled=false;}
});
