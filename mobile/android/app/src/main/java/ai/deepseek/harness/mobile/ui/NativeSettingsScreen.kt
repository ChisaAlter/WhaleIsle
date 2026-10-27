package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.DshViewModel
import ai.deepseek.harness.mobile.Route
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class SettingsSection(val id: String, val title: String, val detail: String)
private val settingsSections = listOf(
    SettingsSection("devices", "电脑与连接", "配对新电脑、切换电脑、重新连接、移除保存的设备"),
    SettingsSection("appearance", "外观与阅读", "跟随系统、浅色、深色、消息字号"),
    SettingsSection("conversation", "对话", "思考过程、工具详情、Enter 发送"),
    SettingsSection("models", "模型与权限", "当前会话的模型、思考强度、权限和 Plan"),
    SettingsSection("archived", "归档会话", "查看、恢复和删除电脑上的归档对话"),
    SettingsSection("usage", "当前会话用量", "输入、输出和缓存 token"),
    SettingsSection("account", "账户", "登录、余额、赠送余额、账户用量与充值"),
    SettingsSection("settings", "电脑设置与供应商", "电脑配置、默认模型、供应商和 API 凭据"),
    SettingsSection("mcp", "MCP 服务器", "连接状态、工具、添加、编辑与测试"),
    SettingsSection("skills", "技能", "查看、分组、调用开关与编辑"),
    SettingsSection("plugins", "插件", "插件包安装与启用、运行状态"),
    SettingsSection("about", "关于", "应用版本、连接与数据说明"),
)

/** A compact navigation list becomes focused settings pages on a portrait phone. */
@Composable
internal fun NativeSettingsScreen(vm: DshViewModel, onClose: () -> Unit) {
    val colors = dsh()
    val preferences = LocalMobilePreferences.current
    val keyboard = LocalSoftwareKeyboardController.current
    val ime = WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current) > 0
    var section by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var modelQuery by rememberSaveable { mutableStateOf("") }
    var chosenModel by remember { mutableStateOf<NativeModelOption?>(null) }
    var removing by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<NativeSession?>(null) }
    val available = vm.route == Route.Chat && !vm.chat.offline && !vm.chat.loading && !vm.chat.busy && !vm.panelBusy
    val currentEditable = available && vm.chat.readOnly.isBlank() && vm.chat.sessionId.isNotBlank()
    val scroll = rememberScrollState()
    LaunchedEffect(section, chosenModel?.id) { scroll.scrollTo(0) }
    fun back() { if (ime) keyboard?.hide() else if (chosenModel != null) chosenModel = null else if (section.isNotBlank()) section = "" else onClose() }
    BackHandler(onBack = ::back)
    Surface(Modifier.fillMaxSize(), color = colors.bgBase) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                NativeIconButton(NativeGlyph.Back, if (section.isBlank()) "返回" else "返回设置", ::back)
                Text(if (chosenModel != null) "思考强度" else settingsSections.find { it.id == section }?.title ?: "设置",
                    Modifier.weight(1f), color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
                NativeIconButton(NativeGlyph.Close, "关闭设置", onClose)
            }
            HorizontalDivider(color = colors.borderHair)
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal = 12.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (section.isBlank()) {
                    NativeField(query, { query = it }, "搜索设置")
                    val matches = settingsSections.filter { query.isBlank() || (it.title + it.detail).contains(query.trim(), true) }
                    if (matches.isEmpty()) SettingsNote("没有匹配的设置")
                    matches.forEach { item -> NativeChoiceRow(item.title, detail = item.detail,
                        enabled = item.id !in setOf("account", "settings", "mcp", "skills", "plugins") || available,
                        onClick = { keyboard?.hide(); if (item.id in setOf("account", "settings", "mcp", "skills", "plugins")) vm.openDesktop(item.id) else section = item.id }) }
                }
                when (section) {
                    "devices" -> {
                        NativeChoiceRow("配对新电脑", detail = "扫描二维码或粘贴桌面端的配对链接", glyph = NativeGlyph.Plus, onClick = vm::beginPairing)
                        if (vm.computers.isEmpty()) SettingsNote("尚未保存电脑。配对成功后会在这里显示。")
                        vm.computers.sortedByDescending { it.savedAt }.forEach { computer ->
                            val current = vm.selectedComputerId == computer.serverId && vm.route == Route.Chat
                            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(colors.bgModule).padding(4.dp)) {
                                NativeChoiceRow(computer.computerName.ifBlank { "我的电脑" }, selected = current,
                                    detail = (if (current) if (vm.chat.offline) "连接已断开 · " else "当前电脑 · " else "") + computer.relayEndpoint,
                                    onClick = { vm.reopenComputer(computer.serverId) })
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                    TextButton(onClick = { vm.reopenComputer(computer.serverId) }) { Text(if (current) "重新连接" else "连接") }
                                    TextButton(onClick = { removing = computer.serverId }) { Text("移除", color = colors.error) }
                                }
                            }
                        }
                        if (vm.route == Route.Chat) {
                            NativeChoiceRow("同步目录与会话", enabled = !vm.chat.offline && !vm.chat.loading, onClick = vm::onForeground)
                            NativeChoiceRow("断开当前电脑", detail = "保留配对和草稿，稍后可继续连接", danger = true, onClick = vm::leaveComputer)
                        }
                    }
                    "appearance" -> {
                        SettingsLabel("颜色主题")
                        listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEach { (key, label) ->
                            NativeChoiceRow(label, selected = vm.scheme == key, onClick = { vm.persistScheme(key) })
                        }
                        if (preferences != null) {
                            SettingsLabel("消息字号")
                            listOf(0.9f to "较小", 1f to "标准", 1.15f to "较大", 1.3f to "特大").forEach { (scale, label) ->
                                NativeChoiceRow(label, selected = preferences.messageScale == scale, onClick = { preferences.updateMessageScale(scale) })
                            }
                            Text("阅读预览：接着电脑上的工作。", Modifier.padding(12.dp), color = colors.labelPrimary,
                                fontSize = (14 * preferences.messageScale).sp, lineHeight = (22 * preferences.messageScale).sp)
                            SettingsNote("消息字号只调整这台手机的正文、表格和代码，继续尊重系统字体大小。")
                        }
                    }
                    "conversation" -> if (preferences != null) {
                        SettingsToggle("显示思考过程", "收起后仍保留原始会话内容", preferences.showReasoning, preferences::updateShowReasoning)
                        SettingsToggle("默认展开工具详情", "显示工具参数和返回内容，仍可逐项收起", preferences.expandToolDetails, preferences::updateExpandToolDetails)
                        SettingsToggle("Enter 发送消息", "关闭时 Enter 换行；开启后 Shift+Enter 仍换行", preferences.sendWithEnter, preferences::updateSendWithEnter)
                        SettingsLabel("回复进行中发送消息")
                        NativeChoiceRow("排队，完成当前回复后发送", selected = preferences.runningSendMode == "queue", onClick = { preferences.updateRunningSendMode("queue") })
                        NativeChoiceRow("发送到当前回复", detail = "把新消息交给正在进行的回复", selected = preferences.runningSendMode == "steer", onClick = { preferences.updateRunningSendMode("steer") })
                        SettingsNote("这些显示与输入偏好只保存到本机，不修改电脑的设置或会话记录。")
                    }
                    "models" -> {
                        val chosen = chosenModel
                        SettingsNote("只修改当前会话。供应商、API 密钥与电脑默认配置可从设置中的“电脑设置与供应商”管理。")
                        if (vm.chat.modelOptions.isEmpty()) SettingsNote(if (vm.route == Route.Chat) "模型仍在同步，请返回对话后重试。" else "连接电脑后可选择模型与权限。")
                        else if (chosen != null) {
                            SettingsLabel(chosen.label)
                            chosen.efforts.forEach { effort -> NativeChoiceRow(effort.label, enabled = currentEditable,
                                selected = chosen.provider == vm.chat.modelCurrentProvider && chosen.id == vm.chat.modelCurrentId && effort.id == vm.chat.modelCurrentEffort,
                                onClick = { vm.onChatAction(NativeChatAction("model", vm.chat.sessionId, provider = chosen.provider, model = chosen.id, reasoningEffort = effort.id)); chosenModel = null }) }
                        } else {
                            NativeField(modelQuery, { modelQuery = it }, "搜索模型")
                            val models = vm.chat.modelOptions.filter { modelQuery.isBlank() || (it.label + it.provider + it.id).contains(modelQuery.trim(), true) }
                            if (models.isEmpty()) SettingsNote("没有匹配的模型")
                            models.groupBy { it.provider }.forEach { (provider, rows) ->
                                SettingsLabel(rows.firstOrNull()?.providerLabel?.ifBlank { provider } ?: provider)
                                rows.forEach { model -> NativeChoiceRow(model.label, enabled = currentEditable, selected = model.provider == vm.chat.modelCurrentProvider && model.id == vm.chat.modelCurrentId,
                                    detail = listOfNotNull(model.description.takeIf { it.isNotBlank() },
                                        model.contextWindow?.let { "上下文 $it" }, model.maxTokens?.let { "最多输出 $it" },
                                        when (model.supportsImages) { true -> "支持图片"; false -> "仅文本"; else -> null },
                                        vm.chat.modelCurrentEffort.takeIf { it.isNotBlank() && model.provider == vm.chat.modelCurrentProvider && model.id == vm.chat.modelCurrentId }).joinToString(" · "),
                                    onClick = { if (model.efforts.isNotEmpty()) chosenModel = model else vm.onChatAction(NativeChatAction("model", vm.chat.sessionId, provider = model.provider, model = model.id)) }) }
                            }
                            SettingsLabel("权限")
                            vm.chat.permissionOptions.forEach { option -> NativeChoiceRow(option.label, enabled = currentEditable, selected = option.id == vm.chat.permissionCurrent,
                                onClick = { vm.onChatAction(NativeChatAction("permission", vm.chat.sessionId, id = option.id)) }) }
                            SettingsToggle("Plan", "当前会话的计划模式", vm.chat.planOn, { value -> vm.onChatAction(NativeChatAction("slash", vm.chat.sessionId, line = if (value) "/plan" else "/plan off")) }, currentEditable)
                        }
                    }
                    "archived" -> {
                        val rows = vm.allSessions.filter { it.archived }
                        if (vm.route != Route.Chat) SettingsNote("连接电脑后查看归档会话。")
                        else if (rows.isEmpty()) SettingsNote(if (vm.chat.offline) "连接已断开，恢复后可同步归档。" else "没有归档会话。")
                        rows.forEach { row ->
                            Column(Modifier.fillMaxWidth()) {
                                NativeChoiceRow(row.title, detail = row.workspace.ifBlank { row.cwd }, enabled = available, onClick = { vm.panel = ""; vm.openSession(row.id) })
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                    TextButton(enabled = available, onClick = { vm.sessionAction("workspace.unarchiveSession", row) }) { Text("恢复") }
                                    TextButton(enabled = available, onClick = { deleting = row }) { Text("永久删除", color = colors.error) }
                                }
                                HorizontalDivider(color = colors.borderHair)
                            }
                        }
                    }
                    "usage" -> {
                        val usage = vm.chat.usage
                        SettingsNote("当前会话记录中的 token 用量；不代表账户账单或余额。")
                        if (usage == null) SettingsNote(if (vm.route == Route.Chat) "电脑尚未提供当前会话的用量数据。" else "连接电脑后查看当前会话用量。")
                        else {
                            SettingsLabel("${vm.chat.title} · ${usage.input + usage.output} tokens")
                            SettingsNote("输入：${usage.input}\n输出：${usage.output}\n缓存读取：${usage.cacheRead}\n缓存写入：${usage.cacheWrite}")
                            if (vm.chat.offline) SettingsNote("连接已断开，显示上次同步的数据。")
                        }
                    }
                    "about" -> {
                        val context = LocalContext.current
                        val version = remember(context) { context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty() }
                        SettingsLabel("Whale Isle $version")
                        SettingsNote("Android 原生客户端 · 竖屏布局")
                        SettingsLabel("连接与数据")
                        SettingsNote("配对凭据与文字草稿加密保存在本机。手机通过端到端加密连接电脑，已配对的电脑使用保存凭据重连。")
                        SettingsNote("手机与电脑共用会话。显示偏好只影响本机；更换或移除配对不会删除电脑上的会话与文件。")
                        SettingsLabel("电脑端功能")
                        SettingsNote("账户、供应商与凭据、插件、MCP 和技能使用已配对电脑的正规服务，修改会作用于电脑。文件与更改从会话与工作区菜单进入。")
                    }
                }
                if (vm.panelError.isNotBlank() || vm.chat.banner.isNotBlank()) SettingsNote(vm.panelError.ifBlank { vm.chat.banner })
            }
        }
    }
    if (removing.isNotBlank()) NativeDialog("移除配对电脑？", onDismiss = { removing = "" }, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { removing = "" }) { Text("取消") }
            TextButton(onClick = { val id = removing; removing = ""; vm.forgetComputer(id) }) { Text("移除", color = colors.error) }
        }
    }) { SettingsNote("只移除这台手机保存的配对凭据，草稿和电脑上的会话会保留。重新连接需要扫码。") }
    deleting?.let { row -> NativeDialog("永久删除会话？", onDismiss = { deleting = null }, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { deleting = null }) { Text("取消") }
            TextButton(enabled = available, onClick = { vm.sessionAction("session.delete", row); deleting = null }) { Text("确认删除", color = colors.error) }
        }
    }) { SettingsNote("删除归档会话“${row.title}”，此操作不可恢复。") } }
}

@Composable
private fun SettingsLabel(text: String) { Text(text, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = dsh().labelSecondary, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium) }

@Composable
private fun SettingsNote(text: String) { Text(text, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), color = dsh().labelTertiary, fontSize = 12.sp, lineHeight = 18.sp) }

@Composable
private fun SettingsToggle(label: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    val colors = dsh()
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, role = Role.Switch) { onChange(!checked) }.padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label, color = if (enabled) colors.labelPrimary else colors.labelCaption, fontSize = 14.sp, lineHeight = 22.sp)
            Text(detail, color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}
