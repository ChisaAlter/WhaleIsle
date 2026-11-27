# Decision: 统一无空格英文主商标 WhaleIsle，收敛中文名出现范围

Status: implemented

## Problem

此前界面与打包配置混用带空格的 `Whale Isle`、全大写 `WHALE ISLE`、无空格仓库名 `WhaleIsle` 以及中文名「鲸屿」：侧栏、启动器导航轨（188px 宽）和移动端连接页同时并列中英文双字标导致视觉拥挤且横向空间局促，而窗口标题、快捷方式、安装器、OAuth 客户端提示与仓库名又存在空格不一致。

## Decision

1. **主商标统一为无空格英文名 `WhaleIsle`**（独立启动器为 `WhaleIsle Launcher`）：
   - 桌面与 Web 侧栏、启动器导航轨、移动端连接/权限/抽屉字标统一使用透明鲸鱼娘头像加双色驼峰 `WhaleIsle`（`Whale` 使用主文字色，`Isle` 使用品牌蓝），下方保留 `BASED ON DEEPSEEK HARNESS`（启动器导航轨为 `LAUNCHER`），不再随语言切换或并列显示中文字标。
   - 桌面启动页海平线画布使用 `WhaleIsle` 衬线主字标与 `BASED ON DEEPSEEK HARNESS` 归属行，不再叠加中文副字标。
   - `package.json`、`electron-builder.launcher.yml`、可执行文件与 `.app` 包名、桌面/开始菜单快捷方式、窗口标题、托盘提示、NSIS 向导文案与侧栏位图、OAuth `agentName`、移动端应用名统一为 `WhaleIsle` / `WhaleIsle Launcher`。
2. **中文辅助名「鲸屿」仅保留在两处**：
   - 应用内 **设置 → 关于** 页面（桌面端中文文案 `WhaleIsle（鲸屿）`、手机 Web 与 Android 原生设置「关于」页）；
   - **GitHub 面向用户的介绍文档**（如中文 `README.md`）与记录品牌规则的设计/决策文档。
   - 角色与功能名（「鲸鱼娘」「大肥鱼」）属于虚拟助手与工作台模式名称，保持不变。
3. **保留发行资产文件名与底层数据路径稳定**：
   - 发行安装包、增量包及 CI 产物命名（`Whale-Isle-Setup-${version}.${ext}`、`Whale-Isle-${version}-mac-${arch}.${ext}`、`Whale-Isle-Launcher-Setup-${version}.${ext}`、`Whale-Isle-${version}-android.apk`、`Whale-Isle-delta-${from}-${to}.zip`）保持连字符格式不变，避免破坏既有下载链接、镜像同步与 `latest.yml` / 增量更新链路。
   - `appId`（`ai.deepseek.harness.gui`、`ai.deepseek.harness.launcher`）、`userData` 目录（`Deepseek-Harness-Desktop`、`Deepseek-Harness-Launcher`）保持不变；安装目录、注册表卸载项、进程探测与 NSIS 旧安装清理同时兼容旧版 `Whale Isle` 与 `Deepseek-Harness-Desktop`。

## Alternatives considered

- **更换为全新的 4～6 字母单字英文名（如 `While`）**：与编程语言保留关键字重名、检索辨识度低，且会割裂既有仓库 `ChisaAlter/WhaleIsle` 与鲸鱼娘视觉资产的关联。
- **同步重命名发行安装包文件名（改为 `WhaleIsle-Setup-*`）**：会影响外部已引用的下载规则、CNB 镜像脚本、增量包匹配与跨版本更新校验，而安装包文件名并非应用内日常可见商标。

## Consequences

所有运行态界面呈现单一清晰的 `WhaleIsle` 英文主商标，窄侧栏与手机顶栏不再因中英双排挤压裁切；中文用户仍可在 GitHub 首页与「设置 → 关于」确认「鲸屿」辅助名称；旧版 `Whale Isle` 与 `Deepseek-Harness-Desktop` 安装均可平滑原地升级并保留全部本地会话与配置。
