package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.DshViewModel
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable
internal fun NativeRemoteScreen(vm: DshViewModel, onAttachment: () -> Unit) {
    if (vm.panel.isBlank()) {
        NativeChatScreen(vm.chat, vm::onChatAction, { vm.panel = "work" }, onAttachment, vm::removeImage, vm::leaveComputer)
        return
    }
    val keyboard = LocalSoftwareKeyboardController.current
    val ime = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    BackHandler { if (ime) keyboard?.hide() else vm.panel = if (vm.panel == "work") "" else "work" }
    var input by remember(vm.panel) { mutableStateOf("") }
    var selectedSession by remember { mutableStateOf<NativeSession?>(null) }
    var selectedWorkspace by remember { mutableStateOf<NativeWorkspace?>(null) }
    var confirmation by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(dsh().sidebarFill).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { vm.panel = if (vm.panel == "work") "" else "work" }) { Text("返回") }
            Text(when(vm.panel) { "new" -> "新会话"; "browse" -> "选择电脑上的目录"; "git" -> "Git";
                "sessions" -> "会话管理"; "settings" -> "设置"; else -> "工作区" }, Modifier.padding(12.dp), color = dsh().labelPrimary)
            if (vm.panelBusy) CircularProgressIndicator(Modifier.size(24.dp))
        }
        if (vm.chat.banner.isNotBlank()) SelectionContainer { Text(vm.chat.banner, Modifier.padding(12.dp), color = dsh().error) }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when(vm.panel) {
                "work" -> {
                    item { WorkButton("新会话 · 选择工作区", !vm.chat.offline) { vm.panel = "new" } }
                    item { WorkButton("会话管理与内容搜索", !vm.chat.offline) { vm.panel = "sessions" } }
                    item { WorkButton("Git · 分支 / 提交 / 推送 / PR", !vm.chat.offline && vm.currentSession()?.cwd?.isNotBlank() == true) { vm.openGit() } }
                    item { WorkButton("设置与已配对电脑") { vm.panel = "settings" } }
                    items(vm.workspaces, key = { it.id }) { workspace ->
                        Row { Text(workspace.title.ifBlank { workspace.path }, Modifier.weight(1f).padding(12.dp), color = dsh().labelPrimary)
                            TextButton(onClick = { selectedWorkspace = workspace; input = workspace.title }) { Text("管理") } }
                    }
                    item { Text("文件与更改：远程网关尚未提供文件浏览；请在电脑端查看。", color = dsh().labelSecondary) }
                    item { Text("MCP 与技能：远程端暂未接入管理；请在电脑端操作。", color = dsh().labelSecondary) }
                }
                "new" -> {
                    item { WorkButton("无工作目录的新会话", !vm.panelBusy) { vm.createSession() } }
                    items(vm.workspaces, key = { it.id }) { ws -> WorkButton(ws.title.ifBlank { ws.path }, !vm.panelBusy) { vm.createSession(ws.id) } }
                    item { WorkButton("浏览电脑目录…", !vm.panelBusy) { vm.browse() } }
                }
                "browse" -> {
                    item { Text(vm.panelData.string("path"), color = dsh().labelPrimary) }
                    val crumbs = vm.panelData.objects("crumbs")
                    item { WorkButton("上一级", !vm.panelBusy && crumbs.size > 1) { vm.browse(crumbs[crumbs.size - 2].string("path")) } }
                    if (vm.panelData["truncated"].flag()) item { Text("此目录内容较多，电脑端返回的列表已截断。", color = dsh().labelSecondary) }
                    items(vm.panelData.objects("entries"), key = { it.string("path") }) { entry ->
                        WorkButton(entry.string("name"), !vm.panelBusy) { vm.browse(entry.string("path")) }
                    }
                    item { OutlinedTextField(input, { input = it }, label = { Text("新文件夹名称") }, modifier = Modifier.fillMaxWidth()) }
                    item { WorkButton("创建文件夹", input.isNotBlank() && !vm.panelBusy) { vm.createDirectory(input.trim()) } }
                    item { WorkButton("使用当前目录创建会话", vm.panelData.string("path").isNotBlank() && !vm.panelBusy) { vm.registerDirectory() } }
                }
                "sessions" -> {
                    item { OutlinedTextField(input, { input = it }, label = { Text("搜索标题或消息内容") }, modifier = Modifier.fillMaxWidth()) }
                    item { WorkButton("搜索内容", input.isNotBlank() && !vm.panelBusy) { vm.findSessions(input) } }
                    if (vm.panelData.objects("items").isNotEmpty()) items(vm.panelData.objects("items")) { result ->
                        WorkButton(result.string("title").ifBlank { result.string("snippet") }) {
                            vm.panel = ""; vm.openSession(result.string("sessionId"))
                        }
                    }
                    items(vm.allSessions.filter { input.isBlank() || it.title.contains(input, true) }, key = { it.id }) { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            TextButton(onClick = { vm.panel = ""; vm.openSession(row.id) }, modifier = Modifier.weight(1f)) {
                                Text((if (row.archived) "已归档 · " else "") + row.title)
                            }
                            TextButton(onClick = { selectedSession = row; input = row.title }) { Text("管理") }
                        }
                    }
                }
                "settings" -> {
                    item { Text("外观", color = dsh().labelPrimary) }
                    item { Row { listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEach { (key, label) ->
                        TextButton(onClick = { vm.persistScheme(key) }) { Text(label + if (vm.scheme == key) " ✓" else "") }
                    } } }
                    item { Text("已配对电脑", color = dsh().labelPrimary) }
                    items(vm.computers, key = { it.serverId }) { computer ->
                        Row { TextButton(onClick = { vm.reopenComputer(computer.serverId) }, modifier = Modifier.weight(1f)) { Text(computer.computerName) }
                            TextButton(onClick = { confirmation = computer.serverId }) { Text("移除") } }
                    }
                    item { WorkButton("断开连接", true, vm::leaveComputer) }
                }
                "git" -> item { NativeGitPage(vm) }
            }
        }
    }
    selectedSession?.let { row ->
        AlertDialog(onDismissRequest = { selectedSession = null }, title = { Text(row.title) }, text = {
            Column {
                OutlinedTextField(input, { input = it }, label = { Text("会话名称") })
                WorkButton("重命名", !vm.panelBusy && input.isNotBlank()) { vm.sessionAction("session.rename", row, input.trim()); selectedSession = null }
                WorkButton("Fork", !vm.panelBusy) { vm.sessionAction("session.fork", row); selectedSession = null }
                if (!row.archived && row.workspaceId.isNotBlank()) {
                    WorkButton("上移", !vm.panelBusy) { vm.moveSession(row, -1); selectedSession = null }
                    WorkButton("下移", !vm.panelBusy) { vm.moveSession(row, 1); selectedSession = null }
                }
                WorkButton(if (row.archived) "取消归档" else "归档", !vm.panelBusy) {
                    vm.sessionAction(if (row.archived) "workspace.unarchiveSession" else "workspace.archiveSession", row); selectedSession = null
                }
                if (row.archived) WorkButton("永久删除", !vm.panelBusy) { confirmation = "delete:${row.id}" }
            }
        }, confirmButton = { TextButton(onClick = { selectedSession = null }) { Text("关闭") } })
    }
    selectedWorkspace?.let { workspace ->
        AlertDialog(onDismissRequest = { selectedWorkspace = null }, title = { Text(workspace.title.ifBlank { workspace.path }) }, text = {
            Column {
                OutlinedTextField(input, { input = it }, label = { Text("工作区名称") })
                WorkButton("重命名", input.isNotBlank() && !vm.panelBusy) {
                    vm.workspaceAction("workspace.rename", workspace, input.trim()); selectedWorkspace = null
                }
                WorkButton("从列表移除工作区", !vm.panelBusy) { confirmation = "workspace:${workspace.id}" }
            }
        }, confirmButton = { TextButton(onClick = { selectedWorkspace = null }) { Text("关闭") } })
    }
    if (confirmation.isNotBlank()) AlertDialog(onDismissRequest = { confirmation = "" }, title = { Text("确认移除？") },
        text = { Text(when { confirmation.startsWith("delete:") -> "永久删除电脑上的归档会话，此操作不可恢复。"
            confirmation.startsWith("workspace:") -> "移除工作区登记，目录与文件会保留。"
            else -> "移除本机保存的配对凭据。重新连接需要扫码，草稿会保留。" }) },
        confirmButton = { TextButton(onClick = {
            if (confirmation.startsWith("delete:")) vm.allSessions.find { it.id == confirmation.removePrefix("delete:") }?.let { vm.sessionAction("session.delete", it) }
            else if (confirmation.startsWith("workspace:")) vm.workspaces.find { it.id == confirmation.removePrefix("workspace:") }?.let { vm.workspaceAction("workspace.delete", it) }
            else vm.forgetComputer(confirmation)
            confirmation = ""; selectedSession = null; selectedWorkspace = null
        }) { Text("确认") } }, dismissButton = { TextButton(onClick = { confirmation = "" }) { Text("取消") } })
}

@Composable
private fun WorkButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(label) }
}

@Composable
private fun NativeGitPage(vm: DshViewModel) {
    val status = vm.panelData["status"].objectValue()
    val branchData = vm.panelData["branches"]
    val branches = if (branchData is JsonArray) branchData.map { it.objectValue() } else branchData.objectValue().objects("branches")
    val fileData = vm.panelData["entries"]
    val files = if (fileData is JsonArray) fileData.map { it.objectValue() } else fileData.objectValue().objects("entries")
    var branch by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var remote by remember { mutableStateOf("") }
    var repositoryName by remember { mutableStateOf(vm.currentSession()?.cwd?.trimEnd('/', '\\')?.substringAfterLast('/')?.substringAfterLast('\\').orEmpty()) }
    var featureBranch by remember { mutableStateOf(false) }
    var selectedFiles by remember { mutableStateOf(files.map { it.string("path") }.toSet()) }
    var defaultConfirmation by remember { mutableStateOf<List<String>?>(null) }
    val available = !vm.panelBusy && !vm.chat.offline
    val diverged = (status["aheadCount"].number() ?: 0) > 0 && (status["behindCount"].number() ?: 0) > 0
    val payload = obj("message" to message, "filePaths" to selectedFiles.toList(), "options" to obj("featureBranch" to featureBranch))
    fun execute(steps: List<String>) {
        if (status["isDefaultRef"].flag() && steps.any { it in setOf("git-commit", "git-push", "git-create-change-request") } && !featureBranch) defaultConfirmation = steps
        else vm.gitAction(steps, payload)
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (vm.gitRemaining.isNotEmpty() && !vm.panelBusy) {
            Text("已完成：${vm.gitCompleted.joinToString().ifBlank { "无" }}", color = dsh().labelSecondary)
            WorkButton("继续剩余操作：${vm.gitRemaining.joinToString()}", available) { vm.retryGit() }
        }
        Text("分支：${status.string("refName").ifBlank { "尚未初始化" }}", color = dsh().labelPrimary)
        if (!status["isRepo"].flag() && status.string("refName").isBlank()) WorkButton("初始化 Git", available) { vm.gitAction(listOf("git-init")) }
        OutlinedTextField(branch, { branch = it }, label = { Text("搜索分支 / 新分支名称") }, modifier = Modifier.fillMaxWidth())
        branches.filter { branch.isBlank() || it.string("name").contains(branch, true) }.forEach { row ->
            WorkButton(row.string("name"), available && row["switchable"]?.flag() != false) { vm.gitAction(listOf("git-switch-branch"), obj("ref" to row.string("name"))) }
        }
        WorkButton("创建并切换分支", available && branch.isNotBlank()) { vm.gitAction(listOf("git-create-branch"), obj("name" to branch.trim())) }
        OutlinedTextField(message, { message = it }, label = { Text("提交说明（可留空由桌面生成）") }, modifier = Modifier.fillMaxWidth())
        Row { Checkbox(featureBranch, { featureBranch = it }); Text("在新工作分支提交", Modifier.padding(top = 12.dp), color = dsh().labelPrimary) }
        files.forEach { file -> val path = file.string("path")
            Row { Checkbox(path in selectedFiles, { selectedFiles = if (it) selectedFiles + path else selectedFiles - path }); Text(path, Modifier.padding(top = 12.dp), color = dsh().labelSecondary) }
        }
        val canCommit = available && (files.isEmpty() || selectedFiles.isNotEmpty())
        WorkButton("提交", canCommit) { execute(listOf("git-commit")) }
        WorkButton("提交并推送", canCommit) { execute(listOf("git-commit", "git-push")) }
        WorkButton("提交、推送并创建 PR", canCommit) { execute(listOf("git-commit", "git-push", "git-create-change-request")) }
        WorkButton("推送", available) { execute(listOf("git-push")) }
        WorkButton("推送并创建 PR", available) { execute(listOf("git-push", "git-create-change-request")) }
        if (diverged) Text("分支已分叉，请在电脑端合并或变基后同步。", color = dsh().labelSecondary)
        WorkButton("拉取", available && !diverged) { vm.gitAction(listOf("git-pull")) }
        WorkButton("查看 PR", available) { vm.viewPullRequest() }
        OutlinedTextField(remote, { remote = it }, label = { Text("发布到已有仓库 URL（留空创建私有仓库）") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(repositoryName, { repositoryName = it }, label = { Text("新仓库名称") }, modifier = Modifier.fillMaxWidth())
        WorkButton("发布仓库", available && !status["hasPrimaryRemote"].flag() && (remote.isNotBlank() || repositoryName.isNotBlank())) {
            vm.gitAction(listOf("git-publish"), obj("remoteUrl" to remote, "name" to repositoryName, "visibility" to "private"))
        }
    }
    defaultConfirmation?.let { steps -> AlertDialog(onDismissRequest = { defaultConfirmation = null }, title = { Text("在默认分支继续？") },
        text = { Text("当前分支是默认分支。可返回创建工作分支，或确认继续此操作。") },
        confirmButton = { TextButton(onClick = { defaultConfirmation = null; vm.gitAction(steps, payload) }) { Text("继续") } },
        dismissButton = { Column {
            TextButton(onClick = { defaultConfirmation = null }) { Text("返回") }
            if (branch.isNotBlank()) TextButton(onClick = {
                defaultConfirmation = null
                vm.gitAction(listOf("git-create-branch") + steps, JsonObject(payload + ("name" to JsonPrimitive(branch.trim()))))
            }) { Text("创建工作分支并继续") }
        } }) }
}
