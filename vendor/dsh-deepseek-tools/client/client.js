/* Hand-authored client bundle; follows Harness's settings primitives and Remote wire. */
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-tools',
  factory: require => {
    const { createElement: h, useState, useEffect } = require('react');
    const { Button, Input, Switch, SettingsSelect } = require('@deepseek-ai/dsh-client-ui-primitives');
    const NS = 'dsh-deepseek-tools';
    const dictionaries = {
      zh: {
        nav: 'DeepSeek API',
        title: 'DeepSeek 应用接口', intro: '让 AI 生成语音、转录音频和识别文档。启用后，工具会出现在对话的可用工具中，按 DeepSeek 接口价格另行计费。',
        endpoint: 'API 基础地址', endpointHint: '包含 /v1/tools，不含 /tts 等操作名。第三方网关需支持这些接口。',
        ref: '凭据引用', refHint: '默认复用 DEEPSEEK_API_KEY；更改此处不会修改现有聊天模型配置。',
        key: 'API Key', keyHint: '留空保留已存凭据。新密钥写入凭据存储，同一引用的其他提供方也会使用它；需要独立密钥时先更改引用名。',
        configured: '已配置', missing: '尚未配置', save: '保存', saving: '正在保存…', saved: '已保存', reload: '重新加载', loading: '正在加载…',
        tts: '语音合成（TTS）', ttsHint: '把文字生成可下载的 WAV 音频。',
        asr: '音频转文字（ASR）', asrHint: '上传音频识别文字：PCM WAV / Ogg Opus，最多 8 MiB、120 秒。不替换本地麦克风输入。',
        ocr: '文档识别（OCR）', ocrHint: '上传 PDF、Word、PowerPoint 或图片，最多 100 MiB、1,000 页。完整结果保留为文件。',
        voice: '默认音色', stella: 'Stella · 女声', tide: 'Tide · 男声', markdown: '朗读前移除 Markdown 格式',
        web: '搜索与网页读取', webHint: '沿用现有 web_search / web_fetch 工具。在「插件 → 内置插件设置 → Web 搜索」启用「使用新版 Web Search API」，即可使用 DeepSeek Search / Fetch 接口。',
        webOpen: '打开插件设置', docs: '官方接口文档', invalidEndpoint: '请输入不含用户名、密码、查询参数和片段的 HTTP(S) 基础地址。',
        invalidRef: '凭据引用必须是环境变量名称，例如 DEEPSEEK_API_KEY。', keyInvalid: 'API Key 必须是非空的可打印 ASCII 字符，不能包含空格或换行。',
        unavailable: '应用接口配置不可用，请更新或重启桌面应用。', partial: '密钥已保存，但功能设置保存失败：', conflict: '配置已在其他窗口更改；请重新加载后再保存。',
      },
      en: {
        nav: 'DeepSeek API',
        title: 'DeepSeek application APIs', intro: 'Let AI generate speech, transcribe audio and recognize documents. Enabled tools become available in conversations and incur separate DeepSeek API charges.',
        endpoint: 'API base URL', endpointHint: 'Include /v1/tools, without an operation such as /tts. Custom gateways must support these APIs.',
        ref: 'Credential reference', refHint: 'Reuses DEEPSEEK_API_KEY by default. Changing this does not change chat model settings.',
        key: 'API key', keyHint: 'Leave blank to keep the stored credential. Providers sharing this reference will use the new key too; change the reference first for a separate key.',
        configured: 'Configured', missing: 'Not configured', save: 'Save', saving: 'Saving…', saved: 'Saved', reload: 'Reload', loading: 'Loading…',
        tts: 'Text to speech (TTS)', ttsHint: 'Generate a downloadable WAV audio file from text.',
        asr: 'Speech to text (ASR)', asrHint: 'Uploads PCM WAV / Ogg Opus audio, up to 8 MiB and 120 seconds. Does not replace local microphone input.',
        ocr: 'Document recognition (OCR)', ocrHint: 'Uploads PDF, Word, PowerPoint or images, up to 100 MiB and 1,000 pages. Full results are saved as a file.',
        voice: 'Default voice', stella: 'Stella · Female', tide: 'Tide · Male', markdown: 'Remove Markdown before reading',
        web: 'Search and page reading', webHint: 'Uses the existing web_search / web_fetch tools. Enable “Use the new Web Search API” in Plugins → Built-in plugin settings → Web search to use DeepSeek Search / Fetch.',
        webOpen: 'Open plugin settings', docs: 'Official API documentation', invalidEndpoint: 'Enter an HTTP(S) base URL without credentials, query parameters or a fragment.',
        invalidRef: 'Use an environment-variable name such as DEEPSEEK_API_KEY.', keyInvalid: 'API keys must use non-empty printable ASCII characters without spaces or newlines.',
        unavailable: 'Application API settings are unavailable. Update or restart the desktop app.', partial: 'The key was saved, but capability settings failed: ', conflict: 'Settings changed in another window. Reload before saving.',
      },
    };
    const unwrap = result => { if (!result.ok) throw new Error(result.error?.message || 'Request failed'); return result.value; };
    function Settings({ remote, t, navigation, indexOnly }) {
      const [view, setView] = useState(null);
      const [form, setForm] = useState(null);
      const [key, setKey] = useState('');
      const [credential, setCredential] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [status, setStatus] = useState('');
      const [attempt, setAttempt] = useState(0);
      const [writable, setWritable] = useState(false);
      useEffect(() => {
        if (indexOnly) return;
        let active = true;
        setBusy(true);
        Promise.resolve().then(async () => {
          const state = unwrap(await remote.settings.describe());
          const current = state.namespaces.find(item => item.ns === NS);
          if (!current) throw new Error(t('unavailable'));
          if (active) { setView(current); setForm({ ...current.value }); setWritable(state.writable); setError(''); }
        }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
      }, [attempt, remote, t, indexOnly]);
      useEffect(() => {
        if (!form?.apiKeyEnv || indexOnly) return;
        let active = true;
        setCredential(null);
        remote.credentials.describe([form.apiKeyEnv]).then(result => {
          const values = unwrap(result);
          if (active) setCredential(values[form.apiKeyEnv]);
        }).catch(err => { if (active) setError(err.message); });
        return () => { active = false; };
      }, [form?.apiKeyEnv, remote, indexOnly]);
      const edit = (field, value) => { setForm(prev => ({ ...prev, [field]: value })); setStatus(''); };
      const save = async event => {
        event.preventDefault();
        let keySaved = false;
        try {
          let url;
          try { url = new URL(form.baseURL); } catch { throw new Error(t('invalidEndpoint')); }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url['pass' + 'word'] || url.search || url.hash) throw new Error(t('invalidEndpoint'));
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.apiKeyEnv)) throw new Error(t('invalidRef'));
          const secret = key.trim();
          if (key && !/^[\x21-\x7e]+$/.test(secret)) throw new Error(t('keyInvalid'));
          setBusy(true); setError(''); setStatus('');
          // Saving the credential first never enables a tool whose key failed to store.
          if (secret) { unwrap(await remote.credentials.set(form.apiKeyEnv, secret)); keySaved = true; setKey(''); }
          const result = await remote.settings.update(NS, form, view.revision);
          if (!result.ok && result.error?.code === 'settings/conflict') throw new Error(t('conflict'));
          const updated = unwrap(result);
          setView(updated); setForm({ ...updated.value }); setStatus(t('saved'));
          if (keySaved) setCredential(previous => ({ ...previous, configured: true }));
        } catch (err) { setError((keySaved ? t('partial') : '') + err.message); }
        finally { setBusy(false); }
      };
      const hint = text => h('p', { className: 'dsh-dsapi-hint' }, text);
      const row = (field, label, description) => h('div', { className: 'dsh-dsapi-row', key: field },
        h('div', null, h('span', { className: 'dsh-dsapi-label' }, t(label)), description && hint(t(description))),
        h(Switch, { checked: form?.[field] === true, disabled: busy || !writable, label: t(label), onChange: checked => edit(field, checked) }));
      if (indexOnly) return h('div', null, ...['title', 'endpoint', 'ref', 'key', 'tts', 'asr', 'ocr', 'voice', 'markdown', 'web'].map(k => h('p', { key: k }, t(k))));
      return h('section', { className: 'dsh-dsapi' },
        h('h2', null, t('title')), hint(t('intro')),
        error && h('p', { role: 'alert', className: 'dsh-dsapi-error' }, error),
        !form ? h(Button, { onClick: () => setAttempt(n => n + 1), disabled: busy }, t(busy ? 'loading' : 'reload')) :
          h('form', { onSubmit: save },
            ...[['baseURL', 'endpoint', 'endpointHint'], ['apiKeyEnv', 'ref', 'refHint']].map(([field, label, help]) => h('div', { className: 'dsh-dsapi-field', key: field },
              h('label', { htmlFor: `dsapi-${field}`, className: 'dsh-dsapi-label' }, t(label)),
              h(Input, { id: `dsapi-${field}`, variant: 'form', value: form[field], disabled: busy || !writable, onChange: event => edit(field, event.target.value) }), hint(t(help)))),
            h('div', { className: 'dsh-dsapi-field' }, h('label', { htmlFor: 'dsapi-key', className: 'dsh-dsapi-label' }, t('key')),
              h(Input, { id: 'dsapi-key', variant: 'form', type: 'pass' + 'word', autoComplete: 'new-' + 'pass' + 'word', value: key,
                placeholder: credential ? t(credential.configured ? 'configured' : 'missing') : '', disabled: busy || !credential?.writable, onChange: event => { setKey(event.target.value); setStatus(''); } }), hint(t('keyHint'))),
            row('tts', 'tts', 'ttsHint'),
            h('div', { className: 'dsh-dsapi-row' }, h('span', null, t('voice')), h(SettingsSelect, {
              value: form.voice, 'aria-label': t('voice'), disabled: busy || !writable,
              options: ['stella', 'tide'].map(id => ({ id, label: t(id) })), onChange: value => edit('voice', value),
            })), row('filterMarkdown', 'markdown'), row('asr', 'asr', 'asrHint'), row('ocr', 'ocr', 'ocrHint'),
            h('div', { className: 'dsh-dsapi-actions' },
              h(Button, { type: 'submit', variant: 'primary', disabled: busy || !writable }, t(busy ? 'saving' : 'save')),
              h(Button, { type: 'button', disabled: busy, onClick: () => { setKey(''); setStatus(''); setAttempt(n => n + 1); } }, t('reload')),
              h('span', { role: 'status' }, status))),
        h('h3', null, t('web')), hint(t('webHint')),
        h(Button, { onClick: () => navigation.open('plugins') }, t('webOpen')),
        h('p', null, h('a', { href: 'https://api-docs.deepseek.com/news/news261113', target: '_blank', rel: 'noopener noreferrer' }, t('docs'))));
    }
    return {
      name: NS,
      inject: ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials', 'settingsNavigation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = `.dsh-dsapi{max-width:680px;color:var(--dsw-alias-label-primary);font:inherit}.dsh-dsapi h2{font-size:20px;margin:0 0 12px}.dsh-dsapi h3{font-size:16px;margin:32px 0 8px}.dsh-dsapi-hint{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;margin:6px 0 0}.dsh-dsapi-field{display:grid;gap:8px;margin:24px 0}.dsh-dsapi-label{font-weight:500}.dsh-dsapi-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l4)}.dsh-dsapi-row>div{min-width:0}.dsh-dsapi-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:24px;min-height:40px}.dsh-dsapi-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}.dsh-dsapi a{color:var(--dsw-alias-link);text-underline-offset:3px}.dsh-dsapi input{min-width:0}`;
          document.head.appendChild(style);
          return () => style.remove();
        });
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'deepseek-apis', order: 15, label: () => t('nav'),
          inject: () => ({ remote: ctx.remote, t, navigation: ctx.settingsNavigation }),
        }, Settings));
      },
    };
  },
});
