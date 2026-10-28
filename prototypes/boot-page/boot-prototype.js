const variants = [
  { key: 'a', label: 'A · 宽分栏' },
  { key: 'b', label: 'B · 状态海报' },
  { key: 'c', label: 'C · 诊断边栏' },
];

const fixtures = {
  startup: {
    state: 'starting',
    code: 'BOOT',
    stamp: '启动中',
    status: '正在启动运行时',
    hint: '本机 dsh web 启动中。关闭应用时服务一并退出。',
    failure: '',
    recovery: '',
    actions: {},
    logs: [
      '[app] 本机服务目录已识别',
      '[app] 运行配置已载入',
      '[app] 本地服务端口可用',
      '[app] Harness Runtime 子进程已创建',
      '[app] 启动 Harness Runtime',
      '[runtime] 正在载入 Web 应用',
      '[runtime] 正在注册本地路由',
      '[app] 等待本地服务就绪',
    ],
  },
  'plugins-known': {
    state: 'starting',
    code: 'BOOT',
    stamp: '启动中',
    status: '正在加载插件 3/5',
    hint: '此计数是原型样例；正式页面只显示运行时实际提供的数量。',
    failure: '',
    recovery: '',
    actions: {},
    logs: [
      '[app] Harness Runtime 已就绪',
      '[plugins] 已发现客户端插件',
      '[plugins] 正在解析插件清单',
      '[plugins] 插件依赖关系已确认',
      '[plugins] 正在加载插件 3/5',
      '[plugins] 已就绪 3/5',
      '[plugins] 正在载入下一个插件',
      '[plugins] 等待插件装载完成',
    ],
  },
  'plugins-unknown': {
    state: 'starting',
    code: 'BOOT',
    stamp: '启动中',
    status: '正在加载插件',
    hint: '当前事件没有提供插件总数，因此不显示计数。',
    failure: '',
    recovery: '',
    actions: {},
    logs: [
      '[app] Harness Runtime 已就绪',
      '[plugins] 已发现客户端插件',
      '[plugins] 正在解析插件清单',
      '[plugins] 插件总数尚未提供',
      '[plugins] 正在启动插件',
      '[plugins] 收到插件启动事件',
      '[plugins] 等待插件就绪事件',
      '[plugins] 等待插件装载完成',
    ],
  },
  error: {
    state: 'error',
    code: 'ERROR',
    stamp: '异常',
    status: '启动失败',
    hint: 'DeepSeek Harness 运行时未能就绪。',
    failure: [
      '错误详情（原型样例）：本地 Harness Runtime 未在等待时限内报告就绪。',
      '阶段：runtime-ready / 失败类型：启动超时',
      '错误码：ERR_HARNESS_RUNTIME_READY_TIMEOUT__LOCAL_SERVER_BIND_WAIT_EXCEEDED__BOOT_FAILURE_PREVIEW_ONLY__LONG_TOKEN_FOR_WRAP_CHECK',
      '等待地址：http://127.0.0.1:3080/health/ready',
      '运行目录：C:\\Users\\profile\\AppData\\Roaming\\Deepseek-Harness-Desktop\\dsh-home\\profiles\\web\\node_modules\\@deepseek-ai\\dsh-experimental-voice-input-bundle\\dist\\runtime-entry-with-a-deliberately-long-name.js',
      '最近事件：Harness Runtime 子进程已创建。',
      '最近事件：本地 HTTP 端口监听成功。',
      '最近事件：健康检查连续等待，尚未收到 ready 信号。',
      '排查建议：检查上方日志中的服务进程输出和端口占用情况。',
      '排查建议：确认 dsh-home 中的 Web 依赖已完成安装。',
      '排查建议：若问题再次出现，请下载日志供排查。',
      '诊断标记：BOOT_RUNTIME_WAIT_TIMEOUT / attempt=1 / preview=true',
      '说明：这里使用多行示例，以预览错误详情区域的滚动行为。',
      '说明：真实页面只展示运行时返回的错误消息，不生成推测性进度。',
    ].join('\n'),
    recovery: '自动恢复已停止。可以重试、下载日志，或回到启动器排查。',
    actions: { retry: true, 'open-launcher': true, 'save-log': true },
    retryLabel: '重试',
    logs: [
      '[app] Harness Runtime 已启动',
      '[runtime] 子进程 PID=18420',
      '[runtime] Web 应用资源已载入',
      '[runtime] 正在绑定 127.0.0.1:3080',
      '[runtime] 端口监听成功',
      '[health] GET /health/ready → 503',
      '[health] GET /health/ready → 503',
      '[health] GET /health/ready → 503',
      '[app] 等待本地服务就绪超时',
      '[recovery] 错误详情已写入诊断快照',
      '[recovery] 保留最近 8 条运行时日志',
      '[recovery] 自动恢复策略已评估',
      '[recovery] 等待用户选择下一步操作',
      '[app] 启动失败（原型样例）',
      '[recovery] 自动重启状态取决于本机策略设置',
      '[app] 等待重试或打开启动器排查',
    ],
  },
  scheduled: {
    state: 'error',
    code: 'ERROR',
    stamp: '自动恢复',
    status: '自动重启已排程',
    hint: '恢复流程已安排自动重启。',
    failure: '',
    recovery: '自动重启尚未开始；可取消排程。',
    actions: { retry: true, 'cancel-restart': true, 'save-log': true },
    retryLabel: '立即重启',
    logs: [
      '[app] Harness Runtime 意外退出',
      '[recovery] 检查自动恢复策略',
      '[recovery] 自动恢复仍有可用次数',
      '[recovery] 已计算下次尝试时间',
      '[recovery] 自动重启已排程',
      '[recovery] 等待用户操作或倒计时结束',
      '[recovery] 等待重启开始',
      '[recovery] 可取消排程或立即重启',
    ],
  },
  restarting: {
    state: 'error',
    code: 'ERROR',
    stamp: '正在重启',
    status: '正在自动重启',
    hint: 'Harness 正在重新启动。',
    failure: '',
    recovery: '恢复仍在进行；重试暂不可用。',
    actions: { retry: true, 'save-log': true },
    retryLabel: '立即重启',
    disabledActions: ['retry'],
    logs: [
      '[app] Harness Runtime 意外退出',
      '[recovery] 自动恢复排程已触发',
      '[recovery] 正在停止旧 Web Runtime',
      '[recovery] 旧进程已退出',
      '[recovery] 正在重新启动 Harness',
      '[app] 正在创建新的 Runtime 进程',
      '[runtime] 正在载入 Web 应用',
      '[recovery] 等待新进程就绪',
    ],
  },
};

const url = new URL(window.location.href);
const canvases = [...document.querySelectorAll('.canvas[data-variant]')];
const currentVariantLabel = document.getElementById('current-variant');
const fixtureSelect = document.getElementById('fixture-select');
const themeToggle = document.getElementById('theme-toggle');
const motionToggle = document.getElementById('motion-toggle');
const note = document.getElementById('prototype-note');
const platformSelect = document.getElementById('platform-select');
const windowStateSelect = document.getElementById('window-state-select');
const macAppMenu = document.querySelector('.mac-app-menu');
let currentVariant = variants.some(({ key }) => key === url.searchParams.get('variant'))
  ? url.searchParams.get('variant')
  : 'a';

function updateUrl(key, value) {
  url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

function setPlatform(platform, syncUrl = true) {
  const mac = platform === 'mac';
  platformSelect.value = mac ? 'mac' : 'windows';
  document.documentElement.dataset.platform = mac ? 'darwin' : 'win32';
  document.getElementById('window-state-label').hidden = !mac;
  document.getElementById('platform-detail').hidden = !mac;
  macAppMenu.open = false;
  setWindowState(windowStateSelect.value, false);
  if (syncUrl) updateUrl('platform', platformSelect.value);
}

function setWindowState(state, syncUrl = true) {
  const resolved = ['active', 'inactive', 'fullscreen'].includes(state) ? state : 'active';
  windowStateSelect.value = resolved;
  document.documentElement.dataset.windowState = resolved;
  document.getElementById('platform-detail').textContent = resolved === 'fullscreen'
    ? '全屏预览：收回窗口圆角；系统标题栏由 AppKit 显隐，此处不模拟鼠标触顶'
    : '原型标注：左侧 80px 留给原生红黄绿 · 关窗不退出 · ⌘, 设置 · ⌘H 隐藏 · ⌘Q 退出';
  macAppMenu.open = false;
  if (syncUrl) updateUrl('window', resolved);
}

function showVariant(key, syncUrl = true) {
  currentVariant = key;
  for (const canvas of canvases) canvas.hidden = canvas.dataset.variant !== key;
  currentVariantLabel.textContent = variants.find((item) => item.key === key)?.label ?? variants[0].label;
  if (syncUrl) updateUrl('variant', key);
}

function setSlot(canvas, name, value) {
  const element = canvas.querySelector(`[data-slot="${name}"]`);
  if (!element) return;
  if (name === 'failure' || name === 'recovery') {
    element.hidden = !value;
    element.textContent = value;
    return;
  }
  if (name === 'actions') return;
  element.textContent = value;
}

function renderFixture(fixtureKey, syncUrl = true) {
  const fixture = fixtures[fixtureKey] ?? fixtures.startup;
  fixtureSelect.value = fixtureKey in fixtures ? fixtureKey : 'startup';
  document.body.dataset.fixture = fixtureKey;
  document.body.dataset.state = fixture.state;

  for (const canvas of canvases) {
    setSlot(canvas, 'stamp-code', fixture.code);
    setSlot(canvas, 'stamp', fixture.stamp);
    setSlot(canvas, 'status', fixture.status);
    setSlot(canvas, 'hint', fixture.hint);
    setSlot(canvas, 'failure', fixture.failure);
    setSlot(canvas, 'recovery', fixture.recovery);

    const logs = canvas.querySelector('[data-slot="logs"]');
    logs.replaceChildren(...fixture.logs.map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }));

    const actions = canvas.querySelector('[data-slot="actions"]');
    let shownAction = false;
    for (const button of actions.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      button.hidden = !fixture.actions[action];
      button.disabled = fixture.disabledActions?.includes(action) ?? false;
      if (action === 'retry') button.textContent = fixture.retryLabel ?? '重试';
      shownAction ||= !button.hidden;
    }
    actions.hidden = !shownAction;
  }

  if (syncUrl) updateUrl('state', fixtureKey);
  note.textContent = '样例状态仅用于预览；操作按钮未连接真实运行时或日志导出。';
}

function setTheme(isDark, syncUrl = true) {
  if (isDark) document.documentElement.setAttribute('data-ds-dark-theme', '');
  else document.documentElement.removeAttribute('data-ds-dark-theme');
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.textContent = isDark ? '浅色预览' : '深色预览';
  if (syncUrl) updateUrl('theme', isDark ? 'dark' : 'light');
}

function setReducedMotion(reduced, syncUrl = true) {
  requestedReducedMotion = reduced;
  const systemForcesReducedMotion = motionPreference.matches;
  const effectiveReducedMotion = systemForcesReducedMotion || requestedReducedMotion;
  document.body.classList.toggle('is-reduced-motion', effectiveReducedMotion);
  motionToggle.setAttribute('aria-pressed', String(effectiveReducedMotion));
  motionToggle.disabled = systemForcesReducedMotion;
  motionToggle.textContent = systemForcesReducedMotion
    ? '减少动效：系统开启'
    : `减少动效：${effectiveReducedMotion ? '开' : '关'}`;
  motionToggle.title = systemForcesReducedMotion
    ? '当前系统偏好强制减少动效'
    : '切换原型预览的动效';
  if (syncUrl && !systemForcesReducedMotion) {
    updateUrl('motion', requestedReducedMotion ? 'reduced' : 'full');
  }
}

function cycleVariant(direction) {
  const index = variants.findIndex(({ key }) => key === currentVariant);
  const next = (index + direction + variants.length) % variants.length;
  showVariant(variants[next].key);
}

document.getElementById('previous-variant').addEventListener('click', () => cycleVariant(-1));
document.getElementById('next-variant').addEventListener('click', () => cycleVariant(1));
fixtureSelect.addEventListener('change', () => renderFixture(fixtureSelect.value));
themeToggle.addEventListener('click', () => setTheme(themeToggle.getAttribute('aria-pressed') !== 'true'));
motionToggle.addEventListener('click', () => setReducedMotion(!document.body.classList.contains('is-reduced-motion')));
platformSelect.addEventListener('change', () => setPlatform(platformSelect.value));
windowStateSelect.addEventListener('change', () => setWindowState(windowStateSelect.value));
document.querySelectorAll('[data-preview-command]').forEach(button => {
  button.addEventListener('click', () => {
    const messages = {
      settings: '原型预览：正式应用通过 ⌘, 打开设置；此处不连接应用',
      hide: '原型预览：⌘H 隐藏整个应用，点击 Dock 图标可回到前台；此处不会隐藏浏览器',
      quit: '原型预览：⌘Q 退出应用；红色按钮与 ⌘W 只关闭窗口，不退出应用',
    };
    note.textContent = messages[button.dataset.previewCommand];
    macAppMenu.open = false;
  });
});
document.addEventListener('pointerdown', event => {
  if (!macAppMenu.contains(event.target)) macAppMenu.open = false;
});
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let requestedReducedMotion = url.searchParams.get('motion') === 'reduced';
motionPreference.addEventListener('change', () => setReducedMotion(requestedReducedMotion, false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && macAppMenu.open) {
    macAppMenu.open = false;
    macAppMenu.querySelector('summary').focus();
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const focused = event.target;
  if (focused instanceof HTMLElement && (
    focused.matches('input, textarea, select, button')
    || focused.isContentEditable
  )) return;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    cycleVariant(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    cycleVariant(1);
  }
});

document.querySelectorAll('.actions button').forEach((button) => {
  button.addEventListener('click', () => {
    note.textContent = '原型预览：此按钮未连接真实重试、恢复或日志导出操作。';
  });
});

showVariant(currentVariant, false);
setWindowState(url.searchParams.get('window'), false);
setPlatform(url.searchParams.get('platform') ?? (/Mac/.test(navigator.platform) ? 'mac' : 'windows'), false);
renderFixture(url.searchParams.get('state') ?? 'startup', false);
setTheme(url.searchParams.get('theme') === 'dark', false);
document.body.classList.toggle('is-clean-presentation', url.searchParams.get('presentation') === 'clean');
setReducedMotion(requestedReducedMotion, false);
