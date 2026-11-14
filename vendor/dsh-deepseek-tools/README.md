# DeepSeek 应用接口

在「设置 → DeepSeek 应用接口」启用需要的能力，保存后即可在对话里说「把这段文字生成语音」「转录这份录音」或「识别这份扫描文档」。AI 会获得对应工具，不要求当前聊天模型来自 DeepSeek。

| 能力 | AI 工具 | 输入与结果 |
| --- | --- | --- |
| 语音合成 | `deepseek_tts` | 文字 → WAV 附件；Stella 女声 / Tide 男声；每次最多 10,000 计费字符、64 KiB JSON |
| 音频转录 | `deepseek_asr` | PCM16 WAV / Ogg Opus，最多 8 MiB、120 秒 → 自动识别语言的转录文本 |
| 文档识别 | `deepseek_ocr` | PDF / Word / PowerPoint / 图片，最多 100 MiB、1,000 页 → 分页文本和完整 JSON 附件 |
| 联网搜索 / 网页读取 | 已有 `web_search` / `web_fetch` | 「插件 → 内置插件设置 → Web 搜索」启用新版 Web Search API；复用 Harness 的 Search / Fetch 提供方和结果呈现 |

新工具默认关闭。配置使用活动 profile 的 `dsh-deepseek-tools` namespace，并实时更新工具可见性。基础地址默认 `https://api.deepseek.com/v1/tools`；第三方网关填写包含路径前缀、不含操作名的完整地址。这不是聊天模型的 `/anthropic` 地址。

默认凭据引用 `DEEPSEEK_API_KEY`，通过 Harness credentials 服务解析，设置页只显示是否已配置。留空保留已有密钥；输入新值写入该引用的凭据存储。使用同一引用的其他提供方也会读取新值；需要独立密钥时先更改引用名。账号登录令牌不当作这些独立接口的 API Key。

这些调用按官方接口价格额外收费。ASR 和 OCR 会把所选文件上传到配置的提供方；读取使用会话工作目录和 Harness 文件系统权限，不绕过沙箱。不会自动替换本地语音输入、现有聊天模型或搜索提供方。TTS 和 OCR 的完整结果由 Harness 附件存储保留，不创建额外 runtime 或临时 profile。

TTS 使用完整文本 HTTP 接口，音频按流写入附件，失败、截断或取消不会提交不完整文件；不提供 WebSocket 边生成边播、语速或断点续传。OCR 在上下文内提供最多 24,000 字符的分页预览，`truncated` 标记预览截断，附件保留全部结果和服务端 `finish_reason`（`length` 表示该页服务端识别不完整）。

官方规格：[2026-11-13 公告](https://api-docs.deepseek.com/news/news261113)、[TTS](https://api-docs.deepseek.com/guides/tts)、[ASR](https://api-docs.deepseek.com/guides/asr)、[OCR](https://api-docs.deepseek.com/guides/ocr)、[Search / Fetch](https://api-docs.deepseek.com/guides/search)。
