package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*
import java.util.UUID

@Composable
internal fun NativeMcpPanel(controller: NativeDesktopController, available: Boolean) {
    val state = controller.state
    var query by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var removing by remember { mutableStateOf<JsonObject?>(null) }
    LaunchedEffect(state.notice, state.busy) { if (!state.busy && state.notice == "修改已保存") editing = null }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { NativeField(query, { query = it }, "搜索 MCP 服务器") }
        item { DesktopButton("添加 MCP 服务器", available) { editing = obj() } }
        val rows = state.data.objects("servers").filter { query.isBlank() || it["spec"].objectValue().string("serverName").contains(query, true) }
        if (state.loaded && rows.isEmpty()) item { DesktopNote(if (query.isBlank()) "电脑尚未配置 MCP 服务器" else "没有匹配的 MCP 服务器") }
        items(rows, key = { it.string("id") }) { row ->
            val spec = row["spec"].objectValue()
            Column {
                Text(spec.string("serverName"), color = dsh().labelPrimary, fontSize = 14.sp)
                val health = row["connection"].objectValue()
                DesktopNote(listOf(spec.string("transport"), if (row["enabled"].flag()) "已启用" else "已停用", health.string("health").ifBlank { row.string("fiberPhase") }).filter { it.isNotBlank() }.joinToString(" · "))
                if (health.string("lastError").isNotBlank()) DesktopNote(health.string("lastError"))
                val tools = health["tools"].arrayValue().map { it.text() }
                if (tools.isNotEmpty()) DesktopNote(tools.joinToString("\n"))
                if (row["writable"].flag()) {
                    DesktopToggle("启用此服务器", row["enabled"].flag(), available) { controller.mcpAction("setEnabled", row.string("id"), it) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DesktopButton("编辑", available) { editing = row }
                        DesktopButton("重连", available) { controller.mcpAction("retry", row.string("id")) }
                        DesktopButton("删除", available) { removing = row }
                    }
                } else DesktopNote("来自电脑的配置组合，只读")
                DesktopButton("测试连接", available) { controller.mcpAction("test", row.string("id")) }
                HorizontalDivider(color = dsh().borderHair)
            }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }
    editing?.let { row -> NativeMcpEditor(row, available, { editing = null }) { controller.saveMcp(it) } }
    removing?.let { row -> DesktopConfirm("删除 MCP 服务器？", "删除“${row["spec"].objectValue().string("serverName")}”的配置与连接。", available, { removing = null }) { controller.mcpAction("delete", row.string("id")); removing = null } }
}

@Composable
private fun NativeMcpEditor(row: JsonObject, available: Boolean, onClose: () -> Unit, save: (JsonObject) -> Unit) {
    val original = row["spec"].objectValue()
    val create = original.isEmpty()
    var transport by remember { mutableStateOf(original.string("transport").ifBlank { "stdio" }) }
    var name by remember { mutableStateOf(original.string("serverName")) }
    var command by remember { mutableStateOf(original.string("command")) }
    var args by remember { mutableStateOf(original["args"].arrayValue().joinToString("\n") { it.text() }) }
    var cwd by remember { mutableStateOf(original.string("cwd")) }
    var url by remember { mutableStateOf(original.string("url")) }
    var timeout by remember { mutableStateOf(original["toolCallTimeoutMs"].text()) }
    var enabled by remember { mutableStateOf(if (create) true else original["enabled"].flag()) }
    var variables by remember { mutableStateOf((original[if (transport == "stdio") "env" else "headers"].objectValue()).map { (k, v) -> k to v.text() }) }
    var newKey by remember { mutableStateOf("") }
    var newValue by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    NativeDialog(if (create) "添加 MCP 服务器" else "编辑 MCP 服务器", onClose, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onClose) { Text("取消") }
            TextButton(enabled = available && name.isNotBlank() && (if (transport == "stdio") command.isNotBlank() else url.isNotBlank()), onClick = {
                try {
                    val fields = original.toMutableMap()
                    fields["id"] = JsonPrimitive(original.string("id").ifBlank { nativeMcpId() })
                    fields["serverName"] = JsonPrimitive(name.trim()); fields["transport"] = JsonPrimitive(transport); fields["enabled"] = JsonPrimitive(enabled)
                    if (timeout.isNotBlank()) fields["toolCallTimeoutMs"] = JsonPrimitive(timeout.toLongOrNull()?.takeIf { it > 0 } ?: error("超时必须是正整数")) else fields.remove("toolCallTimeoutMs")
                    val pairs = variables.toMutableList()
                    if (newKey.isNotBlank()) pairs += newKey.trim() to newValue
                    val map = JsonObject(pairs.associate { it.first to JsonPrimitive(it.second) })
                    if (transport == "stdio") {
                        fields["command"] = JsonPrimitive(command.trim()); fields["args"] = JsonArray(args.lines().filter { it.isNotEmpty() }.map { JsonPrimitive(it) }); fields["env"] = map
                        if (cwd.isBlank()) fields.remove("cwd") else fields["cwd"] = JsonPrimitive(cwd)
                        fields.remove("url"); fields.remove("headers")
                    } else {
                        require(url.startsWith("https://") || url.startsWith("http://")) { "请输入 HTTP(S) 服务器地址" }
                        fields["url"] = JsonPrimitive(url.trim()); fields["headers"] = map
                        fields.remove("command"); fields.remove("args"); fields.remove("env"); fields.remove("cwd")
                    }
                    save(JsonObject(fields))
                } catch (failure: Exception) { error = failure.message ?: "配置无效" }
            }) { Text("保存") }
        }
    }) {
        NativeField(name, { name = it }, "服务器名称", available)
        if (create) Row { TextButton(onClick = { transport = "stdio"; variables = emptyList() }) { Text(if (transport == "stdio") "✓ stdio" else "stdio") }; TextButton(onClick = { transport = "streamable-http"; variables = emptyList() }) { Text(if (transport != "stdio") "✓ HTTP" else "HTTP") } }
        DesktopToggle("启用", enabled, available) { enabled = it }
        if (transport == "stdio") {
            NativeField(command, { command = it }, "命令", available)
            NativeField(args, { args = it }, "参数（每行一个）", available, 3)
            NativeField(cwd, { cwd = it }, "工作目录（可留空）", available)
        } else NativeField(url, { url = it }, "服务器 URL", available)
        NativeField(timeout, { timeout = it }, "工具超时毫秒（可留空）", available)
        DesktopNote(if (transport == "stdio") "环境变量" else "HTTP 请求头")
        variables.forEachIndexed { index, pair ->
            DesktopNote(pair.first + if (pair.second == "********") " · 已配置（留空保留）" else "")
            NativeSecretField(if (pair.second == "********") "" else pair.second, { text -> variables = variables.toMutableList().also { it[index] = pair.first to text } }, "更新 ${pair.first}", available)
            TextButton(onClick = { variables = variables.filterIndexed { i, _ -> i != index } }) { Text("移除此项") }
        }
        NativeField(newKey, { newKey = it }, "新增变量 / 请求头名称", available)
        NativeSecretField(newValue, { newValue = it }, "新增值", available)
        if (error.isNotBlank()) DesktopNote(error)
    }
}

@Composable
internal fun NativeSkillsPanel(controller: NativeDesktopController, available: Boolean) {
    val state = controller.state
    var query by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var removing by remember { mutableStateOf("") }
    LaunchedEffect(state.notice, state.busy) { if (!state.busy && state.notice == "修改已保存") editing = null }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.detail.isEmpty()) {
            item { NativeField(query, { query = it }, "搜索技能名称、说明或分组") }
            item { DesktopButton("创建技能", available) { editing = obj() } }
            val rows = state.data.objects("skills").filter { query.isBlank() || (it.string("name") + it.string("description") + it["groups"].toString()).contains(query, true) }
            if (state.loaded && rows.isEmpty()) item { DesktopNote(if (query.isBlank()) "此会话未发现技能" else "没有匹配的技能") }
            items(rows, key = { it.string("name") }) { row ->
                NativeChoiceRow(row.string("name"), detail = row.string("description"), enabled = available, onClick = { controller.loadSkill(row.string("name")) })
                DesktopNote(listOf(row.string("source"), row["groups"].arrayValue().joinToString(" · ") { it.text() }, if (row["modelInvocable"].flag()) "模型可调用" else "模型调用关闭", if (row["userInvocable"].flag()) "用户可调用" else "用户调用关闭").filter { it.isNotBlank() }.joinToString(" · "))
            }
        } else {
            val skill = state.detail
            item { Text(skill.string("name"), color = dsh().labelPrimary, fontSize = 16.sp) }
            item { DesktopNote(skill.string("description") + "\n" + skill.string("path").ifBlank { skill.string("source") }) }
            if (skill["writable"].flag()) {
                item { DesktopToggle("模型可调用", skill["modelInvocable"].flag(), available) { controller.skillInvocation(skill, it, skill["userInvocable"].flag()) } }
                item { DesktopToggle("用户可调用", skill["userInvocable"].flag(), available) { controller.skillInvocation(skill, skill["modelInvocable"].flag(), it) } }
                item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { DesktopButton("编辑技能", available) { editing = skill }; DesktopButton("删除技能", available) { removing = skill.string("name") } } }
            } else item { DesktopNote("此技能来源只读") }
            item { NativeMarkdown(skill.string("content")) }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }
    editing?.let { NativeSkillEditor(it, available, { editing = null }) { skill, create -> controller.saveSkill(skill, create) } }
    if (removing.isNotBlank()) DesktopConfirm("删除技能？", "删除“$removing”的技能文件或目录。", available, { removing = "" }) { controller.deleteSkill(removing); removing = "" }
}

@Composable
private fun NativeSkillEditor(original: JsonObject, available: Boolean, close: () -> Unit, save: (JsonObject, Boolean) -> Unit) {
    val create = original.isEmpty()
    var name by remember { mutableStateOf(original.string("name")) }
    var description by remember { mutableStateOf(original.string("description")) }
    var whenToUse by remember { mutableStateOf(original.string("whenToUse")) }
    var groups by remember { mutableStateOf(original["groups"].arrayValue().joinToString(", ") { it.text() }) }
    var content by remember { mutableStateOf(original.string("content")) }
    var model by remember { mutableStateOf(if (create) true else original["modelInvocable"].flag()) }
    var user by remember { mutableStateOf(if (create) true else original["userInvocable"].flag()) }
    var root by remember { mutableStateOf("user-dsh") }
    NativeDialog(if (create) "创建技能" else "编辑技能", close, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = close) { Text("取消") }
            TextButton(enabled = available && Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$").matches(name) && description.isNotBlank(), onClick = {
                val value = obj("name" to name, "description" to description, "whenToUse" to whenToUse, "groups" to groups.split(',').map { it.trim() }.filter { it.isNotBlank() }.distinct(), "content" to content, "modelInvocable" to model, "userInvocable" to user)
                save(if (create) JsonObject(value + ("root" to JsonPrimitive(root))) else value, create)
            }) { Text("保存") }
        }
    }) {
        NativeField(name, { name = it }, "技能名称（小写字母、数字、短横线）", available && create)
        NativeField(description, { description = it }, "说明", available, 2)
        NativeField(whenToUse, { whenToUse = it }, "何时使用", available, 2)
        NativeField(groups, { groups = it }, "分组（逗号分隔）", available)
        if (create) { NativeChoiceRow("保存到电脑用户技能", selected = root == "user-dsh", onClick = { root = "user-dsh" }); NativeChoiceRow("保存到当前项目技能", selected = root == "project-dsh", onClick = { root = "project-dsh" }) }
        DesktopToggle("模型可调用", model, available) { model = it }; DesktopToggle("用户可调用", user, available) { user = it }
        NativeField(content, { content = it }, "技能正文（Markdown）", available, 8)
    }
}

@Composable
internal fun NativePluginsPanel(controller: NativeDesktopController, available: Boolean) {
    val state = controller.state
    var query by rememberSaveable { mutableStateOf("") }
    var spec by rememberSaveable { mutableStateOf("") }
    var removing by remember { mutableStateOf("") }
    val inspection = state.detail["inspection"].objectValue()
    val manageable = state.data["inventory"].objectValue()["managementAvailable"].flag()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { NativeField(query, { query = it }, "搜索插件与插件包") }
        if (controller.installRequestId.isNotBlank() || controller.uncertainInstallRequestId.isNotBlank()) item { DesktopButton("取消当前安装", !state.busy || controller.installRequestId.isNotBlank()) { controller.cancelInstall() } }
        if (controller.installUncertain) {
            item { DesktopNote("上次安装结果未确认，请先刷新并核对以下插件包状态。") }
            item { DesktopButton("恢复这次安装结果", available) { controller.recoverInstall() } }
        }
        if (manageable) {
            item { NativeField(spec, { spec = it }, "安装插件包（包名 / GitHub spec / 电脑本地路径）", available) }
            item { DesktopButton("检查安装来源", available && spec.isNotBlank()) { controller.inspectPlugin(spec) } }
        } else if (state.loaded) item { DesktopNote("此电脑未挂载插件管理服务，以下为当前插件的只读状态。") }
        if (inspection.isNotEmpty()) {
            item { DesktopNote(inspection.string("name").ifBlank { state.detail.string("spec") } + " " + inspection.string("version") + "\n" + inspection.string("description").ifBlank { inspection.string("reason") }) }
            if (inspection.string("status") == "accepted") item { DesktopButton("确认安装到电脑", available && !controller.installUncertain) { controller.installPlugin(state.detail.string("spec")) } }
        }
        val installation = state.detail["installation"].objectValue()
        val builds = installation["pendingBuilds"].arrayValue().map { it.text() }
        if (builds.isNotEmpty()) {
            item { DesktopNote("以下包的构建脚本需要明确允许：\n" + builds.joinToString("\n")) }
            item { DesktopButton("允许这些构建脚本并安装", available && !controller.installUncertain) { controller.installPlugin(state.detail.string("spec"), builds) } }
        }
        val bundles = state.data["bundles"].arrayValue().map { it.objectValue() }.filter { query.isBlank() || (it.string("name") + it.string("description")).contains(query, true) }
        if (bundles.isNotEmpty()) item { DesktopNote("插件包") }
        items(bundles, key = { "bundle:" + it.string("name") }) { row ->
            Text(row.string("name"), color = dsh().labelPrimary, fontSize = 14.sp)
            DesktopNote(row.string("description") + "\n" + row.string("version") + " · " + row.string("availability"))
            val editable = row.string("readOnlyReason").isBlank() && row.string("availability") != "missing"
            DesktopToggle("启用插件包", row["enabled"].flag(), available && editable) { controller.bundleEnabled(row.string("name"), it) }
            if (!editable) DesktopNote(row.string("readOnlyReason").ifBlank { "插件包未安装" })
            if (row["removable"].flag()) DesktopButton("移除插件包", available) { removing = row.string("name") }
            if (row["error"].objectValue().isNotEmpty()) DesktopNote(row["error"].objectValue().string("diagnostic").ifBlank { row["error"].objectValue().string("code") })
            HorizontalDivider(color = dsh().borderHair)
        }
        val plugins = state.data["plugins"].arrayValue().map { it.objectValue() }.filter { query.isBlank() || it.string("moduleName").contains(query, true) }
        if (plugins.isNotEmpty()) item { DesktopNote("运行中的插件") }
        items(plugins, key = { "plugin:" + it.string("entryId") }) { row ->
            Text(row.string("moduleName"), color = dsh().labelPrimary, fontSize = 14.sp)
            DesktopNote(row.string("fiberPhase").ifBlank { "未运行" })
            DesktopToggle("启用插件", row["enabled"].flag(), available && row.string("patchId").isNotBlank() && row.string("readOnlyReason").isBlank()) { controller.pluginEnabled(row.string("entryId"), it) }
            if (row.string("readOnlyReason").isNotBlank()) DesktopNote(row.string("readOnlyReason"))
        }
        if (state.loaded && bundles.isEmpty() && plugins.isEmpty()) item { DesktopNote(if (query.isBlank()) "电脑没有返回插件条目" else "没有匹配的插件") }
        item { Spacer(Modifier.height(88.dp)) }
    }
    if (removing.isNotBlank()) DesktopConfirm("移除插件包？", "从电脑的当前配置移除“$removing”。", available, { removing = "" }) { controller.removeBundle(removing); removing = "" }
}

@Composable
internal fun DesktopConfirm(title: String, description: String, enabled: Boolean, close: () -> Unit, confirm: () -> Unit) {
    NativeDialog(title, close, actions = { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { TextButton(onClick = close) { Text("取消") }; TextButton(enabled = enabled, onClick = confirm) { Text("确认", color = dsh().error) } } }) { DesktopNote(description) }
}
