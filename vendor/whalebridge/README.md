# 鲸桥 · WhaleBridge

Magpie 源码的 DSH 专用组件。启动器负责安装、停止、更新、回滚与卸载；Go 进程负责本地网关、配置保存和 DSH 渠道同步。

上游来源与 MIT 版权见 `upstream.json` 和 `LICENSE`。这里直接维护精简后的源码，构建不再下载完整 Magpie 或用 overlay 包装原应用。

- 删除上游主入口、CLI/TUI、Wails 桌面壳、原 GUI、其他客户端配置写入适配和 Skills/MCP 管理页面。
- 保留供应商、模型目录、路由、协议转换和用量的源码依赖。部分核心依赖仍含订阅账号及会话相关内部辅助代码；本组件不启动上游的客户端安装、账号切换、会话扫描、插件更新或远程监听任务。
- 客户端只提供 DSH 的 Chat Completions 和模型列表接口。上游其他客户端专用、MCP、图片/视频和管理 API 不对外暴露。
- 自有设置页面提供接入概览、供应商与账号、模型管理、路由组、用量统计和使用说明。概览解释组件用途和三步接入；供应商使用卡片，模型支持搜索与显示范围筛选，高级配置按需展开。样式复用桌面壳的语义 token 镜像、上游滚动条和图标；透明 logo 与鲸屿 `assets/whale-head.png` 同源。

从仓库根目录执行 `node scripts/build-whalebridge.mjs`，需要 Go >= 1.26.3。输出 `.tmp/whalebridge-package/WhaleBridge-win32-x64.exe` 和同目录清单。源码启动器优先安装这个本地产物。

进程需要启动器提供 `LAUNCHER_COMPONENT_DATA_DIR`、`WHALEBRIDGE_DSH_HOME` 和 `MAGPIE_ADDR`。管理页采用随机端口及私有 Cookie；网关绑定本机、使用持久随机密钥。供应商密钥不返回到管理页。关闭设置窗口不停止网关；DSH 启动时恢复已安装组件。

DSH 只修改 `home/profiles/web/cordis.patch.yml` 中 `llm-pi-ai` 的 `providers.whalebridge` 和自身 `.env` 凭据，使用 DSH 的 profile 写锁并支持运行时热更新；不覆盖其他供应商或默认模型。卸载移除这一渠道；如果它是当前默认模型则清除该默认选择。聊天记录保留。组件自己的配置和用量可在卸载时选择保留或删除。
