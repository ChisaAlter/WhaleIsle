package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.DshViewModel
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
internal fun NativeRemoteScreen(vm: DshViewModel, onAttachment: () -> Unit) {
    var selectedSessionId by rememberSaveable(vm.uiOwnerEpoch, vm.chat.sessionId) { mutableStateOf("") }
    var selectedWorkspaceId by rememberSaveable(vm.uiOwnerEpoch, vm.chat.sessionId) { mutableStateOf("") }
    var name by rememberSaveable(vm.uiOwnerEpoch, vm.chat.sessionId) { mutableStateOf("") }
    var confirmation by rememberSaveable(vm.uiOwnerEpoch, vm.chat.sessionId) { mutableStateOf("") }
    val selectedSession = vm.allSessions.find { it.id == selectedSessionId }
    val selectedWorkspace = vm.workspaces.find { it.id == selectedWorkspaceId }
    val chatUiState = rememberSaveableStateHolder()
    val taskPage = vm.panel in setOf("browse", "sessions", "git")
    if (vm.panel == "settings") {
        NativeSettingsScreen(vm, onClose = { vm.panel = "" })
    } else if (taskPage) {
        NativeTaskPage(vm, onSessionMenu = { selectedSessionId = it.id; name = it.title })
    } else {
        // Keep the same computer/session registry across transport recovery.
        chatUiState.SaveableStateProvider("chat:${vm.uiOwnerEpoch}:${vm.chat.sessionId}") {
            NativeChatScreen(state = vm.chat, workspaces = vm.workspaces, onAction = vm::onChatAction,
                onPanel = { vm.panel = it },
                onWorkspaceMenu = { selectedWorkspaceId = it.id; name = it.title },
                onSessionMenu = { selectedSessionId = it.id; name = it.title },
                onAttachment = onAttachment, onRemoveAttachment = vm::removeImage, onLeave = vm::leaveComputer,
                showConnectionNotice = vm.panel.isBlank() && selectedSession == null && selectedWorkspace == null && confirmation.isBlank())
        }
    }
    val colors = dsh()
    val remoteAvailable = !vm.panelBusy && !vm.chat.offline && !vm.chat.loading
    val connectionFeedback = when {
        vm.chat.offline -> vm.chat.error.ifBlank { vm.chat.connLabel }.ifBlank { "连接已断开，正在等待重连" }
        vm.chat.loading -> vm.chat.error
        else -> ""
    }
    val syncFailed = !vm.chat.offline && vm.chat.loading && vm.chat.error.isNotBlank()
    when (vm.panel) {
        "new" -> NativeDialog("新会话", onDismiss = { vm.panel = "" }, feedback = connectionFeedback.ifBlank { vm.panelError }, feedbackHint = "选择工作区，或浏览电脑上的目录。") {
            if (syncFailed) NativeChoiceRow("重试同步", onClick = vm::onForeground)
            NativeChoiceRow(if (vm.panelBusy) "正在创建会话…" else "无工作目录", enabled = remoteAvailable, glyph = NativeGlyph.Plus, onClick = { vm.createSession() })
            vm.workspaces.forEach { workspace ->
                NativeChoiceRow(workspace.title.ifBlank { workspace.path }, detail = workspace.path,
                    enabled = remoteAvailable, glyph = NativeGlyph.Folder, onClick = { vm.createSession(workspace.id) })
            }
            NativeChoiceRow(if (vm.panelBusy) "正在读取目录…" else "浏览电脑目录…", enabled = remoteAvailable, glyph = NativeGlyph.Folder, onClick = { vm.browse() })
        }
        "work" -> NativeDialog("会话与工作区", onDismiss = { vm.panel = "" }, feedback = connectionFeedback.ifBlank { vm.panelError }, feedbackHint = "管理当前会话与工作区；搜索和 Git 将打开任务页。") {
            NativeChoiceRow("新会话", glyph = NativeGlyph.Plus, enabled = !vm.chat.offline, onClick = { vm.panel = "new" })
            NativeChoiceRow("会话管理与内容搜索", glyph = NativeGlyph.Search, enabled = !vm.chat.offline, onClick = { vm.panel = "sessions" })
            NativeChoiceRow(if (vm.panelBusy) "正在读取 Git…" else "Git · 分支 / Commit / Push / PR", enabled = remoteAvailable && vm.currentSession()?.cwd?.isNotBlank() == true,
                onClick = { vm.openGit() })
            NativeChoiceRow(if (vm.chat.offline) "重新连接电脑" else "重新同步目录与会话", onClick = vm::onForeground)
            if (vm.workspaces.isNotEmpty()) {
                HorizontalDivider(color = colors.borderHair, modifier = Modifier.padding(vertical = 4.dp))
                vm.workspaces.forEach { workspace ->
                    NativeChoiceRow(workspace.title.ifBlank { workspace.path }, detail = workspace.path, glyph = NativeGlyph.Folder,
                        onClick = { vm.panel = ""; selectedWorkspaceId = workspace.id; name = workspace.title })
                }
            }
            Text("文件与更改：远程网关尚未提供文件浏览；请在电脑端查看。", Modifier.padding(12.dp), color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
            Text("MCP 与技能：远程端暂未接入管理；请在电脑端操作。", Modifier.padding(horizontal = 12.dp), color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
        }
    }
    selectedSession?.let { row ->
        NativeDialog("管理会话", onDismiss = { selectedSessionId = "" }, feedback = connectionFeedback, feedbackHint = connectionFeedback) {
            NativeField(name, { name = it }, "会话名称", enabled = !vm.panelBusy)
            NativeChoiceRow("重命名", enabled = remoteAvailable && name.isNotBlank(), onClick = { vm.sessionAction("session.rename", row, name.trim()); selectedSessionId = "" })
            NativeChoiceRow("Fork", enabled = remoteAvailable, onClick = { vm.sessionAction("session.fork", row); selectedSessionId = ""; vm.panel = "" })
            if (!row.archived && row.workspaceId.isNotBlank()) {
                NativeChoiceRow("上移", enabled = remoteAvailable, onClick = { vm.moveSession(row, -1); selectedSessionId = "" })
                NativeChoiceRow("下移", enabled = remoteAvailable, onClick = { vm.moveSession(row, 1); selectedSessionId = "" })
            }
            NativeChoiceRow(if (row.archived) "取消归档" else "归档", enabled = remoteAvailable, onClick = {
                vm.sessionAction(if (row.archived) "workspace.unarchiveSession" else "workspace.archiveSession", row); selectedSessionId = ""
            })
            if (row.archived) NativeChoiceRow("永久删除", enabled = remoteAvailable, danger = true, onClick = { confirmation = "delete:${row.id}" })
        }
    }
    selectedWorkspace?.let { workspace ->
        NativeDialog("管理工作区", onDismiss = { selectedWorkspaceId = "" }, feedback = connectionFeedback, feedbackHint = connectionFeedback) {
            Text(workspace.path, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
            NativeChoiceRow("在此目录新建会话", glyph = NativeGlyph.Plus, enabled = remoteAvailable, onClick = { vm.createSession(workspace.id); selectedWorkspaceId = "" })
            NativeField(name, { name = it }, "工作区名称", enabled = !vm.panelBusy)
            NativeChoiceRow("重命名", enabled = name.isNotBlank() && remoteAvailable, onClick = { vm.workspaceAction("workspace.rename", workspace, name.trim()); selectedWorkspaceId = "" })
            NativeChoiceRow("从列表移除工作区", enabled = remoteAvailable, danger = true, onClick = { confirmation = "workspace:${workspace.id}" })
        }
    }
    if (confirmation.isNotBlank()) NativeDialog("确认移除？", onDismiss = { confirmation = "" }, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { confirmation = "" }) { Text("取消") }
            TextButton(enabled = if (confirmation.startsWith("delete:") || confirmation.startsWith("workspace:")) remoteAvailable else !vm.panelBusy, onClick = {
                when {
                    confirmation.startsWith("delete:") -> vm.allSessions.find { it.id == confirmation.removePrefix("delete:") }?.let { vm.sessionAction("session.delete", it) }
                    confirmation.startsWith("workspace:") -> vm.workspaces.find { it.id == confirmation.removePrefix("workspace:") }?.let { vm.workspaceAction("workspace.delete", it) }
                    else -> vm.forgetComputer(confirmation)
                }
                confirmation = ""; selectedSessionId = ""; selectedWorkspaceId = ""
            }) { Text("确认移除", color = colors.error) }
        }
    }) {
        Text(when {
            confirmation.startsWith("delete:") -> "永久删除电脑上的归档会话，此操作不可恢复。"
            confirmation.startsWith("workspace:") -> "移除工作区登记，目录与文件会保留。"
            else -> "移除本机保存的配对凭据。重新连接需要扫码，草稿会保留。"
        }, Modifier.padding(12.dp), color = colors.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp)
    }
}

@Composable
private fun NativeTaskPage(vm: DshViewModel, onSessionMenu: (NativeSession) -> Unit) {
    val colors = dsh()
    val keyboard = LocalSoftwareKeyboardController.current
    val ime = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    fun goBack() { vm.panel = if (vm.panel == "browse") "new" else "" }
    BackHandler { if (ime) keyboard?.hide() else goBack() }
    var query by rememberSaveable(vm.uiOwnerEpoch, vm.chat.sessionId, vm.panel) { mutableStateOf("") }
    var newDirectory by rememberSaveable(vm.uiOwnerEpoch, vm.chat.sessionId, vm.panelData.string("path")) { mutableStateOf("") }
    var searched by rememberSaveable(vm.uiOwnerEpoch, vm.chat.sessionId, vm.panel) { mutableStateOf(false) }
    val remoteAvailable = !vm.panelBusy && !vm.chat.offline && !vm.chat.loading
    Column(Modifier.fillMaxSize().background(colors.bgBase)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            NativeIconButton(NativeGlyph.Back, "返回聊天", ::goBack)
            Text(when (vm.panel) { "browse" -> "选择电脑上的目录"; "git" -> "Git"; else -> "会话管理与搜索" }, Modifier.weight(1f).padding(vertical = 4.dp), color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (vm.panelBusy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = colors.labelSecondary)
        }
        if (vm.chat.offline) {
            Text(vm.chat.error.ifBlank { vm.chat.connLabel }.ifBlank { "连接已断开，正在等待重连" } + "\n内容已保留，连接恢复后可继续操作。",
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
        } else if (vm.chat.loading) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(vm.chat.error.ifBlank { "正在同步会话，请稍候…" }, color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
                if (vm.chat.error.isNotBlank()) TextButton(onClick = vm::onForeground) { Text("重试同步") }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (vm.panel) {
                    "browse" -> {
                        item { SelectionContainer { Text(vm.panelData.string("path"), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp) } }
                        val crumbs = vm.panelData.objects("crumbs")
                        item { NativeChoiceRow("上一级", enabled = remoteAvailable && crumbs.size > 1, glyph = NativeGlyph.Back, onClick = { vm.browse(crumbs[crumbs.size - 2].string("path")) }) }
                        if (vm.panelData["truncated"].flag()) item { Text("此目录内容较多，电脑端返回的列表已截断。", color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp) }
                        items(vm.panelData.objects("entries"), key = { it.string("path") }) { entry ->
                            NativeChoiceRow(entry.string("name"), enabled = remoteAvailable, glyph = NativeGlyph.Folder, onClick = { vm.browse(entry.string("path")) })
                        }
                        item { NativeField(newDirectory, { newDirectory = it }, "新文件夹名称", enabled = !vm.panelBusy) }
                        item { WorkButton("创建文件夹", newDirectory.isNotBlank() && remoteAvailable) { vm.createDirectory(newDirectory.trim()) } }
                    }
                    "sessions" -> {
                        item { NativeField(query, { query = it; searched = false }, "搜索标题或消息内容") }
                        item { WorkButton(if (vm.panelBusy) "正在搜索…" else "搜索内容", query.isNotBlank() && remoteAvailable) { searched = true; vm.findSessions(query) } }
                        if (searched) {
                            val results = vm.panelData.objects("items")
                            if (remoteAvailable && results.isEmpty()) item { Text("没有匹配的消息内容", color = colors.labelSecondary, fontSize = 14.sp, lineHeight = 22.sp) }
                            items(results) { result -> NativeChoiceRow(result.string("title").ifBlank { result.string("snippet") }, detail = result.string("snippet"), enabled = remoteAvailable, onClick = { vm.panel = ""; vm.openSession(result.string("sessionId")) }) }
                        }
                        val rows = vm.allSessions.filter { query.isBlank() || it.title.contains(query, true) }
                        if (rows.isEmpty() && !searched && !vm.chat.offline && !vm.chat.loading) item { Text("没有匹配的会话", color = colors.labelSecondary, fontSize = 14.sp, lineHeight = 22.sp) }
                        items(rows, key = { it.id }) { row ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.weight(1f)) { NativeChoiceRow((if (row.archived) "已归档 · " else "") + row.title, detail = row.workspace, enabled = remoteAvailable, onClick = { vm.panel = ""; vm.openSession(row.id) }) }
                                NativeIconButton(NativeGlyph.More, "管理会话${row.title}", { onSessionMenu(row) })
                            }
                        }
                    }
                    "git" -> item { NativeGitPage(vm) }
                }
            }
            NativeTaskNotice(vm)
        }
        if (vm.panel == "browse") Box(Modifier.fillMaxWidth().background(colors.bgLayer1).padding(horizontal = 16.dp, vertical = 8.dp)) {
            NativePill(if (vm.panelBusy) "正在创建会话…" else "使用当前目录创建会话", { vm.registerDirectory() }, primary = true, enabled = vm.panelData.string("path").isNotBlank() && remoteAvailable)
        }
    }
}

@Composable
private fun NativeTaskNotice(vm: DshViewModel) {
    val colors = dsh()
    val message = vm.chat.banner
    var shown by remember(message) { mutableStateOf(message.isNotBlank()) }
    LaunchedEffect(message) { if (message.isNotBlank()) { kotlinx.coroutines.delay(6_000); shown = false } }
    if (shown) Surface(Modifier.fillMaxWidth().padding(12.dp), shape = RoundedCornerShape(12.dp), color = colors.bgLayer2, border = BorderStroke(1.dp, colors.borderL2), shadowElevation = 4.dp) {
        SelectionContainer { Text(message, Modifier.padding(12.dp), color = colors.labelPrimary, fontSize = 12.sp, lineHeight = 18.sp) }
    }
}

@Composable
private fun WorkButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, dsh().borderL2)) { Text(label, fontSize = 14.sp, lineHeight = 22.sp) }
}

@Composable
private fun NativeGitPage(vm: DshViewModel) {
    val status = vm.panelData["status"].objectValue()
    val branchData = vm.panelData["branches"]
    val branches = if (branchData is JsonArray) branchData.map { it.objectValue() } else branchData.objectValue().objects("branches")
    val fileData = vm.panelData["entries"]
    val files = if (fileData is JsonArray) fileData.map { it.objectValue() } else fileData.objectValue().objects("entries")
    val cwd = vm.currentSession()?.cwd.orEmpty()
    var branch by rememberSaveable(vm.chat.epoch, vm.chat.sessionId, cwd) { mutableStateOf("") }
    var message by rememberSaveable(vm.chat.epoch, vm.chat.sessionId, cwd) { mutableStateOf("") }
    var remote by rememberSaveable(vm.chat.epoch, vm.chat.sessionId, cwd) { mutableStateOf("") }
    var repositoryName by rememberSaveable(vm.chat.epoch, vm.chat.sessionId, cwd) { mutableStateOf(cwd.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\')) }
    var featureBranch by rememberSaveable(vm.chat.epoch, vm.chat.sessionId, cwd) { mutableStateOf(false) }
    var selectedFiles by rememberSaveable(vm.chat.epoch, vm.chat.sessionId, cwd) { mutableStateOf(files.map { it.string("path") }) }
    var defaultConfirmation by rememberSaveable(vm.chat.epoch, vm.chat.sessionId, cwd) { mutableStateOf<List<String>?>(null) }
    val available = !vm.panelBusy && !vm.chat.offline
    val diverged = (status["aheadCount"].number() ?: 0) > 0 && (status["behindCount"].number() ?: 0) > 0
    val payload = obj("message" to message, "filePaths" to selectedFiles.toList(), "options" to obj("featureBranch" to featureBranch))
    fun execute(steps: List<String>) {
        if (status["isDefaultRef"].flag() && steps.any { it in setOf("git-commit", "git-push", "git-create-change-request") } && !featureBranch) defaultConfirmation = steps
        else vm.gitAction(steps, payload)
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (vm.gitRemaining.isNotEmpty() && !vm.panelBusy) {
            Text("已完成：${vm.gitCompleted.joinToString().ifBlank { "无" }}", color = dsh().labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
            WorkButton("继续剩余操作：${vm.gitRemaining.joinToString()}", available) { vm.retryGit() }
        }
        Text("分支：${status.string("refName").ifBlank { "尚未初始化" }}", color = dsh().labelPrimary, fontSize = 14.sp, lineHeight = 22.sp)
        if (!status["isRepo"].flag() && status.string("refName").isBlank()) WorkButton("初始化 Git", available) { vm.gitAction(listOf("git-init")) }
        NativeField(branch, { branch = it }, "搜索分支 / 新分支名称", enabled = !vm.panelBusy)
        branches.filter { branch.isBlank() || it.string("name").contains(branch, true) }.forEach { row ->
            NativeChoiceRow(row.string("name"), selected = row.string("name") == status.string("refName"), enabled = available && row["switchable"]?.flag() != false, onClick = { vm.gitAction(listOf("git-switch-branch"), obj("ref" to row.string("name"))) })
        }
        WorkButton("创建并切换分支", available && branch.isNotBlank()) { vm.gitAction(listOf("git-create-branch"), obj("name" to branch.trim())) }
        NativeField(message, { message = it }, "提交说明（可留空由桌面生成）", enabled = !vm.panelBusy, minLines = 2)
        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(featureBranch, { featureBranch = it }); Text("在新工作分支提交", color = dsh().labelPrimary, fontSize = 14.sp, lineHeight = 22.sp) }
        files.forEach { file -> val path = file.string("path")
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(path in selectedFiles, { selectedFiles = if (it) selectedFiles + path else selectedFiles - path }); Text(path, color = dsh().labelSecondary, fontSize = 12.sp, lineHeight = 18.sp) }
        }
        val canCommit = available && (files.isEmpty() || selectedFiles.isNotEmpty())
        WorkButton("Commit", canCommit) { execute(listOf("git-commit")) }
        WorkButton("Commit & Push", canCommit) { execute(listOf("git-commit", "git-push")) }
        WorkButton("Commit, Push & PR", canCommit) { execute(listOf("git-commit", "git-push", "git-create-change-request")) }
        WorkButton("Push", available) { execute(listOf("git-push")) }
        WorkButton("Push & PR", available) { execute(listOf("git-push", "git-create-change-request")) }
        if (diverged) Text("分支已分叉，请在电脑端合并或变基后同步。", color = dsh().labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
        WorkButton("Pull", available && !diverged) { vm.gitAction(listOf("git-pull")) }
        WorkButton("View PR", available) { vm.viewPullRequest() }
        NativeField(remote, { remote = it }, "发布到已有仓库 URL（留空创建私有仓库）", enabled = !vm.panelBusy)
        NativeField(repositoryName, { repositoryName = it }, "新仓库名称", enabled = !vm.panelBusy)
        WorkButton("Publish", available && !status["hasPrimaryRemote"].flag() && (remote.isNotBlank() || repositoryName.isNotBlank())) {
            vm.gitAction(listOf("git-publish"), obj("remoteUrl" to remote, "name" to repositoryName, "visibility" to "private"))
        }
    }
    if (vm.gitReview) NativeDialog("确认 PR / MR", onDismiss = vm::cancelGitReview, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = vm::cancelGitReview) { Text("保留草稿") }
            TextButton(onClick = vm::confirmGitReview, enabled = available && vm.gitDraftTitle.isNotBlank()) { Text("确认创建") }
        }
    }) {
        Text("确认后才创建请求；已完成的 Commit 与 Push 不会重复。", Modifier.padding(12.dp), color = dsh().labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
        Text("工作区：${vm.currentSession()?.cwd.orEmpty()}", Modifier.padding(horizontal = 12.dp), color = dsh().labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
        NativeField(vm.gitDraftTitle, { vm.gitDraftTitle = it }, "标题", enabled = !vm.panelBusy)
        NativeField(vm.gitDraftBody, { vm.gitDraftBody = it }, "正文（Markdown）", enabled = !vm.panelBusy, minLines = 4)
        NativeChoiceRow("生成 / 重新生成草稿", enabled = available, onClick = vm::generateGitDraft)
        vm.gitDraftCandidate?.let { candidate ->
            SelectionContainer { Text(candidate.string("title") + "\n\n" + candidate.string("body"), color = dsh().labelPrimary, fontSize = 14.sp, lineHeight = 22.sp) }
            NativeChoiceRow("应用生成草稿", enabled = available, onClick = vm::applyGitDraft)
        }
    }
    defaultConfirmation?.let { steps -> NativeDialog("在默认分支继续？", onDismiss = { defaultConfirmation = null }, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { defaultConfirmation = null }) { Text("返回") }
            TextButton(onClick = { defaultConfirmation = null; vm.gitAction(steps, payload) }) { Text("继续") }
        }
    }) {
        Text("当前分支是默认分支。可返回创建工作分支，或确认继续此操作。", Modifier.padding(12.dp), color = dsh().labelPrimary, fontSize = 14.sp, lineHeight = 22.sp)
        if (branch.isNotBlank()) NativeChoiceRow("创建工作分支并继续", onClick = {
            defaultConfirmation = null
            vm.gitAction(listOf("git-create-branch") + steps, JsonObject(payload + ("name" to JsonPrimitive(branch.trim()))))
        })
    } }
}
